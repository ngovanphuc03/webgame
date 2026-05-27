const dotenv = require('dotenv');
dotenv.config({ path: __dirname + '/.env' });
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mysql = require('mysql2/promise');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const path = require('path');
const compression = require('compression');

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
    },
    maxHttpBufferSize: 5e6 // 5MB for screen share relay frames
});

// 2. Express CORS
app.use(cors({
    origin: ALLOWED_ORIGIN || '*',
    credentials: !!ALLOWED_ORIGIN
}));

// 2.1 Compression (gzip/deflate) — reduces response size by 60-80%
app.use(compression({ level: 6, threshold: 1024 }));

// 2.5 Security Headers (helmet-lite)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), display-capture=(self)');
    // CSP: Allow inline styles/scripts (required by inline HTML pages), Google Fonts, Discord CDN, Socket.IO, HLS.js CDN
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https://cdn.discordapp.com",
        "media-src 'self' blob: data: https: http:",
        "worker-src 'self' blob:",
        "connect-src 'self' ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
        "frame-ancestors 'none'"
    ].join('; '));
    next();
});

// 3. Rate Limiter (DDOS Protection)
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 300, // Limit each IP to 300 requests per windowMs (game apps need high limit)
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// 4. Strict Rate Limiter for Discord OAuth (prevent 429 errors)
const discordAuthLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute per IP (each login = 2 requests)
    message: 'Bạn đang đăng nhập quá nhanh! Vui lòng đợi 1 phút.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful logins against the limit
});

// --- CẤU HÌNH ---
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',      // Cache static files for 1 day
    etag: true,        // Enable ETag for conditional requests
    lastModified: true // Enable Last-Modified header
}));
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
app.use(cookieParser(COOKIE_SECRET));
app.use(express.json());

const TARGET_GUILD_ID = process.env.GUILD_ID || '949162034954633236';
const IS_PROD = process.env.NODE_ENV === 'production';

// Secure cookie options
const COOKIE_OPTS = {
    maxAge: 86400000,
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    signed: true
};
const COOKIE_OPTS_CLIENT = { // user_info readable by client for display
    maxAge: 86400000,
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'lax'
};

// Auth middleware (supports both signed and unsigned cookies for backward compat)
function requireAuth(req, res, next) {
    // Prefer signed cookie, fallback to unsigned for backward compatibility
    const uid = (req.signedCookies && req.signedCookies.user_id) || (req.cookies && req.cookies.user_id);
    if (!uid) {
        return res.status(401).json({ error: 'No login' });
    }
    // Normalize: store resolved uid in req.cookies.user_id for downstream
    req.cookies.user_id = uid;
    next();
}

// Flappy anti-cheat: server-side session tokens
const flappySessions = new Map(); // userId -> { token, startTime }
// Block Blast anti-cheat: server-side session tokens
const blockblastSessions = new Map(); // userId -> { token, startTime, claimed }
// Periodic cleanup: remove stale sessions older than 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [uid, session] of flappySessions) {
        if (now - session.startTime > 600000) flappySessions.delete(uid);
    }
    for (const [uid, session] of blockblastSessions) {
        if (now - session.startTime > 3600000) blockblastSessions.delete(uid); // 1 hour for block blast (longer games)
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

        // --- CREATE ACHIEVEMENTS TABLE ---
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS achievements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                badge_key VARCHAR(64) NOT NULL,
                unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_badge (guild_id, user_id, badge_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ achievements table ready');

        // --- CREATE MINI_GAME_SCORES TABLE ---
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS mini_game_scores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(64) NOT NULL,
                user_id VARCHAR(64) NOT NULL,
                game_id VARCHAR(32) NOT NULL,
                score INT NOT NULL,
                metadata JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_user_game (guild_id, user_id, game_id),
                INDEX idx_game_score (game_id, score DESC)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ mini_game_scores table ready');

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

// --- DISCORD ROLE DETECTION: Fetch real Discord roles for users ---
const RANK_ROLE_NAMES = {
    'Ông Trùm': { name: 'Ông Trùm', color: '#ffd700', icon: '👑', tier: 6 },
    'Lão Làng': { name: 'Lão Làng', color: '#8b5cf6', icon: '🐉', tier: 5 },
    'Đàn Anh': { name: 'Đàn Anh', color: '#ff00aa', icon: '⚔️', tier: 4 },
    'Tay Chơi': { name: 'Tay Chơi', color: '#00f0ff', icon: '🎯', tier: 3 },
    'Lính Mới': { name: 'Lính Mới', color: '#00ff88', icon: '🛡️', tier: 2 },
    'Người Qua Đường': { name: 'Người Qua Đường', color: '#888', icon: '👤', tier: 1 },
};
// Cache guild roles list (role id → role name) - refresh every 30 min
let guildRolesCache = null;
let guildRolesCacheTime = 0;
const GUILD_ROLES_CACHE_TTL = 30 * 60 * 1000;

// Cache member roles (userId → { rank, fetchedAt })
const memberRankCache = new Map();
const MEMBER_RANK_CACHE_TTL = 10 * 60 * 1000; // 10 min

async function fetchGuildRoles() {
    if (!BOT_TOKEN) return null;
    const now = Date.now();
    if (guildRolesCache && (now - guildRolesCacheTime) < GUILD_ROLES_CACHE_TTL) return guildRolesCache;
    try {
        const res = await axios.get(`https://discord.com/api/v10/guilds/${TARGET_GUILD_ID}/roles`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}`, 'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)' }
        });
        // Map role id → role name
        const roleMap = {};
        for (const role of res.data) {
            roleMap[role.id] = role.name;
        }
        guildRolesCache = roleMap;
        guildRolesCacheTime = now;
        console.log(`[Discord] Fetched ${Object.keys(roleMap).length} guild roles`);
        return roleMap;
    } catch (e) {
        console.error('[Discord] Failed to fetch guild roles:', e.message);
        return guildRolesCache; // return stale cache if available
    }
}

async function fetchMemberDiscordRank(userId) {
    if (!BOT_TOKEN) return null;
    // Check cache
    const now = Date.now();
    const cached = memberRankCache.get(userId);
    if (cached && (now - cached.fetchedAt) < MEMBER_RANK_CACHE_TTL) return cached.rank;

    try {
        const guildRoles = await fetchGuildRoles();
        if (!guildRoles) return null;

        const res = await axios.get(`https://discord.com/api/v10/guilds/${TARGET_GUILD_ID}/members/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}`, 'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)' }
        });
        const memberRoleIds = res.data.roles || [];
        // Find highest-tier rank role this member has
        let bestRank = null;
        for (const roleId of memberRoleIds) {
            const roleName = guildRoles[roleId];
            if (roleName && RANK_ROLE_NAMES[roleName]) {
                const candidate = RANK_ROLE_NAMES[roleName];
                if (!bestRank || candidate.tier > bestRank.tier) {
                    bestRank = candidate;
                }
            }
        }
        // Cache result (even null = no rank role)
        memberRankCache.set(userId, { rank: bestRank, fetchedAt: now });
        return bestRank;
    } catch (e) {
        if (e.response && e.response.status === 429) {
            console.warn(`[Discord] Rate limited fetching member ${userId}, retry after ${e.response.data.retry_after}s`);
        } else if (e.response && e.response.status === 404) {
            // Member not in guild
            memberRankCache.set(userId, { rank: null, fetchedAt: now });
        }
        // Return cached if available, otherwise null
        return cached ? cached.rank : null;
    }
}

