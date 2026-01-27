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

    // CRITICAL: Prevent redirect loop
    // If we've redirected in the last 5 seconds, don't redirect again
    const lastRedirect = sessionStorage.getItem('last_mobile_redirect');
    if (lastRedirect) {
        const timeSince = Date.now() - parseInt(lastRedirect);
        if (timeSince < 5000) {
            console.warn('[Mobile Detect] Redirect too recent, preventing loop');
            return;
        }
    }

    // Check localStorage preference (allow users to force desktop on mobile)
    const forcedMode = localStorage.getItem('casino_force_desktop');
    if (forcedMode === 'true') {
        return; // User explicitly wants desktop version
    }

    // Detect mobile device
    function isMobileDevice() {
        // Check 1: User Agent (most reliable)
        const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
        const isMobileUA = mobileRegex.test(navigator.userAgent);

        // Check 2: Touch capability
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Check 3: Screen size (mobile typically < 768px width)
        const isSmallScreen = window.innerWidth < 768;

        // More strict: Require mobile UA AND (small screen OR touch)
        // This prevents desktop browsers with touch from being detected as mobile
        return isMobileUA && (isSmallScreen || hasTouch);
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

        // Mark redirect timestamp BEFORE redirecting
        sessionStorage.setItem('last_mobile_redirect', Date.now().toString());
        sessionStorage.setItem('redirected_from_desktop', 'true');

        // Redirect
        console.log('[Mobile Detect] Redirecting to:', mobilePath);
        window.location.href = mobilePath;
    }

    // Execute detection
    if (isMobileDevice()) {
        redirectToMobile();
    }
})();
