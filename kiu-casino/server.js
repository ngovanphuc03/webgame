const dotenv = require('dotenv');
dotenv.config({ path: __dirname + '/.env' });
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mysql = require('mysql2/promise');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const path = require('path');

const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// --- SECURITY: CORS & DDOS PROTECTION ---
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*"; // Set specific domain in .env for production

// 1. Socket.IO CORS
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true
    }
});

// 2. Express CORS
app.use(cors({
    origin: ALLOWED_ORIGIN,
    credentials: true
}));

// 3. Rate Limiter (DDOS Protection)
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// --- CẤU HÌNH ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(express.json());

const TARGET_GUILD_ID = '949162034954633236';


// --- DATABASE ---
// MySQL pool (enabled for production). Configure via env vars.
const dbPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'meono',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Support TLS for hosted DB providers (Aiven etc.)
    ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    // Important: treat BIGINTs as strings to avoid JS precision loss for Discord IDs
    supportBigNumbers: true,
    bigNumberStrings: true
});

// --- AUTH ---
// Discord OAuth routes (enabled when env is configured)
app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Lỗi: Không có code!');
    try {
        const tRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
            code, grant_type: 'authorization_code', redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify'
        }));
        const uRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tRes.data.access_token}` } });
        const { id, username, avatar } = uRes.data;

        try {
            const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, id]);
            if (rows.length === 0) await dbPool.execute('INSERT INTO wallet (guild_id, user_id, balance) VALUES (?,?,?)', [TARGET_GUILD_ID, id, 10000]);
        } catch (e) { console.error("Lỗi DB:", e.message); }

        res.cookie('user_id', id, { maxAge: 86400000 });

        let avatarUrl = "";
        if (avatar) {
            avatarUrl = `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`;
        } else {
            try {
                const index = Number((BigInt(id) >> 22n) % 6n);
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
            } catch (e) {
                avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
            }
        }

        const info = JSON.stringify({ username: encodeURIComponent(username), avatar: avatarUrl });
        res.cookie('user_info', info, { maxAge: 86400000 });
        res.redirect('/');
    } catch (e) { res.redirect('/'); }
});

// API /api/me (enabled when DB configured)
app.get('/api/me', async (req, res) => {
    const uid = req.cookies.user_id;
    if (!uid) return res.status(401).json({ error: 'No login' });
    try {
        const [r] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        let info = { username: 'User', avatar: '' };
        if (req.cookies.user_info) {
            try {
                const raw = JSON.parse(req.cookies.user_info.startsWith('j:') ? req.cookies.user_info.slice(2) : req.cookies.user_info);
                info.username = decodeURIComponent(raw.username);
                info.avatar = raw.avatar;
            } catch (e) { }
        }

        // Fallback if avatar is empty (default Discord avatar)
        if (!info.avatar) {
            try {
                const index = Number((BigInt(uid) >> 22n) % 6n);
                info.avatar = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
            } catch (e) {
                info.avatar = "https://cdn.discordapp.com/embed/avatars/0.png";
            }
        }

        res.json({ ...info, balance: r.length ? r[0].balance : 0 });
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// Endpoint trả thưởng Flappy Bird (1 điểm = 10 vàng)
// Init Leaderboard Table
(async () => {
    try {
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS flappy_leaderboard (
                user_id VARCHAR(50) PRIMARY KEY,
                username VARCHAR(100),
                score INT DEFAULT 0
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        `);
    } catch (e) { console.error("Init Leaderboard Error:", e); }
})();

