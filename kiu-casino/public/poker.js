// ====================================================================
// POKER CLIENT - OPTIMIZED FOR ZERO LAG
// ====================================================================

const socket = io();

const state = {
    myId: null,
    tableData: null,
    soundEnabled: true,
    animationsEnabled: true,
    lastUpdate: 0,
    updateThrottle: 50,
    playerHands: {}, // Track previous hands to detect new deals
    isProcessing: false // Lock actions while processing
};

// Preload sounds for instant playback
const SFX = {
    deal: new Audio('/sounds/poker/deal.mp3'),
    chip: new Audio('/sounds/poker/chip_place.mp3'),
    check: new Audio('/sounds/poker/check.mp3'),
    fold: new Audio('/sounds/poker/card_flip.mp3'),
    win: new Audio('/sounds/poker/shuffle.mp3'),
    call: new Audio('/sounds/poker/chip_stack.mp3'),
    raise: new Audio('/sounds/poker/chip_heavy.mp3'),
    timer: new Audio('/sounds/poker/tick.mp3')
};

// Preload all sounds
Object.values(SFX).forEach(audio => {
    audio.load();
    audio.volume = 0.6;
});

function playSound(key) {
    if (!state.soundEnabled || !SFX[key]) return;
    try {
        const audio = SFX[key].cloneNode(); // Clone for simultaneous plays
        audio.volume = 0.6;
        audio.play().catch(() => { });
    } catch (e) { }
}

// CONNECTION
const params = new URLSearchParams(window.location.search);
const buyIn = params.get('buyin') || 5000;

socket.emit('pk_join', { tableId: 'vip_table', buyIn: buyIn });

// EVENT LISTENERS
socket.on('pk_update', handleGameUpdate);
socket.on('pk_update_quick', handleQuickUpdate); // New: instant updates
socket.on('pk_win', handleWin);
socket.on('pk_showdown', handleShowdown);
socket.on('pk_chat', handleChatMessage);
socket.on('pk_error', e => showToast(e.message, 'error'));

// THROTTLED UPDATE HANDLER
function handleGameUpdate(data) {
    const now = Date.now();
    if (now - state.lastUpdate < state.updateThrottle) return;
    state.lastUpdate = now;

    if (data.me) state.myId = data.me;
    state.tableData = data;

    // ✅ UNLOCK processing khi nhận update từ server
    state.isProcessing = false;

    requestAnimationFrame(() => {
        renderTable(data);
        renderSeats(data);
        renderControls(data);
        renderPot(data);
        renderCommunityCards(data);

        if (data.currentTurn && data.currentTurn === state.myId) {
            startTimerAnimation();
        }
    });
}

// QUICK UPDATE (no animations)
function handleQuickUpdate(data) {
    if (data.me) state.myId = data.me;
    state.tableData = data;

    // Update only changed elements
    document.getElementById('pot-amount').textContent = `$${data.pot || 0}`;

    // Update player chips/status without re-rendering everything
    data.players.forEach((p, i) => {
        if (!p) return;
        const existing = document.querySelector(`[data-player-id="${p.id}"]`);
        if (existing) {
            const chipsEl = existing.querySelector('.p-chips');
            if (chipsEl) chipsEl.textContent = `$${p.chips}`;
        }
    });
}

function renderTable(data) {
    const elName = document.getElementById('table-name');
    if (elName) elName.textContent = data.name || 'Sòng Bài VIP';

    const elHand = document.getElementById('hand-number');
    if (elHand) elHand.textContent = `Ván #${data.handNumber || 0}`;

    // ✅ Display Blinds
    const elBlinds = document.getElementById('table-blinds');
    if (elBlinds && data.bigBlind) {
        elBlinds.textContent = `Cược: $${data.bigBlind / 2}/$${data.bigBlind}`;
    }

    const elState = document.getElementById('game-state');
    if (elState) elState.textContent = data.state;
}

