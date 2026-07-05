// board.js — renders the board and handles human input.
// Primary interaction is TAP-TO-MOVE (tap a piece, tap a destination) which
// works identically for mouse and touch — HTML5 drag is miserable on phones.
// A promotion picker overlays when a pawn reaches the last rank.

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

export class Board {
  // game: a chess.js instance (source of truth). onHumanMove(move) fires after
  // a legal human move is applied to `game`.
  constructor(root, game, { onHumanMove, orientation = 'w' } = {}) {
    this.root = root;
    this.game = game;
    this.onHumanMove = onHumanMove || (() => {});
    this.orientation = orientation;
    this.interactive = false;
    this.selected = null;       // square name currently selected
    this.targets = new Set();   // legal destination squares for selection
    this.lastMove = null;       // {from, to} to highlight
    this._squares = new Map();  // square name -> element
    this._build();
    this.render();
  }

  _build() {
    this.root.innerHTML = '';
    this.root.classList.add('board');
    const ranks = this.orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = this.orientation === 'w' ? FILES : [...FILES].reverse();
    for (const rank of ranks) {
      for (const file of files) {
        const name = `${file}${rank}`;
        const sq = document.createElement('div');
        sq.className = `sq ${(FILES.indexOf(file) + rank) % 2 === 0 ? 'dark' : 'light'}`;
        sq.dataset.square = name;
        sq.addEventListener('click', () => this._onSquare(name));
        this._squares.set(name, sq);
        this.root.appendChild(sq);
      }
    }
  }

  setInteractive(v) {
    this.interactive = v;
    this._clearSelection();
  }

  flip() {
    this.orientation = this.orientation === 'w' ? 'b' : 'w';
    this._build();
    this.render();
  }

  _onSquare(name) {
    if (!this.interactive) return;
    const piece = this.game.get(name);

    if (this.selected && this.targets.has(name)) {
      this._attemptMove(this.selected, name);
      return;
    }
    // (Re)select one of the side-to-move's pieces.
    if (piece && piece.color === this.game.turn()) {
      this.selected = name;
      this.targets = new Set(
        this.game.moves({ square: name, verbose: true }).map((m) => m.to)
      );
      this.render();
      return;
    }
    this._clearSelection();
  }

  _attemptMove(from, to) {
    const moving = this.game.get(from);
    const lastRank = moving.color === 'w' ? '8' : '1';
    const isPromotion = moving.type === 'p' && to[1] === lastRank;
    if (isPromotion) {
      this._promptPromotion(moving.color, (piece) => this._commit(from, to, piece));
    } else {
      this._commit(from, to);
    }
  }

  _commit(from, to, promotion) {
    let move;
    try {
      move = this.game.move({ from, to, promotion });
    } catch {
      move = null;
    }
    this._clearSelection();
    if (move) {
      this.lastMove = { from: move.from, to: move.to };
      this.render();
      this.onHumanMove(move);
    }
  }

  _promptPromotion(color, cb) {
    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';
    const box = document.createElement('div');
    box.className = 'promotion-box';
    for (const type of ['q', 'r', 'b', 'n']) {
      const btn = document.createElement('button');
      btn.className = `promo-piece ${color === 'w' ? 'white' : 'black'}`;
      btn.textContent = GLYPH[type];
      btn.setAttribute('aria-label', { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type]);
      btn.addEventListener('click', () => { overlay.remove(); cb(type); });
      box.appendChild(btn);
    }
    overlay.appendChild(box);
    this.root.appendChild(overlay);
  }

  _clearSelection() {
    this.selected = null;
    this.targets = new Set();
    this.render();
  }

  // Reflect current game state onto the DOM. Cheap enough to call every move.
  render() {
    const inCheck = this.game.inCheck();
    const turn = this.game.turn();
    let kingSquare = null;
    if (inCheck) {
      for (const [name, sq] of this._squares) {
        const p = this.game.get(name);
        if (p && p.type === 'k' && p.color === turn) { kingSquare = name; break; }
        void sq;
      }
    }
    for (const [name, sq] of this._squares) {
      const piece = this.game.get(name);
      sq.textContent = piece ? GLYPH[piece.type] : '';
      sq.classList.toggle('white-piece', !!piece && piece.color === 'w');
      sq.classList.toggle('black-piece', !!piece && piece.color === 'b');
      sq.classList.toggle('selected', name === this.selected);
      sq.classList.toggle('target', this.targets.has(name));
      sq.classList.toggle('occupied-target', this.targets.has(name) && !!piece);
      sq.classList.toggle('last-move', !!this.lastMove && (name === this.lastMove.from || name === this.lastMove.to));
      sq.classList.toggle('check', name === kingSquare);
    }
  }
}
