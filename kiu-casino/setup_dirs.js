const fs = require('fs');
const path = require('path');

const dest = 'd:/CasinoWebApp/kiu-casino/public';
const dirs = ['images/poker/cards', 'images/poker/chips', 'sounds/poker'];

// Create dirs
dirs.forEach(d => fs.mkdirSync(path.join(dest, d), { recursive: true }));

console.log('Dirs created.');
