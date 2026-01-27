/* FILE: taixiu-core.js (Nằm cùng cấp với server.js) */

class TaiXiuGame {
    constructor(io, dbPool, guildId) {
        this.io = io;
        this.db = dbPool;
        this.guildId = guildId;

        this.T_SHAKING = 5;
        this.T_BETTING = 30;
        this.T_OPENING = 15;

        this.STATE = { WAITING: 0, SHAKING: 1, BETTING: 2, OPENING: 3, RESULT: 4 };

        this.currentState = this.STATE.WAITING;
        this.timeLeft = 0;
        this.sessionId = 1000;
        this.dice = [1, 1, 1];
        this.bets = { tai: {}, xiu: {} };
        this.history = [];
        this.tempResult = null;

        this.startGameLoop();
    }

    async startGameLoop() {
        while (true) {
            // 1. XÓC
            this.startNewRound();
            this.currentState = this.STATE.SHAKING;
            this.dice = [this.rand(), this.rand(), this.rand()];
            this.broadcastState("NHÀ CÁI ĐANG XÓC...", 0);
            await this.sleep(this.T_SHAKING * 1000);

            // 2. ĐẶT CƯỢC
            this.currentState = this.STATE.BETTING;
            this.broadcastState("MỜI ĐẶT CƯỢC", this.T_BETTING);

            const startBetting = Date.now();
            for (let i = this.T_BETTING; i > 0; i--) {
                this.timeLeft = i;
                this.io.emit('tx_timer', i);

                // Anti-Drift: Calculate expected time vs actual time
                const elapsed = Date.now() - startBetting;
                const target = (this.T_BETTING - i + 1) * 1000;
                const delay = Math.max(0, target - elapsed);
                await this.sleep(delay);
            }

            // 3. MỞ BÁT
            this.currentState = this.STATE.OPENING;
            this.calculateOutcome();

            // Gửi kết quả (kèm dice) nhưng chưa force open (để user nặn)
            this.io.emit('tx_phase_open', {
                time: this.T_OPENING,
                dice: this.dice,
                total: this.tempResult.total,
                result: this.tempResult.winnerSide
            });

            const startOpening = Date.now();
            for (let i = this.T_OPENING; i > 0; i--) {
                this.timeLeft = i;
                this.io.emit('tx_timer', i);

                // Anti-Drift for Opening phase
                const elapsed = Date.now() - startOpening;
                const target = (this.T_OPENING - i + 1) * 1000;
                const delay = Math.max(0, target - elapsed);
                await this.sleep(delay);
            }

            // 4. TRẢ THƯỞNG
            this.currentState = this.STATE.RESULT;
            await this.processPayout();
            this.io.emit('tx_force_open'); // Hết giờ nặn, lật bát
            this.io.emit('tx_history', this.history); // GỬI CẦU SAU KHI HẾT 15s MỞ BÁT
            this.broadcastState(null, 0);

            await this.sleep(5000);
        }
    }

    // Gửi trạng thái ngay lập tức cho người mới vào (Fix lỗi F5)
    sendCurrentState(socket) {
        let totalTai = Object.values(this.bets.tai).reduce((a, b) => a + b, 0);
        let totalXiu = Object.values(this.bets.xiu).reduce((a, b) => a + b, 0);

        let phaseName = 'waiting';
        if (this.currentState === this.STATE.SHAKING) phaseName = 'shaking';
        else if (this.currentState === this.STATE.BETTING) phaseName = 'betting';
        else if (this.currentState === this.STATE.OPENING) phaseName = 'opening';
        else if (this.currentState === this.STATE.RESULT) phaseName = 'result';

        const currentDice = (this.currentState >= this.STATE.OPENING) ? this.dice : null;

        socket.emit('tx_update', {
            phase: phaseName, msg: null, time: this.timeLeft,
            total_tai: totalTai, total_xiu: totalXiu, dice: currentDice
        });

        socket.emit('tx_timer', this.timeLeft);

        if (this.currentState === this.STATE.OPENING && this.tempResult) {
            socket.emit('tx_phase_open', {
                time: this.timeLeft, dice: this.dice,
                total: this.tempResult.total, result: this.tempResult.winnerSide
            });
        }

        // FIX BUG 2: Gửi history cho người mới vào
        if (this.history.length > 0) {
            socket.emit('tx_history', this.history);
        }
    }

    startNewRound() {
        this.sessionId++;
        this.bets = { tai: {}, xiu: {} };
        this.tempResult = null;
        this.io.emit('tx_new_round', { session: this.sessionId });
        console.log(`--- PHIÊN #${this.sessionId} ---`);
    }

