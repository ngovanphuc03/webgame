// ═══════════════════════════════════════════════════════════
//  BLOCK BLAST — Premium Puzzle Game Engine
//  Pixel PlayZone © 2026
// ═══════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ═══ CONSTANTS ═══
    const GRID_SIZE = 8;
    const CELL_EMPTY = 0;
    const REWARD_PER_POINT = 5; // 1 score = 5 gold

    // ═══ PIECE DEFINITIONS ═══
    // Each piece: { shape: [[r,c],...], color: idx }
    const PIECE_DEFS = [
        // Single
        { shape: [[0, 0]], id: 'dot' },
        // Lines
        { shape: [[0, 0], [0, 1]], id: 'h2' },
        { shape: [[0, 0], [1, 0]], id: 'v2' },
        { shape: [[0, 0], [0, 1], [0, 2]], id: 'h3' },
        { shape: [[0, 0], [1, 0], [2, 0]], id: 'v3' },
        { shape: [[0, 0], [0, 1], [0, 2], [0, 3]], id: 'h4' },
        { shape: [[0, 0], [1, 0], [2, 0], [3, 0]], id: 'v4' },
        { shape: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], id: 'h5' },
        { shape: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], id: 'v5' },
        // Squares
        { shape: [[0, 0], [0, 1], [1, 0], [1, 1]], id: 'sq2' },
        { shape: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], id: 'sq3' },
        // L-shapes
        { shape: [[0, 0], [1, 0], [1, 1]], id: 'L1' },
        { shape: [[0, 0], [0, 1], [1, 0]], id: 'L2' },
        { shape: [[0, 0], [0, 1], [1, 1]], id: 'L3' },
        { shape: [[0, 0], [1, 0], [1, -1]], id: 'L4' },
        // Big L
        { shape: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], id: 'bigL1' },
        { shape: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], id: 'bigL2' },
        { shape: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], id: 'bigL3' },
        { shape: [[0, 0], [1, 0], [2, 0], [2, -1], [2, -2]], id: 'bigL4' },
        // T-shapes
        { shape: [[0, 0], [0, 1], [0, 2], [1, 1]], id: 'T1' },
        { shape: [[0, 0], [1, 0], [2, 0], [1, 1]], id: 'T2' },
        { shape: [[0, 1], [1, 0], [1, 1], [1, 2]], id: 'T3' },
        { shape: [[0, 0], [1, 0], [2, 0], [1, -1]], id: 'T4' },
        // S/Z shapes  
        { shape: [[0, 0], [0, 1], [1, 1], [1, 2]], id: 'S1' },
        { shape: [[0, 1], [0, 2], [1, 0], [1, 1]], id: 'Z1' },
        { shape: [[0, 0], [1, 0], [1, 1], [2, 1]], id: 'S2' },
        { shape: [[0, 1], [1, 0], [1, 1], [2, 0]], id: 'Z2' },
        // Corner 3x3
        { shape: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], id: 'corner1' },
        { shape: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], id: 'corner2' },
        { shape: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], id: 'corner3' },
        { shape: [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], id: 'corner4' },
    ];

    // Vibrant color palette for blocks — cheerful but not eye-straining
    const BLOCK_COLORS = [
        { bg: '#FF6B6B', border: '#E05252', glow: 'rgba(255,107,107,.35)', light: '#FF8A8A' },  // Coral Red
        { bg: '#4ECDC4', border: '#38B2A9', glow: 'rgba(78,205,196,.35)', light: '#6FE0D8' },   // Teal
        { bg: '#FFD93D', border: '#E6C235', glow: 'rgba(255,217,61,.35)', light: '#FFE16A' },    // Sunny Yellow
        { bg: '#6C5CE7', border: '#5A4BD6', glow: 'rgba(108,92,231,.35)', light: '#8577ED' },    // Purple  
        { bg: '#A8E6CF', border: '#8DD1B7', glow: 'rgba(168,230,207,.35)', light: '#C0F0DE' },   // Mint Green
        { bg: '#FF8A5C', border: '#E67A4E', glow: 'rgba(255,138,92,.35)', light: '#FFA47A' },    // Orange
        { bg: '#F38181', border: '#E06B6B', glow: 'rgba(243,129,129,.35)', light: '#F6A0A0' },   // Rose
        { bg: '#00B8D4', border: '#009DB5', glow: 'rgba(0,184,212,.35)', light: '#33CAE0' },     // Cyan
        { bg: '#7C4DFF', border: '#6B3DE6', glow: 'rgba(124,77,255,.35)', light: '#9670FF' },    // Deep Purple
        { bg: '#FF6F00', border: '#E66300', glow: 'rgba(255,111,0,.35)', light: '#FF8F33' },     // Amber
    ];

    // ═══ GAME STATE ═══
    let grid = [];
    let currentPieces = [null, null, null]; // 3 piece slots
    let score = 0;
    let bestScore = parseInt(localStorage.getItem('bb_best') || '0');
    let combo = 0;
    let totalLinesCleared = 0;
    let moveCount = 0;
    let gameActive = false;
    let gameToken = null;
    let gameStartTime = 0;

    // Drag state
    let dragPiece = null;
    let dragSlotIdx = -1;
    let dragOffsetR = 0;
    let dragOffsetC = 0;
    let ghostCells = [];
    let isDragging = false;

    // DOM refs
    let gridEl, slotsEl, scoreEl, bestEl, comboEl, balanceEl;
    let gameOverOverlay, finalScoreEl, finalRewardEl, finalBestEl, newRecordEl;
    let particleCanvas, pCtx;

    // ═══ PARTICLES ═══
    let particles = [];
    class Particle {
        constructor(x, y, color) {
            this.x = x; this.y = y;
            this.vx = (Math.random() - .5) * 8;
            this.vy = (Math.random() - .5) * 8 - 2;
            this.size = Math.random() * 6 + 2;
            this.color = color;
            this.life = 1;
            this.decay = Math.random() * .02 + .015;
            this.gravity = .12;
            this.rotation = Math.random() * Math.PI * 2;
            this.rotSpeed = (Math.random() - .5) * .2;
        }
        update() {
            this.x += this.vx;
            this.vy += this.gravity;
            this.y += this.vy;
            this.life -= this.decay;
            this.rotation += this.rotSpeed;
            this.vx *= .98;
            return this.life > 0;
        }
        draw(ctx) {
            ctx.save();
            ctx.globalAlpha = this.life;
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation);
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 6;
            ctx.shadowColor = this.color;
            const h = this.size / 2;
            ctx.fillRect(-h, -h, this.size, this.size);
            ctx.restore();
        }
    }

    function spawnParticles(x, y, color, count = 12) {
        for (let i = 0; i < count; i++) {
            particles.push(new Particle(x, y, color));
        }
    }

    function animateParticles() {
        if (!pCtx) return;
        pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
        particles = particles.filter(p => {
            p.draw(pCtx);
            return p.update();
        });
        if (particles.length > 0) requestAnimationFrame(animateParticles);
    }

    function startParticleLoop() {
        if (particles.length > 0) requestAnimationFrame(animateParticles);
    }

    // ═══ GRID HELPERS ═══
    function createGrid() {
        grid = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            grid[r] = [];
            for (let c = 0; c < GRID_SIZE; c++) {
                grid[r][c] = CELL_EMPTY;
            }
        }
    }

    function renderGrid() {
        if (!gridEl) return;
        gridEl.innerHTML = '';
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                const cell = document.createElement('div');
                cell.className = 'bb-cell';
                cell.dataset.r = r;
                cell.dataset.c = c;
                if (grid[r][c] !== CELL_EMPTY) {
                    const color = BLOCK_COLORS[(grid[r][c] - 1) % BLOCK_COLORS.length];
                    cell.classList.add('filled');
                    cell.style.background = `linear-gradient(135deg, ${color.light} 0%, ${color.bg} 50%, ${color.border} 100%)`;
                    cell.style.borderColor = color.border;
                    cell.style.boxShadow = `0 0 8px ${color.glow}, inset 0 1px 0 rgba(255,255,255,.3)`;
                } else {
                    // Check if ghost
                    const isGhost = ghostCells.some(g => g.r === r && g.c === c);
                    if (isGhost && dragPiece) {
                        const color = BLOCK_COLORS[(dragPiece.colorIdx) % BLOCK_COLORS.length];
                        cell.classList.add('ghost');
                        cell.style.background = `${color.bg}33`;
                        cell.style.borderColor = `${color.bg}66`;
                    }
                }
                gridEl.appendChild(cell);
            }
        }
    }

    // ═══ PIECE GENERATION ═══
    function randomPiece() {
        const def = PIECE_DEFS[Math.floor(Math.random() * PIECE_DEFS.length)];
        const colorIdx = Math.floor(Math.random() * BLOCK_COLORS.length);
        // Normalize shape so min r,c = 0
        let minR = Infinity, minC = Infinity;
        def.shape.forEach(([r, c]) => { minR = Math.min(minR, r); minC = Math.min(minC, c); });
        const shape = def.shape.map(([r, c]) => [r - minR, c - minC]);
        let maxR = 0, maxC = 0;
        shape.forEach(([r, c]) => { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); });
        return { shape, colorIdx, rows: maxR + 1, cols: maxC + 1, id: def.id };
    }

    function generateNewPieces() {
        for (let i = 0; i < 3; i++) {
            if (currentPieces[i] === null) {
                currentPieces[i] = randomPiece();
            }
        }
        renderSlots();
    }

    function renderSlots() {
        if (!slotsEl) return;
        const slots = slotsEl.querySelectorAll('.bb-slot');
        slots.forEach((slot, idx) => {
            const preview = slot.querySelector('.bb-slot-preview');
            preview.innerHTML = '';
            const piece = currentPieces[idx];
            if (!piece) {
                slot.classList.add('empty');
                return;
            }
            slot.classList.remove('empty');
            const cellSize = Math.min(36, Math.floor(120 / Math.max(piece.rows, piece.cols)));
            preview.style.width = (piece.cols * cellSize) + 'px';
            preview.style.height = (piece.rows * cellSize) + 'px';
            preview.style.gridTemplateColumns = `repeat(${piece.cols}, ${cellSize}px)`;
            preview.style.gridTemplateRows = `repeat(${piece.rows}, ${cellSize}px)`;

            // Create all cells in the bounding box
            for (let r = 0; r < piece.rows; r++) {
                for (let c = 0; c < piece.cols; c++) {
                    const cell = document.createElement('div');
                    const isFilled = piece.shape.some(([pr, pc]) => pr === r && pc === c);
                    if (isFilled) {
                        const color = BLOCK_COLORS[piece.colorIdx % BLOCK_COLORS.length];
                        cell.className = 'bb-mini-cell filled';
                        cell.style.background = `linear-gradient(135deg, ${color.light} 0%, ${color.bg} 50%, ${color.border} 100%)`;
                        cell.style.borderColor = color.border;
                        cell.style.boxShadow = `0 0 4px ${color.glow}, inset 0 1px 0 rgba(255,255,255,.25)`;
                    } else {
                        cell.className = 'bb-mini-cell transparent';
                    }
                    preview.appendChild(cell);
                }
            }
        });
    }

    // ═══ PLACEMENT LOGIC ═══
    function canPlace(piece, targetR, targetC) {
        for (const [r, c] of piece.shape) {
            const gr = targetR + r;
            const gc = targetC + c;
            if (gr < 0 || gr >= GRID_SIZE || gc < 0 || gc >= GRID_SIZE) return false;
            if (grid[gr][gc] !== CELL_EMPTY) return false;
        }
        return true;
    }

    function placePiece(piece, targetR, targetC) {
        const colorVal = piece.colorIdx + 1;
        const placedCells = [];
        for (const [r, c] of piece.shape) {
            grid[targetR + r][targetC + c] = colorVal;
            placedCells.push({ r: targetR + r, c: targetC + c });
        }
        moveCount++;
        // Animate placed cells
        requestAnimationFrame(() => {
            placedCells.forEach(({ r, c }, i) => {
                const cellEl = gridEl.querySelector(`.bb-cell[data-r="${r}"][data-c="${c}"]`);
                if (cellEl) {
                    cellEl.style.animationDelay = `${i * 30}ms`;
                    cellEl.classList.add('just-placed');
                }
            });
        });

        // Play place sound
        playSound('place');

        // Check and clear lines
        setTimeout(() => {
            const cleared = checkAndClearLines();
            updateScore(piece.shape.length, cleared);
            renderGrid();

            // Check if all 3 pieces are used → generate new set
            if (currentPieces.every(p => p === null)) {
                generateNewPieces();
            }

            // Check game over
            if (isGameOver()) {
                endGame();
            }
        }, 150);
    }

    function checkAndClearLines() {
        const rowsToClear = [];
        const colsToClear = [];

        // Check rows
        for (let r = 0; r < GRID_SIZE; r++) {
            if (grid[r].every(c => c !== CELL_EMPTY)) rowsToClear.push(r);
        }
        // Check columns
        for (let c = 0; c < GRID_SIZE; c++) {
            let full = true;
            for (let r = 0; r < GRID_SIZE; r++) {
                if (grid[r][c] === CELL_EMPTY) { full = false; break; }
            }
            if (full) colsToClear.push(c);
        }

        const totalCleared = rowsToClear.length + colsToClear.length;
        if (totalCleared === 0) {
            combo = 0;
            return 0;
        }

        // Collect cells to clear (union of rows and cols)
        const cellsToClear = new Set();
        rowsToClear.forEach(r => {
            for (let c = 0; c < GRID_SIZE; c++) cellsToClear.add(`${r},${c}`);
        });
        colsToClear.forEach(c => {
            for (let r = 0; r < GRID_SIZE; r++) cellsToClear.add(`${r},${c}`);
        });

        // Spawn particles at each cleared cell
        cellsToClear.forEach(key => {
            const [r, c] = key.split(',').map(Number);
            const colorVal = grid[r][c];
            const color = BLOCK_COLORS[(colorVal - 1) % BLOCK_COLORS.length];
            const cellEl = gridEl.querySelector(`.bb-cell[data-r="${r}"][data-c="${c}"]`);
            if (cellEl && particleCanvas) {
                const rect = cellEl.getBoundingClientRect();
                const canvasRect = particleCanvas.getBoundingClientRect();
                const cx = rect.left + rect.width / 2 - canvasRect.left;
                const cy = rect.top + rect.height / 2 - canvasRect.top;
                spawnParticles(cx, cy, color.bg, 6);
            }
        });
        startParticleLoop();

        // Animate clearing
        cellsToClear.forEach(key => {
            const [r, c] = key.split(',').map(Number);
            const cellEl = gridEl.querySelector(`.bb-cell[data-r="${r}"][data-c="${c}"]`);
            if (cellEl) {
                cellEl.classList.add('clearing');
            }
        });

        // Clear grid after animation
        setTimeout(() => {
            cellsToClear.forEach(key => {
                const [r, c] = key.split(',').map(Number);
                grid[r][c] = CELL_EMPTY;
            });
            renderGrid();
        }, 300);

        combo++;
        totalLinesCleared += totalCleared;

        // Play clear sound
        playSound(totalCleared >= 2 ? 'multi_clear' : 'clear');

        // Show combo popup
        if (combo > 1) {
            showCombo(combo);
            playSound('combo');
        }

        // Screen shake for big clears
        if (totalCleared >= 2) {
            gridEl.classList.add('shake');
            setTimeout(() => gridEl.classList.remove('shake'), 400);
        }

        return totalCleared;
    }

    function updateScore(placedBlocks, linesCleared) {
        // Points for placing blocks
        let points = placedBlocks;

        // Points per line cleared: 10 per line
        if (linesCleared > 0) {
            points += linesCleared * 10;
            // Bonus for multi-line: 2 lines = +5, 3 = +15, 4+ = +30
            if (linesCleared >= 4) points += 30;
            else if (linesCleared >= 3) points += 15;
            else if (linesCleared >= 2) points += 5;
        }

        // Combo multiplier
        if (combo > 1) {
            points = Math.floor(points * (1 + combo * 0.5));
        }

        score += points;
        if (score > bestScore) {
            bestScore = score;
            localStorage.setItem('bb_best', bestScore.toString());
        }

        // Animate score
        if (scoreEl) {
            scoreEl.textContent = score.toLocaleString();
            scoreEl.classList.remove('bump');
            void scoreEl.offsetWidth;
            scoreEl.classList.add('bump');
        }
        if (bestEl) bestEl.textContent = bestScore.toLocaleString();

        // Show floating score text
        if (points > 5 && linesCleared > 0) {
            showFloatingScore(`+${points}`);
        }
    }

    // ═══ GAME OVER ═══
    function isGameOver() {
        for (let i = 0; i < 3; i++) {
            const piece = currentPieces[i];
            if (!piece) continue;
            // Check if this piece can be placed anywhere
            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    if (canPlace(piece, r, c)) return false;
                }
            }
        }
        return true;
    }

    async function endGame() {
        gameActive = false;
        playSound('gameover');

        // Shake the grid
        gridEl.classList.add('game-over-shake');

        // Wait a moment then show overlay
        await sleep(600);

        const isNewRecord = score === bestScore && score > 0;

        if (finalScoreEl) finalScoreEl.textContent = score.toLocaleString();
        if (finalBestEl) finalBestEl.textContent = bestScore.toLocaleString();
        if (finalRewardEl) finalRewardEl.textContent = (score * REWARD_PER_POINT).toLocaleString();
        if (newRecordEl) newRecordEl.style.display = isNewRecord ? 'block' : 'none';

        if (gameOverOverlay) {
            gameOverOverlay.classList.add('show');
        }

        // Claim reward from server
        if (score > 0 && gameToken) {
            try {
                const res = await fetch('/api/blockblast/reward', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ score, token: gameToken, moves: moveCount })
                });
                const data = await res.json();
                if (data.success) {
                    if (balanceEl) balanceEl.textContent = Number(data.newBalance).toLocaleString();
                    if (finalRewardEl) finalRewardEl.textContent = data.addedGold.toLocaleString();
                }
            } catch (e) {
                console.error('[BlockBlast] Reward error:', e);
            }
        }
    }

    // ═══ DRAG & DROP ═══
    function initDragDrop() {
        const slots = slotsEl.querySelectorAll('.bb-slot');

        slots.forEach((slot, idx) => {
            // Touch events
            slot.addEventListener('touchstart', (e) => startDrag(e, idx), { passive: false });

            // Mouse events
            slot.addEventListener('mousedown', (e) => startDrag(e, idx));
        });

        // Global move/end
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('touchend', onDragEnd);
        document.addEventListener('mouseup', onDragEnd);
    }

    function startDrag(e, slotIdx) {
        if (!gameActive || !currentPieces[slotIdx]) return;
        e.preventDefault();

        dragPiece = currentPieces[slotIdx];
        dragSlotIdx = slotIdx;
        isDragging = true;

        // Create floating drag element
        createDragElement(dragPiece);

        // Calculate initial offset — center piece at touch/mouse
        const touch = e.touches ? e.touches[0] : e;
        updateDragPosition(touch.clientX, touch.clientY);

        // Add visual feedback to slot
        const slot = slotsEl.querySelectorAll('.bb-slot')[slotIdx];
        if (slot) slot.classList.add('dragging');

        playSound('pickup');
    }

    function onDragMove(e) {
        if (!isDragging || !dragPiece) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        updateDragPosition(touch.clientX, touch.clientY);
        updateGhostPreview(touch.clientX, touch.clientY);
    }

    function onDragEnd(e) {
        if (!isDragging || !dragPiece) return;

        const touch = e.changedTouches ? e.changedTouches[0] : e;
        const gridPos = getGridPosition(touch.clientX, touch.clientY);

        if (gridPos && canPlace(dragPiece, gridPos.r, gridPos.c)) {
            placePiece(dragPiece, gridPos.r, gridPos.c);
            currentPieces[dragSlotIdx] = null;
            renderSlots();

            // Check if all pieces used → generate new batch
            if (currentPieces.every(p => p === null)) {
                setTimeout(() => generateNewPieces(), 200);
            }
        } else {
            // Failed placement — bounce back
            playSound('invalid');
        }

        // Cleanup
        removeDragElement();
        ghostCells = [];
        renderGrid();
        isDragging = false;
        dragPiece = null;
        dragSlotIdx = -1;

        // Remove slot feedback
        slotsEl.querySelectorAll('.bb-slot').forEach(s => s.classList.remove('dragging'));
    }

    function createDragElement(piece) {
        removeDragElement();
        const el = document.createElement('div');
        el.id = 'bb-drag-piece';
        el.className = 'bb-drag-piece';

        const cellSize = getCellSize();
        el.style.width = (piece.cols * cellSize) + 'px';
        el.style.height = (piece.rows * cellSize) + 'px';
        el.style.gridTemplateColumns = `repeat(${piece.cols}, ${cellSize}px)`;
        el.style.gridTemplateRows = `repeat(${piece.rows}, ${cellSize}px)`;

        for (let r = 0; r < piece.rows; r++) {
            for (let c = 0; c < piece.cols; c++) {
                const cell = document.createElement('div');
                const isFilled = piece.shape.some(([pr, pc]) => pr === r && pc === c);
                if (isFilled) {
                    const color = BLOCK_COLORS[piece.colorIdx % BLOCK_COLORS.length];
                    cell.className = 'bb-drag-cell filled';
                    cell.style.background = `linear-gradient(135deg, ${color.light} 0%, ${color.bg} 50%, ${color.border} 100%)`;
                    cell.style.borderColor = color.border;
                    cell.style.boxShadow = `0 0 10px ${color.glow}, inset 0 1px 0 rgba(255,255,255,.3)`;
                } else {
                    cell.className = 'bb-drag-cell transparent';
                }
                el.appendChild(cell);
            }
        }

        document.body.appendChild(el);
    }

    function removeDragElement() {
        const el = document.getElementById('bb-drag-piece');
        if (el) el.remove();
    }

    function updateDragPosition(clientX, clientY) {
        const el = document.getElementById('bb-drag-piece');
        if (!el) return;
        const cellSize = getCellSize();
        const offsetX = (dragPiece.cols * cellSize) / 2;
        // Offset upward so user can see piece above finger
        const offsetY = (dragPiece.rows * cellSize) / 2 + 60;
        el.style.left = (clientX - offsetX) + 'px';
        el.style.top = (clientY - offsetY) + 'px';
    }

    function updateGhostPreview(clientX, clientY) {
        const pos = getGridPosition(clientX, clientY);
        const newGhost = [];
        if (pos && dragPiece && canPlace(dragPiece, pos.r, pos.c)) {
            for (const [r, c] of dragPiece.shape) {
                newGhost.push({ r: pos.r + r, c: pos.c + c });
            }
        }

        // Only re-render if ghost changed
        const ghostKey = newGhost.map(g => `${g.r},${g.c}`).join('|');
        const oldKey = ghostCells.map(g => `${g.r},${g.c}`).join('|');
        if (ghostKey !== oldKey) {
            ghostCells = newGhost;
            renderGrid();
        }
    }

    function getGridPosition(clientX, clientY) {
        const gridRect = gridEl.getBoundingClientRect();
        const cellSize = getCellSize();
        // Position relative to finger offset
        const offsetY = 60; // same offset as drag piece
        const adjustedY = clientY - offsetY;

        const c = Math.floor((clientX - gridRect.left) / cellSize);
        const r = Math.floor((adjustedY - gridRect.top) / cellSize);

        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return null;

        // Adjust for piece shape — find best snap position
        if (!dragPiece) return null;

        // Center the piece on the grid cell
        const centerR = r - Math.floor(dragPiece.rows / 2);
        const centerC = c - Math.floor(dragPiece.cols / 2);

        // Clamp to valid range
        const clampR = Math.max(0, Math.min(GRID_SIZE - dragPiece.rows, centerR));
        const clampC = Math.max(0, Math.min(GRID_SIZE - dragPiece.cols, centerC));

        return { r: clampR, c: clampC };
    }

    function getCellSize() {
        if (!gridEl) return 40;
        const rect = gridEl.getBoundingClientRect();
        return rect.width / GRID_SIZE;
    }

    // ═══ UI EFFECTS ═══
    function showCombo(comboVal) {
        if (!comboEl) return;
        const texts = ['', '', 'COMBO x2! 🔥', 'COMBO x3! 💥', 'COMBO x4! ⚡', 'COMBO x5! 🌟', 'INSANE! 🔱'];
        const text = comboVal >= 6 ? texts[6] : texts[comboVal] || `COMBO x${comboVal}!`;
        comboEl.textContent = text;
        comboEl.classList.remove('show');
        void comboEl.offsetWidth;
        comboEl.classList.add('show');
        setTimeout(() => comboEl.classList.remove('show'), 1500);
    }

    function showFloatingScore(text) {
        const el = document.createElement('div');
        el.className = 'bb-float-score';
        el.textContent = text;
        const gridRect = gridEl.getBoundingClientRect();
        el.style.left = (gridRect.left + gridRect.width / 2) + 'px';
        el.style.top = (gridRect.top + gridRect.height / 2) + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }

    // ═══ SOUND (lightweight) ═══
    const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
    function playSound(type) {
        if (!audioCtx) return;
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

            switch (type) {
                case 'place':
                    osc.frequency.setValueAtTime(520, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(680, audioCtx.currentTime + 0.08);
                    osc.type = 'sine';
                    break;
                case 'clear':
                    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.15);
                    osc.type = 'triangle';
                    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
                    break;
                case 'multi_clear':
                    osc.frequency.setValueAtTime(700, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(1400, audioCtx.currentTime + 0.25);
                    osc.type = 'triangle';
                    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
                    break;
                case 'combo':
                    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(1600, audioCtx.currentTime + 0.2);
                    osc.type = 'square';
                    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
                    break;
                case 'pickup':
                    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(500, audioCtx.currentTime + 0.05);
                    osc.type = 'sine';
                    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                    break;
                case 'invalid':
                    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.15);
                    osc.type = 'sawtooth';
                    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
                    break;
                case 'gameover':
                    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
                    osc.type = 'sawtooth';
                    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
                    break;
                default:
                    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
            }

            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.5);
        } catch (e) { }
    }

    // ═══ GAME FLOW ═══
    async function startGame() {
        // Reset state
        createGrid();
        currentPieces = [null, null, null];
        score = 0;
        combo = 0;
        totalLinesCleared = 0;
        moveCount = 0;
        gameActive = true;
        particles = [];

        if (scoreEl) scoreEl.textContent = '0';
        if (bestEl) bestEl.textContent = bestScore.toLocaleString();
        if (gameOverOverlay) gameOverOverlay.classList.remove('show');
        gridEl.classList.remove('game-over-shake');

        renderGrid();
        generateNewPieces();

        gameStartTime = Date.now();

        // Get anti-cheat token
        try {
            const res = await fetch('/api/blockblast/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            gameToken = data.token;
        } catch (e) {
            console.warn('[BlockBlast] Could not get session token:', e);
            gameToken = null;
        }

        // Fetch balance
        fetchBalance();
    }

    async function fetchBalance() {
        try {
            const res = await fetch('/api/me');
            const data = await res.json();
            if (balanceEl && data.balance !== undefined) {
                balanceEl.textContent = Number(data.balance).toLocaleString();
            }
        } catch (e) { }
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ═══ INIT ═══
    function init() {
        gridEl = document.getElementById('bb-grid');
        slotsEl = document.getElementById('bb-slots');
        scoreEl = document.getElementById('bb-score');
        bestEl = document.getElementById('bb-best');
        comboEl = document.getElementById('bb-combo');
        balanceEl = document.getElementById('bb-balance');
        gameOverOverlay = document.getElementById('bb-gameover');
        finalScoreEl = document.getElementById('bb-final-score');
        finalRewardEl = document.getElementById('bb-final-reward');
        finalBestEl = document.getElementById('bb-final-best');
        newRecordEl = document.getElementById('bb-new-record');
        particleCanvas = document.getElementById('bb-particles');

        if (particleCanvas) {
            pCtx = particleCanvas.getContext('2d');
            resizeParticleCanvas();
            window.addEventListener('resize', resizeParticleCanvas);
        }

        // Restart button
        const restartBtn = document.getElementById('bb-restart');
        if (restartBtn) restartBtn.addEventListener('click', () => startGame());

        // Initialize drag & drop
        initDragDrop();

        // Start!
        startGame();
    }

    function resizeParticleCanvas() {
        if (!particleCanvas) return;
        const rect = particleCanvas.parentElement.getBoundingClientRect();
        particleCanvas.width = rect.width;
        particleCanvas.height = rect.height;
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
