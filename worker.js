(function(){
const global = (typeof globalThis !== 'undefined' ? globalThis : self);
const __m = {}, __d = {};
function __req(n){ n = n.split('/').pop(); if (__m[n]) return __m[n].exports; if (!__d[n]) throw new Error('no module ' + n); const m = { exports: {} }; __m[n] = m; __d[n](m, m.exports, __req); return m.exports; }
__d["engine.js"] = function(module, exports, require){
// 게임 엔진 (UI 없음). 브라우저와 Node 양쪽에서 동작한다.
(function () {
'use strict';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const LETTERS = new Set(['J', 'Q', 'K', 'A']);
const rv = c => RANKS.indexOf(c.r) + 2;          // 2..14 (A = 14)
const cid = c => c.r + c.s;
const other = p => (p === 'A' ? 'B' : 'A');

// 셀: 0=TL(1) 1=TR(2) 2=BL(3) 3=BR(4)
// 판 주변 8칸: [들어가는 셀, 밀려나는 쪽 셀]
const EDGES = {
  L0: [0, 1], L2: [2, 3],   // 1·3의 왼쪽 → 오른쪽으로 민다
  R1: [1, 0], R3: [3, 2],   // 2·4의 오른쪽 → 왼쪽으로 민다
  T0: [0, 2], T1: [1, 3],   // 1·2의 위쪽 → 아래로 민다
  B2: [2, 0], B3: [3, 1],   // 3·4의 아래쪽 → 위로 민다
};
// 점수용 인접 쌍: 1-2, 1-3, 2-4, 3-4
const PAIRS = [[0, 1], [0, 2], [1, 3], [2, 3]];

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  return d;
}
const letterCount = h => h.filter(c => LETTERS.has(c.r)).length;
const aceCount = h => h.filter(c => c.r === 'A').length;

// ---------- 세팅 ----------
// A = 사람(아래), B = AI(위). A의 동반자는 A의 오른쪽(동쪽), B의 동반자는 B의 오른쪽(서쪽).
function newGame(rand) {
  let reshuffles = 0;
  for (;;) {
    const deck = shuffle(makeDeck(), rand);
    const removed = deck.slice(0, 4);
    const west = deck.slice(4, 16), east = deck.slice(16, 28);
    const hA = deck.slice(28, 40), hB = deck.slice(40, 52);
    const lA = letterCount(hA), lB = letterCount(hB);
    const aA = aceCount(hA), aB = aceCount(hB);
    let second;
    if (lA !== lB) second = lA < lB ? 'A' : 'B';
    else if (aA !== aB) second = aA < aB ? 'A' : 'B';
    else { reshuffles++; continue; }
    const first = other(second);
    const board = shuffle(removed.slice(), rand).map(c => [c]);   // 판에 랜덤 배치
    return {
      board,
      hands: { A: hA, B: hB },
      comp: { A: { deck: east, tamed: false }, B: { deck: west, tamed: false } },
      market: { A: [], B: [] },
      level: { A: [], B: [] },
      played: { A: [], B: [] },
      setup: { first, second, tiebreak: lA === lB, reshuffles,
               letters: { A: lA, B: lB }, aces: { A: aA, B: aB } },
      // 반시계: 선공 → 선공 동반자 → 후공 → 후공 동반자
      order: [{ t: 'P', o: first }, { t: 'C', o: first }, { t: 'P', o: second }, { t: 'C', o: second }],
      turn: 0,
      over: null,
      log: [],
    };
  }
}

function clone(st) {
  return {
    board: st.board.map(s => s.slice()),
    hands: { A: st.hands.A.slice(), B: st.hands.B.slice() },
    comp: { A: { deck: st.comp.A.deck.slice(), tamed: st.comp.A.tamed },
            B: { deck: st.comp.B.deck.slice(), tamed: st.comp.B.tamed } },
    market: { A: st.market.A.slice(), B: st.market.B.slice() },
    level: { A: st.level.A.slice(), B: st.level.B.slice() },
    played: { A: st.played.A.slice(), B: st.played.B.slice() },
    setup: st.setup, order: st.order, turn: st.turn, over: st.over, log: st.log,
  };
}

const top = (st, i) => st.board[i][st.board[i].length - 1];
const actor = st => st.order[st.turn % 4];

// p의 레벨에서 상대보다 많은 문양 = p의 우위 문양
function dominant(st, p) {
  const q = other(p);
  return SUITS.filter(s =>
    st.level[p].filter(c => c.s === s).length > st.level[q].filter(c => c.s === s).length);
}

// owner(또는 그 동반자)가 card로 할 수 있는 합법수. wild면 제한 없음.
function legalMoves(st, owner, card, wild) {
  const moves = [];
  for (let i = 0; i < 4; i++) {
    const t = top(st, i);
    if (wild || t.s === card.s || t.r === card.r) moves.push({ kind: 'cover', cell: i });
  }
  const oppDom = new Set(dominant(st, other(owner)));
  const v = rv(card);
  for (const [e, [a, b]] of Object.entries(EDGES)) {
    const ta = top(st, a), tb = top(st, b);
    let ok;
    if (wild) ok = true;
    else if (oppDom.has(ta.s) || oppDom.has(tb.s)) ok = v > rv(ta) && v > rv(tb);
    else ok = v >= rv(ta) && v >= rv(tb);
    if (ok) moves.push({ kind: 'push', edge: e, gain: st.board[b].length });
  }
  return moves;
}

function playerMoves(st, p) {
  const out = [];
  for (const card of st.hands[p])
    for (const m of legalMoves(st, p, card, false)) out.push({ ...m, card });
  return out;
}

// 동반자 후보: 밀기가 있으면 밀기만, 그중 최다 획득만. wild면 제한 없이 전부(소유자 자유 선택).
function companionMoves(st, o) {
  const c = st.comp[o];
  if (!c.deck.length) return { moves: [], wild: false };
  const card = c.deck[0];
  const normal = legalMoves(st, o, card, false);
  if (!normal.length) return { moves: [], wild: false };
  if (c.tamed) return { moves: legalMoves(st, o, card, true).map(m => ({ ...m, card })), wild: true };
  const pushes = normal.filter(m => m.kind === 'push');
  let moves = normal;
  if (pushes.length) {
    const best = Math.max(...pushes.map(m => m.gain));
    moves = pushes.filter(m => m.gain === best);
  }
  return { moves: moves.map(m => ({ ...m, card })), wild: false };
}

// 카드를 놓는다. 밀려난 카드 배열을 돌려준다(시장/레벨 배분은 호출자가 allocate로).
function applyMove(st, m) {
  if (m.kind === 'cover') { st.board[m.cell].push(m.card); return []; }
  const [a, b] = EDGES[m.edge];
  const out = st.board[b];
  st.board[b] = st.board[a];
  st.board[a] = [m.card];
  return out;
}

// alloc: 카드별 'M'(시장) | 'L'(레벨)
function allocate(st, p, cards, alloc) {
  cards.forEach((c, i) => (alloc[i] === 'L' ? st.level : st.market)[p].push(c));
}

function scoringConditions(st) {
  const suits = [], ranks = [];
  for (const [i, j] of PAIRS) {
    const a = top(st, i), b = top(st, j);
    if (a.s === b.s) suits.push(a.s);
    if (a.r === b.r) ranks.push(a.r);
  }
  return { suits, ranks };
}
function score(st, p) {
  const { suits, ranks } = scoringConditions(st);
  let sc = 0;
  for (const s of suits) sc += st.market[p].filter(c => c.s === s).length;
  for (const r of ranks) sc += 3 * st.market[p].filter(c => c.r === r).length;
  return sc;
}
function finalResult(st, reason, by) {
  const sA = score(st, 'A'), sB = score(st, 'B');
  const nA = st.market.A.length, nB = st.market.B.length;
  let winner = null;
  if (sA !== sB) winner = sA > sB ? 'A' : 'B';
  else if (nA !== nB) winner = nA < nB ? 'A' : 'B';
  return { reason, by, score: { A: sA, B: sB }, marketSize: { A: nA, B: nB }, winner };
}

// 플레이어 차례 시작 시 상태: 합법수 없음 → 종료, 밀기 없음 → 종료 선언 가능
function playerTurnInfo(st, p) {
  const moves = playerMoves(st, p);
  return { moves, mustEnd: moves.length === 0, canDeclareEnd: moves.length > 0 && !moves.some(m => m.kind === 'push') };
}

// 플레이어 수 실행 (allocFn(cards) -> alloc 배열)
function doPlayerMove(st, p, m, alloc) {
  st.hands[p] = st.hands[p].filter(c => c !== m.card);
  st.played[p].push(m.card);
  const cap = applyMove(st, m);
  allocate(st, p, cap, alloc || cap.map(() => 'M'));
  st.turn++;
  return cap;
}
// 동반자 수 실행
function doCompanionMove(st, o, m, alloc) {
  const c = st.comp[o];
  c.deck.shift();
  c.tamed = false;
  const cap = applyMove(st, m);
  allocate(st, o, cap, alloc || cap.map(() => 'M'));
  st.turn++;
  return cap;
}
// 동반자 합법수 없음 → 길들여짐(유지)
function doCompanionPass(st, o) {
  st.comp[o].tamed = true;
  st.turn++;
}

const Engine = {
  SUITS, RANKS, LETTERS, EDGES, PAIRS, rv, cid, other, mulberry32, hashSeed, shuffle, makeDeck,
  letterCount, aceCount, newGame, clone, top, actor, dominant, legalMoves, playerMoves,
  companionMoves, applyMove, allocate, scoringConditions, score, finalResult, playerTurnInfo,
  doPlayerMove, doCompanionMove, doCompanionPass,
};
if (typeof module !== 'undefined') module.exports = Engine;
else window.Engine = Engine;
})();

};
__d["ai.js"] = function(module, exports, require){
// AI: 숨은 정보를 샘플링(결정화)하고, 내 수 → 동반자 → 상대 최선 응수 → 동반자까지 내다본 뒤 평가한다.
(function () {
'use strict';
const E = (typeof module !== 'undefined') ? require('./engine.js') : window.Engine;

// 평가값 (me 관점). 높을수록 좋다.
function evaluate(st, me) {
  const op = E.other(me);
  if (st.over) {
    const r = st.over;
    const d = r.score[me] - r.score[op];
    return r.winner === me ? 1000 + d : r.winner === op ? -1000 + d : d;
  }
  const tops = [0, 1, 2, 3].map(i => E.top(st, i));
  const potential = p => {
    let v = 0;
    for (const c of st.market[p]) {
      v += 0.3;
      for (const t of tops) { if (t.s === c.s) v += 0.1; if (t.r === c.r) v += 0.25; }
    }
    return v;
  };
  return (E.score(st, me) - E.score(st, op))
    + 0.6 * (E.dominant(st, me).length - E.dominant(st, op).length)
    + 0.5 * (potential(me) - potential(op))
    - 0.05 * (st.market[me].length - st.market[op].length);
}

// 획득 카드를 한 장씩 시장/레벨 중 평가가 높은 쪽으로
function greedyAlloc(st, p, cards) {
  const alloc = [];
  const tmp = E.clone(st);
  for (const c of cards) {
    const m = E.clone(tmp); m.market[p].push(c);
    const l = E.clone(tmp); l.level[p].push(c);
    if (evaluate(l, p) > evaluate(m, p)) { alloc.push('L'); tmp.level[p].push(c); }
    else { alloc.push('M'); tmp.market[p].push(c); }
  }
  return alloc;
}

// 동반자 수 실행 후 상태에서 배분까지 포함해 적용
function simCompanion(st, o, m) {
  const s = E.clone(st);
  s.comp[o].deck.shift(); s.comp[o].tamed = false;
  const cap = E.applyMove(s, m);
  E.allocate(s, o, cap, greedyAlloc(s, o, cap));
  s.turn++;
  return s;
}
function simPlayer(st, p, m) {
  const s = E.clone(st);
  s.hands[p] = s.hands[p].filter(c => c !== m.card);
  s.played[p] = s.played[p].concat([m.card]);
  const cap = E.applyMove(s, m);
  const alloc = greedyAlloc(s, p, cap);
  E.allocate(s, p, cap, alloc);
  s.turn++;
  return { s, alloc };
}

// 소유자 입장에서 동반자 후보 중 하나 고르기
function chooseCompanion(st, o, moves) {
  let best = null, bv = -Infinity;
  for (const m of moves) {
    const v = evaluate(simCompanion(st, o, m), o);
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

// 다음 플레이어 차례가 올 때까지 동반자 차례를 자동 진행
function runCompanions(st) {
  let s = st;
  for (let guard = 0; guard < 4 && !s.over; guard++) {
    const a = E.actor(s);
    if (a.t === 'P') break;
    const { moves } = E.companionMoves(s, a.o);
    if (!moves.length) { s = E.clone(s); E.doCompanionPass(s, a.o); continue; }
    s = simCompanion(s, a.o, moves.length === 1 ? moves[0] : chooseCompanion(s, a.o, moves));
  }
  return s;
}

function endState(st, reason, by) {
  const s = E.clone(st); s.over = E.finalResult(s, reason, by); return s;
}

// p의 1수 최선(상대 응수 모델링용)
function greedyValue(st, p, judge) {
  const info = E.playerTurnInfo(st, p);
  if (info.mustEnd) return evaluate(endState(st, 'noMove', p), judge);
  let best = -Infinity, bestJ = 0;
  const consider = s => {
    s = runCompanions(s);
    const v = evaluate(s, p);
    if (v > best) { best = v; bestJ = evaluate(s, judge); }
  };
  if (info.canDeclareEnd) consider(endState(st, 'declared', p));
  for (const m of info.moves) consider(simPlayer(st, p, m).s);
  return bestJ;
}

// 상대 패 + 동반자 숨은 카드를 샘플링. 세팅 단계에서 얻은 문자카드 정보와 모순되는 샘플은 버린다.
function sampleWorld(st, me, rand) {
  const op = E.other(me);
  const hiddenComp = o => st.comp[o].deck.slice(1);
  const pool = [...st.hands[op], ...hiddenComp('A'), ...hiddenComp('B')];
  const nH = st.hands[op].length, nA = hiddenComp('A').length;
  const { first, letters, aces } = st.setup;
  const ok = hand => {
    const orig = hand.concat(st.played[op]);
    const L = E.letterCount(orig);
    if (first === me) return L === letters[op];                      // 선공: 후공 개수를 정확히 안다
    return L > letters[me] || (L === letters[me] && E.aceCount(orig) > aces[me]); // 후공: 선공이 더 많다
  };
  let p;
  for (let tries = 0; tries < 300; tries++) {
    p = E.shuffle(pool.slice(), rand);
    if (ok(p.slice(0, nH))) break;
  }
  const s = E.clone(st);
  s.hands[op] = p.slice(0, nH);
  s.comp.A.deck = [st.comp.A.deck[0], ...p.slice(nH, nH + nA)].filter(Boolean);
  s.comp.B.deck = [st.comp.B.deck[0], ...p.slice(nH + nA)].filter(Boolean);
  return s;
}

// AI 플레이어 결정. 반환: { end: true } 또는 { move, alloc }
function choosePlayer(st, me, opts = {}) {
  const samples = opts.samples ?? 12;
  const rand = opts.rand || Math.random;
  const op = E.other(me);
  const info = E.playerTurnInfo(st, me);
  const cands = info.moves.map(m => ({ move: m }));
  // 종료 선언은 지금 끝내면 이기는 경우에만 고려한다 (무승부·패배로 일찍 끝내지 않음)
  if (info.canDeclareEnd && endState(st, 'declared', me).over.winner === me) cands.push({ end: true });
  if (samples === 0) {   // 쉬움: 1수 평가
    let best = null, bv = -Infinity;
    for (const c of cands) {
      const s = c.end ? endState(st, 'declared', me) : runCompanions(simPlayer(st, me, c.move).s);
      const v = evaluate(s, me);
      if (v > bv) { bv = v; best = c; }
    }
    return finalize(st, me, best);
  }
  const worlds = Array.from({ length: samples }, () => sampleWorld(st, me, rand));
  let best = null, bv = -Infinity;
  for (const c of cands) {
    let total = 0;
    for (const w of worlds) {
      if (c.end) { total += evaluate(endState(w, 'declared', me), me); continue; }
      let s = runCompanions(simPlayer(w, me, { ...c.move, card: w.hands[me].find(x => x === c.move.card) }).s);
      if (s.over) { total += evaluate(s, me); continue; }
      total += E.actor(s).o === op ? greedyValue(s, op, me) : evaluate(s, me);
    }
    if (total > bv) { bv = total; best = c; }
  }
  return finalize(st, me, best);
}
function finalize(st, me, c) {
  if (c.end) return { end: true };
  return { move: c.move, alloc: simPlayer(st, me, c.move).alloc };
}

const AI = { evaluate, greedyAlloc, chooseCompanion, choosePlayer, sampleWorld, runCompanions };
if (typeof module !== 'undefined') module.exports = AI;
else window.AI = AI;
})();

};
__d["pol.js"] = function(module, exports, require){
// 기계적 정책들 (탐색 없음). A = 사용자가 제시한 "덮고-동반자가 민다 → 시장 축적 → 고카드로 짝" 전략.
const E = require('/home/pjins7360/cardgame/engine.js');
const other = E.other, rv = E.rv;
const diff = (s, me) => E.score(s, me) - E.score(s, other(me));
const winsNow = (s, me) => E.finalResult(s, 'declared', me).winner === me;

function applyP(s, me, m, alloc) {   // 플레이어 수 적용(복제본)
  const t = E.clone(s);
  t.hands[me] = t.hands[me].filter(c => c !== m.card);
  const cap = E.applyMove(t, m);
  E.allocate(t, me, cap, alloc ? alloc(t, me, cap) : cap.map(() => 'M'));
  t.turn++;
  return t;
}
// 동반자 강제수 중 최다 획득 (원래 규칙: 밀기 우선, 최다 획득). 와일드면 최다 획득 밀기.
function compBestGain(s, o) {
  if (s.comp[o].tamed) return 0;   // 와일드 여부는 단순화: 길들여진 동반자는 기대 안 함
  const { moves } = E.companionMoves(s, o);
  let g = 0;
  for (const m of moves) if (m.kind === 'push') g = Math.max(g, m.gain);
  return g;
}
const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
function argmax(items, keyf) { let best = null, bk = null; for (const it of items) { const k = keyf(it); if (!bk || better(k, bk)) { bk = k; best = it; } } return best; }

// ---------------- 전략 A ----------------
// opts.hi: 이 랭크 이상은 "고카드"(후반 짝 만들기용으로 아낀다). opts.switchAt: 손패가 이 이하면 짝 단계.
function makeA(opts = {}) {
  const HI = opts.hi ?? 12, SW = opts.switchAt ?? 6;
  // opts.dom: 각 문양에서 상대보다 레벨이 많아질 때까지만 레벨, 나머지는 시장 (최소 비용 문양 우위)
  const allM = (t, me, cap) => {
    if (!opts.dom) return cap.map(() => 'M');
    const op = other(me), lv = {}; let mk = t.market[me].length;
    for (const c of t.level[me]) lv[c.s] = (lv[c.s] || 0) + 1;
    return cap.map(c => {
      const mine = lv[c.s] || 0, theirs = t.level[op].filter(x => x.s === c.s).length;
      if (mine <= theirs) { lv[c.s] = mine + 1; return 'L'; }
      if (opts.lean && mk + 1 >= t.market[op].length) { lv[c.s] = mine + 1; return 'L'; }   // 시장은 상대보다 항상 적게
      mk++; return 'M';
    });
  };
  const capOf = (s, m) => m.kind === 'push' ? s.board[E.EDGES[m.edge][1]] : [];
  function choosePlayer(s, me, rand) {
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && winsNow(s, me)) return { end: true };
    let moves = info.moves;
    if (opts.safe) {   // A': 내 수 → 내 동반자 강제수 뒤, 상대가 '못 밀고 종료하면 이기는' 상태가 되는 수는 피한다
      const ok = moves.filter(m => !loses(s, me, m, rand));
      if (ok.length) moves = ok;
    }
    const low = moves.filter(m => rv(m.card) < HI);
    const pairPhase = s.hands[me].length <= SW || !low.length;
    if (!pairPhase) {
      // 1) 저카드로 덮어서 내 동반자가 바로 큰 더미를 밀게 만든다 (덮기→동반자 밀기 콤보)
      const covers = low.filter(m => m.kind === 'cover');
      let best = null, bk = null;
      for (const m of covers) {
        const t = applyP(s, me, m, allM);
        const g = compBestGain(t, me);
        const k = [g, rv(E.top(s, m.cell)) - rv(m.card), -rv(m.card), rand()];
        if (!bk || better(k, bk)) { bk = k; best = m; }
      }
      if (best && bk[0] >= 1) return { move: best, alloc: [] };
      // 2) 저카드로 판의 고카드를 덮는다 (판을 낮게 → 상대는 종료권을 못 얻음)
      if (best && bk[1] > 0) return { move: best, alloc: [] };
      // 3) 저카드로 가장 많이 가져오는 밀기
      const pushes = low.filter(m => m.kind === 'push');
      if (pushes.length) {
        const m = argmax(pushes, m => [m.gain, -rv(m.card), rand()]);
        return { move: m, alloc: allM(s, me, capOf(s, m)) };
      }
      if (best) return { move: best, alloc: [] };
    }
    // 짝 단계: 내 수 직후 라이브 점수 차가 최대가 되는 수 (고카드를 판 위에 올려 상대 밀기를 막는 쪽 선호)
    const m = argmax(moves, m => {
      const t = applyP(s, me, m, allM);
      const blocked = m.kind === 'push' ? rv(m.card) : 0;
      return [diff(t, me), blocked, -rv(m.card), rand()];
    });
    return { move: m, alloc: allM(s, me, capOf(s, m)) };
  }
  function loses(s, me, m, rand) {
    let t = applyP(s, me, m, allM);
    const a = E.actor(t);
    if (a.t === 'C' && a.o === me) {
      const { moves: cm } = E.companionMoves(t, me);
      if (!cm.length) { t = E.clone(t); E.doCompanionPass(t, me); }
      else { const d = chooseCompanion(t, me, cm, rand); t = E.clone(t); E.doCompanionMove(t, me, d.move, d.alloc); }
    }
    const op = other(me);
    if (!opts.peek) {   // 기본: 공개 정보만: 상대 손패를 보지 않고 '상대가 지금 종료하면 이긴다'만으로 판단
      if (!t.hands[op].length) return E.finalResult(t, 'noMove', op).winner === op;
      return winsNow(t, op);
    }
    const info = E.playerTurnInfo(t, op);
    if (info.mustEnd) return E.finalResult(t, 'noMove', op).winner === op;
    return info.canDeclareEnd && winsNow(t, op);
  }
  function chooseCompanion(s, o, moves, rand) {
    const m = argmax(moves, m => {
      const t = E.clone(s); t.comp[o].deck.shift(); t.comp[o].tamed = false;
      const al = allM(t, o, capOf(t, m)); const cap = E.applyMove(t, m); E.allocate(t, o, cap, al);
      return [diff(t, o), m.kind === 'push' ? m.gain : 0, rand()];
    });
    return { move: m, alloc: allM(s, o, capOf(s, m)) };
  }
  return { name: opts.safe ? "A'" : 'A', choosePlayer, chooseCompanion };
}

module.exports = { makeA, applyP, diff, winsNow, compBestGain, argmax, better };

// ---------------- 카운터 B ----------------
// 축 1) 획득 카드는 전부 레벨 → 시장 0장 유지(동점·0:0이면 시장 적은 쪽 승) + 문양 우위로 A와 A 동반자에게 '초과' 밀기 강제
// 축 2) 판의 짝을 지운다: 내 수 직후 A의 라이브 점수를 최소화
// 축 3) A의 덮기→동반자 밀기 콤보를 끊는다: A 동반자가 다음에 가져갈 수 있는 더미 크기를 최소화, 큰 더미는 내가 먼저 가져간다
// 축 4) 고카드는 아낀다(같은 조건이면 낮은 카드)
function makeB(opts = {}) {
  const target = new WeakMap();
  const tgt = (s, me) => {
    let tg = target.get(s.setup);   // 게임(setup 객체)마다 따로
    if (!tg) {
      const cnt = {}; for (const c of s.hands[me].concat(s.played[me])) cnt[c.s] = (cnt[c.s] || 0) + 1;
      tg = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      target.set(s.setup, tg);
    }
    return tg;
  };
  const allocF = (t, me, cap) => cap.map(c => (opts.mkt === 'target' && c.s === tgt(t, me)) ? 'M' : 'L');
  const allL = allocF;
  function afterMine(s, me, m, rand) {
    let t = applyP(s, me, m, allL);
    const a = E.actor(t);
    if (a.t === 'C' && a.o === me) {
      const { moves: cm } = E.companionMoves(t, me);
      t = E.clone(t);
      if (!cm.length) E.doCompanionPass(t, me);
      else { const d = chooseCompanion(t, me, cm, rand); E.doCompanionMove(t, me, d.move, d.alloc); }
    }
    return t;
  }
  function loses(t, me) {
    const op = other(me);
    if (!opts.peek) {   // 기본: 공개 정보만
      if (!t.hands[op].length) return E.finalResult(t, 'noMove', op).winner === op;
      return winsNow(t, op);
    }
    const info = E.playerTurnInfo(t, op);
    if (info.mustEnd) return E.finalResult(t, 'noMove', op).winner === op;
    return info.canDeclareEnd && winsNow(t, op);
  }
  // 상대 차례 직후 상대 동반자가 밀 때 가져갈 수 있는 최대 더미(상대 수 이전 기준의 근사: 현재 판 최대 더미)
  const maxStack = t => Math.max(...t.board.map(c => c.length));
  function choosePlayer(s, me, rand) {
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && winsNow(s, me)) return { end: true };
    const op = other(me);
    const cands = info.moves.map(m => ({ m, t: afterMine(s, me, m, rand) }));
    let pool = cands;
    if (opts.safe) { const ok = cands.filter(c => !loses(c.t, me)); if (ok.length) pool = ok; }
    const minReq = t => Math.min(...Object.values(E.EDGES).map(([a, b]) => Math.max(rv(E.top(t, a)), rv(E.top(t, b)))));
    const best = opts.high ? argmax(pool, ({ m, t }) => [
      diff(t, me),                          // 짝 지우기(A 라이브 점수 최소)
      minReq(t),                            // 판을 높게: A(와 A 동반자)가 밀기 어렵게, 나는 종료권 확보
      -maxStack(t),
      rv(m.card),                           // 고카드를 먼저 판에 올린다(손에는 낮은 카드만 남겨 종료권)
      rand()]) : argmax(pool, ({ m, t }) => [
      diff(t, me),                          // = -(A 라이브 점수) + 내 점수
      -maxStack(t),                         // A 콤보용 더미 남기지 않기
      m.kind === 'push' ? m.gain : 0,       // 더미는 내가 가져간다(레벨로)
      -rv(m.card), rand()]);
    const m = best.m;
    return { move: m, alloc: m.kind === 'push' ? allocF(s, me, s.board[E.EDGES[m.edge][1]]) : [] };
  }
  function chooseCompanion(s, o, moves, rand) {
    const m = argmax(moves, m => {
      const t = E.clone(s); t.comp[o].deck.shift(); t.comp[o].tamed = false;
      const cap = E.applyMove(t, m); E.allocate(t, o, cap, allocF(t, o, cap));
      return [diff(t, o), -maxStack(t), m.kind === 'push' ? m.gain : 0, rand()];
    });
    return { move: m, alloc: m.kind === 'push' ? allocF(s, o, s.board[E.EDGES[m.edge][1]]) : [] };
  }
  return { name: 'B', choosePlayer, chooseCompanion };
}
module.exports.makeB = makeB;

// ---------------- 카운터 C (B5 대응) ----------------
// opts.mode: 'lock'(C1: 전부 레벨 → B5 시장 0 고정, 막판 확정승 때만 시장 전환) | 'focus'(C2: 목표 문양만 시장)
// opts.deny: C3 엔진 봉쇄 모듈(누적 단계에서 상대 동반자가 밀 수 있는 칸 수 최소화)
// opts.reserve: 마지막 수용으로 아껴 두는 최고 카드 수. opts.peek: (카운팅 가치 평가 전용) 상대 손패 엿보기 허용. 기본은 금지.
const cidOf = c => c.r + c.s;
function unseenFor(s, me) {   // 내 시점에서 보이지 않는 카드(상대 손패 + 동반자 덮인 패 후보)
  const op = other(me), seen = new Set();
  const add = arr => arr.forEach(c => seen.add(cidOf(c)));
  s.board.forEach(add); add(s.hands[me]); add(s.market.A); add(s.market.B); add(s.level.A); add(s.level.B);
  add(s.played.A); add(s.played.B);
  for (const o of ['A', 'B']) if (s.comp[o].deck.length) seen.add(cidOf(s.comp[o].deck[0]));
  return E.makeDeck().filter(c => !seen.has(cidOf(c)));
}
const capOf = (s, m) => m.kind === 'push' ? s.board[E.EDGES[m.edge][1]] : [];
const allocOpts = cap => {   // 배분 후보: 전부 레벨 / 전부 시장 / 한 장만 시장
  if (!cap.length) return [[]];
  const o = [cap.map(() => 'L'), cap.map(() => 'M')];
  if (cap.length > 1) cap.forEach((_, i) => o.push(cap.map((__, j) => (i === j ? 'M' : 'L'))));
  return o;
};
const resVal = (st, me) => { const w = st.over.winner; return w === me ? 2 : w === null ? 1 : 0; };

function makeC(opts = {}) {
  const MODE = opts.mode || 'lock', R = opts.reserve ?? 1;
  const target = new WeakMap(); let plan = null;
  const tgt = (s, me) => {
    let tg = target.get(s.setup);   // 게임(setup 객체)마다 따로
    if (!tg) {
      const cnt = {}; for (const c of s.hands[me].concat(s.played[me])) cnt[c.s] = (cnt[c.s] || 0) + 1;
      tg = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      target.set(s.setup, tg);
    }
    return tg;
  };
  const alloc = (t, me, cap) => cap.map(c => (MODE === 'focus' && c.s === tgt(t, me)) ? 'M' : 'L');
  const stepC = (t, o, m, al) => { t = E.clone(t); E.doCompanionMove(t, o, m, al); return t; };
  function chooseCompanionBasic(s, o, moves, rand) {
    const m = argmax(moves, m => {
      const t = stepC(s, o, m, alloc(s, o, capOf(s, m)));
      return [diff(t, o), m.kind === 'push' ? m.gain : 0, rand()];
    });
    return { move: m, alloc: alloc(s, o, capOf(s, m)) };
  }
  function afterMine(s, me, m, rand) {
    let t = E.clone(s); E.doPlayerMove(t, me, m, alloc(s, me, capOf(s, m)));
    const a = E.actor(t);
    if (a.t === 'C' && a.o === me) {
      const { moves } = E.companionMoves(t, me);
      if (!moves.length) { t = E.clone(t); E.doCompanionPass(t, me); }
      else { const d = chooseCompanionBasic(t, me, moves, rand); t = stepC(t, me, d.move, d.alloc); }
    }
    return t;
  }
  function loses(t, me) {
    const op = other(me);
    if (!t.hands[op].length) return E.finalResult(t, 'noMove', op).winner === op;
    if (!opts.peek) return winsNow(t, op);
    const info = E.playerTurnInfo(t, op);
    if (info.mustEnd) return E.finalResult(t, 'noMove', op).winner === op;
    return info.canDeclareEnd && winsNow(t, op);
  }
  // 상대 차례부터 끝까지(상대 1수 + 상대 동반자) 최악 결과. 상대 마지막 카드는 미공개 카드 전체를 후보로 본다.
  function worstFromOpp(t, me, unseen) {
    const op = other(me);
    const a = E.actor(t);
    if (a.t !== 'P' || a.o !== op) return null;
    if (!t.hands[op].length) { const z = E.clone(t); z.over = E.finalResult(z, 'noMove', op); return resVal(z, me); }
    let worst = 2;
    const cands = unseen;   // 상대 손패는 절대 보지 않는다
    for (const x of cands) {
      const w = E.clone(t); w.hands[op] = [x];
      const info = E.playerTurnInfo(w, op);
      const ends = [];
      if (info.mustEnd) ends.push(E.finalResult(w, 'noMove', op));
      else {
        if (info.canDeclareEnd) ends.push(E.finalResult(w, 'declared', op));
        for (const m of info.moves) for (const al of allocOpts(capOf(w, m))) {
          let u = E.clone(w); E.doPlayerMove(u, op, m, al);
          const b = E.actor(u);
          const finals = [];
          if (b.t === 'C' && b.o === op) {
            const { moves } = E.companionMoves(u, op);
            if (!moves.length) { const v = E.clone(u); E.doCompanionPass(v, op); finals.push(v); }
            else for (const cm of moves) for (const cal of allocOpts(capOf(u, cm))) finals.push(stepC(u, op, cm, cal));
          } else finals.push(u);
          for (const f of finals) ends.push(E.finalResult(f, 'noMove', me));
        }
      }
      for (const r of ends) { const v = r.winner === me ? 2 : r.winner === null ? 1 : 0; if (v < worst) worst = v; if (worst === 0) return 0; }
    }
    return worst;
  }
  // 마지막 한 장: 내 수 × 배분 × 내 동반자 수 × 배분 을 전부 보고, 최악 결과가 가장 좋은 계획을 고른다.
  function finalPlan(s, me, info, override) {
    const unseen = override || (opts.letters ? oppCandidates(s, me, true) : unseenFor(s, me));   // D4: 선후 결정 정보로 후보 축소
    let best = null, bk = null;
    for (const m of info.moves) for (const al of allocOpts(capOf(s, m))) {
      const t1 = E.clone(s); E.doPlayerMove(t1, me, m, al);
      const a = E.actor(t1);
      const branches = [];
      if (a.t === 'C' && a.o === me) {
        const { moves } = E.companionMoves(t1, me);
        if (!moves.length) { const v = E.clone(t1); E.doCompanionPass(v, me); branches.push({ t: v, cp: null }); }
        else for (const cm of moves) for (const cal of allocOpts(capOf(t1, cm))) branches.push({ t: stepC(t1, me, cm, cal), cp: { turn: t1.turn, move: cm, alloc: cal } });
      } else branches.push({ t: t1, cp: null });
      for (const br of branches) {
        const v = worstFromOpp(br.t, me, unseen);
        if (v === null) continue;
        const nM = al.filter(x => x === 'M').length + (br.cp ? br.cp.alloc.filter(x => x === 'M').length : 0);
        const k = [v, -nM, -rv(m.card)];
        if (!bk || better(k, bk)) { bk = k; best = { m, al, cp: br.cp, v }; }
      }
    }
    return best;
  }
  // D5: 내 11번째 수. 상대 남은 2장 후보(문자/A 정보로 축소) × 상대 수 × 상대 동반자 뒤, 내 마지막 수 판정(finalPlan)을 본다.
  // 상대 손 조합은 우연(평균), 상대 수는 적대적(최소)으로 취급. 내 수/상대 수의 배분은 레벨(잠금 유지) 가정.
  function look2(s, me, info, rand) {
    const op = other(me);
    let u = unseenFor(s, me);
    const remL = s.setup.letters[op] - E.letterCount(s.played[op]);
    const remA = s.setup.tiebreak ? s.setup.aces[op] - E.aceCount(s.played[op]) : null;
    const hands = [];
    for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) {
      const H = [u[i], u[j]];
      if (opts.letters && E.letterCount(H) !== remL) continue;
      if (opts.letters && remA !== null && E.aceCount(H) !== remA) continue;
      hands.push(H);
    }
    if (!hands.length) return null;
    const L = cap => cap.map(() => 'L');
    let best = null, bk = null;
    for (const m of info.moves) {
      let t1 = E.clone(s); E.doPlayerMove(t1, me, m, L(capOf(s, m)));
      if (E.actor(t1).t === 'C') {
        const { moves } = E.companionMoves(t1, me);
        t1 = E.clone(t1);
        if (!moves.length) E.doCompanionPass(t1, me);
        else { const d = chooseCompanionBasic(t1, me, moves, rand); E.doCompanionMove(t1, me, d.move, d.alloc); }
      }
      let sum = 0, mn = 2;
      for (const H of hands) {
        const w = E.clone(t1); w.hands[op] = H.slice();
        const oi = E.playerTurnInfo(w, op);
        let vH = 2;
        if (oi.mustEnd) { const r = E.finalResult(w, 'noMove', op); vH = r.winner === me ? 2 : r.winner === null ? 1 : 0; }
        else {
          if (oi.canDeclareEnd && winsNow(w, op)) vH = 0;
          for (const om of oi.moves) {
            if (!vH) break;
            const x = E.clone(w); E.doPlayerMove(x, op, om, L(capOf(w, om)));
            const ys = [];
            if (E.actor(x).t === 'C') {
              const { moves } = E.companionMoves(x, op);
              if (!moves.length) { const y = E.clone(x); E.doCompanionPass(y, op); ys.push(y); }
              else for (const cm of moves) { const y = E.clone(x); E.doCompanionMove(y, op, cm, L(capOf(x, cm))); ys.push(y); }
            } else ys.push(x);
            for (const y of ys) {
              const yi = E.playerTurnInfo(y, me);
              let v;
              if (yi.mustEnd) { const r = E.finalResult(y, 'noMove', me); v = r.winner === me ? 2 : r.winner === null ? 1 : 0; }
              else if (yi.canDeclareEnd && winsNow(y, me)) v = 2;
              else { const fp = finalPlan(y, me, yi, y.hands[op].slice()); v = fp ? fp.v : 0; }
              if (v < vH) vH = v;
              if (!vH) break;
            }
          }
        }
        sum += vH; if (vH < mn) mn = vH;
      }
      const k = [sum / hands.length, mn, -rv(m.card), rand()];
      if (!bk || better(k, bk)) { bk = k; best = { move: m, alloc: L(capOf(s, m)) }; }
    }
    return best;
  }
  function choosePlayer(s, me, rand) {
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && winsNow(s, me)) return { end: true };
    if (opts.look2 && s.hands[me].length === 2 && s.setup.first === me && s.hands[other(me)].length === 2) {
      const lp = look2(s, me, info, rand);
      if (lp) { plan = null; return lp; }
    }
    if (s.hands[me].length === 1) {
      const fp = finalPlan(s, me, info);
      if (global.C_LOG && s.setup.first === me) global.C_LOG.push({ v: fp ? fp.v : null, n: info.moves.length });
      if (fp) { plan = fp.cp; return { move: fp.m, alloc: fp.al }; }
    }
    let moves = info.moves;
    const cand = moves.map(m => ({ m, t: afterMine(s, me, m, rand) }));
    let pool = cand.filter(c => !loses(c.t, me));
    if (!pool.length) pool = cand;
    // 마지막 수용 최고 카드 R장은 아낀다
    if (s.hands[me].length > R) {
      const res = new Set(s.hands[me].slice().sort((a, b) => rv(b) - rv(a)).slice(0, R));
      const nr = pool.filter(c => !res.has(c.m.card));
      if (nr.length) pool = nr;
    }
    const low = pool.filter(c => rv(c.m.card) < 12);
    const pairPhase = s.hands[me].length <= 6 || !low.length;
    const op = other(me);
    const got = (t) => t.market[me].length + t.level[me].length - s.market[me].length - s.level[me].length;
    const maxStack = t => Math.max(...t.board.map(c => c.length));
    let pick;
    if (!pairPhase && opts.deny) {
      const threat = t => {   // 상대 동반자 윗장 이하인 탑 칸 수(한 칸 덮으면 밀 수 있는 발판)
        const d = t.comp[op].deck; if (!d.length || t.comp[op].tamed) return 0;
        const c = rv(d[0]); return [0, 1, 2, 3].filter(i => rv(E.top(t, i)) <= c).length;
      };
      pick = argmax(low, ({ m, t }) => [-threat(t), got(t), -maxStack(t), -rv(m.card), rand()]);
    } else if (!pairPhase) {
      // A/B5와 같은 누적 엔진: 덮기→내 동반자 밀기, 고카드 덮기, 저카드 밀기
      pick = argmax(low, ({ m, t }) => {
        const combo = m.kind === 'cover' ? got(t) : 0;
        const lower = m.kind === 'cover' ? rv(E.top(s, m.cell)) - rv(m.card) : 0;
        const pushGain = m.kind === 'push' ? m.gain : 0;
        return [combo >= 1 ? 1 : 0, combo, lower > 0 ? 1 : 0, pushGain, lower, -rv(m.card), rand()];
      });
    } else {
      // 짝 단계: 내 수 + 내 동반자 이후 라이브 점수 차
      pick = argmax(pool, ({ m, t }) => [diff(t, me), -rv(m.card), rand()]);
    }
    plan = null;
    return { move: pick.m, alloc: alloc(s, me, capOf(s, pick.m)) };
  }
  function chooseCompanion(s, o, moves, rand) {
    if (plan && plan.turn === s.turn) {
      const p = plan; plan = null;
      const m = moves.find(x => x.kind === p.move.kind && x.cell === p.move.cell && x.edge === p.move.edge);
      if (m) return { move: m, alloc: p.alloc };
    }
    return chooseCompanionBasic(s, o, moves, rand);
  }
  return { name: 'C', choosePlayer, chooseCompanion };
}
module.exports.makeC = makeC;

