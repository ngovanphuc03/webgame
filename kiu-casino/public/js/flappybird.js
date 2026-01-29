const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ASSETS ---
const imgBird = document.getElementById('img-bird');
const imgPipes = document.getElementById('img-pipes');
const imgBg = document.getElementById('img-bg');

// --- CONSTANTS ---
// We will scale these based on screen size or keep fixed physics and larger view?
// For simpler gameplay feel, we keep physics constant but just expand the view.
// However, pipes spawn at right edge, so on wider screens it takes longer.
// That is acceptable for "Responsive".
const GRAVITY = 0.25;
const JUMP = -4.6;
const PIPE_SPEED = 2;
const PIPE_SPAWN_RATE = 100; // Frames
const PIPE_GAP = 120; // Slightly larger for full screen playability

// --- GAME STATE ---
let frames = 0;
let score = 0;
let gameState = 'START'; // START, PLAYING, GAMEOVER
let pipes = [];

// --- RESIZE HANDLING ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // We might need to reposition bird if it goes off screen?
    // For now, let's just let it be.
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); // Init

// --- CLASSES ---

class Background {
    constructor() {
        this.x = 0;
    }

    draw() {
        // Tile the background to cover screen
        // Assumes imgBg is loaded
        if (!imgBg.complete) return;

        let bgW = imgBg.width || 300; // Fallback
        let bgH = imgBg.height || 500;

        // Scale bg to fit height? Or just tile?
        // Let's scale to cover height, maintain aspect ratio
        let scale = canvas.height / bgH;
        let scaledW = bgW * scale;
        let scaledH = canvas.height;

        let numTiles = Math.ceil(canvas.width / scaledW) + 1;

        // Offset for parallax
        let offsetX = this.x % scaledW;

        for (let i = 0; i < numTiles; i++) {
            ctx.drawImage(imgBg, offsetX + (i * scaledW), 0, scaledW, scaledH);
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
        this.x = 50;
        this.y = canvas.height / 2;
        this.w = 34;
        this.h = 24;
        this.velocity = 0;
        this.frameIndex = 0;
        this.tickCount = 0;
    }

    draw() {
        // Sprite details: 64x16, 4 frames of 16x16
        // We will animate frames 0, 1, 2, 1
        let animationSequence = [0, 1, 2, 1];
        let currentFrame = animationSequence[this.frameIndex];

        let sx = currentFrame * 16;
        let sy = 0;
        let sw = 16;
        let sh = 16;

        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        // Rotate based on velocity
        let rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (this.velocity * 0.1)));
        ctx.rotate(rotation);

        // Draw bigger bird? 34x24 is small on 1080p
        // Let's scale it up a bit: 1.5x
        // Actually, let's keep it pixel perfect-ish or just same ratio
        ctx.drawImage(imgBird, sx, sy, sw, sh, -this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
    }

    update() {
        // Animation
        if (frames % 5 === 0) {
            this.frameIndex = (this.frameIndex + 1) % 4;
        }

        // Physics
        this.velocity += GRAVITY;
        this.y += this.velocity;

        // Floor collision
        if (this.y + this.h >= canvas.height) {
            this.y = canvas.height - this.h;
            gameOver();
        }

        // Ceiling collision
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
        this.x = canvas.width;
        this.w = 60; // Slightly wider
        // Standard pipe logic
        let minHeight = 50;
        let maxPos = canvas.height - minHeight - PIPE_GAP;
        this.topY = Math.floor(Math.random() * (maxPos - minHeight + 1)) + minHeight;

        this.passed = false;
    }

    draw() {
        // We stretch standard pipe sprite 32x80 to fit
        ctx.save();

        // Top Pipe (Flip Y)
        ctx.translate(this.x + this.w / 2, this.topY);
        ctx.scale(1, -1);
        ctx.drawImage(imgPipes, 0, 0, 32, 80, -this.w / 2, 0, this.w, 800); // Draw tall enough
        ctx.restore();

        // Bottom Pipe
        ctx.drawImage(imgPipes, 0, 0, 32, 80, this.x, this.topY + PIPE_GAP, this.w, 800); // Draw tall enough
    }

