
const socket = io();
let currentBalance = 0;
let selectedAmount = 1;
let canOpenBowl = false;
let isBettingPhase = false;

// --- SAFE DOM HELPERS (prevents null errors on mobile) ---
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function safeSetHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function safeSetStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

function safeGetElement(id) {
    return document.getElementById(id);
}

// Update total-bet elements preserving the 💵 icon span
function safeSetTotal(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const spans = el.querySelectorAll('span');
    if (spans.length >= 2) {
        spans[1].innerText = formatMoney(value);
    } else {
        el.innerText = formatMoney(value);
    }
}

// --- SOUND MANAGER WITH LAZY LOADING ---
const SoundManager = {
    paths: {
        shaking: 'sounds/shaking.mp3',
        bet: 'sounds/bet.mp3',
        open: 'sounds/open.mp3',
        win: 'sounds/win.mp3',
        lose: 'sounds/lose.mp3',
        bgm: 'sounds/bgm.mp3',
        dice_roll: 'sounds/taixiu/dice_roll.mp3',
        dice_land: 'sounds/taixiu/dice_land.mp3'
    },
    sounds: {},
    initialized: {},

    getSound(name) {
        // Lazy create Audio object on first use
        if (!this.sounds[name] && this.paths[name]) {
            this.sounds[name] = new Audio(this.paths[name]);
            if (name === 'shaking' || name === 'bgm') this.sounds[name].loop = true;
            // Set volumes - BGM at 50%, sound effects at 80%
            if (name === 'bgm') this.sounds[name].volume = 0.5;
            else if (name === 'shaking') this.sounds[name].volume = 0.8;
            else this.sounds[name].volume = 0.8; // bet, open, win, lose
            this.initialized[name] = true;
        }
        return this.sounds[name];
    },

    play(name) {
        // Try SFX engine first
        if (window.SFX && window.SFX.play) {
            try { window.SFX.play(name); return; } catch (e) { }
        }
        // Fallback to mp3
        // Respect global sound settings
        if (window.PPZSound) { const gs = window.PPZSound.getSettings(); if (!gs.sfxOn) return; }
        const sound = this.getSound(name);
        if (sound) {
            const globalVol = window.PPZSound ? window.PPZSound.getSettings().sfxVol : 1;
            const baseVol = name === 'bgm' ? 0.5 : 0.8;
            sound.volume = baseVol * globalVol;
            sound.currentTime = 0;
            sound.play().catch(e => console.log('Sound error:', e));
        }
    },

    stop(name) {
        const sound = this.sounds[name];
        if (sound) {
            sound.pause();
            sound.currentTime = 0;
        }
    }
};


// --- 1. XỬ LÝ SLIDER ---
function handleSliderInput(el) {
    const val = parseInt(el.value);
    const max = parseInt(el.max);
    const min = parseInt(el.min);

    selectedAmount = val;
    document.getElementById('selected-amount-display').innerText = formatMoney(selectedAmount);

    // Tính % để cập nhật thanh vàng
    let percent = 0;
    if (max > min) {
        percent = ((val - min) / (max - min)) * 100;
    } else {
        percent = 100;
    }

    document.getElementById('slider-fill').style.width = percent + "%";

    document.querySelectorAll('.tick').forEach((t, i) => {
        const p = i * 25;
        if (percent >= p - 2 && percent <= p + 2) t.classList.add('active');
        else t.classList.remove('active');
    });

    // Sound effect with throttle to prevent spamming
    // Play sound only if 50ms passed since last play
    const now = Date.now();
    if (!el.lastSoundTime || now - el.lastSoundTime > 50) {
        SoundManager.play('bet');
        el.lastSoundTime = now;
    }
}

// Wrap handleSliderInput to avoid spamming sound too much?
// The user request: "Tiếng 'leng keng' của đồng xu mỗi khi người chơi kéo thanh trượt"
// The 'input' event fires rapidly. Let's just play it. If it's too much we can adjust.
// Actually, 'bet' sound is "leng keng".

function updateSliderMax() {
    const slider = safeGetElement('bet-slider');
    if (!slider) return; // Exit if slider doesn't exist (mobile page)

    let maxVal = currentBalance > 0 ? currentBalance : 1;
    slider.max = maxVal;
    safeSetText('max-display', formatMoney(maxVal));

    if (parseInt(slider.value) > maxVal) {
        slider.value = maxVal;
    }
    // Don't play sound on auto-update
    // handleSliderInput(slider); // This would play sound. 
    // Provide a flag or manually update UI without calling handleSliderInput to avoid sound?
    // Or just let it be.

    // Manually update UI to avoid sound spam on balance update
    const val = parseInt(slider.value);
    const min = parseInt(slider.min);
    let percent = 0;
    if (maxVal > min) {
        percent = ((val - min) / (maxVal - min)) * 100;
    } else {
        percent = 100;
    }
    safeSetStyle('slider-fill', 'width', percent + "%");
}

