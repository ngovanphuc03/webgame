const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ASSETS ---
// Collection of assets
const assets = {
    birds: ['bird-1', 'bird-2'],
    pipes: ['pipe-1', 'pipe-2', 'pipe-3', 'pipe-4', 'pipe-5'],
    grounds: ['ground-1', 'ground-2', 'ground-3', 'ground-4', 'ground-5'],
    bgs: ['bg-1', 'bg-2', 'bg-3', 'bg-4', 'bg-5']
};

let currentBirdImg = document.getElementById(assets.birds[0]);
let currentPipeImg = document.getElementById(assets.pipes[0]);
let currentGroundImg = document.getElementById(assets.grounds[0]);
let currentBgImg = document.getElementById(assets.bgs[0]);

function randomizeAssets() {
    // Pick random IDs
    const bId = assets.birds[Math.floor(Math.random() * assets.birds.length)];
    // Sync Pipe and Ground (Index Logic)
    const pIndex = Math.floor(Math.random() * assets.pipes.length);
    const pId = assets.pipes[pIndex];
    const gId = assets.grounds[pIndex]; // Use same index for ground
    const bgId = assets.bgs[Math.floor(Math.random() * assets.bgs.length)];

    currentBirdImg = document.getElementById(bId);
    currentPipeImg = document.getElementById(pId);
    currentGroundImg = document.getElementById(gId);
    currentBgImg = document.getElementById(bgId);

    console.log(`Assets Randomized: Bird=${bId}, Pipe=${pId}, Ground=${gId}, BG=${bgId}`);
}

// --- CONSTANTS ---
const LOGICAL_HEIGHT = 480;
// We will have a logical floor height.
// Tile height is 112px.
// Let's reserve 112px for ground.
const GROUND_H = 112;
const PLAYABLE_H = LOGICAL_HEIGHT - GROUND_H;

const GRAVITY = 0.15; // Was 0.25
const JUMP = -3.5;   // Was -4.6
const PIPE_SPEED = 2;
const PIPE_SPAWN_RATE = 100;
const PIPE_GAP = 120; // Comfortable gap

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
    ctx.imageSmoothingEnabled = false;
    gameScale = canvas.height / LOGICAL_HEIGHT;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- CLASSES ---

class Background {
    constructor() {
        this.x = 0;
        this.groundX = 0;
    }

    draw() {
        if (!currentBgImg.complete || !currentGroundImg.complete) return;

        let screenLogicalW = canvas.width / gameScale;

        // Draw BG (Static relative to scroll speed? Or parallax?)
        let bgW = currentBgImg.width || 300;
        let numTilesBg = Math.ceil(screenLogicalW / bgW) + 1;
        let offsetBg = this.x % bgW;

        for (let i = 0; i < numTilesBg; i++) {
            ctx.drawImage(currentBgImg, offsetBg + (i * bgW), 0, bgW, LOGICAL_HEIGHT);
        }

        // Pipes will be drawn here by game loop
    }

    drawGround() {
        let screenLogicalW = canvas.width / gameScale;
        let gW = 336; // Tile width usually around 336 or 400. From file analysis: TileStyle1 400w
        if (currentGroundImg.width > 0) gW = currentGroundImg.width;

        let numTilesG = Math.ceil(screenLogicalW / gW) + 2; // Extra buffer
        let offsetG = this.groundX % gW;

        for (let i = 0; i < numTilesG; i++) {
            // Overlap by 1px to prevent gaps
            ctx.drawImage(currentGroundImg, Math.floor(offsetG + (i * gW)), LOGICAL_HEIGHT - GROUND_H, gW + 1, GROUND_H);
        }
    }

    update() {
        if (gameState === 'PLAYING' || gameState === 'START') {
            this.x -= 0.5; // Slow parallax BG
            this.groundX -= PIPE_SPEED; // Ground moves same speed as pipes
        }
    }
}