    update() {
        this.x -= PIPE_SPEED;
    }
}

// --- CONTROLLERS ---
const bird = new Bird();
const bg = new Background();

// --- LOOP ---
function loop() {
    // Update
    bg.update();

    if (gameState === 'PLAYING') {
        bird.update();

        // Pipes
        if (frames % PIPE_SPAWN_RATE === 0) {
            pipes.push(new Pipe());
        }

        // Garbage collection & Collision
        for (let i = 0; i < pipes.length; i++) {
            let p = pipes[i];
            p.update();

            // Collision Box
            // Top Pipe
            let pTopUser = { x: p.x, y: 0, w: p.w, h: p.topY };
            // Bottom Pipe
            let pBotUser = { x: p.x, y: p.topY + PIPE_GAP, w: p.w, h: canvas.height };

            if (checkCollision(bird, pTopUser) || checkCollision(bird, pBotUser)) {
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

            // Remove logic
            if (p.x + p.w < 0) {
                pipes.shift();
                i--;
            }
        }
    }

    frames++;

    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bg.draw();

    for (let p of pipes) {
        p.draw();
    }

    bird.draw();

    if (gameState === 'PLAYING' || gameState === 'START') {
        requestAnimationFrame(loop);
    }
}

function checkCollision(b, r) {
    let bx = b.x + 4;
    let by = b.y + 4;
    let bw = b.w - 8;
    let bh = b.h - 8;

    return (
        bx < r.x + r.w &&
        bx + bw > r.x &&
        by < r.y + r.h &&
        by + bh > r.y
    );
}

// --- UI & EVENTS ---
const uiStart = document.getElementById('start-message');
const uiGameOver = document.getElementById('game-over');
const uiScore = document.getElementById('score');
const uiFinalScore = document.getElementById('final-score');
const uiGoldEarned = document.getElementById('gold-earned');

function startGame() {
    gameState = 'PLAYING';
    uiStart.classList.add('hidden');
    loop();
}

function gameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';

    console.log("Game Over! Score:", score);

    if (score > 0) {
        sendReward(score);
    }

    uiFinalScore.innerText = score;
    uiGoldEarned.innerText = score * 10;
    uiGameOver.classList.remove('hidden');
}

function resetGame() {
    bird.y = canvas.height / 2;
    bird.velocity = 0;
    pipes = [];
    score = 0;
    frames = 0;
    updateScoreDisplay();

    uiGameOver.classList.add('hidden');
    gameState = 'START';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bg.draw();
    bird.draw();
    uiStart.classList.remove('hidden');
}

function updateScoreDisplay() {
    uiScore.innerText = score;
}

// --- INPUTS ---
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        action();
    }
});

canvas.addEventListener('mousedown', action);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); action(); }, { passive: false });

function action() {
    if (gameState === 'START') {
        startGame();
        bird.jump();
    } else if (gameState === 'PLAYING') {
        bird.jump();
    }
}

document.getElementById('btn-start').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent canvas click triggering jump immediately
    if (gameState === 'START') {
        startGame();
        bird.jump();
    }
});
document.getElementById('btn-restart').addEventListener('click', (e) => {
    e.stopPropagation();
    resetGame();
});

// --- REWARD API ---
async function sendReward(scoreVal) {
    try {
        const res = await fetch('/api/flappy/reward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: scoreVal })
        });
        const data = await res.json();
        if (data.success) {
            console.log("Reward claimed:", data.addedGold);
        } else {
            console.error("Reward failed:", data.error);
        }
    } catch (e) {
        console.error("Reward network error:", e);
    }
}

// --- INIT ---
// Ensure resize happens
resizeCanvas();

// Initial Draw
imgBird.onload = () => {
    bg.draw();
    bird.draw();
};

if (imgBird.complete || imgBg.complete) {
    bg.draw();
    bird.draw();
}
