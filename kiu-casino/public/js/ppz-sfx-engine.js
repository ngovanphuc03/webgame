/* ═══════════════════════════════════════════════════════════════
 *  PPZ SFX ENGINE — Premium Web Audio Synthesizer
 *  All game sounds: synthesized in real-time via Web Audio API
 *  Include BEFORE game scripts: <script src="/js/ppz-sfx-engine.js">
 *  Usage: window.SFX.play('soundName')
 *         window.SFX.play('soundName', { pitch, vol, pan })
 * ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    let ctx = null;
    let masterGain = null;

    function ensure() {
        if (ctx && ctx.state !== 'closed') {
            if (ctx.state === 'suspended') ctx.resume().catch(() => { });
            return ctx;
        }
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 0.5;
            masterGain.connect(ctx.destination);
        } catch (e) { return null; }
        return ctx;
    }

    // Auto-init on first user interaction
    ['click', 'touchstart', 'keydown'].forEach(evt => {
        document.addEventListener(evt, function _init() {
            ensure();
            document.removeEventListener(evt, _init);
        }, { once: true, passive: true });
    });

    // Get volume from global PPZSound settings
    function getVol() {
        if (window.PPZSound) {
            const s = window.PPZSound.getSettings();
            if (!s.sfxOn) return 0;
            return s.sfxVol;
        }
        return 0.5;
    }

    // ─── HELPERS ───

    function osc(type, freq, start, dur, gainNode) {
        const c = ensure(); if (!c) return null;
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.connect(gainNode);
        o.start(start);
        o.stop(start + dur);
        return o;
    }

    function noise(dur, vol, filter, dest) {
        const c = ensure(); if (!c) return;
        const sr = c.sampleRate;
        const len = sr * dur;
        const buf = c.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = vol;
        if (filter) {
            const f = c.createBiquadFilter();
            f.type = filter.type || 'lowpass';
            f.frequency.value = filter.freq || 2000;
            if (filter.Q) f.Q.value = filter.Q;
            src.connect(f);
            f.connect(g);
        } else {
            src.connect(g);
        }
        g.connect(dest);
        src.start(c.currentTime);
        src.stop(c.currentTime + dur);
    }

    function env(param, pairs, t0) {
        param.setValueAtTime(pairs[0][1], t0 + pairs[0][0]);
        for (let i = 1; i < pairs.length; i++) {
            param.linearRampToValueAtTime(pairs[i][1], t0 + pairs[i][0]);
        }
    }

    function expEnv(param, pairs, t0) {
        param.setValueAtTime(Math.max(pairs[0][1], 0.001), t0 + pairs[0][0]);
        for (let i = 1; i < pairs.length; i++) {
            param.exponentialRampToValueAtTime(Math.max(pairs[i][1], 0.001), t0 + pairs[i][0]);
        }
    }

    // ─── SOUND RECIPES ───

    const recipes = {

        // ══════════════ GLOBAL / UI ══════════════

        click: function (opts) {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.3], [0.02, 0.15], [0.08, 0]], t);
            osc('sine', 1200, t, 0.08, g);
            osc('sine', 900, t + 0.01, 0.06, g);
        },

        hover: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.08], [0.04, 0]], t);
            osc('sine', 1600, t, 0.04, g);
        },

        tick: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.12], [0.015, 0.06], [0.05, 0]], t);
            osc('sine', 800, t, 0.05, g);
        },

        open: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.2], [0.05, 0.15], [0.2, 0]], t);
            const o1 = osc('sine', 440, t, 0.2, g);
            o1.frequency.linearRampToValueAtTime(880, t + 0.15);
            osc('sine', 660, t + 0.05, 0.12, g);
        },

        // ══════════════ CASINO: BET / WIN / LOSE ══════════════

        bet: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Coin clink — two metallic tones
            env(g.gain, [[0, 0.25], [0.03, 0.12], [0.12, 0]], t);
            osc('square', 2400, t, 0.03, g);
            osc('sine', 3200, t + 0.015, 0.04, g);
            noise(0.04, 0.06, { type: 'highpass', freq: 6000 }, masterGain);
        },

        coin: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Rich coin sound
            env(g.gain, [[0, 0.3], [0.02, 0.18], [0.06, 0.08], [0.15, 0]], t);
            osc('sine', 3000, t, 0.06, g);
            osc('sine', 4500, t + 0.01, 0.04, g);
            const o3 = osc('sine', 2200, t + 0.03, 0.1, g);
            if (o3) o3.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
            noise(0.03, 0.04, { type: 'highpass', freq: 8000 }, masterGain);
        },

        win: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Victorious ascending arpeggio
            env(g.gain, [[0, 0.25], [0.4, 0.2], [0.7, 0]], t);
            const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
            notes.forEach((f, i) => {
                osc('sine', f, t + i * 0.08, 0.2, g);
                osc('triangle', f * 2, t + i * 0.08, 0.1, g);
            });
            // Sparkle
            osc('sine', 2093, t + 0.35, 0.15, g);
            noise(0.15, 0.03, { type: 'highpass', freq: 6000 }, masterGain);
        },

        bigwin: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Grand fanfare
            env(g.gain, [[0, 0.3], [0.6, 0.25], [1.2, 0]], t);
            // Triumphant chord progression
            const chords = [
                [523, 659, 784],    // C major
                [587, 740, 880],    // D major
                [659, 831, 988],    // E major → resolve
                [784, 988, 1175]    // G major high
            ];
            chords.forEach((chord, i) => {
                chord.forEach(f => {
                    osc('sine', f, t + i * 0.18, 0.25, g);
                    osc('triangle', f * 0.5, t + i * 0.18, 0.15, g);
                });
            });
            // Shimmer
            for (let i = 0; i < 5; i++) {
                osc('sine', 2000 + i * 400, t + 0.7 + i * 0.05, 0.1, g);
            }
            noise(0.3, 0.04, { type: 'highpass', freq: 5000, Q: 3 }, masterGain);
        },

        lose: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Descending sad tones
            env(g.gain, [[0, 0.2], [0.3, 0.12], [0.6, 0]], t);
            const o1 = osc('sine', 440, t, 0.3, g);
            if (o1) o1.frequency.linearRampToValueAtTime(220, t + 0.3);
            const o2 = osc('triangle', 330, t + 0.1, 0.25, g);
            if (o2) o2.frequency.linearRampToValueAtTime(165, t + 0.35);
            osc('sine', 262, t + 0.2, 0.2, g);
        },

        // ══════════════ CRASH ══════════════

        crash_bet: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.25], [0.04, 0.10], [0.15, 0]], t);
            osc('sine', 600, t, 0.04, g);
            osc('sine', 900, t + 0.02, 0.06, g);
            noise(0.05, 0.05, { type: 'bandpass', freq: 3000, Q: 2 }, masterGain);
        },

        crash_rocket: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Low rumble + ascending whoosh
            env(g.gain, [[0, 0.15], [0.15, 0.2], [0.5, 0.05], [0.8, 0]], t);
            const o1 = osc('sawtooth', 80, t, 0.8, g);
            if (o1) o1.frequency.exponentialRampToValueAtTime(200, t + 0.8);
            noise(0.6, 0.08, { type: 'lowpass', freq: 1500 }, masterGain);
            // Whoosh
            const o2 = osc('sine', 300, t + 0.1, 0.5, g);
            if (o2) o2.frequency.exponentialRampToValueAtTime(1200, t + 0.5);
        },

        crash_tick: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.08], [0.02, 0.03], [0.06, 0]], t);
            osc('sine', 1000, t, 0.06, g);
        },

        crash_tension: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Pulsing warning tone
            env(g.gain, [[0, 0.12], [0.08, 0.06], [0.15, 0.12], [0.25, 0]], t);
            osc('sine', 880, t, 0.12, g);
            osc('sine', 932, t + 0.005, 0.12, g); // Slight detune for tension
            osc('triangle', 440, t, 0.2, g);
        },

        crash_cashout: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Satisfying cash register ka-ching
            env(g.gain, [[0, 0.35], [0.05, 0.25], [0.25, 0.1], [0.5, 0]], t);
            osc('sine', 1200, t, 0.05, g);
            osc('sine', 1800, t + 0.03, 0.08, g);
            osc('sine', 2400, t + 0.06, 0.15, g);
            noise(0.08, 0.08, { type: 'highpass', freq: 5000 }, masterGain);
            // Bell ring
            osc('sine', 3200, t + 0.1, 0.2, g);
            const o = osc('sine', 3200, t + 0.1, 0.2, g);
            if (o) o.frequency.exponentialRampToValueAtTime(2800, t + 0.3);
        },

        crash_explode: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Deep explosion — noise burst + low frequency impact
            env(g.gain, [[0, 0.4], [0.05, 0.35], [0.2, 0.12], [0.6, 0]], t);
            noise(0.5, 0.25, { type: 'lowpass', freq: 2000 }, masterGain);
            noise(0.2, 0.1, { type: 'highpass', freq: 3000 }, masterGain);
            const o1 = osc('sine', 120, t, 0.4, g);
            if (o1) o1.frequency.exponentialRampToValueAtTime(30, t + 0.4);
            osc('sawtooth', 60, t, 0.3, g);
        },

        crash_win: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Celebration
            env(g.gain, [[0, 0.2], [0.15, 0.18], [0.5, 0]], t);
            osc('sine', 784, t, 0.1, g);
            osc('sine', 988, t + 0.08, 0.1, g);
            osc('sine', 1175, t + 0.16, 0.15, g);
            osc('sine', 1568, t + 0.24, 0.2, g);
        },

        // ══════════════ MINES ══════════════

        mines_tile_click: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.18], [0.01, 0.12], [0.06, 0]], t);
            osc('sine', 600, t, 0.06, g);
            noise(0.02, 0.06, { type: 'highpass', freq: 4000 }, masterGain);
        },

        mines_flip: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Card/tile flip
            env(g.gain, [[0, 0.15], [0.03, 0.08], [0.1, 0]], t);
            const o = osc('sine', 800, t, 0.1, g);
            if (o) o.frequency.linearRampToValueAtTime(1200, t + 0.05);
            noise(0.04, 0.08, { type: 'bandpass', freq: 5000, Q: 3 }, masterGain);
        },

        mines_gem: function (opts) {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const pitch = (opts && opts.pitch) || 1;
            const g = c.createGain();
            g.connect(masterGain);
            // Gem reveal — bright ascending with pitch multiplier for streaks
            const baseFreq = 880 * pitch;
            env(g.gain, [[0, 0.22], [0.04, 0.15], [0.2, 0.05], [0.4, 0]], t);
            osc('sine', baseFreq, t, 0.15, g);
            osc('sine', baseFreq * 1.5, t + 0.02, 0.12, g);
            osc('triangle', baseFreq * 2, t + 0.05, 0.1, g);
            // Sparkle
            noise(0.06, 0.03, { type: 'highpass', freq: 8000 }, masterGain);
        },

        mines_boom: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Deep mine explosion
            env(g.gain, [[0, 0.45], [0.04, 0.4], [0.15, 0.2], [0.5, 0]], t);
            noise(0.4, 0.3, { type: 'lowpass', freq: 1200 }, masterGain);
            noise(0.15, 0.12, { type: 'highpass', freq: 4000 }, masterGain);
            const o = osc('sine', 150, t, 0.35, g);
            if (o) o.frequency.exponentialRampToValueAtTime(25, t + 0.35);
            osc('sawtooth', 80, t, 0.2, g);
        },

        mines_cashout: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Satisfying collect sound
            env(g.gain, [[0, 0.28], [0.1, 0.2], [0.4, 0.05], [0.6, 0]], t);
            const notes = [659, 784, 988, 1319]; // ascending
            notes.forEach((f, i) => {
                osc('sine', f, t + i * 0.06, 0.15, g);
            });
            noise(0.1, 0.04, { type: 'highpass', freq: 6000 }, masterGain);
        },

        mines_chip: function () {
            recipes.bet();
        },

        // ══════════════ TÀI XỈU ══════════════

        taixiu_shaking: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Dice shaking rattle
            env(g.gain, [[0, 0.12], [0.15, 0.18], [0.35, 0.15], [0.5, 0]], t);
            // Multiple short rattles
            for (let i = 0; i < 8; i++) {
                const st = t + i * 0.06;
                noise(0.04, 0.08 + Math.random() * 0.04, { type: 'bandpass', freq: 3000 + Math.random() * 2000, Q: 4 }, masterGain);
                osc('sine', 200 + Math.random() * 100, st, 0.03, g);
            }
        },

        taixiu_dice_roll: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Rolling dice — repeating clicks
            env(g.gain, [[0, 0.2], [0.3, 0.15], [0.6, 0]], t);
            for (let i = 0; i < 10; i++) {
                const st = t + i * 0.05 + Math.random() * 0.02;
                osc('sine', 400 + Math.random() * 200, st, 0.02, g);
                noise(0.02, 0.04, { type: 'bandpass', freq: 4000 + Math.random() * 2000, Q: 5 }, masterGain);
            }
        },

        taixiu_dice_land: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Solid thud + click
            env(g.gain, [[0, 0.3], [0.02, 0.2], [0.1, 0.05], [0.2, 0]], t);
            osc('sine', 200, t, 0.08, g);
            osc('sine', 350, t + 0.01, 0.04, g);
            noise(0.05, 0.12, { type: 'lowpass', freq: 2500 }, masterGain);
        },

        taixiu_open: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Bowl lift — dramatic reveal
            env(g.gain, [[0, 0.2], [0.08, 0.15], [0.25, 0]], t);
            const o = osc('sine', 400, t, 0.25, g);
            if (o) o.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
            noise(0.08, 0.06, { type: 'highpass', freq: 3000 }, masterGain);
            osc('triangle', 800, t + 0.05, 0.1, g);
        },

        // ══════════════ POKER ══════════════

        poker_card_flip: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Crisp card snap
            env(g.gain, [[0, 0.2], [0.015, 0.1], [0.06, 0]], t);
            noise(0.03, 0.15, { type: 'bandpass', freq: 6000, Q: 5 }, masterGain);
            osc('sine', 1500, t, 0.03, g);
        },

        poker_deal: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Smooth card slide
            env(g.gain, [[0, 0.12], [0.04, 0.08], [0.1, 0]], t);
            noise(0.06, 0.1, { type: 'bandpass', freq: 3500, Q: 3 }, masterGain);
            osc('sine', 800, t + 0.01, 0.05, g);
        },

        poker_shuffle: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Card riffle
            env(g.gain, [[0, 0.08], [0.25, 0.12], [0.5, 0]], t);
            for (let i = 0; i < 12; i++) {
                const st = t + i * 0.035 + Math.random() * 0.01;
                noise(0.02, 0.06 + Math.random() * 0.03, { type: 'bandpass', freq: 4000 + Math.random() * 3000, Q: 6 }, masterGain);
            }
        },

        poker_chip_place: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Single chip clack
            env(g.gain, [[0, 0.22], [0.025, 0.1], [0.08, 0]], t);
            osc('sine', 2000, t, 0.03, g);
            osc('sine', 3500, t + 0.01, 0.02, g);
            noise(0.03, 0.08, { type: 'highpass', freq: 5000 }, masterGain);
        },

        poker_chip_stack: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Multiple chips stacking
            env(g.gain, [[0, 0.15], [0.15, 0.18], [0.3, 0]], t);
            for (let i = 0; i < 4; i++) {
                const st = t + i * 0.04;
                osc('sine', 2200 + i * 200, st, 0.03, g);
                noise(0.02, 0.05, { type: 'highpass', freq: 5500 }, masterGain);
            }
        },

        poker_check: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Double tap
            env(g.gain, [[0, 0.15], [0.03, 0.05], [0.08, 0]], t);
            osc('sine', 700, t, 0.03, g);
            osc('sine', 700, t + 0.05, 0.03, g);
        },

        poker_win: function () {
            recipes.bigwin();
        },

        poker_tick: function () {
            recipes.tick();
        },

        // ══════════════ DAILY ══════════════

        daily_spin: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Wheel spin whoosh
            env(g.gain, [[0, 0.15], [0.2, 0.2], [0.6, 0.1], [1.0, 0]], t);
            const o = osc('sine', 200, t, 1.0, g);
            if (o) o.frequency.exponentialRampToValueAtTime(800, t + 0.3);
            noise(0.8, 0.06, { type: 'lowpass', freq: 3000 }, masterGain);
        },

        daily_spin_tick: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Quick tick as wheel passes a segment
            env(g.gain, [[0, 0.12], [0.008, 0.06], [0.025, 0]], t);
            osc('sine', 2000, t, 0.025, g);
        },

        daily_reveal: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Fanfare reveal
            env(g.gain, [[0, 0.25], [0.15, 0.2], [0.5, 0]], t);
            osc('sine', 523, t, 0.12, g);       // C5
            osc('sine', 659, t + 0.08, 0.12, g); // E5
            osc('sine', 784, t + 0.16, 0.15, g); // G5
            osc('sine', 1047, t + 0.24, 0.2, g); // C6
            noise(0.1, 0.03, { type: 'highpass', freq: 7000 }, masterGain);
        },

        daily_win: function () {
            recipes.bigwin();
        },

        // ══════════════ FLAPPY BIRD ══════════════

        flappy_wing: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Quick airy flap
            env(g.gain, [[0, 0.15], [0.02, 0.1], [0.08, 0]], t);
            const o = osc('sine', 600, t, 0.08, g);
            if (o) o.frequency.exponentialRampToValueAtTime(1200, t + 0.04);
            noise(0.04, 0.04, { type: 'highpass', freq: 4000 }, masterGain);
        },

        flappy_point: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Cheerful point ding
            env(g.gain, [[0, 0.2], [0.03, 0.15], [0.15, 0]], t);
            osc('sine', 988, t, 0.08, g);     // B5
            osc('sine', 1319, t + 0.04, 0.1, g); // E6
            osc('triangle', 1319, t + 0.04, 0.06, g);
        },

        flappy_hit: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Impact thud
            env(g.gain, [[0, 0.35], [0.02, 0.25], [0.1, 0.05], [0.2, 0]], t);
            osc('sine', 150, t, 0.12, g);
            noise(0.08, 0.15, { type: 'lowpass', freq: 1500 }, masterGain);
            osc('square', 100, t, 0.06, g);
        },

        flappy_die: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Descending death sound
            env(g.gain, [[0, 0.2], [0.15, 0.12], [0.4, 0]], t);
            const o = osc('sine', 500, t, 0.4, g);
            if (o) o.frequency.exponentialRampToValueAtTime(80, t + 0.4);
            osc('triangle', 300, t + 0.05, 0.25, g);
        },

        flappy_swoosh: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Whoosh transition
            env(g.gain, [[0, 0.08], [0.08, 0.12], [0.2, 0]], t);
            noise(0.2, 0.08, { type: 'bandpass', freq: 2000, Q: 1 }, masterGain);
            const o = osc('sine', 300, t, 0.2, g);
            if (o) o.frequency.exponentialRampToValueAtTime(800, t + 0.15);
        },

        // ══════════════ BLOCK BLAST ══════════════

        bb_place: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Snappy block placement
            env(g.gain, [[0, 0.2], [0.02, 0.12], [0.08, 0]], t);
            osc('sine', 440, t, 0.06, g);
            osc('sine', 660, t + 0.01, 0.04, g);
            noise(0.03, 0.04, { type: 'highpass', freq: 4000 }, masterGain);
        },

        bb_clear: function (opts) {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const pitch = (opts && opts.pitch) || 1;
            const g = c.createGain();
            g.connect(masterGain);
            // Line clear — bright ascending sweep
            const baseF = 523 * pitch;
            env(g.gain, [[0, 0.22], [0.06, 0.18], [0.25, 0]], t);
            const o = osc('sine', baseF, t, 0.25, g);
            if (o) o.frequency.exponentialRampToValueAtTime(baseF * 2, t + 0.2);
            osc('triangle', baseF * 1.5, t + 0.03, 0.15, g);
            noise(0.08, 0.04, { type: 'highpass', freq: 5000 }, masterGain);
        },

        bb_multi: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Multi-clear celebration
            env(g.gain, [[0, 0.25], [0.2, 0.2], [0.5, 0]], t);
            const notes = [523, 659, 784, 1047, 1319];
            notes.forEach((f, i) => {
                osc('sine', f, t + i * 0.05, 0.15, g);
                osc('triangle', f * 0.5, t + i * 0.05, 0.08, g);
            });
            noise(0.15, 0.04, { type: 'highpass', freq: 6000 }, masterGain);
        },

        bb_combo: function (opts) {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const level = (opts && opts.level) || 2;
            const g = c.createGain();
            g.connect(masterGain);
            // Combo — escalating power
            const vol = Math.min(0.3, 0.15 + level * 0.04);
            env(g.gain, [[0, vol], [0.3, vol * 0.7], [0.6, 0]], t);
            const baseNote = 523 + (level - 1) * 100;
            osc('sine', baseNote, t, 0.1, g);
            osc('sine', baseNote * 1.25, t + 0.06, 0.12, g);
            osc('sine', baseNote * 1.5, t + 0.12, 0.15, g);
            osc('sine', baseNote * 2, t + 0.2, 0.18, g);
            // Sparkle
            for (let i = 0; i < level; i++) {
                osc('sine', 2000 + i * 500, t + 0.25 + i * 0.04, 0.08, g);
            }
        },

        bb_pickup: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            env(g.gain, [[0, 0.1], [0.015, 0.06], [0.04, 0]], t);
            osc('sine', 1200, t, 0.04, g);
        },

        bb_invalid: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Error buzz
            env(g.gain, [[0, 0.12], [0.04, 0.08], [0.1, 0]], t);
            osc('square', 200, t, 0.06, g);
            osc('square', 250, t + 0.01, 0.04, g);
        },

        bb_gameover: function () {
            const c = ensure(); if (!c) return;
            const t = c.currentTime;
            const g = c.createGain();
            g.connect(masterGain);
            // Solemn descending
            env(g.gain, [[0, 0.2], [0.25, 0.15], [0.6, 0.05], [0.9, 0]], t);
            const o1 = osc('sine', 440, t, 0.4, g);
            if (o1) o1.frequency.linearRampToValueAtTime(220, t + 0.4);
            const o2 = osc('triangle', 330, t + 0.15, 0.35, g);
            if (o2) o2.frequency.linearRampToValueAtTime(165, t + 0.5);
            osc('sine', 220, t + 0.35, 0.35, g);
            noise(0.15, 0.03, { type: 'lowpass', freq: 1500 }, masterGain);
        }
    };

    // ─── ALIASES (map old names → new recipes) ───
    const aliases = {
        // Global sound-system.js names
        'click': 'click',
        'bet': 'bet',
        'win': 'win',
        'lose': 'lose',
        'open': 'open',
        'tick': 'tick',
        // Crash
        'rocket': 'crash_rocket',
        'tension': 'crash_tension',
        'cashout': 'crash_cashout',
        'crash': 'crash_explode',
        'explode': 'crash_explode',
        // Mines
        'tileClick': 'mines_tile_click',
        'tileClick2': 'mines_tile_click',
        'flip': 'mines_flip',
        'chip': 'mines_chip',
        'gem': 'mines_gem',
        'gem2': 'mines_gem',
        'boom': 'mines_boom',
        // Tài Xỉu
        'shaking': 'taixiu_shaking',
        'dice_roll': 'taixiu_dice_roll',
        'dice_land': 'taixiu_dice_land',
        // Poker
        'card_flip': 'poker_card_flip',
        'deal': 'poker_deal',
        'shuffle': 'poker_shuffle',
        'chip_place': 'poker_chip_place',
        'chip_stack': 'poker_chip_stack',
        'chip_heavy': 'poker_chip_stack',
        'check': 'poker_check',
        // Daily
        'spin': 'daily_spin',
        'spinTick': 'daily_spin_tick',
        'reveal': 'daily_reveal',
        // Flappy
        'wing': 'flappy_wing',
        'point': 'flappy_point',
        'hit': 'flappy_hit',
        'die': 'flappy_die',
        'swoosh': 'flappy_swoosh',
        // Block Blast
        'place': 'bb_place',
        'clear': 'bb_clear',
        'multi': 'bb_multi',
        'combo': 'bb_combo',
        'pickup': 'bb_pickup',
        'invalid': 'bb_invalid',
        'gameover': 'bb_gameover',
    };

    function play(name, opts) {
        // Respect global mute
        const vol = getVol();
        if (vol <= 0) return;

        // Update master volume
        if (masterGain) masterGain.gain.value = vol;

        // Resolve alias
        const resolved = aliases[name] || name;
        const fn = recipes[resolved];
        if (fn) {
            try { fn(opts); } catch (e) { }
        }
    }

    // Expose global API
    window.SFX = {
        play: play,
        ensure: ensure,
        recipes: Object.keys(recipes),
        aliases: Object.keys(aliases)
    };

})();
