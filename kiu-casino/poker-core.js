// ====================================================================
// POKER CORE - PROFESSIONAL VERSION (SIDE POTS & SECURITY)
// ====================================================================
const Hand = require('pokersolver').Hand;
const crypto = require('crypto');

class PokerManager {
    constructor(io, dbPool) {
        this.io = io;
        this.db = dbPool;
        this.tables = {};
        this.TARGET_GUILD_ID = process.env.GUILD_ID || '949162034954633236';

        this.createTable({
            id: 'vip_table',
            name: '🏆 VIP High Roller',
            maxPlayers: 9,
            smallBlind: 50,
            bigBlind: 100,
            minBuyIn: 1000,
            maxBuyIn: 100000,
            rake: 0.05,
            rakeMax: 5
        });
    }

    createTable(config) {
        const table = new PokerTable(config, this.io, this.db, this.TARGET_GUILD_ID);
        this.tables[config.id] = table;
        return table;
    }

    handleSocket(socket, user) {
        socket.on('pk_join', (d) => this.playerJoin(socket, user, d));
        socket.on('pk_action', (d) => this.playerAction(socket, user, d));
        socket.on('pk_leave', () => this.playerLeave(socket, user));
        socket.on('pk_sit_out', () => this.toggleSitOut(socket, user));
        socket.on('pk_chat', (d) => this.handleChat(socket, user, d));
        socket.on('pk_auto_action', (d) => this.setAutoAction(socket, user, d));
        socket.on('pk_start', () => this.forceStart(socket, user));
        // ✅ Smart Disconnect Handling
        socket.on('disconnect', () => this.handleDisconnect(socket, user));
    }

    handleDisconnect(socket, user) {
        // Find table where user is playing
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        if (table) table.handlePlayerDisconnect(user.id);
    }

    forceStart(socket, user) {
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        if (table) {
            console.log(`⚡ Force Start by ${user.username}`);
            table.forceStartGame();
        }
    }

    async playerJoin(socket, user, data) {
        let table = this.tables[data.tableId];
        if (!table) return socket.emit('pk_error', { message: 'Table not found' });

        const buyIn = Math.min(Math.max(parseInt(data.buyIn) || 5000, table.minBuyIn), table.maxBuyIn);
        const result = await table.addPlayer(user, buyIn, socket.id);

        if (result.success) {
            socket.join(data.tableId);
            table.broadcast();
            table.sendChatMessage('system', `👋 ${user.username} joined ($${buyIn})`);
        } else {
            socket.emit('pk_error', { message: result.error });
        }
    }

    playerAction(socket, user, data) {
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        if (table) table.handleAction(user.id, data.action, data.amount);
    }

    toggleSitOut(socket, user) {
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        if (table) table.togglePlayerSitOut(user.id);
    }

    handleChat(socket, user, data) {
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        // Anti-Spam: Truncate long messages
        const cleanMsg = (data.message || "").substring(0, 100);
        if (table && cleanMsg.length > 0) table.sendChatMessage(user.id, cleanMsg);
    }

    async playerLeave(socket, user) {
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        if (table) await table.removePlayer(user.id);
    }

    setAutoAction(socket, user, data) {
        const table = Object.values(this.tables).find(t => t.getPlayer(user.id));
        if (table) table.setAutoAction(user.id, data.action);
    }
}

class PokerTable {
    constructor(config, io, db, guildId) {
        this.id = config.id;
        this.name = config.name;
        this.io = io;
        this.db = db;
        this.guildId = guildId;
        this.maxPlayers = config.maxPlayers || 9;
        this.smallBlind = config.smallBlind;
        this.bigBlind = config.bigBlind;
        this.minBuyIn = config.minBuyIn;
        this.maxBuyIn = config.maxBuyIn;
        this.rake = config.rake || 0;
        this.rakeMax = config.rakeMax || 0;

        this.players = new Array(this.maxPlayers).fill(null);
        this.deck = [];
        this.communityCards = [];
        this.pots = [];
        this.state = 'WAITING';
        this.currentBet = 0;
        this.currentTurn = -1;
        this.dealerIdx = -1;
        this.handNumber = 0;
        this.lastAggressorSeat = -1;
        this.turnTimer = null;
        this.phaseTimer = null;
        this.TURN_TIME = 30000;
        this.PHASE_DELAY = 1000;
        this.chatHistory = [];
    }

