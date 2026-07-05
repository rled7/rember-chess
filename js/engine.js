// engine.js — thin wrapper around a single (vendored, single-threaded) Stockfish
// Web Worker. One engine instance is shared for BOTH the opponent's moves and
// coach-mode evaluation, so every request goes through one serialized queue:
// UCI only allows one `go` in flight at a time.

const ENGINE_URL = new URL('../vendor/stockfish.js', import.meta.url);

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this._queue = [];           // pending {cmdFen, options, resolve, ...}
    this._active = null;        // task currently running a `go`
    this._scoreCp = null;       // best score seen this search (side-to-move POV)
    this._mate = null;
    this._pv = null;
    this._ready = this._handshake();
    this.worker.onmessage = (e) => this._onLine(typeof e.data === 'string' ? e.data : e.data?.data ?? '');
  }

  _handshake() {
    return new Promise((resolve) => {
      this._readyResolve = resolve;
      this.worker.postMessage('uci');
    });
  }

  // Resolve init once the engine reports uciok, then isready -> readyok.
  _onLine(line) {
    if (line === 'uciok') {
      this.worker.postMessage('isready');
      return;
    }
    if (line === 'readyok' && this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
      return;
    }
    if (!this._active) return;

    if (line.startsWith('info') && line.includes(' score ')) {
      const cp = line.match(/score cp (-?\d+)/);
      const mate = line.match(/score mate (-?\d+)/);
      const pv = line.match(/ pv (.+)$/);
      if (cp) { this._scoreCp = parseInt(cp[1], 10); this._mate = null; }
      if (mate) { this._mate = parseInt(mate[1], 10); this._scoreCp = null; }
      if (pv) this._pv = pv[1].trim().split(/\s+/);
    } else if (line.startsWith('bestmove')) {
      const best = line.split(/\s+/)[1];
      const task = this._active;
      this._active = null;
      task.resolve({
        bestmove: best === '(none)' ? null : best,
        // Scores come back from the side-to-move's POV; normalize to White +.
        scoreCp: this._scoreCp == null ? null : (task.whiteToMove ? this._scoreCp : -this._scoreCp),
        mate: this._mate == null ? null : (task.whiteToMove ? this._mate : -this._mate),
        pv: this._pv,
      });
      this._pump();
    }
  }

  _pump() {
    if (this._active || this._queue.length === 0) return;
    const task = this._queue.shift();
    this._active = task;
    this._scoreCp = null;
    this._mate = null;
    this._pv = null;
    this.worker.postMessage(`setoption name Skill Level value ${task.skill}`);
    this.worker.postMessage(`position fen ${task.fen}`);
    this.worker.postMessage(task.go);
    if (task.timeoutMs) {
      task._timer = setTimeout(() => this.worker.postMessage('stop'), task.timeoutMs);
    }
  }

  // Run one search. whiteToMove is derived from the FEN so scores normalize.
  async _search(fen, { go, skill = 20, timeoutMs = 0 }) {
    await this._ready;
    const whiteToMove = fen.split(' ')[1] !== 'b';
    return new Promise((resolve) => {
      this._queue.push({
        fen, go, skill, whiteToMove, timeoutMs,
        resolve: (r) => { if (this._active?._timer) clearTimeout(this._active._timer); resolve(r); },
      });
      this._pump();
    });
  }

  // Opponent move. `level` 0..20 maps to Stockfish Skill Level; thinking time
  // is short so the UI stays responsive on a phone.
  bestMove(fen, { level = 12, movetime = 800 } = {}) {
    return this._search(fen, { go: `go movetime ${movetime}`, skill: level, timeoutMs: movetime + 1500 });
  }

  // Coach evaluation — fixed depth so verdicts are consistent between moves.
  evaluate(fen, { depth = 12 } = {}) {
    return this._search(fen, { go: `go depth ${depth}`, skill: 20, timeoutMs: 4000 });
  }
}