// Batch fetch Discord ranks for multiple users (with rate limit protection)
async function batchFetchDiscordRanks(userIds) {
    if (!BOT_TOKEN || !userIds.length) return {};
    const results = {};
    const toFetch = [];
    const now = Date.now();

    // Check cache first
    for (const uid of userIds) {
        const cached = memberRankCache.get(uid);
        if (cached && (now - cached.fetchedAt) < MEMBER_RANK_CACHE_TTL) {
            results[uid] = cached.rank;
        } else {
            toFetch.push(uid);
        }
    }

    // Fetch guild roles once
    if (toFetch.length > 0) {
        await fetchGuildRoles();
    }

    // Fetch missing members (with 200ms delay between to avoid rate limit)
    for (const uid of toFetch) {
        try {
            const rank = await fetchMemberDiscordRank(uid);
            results[uid] = rank;
        } catch (e) {
            results[uid] = null;
        }
        if (toFetch.indexOf(uid) < toFetch.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
    return results;
}

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
            const ext = avatar.startsWith('a_') ? 'gif' : 'png';
            avatarUrl = `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=128`;
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
// OAuth state store for CSRF protection & prevent code reuse
const oauthStates = new Map(); // state → { createdAt }
setInterval(() => { // cleanup expired states every 5 min
    const now = Date.now();
    for (const [s, v] of oauthStates) {
        if (now - v.createdAt > 300000) oauthStates.delete(s); // 5 min TTL
    }
}, 300000);

// Helper: render styled error/info page with auto-redirect
function renderAuthPage({ title, icon, message, color, redirectUrl, redirectSec }) {
    const rSec = redirectSec || 5;
    const rUrl = redirectUrl || '/';
    const metaRefresh = `<meta http-equiv="refresh" content="${rSec};url=${rUrl}">`;
    return `
        <html><head>${metaRefresh}<style>
            @font-face { font-family: 'DearPix'; src: url('/fonts/dearpix-1-94.ttf') format('truetype'); font-display: swap; }
            body { background: #1a1a2e; color: #fff; font-family: 'DearPix', Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .box { text-align: center; padding: 40px; background: #16213e; border-radius: 15px; box-shadow: 0 0 30px ${color || 'rgba(255,100,100,0.3)'}; max-width: 500px; }
            h2 { color: ${color === 'rgba(0,200,255,0.3)' ? '#4ecdc4' : '#ff6b6b'}; } a { color: #4ecdc4; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .countdown { color: rgba(255,255,255,0.5); font-size: 14px; margin-top: 12px; }
        </style></head><body><div class="box">
            <h2>${icon} ${title}</h2>
            <p>${message}</p>
            <p style="margin-top:20px"><a href="${rUrl}">← Quay về trang chủ</a></p>
            <p class="countdown">Tự động chuyển hướng sau ${rSec} giây...</p>
        </div></body></html>
    `;
}

// Discord OAuth routes (enabled when env is configured)
app.get('/auth/discord', discordAuthLimiter, (req, res) => {
    if (!isDiscordConfigured) return res.status(503).send('Discord OAuth is not configured.');
    // Generate CSRF state token
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { createdAt: Date.now() });
    const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify&state=${state}&prompt=consent`;
    res.redirect(url);
});

app.get('/auth/discord/callback', discordAuthLimiter, async (req, res) => {
    const { code, error, error_description, state } = req.query;

    // 1. User cancelled on Discord's authorization page
    if (error === 'access_denied' || error === 'consent_required') {
        console.log('[Auth] User cancelled Discord authorization');
        return res.send(renderAuthPage({
            title: 'Đăng nhập đã huỷ',
            icon: '↩️',
            message: 'Bạn đã huỷ đăng nhập Discord. Bấm nút bên dưới để thử lại.',
            color: 'rgba(0,200,255,0.3)',
            redirectUrl: '/',
            redirectSec: 3
        }));
    }

    // 2. Other Discord errors (e.g. server_error, temporarily_unavailable)
    if (error) {
        console.error('[Auth] Discord OAuth error:', error, error_description);
        return res.send(renderAuthPage({
            title: 'Lỗi từ Discord',
            icon: '⚠️',
            message: error_description || `Discord trả về lỗi: ${error}`,
            redirectSec: 5
        }));
    }

    // 3. No code received at all
    if (!code) {
        return res.send(renderAuthPage({
            title: 'Lỗi đăng nhập',
            icon: '❌',
            message: 'Không nhận được mã xác thực từ Discord. Vui lòng thử lại.',
            redirectSec: 3
        }));
    }

    // 4. Validate CSRF state
    if (state && !oauthStates.has(state)) {
        // State was already used (page refresh) or expired — just redirect home silently
        console.log('[Auth] Stale/reused OAuth state detected, redirecting to /');
        return res.redirect('/');
    }
    // Delete state immediately to prevent code reuse on page refresh
    if (state) oauthStates.delete(state);

    try {
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)'
        };

        // Exchange code for access token
        let tRes;
        try {
            tRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.DISCORD_REDIRECT_URI,
                scope: 'identify'
            }), { headers, timeout: 10000 });
        } catch (tokenErr) {
            // Handle specific Discord token exchange errors
            if (tokenErr.response) {
                const errData = tokenErr.response.data;
                const errCode = errData?.error || '';
                const status = tokenErr.response.status;

                // invalid_grant: code already used or expired (e.g. user refreshed the callback page)
                if (errCode === 'invalid_grant' || (status === 400 && String(errData).includes('invalid'))) {
                    console.log('[Auth] Invalid grant (code reused/expired), redirecting to /');
                    return res.redirect('/');
                }

                // invalid_client: wrong client_id or client_secret
                if (errCode === 'invalid_client') {
                    console.error('[Auth] CRITICAL: Invalid client credentials! Check DISCORD_CLIENT_ID & DISCORD_CLIENT_SECRET in .env');
                    return res.send(renderAuthPage({
                        title: 'Lỗi cấu hình server',
                        icon: '🔧',
                        message: 'Thông tin xác thực Discord không hợp lệ. Vui lòng liên hệ admin.',
                        redirectSec: 10
                    }));
                }

                // Rate limit
                if (status === 429) {
                    const retryAfter = errData?.retry_after || 60;
                    console.error(`[Auth] Discord Rate Limited! Retry after ${retryAfter}s`);
                    return res.send(renderAuthPage({
                        title: 'Discord đang bận!',
                        icon: '⏳',
                        message: `Có quá nhiều yêu cầu đăng nhập. Vui lòng đợi <strong>${Math.ceil(retryAfter)}</strong> giây rồi thử lại.`,
                        color: 'rgba(0,200,255,0.3)',
                        redirectSec: Math.ceil(retryAfter)
                    }));
                }

                // redirect_uri mismatch
                if (errCode === 'redirect_uri_mismatch' || String(JSON.stringify(errData)).includes('redirect_uri')) {
                    console.error('[Auth] CRITICAL: Redirect URI mismatch! .env DISCORD_REDIRECT_URI does not match Discord Developer Portal.');
                    return res.send(renderAuthPage({
                        title: 'Lỗi cấu hình Redirect URI',
                        icon: '🔧',
                        message: 'Redirect URI không khớp. Vui lòng liên hệ admin để kiểm tra cấu hình.',
                        redirectSec: 10
                    }));
                }
            }
            // Re-throw for generic handler
            throw tokenErr;
        }

        // Fetch user info
        const uRes = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${tRes.data.access_token}`,
                'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)'
            },
            timeout: 10000
        });
        const { id, username, avatar } = uRes.data;

        let avatarUrl = "";
        if (avatar) {
            const ext = avatar.startsWith('a_') ? 'gif' : 'png';
            avatarUrl = `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=128`;
        } else {
            try {
                const index = Number((BigInt(id) >> 22n) % 6n);
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
            } catch (e) {
                avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
            }
        }

        // Save to DB (with proper connection release in finally)
        let conn;
        try {
            conn = await dbPool.getConnection();
            await conn.beginTransaction();
            const [rows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [TARGET_GUILD_ID, id]);
            if (rows.length === 0) {
                await conn.execute('INSERT INTO wallet (guild_id, user_id, balance, username, avatar) VALUES (?,?,?,?,?)', [TARGET_GUILD_ID, id, 10000, username, avatarUrl]);
                await logTx(conn, id, 'signup_bonus', 10000, 0, 10000, { source: 'discord_oauth' });
            } else {
                await conn.execute('UPDATE wallet SET username=?, avatar=? WHERE guild_id=? AND user_id=?', [username, avatarUrl, TARGET_GUILD_ID, id]);
            }
            await conn.commit();
        } catch (dbErr) {
            if (conn) await conn.rollback().catch(() => { });
            console.error("[Auth] DB Error:", dbErr.message);
            // Don't block login — user can still play, DB will sync later
        } finally {
            if (conn) conn.release();
        }

        // Set cookies and redirect
        res.cookie('user_id', id, COOKIE_OPTS);
        const info = JSON.stringify({ username: encodeURIComponent(username), avatar: avatarUrl });
        res.cookie('user_info', info, COOKIE_OPTS_CLIENT);
        res.redirect('/');
    } catch (e) {
        // Handle Discord 429 rate limit
        if (e.response && e.response.status === 429) {
            const retryAfter = e.response.data?.retry_after || 60;
            console.error(`[Auth] Discord Rate Limited! Retry after ${retryAfter}s`);
            return res.send(renderAuthPage({
                title: 'Discord đang bận!',
                icon: '⏳',
                message: `Vui lòng đợi <strong>${Math.ceil(retryAfter)}</strong> giây rồi thử lại.`,
                color: 'rgba(0,200,255,0.3)',
                redirectSec: Math.ceil(retryAfter)
            }));
        }
        // Log full error for debugging
        console.error('[Auth] Login Error:', e.response ? JSON.stringify(e.response.data) : e.message);

        // User-friendly error message (don't expose internals)
        let userMsg = 'Đã xảy ra lỗi khi đăng nhập. Vui lòng thử lại.';
        if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
            userMsg = 'Kết nối đến Discord bị timeout. Vui lòng thử lại sau.';
        } else if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
            userMsg = 'Không thể kết nối đến Discord. Kiểm tra kết nối mạng và thử lại.';
        }

        res.send(renderAuthPage({
            title: 'Lỗi đăng nhập',
            icon: '❌',
            message: userMsg,
            redirectSec: 5
        }));
    }
});



// --- LOGOUT (SERVER-SIDE) ---
app.get('/auth/logout', (req, res) => {
    res.clearCookie('user_id');
    res.clearCookie('user_info');
    res.redirect('/');
});

// --- AVATAR PROXY (bypass CSP/referrer/CORS issues with Discord CDN) ---
// In-memory avatar buffer cache (avoid re-fetching from Discord CDN every time)
const avatarCache = new Map(); // userId → { buffer, contentType, cachedAt }
const AVATAR_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
// Cleanup expired avatar cache entries every 30 min
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of avatarCache) {
        if (now - v.cachedAt > AVATAR_CACHE_TTL) avatarCache.delete(k);
    }
}, 30 * 60 * 1000);

app.get('/api/avatar/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!/^\d{17,20}$/.test(userId)) return res.status(400).send('Invalid user ID');

    // Check in-memory cache first
    const cached = avatarCache.get(userId);
    if (cached && (Date.now() - cached.cachedAt < AVATAR_CACHE_TTL)) {
        res.set('Content-Type', cached.contentType);
        res.set('Cache-Control', 'public, max-age=7200'); // browser cache 2h
        return res.send(cached.buffer);
    }

    try {
        // Get avatar URL from DB
        const [rows] = await dbPool.execute(
            'SELECT avatar FROM wallet WHERE guild_id=? AND user_id=?',
            [TARGET_GUILD_ID, userId]
        );
        let avatarUrl = '';
        if (rows.length && rows[0].avatar) {
            avatarUrl = rows[0].avatar;
        } else {
            const index = Number((BigInt(userId) >> 22n) % 6n);
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
        }
        // Fetch from Discord CDN and pipe to client
        const imgRes = await axios.get(avatarUrl, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: { 'User-Agent': 'DiscordBot (https://g18game.onrender.com, 1.0.0)' }
        });
        const contentType = imgRes.headers['content-type'] || 'image/png';
        const buffer = Buffer.from(imgRes.data);

        // Store in cache
        avatarCache.set(userId, { buffer, contentType, cachedAt: Date.now() });

        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=7200'); // browser cache 2h
        res.send(buffer);
    } catch (e) {
        // Fallback: serve local default avatar
        res.redirect('/images/ui/default-avatar.svg');
    }
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

        // Always use avatar proxy to bypass CSP/referrer/CORS issues
        info.avatar = `/api/avatar/${uid}`;

        res.json({ ...info, balance: r.length ? Number(r[0].balance) || 0 : 0 });
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
// BLOCK BLAST GAME API
// ============================================================

// Block Blast: Rate limiter for reward claims
const blockblastRewardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Bạn đang gửi điểm quá nhanh!' }
});

// Block Blast: Start game session (anti-cheat token)
app.post('/api/blockblast/start', requireAuth, (req, res) => {
    const uid = req.cookies.user_id;
    const token = crypto.randomBytes(16).toString('hex');
    blockblastSessions.set(uid, { token, startTime: Date.now(), claimed: false });
    res.json({ token });
});

