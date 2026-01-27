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

    // Detect mobile device
    function isMobileDevice() {
        // 1. Check User Agent (Cũ nhưng vẫn cần)
        const ua = navigator.userAgent;
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);

        // 2. Check iPadOS 13+ (Giả dạng Mac)
        const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // 3. Check Touch Points (Chuẩn nhất cho thiết bị cảm ứng hiện đại)
        const hasTouch = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window);

        // 4. Kết luận: Là Mobile nếu là Android/iOS/iPadOS HOẶC là màn hình cảm ứng nhỏ
        return isAndroid || isIOS || isIPadOS || (hasTouch && window.innerWidth < 1024);
    }

    // Redirect to mobile version
    function redirectToMobile() {
        let mobilePath = '';
        const path = window.location.pathname; // Get current path

        // Check both route names and file names for server compatibility
        if (path === '/poker' || path.includes('poker.html')) {
            mobilePath = '/poker-mobile.html' + window.location.search;
        } else if (path === '/taixiu' || path.includes('taixiu.html')) {
            mobilePath = '/taixiu-mobile.html' + window.location.search;
        } else if (path === '/' || path.includes('index.html')) {
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