    getPlayer(id) { return this.players.find(p => p && p.id === id); }
    getActivePlayers() { return this.players.filter(p => p && p.status === 'PLAYING'); }
    getInHandPlayers() { return this.players.filter(p => p && ['PLAYING', 'ALLIN'].includes(p.status)); }
    getReadyPlayers() { return this.players.filter(p => p && p.chips > 0 && p.status !== 'SITTING_OUT'); }

    // Transaction logging helper
    async logTx(uid, type, amount, balBefore, balAfter, details) {
        if (!this.db) return;
        try {
            await this.db.execute(
                'INSERT INTO transactions (user_id, guild_id, type, amount, balance_before, balance_after, details) VALUES (?,?,?,?,?,?,?)',
                [uid, this.guildId, type, amount, balBefore, balAfter, details ? JSON.stringify(details) : null]
            );
        } catch (e) { console.error('[Poker TX LOG]', e.message); }
    }

    async addPlayer(user, chips, socketId) {
        const existing = this.players.findIndex(p => p && p.id === user.id);
        if (existing !== -1) {
            this.players[existing].socketId = socketId;
            this.players[existing].connected = true;
            return { success: true };
        }

        const seat = this.players.findIndex(p => p === null);
        if (seat === -1) return { success: false, error: 'Table full' };

        // Deduct buy-in with FOR UPDATE to prevent race conditions
        if (this.db && !user.id.toString().startsWith('guest_')) {
            const conn = await this.db.getConnection();
            try {
                await conn.beginTransaction();
                const [rows] = await conn.execute(
                    'SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE',
                    [this.guildId, user.id]
                );
                const balance = rows.length ? Number(rows[0].balance) : 0;
                if (balance < chips) {
                    await conn.rollback(); conn.release();
                    return { success: false, error: `Not enough money ($${balance})` };
                }
                await conn.execute('UPDATE wallet SET balance = balance - ? WHERE guild_id=? AND user_id=?', [chips, this.guildId, user.id]);
                await conn.commit();
                conn.release();
                // Log buy-in transaction
                await this.logTx(user.id, 'poker_buyin', -chips, balance, balance - chips, { table: this.id });
            } catch (e) {
                await conn.rollback().catch(() => { });
                conn.release();
                console.error('DB Error:', e);
                return { success: false, error: 'Database error' };
            }
        }

        this.players[seat] = {
            id: user.id, name: user.username, avatar: user.avatar,
            chips: chips, seat: seat, socketId: socketId, connected: true,
            hand: [], bet: 0, totalBet: 0, status: 'WAITING', lastAction: '',
            hasActed: false, autoAction: null, handsWon: 0
        };

        if (this.state === 'WAITING' && this.getReadyPlayers().length >= 2) {
            setTimeout(() => { if (this.state === 'WAITING') this.startNewHand(); }, 2000);
        }
        return { success: true };
    }

