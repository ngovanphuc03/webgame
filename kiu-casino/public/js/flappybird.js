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
// Logical resolution for consistent gameplay on all screens
const LOGICAL_WIDTH = 288;
const LOGICAL_HEIGHT = 512;
const GROUND_H = 112;
const GRAVITY = 0.25;
const JUMP = -4.6;
const PIPE_SPEED = 2; // Adjusted for 60fps
const PIPE_SPAWN_X = 200; // Distance between pipes
const PIPE_GAP = 100;

// -- STATE --
let gameScale = 1;
let frames = 0;
let score = 0;
let bestScore = parseInt(localStorage.getItem('flappy_best')) || 0;
let gameState = 'START'; // START, PLAYING, GAMEOVER
let pipes = [];
let loopId = null;

// -- UI --
const uiStart = document.getElementById('start-message');
const uiGameOver = document.getElementById('game-over');
const uiScore = document.getElementById('score');
const uiFinalScore = document.getElementById('final-score');
const uiGoldEarned = document.getElementById('gold-earned');
const uiNewBadge = document.getElementById('newRecordBadge');
const uiBasePath = 'flappy_assets/sprites/';

// -- RESIZE HANDLER --
function resizeCanvas() {
    // Fit to window but keep aspect ratio roughly or just fill
    // Standard Flappy Bird is usually portrait.
    // We'll scale to fit height mainly.
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    canvas.width = winW;
    canvas.height = winH;

    // Calculate scale to fit LOGICAL_HEIGHT into window height
    // But don't stretch too wide
    gameScale = Math.min(winW / LOGICAL_WIDTH, winH / LOGICAL_HEIGHT);
    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- LOGIC HELPERS ---
function playSound(s) {
    if (sounds[s]) {
        sounds[s].currentTime = 0;
        sounds[s].play().catch(e => { });
    }
}

function randomizeTheme() {
    assets.currBirdColor = assets.birds[Math.floor(Math.random() * assets.birds.length)];
    assets.currPipeId = assets.pipes[Math.floor(Math.random() * assets.pipes.length)];
    assets.currBgId = assets.bgs[Math.floor(Math.random() * assets.bgs.length)];
}

// --- CLASSES ---

class Background {
    constructor() {
        this.x = 0;
        this.groundX = 0;
    }

    drawBg() {
        const bgImg = document.getElementById(assets.currBgId);
        if (!bgImg) return;

        let sw = LOGICAL_WIDTH;
        let sh = LOGICAL_HEIGHT;

        // Draw enough tiles to cover screen
        let num = Math.ceil((canvas.width / gameScale) / sw) + 1;

        for (let i = 0; i < num; i++) {
            ctx.drawImage(bgImg, this.x + i * sw, 0, sw, sh);
        }
    }

    drawGround() {
        const gImg = document.getElementById('ground');
        if (!gImg) return;

        let sw = 336; // Base image width
        const groundY = LOGICAL_HEIGHT - GROUND_H;

        let num = Math.ceil((canvas.width / gameScale) / sw) + 1;

        // Ground is drawn ON TOP of pipes usually, so we separate this
        for (let i = 0; i < num; i++) {
            ctx.drawImage(gImg, this.groundX + i * sw, groundY, sw, 112);
        }
    }

    update() {
        // Parallax or just simple scroll? Standard moves ground same speed as pipes
        if (gameState !== 'GAMEOVER') {
            this.groundX -= PIPE_SPEED;
            if (this.groundX <= -336) this.groundX = 0; // Reset loop
        }
    }
}

class Bird {
    constructor() {
        this.x = 50;
        this.y = LOGICAL_HEIGHT / 2;
        this.w = 34;
        this.h = 24;
        this.velocity = 0;
        this.frameIndex = 0;
        this.tick = 0;
    }

    update() {
        if (gameState === 'START') {
            // Hover
            this.y = (LOGICAL_HEIGHT / 2) - 50 + Math.sin(frames * 0.1) * 5;
            // Flap slowly
            if (frames % 10 === 0) this.frameIndex = (this.frameIndex + 1) % 3;
            return;
        }

        this.tick++;
        // Cycle frames: 0, 1, 2, 1 ...
        if (this.tick % 5 === 0) {
            this.frameIndex = (this.frameIndex + 1) % 4;
        }

        this.velocity += GRAVITY;
        this.y += this.velocity;

        // Rotation logic
        // 90 deg down if falling fast, -45 deg up if jumping
        // Simplified rotation for visual polish

        // Floor checks
        const floorY = LOGICAL_HEIGHT - GROUND_H - this.h;
        if (this.y >= floorY) {
            this.y = floorY;
            hitPipe(); // Touching ground is death
        }

        if (this.y < 0) this.y = 0; // Ceiling
    }

    draw() {
        // Frame sequence mapping 0,1,2,1
        const seq = [0, 1, 2, 1];
        let f = seq[this.frameIndex];

        let imgId = `bird-${assets.currBirdColor}-${f}`;
        let img = document.getElementById(imgId);

        if (!img) return;

        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);

        // Rotation
        let rotation = 0;
        if (gameState === 'PLAYING' || gameState === 'GAMEOVER') {
            if (this.velocity < JUMP / 2) rotation = -25 * Math.PI / 180;
            else if (this.velocity > 0) {
                rotation += (this.velocity * 4) * Math.PI / 180;
            }
            if (rotation > 90 * Math.PI / 180) rotation = 90 * Math.PI / 180;
        }
        ctx.rotate(rotation);

        ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
    }

    flap() {
        this.velocity = JUMP;
        playSound('wing');
    }
}

