// puzzles.js — "Puzzle of the day". Every FEN + solution below was verified
// with chess.js (the move produces checkmate) before being committed. We STILL
// re-validate at runtime in validatePuzzles(): a bad entry is dropped rather
// than shipped as a broken puzzle.

import { Chess } from '../vendor/chess.js';

// All mate-in-1. `solution` is the mating move in UCI (from+to[+promotion]).
export const PUZZLES = [
  { id: 'backrank-rook',  fen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1',        solution: 'a1a8', theme: 'Back-rank mate' },
  { id: 'queen-8th',      fen: '6k1/8/6K1/8/8/8/8/1Q6 w - - 0 1',         solution: 'b1b8', theme: 'Queen to the back rank' },
  { id: 'queen-diagonal', fen: '5k2/8/5K2/8/7Q/8/8/8 w - - 0 1',          solution: 'h4h8', theme: 'Queen delivers mate' },
  { id: 'smothered',      fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',       solution: 'g5f7', theme: 'Smothered mate' },
  { id: 'q-and-k',        fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',          solution: 'f7g7', theme: 'Queen mate beside the king' },
  { id: 'ladder-7-8',     fen: '6k1/R7/1R6/8/8/8/8/7K w - - 0 1',         solution: 'b6b8', theme: 'Two-rook ladder' },
  { id: 'scholars',       fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w kq - 0 1', solution: 'h5f7', theme: "Scholar's mate" },
  { id: 'queen-corridor', fen: '7k/8/5Q1K/8/8/8/8/8 w - - 0 1',           solution: 'f6f8', theme: 'Queen box mate' },
  { id: 'rook-support-k', fen: '7k/8/7K/8/8/8/8/1R6 w - - 0 1',           solution: 'b1b8', theme: 'Rook mate, king guards' },
  { id: 'q-cut-corner',   fen: '6k1/5ppp/8/8/8/7Q/8/6K1 w - - 0 1',       solution: 'h3c8', theme: 'Queen to the 8th' },
];

// Drop any puzzle whose solution doesn't actually mate (defensive).
export function validatePuzzles(list = PUZZLES) {
  return list.filter((p) => {
    try {
      const c = new Chess(p.fen);
      c.move({ from: p.solution.slice(0, 2), to: p.solution.slice(2, 4), promotion: p.solution[4] });
      return c.isCheckmate();
    } catch {
      return false;
    }
  });
}

// Deterministic day-of-year index so everyone sees the same puzzle each day.
export function puzzleOfTheDay(date = new Date()) {
  const valid = validatePuzzles();
  if (valid.length === 0) return null;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  return valid[dayOfYear % valid.length];
}
