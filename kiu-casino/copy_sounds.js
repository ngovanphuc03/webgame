const fs = require('fs');
const path = require('path');

const srcBase = 'd:/CasinoWebApp/JDSherbert - Tabletop Games SFX Pack (FREE)/Free/Mono/mp3';
const destBase = 'd:/CasinoWebApp/kiu-casino/public/sounds/poker';

const mapping = {
    'JDSherbert - Tabletop Games SFX Pack - Deck Shuffle - 1.mp3': 'shuffle.mp3',
    'JDSherbert - Tabletop Games SFX Pack - Piece Impact - 1.mp3': 'chip_place.mp3',
    'JDSherbert - Tabletop Games SFX Pack - Paper Flip - 1.mp3': 'card_flip.mp3',
    'JDSherbert - Tabletop Games SFX Pack - Piece Move - 1.mp3': 'check.mp3',
    'JDSherbert - Tabletop Games SFX Pack - Deck Deal - 1.mp3': 'deal.mp3'
};

Object.keys(mapping).forEach(file => {
    try {
        fs.copyFileSync(path.join(srcBase, file), path.join(destBase, mapping[file]));
        console.log('Copied ' + mapping[file]);
    } catch (e) {
        console.error('Failed to copy ' + file + ': ' + e.message);
    }
});
