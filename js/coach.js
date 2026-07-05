// coach.js — coach mode.
//   • ALWAYS ON (free, instant): local Stockfish eval → eval bar + a templated
//     verdict for the move just played (Blunder / Mistake / Inaccuracy / Solid /
//     Best). No network, no cost.
//   • ON DEMAND ($): the "Explain this move" button POSTs the *engine's own
//     numbers* (eval before/after, centipawn loss, best line) to /api/explain,
//     which asks Claude for a one-paragraph explanation. Grounding the model in
//     real eval deltas keeps it from inventing chess claims.

const EXPLAIN_ENDPOINT = '/api/explain';

// Map a raw score to a "big number" so mate and centipawns compare on one axis.
function toScalar({ scoreCp, mate }) {
  if (mate != null) return mate > 0 ? 100000 - mate * 100 : -100000 - mate * 100;
  return scoreCp ?? 0;
}

// White-advantage → eval-bar fill % (smooth, clamped to keep both sides visible).
function fillPercent(scalar) {
  const cp = Math.max(-2000, Math.min(2000, scalar));
  const pct = 50 + 50 * (2 / (1 + Math.exp(-0.0038 * cp)) - 1);
  return Math.max(3, Math.min(97, pct));
}

function scoreLabel({ scoreCp, mate }) {
  if (mate != null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  const pawns = (scoreCp ?? 0) / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(1);
}

const VERDICTS = [
  { min: 300, key: 'blunder',    label: 'Blunder',     note: 'That gives away a lot.' },
  { min: 150, key: 'mistake',    label: 'Mistake',     note: 'A stronger move was available.' },
  { min: 70,  key: 'inaccuracy', label: 'Inaccuracy',  note: 'Slightly loose — there was better.' },
  { min: 20,  key: 'good',       label: 'Good move',   note: 'Solid choice.' },
  { min: -Infinity, key: 'best', label: 'Best move',   note: 'Right on the engine line.' },
];

export class Coach {
  constructor(engine, { barFill, barScore, verdictEl, explainBtn, explainOut }) {
    this.engine = engine;
    this.els = { barFill, barScore, verdictEl, explainBtn, explainOut };
    this.prev = null;        // analysis of the position *before* the latest move
    this.lastReview = null;  // payload for the Explain button
    this.enabled = true;

    if (this.els.explainBtn) {
      this.els.explainBtn.addEventListener('click', () => this._explain());
    }
  }

  setEnabled(v) {
    this.enabled = v;
    this.els.verdictEl?.classList.toggle('hidden', !v);
  }

  // Call once for the starting position to seed the eval bar + baseline.
  async seed(fen) {
    const a = await this.engine.evaluate(fen);
    this.prev = a;
    this._paintBar(a);
  }

  // Review the move that produced `game`'s current position.
  // move: chess.js move object (has .san, .color, .before, .after).
  async review(game, move) {
    const after = await this.engine.evaluate(game.fen());
    this._paintBar(after);

    if (!this.enabled || !this.prev || !move) { this.prev = after; return; }

    // Centipawn loss from the MOVER's perspective (both evals are White-POV).
    const before = toScalar(this.prev);
    const now = toScalar(after);
    const loss = move.color === 'w' ? before - now : now - before;

    const verdict = VERDICTS.find((v) => loss >= v.min);
    this._paintVerdict(verdict, move);

    this.lastReview = {
      fen: move.before,
      san: move.san,
      color: move.color === 'w' ? 'White' : 'Black',
      evalBefore: scoreLabel(this.prev),
      evalAfter: scoreLabel(after),
      centipawnLoss: Math.max(0, Math.round(loss)),
      verdict: verdict.label,
      bestLine: (this.prev.pv || []).slice(0, 4).join(' '),
    };
    if (this.els.explainBtn) this.els.explainBtn.disabled = false;
    if (this.els.explainOut) this.els.explainOut.textContent = '';

    this.prev = after;
  }

  _paintBar(analysis) {
    if (this.els.barFill) this.els.barFill.style.height = `${fillPercent(toScalar(analysis))}%`;
    if (this.els.barScore) this.els.barScore.textContent = scoreLabel(analysis);
  }

  _paintVerdict(verdict, move) {
    const el = this.els.verdictEl;
    if (!el) return;
    el.className = `verdict ${verdict.key}`;
    el.innerHTML = `<strong>${move.san}</strong> — ${verdict.label}. <span class="verdict-note">${verdict.note}</span>`;
  }

  async _explain() {
    if (!this.lastReview) return;
    const { explainBtn, explainOut } = this.els;
    if (explainOut) explainOut.textContent = 'Thinking…';
    if (explainBtn) explainBtn.disabled = true;
    try {
      const res = await fetch(EXPLAIN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.lastReview),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (explainOut) explainOut.textContent = data.explanation || 'No explanation returned.';
    } catch (err) {
      // Coach mode's local eval already worked — only the LLM add-on failed.
      if (explainOut) {
        explainOut.textContent =
          'Explain is unavailable (the coach backend isn’t configured). The eval bar and verdict above still work offline.';
      }
      console.warn('explain failed:', err);
    } finally {
      if (explainBtn) explainBtn.disabled = false;
    }
  }
}