    removePlayer(uid) {
        const idx = this.players.findIndex(p => p && p.id === uid);
        if (idx === -1) return;
        const p = this.players[idx];

        // Return chips to wallet with transaction logging
        if (p.chips > 0 && this.db) {
            (async () => {
                const conn = await this.db.getConnection();
                try {
                    await conn.beginTransaction();
                    const [rows] = await conn.execute('SELECT balance FROM wallet WHERE guild_id=? AND user_id=? FOR UPDATE', [this.guildId, uid]);
                    const balBefore = rows.length ? Number(rows[0].balance) : 0;
                    await conn.execute('UPDATE wallet SET balance = balance + ? WHERE guild_id=? AND user_id=?', [p.chips, this.guildId, uid]);
                    const balAfter = balBefore + p.chips;
                    await conn.execute(
                        'INSERT INTO transactions (user_id, guild_id, type, amount, balance_before, balance_after, details) VALUES (?,?,?,?,?,?,?)',
                        [uid, this.guildId, 'poker_cashout', p.chips, balBefore, balAfter, JSON.stringify({ table: this.id })]
                    );
                    await conn.commit();
                    conn.release();
                } catch (e) {
                    await conn.rollback().catch(() => { });
                    conn.release();
                    console.error('[DB] removePlayer error:', e);
                }
            })();
        }

        // LƯU LẠI VỊ TRÍ NGƯỜI VỪA THOÁT
        const wasCurrentTurn = (idx === this.currentTurn);

        this.players[idx] = null;
        this.broadcast();

        // CHECK 1: Nếu bàn chỉ còn 1 người -> Kết thúc ván
        if (this.state !== 'WAITING' && this.getInHandPlayers().length < 2) {
            this.endHandEarly();
            return;
        }

        // CHECK 2: Nếu người vừa thoát đang cầm cái (Active Turn) -> Chuyển lượt ngay
        if (this.state !== 'WAITING' && wasCurrentTurn) {
            this.clearTurnTimer();
            // Tự động chuyển lượt sang người kế tiếp
            this.currentTurn = this.nextActiveSeat(this.currentTurn, true);
            this.startTurnTimer();
            this.broadcast();
        }
    }

    // ✅ SMART DISCONNECT HANDLING
    handlePlayerDisconnect(uid) {
        const p = this.getPlayer(uid);
        if (!p) return;

        console.log(`🔌 Player Disconnected: ${p.name}`);
        p.connected = false;

        // Notify others
        this.sendChatMessage('system', `🔌 ${p.name} mất kết nối.`);

        // CASE 1: Đang trong ván -> Auto Fold (Smart Logic)
        if (p.status === 'PLAYING' || p.status === 'ALLIN') {
            // Immediate Action: Fold to prevent stalling
            // System will handle endHandEarly if needed
            this.handleAction(uid, 'fold');
            p.status = 'SITTING_OUT'; p.pendingKick = true; // Mark as sitting out & to be kicked
        } else {
            // CASE 2: Không chơi -> Chuyển sang Sitting Out
            p.status = 'SITTING_OUT'; p.pendingKick = true;
        }

        this.broadcast();
    }

    togglePlayerSitOut(uid) {
        const p = this.getPlayer(uid);
        if (!p) return;

        if (p.status === 'PLAYING' || p.status === 'ALLIN') {
            // ✅ Đang chơi → Đánh dấu để sit out ván sau
            if (p.pendingSitOut) {
                p.pendingSitOut = false;
                this.sendChatMessage('system', `🔔 ${p.name} hủy đăng ký Tạm Nghỉ.`);
            } else {
                p.pendingSitOut = true;
                this.sendChatMessage('system', `🔔 ${p.name} sẽ Tạm Nghỉ khi hết ván này.`);
            }
        } else {
            // ✅ Không chơi → Đổi trạng thái ngay
            p.status = (p.status === 'SITTING_OUT') ? 'WAITING' : 'SITTING_OUT';
            p.pendingSitOut = false;
        }
        this.broadcast();
    }

    setAutoAction(uid, action) {
        const p = this.getPlayer(uid);
        if (p) {
            p.autoAction = action;
            this.broadcast();
        }
    }

    endHandEarly() {
        this.clearTurnTimer();
        if (this.phaseTimer) clearTimeout(this.phaseTimer);

        const remaining = this.getInHandPlayers();
        if (remaining.length === 1) {
            this.handleWin(remaining[0].id);
        } else if (remaining.length === 0) {
            // EDGE CASE: ALL players disconnected mid-hand
            // Refund pot proportionally to all players based on their totalBet
            console.log('[Poker] All players disconnected - refunding pot');
            const totalPot = this.pots.reduce((s, p) => s + p.amount, 0);
            const currentBets = this.players.reduce((s, p) => s + (p ? p.bet : 0), 0);
            const grandTotal = totalPot + currentBets;

            if (grandTotal > 0 && this.db) {
                // Refund each player their totalBet
                for (const p of this.players) {
                    if (p && p.totalBet > 0) {
                        p.chips += p.totalBet;
                        console.log(`[Poker] Refunded ${p.totalBet} to ${p.name}`);
                    }
                }
            }

            this.pots = [];
            this.communityCards = [];
            this.deck = [];
            this.state = 'WAITING';
            this.broadcast();
        } else {
            this.state = 'WAITING';
            this.broadcast();
        }
    }

