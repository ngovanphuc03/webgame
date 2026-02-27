/**
 * ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Watch Together Client
 *  Server-Relay screen share + Socket.IO video sync
 *  No TURN server needed — streams via server relay
 * ═══════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    // ═══ CONFIG ═══
    const MAX_RECONNECT = 3;
    const REACTIONS = ['🔥', '❤️', '😂', '👏', '🎉', '😮'];
    const SYNC_THRESHOLD = 2; // seconds drift before force-sync
    const STREAM_INTERVAL = 100; // ms between stream chunks (10fps ~= good quality, low bandwidth)
    const STREAM_QUALITY = 0.6; // JPEG quality (0-1), lower = less bandwidth

    // ═══ STATE ═══
    let socket = null;
    let roomId = null;
    let isHost = false;
    let userId = null;
    let username = 'Khách';
    let avatar = '';
    let members = [];
    let localStream = null;  // screen share stream
    let isSharing = false;
    let isTheaterMode = false;
    let isSidebarOpen = true;
    let hlsInstance = null;
    let syncInterval = null;
    let toastTimer = null;
    let streamCanvas = null;
    let streamCtx = null;
    let streamTimer = null;
    let streamVideo = null; // hidden video element for capturing frames

    // ═══ DOM REFS ═══
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    // ═══ INIT ═══
    function init() {
        socket = io({ maxHttpBufferSize: 5e6 }); // 5MB buffer for stream chunks
        bindSocketEvents();
        bindUIEvents();
        fetchUserInfo();
        checkUrlRoomParam();
    }

    async function fetchUserInfo() {
        try {
            const res = await fetch('/api/me');
            if (res.ok) {
                const u = await res.json();
                userId = u.user_id;
                username = u.username || 'Khách';
                avatar = u.avatar || '/images/ui/default-avatar.svg';
                const balEl = $('#wt-balance');
                if (balEl) balEl.textContent = Number(u.balance || 0).toLocaleString() + ' $';
            }
        } catch (e) { console.warn('Auth fetch failed:', e); }
    }

    function checkUrlRoomParam() {
        const params = new URLSearchParams(location.search);
        const r = params.get('room');
        if (r) {
            const inp = $('#join-room-input');
            if (inp) inp.value = r.toUpperCase();
        }
    }

    // ═══ SOCKET EVENTS ═══
    function bindSocketEvents() {
        socket.on('connect', () => {
            socket.emit('page_visit', { page: 'watch' });
        });

        // Room created
        socket.on('wt_room_created', (data) => {
            roomId = data.roomId;
            isHost = true;
            showCinema();
            updateRoomBadge();
            showToast('Đã tạo phòng ' + roomId, 'success');
            addSystemChat('Bạn đã tạo phòng. Chia sẻ mã phòng cho bạn bè!');
        });

        // Joined room
        socket.on('wt_joined', (data) => {
            roomId = data.roomId;
            isHost = data.isHost;
            showCinema();
            updateRoomBadge();
            showToast('Đã vào phòng ' + roomId, 'success');
            if (data.videoUrl) {
                $('#wt-url-input').value = data.videoUrl;
                loadVideo(data.videoUrl, false);
            }
        });

        // Error
        socket.on('wt_error', (data) => {
            showToast(data.msg || 'Lỗi!', 'error');
        });

        // Members update
        socket.on('wt_members', (data) => {
            members = data.members || [];
            isHost = data.hostId === socket.id;
            renderMembers();
            updateHostUI();
        });

        // Video URL set by host
        socket.on('wt_video_url', (data) => {
            if (!isHost) {
                $('#wt-url-input').value = data.url;
                loadVideo(data.url, false);
                showToast('Host đã đổi video', 'info');
            }
        });

        // Sync play/pause/seek from host
        socket.on('wt_sync', (data) => {
            if (isHost) return;
            const video = $('#wt-video');
            if (!video || !video.src) return;
            if (data.action === 'play') {
                if (Math.abs(video.currentTime - data.time) > SYNC_THRESHOLD) {
                    video.currentTime = data.time;
                }
                video.play().catch(() => { });
            } else if (data.action === 'pause') {
                video.pause();
                video.currentTime = data.time;
            } else if (data.action === 'seek') {
                video.currentTime = data.time;
            } else if (data.action === 'timeupdate') {
                if (Math.abs(video.currentTime - data.time) > SYNC_THRESHOLD) {
                    video.currentTime = data.time;
                }
            }
        });

        // Chat
        socket.on('wt_chat', (data) => {
            addChatMessage(data.username, data.text, data.ts);
        });

        // Reaction
        socket.on('wt_reaction', (data) => {
            spawnReaction(data.emoji);
        });

        // Host migration
        socket.on('wt_host_migrate', (data) => {
            isHost = data.newHostId === socket.id;
            updateHostUI();
            if (isHost) {
                showToast('Bạn là Host mới!', 'info');
                addSystemChat('Bạn đã trở thành Host của phòng.');
                startSyncInterval();
            } else {
                addSystemChat(data.newHostName + ' là Host mới.');
                stopSyncInterval();
            }
        });

        // ═══ SERVER-RELAY SCREEN SHARE ═══
        // Receive stream frame from host (via server relay)
        socket.on('wt_stream_frame', (frameData) => {
            if (isHost) return; // Host sees their own stream directly
            displayStreamFrame(frameData);
        });

        // Host started sharing
        socket.on('wt_screen_started', () => {
            if (!isHost) {
                showToast('Host đang chia sẻ màn hình', 'info');
                hidePlaceholder();
            }
        });

        // Host stopped sharing
        socket.on('wt_screen_stopped', () => {
            if (!isHost) {
                const video = $('#wt-video');
                const img = $('#wt-stream-img');
                if (video) { video.srcObject = null; video.src = ''; video.style.display = ''; }
                if (img) { img.style.display = 'none'; img.src = ''; }
                showPlaceholder();
                showToast('Host đã dừng chia sẻ', 'info');
            }
        });
    }

    // ═══ UI EVENTS ═══
    function bindUIEvents() {
        // Create room
        $('#btn-create-room')?.addEventListener('click', () => {
            const pw = $('#create-pw-input')?.value?.trim() || '';
            socket.emit('wt_create', { password: pw, username, avatar });
        });

        // Join room
        $('#btn-join-room')?.addEventListener('click', () => {
            const code = $('#join-room-input')?.value?.trim().toUpperCase();
            const pw = $('#join-pw-input')?.value?.trim() || '';
            if (!code || code.length < 4) {
                showToast('Nhập mã phòng hợp lệ!', 'error');
                return;
            }
            socket.emit('wt_join', { roomId: code, password: pw, username, avatar });
        });

        $('#join-room-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') $('#btn-join-room')?.click();
        });

        // Load video URL
        $('#btn-load-url')?.addEventListener('click', () => {
            if (!isHost) { showToast('Chỉ Host mới được đổi video!', 'error'); return; }
            const url = $('#wt-url-input')?.value?.trim();
            if (!url) { showToast('Nhập URL video!', 'error'); return; }
            loadVideo(url, true);
            socket.emit('wt_video_url', { url });
        });

        $('#wt-url-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') $('#btn-load-url')?.click();
        });

        // Screen share
        $('#btn-screen-share')?.addEventListener('click', toggleScreenShare);

        // Video controls
        $('#btn-play-pause')?.addEventListener('click', togglePlayPause);
        $('#btn-fullscreen')?.addEventListener('click', toggleFullscreen);
        $('#btn-theater')?.addEventListener('click', toggleTheater);
        $('#btn-pip')?.addEventListener('click', togglePiP);

        // Seek bar
        $('#wt-seek')?.addEventListener('input', (e) => {
            const video = $('#wt-video');
            if (!video || !video.duration) return;
            video.currentTime = (e.target.value / 1000) * video.duration;
            if (isHost) socket.emit('wt_sync', { action: 'seek', time: video.currentTime });
        });

        // Volume
        $('#wt-volume')?.addEventListener('input', (e) => {
            const video = $('#wt-video');
            if (video) video.volume = e.target.value / 100;
        });

        // Volume icon toggle mute
        $('#btn-volume')?.addEventListener('click', () => {
            const video = $('#wt-video');
            if (!video) return;
            video.muted = !video.muted;
            $('#btn-volume').textContent = video.muted ? '🔇' : '🔊';
        });

        // Video events
        const video = $('#wt-video');
        if (video) {
            video.addEventListener('timeupdate', () => {
                if (!video.duration) return;
                const pct = (video.currentTime / video.duration) * 1000;
                const seek = $('#wt-seek');
                if (seek && !seek._dragging) seek.value = pct;
                $('#wt-time-display').textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
            });

            video.addEventListener('play', () => {
                $('#btn-play-pause').textContent = '⏸';
                if (isHost) socket.emit('wt_sync', { action: 'play', time: video.currentTime });
            });

            video.addEventListener('pause', () => {
                $('#btn-play-pause').textContent = '▶';
                if (isHost) socket.emit('wt_sync', { action: 'pause', time: video.currentTime });
            });

            video.addEventListener('ended', () => {
                $('#btn-play-pause').textContent = '▶';
            });

            const seek = $('#wt-seek');
            if (seek) {
                seek.addEventListener('mousedown', () => seek._dragging = true);
                seek.addEventListener('mouseup', () => seek._dragging = false);
                seek.addEventListener('touchstart', () => seek._dragging = true);
                seek.addEventListener('touchend', () => seek._dragging = false);
            }
        }

        // Sidebar tabs
        $$('.wt-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.wt-tab').forEach(t => t.classList.remove('active'));
                $$('.wt-tab-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = $('#panel-' + tab.dataset.panel);
                if (panel) panel.classList.add('active');
            });
        });

        // Chat send
        $('#btn-chat-send')?.addEventListener('click', sendChat);
        $('#wt-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChat();
            }
        });

        // Reactions
        $$('.wt-reaction-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.dataset.emoji;
                socket.emit('wt_reaction', { emoji });
                spawnReaction(emoji);
            });
        });

        // Sidebar toggle
        $('#btn-sidebar-toggle')?.addEventListener('click', () => {
            const sidebar = $('.wt-sidebar');
            if (sidebar) {
                isSidebarOpen = !isSidebarOpen;
                sidebar.classList.toggle('open', isSidebarOpen);
            }
        });

        // Room badge click = copy
        document.addEventListener('click', (e) => {
            if (e.target.closest('.wt-room-badge')) {
                copyRoomCode();
            }
        });

        // Leave room
        $('#btn-leave-room')?.addEventListener('click', () => {
            if (confirm('Rời phòng xem phim?')) {
                socket.emit('wt_leave');
                location.reload();
            }
        });
    }

    // ═══ ROOM UI ═══
    function showCinema() {
        const lobby = $('.wt-lobby');
        if (lobby) lobby.style.display = 'none';
        const main = $('.wt-main');
        if (main) main.style.display = 'grid';
    }

    function updateRoomBadge() {
        $$('.room-code-text').forEach(el => el.textContent = roomId);
        $$('.wt-room-badge').forEach(el => el.style.display = '');
    }

    function updateHostUI() {
        const hostEls = $$('.host-only');
        hostEls.forEach(el => {
            el.style.display = isHost ? '' : 'none';
        });
        const urlInput = $('#wt-url-input');
        if (urlInput) {
            urlInput.disabled = !isHost;
            urlInput.placeholder = isHost ? 'Nhập URL video (mp4, webm, m3u8)...' : 'Chỉ Host mới được đổi video';
        }
    }

    function copyRoomCode() {
        if (!roomId) return;
        const url = location.origin + '/watch?room=' + roomId;
        navigator.clipboard.writeText(url).then(() => {
            showToast('Đã copy link phòng!', 'success');
        }).catch(() => {
            const inp = document.createElement('input');
            inp.value = url;
            document.body.appendChild(inp);
            inp.select();
            document.execCommand('copy');
            document.body.removeChild(inp);
            showToast('Đã copy link phòng!', 'success');
        });
    }

    // ═══ VIDEO ═══
    function loadVideo(url, broadcast) {
        const video = $('#wt-video');
        if (!video) return;

        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
        video.srcObject = null;
        video.style.display = '';
        const img = $('#wt-stream-img');
        if (img) img.style.display = 'none';

        if (!url) return;
        hidePlaceholder();

        if (url.includes('.m3u8')) {
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60
                });
                hlsInstance.loadSource(url);
                hlsInstance.attachMedia(video);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (isHost) video.play().catch(() => { });
                });
                hlsInstance.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) showToast('Lỗi phát HLS stream!', 'error');
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                if (isHost) video.play().catch(() => { });
            } else {
                showToast('Trình duyệt không hỗ trợ HLS!', 'error');
            }
        } else {
            video.src = url;
            video.load();
            if (isHost) {
                video.addEventListener('canplay', () => video.play().catch(() => { }), { once: true });
            }
        }
    }

    function togglePlayPause() {
        const video = $('#wt-video');
        if (!video) return;
        if (!isHost) { showToast('Chỉ Host điều khiển!', 'error'); return; }
        if (video.paused) video.play().catch(() => { });
        else video.pause();
    }

    function toggleFullscreen() {
        const area = $('.wt-video-area');
        if (!area) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else area.requestFullscreen().catch(() => { });
    }

    function togglePiP() {
        const video = $('#wt-video');
        if (!video) return;
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => { });
        else video.requestPictureInPicture().catch(() => showToast('PiP không hỗ trợ', 'error'));
    }

    function toggleTheater() {
        const main = $('.wt-main');
        if (!main) return;
        isTheaterMode = !isTheaterMode;
        main.classList.toggle('theater-mode', isTheaterMode);
        if (isTheaterMode) {
            const sidebar = $('.wt-sidebar');
            if (sidebar) sidebar.classList.remove('open');
            isSidebarOpen = false;
        }
        const btn = $('#btn-theater');
        if (btn) btn.textContent = isTheaterMode ? '🖥' : '🎭';
    }

    function showPlaceholder() {
        const ph = $('.wt-video-placeholder');
        if (ph) ph.style.display = 'flex';
    }

    function hidePlaceholder() {
        const ph = $('.wt-video-placeholder');
        if (ph) ph.style.display = 'none';
    }

    function formatTime(s) {
        if (isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
    }

    // ═══ SYNC INTERVAL (host only) ═══
    function startSyncInterval() {
        stopSyncInterval();
        syncInterval = setInterval(() => {
            const video = $('#wt-video');
            if (!video || video.paused || !video.duration) return;
            socket.emit('wt_sync', { action: 'timeupdate', time: video.currentTime });
        }, 3000);
    }

    function stopSyncInterval() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }

    // ═══ SERVER-RELAY SCREEN SHARE ═══
    // Instead of WebRTC P2P which requires TURN servers for cross-network,
    // we capture frames → JPEG → send to server → broadcast to viewers.
    // This works across ALL networks with zero extra infrastructure.

    async function toggleScreenShare() {
        if (isSharing) stopScreenShare();
        else await startScreenShare();
    }

    async function startScreenShare() {
        if (!isHost) {
            showToast('Chỉ Host chia sẻ màn hình!', 'error');
            return;
        }

        try {
            localStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 15, max: 30 }
                },
                audio: true
            });

            // Show on host's own video element
            const video = $('#wt-video');
            if (video) {
                video.srcObject = localStream;
                video.muted = true; // Mute self to avoid echo
                video.style.display = '';
                video.play().catch(() => { });
            }

            // Hide stream image (used for relay), show video element for host
            const img = $('#wt-stream-img');
            if (img) img.style.display = 'none';

            hidePlaceholder();
            isSharing = true;

            const btn = $('#btn-screen-share');
            if (btn) { btn.classList.add('active'); btn.textContent = '🔴'; }
            const btnTop = $('#btn-share-top');
            if (btnTop) { btnTop.textContent = 'DỪNG CHIA SẺ'; btnTop.classList.add('sharing'); }

            // Notify server & viewers
            socket.emit('wt_screen_started');
            showToast('Đang chia sẻ màn hình qua Server Relay', 'success');

            // Start capturing frames and sending to server
            startStreamRelay();

            // Handle browser's native "Stop sharing" button
            localStream.getVideoTracks()[0].addEventListener('ended', () => {
                stopScreenShare();
            });

        } catch (err) {
            if (err.name === 'NotAllowedError') {
                showToast('Đã hủy chia sẻ màn hình', 'info');
            } else {
                showToast('Lỗi chia sẻ: ' + err.message, 'error');
            }
        }
    }

    function stopScreenShare() {
        stopStreamRelay();

        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        isSharing = false;
        const btn = $('#btn-screen-share');
        if (btn) { btn.classList.remove('active'); btn.textContent = '📺'; }
        const btnTop = $('#btn-share-top');
        if (btnTop) { btnTop.textContent = 'CHIA SẺ MÀN HÌNH'; btnTop.classList.remove('sharing'); }

        const video = $('#wt-video');
        if (video) { video.srcObject = null; video.muted = false; }
        showPlaceholder();

        socket.emit('wt_screen_stopped');
    }

    // ═══ FRAME CAPTURE & RELAY ═══
    function startStreamRelay() {
        // Create hidden video + canvas for frame capture
        if (!streamVideo) {
            streamVideo = document.createElement('video');
            streamVideo.muted = true;
            streamVideo.playsInline = true;
        }
        streamVideo.srcObject = localStream;
        streamVideo.play().catch(() => { });

        if (!streamCanvas) {
            streamCanvas = document.createElement('canvas');
            streamCtx = streamCanvas.getContext('2d');
        }

        // Wait for video to be ready, then start capturing
        streamVideo.addEventListener('loadedmetadata', () => {
            // Scale down for bandwidth efficiency (max 1280x720)
            const vw = streamVideo.videoWidth;
            const vh = streamVideo.videoHeight;
            const scale = Math.min(1, 1280 / vw, 720 / vh);
            streamCanvas.width = Math.round(vw * scale);
            streamCanvas.height = Math.round(vh * scale);

            console.log(`[Relay] Streaming at ${streamCanvas.width}x${streamCanvas.height}`);

            // Start frame loop
            captureAndSend();
        }, { once: true });
    }

    function captureAndSend() {
        if (!isSharing || !localStream || !streamVideo) return;

        streamCtx.drawImage(streamVideo, 0, 0, streamCanvas.width, streamCanvas.height);

        // Convert to JPEG data URL (much smaller than PNG)
        const frameData = streamCanvas.toDataURL('image/jpeg', STREAM_QUALITY);

        // Send to server for relay to all viewers
        socket.volatile.emit('wt_stream_frame', frameData);

        // Schedule next frame
        streamTimer = setTimeout(captureAndSend, STREAM_INTERVAL);
    }

    function stopStreamRelay() {
        if (streamTimer) {
            clearTimeout(streamTimer);
            streamTimer = null;
        }
        if (streamVideo) {
            streamVideo.pause();
            streamVideo.srcObject = null;
        }
    }

    // ═══ DISPLAY RECEIVED STREAM (viewer side) ═══
    function displayStreamFrame(frameData) {
        const video = $('#wt-video');
        const img = $('#wt-stream-img');
        if (!img) return;

        // Hide video element, show image element for relay stream
        if (video) video.style.display = 'none';
        img.style.display = 'block';
        img.src = frameData;
        hidePlaceholder();
    }

    // ═══ CHAT ═══
    function sendChat() {
        const inp = $('#wt-chat-input');
        if (!inp) return;
        const text = inp.value.trim();
        if (!text) return;
        inp.value = '';
        socket.emit('wt_chat', { text });
    }

    function addChatMessage(name, text, ts) {
        const container = $('#wt-chat-messages');
        if (!container) return;
        const msg = document.createElement('div');
        msg.className = 'wt-chat-msg';
        const time = ts ? new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
        msg.innerHTML = `
            <div class="wt-chat-msg-header">
                <span class="wt-chat-msg-name">${escapeHtml(name)}</span>
                <span class="wt-chat-msg-time">${time}</span>
            </div>
            <div class="wt-chat-msg-text">${escapeHtml(text)}</div>
        `;
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }

    function addSystemChat(text) {
        const container = $('#wt-chat-messages');
        if (!container) return;
        const msg = document.createElement('div');
        msg.className = 'wt-chat-msg system';
        msg.innerHTML = `<div class="wt-chat-msg-text">${escapeHtml(text)}</div>`;
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }

    // ═══ MEMBERS ═══
    function renderMembers() {
        const list = $('#wt-members-list');
        if (!list) return;
        list.innerHTML = '';
        for (const m of members) {
            const el = document.createElement('div');
            el.className = 'wt-member';
            const roleClass = m.isHost ? 'host' : '';
            const roleText = m.isHost ? '👑 HOST' : 'Viewer';
            el.innerHTML = `
                <img class="wt-member-avatar" src="${m.avatar || '/images/ui/default-avatar.svg'}" alt="" onerror="this.src='/images/ui/default-avatar.svg'">
                <div class="wt-member-info">
                    <div class="wt-member-name">${escapeHtml(m.username)}</div>
                    <div class="wt-member-role ${roleClass}">${roleText}</div>
                </div>
            `;
            list.appendChild(el);
        }
        $$('.member-count').forEach(el => el.textContent = members.length);
    }

    // ═══ REACTIONS ═══
    function spawnReaction(emoji) {
        const wrapper = $('.wt-video-wrapper');
        if (!wrapper) return;
        const el = document.createElement('div');
        el.className = 'wt-reaction-float';
        el.textContent = emoji;
        el.style.left = (20 + Math.random() * 60) + '%';
        el.style.bottom = '10%';
        wrapper.appendChild(el);
        setTimeout(() => el.remove(), 2200);
    }

    // ═══ HELPERS ═══
    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function showToast(msg, type = 'info') {
        let toast = $('#wt-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'wt-toast';
            toast.className = 'wt-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.className = 'wt-toast ' + type + ' show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ═══ BOOT ═══
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
