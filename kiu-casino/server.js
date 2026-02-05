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
const crypto = require('crypto');

// --- VALIDATE REQUIRED ENV VARS ---
const REQUIRED_ENV = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.warn(`⚠️ Missing env vars: ${missingEnv.join(', ')} — Discord OAuth will be disabled.`);
}
const isDiscordConfigured = missingEnv.length === 0;

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// --- SECURITY: CORS & DDOS PROTECTION ---
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || false; // Must set in .env for production

// 1. Socket.IO CORS
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGIN || '*',
        methods: ["GET", "POST"],
        credentials: !!ALLOWED_ORIGIN
    }
});

// 2. Express CORS
app.use(cors({
    origin: ALLOWED_ORIGIN || '*',
    credentials: !!ALLOWED_ORIGIN
}));

// 2.5 Security Headers (helmet-lite)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// 3. Rate Limiter (DDOS Protection)
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// 4. Strict Rate Limiter for Discord OAuth (prevent 429 errors)
const discordAuthLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3, // Only 3 login attempts per minute per IP
    message: 'Bạn đang đăng nhập quá nhanh! Vui lòng đợi 1 phút.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
});

// --- CẤU HÌNH ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(express.json());

const TARGET_GUILD_ID = process.env.GUILD_ID || '949162034954633236';
const IS_PROD = process.env.NODE_ENV === 'production';

// Secure cookie options
const COOKIE_OPTS = {
    maxAge: 86400000,
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax'
};
const COOKIE_OPTS_CLIENT = { // user_info readable by client for display
    maxAge: 86400000,
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'lax'
};

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.cookies || !req.cookies.user_id) {
        return res.status(401).json({ error: 'No login' });
    }
    next();
}

