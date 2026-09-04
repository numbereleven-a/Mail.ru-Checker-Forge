const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const targetBrowser = process.argv[2] || 'all';
if (!['all', 'chrome', 'firefox'].includes(targetBrowser)) throw new Error('Expected all, chrome or firefox');
for (const browserName of (targetBrowser === 'all' ? ['chrome', 'firefox'] : [targetBrowser])) {
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const output = path.join(root, 'artifacts', manifest.version, browserName);
if (fs.existsSync(output)) throw new Error('Build directory already exists; move it before rebuilding.');
fs.mkdirSync(output, { recursive: true });
const files = ['background.js', 'popup.html', 'options.html', 'privacy.html',
    'css/options.css', 'css/popup.css', 'js/options.js', 'js/popup.js',
    'js/theme.js', 'js/text-utils.js', 'js/punycode.min.js', 'LICENSE'];
if (browserName === 'chrome') files.push('offscreen.html', 'offscreen.js', 'js/chrome-audio.js');
for (const directory of ['img', 'sound']) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
        if (directory === 'img' && name.startsWith('readme-')) continue;
        if (!/\.(png|wav)$/.test(name)) continue;
        files.push(directory + '/' + name);
    }
}
for (const file of files) {
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
}
if (browserName === 'firefox') {
manifest.background = { scripts: ['js/punycode.min.js', 'js/text-utils.js', 'background.js'] };
manifest.permissions = manifest.permissions.filter(permission => permission !== 'offscreen');
delete manifest.minimum_chrome_version;
manifest.browser_specific_settings = { gecko: {
    id: 'mailru-checker-forge@numbereleven-a',
    strict_min_version: '142.0',
    data_collection_permissions: {
        required: ['personallyIdentifyingInfo', 'authenticationInfo', 'personalCommunications']
    }
} };
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(output);
}
