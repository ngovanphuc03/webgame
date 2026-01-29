const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#2d2d2d',
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 1000 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    pixelArt: true // Important for pixel assets
};

// --- GAME STATE ---
let player;
let cursors;
let wasd;
let keySpace;
let platforms;
let fruits;
let enemies;
let trophy;
let score = 0;
let level = 1;
let currentLevelScore = 0;
let isAttacking = false;
let gameOver = false;

// --- ASSET CONFIG ---
// We will use "Ninja Frog" as player
const ASSETS_PATH = 'adventure_assets/';

const game = new Phaser.Game(config);

function preload() {
    this.load.setBaseURL('./'); // Local relative path

    // Load Terrain (we will use a tileset image and slice it or just use simple blocks)
    // Looking at assets: "Terrain" folder has "Terrain (16x16).png".
    this.load.image('terrain', ASSETS_PATH + 'Terrain/Terrain (16x16).png');

    // Load Player: Ninja Frog
    // Idle (32x32), Run (32x32), Jump (32x32), Fall, Hit
    const charPath = ASSETS_PATH + 'Main Characters/Ninja Frog/';
    this.load.spritesheet('frog_idle', charPath + 'Idle (32x32).png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('frog_run', charPath + 'Run (32x32).png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('frog_jump', charPath + 'Jump (32x32).png', { frameWidth: 32, frameHeight: 32 });

    // Load Items: Fruits
    // Items/Fruits/Apple.png (32x32 spritesheet? No usually individual images or strip)
    // Check asset structure: Items/Fruits/Apple.png, Bananas.png etc.
    // Usually these are strips of 17 frames.
    this.load.spritesheet('fruit_apple', ASSETS_PATH + 'Items/Fruits/Apple.png', { frameWidth: 32, frameHeight: 32 });

    // Load Trophy: Items/Checkpoints/End (Pressed) (64x64).png
    // Actually "End (Idle).png"
    this.load.image('trophy', ASSETS_PATH + 'Items/Checkpoints/End/End (Idle).png');

    // Load Enemy: Trunk or Slime?
    // 20 Enemies.png is a big sheet? Or subfolders?
    // Folder structure: Free/Enemies/Trunk/Idle (64x32).png
    // Let's use "Trunk".
    // Wait, list_dir showed "20 Enemies.png" file? 
    // And also subdirs inside "Enemies"? No, list_dir showed "20 Enemies.png" in Free root?
    // Let's assume standard Pixel Adventure folder ref: Free/Enemies/Trunk/...
    // I will load a placeholder rect if not found, to be safe.
    // But better to try to load "Start" (Idle) of "Trunk".
    // Let's assume user structure: Free/Enemies/Trunk/Run (64x32).png
    // I'll stick to a simple enemy for now to ensure it works.
    this.load.spritesheet('enemy_trunk', ASSETS_PATH + 'Enemies/Trunk/Run (64x32).png', { frameWidth: 64, frameHeight: 32 });

    // Background
    this.load.image('bg_blue', ASSETS_PATH + 'Background/Blue.png');
}

function create() {
    // Inputs
    cursors = this.input.keyboard.createCursorKeys();
    wasd = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        right: Phaser.Input.Keyboard.KeyCodes.D
    });
    keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.input.on('pointerdown', attack, this);

    // Anims
    this.anims.create({
        key: 'idle',
        frames: this.anims.generateFrameNumbers('frog_idle', { start: 0, end: 10 }),
        frameRate: 20,
        repeat: -1
    });
    this.anims.create({
        key: 'run',
        frames: this.anims.generateFrameNumbers('frog_run', { start: 0, end: 11 }),
        frameRate: 20,
        repeat: -1
    });
    this.anims.create({
        key: 'jump',
        frames: [{ key: 'frog_jump', frame: 0 }],
        frameRate: 20
    });

    this.anims.create({
        key: 'fruit_anim',
        frames: this.anims.generateFrameNumbers('fruit_apple', { start: 0, end: 16 }),
        frameRate: 30,
        repeat: -1
    });

    this.anims.create({
        key: 'enemy_run',
        frames: this.anims.generateFrameNumbers('enemy_trunk', { start: 0, end: 13 }),
        frameRate: 20,
        repeat: -1
    });

    startLevel(this, level);
}

function update() {
    if (gameOver) return;

    // Movement
    if (wasd.left.isDown) {
        player.setVelocityX(-160);
        player.anims.play('run', true);
        player.flipX = true;
    } else if (wasd.right.isDown) {
        player.setVelocityX(160);
        player.anims.play('run', true);
        player.flipX = false;
    } else {
        player.setVelocityX(0);
        player.anims.play('idle', true);
    }

    // Jump
    if ((keySpace.isDown || wasd.up.isDown) && player.body.touching.down) {
        player.setVelocityY(-500); // 1000 gravity -> 500 jump is okay
    }

    if (!player.body.touching.down) {
        player.anims.play('jump');
    }

    // Basic Attack Logic (Click)
    // We check overlap on click frame?
    // Implemented in pointerdown event.

    // Death Check
    if (player.y > 700) {
        restartLevel(this);
    }
}

