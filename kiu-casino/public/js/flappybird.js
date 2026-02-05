const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ASSETS & CONFIG ---
const assets = {
    birds: ['blue', 'red', 'yellow'],
    pipes: ['pipe-green', 'pipe-red'],
    bgs: ['bg-day', 'bg-night'],
    currBirdColor: 'blue',
    currPipeId: 'pipe-green',
    currBgId: 'bg-day'
};

// Sound Effects
const sounds = {
    wing: new Audio('sounds/flappy/wing.wav'),
    hit: new Audio('sounds/flappy/hit.wav'),
    die: new Audio('sounds/flappy/die.wav'),
    point: new Audio('sounds/flappy/point.wav'),
    swoosh: new Audio('sounds/flappy/swoosh.wav')
};

// --- GAME CONSTANTS ---
// We keep LOGICAL_WIDTH as a reference for spacing, but height is now dynamic.
const ASSET_WIDTH = 288;
const BASE_HEIGHT = 512; // Reference height for max scale cap
const GROUND_H = 112;
const GRAVITY = 0.18;      // Reduced from 0.25 - bird falls slower
const JUMP = -4;           // Adjusted jump strength
const PIPE_SPEED = 1.5;    // Reduced from 2 - pipes move slower
const PIPE_GAP = 170;      // Increased from 140 - wider gap between pipes

// -- STATE --
let gameScale = 1;
// Dynamic playground dimensions in logical pixels
let logicalW = 0;
let logicalH = 0;

let frames = 0;
let score = 0;
let bestScore = parseInt(localStorage.getItem('flappy_best')) || 0;
let gameState = 'START';
let pipes = [];
let loopId = null;

const uiStart = document.getElementById('start-message');
const uiGameOver = document.getElementById('game-over');
const uiLoading = document.getElementById('loadingScreen');
const uiGoldEarned = document.getElementById('gold-earned');
const uiFinalScore = document.getElementById('final-score');

let gameSessionToken = null; // Anti-cheat token

// -- RESIZE HANDLER --
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Calculate Scale
    // on Mobile (< 600px wide), we might want to fill more?
    // on Desktop, cap the scale so it doesn't look huge.

    // Standard Scale: always fit vertical height to 512px logical height
    // This ensures consistent gameplay feel regardless of resolution
    let scale = canvas.height / BASE_HEIGHT;

    // Optional: clamp slightly if super tall? No, standard behavior is fill height.
    gameScale = scale;

    logicalW = canvas.width / gameScale;
    logicalH = canvas.height / gameScale;

    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- LOGIC HELPERS ---
function playSound(s) {
    if (sounds[s]) {
        if (s === 'wing' || s === 'point') {
            const soundClone = sounds[s].cloneNode();
            soundClone.volume = 0.6;
            soundClone.play().catch(e => { });
        } else {
            sounds[s].play().catch(e => { });
        }
    }
}

function randomizeTheme() {
    assets.currBirdColor = assets.birds[Math.floor(Math.random() * assets.birds.length)];
    assets.currPipeId = assets.pipes[Math.floor(Math.random() * assets.pipes.length)];
    assets.currBgId = assets.bgs[Math.floor(Math.random() * assets.bgs.length)];
}

// --- CLASSES ---
class Background {
    constructor() { this.x = 0; this.groundX = 0; }

