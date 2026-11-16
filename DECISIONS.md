# Decisions

Why Restraint is built the way it is, and what was checked before it was
called finished.

## 1. The boundary: what the network agrees on

The network is asked one thing per activity: does this page show its author
doing it at any time after leaving the firm on the leaving day. It returns a closed token, and the stored value is the mask of those
tokens plus a fingerprint of the judged text, compared by exact equality. The
outcome (breach, kept, unclear) is computed by the contract from the mask, not
by the model, so nothing a leader writes in prose ever reaches storage, and two
validators cannot agree on a value while believing different things about what
happens next: the mask fixes the outcome.

The model sees one activity, the page, the former firm's name and the leaving
day. It never sees an amount, an address or a clock, so it cannot be nudged by
who stands to gain.

## 2. One question, both orders, one block

Each activity is asked alone. Asking about the whole restraint at once would be
a compound question ("does the page show any of these?"), and a single yes
could not say which activity it was about. One activity per asking keeps each
question to one condition, and the mask says which activity broke.

Each asking is made twice in the same block, the activity first and the page
first. A model that leans on the order of the blocks answers yes one way and no
the other, and that lands as `U`, a stored value, never as a breach. Breach
needs yes in both orders; kept needs no in both orders for every activity.

## 3. The leaving day and the firm's name, as labels

The first version asked whether the page showed its author "currently" doing
the activity. A leaver's old "about me" page, still saying "I sell payroll
software to restaurants at Brightbook", would have read as a breach of a
restraint on that very work. The question now carries two facts the agreement
records: the firm the leaver left and the day they left it. One condition:
does the page show the author doing the activity at any time after leaving
that firm on that day. The reading instructions add that work before leaving,
including work for that firm, is not work after leaving, and that a page with
no sign the work came after leaving does not show it. The demo page
`about.html` is that stale page; it reads `N` offline and should read `N` or
`U` live, never `Y`.

Both are set by the firm, which has money at stake, and printed outside every
block, so they are labels the contract constrains rather than text it fences:

- the name is 2 to 40 characters of letters, digits, spaces and `& . - '`, at
  most four words, each starting with a capital or a digit: it cannot carry a
  bracket, a newline, a question mark or a sentence in lower case;
- the day is exactly `YYYY-MM-DD`, a real day, no later than the day the
  agreement is opened and at most 366 days before it, printed as "30 October
  2026";
- both are checked when the agreement is opened and again where the prompt is
  built; a value that fails there prints a fixed phrase. A static test checks
  that the question is built only from the constant pieces and these two
  checked labels;
- both are returned by `open_agreement`, `accept` and `agreement()`, so the
  leaver sees the exact question before accepting.

The leaving day is explicit rather than the `accept` time because the leaver
may sign days after leaving, and a page about work started in between should
still count.

## 4. A breach is final; no appeal

The brief offered two designs: a bonded appeal in which the leaver points at a
second page (a correction), or a final breach that only a page below the
leaver's own prefix can cause. This contract takes the second.

- **An appeal is a second roll of the same question.** The leaver would ask the
  network again until an answer suited, which is exactly what the repeat rule
  exists to stop. A correction page written after the report says nothing about
  whether the first page was true when it was read.
- **The evidence is the leaver's own words.** The prefix is signed by the leaver
  at `accept`, by repeating it exactly. A breach needs a page published below
  it showing, in both orders, its author doing a restricted activity after
  leaving. The
  leaver is the author. Nobody else can manufacture that page unless the leaver
  accepted a prefix somebody else can write to, and that limit is published in
  `rules()` and the README.
- **The bar is high and lopsided on purpose.** One order alone, an ambiguous
  page, an unreadable answer or a model that leans on block order all give `U`,
  never `Y`. The leaver keeps the pay unless the network agrees, twice per
  validator, that the page says so. Even then the breach takes back only the
  months still to come.
- **The leaver has a route out that is not an appeal.** A leaver who wants the
  competing job calls `release()`, keeps every elapsed period, and the rest goes
  back to the firm.

A finality that protects the firm also protects the leaver: a `kept` reading
can never be overwritten, and the same text can never be judged again.

## 5. The prompt

Every instruction line is a contract constant or the question built from two
checked labels (section 3); only the two blocks carry free text others wrote. Each block is fenced (`<` and `>` replaced, never deleted, so a
cap applied after the fence cannot be undone) and closed by delimiter lines
tagged with the start of the body's own sha256. Labels are contract constants;
an unknown label prints as `BLOCK`. Activities are admitted only as printable
ASCII on one line, so none can start a line of the prompt. A static test checks
that every value joined into a prompt is a fenced block or a constant.

## 6. The page, whole or not at all

Every validator fetches the page itself, once, and judges the body of that one
answer. A status outside 2xx is a failed read and stores nothing.