// Endpoint trả thưởng Flappy Bird (1 điểm = 10 vàng) & Save High Score
app.post('/api/flappy/reward', async (req, res) => {
    const uid = req.cookies.user_id;
    if (!uid) return res.status(401).json({ error: 'Chưa đăng nhập' });

    const { score } = req.body;
    if (!score || score <= 0) return res.status(400).json({ error: 'Điểm không hợp lệ' });

    // Giới hạn điểm tối đa
    if (score > 10000) return res.status(400).json({ error: 'Điểm quá cao bất thường' }); // Relaxed limit

    const goldReward = score * 10;

    // Get username from cookie
    let username = 'Unknown';
    if (req.cookies.user_info) {
        try {
            const raw = JSON.parse(req.cookies.user_info.startsWith('j:') ? req.cookies.user_info.slice(2) : req.cookies.user_info);
            username = decodeURIComponent(raw.username);
        } catch (e) { }
    }

    try {
        // 1. Give Money
        await dbPool.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [goldReward, TARGET_GUILD_ID, uid]);

        // 2. Save High Score (Update if higher)
        await dbPool.execute(`
            INSERT INTO flappy_leaderboard (user_id, username, score) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
                score = GREATEST(score, VALUES(score)),
                username = VALUES(username)
        `, [uid, username, score]);

        const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        const newBalance = rows.length ? rows[0].balance : 0;

        res.json({ success: true, addedGold: goldReward, newBalance });
    } catch (e) {
        console.error('Flappy Reward Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});


app.get('/api/flappy/leaderboard', async (req, res) => {
    try {
        const [rows] = await dbPool.execute('SELECT username, score FROM flappy_leaderboard ORDER BY score DESC LIMIT 3');
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: 'DB Error' });
    }
});

// Endpoint trả thưởng Pixel Adventure
app.post('/api/adventure/reward', async (req, res) => {
    const uid = req.cookies.user_id;
    if (!uid) return res.status(401).json({ error: 'Chưa đăng nhập' });

    const { score, level } = req.body;
    if (!score || score <= 0) return res.status(400).json({ error: 'Điểm không hợp lệ' });

    // Validate sane defaults for platformer (e.g. max 50 fruits per level?)
    // Relaxed check for now

    // Reward: 1 Score (Fruit) = 10 Gold
    // Level Completion Bonus: Level * 100 Gold?
    let goldReward = score * 10;
    if (level === 30) goldReward += 5000; // Big bonus for finishing game

    try {
        await dbPool.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [goldReward, TARGET_GUILD_ID, uid]);
        const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        const newBalance = rows.length ? rows[0].balance : 0;

        console.log(`[PixelAdv] User ${uid} Level ${level} Score ${score} -> +${goldReward} gold.`);
        res.json({ success: true, addedGold: goldReward, newBalance });
    } catch (e) {
        console.error('Adventure Reward Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});




// ============================================================
// MANAGER GAME
// ============================================================

// --- KHỞI TẠO POKER ---
const PokerManager = require('./poker-core');
const pokerGame = new PokerManager(io, dbPool);
// Auto-create table is handled inside the class constructor

// --- START ---
// txGame / taixiu-core integration (enabled if module present)
let txGame; try { txGame = new (require('./taixiu-core'))(io, dbPool, TARGET_GUILD_ID); console.log('taixiu-core loaded'); } catch (e) { console.error('taixiu-core not loaded:', e?.message || e); }

io.on('connection', (socket) => {
    // Simplified local-friendly user info (no DB/Discord required)
    const getCookie = (name) => { const v = `; ${socket.handshake.headers.cookie || ''}`; const p = v.split(`; ${name}=`); if (p.length === 2) return decodeURIComponent(p.pop().split(';').shift()); }
    const userId = getCookie('user_id');
    let userInfo = { id: socket.id, username: "Khách", avatar: "" };
    try {
        const raw = getCookie('user_info');
        if (raw) {
            const data = JSON.parse(raw.startsWith('j:') ? raw.slice(2) : raw);
            userInfo.username = decodeURIComponent(data.username || userInfo.username);
            userInfo.avatar = data.avatar || userInfo.avatar;
            userInfo.id = userId || userInfo.id;
        }
    } catch (e) { }


    // KẾT NỐI POKER
    if (userInfo.id) pokerGame.handleSocket(socket, userInfo);

    // KẾT NỐI TAI XIU - FIX: Gọi sendCurrentState ngay khi connect
    if (typeof txGame !== 'undefined' && txGame && userId) {
        socket.join(`user_${userId}`);
        if (txGame.sendCurrentState) txGame.sendCurrentState(socket); // FIX: Thực sự gọi hàm
        socket.on('tx_bet', async d => socket.emit((await txGame.handleBet(userId, d.side, +d.amount)).success ? 'tx_bet_success' : 'tx_bet_error', { msg: 'Done' }));
    }
});

const PORT = process.env.PORT || 3000;
// LEGACY REDIRECT
app.get('/lobby.html', (req, res) => res.redirect('/'));

// Serve Taixiu page (friendly route without .html)
app.get('/taixiu', (req, res) => {
    // require login to enter table; if not logged-in redirect to root
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'taixiu.html'));
});

// Serve Poker page
app.get('/poker', (req, res) => {
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'poker.html'));
});



server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server: http://localhost:${PORT}`));