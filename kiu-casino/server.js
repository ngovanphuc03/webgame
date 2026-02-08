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
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // CSP: Allow inline styles/scripts (required by inline HTML pages), Google Fonts, Discord CDN, Socket.IO
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https://cdn.discordapp.com",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'"
    ].join('; '));
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

// --- AUTO-MIGRATE: Add username/avatar columns to wallet ---
(async () => {
    try {
        await dbPool.execute("ALTER TABLE wallet ADD COLUMN username VARCHAR(128) DEFAULT ''").catch(() => { });
        await dbPool.execute("ALTER TABLE wallet ADD COLUMN avatar VARCHAR(512) DEFAULT ''").catch(() => { });
        console.log('✅ wallet table columns checked (username, avatar)');

        // --- CREATE TRANSACTIONS TABLE (audit log) ---
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                guild_id VARCHAR(64) NOT NULL,
                type VARCHAR(32) NOT NULL COMMENT 'mines_bet, mines_win, mines_lose, flappy_reward, daily_reward, poker_win, poker_lose, taixiu_bet, taixiu_win',
                amount BIGINT NOT NULL COMMENT 'positive=credit, negative=debit',
                balance_before BIGINT NOT NULL,
                balance_after BIGINT NOT NULL,
                details JSON DEFAULT NULL COMMENT 'game-specific metadata',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_guild (user_id, guild_id),
                INDEX idx_type (type),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ transactions table ready');

        // --- CREATE MINES_GAMES TABLE (persistent state) ---
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS mines_games (
                user_id VARCHAR(64) NOT NULL,
                guild_id VARCHAR(64) NOT NULL,
                bet BIGINT NOT NULL,
                mine_count INT NOT NULL,
                mines JSON NOT NULL,
                revealed JSON NOT NULL,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ mines_games table ready');

    } catch (e) { console.error('Auto-migrate error:', e.message); }
})();

// --- TRANSACTION LOGGER ---
async function logTx(conn, uid, type, amount, balBefore, balAfter, details) {
    try {
        await conn.execute(
            'INSERT INTO transactions (user_id, guild_id, type, amount, balance_before, balance_after, details) VALUES (?,?,?,?,?,?,?)',
            [uid, TARGET_GUILD_ID, type, amount, balBefore, balAfter, details ? JSON.stringify(details) : null]
        );
    } catch (e) { console.error('[TX LOG]', e.message); }
}
// Shorthand for non-transactional logging
async function logTxSimple(uid, type, amount, balBefore, balAfter, details) {
    try {
        await dbPool.execute(
            'INSERT INTO transactions (user_id, guild_id, type, amount, balance_before, balance_after, details) VALUES (?,?,?,?,?,?,?)',
            [uid, TARGET_GUILD_ID, type, amount, balBefore, balAfter, details ? JSON.stringify(details) : null]
        );
    } catch (e) { console.error('[TX LOG]', e.message); }
}

// --- DISCORD BOT: Auto-sync user info ---
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
let lastSyncTime = 0;
const SYNC_COOLDOWN = 5 * 60 * 1000; // 5 phút cooldown giữa các lần sync

async function fetchDiscordUser(userId) {
    if (!BOT_TOKEN) return null;
    try {
        const res = await axios.get(`https://discord.com/api/v10/users/${userId}`, {
            headers: {
                Authorization: `Bot ${BOT_TOKEN}`,
                'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)'
            }
        });
        const { username, avatar, id } = res.data;
        let avatarUrl = '';
        if (avatar) {
            avatarUrl = `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=128`;
        } else {
            const index = Number((BigInt(id) >> 22n) % 6n);
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
        }
        return { username, avatar: avatarUrl };
    } catch (e) {
        if (e.response && e.response.status === 429) {
            console.warn(`[Discord Bot] Rate limited, retry after ${e.response.data.retry_after}s`);
        }
        return null;
    }
}

async function syncMissingUsers() {
    if (!BOT_TOKEN) return 0;
    const now = Date.now();
    if (now - lastSyncTime < SYNC_COOLDOWN) return -1; // cooldown
    lastSyncTime = now;

    try {
        const [rows] = await dbPool.execute(
            "SELECT user_id FROM wallet WHERE guild_id=? AND (username IS NULL OR username='' OR username LIKE 'User_%')",
            [TARGET_GUILD_ID]
        );
        if (rows.length === 0) return 0;

        let synced = 0;
        for (const row of rows) {
            const info = await fetchDiscordUser(row.user_id);
            if (info) {
                await dbPool.execute(
                    'UPDATE wallet SET username=?, avatar=? WHERE guild_id=? AND user_id=?',
                    [info.username, info.avatar, TARGET_GUILD_ID, row.user_id]
                );
                synced++;
                console.log(`[Sync] ✅ ${row.user_id} → ${info.username}`);
            }
            // Delay 500ms between requests to avoid rate limit
            await new Promise(r => setTimeout(r, 500));
        }
        console.log(`[Sync] Hoàn tất: ${synced}/${rows.length} users đã cập nhật`);
        return synced;
    } catch (e) {
        console.error('[Sync] Error:', e.message);
        return 0;
    }
}

// Auto-sync on startup (after 5s delay)
setTimeout(() => {
    if (BOT_TOKEN) {
        console.log('🔄 Bắt đầu sync thông tin Discord users...');
        syncMissingUsers();
    } else {
        console.log('⚠️ Không có DISCORD_BOT_TOKEN — bảng xếp hạng sẽ dùng tên mặc định. Thêm token vào .env để tự động cập nhật.');
    }
}, 5000);

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

        try {
            const conn = await dbPool.getConnection();
            await conn.beginTransaction();
            const [rows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [TARGET_GUILD_ID, id]);
            if (rows.length === 0) {
                await conn.execute('INSERT INTO wallet (guild_id, user_id, balance, username, avatar) VALUES (?,?,?,?,?)', [TARGET_GUILD_ID, id, 10000, username, avatarUrl]);
                await logTx(conn, id, 'signup_bonus', 10000, 0, 10000, { source: 'discord_oauth' });
            } else {
                await conn.execute('UPDATE wallet SET username=?, avatar=? WHERE guild_id=? AND user_id=?', [username, avatarUrl, TARGET_GUILD_ID, id]);
            }
            await conn.commit();
            conn.release();
        } catch (e) { console.error("Lỗi DB:", e.message); }

        res.cookie('user_id', id, COOKIE_OPTS);

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
        let r;
        try {
            [r] = await dbPool.execute('SELECT balance, username, avatar FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        } catch (colErr) {
            [r] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        }
        let info = { username: 'User', avatar: '' };

        // Try DB first for username/avatar
        if (r.length && r[0].username) info.username = r[0].username;
        if (r.length && r[0].avatar) info.avatar = r[0].avatar;

        // Override with cookie info if available (more up-to-date)
        if (req.cookies.user_info) {
            try {
                const raw = JSON.parse(req.cookies.user_info.startsWith('j:') ? req.cookies.user_info.slice(2) : req.cookies.user_info);
                if (raw.username) info.username = decodeURIComponent(raw.username);
                if (raw.avatar) info.avatar = raw.avatar;
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
    const conn = await dbPool.getConnection();

    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        if (!rows.length) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Lỗi: Không tìm thấy ví tiền' });
        }

        const balBefore = Number(rows[0].balance);
        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [goldReward, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore + goldReward;

        await logTx(conn, uid, 'flappy_reward', goldReward, balBefore, balAfter, { score });
        await conn.commit();
        conn.release();

        console.log(`[FlappyBird] User ${uid} score ${score} -> +${goldReward} gold. New Balance: ${balAfter}`);
        res.json({ success: true, addedGold: goldReward, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Flappy Reward Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});


// ============================================================
// CRASH GAME API
// ============================================================

// In-memory crash bets per user (single-player per-round)
// userId -> { bet, status, crashPoint, cashedAt, ts, flyStart }
const crashBets = new Map();

const crashLimiter = rateLimit({
    windowMs: 3 * 1000,
    max: 15,
    message: { error: 'Quá nhanh! Đợi vài giây.' }
});

// Server-side crash point generator (provably fair)
function generateCrashPoint() {
    const HOUSE_EDGE = 0.04;
    const r = Math.random();
    if (r < HOUSE_EDGE) return 1.00;
    const raw = 1 / (1 - r);
    return Math.min(Math.round(raw * 100) / 100, 100);
}

// Place a crash bet (deducts balance, generates crash point server-side)
app.post('/api/crash/bet', requireAuth, crashLimiter, async (req, res) => {
    const uid = req.cookies.user_id;
    const { bet } = req.body;

    if (!bet || !Number.isInteger(bet) || bet < 500 || bet > 100000) {
        return res.status(400).json({ error: 'Cược không hợp lệ (500 - 100,000)' });
    }

    // Prevent double bet
    if (crashBets.has(uid)) {
        return res.status(400).json({ error: 'Bạn đã đặt cược rồi!' });
    }

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        if (!rows.length || Number(rows[0].balance) < bet) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Không đủ tiền!' });
        }

        const balBefore = Number(rows[0].balance);
        await conn.execute('UPDATE wallet SET balance = balance - ? WHERE guild_id=? AND user_id=?',
            [bet, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore - bet;

        await logTx(conn, uid, 'crash_bet', -bet, balBefore, balAfter, { bet });
        await conn.commit();
        conn.release();

        // Generate crash point SERVER-SIDE (the source of truth)
        const crashPoint = generateCrashPoint();
        crashBets.set(uid, {
            bet, status: 'pending', crashPoint,
            cashedAt: 0, ts: Date.now(), flyStart: 0
        });

        console.log(`[Crash] User ${uid} bet ${bet}, crashPoint=${crashPoint}`);
        res.json({ success: true, bet, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Crash Bet Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Start the flying phase — reveals crash point (only after waiting period)
app.post('/api/crash/start', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const entry = crashBets.get(uid);

    if (!entry || entry.status !== 'pending') {
        return res.status(400).json({ error: 'Không có cược đang đợi!' });
    }

    // Ensure at least 2 seconds have passed since bet (anti-cheat: must wait)
    if (Date.now() - entry.ts < 2000) {
        return res.status(400).json({ error: 'Đợi hết countdown!' });
    }

    entry.status = 'active';
    entry.flyStart = Date.now();

    // Return the crash point for client animation
    res.json({ success: true, crashPoint: entry.crashPoint });
});

// Cancel a pending crash bet (only before round starts)
app.post('/api/crash/cancel', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const entry = crashBets.get(uid);

    if (!entry || entry.status !== 'pending') {
        return res.status(400).json({ error: 'Không có cược để hủy!' });
    }

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        const balBefore = rows.length ? Number(rows[0].balance) : 0;
        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?',
            [entry.bet, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore + entry.bet;

        await logTx(conn, uid, 'crash_cancel', entry.bet, balBefore, balAfter, { refund: true });
        await conn.commit();
        conn.release();

        crashBets.delete(uid);
        console.log(`[Crash] User ${uid} cancelled bet ${entry.bet}`);
        res.json({ success: true, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Crash Cancel Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Cashout from crash — SERVER validates multiplier against crash point
app.post('/api/crash/cashout', requireAuth, crashLimiter, async (req, res) => {
    const uid = req.cookies.user_id;
    const { multiplier } = req.body;
    const entry = crashBets.get(uid);

    if (!entry || entry.status !== 'active') {
        return res.status(400).json({ error: 'Không có cược đang chơi!' });
    }

    if (!multiplier || multiplier < 1 || multiplier > 100) {
        return res.status(400).json({ error: 'Hệ số không hợp lệ' });
    }

    // *** CRITICAL VALIDATION: multiplier must not exceed crash point ***
    if (multiplier > entry.crashPoint) {
        // Round already crashed — player loses
        entry.status = 'busted';
        setTimeout(() => crashBets.delete(uid), 10000);
        console.log(`[Crash] User ${uid} BUSTED! Tried ${multiplier}x but crash=${entry.crashPoint}x`);
        return res.status(400).json({
            error: 'Đã nổ rồi!',
            crashed: true,
            crashPoint: entry.crashPoint
        });
    }

    // Validate time elapsed (anti-cheat: can't cashout instantly at high mult)
    const flyElapsed = (Date.now() - entry.flyStart) / 1000;
    if (flyElapsed < 0.3 && multiplier > 1.5) {
        return res.status(400).json({ error: 'Quá nhanh! Đợi thêm.' });
    }

    const mult = Math.round(multiplier * 100) / 100;
    const winAmount = Math.floor(entry.bet * mult);
    const profit = winAmount - entry.bet;

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        const balBefore = rows.length ? Number(rows[0].balance) : 0;
        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?',
            [winAmount, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore + winAmount;

        await logTx(conn, uid, 'crash_win', winAmount, balBefore, balAfter,
            { bet: entry.bet, multiplier: mult, crashPoint: entry.crashPoint, profit });
        await conn.commit();
        conn.release();

        entry.status = 'cashedOut';
        entry.cashedAt = mult;
        setTimeout(() => crashBets.delete(uid), 30000);

        console.log(`[Crash] User ${uid} CASHOUT! Bet=${entry.bet}, Mult=${mult}, CrashPoint=${entry.crashPoint}, Win=${winAmount}`);
        res.json({ success: true, multiplier: mult, winAmount, profit, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Crash Cashout Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Report round ended (bust) — marks bet as lost
app.post('/api/crash/bust', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const entry = crashBets.get(uid);

    if (!entry || (entry.status !== 'active' && entry.status !== 'pending')) {
        return res.json({ success: true }); // Already handled
    }

    const crashPoint = entry.crashPoint || 1.00;
    // Use logTxSimple (no conn required) for non-transactional logging
    await logTxSimple(uid, 'crash_bust', -entry.bet, 0, 0,
        { bet: entry.bet, crashPoint }).catch(() => { });

    console.log(`[Crash] User ${uid} BUSTED at ${crashPoint}x, lost ${entry.bet}`);
    crashBets.delete(uid);
    res.json({ success: true, crashPoint });
});

// Auto-cleanup stale crash bets — refund if still pending, log loss if active
setInterval(async () => {
    const now = Date.now();
    for (const [uid, entry] of crashBets) {
        if (now - entry.ts > 120000) {
            // If still pending (never started), refund the player
            if (entry.status === 'pending') {
                let conn;
                try {
                    conn = await dbPool.getConnection();
                    await conn.beginTransaction();
                    const [rows] = await conn.execute(
                        'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
                        [TARGET_GUILD_ID, uid]);
                    const balBefore = rows.length ? Number(rows[0].balance) : 0;
                    await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?',
                        [entry.bet, TARGET_GUILD_ID, uid]);
                    await logTx(conn, uid, 'crash_stale_refund', entry.bet, balBefore, balBefore + entry.bet,
                        { reason: 'stale_pending' });
                    await conn.commit();
                    console.log(`[Crash] Refunded stale pending bet for ${uid}: ${entry.bet}`);
                } catch (e) {
                    if (conn) await conn.rollback().catch(() => { });
                    console.error('[Crash] Stale refund error:', e);
                } finally {
                    if (conn) conn.release();
                }
            } else {
                console.log(`[Crash] Cleaned up stale bet for ${uid} (status: ${entry.status})`);
            }
            crashBets.delete(uid);
        }
    }
}, 30000);

// ============================================================
// MINES GAME API (DB-persistent, transactional)
// ============================================================
const minesLimiter = rateLimit({
    windowMs: 3 * 1000,
    max: 10,
    message: { error: 'Quá nhanh! Đợi vài giây.' }
});

// Calculate multiplier for mines game
// Uses fair probability with 3% house edge + reasonable max caps
const MINES_MAX_MULT = { 1: 25, 2: 80, 3: 250, 4: 500, 5: 1000, 6: 1500, 7: 2000, 8: 2500, 9: 3000, 10: 5000, 11: 5000, 12: 6000, 13: 7000, 14: 8000, 15: 10000, 16: 12000, 17: 14000, 18: 16000, 19: 18000, 20: 25000, 21: 30000, 22: 40000, 23: 50000, 24: 25 };
function calcMinesMultiplier(mineCount, revealedCount) {
    const safeCells = 25 - mineCount;
    let multiplier = 0.97; // 3% house edge
    for (let i = 0; i < revealedCount; i++) {
        multiplier *= (25 - i) / (safeCells - i);
    }
    multiplier = Math.round(multiplier * 100) / 100;
    const cap = MINES_MAX_MULT[mineCount] || 5000;
    return Math.min(multiplier, cap);
}

// Helper: get active mines game from DB
async function getMinesGame(conn, uid) {
    const [rows] = await conn.execute(
        'SELECT bet, mine_count, mines, revealed, started_at FROM mines_games WHERE user_id=? AND guild_id=?',
        [uid, TARGET_GUILD_ID]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
        bet: Number(r.bet),
        mineCount: r.mine_count,
        mines: typeof r.mines === 'string' ? JSON.parse(r.mines) : r.mines,
        revealed: typeof r.revealed === 'string' ? JSON.parse(r.revealed) : r.revealed,
        startTime: new Date(r.started_at).getTime()
    };
}

// Auto-expire old mines games (>10 minutes) — refund bets
setInterval(async () => {
    try {
        // Find expired games first so we can refund
        const [expiredGames] = await dbPool.execute(
            'SELECT user_id, bet FROM mines_games WHERE guild_id=? AND started_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)',
            [TARGET_GUILD_ID]
        );
        if (expiredGames.length === 0) return;

        for (const game of expiredGames) {
            const conn = await dbPool.getConnection();
            try {
                await conn.beginTransaction();
                // Refund bet
                const [walletRows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [TARGET_GUILD_ID, game.user_id]);
                const balBefore = walletRows.length ? Number(walletRows[0].balance) : 0;
                await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [Number(game.bet), TARGET_GUILD_ID, game.user_id]);
                const balAfter = balBefore + Number(game.bet);
                // Delete game
                await conn.execute('DELETE FROM mines_games WHERE user_id=? AND guild_id=?', [game.user_id, TARGET_GUILD_ID]);
                // Log refund
                await logTx(conn, game.user_id, 'mines_expire_refund', Number(game.bet), balBefore, balAfter, { reason: 'game_timeout' });
                await conn.commit();
                conn.release();
                console.log(`[Mines] Expired & refunded ${game.bet} to user ${game.user_id}`);
            } catch (e) {
                await conn.rollback().catch(() => { });
                conn.release();
                console.error('[Mines] Expire refund error:', e.message);
            }
        }
    } catch (e) { /* ignore */ }
}, 60000);

// Start a new mines game
app.post('/api/mines/start', requireAuth, minesLimiter, async (req, res) => {
    const uid = req.cookies.user_id;
    const { bet, mineCount } = req.body;

    if (!bet || !Number.isInteger(bet) || bet < 500 || bet > 100000) {
        return res.status(400).json({ error: 'Cược không hợp lệ (500 - 100,000)' });
    }
    if (!mineCount || !Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24) {
        return res.status(400).json({ error: 'Số mìn không hợp lệ (1 - 24)' });
    }

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        // Check for existing active game
        const existing = await getMinesGame(conn, uid);
        if (existing) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Bạn đang có ván chưa kết thúc!' });
        }

        // Lock wallet row and check balance
        const [rows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        if (!rows.length || Number(rows[0].balance) < bet) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Không đủ tiền!' });
        }

        const balBefore = Number(rows[0].balance);

        // Deduct bet
        await conn.execute('UPDATE wallet SET balance = balance - ? WHERE guild_id=? AND user_id=?', [bet, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore - bet;

        // Generate mine positions (25 cells, 0-24)
        const mines = new Set();
        while (mines.size < mineCount) {
            mines.add(Math.floor(Math.random() * 25));
        }
        const minesArr = [...mines];

        // Save game state to DB
        await conn.execute(
            'INSERT INTO mines_games (user_id, guild_id, bet, mine_count, mines, revealed) VALUES (?,?,?,?,?,?)',
            [uid, TARGET_GUILD_ID, bet, mineCount, JSON.stringify(minesArr), '[]']
        );

        // Log transaction
        await logTx(conn, uid, 'mines_bet', -bet, balBefore, balAfter, { mineCount });

        await conn.commit();
        conn.release();

        console.log(`[Mines] User ${uid} started game: bet=${bet}, mines=${mineCount}`);
        res.json({ success: true, bet, mineCount, totalCells: 25, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Mines Start Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Reveal a cell
app.post('/api/mines/reveal', requireAuth, minesLimiter, async (req, res) => {
    const uid = req.cookies.user_id;
    const { cell } = req.body;

    if (cell === undefined || !Number.isInteger(cell) || cell < 0 || cell > 24) {
        return res.status(400).json({ error: 'Ô không hợp lệ!' });
    }

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        const game = await getMinesGame(conn, uid);
        if (!game) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Không có ván đang chơi!' });
        }

        if (game.revealed.includes(cell)) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Ô này đã mở!' });
        }

        const isMine = game.mines.includes(cell);

        if (isMine) {
            // BOOM - game over, delete game state
            await conn.execute('DELETE FROM mines_games WHERE user_id=? AND guild_id=?', [uid, TARGET_GUILD_ID]);

            // Log loss transaction
            const [walletRows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
            const bal = walletRows.length ? Number(walletRows[0].balance) : 0;
            await logTx(conn, uid, 'mines_lose', 0, bal, bal, { bet: game.bet, mineCount: game.mineCount, revealed: game.revealed.length, hitCell: cell });

            await conn.commit();
            conn.release();

            console.log(`[Mines] User ${uid} HIT MINE at cell ${cell}! Lost ${game.bet}`);
            return res.json({ result: 'mine', cell, mines: game.mines, bet: game.bet, newBalance: bal });
        }

        // Safe cell
        game.revealed.push(cell);
        const multiplier = calcMinesMultiplier(game.mineCount, game.revealed.length);
        const currentWin = Math.floor(game.bet * multiplier);
        const safeCells = 25 - game.mineCount;

        // Check if all safe cells revealed (auto cashout)
        if (game.revealed.length >= safeCells) {
            await conn.execute('DELETE FROM mines_games WHERE user_id=? AND guild_id=?', [uid, TARGET_GUILD_ID]);

            const [walletRows] = await conn.execute(
                'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
                [TARGET_GUILD_ID, uid]
            );
            const balBefore = walletRows.length ? Number(walletRows[0].balance) : 0;
            await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [currentWin, TARGET_GUILD_ID, uid]);
            const balAfter = balBefore + currentWin;

            await logTx(conn, uid, 'mines_win', currentWin, balBefore, balAfter, { bet: game.bet, mineCount: game.mineCount, multiplier, revealed: game.revealed.length, cleared: true });
            await conn.commit();
            conn.release();

            console.log(`[Mines] User ${uid} CLEARED ALL! Won ${currentWin}`);
            return res.json({ result: 'cleared', cell, multiplier, currentWin, mines: game.mines, newBalance: balAfter });
        }

        // Update revealed cells in DB
        await conn.execute(
            'UPDATE mines_games SET revealed=? WHERE user_id=? AND guild_id=?',
            [JSON.stringify(game.revealed), uid, TARGET_GUILD_ID]
        );

        await conn.commit();
        conn.release();

        const nextMultiplier = calcMinesMultiplier(game.mineCount, game.revealed.length + 1);
        res.json({ result: 'safe', cell, multiplier, currentWin, nextMultiplier, revealedCount: game.revealed.length, safeCells });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Mines Reveal Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Cash out current game
app.post('/api/mines/cashout', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const conn = await dbPool.getConnection();

    try {
        await conn.beginTransaction();

        const game = await getMinesGame(conn, uid);
        if (!game) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Không có ván đang chơi!' });
        }

        if (game.revealed.length === 0) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Phải mở ít nhất 1 ô!' });
        }

        const multiplier = calcMinesMultiplier(game.mineCount, game.revealed.length);
        const winAmount = Math.floor(game.bet * multiplier);
        const profit = winAmount - game.bet;

        // Delete game & credit wallet atomically
        await conn.execute('DELETE FROM mines_games WHERE user_id=? AND guild_id=?', [uid, TARGET_GUILD_ID]);

        const [walletRows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        const balBefore = walletRows.length ? Number(walletRows[0].balance) : 0;
        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [winAmount, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore + winAmount;

        await logTx(conn, uid, 'mines_win', winAmount, balBefore, balAfter, { bet: game.bet, mineCount: game.mineCount, multiplier, revealed: game.revealed.length, profit });

        await conn.commit();
        conn.release();

        console.log(`[Mines] User ${uid} CASHED OUT! Bet=${game.bet}, Win=${winAmount}, Profit=${profit > 0 ? '+' : ''}${profit}`);
        res.json({ success: true, multiplier, winAmount, profit, bet: game.bet, mines: game.mines, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Mines Cashout Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Check if user has active game (read from DB)
app.get('/api/mines/status', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        const [rows] = await dbPool.execute(
            'SELECT bet, mine_count, mines, revealed FROM mines_games WHERE user_id=? AND guild_id=?',
            [uid, TARGET_GUILD_ID]
        );
        if (!rows.length) return res.json({ active: false });

        const r = rows[0];
        const game = {
            bet: Number(r.bet),
            mineCount: r.mine_count,
            revealed: typeof r.revealed === 'string' ? JSON.parse(r.revealed) : r.revealed
        };
        const multiplier = game.revealed.length > 0 ? calcMinesMultiplier(game.mineCount, game.revealed.length) : 1;
        const currentWin = Math.floor(game.bet * multiplier);
        res.json({ active: true, bet: game.bet, mineCount: game.mineCount, revealed: game.revealed, multiplier, currentWin });
    } catch (e) {
        console.error('Mines Status Error:', e);
        res.json({ active: false });
    }
});

// ============================================================
// DAILY REWARD API
// ============================================================

// Init daily_rewards table
(async () => {
    try {
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS daily_rewards (
                user_id VARCHAR(64) NOT NULL,
                guild_id VARCHAR(64) NOT NULL,
                last_claim DATETIME NOT NULL,
                streak INT DEFAULT 1,
                PRIMARY KEY (user_id, guild_id)
            )
        `);
        console.log('✅ daily_rewards table ready');
    } catch (e) {
        console.error('Daily rewards table error:', e.message);
    }
})();

const DAILY_WHEEL_SEGMENTS = [
    { label: '500', value: 500, emoji: '🪙' },
    { label: '1,000', value: 1000, emoji: '💰' },
    { label: '2,000', value: 2000, emoji: '💎' },
    { label: '500', value: 500, emoji: '🪙' },
    { label: '3,000', value: 3000, emoji: '🌟' },
    { label: '1,000', value: 1000, emoji: '💰' },
    { label: '5,000', value: 5000, emoji: '👑' },
    { label: '1,500', value: 1500, emoji: '🔥' },
];

const STREAK_BONUS = [0, 500, 1000, 1500, 2000, 3000, 4000, 10000]; // day 0-7

app.get('/api/daily/status', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        const [rows] = await dbPool.execute(
            'SELECT last_claim, streak FROM daily_rewards WHERE user_id=? AND guild_id=?',
            [uid, TARGET_GUILD_ID]
        );

        const now = new Date();
        let streak = 0;
        let claimedToday = false;
        let nextClaimIn = null;

        if (rows.length > 0) {
            const lastClaim = new Date(rows[0].last_claim);
            streak = rows[0].streak || 0;

            const lastDate = lastClaim.toISOString().split('T')[0];
            const todayDate = now.toISOString().split('T')[0];

            if (lastDate === todayDate) {
                claimedToday = true;
                // Calculate time until midnight UTC
                const tomorrow = new Date(now);
                tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
                tomorrow.setUTCHours(0, 0, 0, 0);
                const diffMs = tomorrow - now;
                const hours = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                nextClaimIn = `${hours}h ${mins}m`;
            }

            // Reset streak if missed a day
            const yesterday = new Date(now);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            const yesterdayDate = yesterday.toISOString().split('T')[0];
            if (lastDate !== todayDate && lastDate !== yesterdayDate) {
                streak = 0;
            }
        }

        res.json({ streak: Math.min(streak, 7), claimed_today: claimedToday, next_claim_in: nextClaimIn });
    } catch (e) {
        console.error('Daily Status Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

app.post('/api/daily/claim', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.execute(
            'SELECT last_claim, streak FROM daily_rewards WHERE user_id=? AND guild_id=?',
            [uid, TARGET_GUILD_ID]
        );

        const now = new Date();
        const todayDate = now.toISOString().split('T')[0];
        let streak = 0;

        if (rows.length > 0) {
            const lastClaim = new Date(rows[0].last_claim);
            const lastDate = lastClaim.toISOString().split('T')[0];

            if (lastDate === todayDate) {
                await conn.rollback(); conn.release();
                return res.status(400).json({ error: 'Bạn đã nhận thưởng hôm nay rồi!' });
            }

            const yesterday = new Date(now);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            const yesterdayDate = yesterday.toISOString().split('T')[0];

            if (lastDate === yesterdayDate) {
                streak = Math.min((rows[0].streak || 0) + 1, 7);
            } else {
                streak = 1;
            }
        } else {
            streak = 1;
        }

        // Random wheel segment
        const segIndex = Math.floor(Math.random() * DAILY_WHEEL_SEGMENTS.length);
        const segment = DAILY_WHEEL_SEGMENTS[segIndex];
        const streakBonus = STREAK_BONUS[Math.min(streak, 7)] || 0;
        const totalReward = segment.value + streakBonus;

        // Update daily_rewards
        if (rows.length > 0) {
            await conn.execute(
                'UPDATE daily_rewards SET last_claim=NOW(), streak=? WHERE user_id=? AND guild_id=?',
                [streak, uid, TARGET_GUILD_ID]
            );
        } else {
            await conn.execute(
                'INSERT INTO daily_rewards (user_id, guild_id, last_claim, streak) VALUES (?, ?, NOW(), ?)',
                [uid, TARGET_GUILD_ID, streak]
            );
        }

        // Lock wallet + credit
        const [walletRows] = await conn.execute(
            'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, uid]
        );
        const balBefore = walletRows.length ? Number(walletRows[0].balance) : 0;
        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [totalReward, TARGET_GUILD_ID, uid]);
        const balAfter = balBefore + totalReward;

        // Log transaction
        await logTx(conn, uid, 'daily_claim', totalReward, balBefore, balAfter, { streak, wheelValue: segment.value, streakBonus });

        await conn.commit();
        conn.release();

        console.log(`[Daily] User ${uid} claimed daily reward: ${totalReward} (wheel: ${segment.value}, streak bonus: ${streakBonus}, streak: ${streak})`);

        res.json({
            success: true,
            reward: totalReward,
            wheel_value: segment.value,
            streak_bonus: streakBonus,
            streak,
            segment_index: segIndex,
            emoji: segment.emoji,
            newBalance: balAfter
        });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Daily Claim Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// ============================================================
// LEADERBOARD API
// ============================================================
app.get('/api/leaderboard', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        // Background sync: nếu có bot token, tự động cập nhật user thiếu info
        syncMissingUsers().catch(() => { });

        // Try with username/avatar columns first, fallback to basic query
        let rows;
        try {
            [rows] = await dbPool.execute(
                'SELECT user_id, balance, username, avatar FROM wallet WHERE guild_id=? ORDER BY balance DESC LIMIT 50',
                [TARGET_GUILD_ID]
            );
        } catch (colErr) {
            console.log('[Leaderboard] Fallback to basic query:', colErr.message);
            [rows] = await dbPool.execute(
                'SELECT user_id, balance FROM wallet WHERE guild_id=? ORDER BY balance DESC LIMIT 50',
                [TARGET_GUILD_ID]
            );
        }

        const leaderboard = rows.map(r => {
            let av = r.avatar || '';
            if (!av) {
                try {
                    const index = Number((BigInt(r.user_id) >> 22n) % 6n);
                    av = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
                } catch (e) {
                    av = 'https://cdn.discordapp.com/embed/avatars/0.png';
                }
            }
            return {
                user_id: r.user_id,
                balance: Number(r.balance),
                username: r.username || ('User_' + String(r.user_id).slice(-4)),
                avatar: av
            };
        });

        // Find my rank - safer query that handles missing user
        let myRank = null;
        try {
            const [myWallet] = await dbPool.execute(
                'SELECT balance FROM wallet WHERE guild_id=? AND user_id=?',
                [TARGET_GUILD_ID, uid]
            );
            if (myWallet.length > 0) {
                const myBalance = Number(myWallet[0].balance);
                const [rankRows] = await dbPool.execute(
                    'SELECT COUNT(*) as cnt FROM wallet WHERE guild_id=? AND balance > ?',
                    [TARGET_GUILD_ID, myBalance]
                );
                myRank = Number(rankRows[0].cnt) + 1;
            }
        } catch (rankErr) {
            console.log('[Leaderboard] Rank query error:', rankErr.message);
        }

        res.json({ leaderboard, my_user_id: uid, my_rank: myRank });
    } catch (e) {
        console.error('Leaderboard Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database: ' + e.message });
    }
});

// Manual sync endpoint (admin)
app.get('/api/sync-users', requireAuth, async (req, res) => {
    if (!BOT_TOKEN) {
        return res.status(400).json({ error: 'DISCORD_BOT_TOKEN chưa được cấu hình trong .env' });
    }
    const result = await syncMissingUsers();
    if (result === -1) {
        return res.json({ message: 'Đang cooldown, thử lại sau 5 phút', synced: 0 });
    }
    res.json({ message: `Đã đồng bộ ${result} users`, synced: result });
});

// ============================================================
// ADMIN: TRANSACTION LOG API
// ============================================================
app.get('/api/admin/transactions', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const { type, limit: rawLimit, offset: rawOffset, user } = req.query;

    // Admin check: only ADMIN_USER_IDS (comma-separated in env) can view other users' transactions
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const isAdmin = adminIds.includes(uid);

    try {
        let query = 'SELECT * FROM transactions WHERE guild_id=?';
        const params = [TARGET_GUILD_ID];

        // Admin can filter by any user; normal users can only see their own
        if (user && isAdmin) {
            query += ' AND user_id=?';
            params.push(user);
        } else {
            query += ' AND user_id=?';
            params.push(uid);
        }

        if (type) {
            query += ' AND type=?';
            params.push(type);
        }

        query += ' ORDER BY created_at DESC';

        const limit = Math.min(Math.max(parseInt(rawLimit) || 50, 1), 200);
        const offset = Math.max(parseInt(rawOffset) || 0, 0);
        query += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [rows] = await dbPool.execute(query, params);

        // Parse JSON details field
        const txs = rows.map(r => ({
            ...r,
            amount: Number(r.amount),
            balance_before: Number(r.balance_before),
            balance_after: Number(r.balance_after),
            details: r.details ? (typeof r.details === 'string' ? JSON.parse(r.details) : r.details) : null
        }));

        res.json({ transactions: txs, count: txs.length, offset, limit });
    } catch (e) {
        console.error('Transactions API Error:', e);
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

// Serve Mines game page
app.get('/mines', (req, res) => {
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'mines.html'));
});
// Legacy redirect
app.get('/slot', (req, res) => res.redirect('/mines'));

// Serve Crash game page
app.get('/crash', (req, res) => {
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'crash.html'));
});

// Serve Daily Reward page
app.get('/daily', (req, res) => {
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'daily.html'));
});

// Serve Leaderboard page
app.get('/leaderboard', (req, res) => {
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
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