---
name: add-perk
description: Add one or more new license-plate-number perks to PLATE_PERKS in server/scoring.js. Use this skill whenever the user wants to create, add, or define a new plate perk / bonus / badge and gives a Hebrew name, a Hebrew description, and a condition for when it applies (e.g. "add a perk called X, described Y, when the plate contains/ends with/sums to Z"). Trigger it even if they phrase it casually ("make a perk for plates with 67 in them", "I want a badge when all digits are the same") — anything that turns a plate-number pattern into a named, scored perk belongs here.
---

# Add a plate-number perk

## What this does

Each rolled plate earns bonus points and named badges ("perks") for fun patterns in
its digits — palindromes, `777`, all-even, and so on. They live in one array,
`PLATE_PERKS`, in [server/scoring.js](../../../server/scoring.js). This skill turns a
user's request — a **Hebrew name**, a **Hebrew description**, and a plain-language
**condition for when it applies** — into a correct new entry in that array, with a
sensible point value and a `check` that won't break a real roll.

Nothing else needs touching: the client never sees the scoring tables. Names and points
ride along in every roll payload, and `getPerkDescriptions()` exposes the descriptions
automatically. Adding the array entry is the whole job.

## The shape of a perk

Every entry is an object:

```js
{
  id: "sixtyseven",            // unique, short, lowercase English — internal only
  name: "שש שבע!",             // Hebrew, shown on the badge — user's words, verbatim
  desc: "מספר לוחית מכיל 67",   // Hebrew, the tap-to-reveal explanation — verbatim
  pts: 6,                       // bonus points (see "Choosing points")
  check: (d) => d.includes("67"), // true ⇒ the plate earns this perk
}
```

### The `check(d)` contract — read this before writing one

- **`d` is a string of digits**, e.g. `"69756301"`. It is **7 or 8 characters** long
  (Israeli plates come in both lengths). Write checks that work for either.
- **It must never throw.** Every perk's `check` runs on every roll with no `try`/`catch`
  around it — an exception breaks the whole roll. The bundled script (below) samples
  both lengths specifically to catch this.
- **Don't assume a fixed length.** Indexing a hard-coded position like `d[7]` reads
  `undefined` on a 7-digit plate. Either iterate generically (see the `sequence` perk)
  or guard with `d.length === 8` when the perk is deliberately 8-digit-only (see
  `thousand`).
- **Numeric checks use `Number(d)`**, which drops leading zeros (`"0012"` → `12`). That
  matches how the registry stores plate numbers, so it's correct — just be aware when a
  perk cares about digit *count*.
- **Strings, not numbers, for substring/position patterns** — `d.includes("67")`,
  `d.startsWith("100")`, `d[0] === d[d.length - 1]`.

### Reuse the existing helpers

`scoring.js` already defines these above `PLATE_PERKS` — prefer them over re-rolling the
logic, so the new perk reads like its neighbours:

| helper | what it answers |
|---|---|
| `isPrime(n)`, `isFib(n)`, `isPerfectSquare(n)`, `isTriangular(n)`, `isPowerOfTwo(n)` | is the number prime / Fibonacci / a square / triangular / a power of two |
| `isAllIn(d, "02468")` | are **all** digits drawn from the allowed set (even / odd / prime digits / binary…) |
| `digitSum(d)` | sum of the digits |
| `maxDigitCount(d)` | how many times the most-frequent digit appears |
| `countRuns(d, minLen)` | which digits have a run of ≥ `minLen` in a row |
| `hasConsecutiveRun(d, step)` | is there a 3-long ascending (`step 1`) / descending (`-1`) run |
| `isABAB(d)` | does it alternate two digits (ABAB…) |
| `new Set(d).size` | how many **distinct** digits (1 = all same, `d.length` = all unique) |

Translating a condition is usually mechanical:

| user says | `check` |
|---|---|
| "contains 67" | `(d) => d.includes("67")` |
| "ends in 000" | `(d) => d.endsWith("000")` |
| "all digits even" | `(d) => isAllIn(d, "02468")` |
| "digit sum divisible by 7" | `(d) => digitSum(d) % 7 === 0` |
| "the number is prime" | `(d) => isPrime(Number(d))` |
| "first and last digit match" | `(d) => d[0] === d[d.length - 1]` |
| "four identical digits in a row" | `(d) => /(.)\1\1\1/.test(d)` |
| "8-digit only: outer thirds sum to 1000" | `(d) => d.length === 8 && Number(d.slice(0,3)) + Number(d.slice(5)) === 1000` |

