const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ASSETS ---
const imgBird = document.getElementById('img-bird');
const imgPipes = document.getElementById('img-pipes');
const imgBg = document.getElementById('img-bg');

// --- CONSTANTS ---
// Logical Resolution (Base)
const LOGICAL_HEIGHT = 480;
// We will scale everything based on this height.
// The logical width will vary.

const GRAVITY = 0.25;
const JUMP = -4.6;
const PIPE_SPEED = 2;
const PIPE_SPAWN_RATE = 100;
const PIPE_GAP = 110;

// --- GAME STATE ---
let frames = 0;
let score = 0;
let gameState = 'START';
let pipes = [];
let gameScale = 1;

// --- RESIZE HANDLING ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Disable smoothing for pixel art
    ctx.imageSmoothingEnabled = false;

    // Calculate Scale
    gameScale = canvas.height / LOGICAL_HEIGHT;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- CLASSES ---

class Background {
    constructor() {
        this.x = 0;
    }

    draw() {
        // Draw background to cover the LOGICAL width/height
        // Logic: we want 1 pixel of bg to map to 1 logical unit?
        // Actually, just tile it across the screen.
        // We draw in LOGICAL coordinates.
        // Screen is (canvas.width / gameScale) wide.

        let screenLogicalW = canvas.width / gameScale;
        let bgW = imgBg.width || 300;
        let bgH = imgBg.height || 500;

        let numTiles = Math.ceil(screenLogicalW / bgW) + 1;
        let offsetX = this.x % bgW;

        for (let i = 0; i < numTiles; i++) {
            ctx.drawImage(imgBg, offsetX + (i * bgW), 0, bgW, LOGICAL_HEIGHT);
            // Stretch height to 480 logic units? Background1 is usually portrait.
            // If we just draw at 0,0 it might be too small.
            // Let's stretch bg to LOGICAL_HEIGHT
        }
    }

    update() {
        if (gameState === 'PLAYING') {
            this.x -= 0.5;
        }
    }
}

class Bird {
    constructor() {
        this.w = 34; // 34x24 logic size
        this.h = 24;
        this.x = 50;
        this.y = LOGICAL_HEIGHT / 2;
        this.velocity = 0;
        this.frameIndex = 0;
    }

    draw() {
        // Animation
        let animationSequence = [0, 1, 2, 1];
        let frame = animationSequence[this.frameIndex];

        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        let rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (this.velocity * 0.1)));
        ctx.rotate(rotation);

        // Draw 64x16 sprite sheet, 16x16 frames
        ctx.drawImage(imgBird, frame * 16, 0, 16, 16, -this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
    }

    update() {
        if (frames % 5 === 0) this.frameIndex = (this.frameIndex + 1) % 4;

        this.velocity += GRAVITY;
        this.y += this.velocity;

        // Floor
        if (this.y + this.h >= LOGICAL_HEIGHT) {
            this.y = LOGICAL_HEIGHT - this.h;
            gameOver();
        }
        // Ceiling
        if (this.y < 0) {
            this.y = 0;
            this.velocity = 0;
        }
    }

    jump() {
        this.velocity = JUMP;
    }
}

class Pipe {
    constructor() {
        // Spawn off-screen (logical coordinate)
        this.x = (canvas.width / gameScale);
        this.w = 52;

        let minHeight = 50;
        // Pipe gap logic relative to 480 height
        let maxPos = LOGICAL_HEIGHT - minHeight - PIPE_GAP;
        this.topY = Math.floor(Math.random() * (maxPos - minHeight + 1)) + minHeight;

        this.passed = false;
    }

    draw() {
        // Draw using logical coordinates
        // Top Pipe
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.topY);
        ctx.scale(1, -1);
        ctx.drawImage(imgPipes, 0, 0, 32, 80, -this.w / 2, 0, this.w, 800);
        ctx.restore();