// Block Blast: Claim reward (score × 5 gold)
app.post('/api/blockblast/reward', requireAuth, blockblastRewardLimiter, async (req, res) => {
    const uid = req.cookies.user_id;
    const { score, token, moves } = req.body;

    if (!score || score <= 0 || !Number.isInteger(score)) return res.status(400).json({ error: 'Điểm không hợp lệ' });

    // Anti-cheat: validate session token
    const session = blockblastSessions.get(uid);
    if (!session || session.token !== token || session.claimed) {
        return res.status(400).json({ error: 'Phiên game không hợp lệ' });
    }

    // Check minimum play time (at least 2 seconds per move)
    const elapsed = Date.now() - session.startTime;
    const minTime = Math.min((moves || 1) * 1500, 300000); // ~1.5s per move, max 5 min check
    if (elapsed < minTime) {
        return res.status(400).json({ error: 'Thời gian chơi quá ngắn' });
    }

    // Mark session as claimed
    session.claimed = true;
    blockblastSessions.delete(uid);

    if (score > 50000) return res.status(400).json({ error: 'Điểm quá cao bất thường' });

    const goldReward = score * 5;
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

        await logTx(conn, uid, 'blockblast_reward', goldReward, balBefore, balAfter, { score, moves });
        await conn.commit();
        conn.release();

        console.log(`[BlockBlast] User ${uid} score ${score} -> +${goldReward} gold. New Balance: ${balAfter}`);
        res.json({ success: true, addedGold: goldReward, newBalance: balAfter });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('BlockBlast Reward Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// ============================================================
// CRASH GAME API
// ============================================================

// Legacy single-player crash bets removed — using multiplayer Socket.IO system
// const crashBets = new Map(); // REMOVED

const crashLimiter = rateLimit({
    windowMs: 3 * 1000,
    max: 15,
    message: { error: 'Quá nhanh! Đợi vài giây.' }
});

// Server-side crash point generator (cryptographically secure)
function generateCrashPoint() {
    const HOUSE_EDGE = 0.04;
    const r = crypto.randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF;
    if (r < HOUSE_EDGE) return 1.00;
    const raw = 1 / (1 - r);
    return Math.min(Math.round(raw * 100) / 100, 100);
}

// Old single-player crash HTTP endpoints removed — all crash gameplay is via Socket.IO multiplayer

// ============================================================
// GLOBAL CHAT: In-memory message history
// ============================================================
const chatHistory = [];

// CRASH MULTIPLAYER: Shared Rounds via Socket.IO
// ============================================================
const crashRoom = 'crash_room';
const crashState = {
    phase: 'waiting',      // 'waiting' | 'flying' | 'crashed'
    crashPoint: 0,
    roundId: 0,
    flyStartTime: 0,
    waitEndTime: 0,
    currentMult: 1.00,
    bettors: new Map(),     // socketId -> { userId, bet, cashedOut, cashoutMult }
    history: []             // last 20 crash points
};

const CRASH_WAIT_MS = 6000;
const CRASH_TICK_MS = 50;
let crashRoundTimer = null;
let crashTickTimer = null;

function crashEmit(event, data) {
    io.to(crashRoom).emit(event, data);
}

function startCrashWaitingPhase() {
    crashState.phase = 'waiting';
    crashState.roundId++;
    crashState.crashPoint = generateCrashPoint();
    crashState.currentMult = 1.00;
    crashState.bettors.clear();
    crashState.waitEndTime = Date.now() + CRASH_WAIT_MS;

    crashEmit('crash_waiting', {
        roundId: crashState.roundId,
        waitMs: CRASH_WAIT_MS,
        history: crashState.history.slice(0, 15)
    });

    console.log(`[CrashMP] Round #${crashState.roundId} waiting, crashPoint=${crashState.crashPoint}`);

    crashRoundTimer = setTimeout(() => {
        startCrashFlyingPhase();
    }, CRASH_WAIT_MS);
}

function startCrashFlyingPhase() {
    crashState.phase = 'flying';
    crashState.flyStartTime = Date.now();

    crashEmit('crash_flying', { roundId: crashState.roundId });

    // Tick loop
    crashTickTimer = setInterval(() => {
        const elapsed = (Date.now() - crashState.flyStartTime) / 1000;
        const speed = 0.06 + elapsed * 0.003;
        crashState.currentMult = Math.round(Math.pow(Math.E, speed * elapsed) * 100) / 100;
        crashState.currentMult = Math.max(1.00, crashState.currentMult);

        if (crashState.currentMult >= crashState.crashPoint || crashState.currentMult >= 100) {
            crashState.currentMult = crashState.crashPoint;
            doCrashRoundEnd();
            return;
        }

        // Check auto-cashouts (from bettors with autoCashout set)
        // This is handled client-side via crash_cashout event

        crashEmit('crash_tick', { mult: crashState.currentMult });
    }, CRASH_TICK_MS);
}

async function doCrashRoundEnd() {
    clearInterval(crashTickTimer);
    crashState.phase = 'crashed';

    // Mark all non-cashed-out bettors as busted
    for (const [sid, bettor] of crashState.bettors) {
        if (!bettor.cashedOut) {
            // Log loss
            await logTxSimple(bettor.userId, 'crash_bust', -bettor.bet, 0, 0,
                { bet: bettor.bet, crashPoint: crashState.crashPoint, roundId: crashState.roundId }).catch(() => { });
        }
    }

    crashState.history.unshift(crashState.crashPoint);
    if (crashState.history.length > 20) crashState.history.pop();

    // Collect all bettors for display
    const bettorsArr = [];
    for (const [sid, b] of crashState.bettors) {
        bettorsArr.push({
            username: b.username || 'Ẩn danh',
            bet: b.bet,
            cashedOut: b.cashedOut,
            cashoutMult: b.cashoutMult || 0,
            profit: b.cashedOut ? Math.floor(b.bet * b.cashoutMult) - b.bet : -b.bet
        });
    }

    crashEmit('crash_crashed', {
        roundId: crashState.roundId,
        crashPoint: crashState.crashPoint,
        bettors: bettorsArr
    });

    console.log(`[CrashMP] Round #${crashState.roundId} CRASHED at ${crashState.crashPoint}x, ${crashState.bettors.size} bettors`);

    // Next round after delay
    setTimeout(() => startCrashWaitingPhase(), 3000);
}

// Start the first crash round (delayed so server is fully ready)
setTimeout(() => startCrashWaitingPhase(), 3000);

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

        // Tier 2: Broadcast significant wins to live feed
        if (profit > 0) {
            try {
                const [uRow] = await dbPool.execute('SELECT username FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
                const uname = uRow.length ? uRow[0].username : 'User';
                broadcastWin(uid, uname, 'mines', winAmount, { multiplier, mineCount: game.mineCount });
            } catch (e) { /* ignore */ }
        }

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

        // Tier 2: Broadcast daily win to live feed
        if (totalReward >= 2000) {
            const [uRows] = await dbPool.execute('SELECT username FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]);
            const uname = uRows.length ? (uRows[0].username || 'User') : 'User';
            broadcastWin(uid, uname, 'daily', totalReward, { streak, wheelValue: segment.value });
        }

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
// TIER 2: LIVE ACTIVITY FEED (in-memory, broadcast via Socket.IO)
// ============================================================
const liveFeed = []; // Last 50 notable events
const MAX_FEED = 50;
const onlineUsers = new Map(); // socketId -> { userId, username, avatar, page, joinedAt }

function pushLiveFeed(entry) {
    entry.ts = Date.now();
    entry.id = crypto.randomBytes(4).toString('hex');
    liveFeed.unshift(entry);
    if (liveFeed.length > MAX_FEED) liveFeed.pop();
    io.emit('live_feed', entry);
}

// Helper: broadcast a notable win to the live feed
function broadcastWin(userId, username, game, amount, details = {}) {
    if (amount < 2000) return; // Only broadcast significant wins
    const gameNames = { mines: '💣 Mines', crash: '🚀 Crash', poker: '🃏 Poker', taixiu: '🎲 Tài Xỉu', flappy: '🐦 Flappy', daily: '🎁 Daily' };
    const gameName = gameNames[game] || game;
    pushLiveFeed({
        type: 'big_win', userId, username, game: gameName, amount, details,
        msg: `${username} vừa thắng ${Number(amount).toLocaleString()}$ tại ${gameName}!`
    });
    // Also send real-time notification to the winner
    io.to(`user_${userId}`).emit('server_notification', {
        type: 'jackpot', title: '🎉 Chiến Thắng!',
        msg: `Bạn đã thắng ${Number(amount).toLocaleString()}$ tại ${gameName}!`
    });
}

// Helper: broadcast achievement unlock
function broadcastAchievement(userId, username, badge) {
    pushLiveFeed({
        type: 'achievement', userId, username,
        badge: badge.icon + ' ' + badge.name,
        msg: `${username} đã mở khóa huy chương "${badge.name}"!`
    });
    io.to(`user_${userId}`).emit('server_notification', {
        type: 'reward', title: '🏆 Achievement Unlocked!',
        msg: `${badge.icon} ${badge.name} — ${badge.desc || ''}`
    });
}

// Helper: broadcast level up
function broadcastLevelUp(userId, username, newLevel, rankRole) {
    pushLiveFeed({
        type: 'level_up', userId, username, level: newLevel,
        rank: rankRole.icon + ' ' + rankRole.name,
        msg: `${username} đã lên Level ${newLevel}! ${rankRole.icon} ${rankRole.name}`
    });
    io.to(`user_${userId}`).emit('server_notification', {
        type: 'level', title: '⭐ Level Up!',
        msg: `Bạn đã lên Level ${newLevel}! Rank: ${rankRole.icon} ${rankRole.name}`
    });
}

// Live Feed API — get recent activity
app.get('/api/live-feed', requireAuth, (req, res) => {
    res.json({ feed: liveFeed.slice(0, 30) });
});

// Online users API
app.get('/api/online', requireAuth, (req, res) => {
    const users = [];
    const seen = new Set();
    for (const [, u] of onlineUsers) {
        if (u.userId && !seen.has(u.userId)) {
            seen.add(u.userId);
            users.push({ userId: u.userId, username: u.username, avatar: `/api/avatar/${u.userId}`, page: u.page });
        }
    }
    res.json({ count: seen.size, users: users.slice(0, 50) });
});

// ============================================================
// TIER 2: TRANSFER MONEY SYSTEM
// ============================================================
const transferLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Chuyển tiền quá nhanh! Đợi 1 phút.' }
});

app.post('/api/transfer', requireAuth, transferLimiter, async (req, res) => {
    const senderId = req.cookies.user_id;
    const { recipientId, amount, note } = req.body;

    // Validate input
    if (!recipientId || typeof recipientId !== 'string' || !/^\d{17,20}$/.test(recipientId)) {
        return res.status(400).json({ error: 'ID người nhận không hợp lệ' });
    }
    if (recipientId === senderId) {
        return res.status(400).json({ error: 'Không thể chuyển tiền cho chính mình' });
    }
    const amt = parseInt(amount);
    if (!amt || amt < 1000 || amt > 1000000) {
        return res.status(400).json({ error: 'Số tiền phải từ 1,000 đến 1,000,000$' });
    }

    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();

        // Lock sender wallet
        const [senderRows] = await conn.execute(
            'SELECT balance, username FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, senderId]
        );
        if (!senderRows.length || Number(senderRows[0].balance) < amt) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Không đủ tiền!' });
        }

        // Lock recipient wallet
        const [recipientRows] = await conn.execute(
            'SELECT balance, username FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
            [TARGET_GUILD_ID, recipientId]
        );
        if (!recipientRows.length) {
            await conn.rollback(); conn.release();
            return res.status(400).json({ error: 'Không tìm thấy người nhận!' });
        }

        const senderBal = Number(senderRows[0].balance);
        const recipientBal = Number(recipientRows[0].balance);
        const senderName = senderRows[0].username || 'User';
        const recipientName = recipientRows[0].username || 'User';

        // Deduct from sender
        await conn.execute('UPDATE wallet SET balance = balance - ? WHERE guild_id=? AND user_id=?', [amt, TARGET_GUILD_ID, senderId]);
        // Credit recipient
        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [amt, TARGET_GUILD_ID, recipientId]);

        const safeNote = note ? String(note).slice(0, 100) : '';

        // Log both sides
        await logTx(conn, senderId, 'transfer_send', -amt, senderBal, senderBal - amt,
            { to: recipientId, toName: recipientName, note: safeNote });
        await logTx(conn, recipientId, 'transfer_receive', amt, recipientBal, recipientBal + amt,
            { from: senderId, fromName: senderName, note: safeNote });

        await conn.commit();
        conn.release();

        console.log(`[Transfer] ${senderId} (${senderName}) → ${recipientId} (${recipientName}): ${amt}$`);

        // Real-time notifications (include both field names for compatibility)
        io.to(`user_${senderId}`).emit('balance_update', { balance: senderBal - amt, new_balance: senderBal - amt });
        io.to(`user_${recipientId}`).emit('balance_update', { balance: recipientBal + amt, new_balance: recipientBal + amt });
        io.to(`user_${recipientId}`).emit('server_notification', {
            type: 'reward', title: '💸 Nhận tiền!',
            msg: `${senderName} đã chuyển cho bạn ${amt.toLocaleString()}$${safeNote ? ` — "${safeNote}"` : ''}`
        });

        // Live feed
        pushLiveFeed({
            type: 'transfer', from: senderName, to: recipientName, amount: amt,
            msg: `${senderName} đã chuyển ${amt.toLocaleString()}$ cho ${recipientName}`
        });

        res.json({
            success: true,
            amount: amt,
            recipientName,
            newBalance: senderBal - amt
        });
    } catch (e) {
        await conn.rollback().catch(() => { });
        conn.release();
        console.error('Transfer Error:', e);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Search users for transfer
app.get('/api/users/search', requireAuth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    try {
        const [rows] = await dbPool.execute(
            'SELECT user_id, username, avatar FROM wallet WHERE guild_id=? AND (username LIKE ? OR user_id=?) LIMIT 10',
            [TARGET_GUILD_ID, `%${q}%`, q]
        );
        res.json({
            users: rows.map(r => ({
                user_id: r.user_id,
                username: r.username || ('User_' + String(r.user_id).slice(-4)),
                avatar: `/api/avatar/${r.user_id}`
            }))
        });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Transfer history
app.get('/api/transfer/history', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        const [rows] = await dbPool.execute(
            `SELECT type, amount, balance_after, details, created_at FROM transactions
             WHERE user_id=? AND guild_id=? AND type IN ('transfer_send','transfer_receive')
             ORDER BY created_at DESC LIMIT 30`,
            [uid, TARGET_GUILD_ID]
        );
        const txs = rows.map(r => ({
            type: r.type,
            amount: Number(r.amount),
            balance_after: Number(r.balance_after),
            details: r.details ? (typeof r.details === 'string' ? JSON.parse(r.details) : r.details) : null,
            time: r.created_at
        }));
        res.json({ transactions: txs });
    } catch (e) {
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// ============================================================
// DISCORD LEVELING INTEGRATION (reads from shared MySQL)
// ============================================================
const LEVEL_ROLES = {
    80: { name: 'Ông Trùm', color: '#ffd700', icon: '👑', tier: 6 },
    40: { name: 'Lão Làng', color: '#8b5cf6', icon: '🐉', tier: 5 },
    20: { name: 'Đàn Anh', color: '#ff00aa', icon: '⚔️', tier: 4 },
    10: { name: 'Tay Chơi', color: '#00f0ff', icon: '🎯', tier: 3 },
    5: { name: 'Lính Mới', color: '#00ff88', icon: '🛡️', tier: 2 },
    1: { name: 'Người Qua Đường', color: '#888', icon: '👤', tier: 1 },
};
function getRankRole(level) {
    const thresholds = [80, 40, 20, 10, 5, 1];
    for (const t of thresholds) { if (level >= t) return { level: t, ...LEVEL_ROLES[t] }; }
    return { level: 0, name: 'Chưa xếp hạng', color: '#555', icon: '❓', tier: 0 };
}
// XP formula matching bot: xp_for_next_level(L) = 5*L² + 50*L + 100
function xpForNextLevel(level) { return 5 * level * level + 50 * level + 100; }
function totalXpForLevel(L) {
    if (L <= 0) return 0;
    // Sum of xpForNextLevel(0..L-1) = 5*(L-1)*L*(2L-1)/6 + 50*(L-1)*L/2 + 100*L
    return Math.floor(5 * (L - 1) * L * (2 * L - 1) / 6 + 50 * (L - 1) * L / 2 + 100 * L);
}

// --- Leveling profile for current user or any user ---
app.get('/api/leveling/profile', requireAuth, async (req, res) => {
    const uid = req.query.user_id || req.cookies.user_id;
    try {
        const [rows] = await dbPool.execute(
            'SELECT xp, level, last_message_ts, last_voice_ts FROM leveling WHERE guild_id=? AND user_id=?',
            [TARGET_GUILD_ID, uid]
        );
        if (rows.length === 0) {
            return res.json({ found: false, level: 0, xp: 0, rank: getRankRole(0), xpForNext: xpForNextLevel(0), xpProgress: 0, totalXp: 0 });
        }
        const row = rows[0];
        const level = Number(row.level) || 0;
        const xp = Number(row.xp) || 0;
        const xpNeeded = xpForNextLevel(level);
        const totalXp = totalXpForLevel(level) + xp;
        // Fetch real Discord rank, fallback to level-based
        const discordRank = await fetchMemberDiscordRank(uid);
        const rank = discordRank || getRankRole(level);

        // Get user's rank position among all members
        const [rankRows] = await dbPool.execute(
            'SELECT COUNT(*) as cnt FROM leveling WHERE guild_id=? AND (level > ? OR (level = ? AND xp > ?))',
            [TARGET_GUILD_ID, level, level, xp]
        );
        const position = Number(rankRows[0].cnt) + 1;

        // Get total members count
        const [totalRows] = await dbPool.execute(
            'SELECT COUNT(*) as cnt FROM leveling WHERE guild_id=?',
            [TARGET_GUILD_ID]
        );

        res.json({
            found: true,
            level,
            xp,
            xpForNext: xpNeeded,
            xpProgress: xpNeeded > 0 ? Math.round((xp / xpNeeded) * 100) : 0,
            totalXp,
            rank,
            position,
            totalMembers: Number(totalRows[0].cnt),
            lastMessage: row.last_message_ts,
            lastVoice: row.last_voice_ts
        });
    } catch (e) {
        console.error('Leveling Profile Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// --- Multi-dimension leaderboard ---
app.get('/api/leaderboard/level', requireAuth, async (req, res) => {
    try {
        const [rows] = await dbPool.execute(
            `SELECT l.user_id, l.level, l.xp, w.username, w.avatar
             FROM leveling l LEFT JOIN wallet w ON l.guild_id=w.guild_id AND l.user_id=w.user_id
             WHERE l.guild_id=? ORDER BY l.level DESC, l.xp DESC LIMIT 50`,
            [TARGET_GUILD_ID]
        );
        const uid = req.cookies.user_id;
        // Find my rank
        const [myRow] = await dbPool.execute(
            'SELECT level, xp FROM leveling WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, uid]
        );
        let myRank = null;
        if (myRow.length) {
            const [r] = await dbPool.execute(
                'SELECT COUNT(*) as cnt FROM leveling WHERE guild_id=? AND (level > ? OR (level = ? AND xp > ?))',
                [TARGET_GUILD_ID, myRow[0].level, myRow[0].level, myRow[0].xp]
            );
            myRank = Number(r[0].cnt) + 1;
        }
        // Fetch real Discord roles for all users in leaderboard
        const userIds = rows.map(r => r.user_id);
        const discordRanks = await batchFetchDiscordRanks(userIds);

        const leaderboard = rows.map(r => {
            const discordRank = discordRanks[r.user_id];
            return {
                user_id: r.user_id,
                level: Number(r.level),
                xp: Number(r.xp),
                totalXp: totalXpForLevel(Number(r.level)) + Number(r.xp),
                rank: discordRank || getRankRole(Number(r.level)),
                username: r.username || ('User_' + String(r.user_id).slice(-4)),
                avatar: `/api/avatar/${r.user_id}`
            };
        });
        res.json({ leaderboard, my_user_id: uid, my_rank: myRank });
    } catch (e) {
        console.error('Level Leaderboard Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

app.get('/api/leaderboard/xp', requireAuth, async (req, res) => {
    try {
        // Total XP = sum formula + current xp
        const [rows] = await dbPool.execute(
            `SELECT l.user_id, l.level, l.xp, w.username, w.avatar
             FROM leveling l LEFT JOIN wallet w ON l.guild_id=w.guild_id AND l.user_id=w.user_id
             WHERE l.guild_id=? ORDER BY l.level DESC, l.xp DESC LIMIT 50`,
            [TARGET_GUILD_ID]
        );
        const uid = req.cookies.user_id;

        // Fetch real Discord roles for all users in leaderboard
        const userIds = rows.map(r => r.user_id);
        const discordRanks = await batchFetchDiscordRanks(userIds);

        const leaderboard = rows.map(r => {
            const discordRank = discordRanks[r.user_id];
            return {
                user_id: r.user_id,
                level: Number(r.level),
                xp: Number(r.xp),
                totalXp: totalXpForLevel(Number(r.level)) + Number(r.xp),
                rank: discordRank || getRankRole(Number(r.level)),
                username: r.username || ('User_' + String(r.user_id).slice(-4)),
                avatar: `/api/avatar/${r.user_id}`
            };
        });
        // Sort by totalXp descending (already mostly correct since level dominates)
        leaderboard.sort((a, b) => b.totalXp - a.totalXp);

        let myRank = null;
        const myIdx = leaderboard.findIndex(l => l.user_id === uid);
        if (myIdx >= 0) myRank = myIdx + 1;

        res.json({ leaderboard, my_user_id: uid, my_rank: myRank });
    } catch (e) {
        console.error('XP Leaderboard Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// --- Statistics API: daily win/loss chart, streaks, favorite game ---
app.get('/api/stats/chart', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        // Last 30 days of transactions grouped by day
        const [rows] = await dbPool.execute(
            `SELECT DATE(created_at) as day, type, SUM(amount) as total, COUNT(*) as cnt
             FROM transactions WHERE user_id=? AND guild_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(created_at), type ORDER BY day ASC`,
            [uid, TARGET_GUILD_ID]
        );

        // Build daily data
        const dailyMap = {};
        for (const r of rows) {
            const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day);
            if (!dailyMap[day]) dailyMap[day] = { day, wins: 0, losses: 0, profit: 0, games: 0 };
            const amt = Number(r.total);
            if (amt > 0) dailyMap[day].wins += amt;
            else dailyMap[day].losses += Math.abs(amt);
            dailyMap[day].profit += amt;
            dailyMap[day].games += Number(r.cnt);
        }
        const dailyChart = Object.values(dailyMap).sort((a, b) => a.day.localeCompare(b.day));

        // Streak calculation: consecutive winning days
        let currentStreak = 0, maxStreak = 0, streakType = 'none';
        for (let i = dailyChart.length - 1; i >= 0; i--) {
            if (i === dailyChart.length - 1) {
                if (dailyChart[i].profit > 0) { currentStreak = 1; streakType = 'win'; }
                else if (dailyChart[i].profit < 0) { currentStreak = 1; streakType = 'lose'; }
                else { currentStreak = 0; break; }
            } else {
                if (streakType === 'win' && dailyChart[i].profit > 0) currentStreak++;
                else if (streakType === 'lose' && dailyChart[i].profit < 0) currentStreak++;
                else break;
            }
        }
        // Max win streak over all time
        let tempStreak = 0;
        for (const d of dailyChart) {
            if (d.profit > 0) { tempStreak++; maxStreak = Math.max(maxStreak, tempStreak); }
            else tempStreak = 0;
        }

        // Favorite game (most played)
        const gameMap = {};
        for (const r of rows) {
            const game = r.type.split('_')[0]; // mines_bet → mines
            if (!gameMap[game]) gameMap[game] = 0;
            gameMap[game] += Number(r.cnt);
        }
        const favoriteGame = Object.entries(gameMap).sort((a, b) => b[1] - a[1])[0] || ['none', 0];

        // Lucky hours (best time to play)
        const [hourRows] = await dbPool.execute(
            `SELECT HOUR(created_at) as h, SUM(amount) as total
             FROM transactions WHERE user_id=? AND guild_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY HOUR(created_at) ORDER BY total DESC LIMIT 3`,
            [uid, TARGET_GUILD_ID]
        );
        const luckyHours = hourRows.map(r => ({ hour: r.h, profit: Number(r.total) }));

        res.json({
            dailyChart,
            currentStreak: { count: currentStreak, type: streakType },
            maxWinStreak: maxStreak,
            favoriteGame: { name: favoriteGame[0], count: favoriteGame[1] },
            luckyHours
        });
    } catch (e) {
        console.error('Stats Chart Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// ============================================================
// LEADERBOARD API
// ============================================================
app.get('/api/leaderboard', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        // syncMissingUsers() removed from hot path — runs on startup and via /api/sync-users only

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

        const leaderboard = rows.map(r => ({
            user_id: r.user_id,
            balance: Number(r.balance),
            username: r.username || ('User_' + String(r.user_id).slice(-4)),
            avatar: `/api/avatar/${r.user_id}`
        }));

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

// Get top scores for a specific mini-game
app.get('/api/leaderboard/top-scores', requireAuth, async (req, res) => {
    const game = req.query.game;
    const limit = parseInt(req.query.limit) || 50;
    const uid = req.cookies.user_id;

    if (!game) {
        return res.status(400).json({ error: 'Thiếu tham số game' });
    }

    try {
        const [rows] = await dbPool.query(
            `SELECT s.user_id, s.score, s.metadata, s.updated_at as achieved_at, w.username, w.avatar
             FROM mini_game_scores s
             LEFT JOIN (
                 SELECT user_id, MAX(username) as username, MAX(avatar) as avatar
                 FROM wallet
                 GROUP BY user_id
             ) w ON s.user_id = w.user_id
             WHERE s.guild_id = ? AND s.game_id = ?
             ORDER BY s.score DESC, s.updated_at ASC
             LIMIT ?`,
            [TARGET_GUILD_ID, game, limit]
        );

        const leaderboard = rows.map((r, index) => ({
            rank: index + 1,
            user_id: r.user_id,
            score: Number(r.score),
            metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null,
            achieved_at: r.achieved_at,
            username: r.username || ('User_' + String(r.user_id).slice(-4)),
            avatar: `/api/avatar/${r.user_id}`
        }));

        // Find my rank
        let myRank = null;
        let myScore = null;
        const [myRows] = await dbPool.query(
            'SELECT score FROM mini_game_scores WHERE guild_id = ? AND user_id = ? AND game_id = ?',
            [TARGET_GUILD_ID, uid, game]
        );
        if (myRows.length > 0) {
            myScore = Number(myRows[0].score);
            const [rankRows] = await dbPool.query(
                'SELECT COUNT(*) as cnt FROM mini_game_scores WHERE guild_id = ? AND game_id = ? AND (score > ? OR (score = ? AND updated_at < (SELECT updated_at FROM mini_game_scores WHERE guild_id = ? AND user_id = ? AND game_id = ?)))',
                [TARGET_GUILD_ID, game, myScore, myScore, TARGET_GUILD_ID, uid, game]
            );
            myRank = Number(rankRows[0].cnt) + 1;
        }

        res.json({ leaderboard, my_user_id: uid, my_rank: myRank, my_score: myScore });
    } catch (e) {
        console.error('Game Leaderboard Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database: ' + e.message });
    }
});

// Submit a new score for a mini-game
app.post('/api/score/submit', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const { game, score, metadata } = req.body;

    if (!game || score === undefined) {
        return res.status(400).json({ error: 'Thiếu game hoặc score' });
    }

    const scoreNum = parseInt(score);
    if (isNaN(scoreNum) || scoreNum < 0) {
        return res.status(400).json({ error: 'Điểm số không hợp lệ' });
    }

    try {
        const [existing] = await dbPool.execute(
            'SELECT score FROM mini_game_scores WHERE guild_id = ? AND user_id = ? AND game_id = ?',
            [TARGET_GUILD_ID, uid, game]
        );

        let newRecord = false;
        if (existing.length === 0) {
            await dbPool.execute(
                'INSERT INTO mini_game_scores (guild_id, user_id, game_id, score, metadata) VALUES (?, ?, ?, ?, ?)',
                [TARGET_GUILD_ID, uid, game, scoreNum, metadata ? JSON.stringify(metadata) : null]
            );
            newRecord = true;
        } else if (scoreNum > Number(existing[0].score)) {
            await dbPool.execute(
                'UPDATE mini_game_scores SET score = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ? AND game_id = ?',
                [scoreNum, metadata ? JSON.stringify(metadata) : null, TARGET_GUILD_ID, uid, game]
            );
            newRecord = true;
        }

        res.json({ success: true, newRecord, currentBest: newRecord ? scoreNum : Number(existing[0].score) });
    } catch (e) {
        console.error('Submit Score Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database: ' + e.message });
    }
});

// ============================================================
// PROFILE STATS API
// ============================================================
app.get('/api/profile/stats', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        // Overall stats from transactions
        const [allTx] = await dbPool.execute(
            'SELECT type, amount, details, created_at FROM transactions WHERE user_id=? AND guild_id=? ORDER BY created_at DESC LIMIT 500',
            [uid, TARGET_GUILD_ID]
        );

        // Game type mapping
        const gameTypes = {
            taixiu: ['taixiu_bet', 'taixiu_win'],
            poker: ['poker_bet', 'poker_win'],
            mines: ['mines_bet', 'mines_win', 'mines_lose'],
            crash: ['crash_bet', 'crash_win', 'crash_bust'],
            flappy: ['flappy_reward']
        };

        // Per-game breakdown
        const breakdown = {};
        for (const [game, types] of Object.entries(gameTypes)) {
            const gameTx = allTx.filter(t => types.includes(t.type));
            const betTypes = types.filter(t => t.includes('bet') || t.includes('lose') || t.includes('bust'));
            const winTypes = types.filter(t => t.includes('win') || t.includes('cashout') || t.includes('reward'));

            const bets = gameTx.filter(t => betTypes.includes(t.type));
            const wins = gameTx.filter(t => winTypes.includes(t.type));

            const totalBet = bets.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
            const totalWin = wins.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

            breakdown[game] = {
                games: bets.length,
                wins: wins.length,
                totalBet,
                totalWin,
                profit: totalWin - totalBet
            };
        }

        // Overall totals
        const totalGames = Object.values(breakdown).reduce((s, g) => s + g.games, 0);
        const totalWins = Object.values(breakdown).reduce((s, g) => s + g.wins, 0);
        const totalBet = Object.values(breakdown).reduce((s, g) => s + g.totalBet, 0);
        const totalWin = Object.values(breakdown).reduce((s, g) => s + g.totalWin, 0);
        const profit = totalWin - totalBet;

        // Recent activity (last 20 transactions)
        const recent = allTx.slice(0, 20).map(t => ({
            type: t.type,
            amount: Number(t.amount),
            details: t.details ? (typeof t.details === 'string' ? JSON.parse(t.details) : t.details) : null,
            time: t.created_at
        }));

        // Joined date (first transaction or fallback)
        const joinDate = allTx.length > 0 ? allTx[allTx.length - 1].created_at : new Date();

        res.json({
            totalGames,
            totalWins,
            winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0,
            totalBet,
            totalWin,
            profit,
            breakdown,
            recent,
            joinDate
        });
    } catch (e) {
        console.error('Profile Stats Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// ============================================================
// ACHIEVEMENT / BADGE SYSTEM
// ============================================================
const BADGE_DEFS = {
    first_win: { icon: '🏆', name: 'Chiến Thắng Đầu Tiên', desc: 'Thắng 1 ván bất kỳ' },
    high_roller: { icon: '💎', name: 'High Roller', desc: 'Đặt cược tổng cộng 100,000$' },
    lucky_star: { icon: '⭐', name: 'Ngôi Sao May Mắn', desc: 'Thắng 10 ván' },
    crash_master: { icon: '🚀', name: 'Crash Master', desc: 'Cashout ở hệ số ≥ 5x' },
    mine_sweeper: { icon: '💣', name: 'Gỡ Bom Chuyên Nghiệp', desc: 'Mở 15+ ô trong 1 ván Mines' },
    poker_shark: { icon: '🃏', name: 'Poker Shark', desc: 'Thắng 5 ván Poker' },
    daily_streak: { icon: '🔥', name: 'Siêng Năng', desc: 'Điểm danh 7 ngày' },
    big_winner: { icon: '👑', name: 'Đại Gia', desc: 'Tổng thắng đạt 500,000$' },
    chat_social: { icon: '💬', name: 'Tay Hòm Chìa Khóa', desc: 'Gửi 50 tin nhắn chat' },
    veteran: { icon: '🎖️', name: 'Cựu Binh', desc: 'Chơi tổng cộng 100 ván' }
};

async function checkAndAwardBadges(userId) {
    const awarded = [];
    try {
        // Get existing badges
        const [existing] = await dbPool.execute(
            'SELECT badge_key FROM achievements WHERE guild_id=? AND user_id=?',
            [TARGET_GUILD_ID, userId]
        );
        const has = new Set(existing.map(r => r.badge_key));

        // Get transaction stats
        const [txRows] = await dbPool.execute(
            'SELECT type, amount, details FROM transactions WHERE user_id=? AND guild_id=?',
            [userId, TARGET_GUILD_ID]
        );

        const winTypes = ['mines_win', 'crash_win', 'poker_win', 'taixiu_win', 'flappy_reward'];
        const betTypes = ['mines_bet', 'crash_bet', 'poker_bet', 'taixiu_bet'];

        const totalWins = txRows.filter(t => winTypes.includes(t.type)).length;
        const totalBets = txRows.filter(t => betTypes.includes(t.type)).length;
        const totalBetAmount = txRows.filter(t => betTypes.includes(t.type))
            .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
        const totalWinAmount = txRows.filter(t => winTypes.includes(t.type))
            .reduce((s, t) => s + Number(t.amount), 0);
        const pokerWins = txRows.filter(t => t.type === 'poker_win').length;

        // Check crash details for high multiplier
        const crashWins = txRows.filter(t => t.type === 'crash_win');
        let hasCrash5x = false;
        for (const cw of crashWins) {
            try {
                const d = typeof cw.details === 'string' ? JSON.parse(cw.details) : cw.details;
                if (d && d.multiplier >= 5) { hasCrash5x = true; break; }
            } catch (e) { }
        }

        // Check mines details for 15+ reveals
        const minesCashouts = txRows.filter(t => t.type === 'mines_win');
        let hasMines15 = false;
        for (const mc of minesCashouts) {
            try {
                const d = typeof mc.details === 'string' ? JSON.parse(mc.details) : mc.details;
                if (d && d.revealed >= 15) { hasMines15 = true; break; }
            } catch (e) { }
        }

        // Check daily streak
        const [dailyRows] = await dbPool.execute(
            'SELECT streak FROM daily_rewards WHERE guild_id=? AND user_id=?',
            [TARGET_GUILD_ID, userId]
        ).catch(() => [[]]);
        const streak = dailyRows.length ? dailyRows[0].streak : 0;

        // Award logic
        const checks = [
            ['first_win', totalWins >= 1],
            ['high_roller', totalBetAmount >= 100000],
            ['lucky_star', totalWins >= 10],
            ['crash_master', hasCrash5x],
            ['mine_sweeper', hasMines15],
            ['poker_shark', pokerWins >= 5],
            ['daily_streak', streak >= 7],
            ['big_winner', totalWinAmount >= 500000],
            ['veteran', totalBets >= 100]
        ];

        for (const [key, condition] of checks) {
            if (!has.has(key) && condition) {
                try {
                    await dbPool.execute(
                        'INSERT IGNORE INTO achievements (guild_id, user_id, badge_key) VALUES (?,?,?)',
                        [TARGET_GUILD_ID, userId, key]
                    );
                    awarded.push(key);
                    // Tier 2: Broadcast achievement to live feed
                    try {
                        const [uRow] = await dbPool.execute('SELECT username FROM wallet WHERE guild_id=? AND user_id=?', [TARGET_GUILD_ID, userId]);
                        const uname = uRow.length ? uRow[0].username : 'User';
                        broadcastAchievement(userId, uname, BADGE_DEFS[key]);
                    } catch (e) { /* ignore */ }
                } catch (e) { }
            }
        }
    } catch (e) {
        console.error('Badge check error:', e.message);
    }
    return awarded;
}

// Get user achievements
app.get('/api/achievements', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        const [rows] = await dbPool.execute(
            'SELECT badge_key, unlocked_at FROM achievements WHERE guild_id=? AND user_id=? ORDER BY unlocked_at DESC',
            [TARGET_GUILD_ID, uid]
        );
        // Also check & award new ones
        const newBadges = await checkAndAwardBadges(uid);

        const badges = rows.map(r => ({
            key: r.badge_key,
            ...BADGE_DEFS[r.badge_key],
            unlockedAt: r.unlocked_at
        }));

        // If new badges were just awarded, add them too
        for (const key of newBadges) {
            if (!badges.find(b => b.key === key)) {
                badges.push({ key, ...BADGE_DEFS[key], unlockedAt: new Date() });
            }
        }

        res.json({
            badges,
            allBadges: Object.entries(BADGE_DEFS).map(([key, def]) => ({
                key, ...def,
                unlocked: badges.some(b => b.key === key)
            })),
            newBadges: newBadges.map(k => ({ key: k, ...BADGE_DEFS[k] }))
        });
    } catch (e) {
        console.error('Achievements Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Progression summary (me + daily + achievements + leveling)
app.get('/api/progression/summary', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    try {
        // --- Me ---
        let username = 'User';
        let avatar = '';
        let balance = 0;
        const [walletRows] = await dbPool.execute(
            'SELECT balance, username, avatar FROM wallet WHERE guild_id=? AND user_id=?',
            [TARGET_GUILD_ID, uid]
        );
        if (walletRows.length) {
            balance = Number(walletRows[0].balance) || 0;
            if (walletRows[0].username) username = walletRows[0].username;
            if (walletRows[0].avatar) avatar = walletRows[0].avatar;
        }
        if (req.cookies.user_info) {
            try {
                const raw = JSON.parse(req.cookies.user_info.startsWith('j:') ? req.cookies.user_info.slice(2) : req.cookies.user_info);
                if (raw.username) username = decodeURIComponent(raw.username);
                if (raw.avatar) avatar = raw.avatar;
            } catch (e) { }
        }
        avatar = `/api/avatar/${uid}`;
        const me = { username, avatar, balance };

        // --- Daily ---
        const [dailyRows] = await dbPool.execute(
            'SELECT last_claim, streak FROM daily_rewards WHERE user_id=? AND guild_id=?',
            [uid, TARGET_GUILD_ID]
        );
        const now = new Date();
        let streak = 0;
        let claimedToday = false;
        let nextClaimIn = null;
        if (dailyRows.length > 0) {
            const lastClaim = new Date(dailyRows[0].last_claim);
            streak = dailyRows[0].streak || 0;

            const lastDate = lastClaim.toISOString().split('T')[0];
            const todayDate = now.toISOString().split('T')[0];

            if (lastDate === todayDate) {
                claimedToday = true;
                const tomorrow = new Date(now);
                tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
                tomorrow.setUTCHours(0, 0, 0, 0);
                const diffMs = tomorrow - now;
                const hours = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                nextClaimIn = `${hours}h ${mins}m`;
            }

            const yesterday = new Date(now);
            yesterday.setUTCDate(yesterday.getUTCDate() - 1);
            const yesterdayDate = yesterday.toISOString().split('T')[0];
            if (lastDate !== todayDate && lastDate !== yesterdayDate) {
                streak = 0;
            }
        }
        const daily = {
            streak: Math.min(streak, 7),
            claimed_today: claimedToday,
            next_claim_in: nextClaimIn
        };

        // --- Achievements ---
        const [achRows] = await dbPool.execute(
            'SELECT badge_key, unlocked_at FROM achievements WHERE guild_id=? AND user_id=? ORDER BY unlocked_at DESC',
            [TARGET_GUILD_ID, uid]
        );
        const newBadges = await checkAndAwardBadges(uid);
        const badges = achRows.map(r => ({
            key: r.badge_key,
            ...BADGE_DEFS[r.badge_key],
            unlockedAt: r.unlocked_at
        }));
        for (const key of newBadges) {
            if (!badges.find(b => b.key === key)) {
                badges.push({ key, ...BADGE_DEFS[key], unlockedAt: new Date() });
            }
        }
        const achievements = {
            badges,
            allBadges: Object.entries(BADGE_DEFS).map(([key, def]) => ({
                key, ...def,
                unlocked: badges.some(b => b.key === key)
            })),
            newBadges: newBadges.map(k => ({ key: k, ...BADGE_DEFS[k] }))
        };

        // --- Leveling ---
        const [lvlRows] = await dbPool.execute(
            'SELECT xp, level, last_message_ts, last_voice_ts FROM leveling WHERE guild_id=? AND user_id=?',
            [TARGET_GUILD_ID, uid]
        );
        let leveling;
        if (lvlRows.length === 0) {
            leveling = {
                found: false,
                level: 0,
                xp: 0,
                rank: getRankRole(0),
                xpForNext: xpForNextLevel(0),
                xpProgress: 0,
                totalXp: 0,
                position: null,
                totalMembers: null,
                lastMessage: null,
                lastVoice: null
            };
        } else {
            const row = lvlRows[0];
            const level = Number(row.level) || 0;
            const xp = Number(row.xp) || 0;
            const xpNeeded = xpForNextLevel(level);
            const totalXp = totalXpForLevel(level) + xp;
            const discordRank = await fetchMemberDiscordRank(uid);
            const rank = discordRank || getRankRole(level);

            const [rankRows] = await dbPool.execute(
                'SELECT COUNT(*) as cnt FROM leveling WHERE guild_id=? AND (level > ? OR (level = ? AND xp > ?))',
                [TARGET_GUILD_ID, level, level, xp]
            );
            const position = Number(rankRows[0].cnt) + 1;

            const [totalRows] = await dbPool.execute(
                'SELECT COUNT(*) as cnt FROM leveling WHERE guild_id=?',
                [TARGET_GUILD_ID]
            );

            leveling = {
                found: true,
                level,
                xp,
                xpForNext: xpNeeded,
                xpProgress: xpNeeded > 0 ? Math.round((xp / xpNeeded) * 100) : 0,
                totalXp,
                rank,
                position,
                totalMembers: Number(totalRows[0].cnt),
                lastMessage: row.last_message_ts,
                lastVoice: row.last_voice_ts
            };
        }

        res.json({ me, daily, achievements, leveling });
    } catch (e) {
        console.error('Progression Summary Error:', e.message);
        res.status(500).json({ error: 'Lỗi Database' });
    }
});

// Manual sync endpoint (admin only)
app.get('/api/sync-users', requireAuth, async (req, res) => {
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminIds.includes(req.cookies.user_id)) {
        return res.status(403).json({ error: 'Không có quyền' });
    }
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
            // Support prefix matching: 'mines' matches 'mines_bet', 'mines_win', etc.
            query += ' AND type LIKE ?';
            params.push(type + '%');
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

// Admin: check if current user is admin
app.get('/api/admin/check', requireAuth, (req, res) => {
    const uid = req.cookies.user_id;
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    res.json({ isAdmin: adminIds.includes(uid) });
});

// Admin: dashboard stats
app.get('/api/admin/stats', requireAuth, async (req, res) => {
    const uid = req.cookies.user_id;
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!adminIds.includes(uid)) return res.status(403).json({ error: 'Không có quyền' });

    try {
        // Total players
        const [[{ playerCount }]] = await dbPool.execute(
            'SELECT COUNT(*) as playerCount FROM wallet WHERE guild_id=?', [TARGET_GUILD_ID]
        );
        // Total balance in circulation
        const [[{ totalBalance }]] = await dbPool.execute(
            'SELECT COALESCE(SUM(balance),0) as totalBalance FROM wallet WHERE guild_id=?', [TARGET_GUILD_ID]
        );
        // Transaction stats (last 24h)
        const [[{ txCount24h }]] = await dbPool.execute(
            "SELECT COUNT(*) as txCount24h FROM transactions WHERE guild_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
            [TARGET_GUILD_ID]
        );
        // Revenue by game type (last 7 days): bets - wins = house profit
        const [revRows] = await dbPool.execute(
            `SELECT type, SUM(amount) as total FROM transactions
             WHERE guild_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
             GROUP BY type`, [TARGET_GUILD_ID]
        );
        const revenue = {};
        for (const r of revRows) {
            revenue[r.type] = Number(r.total);
        }
        // Top 10 players by balance
        const [topPlayers] = await dbPool.execute(
            'SELECT user_id, username, balance FROM wallet WHERE guild_id=? ORDER BY balance DESC LIMIT 10',
            [TARGET_GUILD_ID]
        );
        // Active players (had transactions in last 24h)
        const [[{ activePlayers }]] = await dbPool.execute(
            "SELECT COUNT(DISTINCT user_id) as activePlayers FROM transactions WHERE guild_id=? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
            [TARGET_GUILD_ID]
        );
        // Transactions per game (last 7 days)
        const gameGroups = {
            mines: ['mines_bet', 'mines_win', 'mines_lose'],
            crash: ['crash_bet', 'crash_win', 'crash_bust'],
            poker: ['poker_bet', 'poker_win'],
            taixiu: ['taixiu_bet', 'taixiu_win'],
            flappy: ['flappy_reward'],
            daily: ['daily_claim']
        };
        const gameStats = {};
        for (const [game, types] of Object.entries(gameGroups)) {
            const betTypes = types.filter(t => t.includes('bet') || t.includes('lose') || t.includes('bust'));
            const winTypes = types.filter(t => t.includes('win') || t.includes('cashout') || t.includes('reward') || t.includes('spin'));
            const bets = betTypes.reduce((s, t) => s + Math.abs(revenue[t] || 0), 0);
            const wins = winTypes.reduce((s, t) => s + Math.abs(revenue[t] || 0), 0);
            gameStats[game] = { bets, wins, profit: bets - wins };
        }

        res.json({
            playerCount,
            totalBalance: Number(totalBalance),
            txCount24h,
            activePlayers,
            topPlayers: topPlayers.map(p => ({ ...p, balance: Number(p.balance) })),
            gameStats,
            revenue
        });
    } catch (e) {
        console.error('Admin Stats Error:', e.message);
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
let txGame; try { txGame = new (require('./taixiu-core'))(io, dbPool, TARGET_GUILD_ID); txGame.onWin = broadcastWin; console.log('taixiu-core loaded'); } catch (e) { console.error('taixiu-core not loaded:', e?.message || e); }

// ============================================================
// WATCH TOGETHER — Room Store
// ============================================================
const watchRooms = new Map(); // roomId -> { id, hostId, hostSocket, password, members[], videoUrl, playing, currentTime, createdAt }
function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return watchRooms.has(id) ? generateRoomId() : id;
}
function broadcastRoomMembers(roomId) {
    const room = watchRooms.get(roomId);
    if (!room) return;
    const memberData = room.members.map(m => ({
        socketId: m.socketId,
        username: m.username,
        avatar: m.avatar,
        isHost: m.socketId === room.hostSocket
    }));
    io.to('wt_' + roomId).emit('wt_members', { members: memberData, hostId: room.hostSocket });
}
// Auto-cleanup empty rooms every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, room] of watchRooms) {
        if (room.members.length === 0 && now - room.createdAt > 300000) {
            watchRooms.delete(id);
        }
    }
}, 300000);

// Socket.IO authentication middleware
io.use((socket, next) => {
    const cookieStr = socket.handshake.headers.cookie || '';
    const getCk = (name) => { const v = `; ${cookieStr}`; const p = v.split(`; ${name}=`); if (p.length === 2) return decodeURIComponent(p.pop().split(';').shift()); };
    // Try signed cookie first (s:value.signature), fallback to unsigned
    const raw = getCk('user_id');
    if (raw && raw.startsWith('s:')) {
        try {
            const val = cookieParser.signedCookie(raw, COOKIE_SECRET);
            if (val !== false) { socket._userId = val; return next(); }
        } catch (e) { }
    }
    // Fallback: unsigned cookie (backward compat)
    if (raw) { socket._userId = raw; }
    next();
});

io.on('connection', (socket) => {
    // Simplified local-friendly user info (no DB/Discord required)
    const getCookie = (name) => { const v = `; ${socket.handshake.headers.cookie || ''}`; const p = v.split(`; ${name}=`); if (p.length === 2) return decodeURIComponent(p.pop().split(';').shift()); }
    const userId = socket._userId || getCookie('user_id');
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

    // ═══ TIER 2: Online tracking ═══
    if (userId) {
        socket.join(`user_${userId}`);
        onlineUsers.set(socket.id, {
            userId, username: userInfo.username, avatar: userInfo.avatar,
            page: 'lobby', joinedAt: Date.now()
        });
        // Broadcast online count
        const uniqueOnline = new Set([...onlineUsers.values()].map(u => u.userId)).size;
        io.emit('online_count', { count: uniqueOnline });

        // Handle page tracking
        socket.on('page_visit', (data) => {
            const u = onlineUsers.get(socket.id);
            if (u) u.page = data?.page || 'lobby';
        });

        // Send live feed history on connect
        socket.emit('live_feed_history', liveFeed.slice(0, 20));
    }

    // KẾT NỐI POKER
    if (userInfo.id) pokerGame.handleSocket(socket, userInfo);

    // KẾT NỐI TAI XIU - FIX: Gọi sendCurrentState ngay khi connect
    if (typeof txGame !== 'undefined' && txGame && userId) {
        if (txGame.sendCurrentState) txGame.sendCurrentState(socket); // FIX: Thực sự gọi hàm
        socket.on('tx_bet', async d => {
            const result = await txGame.handleBet(userId, d.side, +d.amount);
            socket.emit(result.success ? 'tx_bet_success' : 'tx_bet_error', { msg: result.msg || 'OK' });
        });
    }

    // KẾT NỐI GLOBAL CHAT
    socket.on('chat_join', () => {
        socket.join('chat_room');
        // Send last 50 messages
        socket.emit('chat_history', chatHistory.slice(-50));
    });

    socket.on('chat_send', (data) => {
        if (!data || !data.text || typeof data.text !== 'string') return;
        const text = data.text.trim().slice(0, 200);
        if (!text) return;

        // Rate-limit: max 3 msgs per 3 seconds per socket
        const now = Date.now();
        if (!socket._chatTimes) socket._chatTimes = [];
        socket._chatTimes = socket._chatTimes.filter(t => now - t < 3000);
        if (socket._chatTimes.length >= 3) {
            socket.emit('chat_system', 'Bạn gửi tin nhắn quá nhanh! Chờ vài giây...');
            return;
        }
        socket._chatTimes.push(now);

        const msg = {
            username: userInfo.username || 'Khách',
            userId: userId || socket.id,
            text,
            ts: now
        };
        chatHistory.push(msg);
        // Keep only last 200 messages in memory
        if (chatHistory.length > 200) chatHistory.splice(0, chatHistory.length - 200);
        io.to('chat_room').emit('chat_message', msg);

        // Track chat count for chat_social badge
        if (userId) {
            if (!socket._chatCount) socket._chatCount = 0;
            socket._chatCount++;
            if (socket._chatCount === 50) {
                checkAndAwardBadges(userId).then(newBadges => {
                    // chat_social won't fire here since we check in checkAndAwardBadges via transactions
                    // Instead award directly
                    dbPool.execute('INSERT IGNORE INTO achievements (guild_id, user_id, badge_key) VALUES (?,?,?)',
                        [TARGET_GUILD_ID, userId, 'chat_social']).catch(() => { });
                }).catch(() => { });
            }
        }
    });

    // KẾT NỐI CRASH MULTIPLAYER
    socket.on('crash_join', () => {
        socket.join(crashRoom);
        // Send current state
        const remaining = Math.max(0, crashState.waitEndTime - Date.now());
        socket.emit('crash_state', {
            phase: crashState.phase,
            roundId: crashState.roundId,
            mult: crashState.currentMult,
            crashPoint: crashState.phase === 'crashed' ? crashState.crashPoint : undefined,
            waitRemaining: remaining,
            history: crashState.history.slice(0, 15),
            playerCount: io.sockets.adapter.rooms.get(crashRoom)?.size || 0
        });
    });

    socket.on('crash_bet', async (data) => {
        if (!userId || crashState.phase !== 'waiting') {
            socket.emit('crash_bet_error', { msg: 'Không thể đặt cược lúc này!' }); return;
        }
        // Check if already bet this round
        if (crashState.bettors.has(socket.id)) {
            socket.emit('crash_bet_error', { msg: 'Bạn đã đặt cược rồi!' }); return;
        }
        const bet = parseInt(data.bet);
        if (!bet || bet < 500 || bet > 100000) {
            socket.emit('crash_bet_error', { msg: 'Cược 500 - 100,000 $' }); return;
        }

        // Deduct balance
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            const [rows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [TARGET_GUILD_ID, userId]);
            if (!rows.length || Number(rows[0].balance) < bet) {
                await conn.rollback(); conn.release();
                socket.emit('crash_bet_error', { msg: 'Không đủ tiền!' }); return;
            }
            const balBefore = Number(rows[0].balance);
            await conn.execute('UPDATE wallet SET balance = balance - ? WHERE guild_id=? AND user_id=?', [bet, TARGET_GUILD_ID, userId]);
            await logTx(conn, userId, 'crash_bet', -bet, balBefore, balBefore - bet, { bet, roundId: crashState.roundId });
            await conn.commit(); conn.release();

            crashState.bettors.set(socket.id, {
                userId, bet, cashedOut: false, cashoutMult: 0,
                username: userInfo.username, autoCashout: parseFloat(data.autoCashout) || 0
            });

            socket.emit('crash_bet_ok', { bet, newBalance: balBefore - bet });
            // Broadcast player count
            crashEmit('crash_players', {
                count: crashState.bettors.size,
                bets: Array.from(crashState.bettors.values()).map(b => ({
                    username: b.username, bet: b.bet, cashedOut: b.cashedOut
                }))
            });
        } catch (e) {
            await conn.rollback().catch(() => { }); conn.release();
            socket.emit('crash_bet_error', { msg: 'Lỗi server' });
        }
    });

    socket.on('crash_cashout', async () => {
        if (!userId || crashState.phase !== 'flying') return;
        const bettor = crashState.bettors.get(socket.id);
        if (!bettor || bettor.cashedOut) return;

        const mult = crashState.currentMult;
        if (mult >= crashState.crashPoint) return; // Already crashed

        bettor.cashedOut = true;
        bettor.cashoutMult = mult;
        const winAmount = Math.floor(bettor.bet * mult);

        // Credit balance
        const conn = await dbPool.getConnection();
        try {
            await conn.beginTransaction();
            const [rows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [TARGET_GUILD_ID, userId]);
            const balBefore = rows.length ? Number(rows[0].balance) : 0;
            await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [winAmount, TARGET_GUILD_ID, userId]);
            await logTx(conn, userId, 'crash_win', winAmount, balBefore, balBefore + winAmount,
                { bet: bettor.bet, multiplier: mult, crashPoint: crashState.crashPoint, roundId: crashState.roundId });
            await conn.commit(); conn.release();

            socket.emit('crash_cashout_ok', { mult, winAmount, profit: winAmount - bettor.bet, newBalance: balBefore + winAmount });
            // Broadcast cashout to room
            crashEmit('crash_player_cashout', { username: bettor.username, mult, winAmount });
            // Tier 2: Broadcast big crash wins
            if (winAmount - bettor.bet > 0) broadcastWin(userId, bettor.username, 'crash', winAmount, { multiplier: mult });
        } catch (e) {
            bettor.cashedOut = false;
            await conn.rollback().catch(() => { }); conn.release();
        }
    });

    // ═══ WATCH TOGETHER EVENTS ═══
    socket.on('wt_create', (data) => {
        const rid = generateRoomId();
        const room = {
            id: rid,
            hostId: userId || socket.id,
            hostSocket: socket.id,
            password: data.password || '',
            members: [{ socketId: socket.id, userId: userId || socket.id, username: data.username || userInfo.username, avatar: data.avatar || userInfo.avatar }],
            videoUrl: '',
            playing: false,
            currentTime: 0,
            createdAt: Date.now()
        };
        watchRooms.set(rid, room);
        socket.join('wt_' + rid);
        socket._wtRoom = rid;
        socket.emit('wt_room_created', { roomId: rid });
        broadcastRoomMembers(rid);
    });

    socket.on('wt_join', (data) => {
        const rid = (data.roomId || '').toUpperCase();
        const room = watchRooms.get(rid);
        if (!room) { socket.emit('wt_error', { msg: 'Phòng không tồn tại!' }); return; }
        if (room.password && room.password !== (data.password || '')) { socket.emit('wt_error', { msg: 'Sai mật khẩu!' }); return; }
        if (room.members.find(m => m.socketId === socket.id)) { socket.emit('wt_error', { msg: 'Bạn đã trong phòng!' }); return; }
        room.members.push({ socketId: socket.id, userId: userId || socket.id, username: data.username || userInfo.username, avatar: data.avatar || userInfo.avatar });
        socket.join('wt_' + rid);
        socket._wtRoom = rid;
        socket.emit('wt_joined', { roomId: rid, isHost: room.hostSocket === socket.id, videoUrl: room.videoUrl });
        broadcastRoomMembers(rid);
        // Notify chat
        io.to('wt_' + rid).emit('wt_chat', { username: '🎬 HỆ THỐNG', text: (data.username || 'Ai đó') + ' đã tham gia phòng!', ts: Date.now() });
    });

    socket.on('wt_leave', () => {
        handleWtLeave(socket);
    });

    socket.on('wt_video_url', (data) => {
        const rid = socket._wtRoom;
        const room = watchRooms.get(rid);
        if (!room || room.hostSocket !== socket.id) return;
        room.videoUrl = data.url || '';
        room.currentTime = 0;
        room.playing = false;
        socket.to('wt_' + rid).emit('wt_video_url', { url: room.videoUrl });
    });

    socket.on('wt_sync', (data) => {
        const rid = socket._wtRoom;
        const room = watchRooms.get(rid);
        if (!room || room.hostSocket !== socket.id) return;
        if (data.time !== undefined) room.currentTime = data.time;
        if (data.action === 'play') room.playing = true;
        if (data.action === 'pause') room.playing = false;
        socket.to('wt_' + rid).emit('wt_sync', data);
    });

    socket.on('wt_chat', (data) => {
        const rid = socket._wtRoom;
        if (!rid || !data.text) return;
        const text = String(data.text).trim().slice(0, 200);
        if (!text) return;
        io.to('wt_' + rid).emit('wt_chat', { username: userInfo.username, text, ts: Date.now() });
    });

    socket.on('wt_reaction', (data) => {
        const rid = socket._wtRoom;
        if (!rid || !data.emoji) return;
        socket.to('wt_' + rid).emit('wt_reaction', { emoji: data.emoji, username: userInfo.username });
    });

    // Server-Relay: Broadcast screen share frames (replaces WebRTC P2P)
    socket.on('wt_stream_frame', (frameData) => {
        const rid = socket._wtRoom;
        if (!rid) return;
        const room = watchRooms.get(rid);
        if (!room || room.hostSocket !== socket.id) return;
        // Use volatile emit — drops frames if receiver is slow (no buffering)
        socket.volatile.to('wt_' + rid).emit('wt_stream_frame', frameData);
    });

    socket.on('wt_screen_started', () => {
        const rid = socket._wtRoom;
        if (!rid) return;
        socket.to('wt_' + rid).emit('wt_screen_started');
    });

    socket.on('wt_screen_stopped', () => {
        const rid = socket._wtRoom;
        if (!rid) return;
        socket.to('wt_' + rid).emit('wt_screen_stopped');
    });

    function handleWtLeave(sock) {
        const rid = sock._wtRoom;
        if (!rid) return;
        const room = watchRooms.get(rid);
        if (!room) return;
        room.members = room.members.filter(m => m.socketId !== sock.id);
        sock.leave('wt_' + rid);
        delete sock._wtRoom;
        // Notify peers to cleanup WebRTC
        io.to('wt_' + rid).emit('wt_peer_left', { peerId: sock.id });
        // Host migration
        if (room.hostSocket === sock.id && room.members.length > 0) {
            room.hostSocket = room.members[0].socketId;
            room.hostId = room.members[0].userId;
            io.to('wt_' + rid).emit('wt_host_migrate', { newHostId: room.hostSocket, newHostName: room.members[0].username });
        }
        // Notify chat
        io.to('wt_' + rid).emit('wt_chat', { username: '🎬 HỆ THỐNG', text: 'Một thành viên đã rời phòng.', ts: Date.now() });
        broadcastRoomMembers(rid);
        // Cleanup empty room
        if (room.members.length === 0) {
            watchRooms.delete(rid);
        }
    }

    socket.on('disconnect', () => {
        // Watch Together cleanup
        handleWtLeave(socket);
        // Tier 2: Remove from online tracking
        onlineUsers.delete(socket.id);
        const uniqueOnline = new Set([...onlineUsers.values()].map(u => u.userId)).size;
        io.emit('online_count', { count: uniqueOnline });

        // If player disconnects during flying and has active bet, auto-cashout at current mult if possible
        if (crashState.phase === 'flying' && crashState.bettors.has(socket.id)) {
            const bettor = crashState.bettors.get(socket.id);
            if (!bettor.cashedOut && crashState.currentMult < crashState.crashPoint) {
                // Auto-cashout on disconnect
                bettor.cashedOut = true;
                bettor.cashoutMult = crashState.currentMult;
                const winAmount = Math.floor(bettor.bet * crashState.currentMult);
                dbPool.getConnection().then(async conn => {
                    try {
                        await conn.beginTransaction();
                        const [rows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [TARGET_GUILD_ID, bettor.userId]);
                        const balBefore = rows.length ? Number(rows[0].balance) : 0;
                        await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [winAmount, TARGET_GUILD_ID, bettor.userId]);
                        await logTx(conn, bettor.userId, 'crash_win', winAmount, balBefore, balBefore + winAmount,
                            { bet: bettor.bet, multiplier: crashState.currentMult, autoCashout: true, disconnect: true });
                        await conn.commit(); conn.release();
                    } catch (e) { await conn.rollback().catch(() => { }); conn.release(); }
                }).catch(() => { });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
// LEGACY REDIRECT
app.get('/lobby.html', (req, res) => res.redirect('/'));

// Helper: get user_id from signed or unsigned cookies
function getPageUserId(req) {
    return (req.signedCookies && req.signedCookies.user_id) || (req.cookies && req.cookies.user_id);
}

// Admin Dashboard (friendly route)
app.get('/admin', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve Taixiu page (friendly route without .html)
app.get('/taixiu', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'taixiu.html'));
});

// Serve Poker page
app.get('/poker', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'poker.html'));
});

// Serve Mines game page
app.get('/mines', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'mines.html'));
});
// Legacy redirect
app.get('/slot', (req, res) => res.redirect('/mines'));

// Serve Crash game page
app.get('/crash', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'crash.html'));
});

// Serve Daily Reward page
app.get('/daily', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'daily.html'));
});

// Serve Leaderboard page
app.get('/leaderboard', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
});

// Serve Profile page
app.get('/profile', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Serve Flappy Bird page
app.get('/flappybird', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'flappybird.html'));
});

// Serve Block Blast page
app.get('/blockblast', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'blockblast.html'));
});

// Serve Transfer page
// TURN server config API for Watch Together WebRTC
app.get('/api/turn-config', (req, res) => {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];
    // Add TURN servers from .env if configured
    const turnUrl = process.env.TURN_URL;
    const turnUser = process.env.TURN_USERNAME;
    const turnCred = process.env.TURN_CREDENTIAL;
    if (turnUrl && turnUser && turnCred) {
        // Support multiple TURN URLs separated by comma
        const urls = turnUrl.split(',').map(u => u.trim());
        iceServers.push({ urls, username: turnUser, credential: turnCred });
    } else {
        // Free public TURN relay fallback (Metered.ca Open Relay)
        iceServers.push(
            { urls: 'turn:a.relay.metered.ca:80', username: 'e8dd65b92aad045862a29820', credential: 'dVs8MnJzqHgirnkr' },
            { urls: 'turn:a.relay.metered.ca:80?transport=tcp', username: 'e8dd65b92aad045862a29820', credential: 'dVs8MnJzqHgirnkr' },
            { urls: 'turn:a.relay.metered.ca:443', username: 'e8dd65b92aad045862a29820', credential: 'dVs8MnJzqHgirnkr' },
            { urls: 'turns:a.relay.metered.ca:443?transport=tcp', username: 'e8dd65b92aad045862a29820', credential: 'dVs8MnJzqHgirnkr' }
        );
    }
    res.json({ iceServers });
});

// Serve Watch Together page
app.get('/watch', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'watch-together.html'));
});

app.get('/transfer', (req, res) => {
    if (!getPageUserId(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'transfer.html'));
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
            @font-face { font-family: 'DearPix'; src: url('/fonts/dearpix-1-94.ttf') format('truetype'); font-display: swap; }
            body { background: #0a0b1e; color: #fff; font-family: 'DearPix', Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
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
            @font-face { font-family: 'DearPix'; src: url('/fonts/dearpix-1-94.ttf') format('truetype'); font-display: swap; }
            body { background: #0a0b1e; color: #fff; font-family: 'DearPix', Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
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
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
});