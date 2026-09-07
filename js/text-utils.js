function decodeHtmlEntities(text) {
    if (!text) return '';
    var entities = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    return String(text).replace(/&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+)|\w+);/g, function(m) {
        if (m.startsWith('&#')) {
            var hex = m[2].toLowerCase() === 'x';
            var num = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
            if (num === 0 || num > 0x10ffff || (num >= 0xd800 && num <= 0xdfff)) return '\uFFFD';
            return String.fromCodePoint(num);
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