class Bird {
    constructor() {
        this.w = 34; // 34x24 logic size
        this.h = 24;
        this.x = 50;
        this.y = PLAYABLE_H / 2;
        this.velocity = 0;
        this.frameIndex = 0;
    }

    draw() {
        let animationSequence = [0, 1, 2, 1];
        let frame = animationSequence[this.frameIndex];

        ctx.save();
        ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
        let rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (this.velocity * 0.1)));
        ctx.rotate(rotation);

        ctx.drawImage(currentBirdImg, frame * 16, 0, 16, 16, -this.w / 2, -this.h / 2, this.w, this.h);
        ctx.restore();
    }

    update() {
        if (gameState === 'START') {
            // Hover effect
            this.y = (PLAYABLE_H / 2) + Math.sin(frames * 0.1) * 5;
            return;
        }

        if (frames % 5 === 0) this.frameIndex = (this.frameIndex + 1) % 4;

        this.velocity += GRAVITY;
        this.y += this.velocity;

        // Ground Collision
        if (this.y + this.h >= LOGICAL_HEIGHT - GROUND_H) {
            this.y = LOGICAL_HEIGHT - GROUND_H - this.h;
            gameOver();
        }
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
        this.x = (canvas.width / gameScale);
        this.w = 52;

        let minHeight = 50;
        // Pipe gap logic relative to PLAYABLE space (minus ground)
        let maxPos = (LOGICAL_HEIGHT - GROUND_H) - minHeight - PIPE_GAP;
        this.topY = Math.floor(Math.random() * (maxPos - minHeight + 1)) + minHeight;

        this.passed = false;
    }

    draw() {
        // Top Pipe
        ctx.save();
        ctx.translate(this.x + this.w / 2, this.topY);
        ctx.scale(1, -1);
        ctx.drawImage(currentPipeImg, 0, 0, 32, 80, -this.w / 2, 0, this.w, 800);
        ctx.restore();

        // Bottom Pipe
        ctx.drawImage(currentPipeImg, 0, 0, 32, 80, this.x, this.topY + PIPE_GAP, this.w, 800);
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
    bg.update();

    if (gameState === 'PLAYING') {
        bird.update();
        if (frames % PIPE_SPAWN_RATE === 0) pipes.push(new Pipe());

        for (let i = 0; i < pipes.length; i++) {
            let p = pipes[i];
            p.update();

            // Collision logic
            let pTop = { x: p.x, y: 0, w: p.w, h: p.topY };
            let pBot = { x: p.x, y: p.topY + PIPE_GAP, w: p.w, h: LOGICAL_HEIGHT };

            if (checkCollision({ x: bird.x + 4, y: bird.y + 4, w: bird.w - 8, h: bird.h - 8 }, pTop) ||
                checkCollision({ x: bird.x + 4, y: bird.y + 4, w: bird.w - 8, h: bird.h - 8 }, pBot)) {
                gameOver();
            }

            if (p.x + p.w < bird.x && !p.passed) {
                if (gameState === 'PLAYING') {
                    score++;
                    updateScoreDisplay();
                    p.passed = true;
                }
            }

            if (p.x + p.w < -100) {
                pipes.shift();
                i--;
            }
        }
    } else if (gameState === 'START') {
        bird.update(); // Just hover
    }

    frames++;

    // DRAW
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.scale(gameScale, gameScale);

    bg.draw(); // draw sky
    for (let p of pipes) p.draw();
    bg.drawGround(); // draw ground OVER pipes
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
    // loop continues
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
    randomizeAssets();
    bird = new Bird();
    pipes = [];
    score = 0;
    frames = 0;
    gameState = 'START';
    updateScoreDisplay();
    uiGameOver.classList.add('hidden');
    uiStart.classList.remove('hidden');

    // Restart loop if stopped? Actually loop stops on gameover? 
    // In previous code, loop stopped on gameover (requestAnimationFrame check).
    // So we need to call loop() again.
    loop();
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
resizeCanvas(); // Setup scale
randomizeAssets();
window.onload = resetGame;
setTimeout(resetGame, 500);