    forceStartGame() {
        if (this.getReadyPlayers().length >= 2) this.startNewHand();
    }

    startNewHand() {
        console.log("--> Starting New Hand");

        // ✅ Process pending sit outs
        this.players.forEach(p => {
            if (p) {
                // KICK DISCONNECTED PLAYERS
                if (p.pendingKick || p.connected === false) {
                    this.removePlayer(p.id);
                    return; // Player removed, skip sit out check
                }

                if (p.pendingSitOut) {
                    p.status = 'SITTING_OUT';
                    p.pendingSitOut = false;
                    this.sendChatMessage('system', `💤 ${p.name} đã chuyển sang Tạm Nghỉ.`);
                }
            }
        });

        const ready = this.getReadyPlayers();
        if (ready.length < 2) { this.state = 'WAITING'; return; }

        this.handNumber++;
        this.state = 'PREFLOP';
        this.pots = [];
        this.communityCards = [];
        this.currentBet = 0;
        this.lastRaiseSize = 0;

        // --- FIX: Create Deck Safe Mode ---
        this.deck = this.createDeck();
        if (!this.deck || this.deck.length < 52) {
            console.error("Deck generation failed!");
            this.state = 'WAITING';
            return;
        }

        if (this.dealerIdx === -1) this.dealerIdx = ready[0].seat;
        else this.dealerIdx = this.nextActiveSeat(this.dealerIdx, true);

        // Reset Players & Deal Cards
        this.players.forEach(p => {
            if (p && p.chips > 0 && p.status !== 'SITTING_OUT') {
                p.status = 'PLAYING';
                try {
                    p.hand = [this.deck.pop(), this.deck.pop()];
                } catch (e) { console.error("Deal error:", e); p.hand = []; }
                p.bet = 0; p.totalBet = 0; p.lastAction = ''; p.hasActed = false;
            } else if (p) {
                p.status = 'SITTING_OUT'; p.hand = [];
            }
        });

        // Blinds Logic
        const sbSeat = this.nextActiveSeat(this.dealerIdx, true);
        const bbSeat = this.nextActiveSeat(sbSeat, true); // 2 players: Dealer=SB, Next=BB. 3+: Dealer, SB, BB.

        // Fix for Heads-up (2 players): Dealer is SB
        const activeCount = this.getActivePlayers().length;
        let actualSB = (activeCount === 2) ? this.dealerIdx : sbSeat;
        let actualBB = (activeCount === 2) ? this.nextActiveSeat(this.dealerIdx, true) : bbSeat;

        console.log(`Dealer: ${this.dealerIdx}, SB: ${actualSB}, BB: ${actualBB}`);

        this.postBlind(actualSB, this.smallBlind, 'SB');
        this.postBlind(actualBB, this.bigBlind, 'BB');

        if (activeCount === 2) {
            // ✅ Heads-up: Dealer (SB) acts first preflop
            this.currentTurn = actualSB;
        } else {
            // ✅ 3+ players: UTG (after BB) acts first
            this.currentTurn = this.nextActiveSeat(actualBB, true);
        }

        this.lastAggressorSeat = actualBB;
        this.currentBet = this.bigBlind;
        // this.lastRaiseSize is set in postBlind for BB

        this.startTurnTimer();
        this.broadcast();
        this.sendChatMessage('system', `🎲 Hand #${this.handNumber} Started`);
    }

    postBlind(seat, amount, label) {
        const p = this.players[seat];
        if (!p) return;
        const actual = Math.min(p.chips, amount);
        p.chips -= actual; p.bet += actual; p.totalBet += actual;
        p.lastAction = label;
        if (p.chips === 0) p.status = 'ALLIN';

        if (label === 'BB') {
            // ✅ Big Blind IS the first "raise"
            this.lastRaiseSize = this.bigBlind;
        }
    }