// Flappy anti-cheat: server-side session tokens
const flappySessions = new Map(); // userId -> { token, startTime }
// Periodic cleanup: remove stale sessions older than 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [uid, session] of flappySessions) {
        if (now - session.startTime > 600000) flappySessions.delete(uid);
    }
}, 60000);


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
app.get('/auth/discord', discordAuthLimiter, (req, res) => {
    if (!isDiscordConfigured) return res.status(503).send('Discord OAuth is not configured.');
    const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/auth/discord/callback', discordAuthLimiter, async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Lỗi: Không có code!');
    try {
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)'
        };

        const tRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
            code, grant_type: 'authorization_code', redirect_uri: process.env.DISCORD_REDIRECT_URI, scope: 'identify'
        }), { headers });

        const uRes = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tRes.data.access_token}`,
                ...headers
            }
        });
        const { id, username, avatar } = uRes.data;

        try {
            const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, id]);
            if (rows.length === 0) await dbPool.execute('INSERT INTO wallet (guild_id, user_id, balance) VALUES (?,?,?)', [TARGET_GUILD_ID, id, 10000]);
        } catch (e) { console.error("Lỗi DB:", e.message); }

        res.cookie('user_id', id, COOKIE_OPTS);

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
        res.cookie('user_info', info, COOKIE_OPTS_CLIENT);
        res.redirect('/');
    } catch (e) {
        // Handle Discord 429 rate limit error
        if (e.response && e.response.status === 429) {
            const retryAfter = e.response.data.retry_after || 60;
            console.error(`Discord Rate Limited! Retry after ${retryAfter}s`);
            return res.send(`
                <html><head><style>
                    body { background: #1a1a2e; color: #fff; font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .box { text-align: center; padding: 40px; background: #16213e; border-radius: 15px; box-shadow: 0 0 30px rgba(0,200,255,0.3); }
                    h2 { color: #ff6b6b; } a { color: #4ecdc4; }
                </style></head><body><div class="box">
                    <h2>⏳ Discord đang bận!</h2>
                    <p>Vui lòng đợi <strong>${Math.ceil(retryAfter)}</strong> giây rồi thử lại.</p>
                    <p><a href="/">← Quay về trang chủ</a></p>
                </div></body></html>
            `);
        }
        console.error('Login Error:', e.response ? e.response.data : e.message);
        const safeMsg = (e.message || 'Unknown error').replace(/[<>"'&]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c]));
        res.send(`
            <html><head><style>
                body { background: #1a1a2e; color: #fff; font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .box { text-align: center; padding: 40px; background: #16213e; border-radius: 15px; box-shadow: 0 0 30px rgba(255,100,100,0.3); max-width: 500px; }
                h2 { color: #ff6b6b; } a { color: #4ecdc4; }
            </style></head><body><div class="box">
                <h2>❌ Lỗi đăng nhập</h2>
                <p>${safeMsg}</p>
                <p style="margin-top:20px"><a href="/">← Quay về trang chủ</a></p>
            </div></body></html>
        `);
    }
});

// --- DEV LOGIN (BYPASS) - ONLY IN DEVELOPMENT ---
app.get('/auth/fake', async (req, res) => {
    if (IS_PROD) return res.status(403).send('Dev login disabled in production.');

    const id = 'dev_' + Math.floor(Math.random() * 1000000);
    const username = 'Dev_User_' + id.slice(-4);
    const avatar = '';

    try {
        const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, id]);
        if (rows.length === 0) await dbPool.execute('INSERT INTO wallet (guild_id, user_id, balance) VALUES (?,?,?)', [TARGET_GUILD_ID, id, 50000]);
    } catch (e) { console.error("Dev Login DB Error:", e.message); }

    res.cookie('user_id', id, COOKIE_OPTS);
    const info = JSON.stringify({ username: encodeURIComponent(username), avatar: avatar });
    res.cookie('user_info', info, COOKIE_OPTS_CLIENT);

    res.redirect('/');
});

// --- LOGOUT (SERVER-SIDE) ---
app.get('/auth/logout', (req, res) => {
    res.clearCookie('user_id');
    res.clearCookie('user_info');
    res.redirect('/');
});

// API /api/me (enabled when DB configured)
app.get('/api/me', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
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

// Flappy Bird: Start game session (anti-cheat token)
app.post('/api/flappy/start', requireAuth, (req, res) => {
    const uid = req.cookies.user_id;
    const token = crypto.randomBytes(16).toString('hex');
    flappySessions.set(uid, { token, startTime: Date.now(), claimed: false });
    res.json({ token });
});

// Flappy Bird: Rate limiter for reward claims
const flappyRewardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // Max 10 reward claims per minute
    message: { error: 'Bạn đang gửi điểm quá nhanh!' }
});

// Endpoint trả thưởng Flappy Bird (1 điểm = 10 vàng)
app.post('/api/flappy/reward', requireAuth, flappyRewardLimiter, async (req, res) => {
    const uid = req.cookies.user_id;

    const { score, token } = req.body;
    if (!score || score <= 0 || !Number.isInteger(score)) return res.status(400).json({ error: 'Điểm không hợp lệ' });

    // Anti-cheat: validate session token
    const session = flappySessions.get(uid);
    if (!session || session.token !== token || session.claimed) {
        return res.status(400).json({ error: 'Phiên game không hợp lệ' });
    }

    // Check minimum play time (at least 3 seconds per point as sanity check)
    const elapsed = Date.now() - session.startTime;
    const minTime = Math.min(score * 800, 120000); // ~0.8s per point, max 2 min check
    if (elapsed < minTime) {
        return res.status(400).json({ error: 'Thời gian chơi quá ngắn' });
    }

    // Mark session as claimed
    session.claimed = true;
    flappySessions.delete(uid);

    if (score > 1000) return res.status(400).json({ error: 'Điểm quá cao bất thường' });

    const goldReward = score * 10;

    try {
        const [result] = await dbPool.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [goldReward, TARGET_GUILD_ID, uid]);

        if (result.affectedRows === 0) {
            console.error(`[FlappyBird] ERROR: User ${uid} not found in Guild ${TARGET_GUILD_ID}. Update failed.`);
            return res.status(400).json({ error: 'Lỗi: Không tìm thấy ví tiền (Sai GuildID?)' });
        }

        const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        const newBalance = rows.length ? rows[0].balance : 0;
        console.log(`[FlappyBird] User ${uid} score ${score} -> +${goldReward} gold. New Balance: ${newBalance}`);
        res.json({ success: true, addedGold: goldReward, newBalance });
    } catch (e) {
        console.error('Flappy Reward Error:', e);
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
        socket.on('tx_bet', async d => {
            const result = await txGame.handleBet(userId, d.side, +d.amount);
            socket.emit(result.success ? 'tx_bet_success' : 'tx_bet_error', { msg: result.msg || 'OK' });
        });
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



// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// --- 404 ERROR PAGE ---
app.use((req, res) => {
    res.status(404).send(`
        <html><head><meta charset="UTF-8"><title>404 - Không tìm thấy</title>
        <style>
            body { background: #0a0b1e; color: #fff; font-family: 'Arial', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .box { text-align: center; }
            h1 { font-size: 120px; margin: 0; background: linear-gradient(135deg, #00f3ff, #bc13fe); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            p { font-size: 20px; color: #888; margin: 20px 0; }
            a { color: #00f3ff; text-decoration: none; font-size: 18px; border: 2px solid #00f3ff; padding: 12px 30px; border-radius: 30px; transition: all 0.3s; display: inline-block; }
            a:hover { background: #00f3ff; color: #0a0b1e; }
        </style></head><body><div class="box">
            <h1>404</h1>
            <p>Trang bạn tìm kiếm không tồn tại 👾</p>
            <a href="/">← Về trang chủ</a>
        </div></body></html>
    `);
});

// --- 500 ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).send(`
        <html><head><meta charset="UTF-8"><title>500 - Lỗi Server</title>
        <style>
            body { background: #0a0b1e; color: #fff; font-family: 'Arial', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .box { text-align: center; }
            h1 { font-size: 80px; margin: 0; color: #ff6b6b; }
            p { font-size: 18px; color: #888; margin: 20px 0; }
            a { color: #4ecdc4; text-decoration: none; font-size: 18px; }
        </style></head><body><div class="box">
            <h1>500</h1>
            <p>Đã xảy ra lỗi server. Vui lòng thử lại sau.</p>
            <a href="/">← Về trang chủ</a>
        </div></body></html>
    `);
});

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server: http://localhost:${PORT}`));

// --- GRACEFUL SHUTDOWN ---
function gracefulShutdown(signal) {
    console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
    server.close(async () => {
        try { await dbPool.end(); console.log('✅ Database connections closed.'); } catch (e) { /* ignore */ }
        console.log('✅ Server closed.');
        process.exit(0);
    });
    setTimeout(() => { console.error('⚠️ Forced shutdown after timeout'); process.exit(1); }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));