function jumpTo(percent) {
    if (currentBalance <= 0) return;
    const slider = safeGetElement('bet-slider');
    if (!slider) return; // Exit if slider doesn't exist (mobile page)

    let val = Math.floor(currentBalance * percent);
    if (val < 1) val = 1;
    slider.value = val;
    handleSliderInput(slider); // Plays sound
}

function formatMoney(num) {
    return Number(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// --- 2. LOGIC GAME & SOCKET ---
const bowlWrap = document.getElementById('bowl');
const hammer = new Hammer(bowlWrap);
hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL, threshold: 0 });
let cx = 0, cy = 0;
let currentResultSide = null; // Store result to show only when bowl opens
let currentUserWon = false;   // Store if user won to determine lose sound
let hasUserBet = false;       // Store if user bet

hammer.on("panstart", () => { if (!canOpenBowl) return; bowlWrap.style.transition = 'none'; });
hammer.on("panmove", (ev) => { if (!canOpenBowl) return; bowlWrap.style.transform = `translate(calc(-50% + ${ev.deltaX}px), calc(-50% + ${ev.deltaY}px))`; cx = ev.deltaX; cy = ev.deltaY; });
hammer.on("panend", () => { if (!canOpenBowl) return; if (Math.sqrt(cx * cx + cy * cy) > 150) openBowl(); else resetBowlPosition(); });

function openBowl() {
    bowlWrap.style.transition = 'all 0.5s ease-out';
    bowlWrap.style.transform = 'translate(-50%, -500px)';
    bowlWrap.style.opacity = 0;
    document.getElementById('result-toast').style.opacity = 1;
    SoundManager.play('open');
    SoundManager.play('dice_land');

    // Show winner glow NOW
    if (currentResultSide) {
        const winBox = document.getElementById(`box-${currentResultSide}`);
        if (winBox) winBox.classList.add('winner-glow');
    }

    // Play Lose sound if user bet but didn't win
    // Delay slightly to let user process the dice
    if (hasUserBet && !currentUserWon) {
        setTimeout(() => SoundManager.play('lose'), 800);
    }
}
function resetBowl() {
    cx = 0; cy = 0; bowlWrap.style.transition = 'none';
    bowlWrap.style.transform = 'translate(-50%, -50%)';
    bowlWrap.style.opacity = 1;
    document.getElementById('result-toast').style.opacity = 0;

    // Reset states
    currentResultSide = null;
    currentUserWon = false;
    hasUserBet = false;
}
function resetBowlPosition() {
    bowlWrap.style.transition = 'transform 0.3s ease-out';
    bowlWrap.style.transform = 'translate(-50%, -50%)';
}

socket.on('balance_update', (d) => {
    const bal = d.new_balance !== undefined ? d.new_balance : d.balance;
    if (bal !== undefined && bal !== null) {
        currentBalance = Number(bal);
        document.getElementById('balance').innerText = formatMoney(currentBalance);
        updateSliderMax();
    }
});

socket.on('tx_win_notify', (d) => {
    showNotif(`THẮNG LỚN +${formatMoney(d.amount)}`);
    // If win notify comes, ensure we don't play lose sound (just in case)
    currentUserWon = true;
    SoundManager.play('win');
    spawnFlyingCoins();
    fetch('/api/me').then(r => r.json()).then(u => {
        currentBalance = u.balance;
        safeSetText('balance', formatMoney(currentBalance));
        updateSliderMax();
    });
});

fetch('/api/me').then(r => r.json()).then(u => {
    if (u.error || typeof u.balance === 'undefined') {
        alert("Vui lòng đăng nhập để chơi!");
        window.location.href = '/';
        return;
    }
    currentBalance = u.balance;
    safeSetText('balance', formatMoney(currentBalance));
    updateSliderMax();
    // Initialize slider UI without playing sound
    const slider = document.getElementById('bet-slider');
    handleSliderInput(slider);
}).catch(err => {
    console.error("Login check failed:", err);
});