    handleAction(uid, action, amount) {
        const p = this.getPlayer(uid);
        if (!p || p.seat !== this.currentTurn) return;

        // --- BẢO MẬT TUYỆT ĐỐI ---
        if (action === 'raise' && (!Number.isInteger(amount) || amount <= 0)) return;
        // -------------------------

        this.clearTurnTimer();
        p.hasActed = true;

        if (action === 'fold') { p.status = 'FOLDED'; p.lastAction = 'FOLD'; }
        else if (action === 'check') { p.lastAction = 'CHECK'; }
        else if (action === 'call') {
            const toCall = this.currentBet - p.bet;
            const actual = Math.min(p.chips, toCall);
            p.chips -= actual; p.bet += actual; p.totalBet += actual;
            p.lastAction = 'CALL';
            if (p.chips === 0) p.status = 'ALLIN';
        }
        else if (action === 'raise') {
            const isAllIn = (amount >= p.chips + p.bet);

            if (isAllIn) {
                amount = p.chips + p.bet; // Force exact all-in
                p.status = 'ALLIN';
                p.lastAction = 'ALL-IN';
            } else {
                // Normal raise validation
                const minRaise = this.currentBet + this.lastRaiseSize;
                if (amount < minRaise) {
                    console.log(`Invalid raise: ${amount} < ${minRaise}`);
                    return;
                }
                p.lastAction = `RAISE $${amount}`;
            }

            const added = amount - p.bet;
            p.chips -= added;
            p.bet = amount;
            p.totalBet += added;

            if (amount > this.currentBet) {
                const raiseDiff = amount - this.currentBet;
                if (raiseDiff >= this.lastRaiseSize) this.lastRaiseSize = raiseDiff;
                this.currentBet = amount;
                this.lastAggressorSeat = p.seat;
                this.getActivePlayers().forEach(pl => { if (pl.id !== p.id) pl.hasActed = false; });
            }
        }

        this.broadcast();
        setTimeout(() => this.checkNextTurn(), 200);
    }

    checkNextTurn() {
        const active = this.getActivePlayers();
        const inHand = this.getInHandPlayers();

        if (inHand.length === 1) { this.handleWin(inHand[0].id); return; }

        const allActed = active.every(p => p.hasActed);
        const allMatched = active.every(p => p.bet === this.currentBet);

        if ((active.length === 0) || (allActed && allMatched)) {
            this.nextPhase();
        } else {
            this.currentTurn = this.nextActiveSeat(this.currentTurn, true);
            this.startTurnTimer();
            this.broadcast();
        }
    }

    nextPhase() {
        this.calculatePot(); // Now uses Side Pot Logic
        this.getActivePlayers().forEach(p => { p.bet = 0; p.hasActed = false; p.lastAction = ''; });
        this.currentBet = 0;
        this.lastRaiseSize = 0; // Reset raise size

        const phases = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'];
        const idx = phases.indexOf(this.state);

        if (idx < 4) {
            this.state = phases[idx + 1];
            if (this.state === 'FLOP') this.dealCommunity(3);
            else if (['TURN', 'RIVER'].includes(this.state)) this.dealCommunity(1);

            if (this.state === 'SHOWDOWN') this.handleShowdown();
            else {
                // First to act is next active player after Dealer
                this.currentTurn = this.nextActiveSeat(this.dealerIdx, true);
                this.startTurnTimer();
            }
            this.broadcast();
        }
    }

    calculatePot() {
        this.pots = [];
        const contributors = this.players.filter(p => p && p.totalBet > 0);
        if (contributors.length === 0) return;

        // Sắp xếp các mức tiền cược từ thấp đến cao
        const bets = contributors.map(p => p.totalBet).sort((a, b) => a - b);
        const uniqueBets = [...new Set(bets)]; // Lọc trùng

        let prevBetLevel = 0;
        uniqueBets.forEach(betLevel => {
            const potAmountPerPlayer = betLevel - prevBetLevel;
            if (potAmountPerPlayer <= 0) return;

            const sidePot = { amount: 0, eligible: [] };
            contributors.forEach(p => {
                const isActive = ['PLAYING', 'ALLIN'].includes(p.status);

                if (p.totalBet >= betLevel) {
                    sidePot.amount += potAmountPerPlayer;
                    if (isActive) sidePot.eligible.push(p.id);
                } else if (p.totalBet > prevBetLevel) {
                    // Player went All-in/Folded at a sub-level
                    sidePot.amount += (p.totalBet - prevBetLevel);
                    // Standard rules: If All-in less than this level, not eligible for this chunk.
                    // But if this block runs, it implies p.totalBet matches a level we missed?
                    // With uniqueBets logic, this specific else-if ideally shouldn't trigger for eligibility 
                    // unless Floating Point weirdness. Safe to add check though:
                    if (isActive && p.totalBet > prevBetLevel) {
                        // Actually, if they bet less than betLevel (the current cap), 
                        // they can't win this excess portion above their all-in.
                        // So NO eligibility push here is correct.
                    }
                }
            });

            if (sidePot.amount > 0 && sidePot.eligible.length > 0) this.pots.push(sidePot);
            prevBetLevel = betLevel;
        });
    }