    drawBg() {
        const bgImg = document.getElementById(assets.currBgId);
        if (!bgImg) return;

        let sw = 288;
        let sh = 512; // Asset height
        // Draw mostly bottom aligned or top aligned? 
        // Flappy bird usually aligns bottom content (city) to ground.
        // But the sky stretches.

        // Let's draw it aligned to the bottom (just above ground)
        // Or stretch? Asset is 512 high.
        // If logicalH > 512, we have extra sky.
        // We should draw the BG such that the bottom lines up with the ground.

        const groundY = logicalH - GROUND_H;
        // The BG image contains text/sky at top and city at bottom.
        // We want the city part to sit on the ground.
        // BG image usually matches logical height logic.

        // If we just draw from top=0, and visualH > 512, we might see gap at bottom?
        // Actually, logicalH might be >> 512.
        // Let's draw repeated BG across X. Y position?
        // Let's align BG bottom to Ground Top.
        // BG height is 512. Ground is 112.

        // Correction: BG image usually includes the ground? No, separate.

        let bgY = logicalH - sh;
        if (bgY > 0) bgY = 0; // If screen is short, crop top.
        // If screen is tall (logicalH > 512), bgY is positive (gap at top).
        // Standard flappy bg is just sky.
        // We can fill top with color matching sky? #70c5ce (Day) or #008793 (Night)
        // Or just stretch? Pixel art stretch is bad.
        // We'll align to bottom.

        // Better: Align to bottom of "World" (which is logicalH).
        // Since Ground covers bottom 112, BG should sit at logicalH - 112 (Ground Top)? 
        // No, standard BG assets usually go down to bottom of screen behind ground.
        // Let's align BG bottom to logicalH.
        bgY = logicalH - sh;

        // Fill sky color if needed
        if (bgY > 0) {
            ctx.fillStyle = assets.currBgId.includes('day') ? '#70c5ce' : '#008793';
            ctx.fillRect(0, 0, logicalW, bgY + 2); // +2 overlap
        }

        const num = Math.ceil(logicalW / sw) + 1;
        for (let i = 0; i < num; i++) {
            ctx.drawImage(bgImg, this.x + i * sw, bgY, sw, sh);
        }
    }

    drawGround() {
        const gImg = document.getElementById('ground');
        if (!gImg) return;

        let sw = 336;
        const groundY = logicalH - GROUND_H;
        const num = Math.ceil(logicalW / sw) + 1;

        let renderX = this.groundX % sw;
        for (let i = -1; i < num; i++) {
            ctx.drawImage(gImg, renderX + i * sw, groundY, sw, 112);
        }
    }

    update() {
        if (gameState !== 'GAMEOVER') {
            this.groundX -= PIPE_SPEED;
            if (this.groundX <= -336) this.groundX += 336;
        }
    }
}

class Bird {
    constructor() {
        this.x = 50;
        this.y = (logicalH / 2); // Center of active space?
        this.w = 34; this.h = 24;
        this.velocity = 0; this.frameIndex = 0; this.tick = 0; this.rotation = 0;
    }
    update() {
        if (gameState === 'START') {
            this.y = (logicalH / 2) - 20 + Math.sin(frames * 0.1) * 5;
            if (frames % 10 === 0) this.frameIndex = (this.frameIndex + 1) % 3;
            this.velocity = 0; this.rotation = 0;
            return;
        }
        this.tick++;
        if (this.tick % 5 === 0) this.frameIndex = (this.frameIndex + 1) % 4;
        this.velocity += GRAVITY;
        this.y += this.velocity;

        const floorY = logicalH - GROUND_H - this.h;
        if (this.y >= floorY) { this.y = floorY; hitPipe(); }
        // Ceiling check
        if (this.y < 0) { this.y = 0; this.velocity = 0; }
    }
    draw() {
        const seq = [0, 1, 2, 1];
        let f = seq[this.frameIndex];
        let img = document.getElementById(`bird-${assets.currBirdColor}-${f}`);
        if (!img) return;

        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);

        if (gameState === 'PLAYING' || gameState === 'GAMEOVER') {
            if (this.velocity < JUMP / 2) this.rotation = -25 * Math.PI / 180;
            else if (this.velocity > 0) {
                let targetRot = 90 * Math.PI / 180;
                if (this.rotation < targetRot) this.rotation += 0.05 + (this.velocity * 0.01);
            }
            if (this.rotation > 90 * Math.PI / 180) this.rotation = 90 * Math.PI / 180;
        }
        ctx.rotate(this.rotation);
        ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
    }
    flap() { this.velocity = JUMP; this.rotation = -25 * Math.PI / 180; playSound('wing'); }
}