// ---------------- 선공용 파훼 D (후공 '마지막 수' 전략 대응) ----------------
// 기반: A'(누적 엔진, 획득은 시장에 넓게 → 어떤 짝이든 내 점수가 되게). 상대 손패는 절대 보지 않는다.
// opts.deny  (D1): 짝 단계에서 "리드 유지 + 득점 짝 여러 개 + 내 손에 밀 수 있는 카드 안 남기기(=종료권) + 고카드 먼저 소모"
// opts.final (D2): 마지막 한 장에서 [내 수×배분×내 동반자] 각각에 대해 상대 마지막 카드 후보 전부의 최악 결과를 보고 고른다
// opts.letters (D3): 상대 마지막 카드 후보를 선후 결정 정보(상대 문자카드 수, 동수였다면 A 수)로 좁힌다(선공일 때만)
function oppCandidates(s, me, useLetters) {
  const op = other(me);
  let u = unseenFor(s, me);
  if (!useLetters || s.setup.first !== me || s.hands[op].length !== 1) return u;
  const remL = s.setup.letters[op] - E.letterCount(s.played[op]);
  u = u.filter(c => E.LETTERS.has(c.r) === (remL === 1));
  if (s.setup.tiebreak) {
    const remA = s.setup.aces[op] - E.aceCount(s.played[op]);
    u = u.filter(c => (c.r === 'A') === (remA === 1));
  }
  return u;
}
function worstAfter(t, me, cands) {   // 상대 마지막 카드 → 상대 수(배분 포함)/선언 → 상대 동반자 → 종료. 내 관점 최악값
  const op = other(me), a = E.actor(t);
  if (a.t !== 'P' || a.o !== op) return null;
  const stepC = (u, o, m, al) => { u = E.clone(u); E.doCompanionMove(u, o, m, al); return u; };
  if (!t.hands[op].length) return E.finalResult(t, 'noMove', op).winner === me ? 2 : E.finalResult(t, 'noMove', op).winner === null ? 1 : 0;
  let worst = 2;
  for (const x of cands) {
    const w = E.clone(t); w.hands[op] = [x];
    const info = E.playerTurnInfo(w, op), ends = [];
    if (info.mustEnd) ends.push(E.finalResult(w, 'noMove', op));
    else {
      if (info.canDeclareEnd) ends.push(E.finalResult(w, 'declared', op));
      for (const m of info.moves) for (const al of allocOpts(capOf(w, m))) {
        const u = E.clone(w); E.doPlayerMove(u, op, m, al);
        const b = E.actor(u), fin = [];
        if (b.t === 'C' && b.o === op) {
          const { moves } = E.companionMoves(u, op);
          if (!moves.length) { const v = E.clone(u); E.doCompanionPass(v, op); fin.push(v); }
          else for (const cm of moves) for (const cal of allocOpts(capOf(u, cm))) fin.push(stepC(u, op, cm, cal));
        } else fin.push(u);
        for (const f of fin) ends.push(E.finalResult(f, 'noMove', me));
      }
    }
    for (const r of ends) { const v = r.winner === me ? 2 : r.winner === null ? 1 : 0; if (v < worst) worst = v; if (!worst) return 0; }
  }
  return worst;
}
function makeD(opts = {}) {
  const base = makeA({ safe: 1, peek: false });
  const SW = 6;
  let plan = null;
  const allM = (t, me, cap) => cap.map(() => 'M');
  function afterMine(s, me, m, rand) {
    let t = E.clone(s); E.doPlayerMove(t, me, m, allM(s, me, capOf(s, m)));
    const a = E.actor(t);
    if (a.t === 'C' && a.o === me) {
      const { moves } = E.companionMoves(t, me);
      t = E.clone(t);
      if (!moves.length) E.doCompanionPass(t, me);
      else { const d = base.chooseCompanion(t, me, moves, rand); E.doCompanionMove(t, me, d.move, d.alloc); }
    }
    return t;
  }
  const scoringPairs = (t, me) => {
    let n = 0;
    for (const [i, j] of E.PAIRS) {
      const a = E.top(t, i), b = E.top(t, j);
      if ((a.s === b.s && t.market[me].some(c => c.s === a.s)) || (a.r === b.r && t.market[me].some(c => c.r === a.r))) n++;
    }
    return n;
  };
  const pushable = (t, me) => t.hands[me].filter(c => E.legalMoves(t, me, c, false).some(m => m.kind === 'push')).length;
  function finalPlan(s, me, info) {
    const cands = oppCandidates(s, me, opts.letters);
    let best = null, bk = null;
    for (const m of info.moves) for (const al of allocOpts(capOf(s, m))) {
      const t1 = E.clone(s); E.doPlayerMove(t1, me, m, al);
      const a = E.actor(t1), brs = [];
      if (a.t === 'C' && a.o === me) {
        const { moves } = E.companionMoves(t1, me);
        if (!moves.length) { const v = E.clone(t1); E.doCompanionPass(v, me); brs.push({ t: v, cp: null }); }
        else for (const cm of moves) for (const cal of allocOpts(capOf(t1, cm))) {
          const v = E.clone(t1); E.doCompanionMove(v, me, cm, cal); brs.push({ t: v, cp: { turn: t1.turn, move: cm, alloc: cal } });
        }
      } else brs.push({ t: t1, cp: null });
      for (const br of brs) {
        const v = worstAfter(br.t, me, cands);
        if (v === null) continue;
        const k = [v, diff(br.t, me), -br.t.market[me].length];
        if (!bk || better(k, bk)) { bk = k; best = { m, al, cp: br.cp, v }; }
      }
    }
    return best;
  }
  function choosePlayer(s, me, rand) {
    plan = null;
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && winsNow(s, me)) return { end: true };
    if (opts.final && s.hands[me].length === 1) {
      const fp = finalPlan(s, me, info);
      if (global.D_LOG) global.D_LOG.push({ v: fp ? fp.v : null, nc: oppCandidates(s, me, opts.letters).length, nu: unseenFor(s, me).length, lead: diff(s, me), mk: s.market[me].length });
      if (fp) { plan = fp.cp; return { move: fp.m, alloc: fp.al }; }
    }
    if (!opts.deny || s.hands[me].length > SW) return base.choosePlayer(s, me, rand);
    const op = other(me);
    const cand = info.moves.map(m => ({ m, t: afterMine(s, me, m, rand) }));
    let pool = cand.filter(c => !(c.t.hands[op].length ? winsNow(c.t, op) : E.finalResult(c.t, 'noMove', op).winner === op));
    if (!pool.length) pool = cand;
    const pick = argmax(pool, ({ m, t }) => [diff(t, me) > 0 ? 1 : 0, scoringPairs(t, me), diff(t, me), -pushable(t, me), rv(m.card), rand()]);
    return { move: pick.m, alloc: allM(s, me, capOf(s, pick.m)) };
  }
  function chooseCompanion(s, o, moves, rand) {
    if (plan && plan.turn === s.turn) {
      const p = plan; plan = null;
      const m = moves.find(x => x.kind === p.move.kind && x.cell === p.move.cell && x.edge === p.move.edge);
      if (m) return { move: m, alloc: p.alloc };
    }
    return base.chooseCompanion(s, o, moves, rand);
  }
  return { name: 'D', choosePlayer, chooseCompanion };
}
module.exports.makeD = makeD;

};
__d["sim.js"] = function(module, exports, require){
// 공용: 끝까지 진행(play-out), 숨은 정보 샘플링(공개 정보만 사용), 정책 생성 별칭
const E = require('/home/pjins7360/cardgame/engine.js');
const P = require('./pol.js');
const other = E.other;
const cidOf = c => c.r + c.s;

function unseenFor(s, me) {
  const seen = new Set();
  const add = arr => arr.forEach(c => seen.add(cidOf(c)));
  s.board.forEach(add); add(s.hands[me]); add(s.market.A); add(s.market.B); add(s.level.A); add(s.level.B);
  add(s.played.A); add(s.played.B);
  for (const o of ['A', 'B']) if (s.comp[o].deck.length) seen.add(cidOf(s.comp[o].deck[0]));
  return E.makeDeck().filter(c => !seen.has(cidOf(c)));
}
// 상대 손패 + 두 동반자의 덮인 패를 미공개 집합에서 샘플링. 선후 결정 정보와 모순되는 손패는 버린다.
function sampleWorld(st, me, rand) {
  const op = other(me);
  const pool = unseenFor(st, me);
  const nH = st.hands[op].length;
  const hid = o => Math.max(0, st.comp[o].deck.length - 1);
  const { first, letters, aces, tiebreak } = st.setup;
  const ok = hand => {
    const orig = hand.concat(st.played[op]);
    const L = E.letterCount(orig), A = E.aceCount(orig);
    if (first === me) return L === letters[op] && (!tiebreak || A === aces[op]);
    return L > letters[me] || (L === letters[me] && A > aces[me]);
  };
  let p = pool.slice();
  for (let tries = 0; tries < 200; tries++) { p = E.shuffle(pool.slice(), rand); if (ok(p.slice(0, nH))) break; }
  const s = E.clone(st);
  s.hands[op] = p.slice(0, nH);
  let k = nH;
  for (const o of ['A', 'B']) {
    const n = hid(o);
    s.comp[o].deck = st.comp[o].deck.length ? [st.comp[o].deck[0], ...p.slice(k, k + n)] : [];
    k += n;
  }
  return s;
}
// 한 판 끝까지. pols = {A: pol, B: pol}. hooks: onMove(sBefore, actor, move, alloc), onDecide(s, owner, label)
function playOut(s, pols, rand, hooks) {
  for (let g = 0; g < 400 && !s.over; g++) {
    const a = E.actor(s);
    if (a.t === 'P') {
      const info = E.playerTurnInfo(s, a.o);
      if (info.mustEnd) { s.over = E.finalResult(s, 'noMove', a.o); break; }
      const d = pols[a.o].choosePlayer(s, a.o, rand);
      if (d.end) { s.over = E.finalResult(s, 'declared', a.o); break; }
      const before = hooks ? E.clone(s) : null;
      E.doPlayerMove(s, a.o, d.move, d.alloc);
      if (hooks) for (const h of hooks) h.onMove && h.onMove(before, a, d.move, d.alloc);
    } else {
      const { moves } = E.companionMoves(s, a.o);
      if (!moves.length) { E.doCompanionPass(s, a.o); continue; }
      const d = pols[a.o].chooseCompanion(s, a.o, moves, rand);
      const before = hooks ? E.clone(s) : null;
      E.doCompanionMove(s, a.o, d.move, d.alloc);
      if (hooks) for (const h of hooks) h.onMove && h.onMove(before, a, d.move, d.alloc);
    }
  }
  if (!s.over) s.over = E.finalResult(s, 'timeout', null);
  return s.over;
}
const resVal = (r, me) => (r.winner === me ? 2 : r.winner === null ? 1 : 0);

// 기계적 정책 생성 (이름 → 새 인스턴스). C1은 롤아웃용(look2 없음), D는 실전용.
const MAKERS = {
  "A'": () => P.makeA({ safe: 1 }),
  B5: () => P.makeA({ safe: 1, dom: 1, lean: 1 }),
  C1: () => P.makeC({ mode: 'lock' }),
  D: () => P.makeC({ mode: 'lock', letters: 1, look2: 1 }),
};
// B5 배분 규칙(공개 정보만): 관찰자용
function allocB5(t, me, cap) {
  const op = other(me), lv = {}; let mk = t.market[me].length;
  for (const c of t.level[me]) lv[c.s] = (lv[c.s] || 0) + 1;
  return cap.map(c => {
    const mine = lv[c.s] || 0, theirs = t.level[op].filter(x => x.s === c.s).length;
    if (mine <= theirs) { lv[c.s] = mine + 1; return 'L'; }
    if (mk + 1 >= t.market[op].length) { lv[c.s] = mine + 1; return 'L'; }
    mk++; return 'M';
  });
}
module.exports = { unseenFor, sampleWorld, playOut, resVal, MAKERS, allocB5, cidOf };

};
__d["mix.js"] = function(module, exports, require){
// 혼합형 전략. M1: 샘플링+롤아웃으로 {A', B5, C1/D} 중 현재 최선의 하위 정책을 매 수 선택(상대는 행렬 균형 사전분포).
// M2: M1 + 관찰자(상대의 배분 행동으로 상대 하위 정책 사후분포 추정)를 롤아웃의 상대 모델로 사용.
// BL: 블러핑(초반 C1 신호 → 중반 B5), 막판은 D.
const E = require('/home/pjins7360/cardgame/engine.js');
const S = require('./sim.js');
const P = require('./pol.js');
const other = E.other;
const LABELS = ["A'", 'B5', 'C1'];

// ---- 관찰자: 배분 사건으로 하위 정책 추정 (HMM, 공개 정보만) ----
function makeObserver(opts = {}) {
  const EPS = opts.eps ?? 0.05, STAY = opts.stay ?? 0.9;
  const post = { A: [1 / 3, 1 / 3, 1 / 3], B: [1 / 3, 1 / 3, 1 / 3] };
  const nEv = { A: 0, B: 0 };
  function predict(p) { const u = (1 - STAY) / 3; return p.map(x => STAY * x + u * 1); }  // 전이: 유지 STAY, 아니면 균등
  function onMove(sBefore, actor, move, alloc) {
    const o = actor.o;
    let p = predict(post[o]);
    const cap = move.kind === 'push' ? sBefore.board[E.EDGES[move.edge][1]] : [];
    // 마지막 카드 국면(손패 ≤1)의 배분은 모든 정책이 달라질 수 있으므로 증거로 쓰지 않는다
    if (cap.length && sBefore.hands[o].length > 1) {
      const t = sBefore;
      const pred = { "A'": cap.map(() => 'M'), B5: S.allocB5(t, o, cap), C1: cap.map(() => 'L') };
      const like = LABELS.map(l => (pred[l].join('') === alloc.join('') ? 1 - EPS : EPS));
      p = p.map((x, i) => x * like[i]);
      const z = p.reduce((a, b) => a + b, 0); p = p.map(x => x / z);
      nEv[o]++;
    }
    post[o] = p;
  }
  return { onMove, posterior: o => post[o].slice(), evidence: o => nEv[o], LABELS };
}

// ---- 롤아웃 평가 ----
function evalCandidates(s, me, rand, K, oppDist, hooksLabel) {
  const op = other(me);
  const scores = {};
  for (const l of LABELS) scores[l] = 0;
  for (let k = 0; k < K; k++) {
    const w = S.sampleWorld(s, me, rand);
    const r = rand(); let acc = 0, q = LABELS[LABELS.length - 1];
    for (let i = 0; i < LABELS.length; i++) { acc += oppDist[i]; if (r < acc) { q = LABELS[i]; break; } }
    const seedK = Math.floor(rand() * 1e9);
    for (const l of LABELS) {
      const w2 = E.clone(w);
      const pols = { [me]: S.MAKERS[l](), [op]: S.MAKERS[q]() };
      const res = S.playOut(w2, pols, E.mulberry32(seedK));
      scores[l] += S.resVal(res, me);
    }
  }
  return scores;
}

function makeMix(opts = {}) {
  const K = opts.K ?? 8;
  const prior = opts.prior || { first: [1 / 3, 1 / 3, 1 / 3], second: [1 / 3, 1 / 3, 1 / 3] };  // 상대 좌석 기준
  const observer = opts.observe ? makeObserver(opts) : null;
  const subs = { "A'": S.MAKERS["A'"](), B5: S.MAKERS.B5(), C1: S.MAKERS.D() };   // 실전 C1 자리는 D
  let cur = 'C1';
  const trace = [];
  function oppDist(s, me) {
    const op = other(me);
    const seat = s.setup.first === op ? 'first' : 'second';
    let d = prior[seat].slice();
    if (observer) {
      const po = observer.posterior(op);
      const lam = opts.lam ?? 1.0;
      d = d.map((x, i) => (1 - lam) * x + lam * po[i]);
      const fl = 0.03; d = d.map(x => Math.max(x, fl)); const z = d.reduce((a, b) => a + b, 0); d = d.map(x => x / z);
    }
    return d;
  }
  function choosePlayer(s, me, rand) {
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && P.winsNow(s, me)) return { end: true };
    const endgame = s.hands[me].length <= (s.setup.first === me ? 2 : 1);
    if (!endgame) {
      const sc = evalCandidates(s, me, rand, K, oppDist(s, me));
      let best = cur;
      for (const l of LABELS) if (sc[l] > sc[best] + 1e-9) best = l;
      cur = best;
    } else cur = 'C1';   // 막판은 정확 계산(D)
    trace.push({ turn: s.turn, owner: me, label: cur, endgame: endgame ? 1 : 0, post: observer ? observer.posterior(other(me)) : null });
    return subs[cur].choosePlayer(s, me, rand);
  }
  function chooseCompanion(s, o, moves, rand) { return subs[cur].chooseCompanion(s, o, moves, rand); }
  function onMove(sB, a, m, al) { if (observer) observer.onMove(sB, a, m, al); }
  return { name: opts.observe ? 'M2' : 'M1', choosePlayer, chooseCompanion, onMove, trace, current: () => cur, oppDist: (s, me) => oppDist(s, me) };
}