## Steps

### 1. Pin down name, description, and condition

The user supplies all three. Take the Hebrew `name` and `desc` **verbatim** — literal
Hebrew strings, no translation, no escaping (the file is full of them). The "condition"
is the spec for `check`; the Hebrew `desc` is display text and often restates it. If the
condition is ambiguous (does "contains 7" mean the digit appears, or appears a certain
number of times?), ask before guessing. If the user hands you several perks at once, do
them all in one pass and run the script once at the end.

### 2. Write the entry

- **`check`**: follow the contract above; reuse a helper when one fits.
- **`id`**: a short lowercase English handle. Make sure it's unique — search the file
  (`grep 'id:' server/scoring.js`). It's internal; it never reaches the user.
- **`name` / `desc`**: the user's Hebrew, as given.

### 3. Choose points

Points track **rarity** — the less often a perk fires, the more it's worth. Don't guess
in the abstract; measure it:

```
node .claude/skills/add-perk/scripts/estimate-perk-rarity.js --name "<part of the Hebrew name>"
```

This samples hundreds of thousands of random plates through the real scoring code and
prints every perk sorted by how often it fires, with its current points. Run it once
*before* committing to a number to see the existing landscape (you can add the perk
first and pass `--name` to mark it with `◄ NEW`). Then **set the new perk's points to
match its frequency neighbours** in that table — a perk that fires as often as `42`
(≈6.7%, 4 pts) or `נחמד` (≈6.7%, 6 pts) belongs in that 4–6 range, not at 20. The
`suggest` column is a loose starting bucket; the neighbouring real perks are the better
guide. Nudge a point or two upward for a perk that's especially cute or culturally
loaded — that's a feature, not noise.

If the user gave an explicit point value, honour it (a quick sanity-check against the
table is still worth a sentence).

Perks rarer than the sample can resolve (a single hard-coded plate, say) won't appear —
reason about those by hand and look at comparably rare entries like `chosen` (100).

### 4. Place it in the right section

`PLATE_PERKS` is grouped by comment banners — `Composition`, `Runs & Patterns`, `Math`,
`Contains`, `Position`, `Special / themed`. Drop the entry in the section that matches
its idea (a substring match → `Contains`; a digit-sum/divisibility rule → `Math`). Order
**within** the array does not affect correctness — every perk is tested independently, so
unlike the `lookupPoints` tables there's no first-match shadowing to worry about. Group
for readability, not behaviour.

### 5. Verify

- **It loads:** `node -e "require('./server/scoring.js')"` must not throw (catches a
  stray comma or broken literal).
- **It fires when it should — and survives both plate lengths:** re-run the script with
  `--name`. Confirm your perk appears at a believable rate and that no `⚠️ A check()
  THREW` warning printed. For a targeted check on a specific plate:

  ```
  node -e "const s=require('./server/scoring.js');
    const p=s.buildRollPayload({mispar_rechev:'12674567'});
    console.log(p.platePerks.map(x=>x.name).join(', '));"
  ```

  Try one plate that should match and one that shouldn't, including a 7-digit plate if
  the perk does anything position- or length-sensitive.

### 6. Summarize

Tell the user the perk(s) you added: Hebrew name, the condition in one line, the points
you chose and the neighbour you anchored to (e.g. "6 pts — same as `נחמד`, which fires
about as often"). Mention the verification you ran.

## Conventions & gotchas

- **Server-only.** Perks, their tables, and the roll logic stay in `server/`. Never copy
  any of it into `public/` — keeping scoring server-side is the app's anti-cheat core.
- **No client wiring.** Don't edit `public/perks.js`, `app.js`, or any template. The new
  perk's name + points flow through the existing payload, and its description through
  `getPerkDescriptions()`, automatically.
- **Hebrew is literal and RTL.** Paste the user's strings directly; don't `\u`-escape.
- **`id` is unique and internal.** It's a key, not display text — never user-facing.

## Files

- `scripts/estimate-perk-rarity.js` — Monte-Carlo samples random 7- and 8-digit plates
  through the real `buildRollPayload`, then prints every perk sorted by hit-rate with its
  points and a suggested bucket. Use it to calibrate a new perk against its neighbours and
  to catch any `check` that throws on some plate length. Reads `server/scoring.js`; writes
  nothing. Flags: `--samples N`, `--seven-pct F`, `--name SUBSTR`.