class Pipe {
    constructor(x) {
        this.x = x; this.w = 52; this.passed = false;

        const floorY = logicalH - GROUND_H;
        // Pipe logic relative to floor
        const minPipeH = 80; // Minimum pipe height sticking out
        const maxPos = floorY - minPipeH - PIPE_GAP;
        const minPos = minPipeH;

        // We need to ensure pipes aren't impossible if screen is super short?
        // logicalH is dynamic. If screen is short, maxPos might be < minPos.
        // But we forced min scale, so logicalH usually >= 512/MaxScale.
        // Actually, if we zoom OUT (MaxScale cap), logicalH is BIG.
        // If logicalH is big, pipes have huge range.

        // Centralize pipes more to avoid extreme highs/lows
        // We effectively clamp the random range

        this.topY = Math.floor(Math.random() * (maxPos - minPos + 1)) + minPos;
    }
    update() { this.x -= PIPE_SPEED; }
    draw() {
        const img = document.getElementById(assets.currPipeId);
        if (!img) return;
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.topY);
        ctx.scale(1, -1);
        ctx.drawImage(img, -this.w / 2, 0, this.w, 320 + logicalH); // Extend pipe height safely
        ctx.restore();
        ctx.drawImage(img, this.x, this.topY + PIPE_GAP, this.w, 320 + logicalH);
    }
}

// --- UI DRAWING ---
function drawScore(val, x, y, align = 'center') {
    const str = val.toString();
    const zeroImg = document.getElementById('num-0');
    if (!zeroImg) return;
    const w = zeroImg.naturalWidth || 24;
    const h = zeroImg.naturalHeight || 36;
    let totalW = w * str.length;
    let startX = x;
    if (align === 'center') startX = x - totalW / 2;
    if (align === 'right') startX = x - totalW;

    for (let i = 0; i < str.length; i++) {
        let char = str[i];
        let img = document.getElementById(`num-${char}`);
        if (img) ctx.drawImage(img, startX + (i * w), y, w, h);
    }
}

function drawUI() {
    const centerW = logicalW / 2;
    const centerH = logicalH / 2;

    if (gameState === 'START') {
        const msg = document.getElementById('ui-message');
        if (msg) {
            const w = msg.naturalWidth;
            const h = msg.naturalHeight;
            const x = centerW - w / 2;
            const y = (logicalH - GROUND_H - h) / 2;
            ctx.drawImage(msg, x, y);
        }
    } else if (gameState === 'PLAYING') {
        drawScore(score, centerW, 50);
    } else if (gameState === 'GAMEOVER') {
        const go = document.getElementById('ui-gameover');
        if (go) {
            const w = go.naturalWidth;
            const x = centerW - w / 2;
            ctx.drawImage(go, x, centerH - 100);
        }
        drawScore(score, centerW, centerH);
    }
}

// --- CONTROLLER ---
const bg = new Background();
let bird = new Bird();

function gameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';
    playSound('hit');
    setTimeout(() => playSound('die'), 500);
    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('flappy_best', bestScore);
        const newRecordEl = document.getElementById('newRecordBadge');
        if (newRecordEl) newRecordEl.style.display = 'block';
    } else {
        const newRecordEl = document.getElementById('newRecordBadge');
        if (newRecordEl) newRecordEl.style.display = 'none';
    }

    // Update score displays
    if (uiFinalScore) uiFinalScore.innerText = score;
    const bestEl = document.getElementById('best-score-display');
    if (bestEl) bestEl.innerText = bestScore;
    if (uiGoldEarned) uiGoldEarned.innerText = (score * 10).toLocaleString();

    if (score > 0) sendReward(score);
    if (uiGameOver) uiGameOver.classList.remove('hidden');
    if (uiStart) uiStart.classList.add('hidden');
}