    calculateOutcome() {
        const totalPoint = this.dice[0] + this.dice[1] + this.dice[2];
        let winnerSide = null;
        if (this.dice[0] === this.dice[1] && this.dice[1] === this.dice[2]) winnerSide = 'bao';
        else winnerSide = totalPoint >= 11 ? 'tai' : 'xiu';

        this.history.push({ result: winnerSide, dice: [...this.dice], total: totalPoint });
        if (this.history.length > 120) this.history.shift();
        this.tempResult = { winnerSide, total: totalPoint };
        // Không gửi tx_history ở đây nữa - sẽ gửi sau khi hết 15s mở bát
    }

    async processPayout() {
        if (!this.tempResult) return;
        const { winnerSide } = this.tempResult;

        // FIX BUG 1: BÃO = nhà cái thắng, không ai được trả thưởng
        if (winnerSide === 'bao') {
            console.log('BÃO - Nhà cái thắng, không ai được thưởng');
            return;
        }

        const winners = this.bets[winnerSide] || {};

        for (const [userId, amount] of Object.entries(winners)) {
            const profit = amount * 2; // Tỉ lệ 1:1 (x2 vốn)
            try {
                await this.db.execute(
                    'UPDATE wallet SET balance = balance + ? WHERE guild_id = ? AND user_id = ?',
                    [profit, this.guildId, userId]
                );
                this.io.to(`user_${userId}`).emit('tx_win_notify', { amount: profit });
                this.updateBalance(userId);
            } catch (err) { console.error('[Payout Error]', err); }
        }
    }

    async handleBet(userId, side, amount) {
        if (this.currentState !== this.STATE.BETTING) return { success: false, msg: "Không phải giờ cược!" };
        if (amount <= 0 || !Number.isInteger(amount)) return { success: false, msg: "Lỗi tiền!" };

        let conn = null;
        try {
            conn = await this.db.getConnection();
            await conn.beginTransaction(); // 🔒 KHÓA GIAO DỊCH

            // 1. Lấy số dư mới nhất và KHÓA DÒNG (FOR UPDATE)
            // Ngăn chặn Race Condition tuyệt đối
            const [rows] = await conn.execute(
                'SELECT balance FROM wallet WHERE user_id = ? AND guild_id = ? FOR UPDATE',
                [userId, this.guildId]
            );

            if (rows.length === 0 || rows[0].balance < amount) {
                await conn.rollback();
                return { success: false, msg: "Số dư không đủ!" };
            }

            // 2. Trừ tiền
            await conn.execute(
                'UPDATE wallet SET balance = balance - ? WHERE user_id = ? AND guild_id = ?',
                [amount, userId, this.guildId]
            );

            await conn.commit(); // ✅ MỞ KHÓA

            // 3. Update RAM state (Chỉ làm khi DB thành công)
            if (!this.bets[side][userId]) this.bets[side][userId] = 0;
            this.bets[side][userId] += amount;

            this.updateBalance(userId);
            this.broadcastTotals();
            return { success: true };

        } catch (err) {
            console.error(err);
            if (conn) await conn.rollback();
            return { success: false, msg: "Lỗi DB" };
        } finally {
            if (conn) conn.release();
        }
    }

    // FIX BUG 3: Wrap trong try-catch để không crash server
    async updateBalance(userId) {
        try {
            const [rows] = await this.db.execute('SELECT balance FROM wallet WHERE guild_id = ? AND user_id = ?', [this.guildId, userId]);
            if (rows.length > 0) this.io.to(`user_${userId}`).emit('balance_update', { new_balance: rows[0].balance });
        } catch (err) {
            console.error('[updateBalance Error]', err);
        }
    }

    broadcastState(msg, timeLeft) {
        let totalTai = Object.values(this.bets.tai).reduce((a, b) => a + b, 0);
        let totalXiu = Object.values(this.bets.xiu).reduce((a, b) => a + b, 0);
        let phaseName = 'waiting';
        if (this.currentState === this.STATE.SHAKING) phaseName = 'shaking';
        else if (this.currentState === this.STATE.BETTING) phaseName = 'betting';
        else if (this.currentState === this.STATE.OPENING) phaseName = 'opening';
        else if (this.currentState === this.STATE.RESULT) phaseName = 'result';

        const currentDice = (this.currentState >= this.STATE.OPENING) ? this.dice : null;
        this.io.emit('tx_update', {
            phase: phaseName, msg: msg, time: timeLeft,
            total_tai: totalTai, total_xiu: totalXiu, dice: currentDice
        });
    }

    broadcastTotals() {
        let totalTai = Object.values(this.bets.tai).reduce((a, b) => a + b, 0);
        let totalXiu = Object.values(this.bets.xiu).reduce((a, b) => a + b, 0);
        this.io.emit('tx_totals', { total_tai: totalTai, total_xiu: totalXiu });
    }

    rand() { return Math.floor(Math.random() * 6) + 1; }
    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

module.exports = TaiXiuGame; // QUAN TRỌNG: Xuất class ra để server.js dùng