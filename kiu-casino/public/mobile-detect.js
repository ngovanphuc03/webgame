// ====================================================================
// MOBILE DETECTION & REDIRECT UTILITY
// ====================================================================

(function () {
    'use strict';

    // Check if already on mobile page
    const currentPath = window.location.pathname;
    if (currentPath.includes('-mobile.html')) {
        return; // Already on mobile version, don't redirect
    }

    // Check localStorage preference (allow users to force desktop on mobile)
    const forcedMode = localStorage.getItem('casino_force_desktop');
    if (forcedMode === 'true') {
        return; // User explicitly wants desktop version
    }

    // Detect mobile device
    function isMobileDevice() {
        // Check 1: User Agent
        const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
        const isMobileUA = mobileRegex.test(navigator.userAgent);

        // Check 2: Touch capability
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Check 3: Screen size (mobile typically < 768px width)
        const isSmallScreen = window.innerWidth < 768;

        // Return true if it's mobile UA OR (has touch AND small screen)
        return isMobileUA || (hasTouch && isSmallScreen);
    }

    // Redirect to mobile version
    function redirectToMobile() {
        let mobilePath = '';

        if (currentPath.includes('poker.html')) {
            mobilePath = '/poker-mobile.html' + window.location.search;
        } else if (currentPath.includes('taixiu.html')) {
            mobilePath = '/taixiu-mobile.html' + window.location.search;
        } else if (currentPath === '/' || currentPath.includes('index.html')) {
            mobilePath = '/index-mobile.html';
        } else {
            return; // Unknown page, don't redirect
        }

        // Store detection for analytics
        sessionStorage.setItem('redirected_from_desktop', 'true');

        // Redirect
        window.location.href = mobilePath;
    }

    // Execute detection
    if (isMobileDevice()) {
        redirectToMobile();
    }
})();
