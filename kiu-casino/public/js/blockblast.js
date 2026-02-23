// ═══════════════════════════════════════════════════════════
//  BLOCK BLAST — Premium Puzzle Game Engine v3 (10/10)
//  Pixel PlayZone © 2026
//  Smart balancing · Row/Col highlight · Rich animations
// ═══════════════════════════════════════════════════════════

(function () {
    'use strict';

    const G = 8;
    const E = 0;
    const GPP = 5; // Gold per point

    /* ═══════════ PIECE DEFINITIONS ═══════════
       Tiers: 1=tiny(1-2) 2=small(3) 3=medium(4) 4=large(5) 5=xl(9)
       Every shape is normalized (min r,c = 0) automatically */
    const P = [
        // ── T1: Tiny ──
        { s: [[0, 0]], t: 1 },
        { s: [[0, 0], [0, 1]], t: 1 },
        { s: [[0, 0], [1, 0]], t: 1 },

        // ── T2: Small (3 cells) ──
        { s: [[0, 0], [0, 1], [0, 2]], t: 2 },            // h3
        { s: [[0, 0], [1, 0], [2, 0]], t: 2 },            // v3
        { s: [[0, 0], [1, 0], [1, 1]], t: 2 },            // L-a
        { s: [[0, 0], [0, 1], [1, 0]], t: 2 },            // L-b
        { s: [[0, 0], [0, 1], [1, 1]], t: 2 },            // L-c
        { s: [[0, 1], [1, 0], [1, 1]], t: 2 },            // L-d

        // ── T3: Medium (4 cells) ──
        { s: [[0, 0], [0, 1], [1, 0], [1, 1]], t: 3 },      // sq2
        { s: [[0, 0], [0, 1], [0, 2], [0, 3]], t: 3 },      // h4
        { s: [[0, 0], [1, 0], [2, 0], [3, 0]], t: 3 },      // v4
        { s: [[0, 0], [0, 1], [0, 2], [1, 1]], t: 3 },      // T-up
        { s: [[0, 1], [1, 0], [1, 1], [1, 2]], t: 3 },      // T-dn
        { s: [[0, 0], [1, 0], [1, 1], [2, 0]], t: 3 },      // T-rt
        { s: [[0, 0], [1, 0], [1, -1], [2, 0]], t: 3 },     // T-lt
        { s: [[0, 0], [0, 1], [1, 1], [1, 2]], t: 3 },      // S
        { s: [[0, 1], [0, 2], [1, 0], [1, 1]], t: 3 },      // Z
        { s: [[0, 0], [1, 0], [1, 1], [2, 1]], t: 3 },      // S-v
        { s: [[0, 1], [1, 0], [1, 1], [2, 0]], t: 3 },      // Z-v

        // ── T4: Large (5 cells) ──
        { s: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], t: 4 }, // h5
        { s: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], t: 4 }, // v5
        // Big L (all 4 rotations)
        { s: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], t: 4 },
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], t: 4 },
        { s: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], t: 4 },
        { s: [[0, 0], [1, 0], [2, 0], [2, -1], [2, -2]], t: 4 },
        // Corners (all 4 rotations)
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], t: 4 },
        { s: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], t: 4 },
        { s: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], t: 4 },
        { s: [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], t: 4 },
        // + shape
        { s: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], t: 4 },

        // ── T5: XL (9 cells) ──
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], t: 5 },
    ];

    /* ═══════════ DIFFICULTY CURVE ═══════════ */
    function tierW() {
        const d = Math.min(score / 500, 1); // Smoother curve over 500pts
        return {
            1: Math.round(25 - d * 8),   // 25→17
            2: Math.round(35 - d * 8),   // 35→27
            3: 25,                        // constant
            4: Math.round(12 + d * 12),  // 12→24
            5: Math.round(3 + d * 5)     // 3→8
        };
    }

    /* ═══════════ COLORS ═══════════ */
    const C = [
        { bg: '#FF6B6B', bd: '#CC4444', gw: 'rgba(255,107,107,.35)', lt: '#FF9999' },  // Coral
        { bg: '#4ECDC4', bd: '#339E96', gw: 'rgba(78,205,196,.35)', lt: '#7ADDD6' },  // Teal
        { bg: '#FFD93D', bd: '#CCB020', gw: 'rgba(255,217,61,.35)', lt: '#FFE570' },  // Gold
        { bg: '#6C5CE7', bd: '#5040B8', gw: 'rgba(108,92,231,.35)', lt: '#9080F0' },  // Purple
        { bg: '#A8E6CF', bd: '#7BBF9F', gw: 'rgba(168,230,207,.35)', lt: '#C8F0DF' }, // Mint
        { bg: '#FF8A5C', bd: '#CC6639', gw: 'rgba(255,138,92,.35)', lt: '#FFAA85' },  // Orange
        { bg: '#74B9FF', bd: '#4A90CC', gw: 'rgba(116,185,255,.35)', lt: '#99CCFF' }, // Sky
        { bg: '#E17055', bd: '#B24533', gw: 'rgba(225,112,85,.35)', lt: '#EB9580' },  // Burnt
        { bg: '#00CEC9', bd: '#00A09B', gw: 'rgba(0,206,201,.35)', lt: '#40E0DC' },  // Cyan
        { bg: '#FD79A8', bd: '#CC5580', gw: 'rgba(253,121,168,.35)', lt: '#FEA0C0' }, // Pink
    ];

    /* ═══════════ STATE ═══════════ */
    let grid = [], dom = []; // dom = cell refs
    let pcs = [null, null, null];
    let score = 0, best = +localStorage.getItem('bb_best') || 0;
    let combo = 0, mv = 0, lnTot = 0;
    let on = false, tok = null;

    // Drag
    let dPc = null, dIdx = -1, dOn = false;
    let gh = [], ghKey = '', ghOk = false;

    // DOM
    let $g, $s, $sc, $bs, $co, $bl;
    let $ov, $fs, $fr, $fb, $nr;
    let $cv, cx;
    let sparks = [];

    /* ═══════════ HAPTIC ═══════════ */
    function vib(ms) {
        try { navigator.vibrate?.(ms); } catch (_) { }
    }

    /* ═══════════ PARTICLES ═══════════ */
    class Sp {
        constructor(x, y, c) {
            this.x = x; this.y = y;
            this.vx = (Math.random() - .5) * 8;
            this.vy = (Math.random() - .5) * 6 - 4;
            this.sz = Math.random() * 6 + 2;
            this.c = c; this.a = 1;
            this.dk = Math.random() * .025 + .012;
            this.r = Math.random() * 6.28;
            this.rv = (Math.random() - .5) * .2;
            this.shape = Math.random() > .5 ? 0 : 1; // rect or circle
        }
        tick() {
            this.x += this.vx; this.vy += .14; this.y += this.vy;
            this.a -= this.dk; this.r += this.rv; this.vx *= .97;
            return this.a > 0;
        }
        draw(ctx) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, this.a);
            ctx.translate(this.x, this.y);
            ctx.rotate(this.r);
            ctx.fillStyle = this.c;
            ctx.shadowBlur = 8; ctx.shadowColor = this.c;
            const h = this.sz / 2;
            if (this.shape === 0) ctx.fillRect(-h, -h, this.sz, this.sz);
            else { ctx.beginPath(); ctx.arc(0, 0, h, 0, 6.28); ctx.fill(); }
            ctx.restore();
        }
    }

    function boom(x, y, c, n = 10) {
        for (let i = 0; i < n; i++) sparks.push(new Sp(x, y, c));
    }

    let pOn = false;
    function pRun() {
        if (!cx || !pOn) return;
        cx.clearRect(0, 0, $cv.width, $cv.height);
        sparks = sparks.filter(s => { s.draw(cx); return s.tick(); });
        if (sparks.length) requestAnimationFrame(pRun);
        else pOn = false;
    }
    function pGo() { if (!pOn) { pOn = true; pRun(); } }

    /* ═══════════ PIECE GENERATION ═══════════ */
    function norm(s) {
        let mr = Infinity, mc = Infinity;
        s.forEach(([r, c]) => { mr = Math.min(mr, r); mc = Math.min(mc, c); });
        return s.map(([r, c]) => [r - mr, c - mc]);
    }

    function mkPc(ft) {
        const w = tierW();
        let t = ft;
        if (!t) {
            const ents = Object.entries(w);
            let sum = ents.reduce((a, [, v]) => a + v, 0);
            let r = Math.random() * sum;
            for (const [k, v] of ents) { r -= v; if (r <= 0) { t = +k; break; } }
            t = t || 2;
        }
        const pool = P.filter(p => p.t === t);
        if (!pool.length) return mkPc(2);
        const def = pool[Math.floor(Math.random() * pool.length)];
        const ci = Math.floor(Math.random() * C.length);
        const shape = norm(def.s);
        let xr = 0, xc = 0;
        shape.forEach(([r, c]) => { xr = Math.max(xr, r); xc = Math.max(xc, c); });
        return { shape, ci, rows: xr + 1, cols: xc + 1, t };
    }

    function fits(pc) {
        for (let r = 0; r < G; r++)
            for (let c = 0; c < G; c++)
                if (canPl(pc, r, c)) return true;
        return false;
    }

    function gen() {
        for (let i = 0; i < 3; i++) if (!pcs[i]) pcs[i] = mkPc();

        // Guarantee at least 1 fits
        let tries = 0;
        while (!pcs.some(p => p && fits(p)) && tries < 30) {
            tries++;
            let li = 0, ls = 0;
            pcs.forEach((p, i) => { if (p && p.shape.length > ls) { ls = p.shape.length; li = i; } });
            pcs[li] = mkPc(Math.max(1, pcs[li].t - 1));
        }
        if (!pcs.some(p => p && fits(p))) {
            for (let i = 0; i < 3; i++) pcs[i] = mkPc(1);
        }
        renderSlots();
    }

    /* ═══════════ GRID ═══════════ */
    function mkGrid() {
        grid = Array.from({ length: G }, () => Array(G).fill(E));
    }

    function buildDOM() {
        $g.innerHTML = '';
        dom = [];
        for (let r = 0; r < G; r++) {
            dom[r] = [];
            for (let c = 0; c < G; c++) {
                const el = document.createElement('div');
                el.className = 'bb-cell' + ((r + c) % 2 === 0 ? ' even' : '');
                el.dataset.r = r; el.dataset.c = c;
                dom[r][c] = el;
                $g.appendChild(el);
            }
        }
    }

    function paint() {
        for (let r = 0; r < G; r++) {
            for (let c = 0; c < G; c++) {
                const el = dom[r][c];
                const v = grid[r][c];
                el.className = 'bb-cell' + ((r + c) % 2 === 0 ? ' even' : '');
                el.removeAttribute('style');
                if (v !== E) {
                    const cl = C[(v - 1) % C.length];
                    el.classList.add('filled');
                    el.style.background = `linear-gradient(145deg, ${cl.lt}, ${cl.bg} 50%, ${cl.bd})`;
                    el.style.borderColor = cl.bd;
                    el.style.boxShadow = `0 2px 6px ${cl.gw}, inset 0 1px 0 rgba(255,255,255,.22)`;
                }
            }
        }
        // Highlight rows/cols that are nearly complete
        hlNear();
    }

    // ═══ Near-complete highlight ═══
    function hlNear() {
        for (let r = 0; r < G; r++) {
            const empty = grid[r].filter(v => v === E).length;
            if (empty > 0 && empty <= 2) {
                for (let c = 0; c < G; c++) {
                    if (grid[r][c] === E) dom[r][c].classList.add('near');
                }
            }
        }
        for (let c = 0; c < G; c++) {
            let empty = 0;
            for (let r = 0; r < G; r++) if (grid[r][c] === E) empty++;
            if (empty > 0 && empty <= 2) {
                for (let r = 0; r < G; r++) {
                    if (grid[r][c] === E) dom[r][c].classList.add('near');
                }
            }
        }
    }

    function paintGh() {
        // Clear old ghosts
        for (let r = 0; r < G; r++)
            for (let c = 0; c < G; c++)
                if (grid[r][c] === E) {
                    dom[r][c].classList.remove('ghost', 'gv', 'gi');
                    dom[r][c].style.background = '';
                    dom[r][c].style.borderColor = '';
                    dom[r][c].style.boxShadow = '';
                }

        if (!gh.length || !dPc) return;
        const cl = C[dPc.ci % C.length];
        gh.forEach(({ r, c }) => {
            const el = dom[r]?.[c];
            if (!el || grid[r][c] !== E) return;
            if (ghOk) {
                el.classList.add('ghost', 'gv');
                el.style.background = `${cl.bg}44`;
                el.style.borderColor = `${cl.bg}90`;
                el.style.boxShadow = `0 0 8px ${cl.gw}`;
            } else {
                el.classList.add('ghost', 'gi');
                el.style.background = 'rgba(255,50,50,.12)';
                el.style.borderColor = 'rgba(255,50,50,.25)';
            }
        });
    }

    /* ═══════════ SLOTS ═══════════ */
    function renderSlots() {
        const slots = $s.querySelectorAll('.bb-slot');
        slots.forEach((sl, i) => {
            const pv = sl.querySelector('.bb-slot-preview');
            pv.innerHTML = '';
            const pc = pcs[i];
            if (!pc) { sl.classList.add('empty'); sl.classList.remove('no-fit'); return; }
            sl.classList.remove('empty');

            const maxD = Math.max(pc.rows, pc.cols);
            const sz = maxD <= 2 ? 30 : maxD <= 3 ? 24 : maxD <= 4 ? 20 : 16;

            pv.style.width = pc.cols * sz + 'px';
            pv.style.height = pc.rows * sz + 'px';
            pv.style.gridTemplateColumns = `repeat(${pc.cols}, ${sz}px)`;
            pv.style.gridTemplateRows = `repeat(${pc.rows}, ${sz}px)`;

            for (let r = 0; r < pc.rows; r++) {
                for (let c = 0; c < pc.cols; c++) {
                    const d = document.createElement('div');
                    // FIX: avoid variable shadowing with piece `pc`
                    const isFilled = pc.shape.some(([sr, sc]) => sr === r && sc === c);
                    if (isFilled) {
                        const cl = C[pc.ci % C.length];
                        d.className = 'bb-mini filled';
                        d.style.background = `linear-gradient(145deg, ${cl.lt}, ${cl.bg} 50%, ${cl.bd})`;
                        d.style.borderColor = cl.bd;
                        d.style.boxShadow = `0 1px 4px ${cl.gw}, inset 0 1px 0 rgba(255,255,255,.18)`;
                    } else {
                        d.className = 'bb-mini empty-cell';
                    }
                    pv.appendChild(d);
                }
            }

            // Highlight can-fit
            if (on) sl.classList.toggle('no-fit', !fits(pc));
            else sl.classList.remove('no-fit');
        });
    }

    /* ═══════════ PLACEMENT ═══════════ */
    function canPl(pc, tr, tc) {
        for (const [r, c] of pc.shape) {
            const gr = tr + r, gc = tc + c;
            if (gr < 0 || gr >= G || gc < 0 || gc >= G) return false;
            if (grid[gr][gc] !== E) return false;
        }
        return true;
    }

    function pl(pc, tr, tc) {
        const cv = pc.ci + 1;
        const placed = [];
        for (const [r, c] of pc.shape) {
            grid[tr + r][tc + c] = cv;
            placed.push({ r: tr + r, c: tc + c });
        }
        mv++;
        paint();

        // Pop animation
        placed.forEach(({ r, c }, i) => {
            const el = dom[r][c];
            el.style.animationDelay = `${i * 20}ms`;
            el.classList.add('pop');
            setTimeout(() => el.classList.remove('pop'), 450);
        });

        sfx('place');
        vib(15);

        // Process clears
        setTimeout(() => {
            const cleared = clr();
            addSc(pc.shape.length, cleared);
            paint();
            renderSlots();

            if (pcs.every(p => p === null)) {
                setTimeout(() => gen(), 200);
            }

            setTimeout(() => {
                if (on && gameOver()) end();
            }, 280);
        }, 130);
    }

    function clr() {
        const rows = [], cols = [];
        for (let r = 0; r < G; r++) if (grid[r].every(v => v !== E)) rows.push(r);
        for (let c = 0; c < G; c++) {
            let ok = true;
            for (let r = 0; r < G; r++) if (grid[r][c] === E) { ok = false; break; }
            if (ok) cols.push(c);
        }

        const total = rows.length + cols.length;
        if (!total) { combo = 0; return 0; }

        const set = new Set();
        rows.forEach(r => { for (let c = 0; c < G; c++) set.add(r * G + c); });
        cols.forEach(c => { for (let r = 0; r < G; r++) set.add(r * G + c); });

        // Staggered clearing animation (row sweep feel)
        let delay = 0;
        // Rows sweep left-to-right
        rows.forEach(r => {
            for (let c = 0; c < G; c++) {
                const el = dom[r][c];
                if (el) {
                    el.style.animationDelay = `${delay + c * 25}ms`;
                    el.classList.add('sweep');
                }
            }
            delay += 50;
        });
        // Cols sweep top-to-bottom
        cols.forEach(c => {
            for (let r = 0; r < G; r++) {
                const el = dom[r][c];
                if (el) {
                    el.style.animationDelay = `${delay + r * 25}ms`;
                    el.classList.add('sweep');
                }
            }
            delay += 50;
        });

        // Particles
        set.forEach(idx => {
            const r = Math.floor(idx / G), c = idx % G;
            const cl = C[(grid[r][c] - 1) % C.length];
            const el = dom[r][c];
            if (el && $cv) {
                const rect = el.getBoundingClientRect();
                const cr = $cv.getBoundingClientRect();
                boom(rect.left + rect.width / 2 - cr.left, rect.top + rect.height / 2 - cr.top, cl.bg, 6);
            }
        });
        pGo();

        // Clear grid data after sweep
        const sweepTime = Math.max(300, delay + G * 25);
        setTimeout(() => {
            set.forEach(idx => {
                const r = Math.floor(idx / G), c = idx % G;
                grid[r][c] = E;
                dom[r][c].classList.remove('sweep');
            });
            paint();
        }, sweepTime);

        combo++;
        lnTot += total;
        sfx(total >= 2 ? 'multi' : 'clear');
        vib(total >= 2 ? [20, 30, 20] : 25);
        if (combo > 1) { showCombo(combo); sfx('combo'); }
        if (total >= 2) {
            $g.classList.add('shake');
            setTimeout(() => $g.classList.remove('shake'), 400);
        }

        // Flash the grid border on clear
        $g.classList.add('flash');
        setTimeout(() => $g.classList.remove('flash'), 600);

        return total;
    }

    function addSc(blocks, lines) {
        let pts = blocks;
        if (lines > 0) {
            pts += lines * 10;
            if (lines >= 4) pts += 40;
            else if (lines >= 3) pts += 20;
            else if (lines >= 2) pts += 8;
        }
        if (combo > 1) pts = Math.floor(pts * (1 + combo * .5));

        // Animated counter
        const prev = score;
        score += pts;
        if (score > best) { best = score; localStorage.setItem('bb_best', '' + best); }

        animateCounter($sc, prev, score, 400);
        if ($bs) $bs.textContent = best.toLocaleString();
        if (pts > 5 && lines > 0) floatSc('+' + pts);
    }

    function animateCounter(el, from, to, dur) {
        if (!el) return;
        const st = performance.now();
        function step(now) {
            const p = Math.min((now - st) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
            el.textContent = Math.round(from + (to - from) * ease).toLocaleString();
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }

    /* ═══════════ GAME OVER ═══════════ */
    function gameOver() {
        return pcs.every(p => !p || !fits(p));
    }

    async function end() {
        on = false;
        sfx('gameover');
        vib([30, 50, 30, 50, 60]);
        $g.classList.add('go-shake');
        await slp(600);

        const rec = score === best && score > 0;
        if ($fs) $fs.textContent = score.toLocaleString();
        if ($fb) $fb.textContent = best.toLocaleString();
        if ($fr) $fr.textContent = (score * GPP).toLocaleString();
        if ($nr) $nr.style.display = rec ? 'block' : 'none';
        if ($ov) $ov.classList.add('show');

        const el = id => document.getElementById(id);
        const $gl = el('bb-final-lines'), $gm = el('bb-final-moves'), $gc = el('bb-final-combo');
        if ($gl) $gl.textContent = lnTot;
        if ($gm) $gm.textContent = mv;
        if ($gc) $gc.textContent = combo > 1 ? `x${combo}` : '-';

        if (score > 0 && tok) {
            try {
                const res = await fetch('/api/blockblast/reward', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ score, token: tok, moves: mv })
                });
                const d = await res.json();
                if (d.success) {
                    if ($bl) $bl.textContent = (+d.newBalance).toLocaleString();
                    if ($fr) {
                        // Animate reward count-up
                        animateCounter($fr, 0, d.addedGold, 800);
                    }
                    // Show gold gain notification
                    const nEl = document.createElement('div');
                    nEl.className = 'gold-notif';
                    nEl.textContent = `+${d.addedGold.toLocaleString()} 💰`;
                    document.body.appendChild(nEl);
                    setTimeout(() => nEl.remove(), 2500);
                }
            } catch (e) { console.error('[BB] Reward:', e); }
        }
    }

    /* ═══════════ DRAG & DROP ═══════════ */
    function initDrag() {
        $s.querySelectorAll('.bb-slot').forEach((sl, i) => {
            sl.addEventListener('touchstart', e => dStart(e, i), { passive: false });
            sl.addEventListener('mousedown', e => dStart(e, i));
        });
        document.addEventListener('touchmove', dMove, { passive: false });
        document.addEventListener('mousemove', dMove);
        document.addEventListener('touchend', dEnd);
        document.addEventListener('mouseup', dEnd);
    }

    function dStart(e, idx) {
        if (!on || !pcs[idx]) return;
        // Don't start drag on no-fit pieces
        if (!fits(pcs[idx])) { sfx('invalid'); vib(10); return; }
        e.preventDefault();
        dPc = pcs[idx]; dIdx = idx; dOn = true;
        mkDragEl(dPc);
        const t = e.touches ? e.touches[0] : e;
        moveDrag(t.clientX, t.clientY);
        $s.querySelectorAll('.bb-slot')[idx]?.classList.add('dragging');
        sfx('pickup');
        vib(10);
    }

    function dMove(e) {
        if (!dOn || !dPc) return;
        e.preventDefault();
        const t = e.touches ? e.touches[0] : e;
        moveDrag(t.clientX, t.clientY);
        updateGh(t.clientX, t.clientY);
    }

    function dEnd(e) {
        if (!dOn || !dPc) return;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const pos = snap(t.clientX, t.clientY);

        if (pos && canPl(dPc, pos.r, pos.c)) {
            pl(dPc, pos.r, pos.c);
            pcs[dIdx] = null;
            renderSlots();
            if (pcs.every(p => p === null)) setTimeout(() => gen(), 200);
        } else {
            sfx('invalid');
            vib(20);
            // Bounce-back animation on the slot
            const sl = $s.querySelectorAll('.bb-slot')[dIdx];
            if (sl) { sl.classList.add('bounce'); setTimeout(() => sl.classList.remove('bounce'), 400); }
        }

        rmDragEl();
        gh = []; ghKey = '';
        paintGh(); paint();
        dOn = false; dPc = null; dIdx = -1;
        $s.querySelectorAll('.bb-slot').forEach(s => s.classList.remove('dragging'));
    }

    function mkDragEl(pc) {
        rmDragEl();
        const el = document.createElement('div');
        el.id = 'bb-drag';
        el.className = 'bb-drag-piece';

        const sz = cellSz();
        el.style.width = pc.cols * sz + 'px';
        el.style.height = pc.rows * sz + 'px';
        el.style.gridTemplateColumns = `repeat(${pc.cols}, ${sz}px)`;
        el.style.gridTemplateRows = `repeat(${pc.rows}, ${sz}px)`;

        for (let r = 0; r < pc.rows; r++) {
            for (let c = 0; c < pc.cols; c++) {
                const d = document.createElement('div');
                const ok = pc.shape.some(([sr, sc]) => sr === r && sc === c);
                if (ok) {
                    const cl = C[pc.ci % C.length];
                    d.className = 'bb-drag-cell filled';
                    d.style.background = `linear-gradient(145deg, ${cl.lt}, ${cl.bg} 50%, ${cl.bd})`;
                    d.style.borderColor = cl.bd;
                    d.style.boxShadow = `0 2px 10px ${cl.gw}, inset 0 1px 0 rgba(255,255,255,.25)`;
                } else {
                    d.className = 'bb-drag-cell empty-cell';
                }
                el.appendChild(d);
            }
        }
        document.body.appendChild(el);
    }

    function rmDragEl() {
        const el = document.getElementById('bb-drag');
        if (el) el.remove();
    }

    function moveDrag(x, y) {
        const el = document.getElementById('bb-drag');
        if (!el || !dPc) return;
        const sz = cellSz();
        el.style.left = (x - dPc.cols * sz / 2) + 'px';
        el.style.top = (y - dPc.rows * sz / 2 - 75) + 'px';
    }

    function updateGh(x, y) {
        const pos = snap(x, y);
        const ng = [];
        ghOk = false;
        if (pos && dPc) {
            ghOk = canPl(dPc, pos.r, pos.c);
            for (const [r, c] of dPc.shape) {
                const gr = pos.r + r, gc = pos.c + c;
                if (gr >= 0 && gr < G && gc >= 0 && gc < G) ng.push({ r: gr, c: gc });
            }
        }
        const k = ng.map(g => g.r * G + g.c).join(',');
        if (k !== ghKey) { gh = ng; ghKey = k; paintGh(); }
    }

    function snap(x, y) {
        const rect = $g.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle($g).paddingLeft) || 8;
        const sz = (rect.width - pad * 2) / G;
        const oy = 75;
        const col = Math.floor((x - rect.left - pad) / sz);
        const row = Math.floor((y - oy - rect.top - pad) / sz);
        if (!dPc) return null;
        const cr = row - Math.floor(dPc.rows / 2);
        const cc = col - Math.floor(dPc.cols / 2);
        const fr = Math.max(0, Math.min(G - dPc.rows, cr));
        const fc = Math.max(0, Math.min(G - dPc.cols, cc));
        if (x < rect.left - 40 || x > rect.right + 40 || (y - oy) < rect.top - 40 || (y - oy) > rect.bottom + 40) return null;
        return { r: fr, c: fc };
    }

    function cellSz() {
        if (!$g) return 40;
        const rect = $g.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle($g).paddingLeft) || 8;
        return (rect.width - pad * 2) / G;
    }

    /* ═══════════ UI EFFECTS ═══════════ */
    function showCombo(v) {
        if (!$co) return;
        const labels = { 2: '🔥 COMBO x2!', 3: '💥 x3!', 4: '⚡ x4!', 5: '🌟 x5!', 6: '🔱 INSANE!' };
        $co.textContent = v >= 6 ? labels[6] : labels[v] || `🔱 x${v}!`;
        $co.classList.remove('show'); void $co.offsetWidth; $co.classList.add('show');
        setTimeout(() => $co.classList.remove('show'), 1800);
    }

    function floatSc(txt) {
        const el = document.createElement('div');
        el.className = 'bb-float';
        el.textContent = txt;
        const gr = $g.getBoundingClientRect();
        el.style.left = gr.left + gr.width / 2 + 'px';
        el.style.top = gr.top + gr.height / 2.5 + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }

    /* ═══════════ SOUND ═══════════ */
    const ac = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
    function sfx(ty) {
        if (!ac) return;
        try {
            if (ac.state === 'suspended') ac.resume();
            const o = ac.createOscillator(), g = ac.createGain();
            o.connect(g); g.connect(ac.destination);
            g.gain.setValueAtTime(.06, ac.currentTime);
            g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .3);
            const t = ac.currentTime;
            switch (ty) {
                case 'place':
                    o.frequency.setValueAtTime(520, t);
                    o.frequency.exponentialRampToValueAtTime(740, t + .06);
                    o.type = 'sine'; break;
                case 'clear':
                    o.frequency.setValueAtTime(650, t);
                    o.frequency.exponentialRampToValueAtTime(1200, t + .14);
                    o.type = 'triangle'; g.gain.setValueAtTime(.09, t); break;
                case 'multi':
                    o.frequency.setValueAtTime(700, t);
                    o.frequency.exponentialRampToValueAtTime(1500, t + .2);
                    o.type = 'triangle'; g.gain.setValueAtTime(.1, t);
                    g.gain.exponentialRampToValueAtTime(.001, t + .4); break;
                case 'combo':
                    o.frequency.setValueAtTime(880, t);
                    o.frequency.exponentialRampToValueAtTime(1760, t + .18);
                    o.type = 'square'; g.gain.setValueAtTime(.04, t); break;
                case 'pickup':
                    o.frequency.setValueAtTime(440, t);
                    o.frequency.exponentialRampToValueAtTime(550, t + .04);
                    o.type = 'sine'; g.gain.setValueAtTime(.035, t); break;
                case 'invalid':
                    o.frequency.setValueAtTime(220, t);
                    o.frequency.exponentialRampToValueAtTime(150, t + .1);
                    o.type = 'sawtooth'; g.gain.setValueAtTime(.03, t); break;
                case 'gameover':
                    o.frequency.setValueAtTime(400, t);
                    o.frequency.exponentialRampToValueAtTime(80, t + .6);
                    o.type = 'sawtooth'; g.gain.setValueAtTime(.06, t);
                    g.gain.exponentialRampToValueAtTime(.001, t + .6); break;
                default: o.frequency.setValueAtTime(440, t);
            }
            o.start(t); o.stop(t + .7);
        } catch (_) { }
    }

    /* ═══════════ GAME FLOW ═══════════ */
    async function start() {
        mkGrid(); pcs = [null, null, null];
        score = 0; combo = 0; lnTot = 0; mv = 0;
        on = true; sparks = [];

        if ($sc) $sc.textContent = '0';
        if ($bs) $bs.textContent = best.toLocaleString();
        if ($ov) $ov.classList.remove('show');
        $g.classList.remove('go-shake');

        buildDOM();
        paint();
        gen();

        try {
            const r = await fetch('/api/blockblast/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
            });
            tok = (await r.json()).token;
        } catch (_) { tok = null; }
        bal();
    }

    async function bal() {
        try {
            const r = await fetch('/api/me');
            const d = await r.json();
            if ($bl && d.balance != null) $bl.textContent = (+d.balance).toLocaleString();
        } catch (_) { }
    }

    function slp(ms) { return new Promise(r => setTimeout(r, ms)); }

    /* ═══════════ INIT ═══════════ */
    function init() {
        const $ = id => document.getElementById(id);
        $g = $('bb-grid');
        $s = $('bb-slots');
        $sc = $('bb-score');
        $bs = $('bb-best');
        $co = $('bb-combo');
        $bl = $('bb-balance');
        $ov = $('bb-gameover');
        $fs = $('bb-final-score');
        $fr = $('bb-final-reward');
        $fb = $('bb-final-best');
        $nr = $('bb-new-record');
        $cv = $('bb-particles');

        if ($cv) {
            cx = $cv.getContext('2d');
            szCv();
            window.addEventListener('resize', szCv);
        }

        $('bb-restart')?.addEventListener('click', () => start());
        initDrag();
        start();
    }

    function szCv() {
        if (!$cv) return;
        const r = $cv.parentElement.getBoundingClientRect();
        $cv.width = r.width;
        $cv.height = r.height;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
