const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, 'public');
const files = fs.readdirSync(pub).filter(f => f.endsWith('.html'));

let count = 0;
files.forEach(f => {
    const fp = path.join(pub, f);
    let content = fs.readFileSync(fp, 'utf8');
    const original = content;
    content = content.replace(
        /<meta name="apple-mobile-web-app-capable" content="yes">/g,
        '<meta name="mobile-web-app-capable" content="yes">'
    );
    if (content !== original) {
        fs.writeFileSync(fp, content, 'utf8');
        count++;
        console.log('Fixed: ' + f);
    }
});
console.log('Total fixed: ' + count);
