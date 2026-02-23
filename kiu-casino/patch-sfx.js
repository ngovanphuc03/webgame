const fs = require('fs');

// ─── MINES ───
let mines = fs.readFileSync('d:/CasinoWebApp/kiu-casino/public/mines.html', 'utf8');

// Debug: find play function
const idx = mines.indexOf('function play(name)');
if (idx > -1) {
    // Check 200 chars around the match
    const start = Math.max(0, idx - 20);
    const context = mines.substring(start, idx + 200);
    console.log('Found play() at index', idx);

    // Check if SFX engine already integrated
    const before = mines.substring(Math.max(0, idx - 300), idx);
    if (before.includes('SFX') || mines.substring(idx, idx + 500).includes('SFX')) {
        console.log('Mines: SFX already integrated!');
    } else {
        // Insert SFX routing after the opening brace
        const afterFunc = mines.indexOf('{', idx);
        const nextLine = mines.indexOf('\n', afterFunc);
        const insertPoint = nextLine + 1;
        const insertion = '                // Try SFX engine first\n                if (window.SFX && window.SFX.play) { try { window.SFX.play(name); return; } catch(e) {} }\n';
        mines = mines.substring(0, insertPoint) + insertion + mines.substring(insertPoint);
        console.log('Mines: play() patched');
    }
} else {
    console.log('Mines: play() NOT FOUND');
}

// playGemStreak
const gemIdx = mines.indexOf('function playGemStreak(n)');
if (gemIdx > -1) {
    if (mines.substring(gemIdx, gemIdx + 300).includes('SFX')) {
        console.log('Mines: playGemStreak already patched');
    } else {
        const braceIdx = mines.indexOf('{', gemIdx);
        const nextLine = mines.indexOf('\n', braceIdx);
        const insertPoint = nextLine + 1;
        const insertion = '                // SFX engine handles pitch natively\n                if (window.SFX && window.SFX.play) { const p = 1 + Math.min(n, 18) * 0.028; try { window.SFX.play(\'mines_gem\', { pitch: p }); return; } catch(e) {} }\n';
        mines = mines.substring(0, insertPoint) + insertion + mines.substring(insertPoint);
        console.log('Mines: playGemStreak() patched');
    }
}

fs.writeFileSync('d:/CasinoWebApp/kiu-casino/public/mines.html', mines, 'utf8');

// ─── DAILY ───
let daily = fs.readFileSync('d:/CasinoWebApp/kiu-casino/public/daily.html', 'utf8');

const dailyIdx = daily.indexOf('function playSound(');
if (dailyIdx > -1) {
    if (daily.substring(dailyIdx, dailyIdx + 500).includes('SFX')) {
        console.log('Daily: Already patched');
    } else {
        const braceIdx = daily.indexOf('{', dailyIdx);
        const nextLine = daily.indexOf('\n', braceIdx);
        const insertPoint = nextLine + 1;
        const insertion = `            // Try SFX engine first
            if (window.SFX && window.SFX.play) {
                const nameMap = { spin: 'daily_spin', spinTick: 'daily_spin_tick', reveal: 'daily_reveal', win: 'daily_win', click: 'click', tick: 'tick' };
                try { window.SFX.play(nameMap[name] || name); return; } catch (e) { }
            }
`;
        daily = daily.substring(0, insertPoint) + insertion + daily.substring(insertPoint);
        console.log('Daily: playSound() patched');
    }
} else {
    console.log('Daily: playSound() NOT FOUND');
}

fs.writeFileSync('d:/CasinoWebApp/kiu-casino/public/daily.html', daily, 'utf8');

// ─── BLOCK BLAST ───
let bb = fs.readFileSync('d:/CasinoWebApp/kiu-casino/public/js/blockblast.js', 'utf8');
const bbIdx = bb.indexOf('function sfx(');
if (bbIdx > -1) {
    if (bb.substring(bbIdx, bbIdx + 300).includes('SFX')) {
        console.log('BlockBlast: Already patched');
    } else {
        const braceIdx = bb.indexOf('{', bbIdx);
        const nextLine = bb.indexOf('\n', braceIdx);
        const insertPoint = nextLine + 1;
        const insertion = '    // Use SFX engine for premium sounds\n    if (window.SFX && window.SFX.play) { try { window.SFX.play(n); return; } catch(e) {} }\n';
        bb = bb.substring(0, insertPoint) + insertion + bb.substring(insertPoint);
        console.log('BlockBlast: sfx() patched');
    }
} else {
    console.log('BlockBlast: sfx() NOT FOUND - checking for inline sound...');
    // Block blast may use a different pattern
    const bbSfx = bb.indexOf('sfx(');
    console.log('Found sfx( at:', bbSfx);
}

fs.writeFileSync('d:/CasinoWebApp/kiu-casino/public/js/blockblast.js', bb, 'utf8');

console.log('\nPatch complete!');