The first draft cut the judged text at 6,000 characters, as an earlier contract
did. The self-audit flagged that as a finite probe: a leaver could put the new
job below the cut, the network would read only the start, and the contract
would store `kept` and pay the leaver the bond on a page nobody read in full. So
a body over 32,000 characters, or a collapsed text over 6,000, is refused inside
the block: the leader raises, nobody agrees, nothing is stored, and no bond is
taken. The firm reports a shorter page. Every node measures the same bytes, so
the refusal is the same everywhere.

## 7. The money: earned pay is paid

The whole pay is held from the start: the firm cannot withhold it on a
suspicion. Instalment k is paid once period k has ended, in order, one per
call.

A breach stops only future instalments. At the report's transaction, `earned =
(now - accepted_at) // period`: every period that has fully elapsed. Those
instalments stay the leaver's whether or not they were claimed, and `claim()`
still pays them after the breach; only `total - paid_through(earned)` goes back
to the firm. The first version sent every unclaimed instalment back, which let
a firm wait for a period to end and report before the leaver had claimed it.
The contract cannot tell when the competing work began, so a period that has
elapsed is treated as earned, and that is stated as a limit. `release()` uses the
same rule. A period ending on the very second of the report counts as elapsed,
matching the second from which `claim()` pays it.

A report stakes 0.05 GEN of credit, deposited in advance, so `report()` takes no
value and payable calls never run the model. Kept pays the bond to the leaver,
so harassment pays the person harassed. Unclear pays 0.01 GEN, so an ambiguous
page is never a free roll. A breach leaves the bond in the firm's credit.

## 8. The same text once

A report whose agreed fingerprint was already judged for the agreement is a
repeat. The fingerprint is the sha256 of what the validators read, so it exists
only after the round: the repeat cannot be refused before anything moves.
The first version returned `ok: false` while still moving the bond, which said
one thing and did another. Now a repeat is a result like any other: `ok: true`,
outcome `repeat`, the earlier mask carried, a `repeat` sentence saying the page
was not judged again and the whole 0.05 GEN bond went to the leaver, and the
same in `rules()`. The whole bond, not the earlier reading's share, because
asking again about a page already judged is the free roll this rule exists to
price. Dedupe is by content, not by address:
the same text under another spelling is the same report, and the same address
with new text is a new one, since a leaver's page changes over time.

## 9. Every call is bounded

No write loops. The two loops in the restraint parser run over at most six
markers; the firm-name check walks five signs and at most four words; the leader's loop runs over at most five activities; views read at
most 20 rows. A static test lists every loop with its named bound and fails on
a new one.

## 10. The doors

Payable calls (`open_agreement`, `deposit`) never raise after taking value:
every refusal returns what was sent with `ok: false`. Every other refusal comes
before any state is written, and in `report` before anything is fetched. A
static test checks that every write compares the sender with the right party,
or is listed as open on purpose with its reason.

## 11. The self-audit

Run against the house rules and every past reviewer note before calling this
finished.

| check | result |
|---|---|
| nondet calls only inside the leader closure, one block, nothing nested | static test |
| validators re-derive the whole stored value and compare exactly; a failed rerun disagrees | static test and scripted worlds |
| no tolerance anywhere; disagreement is a stored `U` | combine table tested in full |
| both orders in one block | every node asks 2 x activities askings, tested |
| every write bound to a sender or listed open with a reason | static test |
| every untrusted string fenced; delimiter lines carry only constants and hashes | static test, forgery tests |
| a cap on judged material is a finite probe | found; pages are now judged whole or not at all (section 5) |
| a judged refusal that must be remembered does not raise | the repeat is recorded, `ok: true`, outcome `repeat` |
| a result never says one thing while the money does another | found on review: the repeat said `ok: false` while the bond moved; fixed (section 8) |
| earned pay is paid | found on review: a breach took back elapsed, unclaimed periods; fixed (section 7) |
| every field printed outside a block is constrained | the firm's name and the leaving day, allowlisted at admission and where the prompt is built |
| dedupe the content, not the id | fingerprint per agreement |
| a verdict cannot be re-run | a breach closes; a kept or unclear reading is never overwritten |
| unagreed prose never reaches storage | the contract writes every sentence |
| every settlement loop bounded by a constant | no write loops, static test |
| the verdict has a consequence | money moves in the same call |
| who owns the URL owns the verdict | the leaver signs the prefix at `accept`; stated as a limit |
| a stale present-tense page reads as current | found; fixed with the leaving day and the firm's name in the question (section 3) |
| no floats, no `datetime` | static test |
| docs checked against the code | numbers in the README match the suite and the mutation table |
| a refused party has somewhere to go | firm: another page; leaver: `release`, and earned instalments after a breach; unaccepted offer: `cancel`; credit: `withdraw` |

## 12. Verified, and not verified

Verified offline: 321 tests, 296 of 296 mutants killed, `genvm-lint check`
clean. The smoke script passes `node --check`.

Not yet verified: the on-chain run, and how live validators read the five demo
pages. The garden and greenhouse pages are written to read `N` for both
activities, Plateful `Y` for activity 1 only, the old about-me page `N` (the
smoke also accepts `U`); the favours page is meant to be ambiguous and is used
offline only.