class Pipe {
    constructor(x) {
        this.x = x;
        this.w = 52;
        this.passed = false;

        // Calculate random height
        // Center of gap range
        const floorY = LOGICAL_HEIGHT - GROUND_H;
        const minPipeH = 50;
        const maxPos = floorY - minPipeH - PIPE_GAP;
        const minPos = minPipeH;

        // Top pipe 'y' end position
        this.topY = Math.floor(Math.random() * (maxPos - minPos + 1)) + minPos;
    }

    update() {
        this.x -= PIPE_SPEED;
    }

    draw() {
        const img = document.getElementById(assets.currPipeId);
        if (!img) return;

        // Draw Top Pipe (Flipped)
        // We draw it such that its bottom edge is at this.topY
        // The image is usually 320px high.
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.topY);
        ctx.scale(1, -1);
        ctx.drawImage(img, -this.w / 2, 0, this.w, 320); // 320 is arbitrary long height, will get clipped
        ctx.restore();

        // Draw Bottom Pipe
        // Starts at topY + GAP
        ctx.drawImage(img, this.x, this.topY + PIPE_GAP, this.w, 320);
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

    // High Score Logic
    let isNewBest = false;
    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('flappy_best', bestScore);
        isNewBest = true;
    }

    if (score > 0) sendReward(score);

    // Update UI
    uiScore.style.display = 'none';
    uiFinalScore.innerText = score;
    uiGoldEarned.innerText = score * 10;

    if (isNewBest && score > 0) {
        uiNewBadge.style.display = 'block';
    } else {
        uiNewBadge.style.display = 'none';
    }

    uiGameOver.classList.remove('hidden');

    // Show flash
    const flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.top = 0; flash.style.left = 0;
    flash.style.width = '100%'; flash.style.height = '100%';
    flash.style.background = 'white';
    flash.style.opacity = 0.8;
    flash.style.transition = 'opacity 0.2s';
    flash.style.zIndex = 1000;
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 200) }, 50);
}

function hitPipe() {
    gameState = 'GAMEOVER';
    gameOver();
}

function resetGame() {
    randomizeTheme();
    bird = new Bird();
    pipes = [];
    score = 0;
    frames = 0;
    gameState = 'START';

    uiScore.innerText = 0;
    uiScore.style.display = 'block';
    uiGameOver.classList.add('hidden');
    uiStart.classList.remove('hidden');

    bird.update(); // Set initial pos
    playSound('swoosh');

    if (loopId) cancelAnimationFrame(loopId);
    loop();
}

function startGame() {
    gameState = 'PLAYING';
    uiStart.classList.add('hidden');
    bird.flap();
}

function loop() {
    // Logic
    bg.update();

    if (gameState === 'PLAYING') {
        bird.update();

        // Pipe Spawning
        if (frames % 100 === 0) {
            // Logic to spawn pipe based on distance
        }

        // Spawn pipe logic adjusted for distance not frames strictly for smoothness? 
        // Or simply frames if constant speed.
        // Pipe speed 2, spawn X 200. 200 / 2 = 100 frames. Correct.
        if (frames % 100 === 0) {
            pipes.push(new Pipe(LOGICAL_WIDTH + 50));
        }

        for (let i = 0; i < pipes.length; i++) {
            let p = pipes[i];
            p.update();

            // Collision
            // Bird Box
            let bx = bird.x + 4;
            let by = bird.y + 4;
            let bw = bird.w - 8;
            let bh = bird.h - 8;

            // Pipe Boxes
            let pTopBox = { x: p.x, y: p.topY - 320, w: p.w, h: 320 }; // Roughly
            let pBotBox = { x: p.x, y: p.topY + PIPE_GAP, w: p.w, h: 320 };

            // Simpler AABB
            if (
                // Top Pipe Collision
                (bx < p.x + p.w && bx + bw > p.x && by < p.topY) ||
                // Bottom Pipe Collision
                (bx < p.x + p.w && bx + bw > p.x && by + bh > p.topY + PIPE_GAP)
            ) {
                hitPipe();
            }

            // Score
            if (!p.passed && p.x + p.w < bird.x) {
                p.passed = true;
                score++;
                uiScore.innerText = score;
                playSound('point');
            }

            // Remove
            if (p.x + p.w < -50) {
                pipes.shift();
                i--;
            }
        }
    } else if (gameState === 'GAMEOVER') {
        if (bird.y < LOGICAL_HEIGHT - GROUND_H - bird.h) {
            bird.y += bird.velocity;
            bird.velocity += GRAVITY;
            if (bird.rotation < 90) bird.rotation += 2;
        }
    }

    frames++;

    // Draw
    // Clear and scale
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background first

    // We want the game to be centered horizontally if screen is wide
    // Or just fill.
    // Let's simple Scale.
    ctx.scale(gameScale, gameScale);

    bg.drawBg();

    for (let p of pipes) p.draw();

    bg.drawGround();

    bird.draw();

    loopId = requestAnimationFrame(loop);
}

// Input
function action() {
    if (gameState === 'START') startGame();
    else if (gameState === 'PLAYING') bird.flap();
}

// Event Listeners
window.addEventListener('keydown', e => { if (e.code === 'Space') action(); });
window.addEventListener('touchstart', e => { e.preventDefault(); action(); }, { passive: false });
window.addEventListener('mousedown', action);

document.getElementById('btn-start').addEventListener('click', (e) => { e.stopPropagation(); action(); });
document.getElementById('btn-restart').addEventListener('click', (e) => { e.stopPropagation(); resetGame(); });

// Utils
async function sendReward(v) {
    try { await fetch('/api/flappy/reward', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score: v }) }); } catch (e) { }
}

// Init
gameScale = Math.min(window.innerWidth / LOGICAL_WIDTH, window.innerHeight / LOGICAL_HEIGHT);
resetGame();