socket.on('tx_timer', (t) => {
    safeSetText('timer', t);
    const color = (t <= 5) ? '#e74c3c' : '#ffd700';
    safeSetStyle('timer', 'color', color);

    const timerContainer = safeGetElement('timer-container');
    if (timerContainer) {
        timerContainer.style.borderColor = color;
        timerContainer.style.boxShadow = `0 0 15px ${color}`;
    }

    // Countdown sound logic? 
    // "Tiếng xóc đĩa: Âm thanh lách cách của sứ va chạm khi đếm ngược 5s đầu."
    // Usually shaking happens at start of round, not end. 
    // But request says "khi đếm ngược 5s đầu" -> assuming 5s remaining? Or first 5s?
    // Usually 'shaking' is a phase.
});

socket.on('tx_update', (data) => {
    try {
        safeSetTotal('total-tai', data.total_tai);
        safeSetTotal('total-xiu', data.total_xiu);
        if (data.msg) showNotif(data.msg);

        if (data.phase === 'shaking') {
            isBettingPhase = false; canOpenBowl = false; resetBowl();
            bowlWrap.classList.add('shaking');
            SoundManager.play('shaking');
            setTimeout(() => SoundManager.play('dice_roll'), 300);

            safeSetText('my-tai', '');
            safeSetText('my-xiu', ''); // Safe update
            const boxTai = document.getElementById('box-tai'); if (boxTai) boxTai.classList.remove('selected', 'winner-glow');
            const boxXiu = document.getElementById('box-xiu'); if (boxXiu) boxXiu.classList.remove('selected', 'winner-glow');

            for (let i = 1; i <= 3; i++) {
                const d = document.getElementById(`d${i}`);
                if (d) d.classList.remove('dice-reveal');
            }
        } else {
            bowlWrap.classList.remove('shaking');
            SoundManager.stop('shaking');
            SoundManager.stop('dice_roll');

            if (data.phase === 'betting') { isBettingPhase = true; canOpenBowl = false; resetBowl(); }
            else if (data.phase === 'opening' || data.phase === 'result') {
                isBettingPhase = false; canOpenBowl = (data.phase === 'opening');
                if (data.dice) {
                    for (let i = 0; i < 3; i++) {
                        const d = document.getElementById(`d${i + 1}`);
                        if (d) d.src = `images/dice/${data.dice[i]}.png?t=${Date.now()}`;
                    }
                }
            }
        }
    } catch (e) {
        console.error("TX Update Error:", e);
    }
});

socket.on('tx_phase_open', (data) => {
    canOpenBowl = true; isBettingPhase = false; showNotif("MỞ BÁT !");
    if (data.dice) for (let i = 0; i < 3; i++) { const d = document.getElementById(`d${i + 1}`); if (d) d.src = `images/dice/${data.dice[i]}.png?t=${Date.now()}`; }
    let txt = data.result.toUpperCase(); if (data.result === 'bao') txt = "BÃO";
    let color = data.result === 'tai' ? '#e74c3c' : (data.result === 'xiu' ? '#3498db' : '#ffd700');
    document.getElementById('toast-text').innerText = `${data.total} - ${txt}`;
    document.getElementById('toast-text').style.color = color;
    document.getElementById('toast-text').style.textShadow = `0 0 20px ${color}`;

    // Update balance vars for logic
    const myTai = parseInt(document.getElementById('my-tai').innerText.replace(/\D/g, '')) || 0;
    const myXiu = parseInt(document.getElementById('my-xiu').innerText.replace(/\D/g, '')) || 0;

    hasUserBet = (myTai > 0 || myXiu > 0);
    currentUserWon = false; // Reset, will be set true if check passes below OR if tx_win_notify arrives
    currentResultSide = null;

    if (data.result === 'tai') {
        currentResultSide = 'tai';
        if (myTai > 0) currentUserWon = true;
    }
    if (data.result === 'xiu') {
        currentResultSide = 'xiu';
        if (myXiu > 0) currentUserWon = true;
    }

    // 2. Dice Animation Effect
    for (let i = 1; i <= 3; i++) {
        const d = document.getElementById(`d${i}`);
        d.classList.remove('dice-reveal');
        void d.offsetWidth; // Trigger reflow
        d.classList.add('dice-reveal');
    }
});

// --- MUSIC TOGGLE ---
let isMusicPlaying = false;
function toggleMusic() {
    isMusicPlaying = !isMusicPlaying;
    const btn = document.getElementById('music-btn');
    if (isMusicPlaying) {
        SoundManager.play('bgm');
        btn.innerText = '🔊';
        btn.style.opacity = 1;
    } else {
        SoundManager.stop('bgm');
        btn.innerText = '🔇';
        btn.style.opacity = 0.5;
    }
}