// ---- 블러핑: 초반 C1 신호(전부 레벨) → 조건 충족 시 B5로 전환, 막판 D ----
function makeBluff(opts = {}) {
  const M = opts.m ?? 3, Kt = opts.k ?? 5;
  const subs = { C1: S.MAKERS.D(), B5: S.MAKERS.B5() };
  let switched = false;
  const trace = [];
  function mode(s, me) {
    const op = other(me);
    if (!switched && (s.market[op].length >= M || s.played[me].length >= Kt)) switched = true;
    return switched ? 'B5' : 'C1';
  }
  function choosePlayer(s, me, rand) {
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && P.winsNow(s, me)) return { end: true };
    const endgame = s.hands[me].length <= (s.setup.first === me ? 2 : 1);
    const l = endgame ? 'C1' : mode(s, me);
    trace.push({ turn: s.turn, owner: me, label: l, endgame: endgame ? 1 : 0 });
    return subs[l].choosePlayer(s, me, rand);
  }
  function chooseCompanion(s, o, moves, rand) { return subs[switched ? 'B5' : 'C1'].chooseCompanion(s, o, moves, rand); }
  return { name: 'BL', choosePlayer, chooseCompanion, trace };
}
module.exports = { makeObserver, makeMix, makeBluff, LABELS };

};
__d["prior.js"] = function(module, exports, require){
module.exports = {
 "labels": [
  "A'",
  "B5",
  "C1"
 ],
 "first": [
  0.045454545454545456,
  0.045454545454545456,
  0.9090909090909091
 ],
 "second": [
  0.9090909090909091,
  0.045454545454545456,
  0.045454545454545456
 ],
 "value": 0.55,
 "source": "5x5 mechanical 4x4 submatrix, D merged into C1"
};

};
__d["strong.js"] = function(module, exports, require){
// 강한 AI "S". 노드/브라우저 공용(번들러가 require 경로를 파일명으로 재해석).
// 구성: 이론 최강 전략(M2 = 좌석별 사전분포 + 손패 샘플링 + 배분 관찰자로 상대 전략 추정, 선공 막판은 D의 정확 계산)
//       + W개 가능세계 롤아웃(N0 연속)으로 후보 수 전체를 평가. 이론 수가 후보 중 중앙값 이하로 평가되면 기각하고 롤아웃 최선수.
// 상대 손패는 절대 보지 않는다: 호출자가 publicView로 가린 상태를 넘겨도 동작하도록 설계.
const E = require('/home/pjins7360/cardgame/engine.js');
const AI = require('/home/pjins7360/cardgame/ai.js');
const P = require('/home/pjins7360/duel/dom/pol.js');
const SIM = require('/home/pjins7360/duel/dom/sim.js');
const MX = require('/home/pjins7360/duel/dom/mix.js');
const PRIOR = require('/home/pjins7360/cardgame/prior.js');
const other = E.other;
const cid = c => c.r + c.s;

// ---- 공개 시점(viewer가 볼 수 있는 것만 남긴 상태) ----
const DUMMY = () => ({ r: '?', s: '?' });
function publicView(st, viewer) {
  const t = E.clone(st); const op = other(viewer);
  t.hands[op] = st.hands[op].map(DUMMY);
  for (const o of ['A', 'B']) if (t.comp[o].deck.length) t.comp[o].deck = [st.comp[o].deck[0], ...st.comp[o].deck.slice(1).map(DUMMY)];
  t.log = [];
  return t;
}
// JSON 왕복 후 상태 복원(카드 객체는 평범한 {r,s}; 판/손패 안에서 한 번씩만 등장하므로 동일성은 유지됨)
const fromJSON = o => (typeof o === 'string' ? JSON.parse(o) : o);

// ---- 기초 정책(롤아웃 연속용) ----
function makeN(samples) {
  return {
    choosePlayer: (s, me, rand) => AI.choosePlayer(s, me, { samples, rand }),
    chooseCompanion: (s, o, moves) => {
      const m = moves.length === 1 ? moves[0] : AI.chooseCompanion(s, o, moves);
      const t = E.clone(s); t.comp[o].deck.shift(); const cap = E.applyMove(t, m);
      return { move: m, alloc: AI.greedyAlloc(t, o, cap) };
    },
  };
}
const moveKey = c => (c.end ? 'END' : `${cid(c.move.card)}|${c.move.kind}|${c.move.kind === 'push' ? c.move.edge : c.move.cell}|${(c.alloc || []).join('')}`);
// 후보 = 합법수 × 배분{탐욕, 전부 레벨, 전부 시장} (+ 종료 선언 가능 시 선언)
function candidates(s, me) {
  const info = E.playerTurnInfo(s, me);
  const out = [];
  if (info.canDeclareEnd) out.push({ end: true });
  for (const m of info.moves) {
    const t = E.clone(s); t.hands[me] = t.hands[me].filter(c => c !== m.card);
    const cap = E.applyMove(t, m);
    if (!cap.length) { out.push({ move: m, alloc: [] }); continue; }
    const seen = new Set();
    for (const al of [AI.greedyAlloc(t, me, cap), cap.map(() => 'L'), cap.map(() => 'M')]) {
      const k = al.join(''); if (seen.has(k)) continue; seen.add(k); out.push({ move: m, alloc: al });
    }
  }
  return out;
}
const val = (r, me) => (r.winner === me ? 1 : r.winner === null ? 0.5 : 0);
// 후보 c를 세계 w에 적용 후 끝까지(N0 양쪽). 결과 me 관점 1/0.5/0
const LABELS = ["A'", 'B5', 'C1'];
function contPols(me, cont, r) {
  if (!cont) return { A: makeN(0), B: makeN(0) };
  const op = other(me);
  let q = 'C1', acc = 0; for (let i = 0; i < LABELS.length; i++) { acc += cont.oppDist[i]; if (r < acc) { q = LABELS[i]; break; } }
  const mk = l => SIM.MAKERS[l]();   // 롤아웃 안에서는 D(3.6s/판) 대신 C1(16ms/판)
  return { [me]: mk(cont.myLabel || 'C1'), [op]: mk(q) };
}
function rollout(w, me, c, seed, cont, r) {
  const t = E.clone(w);
  if (c.end) return val(E.finalResult(t, 'declared', me), me);
  const card = t.hands[me].find(x => cid(x) === cid(c.move.card));
  E.doPlayerMove(t, me, { ...c.move, card }, c.alloc);
  const res = SIM.playOut(t, contPols(me, cont, r), E.mulberry32(seed));
  return val(res, me);
}
// 공통 난수: 세계·시드를 모든 후보에 공유. deadline(ms, 절대시각)을 넘기면 세계 수를 줄여서라도 끝낸다(최소 4개).
function qValues(s, me, rand, W, opts = {}) {
  const cands = opts.cands || candidates(s, me);
  const q = cands.map(() => []);
  const t0 = Date.now();
  let k = 0;
  for (; k < W; k++) {
    if (opts.deadline && k >= 4 && Date.now() > opts.deadline) break;
    const w = SIM.sampleWorld(s, me, rand); const seed = Math.floor(rand() * 1e9); const r = rand();
    cands.forEach((c, i) => q[i].push(rollout(w, me, c, seed, opts.cont, r)));
  }
  const mean = q.map(r => r.reduce((a, b) => a + b, 0) / r.length);
  return { cands, q, mean, worlds: k, ms: Date.now() - t0 };
}

// ---- S ----
function makeS(opts = {}) {
  const W = opts.W ?? 16, RULE = opts.rule || 'margin', MARGIN = opts.margin ?? 0.03, TIME = opts.time ?? 20000;
  const theory = MX.makeMix({ prior: PRIOR, observe: 1, K: opts.K ?? 8 });
  const last = { info: null };
  function choosePlayer(s, me, rand) {
    const t0 = Date.now();
    const info = E.playerTurnInfo(s, me);
    if (info.canDeclareEnd && P.winsNow(s, me)) { last.info = { label: 'end', text: '지금 끝내면 이김 → 종료 선언' }; return { end: true }; }
    const dt = theory.choosePlayer(s, me, rand);
    const label = theory.current();
    const endgame = s.hands[me].length <= (s.setup.first === me ? 2 : 1);
    const tc = dt.end ? { end: true } : { move: dt.move, alloc: dt.alloc };
    const tk = moveKey(tc);
    if (RULE === 'theory' || (endgame && RULE !== 'pure')) {   // 막판: D의 정확(최악의 경우) 계획을 그대로 신뢰
      last.info = { label, theoryKey: tk, chosenKey: tk, overridden: 0, endgame: 1, ms: Date.now() - t0 };
      return dt;
    }
    let cands = candidates(s, me);
    let ti = cands.findIndex(c => moveKey(c) === tk);
    if (ti < 0) { cands.push(tc); ti = cands.length - 1; }
    const cont = opts.cont === 0 ? null : { myLabel: label, oppDist: theory.oppDist(s, me) };
    const r = qValues(s, me, rand, W, { cands, deadline: t0 + TIME, cont });
    const keys = cands.map(moveKey);
    const cb = combine(tk, keys, r.q, RULE, MARGIN);
    const pick = keys.indexOf(cb.pick);
    const c = cands[pick];
    last.info = { ...cb, label, theoryKey: tk, chosenKey: cb.pick, ms: Date.now() - t0, endgame: 0 };
    return c.end ? { end: true } : { move: c.move, alloc: c.alloc };
  }
  function chooseCompanion(s, o, moves, rand) { return theory.chooseCompanion(s, o, moves, rand); }
  function onMove(sB, a, m, al) { theory.onMove(sB, a, m, al); }
  return { name: 'S', choosePlayer, chooseCompanion, onMove, lastInfo: () => last.info, theory };
}
module.exports = { makeS, makeN, candidates, qValues, rollout, val, moveKey, publicView, fromJSON, cid, PRIOR };

// ---- 병렬 평가용 분할 API (브라우저 워커 풀 / 노드 worker_threads) ----
// theoryStep: 이론 수와 후보 목록(키)만 계산. evalPart: 주어진 후보 키들을 자기 몫의 세계 W로 평가해 후보별 합을 돌려준다.
function theoryStep(S, s, me, rand) {
  const info = E.playerTurnInfo(s, me);
  if (info.canDeclareEnd && P.winsNow(s, me)) return { end: true, label: 'end' };
  const dt = S.theory.choosePlayer(s, me, rand);
  const label = S.theory.current();
  const endgame = s.hands[me].length <= (s.setup.first === me ? 2 : 1);
  const tc = dt.end ? { end: true } : { move: dt.move, alloc: dt.alloc };
  const cands = candidates(s, me);
  if (!cands.some(c => moveKey(c) === moveKey(tc))) cands.push(tc);
  return { theoryKey: moveKey(tc), label, endgame, cands: cands.map(moveKey), theory: tc, cont: { myLabel: label, oppDist: S.theory.oppDist(s, me) } };
}
function candFromKey(s, me, key) {
  if (key === 'END') return { end: true };
  const [id, kind, where, al] = key.split('|');
  const card = s.hands[me].find(c => cid(c) === id);
  const move = kind === 'push' ? { kind, edge: where, card, gain: s.board[E.EDGES[where][1]].length } : { kind, cell: +where, card };
  return { move, alloc: al ? al.split('') : [] };
}
function evalPart(s, me, keys, W, seed, deadlineMs, cont) {
  const cands = keys.map(k => candFromKey(s, me, k));
  const rand = E.mulberry32(seed);
  const r = qValues(s, me, rand, W, { cands, deadline: deadlineMs ? Date.now() + deadlineMs : 0, cont });
  return { keys, q: r.q, worlds: r.worlds, ms: r.ms };
}
// 결합 규칙. q[i][k] = 후보 i의 세계 k 결과. 'margin'은 교차검증: 짝수 세계로 최선을 고르고 홀수 세계로 이론 수와 비교(최댓값 편향 제거).
function combine(theoryKey, keys, q, rule, margin) {
  const worlds = q[0].length;
  const mean = q.map(row => row.reduce((a, b) => a + b, 0) / worlds);
  const order = mean.map((_, i) => i).sort((a, b) => mean[b] - mean[a]);
  const ti = keys.indexOf(theoryKey), bi = order[0];
  const rank = order.indexOf(ti);
  let pick = ti, why;
  if (rule === 'pure' || ti < 0) { pick = bi; why = '롤아웃 최선'; }
  else if (rule === 'median') { if (rank > (keys.length - 1) / 2) { pick = bi; why = `이론 수 ${rank + 1}위/${keys.length}(중앙값 이하) → 기각`; } else why = `이론 수 ${rank + 1}위/${keys.length} → 유지`; }
  else {
    const sub = (row, par) => { let s_ = 0, n = 0; for (let k = par; k < row.length; k += 2) { s_ += row[k]; n++; } return n ? s_ / n : 0; };
    const bA = q.map((row, i) => [sub(row, 0), i]).sort((x, y) => y[0] - x[0])[0][1];   // 짝수 세계에서 고른 최선
    const tB = sub(q[ti], 1), bB = sub(q[bA], 1);                                          // 홀수 세계에서 비교
    if (tB < bB - margin) { pick = bA; why = `교차검증: 이론 수가 선택된 최선보다 ${((bB - tB) * 100).toFixed(0)}%p 낮아 기각`; }
    else why = `교차검증: 이론 수 유지(선택된 최선과 차이 ${((bB - tB) * 100).toFixed(0)}%p)`;
  }
  return { pick: keys[pick], bestKey: keys[bi], qTheory: ti < 0 ? null : mean[ti], qBest: mean[bi], qChosen: mean[pick], rank: rank + 1, n: keys.length, overridden: pick !== ti ? 1 : 0, why, worlds };
}
module.exports.theoryStep = theoryStep; module.exports.candFromKey = candFromKey; module.exports.evalPart = evalPart; module.exports.combine = combine;

};
__d["record.js"] = function(module, exports, require){
// 대국 기록·재생. 노드/브라우저 공용.
// 기록 = { v, names, init(시작 상태 전체), actions[], result }. 행동은 카드 id(랭크+문양)로만 참조한다.
const E = require('/home/pjins7360/cardgame/engine.js');
const cid = c => c.r + c.s;

function snapshot(st) { return JSON.parse(JSON.stringify({ ...st, log: [] })); }
function newRecord(st, names, meta) {
  return { v: 1, t: Date.now(), names: names || { A: 'A', B: 'B' }, meta: meta || {}, init: snapshot(st), actions: [], result: null };
}
// 행동 추가. move는 엔진의 수 객체(card 포함). alloc은 'M'/'L' 배열. 동반자 패스는 move 없이 t:'X'. 종료는 t:'E'.
function pushAction(rec, a) {
  const o = { t: a.t, o: a.o };
  if (a.t === 'P' || a.t === 'C') {
    o.card = cid(a.move.card); o.kind = a.move.kind;
    if (a.move.kind === 'push') o.edge = a.move.edge; else o.cell = a.move.cell;
    o.alloc = (a.alloc || []).slice(); o.cap = (a.cap || []).map(cid);
    if (a.wild) o.wild = 1;
    if (a.info) o.info = a.info;   // AI의 생각 요약(공개 가능)
  }
  if (a.t === 'E') o.reason = a.reason;
  rec.actions.push(o);
  return o;
}
function finishRecord(rec, over) { rec.result = JSON.parse(JSON.stringify(over)); }

// 기록으로부터 상태 복원. 행동 i(0부터) 적용 직전의 상태를 돌려주는 states[i]와 마지막 상태 states[n].
function moveOf(st, a, owner, isComp) {
  const card = isComp ? st.comp[owner].deck[0] : st.hands[owner].find(c => cid(c) === a.card);
  if (!card) throw new Error('card not found ' + a.card);
  const m = a.kind === 'push' ? { kind: 'push', edge: a.edge, card, gain: st.board[E.EDGES[a.edge][1]].length } : { kind: 'cover', cell: a.cell, card };
  return m;
}
function applyAction(st, a) {
  if (a.t === 'P') E.doPlayerMove(st, a.o, moveOf(st, a, a.o, false), a.alloc);
  else if (a.t === 'C') E.doCompanionMove(st, a.o, moveOf(st, a, a.o, true), a.alloc);
  else if (a.t === 'X') E.doCompanionPass(st, a.o);
  else if (a.t === 'E') st.over = E.finalResult(st, a.reason, a.o);
}
function replay(rec, upTo) {
  const n = upTo == null ? rec.actions.length : upTo;
  let st = E.clone(JSON.parse(JSON.stringify(rec.init)));
  const states = [];
  for (let i = 0; i < n; i++) { states.push(st); st = E.clone(st); applyAction(st, rec.actions[i]); }
  states.push(st);
  return states;
}
// 플레이어 결정 행동의 인덱스 목록(P 또는 E)
const decisionIdx = rec => rec.actions.map((a, i) => (a.t === 'P' || a.t === 'E' ? i : -1)).filter(i => i >= 0);

const CELL_NAME = ['1', '2', '3', '4'];
function moveText(a) {
  if (a.t === 'E') return '종료 선언';
  if (a.t === 'X') return '동반자 합법수 없음';
  const c = a.card.slice(-1) + a.card.slice(0, -1);
  if (a.kind === 'cover') return `${c} → ${CELL_NAME[a.cell]}번 덮기`;
  const [x] = E.EDGES[a.edge];
  const side = { T: '위', B: '아래', L: '왼쪽', R: '오른쪽' }[a.edge[0]];
  return `${c} → ${CELL_NAME[x]}번 ${side}에서 밀기` + (a.cap && a.cap.length ? ` (획득 ${a.cap.length}: ${a.alloc.map((x, i) => a.cap[i] + (x === 'L' ? '→레벨' : '→시장')).join(' ')})` : '');
}
module.exports = { snapshot, newRecord, pushAction, finishRecord, replay, applyAction, decisionIdx, moveText, cid };

};
__d["analysis.js"] = function(module, exports, require){
// 분석 엔진: 결정 시점마다 후보 수 전체를 가능세계 롤아웃(공통 난수)으로 평가하고, 각 롤아웃의 "궤적"(상태 축 벡터의 시간열 + 사건)을 기록한다.
// 노드/브라우저 공용. 상태 축은 사람이 세는 개념(시장 개수 부호, 현재 판 기준 우열, 짝, 레벨 우위, 종료권, 동반자, 저항성)으로 이산화.
const E = require('/home/pjins7360/cardgame/engine.js');
const ST = require('/home/pjins7360/cardgame/strong.js');
const R = require('/home/pjins7360/cardgame/record.js');
const SIM = require('/home/pjins7360/duel/dom/sim.js');
const other = E.other, cid = c => c.r + c.s, sgn = x => (x > 0 ? 1 : x < 0 ? -1 : 0);

// ---- 상태 축 벡터 (me 관점). 전부 정수. ----
function axes(s, me) {
  const op = other(me);
  const lv = (p, x) => s.level[p].filter(c => c.s === x).length;
  const r = E.finalResult(s, 'now', null);
  const { suits, ranks } = E.scoringConditions(s);
  const pushInfo = p => { const ms = E.playerMoves(s, p); return { n: ms.filter(m => m.kind === 'push').length, any: ms.length }; };
  const mp = pushInfo(me), opp = pushInfo(op);
  const compPush = p => { if (!s.comp[p].deck.length) return 0; const { moves, wild } = E.companionMoves(s, p); if (wild) return -1; let g = 0; for (const m of moves) if (m.kind === 'push') g = Math.max(g, m.gain); return g; };
  let resist = 99;
  for (const [a, b] of Object.values(E.EDGES)) resist = Math.min(resist, Math.max(E.rv(E.top(s, a)), E.rv(E.top(s, b))));
  return {
    sc: E.score(s, me) - E.score(s, op),              // 현재 판 기준 점수차
    res: r.winner === me ? 1 : r.winner === op ? -1 : 0, // 지금 끝나면: 승 1 / 무 0 / 패 -1 (동점은 시장 개수로)
    mk: sgn(s.market[op].length - s.market[me].length), // +1 = 내 시장이 더 적음(동점 시 내가 이김)
    mkn: s.market[me].length, mko: s.market[op].length,
    pairs: suits.length + ranks.length, pS: suits.join(''), pR: ranks.join(''),
    dom: E.SUITS.map(x => sgn(lv(me, x) - lv(op, x))),   // 문양별 +1 우위 / -1 열위
    myEnd: mp.any && mp.n === 0 ? 1 : 0, opEnd: opp.any && opp.n === 0 ? 1 : 0,   // 종료권(밀기 없음 → 선언 가능)
    myPush: mp.n, opPush: opp.n,
    mcPush: compPush(me), ocPush: compPush(op),          // 동반자가 지금 밀 수 있는 최대 획득(-1 = 와일드)
    mcTame: s.comp[me].tamed ? 1 : 0, ocTame: s.comp[op].tamed ? 1 : 0,
    resist,                                               // 어느 줄이든 밀려면 필요한 최소 랭크(저항성)
    hand: s.hands[me].length, ohand: s.hands[op].length,
    lvn: s.level[me].length, lvo: s.level[op].length,
    // 시장 문양 우열: 내가 앞서는 문양 수 − 뒤지는 문양 수 ;  시장 숫자패 협박: 내가 시장에 가진 랭크 종류 − 상대 것
    msuit: E.SUITS.reduce((a, x) => a + sgn(s.market[me].filter(c => c.s === x).length - s.market[op].filter(c => c.s === x).length), 0),
    rthreat: new Set(s.market[me].map(c => c.r)).size - new Set(s.market[op].map(c => c.r)).size,
  };
}
// 두 축 벡터의 차이를 사건 태그로
function diffTags(a, b) {
  const t = [];
  if (a.res !== b.res) t.push({ t: 'RES', from: a.res, to: b.res });
  if (a.sc !== b.sc) t.push({ t: 'SC', d: b.sc - a.sc });
  if (a.mk !== b.mk) t.push({ t: 'MK', from: a.mk, to: b.mk });
  if (a.pS !== b.pS || a.pR !== b.pR) t.push({ t: 'PAIR', from: a.pS + '/' + a.pR, to: b.pS + '/' + b.pR, d: b.pairs - a.pairs });
  a.dom.forEach((v, i) => { if (v !== b.dom[i]) t.push({ t: 'DOM', suit: E.SUITS[i], from: v, to: b.dom[i] }); });
  if (a.myEnd !== b.myEnd) t.push({ t: 'ENDR', who: 'me', to: b.myEnd });
  if (a.opEnd !== b.opEnd) t.push({ t: 'ENDR', who: 'op', to: b.opEnd });
  if (a.mcTame !== b.mcTame) t.push({ t: b.mcTame ? 'TAME' : 'UNTAME', who: 'me' });
  if (a.ocTame !== b.ocTame) t.push({ t: b.ocTame ? 'TAME' : 'UNTAME', who: 'op' });
  if (a.resist !== b.resist) t.push({ t: 'RESIST', from: a.resist, to: b.resist });
  if (a.msuit !== b.msuit) t.push({ t: 'MSUIT', from: a.msuit, to: b.msuit });
  if (a.rthreat !== b.rthreat) t.push({ t: 'RTHREAT', from: a.rthreat, to: b.rthreat });
  return t;
}
// 종료 상태 분류 (me 관점)
function terminal(s, over, me) {
  const op = other(me);
  const d = over.score[me] - over.score[op];
  const res = over.winner === me ? 'W' : over.winner === op ? 'L' : 'D';
  let how = 'DRAW';
  if (d !== 0) {
    const { suits, ranks } = E.scoringConditions(s);
    const cnt = (p, f) => s.market[p].filter(f).length;
    let ds = 0, dr = 0;
    for (const x of suits) ds += cnt(me, c => c.s === x) - cnt(op, c => c.s === x);
    for (const x of ranks) dr += 3 * (cnt(me, c => c.r === x) - cnt(op, c => c.r === x));
    how = Math.abs(ds) >= Math.abs(dr) ? 'SUIT' : 'RANK';
  } else if (over.marketSize[me] !== over.marketSize[op]) how = 'TIE_MK';
  const ender = (over.by === me ? 'me' : 'op') + '_' + over.reason;   // me_declared / op_noMove ...
  return { res, how, ender, sc: d, mk: over.marketSize[op] - over.marketSize[me] };
}

// ---- 궤적 기록 롤아웃 ----
// 반환: { val, end, plies:[{who, kind, card, gain, nM, nL, tags, ax}] } ; plies[0] = 후보 수 자체
function rolloutTrace(w, me, c, seed, maxPly) {
  const op = other(me);
  const s = E.clone(w);
  const plies = [];
  const ax0 = axes(s, me);
  let prev = ax0;
  const who = a => (a.t === 'P' ? (a.o === me ? 'me' : 'op') : (a.o === me ? 'mc' : 'oc'));
  const rec = (w_, kind, card, gain, alloc) => {
    const ax = axes(s, me);
    plies.push({ who: w_, kind, card: card ? cid(card) : null, gain: gain || 0, nM: alloc ? alloc.filter(x => x === 'M').length : 0, nL: alloc ? alloc.filter(x => x === 'L').length : 0, tags: diffTags(prev, ax), ax });
    prev = ax;
  };
  if (c.end) { s.over = E.finalResult(s, 'declared', me); rec('me', 'end', null, 0, null); }
  else {
    const card = s.hands[me].find(x => cid(x) === cid(c.move.card));
    const cap = E.doPlayerMove(s, me, { ...c.move, card }, c.alloc);
    rec('me', c.move.kind, card, cap.length, c.alloc);
  }
  const pols = { A: ST.makeN(0), B: ST.makeN(0) };
  const rand = E.mulberry32(seed);
  for (let g = 0; g < (maxPly || 400) && !s.over; g++) {
    const a = E.actor(s);
    if (a.t === 'P') {
      const info = E.playerTurnInfo(s, a.o);
      if (info.mustEnd) { s.over = E.finalResult(s, 'noMove', a.o); rec(who(a), 'noMove', null, 0, null); break; }
      const d = pols[a.o].choosePlayer(s, a.o, rand);
      if (d.end) { s.over = E.finalResult(s, 'declared', a.o); rec(who(a), 'end', null, 0, null); break; }
      const cap = E.doPlayerMove(s, a.o, d.move, d.alloc);
      rec(who(a), d.move.kind, d.move.card, cap.length, d.alloc);
    } else {
      const { moves } = E.companionMoves(s, a.o);
      if (!moves.length) { E.doCompanionPass(s, a.o); rec(who(a), 'pass', null, 0, null); continue; }
      const d = pols[a.o].chooseCompanion(s, a.o, moves, rand);
      const card = d.move.card;
      const cap = E.doCompanionMove(s, a.o, d.move, d.alloc);
      rec(who(a), d.move.kind, card, cap.length, d.alloc);
    }
  }
  if (!s.over) s.over = E.finalResult(s, 'timeout', null);
  return { val: ST.val(s.over, me), end: terminal(s, s.over, me), plies, ax0 };
}

const CELL_NAME = ['1', '2', '3', '4'];
const cstr = c => c.s + c.r;
function candText(c) {
  if (c.end) return '종료 선언';
  const m = c.move;
  if (m.kind === 'cover') return `${cstr(m.card)} ${CELL_NAME[m.cell]}번 덮기`;
  const [x] = E.EDGES[m.edge];
  const side = { T: '위', B: '아래', L: '왼쪽', R: '오른쪽' }[m.edge[0]];
  const al = c.alloc.length ? `(획득 ${c.alloc.length}: ${c.alloc.map(x => (x === 'L' ? '레벨' : '시장')).join('·')})` : '';
  return `${cstr(m.card)} ${CELL_NAME[x]}번 ${side}에서 밀기${al}`;
}

// ---- 한 결정 분석 ----
// rec: 기록, i: 행동 인덱스(플레이어 결정), opts: {W, seed, maxCands}
function analyzeDecision(rec, i, opts = {}) {
  const W = opts.W ?? 32;
  const states = R.replay(rec, i);
  const s = states[i], a = rec.actions[i], me = a.o;
  const rand = E.mulberry32((opts.seed ?? 12345) + i * 7919);
  let cands = ST.candidates(s, me);
  // 실제 둔 수를 후보 목록에서 찾기(배분까지 일치). 없으면 추가.
  const actualKey = a.t === 'E' ? 'END' : `${a.card}|${a.kind}|${a.kind === 'push' ? a.edge : a.cell}|${(a.alloc || []).join('')}`;
  let ci = cands.findIndex(c => ST.moveKey(c) === actualKey);
  if (ci < 0) {
    if (a.t === 'E') cands.push({ end: true });
    else { const card = s.hands[me].find(c => cid(c) === a.card); const m = a.kind === 'push' ? { kind: 'push', edge: a.edge, card, gain: s.board[E.EDGES[a.edge][1]].length } : { kind: 'cover', cell: a.cell, card }; cands.push({ move: m, alloc: a.alloc || [] }); }
    ci = cands.length - 1;
  }
  const traces = cands.map(() => []);
  const t0 = Date.now();
  for (let k = 0; k < W; k++) {
    const w = SIM.sampleWorld(s, me, rand); const seed = Math.floor(rand() * 1e9);
    cands.forEach((c, j) => traces[j].push(rolloutTrace(w, me, c, seed)));
  }
  const mean = traces.map(tr => tr.reduce((x, t) => x + t.val, 0) / W);
  const se = traces.map((tr, j) => Math.sqrt(tr.reduce((x, t) => x + (t.val - mean[j]) ** 2, 0) / (W - 1) / W));
  const order = mean.map((_, j) => j).sort((x, y) => mean[y] - mean[x]);
  const bi = order[0], mi = order[Math.floor((order.length - 1) / 2)];
  // 짝지은 차이(최선 - 실제)의 표준오차
  const pd = traces[bi].map((t, k) => t.val - traces[ci][k].val);
  const loss = pd.reduce((x, y) => x + y, 0) / W;
  const seLoss = Math.sqrt(pd.reduce((x, y) => x + (y - loss) ** 2, 0) / (W - 1) / W);
  const rank = order.indexOf(ci);
  let cls;
  if (ci === bi || loss <= Math.max(0.02, seLoss)) cls = 'best';
  else if (mean[ci] <= 0.12 && mean[bi] >= 0.5) cls = 'giveaway';
  else if (loss <= 0.06) cls = 'good';
  else if (loss <= 0.12) cls = 'inaccuracy';
  else if (loss <= 0.22) cls = 'mistake';
  else cls = 'blunder';
  const out = {
    i, me, ply: i, hand: s.hands[me].length, first: s.setup.first === me ? 1 : 0, W, ms: Date.now() - t0,
    cands: cands.map((c, j) => ({ key: ST.moveKey(c), text: candText(c), q: mean[j], se: se[j], rank: order.indexOf(j) + 1 })),
    chosen: ci, best: bi, median: mi, loss, seLoss, rank: rank + 1, cls,
  };
  if (opts.withTraces) { out.traces = traces; out.state = s; out.candObjs = cands; }
  return out;
}
module.exports = { axes, diffTags, terminal, rolloutTrace, analyzeDecision, candText, cstr };

};
__d["commentary.js"] = function(module, exports, require){
// 해설 알고리즘 (LLM 없음). 관계 지향: 같은 가능세계·같은 난수에서 두 후보 수가 만든 두 궤적을 짝지어 비교한다.
//  1) 값의 분해: Q(좋은 수) − Q(나쁜 수) = Σ(역전된 세계) 종료 유형별 기여  — 회계 항등식
//  2) 갈림길: 역전된 세계마다, 두 궤적의 상태 축이 처음 갈라진 뒤 끝까지 되돌아오지 않은 (시점, 축) = 근본 원인; 그 시점의 사건 = 방아쇠
//  3) 비가역성: 그 축이 한 번 바뀐 뒤 끝까지 복구되지 않은 세계 비율
//  4) 실제 대국과의 연결
const E = require('/home/pjins7360/cardgame/engine.js');
const A = require('/home/pjins7360/cardgame/analysis.js');
const R = require('/home/pjins7360/cardgame/record.js');
const other = E.other;
const pct = x => Math.round(x * 100) + '%';
const pp = x => (x >= 0 ? '+' : '') + Math.round(x * 100) + '%p';
const cardKo = id => (id ? id.slice(-1) + id.slice(0, -1) : '');
const CLS_KO = { best: '최선', good: '좋은 수', inaccuracy: '부정확', mistake: '실수', blunder: '블런더', giveaway: '헌납' };
const AXIS_KO = { res: '지금 끝나면 승·무·패', mk: '시장 개수(동점 승부)', pairs: '판의 짝', dom: '레벨 우위(밀기 조건)', myEnd: '{me}의 종료권', opEnd: '{op}의 종료권',
  mcTame: '{me} 동반자 길들임', ocTame: '{op} 동반자 길들임', resist: '판의 저항성(밀기에 필요한 랭크)', sc: '현재 판 기준 점수차', mcPush: '{me} 동반자의 밀기', ocPush: '{op} 동반자의 밀기',
  msuit: '시장 문양 우열(앞서는 문양 수 − 뒤지는 문양 수)', rthreat: '시장 숫자패 협박(보유 랭크 종류 차)' };
const AX_ORDER = ['res', 'mk', 'pairs', 'dom', 'msuit', 'rthreat', 'opEnd', 'myEnd', 'ocTame', 'mcTame', 'ocPush', 'mcPush', 'resist', 'sc'];
const resKo = v => (v === 1 ? '승' : v === -1 ? '패' : '무');
const mkKo = v => (v === 1 ? '{me}가 적음(동점 시 유리)' : v === -1 ? '{me}가 많음(동점 시 불리)' : '같음');
const KIND_KO = { cover: '덮기', push: '밀기', pass: '패스(길들여짐)', end: '종료 선언', noMove: '합법수 소진' };
const HOW_KO = { 'L:TIE_MK': '동점에서 시장이 많아 패', 'L:SUIT': '문양 짝 점수에서 패', 'L:RANK': '숫자 짝(×3) 점수에서 패', 'D:DRAW': '무승부',
  'W:TIE_MK': '동점에서 시장이 적어 승', 'W:SUIT': '문양 짝 점수로 승', 'W:RANK': '숫자 짝(×3) 점수로 승' };
const ENDER_KO = { me_declared: '{me}의 종료 선언', op_declared: '{op}의 종료 선언', me_noMove: '{me}의 합법수 소진', op_noMove: '{op}의 합법수 소진', 'null_timeout': '시간 초과' };

function axVal(ax, f) { return f === 'dom' ? ax.dom.join(',') : f === 'pairs' ? ax.pS + '/' + ax.pR : ax[f]; }
function axText(f, v) {
  if (f === 'res') return resKo(v);
  if (f === 'mk') return mkKo(v);
  if (f === 'dom') return String(v).split(',').map((x, i) => (x === '1' ? E.SUITS[i] + '우위' : x === '-1' ? E.SUITS[i] + '열위' : '')).filter(Boolean).join(' ') || '모든 문양 동률';
  if (f === 'pairs') { const [s, r] = v.split('/'); return (s.split('').map(x => x + '짝').join(' ') + ' ' + r.split('').map(x => x + '짝').join(' ')).trim() || '짝 없음'; }
  if (f === 'myEnd' || f === 'opEnd') return v ? '있음' : '없음';
  if (f === 'mcTame' || f === 'ocTame') return v ? '길들여짐' : '활동';
  return String(v);
}
function tagKo(t, nm) {
  const sub = s => s.replace('{me}', nm.me).replace('{op}', nm.op);
  if (t.t === 'RES') return `${sub(AXIS_KO.res)} ${resKo(t.from)}→${resKo(t.to)}`;
  if (t.t === 'SC') return `${sub(AXIS_KO.sc)} ${t.d > 0 ? '+' : ''}${t.d}`;
  if (t.t === 'MK') return `${sub(AXIS_KO.mk)}: ${sub(mkKo(t.to))}`;
  if (t.t === 'PAIR') return `${AXIS_KO.pairs} ${axText('pairs', t.from)} → ${axText('pairs', t.to)}`;
  if (t.t === 'DOM') return `${t.suit} 레벨 ${t.to === 1 ? sub('{me} 우위') : t.to === -1 ? sub('{op} 우위') : '동률'}`;
  if (t.t === 'ENDR') return `${sub(t.who === 'me' ? '{me}' : '{op}')}의 종료권 ${t.to ? '생김' : '사라짐'}`;
  if (t.t === 'TAME') return `${sub(t.who === 'me' ? '{me}' : '{op}')} 동반자 길들여짐`;
  if (t.t === 'UNTAME') return `${sub(t.who === 'me' ? '{me}' : '{op}')} 동반자 활동 재개(와일드 가능)`;
  if (t.t === 'RESIST') return `${AXIS_KO.resist} ${t.from}→${t.to}`;
  if (t.t === 'MSUIT') return `${AXIS_KO.msuit} ${t.from}→${t.to}`;
  if (t.t === 'RTHREAT') return `${AXIS_KO.rthreat} ${t.from}→${t.to}`;
  return t.t;
}
const whoKo = (w, nm) => ({ me: nm.me, op: nm.op, mc: nm.me + ' 동반자', oc: nm.op + ' 동반자' }[w]);
function plyKo(p, nm) {
  let s = `${whoKo(p.who, nm)}가 ${p.card ? cardKo(p.card) + '로 ' : ''}${KIND_KO[p.kind] || p.kind}`;
  if (p.gain) s += `(${p.gain}장 획득` + (p.nL ? `, 레벨 ${p.nL}` : '') + (p.nM ? `, 시장 ${p.nM}` : '') + ')';
  return s;
}
const mode = arr => { const c = {}; let b = null; for (const x of arr) { const k = JSON.stringify(x); c[k] = (c[k] || 0) + 1; if (b === null || c[k] > c[b]) b = k; } return b === null ? null : { v: JSON.parse(b), n: c[b] }; };

// 두 궤적(good, bad)에서 근본 원인 = 가장 이른 "지속 분기": 축 f가 j시점부터 두 궤적이 함께 진행되는 동안 내내 다르고 끝에서도 다른 것.
// 방아쇠 = bad 궤적에서 상대 차례(j≥2) 이후 처음 생긴, 끝까지 지속되는 사건.
function persistent(g, b, f, j) {
  const n = Math.min(g.plies.length, b.plies.length);
  for (let k = j; k < n; k++) if (axVal(g.plies[k].ax, f) === axVal(b.plies[k].ax, f)) return false;
  return axVal(g.plies[g.plies.length - 1].ax, f) !== axVal(b.plies[b.plies.length - 1].ax, f);
}
function divergence(g, b) {
  const n = Math.min(g.plies.length, b.plies.length);
  let root = null;
  for (let j = 0; j < n && !root; j++) {
    for (const f of AX_ORDER) {
      const gv = axVal(g.plies[j].ax, f), bv = axVal(b.plies[j].ax, f);
      if (gv !== bv && persistent(g, b, f, j)) { root = { j, f, who: b.plies[j].who, kind: b.plies[j].kind, card: b.plies[j].card, bv, gv }; break; }
    }
  }
  let trig = null;
  for (let j = 2; j < b.plies.length && !trig; j++) {
    const p = b.plies[j];
    for (const t of p.tags) {
      const f = { RES: 'res', MK: 'mk', PAIR: 'pairs', DOM: 'dom', ENDR: null, TAME: null, UNTAME: null, RESIST: 'resist', SC: 'sc', MSUIT: 'msuit', RTHREAT: 'rthreat' }[t.t];
      const ff = f || (t.t === 'ENDR' ? (t.who === 'me' ? 'myEnd' : 'opEnd') : t.who === 'me' ? 'mcTame' : 'ocTame');
      if (j < g.plies.length && persistent(g, b, ff, j)) { trig = { j, who: p.who, kind: p.kind, card: p.card, gain: p.gain, nL: p.nL, nM: p.nM, tag: t, f: ff }; break; }
    }
  }
  return { root, trig };
}
// 비가역성: bad 궤적들에서 축 f가 j시점에 수 이전 값과 달라진 뒤 끝까지 복구되지 않은 비율
function irreversibility(traces, f, j) {
  let changed = 0, stuck = 0;
  for (const t of traces) {
    if (j >= t.plies.length) continue;
    const v0 = axVal(t.ax0, f), vj = axVal(t.plies[j].ax, f);
    if (v0 === vj) continue;
    changed++;
    let back = false;
    for (let k = j + 1; k < t.plies.length; k++) if (axVal(t.plies[k].ax, f) === v0) { back = true; break; }
    if (!back) stuck++;
  }
  return changed ? { n: changed, frac: stuck / changed } : null;
}

// res = analyzeDecision(..., {withTraces:1}); rec, i; nm = {me, op} 표시 이름
function explain(res, rec, i, nm) {
  const sub = s => s.replace(/\{me\}/g, nm.me).replace(/\{op\}/g, nm.op).replace(/(^|[ (])나가 /g, '$1내가 ').replace(/나의 /g, '내 ');
  const { cands, traces, chosen: c, best: b, median: m, W, cls } = res;
  const lines = [], data = {};
  const qc = cands[c].q;
  if (cands.length === 1) return { cls: 'best', headline: `${cands[c].text}: 유일한 합법수 (승률 ${pct(qc)})`, lines, data };
  const isBest = cls === 'best';
  const good = isBest ? c : b, bad = isBest ? m : c;
  const G = traces[good], B = traces[bad];
  const gain = cands[good].q - cands[bad].q;
  let headline = `${cands[c].text}: 승률 ${pct(qc)} — ${CLS_KO[cls]}`;
  if (!isBest) headline += ` (최선 ${cands[b].text} ${pct(cands[b].q)}, 손실 ${pp(-res.loss)}; ${res.rank}위/${cands.length})`;
  else headline += ` (중앙값 후보 ${cands[m].text} ${pct(cands[m].q)} 대비 ${pp(gain)})`;
  data.q = { chosen: qc, best: cands[b].q, median: cands[m].q, se: res.seLoss };

  // 1) 직접 효과: 실제 둔 수의 0수(결정론) + 1수(내 동반자, 판만으로 결정)
  const C = traces[c];
  const d0 = mode(C.map(t => t.plies[0].tags.map(x => tagKo(x, nm))));
  const ply1 = mode(C.map(t => (t.plies[1] && t.plies[1].who === 'mc' ? { k: plyKo(t.plies[1], nm), tags: t.plies[1].tags.map(x => tagKo(x, nm)) } : null)));
  let direct = '직접 효과: ' + (d0 && d0.v.length ? d0.v.join(', ') : '축 변화 없음');
  if (ply1 && ply1.v) direct += ` → 이어서 ${ply1.v.k}` + (ply1.v.tags.length ? `: ${ply1.v.tags.join(', ')}` : '') + (ply1.n < W ? ` (세계 ${ply1.n}/${W})` : '');
  lines.push(sub(direct));

  // 2) 값의 분해 (짝지은 세계)
  const dv = G.map((t, k) => t.val - B[k].val);
  const swing = dv.map((d, k) => (d > 0 ? k : -1)).filter(k => k >= 0), anti = dv.filter(d => d < 0);
  const cat = {};
  for (const k of swing) { const e = B[k].end; const key = e.res + ':' + e.how; cat[key] = cat[key] || { n: 0, v: 0, enders: [], gcat: [] }; cat[key].n++; cat[key].v += dv[k] / W; cat[key].enders.push(e.ender); cat[key].gcat.push(G[k].end.res + ':' + G[k].end.how); }
  const cats = Object.entries(cat).sort((x, y) => y[1].v - x[1].v);
  data.decomp = cats.map(([k, v]) => ({ cat: k, n: v.n, v: v.v, ender: mode(v.enders), gcat: mode(v.gcat) }));
  data.nSwing = swing.length; data.nAnti = anti.length; data.antiV = anti.reduce((x, y) => x + y, 0) / W;
  if (swing.length) {
    const who = isBest ? `중앙값 후보 ${cands[m].text}` : `최선수 ${cands[b].text}`;
    let s = isBest ? `이득 ${pp(gain)}의 내역 (${W}개 세계 중 ${swing.length}개에서 ${who}보다 좋았음): `
      : `손실 ${pp(-gain)}의 내역 (${W}개 세계 중 ${swing.length}개에서 ${who}가 더 좋았음): `;
    s += cats.map(([k, v]) => `${isBest ? '그 수였다면 ' : ''}${sub(HOW_KO[k] || k)} ${v.n}개(${pp(isBest ? v.v : -v.v)}, 대개 ${sub(ENDER_KO[mode(v.enders).v] || '')}(으)로 끝)`).join('; ');
    if (anti.length) s += `. 반대로 이 수가 더 ${isBest ? '나빴던' : '좋았던'} 세계 ${anti.length}개(${pp(isBest ? data.antiV : -data.antiV)})`;
    lines.push(s + '.');
  } else lines.push(isBest ? '모든 세계에서 중앙값 후보와 결과가 같음 — 이 결정은 승패를 바꾸지 않았다.' : '모든 세계에서 최선수와 결과가 같음.');

  // 3) 갈림길: 근본 원인(지속 분기)과 방아쇠
  const roots = [], trigs = [];
  for (const k of swing) { const d = divergence(G[k], B[k]); if (d.root) roots.push(d.root); if (d.trig) trigs.push(d.trig); }
  const rootKey = mode(roots.map(r => ({ j: r.j, f: r.f, who: r.who })));
  if (rootKey) {
    const same = roots.filter(r => r.j === rootKey.v.j && r.f === rootKey.v.f);
    const bv = mode(same.map(r => r.bv)), gv = mode(same.map(r => r.gv));
    const irr = irreversibility(B, rootKey.v.f, rootKey.v.j);
    const axn = sub(AXIS_KO[rootKey.v.f]);
    let s;
    const badName = isBest ? `중앙값 후보` : `이 수`;
    const weak = rootKey.n / swing.length < 0.34 ? '(세계마다 갈림길이 달라 하나로 요약되지 않음; 가장 흔한 것) ' : '';
    if (rootKey.v.j === 0) s = `갈림길: ${weak}${badName} 자체가 '${axn}'를 ${sub(axText(rootKey.v.f, bv.v))}로 만들었고(최선 쪽은 ${sub(axText(rootKey.v.f, gv.v))}), 역전된 세계의 ${pct(rootKey.n / swing.length)}에서 그 차이가 끝까지 남았다`;
    else s = `갈림길: ${weak}역전된 세계의 ${pct(rootKey.n / swing.length)}에서 ${rootKey.v.j}수 뒤 ${whoKo(rootKey.v.who, nm)}의 차례에 '${axn}'가 ${sub(axText(rootKey.v.f, gv.v))} 대신 ${sub(axText(rootKey.v.f, bv.v))}가 되었고, 끝까지 되돌아오지 않았다`;
    if (irr) s += irr.frac >= 0.7 ? ` (비가역: 이 축이 바뀐 세계 ${irr.n}개 중 ${Math.round(irr.frac * irr.n)}개에서 끝까지 복구되지 않음)`
      : irr.frac <= 0.3 ? ` (일시적: 이 축의 변화는 세계 ${irr.n}개 중 ${irr.n - Math.round(irr.frac * irr.n)}개에서 나중에 되돌아감)`
      : ` (비가역성 ${irr.frac.toFixed(2)})`;
    lines.push(s + '.');
    data.root = { ...rootKey.v, n: rootKey.n, bv: bv.v, gv: gv.v, irr };
  }
  const trigKey = mode(trigs.map(t => ({ j: t.j, who: t.who, kind: t.kind, f: t.f })));
  if (trigKey && trigKey.n >= 2) {
    const same = trigs.filter(t => t.j === trigKey.v.j && t.who === trigKey.v.who && t.kind === trigKey.v.kind);
    const card = mode(same.map(t => t.card)); const tag = mode(same.map(t => tagKo(t.tag, nm)));
    const ex = same.find(t => t.card === card.v) || same[0];
    const after = mode(swing.filter(k => B[k].plies[trigKey.v.j] && B[k].plies[trigKey.v.j].card === card.v).map(k => sub(HOW_KO[B[k].end.res + ':' + B[k].end.how] || '')));
    let s = `${isBest ? '막아낸 길' : '여기에 치명적인 전개'}(역전 세계 ${trigKey.n}/${swing.length}): ${trigKey.v.j}수 뒤 ${plyKo(ex, nm)} → ${tag.v}`;
    if (after && after.v) s += ` → 대개 ${after.v}`;
    lines.push(sub(s) + '.');
    data.trig = { ...trigKey.v, n: trigKey.n, card: card.v, tag: tag.v };
  }
  // 4) 상대의 가장 흔한 응수(나쁜 수 쪽 궤적의 ply 2) — 방아쇠와 다를 때만
  const replies = swing.map(k => B[k].plies[2]).filter(p => p && p.who === 'op').map(p => ({ kind: p.kind, card: p.card }));
  const rep = mode(replies);
  if (rep && !isBest && rep.n >= 2 && !(data.trig && data.trig.j === 2 && data.trig.card === rep.v.card)) {
    const after = swing.filter(k => B[k].plies[2] && B[k].plies[2].card === rep.v.card).map(k => sub(HOW_KO[B[k].end.res + ':' + B[k].end.how] || ''));
    lines.push(sub(`역전 세계에서 ${nm.op}의 가장 흔한 응수(${rep.n}/${swing.length}): ${cardKo(rep.v.card)}로 ${KIND_KO[rep.v.kind]} → 대개 ${mode(after).v}.`));
    data.reply = { ...rep.v, n: rep.n };
  }
  // 5) 실제 대국과의 연결
  const rest = rec.actions.length - 1 - i;
  if (rec.result && (rest <= 8 || cls === 'blunder' || cls === 'giveaway' || isBest)) {
    const fin = R.replay(rec)[rec.actions.length];
    const me = res.me;
    const term = A.terminal(fin, rec.result, me);
    const key = term.res + ':' + term.how;
    const dom = data.decomp && data.decomp[0];
    let s = `실제 대국: 이 수 뒤 ${rest}수 만에 ${sub(ENDER_KO[term.ender] || term.ender)}, ${sub(HOW_KO[key] || key)} (${rec.result.score[me]}:${rec.result.score[other(me)]}, 시장 ${rec.result.marketSize[me]}:${rec.result.marketSize[other(me)]})`;
    if (!isBest && dom) s += dom.cat === key ? ' — 롤아웃의 주된 손실 경로와 일치.' : ` — 롤아웃의 주된 손실 경로(${sub(HOW_KO[dom.cat] || dom.cat)})와는 다른 길.`;
    else s += '.';
    lines.push(s);
    data.actual = { rest, term };
  }
  return { cls, headline, lines, data };
}
module.exports = { explain, CLS_KO, AXIS_KO, HOW_KO, ENDER_KO, divergence, irreversibility };

};
const CG = { Engine: __req('engine.js'), AI: __req('ai.js'), Strong: __req('strong.js'), Record: __req('record.js'), Analysis: __req('analysis.js'), Commentary: __req('commentary.js') };
(typeof self !== 'undefined' ? self : window).CG = CG;
})();

