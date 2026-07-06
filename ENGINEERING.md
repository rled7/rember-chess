# Rember Chess — Engineering Write-Up

Every significant decision and problem this project hit, the alternatives
considered, and what each choice cost. Rember Chess is a self-contained browser
chess game (vanilla ES modules, vendored chess.js + single-threaded Stockfish
WASM, one Cloudflare Pages Function for the optional AI coach) — **no
framework, no build step for the game itself**. This document is the honest
log: what we chose, what we rejected, and why.

> Companion docs: `README.md` (what it is / how to run).

---

## Table of contents

1. [Single-threaded Stockfish, vendored — the central decision](#1-single-threaded-stockfish-vendored--the-central-decision)
2. [One engine instance behind a serialized queue](#2-one-engine-instance-behind-a-serialized-queue)
3. [Tap-to-move as the primary input](#3-tap-to-move-as-the-primary-input-not-drag-and-drop)
4. [Unicode piece glyphs, not image sets](#4-unicode-piece-glyphs-with-a-css-stroke-not-image-sets)
5. [Two-tier coach: free local eval + paid explanation](#5-two-tier-coach-free-local-eval--paid-on-demand-explanation)
6. [LLM call lives server-side, not in the browser](#6-llm-call-lives-in-a-cloudflare-pages-function-not-the-browser)
7. [Ground the model in the engine's numbers](#7-ground-the-model-in-the-engines-numbers)
8. [Model + cost caps for a public endpoint](#8-model--claude-sonnet-5-thinking-off-max_tokens-220-env-overridable)
9. [Puzzles validated at build *and* runtime](#9-puzzles-mate-in-one-only-validated-at-build-and-runtime)
10. [Deterministic "puzzle of the day"](#10-deterministic-puzzle-of-the-day)
11. [Vanilla ES modules, no bundler or framework](#11-vanilla-es-modules-no-bundler-or-framework)
12. [Vendored dependencies, no runtime CDN](#12-vendor-dependencies-no-runtime-cdn)
13. [The Stockfish download 404 (wrong package path)](#13-the-stockfish-download-404d-wrong-package-path)
14. [Newer builds wanted a separate NNUE weights file](#14-newer-builds-wanted-a-separate-nnue-weights-file)
15. [Several hand-authored puzzle FENs were wrong](#15-several-hand-authored-puzzle-fens-were-wrong)
16. [Headless screenshot showed "Loading engine…" — false alarm](#16-headless-screenshot-showed-loading-engine--false-alarm)
17. [No Playwright/Puppeteer available for the browser test](#17-no-playwrightpuppeteer-available-for-that-browser-test)
18. [A stray `favicon.ico` 404](#18-a-stray-faviconico-404-in-the-console)
19. [Cross-cutting lessons](#cross-cutting-lessons)

---

## 1. Single-threaded Stockfish, vendored — the central decision

**Problem.** Need a real chess engine running client-side, on a public
Cloudflare Pages site, with zero server-side compute and zero extra hosting
configuration.

**Alternatives rejected:**

| Option | Why we rejected it |
|---|---|
| **Multi-threaded / NNUE Stockfish** (v16+) | Needs `SharedArrayBuffer`, which requires cross-origin isolation — the page must send `COOP: same-origin` + `COEP: require-corp`. Once `COEP: require-corp` is set, a cross-origin CDN load of the engine breaks unless the CDN sends CORP headers, and cross-origin worker scripts hit the same wall. A header/hosting rabbit hole for a portfolio board. |
| **NNUE single-threaded build** (`stockfish-nnue-16-single`) | Removes the `SharedArrayBuffer` problem, but NNUE needs a separate multi-MB weights file to vendor and serve. More weight, more moving parts. |
| **Load Stockfish from a CDN** | Reintroduces the CORP/CORS problem above, breaks offline dev, adds a runtime dependency on a third party being up. |
| **Pure asm.js build** (`stockfish.asm.js`, ~957 KB) | Truly zero-dependency and header-free, but larger and slower than the WASM build. Kept in back pocket as the most bulletproof fallback; not needed. |

**Fix.** Vendor **Stockfish.js v10 (single-threaded WASM, classical eval)**
into `vendor/` and load it as a same-origin Web Worker (`stockfish.js` loader +
`stockfish.wasm`, ~430 KB total) — no NNUE weights file, no
`SharedArrayBuffer`, no COOP/COEP headers, no cross-origin anything. Runs
same-origin from `vendor/` and just works on Cloudflare Pages with zero server
config.

**Trade-off.** A classical, single-threaded engine is weaker and slower than
modern NNUE Stockfish. For "play a decent game and get a sane eval bar," that's
a non-issue, and it buys deployment simplicity that would otherwise cost real
hours.

## 2. One engine instance behind a serialized queue

**Problem.** The engine is used for **two** things — the opponent's move and
coach evaluation — but UCI only allows one `go` search in flight at a time. You
can't run a `go movetime` for the opponent and a `go depth` for the coach
simultaneously.

**Fix.** One engine worker, wrapped in a request queue (`engine.js`), instead
of spinning up two instances.

**Trade-off.** A coach evaluation and an opponent search can't run truly
concurrently — they run back-to-back. At the depths/times used, that's
imperceptible. In exchange: lower memory, one init, no risk of two searches
stepping on each other.

## 3. Tap-to-move as the primary input (not drag-and-drop)

**Problem.** This game ships on a public site where a large share of visitors
are on phones, and HTML5 drag-and-drop is genuinely miserable on touch.

**Fix.** Tap a piece, then tap a destination — the identical code path for
mouse and touch.

**Trade-off.** None of substance: tap-select → tap-destination is robust
everywhere and needs no pointer-event gymnastics. Drag could be added later as
a pure enhancement; it's deliberately not the foundation.

## 4. Unicode piece glyphs with a CSS stroke (not image sets)

**Problem.** Need a "refined chess set" look for both piece colors without
taking on an asset-management burden.

**Alternative rejected.** SVG or PNG piece sets — look great, but are a dozen
files, licensing, and sizing to manage for marginal visual gain here.

**Fix.** Render pieces as Unicode chess glyphs (`♞ ♛ …`), colored by CSS, using
`-webkit-text-stroke` plus a subtle shadow for a crisp result — zero extra
assets.

**Trade-off.** `-webkit-text-stroke` is a WebKit/Blink property (Chrome,
Safari, Edge, and modern mobile browsers — essentially everyone), and exact
glyph shapes vary slightly by system font. Acceptable for this audience.

## 5. Two-tier coach: free local eval + paid on-demand explanation

**Problem.** Want an AI-narrated coach without a network round-trip (and its
latency and cost) on every single move, on a page that could get real traffic.

**Alternative rejected.** Call the LLM to narrate every move — seconds of
latency and a real per-move cost, when most of the value is already delivered
for free by the engine's own eval number.

**Fix.** The eval bar and per-move verdict (Blunder / Mistake / Inaccuracy /
Good / Best) come from the **local Stockfish eval** — free, instant, offline.
The natural-language explanation is a separate, on-demand LLM call behind an
"Explain this move" button, only invoked when the user explicitly asks about
the one move they care about.

**Trade-off.** None meaningful — this is strictly better than narrating every
move: same value where it matters, a fraction of the cost. The "don't call the
model when you don't have to" pattern, made visible in the UI.

## 6. LLM call lives in a Cloudflare Pages Function (not the browser)

**Problem.** Calling the Claude API straight from the browser would expose the
API key — not viable.

**Fix.** The browser POSTs to `/api/explain`; a Cloudflare Pages Function calls
Claude server-side, keeping the key server-side and fitting the existing
Cloudflare hosting with zero extra infrastructure.

**Trade-off.** None — this is the only viable shape for a browser app that
needs a provider-authenticated model call. (NexusScale's dead "AI API key" mode
is the counter-example of what happens if you skip this.)

## 7. Ground the model in the engine's numbers

**Problem.** LLMs are unreliable at raw board calculation and will confidently
invent chess claims if asked "is this a good move?" cold.

**Alternative rejected.** Hand the model a bare position and let it judge the
move itself.

**Fix.** The Explain request sends the FEN, the move (SAN), whose move it was,
the eval **before and after**, the **centipawn loss**, the verdict, and the
engine's **best line** — and the system prompt tells the model to explain
*those numbers*, not to calculate its own.

**Trade-off.** None — this is a pure quality win. Making the engine the source
of truth and the model the *explainer* keeps every output grounded in a real
number instead of a plausible-sounding guess.

## 8. Model = `claude-sonnet-5`, thinking off, `max_tokens` 220, env-overridable

**Problem.** The Explain endpoint is public — a high-volume, low-complexity
task ("explain this chess move in a sentence or two") needs a cost posture that
survives real traffic.

**Fix.** Default to **Sonnet** (not Opus), disable extended thinking, cap
output at **220 tokens** — all overridable via the `EXPLAIN_MODEL` env var —
and log every call's token usage and estimated cost.

**Trade-off.** The general guidance is "default to the most capable model."
Here we consciously traded a sliver of eloquence for a much cheaper public
endpoint, because the quality bar for a 2-sentence move explanation is low and
the traffic profile is potentially high. Making it an env var means dialing it
back up to Opus is a one-setting change, not a redeploy.

## 9. Puzzles: mate-in-one only, validated at build **and** runtime

**Problem.** Hand-authored chess positions are error-prone (see #15 below), and
a broken puzzle on a portfolio site is embarrassing.

**Alternatives rejected:**
- **Trust hand-authored FENs** — tried it, got several wrong.
- **Fetch from an external puzzle API** (e.g. Lichess) — adds a network
  dependency and breaks the "self-contained, works offline" property.

**Fix.** Every puzzle entry is checked by chess.js twice: once by a build-time
script (`npm run validate:puzzles`), and again in the browser at load time
(`validatePuzzles()` drops any entry whose solution doesn't actually deliver
mate). Mate-in-one is the sweet spot: rich enough to be fun, and cleanly
machine-verifiable (apply the move, assert `isCheckmate()`).

**Trade-off.** None — runtime re-validation means even a bad future commit
degrades gracefully (the puzzle is dropped) instead of shipping visibly broken.

## 10. Deterministic "puzzle of the day"

**Problem.** Want a shared daily puzzle with no backend and no stored state.

**Fix.** Pick the puzzle by **UTC day-of-year modulo the puzzle count** —
everyone sees the same puzzle each day, computed client-side.

**Trade-off.** It cycles (only ~10 puzzles today); adding more is a one-line
append plus the validator.

## 11. Vanilla ES modules, no bundler or framework

**Problem.** Choosing a stack for a small, static-hosted game.

**Alternative rejected.** React/Vite (or any framework) for the game itself.

**Fix.** Plain ES modules, no build tooling. The only `package.json` dependency
exists solely for the serverless function (`@anthropic-ai/sdk`).

**Trade-off.** None at this size — a framework would add a build step and
dependencies for no benefit, where "drops onto Cloudflare Pages verbatim and is
trivial to read" is the actual goal.

## 12. Vendor dependencies (no runtime CDN)

**Problem.** Want zero external runtime dependencies — works offline, in local
dev, and doesn't break if a CDN has a bad day.

**Fix.** `chess.js` and Stockfish are committed into `vendor/` rather than
loaded from a CDN. (For Stockfish specifically, vendoring also sidesteps the
CORP/CORS problem from #1.)

**Trade-off.** ~470 KB of vendored assets in the repo — fine for what it buys.

## 13. The Stockfish download 404'd (wrong package path)

**Problem.** The first fetch of `stockfish@10.0.2/stockfish.js` returned
*"Couldn't find the requested file."* — the engine file isn't at the package
root in that version.

**Fix.** Queried the jsDelivr package API to list the actual file tree, found
the engine at `src/stockfish.js` + `src/stockfish.wasm`, and vendored those.
Verified the download by checking the WASM magic bytes (`00 61 73 6d`).

## 14. Newer builds wanted a separate NNUE weights file

**Problem.** While comparing engine versions, the v16 single-threaded build
turned out to be NNUE, which needs a multi-MB weights file served alongside it.

**Fix.** Stepped back to Stockfish 10's classical evaluator — self-contained,
no weights file, no `SharedArrayBuffer`. (This is decision #1; this entry is
*why* that decision mattered in practice, not just in theory.)

## 15. Several hand-authored puzzle FENs were wrong

**Problem.** The first pass of candidate puzzles included illegal moves and
"checks that aren't mate."

**Fix.** Never trusted them on faith — a validation script ran each candidate
through chess.js and kept only the ones that produced a real checkmate. Of ~18
candidates authored across two batches, **10 survived**; the rest were caught
and discarded. That same validator now runs in CI (`npm run validate:puzzles`)
and again in the browser at runtime.

## 16. Headless screenshot showed "Loading engine…" — false alarm

**Problem.** An early headless-Chrome screenshot (taken with
`--virtual-time-budget`) showed the board rendered but the status stuck on
"Loading engine…".

**Root cause.** `--virtual-time-budget` starves asynchronous Web Worker / WASM
initialization — a known headless quirk — so the engine's async boot hadn't
completed *in the screenshot harness*, not in a real browser.

**Fix / verification.** Drove a real browser over the Chrome DevTools Protocol
(waiting on real time), confirmed the status advanced to "White to move," then
programmatically played `e2e4` and watched the engine reply and the eval bar
update. The bug was in the test method, not the app.

## 17. No Playwright/Puppeteer available for that browser test

**Problem.** The environment had no browser-automation library installed.

**Fix.** Wrote a ~40-line CDP driver using **Node 22's built-in `WebSocket`** —
enabled the `Runtime`/`Log` domains, polled the DOM for the status text,
injected the clicks, and collected console errors. No dependency added.

## 18. A stray `favicon.ico` 404 in the console

**Problem.** The only console error left after the CDP run (#17) was the
browser's automatic favicon request.

**Fix.** Added an inline SVG data-URI favicon (a knight glyph) — no 404, no
extra asset.

---

## Cross-cutting lessons

- **Choose the boring engine build.** The single-threaded classical Stockfish
  (§1) is objectively weaker than NNUE — but it has zero hosting requirements,
  which mattered more for a portfolio piece that has to "just deploy."
- **Never trust hand-authored structured data — validate it mechanically.**
  §9/§15: chess FENs looked plausible and were wrong; a real chess.js check
  (build-time *and* runtime) is the only thing that actually catches it.
- **Ground an LLM in a deterministic source of truth before asking it to
  narrate anything.** §7: the engine's own eval numbers, not the model's guess,
  are what make the coach's explanation trustworthy.
- **Test the path users actually take, in a real environment.** §16: a headless
  automation flag (`--virtual-time-budget`) produced a false bug report; a real
  browser via CDP (§17) was the only reliable ground truth.
- **A serverless function, not the browser, is the only safe home for a
  provider-authenticated API call.** §6 — see NexusScale's dead "AI API key"
  mode for what happens if this is skipped.
