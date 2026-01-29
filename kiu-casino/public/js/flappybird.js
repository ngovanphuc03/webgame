const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ASSETS ---
const imgBird = document.getElementById('img-bird');
const imgPipes = document.getElementById('img-pipes');
const imgBg = document.getElementById('img-bg');

// --- CONSTANTS ---
const GRAVITY = 0.25;
const JUMP = -4.6;
const PIPE_SPEED = 2;
const PIPE_SPAWN_RATE = 100; // Frames
const PIPE_GAP = 100;

// --- GAME STATE ---
let frames = 0;
let score = 0;
let gameState = 'START'; // START, PLAYING, GAMEOVER
let pipes = [];

// --- CLASSES ---

class Background {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.w = canvas.width;
        this.h = canvas.height;
    }

    draw() {
        // Simple parallax or just static tile
        ctx.drawImage(imgBg, this.x, this.y, this.w, this.h);
        ctx.drawImage(imgBg, this.x + this.w, this.y, this.w, this.h);
    }

    update() {
        if (gameState === 'PLAYING') {
            this.x = (this.x - 0.5) % this.w;
        }
    }
}

class Bird {
    constructor() {
        this.x = 50;
        this.y = 150;
        this.w = 34; // Scaled up slightly
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
        this.w = 50; // Visual width
        // Pipe Image Slicing: Green Pipe at (0,0), size 32x80 (logic from plan)
        // We need to stretch the middle part or just draw simple pipes from the sprite
        // Use full sprite 32x80 for "cap" and "body"? 
        // Let's simplify: Draw Top and Bottom pipes using the sprite as texture

        // Random Y position for gap
        // Min pipe height: 50
        // Max pipe height: canvas.height - ground - gap - min_height
        let minHeight = 50;
        let maxPos = canvas.height - minHeight - PIPE_GAP;
        this.topY = Math.floor(Math.random() * (maxPos - minHeight + 1)) + minHeight;

        this.passed = false;
    }

    draw() {
        // Source Pipe: 32x80. (0,0 is Green Pipe Top? No, usually these sheets are complex)
        // Based on user asset: 
        // PipeStyle1.png (128x160) -> 32x80 per pipe section?
        // Let's assume standard layout or trial/error. 
        // Usually: Top-left is one pipe, one color. 
        // Let's use Source: x=0, y=0, w=32, h=80 as "Whole Pipe"? 
        // Actually, typical Flappy Bird assets have a "Top Pipe" and "Bottom Pipe".
        // If the sprite is just one vertical tube, we might need to flip it for top.

        // DRAWING LOGIC:
        // Top Pipe (flipped vertical or specific sprite)
        // Bottom Pipe

        // Since we can't easily see the sprite content perfectly, I will assume:
        // x=0, y=0, w=32, h=80 is "Green Pipe Body/Cap"
        // I will draw it stretched.

        // Better implementation for generic asset:
        // Draw Top Pipe
        ctx.save();
        // Flip for top pipe check? Or just draw rect for now if sprite is weird.
        // Let's try drawing sprite directly.
        // Top Pipe: y = this.topY - (some giant number), height = giant number
        // Bottom Pipe: y = this.topY + PIPE_GAP

        // For visual safety, let's draw standard green pipes using 0,0,32,80
        // Top Pipe (Rotated 180 deg)
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.topY); // Pivot at bottom of top pipe
        ctx.scale(1, -1); // Flip Y
        ctx.drawImage(imgPipes, 0, 0, 32, 80, -this.w / 2, 0, this.w, 400); // Stretch height
        ctx.restore();

        // Bottom Pipe
        ctx.drawImage(imgPipes, 0, 0, 32, 80, this.x, this.topY + PIPE_GAP, this.w, 400);

        ctx.restore();
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
                if (gameState === 'PLAYING') { // Check again state
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

    // Draw ground if needed (omitted for now, pipes go to bottom)

    bird.draw();

    if (gameState === 'PLAYING' || gameState === 'START') {
        requestAnimationFrame(loop);
    }
}

function checkCollision(b, r) {
    // b: bird, r: rect (pipe)
    // Reduce hitbox slightly for better feel
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

    // Send Reward
    if (score > 0) {
        sendReward(score);
    }

    uiFinalScore.innerText = score;
    uiGoldEarned.innerText = score * 10;
    uiGameOver.classList.remove('hidden');
}

function resetGame() {
    bird.y = 150;
    bird.velocity = 0;
    pipes = [];
    score = 0;
    frames = 0;
    updateScoreDisplay();

    uiGameOver.classList.add('hidden');
    gameState = 'START';

    // Redraw initial state
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

document.getElementById('btn-start').addEventListener('click', () => {
    if (gameState === 'START') {
        startGame();
        bird.jump();
    }
});
document.getElementById('btn-restart').addEventListener('click', resetGame);

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
// Draw initial frame
imgBird.onload = () => {
    bg.draw();
    bird.draw();
};

// Fallback if images already loaded
if (imgBird.complete) {
    bg.draw();
    bird.draw();
}
