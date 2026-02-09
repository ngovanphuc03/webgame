/* ═══════════════════════════════════════════════════════
 *  PIXEL PLAYZONE — Game Tutorial System
 *  Include on game pages: <script src="/js/tutorial-system.js"></script>
 *  Only renders button when logged in (has user_info cookie)
 * ═══════════════════════════════════════════════════════ */
(function () {
    'use strict';

    function isLoggedIn() {
        return document.cookie.split(';').some(c => c.trim().startsWith('user_info='));
    }

    const TUTORIALS = {
        mines: {
            title: '💣 HƯỚNG DẪN MINES',
            steps: [
                { icon: '🎯', title: 'Mục tiêu', desc: 'Chọn các ô an toàn để nhân hệ số cược lên cao. Tránh bom!' },
                { icon: '💰', title: 'Đặt cược', desc: 'Chọn mức cược và số lượng bom (3-24). Bom càng nhiều = nhân càng cao!' },
                { icon: '🔲', title: 'Chơi', desc: 'Click vào các ô trên bàn. Mỗi ô an toàn sẽ tăng hệ số nhân.' },
                { icon: '💎', title: 'Rút tiền', desc: 'Nhấn "THU TIỀN" bất kỳ lúc nào để nhận thưởng theo hệ số hiện tại.' },
                { icon: '💥', title: 'Bom!', desc: 'Nếu chọn trúng ô bom — mất toàn bộ tiền cược. Biết dừng đúng lúc!' }
            ]
        },
        crash: {
            title: '🚀 HƯỚNG DẪN CRASH',
            steps: [
                { icon: '🎯', title: 'Mục tiêu', desc: 'Tên lửa bay lên — rút tiền trước khi nó nổ tung!' },
                { icon: '💰', title: 'Đặt cược', desc: 'Nhập số tiền cược trước khi vòng mới bắt đầu.' },
                { icon: '🚀', title: 'Bay lên!', desc: 'Hệ số nhân tăng dần: 1.00x → 2.00x → 10.00x → ∞' },
                { icon: '💸', title: 'Thu tiền', desc: 'Nhấn "CASHOUT" để rút tiền = cược × hệ số hiện tại.' },
                { icon: '💥', title: 'Nổ!', desc: 'Nếu tên lửa nổ trước khi bạn rút — mất hết! Tham lam = thua.' }
            ]
        },
        poker: {
            title: '🂡 HƯỚNG DẪN POKER',
            steps: [
                { icon: '🎯', title: 'Texas Hold\'em', desc: 'Mỗi người nhận 2 lá bài. Kết hợp với 5 lá chung để tạo bộ tốt nhất.' },
                { icon: '💰', title: 'Đặt cược', desc: 'Có 4 vòng cược: Pre-flop, Flop (3 lá), Turn (1 lá), River (1 lá).' },
                { icon: '🃏', title: 'Hành động', desc: 'Check (qua), Call (theo), Raise (tăng), Fold (bỏ bài), All-in (tất tay).' },
                { icon: '👑', title: 'Xếp hạng bài', desc: 'Royal Flush > Straight Flush > Quads > Full House > Flush > Straight > Trips > Two Pair > Pair > High Card.' },
                { icon: '🏆', title: 'Thắng', desc: 'Người có bộ bài tốt nhất hoặc người cuối cùng còn lại sẽ thắng pot!' }
            ]
        },
        taixiu: {
            title: '🎲 HƯỚNG DẪN TÀI XỈU',
            steps: [
                { icon: '🎯', title: 'Luật chơi', desc: 'Đoán tổng 3 xúc xắc: Tài (11-17) hoặc Xỉu (4-10).' },
                { icon: '💰', title: 'Đặt cược', desc: 'Chọn Tài hoặc Xỉu, đặt số tiền cược trong thời gian cho phép.' },
                { icon: '🎲', title: 'Lắc xúc xắc', desc: 'Khi hết thời gian, xúc xắc sẽ được lắc và mở kết quả.' },
                { icon: '🏆', title: 'Thắng x2', desc: 'Đoán đúng = nhận x1.95 tiền cược. Đoán sai = mất tiền.' },
                { icon: '⚡', title: 'Multiplayer', desc: 'Chơi cùng lúc với nhiều người! Xem tỷ lệ cược realtime.' }
            ]
        },
        flappy: {
            title: '🐦 HƯỚNG DẪN FLAPPY BIRD',
            steps: [
                { icon: '🎯', title: 'Mục tiêu', desc: 'Điều khiển chim bay qua các ống nhiều nhất có thể.' },
                { icon: '👆', title: 'Điều khiển', desc: 'Click hoặc nhấn Space để chim vỗ cánh bay lên.' },
                { icon: '🏗️', title: 'Ống nước', desc: 'Bay qua khe giữa 2 ống. Chạm vào ống hoặc mặt đất = thua!' },
                { icon: '💰', title: 'Phần thưởng', desc: 'Mỗi ống vượt qua = xu thưởng. Điểm càng cao = thưởng càng lớn.' },
                { icon: '🏆', title: 'Kỷ lục', desc: 'Phá kỷ lục cá nhân để nhận bonus xu đặc biệt!' }
            ]
        },
        daily: {
            title: '🎁 HƯỚNG DẪN DAILY REWARD',
            steps: [
                { icon: '📅', title: 'Mỗi ngày 1 lần', desc: 'Đăng nhập mỗi ngày để quay vòng quay may mắn nhận xu miễn phí.' },
                { icon: '🔥', title: 'Streak', desc: 'Đăng nhập liên tục nhiều ngày → phần thưởng tăng dần theo streak.' },
                { icon: '🎡', title: 'Vòng quay', desc: 'Nhấn nút quay, vòng quay sẽ dừng ngẫu nhiên ở 1 phần thưởng.' },
                { icon: '💎', title: 'Phần thưởng', desc: 'Từ 100$ đến 10,000$ tùy may mắn. Streak cao = xu nhiều hơn!' },
                { icon: '⚠️', title: 'Lưu ý', desc: 'Bỏ lỡ 1 ngày sẽ reset streak về 0. Nhớ đăng nhập mỗi ngày!' }
            ]
        }
    };

    function createTutorialBtn(gameKey) {
        if (!isLoggedIn()) return;
        const tut = TUTORIALS[gameKey];
        if (!tut) return;

        const toolbar = document.getElementById('ppz-toolbar');
        if (!toolbar) {
            // Toolbar not yet created (async checkAuth) — retry up to 3s
            if (!createTutorialBtn._retries) createTutorialBtn._retries = 0;
            if (createTutorialBtn._retries++ < 30) {
                setTimeout(() => createTutorialBtn(gameKey), 100);
            }
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'ppz-tutorial-btn';
        btn.className = 'ppz-tb-btn';
        btn.innerHTML = '❓';
        btn.title = 'Hướng dẫn chơi';
        btn.addEventListener('click', (e) => { e.stopPropagation(); showTutorial(tut); });

        if (toolbar) {
            toolbar.appendChild(btn);
        }

        // Auto-show on first visit
        const key = `ppz_tut_${gameKey}`;
        if (!localStorage.getItem(key)) {
            setTimeout(() => showTutorial(tut), 1500);
            localStorage.setItem(key, '1');
        }
    }

    function showTutorial(tut) {
        const old = document.getElementById('ppz-tutorial-modal');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ppz-tutorial-modal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;animation:ppzTutFade .3s ease';

        const stepsHtml = tut.steps.map((s, i) => `
            <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid rgba(255,255,255,.05)">
                <div style="font-size:24px;min-width:36px;text-align:center;line-height:1">${s.icon}</div>
                <div>
                    <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,.9);margin-bottom:3px">${i + 1}. ${s.title}</div>
                    <div style="font-size:11px;color:rgba(255,255,255,.55);line-height:1.5">${s.desc}</div>
                </div>
            </div>`).join('');

        overlay.innerHTML = `
            <style>@keyframes ppzTutFade{from{opacity:0}to{opacity:1}}@keyframes ppzTutSlide{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}</style>
            <div style="background:rgba(10,5,25,.97);border:1px solid rgba(139,92,246,.2);border-radius:20px;max-width:420px;width:100%;max-height:85vh;overflow-y:auto;padding:28px 24px;animation:ppzTutSlide .4s ease;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:'DearPix','Orbitron',sans-serif">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                    <h2 style="font-size:17px;color:#8b5cf6;margin:0">${tut.title}</h2>
                    <button onclick="document.getElementById('ppz-tutorial-modal').remove()" style="background:none;border:none;color:rgba(255,255,255,.4);font-size:22px;cursor:pointer;padding:4px;line-height:1;transition:.3s" onmouseenter="this.style.color='#fff'" onmouseleave="this.style.color='rgba(255,255,255,.4)'">&times;</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">${stepsHtml}</div>
                <button onclick="document.getElementById('ppz-tutorial-modal').remove()" style="display:block;margin:20px auto 0;padding:10px 40px;border-radius:25px;border:1px solid rgba(139,92,246,.3);background:rgba(139,92,246,.15);color:#8b5cf6;font-family:inherit;font-size:13px;cursor:pointer;transition:.3s;letter-spacing:2px" onmouseenter="this.style.background='rgba(139,92,246,.3)'" onmouseleave="this.style.background='rgba(139,92,246,.15)'">ĐÃ HIỂU ✓</button>
            </div>`;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    // Auto-detect game from URL
    function autoInit() {
        const path = window.location.pathname;
        if (path.includes('mines')) createTutorialBtn('mines');
        else if (path.includes('crash')) createTutorialBtn('crash');
        else if (path.includes('poker')) createTutorialBtn('poker');
        else if (path.includes('taixiu')) createTutorialBtn('taixiu');
        else if (path.includes('flappy')) createTutorialBtn('flappy');
        else if (path.includes('daily')) createTutorialBtn('daily');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

    window.PPZTutorial = { show: showTutorial, tutorials: TUTORIALS };
})();