function renderPot(data) {
    const totalPot = data.pots?.reduce((sum, p) => sum + p.amount, 0) || data.pot || 0;
    const potEl = document.getElementById('pot-amount');

    // Smooth pot animation
    if (potEl) {
        const current = parseInt(potEl.textContent.replace('$', '')) || 0;
        if (totalPot !== current && window.gsap) {
            gsap.to({ val: current }, {
                val: totalPot,
                duration: 0.3,
                ease: 'power2.out',
                onUpdate: function () {
                    potEl.textContent = `$${Math.floor(this.targets()[0].val)}`;
                }
            });
        } else {
            potEl.textContent = `$${totalPot}`;
        }
    }

    const sidePotsDiv = document.getElementById('side-pots');
    if (sidePotsDiv) {
        if (data.pots && data.pots.length > 1) {
            sidePotsDiv.innerHTML = data.pots.map((pot, i) =>
                `<div class="side-pot">Hũ ${i + 1}: $${pot.amount}</div>`
            ).join('');
            sidePotsDiv.style.display = 'block';
        } else {
            sidePotsDiv.style.display = 'none';
        }
    }
}

function renderCommunityCards(data) {
    const container = document.getElementById('community-cards');
    const currentCount = container.children.length;

    if (data.communityCards.length > currentCount) {
        // New cards - stagger animation
        for (let i = currentCount; i < data.communityCards.length; i++) {
            const card = createCard(data.communityCards[i]);
            container.appendChild(card);

            playSound('deal');

            if (window.gsap && state.animationsEnabled) {
                gsap.from(card, {
                    y: -200,
                    x: Math.random() * 100 - 50,
                    opacity: 0,
                    scale: 1.5,
                    rotation: 720,
                    duration: 0.5,
                    delay: (i - currentCount) * 0.1, // Faster stagger
                    ease: 'back.out(1.2)'
                });
            }
        }
    } else if (data.communityCards.length === 0) {
        container.innerHTML = '';
    }
}

function renderSeats(data) {
    const container = document.getElementById('seats-area');
    if (!container) return; // Fix for null error

    const me = data.players.find(p => p && p.id === state.myId);
    const mySeat = me ? me.seat : 0;

    data.players.forEach((p, i) => {
        if (!p) {
            const existing = container.querySelector(`[data-seat="${i}"]`);
            if (existing) existing.remove();
            delete state.playerHands[i];
            return;
        }

        const maxPlayers = data.maxPlayers || 9;
        const visualPos = (i - mySeat + maxPlayers) % maxPlayers;
        let seatEl = container.querySelector(`[data-seat="${i}"]`);

        // Check for new deal
        const prevHand = state.playerHands[p.id] || [];
        const currentHand = p.hand || [];
        // Detect if cards appeared (e.g. hand length went from 0 to 2)
        const isNewDeal = (prevHand.length === 0 && currentHand.length > 0) ||
            (p.status === 'PLAYING' && prevHand.length === 0 && currentHand.length > 0);
        state.playerHands[p.id] = currentHand;

        if (!seatEl) {
            seatEl = createSeatElement(p, data, visualPos);
            container.appendChild(seatEl);
            if (window.gsap && state.animationsEnabled) {
                gsap.from(seatEl, { opacity: 0, scale: 0.8, duration: 0.3, ease: 'back.out(1.7)' });
            }
        } else {
            updateSeatElement(seatEl, p, data, visualPos);
        }

        // Animate Cards if New Deal
        if (isNewDeal && state.animationsEnabled && window.gsap) {
            const cards = seatEl.querySelectorAll('.mini-card');
            if (cards.length > 0) {
                const rect = seatEl.getBoundingClientRect();
                const centerX = window.innerWidth / 2;
                const centerY = window.innerHeight / 2;
                const seatX = rect.left + rect.width / 2;
                const seatY = rect.top + rect.height / 2;

                gsap.from(cards, {
                    x: centerX - seatX,
                    y: centerY - seatY,
                    scale: 0.1,
                    opacity: 0,
                    rotation: 180,
                    duration: 0.6,
                    stagger: 0.1,
                    ease: 'power3.out'
                });
                playSound('deal');
            }
        }
    });
}

function createSeatElement(player, data, visualPos) {
    const el = document.createElement('div');
    el.className = `seat ${player.id === data.currentTurn ? 'active' : ''}`;
    el.setAttribute('data-pos', visualPos);
    el.setAttribute('data-seat', player.seat);
    el.setAttribute('data-player-id', player.id);

    el.innerHTML = buildSeatHTML(player, data);
    return el;
}