// Try to auto-play music on first user interaction if not playing
document.addEventListener('click', () => {
    const bgm = SoundManager.getSound('bgm');
    if (!isMusicPlaying && bgm && !bgm.paused) {
        // If it thinks it's playing but paused by browser policy, try again
        SoundManager.play('bgm');
    }
}, { once: true });

socket.on('tx_force_open', () => { if (bowlWrap.style.opacity != 0) openBowl(); });

socket.on('tx_history', (hist) => {
    // Chỉ render Pro Grid (đã bỏ history-bar chấm)
    renderHistoryGrid(hist);
});

// --- PRO HISTORY GRID ---
function renderHistoryGrid(hist) {
    const grid = document.getElementById('history-grid');
    if (!grid) return;

    let cells = '';
    const maxCells = 120;

    // Fill from oldest to newest (left-to-right, top-to-bottom)
    for (let i = 0; i < maxCells; i++) {
        const entry = hist[i];
        if (entry) {
            const diceStr = entry.dice ? entry.dice.join(' + ') : '?';
            const total = entry.total || (entry.dice ? entry.dice.reduce((a, b) => a + b, 0) : '?');
            const resultLabel = entry.result === 'tai' ? 'TÀI' : (entry.result === 'xiu' ? 'XỈU' : 'BÃO');

            cells += `<div class="history-cell ${entry.result}" title="${resultLabel}: ${total} điểm (${diceStr})">
                ${total}
                <span class="tooltip">🎲 ${diceStr}<br>${resultLabel} (${total} điểm)</span>
            </div>`;
        } else {
            cells += `<div class="history-cell empty"></div>`;
        }
    }

    grid.innerHTML = cells;
}

function toggleHistoryBoard() {
    const board = document.getElementById('history-board');
    const btn = document.getElementById('toggle-history-btn');

    if (board.classList.contains('hidden')) {
        board.classList.remove('hidden');
        btn.innerHTML = '✕ Đóng';
    } else {
        board.classList.add('hidden');
        btn.innerHTML = '📊 Xem Cầu';
    }
}

socket.on('tx_bet_success', () => {
    showNotif("ĐÃ CƯỢC THÀNH CÔNG!");
    SoundManager.play('bet');
});
socket.on('tx_bet_error', (d) => showNotif(d.msg));
socket.on('tx_totals', (d) => {
    safeSetTotal('total-tai', d.total_tai);
    safeSetTotal('total-xiu', d.total_xiu);
});

// --- VISUAL EFFECTS HELPERS ---
function spawnFlyingCoins() {
    const coinCount = 20;
    const centerStage = document.querySelector('.center-stage').getBoundingClientRect();
    const target = document.querySelector('.user-money').getBoundingClientRect();

    const startX = centerStage.left + centerStage.width / 2;
    const startY = centerStage.top + centerStage.height / 2;

    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;

    for (let i = 0; i < coinCount; i++) {
        const coin = document.createElement('div');
        coin.className = 'flying-coin';

        // Randomize start slightly
        const offsetX = (Math.random() - 0.5) * 50;
        const offsetY = (Math.random() - 0.5) * 50;

        coin.style.left = (startX + offsetX) + 'px';
        coin.style.top = (startY + offsetY) + 'px';

        document.body.appendChild(coin);

        // Animate
        const duration = 800 + Math.random() * 500; // 0.8s - 1.3s

        // Using Web Animations API for movement
        const animation = coin.animate([
            { transform: `translate(0, 0) scale(1)`, opacity: 1 },
            { transform: `translate(${targetX - startX - offsetX}px, ${targetY - startY - offsetY}px) scale(0.5)`, opacity: 0 }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)', // Ease out
            delay: Math.random() * 300 // Slight stagger
        });

        animation.onfinish = () => {
            coin.remove();
        };
    }
}


function quickBet(side) {
    if (!isBettingPhase) return showNotif("Vui lòng chờ ván mới!");
    if (selectedAmount <= 0) return showNotif("Hãy chọn tiền cược!");
    if (currentBalance < selectedAmount) return showNotif("Số dư không đủ!");

    socket.emit('tx_bet', { side: side, amount: selectedAmount });

    const box = document.getElementById(`box-${side}`);
    box.classList.add('selected');
    setTimeout(() => box.classList.remove('selected'), 200);

    const elMy = document.getElementById(`my-${side}`);
    const current = parseInt(elMy.innerText.replace(/\D/g, '')) || 0;
    elMy.innerText = formatMoney(current + selectedAmount);

    SoundManager.play('bet');
}

function showNotif(msg) {
    const el = document.getElementById('notif');
    el.innerText = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 2000);
}