    handleShowdown() {
        // Ensure pots are up to date
        this.calculatePot();

        const results = [];
        this.pots.forEach((pot, index) => {
            if (pot.amount <= 0) return;

            // Find candidates for this specific pot
            const candidates = pot.eligible.map(uid => {
                const p = this.getPlayer(uid);
                // We need to construct a Hand object
                const h = Hand.solve([...p.hand, ...this.communityCards]);
                h.playerId = p.id;
                h.playerName = p.name;
                return h;
            });

            const winners = Hand.winners(candidates);
            const share = Math.floor(pot.amount / winners.length);
            const remainder = pot.amount % winners.length;

            // Sort winners by distance from dealer's left
            if (remainder > 0) {
                winners.sort((a, b) => {
                    const pA = this.getPlayer(a.playerId);
                    const pB = this.getPlayer(b.playerId);
                    // Calc distance from dealer (clockwise)
                    const distA = (pA.seat - this.dealerIdx + this.maxPlayers) % this.maxPlayers;
                    const distB = (pB.seat - this.dealerIdx + this.maxPlayers) % this.maxPlayers;
                    return distA - distB;
                });
            }

            winners.forEach((w, i) => {
                const p = this.getPlayer(w.playerId);
                if (p) {
                    let amount = share;
                    if (i < remainder) amount += 1; // Distribute odd chips

                    p.chips += amount;
                    results.push({
                        playerId: p.id, // ✅ Added for UI highlighting
                        playerName: p.name,
                        amount: amount,
                        handDesc: w.descr,
                        cards: w.cards.map(c => c.toString()),
                        potIdx: index
                    });
                }
            });
        });

        this.io.to(this.id).emit('pk_showdown', {
            results: results,
            communityCards: this.communityCards
        });

        setTimeout(() => this.startNewHand(), 6000);
    }

    handleWin(wid) {
        // Fold win - winner takes EVERYTHING
        // Re-calculate pot one last time just in case
        this.calculatePot();
        const total = this.pots.reduce((s, pot) => s + pot.amount, 0);
        const p = this.getPlayer(wid);

        if (p) {
            p.chips += total;
            // CHECK HEADS-UP DISCONNECT WIN
            // If winner is the ONLY player left with connection, and others are disconnected
            // We want a "Clean Wipe" effect
            const onlinePlayers = this.players.filter(pl => pl && pl.connected);
            if (onlinePlayers.length <= 1) {
                // Immediate Clean Wipe for remaining player
                this.io.to(this.id).emit('pk_win', {
                    winnerId: p.id,
                    winnerName: p.name,
                    amount: total,
                    desc: 'Opponent Disconnected',
                    cleanWipe: true // Signal client to clear board immediately
                });
                // Clear board state immediately on server side too for next handshake
                this.communityCards = [];
                this.pots = [];

                setTimeout(() => this.startNewHand(), 2000); // Faster restart
            } else {
                this.io.to(this.id).emit('pk_win', { winnerId: p.id, winnerName: p.name, amount: total, desc: 'Fold Win' });
                setTimeout(() => this.startNewHand(), 3000);
            }
        } else {
            setTimeout(() => this.startNewHand(), 3000);
        }
    }

