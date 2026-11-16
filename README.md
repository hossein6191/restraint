# Restraint

Paid garden leave with a restraint that is judged, not argued. A firm pays
someone who is leaving to stay out of a narrow line of work for a few months.
The whole pay is held in the contract and released in instalments. If the firm
thinks the person has started the restricted work, it points at one page below
the person's own profile address, and validators read that page on the live
web. Only a page that shows, in both reading orders, its author doing a
restricted activity after leaving the firm stops the pay, and then only the
pay for the months still to come.

## The problem

When someone leaves a firm, the firm often pays them to stay away from a narrow
line of work for a few months: "do not sell payroll software to restaurants, and
do not work for our two closest rivals". Both sides can cheat. The firm can
stop paying on a suspicion and leave the person to sue for the money. The
person can quietly take the competing job and keep cashing the cheques.

Restraint holds the whole garden-leave pay from the start, so the firm cannot
withhold it on a hunch, and lets the firm stop it only with evidence the person
published themselves, read by the network against the words both sides agreed.

## What it is

The firm opens an agreement and sends the whole pay with it (0.1 to 100 GEN), in
one call:

- the **leaver**, the address of the person leaving;
- the **firm's name** (at most four words of letters, digits and `& . - '`, each
  starting with a capital or a digit) and the **leaving day** (`YYYY-MM-DD`, no
  later than today and at most 366 days back). Both are printed in the question
  the validators ask, and the leaver sees both before accepting;
- the **restraint**, one to five numbered activities in plain text, for example
  `1. Selling payroll software to restaurants. 2. Working for Ledgerly or Tillpoint.`
  Each activity is 5 to 200 characters;
- the **profile prefix**, one `https` address ending in `/` below which the
  leaver's own pages live;
- the number of **instalments** (1 to 12) and the length of a **period**
  (5 minutes, for the demo, to 31 days).

The leaver accepts by repeating the profile prefix exactly, so the leaver signs
the very address that may be read against them. The restraint runs from that
moment for instalments x period. Until the leaver accepts, the firm may cancel
and take everything back.

| what happens | where the money goes, in the same transaction |
|---|---|
| period k ends | the leaver claims instalment k (an equal share; the last carries the remainder) |
| the firm reports a page that shows a restricted activity after leaving | breach: future instalments stop, closed `breached`. Every period that fully elapsed before the report stays the leaver's, claimed or not, and can still be claimed; only the pay for the periods not yet elapsed goes back to the firm. The bond stays in the firm's credit |
| the firm reports a page that shows none | kept: the 0.05 GEN report bond goes to the leaver |
| the reading does not settle | unclear: 0.01 GEN of the bond goes to the leaver; the restraint runs on |
| the same page text is reported again | outcome `repeat`, `ok: true`: the page is not judged again, the earlier reading stands, and the whole 0.05 GEN bond goes to the leaver |
| the leaver wants the competing job | `release`: the elapsed periods stay the leaver's; the pay for the rest goes back to the firm, closed `released` |
| every instalment is claimed | closed `completed` |

A report stakes 0.05 GEN of credit, which the firm adds with `deposit()` and
takes back with `withdraw()`. Payable calls never run the model.

## How consensus is used

One `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` block, in `report()`,
which takes no value. Inside the leader closure the node fetches the reported
page once with `gl.nondet.web.get`, checks the status of that answer (anything
outside 200 to 299 is a failed read and stores nothing), and judges the body of
that same answer: read as UTF-8, every tag removed and the text after a script
or style tag dropped, the whitespace collapsed. A body over 32,000 characters,
or a text over 6,000, is never judged in part: nothing is stored and no bond is
taken.

Then, for each activity, it asks one question twice, once with the activity
block first and once with the page block first:

> Does the PAGE show its author doing the activity in the ACTIVITY block at any time after leaving Brightbook on 30 October 2026? Answer yes, no or unclear.

The firm's name and the leaving day are contract labels, not untrusted text:
they are held to an allowlist when the agreement is opened and checked again
where the prompt is built (a name that fails prints as "the firm"), so they can
never open or close a block or start a line. The reading instructions say that
work before leaving, including the old job at that firm, is not work after
leaving, and that a page with no sign the work came after leaving does not show
it. So an old "about me" page describing the job at the firm reads `N` or `U`,
never `Y`.

Each answer is read only as a JSON object `{"answer": "yes" | "no" | "unclear"}`.
Each activity becomes one letter: `Y` for yes in both orders, `N` for no in both
orders, `U` for anything else, including an unreadable answer. The leader
returns `{"mask": "YN", "fp": "<16 hex>"}`, where `fp` is the start of the
sha256 of the judged text.

Every validator runs the same closure itself, fetching the page and asking every
asking, and agrees only if its own value equals the leader's exactly. A
validator whose own run fails disagrees; nobody agrees with a leader that
raised. So a page that reads differently to different nodes, or a model that
leans on the order of the blocks, gets no breach: a disagreement between the
two orders is a `U`, stored, not a tolerance.

The contract, not the model, turns the mask into an outcome: a `Y` anywhere is
a breach, `N` for every activity is kept, anything else is unclear. The page
text and the activities are untrusted: each sits between delimiter lines tagged
with the start of its own sha256, every `<` and `>` in it is replaced by `(` and
`)`, and the prompt says before the blocks that nothing inside them is an
instruction. The model sees the activity, the page, the firm's name and the
leaving day; it never sees an amount, an address or a clock.

`rules()` publishes the question word for word, both orders, the letter table,
the combine table and the comparison.

## Who may do what

| call | who |
|---|---|
| `open_agreement` (payable) | anyone; the sender is the firm, the leaver another address |
| `accept(id, prefix)` | the leaver, while offered, repeating the prefix exactly |
| `cancel(id)` | the firm, while offered |
| `claim(id)` | the leaver, once the period of the next instalment has ended; after a breach or a release, up to the instalments earned before it |
| `release(id)` | the leaver, while the restraint runs |
| `report(id, url)` | the firm, while the restraint runs, a page below the prefix, with 0.05 GEN of credit |
| `deposit()` (payable), `withdraw()` | anyone, its own credit only |

Every write either compares the sender with the party it names or is listed in
the test suite as open on purpose, with the reason. Every refusal before the
round raises and writes nothing: a stranger's report, a page outside the prefix
(`https`, a lowercase host, no query, port, `..` or empty segment), a report
after the restraint ended, too little credit. A refused payable call returns
what was sent in the same transaction.

## The money

The contract holds exactly the pay not yet paid to a leaver nor sent back to a
firm (which includes instalments earned before a breach and not yet claimed)
and the report credit, and the test suite checks that after every call. Every settlement is
O(1): a claim pays one instalment, a report moves one bond and at most one
remainder, and no call walks a list. Instalments are integers: an equal share,
the last one carrying what the division left over. There are no floats
anywhere.

## The limits, stated plainly

- **A breach is final, and only a page below the profile prefix the leaver
  signed can cause one.** Whoever can publish below that prefix controls the
  verdict. A leaver should accept only a prefix nobody else can write to. On
  `raw.githubusercontent.com`, a prefix that stops at the repository
  (`.../owner/repo/`) is not one: a commit pushed to somebody's fork can be
  reached through the parent repository's address by its hash. A prefix that
  names a branch or one commit (`.../owner/repo/<commit>/profile/`) is.
- **The network reads only what the leaver publishes there.** Competing work
  that is never written below the prefix is invisible to it.
- **Every page is read against the leaving day and the former firm.** A page
  that shows the work only for that firm, or only before that day, reads no; a
  page that gives no sign of when may read unclear, never yes. The firm sets
  both labels; the leaver sees them before accepting and should refuse a wrong
  leaving day.
- **A breach stops only future instalments.** Every period that fully elapsed
  before the report stays the leaver's, claimed or not. Work begun inside an
  elapsed period is still paid for, because the contract cannot tell when it
  began.
- The page must read the same for every validator at the moment of the report.
  A page that changes between fetches, or that cannot be fetched, stores nothing
  and takes no bond.
- Text only: tags are removed, and images, scripts and attachments are not
  read. A page whose text runs past 6,000 characters is never judged, so the
  firm reports a shorter one.
- The network judges what the page says its author did after leaving, never
  whether it is true.

## What is in this repository

| path | what |
|---|---|
| `contracts/restraint.py` | the contract |
| `profile/` | the demo leaver's pages: `garden.html` (allotment notes), `plateful.html` (since leaving, sells payroll software to restaurants), `about.html` (an old about-me page describing the job at the firm, no date after leaving), `greenhouse.html` (an unrelated new job), `favours.html` (ambiguous) |
| `tests/test_pure.py` | the offline suite: 321 tests, every node in its own scripted world, and static checks over the parsed source |
| `tools/mutate.py`, `tests/MUTATIONS.md` | 296 defences removed one at a time, and the test that caught each |
| `tests/on_chain/smoke.mjs` | the run against GenLayer Studio |
| `CONTRACTS.md` | the contract in detail |
| `DECISIONS.md` | why it is built this way |

## Running it

```
pip install -r requirements-dev.txt
pytest tests/ -q                      # offline, no network, under a second
genvm-lint check contracts/restraint.py
python tools/mutate.py                # rewrites tests/MUTATIONS.md; exit 1 if any mutant survives
```

The on-chain smoke deploys its own copy with throwaway accounts. The
validators read the demo pages from `raw.githubusercontent.com`, pinned to one
commit, so push first and pass that commit:

```
npm ci
COMMIT=<40-hex commit> node tests/on_chain/smoke.mjs
```

It walks: open and accept (with a stranger's accept and a wrong prefix
refused), a cancelled offer, an early claim refused, a stranger's report and a
page outside the prefix refused, the garden page kept with the bond to the
leaver, the old about-me page read as no breach, the garden page again as a
`repeat` with the whole bond to the leaver, instalment 1 claimed, the Plateful
page read as a breach with only the pay for periods not yet elapsed back to the
firm, any earned instalment still claimed after it and the next one refused, and
the deployed code compared with `contracts/restraint.py` byte for byte. Set
`LEFT_ON=YYYY-MM-DD` if the default leaving day (2026-10-30) is more than 366
days back by the time it runs.

## Network

GenLayer Studio, chain 61999. The contract pins its runner in its first line.

## Evidence

Run on 16 Nov 2026 on GenLayer Studio (chain 61999) by `tests/on_chain/smoke.mjs`, from generated accounts funded from the
Studio faucet, none of them anybody's wallet: FIRM, LEAVER and STRANGER are fresh accounts funded for this run.. **26 passed, 0 failed**; transactions: 19 in 19 steps; sent a second time: none.
The whole log is `tests/on_chain/smoke-run.log`. A garden-leave page and an old about-me page read as kept; a repeat of the garden page is not judged again; a page showing the leaver selling payroll software to restaurants since leaving reads as a breach on activity 1, the earned instalment stays the leaver's and the rest goes back to the firm.

- `restraint.py` deployed at [`0x4F5cbb8CEF967d604105bB77f36b0e13b7e49CB8`](https://explorer-studio.genlayer.com/address/0x4F5cbb8CEF967d604105bB77f36b0e13b7e49CB8)

- the code deployed at 0x4F5cbb8CEF967d604105bB77f36b0e13b7e49CB8 is byte for byte contracts/restraint.py: 74228 bytes, sha256 c888494db811acf9a4bf235c597c81edf3b557724597f72e046d7a07709ae2fe

| step | by | transactions | votes |
|---|---|---|---|
| FIRM names itself as the leaver: refused, and the 0.3 GEN comes back in the same transaction | FIRM | [0xc2d59c64…](https://explorer-studio.genlayer.com/tx/0xc2d59c64a442c505556fa17eb747db0efa82ae0a0b92f1411cff9467563de776), [0x5fce7210…](https://explorer-studio.genlayer.com/tx/0x5fce721038501518900794702ea0a861b103556e198ecfcf76f97823cf864016) | 4 agree, 0 disagree, 1 idle |
| FIRM opens A1 for LEAVER and holds 0.3 GEN in 3 instalment(s) of 900 s | FIRM | [0xd340feb0…](https://explorer-studio.genlayer.com/tx/0xd340feb0d9c3c96d28c3adf99fce6bf98a082a2b0c013a56a5b629c267ece364) | 3 agree, 0 disagree, 2 idle |
| FIRM opens A2 for LEAVER and holds 0.1 GEN in 1 instalment(s) of 300 s | FIRM | [0xc7d5fdf6…](https://explorer-studio.genlayer.com/tx/0xc7d5fdf69ff14d5743f7e858cdf9757ac9181d52f0f4a0ad4f06fe92bbe2ce7c) | 3 agree, 0 disagree, 2 idle |
| STRANGER may not accept A1 | STRANGER | [0xf8306ec8…](https://explorer-studio.genlayer.com/tx/0xf8306ec8ef2ba544ed385a2be43a555bdafd8342f574557ccb42f327201d5825) | 4 agree, 0 disagree, 1 idle |
| LEAVER may not accept A1 without repeating its profile prefix exactly | LEAVER | [0x5e0b0d24…](https://explorer-studio.genlayer.com/tx/0x5e0b0d241697d88be694dc1f794fa2d1be92aa55e11e8c95a04817bba9981d5c) | 3 agree, 0 disagree, 2 idle |
| LEAVER accepts A1, repeating the prefix: the restraint starts | LEAVER | [0x81104d20…](https://explorer-studio.genlayer.com/tx/0x81104d2098073b30653e6b6ecf8a9b60e5b5d494ec5841974a604b2c948a5f0c) | 3 agree, 0 disagree, 2 idle |
| FIRM cancels A2, never accepted: the 0.1 GEN back | FIRM | [0xe491b3d3…](https://explorer-studio.genlayer.com/tx/0xe491b3d30fc920462cdb7a2bda6942201a094a71285552b4b08d9459c50cc573) | 4 agree, 0 disagree, 1 idle |
| LEAVER may not claim instalment 1 of A1 before its period ends | LEAVER | [0xd19b0e7e…](https://explorer-studio.genlayer.com/tx/0xd19b0e7ec88ad60f63420d297942d19b5cbc896dbc28109c2e0fa8cb62ec070a) | 3 agree, 0 disagree, 2 idle |
| FIRM deposits 0.2 GEN of report credit | FIRM | [0x3fdbbaa9…](https://explorer-studio.genlayer.com/tx/0x3fdbbaa97453ca266fb1231fcb2ac3c8ef70d7f05f7683cc03789745d473394c) | 3 agree, 0 disagree, 2 idle |
| STRANGER may not report a page against A1 | STRANGER | [0x4c058287…](https://explorer-studio.genlayer.com/tx/0x4c0582873a0a90ad26e6f06555fb246733d0e0f8d031f0f9d011c20c8ea38822) | 3 agree, 0 disagree, 2 idle |
| FIRM reports the repository's README, outside the prefix the leaver signed: refused before any fetch, no bond | FIRM | [0x4703d839…](https://explorer-studio.genlayer.com/tx/0x4703d839d46f84ff0aad991efc2bef579dfe0e8ed3dca6186b5844ab85194444) | 4 agree, 0 disagree, 1 idle |
| every validator reads "garden.html" (allotment notes on garden leave): kept, the 0.05 GEN bond to LEAVER | FIRM | [0xccbd7907…](https://explorer-studio.genlayer.com/tx/0xccbd7907d3593528800e56319910366f3ce5549ed14fd5e4657c254d8d28ba9a) | 3 agree, 0 disagree, 2 idle |
| every validator reads "about.html" (an old about-me page: the job at Brightbook, nothing after leaving it): not a breach | FIRM | [0x3f0e6b7d…](https://explorer-studio.genlayer.com/tx/0x3f0e6b7d77c20c8bc2e1b38702344bd065faad05ada59e4abd09053244b30085) | 3 agree, 2 disagree, 0 idle |
| "garden.html" reported again reads the same: ok, outcome repeat of R1, not judged again, and the whole 0.05 GEN bond goes to LEAVER | FIRM | [0x3b6b3f38…](https://explorer-studio.genlayer.com/tx/0x3b6b3f38aaeed5978c4a66e0d0fef540c281515a2c6474d9508166f1b78fb4e6) | 3 agree, 0 disagree, 2 idle |
| period 1 has ended: LEAVER claims instalment 1 of A1, 0.1 GEN | LEAVER | [0x4606f0ed…](https://explorer-studio.genlayer.com/tx/0x4606f0edcf6ed4b0d1b26e1dc9cb6959acafe57ae929880b858bb77a4091e59b) | 5 agree, 0 disagree, 0 idle |
| every validator reads "plateful.html" (since leaving Brightbook, sells payroll software to restaurants): breach on activity 1; 1 elapsed period(s) stay LEAVER's, 0.2 GEN back to FIRM | FIRM | [0x6d5d68b2…](https://explorer-studio.genlayer.com/tx/0x6d5d68b205895bfbf3b72f46c5dfeda0decad501eb45e0d92cdcd62767067507) | 3 agree, 0 disagree, 2 idle |
| LEAVER may not claim instalment 2 of A1: its period had not elapsed before the breach | LEAVER | [0x1acc8e85…](https://explorer-studio.genlayer.com/tx/0x1acc8e85eb818a30f499dfc9292c6b0eb5f84e0ba06207e6a141eef0bd68d260) | 3 agree, 0 disagree, 2 idle |
| FIRM takes its 0.05 GEN of credit back | FIRM | [0x24855293…](https://explorer-studio.genlayer.com/tx/0x2485529338e1ea68bbae154d6bdbaa011e4275118cfc62eece22112bd8867427) | 3 agree, 0 disagree, 2 idle |

## Licence

MIT. See `LICENSE`.