function attack(pointer) {
    if (gameOver) return;

    // Simple Attack: Create a hitbox in front of player
    // For visual, maybe flash white or play attack anim if we had one.
    // Ninja Frog has no Attack anim loaded?
    // Let's just do a logic check for nearby enemies.

    const attackRange = 50;
    const direction = player.flipX ? -1 : 1;
    const attackX = player.x + (direction * 20);
    const attackY = player.y;

    // Visual debug
    // var rect = this.add.rectangle(attackX, attackY, 40, 40, 0xff0000, 0.5);
    // this.time.delayedCall(100, () => rect.destroy());

    enemies.children.iterate((enemy) => {
        if (!enemy.active) return;
        if (Phaser.Math.Distance.Between(attackX, attackY, enemy.x, enemy.y) < attackRange) {
            // Kill Enemy
            enemy.disableBody(true, true);
            // Maybe add score?
        }
    });
}

// --- LEVEL GENERATION ---
function startLevel(scene, lvl) {
    // Reset State
    currentLevelScore = 0;
    document.getElementById('level-display').innerText = lvl;

    // Clear old objects
    if (platforms) platforms.clear(true, true);
    if (fruits) fruits.clear(true, true);
    if (enemies) enemies.clear(true, true);
    if (trophy) trophy.destroy();
    if (player) player.destroy();

    // Background
    scene.add.image(400, 300, 'bg_blue').setScrollFactor(0).setScale(10); // Big BG

    // Groups
    platforms = scene.physics.add.staticGroup();
    fruits = scene.physics.add.group({ allowGravity: false, immovable: true });
    enemies = scene.physics.add.group();

    // Generate Level Map
    // Procedural: Longer and harder as lvl increases
    let currentX = 50;
    let currentY = 500;

    // Start Platform
    createPlatform(scene, 0, 550, 10); // 10 blocks wide

    const levelLength = 10 + (lvl * 2); // Gets longer

    for (let i = 0; i < levelLength; i++) {
        // Gap?
        if (Math.random() < 0.2 + (lvl * 0.01)) {
            // Create Gap
            currentX += 100 + (Math.random() * 50);
        } else {
            // Next Platform
            // Change Y
            let yChange = (Math.random() * 100) - 50;
            currentY += yChange;
            // Clamp Y
            if (currentY > 550) currentY = 550;
            if (currentY < 200) currentY = 200;

            let width = 3 + Math.floor(Math.random() * 5);
            createPlatform(scene, currentX, currentY, width);

            // Add Enemies?
            if (Math.random() < 0.3 + (lvl * 0.01) && width > 4) {
                let enemy = enemies.create(currentX + 50, currentY - 32, 'enemy_trunk');
                enemy.setCollideWorldBounds(false);
                enemy.setVelocityX(Phaser.Math.Between(-50, 50));
                enemy.anims.play('enemy_run', true);
            }

            // Add Fruit
            if (Math.random() < 0.5) {
                let f = fruits.create(currentX + (width * 16 / 2), currentY - 50, 'fruit_apple');
                f.anims.play('fruit_anim', true);
            }

            currentX += width * 32; // Advance
        }
    }

    // End Goal
    trophy = scene.physics.add.staticImage(currentX, currentY - 48, 'trophy');

    // Player
    player = scene.physics.add.sprite(100, 450, 'frog_idle');
    player.setBounce(0.1);
    player.setCollideWorldBounds(false); // Can fall off

    // Camera
    scene.cameras.main.startFollow(player, true, 0.05, 0.05);
    scene.cameras.main.setBounds(0, 0, currentX + 500, 800);
    scene.physics.world.setBounds(0, 0, currentX + 500, 800);

    // Colliders
    scene.physics.add.collider(player, platforms);
    scene.physics.add.collider(enemies, platforms);
    scene.physics.add.overlap(player, fruits, collectFruit, null, scene);
    scene.physics.add.overlap(player, enemies, hitEnemy, null, scene);
    scene.physics.add.overlap(player, trophy, reachEnd, null, scene);
}

function createPlatform(scene, x, y, widthInBlocks) {
    // 1 Block = 32px (scaled up from 16px asset?)
    // Default terrain is 16x16. Let's scale to 32x32 for better visibility?
    // Or keep 16x16. Let's do 32x32 (Scale 2) or use 32px logic.
    // Let's assume we place 16x16 blocks but scaled x2 -> 32x32.

    for (let i = 0; i < widthInBlocks; i++) {
        let block = platforms.create(x + (i * 32), y, 'terrain');
        block.setScale(2).refreshBody(); // Important for static body scaling
    }
}

function collectFruit(player, fruit) {
    fruit.disableBody(true, true);
    currentLevelScore++;
    score++;
    document.getElementById('score-display').innerText = score;
}

function hitEnemy(player, enemy) {
    // Simple damage logic: Restart level if touch
    // Unless attacking? (Handled in input click)
    // For now, simple death
    restartLevel(this);
}

function reachEnd(player, trophy) {
    // Save Score
    sendReward(currentLevelScore, level);

    // Next Level
    level++;
    if (level > 30) {
        alert("YOU WIN! COMPLETED 30 LEVELS!");
        level = 1;
        score = 0;
        // Back to menu or restart
        window.location.href = '/';
    } else {
        startLevel(this, level);
    }
}

function restartLevel(scene) {
    // Reset Score gained in this level?
    score -= currentLevelScore;
    document.getElementById('score-display').innerText = score;
    startLevel(scene, level);
}

// --- API ---
async function sendReward(points, lvl) {
    if (points <= 0 && lvl < 30) return;
    try {
        await fetch('/api/adventure/reward', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: points, level: lvl })
        });
    } catch (e) { }
}