    // --- THÊM HÀM NÀY VÀO TRONG CLASS PokerTable ---
    getTotalPot() {
        // Cộng tổng tiền Main Pot + Side Pots + Tiền cược trên bàn hiện tại
        const potsTotal = this.pots.reduce((sum, p) => sum + p.amount, 0);
        const currentBets = this.players.reduce((sum, p) => sum + (p ? p.bet : 0), 0);
        return potsTotal + currentBets;
    }

    // --- UTILS ---
    dealCommunity(n) { for (let i = 0; i < n; i++) this.communityCards.push(this.deck.pop()); }

    // Fisher-Yates shuffle with crypto-secure random (unbiased)
    createDeck() {
        const suits = ['d', 'c', 'h', 's'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
        let deck = [];
        for (let s of suits) {
            for (let r of ranks) {
                deck.push(r + s);
            }
        }
        // Fisher-Yates shuffle (cryptographically secure)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = crypto.randomInt(0, i + 1);
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    nextActiveSeat(idx, skipCurrent) {
        let i = skipCurrent ? (idx + 1) % this.maxPlayers : idx;
        let loop = 0;
        while (loop < 9) {
            if (this.players[i] && this.players[i].status === 'PLAYING') return i;
            i = (i + 1) % this.maxPlayers;
            loop++;
        }
        return idx;
    }

    startTurnTimer() {
        this.clearTurnTimer();
        const p = this.players[this.currentTurn];
        if (!p) return;

        // CHECK AUTO-ACTION
        if (p.autoAction) {
            const auto = p.autoAction;
            let action = null;

            if (auto === 'fold') action = 'fold';
            else if (auto === 'check_fold') {
                action = (this.currentBet === p.bet) ? 'check' : 'fold';
            } else if (auto === 'check') {
                if (this.currentBet === p.bet) action = 'check';
                // If can't check, do nothing (wait for manual input)
            } else if (auto === 'call_any') {
                action = 'call';
            }

            if (action) {
                // Execute immediately with small delay for visual clarity
                p.autoAction = null; // Clear trigger
                setTimeout(() => this.handleAction(p.id, action), 1000);
                return; // Logic will proceed in handleAction
            }
        }

        this.turnTimer = setTimeout(() => {
            const player = this.players[this.currentTurn];
            if (!player) {
                console.warn('Turn timeout but player is gone');
                this.currentTurn = this.nextActiveSeat(this.currentTurn, true);
                this.startTurnTimer();
                return;
            }

            console.log(`⏱ Turn Timeout: ${player.id}`);

            // Try check if possible, else fold
            const canCheck = (this.currentBet === player.bet);
            if (canCheck) {
                this.handleAction(player.id, 'check');
            } else {
                this.handleAction(player.id, 'fold');
            }

            // Safety: If action failed, force move to next player
            setTimeout(() => {
                if (this.currentTurn === player.seat && this.state !== 'WAITING') {
                    console.error('Stuck turn detected - forcing next');
                    player.status = 'FOLDED';
                    this.checkNextTurn();
                }
            }, 500);
        }, this.TURN_TIME);
    }

    clearTurnTimer() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        this.turnTimer = null;
    }
    sendChatMessage(from, message) { this.io.to(this.id).emit('pk_chat', { from, message }); }

    broadcast() {
        const data = {
            id: this.id, name: this.name, state: this.state,
            pot: this.pots.reduce((s, p) => s + p.amount, 0), // Sum all pots
            pots: this.pots,
            communityCards: this.communityCards,
            currentTurn: this.players[this.currentTurn]?.id,
            dealerSeat: this.dealerIdx,
            currentBet: this.currentBet,
            lastRaiseSize: this.lastRaiseSize,
            bigBlind: this.bigBlind,
            handNumber: this.handNumber,
            players: this.players.map(p => p ? {
                id: p.id, name: p.name, avatar: p.avatar, chips: p.chips,
                bet: p.bet, status: p.status, seat: p.seat, lastAction: p.lastAction,
                connected: p.connected, // ✅ Added for UI
                hand: null
            } : null)
        };
        this.players.forEach(p => {
            if (p && p.socketId) this.io.to(p.socketId).emit('pk_update', { ...data, myHand: p.hand, me: p.id });
        });
    }
}

module.exports = PokerManager;