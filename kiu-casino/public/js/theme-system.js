/* ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Theme System (Light/Dark Toggle)
 *  Include on every page: <script src="/js/theme-system.js"></script>
 * ═══════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function getTheme() {
        try { return localStorage.getItem('ppz_theme') || 'dark'; } catch (e) { return 'dark'; }
    }
    function saveTheme(t) {
        try { localStorage.setItem('ppz_theme', t); } catch (e) { }
    }

    let currentTheme = getTheme();

    // Light theme overrides — injected as a <style> block
    const LIGHT_CSS = `
        /* ═══ LIGHT THEME — Soft Gradient Design ═══ */
        [data-theme="light"] {
            --bg-primary: #0f0b1a !important;
            --bg-secondary: #150f26 !important;
            --surface: rgba(255,255,255,.06) !important;
            --surface-light: rgba(255,255,255,.04) !important;
            --glass: rgba(255,255,255,.03) !important;
            --glass-border: rgba(255,255,255,.08) !important;
        }

        /* Body: warm soft gradient instead of flat white */
        [data-theme="light"] body {
            background: linear-gradient(145deg, #1a1035 0%, #0d1b2a 35%, #1b0a28 70%, #0f172a 100%) !important;
            color: #e2dff0 !important;
        }

        /* Navbar: frosted glass */
        [data-theme="light"] .navbar,
        [data-theme="light"] .nav,
        [data-theme="light"] .top-bar,
        [data-theme="light"] header {
            background: rgba(15,11,26,.75) !important;
            backdrop-filter: blur(24px) saturate(1.5) !important;
            border-color: rgba(139,92,246,.12) !important;
        }
        [data-theme="light"] .navbar.scrolled {
            background: rgba(15,11,26,.92) !important;
            box-shadow: 0 4px 30px rgba(139,92,246,.08) !important;
        }

        /* Cards: tinted glass with subtle purple glow */
        [data-theme="light"] .game-card {
            background: rgba(20,15,40,.65) !important;
            border-color: rgba(139,92,246,.1) !important;
            backdrop-filter: blur(12px) !important;
        }
        [data-theme="light"] .game-card:hover {
            background: rgba(25,18,50,.75) !important;
        }
        [data-theme="light"] .stat-card,
        [data-theme="light"] .game-row,
        [data-theme="light"] .activity-item,
        [data-theme="light"] .ach-card {
            background: rgba(20,15,40,.55) !important;
            border-color: rgba(139,92,246,.1) !important;
        }
        [data-theme="light"] .stat-card:hover {
            background: rgba(30,22,55,.7) !important;
            box-shadow: 0 8px 32px rgba(139,92,246,.12) !important;
        }

        /* Card content text stays light */
        [data-theme="light"] .card-content {
            background: linear-gradient(180deg, rgba(10,8,22,.85) 0%, rgba(15,12,30,.95) 100%) !important;
        }
        [data-theme="light"] .card-title,
        [data-theme="light"] .game-name,
        [data-theme="light"] .section-title,
        [data-theme="light"] h1, [data-theme="light"] h2, [data-theme="light"] h3 {
            color: #f0ecff !important;
        }
        [data-theme="light"] .card-desc,
        [data-theme="light"] .game-detail,
        [data-theme="light"] .activity-text,
        [data-theme="light"] .ach-desc {
            color: rgba(224,220,245,.6) !important;
        }
        [data-theme="light"] p {
            color: rgba(224,220,245,.7) !important;
        }
        [data-theme="light"] .stat-label {
            color: rgba(224,220,245,.5) !important;
        }

        /* Background effects: soften */
        [data-theme="light"] .bg-mesh {
            background:
                radial-gradient(ellipse 80% 60% at 10% 20%, rgba(139,92,246,.12) 0%, transparent 70%),
                radial-gradient(ellipse 60% 80% at 90% 80%, rgba(6,182,212,.08) 0%, transparent 70%),
                radial-gradient(ellipse 50% 50% at 50% 0%, rgba(236,72,153,.06) 0%, transparent 60%) !important;
            opacity: 1 !important;
        }
        [data-theme="light"] .scanlines { opacity: .12 !important; }
        [data-theme="light"] .hex-grid { opacity: .04 !important; }
        [data-theme="light"] #bg-canvas { opacity: .35 !important; }

        /* Footer */
        [data-theme="light"] .footer { color: rgba(224,220,245,.35) !important; }

        /* Hero section text */
        [data-theme="light"] .hero-subtitle {
            color: rgba(224,220,245,.65) !important;
        }
        [data-theme="light"] .section-tag {
            color: rgba(224,220,245,.6) !important;
        }

        /* Chips / badges */
        [data-theme="light"] .chip,
        [data-theme="light"] .hero-chip {
            background: rgba(255,255,255,.06) !important;
            border-color: rgba(255,255,255,.1) !important;
        }

        /* User panel */
        [data-theme="light"] .username { color: rgba(224,220,245,.85) !important; }
        [data-theme="light"] .brand-text .t1 { color: #f0ecff !important; }
        [data-theme="light"] .brand-text .t2 {
            background: linear-gradient(135deg, #00f0ff, #c084fc) !important;
            -webkit-background-clip: text !important;
            -webkit-text-fill-color: transparent !important;
        }
        [data-theme="light"] .balance-chip {
            background: linear-gradient(135deg, rgba(255,215,0,.12), rgba(255,215,0,.04)) !important;
            border-color: rgba(255,215,0,.2) !important;
        }
        [data-theme="light"] .btn-exit {
            color: #ff6b8a !important;
            border-color: rgba(255,107,138,.25) !important;
        }
        [data-theme="light"] .btn-login {
            color: #c084fc !important;
            border-color: rgba(192,132,252,.3) !important;
        }

        /* Modals / panels */
        [data-theme="light"] .modal-box,
        [data-theme="light"] #ppz-sound-menu,
        [data-theme="light"] #ppz-notif-history {
            background: rgba(20,15,40,.95) !important;
            border-color: rgba(139,92,246,.15) !important;
            color: #e2dff0 !important;
            backdrop-filter: blur(24px) !important;
        }
        [data-theme="light"] .ppz-toast {
            background: rgba(20,15,40,.92) !important;
            border-color: rgba(139,92,246,.12) !important;
        }
        [data-theme="light"] .ppz-toast-msg,
        [data-theme="light"] .ppz-nh-item .ni-msg {
            color: rgba(224,220,245,.55) !important;
        }
        [data-theme="light"] .ppz-toast-title,
        [data-theme="light"] .ppz-nh-item .ni-title { color: #f0ecff !important; }

        /* Inputs */
        [data-theme="light"] input, [data-theme="light"] select {
            background: rgba(255,255,255,.06) !important;
            color: #e2dff0 !important;
            border-color: rgba(139,92,246,.15) !important;
        }

        /* Profile page specifics */
        [data-theme="light"] .profile-id,
        [data-theme="light"] .activity-time,
        [data-theme="light"] .ni-time {
            color: rgba(224,220,245,.3) !important;
        }

        /* Leaderboard */
        [data-theme="light"] .lb-row {
            background: rgba(20,15,40,.5) !important;
            border-color: rgba(139,92,246,.08) !important;
        }
        [data-theme="light"] .lb-row:hover {
            background: rgba(30,22,55,.65) !important;
        }
        [data-theme="light"] .lb-name { color: #e2dff0 !important; }
        [data-theme="light"] .lb-balance { color: #ffd700 !important; }
        [data-theme="light"] .my-rank-card {
            background: rgba(20,15,40,.7) !important;
            border-color: rgba(139,92,246,.15) !important;
        }
        [data-theme="light"] .podium-block {
            opacity: .9 !important;
        }

        /* Crash/Mines game pages */
        [data-theme="light"] .game-container,
        [data-theme="light"] .panel,
        [data-theme="light"] .bet-panel,
        [data-theme="light"] .control-panel {
            background: rgba(20,15,40,.7) !important;
            border-color: rgba(139,92,246,.1) !important;
        }

        /* Daily reward */
        [data-theme="light"] .reward-card,
        [data-theme="light"] .wheel-container {
            background: rgba(20,15,40,.6) !important;
            border-color: rgba(139,92,246,.12) !important;
        }

        /* Login modal */
        [data-theme="light"] .login-content {
            background: rgba(20,15,40,.95) !important;
            border-color: rgba(139,92,246,.15) !important;
        }

        /* Buttons keep their gradient colors */
        [data-theme="light"] .btn-play { opacity: .95 !important; }

        /* Meta items */
        [data-theme="light"] .meta-item,
        [data-theme="light"] .card-meta {
            color: rgba(224,220,245,.5) !important;
        }

        /* Floating buttons */
        [data-theme="light"] #ppz-notif-bell {
            background: rgba(20,15,40,.85) !important;
            border-color: rgba(139,92,246,.25) !important;
        }
    `;

    function applyTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);

        // Inject or update light CSS
        let styleEl = document.getElementById('ppz-theme-css');
        if (theme === 'light') {
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'ppz-theme-css';
                styleEl.textContent = LIGHT_CSS;
                document.head.appendChild(styleEl);
            }
        } else {
            if (styleEl) styleEl.remove();
        }

        // Update meta theme-color
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'light' ? '#1a1035' : '#030014';

        updateToggleUI();
        saveTheme(theme);
    }

    function toggleTheme() {
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
        return currentTheme;
    }

    function createToggleButton() {
        if (document.getElementById('ppz-theme-btn')) return;

        const style = document.createElement('style');
        style.textContent = `
            #ppz-theme-btn{position:fixed;bottom:140px;right:20px;z-index:9988;width:48px;height:48px;border-radius:50%;border:2px solid rgba(255,215,0,.25);background:rgba(3,0,20,.9);backdrop-filter:blur(10px);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;transition:.3s;box-shadow:0 4px 20px rgba(0,0,0,.5)}
            #ppz-theme-btn:hover{border-color:rgba(255,215,0,.5);transform:scale(1.1);box-shadow:0 0 25px rgba(255,215,0,.15)}
            [data-theme="light"] #ppz-theme-btn{background:rgba(20,15,40,.85);border-color:rgba(192,132,252,.3);box-shadow:0 4px 20px rgba(139,92,246,.15)}
        `;
        document.head.appendChild(style);

        const btn = document.createElement('button');
        btn.id = 'ppz-theme-btn';
        btn.title = 'Chế độ sáng/tối';
        btn.textContent = currentTheme === 'dark' ? '🌙' : '☀️';
        btn.addEventListener('click', () => {
            toggleTheme();
            if (window.PPZSound) window.PPZSound.play('click');
        });
        document.body.appendChild(btn);
    }

    function updateToggleUI() {
        const btn = document.getElementById('ppz-theme-btn');
        if (btn) btn.textContent = currentTheme === 'dark' ? '🌙' : '☀️';
    }

    // Apply immediately (before DOM ready to prevent flash)
    applyTheme(currentTheme);

    // Create toggle button on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createToggleButton);
    } else {
        createToggleButton();
    }

    // Global API
    window.PPZTheme = {
        toggle: toggleTheme,
        set: applyTheme,
        get: () => currentTheme
    };
})();
