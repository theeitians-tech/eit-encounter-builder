# Eit Encounter Builder

Build and stress-test combat encounters before you run them: pull creatures
and players from your existing vault notes, tune difficulty with sliders,
and get a live report on who wins and how many rounds it takes.

## How it finds combatants

Same tagging convention as the Initiative Tracker:
- **Creatures**: any note tagged `#bestiary`
- **Players**: any note tagged `#PC`

## The math

**Hit chance** uses the standard 5e approximation: `(21 - (targetAC - toHit)) / 20`,
clamped between 5% (a nat 1 always misses) and 95% (a nat 20 always hits).

**Party DPR** — per member, you enter Ability Mod, Proficiency, Magic Bonus,
average damage per hit, and attacks per round. To-hit = ability + proficiency
+ magic. Damage per hit = dice average + ability + magic. Multiply by attacks
per round and hit chance, then sum across the party.

**Creature DPR** — parsed automatically from each creature's `***Actions***`
section. Each attack's to-hit and damage-dice are read directly (Eit
statblocks list damage as dice notation only, no pre-computed average, so
the average is calculated fresh: `count × (die + 1) / 2 + modifier`).

**Multiattack** — if a creature has a `**Multiattack.**` trait, its text is
parsed for phrasing like *"makes two claw attacks and one bite attack"* to
set per-attack counts. If that can't be confidently parsed (generic phrasing
like *"makes three attacks"* with multiple attack types available), every
listed attack falls back to count 1 — flagged in-app so you know to
double check that creature's numbers.

**Effective HP** — base HP × (1 + HP% slider), plus 100 per Resistance and
200 per Immunity toggled on.

**Rounds to win** — creature-side effective HP ÷ party DPR (rounded up) vs.
party total HP ÷ creature-side DPR (rounded up). Whichever side hits zero
first wins; equal rounds is reported as a tie.

## Using it

1. Command Palette → **"Open Encounter Builder"** (or the sword icon in the
   ribbon). Opens as a full tab — this needs more horizontal room than a
   sidebar panel comfortably gives.
2. **Party panel (left):** set Average Party AC, then search and add players
   from your `#PC` notes. HP pulls in automatically (Current HP if set,
   otherwise Max HP). Fill in the offense fields yourself — Ability Mod,
   Proficiency, Magic Bonus, Damage Dice Avg, Attacks/Round — since those
   aren't on a standard character sheet.
3. **Creature panel (right):** search and add from your `#bestiary` notes.
   AC, HP, and attacks parse automatically. Use the sliders to test "what
   if this creature had +2 AC" or "what if I buffed its damage 25%" —
   report updates live as you drag. Resistance/Immunity are +/- steppers.
4. **Report (bottom):** updates live — Party DPR, Party Total HP,
   Creature-side DPR, Creature-side Effective HP, rounds for each side to
   win, and a winner call (or "too close to call" on an exact tie).
5. **Save as Note** — type a name in the toolbar, click Save. Writes a
   snapshot of the full build and report to `Encounters/Encounter - [name] -
   [date].md`, tagged `#AOE`. Saving again with the same name/date
   overwrites that note rather than duplicating it.
6. **Reset** clears everything (asks for confirmation first). Your build
   also auto-persists as you go, so closing Obsidian mid-session and
   reopening picks up where you left off.

## Known v1 simplifications

- One "Average Party AC" value is used for all of the creatures' attacks
  against the party, rather than per-member AC — keeps the report as a
  single clean number instead of a per-member breakdown.
- Multiattack parsing handles named-attack phrasing well but falls back to
  a flat count-1-each guess on ambiguous/generic wording — always worth a
  sanity check against the actual statblock for anything with an unusual
  Multiattack description.
- This tool doesn't account for AoE spreading damage across multiple
  targets, legendary actions, lair actions, or reaction economy — it's a
  DPR-race approximation for balance-checking, not a full combat sim.

## Building & releasing (nothing runs locally)

Same pattern as your other two plugins:

```bash
git tag 1.0.0
git push origin 1.0.0
```

GitHub Actions builds it and attaches `main.js`, `manifest.json`,
`versions.json`, and `styles.css` to the release — confirm all four are
there before installing.

## Installing via BRAT

Command Palette → **"BRAT: Add a beta plugin for testing"** → paste your
repo URL → enable **"Eit Encounter Builder"** under Community Plugins.

## Repository structure

```
eit-encounter-builder/
  main.ts              # plugin entry point
  types.ts               # shared type definitions
  parser.ts               # AC/HP/ability/attack/Multiattack extraction
  vaultIndex.ts            # #bestiary / #PC vault scanning
  state.ts                  # persistence + pub/sub store
  calculations.ts            # hit chance, DPR, effective HP, rounds-to-win
  builderView.ts               # the split-screen view itself
  saveEncounter.ts               # writes the report snapshot to a note
  styles.css
  manifest.json
  versions.json
  package.json
  tsconfig.json
  esbuild.config.mjs
  .gitignore
  .github/workflows/release.yml
  README.md
```
