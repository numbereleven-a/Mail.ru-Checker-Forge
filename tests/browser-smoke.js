// Run against an extracted release folder. Requires playwright (Chrome) or selenium-webdriver (Firefox).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const kind = process.argv[2];
const packageDir = path.resolve(process.argv[3]);
const reportDir = path.resolve(process.argv[4]);
const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
fs.mkdirSync(reportDir, { recursive: true });

// Only synthetic mail in an isolated browser profile; no real mailbox actions.
function installFixture(w = globalThis) {
    w.app.account.pause();
    w.app.account.clear();
    const emails = ['first@example.com', 'second@example.com'];
    const messages = Object.fromEntries(emails.map(email => [email, Array.from({ length: 7 }, (_, i) => ({
        id: email.split('@')[0] + '-' + i, folder: '0', date: 1700000000 + i,
        subject: 'Message &#x1F600; ' + i, flags: { unread: true },
        correspondents: { from: [{ name: 'Demo Sender', email: 'sender@example.com' }] }
    }))]));
    w.app.utils.request = function(options, callback, onError) {
        const url = new URL(options.url);
        const email = url.searchParams.get('email');
        let data;
        if (url.pathname === '/NaviData') data = { status: 'ok', data: { email: emails[0], list: emails, mail_cnt: 14 } };
        else if (url.pathname.endsWith('/tokens')) data = { status: 200, body: { token: 'test-placeholder' } };
        else if (url.pathname.endsWith('/folders')) data = { status: 200, body: { inbox: { id: '0', messages_unread: messages[email].length } } };
        else if (url.pathname.includes('/messages/')) data = { status: 200, body: messages[email] };
        else if (url.pathname.includes('/threads/')) {
            const params = new URLSearchParams(options.params);
            const ids = JSON.parse(params.get('message_id_last'));
            const targetEmail = params.get('email');
            messages[targetEmail] = messages[targetEmail].filter(m => !Object.values(ids).includes(m.id));
            data = { status: 200 };
        } else { if (onError) onError(new Error('Unexpected fixture request')); return; }
        w.setTimeout(() => callback(JSON.stringify(data)), 5);
    };
    w.app.account = new w.Account(true);
    w.app.account.resume();
    w.app.account.start();
}

