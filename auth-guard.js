// ═══════════════════════════════════════════════════════════════
// auth-guard.js — Client-side auth guard for protected pages
// Include via <script src="/auth-guard.js"></script> in <head>
// Redirects to /login if no valid session exists
// ═══════════════════════════════════════════════════════════════
(function() {
    var raw = sessionStorage.getItem('medGzuriSession');
    if (!raw) {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        return;
    }
    try {
        var session = JSON.parse(raw);
        // Check token expiry
        if (session.expires_at && Date.now() / 1000 > session.expires_at) {
            sessionStorage.removeItem('medGzuriSession');
            sessionStorage.removeItem('medGzuriLoggedIn');
            sessionStorage.removeItem('medGzuriLoginTime');
            window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
            return;
        }
        // Expose session globally for other scripts
        window.__medSession = session;
        window.__medUser = session.user || {};
    } catch(e) {
        sessionStorage.removeItem('medGzuriSession');
        window.location.href = '/login';
    }
})();