function hitPipe() {
    if (gameState !== 'GAMEOVER') {
        gameOver();
    }
}

function resetGame() {
    randomizeTheme();
    // Re-calc height dependent centers
    bird = new Bird();
    pipes = [];
    score = 0;
    frames = 0;
    gameState = 'START';
    if (uiGameOver) uiGameOver.classList.add('hidden');
    if (uiStart) uiStart.classList.remove('hidden');
    playSound('swoosh');
    if (loopId) cancelAnimationFrame(loopId);
    loop();
}

function startGame() {
    if (gameState === 'PLAYING') return;
    gameState = 'PLAYING';
    if (uiStart) uiStart.classList.add('hidden');
    bird.flap();
    // Request anti-cheat session token
    fetch('/api/flappy/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(r => r.json()).then(d => { gameSessionToken = d.token; }).catch(() => { });
}

function loop() {
    bg.update();
    if (gameState === 'PLAYING') {
        bird.update();
        if (frames % 100 === 0) pipes.push(new Pipe(logicalW + 50));
        for (let i = 0; i < pipes.length; i++) {
            let p = pipes[i];
            p.update();
            let bx = bird.x + 4; let by = bird.y + 4; let bw = bird.w - 8; let bh = bird.h - 8;
            if ((bx < p.x + p.w && bx + bw > p.x) && (by < p.topY || by + bh > p.topY + PIPE_GAP)) hitPipe();
            if (!p.passed && p.x + p.w < bird.x) {
                p.passed = true; score++; playSound('point');
            }
            if (p.x + p.w < -50) { pipes.shift(); i--; }
        }
        if (bird.y >= logicalH - GROUND_H - bird.h) hitPipe();
    } else if (gameState === 'GAMEOVER') {
        if (bird.y < logicalH - GROUND_H - bird.h) {
            bird.velocity += GRAVITY; bird.y += bird.velocity;
            if (bird.rotation < 90 * Math.PI / 180) bird.rotation += 0.1;
        }
    } else if (gameState === 'START') {
        bird.update();
    }
    frames++;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.scale(gameScale, gameScale);

    bg.drawBg();
    for (let p of pipes) p.draw();
    bg.drawGround();
    bird.draw();
    drawUI();

    loopId = requestAnimationFrame(loop);
}

// Input
function action(e) {
    if (e && e.type !== 'keydown') e.stopPropagation();
    if (gameState === 'START') startGame();
    else if (gameState === 'PLAYING') bird.flap();
    else if (gameState === 'GAMEOVER') resetGame();
}

window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); action(e); } });
const gameContainer = document.getElementById('game-container') || document.body;
gameContainer.addEventListener('mousedown', (e) => {
    if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') action(e);
});
gameContainer.addEventListener('touchstart', (e) => {
    if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') { e.preventDefault(); action(e); }
}, { passive: false });

document.getElementById('btn-restart').addEventListener('click', (e) => { e.stopPropagation(); resetGame(); });

async function sendReward(v) {
    try {
        const res = await fetch('/api/flappy/reward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: v, token: gameSessionToken })
        });
        const data = await res.json();
        if (res.ok && data.newBalance !== undefined) {
            updateBalanceDisplay(data.newBalance);
            if (uiGoldEarned) uiGoldEarned.innerText = (v * 10).toLocaleString();
        }
        gameSessionToken = null; // Invalidate token
    } catch (e) { }
}

function updateBalanceDisplay(bal) {
    const el = document.getElementById('userBalance');
    if (el) el.innerText = bal.toLocaleString();
}

async function fetchBalance() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            const data = await res.json();
            updateBalanceDisplay(data.balance);
        }
    } catch (e) { }
}

function init() {
    resizeCanvas();
    resetGame();
    fetchBalance(); // Get initial balance
    if (uiLoading) setTimeout(() => uiLoading.style.display = 'none', 500);
}
window.onload = init;
