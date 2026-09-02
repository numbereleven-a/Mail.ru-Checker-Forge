function decodeHtmlEntities(text) {
    if (!text) return '';
    var entities = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    return text.replace(/&[#\w]+;/g, function(m) {
        if (m.startsWith('&#')) {
            var num = parseInt(m.replace(/[&#;]/g, ''), 10);
            if (!isNaN(num)) return String.fromCharCode(num);
        }
        return entities[m] || m;
    });
}

function normalizeHttpsUrl(value) {
    var normalized = decodeHtmlEntities(value || '');
    if (normalized && normalized.indexOf('//') === 0) normalized = 'https:' + normalized;
    try {
        var url = new URL(normalized);
        return url.protocol === 'https:' ? url.href : '';
    } catch (error) {
        return '';
    }
}

function normalizeMessageDisplayLimit(value) {
    var limit = Number(value);
    if (!Number.isFinite(limit) || limit < 1) return 5;
    return Math.min(100, Math.max(1, Math.floor(limit)));
}
