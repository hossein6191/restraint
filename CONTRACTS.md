# Contracts

One file. `contracts/restraint.py`, class `Restraint`, is the contract.

## Restraint

### Purpose

Paid garden leave whose restraint is judged, not argued. A firm holds the whole
garden-leave pay for a leaver, together with a restraint of one to five
numbered activities, the leaver's own profile prefix, the firm's name and the
day the leaver left it, a number of instalments and the length of a period. The leaver accepts by repeating the prefix. Each
period the leaver claims that period's instalment. While the restraint runs the
firm may report one page below the prefix; the network reads it against every
activity, and the money moves in the same call: the pay back to the
firm for the periods not yet elapsed on a breach (the elapsed ones stay the
leaver's, claimed or not), the report bond to the leaver when the restraint was
kept or the page was a repeat.

### Consensus

There is one round, `_judge(activities, url)`, run only in `report()`, which
takes no value. It is one `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`
block. In its leader closure there is one `gl.nondet.web.get(url)` and, for each
activity, two sequential `gl.nondet.exec_prompt(..., response_format="json")`
calls; there are no others in the file. Nothing is nested.

1. **The fetch.** Any failure, or a status outside 200 to 299, raises
   `[TRANSIENT]`.
2. **The page.** `_page_text(_visible(_whole_body(body)))`:
   - a body over `MAX_RAW_BYTES` (128,000) bytes, or over `MAX_RAW_PAGE`
     (32,000) characters once decoded as UTF-8, raises `[EXPECTED]`: never
     judged in part;
   - every tag becomes a space, and the text after a `script` or `style` tag is
     dropped;
   - the whitespace is collapsed; an empty text raises `[TRANSIENT]`, a text
     over `MAX_PAGE_TEXT` (6,000) characters raises `[EXPECTED]`.
3. **The askings.** `question = _question(firm, left_on)`, then for each stored
   activity `_task(activity, page, ACTIVITY_FIRST, question)` and
   `_task(activity, page, PAGE_FIRST, question)`. A model failure raises
   `[LLM_ERROR]`.

Each reply is read by `_read_word`: only a JSON object (or the text of one, at
most 2,000 characters) whose `answer` is `yes`, `no` or `unclear`, case and
surrounding spaces aside. `_pair` turns the two orders into `Y`, `N` or `U`.
The closure returns `{"mask": "<letters>", "fp": "<16 hex>"}`, a flat dict of
strings.

`validator_fn` is `_agrees(leaders_res, leader_fn)`: it refuses a leader that
raised or returned anything but a dict, reruns `leader_fn` inside try/except
(its own failure is a disagreement), and compares by `==`. The agreed value is
read back by `_clean_value`, which accepts only a mask of exactly one letter
from `Y N U` per activity and a 16-character lowercase hex fingerprint; anything
else reads as all `U` with no fingerprint.

`_outcome(mask)`: a `Y` anywhere is `breach`; `N` for every activity is
`kept`; anything else is `unclear`. A report whose agreed fingerprint was
already judged for the agreement takes the outcome `repeat` instead, with the
earlier mask; the fingerprint is known only after the round, so it cannot be
refused before it.

### The prompt

Every asking is the constant `HEADER`, `UNTRUSTED` and `EITHER_ORDER`, the two
blocks, then the constant `READING`, the question, and the constant `MEANING`
and `RETURN_WORD`. The question is `QUESTION_HEAD + _firm_label(firm) +
QUESTION_MID + _date_label(left_on) + QUESTION_TAIL`: the firm's name re-checked
against the same allowlist as at admission (`_firm_problem`; "the firm" when it
fails), the leaving day re-checked and written out as "30 October 2026". A
block is `_block(label, text)`: the label is `ACTIVITY` or `PAGE` (anything else
prints `BLOCK`), the body is `_fence(text)` capped at its label's limit (200 or
6,000 characters, never less than the door lets in), and both delimiter lines
carry the first 16 hex characters of the body's own sha256. `_fence` replaces
`<` with `(` and `>` with `)`, keeping the length.

### State

- `agreement_rows: TreeMap[str, Agreement]`, scalars only: firm, leaver,
  firm_name, left_on, restraint, `act_1` to `act_5` and `n_acts`, prefix,
  total, instalments, period, opened_at, accepted_at, status, claimed, paid,
  earned (set at a close), to_firm, reports, bonds_to_leaver, closed_at,
  closed_by.
- `report_rows: TreeMap[str, Report]`: agreement, firm, url, period, mask, fp,
  outcome, repeat_of, to_leaver, at.
- `index` / `counts`: numbered lists (`party:<address>`, `reports:<id>`) for
  paged views.
- `seen`: `<agreement>|<fp>` to the first report that judged that text.
- `balances`: report credit per lowercase address.
- Totals: `held_total`, `pay_total`, `to_leavers`, `to_firms`, `credit_total`,
  `deposited_total`, `credit_out`, `bonds_out`, `returned`, and counters.

### Key methods

| method | kind | does |
|---|---|---|
| `open_agreement(leaver, firm_name, left_on, restraint, profile_prefix, instalments, period)` | payable | holds the pay; never raises after taking value |
| `accept(agreement_id, profile_prefix)` | write | the leaver; starts the restraint |
| `cancel(agreement_id)` | write | the firm, while offered; everything back |
| `claim(agreement_id)` | write | the leaver; the next instalment once its period ended, also after a breach or release up to `earned` |
| `release(agreement_id)` | write | the leaver; the pay for periods not yet elapsed back to the firm |
| `deposit()` / `withdraw()` | payable / write | report credit, the sender's own |
| `report(agreement_id, url)` | write | the firm; one consensus round; the money moves |
| `agreement`, `agreements_of`, `reports_of`, `credit`, `stats`, `rules` | views | paged at 20 rows |

### Bounds

| bound | value |
|---|---|
| pay | 0.1 to 100 GEN |
| instalments | 1 to 12 |
| period | 300 s to 31 days |
| restraint | 8 to 1,000 characters, 1 to 5 activities of 5 to 200 |
| firm's name | 2 to 40 characters, at most 4 words |
| leaving day | `YYYY-MM-DD`, today to 366 days back |
| profile prefix | at most 120 characters, ends with `/` |
| reported page address | at most 200 characters, below the prefix |
| report bond / unclear fee | 0.05 GEN / 0.01 GEN |
| judged text | at most 6,000 characters, whole |
| model reply | at most 2,000 characters parsed |
| view page | 20 rows |

### Windows

Period k runs from `accepted_at + (k - 1) * period` to `accepted_at + k *
period`. Instalment k is claimable from the end of period k, in order. Reports
are taken from acceptance until `accepted_at + instalments * period`. Claims
have no deadline. At a breach or a release, `earned = (now - accepted_at) //
period`, capped at the instalments: instalments 1 to `earned` stay the
leaver's, and `_close` sends back `total - _paid_through(total, instalments,
earned)`.

### Limits

See `rules()["limits"]` and the README: a breach is final and only a page below
the signed prefix can cause one; the network sees only what is published there;
a page is read against the leaving day and the former firm; a breach stops only
future instalments; text only; the page must read the same for every validator.
