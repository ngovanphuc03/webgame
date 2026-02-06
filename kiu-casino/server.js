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

// --- AUTO-MIGRATE: Add username/avatar columns to wallet ---
(async () => {
    try {
        await dbPool.execute("ALTER TABLE wallet ADD COLUMN username VARCHAR(128) DEFAULT ''").catch(() => { });
        await dbPool.execute("ALTER TABLE wallet ADD COLUMN avatar VARCHAR(512) DEFAULT ''").catch(() => { });
        console.log('✅ wallet table columns checked (username, avatar)');
    } catch (e) { /* columns already exist */ }
})();

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
            const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, id]);
            if (rows.length === 0) {
                await dbPool.execute('INSERT INTO wallet (guild_id, user_id, balance, username, avatar) VALUES (?,?,?,?,?)', [TARGET_GUILD_ID, id, 10000, username, avatarUrl]);
            } else {
                await dbPool.execute('UPDATE wallet SET username=?, avatar=? WHERE guild_id=? AND user_id=?', [username, avatarUrl, TARGET_GUILD_ID, id]);
            }
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
// SLOT MACHINE API
// ============================================================
const slotLimiter = rateLimit({
    windowMs: 5 * 1000,
    max: 3,
    message: { error: 'Quay quá nhanh! Đợi vài giây.' }
});

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '⭐', '7️⃣', '💎'];
const SLOT_WEIGHTS = [25, 22, 20, 18, 10, 5];
const SLOT_PAYOUTS = { '💎': 50, '7️⃣': 30, '⭐': 20, '🍒': 10, '🍋': 5, '🍊': 3 };

function getSlotSymbol() {
    const total = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
        r -= SLOT_WEIGHTS[i];
        if (r <= 0) return SLOT_SYMBOLS[i];
    }
    return SLOT_SYMBOLS[0];
}

app.post('/api/slot/spin', requireAuth, slotLimiter, async (req, res) => {
    const uid = req.cookies.user_id;
    const { bet } = req.body;

    if (!bet || !Number.isInteger(bet) || bet < 500 || bet > 100000) {
        return res.status(400).json({ error: 'Cược không hợp lệ (500 - 100,000)' });
    }

    try {
        // Check balance
        const [rows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        if (!rows.length || Number(rows[0].balance) < bet) {
            return res.status(400).json({ error: 'Không đủ tiền!' });
        }

        // Generate 3 symbols
        const symbols = [getSlotSymbol(), getSlotSymbol(), getSlotSymbol()];

        // Calculate win
        let multiplier = 0;
        if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
            // 3 of a kind
            multiplier = SLOT_PAYOUTS[symbols[0]] || 3;
        } else if (symbols[0] === symbols[1] || symbols[1] === symbols[2] || symbols[0] === symbols[2]) {
            // 2 of a kind
            multiplier = 1.5;
        }

        const winAmount = Math.floor(bet * multiplier);
        const netChange = winAmount - bet;

        // Update balance
        await dbPool.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [netChange, TARGET_GUILD_ID, uid]);

        const [newRows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        const newBalance = newRows.length ? Number(newRows[0].balance) : 0;

        console.log(`[Slot] User ${uid} bet ${bet} -> ${symbols.join(' ')} -> ${winAmount > 0 ? '+' + winAmount : netChange}`);

        res.json({
            symbols,
            multiplier,
            win: winAmount,
            bet,
            netChange,
            newBalance
        });
    } catch (e) {
        console.error('Slot Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
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
    try {
        const [rows] = await dbPool.execute(
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

        // Update DB
        if (rows.length > 0) {
            await dbPool.execute(
                'UPDATE daily_rewards SET last_claim=NOW(), streak=? WHERE user_id=? AND guild_id=?',
                [streak, uid, TARGET_GUILD_ID]
            );
        } else {
            await dbPool.execute(
                'INSERT INTO daily_rewards (user_id, guild_id, last_claim, streak) VALUES (?, ?, NOW(), ?)',
                [uid, TARGET_GUILD_ID, streak]
            );
        }

        // Add to wallet
        await dbPool.execute(
            'UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?',
            [totalReward, TARGET_GUILD_ID, uid]
        );

        const [newRows] = await dbPool.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
        const newBalance = newRows.length ? Number(newRows[0].balance) : 0;

        console.log(`[Daily] User ${uid} claimed daily reward: ${totalReward} (wheel: ${segment.value}, streak bonus: ${streakBonus}, streak: ${streak})`);

        res.json({
            success: true,
            reward: totalReward,
            wheel_value: segment.value,
            streak_bonus: streakBonus,
            streak,
            segment_index: segIndex,
            emoji: segment.emoji,
            newBalance
        });
    } catch (e) {
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

// Serve Slot Machine page
app.get('/slot', (req, res) => {
    if (!req.cookies || !req.cookies.user_id) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'slot.html'));
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