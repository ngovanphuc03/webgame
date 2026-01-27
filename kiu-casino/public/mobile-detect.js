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
    const lastRedirect = sessionStorage.getItem('last_mobile_redirect');
    if (lastRedirect) {
        const timeSince = Date.now() - parseInt(lastRedirect);
        if (timeSince < 5000) {
            console.warn('[Mobile Detect] Redirect too recent, preventing loop');
            return;
        }
    }

    // Detect mobile device
    function isMobileDevice() {
        const ua = navigator.userAgent;
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const hasTouch = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
        return isAndroid || isIOS || isIPadOS || (hasTouch && window.innerWidth < 1024);
    }

    // Check if user is logged in
    async function isLoggedIn() {
        try {
            const res = await fetch('/api/me');
            const data = await res.json();
            return !data.error && data.balance !== undefined;
        } catch {
            return false;
        }
    }

    // Redirect to mobile version
    function redirectToMobile() {
        let mobilePath = '';
        const path = window.location.pathname;

        if (path === '/poker' || path.includes('poker.html')) {
            mobilePath = '/poker-mobile.html' + window.location.search;
        } else if (path === '/taixiu' || path.includes('taixiu.html')) {
            mobilePath = '/taixiu-mobile.html' + window.location.search;
        } else if (path === '/' || path.includes('index.html')) {
            mobilePath = '/index-mobile.html';
        } else {
            return; // Unknown page, don't redirect
        }

        sessionStorage.setItem('last_mobile_redirect', Date.now().toString());
        console.log('[Mobile Detect] Redirecting to:', mobilePath);
        window.location.href = mobilePath;
    }

    // Execute: Only redirect if mobile AND logged in
    if (isMobileDevice()) {
        isLoggedIn().then(loggedIn => {
            if (loggedIn) {
                redirectToMobile();
            } else {
                console.log('[Mobile Detect] Not logged in, staying on desktop for login');
            }
        });
    }
})();