async function run(ui) {
    await ui.fixture();
    await ui.wait(async () => (await ui.data()).account.ready && Object.keys((await ui.data()).account.users).length === 2);
    await ui.go('options.html');
    await ui.wait(async () => await ui.evaluate(() => document.querySelectorAll('.mailbox-row').length === 2));
    assert.equal(await ui.evaluate(() => document.getElementById('app_version').textContent), 'Версия ' + manifest.version);
    await ui.evaluate(() => {
        document.getElementById('message_limit').value = '2';
        document.getElementById('message_limit').dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('theme_select').value = 'dark';
        document.getElementById('theme_select').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ui.wait(async () => await ui.evaluate(() => document.documentElement.classList.contains('dark-theme')));
    for (const sound of ['01-glass-drop.wav','02-soft-bell.wav','03-airy-chime.wav','04-warm-pluck.wav',
        '05-gentle-pop.wav','06-clear-double.wav','07-mellow-triad.wav','08-minimal-ping.wav']) {
        const loaded = await ui.evaluate(async file => {
            const audio = document.getElementById('sound');
            audio.src = 'sound/' + file;
            await audio.play();
            const duration = audio.duration;
            audio.pause();
            return Number.isFinite(duration) && duration > 0;
        }, sound);
        assert(loaded, 'Sound must decode: ' + sound);
    }
    await ui.screenshot('options');
    await ui.go('popup.html');
    await ui.wait(async () => await ui.evaluate(() => document.querySelectorAll('.mes').length === 4));
    assert.equal(await ui.evaluate(() => document.querySelectorAll('.account').length), 2);
    assert(await ui.evaluate(() => document.documentElement.classList.contains('dark-theme')), 'Theme must persist in popup');
    assert((await ui.evaluate(() => document.querySelector('.subject').textContent)).includes('😀'));
    await ui.click('[data-message-action="read"][data-email="first@example.com"]');
    await ui.wait(async () => (await ui.data()).account.users['first@example.com'].count === 6);
    await ui.click('[data-message-action="delete"][data-email="second@example.com"]');
    await ui.wait(async () => (await ui.data()).account.users['second@example.com'].count === 6);
    await ui.wait(async () => await ui.evaluate(() =>
        !document.querySelector('[data-msg-id="first-0"]') && !document.querySelector('[data-msg-id="second-0"]') &&
        document.querySelectorAll('.mes').length === 4));
    await ui.evaluate(() => { document.getElementById('content').scrollTop = 0; });
    await ui.wait(async () => await ui.evaluate(() => Array.from(document.querySelectorAll('.mes')).every(el => Number(getComputedStyle(el).opacity) > 0.99)));
    await ui.screenshot('popup');
    await ui.backgroundSound();
    const details = { browser: kind, version: manifest.version, result: 'PASS', checks: [
        'extension loaded', 'two mailboxes', 'saved limit and dark theme', 'Unicode subject',
        'read and delete through runtime messaging (synthetic API)', 'eight WAVs decoded and played', 'background sound'
    ] };
    fs.writeFileSync(path.join(reportDir, kind + '-smoke.json'), JSON.stringify(details, null, 2) + '\n');
    console.log(JSON.stringify(details));
}

async function firefoxTest() {
    const { Builder, By } = require('selenium-webdriver');
    const firefox = require('selenium-webdriver/firefox');
    const driver = await new Builder().forBrowser('firefox')
        .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'))
        .setFirefoxOptions(new firefox.Options().addArguments('-headless').setPreference('media.autoplay.default', 0)).build();
    try {
        await driver.manage().setTimeouts({ script: 15000 });
        await driver.manage().window().setRect({ width: 1000, height: 1200 });
        const id = await driver.installAddon(packageDir, true);
        await driver.setContext('chrome');
        const uuid = await driver.executeScript('return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;', id);
        await driver.setContext('content');
        const base = 'moz-extension://' + uuid + '/';
        await driver.get(base + 'options.html');
        const evaluate = (fn, ...args) => driver.executeAsyncScript(
            'const done=arguments[arguments.length-1]; Promise.resolve((' + fn.toString() + ')(...Array.from(arguments).slice(0,-1))).then(value=>done({value}),error=>done({error:String(error)}));', ...args
        ).then(result => { if (result.error) throw new Error(result.error); return result.value; });
        await run({
            go: file => driver.get(base + file), evaluate,
            wait: fn => driver.wait(fn, 15000),
            click: selector => driver.findElement(By.css(selector)).click(),
            fixture: () => driver.executeAsyncScript('const done=arguments[arguments.length-1]; browser.runtime.getBackgroundPage().then(bg=>{(' + installFixture.toString() + ')(bg);done(true);});'),
            data: () => evaluate(async () => (await browser.runtime.sendMessage({ action: 'getData' })).data),
            screenshot: async label => fs.writeFileSync(path.join(reportDir, kind + '-' + label + '.png'), await driver.takeScreenshot(), 'base64'),
            backgroundSound: async () => {
                const result = await evaluate(async () => {
                    const bg = await browser.runtime.getBackgroundPage();
                    bg.app.sound.play('05-gentle-pop.wav');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const a = bg.backgroundAudio;
                    return a ? { time: a.currentTime, paused: a.paused, ready: a.readyState, error: a.error && a.error.code, src: a.src.split('/').pop() } : { missing: true };
                });
                assert(result.time > 0 && !result.error, 'Firefox background sound must play: ' + JSON.stringify(result));
            }
        });
    } finally { await driver.quit(); }
}

async function chromeTest() {
    const { chromium } = require('playwright');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-smoke-'));
    const context = await chromium.launchPersistentContext(profile, {
        headless: true, channel: 'chromium', viewport: { width: 1000, height: 1200 },
        args: ['--disable-extensions-except=' + packageDir, '--load-extension=' + packageDir, '--autoplay-policy=no-user-gesture-required']
    });
    try {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const base = worker.url().replace(/background\.js$/, '');
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + 'options.html');
        await run({
            go: file => page.goto(base + file), evaluate: (fn, arg) => page.evaluate(fn, arg),
            wait: async fn => {
                const deadline = Date.now() + 15000;
                while (!await fn()) { if (Date.now() > deadline) throw new Error('Browser wait timed out'); await new Promise(resolve => setTimeout(resolve, 50)); }
            },
            click: selector => page.locator(selector).first().click(),
            fixture: () => worker.evaluate(installFixture),
            data: () => page.evaluate(async () => (await chrome.runtime.sendMessage({ action: 'getData' })).data),
            screenshot: label => page.screenshot({ path: path.join(reportDir, kind + '-' + label + '.png'),
                clip: label === 'popup' ? { x: 0, y: 0, width: 380, height: 500 } : undefined }),
            backgroundSound: async () => {
                await worker.evaluate(async () => { await Promise.all([createOffscreen(), createOffscreen()]); });
                assert(await worker.evaluate(async () => {
                    return (await chrome.runtime.sendMessage({ type: 'playSound', soundFile: '05-gentle-pop.wav', volume: 0.1 })).success;
                }), 'Chrome offscreen sound must play');
            }
        });
        assert.deepEqual(errors, [], 'No popup/options JavaScript errors');
    } finally { await context.close(); }
}

(kind === 'firefox' ? firefoxTest() : chromeTest()).catch(error => { console.error(error); process.exitCode = 1; });
