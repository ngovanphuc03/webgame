/* ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Global Chat System
 *  Include on every page: <script src="/js/chat-system.js"></script>
 *  Requires Socket.IO to be loaded
 *  Only renders UI when logged in (has user_info cookie)
 * ═══════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function isLoggedIn() {
        return document.cookie.split(';').some(c => c.trim().startsWith('user_info='));
    }

    const MAX_MESSAGES = 100;
    const EMOJIS = ['😀', '😂', '🤣', '😎', '🤩', '🥳', '😱', '🤯', '💀', '👻', '🔥', '💰', '🎰', '🎲', '🃏', '💎', '🚀', '💣', '🏆', '👑', '❤️', '💜', '✅', '❌', '⭐', '🎯', '🎁', '🍀'];
    let socket = null;
    let chatOpen = false;
    let unreadCount = 0;
    let myUsername = 'Khách';
    let myAvatar = '';

    try {
        const cookies = document.cookie.split(';').reduce((acc, c) => {
            const [k, v] = c.trim().split('=');
            acc[k] = v ? decodeURIComponent(v) : '';
            return acc;
        }, {});
        if (cookies.user_info) {
            const raw = cookies.user_info;
            const data = JSON.parse(raw.startsWith('j:') ? raw.slice(2) : raw);
            myUsername = decodeURIComponent(data.username || myUsername);
            myAvatar = data.avatar || '';
        }
    } catch (e) { }

    function initChat() {
        if (!isLoggedIn()) return;
        if (document.getElementById('ppz-chat-panel')) return;

        const toolbar = document.getElementById('ppz-toolbar');
        if (!toolbar) {
            // Toolbar not yet created (async checkAuth on index.html) — retry up to 3s
            if (!initChat._retries) initChat._retries = 0;
            if (initChat._retries++ < 30) {
                setTimeout(initChat, 100);
            }
            return;
        }

        // Connect socket
        if (typeof io !== 'undefined') {
            socket = io();
            socket.emit('chat_join');

            socket.on('chat_message', (msg) => {
                addMessage(msg);
                if (!chatOpen) {
                    unreadCount++;
                    updateBadge();
                }
            });

            socket.on('chat_history', (messages) => {
                const list = document.getElementById('ppz-chat-messages');
                if (list) {
                    list.innerHTML = '';
                    messages.forEach(m => addMessage(m, true));
                    list.scrollTop = list.scrollHeight;
                }
            });

            socket.on('chat_system', (msg) => {
                addMessage({ username: '🤖 System', text: msg, system: true, ts: Date.now() });
            });
        }

        // Inject CSS
        const style = document.createElement('style');
        style.textContent = `
            #ppz-chat-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:9px;min-width:16px;height:16px;border-radius:8px;display:none;align-items:center;justify-content:center;font-weight:700;padding:0 3px}
            #ppz-chat-window{position:fixed;top:60px;right:20px;z-index:99999;width:320px;height:420px;background:rgba(3,0,20,.97);backdrop-filter:blur(20px);border:1px solid rgba(139,92,246,.15);border-radius:16px;display:none;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.6);font-family:'DearPix',sans-serif;overflow:hidden}
            #ppz-chat-window.show{display:flex;animation:ppzChatSlide .3s ease}
            @keyframes ppzChatSlide{from{opacity:0;transform:translateY(-10px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}
            .ppz-chat-header{padding:12px 16px;border-bottom:1px solid rgba(139,92,246,.1);display:flex;justify-content:space-between;align-items:center}
            .ppz-chat-header h3{font-size:14px;color:#8b5cf6;margin:0;display:flex;align-items:center;gap:6px}
            .ppz-chat-header .close{background:none;border:none;color:rgba(255,255,255,.4);font-size:18px;cursor:pointer;padding:2px;transition:.3s}
            .ppz-chat-header .close:hover{color:#fff}
            .ppz-chat-messages{flex:1;overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin;scrollbar-color:rgba(139,92,246,.2) transparent}
            .ppz-chat-msg{padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.4;background:rgba(255,255,255,.03);word-wrap:break-word}
            .ppz-chat-msg.system{color:rgba(139,92,246,.6);font-style:italic;background:none;padding:4px 10px;font-size:11px}
            .ppz-chat-msg .name{font-weight:700;color:#06b6d4;font-size:11px;margin-bottom:2px}
            .ppz-chat-msg .text{color:rgba(255,255,255,.8)}
            .ppz-chat-msg .time{font-size:9px;color:rgba(255,255,255,.2);float:right;margin-top:2px}
            .ppz-chat-input-row{display:flex;gap:6px;padding:10px 12px;border-top:1px solid rgba(139,92,246,.1);align-items:center}
            .ppz-chat-input-row input{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(139,92,246,.1);border-radius:20px;padding:8px 14px;color:#fff;font-size:12px;font-family:inherit;outline:none;transition:.3s}
            .ppz-chat-input-row input:focus{border-color:rgba(139,92,246,.4)}
            .ppz-chat-input-row button{width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:.3s}
            .ppz-chat-send{background:rgba(139,92,246,.2);color:#8b5cf6}
            .ppz-chat-send:hover{background:rgba(139,92,246,.4)}
            .ppz-chat-emoji-btn{background:rgba(255,255,255,.05);color:rgba(255,255,255,.5)}
            .ppz-chat-emoji-btn:hover{background:rgba(255,255,255,.1)}
            .ppz-chat-emoji-panel{display:none;padding:8px;border-top:1px solid rgba(139,92,246,.1);flex-wrap:wrap;gap:4px;justify-content:center}
            .ppz-chat-emoji-panel.show{display:flex}
            .ppz-chat-emoji-panel span{cursor:pointer;font-size:18px;padding:4px;border-radius:6px;transition:.2s}
            .ppz-chat-emoji-panel span:hover{background:rgba(255,255,255,.1);transform:scale(1.2)}
            @media (max-width:480px){
                #ppz-chat-window{width:calc(100% - 40px);right:20px;height:50vh}
            }
        `;
        document.head.appendChild(style);

        // Create chat button
        const btn = document.createElement('button');
        btn.id = 'ppz-chat-btn';
        btn.className = 'ppz-tb-btn';
        btn.title = 'Chat';
        btn.innerHTML = '💬<span id="ppz-chat-badge"></span>';

        // Create chat window
        const win = document.createElement('div');
        win.id = 'ppz-chat-window';
        win.innerHTML = `
            <div class="ppz-chat-header">
                <h3>💬 Chat chung</h3>
                <button class="close" onclick="document.getElementById('ppz-chat-window').classList.remove('show');window._ppzChatOpen=false">&times;</button>
            </div>
            <div class="ppz-chat-messages" id="ppz-chat-messages"></div>
            <div class="ppz-chat-emoji-panel" id="ppz-emoji-panel">
                ${EMOJIS.map(e => `<span onclick="document.getElementById('ppz-chat-input').value+='${e}';document.getElementById('ppz-chat-input').focus()">${e}</span>`).join('')}
            </div>
            <div class="ppz-chat-input-row">
                <button class="ppz-chat-emoji-btn" onclick="document.getElementById('ppz-emoji-panel').classList.toggle('show')">😀</button>
                <input type="text" id="ppz-chat-input" placeholder="Nhập tin nhắn..." maxlength="200" autocomplete="off">
                <button class="ppz-chat-send" onclick="window._ppzSendChat()">➤</button>
            </div>`;

        if (toolbar) {
            toolbar.appendChild(btn);
        }
        document.body.appendChild(win);

        // Toggle chat
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            chatOpen = !chatOpen;
            window._ppzChatOpen = chatOpen;
            if (chatOpen) {
                win.classList.add('show');
                unreadCount = 0;
                updateBadge();
                document.getElementById('ppz-chat-input').focus();
                const list = document.getElementById('ppz-chat-messages');
                list.scrollTop = list.scrollHeight;
            } else {
                win.classList.remove('show');
            }
        });

        // Close on outside click
        document.addEventListener('click', e => {
            if (chatOpen && !win.contains(e.target) && !btn.contains(e.target)) {
                chatOpen = false;
                window._ppzChatOpen = false;
                win.classList.remove('show');
            }
        });

        // Send on Enter
        document.getElementById('ppz-chat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); window._ppzSendChat(); }
        });
    }

    window._ppzSendChat = function () {
        const input = document.getElementById('ppz-chat-input');
        const text = (input.value || '').trim();
        if (!text || !socket) return;

        socket.emit('chat_send', { text });
        input.value = '';
        const ep = document.getElementById('ppz-emoji-panel');
        if (ep) ep.classList.remove('show');
    };

    function addMessage(msg, skipScroll) {
        const list = document.getElementById('ppz-chat-messages');
        if (!list) return;

        const el = document.createElement('div');
        el.className = 'ppz-chat-msg' + (msg.system ? ' system' : '');

        if (msg.system) {
            el.textContent = msg.text;
        } else {
            const time = new Date(msg.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            el.innerHTML = `<div class="name">${escHtml(msg.username)}</div><div class="text">${escHtml(msg.text)}<span class="time">${time}</span></div>`;
        }

        list.appendChild(el);

        while (list.children.length > MAX_MESSAGES) {
            list.removeChild(list.firstChild);
        }

        if (!skipScroll) {
            list.scrollTop = list.scrollHeight;
        }
    }

    function updateBadge() {
        const badge = document.getElementById('ppz-chat-badge');
        if (!badge) return;
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // Init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        initChat();
    }
})();