function updateSeatElement(el, player, data, visualPos) {
    // Update class
    el.className = `seat ${player.id === data.currentTurn ? 'active' : ''}`;
    el.setAttribute('data-pos', visualPos);

    // Update content
    el.innerHTML = buildSeatHTML(player, data);
}

function buildSeatHTML(player, data) {
    let dealerBtn = '';
    if (data.dealerSeat === player.seat) {
        dealerBtn = '<div class="dealer-btn">D</div>';
    }

    let cardsHtml = '';
    if (['PLAYING', 'ALLIN'].includes(player.status)) {
        const showFace = (player.id === state.myId) || data.state === 'SHOWDOWN';
        const handData = (showFace && data.myHand) ? data.myHand : (player.hand || ['back', 'back']);
        const hand = (handData.length > 0) ? handData : ['back', 'back'];

        cardsHtml = `
            <div class="hole-cards">
                ${hand.map(c => `<div class="mini-card" style="background-image:${getCardBg(c)}"></div>`).join('')}
            </div>
        `;
    }

    let timerRing = '';
    if (player.id === data.currentTurn && player.status === 'PLAYING') {
        timerRing = '<div class="turn-timer-ring"></div>';
    }

    let autoActionHtml = '';
    if (player.autoAction) {
        autoActionHtml = `<div class="auto-action-indicator">${player.autoAction.replace('_', ' ')}</div>`;
    }

    return `
        ${cardsHtml}
        ${dealerBtn}
        <div class="avatar-wrapper">
            <img class="avatar-img" src="${player.avatar || `https://ui-avatars.com/api/?name=${player.name}`}">
            ${timerRing}
            ${player.status === 'SITTING_OUT' ? '<div class="sit-out-badge">Đang Rời</div>' : ''}
        </div>
        <div class="player-label ${player.connected === false ? 'disconnected' : ''}">
            <div class="p-name">${player.name}</div>
            <div class="p-chips">$${player.chips}</div>
            ${player.handsWon > 0 ? `<div class="p-stats">${player.handsWon} thắng</div>` : ''}
        </div>
        ${player.bet > 0 ? `<div class="bet-chip">🪙 $${player.bet}</div>` : ''}
        ${player.lastAction ? `<div class="action-bubble">${player.lastAction}</div>` : ''}
        ${autoActionHtml}
    `;
}

function renderControls(data) {
    const bar = document.getElementById('controls-bar');
    const me = data.players.find(p => p && p.id === state.myId);

    if (!me) {
        bar.classList.add('hidden');
        return;
    }

    if (me.id === data.currentTurn && me.status === 'PLAYING') {
        bar.classList.remove('hidden');
        // Unlock buttons ONLY if not processing
        if (!state.isProcessing) {
            const buttons = bar.querySelectorAll('.btn-game');
            buttons.forEach(b => b.disabled = false);
            updateControlButtons(data, me);
        }
    } else {
        bar.classList.add('hidden');
        showQuickActions(me);
    }
}

function updateControlButtons(data, me) {
    const currentBet = data.currentBet || 0;
    const toCall = currentBet - me.bet;

    const btnCheckCall = document.getElementById('btn-check-call');
    if (btnCheckCall) {
        if (toCall > 0) {
            if (me.chips <= toCall) {
                // ✅ Không đủ tiền -> All-in
                btnCheckCall.textContent = `TẤT TAY $${me.chips}`;
                btnCheckCall.className = 'btn-game btn-allin';
            } else {
                btnCheckCall.textContent = `THEO $${toCall}`;
                btnCheckCall.className = 'btn-game btn-call';
            }
            btnCheckCall.onclick = () => doAction('call');
        } else {
            btnCheckCall.textContent = 'XEM';
            btnCheckCall.className = 'btn-game btn-check';
            btnCheckCall.onclick = () => doAction('check');
        }
    }

    const slider = document.getElementById('raise-slider');
    if (slider) {
        const bigBlind = data.bigBlind || 20;
        const currentBet = data.currentBet || 0;
        const lastRaise = data.lastRaiseSize || bigBlind;

        // ✅ CÔNG THỨC ĐÚNG
        const minRaise = currentBet + lastRaise;
        const maxRaise = me.chips + me.bet;

        slider.min = minRaise;
        slider.max = maxRaise;
        slider.value = minRaise;
        slider.step = bigBlind; // Sync step with Big Blind
        updateRaiseDisplay(slider.value);
    }

    const btnAllin = document.getElementById('btn-allin');
    if (btnAllin) {
        if (me.chips > 0) {
            btnAllin.style.display = 'block';
            btnAllin.onclick = () => doAction('allin');
        } else {
            btnAllin.style.display = 'none';
        }
    }
}

function showQuickActions(me) {
    const quickBar = document.getElementById('quick-actions');
    if (quickBar) {
        if (!me || me.status === 'FOLDED' || me.status === 'SITTING_OUT') {
            quickBar.classList.add('hidden');
            return;
        }
        quickBar.classList.remove('hidden');
    }
}

function updateRaiseDisplay(val) {
    const b = document.getElementById('raise-bubble');
    if (b) b.textContent = `$${val}`;
    const btn = document.getElementById('btn-raise');
    if (btn) btn.innerHTML = `TỐ<br><small>$${val}</small>`;
}

// ACTIONS - INSTANT RESPONSE
// ACTIONS - INSTANT RESPONSE
function doAction(action, amount) {
    // 0. CHECK PROCESSING LOCK
    if (state.isProcessing) return;

    // 1. ANTI-SPAM: Lock buttons immediately
    const buttons = document.querySelectorAll('.btn-game');
    buttons.forEach(btn => btn.disabled = true);

    if (action === 'raise') {
        const slider = document.getElementById('raise-slider');
        if (slider) {
            amount = parseInt(slider.value);
            const min = parseInt(slider.min);
            const max = parseInt(slider.max);

            // ✅ Client-side validation
            if (amount < min || amount > max) {
                showToast(`Raise phải từ $${min} đến $${max}`, 'error');
                state.isProcessing = false;
                buttons.forEach(btn => btn.disabled = false);
                return;
            }
        }
    }

    // CONFIRM ALL-IN
    if (action === 'allin') {
        const me = state.tableData?.players.find(p => p && p.id === state.myId);
        if (!me) return;

        const allInAmount = me.chips + me.bet;
        if (!confirm(`Bạn có chắc muốn TẤT TAY $${allInAmount} không?`)) {
            // Cancelled: Unlock buttons
            buttons.forEach(btn => btn.disabled = false);
            return;
        }

        action = 'raise';
        amount = allInAmount;
    }

    state.isProcessing = true; // LOCK

    // INSTANT local feedback
    const bar = document.getElementById('controls-bar');
    if (bar) bar.classList.add('hidden');

    // Play sound immediately
    const soundMap = { fold: 'fold', check: 'check', call: 'call', raise: 'raise', allin: 'raise' };
    playSound(soundMap[action] || 'chip');

    // Send to server (don't wait for response)
    socket.emit('pk_action', { action, amount });

    // ✅ Failsafe: Unlock sau 3s nếu server không respond
    setTimeout(() => {
        if (state.isProcessing) {
            console.warn('Action timeout - force unlock');
            state.isProcessing = false;
        }
    }, 3000);
}

function setQuickRaise(factor) {
    const slider = document.getElementById('raise-slider');
    if (!slider) return;

    if (factor === 999) {
        slider.value = parseInt(slider.max);
        updateRaiseDisplay(slider.value);
        return;
    }

    const pot = state.tableData?.pot || 0;
    const currentBet = state.tableData?.currentBet || 0;

    // ✅ CÔNG THỨC ĐÚNG: NewBet = CurrentBet + (Pot × Factor)
    let newBet = currentBet + Math.floor(pot * factor);

    // Clamp to slider range
    newBet = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), newBet));

    slider.value = newBet;
    updateRaiseDisplay(newBet);
}

function setAutoAction(action) {
    socket.emit('pk_auto_action', { action });
    showToast(`Đã đặt tự động: ${action ? action.replace('_', ' ') : 'Không'}`, 'info');
}

function toggleSitOut() {
    socket.emit('pk_sit_out');
}

function leaveTable() {
    if (confirm('Bạn có chắc chắn muốn rời bàn không?')) {
        socket.emit('pk_leave');
        window.location.href = '/';
    }
}

// WIN/SHOWDOWN
function handleWin(data) {
    playSound('win');

    const overlay = document.getElementById('win-overlay');
    const details = document.getElementById('win-details');
    if (details) {
        const name = data.winnerName || 'Người Thắng';
        const amt = data.amount || 0;
        details.innerHTML = `
            <div class="winner-name">${name}</div>
            <div class="win-desc">${data.desc || ''}</div>
            <div class="win-amount">+$${amt}</div>
        `;
    }

    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => overlay.classList.remove('active'), 4000);
    }
}

function handleShowdown(data) {
    playSound('win');
    const overlay = document.getElementById('win-overlay');
    const details = document.getElementById('win-details');

    if (data.results && details) {
        const resultsHtml = data.results.map(r => `
            <div class="showdown-result">
                <div class="result-name">${r.playerName}</div>
                <div class="result-hand">${r.handDesc}</div>
                <div class="result-amount">+$${r.amount}</div>
            </div>
        `).join('');
        details.innerHTML = resultsHtml;
    }

    if (overlay) {
        overlay.classList.add('active');
        setTimeout(() => overlay.classList.remove('active'), 6000);
    }
}

// CHAT
function handleChatMessage(msg) {
    const chatBox = document.getElementById('chat-messages');
    if (!chatBox) return;

    const msgDiv = document.createElement('div');
    const isSystem = msg.from === 'system';
    const isMe = msg.from === state.myId;
    msgDiv.className = `chat-msg chat-${isSystem ? 'system' : isMe ? 'me' : 'other'}`;

    const name = isSystem ? 'Hệ Thống' :
        (isMe ? 'Bạn' : (state.tableData?.players.find(p => p && p.id === msg.from)?.name || 'Người Chơi'));

    msgDiv.innerHTML = `
        <span class="chat-name">${name}:</span>
        <span class="chat-text">${escapeHtml(msg.message)}</span>
    `;

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    while (chatBox.children.length > 50) chatBox.removeChild(chatBox.firstChild);
}

function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (msg.length > 0 && msg.length <= 200) {
        socket.emit('pk_chat', { message: msg });
        input.value = '';
    }
}

// UTILITIES
function createCard(code) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.backgroundImage = getCardBg(code);
    return card;
}

function getCardBg(code) {
    if (!code || code === 'back') {
        return `url('/images/poker/cards/back01.png')`;
    }
    const suitMap = { d: 'diamonds', c: 'clubs', h: 'hearts', s: 'spades' };
    const rankMap = { A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: '10', '9': '09', '8': '08', '7': '07', '6': '06', '5': '05', '4': '04', '3': '03', '2': '02' };
    const rank = code.charAt(0);
    const suit = code.charAt(1);
    return `url('/images/poker/cards/${suitMap[suit]}_${rankMap[rank]}.png')`;
}

function startTimerAnimation() {
    setTimeout(() => {
        if (state.tableData?.currentTurn === state.myId) playSound('timer');
    }, 8000); // Warning sound at 8s
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// SETTINGS
function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    const btn = document.getElementById('btn-sound');
    if (btn) btn.textContent = state.soundEnabled ? '🔊' : '🔇';
    localStorage.setItem('poker_sound', state.soundEnabled);
}

function toggleAnimations() {
    state.animationsEnabled = !state.animationsEnabled;
    document.body.classList.toggle('no-animations', !state.animationsEnabled);
    localStorage.setItem('poker_animations', state.animationsEnabled);
}

// INIT
window.addEventListener('DOMContentLoaded', () => {
    state.soundEnabled = localStorage.getItem('poker_sound') !== 'false';
    state.animationsEnabled = localStorage.getItem('poker_animations') !== 'false';

    const btnS = document.getElementById('btn-sound');
    if (btnS) btnS.textContent = state.soundEnabled ? '🔊' : '🔇';
    if (!state.animationsEnabled) document.body.classList.add('no-animations');

    const inp = document.getElementById('chat-input');
    if (inp) inp.addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

});
