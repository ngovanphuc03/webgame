/* ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Realtime Notification System
 *  Include on every page: <script src="/js/notify-system.js"></script>
 *  Bell UI only renders when logged in (has user_info cookie)
 * ═══════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function isLoggedIn() {
        return document.cookie.split(';').some(c => c.trim().startsWith('user_info='));
    }

    const MAX_TOASTS = 5;
    const TOAST_DURATION = 4500;
    let container = null;
    let toastQueue = [];

    const TYPES = {
        info: { icon: 'ℹ️', color: '#00f0ff', glow: 'rgba(0,240,255,.15)' },
        success: { icon: '✅', color: '#00ff9d', glow: 'rgba(0,255,157,.15)' },
        warning: { icon: '⚠️', color: '#ff8c00', glow: 'rgba(255,140,0,.15)' },
        error: { icon: '❌', color: '#ff3355', glow: 'rgba(255,51,85,.15)' },
        reward: { icon: '🎁', color: '#ffd700', glow: 'rgba(255,215,0,.15)' },
        jackpot: { icon: '💰', color: '#ffd700', glow: 'rgba(255,215,0,.25)' },
        friend: { icon: '👤', color: '#8b5cf6', glow: 'rgba(139,92,246,.15)' },
        level: { icon: '⭐', color: '#ffd700', glow: 'rgba(255,215,0,.2)' },
        system: { icon: '🔔', color: '#00f0ff', glow: 'rgba(0,240,255,.1)' }
    };

    function createContainer() {
        if (container) return;
        container = document.createElement('div');
        container.id = 'ppz-notify-container';
        const style = document.createElement('style');
        style.textContent = `
            #ppz-notify-container{position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:380px;width:calc(100% - 32px)}
            .ppz-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:12px;padding:14px 18px;border-radius:14px;background:rgba(3,0,20,.92);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 32px rgba(0,0,0,.5);animation:ppzToastIn .4s cubic-bezier(.4,0,.2,1);font-family:'DearPix',sans-serif;cursor:pointer;transition:transform .2s,opacity .3s}
            .ppz-toast:hover{transform:translateX(-4px)}
            .ppz-toast.out{animation:ppzToastOut .3s ease forwards}
            .ppz-toast-icon{font-size:24px;flex-shrink:0;margin-top:1px}
            .ppz-toast-body{flex:1;min-width:0}
            .ppz-toast-title{font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;line-height:1.3}
            .ppz-toast-msg{font-size:12px;color:rgba(255,255,255,.65);line-height:1.4;word-break:break-word}
            .ppz-toast-time{font-size:10px;color:rgba(255,255,255,.3);margin-top:4px}
            .ppz-toast-close{flex-shrink:0;background:none;border:none;color:rgba(255,255,255,.3);font-size:16px;cursor:pointer;padding:0 0 0 8px;line-height:1}
            .ppz-toast-close:hover{color:#fff}
            .ppz-toast-bar{position:absolute;bottom:0;left:0;height:3px;border-radius:0 0 14px 14px;transition:width linear}
            @keyframes ppzToastIn{from{opacity:0;transform:translateX(80px)}to{opacity:1;transform:translateX(0)}}
            @keyframes ppzToastOut{to{opacity:0;transform:translateX(80px);height:0;padding:0;margin:0;border:0}}
            @media(max-width:480px){#ppz-notify-container{right:8px;max-width:calc(100% - 16px)}.ppz-toast{padding:12px 14px}}

            /* Notification bell — toolbar style */
            #ppz-notif-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:#ff3355;color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;font-family:'DearPix',sans-serif}
            #ppz-notif-badge.hidden{display:none}
            #ppz-notif-history{position:fixed;top:60px;right:20px;z-index:99999;width:340px;max-height:420px;background:rgba(3,0,20,.95);backdrop-filter:blur(20px);border:1px solid rgba(139,92,246,.15);border-radius:16px;display:none;box-shadow:0 10px 40px rgba(0,0,0,.6);font-family:'DearPix',sans-serif;color:#fff;overflow:hidden}
            #ppz-notif-history.show{display:flex;flex-direction:column;animation:ppzSlideDown .3s ease}
            @keyframes ppzSlideDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
            .ppz-nh-header{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between}
            .ppz-nh-header h3{font-size:14px;color:#8b5cf6;margin:0;display:flex;align-items:center;gap:6px}
            .ppz-nh-clear{background:none;border:none;color:rgba(255,255,255,.3);font-size:11px;cursor:pointer;font-family:'DearPix',sans-serif}
            .ppz-nh-clear:hover{color:#ff3355}
            .ppz-nh-list{flex:1;overflow-y:auto;padding:8px;max-height:340px}
            .ppz-nh-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;margin-bottom:4px;transition:.2s}
            .ppz-nh-item:hover{background:rgba(255,255,255,.03)}
            .ppz-nh-item .ni-icon{font-size:18px;flex-shrink:0;margin-top:2px}
            .ppz-nh-item .ni-body{flex:1;min-width:0}
            .ppz-nh-item .ni-title{font-size:12px;font-weight:600;color:#fff}
            .ppz-nh-item .ni-msg{font-size:11px;color:rgba(255,255,255,.5);margin-top:2px}
            .ppz-nh-item .ni-time{font-size:10px;color:rgba(255,255,255,.25);margin-top:3px}
            .ppz-nh-empty{text-align:center;padding:40px 20px;color:rgba(255,255,255,.3);font-size:13px}
            @media(max-width:480px){#ppz-notif-history{right:8px;width:calc(100% - 16px)}}
        `;
        document.head.appendChild(style);
        document.body.appendChild(container);
    }

    // History storage
    function getHistory() {
        try { return JSON.parse(localStorage.getItem('ppz_notifs') || '[]'); } catch (e) { return []; }
    }
    function saveHistory(list) {
        try { localStorage.setItem('ppz_notifs', JSON.stringify(list.slice(0, 50))); } catch (e) { }
    }
    function getUnread() {
        try { return parseInt(localStorage.getItem('ppz_notifs_unread') || '0', 10); } catch (e) { return 0; }
    }
    function setUnread(n) {
        try { localStorage.setItem('ppz_notifs_unread', String(n)); } catch (e) { }
        updateBadge(n);
    }

    // Show toast notification
    function notify(title, msg, type = 'info', duration = TOAST_DURATION) {
        createContainer();
        const cfg = TYPES[type] || TYPES.info;

        const entry = { title, msg, type, ts: Date.now() };
        const hist = getHistory();
        hist.unshift(entry);
        saveHistory(hist);
        setUnread(getUnread() + 1);
        renderHistory();

        const toast = document.createElement('div');
        toast.className = 'ppz-toast';
        toast.style.borderColor = cfg.glow;
        toast.innerHTML = `
            <span class="ppz-toast-icon">${cfg.icon}</span>
            <div class="ppz-toast-body">
                <div class="ppz-toast-title" style="color:${cfg.color}">${title}</div>
                <div class="ppz-toast-msg">${msg}</div>
            </div>
            <button class="ppz-toast-close" onclick="this.closest('.ppz-toast').remove()">✕</button>
            <div class="ppz-toast-bar" style="background:${cfg.color};width:100%"></div>`;

        container.appendChild(toast);

        const bar = toast.querySelector('.ppz-toast-bar');
        requestAnimationFrame(() => { bar.style.transitionDuration = duration + 'ms'; bar.style.width = '0%'; });

        const timer = setTimeout(() => removeToast(toast), duration);
        toast.addEventListener('click', e => {
            if (e.target.closest('.ppz-toast-close')) return;
            clearTimeout(timer);
            removeToast(toast);
        });

        if (window.PPZSound) window.PPZSound.play('click');

        while (container.children.length > MAX_TOASTS) {
            container.firstChild.remove();
        }
    }

    function removeToast(toast) {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 300);
    }

    function timeAgo(ts) {
        const d = Date.now() - ts;
        if (d < 60000) return 'Vừa xong';
        if (d < 3600000) return Math.floor(d / 60000) + ' phút trước';
        if (d < 86400000) return Math.floor(d / 3600000) + ' giờ trước';
        return Math.floor(d / 86400000) + ' ngày trước';
    }

    // Bell + history panel — only if logged in, renders into #ppz-toolbar
    function createBellUI() {
        if (!isLoggedIn()) return;
        if (document.getElementById('ppz-notif-bell')) return;

        const toolbar = document.getElementById('ppz-toolbar');
        if (!toolbar) {
            // Toolbar not yet created (async checkAuth on index.html) — retry up to 3s
            if (!createBellUI._retries) createBellUI._retries = 0;
            if (createBellUI._retries++ < 30) {
                setTimeout(createBellUI, 100);
            }
            return;
        }

        const bell = document.createElement('button');
        bell.id = 'ppz-notif-bell';
        bell.className = 'ppz-tb-btn';
        bell.title = 'Thông báo';
        bell.innerHTML = `🔔<span id="ppz-notif-badge" class="${getUnread() > 0 ? '' : 'hidden'}">${getUnread()}</span>`;

        const panel = document.createElement('div');
        panel.id = 'ppz-notif-history';
        panel.innerHTML = `
            <div class="ppz-nh-header">
                <h3>🔔 Thông báo</h3>
                <button class="ppz-nh-clear" id="ppz-nh-clear">Xóa tất cả</button>
            </div>
            <div class="ppz-nh-list" id="ppz-nh-list"></div>`;

        if (toolbar) {
            toolbar.appendChild(bell);
        }
        document.body.appendChild(panel);

        bell.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('show');
            if (panel.classList.contains('show')) {
                setUnread(0);
                renderHistory();
            }
        });

        document.getElementById('ppz-nh-clear').addEventListener('click', () => {
            saveHistory([]);
            setUnread(0);
            renderHistory();
        });

        document.addEventListener('click', e => {
            if (!panel.contains(e.target) && !bell.contains(e.target)) {
                panel.classList.remove('show');
            }
        });

        renderHistory();
    }

    function updateBadge(n) {
        const badge = document.getElementById('ppz-notif-badge');
        if (!badge) return;
        badge.textContent = n > 99 ? '99+' : n;
        badge.classList.toggle('hidden', n <= 0);
    }

    function renderHistory() {
        const list = document.getElementById('ppz-nh-list');
        if (!list) return;
        const hist = getHistory();
        if (hist.length === 0) {
            list.innerHTML = '<div class="ppz-nh-empty">🔕 Không có thông báo</div>';
            return;
        }
        list.innerHTML = hist.map(n => {
            const cfg = TYPES[n.type] || TYPES.info;
            return `<div class="ppz-nh-item">
                <span class="ni-icon">${cfg.icon}</span>
                <div class="ni-body">
                    <div class="ni-title" style="color:${cfg.color}">${n.title}</div>
                    <div class="ni-msg">${n.msg}</div>
                    <div class="ni-time">${timeAgo(n.ts)}</div>
                </div>
            </div>`;
        }).join('');
    }

    // Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { createContainer(); createBellUI(); });
    } else {
        createContainer(); createBellUI();
    }

    // Global API (always available for programmatic use)
    window.PPZNotify = {
        show: notify,
        info: (title, msg) => notify(title, msg, 'info'),
        success: (title, msg) => notify(title, msg, 'success'),
        warning: (title, msg) => notify(title, msg, 'warning'),
        error: (title, msg) => notify(title, msg, 'error'),
        reward: (title, msg) => notify(title, msg, 'reward'),
        jackpot: (title, msg) => notify(title, msg, 'jackpot'),
        friend: (title, msg) => notify(title, msg, 'friend'),
        level: (title, msg) => notify(title, msg, 'level'),
        system: (title, msg) => notify(title, msg, 'system'),
        getHistory,
        clearHistory: () => { saveHistory([]); setUnread(0); renderHistory(); }
    };
})();
