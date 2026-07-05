// Cloudflare Pages Function: POST /api/explain
// Coach mode's on-demand LLM explanation. Runs server-side so the API key is
// never exposed to the browser. Grounded in the engine's own eval numbers so
// Claude explains, rather than guesses, the chess.
//
// Cost posture (this is a public, high-volume, low-complexity endpoint):
//   • Model defaults to claude-sonnet-5 (override with EXPLAIN_MODEL env var).
//   • Thinking disabled + max_tokens capped at 220 — a move explanation is short.
//   • Per-request token usage + estimated cost is logged (see `wrangler tail`).

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = [
  'You are a friendly chess coach explaining ONE move to an improving player.',
  'You are given the position (FEN), the move played (SAN), whose move it was,',
  'the engine evaluation before and after, the centipawn loss, a verdict, and',
  'the engine\'s best line. Explain in 2-3 plain-English sentences WHY the move',
  'earned that verdict, using the numbers as ground truth. If a better move',
  'exists, name it from the best line. No markdown, no lists, no headers.',
].join(' ');

// Approx per-MTok pricing for cost logging (Sonnet 5 intro rates).
const PRICE = { in: 2.0, out: 10.0 };

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'coach_not_configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const p = validate(body);
  if (!p) return json({ error: 'invalid_payload' }, 400);

  const model = env.EXPLAIN_MODEL || 'claude-sonnet-5';
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const userMsg =
    `Position (FEN): ${p.fen}\n` +
    `Move played: ${p.san} by ${p.color}\n` +
    `Eval before: ${p.evalBefore}   Eval after: ${p.evalAfter}\n` +
    `Centipawn loss for the mover: ${p.centipawnLoss}\n` +
    `Verdict: ${p.verdict}\n` +
    `Engine best line from before the move: ${p.bestLine || '(none)'}`;

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 220,
      thinking: { type: 'disabled' },
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });

    const u = msg.usage || {};
    const cost =
      ((u.input_tokens || 0) / 1e6) * PRICE.in +
      ((u.output_tokens || 0) / 1e6) * PRICE.out;
    console.log(
      `[explain] model=${model} in=${u.input_tokens} out=${u.output_tokens} est_cost=$${cost.toFixed(5)}`
    );

    const text = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return json({ explanation: text || 'No explanation produced.' });
  } catch (err) {
    console.error('[explain] error:', err?.message || err);
    return json({ error: 'upstream_error' }, 502);
  }
}

function validate(b) {
  if (!b || typeof b !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  const fen = str(b.fen, 120);
  const san = str(b.san, 12);
  const color = b.color === 'White' || b.color === 'Black' ? b.color : null;
  if (!fen || !san || !color) return null;
  return {
    fen,
    san,
    color,
    evalBefore: str(b.evalBefore, 12) || '?',
    evalAfter: str(b.evalAfter, 12) || '?',
    centipawnLoss: Number.isFinite(b.centipawnLoss) ? b.centipawnLoss : 0,
    verdict: str(b.verdict, 24) || 'Move',
    bestLine: str(b.bestLine, 60) || '',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
