const fs = require('fs');
const path = require('path');

const dir = 'd:/CasinoWebApp/kiu-casino/public';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

for (const f of files) {
    const fp = path.join(dir, f);
    let c = fs.readFileSync(fp, 'utf8');
    if (c.includes('sound-system.js') && !c.includes('ppz-sfx-engine')) {
        c = c.replace(
            '<script src="/js/sound-system.js"></script>',
            '<script src="/js/ppz-sfx-engine.js"></script>\n    <script src="/js/sound-system.js"></script>'
        );
        fs.writeFileSync(fp, c, 'utf8');
        console.log('Updated:', f);
    }
}
console.log('Done');
