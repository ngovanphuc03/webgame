/* ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Live Activity Feed Widget (Tier 2)
 *  Shows real-time wins, achievements, transfers as a scrolling ticker
 *  Include on every page: <script src="/js/live-feed.js"></script>
 * ═══════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function isLoggedIn() {
        return document.cookie.split(';').some(c => c.trim().startsWith('user_info='));
    }
    if (!isLoggedIn()) return;

    const feedItems = [];
    const MAX_ITEMS = 30;
    let tickerEl = null;
    let feedPanelEl = null;
    let feedOpen = false;

    // Feed type configs
    const FEED_TYPES = {
        big_win: { icon: '💰', color: '#ffd700', label: 'Big Win' },
        achievement: { icon: '🏆', color: '#8b5cf6', label: 'Achievement' },
        level_up: { icon: '⭐', color: '#00f0ff', label: 'Level Up' },
        transfer: { icon: '💸', color: '#00ff9d', label: 'Transfer' },
        system: { icon: '📢', color: '#ff8c00', label: 'System' }
    };

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* ═══ LIVE FEED TICKER BAR ═══ */
            #ppz-live-ticker{position:fixed;bottom:0;left:0;right:0;z-index:9990;height:36px;background:rgba(3,0,20,.92);backdrop-filter:blur(12px);border-top:1px solid rgba(139,92,246,.12);display:flex;align-items:center;overflow:hidden;cursor:pointer;transition:opacity .3s}
            #ppz-live-ticker:hover{background:rgba(3,0,20,.97)}
            .ticker-label{flex-shrink:0;padding:0 14px;font-size:11px;font-weight:700;color:#8b5cf6;font-family:'DearPix',sans-serif;display:flex;align-items:center;gap:6px;border-right:1px solid rgba(139,92,246,.15)}
            .ticker-dot{width:7px;height:7px;border-radius:50%;background:#00ff88;animation:tickerPulse 1.5s ease infinite}
            @keyframes tickerPulse{0%,100%{opacity:.4;box-shadow:0 0 4px #00ff88}50%{opacity:1;box-shadow:0 0 10px #00ff88}}
            .ticker-scroll{flex:1;overflow:hidden;position:relative;height:100%;display:flex;align-items:center}
            .ticker-track{display:flex;align-items:center;gap:40px;animation:tickerSlide 30s linear infinite;white-space:nowrap;padding-left:100%}
            .ticker-track:hover{animation-play-state:paused}
            @keyframes tickerSlide{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
            .ticker-item{display:flex;align-items:center;gap:8px;font-size:12px;font-family:'DearPix',sans-serif;color:rgba(255,255,255,.7);flex-shrink:0}
            .ticker-item .ti-icon{font-size:14px}
            .ticker-item .ti-user{font-weight:700;color:#00f0ff}
            .ticker-item .ti-amount{font-weight:700;color:#ffd700}
            .ticker-item .ti-time{font-size:10px;color:rgba(255,255,255,.3);margin-left:4px}
            .ticker-expand{flex-shrink:0;padding:0 12px;font-size:16px;color:rgba(255,255,255,.4);cursor:pointer;transition:.3s;display:flex;align-items:center}
            .ticker-expand:hover{color:#8b5cf6}
            .ticker-online{flex-shrink:0;padding:0 12px;font-size:11px;color:#00ff88;font-family:'DearPix',sans-serif;display:flex;align-items:center;gap:5px;border-left:1px solid rgba(139,92,246,.15)}

            /* ═══ EXPANDED FEED PANEL ═══ */
            #ppz-feed-panel{position:fixed;bottom:36px;right:16px;z-index:9991;width:380px;max-height:450px;background:rgba(3,0,20,.96);backdrop-filter:blur(24px);border:1px solid rgba(139,92,246,.15);border-radius:16px 16px 0 0;display:none;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.5);font-family:'DearPix',sans-serif;color:#fff;overflow:hidden}
            #ppz-feed-panel.show{display:flex;animation:feedSlideUp .3s ease}
            @keyframes feedSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
            .feed-header{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between}
            .feed-header h3{font-size:14px;color:#8b5cf6;margin:0;display:flex;align-items:center;gap:8px}
            .feed-header .feed-close{background:none;border:none;color:rgba(255,255,255,.3);font-size:18px;cursor:pointer}
            .feed-header .feed-close:hover{color:#fff}
            .feed-list{flex:1;overflow-y:auto;padding:8px;max-height:380px;scrollbar-width:thin;scrollbar-color:rgba(139,92,246,.2) transparent}
            .feed-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;margin-bottom:4px;transition:.2s;border-left:3px solid transparent}
            .feed-item:hover{background:rgba(255,255,255,.03)}
            .feed-item .fi-icon{font-size:20px;flex-shrink:0;margin-top:2px}
            .feed-item .fi-body{flex:1;min-width:0}
            .feed-item .fi-msg{font-size:12px;color:rgba(255,255,255,.75);line-height:1.4}
            .feed-item .fi-msg strong{color:#00f0ff;font-weight:700}
            .feed-item .fi-msg .fi-amount{color:#ffd700;font-weight:700}
            .feed-item .fi-time{font-size:10px;color:rgba(255,255,255,.25);margin-top:3px}
            .feed-empty{text-align:center;padding:40px 20px;color:rgba(255,255,255,.3);font-size:13px}
            @media(max-width:600px){#ppz-feed-panel{right:0;left:0;width:100%;border-radius:16px 16px 0 0}}
            /* Push page content up to avoid ticker overlap — skip fullscreen game pages */
            body:not(.ppz-fullscreen){padding-bottom:36px!important}
        `;
        document.head.appendChild(style);
    }

    function timeAgo(ts) {
        const d = Date.now() - ts;
        if (d < 60000) return 'vừa xong';
        if (d < 3600000) return Math.floor(d / 60000) + 'p';
        if (d < 86400000) return Math.floor(d / 3600000) + 'h';
        return Math.floor(d / 86400000) + 'd';
    }

    function createTicker() {
        if (tickerEl) return;
        injectStyles();

        tickerEl = document.createElement('div');
        tickerEl.id = 'ppz-live-ticker';
        tickerEl.innerHTML = `
            <div class="ticker-label"><span class="ticker-dot"></span> LIVE</div>
            <div class="ticker-scroll">
                <div class="ticker-track" id="ppz-ticker-track"></div>
            </div>
            <div class="ticker-online">👥 <span id="ppz-online-count">0</span></div>
            <div class="ticker-expand" id="ppz-feed-expand" title="Mở bảng tin">▲</div>
        `;

        feedPanelEl = document.createElement('div');
        feedPanelEl.id = 'ppz-feed-panel';
        feedPanelEl.innerHTML = `
            <div class="feed-header">
                <h3>📡 Hoạt Động Trực Tiếp</h3>
                <button class="feed-close" id="ppz-feed-close">✕</button>
            </div>
            <div class="feed-list" id="ppz-feed-list">
                <div class="feed-empty">⏳ Đang tải...</div>
            </div>
        `;

        document.body.appendChild(tickerEl);
        document.body.appendChild(feedPanelEl);

        // Toggle feed panel
        document.getElementById('ppz-feed-expand').addEventListener('click', (e) => {
            e.stopPropagation();
            feedOpen = !feedOpen;
            feedPanelEl.classList.toggle('show', feedOpen);
            document.getElementById('ppz-feed-expand').textContent = feedOpen ? '▼' : '▲';
            if (feedOpen) renderFeedPanel();
        });

        document.getElementById('ppz-feed-close').addEventListener('click', () => {
            feedOpen = false;
            feedPanelEl.classList.remove('show');
            document.getElementById('ppz-feed-expand').textContent = '▲';
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (feedOpen && !feedPanelEl.contains(e.target) && !tickerEl.contains(e.target)) {
                feedOpen = false;
                feedPanelEl.classList.remove('show');
                document.getElementById('ppz-feed-expand').textContent = '▲';
            }
        });

        // Initial placeholder
        updateTickerTrack();
    }

    function addFeedItem(item) {
        feedItems.unshift(item);
        if (feedItems.length > MAX_ITEMS) feedItems.pop();
        updateTickerTrack();
        if (feedOpen) renderFeedPanel();
    }

    function updateTickerTrack() {
        const track = document.getElementById('ppz-ticker-track');
        if (!track) return;

        if (feedItems.length === 0) {
            track.innerHTML = `<span class="ticker-item"><span class="ti-icon">🎮</span> Chào mừng đến Pixel PlayZone!</span>`.repeat(2);
            return;
        }

        // Duplicate items for seamless looping
        const items = feedItems.slice(0, 15);
        const html = items.map(item => {
            const cfg = FEED_TYPES[item.type] || FEED_TYPES.system;
            return `<span class="ticker-item">
                <span class="ti-icon">${cfg.icon}</span>
                <span>${item.msg || ''}</span>
                <span class="ti-time">${timeAgo(item.ts)}</span>
            </span>`;
        }).join('');
        track.innerHTML = html + html; // Double for seamless loop

        // Adjust animation duration based on content
        const speed = Math.max(20, items.length * 5);
        track.style.animationDuration = speed + 's';
    }

    function renderFeedPanel() {
        const list = document.getElementById('ppz-feed-list');
        if (!list) return;

        if (feedItems.length === 0) {
            list.innerHTML = '<div class="feed-empty">🔕 Chưa có hoạt động nào</div>';
            return;
        }

        list.innerHTML = feedItems.map(item => {
            const cfg = FEED_TYPES[item.type] || FEED_TYPES.system;
            let msg = item.msg || '';
            // Highlight usernames and amounts
            if (item.username) msg = msg.replace(item.username, `<strong>${item.username}</strong>`);
            if (item.amount) msg = msg.replace(Number(item.amount).toLocaleString() + '$', `<span class="fi-amount">${Number(item.amount).toLocaleString()}$</span>`);

            return `<div class="feed-item" style="border-left-color:${cfg.color}">
                <span class="fi-icon">${cfg.icon}</span>
                <div class="fi-body">
                    <div class="fi-msg">${msg}</div>
                    <div class="fi-time">${timeAgo(item.ts)}</div>
                </div>
            </div>`;
        }).join('');
    }

    function initSocket() {
        function tryConnect() {
            if (typeof io === 'undefined') {
                setTimeout(tryConnect, 300);
                return;
            }
            const socket = window._ppzSocket || io();
            window._ppzSocket = socket;

            // Receive live feed history on connect
            socket.on('live_feed_history', (items) => {
                if (Array.isArray(items)) {
                    items.reverse().forEach(item => addFeedItem(item));
                }
            });

            // Receive individual live feed events
            socket.on('live_feed', (item) => {
                addFeedItem(item);
            });

            // Online count
            socket.on('online_count', (data) => {
                const el = document.getElementById('ppz-online-count');
                if (el) el.textContent = data.count || 0;
            });

            // Report page visit
            const pageName = location.pathname.replace(/^\//, '').replace(/\.html$/, '') || 'lobby';
            socket.emit('page_visit', { page: pageName });
        }
        tryConnect();
    }

    // Init
    function init() {
        createTicker();
        initSocket();

        // Also fetch initial feed via REST
        fetch('/api/live-feed')
            .then(r => r.ok ? r.json() : { feed: [] })
            .then(data => {
                if (data.feed && data.feed.length > 0) {
                    data.feed.reverse().forEach(item => addFeedItem(item));
                }
            })
            .catch(() => { });

        // Fetch online count
        fetch('/api/online')
            .then(r => r.ok ? r.json() : { count: 0 })
            .then(data => {
                const el = document.getElementById('ppz-online-count');
                if (el) el.textContent = data.count || 0;
            })
            .catch(() => { });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
