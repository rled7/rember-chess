# Rember Chess

A refined, self-contained browser chess game. Play a real engine, solve a daily
puzzle, and get coached on every move. Built to drop onto a Cloudflare Pages
site with no build step for the game itself.

## Features

- **Play vs. Stockfish** — adjustable strength (Beginner → Max), tap-to-move
  (works on touch and mouse), legal-move dots, check highlighting, and a
  promotion picker.
- **Themed board (your own look)** — walnut / ivory / slate / forest palettes,
  all driven by CSS variables. Default is a Rember terracotta accent.
- **Puzzle of the day** — a rotating mate-in-one. Every puzzle is verified with
  chess.js at build time *and* re-validated at runtime, so a bad position is
  dropped rather than shown broken.
- **Coach mode**
  - *Always on (free, instant):* a local Stockfish eval bar plus a per-move
    verdict — Blunder / Mistake / Inaccuracy / Good / Best.
  - *On demand ($):* an **Explain this move** button that asks Claude for a
    plain-English reason, grounded in the engine's actual eval numbers.

## Tech

- `chess.js` — move legality / check / mate (vendored, no CDN).
- `Stockfish.js` (v10, single-threaded WASM) — engine + coach eval (vendored).
  Single-threaded on purpose: no `SharedArrayBuffer`, so **no COOP/COEP headers
  needed** and it runs same-origin anywhere.
- Vanilla ES modules — no bundler, no framework for the game.
- Cloudflare Pages Function (`functions/api/explain.js`) — the only server
  piece, used solely for the LLM explanation.

## Run locally

ES modules + a Web Worker can't load from `file://`, so use a static server:

```bash
npm run dev          # → npx serve .
# or: python3 -m http.server 8080
```

Then open the printed URL. The board, engine, puzzles, and local eval all work
with **no backend**. Only the "Explain this move" button needs the function
(below).

## Deploy (Cloudflare Pages)

1. Push this repo and connect it to a Cloudflare Pages project.
2. Build command: none needed for the static site. Cloudflare bundles the
   function in `functions/` and installs its dependency (`@anthropic-ai/sdk`)
   from `package.json` automatically.
3. Add environment variables in the Pages project:
   - `ANTHROPIC_API_KEY` — **required** for coach explanations (mark as secret).
   - `EXPLAIN_MODEL` — *optional*, defaults to `claude-sonnet-5`.

Without `ANTHROPIC_API_KEY` the site still fully works; the Explain button just
reports that the coach backend isn't configured.

## Cost notes

The Explain endpoint is public and high-volume, so it's tuned for cost:

- Defaults to **`claude-sonnet-5`** (not Opus) — override via `EXPLAIN_MODEL`.
- **Thinking disabled** and **`max_tokens` capped at 220** — a move explanation
  is short.
- Per-request token usage + estimated cost is logged (`wrangler pages
  deployment tail`) so you can watch spend.

If you expect real traffic, put the endpoint behind rate limiting / Turnstile.

## Puzzle validation

```bash
npm run validate:puzzles
```

Fails if any embedded puzzle is not a genuine mate-in-one.

## Credits / licenses

- Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) — **GPL**.
  The vendored engine keeps its license header; see `vendor/stockfish.js`.
- Rules: [chess.js](https://github.com/jhlywa/chess.js) — BSD-2-Clause.
