---
name: recalibrate-scoring
description: Recalibrate the rarity-based scoring tables in server/scoring.js from a fleet-survey result JSON (the output of scripts/survey-fleet.js, usually scripts/survey-result.json). Use this skill whenever the user wants to update, rebalance, or re-score plate fields "according to how rare they are", points the skill at a survey/distribution JSON of the vehicle fleet, mentions survey-result.json or survey-fleet, or asks to refresh MANUFACTURER_POINTS / COLOR_POINTS / FUEL_POINTS to match real-world frequencies. Also use it when a new fleet survey has been generated and the scoring tables should follow the data.
---

# Recalibrate scoring from a fleet survey

## What this does

The game scores each plate's fields (manufacturer, color, fuel…) on a "rarer ⇒ more
points" basis. Those point tables live in [server/scoring.js](../../../server/scoring.js).
A companion script, `scripts/survey-fleet.js`, pages through the same data.gov.il
registry and tallies how often every value actually appears, writing
`scripts/survey-result.json`. This skill closes the loop: it reads that survey and
updates the point tables so the scores track observed rarity.

Three tables are calibrated directly from frequency:

| survey field | scoring table | what it scores |
|---|---|---|
| `tozeret_nm` | `MANUFACTURER_POINTS` | manufacturer (brand root) |
| `tzeva_rechev` | `COLOR_POINTS` | paint color |
| `sug_delek_nm` | `FUEL_POINTS` | fuel type |

`MODEL_SCORES` (field `kinuy_mishari`) is **not** a frequency table — see the
caveat below.

## How scoring matching works (read this first)

`scoring.js` scores a value with `lookupPoints`: it walks a table **in insertion
order** and returns the points of the **first key that is a case-insensitive
substring** of the value. Two consequences drive everything here:

- **Order is load-bearing.** A more specific key must come before any key it
  contains, or the general one shadows it. Examples already in the file: `"כסף"`
  (silver) before `"אפור"` (grey); the hybrid fuels `"חשמל/בנזין"` before plain
  `"בנזין"`. Never reorder without preserving these.
- **A key only earns points for the share of the fleet that lands on it first.**
  So to know how rare a key really is, you attribute every surveyed value to the
  first key it would match and sum the percentages. The bundled script does exactly
  this — don't eyeball it.

## Steps

### 1. Locate the inputs

- Scoring file: `server/scoring.js` in the repo.
- Survey JSON: ask the user, or look for `scripts/survey-result.json`. It may live
  in a different worktree or a temp path — use whatever path the user gives.

The survey JSON is **large** (hundreds of KB). Do **not** read it whole with the
Read tool. The script below digests it; if you need to peek, use Node/`jq` to pull
specific fields.

### 2. Run the analyzer

```
node .claude/skills/recalibrate-scoring/scripts/analyze-survey.js [survey.json] [scoring.js]
```

Both arguments are optional and default to `scripts/survey-result.json` and
`server/scoring.js`. The script writes nothing — it prints, per table:

- each key with its **real fleet share (pct)**, current points, and a **suggested**
  value from default rarity buckets, flagging `<== CHANGE` where they differ;
- `[DEAD KEY — matches ~0%]` for keys nothing matches (absent brands or, crucially,
  **misspelled keys**);
- **Top unmatched values** — the most common surveyed values that match *no* key and
  fall to the fallback. This is the single most useful section: it reveals brands or
  colors the table is **missing or has misspelled**.

### 3. Decide the changes (judgement required)

The `sug` column is a *starting point* from generic rarity buckets, not an order to
obey. Apply it thoughtfully:

- **Trust the suggestion for the common/mid tiers.** When a key's real share clearly
  disagrees with its points (e.g. an EV fuel type that's now 5% of the fleet still
  scoring like a rarity), move it. These are the changes that matter.
- **Preserve the curated near-absent tier.** Brands below the calibration floor
  (exotics like Ferrari/Bentley/Bugatti, all ≈0%) are a hand-ranked *prestige*
  ladder, not a measured one. The script already declines to propose changes here;
  leave their relative ordering intact.
- **Hunt for spelling bugs.** Cross-reference each `[DEAD KEY]` against the **Top
  unmatched values**. A dead key plus a popular unmatched value with a similar name
  is a spelling bug: the key never fires and that whole slice scores the fallback.
  Fix it by **renaming the key to the spelling the survey actually uses** (and set
  its points from the unmatched value's share). *Real example:* the key `"וולוו"`
  matched nothing because the registry spells Volvo `"וולבו"`; ~0.6% of the fleet
  was silently mis-scored until the key was corrected.
- **Consider genuinely missing keys.** If a Top-unmatched value is a real,
  non-trivial share and has no key at all (e.g. newly popular brands), offer to add
  it. Mention it to the user rather than silently expanding scope.
- **Keep gradations you care about.** The buckets may flatten two tiers into one
  point; a one-point hand-tweak to keep a visible distinction (e.g. black slightly
  above the other ultra-common colors) is fine — note it.

### 4. Apply the edits to `scoring.js`

- Change the point **values** in place. When renaming a dead key, put the new key in
  a position that respects substring ordering (a more specific variant must precede a
  more general one).
- **Refresh the comment above each table** to cite the new sample (size + date from
  the survey's `meta`) and call out any notable moves, so the next reader knows the
  numbers came from data. The existing comments follow this convention — match it.
- Stay within each table's documented point range (manufacturer 1–40, color 1–25,
  fuel 1–30).
- **Do not** move any scoring logic, tables, or the dataset into `public/` — scoring
  is server-only by design.

### 5. Verify

- **It still loads:** `node -e "require('./server/scoring.js')"` must not throw
  (catches a dangling comma, a duplicate key, a broken literal).
- **Re-run the analyzer** against the edited file: the `<== CHANGE` lines you acted
  on should be resolved and the **fallback share should drop** if you fixed any dead
  keys.
- **Spot-check records.** Build a couple of payloads through the real code and
  confirm the fields score as intended:

  ```
  node -e "const s=require('./server/scoring.js');
    const r={mispar_rechev:'12345678',shnat_yitzur:'2022',
      tozeret_nm:'וולבו שוודיה',tzeva_rechev:'שחור',sug_delek_nm:'חשמל'};
    const p=s.buildRollPayload(r);
    console.log(p.fields.map(f=>f.label+':'+f.value+'='+f.points).join('  '));"
  ```

### 6. Summarize

Tell the user what moved and why, grouped by table: the headline changes (biggest
point swings and the reason — a value became common or rare), any spelling/dead-key
fixes (with the recovered fleet share), and anything you deliberately left alone
(the curated exotic tier, MODEL_SCORES). Flag missing-key candidates you spotted but
didn't add.

## Caveat: MODEL_SCORES is curated, not frequency-based

`MODEL_SCORES` is an ordered list of Latin trim fragments (M3, AMG, RS, GT3…) scored
by *desirability/performance*, and ~95% of surveyed models match nothing in it by
design. Do **not** rebalance it wholesale from frequency. Only touch a fragment if
the data flatly contradicts it — e.g. a fragment meant to be rare that actually
matches a large share (often because it's a short fragment catching unintended
models). Otherwise leave it and say so. The analyzer prints model coverage as INFO
only.

## Files

- `scripts/analyze-survey.js` — attributes fleet share to each scoring key (the same
  first-substring logic as `lookupPoints`), prints current-vs-suggested points, flags
  dead keys, and lists the top unmatched values. Reads the survey and `scoring.js`;
  writes nothing.
