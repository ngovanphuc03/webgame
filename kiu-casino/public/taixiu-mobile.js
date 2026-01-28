// ====================================================================
// TÀI XỈU - MOBILE VERSION
// ====================================================================

const socket = io();
let currentBalance = 0;
let selectedAmount = 1;
let canNan = false;
let isBettingPhase = false;

// --- SAFE DOM HELPERS ---
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function safeSetStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
}

function safeGetElement(id) {
    return document.getElementById(id);
}

// --- SOUND MANAGER ---
const SoundManager = {
    paths: {
        shaking: '/sounds/shaking.mp3',
        bet: '/sounds/bet.mp3',
        open: '/sounds/open.mp3',
        win: '/sounds/win.mp3',
        lose: '/sounds/lose.mp3',
        bgm: '/sounds/bgm.mp3'
    },
    sounds: {},
    initialized: {},

    getSound(name) {
        if (!this.sounds[name] && this.paths[name]) {
            this.sounds[name] = new Audio(this.paths[name]);
            if (name === 'shaking' || name === 'bgm') this.sounds[name].loop = true;
            if (name === 'bgm') this.sounds[name].volume = 0.5;
            else this.sounds[name].volume = 0.8;
            this.initialized[name] = true;
        }
        return this.sounds[name];
    },

    play(name) {
        const sound = this.getSound(name);
        if (sound) {
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

// --- SLIDER HANDLING ---
function handleSliderInput(el) {
    if (!el) return;
    const val = parseInt(el.value);
    const max = parseInt(el.max);
    const min = parseInt(el.min);

    selectedAmount = val;
    safeSetText('selected-amount-display', formatMoney(selectedAmount));

    let percent = 0;
    if (max > min) {
        percent = ((val - min) / (max - min)) * 100;
    } else {
        percent = 100;
    }

    safeSetStyle('slider-fill', 'width', percent + "%");

    document.querySelectorAll('.tick').forEach((t, i) => {
        const p = i * 25;
        if (percent >= p - 2 && percent <= p + 2) t.classList.add('active');
        else t.classList.remove('active');
    });

    SoundManager.play('bet');
}

function updateSliderMax() {
    const slider = safeGetElement('bet-slider');
    if (!slider) return;

    let maxVal = currentBalance > 0 ? currentBalance : 1;
    slider.max = maxVal;
    safeSetText('max-display', formatMoney(maxVal));
    safeSetText('balance', formatMoney(currentBalance));

    if (parseInt(slider.value) > maxVal) {
        slider.value = maxVal;
    }

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
    if (!slider) return;

    let val = Math.floor(currentBalance * percent);
    if (val < 1) val = 1;
    slider.value = val;
    handleSliderInput(slider);
}

function formatMoney(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// --- BOWL HANDLING ---
const bowlWrap = document.getElementById('bowl');
let cx = 0, cy = 0;
let currentResultSide = null;
let currentUserWon = false;
let hasUserBet = false;

if (bowlWrap && typeof Hammer !== 'undefined') {
    const hammer = new Hammer(bowlWrap);
    hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL, threshold: 0 });

    hammer.on("panstart", () => { if (!canNan) return; bowlWrap.style.transition = 'none'; });
    hammer.on("panmove", (ev) => {
        if (!canNan) return;
        bowlWrap.style.transform = `translate(${ev.deltaX}px, ${ev.deltaY}px)`;
        cx = ev.deltaX;
        cy = ev.deltaY;
    });
    hammer.on("panend", () => { if (!canNan) return; if (Math.sqrt(cx * cx + cy * cy) > 100) openBowl(); else resetBowlPosition(); });
}

function openBowl() {
    if (!bowlWrap) return;
    // Use the 3D CSS class for opening
    bowlWrap.classList.add('open');
    // Remove manual style manipulation if possible, or keep as fallback
    // bowlWrap.style.transform = 'translateY(-300px)'; 
    // ^ Disabled in favor of class-based animation defined in CSS (.bowl-3d.open)

    const resultToast = safeGetElement('result-toast');
    if (resultToast) {
        resultToast.style.opacity = 1;
        resultToast.style.top = '-50px'; // Float up slightly
    }

    SoundManager.play('open');

    if (currentResultSide) {
        const winBox = document.getElementById(`box-${currentResultSide}`);
        if (winBox) winBox.classList.add('winner-glow');
    }

    if (hasUserBet && !currentUserWon) {
        setTimeout(() => SoundManager.play('lose'), 800);
    }
}

function resetBowl() {
    if (!bowlWrap) return;
    cx = 0; cy = 0;
    // Reset classes
    bowlWrap.classList.remove('open');
    bowlWrap.classList.remove('shaking');

    // Clear manual styles
    bowlWrap.style.transform = '';
    bowlWrap.style.opacity = '';

    const resultToast = safeGetElement('result-toast');
    if (resultToast) {
        resultToast.style.opacity = 0;
        resultToast.style.top = '-30px';
    }

    currentResultSide = null;
    currentUserWon = false;
    hasUserBet = false;
}

function resetBowlPosition() {
    if (!bowlWrap) return;
    bowlWrap.style.transition = 'transform 0.3s ease-out';
    bowlWrap.style.transform = 'translate(0, 0)';
}

// --- SOCKET EVENTS ---
socket.on('balance_update', (d) => {
    currentBalance = d.new_balance;
    safeSetText('balance', formatMoney(currentBalance));
    updateSliderMax();
});

socket.on('tx_win_notify', (d) => {
    showNotif(`THẮNG LỚN +${formatMoney(d.amount)}`);
    currentUserWon = true;
    SoundManager.play('win');
    spawnFlyingCoins();
    fetch('/api/me').then(r => r.json()).then(u => {
        currentBalance = u.balance;
        safeSetText('balance', formatMoney(currentBalance));
        updateSliderMax();
    });
});

// Initial balance fetch
fetch('/api/me').then(r => r.json()).then(u => {
    if (u.error || typeof u.balance === 'undefined') {
        alert("Vui lòng đăng nhập để chơi!");
        window.location.href = '/';
        return;
    }
    currentBalance = u.balance;
    safeSetText('balance', formatMoney(currentBalance));
    updateSliderMax();

    const slider = safeGetElement('bet-slider');
    if (slider) handleSliderInput(slider);
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
});

socket.on('tx_update', (data) => {
    safeSetText('total-tai', formatMoney(data.total_tai));
    safeSetText('total-xiu', formatMoney(data.total_xiu));
    if (data.msg) showNotif(data.msg);

    if (data.phase === 'shaking') {
        isBettingPhase = false; canNan = false; resetBowl();
        if (bowlWrap) bowlWrap.classList.add('shaking');
        SoundManager.play('shaking');

        safeSetText('my-tai', '');
        safeSetText('my-xiu', '');

        const boxTai = safeGetElement('box-tai');
        const boxXiu = safeGetElement('box-xiu');
        if (boxTai) { boxTai.classList.remove('selected'); boxTai.classList.remove('winner-glow'); }
        if (boxXiu) { boxXiu.classList.remove('selected'); boxXiu.classList.remove('winner-glow'); }

        for (let i = 1; i <= 3; i++) {
            const dice = safeGetElement(`d${i}`);
            if (dice) dice.classList.remove('dice-reveal');
        }
    } else {
        if (bowlWrap) bowlWrap.classList.remove('shaking');
        SoundManager.stop('shaking');

        if (data.phase === 'betting') { isBettingPhase = true; canNan = false; resetBowl(); }
        else if (data.phase === 'opening' || data.phase === 'result') {
            isBettingPhase = false; canNan = (data.phase === 'opening');
            if (data.dice) {
                for (let i = 0; i < 3; i++) {
                    const dice = safeGetElement(`d${i + 1}`);
                    if (dice) dice.src = `/images/dice/${data.dice[i]}.png?t=${Date.now()}`;
                }
            }
        }
    }
});

socket.on('tx_phase_open', (data) => {
    canNan = true; isBettingPhase = false; showNotif("MỞ BÁT !");

    if (data.dice) {
        for (let i = 0; i < 3; i++) {
            const dice = safeGetElement(`d${i + 1}`);
            if (dice) dice.src = `/images/dice/${data.dice[i]}.png?t=${Date.now()}`;
        }
    }

    let txt = data.result.toUpperCase();
    if (data.result === 'bao') txt = "BÃO";
    let color = data.result === 'tai' ? '#e74c3c' : (data.result === 'xiu' ? '#3498db' : '#ffd700');

    const toastText = safeGetElement('toast-text');
    if (toastText) {
        toastText.innerText = `${data.total} - ${txt}`;
        toastText.style.color = color;
        toastText.style.textShadow = `0 0 20px ${color}`;
    }

    const myTaiEl = safeGetElement('my-tai');
    const myXiuEl = safeGetElement('my-xiu');
    const myTai = myTaiEl ? (parseInt(myTaiEl.innerText.replace(/\D/g, '')) || 0) : 0;
    const myXiu = myXiuEl ? (parseInt(myXiuEl.innerText.replace(/\D/g, '')) || 0) : 0;

    hasUserBet = (myTai > 0 || myXiu > 0);
    currentUserWon = false;
    currentResultSide = null;

    if (data.result === 'tai') {
        currentResultSide = 'tai';
        if (myTai > 0) currentUserWon = true;
    }
    if (data.result === 'xiu') {
        currentResultSide = 'xiu';
        if (myXiu > 0) currentUserWon = true;
    }

    for (let i = 1; i <= 3; i++) {
        const d = safeGetElement(`d${i}`);
        if (d) {
            d.classList.remove('dice-reveal');
            void d.offsetWidth;
            d.classList.add('dice-reveal');
        }
    }
});

// --- MUSIC TOGGLE ---
let isMusicPlaying = false;
function toggleMusic() {
    isMusicPlaying = !isMusicPlaying;
    const btn = safeGetElement('music-btn');
    if (isMusicPlaying) {
        SoundManager.play('bgm');
        if (btn) { btn.innerText = '🔊'; btn.style.opacity = 1; }
    } else {
        SoundManager.stop('bgm');
        if (btn) { btn.innerText = '🔇'; btn.style.opacity = 0.5; }
    }
}

document.addEventListener('click', () => {
    if (!isMusicPlaying && SoundManager.sounds.bgm && !SoundManager.sounds.bgm.paused) {
        SoundManager.play('bgm');
    }
}, { once: true });

socket.on('tx_force_open', () => { if (bowlWrap && bowlWrap.style.opacity != 0) openBowl(); });

socket.on('tx_history', (hist) => {
    renderHistoryGrid(hist);
    renderMiniHistory(hist);
});

// --- HISTORY GRID ---
function renderMiniHistory(hist) {
    const container = safeGetElement('mini-history-bar');
    if (!container) return;

    // Show last 15 items. 
    // Assuming hist is sorted Newest -> Oldest (index 0 is newest) 
    // We want to show Oldest -> Newest (Left -> Right) for the bar? 
    // Or Newest on Right?
    // Usually "Road" maps go Left->Right. 
    // Let's grab the first 15 items of a standard history arrays usually meant for grid

    // Let's assume hist[0] is the *latest* result.
    // So to show flow Left->Right (Old->New), we take slice(0, 15) and reverse it.

    const count = 12;
    const subset = hist.slice(0, count).reverse(); // Take latest 12 and verify order

    let html = '';
    subset.forEach(entry => {
        if (!entry) return;
        const res = entry.result === 'tai' ? 'tai' : (entry.result === 'xiu' ? 'xiu' : 'bao');
        html += `<div class="mini-dot ${res}"></div>`;
    });

    container.innerHTML = html;
}

function renderHistoryGrid(hist) {
    const grid = safeGetElement('history-grid');
    if (!grid) return;

    let cells = '';
    const maxCells = 120; // 6 rows x 20 cols usually

    // ... existing grid logic ...
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
    const board = safeGetElement('history-board');

    if (board) {
        if (board.classList.contains('show')) {
            board.classList.remove('show');
        } else {
            board.classList.add('show');
        }
    }
}

socket.on('tx_bet_success', () => {
    showNotif("ĐÃ CƯỢC THÀNH CÔNG!");
    SoundManager.play('bet');
});

socket.on('tx_bet_error', (d) => showNotif(d.msg));

socket.on('tx_totals', (d) => {
    safeSetText('total-tai', formatMoney(d.total_tai));
    safeSetText('total-xiu', formatMoney(d.total_xiu));
});

// --- FLYING COINS EFFECT ---
function spawnFlyingCoins() {
    const coinCount = 15;
    const centerStage = document.querySelector('.center-stage');
    // Updated selector to match new HTML structure
    const target = document.querySelector('.balance-pill') || document.querySelector('.balance-display');

    if (!centerStage || !target) return;

    const centerRect = centerStage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const startX = centerRect.left + centerRect.width / 2;
    const startY = centerRect.top + centerRect.height / 2;
    // Target center of balance pill
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;

    for (let i = 0; i < coinCount; i++) {
        const coin = document.createElement('div');
        coin.className = 'flying-coin';

        const offsetX = (Math.random() - 0.5) * 50;
        const offsetY = (Math.random() - 0.5) * 50;

        coin.style.left = (startX + offsetX) + 'px';
        coin.style.top = (startY + offsetY) + 'px';

        document.body.appendChild(coin);

        const duration = 800 + Math.random() * 500;

        const animation = coin.animate([
            { transform: `translate(0, 0) scale(1)`, opacity: 1 },
            { transform: `translate(${targetX - startX - offsetX}px, ${targetY - startY - offsetY}px) scale(0.5)`, opacity: 0 }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
            delay: Math.random() * 300
        });

        animation.onfinish = () => coin.remove();
    }
}

// --- QUICK BET ---
function quickBet(side) {
    if (!isBettingPhase) return showNotif("Vui lòng chờ ván mới!");
    if (selectedAmount <= 0) return showNotif("Hãy chọn tiền cược!");
    if (currentBalance < selectedAmount) return showNotif("Số dư không đủ!");

    socket.emit('tx_bet', { side: side, amount: selectedAmount });

    const box = safeGetElement(`box-${side}`);
    if (box) {
        box.classList.add('selected');
        setTimeout(() => box.classList.remove('selected'), 200);
    }

    const elMy = safeGetElement(`my-${side}`);
    if (elMy) {
        const current = parseInt(elMy.innerText.replace(/\D/g, '')) || 0;
        elMy.innerText = formatMoney(current + selectedAmount);
    }

    SoundManager.play('bet');
}

// --- NOTIFICATION ---
function showNotif(msg) {
    const el = safeGetElement('notif');
    if (el) {
        el.innerText = msg;
        el.style.display = 'block';
        setTimeout(() => el.style.display = 'none', 2000);
    }
}
