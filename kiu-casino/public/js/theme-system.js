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
        [data-theme="light"] {
            --bg: #f0f0f5 !important;
            --bg-primary: #f0f0f5 !important;
            --bg-secondary: #e4e4ec !important;
            --surface: rgba(255,255,255,.92) !important;
            --surface2: rgba(240,240,248,.95) !important;
            --surface-light: rgba(255,255,255,.7) !important;
            --glass: rgba(0,0,0,.02) !important;
            --glass-border: rgba(0,0,0,.06) !important;
            --border: rgba(139,92,246,.12) !important;
            --text: #1a1a2e !important;
            --muted: rgba(0,0,0,.45) !important;
            color: #1a1a2e !important;
        }
        [data-theme="light"] body {
            background: #f0f0f5 !important;
            color: #1a1a2e !important;
        }
        [data-theme="light"] .navbar,
        [data-theme="light"] .nav,
        [data-theme="light"] .top-bar,
        [data-theme="light"] header {
            background: rgba(240,240,248,.9) !important;
            border-color: rgba(0,0,0,.06) !important;
        }
        [data-theme="light"] .game-card,
        [data-theme="light"] .stat-card,
        [data-theme="light"] .game-row,
        [data-theme="light"] .activity-item,
        [data-theme="light"] .ach-card {
            background: rgba(255,255,255,.9) !important;
            border-color: rgba(139,92,246,.1) !important;
            box-shadow: 0 2px 12px rgba(0,0,0,.06) !important;
        }
        [data-theme="light"] .game-card:hover,
        [data-theme="light"] .stat-card:hover {
            box-shadow: 0 6px 24px rgba(139,92,246,.12) !important;
        }
        [data-theme="light"] .card-title,
        [data-theme="light"] .game-name,
        [data-theme="light"] .stat-label,
        [data-theme="light"] .section-title,
        [data-theme="light"] h1, [data-theme="light"] h2, [data-theme="light"] h3 {
            color: #1a1a2e !important;
        }
        [data-theme="light"] .card-desc,
        [data-theme="light"] .game-detail,
        [data-theme="light"] .activity-text,
        [data-theme="light"] .ach-desc,
        [data-theme="light"] p {
            color: rgba(0,0,0,.6) !important;
        }
        [data-theme="light"] .bg-mesh,
        [data-theme="light"] .bg-stars,
        [data-theme="light"] .hex-grid,
        [data-theme="light"] .scanlines {
            opacity: .15 !important;
        }
        [data-theme="light"] #bg-canvas { opacity: .08 !important; }
        [data-theme="light"] .footer { color: rgba(0,0,0,.4) !important; }
        [data-theme="light"] .modal-box,
        [data-theme="light"] #ppz-sound-menu,
        [data-theme="light"] #ppz-notif-history {
            background: rgba(255,255,255,.95) !important;
            border-color: rgba(0,0,0,.08) !important;
            color: #1a1a2e !important;
        }
        [data-theme="light"] .ppz-toast {
            background: rgba(255,255,255,.95) !important;
            border-color: rgba(0,0,0,.08) !important;
        }
        [data-theme="light"] .ppz-toast-msg,
        [data-theme="light"] .ppz-nh-item .ni-msg {
            color: rgba(0,0,0,.55) !important;
        }
        [data-theme="light"] .ppz-toast-title,
        [data-theme="light"] .ppz-nh-item .ni-title { color: #1a1a2e !important; }
        [data-theme="light"] input, [data-theme="light"] select {
            background: rgba(0,0,0,.04) !important;
            color: #1a1a2e !important;
            border-color: rgba(0,0,0,.1) !important;
        }
        [data-theme="light"] .username,
        [data-theme="light"] .brand-text { color: #1a1a2e !important; }
        [data-theme="light"] .btn-login,
        [data-theme="light"] .btn-exit {
            color: #1a1a2e !important;
            border-color: rgba(0,0,0,.15) !important;
        }
        [data-theme="light"] .profile-id,
        [data-theme="light"] .activity-time,
        [data-theme="light"] .ni-time {
            color: rgba(0,0,0,.35) !important;
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
        if (meta) meta.content = theme === 'light' ? '#f0f0f5' : '#030014';

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
            [data-theme="light"] #ppz-theme-btn{background:rgba(255,255,255,.9);border-color:rgba(139,92,246,.25);box-shadow:0 4px 20px rgba(0,0,0,.1)}
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
