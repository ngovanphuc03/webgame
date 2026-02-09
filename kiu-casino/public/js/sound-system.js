/* ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Global Sound System
 *  Include on every page: <script src="/js/sound-system.js"></script>
 *  Only renders UI when logged in (has user_id cookie)
 * ═══════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // Check login status — no user_id cookie = don't show UI
    function isLoggedIn() {
        return document.cookie.split(';').some(c => c.trim().startsWith('user_id='));
    }

    const SOUNDS = {
        click: '/sounds/click.mp3',
        bet: '/sounds/bet.mp3',
        win: '/sounds/win.mp3',
        lose: '/sounds/lose.mp3',
        open: '/sounds/open.mp3',
        tick: '/sounds/tick.mp3',
        bgm: '/sounds/bgm.mp3'
    };

    const POOL_SIZE = 3;
    const pools = {};
    let bgmAudio = null;
    let bgmPlaying = false;

    // Settings stored in localStorage
    function getSettings() {
        try {
            const raw = localStorage.getItem('ppz_sound');
            if (raw) return JSON.parse(raw);
        } catch (e) { }
        return { sfxOn: true, bgmOn: false, sfxVol: 0.5, bgmVol: 0.25 };
    }
    function saveSettings(s) {
        try { localStorage.setItem('ppz_sound', JSON.stringify(s)); } catch (e) { }
    }

    let settings = getSettings();

    // Create audio pool for SFX
    function getPool(name) {
        if (!pools[name]) {
            pools[name] = [];
            const src = SOUNDS[name];
            if (!src) return [];
            for (let i = 0; i < POOL_SIZE; i++) {
                const a = new Audio(src);
                a.preload = 'auto';
                a.volume = settings.sfxVol;
                pools[name].push(a);
            }
        }
        return pools[name];
    }

    // Play SFX
    function playSFX(name) {
        if (!settings.sfxOn) return;
        const pool = getPool(name);
        for (const a of pool) {
            if (a.paused || a.ended) {
                a.volume = settings.sfxVol;
                a.currentTime = 0;
                a.play().catch(() => { });
                return;
            }
        }
        // All busy — reuse first
        if (pool.length > 0) {
            pool[0].volume = settings.sfxVol;
            pool[0].currentTime = 0;
            pool[0].play().catch(() => { });
        }
    }

    // BGM control
    function initBGM() {
        if (bgmAudio) return;
        bgmAudio = new Audio(SOUNDS.bgm);
        bgmAudio.loop = true;
        bgmAudio.volume = settings.bgmVol;
        bgmAudio.preload = 'auto';
    }
    function playBGM() {
        initBGM();
        if (!settings.bgmOn) return;
        bgmAudio.volume = settings.bgmVol;
        bgmAudio.play().catch(() => { });
        bgmPlaying = true;
    }
    function pauseBGM() {
        if (bgmAudio) { bgmAudio.pause(); bgmPlaying = false; }
    }
    function toggleBGM() {
        settings.bgmOn = !settings.bgmOn;
        saveSettings(settings);
        if (settings.bgmOn) playBGM(); else pauseBGM();
        updateSoundUI();
        return settings.bgmOn;
    }
    function toggleSFX() {
        settings.sfxOn = !settings.sfxOn;
        saveSettings(settings);
        updateSoundUI();
        return settings.sfxOn;
    }
    function setVolume(type, val) {
        val = Math.max(0, Math.min(1, val));
        if (type === 'sfx') {
            settings.sfxVol = val;
            Object.values(pools).forEach(pool => pool.forEach(a => a.volume = val));
        } else {
            settings.bgmVol = val;
            if (bgmAudio) bgmAudio.volume = val;
        }
        saveSettings(settings);
    }

    // UI Panel — renders into #ppz-toolbar if available, else fixed button
    function createSoundPanel() {
        if (!isLoggedIn()) return; // Don't show if not logged in
        if (document.getElementById('ppz-sound-panel')) return;

        const toolbar = document.getElementById('ppz-toolbar');

        const panel = document.createElement('div');
        panel.id = 'ppz-sound-panel';
        panel.innerHTML = `
            <style>
                .ppz-tb-btn{width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(0,240,255,.25);background:rgba(0,240,255,.08);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:17px;transition:.3s;position:relative;flex-shrink:0}
                .ppz-tb-btn:hover{border-color:rgba(0,240,255,.5);background:rgba(0,240,255,.15);transform:scale(1.1)}
                #ppz-sound-menu{position:fixed;top:60px;right:20px;z-index:99999;background:rgba(3,0,20,.95);backdrop-filter:blur(20px);border:1px solid rgba(0,240,255,.15);border-radius:16px;padding:20px;width:280px;display:none;box-shadow:0 10px 40px rgba(0,0,0,.6);font-family:'DearPix',sans-serif;color:#fff}
                #ppz-sound-menu.show{display:block;animation:ppzSlideDown .3s ease}
                @keyframes ppzSlideDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
                #ppz-sound-menu h3{font-size:15px;margin:0 0 14px;color:#00f0ff;display:flex;align-items:center;gap:8px}
                .ppz-snd-row{display:flex;align-items:center;justify-content:space-between;margin:10px 0;font-size:13px;color:rgba(255,255,255,.8)}
                .ppz-snd-row label{flex:1}
                .ppz-snd-toggle{width:44px;height:24px;background:rgba(255,255,255,.1);border-radius:12px;border:none;cursor:pointer;position:relative;transition:.3s}
                .ppz-snd-toggle.on{background:rgba(0,240,255,.3)}
                .ppz-snd-toggle::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.3s}
                .ppz-snd-toggle.on::after{left:23px;background:#00f0ff}
                .ppz-snd-slider{width:100%;height:4px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.1);border-radius:2px;outline:none;margin:6px 0}
                .ppz-snd-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#00f0ff;cursor:pointer;box-shadow:0 0 8px rgba(0,240,255,.4)}
                .ppz-snd-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#00f0ff;cursor:pointer;border:none}
                .ppz-snd-label{font-size:11px;color:rgba(255,255,255,.4);margin-top:2px}
            </style>
            <button class="ppz-tb-btn" id="ppz-sound-btn" title="Âm thanh">${(settings.sfxOn || settings.bgmOn) ? '🔊' : '🔇'}</button>
            <div id="ppz-sound-menu">
                <h3>🔊 Âm Thanh</h3>
                <div class="ppz-snd-row">
                    <label>🎵 Nhạc nền</label>
                    <button class="ppz-snd-toggle ${settings.bgmOn ? 'on' : ''}" id="ppz-bgm-toggle"></button>
                </div>
                <div>
                    <input type="range" class="ppz-snd-slider" id="ppz-bgm-vol" min="0" max="100" value="${Math.round(settings.bgmVol * 100)}">
                    <div class="ppz-snd-label">Âm lượng nhạc: <span id="ppz-bgm-val">${Math.round(settings.bgmVol * 100)}%</span></div>
                </div>
                <div class="ppz-snd-row" style="margin-top:14px">
                    <label>🔔 Hiệu ứng</label>
                    <button class="ppz-snd-toggle ${settings.sfxOn ? 'on' : ''}" id="ppz-sfx-toggle"></button>
                </div>
                <div>
                    <input type="range" class="ppz-snd-slider" id="ppz-sfx-vol" min="0" max="100" value="${Math.round(settings.sfxVol * 100)}">
                    <div class="ppz-snd-label">Âm lượng SFX: <span id="ppz-sfx-val">${Math.round(settings.sfxVol * 100)}%</span></div>
                </div>
            </div>`;

        if (toolbar) {
            // Insert just the button into toolbar, menu stays in panel appended to body
            const btn = panel.querySelector('#ppz-sound-btn');
            const menu = panel.querySelector('#ppz-sound-menu');
            const style = panel.querySelector('style');
            toolbar.appendChild(btn);
            document.body.appendChild(menu);
            document.head.appendChild(style);
        } else {
            document.body.appendChild(panel);
        }

        // Events
        document.getElementById('ppz-sound-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('ppz-sound-menu').classList.toggle('show');
        });
        document.getElementById('ppz-bgm-toggle').addEventListener('click', () => toggleBGM());
        document.getElementById('ppz-sfx-toggle').addEventListener('click', () => toggleSFX());
        document.getElementById('ppz-bgm-vol').addEventListener('input', e => {
            setVolume('bgm', e.target.value / 100);
            document.getElementById('ppz-bgm-val').textContent = e.target.value + '%';
        });
        document.getElementById('ppz-sfx-vol').addEventListener('input', e => {
            setVolume('sfx', e.target.value / 100);
            document.getElementById('ppz-sfx-val').textContent = e.target.value + '%';
        });

        // Close menu on outside click
        document.addEventListener('click', e => {
            const menu = document.getElementById('ppz-sound-menu');
            const btn = document.getElementById('ppz-sound-btn');
            if (menu && !menu.contains(e.target) && !btn.contains(e.target)) {
                menu.classList.remove('show');
            }
        });

        // Auto-play BGM on first interaction
        if (settings.bgmOn) {
            const startBGM = () => { playBGM(); document.removeEventListener('click', startBGM); document.removeEventListener('touchstart', startBGM); };
            document.addEventListener('click', startBGM, { once: true });
            document.addEventListener('touchstart', startBGM, { once: true });
        }
    }

    function updateSoundUI() {
        const bgmToggle = document.getElementById('ppz-bgm-toggle');
        const sfxToggle = document.getElementById('ppz-sfx-toggle');
        const btn = document.getElementById('ppz-sound-btn');
        if (bgmToggle) bgmToggle.className = 'ppz-snd-toggle' + (settings.bgmOn ? ' on' : '');
        if (sfxToggle) sfxToggle.className = 'ppz-snd-toggle' + (settings.sfxOn ? ' on' : '');
        if (btn) btn.textContent = (settings.sfxOn || settings.bgmOn) ? '🔊' : '🔇';
    }

    // Init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createSoundPanel);
    } else {
        createSoundPanel();
    }

    // Expose global API (always available for programmatic use even if UI hidden)
    window.PPZSound = {
        play: playSFX,
        playBGM, pauseBGM, toggleBGM, toggleSFX,
        setVolume,
        getSettings: () => ({ ...settings })
    };
})();
