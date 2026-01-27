// ====================================================================
// DESKTOP REDIRECT - For mobile pages only
// Redirects desktop users back to desktop pages
// ====================================================================

(function () {
    'use strict';

    // Only run on mobile pages
    const currentPath = window.location.pathname;
    if (!currentPath.includes('-mobile.html')) {
        return; // Not on mobile page
    }

    // Detect if this is a desktop device
    function isDesktopDevice() {
        const ua = navigator.userAgent;
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const hasTouch = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window);

        // Return TRUE if this is DESKTOP (NOT mobile)
        const isMobile = isAndroid || isIOS || isIPadOS || (hasTouch && window.innerWidth < 1024);
        return !isMobile;
    }

    // Redirect to desktop version
    function redirectToDesktop() {
        let desktopPath = '';

        if (currentPath.includes('poker-mobile.html')) {
            desktopPath = '/poker.html' + window.location.search;
        } else if (currentPath.includes('taixiu-mobile.html')) {
            desktopPath = '/taixiu.html' + window.location.search;
        } else if (currentPath.includes('index-mobile.html')) {
            desktopPath = '/index.html';
        } else {
            return; // Unknown mobile page
        }

        console.log('[Desktop Redirect] Redirecting to:', desktopPath);
        window.location.href = desktopPath;
    }

    // Execute redirect if desktop
    if (isDesktopDevice()) {
        redirectToDesktop();
    }
})();