        // Bottom Pipe
        ctx.drawImage(imgPipes, 0, 0, 32, 80, this.x, this.topY + PIPE_GAP, this.w, 800);
    }

    update() {
        this.x -= PIPE_SPEED;
    }
}

// --- CONTROLLERS ---
let bird = new Bird();
let bg = new Background();

// --- LOOP ---
function loop() {
    // Update
    bg.update();
    if (gameState === 'PLAYING') {
        bird.update();
        if (frames % PIPE_SPAWN_RATE === 0) pipes.push(new Pipe());

        for (let i = 0; i < pipes.length; i++) {
            let p = pipes[i];
            p.update();

            // Collision
            // Top Pipe Rect
            let pTop = { x: p.x, y: 0, w: p.w, h: p.topY };
            // Bottom Pipe Rect
            let pBot = { x: p.x, y: p.topY + PIPE_GAP, w: p.w, h: LOGICAL_HEIGHT };
            // Collision logic check
            if (checkCollision({ x: bird.x + 4, y: bird.y + 4, w: bird.w - 8, h: bird.h - 8 }, pTop) ||
                checkCollision({ x: bird.x + 4, y: bird.y + 4, w: bird.w - 8, h: bird.h - 8 }, pBot)) {
                gameOver();
            }

            // Score
            if (p.x + p.w < bird.x && !p.passed) {
                if (gameState === 'PLAYING') {
                    score++;
                    updateScoreDisplay();
                    p.passed = true;
                }
            }

            // Remove
            if (p.x + p.w < -100) {
                pipes.shift();
                i--;
            }
        }
    }
    frames++;

    // DRAW
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply Scale
    ctx.scale(gameScale, gameScale);

    bg.draw();
    for (let p of pipes) p.draw();
    bird.draw();

    if (gameState === 'PLAYING' || gameState === 'START') {
        requestAnimationFrame(loop);
    }
}

function checkCollision(r1, r2) {
    return (r1.x < r2.x + r2.w && r1.x + r1.w > r2.x &&
        r1.y < r2.y + r2.h && r1.y + r1.h > r2.y);
}

// --- UI ---
const uiStart = document.getElementById('start-message');
const uiGameOver = document.getElementById('game-over');
const uiScore = document.getElementById('score');
const uiFinalScore = document.getElementById('final-score');
const uiGoldEarned = document.getElementById('gold-earned');

function updateScoreDisplay() { uiScore.innerText = score; }

function startGame() {
    gameState = 'PLAYING';
    uiStart.classList.add('hidden');
    loop();
}

function gameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';
    if (score > 0) sendReward(score);
    uiFinalScore.innerText = score;
    uiGoldEarned.innerText = score * 10;
    uiGameOver.classList.remove('hidden');
}

function resetGame() {
    bird = new Bird(); // Reset bird pos
    pipes = [];
    score = 0;
    frames = 0;
    gameState = 'START';
    updateScoreDisplay();
    uiGameOver.classList.add('hidden');

    // Draw initial frame
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(gameScale, gameScale);
    bg.draw();
    bird.draw();
    uiStart.classList.remove('hidden');
}

// --- INPUTS ---
function action() {
    if (gameState === 'START') { startGame(); bird.jump(); }
    else if (gameState === 'PLAYING') bird.jump();
}
window.addEventListener('keydown', e => { if (e.code === 'Space') action(); });
canvas.addEventListener('mousedown', action);
canvas.addEventListener('touchstart', e => { e.preventDefault(); action(); }, { passive: false });

document.getElementById('btn-start').addEventListener('click', (e) => { e.stopPropagation(); action(); });
document.getElementById('btn-restart').addEventListener('click', (e) => { e.stopPropagation(); resetGame(); });

// --- REWARD ---
async function sendReward(scoreVal) {
    try {
        await fetch('/api/flappy/reward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: scoreVal })
        });
    } catch (e) { }
}

// --- INIT ---
resizeCanvas();
imgBird.onload = () => { resetGame(); };
if (imgBird.complete && imgBg.complete) resetGame();
