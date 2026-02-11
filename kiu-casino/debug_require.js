
try {
    const compression = require('compression');
    console.log('compression loaded successfully');
} catch (e) {
    console.error('Error loading compression:', e);
    console.log('Require paths:', module.paths);
}
