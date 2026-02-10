const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, 'public');
const htmlFiles = fs.readdirSync(pub).filter(f => f.endsWith('.html'));
const notFound = [];

htmlFiles.forEach(htmlFile => {
    const content = fs.readFileSync(path.join(pub, htmlFile), 'utf8');
    const re = /(?:src|href)=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const r = m[1];
        if (!r || r.startsWith('http') || r.startsWith('//') || r.startsWith('data:') ||
            r.startsWith('#') || r === '/' || r.startsWith('/socket.io') || r.startsWith('/api') ||
            r.startsWith('javascript') || r.startsWith('mailto') || r.includes('${') ||
            r.startsWith('/auth') || r === '/manifest.json') continue;

        // For routes like /profile, /taixiu etc these are handled by express routes, skip
        if (r.startsWith('/') && !r.includes('.') && !r.startsWith('/fonts/') && !r.startsWith('/images/') && !r.startsWith('/sounds/') && !r.startsWith('/css/') && !r.startsWith('/js/') && !r.startsWith('/flappy_assets/')) continue;

        const fp = r.startsWith('/') ? path.join(pub, r) : path.join(pub, r);
        if (!fs.existsSync(fp)) notFound.push(`${htmlFile} -> ${r}`);
    }

    // Check url() in inline CSS
    const urlRe = /url\(["']?([^)"'\s]+)["']?\)/g;
    while ((m = urlRe.exec(content)) !== null) {
        const r = m[1];
        if (!r || r.startsWith('http') || r.startsWith('//') || r.startsWith('data:') || r.startsWith('#')) continue;
        const fp = r.startsWith('/') ? path.join(pub, r) : path.join(pub, r);
        if (!fs.existsSync(fp)) notFound.push(`${htmlFile} (css) -> ${r}`);
    }
});

// Check JS files
const jsFiles = ['taixiu.js', 'poker.js'];
jsFiles.forEach(jsFile => {
    const fp = path.join(pub, jsFile);
    if (!fs.existsSync(fp)) return;
    const content = fs.readFileSync(fp, 'utf8');
    const re = /['"`](\/(?:sounds|images|fonts|css|flappy_assets)[^'"`\s]+)['"`]/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const r = m[1];
        const filePath = path.join(pub, r);
        if (!fs.existsSync(filePath)) notFound.push(`${jsFile} -> ${r}`);
    }
});

// Check JS in js/ folder
const jsDir = path.join(pub, 'js');
if (fs.existsSync(jsDir)) {
    fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).forEach(jsFile => {
        const content = fs.readFileSync(path.join(jsDir, jsFile), 'utf8');
        const re = /['"`](\/(?:sounds|images|fonts|css|flappy_assets)[^'"`\s]+)['"`]/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            const r = m[1];
            const filePath = path.join(pub, r);
            if (!fs.existsSync(filePath)) notFound.push(`js/${jsFile} -> ${r}`);
        }
    });
}

// Output
fs.writeFileSync(path.join(__dirname, 'results.txt'), notFound.length ? notFound.join('\n') : 'ALL OK - No 404s found', 'utf8');
console.log('Done. Found ' + notFound.length + ' broken refs');
notFound.forEach(r => console.log('  X ' + r));
