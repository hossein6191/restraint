/* Restraint against GenLayer Studio (chain 61999), with throwaway accounts. Deploys its own copy.
 *
 *   npm ci                                                   # genlayer-js 1.1.8 and viem 2.56.8, pinned by package-lock.json
 *   COMMIT=<sha> node tests/on_chain/smoke.mjs               # the whole run, about forty minutes
 *   COMMIT=<sha> RESUME=1 node tests/on_chain/smoke.mjs      # continue a run that was cut off, from the saved state
 *   STATE=/some/dir/run.json ...                             # the state file: keys, contract address, every step made
 *   FRESH=1 ...                                              # start over even though a saved run exists
 *
 * The validators read the leaver's pages from raw.githubusercontent.com, pinned to one commit, so the page every
 * node fetches is the same bytes. Push the repository first and pass that commit as COMMIT (40 hex characters).
 * REPO is "<owner>/<name>" on GitHub; when it is not set it is read from `git remote get-url origin`. The script
 * fetches the pages itself before it deploys anything, and stops if they are not there.
 *
 * Three accounts the script generates and funds itself play the whole story: FIRM, a payroll company, opens garden
 * leave for LEAVER with the restraint "1. Selling payroll software to restaurants. 2. Working for Ledgerly or
 * Tillpoint." and LEAVER's profile prefix, profile/ at COMMIT; STRANGER tries what only the others may do.
 *
 * Phases:
 *   A  deploy. FIRM names itself as the leaver: refused, the value back in the same transaction. FIRM opens A1
 *      (0.3 GEN in 3 instalments of 900 s) and A2 (0.1 GEN, one instalment). STRANGER tries to accept A1 and is
 *      refused; LEAVER tries to accept it with another prefix and is refused; LEAVER accepts A1, repeating the
 *      prefix. FIRM cancels A2, never accepted (the pay back). LEAVER is refused instalment 1 before its period ends.
 *      FIRM deposits 0.2 GEN of report credit.
 *   B  one consensus round per report, every page read by the validators on the live web:
 *        STRANGER reports garden.html for A1: refused, only the firm may
 *        FIRM reports the repository's README, outside the prefix: refused before anything is fetched
 *        FIRM: garden.html (allotment notes)                 kept; the 0.05 GEN bond to LEAVER
 *        FIRM: garden.html again                             repeat: refused and recorded, the earlier reading stands,
 *                                                            the bond to LEAVER again
 *      the chain clock passes the end of period 1; LEAVER claims instalment 1 (0.1 GEN)
 *        FIRM: plateful.html (sells payroll software to restaurants)   breach; the unclaimed 0.2 GEN back to FIRM
 *      LEAVER is refused instalment 2: the agreement is breached.
 *   C  the deployed code is read back and compared with contracts/restraint.py byte for byte; the views are checked
 *      against what the run did; FIRM takes its credit back; the contract holds nothing; every account ends where
 *      the money says: LEAVER up one instalment and two bonds, FIRM down the same.
 *
 * Every refusal is a signed transaction. Balances are read before and after every step that moves money.
 * Transactions are polled with eth_getTransactionByHash, never with views (gen_call is limited to 30 a minute
 * per client, shared with sim_fundAccount). A round the validators do not carry stores nothing; it is sent again
 * and both transactions are kept. Every id is read from the receipt of the call that made it. Every wait is by the
 * chain's own clock, read from the views. Every step is saved as it is made, so a run cut off by a closed laptop
 * continues with RESUME=1 without sending anything twice.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const EXPLORER = "https://explorer-studio.genlayer.com";
const STATE = process.env.STATE || join(tmpdir(), "restraint-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }   // the connection itself failed, or the answer was not JSON
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const note = (s) => console.log(`      .. ${s}`);
const GEN = 10n ** 18n;
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const sha = (text) => createHash("sha256").update(text).digest("hex");

// ---------- where the validators will read the leaver's pages ----------
const COMMIT = String(process.env.COMMIT || "").trim();
if (!/^[0-9a-f]{40}$/.test(COMMIT)) {
  console.log("COMMIT must be the 40-character commit the pages were pushed in: COMMIT=<sha> node tests/on_chain/smoke.mjs");
  process.exit(2);
}
let REPO = String(process.env.REPO || "").trim();
if (!REPO) {
  try {
    const origin = execSync("git remote get-url origin", { cwd: new URL("../..", import.meta.url), encoding: "utf8" }).trim();
    REPO = (origin.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/) || [])[1] || "";
  } catch (e) { REPO = ""; }
}
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(REPO)) {
  console.log("REPO must be <owner>/<name> on GitHub (or set the git remote origin): REPO=<owner>/restraint COMMIT=<sha> ...");
  process.exit(2);
}
const RAW_ROOT = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/`;
const PROFILE = RAW_ROOT + "profile/";
if (PROFILE.length > 120) {
  console.log(`The profile prefix ${PROFILE} must be at most 120 characters (the contract's own rule); use a shorter repository name.`);
  process.exit(2);
}
const PAGE = { garden: PROFILE + "garden.html", plateful: PROFILE + "plateful.html" };
const OUTSIDE = RAW_ROOT + "README.md";          // a real page of the same commit, but not below the prefix
const LOCAL = {};
for (const [name, address] of Object.entries(PAGE)) {
  LOCAL[name] = readFileSync(new URL("../../profile/" + address.slice(PROFILE.length), import.meta.url), "utf8");
  let there = "";
  try { const r = await fetch(address); there = r.ok ? await r.text() : ""; } catch (e) { there = ""; }
  if (there !== LOCAL[name]) {
    console.log(`${address}\ndoes not serve profile/${address.slice(PROFILE.length)} as it is in this checkout. Push the repository and pass that commit as COMMIT.`);
    process.exit(2);
  }
}
// what every validator should fingerprint: the first 32,000 characters with their tags removed (and the text after a
// script or style tag), then their spacing collapsed, at most 6,000; the contract's _visible and _page_text
const visible = (text) => {
  const pieces = text.slice(0, 32000).split("<");
  let out = pieces[0];
  for (const piece of pieces.slice(1)) {
    const close = piece.indexOf(">");
    if (close === -1) out += "<" + piece;
    else if (/^(script|style)/.test(piece.slice(0, 6).toLowerCase())) out += " ";
    else out += " " + piece.slice(close + 1);
  }
  return out;
};
const fpOf = (text) => sha(visible(text).slice(0, 32000).split(/\s+/).filter(Boolean).join(" ").slice(0, 6000)).slice(0, 16);

// ---------- state: keys, the contract address and every step already made survive a cut-off run ----------
if (existsSync(STATE) && !process.env.RESUME && !process.env.FRESH) {
  console.log(`A saved run exists at ${STATE}.\nRESUME=1 continues it; FRESH=1 starts over; STATE=<path> keeps another.`);
  process.exit(2);
}
const st = existsSync(STATE) && process.env.RESUME && !process.env.FRESH ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || [];
st.commit = st.commit || COMMIT; st.repo = st.repo || REPO;
if (st.commit !== COMMIT) { console.log(`This saved run used commit ${st.commit}; continue it with that COMMIT, or start over with FRESH=1.`); process.exit(2); }
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = { firm: "FIRM, the payroll firm", leaver: "LEAVER, on garden leave", stranger: "STRANGER" };
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
save();

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });   // checksummed
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the
// sender's nonce says whether the transaction landed after all, and its hash is read back, so nothing
// is ever sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      const text = errText(e);
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${text.slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => String(t.from_address).toLowerCase() === addr.toLowerCase() && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, msg, exec: one?.execution_result || "", votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: countVotes(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settleBalance = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step of the run: a signed transaction, its tally, what it returned, and the balances it moved.
// opt.value is what is sent with it; opt.watch names the accounts whose balances are read before and
// after; opt.expect is the change each should show once every transfer has landed, a table or a
// function of what the call returned. A step already in the saved state is not sent again.
const call = async (id, who, fn, args = [], opt = {}) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn, args: args.map(String), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const watch = opt.watch || [];
    if (!rec.before) { rec.before = {}; for (const k of watch) rec.before[k] = String(await balance(acct[k].address)); save(); }
    let r;
    for (;;) {
      if (!rec.pending) {
        rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: st.contract, functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) }));
        save();
      }
      r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg, at: stamp() });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(-30)).join(", ")})${opt.value ? " +" + Number(opt.value) / 1e18 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      break;
    }
    const expect = typeof opt.expect === "function" ? opt.expect(jsonOf(r.msg)) : opt.expect;
    rec.after = {}; rec.delta = {};
    for (const k of watch) {
      const before = BigInt(rec.before[k]);
      const want = expect && expect[k] !== undefined ? BigInt(expect[k]) : null;
      const now = want === null ? await balance(acct[k].address) : await settleBalance(acct[k].address, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async (id, who, path) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn: "deploy " + path.split("/").pop(), args: [], value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(new URL(path, import.meta.url));
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args: [], leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300), at: stamp() });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} deploy ${path.split("/").pop()}  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return rec.address;
};

// ---------- reads: paced, and made again on a 429 or on "Contract not found" instead of failing ----------
let lastRead = 0;
const read = async (fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address: st.contract, functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, fn, args = []) => { if (!st.views[id]) { st.views[id] = { fn, args, at: stamp(), out: await read(fn, args) }; save(); } return st.views[id].out; };
// wait, by the chain's own clock, until one of an agreement's instants has passed: the view reports the message
// clock as `now` (or -1 when a read carries none, and then this machine's clock stands in)
const untilPast = async (aid, field) => {
  for (;;) {
    const row = await read("agreement", [aid]);
    // a failed read says nothing about the clock: wait and read again, never take the instant as passed
    if (row.error || !(Number(row[field]) > 0)) { console.log(`      [${stamp()}] agreement(${aid}) could not be read (${String(row.error).slice(0, 60)}); reading again in 30 s`); await sleep(30000); continue; }
    const now = Number(row.now > 0 ? row.now : Math.floor(Date.now() / 1000));
    const left = Number(row[field] || 0) - now;
    if (left < -5) return;
    console.log(`      [${stamp()}] waiting ${left + 20} s, by the chain clock, for ${field} of ${aid} to pass`);
    await sleep((left + 20) * 1000);
  }
};

// ---------- the demonstration: one restraint, the same pages as tests/test_pure.py ----------
const RESTRAINT = "1. Selling payroll software to restaurants. 2. Working for Ledgerly or Tillpoint.";
const QUESTION = "Does the PAGE say that its author currently does the activity in the ACTIVITY block? Answer yes, no or unclear.";
const BOND = GEN / 20n, FEE = GEN / 100n;
const PAY = { A1: 3n * GEN / 10n, A2: GEN / 10n };
const COUNT = { A1: 3, A2: 1 };
const PERIOD = { A1: 900, A2: 300 };
const SHARE = PAY.A1 / 3n;
const LEAVER = () => st.accounts.leaver;
const toLeaver = (j) => (j?.outcome === "kept" ? BOND : j?.outcome === "unclear" ? FEE : 0n);

await fundOnce("firm", 10); await fundOnce("leaver", 2); await fundOnce("stranger", 2);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase().padEnd(9) + " " + st.accounts[k]).join("\n           ")}\n           profile ${PROFILE}\n           state ${STATE}`);

// ================================================================ phase A
console.log(`\n[${stamp()}] ---- phase A: deploy, two agreements opened, one accepted, one cancelled`);
st.contract = st.contract || await deploy("deploy", "firm", "../../contracts/restraint.py");
save();
console.log(`      Restraint at ${st.contract}`);
const self = await call("openSelf", "firm", "open_agreement", [st.accounts.firm, RESTRAINT, PROFILE, COUNT.A1, PERIOD.A1], { value: PAY.A1, watch: ["firm"], expect: { firm: 0n } });
ok("FIRM names itself as the leaver: refused, and the 0.3 GEN comes back in the same transaction", self.exec !== "ERROR" && self.j?.ok === false && String(self.j?.reason).includes("the leaver is somebody other than the firm") && self.j?.returned === String(PAY.A1) && moved(self, "firm", 0n), `${votes(self)}  ${self.j?.reason}`);
const ag = {};
for (const key of ["A1", "A2"]) {
  const r = await call("open" + key, "firm", "open_agreement", [LEAVER(), RESTRAINT, PROFILE, COUNT[key], PERIOD[key]], { value: PAY[key], watch: ["firm"], expect: { firm: -PAY[key] } });
  ag[key] = r.j?.agreement || "";
  ok(`FIRM opens ${ag[key]} for LEAVER and holds ${Number(PAY[key]) / 1e18} GEN in ${COUNT[key]} instalment(s) of ${PERIOD[key]} s`, r.j?.ok === true && /^A\d+$/.test(ag[key]) && r.j?.status === "offered" && r.j?.pay === String(PAY[key]) && r.j?.activities?.length === 2 && moved(r, "firm", -PAY[key]), `${votes(r)}  ${r.msg.slice(0, 120)}`);
}
const strangerAccept = await call("acceptStranger", "stranger", "accept", [ag.A1, PROFILE]);
ok(`STRANGER may not accept ${ag.A1}`, refused(strangerAccept, "only the leaver ") && refused(strangerAccept, " may accept " + ag.A1), `${votes(strangerAccept)}  ${strangerAccept.msg.slice(0, 120)}`);
const wrongPrefix = await call("acceptWrongPrefix", "leaver", "accept", [ag.A1, RAW_ROOT]);
ok(`LEAVER may not accept ${ag.A1} without repeating its profile prefix exactly`, refused(wrongPrefix, "accept repeats the profile prefix of " + ag.A1 + " exactly"), `${votes(wrongPrefix)}  ${wrongPrefix.msg.slice(0, 140)}`);
const acc = await call("acceptA1", "leaver", "accept", [ag.A1, PROFILE]);
ok(`LEAVER accepts ${ag.A1}, repeating the prefix: the restraint starts`, acc.j?.ok === true && acc.j?.status === "active" && acc.j?.ends - acc.j?.accepted_at === COUNT.A1 * PERIOD.A1, `${votes(acc)}  ${acc.msg.slice(0, 120)}`);
const cancelled = await call("cancelA2", "firm", "cancel", [ag.A2], { watch: ["firm"], expect: { firm: PAY.A2 } });
ok(`FIRM cancels ${ag.A2}, never accepted: the 0.1 GEN back`, cancelled.j?.status === "cancelled" && cancelled.j?.to_firm === String(PAY.A2) && moved(cancelled, "firm", PAY.A2), `${votes(cancelled)}  ${cancelled.msg.slice(0, 120)}`);
const early = await call("claimEarly", "leaver", "claim", [ag.A1]);
ok(`LEAVER may not claim instalment 1 of ${ag.A1} before its period ends`, refused(early, "instalment 1 of " + ag.A1 + " is claimed from"), `${votes(early)}  ${early.msg.slice(0, 140)}`);
const CREDIT = 4n * BOND;
const dep = await call("deposit", "firm", "deposit", [], { value: CREDIT, watch: ["firm"], expect: { firm: -CREDIT } });
ok("FIRM deposits 0.2 GEN of report credit", dep.j?.ok === true && dep.j?.credit === String(CREDIT) && moved(dep, "firm", -CREDIT), `${votes(dep)}  ${dep.msg.slice(0, 100)}`);

// ================================================================ phase B
console.log(`\n[${stamp()}] ---- phase B: the leaver's pages read by the validators on the live web`);
const stranger = await call("reportStranger", "stranger", "report", [ag.A1, PAGE.garden]);
ok(`STRANGER may not report a page against ${ag.A1}`, refused(stranger, "only the firm of " + ag.A1 + " may report a page"), `${votes(stranger)}  ${stranger.msg.slice(0, 120)}`);
const outside = await call("reportOutside", "firm", "report", [ag.A1, OUTSIDE], { watch: ["firm", "leaver"], expect: { firm: 0n, leaver: 0n } });
ok("FIRM reports the repository's README, outside the prefix the leaver signed: refused before any fetch, no bond", refused(outside, "the page is not below " + PROFILE) && moved(outside, "leaver", 0n), `${votes(outside)}  ${outside.msg.slice(0, 160)}`);
const r1 = await call("reportGarden", "firm", "report", [ag.A1, PAGE.garden], { watch: ["leaver"], expect: (j) => ({ leaver: toLeaver(j) }) });
ok(`every validator reads "garden.html" (allotment notes on garden leave): kept, the 0.05 GEN bond to LEAVER`, r1.applied && r1.j?.outcome === "kept" && r1.j?.mask === "NN" && r1.j?.status === "active" && /^[0-9a-f]{16}$/.test(String(r1.j?.fp)) && moved(r1, "leaver", BOND), `${votes(r1)}  ${JSON.stringify({ report: r1.j?.report, mask: r1.j?.mask, outcome: r1.j?.outcome, fp: r1.j?.fp })}`);
if (r1.j?.fp) note(`the stored fingerprint ${r1.j.fp}; this checkout's file collapsed gives ${fpOf(LOCAL.garden)}`);
const r2 = await call("reportGardenAgain", "firm", "report", [ag.A1, PAGE.garden], { watch: ["leaver"], expect: (j) => ({ leaver: toLeaver(j) }) });
ok(`"garden.html" reported again reads the same: refused as a repeat of ${r1.j?.report}, recorded, the earlier reading stands and the bond goes to LEAVER again`, r2.applied && r2.j?.ok === false && r2.j?.repeat_of === r1.j?.report && r2.j?.outcome === r1.j?.outcome && r2.j?.fp === r1.j?.fp && moved(r2, "leaver", toLeaver(r1.j)), `${votes(r2)}  ${JSON.stringify({ report: r2.j?.report, repeat_of: r2.j?.repeat_of, reason: r2.j?.reason })}`);
await untilPast(ag.A1, "next_claim_from");
const c1 = await call("claim1", "leaver", "claim", [ag.A1], { watch: ["leaver"], expect: { leaver: SHARE } });
ok(`period 1 has ended: LEAVER claims instalment 1 of ${ag.A1}, 0.1 GEN`, c1.j?.instalment === 1 && c1.j?.paid === String(SHARE) && moved(c1, "leaver", SHARE), `${votes(c1)}  ${c1.msg.slice(0, 120)}`);
const rest = PAY.A1 - SHARE;
const r3 = await call("reportPlateful", "firm", "report", [ag.A1, PAGE.plateful], { watch: ["firm", "leaver"], expect: (j) => (j?.outcome === "breach" ? { firm: rest, leaver: 0n } : {}) });
ok(`every validator reads "plateful.html" (sells payroll software to restaurants): breach on activity 1, the unclaimed 0.2 GEN back to FIRM`, r3.applied && r3.j?.outcome === "breach" && r3.j?.mask === "YN" && r3.j?.status === "breached" && r3.j?.to_firm === String(rest) && moved(r3, "firm", rest) && moved(r3, "leaver", 0n), `${votes(r3)}  ${JSON.stringify({ report: r3.j?.report, mask: r3.j?.mask, outcome: r3.j?.outcome, fp: r3.j?.fp })}`);
if (r3.j?.fp) note(`the stored fingerprint ${r3.j.fp}; this checkout's file collapsed gives ${fpOf(LOCAL.plateful)}`);
const after = await call("claimAfterBreach", "leaver", "claim", [ag.A1]);
ok(`LEAVER may not claim instalment 2 of ${ag.A1}: it is breached`, refused(after, ag.A1 + " is breached; nothing more is paid from it"), `${votes(after)}  ${after.msg.slice(0, 140)}`);

// ================================================================ phase C
console.log(`\n[${stamp()}] ---- phase C: the code read back, the views, the credit, the balances`);
{
  const file = readFileSync(new URL("../../contracts/restraint.py", import.meta.url));
  const chain = Buffer.from(String(await rpc("gen_getContractCode", [st.contract])), "base64");
  st.code = { address: st.contract, bytes: chain.length, sha256: sha(chain), file_bytes: file.length, file_sha256: sha(file), identical: Buffer.compare(chain, file) === 0 };
  save();
  ok(`the code deployed at ${st.contract} is byte for byte contracts/restraint.py`, st.code.identical, `${chain.length} bytes, sha256 ${st.code.sha256}`);
  const a1 = await seen("agreementA1", "agreement", [ag.A1]);
  ok(`agreement(${ag.A1}) reads breached by ${r3.j?.report}: one instalment paid, the rest to FIRM`, a1.status === "breached" && a1.closed_by === r3.j?.report && a1.paid === String(SHARE) && a1.to_firm === String(rest) && a1.restraint === RESTRAINT && a1.profile_prefix === PROFILE && a1.bonds_to_leaver === String(toLeaver(r1.j) * 2n), JSON.stringify({ status: a1.status, closed_by: a1.closed_by }));
  const rows = await seen("reportsA1", "reports_of", [ag.A1, 0, 20]);
  ok(`reports_of(${ag.A1}) lists the three judged reports with their pages, masks, outcomes and the repeat`, rows.total === 3 && rows.rows?.[0]?.url === PAGE.garden && rows.rows?.[1]?.repeat_of === r1.j?.report && rows.rows?.[2]?.outcome === "breach" && rows.rows?.[2]?.fp === r3.j?.fp, JSON.stringify((rows.rows || []).map((r) => [r.report, r.mask, r.outcome, r.repeat_of])));
  const mine = await seen("agreementsOfLeaver", "agreements_of", [st.accounts.leaver, 0, 20]);
  ok("agreements_of(LEAVER) finds both agreements as the leaver, with the address in any letter case", mine.total === 2 && (mine.rows || []).every((r) => r.role === "leaver"), JSON.stringify({ total: mine.total }));
  const stats = await seen("stats", "stats", []);
  ok("stats(): two agreements, one cancelled, one breached, one kept, one repeat, one refused payment returned", stats.held === "0" && stats.agreements === 2 && stats.cancelled === 1 && stats.breached === 1 && stats.reports === 3 && stats.repeats === 1 && stats.refused_payments === 1, JSON.stringify(stats));
  const rules = await seen("rules", "rules", []);
  ok("rules() publishes the question word for word, both orders, the comparison, the combine table and the limits", rules.report?.question === QUESTION && String(rules.report?.askings?.[1]).startsWith("for each activity k, 2: blocks PAGE then ACTIVITY k: ") && String(rules.compared).includes("exact equality") && rules.report?.combine?.breach === "a Y for any activity" && String(rules.limits?.[0]).includes("a breach is final"), "");
  const back = CREDIT - 2n * toLeaver(r1.j);
  const w = await call("withdrawCredit", "firm", "withdraw", [], { watch: ["firm"], expect: { firm: back } });
  ok(`FIRM takes its ${Number(back) / 1e18} GEN of credit back`, w.j?.withdrawn === String(back) && moved(w, "firm", back), `${votes(w)}  ${w.msg.slice(0, 100)}`);
  ok("the contract's own balance is zero", (await balance(st.contract)) === 0n, String(await balance(st.contract)));
  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.ended = new Date().toISOString(); save();
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  const owed = SHARE + 2n * toLeaver(r1.j);
  const want = { firm: -owed, leaver: owed, stranger: 0n };
  ok(`every account ends where the money says: LEAVER up ${Number(owed) / 1e18} GEN, FIRM down the same, STRANGER unchanged`, Object.keys(want).every((k) => net(k) === want[k]), Object.keys(want).map((k) => k.toUpperCase() + " " + Number(net(k)) / 1e18).join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`Restraint: ${st.contract}  ${EXPLORER}/address/${st.contract}`);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id]; console.log(`${id.padEnd(19)} ${s.tries.map((t) => t.tx + " " + tally(t.votes) + " " + t.exec).join(" | ")}`); }
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