// 브라우저 워커: 강한 AI 결정 + 분석. 메인 스레드는 상대 손패를 가린 상태(publicView)만 보낸다.
const { Engine: E, Strong: ST, Analysis: A, Commentary: CM } = self.CG;
let S = null, rand = E.mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0);
const ser = m => (m.end ? { end: true } : { move: { kind: m.move.kind, cell: m.move.cell, edge: m.move.edge, card: { r: m.move.card.r, s: m.move.card.s } }, alloc: m.alloc });
self.onmessage = e => {
  const d = e.data;
  try {
    if (d.type === 'init') { S = ST.makeS(d.opts || {}); self.postMessage({ type: 'ready' }); }
    else if (d.type === 'event') { if (S) S.onMove(ST.fromJSON(d.before), d.actor, d.move, d.alloc); }
    else if (d.type === 'decide') {
      const st = ST.fromJSON(d.state);
      const r = S.choosePlayer(st, d.me, rand);
      self.postMessage({ type: 'decision', id: d.id, ...ser(r), info: S.lastInfo() });
    } else if (d.type === 'theory') {
      const st = ST.fromJSON(d.state);
      const t = ST.theoryStep(S, st, d.me, rand);
      self.postMessage({ type: 'theory', id: d.id, end: !!t.end, label: t.label, endgame: t.endgame, theoryKey: t.theoryKey, cands: t.cands, theory: t.theory ? ser(t.theory) : null, cont: t.cont || null });
    } else if (d.type === 'eval') {
      const st = ST.fromJSON(d.state);
      const r = ST.evalPart(st, d.me, d.keys, d.W, d.seed, d.time, d.cont);
      self.postMessage({ type: 'eval', id: d.id, ...r });
    } else if (d.type === 'companion') {
      const st = ST.fromJSON(d.state);
      const { moves } = E.companionMoves(st, d.o);
      const r = S.chooseCompanion(st, d.o, moves, rand);
      self.postMessage({ type: 'companion', id: d.id, ...ser(r) });
    } else if (d.type === 'analyze') {
      for (const i of d.idx) {
        const res = A.analyzeDecision(d.rec, i, { W: d.W, withTraces: 1 });
        res.commentary = CM.explain(res, d.rec, i, d.nm[res.me]);
        delete res.traces; delete res.state; delete res.candObjs;
        self.postMessage({ type: 'result', i, res });
      }
      self.postMessage({ type: 'analyzeDone' });
    }
  } catch (err) { self.postMessage({ type: 'error', id: d.id, message: String(err && err.stack || err) }); }
};
