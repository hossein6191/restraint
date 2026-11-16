# Restraint

Paid garden leave with a restraint that is judged, not argued. A firm pays
someone who is leaving to stay out of a narrow line of work for a few months.
The whole pay is held in the contract and released in instalments. If the firm
thinks the person has started the restricted work, it points at one page below
the person's own profile address, and validators read that page on the live
web. Only a page that says, in both reading orders, that its author now does a
restricted activity stops the pay.

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
| the firm reports a page that shows a restricted activity | breach: the unclaimed pay goes back to the firm, closed `breached`; the bond stays in the firm's credit |
| the firm reports a page that shows none | kept: the 0.05 GEN report bond goes to the leaver |
| the reading does not settle | unclear: 0.01 GEN of the bond goes to the leaver; the restraint runs on |
| the same page text is reported again | refused as a repeat, recorded; the earlier reading stands and the bond moves as it did then |
| the leaver wants the competing job | `release`: the unclaimed pay goes back to the firm, closed `released` |
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

> Does the PAGE say that its author currently does the activity in the ACTIVITY block? Answer yes, no or unclear.

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
instruction. The model never sees an amount, an address or a clock.

`rules()` publishes the question word for word, both orders, the letter table,
the combine table and the comparison.

## Who may do what

| call | who |
|---|---|
| `open_agreement` (payable) | anyone; the sender is the firm, the leaver another address |
| `accept(id, prefix)` | the leaver, while offered, repeating the prefix exactly |
| `cancel(id)` | the firm, while offered |
| `claim(id)` | the leaver, once the period of the next instalment has ended |
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

The contract holds exactly the unclaimed pay of open agreements and the report
credit, and the test suite checks that after every call. Every settlement is
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
- **Every page is read as it stands at the report.** A page that still
  describes the leaver's old job in the present tense reads as current, so the
  leaver should clear such pages before accepting.
- **An instalment whose period has ended but which was not claimed is still
  unclaimed pay.** A breach sends it back to the firm, so the leaver should claim
  each instalment as its period ends.
- The page must read the same for every validator at the moment of the report.
  A page that changes between fetches, or that cannot be fetched, stores nothing
  and takes no bond.
- Text only: tags are removed, and images, scripts and attachments are not
  read. A page whose text runs past 6,000 characters is never judged, so the
  firm reports a shorter one.
- The network judges what the page says its author does now, never whether it
  is true.

## What is in this repository

| path | what |
|---|---|
| `contracts/restraint.py` | the contract |
| `profile/` | the demo leaver's pages: `garden.html` (allotment notes), `plateful.html` (sells payroll software to restaurants), `greenhouse.html` (an unrelated new job), `favours.html` (ambiguous) |
| `tests/test_pure.py` | the offline suite: 271 tests, every node in its own scripted world, and static checks over the parsed source |
| `tools/mutate.py`, `tests/MUTATIONS.md` | 255 defences removed one at a time, and the test that caught each |
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
leaver, the same page again refused as a repeat, instalment 1 claimed, the
restaurant-payroll page read as a breach with the remainder to the firm, a
claim after the breach refused, and the deployed code compared with
`contracts/restraint.py` byte for byte.

## Network

GenLayer Studio, chain 61999. The contract pins its runner in its first line.

## Evidence

The on-chain run is recorded here once it has run.

## Licence

MIT. See `LICENSE`.
