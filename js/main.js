// main.js — wires the engine, board, and coach together and runs the two modes:
// "Play vs Engine" and "Daily Puzzle".

import { Chess } from '../vendor/chess.js';
import { Engine } from './engine.js';
import { Board } from './board.js';
import { Coach } from './coach.js';
import { puzzleOfTheDay } from './puzzles.js';

const $ = (id) => document.getElementById(id);
const uciToMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

const engine = new Engine();
const game = new Chess();

let mode = 'play';        // 'play' | 'puzzle'
let humanColor = 'w';
let currentPuzzle = null;
let busy = false;         // engine is thinking

const coach = new Coach(engine, {
  barFill: $('eval-fill'),
  barScore: $('eval-score'),
  verdictEl: $('verdict'),
  explainBtn: $('explain-btn'),
  explainOut: $('explain-out'),
});

const board = new Board($('board'), game, {
  onHumanMove: (move) => onHumanMove(move),
  orientation: 'w',
});

function setStatus(msg) { $('status').textContent = msg; }

function gameOverMessage() {
  if (game.isCheckmate()) return `Checkmate — ${game.turn() === 'w' ? 'Black' : 'White'} wins.`;
  if (game.isStalemate()) return 'Draw — stalemate.';
  if (game.isInsufficientMaterial()) return 'Draw — insufficient material.';
  if (game.isThreefoldRepetition()) return 'Draw — threefold repetition.';
  if (game.isDraw()) return 'Draw.';
  return null;
}

function turnStatus() {
  const over = gameOverMessage();
  if (over) return over;
  const side = game.turn() === 'w' ? 'White' : 'Black';
  return game.inCheck() ? `${side} to move — check!` : `${side} to move.`;
}

// ---- Play vs Engine ------------------------------------------------------

async function onHumanMove(move) {
  if (mode === 'puzzle') return onPuzzleMove(move);

  await coach.review(game, move);
  setStatus(turnStatus());
  if (gameOverMessage()) { board.setInteractive(false); return; }

  await engineMove();
}

async function engineMove() {
  busy = true;
  board.setInteractive(false);
  setStatus('Engine thinking…');

  const level = parseInt($('difficulty').value, 10);
  const { bestmove } = await engine.bestMove(game.fen(), { level, movetime: 700 });
  if (!bestmove) { busy = false; setStatus(turnStatus()); return; }

  const move = game.move(uciToMove(bestmove));
  board.lastMove = { from: move.from, to: move.to };
  board.render();
  await coach.review(game, move);

  busy = false;
  setStatus(turnStatus());
  if (!gameOverMessage()) board.setInteractive(true);
}

async function newGame() {
  mode = 'play';
  currentPuzzle = null;
  game.reset();
  board.orientation = humanColor;
  board.lastMove = null;
  board._build();
  board.render();
  $('puzzle-banner').classList.add('hidden');
  $('verdict').innerHTML = '';
  $('explain-out').textContent = '';
  $('explain-btn').disabled = true;
  setStatus('New game. White to move.');
  await coach.seed(game.fen());

  // If the human is Black, the engine (White) opens.
  if (humanColor === 'b') { await engineMove(); }
  else board.setInteractive(true);
}

// ---- Daily Puzzle --------------------------------------------------------

async function loadPuzzle() {
  const p = puzzleOfTheDay();
  if (!p) { setStatus('No puzzle available today.'); return; }
  mode = 'puzzle';
  currentPuzzle = p;
  game.load(p.fen);
  humanColor = game.turn();
  board.orientation = humanColor;
  board.lastMove = null;
  board._build();
  board.render();
  board.setInteractive(true);
  $('verdict').innerHTML = '';
  $('explain-out').textContent = '';
  $('explain-btn').disabled = true;
  $('puzzle-banner').classList.remove('hidden');
  $('puzzle-theme').textContent = p.theme;
  setStatus(`${game.turn() === 'w' ? 'White' : 'Black'} to play and mate in one.`);
  await coach.seed(game.fen());
}

function onPuzzleMove(move) {
  if (game.isCheckmate()) {
    board.setInteractive(false);
    setStatus('Solved! That’s checkmate. 🎉');
    $('verdict').className = 'verdict best';
    $('verdict').innerHTML = `<strong>${move.san}#</strong> — Puzzle solved.`;
    return;
  }
  // Wrong try — take it back and let them retry.
  game.undo();
  board.lastMove = null;
  board.render();
  setStatus('Not mate — try again. (Tip: it’s mate in one.)');
}

function showSolution() {
  if (!currentPuzzle) return;
  game.load(currentPuzzle.fen);
  const move = game.move(uciToMove(currentPuzzle.solution));
  board.lastMove = { from: move.from, to: move.to };
  board.render();
  board.setInteractive(false);
  setStatus(`Solution: ${move.san}#`);
}

// ---- Controls ------------------------------------------------------------

$('new-game').addEventListener('click', () => newGame());
$('mode-play').addEventListener('click', () => newGame());
$('mode-puzzle').addEventListener('click', () => loadPuzzle());
$('flip').addEventListener('click', () => board.flip());
$('show-solution').addEventListener('click', () => showSolution());
$('play-black').addEventListener('change', (e) => { humanColor = e.target.checked ? 'b' : 'w'; });
$('coach-toggle').addEventListener('change', (e) => {
  coach.setEnabled(e.target.checked);
  $('coach-panel').classList.toggle('hidden', !e.target.checked);
});
$('theme-select').addEventListener('change', (e) => {
  document.body.dataset.theme = e.target.value;
});

// ---- Boot ----------------------------------------------------------------

setStatus('Loading engine…');
engine.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 1 })
  .then(() => newGame());
