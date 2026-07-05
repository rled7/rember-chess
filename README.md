# Rember Chess

A refined, self-contained browser chess game. Play a real engine, solve a daily
puzzle, and get coached on every move. Built to drop onto a Cloudflare Pages
site with **no build step for the game itself**.

- **Play:** `https://github.com/rled7/rember-chess`
- **Stack in one line:** vanilla ES modules + vendored chess.js + vendored
  single-threaded Stockfish (WASM) + one Cloudflare Pages Function for the
  optional AI coach.

---

## Table of contents

1. [Features](#features)
2. [Quick start](#quick-start-run-it-locally)
3. [Deploy to Cloudflare Pages](#deploy-to-cloudflare-pages)
4. [Architecture](#architecture)
5. [Engineering decisions & trade-offs](#engineering-decisions--trade-offs) — the
   heart of this doc: what we chose, what we rejected, and why
6. [Problems we hit and how we solved them](#problems-we-hit-and-how-we-solved-them)
7. [What's tested vs. not](#whats-tested-vs-not)
8. [Cost posture of the AI coach](#cost-posture-of-the-ai-coach)
9. [Credits & licenses](#credits--licenses)

---

## Features

- **Play vs. Stockfish** — adjustable strength (Beginner → Max), tap-to-move
  (touch + mouse), legal-move dots, check highlighting, and a promotion picker.
- **Themed board** — walnut / ivory / slate / forest palettes, all driven by CSS
  variables, with a Rember terracotta accent as the default identity.
- **Puzzle of the day** — a rotating mate-in-one. Every puzzle is verified with
  chess.js at build time *and* re-validated at runtime, so a bad position is
  dropped rather than shown broken.
- **Coach mode**
  - *Always on (free, instant):* a local Stockfish eval bar plus a per-move
    verdict — Blunder / Mistake / Inaccuracy / Good / Best.
  - *On demand ($):* an **Explain this move** button that asks Claude for a
    plain-English reason, grounded in the engine's actual eval numbers.

---

## Quick start (run it locally)

ES modules and a Web Worker **cannot load from `file://`**, so you need a static
server:

```bash
npm run dev          # → npx serve .
# or: python3 -m http.server 8080
```

Open the printed URL. The board, engine, puzzles, and local eval all work with
**no backend**. Only the "Explain this move" button needs the Cloudflare
function (below).

---

## Deploy to Cloudflare Pages

1. Push this repo and connect it to a Cloudflare Pages project.
2. Build command: **none** for the static site. Cloudflare bundles the function
   in `functions/` and installs its one dependency (`@anthropic-ai/sdk`) from
   `package.json` automatically.
3. Environment variables (Pages project → Settings):
   - `ANTHROPIC_API_KEY` — **required** for coach explanations (mark as secret).
   - `EXPLAIN_MODEL` — *optional*, defaults to `claude-sonnet-5`.

Without `ANTHROPIC_API_KEY` the site still fully works; the Explain button just
reports that the coach backend isn't configured.

---

## Architecture

```
 index.html
   └─ js/main.js  (orchestrator: modes, turn loop, controls)
        ├─ js/engine.js   → one Web Worker running vendor/stockfish.js (+ .wasm)
        │                   wrapped in a SERIALIZED command queue
        ├─ js/board.js    → renders the board, handles tap-to-move + promotion
        ├─ js/coach.js    → eval bar + verdicts; calls /api/explain on demand
        └─ js/puzzles.js  → embedded, self-validating mate-in-one set

 functions/api/explain.js → Cloudflare Pages Function → Claude (server-side)
 vendor/                  → chess.js, stockfish.js, stockfish.wasm (no CDN)
```

**Data flow of a move (Play mode):**

1. Human taps a piece → `board.js` asks `chess.js` for legal targets → taps a
   destination → `chess.js` validates and applies the move.
2. `main.js` hands the move to `coach.js`, which evaluates the new position on
   the engine and updates the eval bar + verdict.
3. `main.js` asks the engine for the opponent's reply, applies it, and coach
   re-evaluates.
4. Control returns to the human.

Both the opponent move **and** every coach evaluation go through the *same*
engine worker, one request at a time (see the queue decision below).

---

## Engineering decisions & trade-offs

This section is the point of the document: every non-obvious choice, the
alternatives we considered, and why we landed where we did.

### 1. Single-threaded Stockfish, vendored — *the* central decision

**Choice:** vendor **Stockfish.js v10 (single-threaded WASM, classical eval)**
into `vendor/` and load it as a same-origin Web Worker.

**Alternatives rejected:**

| Option | Why we rejected it |
|---|---|
| **Multi-threaded / NNUE Stockfish** (v16+) | The multi-threaded build needs `SharedArrayBuffer`, which requires **cross-origin isolation** — the page must send `COOP: same-origin` + `COEP: require-corp` headers. The moment you set `COEP: require-corp`, a **cross-origin CDN** load of the engine breaks unless the CDN sends CORP headers, and cross-origin worker scripts hit the same wall. That's a header/hosting rabbit hole for a portfolio board. |
| **NNUE single-threaded build** (`stockfish-nnue-16-single`) | Removes the `SharedArrayBuffer` problem, but NNUE needs a **separate multi-MB weights file** to vendor and serve. More weight, more moving parts. |
| **Load Stockfish from a CDN** | Reintroduces the CORP/CORS problem above, breaks offline dev, and adds a runtime dependency on a third party being up. |
| **Pure asm.js build** (`stockfish.asm.js`, ~957 KB) | Truly zero-dependency and header-free, but larger and slower than the WASM build. We kept it in our back pocket as the most bulletproof fallback but didn't need it. |

**Why the winner wins:** the v10 single-threaded **WASM** build (`stockfish.js`
loader + `stockfish.wasm`, ~430 KB total) is a classical evaluator — **no NNUE
weights file, no `SharedArrayBuffer`, no COOP/COEP headers, no cross-origin
anything.** It runs same-origin from `vendor/` and just works on Cloudflare
Pages with zero server config.

**Trade-off we accepted:** a classical, single-threaded engine is weaker and
slower than modern NNUE Stockfish. For a "play a decent game and get a sane eval
bar" portfolio piece, that's a non-issue — and it buys us deployment simplicity
that would otherwise cost real hours.

### 2. One engine instance behind a serialized queue

**Choice:** a single engine worker, wrapped in a request queue in `engine.js`.

We use the engine for **two** things: the opponent's move *and* coach
evaluation. UCI only allows **one `go` search in flight at a time** — you can't
have a `go movetime` for the opponent and a `go depth` for the coach running at
once. Options were: (a) spin up two engine instances, or (b) serialize one.

We chose **one instance + a queue**: lower memory, one init, and no risk of two
searches stepping on each other. The trade-off is that a coach evaluation and an
opponent search can't run truly concurrently — they run back-to-back. At the
depths/times we use, that's imperceptible.

### 3. Tap-to-move as the primary input (not drag-and-drop)

**Choice:** tap a piece, then tap a destination. Identical code path for mouse
and touch.

This game goes on a **public site**, and a large share of visitors are on
phones. HTML5 drag-and-drop is genuinely miserable on touch. Tap-select →
tap-destination is robust everywhere and needs no pointer-event gymnastics.
Drag could be added later as a pure enhancement; it is deliberately not the
foundation.

### 4. Unicode piece glyphs with a CSS stroke (not image sets)

**Choice:** render pieces as Unicode chess glyphs (`♞ ♛ …`) colored by CSS,
using `-webkit-text-stroke` + a subtle shadow to get a crisp, "refined chess
set" look for both colors.

**Alternative rejected:** SVG or PNG piece sets. They look great but are an
asset-management burden (a dozen files, licensing, sizing) for marginal gain
here. The glyph approach is **zero-asset** and still reads as polished.

**Trade-off:** `-webkit-text-stroke` is a WebKit/Blink property (Chrome, Safari,
Edge, and modern mobile browsers — i.e. essentially everyone), and exact glyph
shapes vary slightly by system font. Acceptable for this audience.

### 5. Two-tier coach: free local eval + paid on-demand explanation

**Choice:** the eval bar and per-move verdict come from the **local Stockfish
eval (free, instant, offline)**. The natural-language explanation is a
**separate, on-demand LLM call** behind an "Explain this move" button.

**Alternative rejected:** call the LLM to narrate **every** move. That's a
network round-trip, seconds of latency, and a real per-move cost on a page that
could get traffic. Most of that value is already delivered for free by the
engine's own number. So the model is only invoked when the user explicitly asks,
for the one move they care about.

This is the "don't call the model when you don't have to" pattern, made visible
in the UI.

### 6. LLM call lives in a Cloudflare Pages Function (not the browser)

**Choice:** the browser POSTs to `/api/explain`; the function calls Claude
server-side.

You cannot call the Claude API from the browser without exposing the API key.
A serverless function keeps the key server-side, and Cloudflare Pages Functions
fit the existing Cloudflare hosting with zero extra infrastructure.

### 7. Ground the model in the engine's numbers

**Choice:** the Explain request sends the FEN, the move (SAN), whose move it was,
the eval **before and after**, the **centipawn loss**, the verdict, and the
engine's **best line** — and the system prompt tells the model to explain *those
numbers*.

**Alternative rejected:** hand the model a bare position and ask "is this a good
move?" LLMs are unreliable at raw board calculation and will confidently invent
chess claims. By making the engine the source of truth and the model the
*explainer*, the output stays grounded.

### 8. Model = `claude-sonnet-5`, thinking off, `max_tokens` 220, env-overridable

**Choice / cost posture:** for a public, high-volume, low-complexity endpoint
("explain this chess move in a sentence or two"), we default to Sonnet rather
than Opus, disable extended thinking, and cap output at 220 tokens — all
overridable via the `EXPLAIN_MODEL` env var, and every call logs its token usage
and estimated cost.

**Trade-off / tension:** the general guidance is "default to the most capable
model." We consciously traded a sliver of eloquence for a much cheaper public
endpoint, because the quality bar for a 2-sentence move explanation is low and
the traffic profile is high. Making it an env var means anyone can dial it back
up to Opus in one setting.

### 9. Puzzles: mate-in-one only, validated at build **and** runtime

**Choice:** the puzzle set is all mate-in-ones, and each entry is checked by
chess.js — first by a build-time script (`npm run validate:puzzles`), then again
in the browser at load time (`validatePuzzles()` drops any entry whose solution
doesn't actually deliver mate).

**Alternatives rejected:**

- **Trust hand-authored FENs.** We tried; we got several wrong (see problems
  below). Hand-authored chess positions are error-prone, and a broken puzzle on
  a portfolio site is embarrassing.
- **Fetch from an external puzzle API** (e.g. Lichess). Adds a network
  dependency and breaks the "self-contained, works offline" property.

Mate-in-one is the sweet spot: rich enough to be fun, and **cleanly
machine-verifiable** (apply the move, assert `isCheckmate()`). Runtime
re-validation means even a bad commit degrades gracefully instead of shipping a
broken puzzle.

### 10. Deterministic "puzzle of the day"

**Choice:** pick the puzzle by **UTC day-of-year modulo the puzzle count**.
Everyone sees the same puzzle each day, with **no backend and no stored state**.
Trade-off: it cycles (only ~10 puzzles today), but adding more is a one-line
append plus the validator.

### 11. Vanilla ES modules, no bundler or framework

**Choice:** plain ES modules, no React, no build tooling for the game.

The game is small, it targets a static host, and "no toolchain" means it drops
onto Cloudflare Pages verbatim and is trivial to read. A framework would add a
build step and dependencies for no benefit at this size. The only `package.json`
dependency exists solely for the serverless function.

### 12. Vendor dependencies (no runtime CDN)

**Choice:** `chess.js` and Stockfish are committed into `vendor/`.

This gives the repo **zero external runtime dependencies** — it works offline,
in local dev, and doesn't break if a CDN has a bad day. (For Stockfish
specifically, vendoring also sidesteps the CORP/CORS problem from decision #1.)
Trade-off: ~470 KB of vendored assets in the repo, which is fine.

---

## Problems we hit and how we solved them

Real issues encountered during the build, and the fix for each.

### A. The Stockfish download 404'd (wrong package path)

The first fetch of `stockfish@10.0.2/stockfish.js` returned *"Couldn't find the
requested file."* The engine file isn't at the package root in that version.
**Fix:** queried the jsDelivr package API to list the actual file tree, found the
engine at `src/stockfish.js` + `src/stockfish.wasm`, and vendored those. We also
verified the download by checking the WASM magic bytes (`00 61 73 6d`).

### B. Newer builds wanted a separate NNUE weights file

While comparing versions, the v16 single-threaded build turned out to be NNUE,
which needs a multi-MB weights file to serve alongside it. **Fix:** stepped back
to Stockfish 10's classical evaluator — self-contained, no weights, no
`SharedArrayBuffer`. (This is decision #1 above; the problem is *why* the
decision matters.)

### C. Several hand-authored puzzle FENs were wrong

Our first pass of candidate puzzles included illegal moves and "checks that
aren't mate." **Fix:** we never trusted them — a validation script ran each
candidate through chess.js and kept only the ones that produced a real
checkmate. Of ~18 candidates authored across two batches, **10 survived**; the
rest were caught and discarded. That same validator now runs in CI
(`npm run validate:puzzles`) and again in the browser at runtime.

### D. Headless screenshot showed "Loading engine…" — false alarm

An early headless-Chrome screenshot (taken with `--virtual-time-budget`) showed
the board rendered but the status stuck on "Loading engine…". **Diagnosis:**
`--virtual-time-budget` starves asynchronous Web Worker / WASM initialization —
a known headless quirk — so the engine's async boot hadn't completed *in the
screenshot harness*, not in a real browser. **Fix / verification:** we drove a
real browser over the Chrome DevTools Protocol (waiting on **real** time),
confirmed the status advanced to "White to move", then programmatically played
`e2e4` and watched the engine reply and the eval bar update. The bug was in the
test method, not the app.

### E. No Playwright/Puppeteer available for that browser test

The environment had no browser-automation library installed. **Fix:** wrote a
~40-line CDP driver using **Node 22's built-in `WebSocket`** — enabled the
`Runtime`/`Log` domains, polled the DOM for the status text, injected the clicks,
and collected console errors. No dependency added.

### F. A stray `favicon.ico` 404 in the console

The only console error left after the CDP run was the browser's automatic
favicon request. **Fix:** added an inline SVG data-URI favicon (a knight glyph)
so there's no 404 and no extra asset.

---

## What's tested vs. not

Being honest about coverage:

- **Verified in a real browser (CDP):** engine boots, human move applies, engine
  replies, coach eval bar and verdict update. Board renders correctly across the
  themed palette.
- **Verified by script:** all embedded puzzles are genuine mate-in-ones
  (`npm run validate:puzzles`, 10/10). All JS files pass `node --check`.
- **Not yet exercised end-to-end:** the live **Explain** call (needs a deployed
  function + `ANTHROPIC_API_KEY`) and the puzzle-mode click-to-solve flow (the
  underlying logic is validated; the click path hasn't been browser-driven).
  Both are low-risk and next on the list after deploy.

---

## Cost posture of the AI coach

The Explain endpoint is public, so it's tuned for cost:

- Defaults to **`claude-sonnet-5`** (not Opus) — override via `EXPLAIN_MODEL`.
- **Thinking disabled** and **`max_tokens` capped at 220** — a move explanation
  is short.
- Per-request token usage + estimated cost is logged (`wrangler pages deployment
  tail`) so you can watch spend.
- Input is validated and length-capped before it reaches the model.

If you expect real traffic, put the endpoint behind rate limiting / Cloudflare
Turnstile.

---

## Puzzle validation

```bash
npm run validate:puzzles
```

Exits non-zero if any embedded puzzle is not a genuine mate-in-one.

---

## Credits & licenses

- Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) — **GPL**. The
  vendored engine keeps its license header; see `vendor/stockfish.js`.
- Rules: [chess.js](https://github.com/jhlywa/chess.js) — BSD-2-Clause.
