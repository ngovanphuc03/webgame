// Generate PWA icons from SVG
// Run: node generate-icons.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'images', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Create a simple SVG icon for each size
sizes.forEach(size => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#030014"/>
      <stop offset="50%" style="stop-color:#1a0a3e"/>
      <stop offset="100%" style="stop-color:#030014"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00f0ff"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="url(#bg)"/>
  <rect x="${Math.round(size * 0.04)}" y="${Math.round(size * 0.04)}" width="${Math.round(size * 0.92)}" height="${Math.round(size * 0.92)}" rx="${Math.round(size * 0.15)}" fill="none" stroke="url(#glow)" stroke-width="${Math.max(1, Math.round(size * 0.015))}"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(size * 0.45)}" fill="url(#glow)" font-family="sans-serif" font-weight="900">PP</text>
  <text x="50%" y="80%" text-anchor="middle" font-size="${Math.round(size * 0.1)}" fill="#00f0ff" font-family="sans-serif" opacity="0.7">PLAYZONE</text>
</svg>`;
    fs.writeFileSync(path.join(dir, `icon-${size}.svg`), svg);
    console.log(`✅ Generated icon-${size}.svg`);
});

// Also create a simple PNG placeholder using a data URI approach
// For production, convert SVGs to PNGs using sharp or an online tool
console.log('\n📝 SVG icons generated! For PNG conversion, use:');
console.log('   npx sharp-cli -i public/images/icons/icon-512.svg -o public/images/icons/icon-512.png');
console.log('   Or use https://svgtopng.com/');
