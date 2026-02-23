// ═══════════════════════════════════════════════════════════
//  BLOCK BLAST — Premium Puzzle Game Engine v2
//  Pixel PlayZone © 2026
//  Smart piece balancing + polished UX
// ═══════════════════════════════════════════════════════════

(function () {
    'use strict';

    const GRID = 8;
    const EMPTY = 0;
    const GOLD_PER_PT = 5;

    // ═══ PIECE DEFINITIONS WITH TIERS ═══
    // tier: 1 = small (easy), 2 = medium, 3 = large (hard)
    const PIECES = [
        // ── Tier 1: Small (1-2 cells) ──
        { s: [[0, 0]], tier: 1 },                    // dot
        { s: [[0, 0], [0, 1]], tier: 1 },              // h2
        { s: [[0, 0], [1, 0]], tier: 1 },              // v2

        // ── Tier 2: Medium (3 cells) ──
        { s: [[0, 0], [0, 1], [0, 2]], tier: 2 },        // h3
        { s: [[0, 0], [1, 0], [2, 0]], tier: 2 },        // v3
        { s: [[0, 0], [1, 0], [1, 1]], tier: 2 },        // L small 1
        { s: [[0, 0], [0, 1], [1, 0]], tier: 2 },        // L small 2
        { s: [[0, 0], [0, 1], [1, 1]], tier: 2 },        // L small 3
        { s: [[0, 1], [1, 0], [1, 1]], tier: 2 },        // L small 4

        // ── Tier 3: Medium+ (4 cells) ──
        { s: [[0, 0], [0, 1], [1, 0], [1, 1]], tier: 3 },  // sq2
        { s: [[0, 0], [0, 1], [0, 2], [0, 3]], tier: 3 },  // h4
        { s: [[0, 0], [1, 0], [2, 0], [3, 0]], tier: 3 },  // v4
        { s: [[0, 0], [0, 1], [0, 2], [1, 1]], tier: 3 },  // T top
        { s: [[0, 1], [1, 0], [1, 1], [1, 2]], tier: 3 },  // T bottom
        { s: [[0, 0], [1, 0], [2, 0], [1, 1]], tier: 3 },  // T right
        { s: [[0, 0], [1, 0], [2, 0], [1, -1]], tier: 3 }, // T left
        { s: [[0, 0], [0, 1], [1, 1], [1, 2]], tier: 3 },  // S shape
        { s: [[0, 1], [0, 2], [1, 0], [1, 1]], tier: 3 },  // Z shape

        // ── Tier 4: Large (5 cells) ──
        { s: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], tier: 4 }, // h5
        { s: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], tier: 4 }, // v5
        { s: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], tier: 4 }, // big L 1
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], tier: 4 }, // big L 2
        { s: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], tier: 4 }, // big L 3
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], tier: 4 }, // big L 4
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], tier: 4 }, // corner 1
        { s: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], tier: 4 }, // corner 2

        // ── Tier 5: Extra Large (9 cells) ──
        { s: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], tier: 5 }, // sq3
    ];

    // Tier weights: controls how often each tier appears
    // Higher early game weight → easier start; adjusts as score grows
    function getTierWeights() {
        // Make game progressively harder: more large pieces as score increases
        const difficulty = Math.min(score / 300, 1); // 0 to 1 over 300 points
        return {
            1: 30 - difficulty * 10,  // 30→20
            2: 35 - difficulty * 5,   // 35→30
            3: 25,                    // stays 25
            4: 8 + difficulty * 10,   // 8→18
            5: 2 + difficulty * 5     // 2→7
        };
    }

    // ═══ VIBRANT COLOR PALETTE ═══
    const COLORS = [
        { bg: '#FF6B6B', bd: '#D94F4F', gw: 'rgba(255,107,107,.3)', lt: '#FF9494', nm: 'Coral' },
        { bg: '#4ECDC4', bd: '#3AB0A8', gw: 'rgba(78,205,196,.3)', lt: '#74DDD6', nm: 'Teal' },
        { bg: '#FFD93D', bd: '#DEBA28', gw: 'rgba(255,217,61,.3)', lt: '#FFE46B', nm: 'Gold' },
        { bg: '#6C5CE7', bd: '#5847CC', gw: 'rgba(108,92,231,.3)', lt: '#8A7DEE', nm: 'Purple' },
        { bg: '#A8E6CF', bd: '#85CCAE', gw: 'rgba(168,230,207,.3)', lt: '#C2F0DE', nm: 'Mint' },
        { bg: '#FF8A5C', bd: '#DD7244', gw: 'rgba(255,138,92,.3)', lt: '#FFA882', nm: 'Orange' },
        { bg: '#74B9FF', bd: '#5AA0E0', gw: 'rgba(116,185,255,.3)', lt: '#97CCFF', nm: 'Sky' },
        { bg: '#E17055', bd: '#C45D44', gw: 'rgba(225,112,85,.3)', lt: '#EB9179', nm: 'Sunset' },
        { bg: '#00CEC9', bd: '#00B3AE', gw: 'rgba(0,206,201,.3)', lt: '#33DBD7', nm: 'Cyan' },
        { bg: '#FD79A8', bd: '#DB6290', gw: 'rgba(253,121,168,.3)', lt: '#FE9ABD', nm: 'Pink' },
    ];

    // ═══ STATE ═══
    let grid = [], cells = []; // cells = DOM refs for fast updates
    let pieces = [null, null, null];
    let score = 0, best = +localStorage.getItem('bb_best') || 0;
    let combo = 0, moves = 0, linesTotal = 0;
    let active = false, token = null;

    // Drag
    let dragPc = null, dragIdx = -1, dragging = false;
    let ghosts = [], lastGhostKey = '';
    let validPlacement = false;

    // DOM
    let $grid, $slots, $score, $best, $combo, $bal;
    let $goOverlay, $goScore, $goReward, $goBest, $goRecord;
    let $particles, pCtx;
    let particles = [];

    // ═══ PARTICLES ═══
    class Spark {
        constructor(x, y, col) {
            this.x = x; this.y = y;
            this.vx = (Math.random() - .5) * 7;
            this.vy = (Math.random() - .5) * 7 - 3;
            this.sz = Math.random() * 5 + 2;
            this.col = col;
            this.life = 1;
            this.fade = Math.random() * .025 + .015;
            this.rot = Math.random() * 6.28;
            this.rv = (Math.random() - .5) * .15;
        }
        tick() {
            this.x += this.vx; this.vy += .15; this.y += this.vy;
            this.life -= this.fade; this.rot += this.rv; this.vx *= .97;
            return this.life > 0;
        }
        draw(ctx) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, this.life);
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rot);
            ctx.fillStyle = this.col;
            ctx.shadowBlur = 5; ctx.shadowColor = this.col;
            const h = this.sz / 2;
            ctx.fillRect(-h, -h, this.sz, this.sz);
            ctx.restore();
        }
    }

    function boom(x, y, col, n = 10) {
        for (let i = 0; i < n; i++) particles.push(new Spark(x, y, col));
    }

    let pLoop = false;
    function runParticles() {
        if (!pCtx || !pLoop) return;
        pCtx.clearRect(0, 0, $particles.width, $particles.height);
        particles = particles.filter(p => { p.draw(pCtx); return p.tick(); });
        if (particles.length) requestAnimationFrame(runParticles);
        else pLoop = false;
    }
    function kickParticles() {
        if (!pLoop) { pLoop = true; runParticles(); }
    }

    // ═══ SMART PIECE GENERATION ═══
    function makePiece(forceTier) {
        const weights = getTierWeights();
        let tier = forceTier;
        if (!tier) {
            // Weighted random tier selection
            const entries = Object.entries(weights);
            let total = entries.reduce((s, [, w]) => s + w, 0);
            let r = Math.random() * total;
            for (const [t, w] of entries) {
                r -= w;
                if (r <= 0) { tier = +t; break; }
            }
            if (!tier) tier = 2;
        }

        // Get pieces in this tier
        const pool = PIECES.filter(p => p.tier === tier);
        if (!pool.length) return makePiece(2); // fallback
        const def = pool[Math.floor(Math.random() * pool.length)];
        const ci = Math.floor(Math.random() * COLORS.length);

        // Normalize so min r,c=0
        let mr = Infinity, mc = Infinity;
        def.s.forEach(([r, c]) => { mr = Math.min(mr, r); mc = Math.min(mc, c); });
        const shape = def.s.map(([r, c]) => [r - mr, c - mc]);
        let xr = 0, xc = 0;
        shape.forEach(([r, c]) => { xr = Math.max(xr, r); xc = Math.max(xc, c); });

        return { shape, ci, rows: xr + 1, cols: xc + 1, tier };
    }

    function canFitAny(piece) {
        for (let r = 0; r < GRID; r++)
            for (let c = 0; c < GRID; c++)
                if (canPlace(piece, r, c)) return true;
        return false;
    }

    function genPieces() {
        // Smart generation: ensure at least 1 piece can be placed
        let attempts = 0;
        const maxAttempts = 20;

        for (let i = 0; i < 3; i++) {
            if (pieces[i] === null) pieces[i] = makePiece();
        }

        // Verify at least one piece fits, if not, regenerate smaller
        while (!pieces.some(p => p && canFitAny(p)) && attempts < maxAttempts) {
            attempts++;
            // Replace the largest piece with a smaller one
            let largestIdx = 0, largestSize = 0;
            pieces.forEach((p, i) => {
                if (p && p.shape.length > largestSize) {
                    largestSize = p.shape.length;
                    largestIdx = i;
                }
            });
            pieces[largestIdx] = makePiece(Math.max(1, pieces[largestIdx].tier - 1));
        }

        // If still can't fit, force generate small pieces
        if (!pieces.some(p => p && canFitAny(p))) {
            for (let i = 0; i < 3; i++) pieces[i] = makePiece(1);
        }

        renderSlots();
    }

    // ═══ GRID ═══
    function createGrid() {
        grid = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    }

    function buildGridDOM() {
        $grid.innerHTML = '';
        cells = [];
        for (let r = 0; r < GRID; r++) {
            cells[r] = [];
            for (let c = 0; c < GRID; c++) {
                const el = document.createElement('div');
                el.className = 'bb-cell';
                el.dataset.r = r; el.dataset.c = c;
                cells[r][c] = el;
                $grid.appendChild(el);
            }
        }
    }

    function paintGrid() {
        for (let r = 0; r < GRID; r++) {
            for (let c = 0; c < GRID; c++) {
                const el = cells[r][c];
                const v = grid[r][c];
                // Clear prev classes/styles
                el.className = 'bb-cell';
                el.removeAttribute('style');

                if (v !== EMPTY) {
                    const col = COLORS[(v - 1) % COLORS.length];
                    el.classList.add('filled');
                    el.style.background = `linear-gradient(135deg, ${col.lt}, ${col.bg} 55%, ${col.bd})`;
                    el.style.borderColor = col.bd;
                    el.style.boxShadow = `0 2px 8px ${col.gw}, inset 0 1px 0 rgba(255,255,255,.25)`;
                }
            }
        }
    }

    function paintGhosts() {
        // Clear old ghosts
        for (let r = 0; r < GRID; r++)
            for (let c = 0; c < GRID; c++)
                if (grid[r][c] === EMPTY) {
                    cells[r][c].classList.remove('ghost', 'ghost-valid', 'ghost-invalid');
                    cells[r][c].style.background = '';
                    cells[r][c].style.borderColor = '';
                }

        if (!ghosts.length || !dragPc) return;

        const col = COLORS[dragPc.ci % COLORS.length];
        ghosts.forEach(({ r, c }) => {
            const el = cells[r]?.[c];
            if (!el || grid[r][c] !== EMPTY) return;

            if (validPlacement) {
                el.classList.add('ghost', 'ghost-valid');
                el.style.background = `${col.bg}40`;
                el.style.borderColor = `${col.bg}88`;
                el.style.boxShadow = `0 0 6px ${col.gw}`;
            } else {
                el.classList.add('ghost', 'ghost-invalid');
                el.style.background = 'rgba(255,60,60,.15)';
                el.style.borderColor = 'rgba(255,60,60,.3)';
            }
        });
    }

    // ═══ SLOTS ═══
    function renderSlots() {
        const slots = $slots.querySelectorAll('.bb-slot');
        slots.forEach((slot, i) => {
            const pv = slot.querySelector('.bb-slot-preview');
            pv.innerHTML = '';
            const pc = pieces[i];
            if (!pc) { slot.classList.add('empty'); return; }
            slot.classList.remove('empty');

            const maxDim = Math.max(pc.rows, pc.cols);
            const sz = maxDim <= 2 ? 32 : maxDim <= 3 ? 26 : maxDim <= 4 ? 22 : 18;

            pv.style.width = pc.cols * sz + 'px';
            pv.style.height = pc.rows * sz + 'px';
            pv.style.gridTemplateColumns = `repeat(${pc.cols}, ${sz}px)`;
            pv.style.gridTemplateRows = `repeat(${pc.rows}, ${sz}px)`;

            for (let r = 0; r < pc.rows; r++) {
                for (let c = 0; c < pc.cols; c++) {
                    const d = document.createElement('div');
                    const filled = pc.shape.some(([pr, pc]) => pr === r && pc === c);
                    if (filled) {
                        const col = COLORS[pc.ci % COLORS.length];
                        d.className = 'bb-mini filled';
                        d.style.background = `linear-gradient(135deg, ${col.lt}, ${col.bg} 55%, ${col.bd})`;
                        d.style.borderColor = col.bd;
                        d.style.boxShadow = `0 1px 4px ${col.gw}, inset 0 1px 0 rgba(255,255,255,.2)`;
                    } else {
                        d.className = 'bb-mini empty-cell';
                    }
                    pv.appendChild(d);
                }
            }

            // Highlight pieces that CAN be placed
            if (active && canFitAny(pc)) {
                slot.classList.remove('no-fit');
            } else if (active) {
                slot.classList.add('no-fit');
            }
        });
    }

    // ═══ PLACEMENT ═══
    function canPlace(pc, tr, tc) {
        for (const [r, c] of pc.shape) {
            const gr = tr + r, gc = tc + c;
            if (gr < 0 || gr >= GRID || gc < 0 || gc >= GRID) return false;
            if (grid[gr][gc] !== EMPTY) return false;
        }
        return true;
    }

    function place(pc, tr, tc) {
        const cv = pc.ci + 1;
        const placed = [];
        for (const [r, c] of pc.shape) {
            grid[tr + r][tc + c] = cv;
            placed.push({ r: tr + r, c: tc + c });
        }
        moves++;
        paintGrid();

        // Animate placement
        placed.forEach(({ r, c }, i) => {
            const el = cells[r][c];
            el.style.animationDelay = `${i * 25}ms`;
            el.classList.add('pop');
            setTimeout(() => el.classList.remove('pop'), 400);
        });

        sfx('place');

        // Process line clears
        setTimeout(() => {
            const cleared = clearLines();
            addScore(pc.shape.length, cleared);
            paintGrid();
            renderSlots(); // update can-fit highlights

            if (pieces.every(p => p === null)) {
                setTimeout(() => genPieces(), 180);
            }

            // Check game over after new pieces
            setTimeout(() => {
                if (active && isGameOver()) endGame();
            }, 250);
        }, 120);
    }

    function clearLines() {
        const rows = [], cols = [];
        for (let r = 0; r < GRID; r++) if (grid[r].every(v => v !== EMPTY)) rows.push(r);
        for (let c = 0; c < GRID; c++) {
            let ok = true;
            for (let r = 0; r < GRID; r++) if (grid[r][c] === EMPTY) { ok = false; break; }
            if (ok) cols.push(c);
        }

        const total = rows.length + cols.length;
        if (!total) { combo = 0; return 0; }

        const toClear = new Set();
        rows.forEach(r => { for (let c = 0; c < GRID; c++) toClear.add(r * GRID + c); });
        cols.forEach(c => { for (let r = 0; r < GRID; r++) toClear.add(r * GRID + c); });

        // Particles at each cleared cell
        toClear.forEach(idx => {
            const r = Math.floor(idx / GRID), c = idx % GRID;
            const col = COLORS[(grid[r][c] - 1) % COLORS.length];
            const el = cells[r][c];
            if (el && $particles) {
                const rect = el.getBoundingClientRect();
                const cr = $particles.getBoundingClientRect();
                boom(rect.left + rect.width / 2 - cr.left, rect.top + rect.height / 2 - cr.top, col.bg, 5);
            }
        });
        kickParticles();

        // Animate clearing
        toClear.forEach(idx => {
            const r = Math.floor(idx / GRID), c = idx % GRID;
            cells[r][c].classList.add('clearing');
        });

        // Clear after anim
        setTimeout(() => {
            toClear.forEach(idx => {
                const r = Math.floor(idx / GRID), c = idx % GRID;
                grid[r][c] = EMPTY;
            });
            paintGrid();
        }, 280);

        combo++;
        linesTotal += total;
        sfx(total >= 2 ? 'multi' : 'clear');
        if (combo > 1) { showCombo(combo); sfx('combo'); }
        if (total >= 2) {
            $grid.classList.add('shake');
            setTimeout(() => $grid.classList.remove('shake'), 400);
        }
        return total;
    }

    function addScore(blocks, lines) {
        let pts = blocks;
        if (lines > 0) {
            pts += lines * 10;
            if (lines >= 4) pts += 30;
            else if (lines >= 3) pts += 15;
            else if (lines >= 2) pts += 5;
        }
        if (combo > 1) pts = Math.floor(pts * (1 + combo * .5));

        score += pts;
        if (score > best) { best = score; localStorage.setItem('bb_best', '' + best); }

        if ($score) {
            $score.textContent = score.toLocaleString();
            $score.classList.remove('bump'); void $score.offsetWidth; $score.classList.add('bump');
        }
        if ($best) $best.textContent = best.toLocaleString();
        if (pts > 5 && lines > 0) floatScore('+' + pts);
    }

    // ═══ GAME OVER ═══
    function isGameOver() {
        return pieces.every(p => !p || !canFitAny(p));
    }

    async function endGame() {
        active = false;
        sfx('gameover');
        $grid.classList.add('game-over-shake');
        await sleep(500);

        const rec = score === best && score > 0;
        if ($goScore) $goScore.textContent = score.toLocaleString();
        if ($goBest) $goBest.textContent = best.toLocaleString();
        if ($goReward) $goReward.textContent = (score * GOLD_PER_PT).toLocaleString();
        if ($goRecord) $goRecord.style.display = rec ? 'block' : 'none';
        if ($goOverlay) $goOverlay.classList.add('show');

        // Update lines/moves on game-over if present
        const $goLines = document.getElementById('bb-final-lines');
        const $goMoves = document.getElementById('bb-final-moves');
        if ($goLines) $goLines.textContent = linesTotal;
        if ($goMoves) $goMoves.textContent = moves;

        if (score > 0 && token) {
            try {
                const r = await fetch('/api/blockblast/reward', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ score, token, moves })
                });
                const d = await r.json();
                if (d.success) {
                    if ($bal) $bal.textContent = (+d.newBalance).toLocaleString();
                    if ($goReward) $goReward.textContent = d.addedGold.toLocaleString();
                }
            } catch (e) { console.error('[BB] Reward error:', e); }
        }
    }

    // ═══ DRAG & DROP ═══
    function initDrag() {
        $slots.querySelectorAll('.bb-slot').forEach((sl, i) => {
            sl.addEventListener('touchstart', e => startDrag(e, i), { passive: false });
            sl.addEventListener('mousedown', e => startDrag(e, i));
        });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchend', onEnd);
        document.addEventListener('mouseup', onEnd);
    }

    function startDrag(e, idx) {
        if (!active || !pieces[idx]) return;
        e.preventDefault();
        dragPc = pieces[idx]; dragIdx = idx; dragging = true;
        createDragEl(dragPc);
        const t = e.touches ? e.touches[0] : e;
        moveDragEl(t.clientX, t.clientY);
        $slots.querySelectorAll('.bb-slot')[idx]?.classList.add('dragging');
        sfx('pickup');
    }

    function onMove(e) {
        if (!dragging || !dragPc) return;
        e.preventDefault();
        const t = e.touches ? e.touches[0] : e;
        moveDragEl(t.clientX, t.clientY);
        updateGhost(t.clientX, t.clientY);
    }

    function onEnd(e) {
        if (!dragging || !dragPc) return;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        const pos = snapToGrid(t.clientX, t.clientY);

        if (pos && canPlace(dragPc, pos.r, pos.c)) {
            place(dragPc, pos.r, pos.c);
            pieces[dragIdx] = null;
            renderSlots();
            if (pieces.every(p => p === null)) setTimeout(() => genPieces(), 180);
        } else {
            sfx('invalid');
        }

        removeDragEl();
        ghosts = []; lastGhostKey = '';
        paintGhosts();
        dragging = false; dragPc = null; dragIdx = -1;
        $slots.querySelectorAll('.bb-slot').forEach(s => s.classList.remove('dragging'));
    }

    function createDragEl(pc) {
        removeDragEl();
        const el = document.createElement('div');
        el.id = 'bb-drag';
        el.className = 'bb-drag-piece';

        const sz = cellPx();
        el.style.width = pc.cols * sz + 'px';
        el.style.height = pc.rows * sz + 'px';
        el.style.gridTemplateColumns = `repeat(${pc.cols}, ${sz}px)`;
        el.style.gridTemplateRows = `repeat(${pc.rows}, ${sz}px)`;

        for (let r = 0; r < pc.rows; r++) {
            for (let c = 0; c < pc.cols; c++) {
                const d = document.createElement('div');
                const ok = pc.shape.some(([pr, pc2]) => pr === r && pc2 === c);
                if (ok) {
                    const col = COLORS[pc.ci % COLORS.length];
                    d.className = 'bb-drag-cell filled';
                    d.style.background = `linear-gradient(135deg, ${col.lt}, ${col.bg} 55%, ${col.bd})`;
                    d.style.borderColor = col.bd;
                    d.style.boxShadow = `0 2px 12px ${col.gw}, inset 0 1px 0 rgba(255,255,255,.3)`;
                } else {
                    d.className = 'bb-drag-cell empty-cell';
                }
                el.appendChild(d);
            }
        }
        document.body.appendChild(el);
    }

    function removeDragEl() {
        const el = document.getElementById('bb-drag');
        if (el) el.remove();
    }

    function moveDragEl(x, y) {
        const el = document.getElementById('bb-drag');
        if (!el || !dragPc) return;
        const sz = cellPx();
        el.style.left = (x - dragPc.cols * sz / 2) + 'px';
        el.style.top = (y - dragPc.rows * sz / 2 - 70) + 'px';
    }

    function updateGhost(x, y) {
        const pos = snapToGrid(x, y);
        const ng = [];
        validPlacement = false;
        if (pos && dragPc) {
            validPlacement = canPlace(dragPc, pos.r, pos.c);
            for (const [r, c] of dragPc.shape) {
                const gr = pos.r + r, gc = pos.c + c;
                if (gr >= 0 && gr < GRID && gc >= 0 && gc < GRID) ng.push({ r: gr, c: gc });
            }
        }
        const key = ng.map(g => g.r * GRID + g.c).join(',');
        if (key !== lastGhostKey) {
            ghosts = ng; lastGhostKey = key;
            paintGhosts();
        }
    }

    function snapToGrid(x, y) {
        const rect = $grid.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle($grid).paddingLeft) || 8;
        const sz = (rect.width - pad * 2) / GRID;
        const oy = 70; // same as drag offset
        const col = Math.floor((x - rect.left - pad) / sz);
        const row = Math.floor((y - oy - rect.top - pad) / sz);
        if (!dragPc) return null;
        const cr = row - Math.floor(dragPc.rows / 2);
        const cc = col - Math.floor(dragPc.cols / 2);
        const fr = Math.max(0, Math.min(GRID - dragPc.rows, cr));
        const fc = Math.max(0, Math.min(GRID - dragPc.cols, cc));
        // Only return if touch is near grid area
        if (x < rect.left - 30 || x > rect.right + 30 || (y - oy) < rect.top - 30 || (y - oy) > rect.bottom + 30) return null;
        return { r: fr, c: fc };
    }

    function cellPx() {
        if (!$grid) return 40;
        const rect = $grid.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle($grid).paddingLeft) || 8;
        return (rect.width - pad * 2) / GRID;
    }

    // ═══ UI EFFECTS ═══
    function showCombo(v) {
        if (!$combo) return;
        const t = v >= 6 ? '🔱 INSANE!' : v >= 5 ? '🌟 x5!' : v >= 4 ? '⚡ x4!' : v >= 3 ? '💥 COMBO x3!' : '🔥 COMBO x2!';
        $combo.textContent = t;
        $combo.classList.remove('show'); void $combo.offsetWidth; $combo.classList.add('show');
        setTimeout(() => $combo.classList.remove('show'), 1600);
    }

    function floatScore(txt) {
        const el = document.createElement('div');
        el.className = 'bb-float';
        el.textContent = txt;
        const gr = $grid.getBoundingClientRect();
        el.style.left = gr.left + gr.width / 2 + 'px';
        el.style.top = gr.top + gr.height / 2.5 + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1100);
    }

    // ═══ SOUND ═══
    const ac = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
    function sfx(type) {
        if (!ac) return;
        try {
            if (ac.state === 'suspended') ac.resume();
            const o = ac.createOscillator(), g = ac.createGain();
            o.connect(g); g.connect(ac.destination);
            g.gain.setValueAtTime(.07, ac.currentTime);
            g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .3);
            const t = ac.currentTime;
            switch (type) {
                case 'place':
                    o.frequency.setValueAtTime(520, t);
                    o.frequency.exponentialRampToValueAtTime(720, t + .07);
                    o.type = 'sine'; break;
                case 'clear':
                    o.frequency.setValueAtTime(600, t);
                    o.frequency.exponentialRampToValueAtTime(1100, t + .15);
                    o.type = 'triangle'; g.gain.setValueAtTime(.1, t); break;
                case 'multi':
                    o.frequency.setValueAtTime(700, t);
                    o.frequency.exponentialRampToValueAtTime(1500, t + .2);
                    o.type = 'triangle'; g.gain.setValueAtTime(.11, t); break;
                case 'combo':
                    o.frequency.setValueAtTime(800, t);
                    o.frequency.exponentialRampToValueAtTime(1600, t + .2);
                    o.type = 'square'; g.gain.setValueAtTime(.05, t); break;
                case 'pickup':
                    o.frequency.setValueAtTime(400, t);
                    o.frequency.exponentialRampToValueAtTime(520, t + .05);
                    o.type = 'sine'; g.gain.setValueAtTime(.04, t); break;
                case 'invalid':
                    o.frequency.setValueAtTime(200, t);
                    o.frequency.exponentialRampToValueAtTime(140, t + .12);
                    o.type = 'sawtooth'; g.gain.setValueAtTime(.035, t); break;
                case 'gameover':
                    o.frequency.setValueAtTime(380, t);
                    o.frequency.exponentialRampToValueAtTime(90, t + .5);
                    o.type = 'sawtooth'; g.gain.setValueAtTime(.07, t);
                    g.gain.exponentialRampToValueAtTime(.001, t + .5); break;
                default:
                    o.frequency.setValueAtTime(440, t);
            }
            o.start(t); o.stop(t + .5);
        } catch (e) { }
    }

    // ═══ GAME FLOW ═══
    async function startGame() {
        createGrid(); pieces = [null, null, null];
        score = 0; combo = 0; linesTotal = 0; moves = 0;
        active = true; particles = [];

        if ($score) $score.textContent = '0';
        if ($best) $best.textContent = best.toLocaleString();
        if ($goOverlay) $goOverlay.classList.remove('show');
        $grid.classList.remove('game-over-shake');

        buildGridDOM();
        paintGrid();
        genPieces();

        try {
            const r = await fetch('/api/blockblast/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
            });
            token = (await r.json()).token;
        } catch (e) { token = null; }
        fetchBal();
    }

    async function fetchBal() {
        try {
            const r = await fetch('/api/me');
            const d = await r.json();
            if ($bal && d.balance != null) $bal.textContent = (+d.balance).toLocaleString();
        } catch (e) { }
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ═══ INIT ═══
    function init() {
        $grid = document.getElementById('bb-grid');
        $slots = document.getElementById('bb-slots');
        $score = document.getElementById('bb-score');
        $best = document.getElementById('bb-best');
        $combo = document.getElementById('bb-combo');
        $bal = document.getElementById('bb-balance');
        $goOverlay = document.getElementById('bb-gameover');
        $goScore = document.getElementById('bb-final-score');
        $goReward = document.getElementById('bb-final-reward');
        $goBest = document.getElementById('bb-final-best');
        $goRecord = document.getElementById('bb-new-record');
        $particles = document.getElementById('bb-particles');

        if ($particles) {
            pCtx = $particles.getContext('2d');
            sizeCanvas();
            window.addEventListener('resize', sizeCanvas);
        }

        document.getElementById('bb-restart')?.addEventListener('click', () => startGame());
        initDrag();
        startGame();
    }

    function sizeCanvas() {
        if (!$particles) return;
        const r = $particles.parentElement.getBoundingClientRect();
        $particles.width = r.width;
        $particles.height = r.height;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
