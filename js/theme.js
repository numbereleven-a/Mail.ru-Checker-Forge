(function() {
    function applyTheme(theme) {
        if (theme === 'dark' || (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark-theme');
        } else {
            document.documentElement.classList.remove('dark-theme');
        }
    }

    try {
        chrome.storage.local.get('theme', function(result) {
            applyTheme(result.theme || 'system');
        });
        
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
                chrome.storage.local.get('theme', function(result) {
                    if ((result.theme || 'system') === 'system') {
                        applyTheme('system');
                    }
                });
            });
        }
    } catch (e) {
        // Fallback for context outside extension if needed, though unlikely
        applyTheme('system');
    }
})();
