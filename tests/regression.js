const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = process.env.FORGE_PROJECT_ROOT || path.join(__dirname, '..');
const backgroundPath = path.join(projectRoot, 'background.js');
const popupPath = path.join(projectRoot, 'js', 'popup.js');
const textUtilsPath = path.join(projectRoot, 'js', 'text-utils.js');
const optionsPath = path.join(projectRoot, 'js', 'options.js');
const optionsHtmlPath = path.join(projectRoot, 'options.html');
const manifestPath = path.join(projectRoot, 'manifest.json');
const packageIsFirefox = Array.isArray(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).background.scripts);

const wait = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));

function createBackgroundEnvironment(firefox = packageIsFirefox) {
    const storage = { timetest: 30000, interface: 'win' };
    const sessionStorage = {};
    const messageListeners = [];
    const idleListeners = [];
    const alarmListeners = [];
    const alarmCreates = [];
    const alarmClears = [];
    const calls = [];
    const notificationOptions = [];
    const multiKeyGets = [];
    const emails = ['first@example.com', 'second@example.com'];
    const folderBodies = {
        'first@example.com': { inbox: { id: '0', messages_unread: 1 } },
        'second@example.com': { inbox: { id: '0', messages_unread: 1 } }
    };
    const messageBodies = {
        'first@example.com': [{ id: 'first-old', folder: '0', date: 1, flags: { unread: true } }],
        'second@example.com': [{ id: 'second-old', folder: '0', date: 1, flags: { unread: true } }]
    };
    let actionHttpOk = true;
    let actionStatus = 200;
    let failNextMessageRequestFor = null;

    const noopListener = { addListener() {} };
    const chrome = {
        storage: {
            local: {
                get(key, callback) {
                    if (key === null) return callback({ ...storage });
                    if (Array.isArray(key)) {
                        multiKeyGets.push([...key]);
                        const result = {};
                        for (const item of key) result[item] = storage[item];
                        return callback(result);
                    }
                    callback({ [key]: storage[key] });
                },
                set(value, callback) {
                    Object.assign(storage, value);
                    if (callback) callback();
                }
            },
            session: {
                get(key, callback) { callback({ [key]: sessionStorage[key] }); },
                set(value, callback) {
                    Object.assign(sessionStorage, value);
                    if (callback) callback();
                }
            }
        },
        runtime: {
            lastError: null,
            onInstalled: noopListener,
            onMessage: { addListener(listener) { messageListeners.push(listener); } },
            sendMessage() { return Promise.resolve(); },
            getURL(file) { return `chrome-extension://test/${file}`; }
        },
        action: {
            setBadgeText() {}, setIcon() {}, setBadgeBackgroundColor() {}, setPopup() {}
        },
        notifications: {
            onClosed: noopListener,
            onClicked: noopListener,
            onButtonClicked: noopListener,
            create(_id, options, callback) { notificationOptions.push(options); callback('notification'); },
            clear(_id, callback) { if (callback) callback(true); }
        },
        idle: {
            onStateChanged: { addListener(listener) { idleListeners.push(listener); } },
            queryState(_seconds, callback) { callback('active'); }
        },
        alarms: {
            onAlarm: { addListener(listener) { alarmListeners.push(listener); } },
            get(_name, callback) { callback(null); },
            create(name, options) { alarmCreates.push({ name, options }); },
            clear(name, callback) {
                alarmClears.push(name);
                if (callback) callback(true);
            }
        },
        tabs: { create() {} },
        offscreen: {
            async hasDocument() { return true; },
            async createDocument() {}
        }
    };

    function emailFromUrl(url) {
        return new URL(url).searchParams.get('email') || new URL(url).searchParams.get('x-email');
    }
    function response(body, ok = true, status = 200) {
        return Promise.resolve({
            ok,
            status,
            headers: { get() { return 'application/json'; } },
            text() { return Promise.resolve(JSON.stringify(body)); }
        });
    }

    const context = {
        chrome,
        console,
        importScripts(...files) {
            if (files.includes('js/chrome-audio.js')) {
                vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js/chrome-audio.js'), 'utf8'), context, { filename: 'js/chrome-audio.js' });
            }
            if (files.includes('js/text-utils.js')) {
                vm.runInContext(fs.readFileSync(textUtilsPath, 'utf8'), context, { filename: 'js/text-utils.js' });
            }
        },
        URL,
        URLSearchParams,
        AbortController,
        setTimeout(callback, delay, ...args) {
            const timer = setTimeout(callback, delay, ...args);
            if (delay > 1000 && timer.unref) timer.unref();
            return timer;
        },
        clearTimeout,
        setInterval() { return 1; },
        fetch(url, options = {}) {
            calls.push({ url, options });
            if (url.includes('NaviData')) {
                return response({ status: 'ok', data: { email: emails[0], mail_cnt: 2, list: emails } });
            }
            if (url.includes('/tokens')) return response({ status: 200, body: { token: 'secret-token' } });
            if (url.includes('/folders')) return response({ status: 200, body: folderBodies[emailFromUrl(url)] });
            if (url.includes('/messages/')) {
                const email = emailFromUrl(url);
                if (failNextMessageRequestFor === email) {
                    failNextMessageRequestFor = null;
                    return response({ status: 500 }, false, 500);
                }
                return response({ status: 200, body: messageBodies[email] });
            }
            if (url.includes('/threads/')) return response({ status: actionStatus }, actionHttpOk, actionHttpOk ? 200 : 500);
            return response({});
        },
        self: { addEventListener() {} }
    };

    if (firefox) {
        delete context.importScripts;
        delete chrome.offscreen;
        delete chrome.notifications.onButtonClicked;
        context.browser = { runtime: { getBrowserInfo() {} } };
        context.Audio = class {
            pause() {}
            async play() { this.played = true; }
        };
        chrome.runtime.sendMessage = function(message, callback) { if (callback) callback(); };
    }
    vm.createContext(context);
    if (firefox) {
        for (const file of ['js/punycode.min.js', 'js/text-utils.js']) {
            vm.runInContext(fs.readFileSync(path.join(projectRoot, file), 'utf8'), context, { filename: file });
        }
    }
    vm.runInContext(fs.readFileSync(backgroundPath, 'utf8'), context, { filename: 'background.js' });

    return {
        context,
        calls,
        messageListeners,
        idleListeners,
        alarmListeners,
        alarmCreates,
        alarmClears,
        storage,
        folderBodies,
        messageBodies,
        multiKeyGets,
        notificationOptions,
        setActionResponse(httpOk, apiStatus) {
            actionHttpOk = httpOk;
            actionStatus = apiStatus;
        },
        failNextMessageRequest(email) {
            failNextMessageRequestFor = email;
        }
    };
}

async function testBackground() {
    const env = createBackgroundEnvironment();
    const { context } = env;
    await wait();

    assert.deepStrictEqual(Object.keys(context.app.account.users).sort(), ['first@example.com', 'second@example.com']);
    assert.strictEqual(env.storage.repeatUnreadSound, false, 'Unread reminder must be disabled by default');
    assert.strictEqual(env.storage.messageLimit, 5, 'Five messages must be the default display limit');
    assert.strictEqual(env.storage.soundtrek, '05-gentle-pop.wav', 'Gentle pop must be the default notification sound');
    assert.strictEqual(context.normalizeSoundFile('4.wav'), '05-gentle-pop.wav', 'Legacy sounds must migrate to the new default');
    assert.strictEqual(context.normalizeSoundFile('01-glass-drop.wav'), '01-glass-drop.wav', 'New sound choices must remain unchanged');
    assert.strictEqual(context.normalizeSoundFile('0'), '0', 'Muted sound choice must remain unchanged');
    assert.strictEqual(env.multiKeyGets.length, 2, 'Each User must initialize from one multi-key storage read');
    assert(env.multiKeyGets.every(keys => keys.length === 2), 'User initialization must read all required state together');

    const initialMessageFetches = env.calls.filter(call => call.url.includes('/messages/')).length;
    env.messageBodies['first@example.com'] = [{ id: 'first-new', folder: '0', date: 2, subject: 'Subject', snippet: 'Private preview', privateField: 'private', flags: { unread: true } }];
    context.app.account.start();
    await wait();
    const nextMessageFetches = env.calls.filter(call => call.url.includes('/messages/')).length;
    assert.strictEqual(nextMessageFetches - initialMessageFetches, 2, 'Unread messages must refresh for both accounts even when counts stay unchanged');
    assert.strictEqual(context.app.account.users['first@example.com'].messages[0].id, 'first-new');
    assert.strictEqual(env.storage['userState_first@example.com'].messages[0].privateField, undefined, 'Stored messages must exclude unrelated API fields');
    assert.strictEqual(env.storage['userState_first@example.com'].messages[0].snippet, undefined, 'Stored messages must exclude preview text');

    env.messageBodies['first@example.com'] = [{ id: 'after-failure', folder: '0', date: 3, flags: { unread: true } }];
    env.failNextMessageRequest('first@example.com');
    context.app.account.start();
    await wait();
    assert.strictEqual(context.app.account.users['first@example.com'].messages[0].id, 'first-new', 'A failed list request must preserve the last good state');
    context.app.account.start();
    await wait();
    assert.strictEqual(context.app.account.users['first@example.com'].messages[0].id, 'after-failure', 'The next cycle must retry the unread list after a failure');

    env.folderBodies['first@example.com'] = {
        one: { id: '1', messages_unread: '2' },
        two: { id: 2, messages_unread: '3' },
        trash: { id: 500002, messages_unread: '10' }
    };
    env.messageBodies['first@example.com'] = [
        { id: 1, folder: 1, flags: { unread: true } },
        { id: 2, folder: 1, flags: { unread: true } },
        { id: 3, folder: 2, flags: { unread: true } },
        { id: 4, folder: 2, flags: { unread: true } },
        { id: 5, folder: 2, flags: { unread: true } },
        { id: 6, folder: 500002, flags: { unread: true } }
    ];
    context.app.account.start();
    await wait();
    const firstUser = context.app.account.users['first@example.com'];
    assert.strictEqual(firstUser.count, 5, 'String counts must be converted to numbers and system folders excluded');
    assert.deepStrictEqual(Array.from(firstUser.messages, message => message.id), ['1', '2', '3', '4', '5']);

    let publicResponse;
    env.messageListeners[0]({ action: 'getData' }, {}, response => { publicResponse = response; });
    const publicJson = JSON.stringify(publicResponse);
    assert(!publicJson.includes('secret-token'), 'Popup state must not expose API tokens');
    assert(!publicJson.includes('folders'), 'Popup state must not expose folder internals');
    assert(!publicJson.includes('_startInFlight'), 'Popup state must not expose request flags');

    let accountInfoResponse;
    env.messageListeners[0]({ action: 'getAccountInfo' }, {}, response => { accountInfoResponse = response; });
    assert.strictEqual(accountInfoResponse.data.accounts.length, 2, 'Options must receive every available mailbox');
    assert.strictEqual(accountInfoResponse.data.accounts[0].email, 'first@example.com');
    assert.strictEqual(accountInfoResponse.data.accounts[0].unreadCount, 5, 'Options must receive unread counts per mailbox');
    assert.strictEqual(accountInfoResponse.data.totalUnread, 6, 'Options summary must total unread counts across mailboxes');

    context.app.view.notifications({
        subject: 'A &amp; B',
        snippet: 'C &quot;D&quot;',
        correspondents: { from: [{ name: 'X &amp; Y', avatars: { default: 'https://example.com/avatar.png' } }] }
    }, 'first@example.com');
    const notification = env.notificationOptions.at(-1);
    assert.strictEqual(notification.title, 'X & Y', 'Notification sender must decode HTML entities');
    assert.strictEqual(notification.message, packageIsFirefox ? 'A & B\nC "D"' : 'A & B', 'Notification subject must decode HTML entities');
    if (!packageIsFirefox) assert.strictEqual(notification.contextMessage, 'C "D"', 'Notification preview must decode HTML entities');
    assert.strictEqual(notification.iconUrl, 'chrome-extension://test/img/48_activ.png', 'Notifications must use the local icon even when a remote avatar is available');

    firstUser.messages = [{ id: 123, folder: 7 }];
    firstUser.count = 1;
    env.setActionResponse(true, 200);
    const markResult = await new Promise(resolve => context.markMessageAsRead('123', firstUser.email, resolve));
    assert.strictEqual(markResult, true);
    assert.strictEqual(firstUser.messages.length, 0, 'Numeric API ID must match string DOM ID');

    firstUser.messages = [{ id: 'http-error', folder: '0' }];
    firstUser.count = 1;
    env.setActionResponse(false, 200);
    const httpErrorResult = await new Promise(resolve => context.markMessageAsRead('http-error', firstUser.email, resolve));
    assert.strictEqual(httpErrorResult, false, 'HTTP errors must not be accepted because JSON says status 200');
    assert.strictEqual(firstUser.messages.length, 1);

    firstUser.messages = [{ id: 'delete-id', folder: '0' }];
    firstUser.folders = { trash: { id: '500002', name: 'Корзина' } };
    firstUser.count = 1;
    env.setActionResponse(true, 200);
    const deleteResult = await new Promise(resolve => context.moveMessageToTrash('delete-id', firstUser.email, resolve));
    assert.strictEqual(deleteResult, true);
    assert.strictEqual(context.isMessageMuted(firstUser.email, 'delete-id'), true, 'Deleted messages must be muted during API eventual consistency');

    context.muteMessage(firstUser.email, 'shared-id');
    const secondUser = context.app.account.users['second@example.com'];
    secondUser.messages = [];
    assert.strictEqual(secondUser.checkMessages([{ id: 'shared-id', folder: '0' }]).length, 1, 'Mute keys must be isolated by account');

    let starts = 0;
    context.app.account.start = function() { starts++; };
    env.idleListeners[0]('idle');
    env.alarmListeners[0]({ name: 'mail_update_alarm' });
    assert.strictEqual(starts, 0, 'Alarm must not refresh while idle');
    env.idleListeners[0]('active');
    assert.strictEqual(starts, 1, 'idle -> active must resume and refresh');

    let reminderSounds = 0;
    context.safePlaySound = function() { reminderSounds++; };
    firstUser.count = 1;
    env.storage.repeatUnreadSound = true;
    env.alarmListeners[0]({ name: 'unread_sound_reminder' });
    assert.strictEqual(reminderSounds, 1, 'Enabled reminder must play when unread mail exists');
    firstUser.count = 0;
    secondUser.count = 0;
    env.alarmListeners[0]({ name: 'unread_sound_reminder' });
    assert.strictEqual(reminderSounds, 1, 'Reminder must stay silent when no unread mail exists');
    firstUser.count = 1;
    env.idleListeners[0]('idle');
    env.alarmListeners[0]({ name: 'unread_sound_reminder' });
    assert.strictEqual(reminderSounds, 1, 'Reminder must stay silent while the account is paused');
    env.idleListeners[0]('active');

    env.storage.repeatUnreadSound = true;
    context.syncUnreadSoundReminder();
    const reminderAlarm = env.alarmCreates.find(item => item.name === 'unread_sound_reminder');
    assert(reminderAlarm, 'Enabling reminders must create a dedicated alarm');
    assert.strictEqual(reminderAlarm.options.periodInMinutes, 0.5);
    assert.strictEqual(reminderAlarm.options.delayInMinutes, 0.5);
    env.storage.repeatUnreadSound = false;
    context.syncUnreadSoundReminder();
    assert(env.alarmClears.includes('unread_sound_reminder'), 'Disabling reminders must clear the dedicated alarm');

    const specialLogin = 'a+b&c@example.com';
    const targetPage = 'https://e.mail.ru/cgi-bin/readmsg?id=1&from=personal';
    const mailUrl = new URL(context.openTab.getMailUrl(targetPage, specialLogin));
    assert.strictEqual(mailUrl.searchParams.get('Page'), targetPage, 'Target mail URL must round-trip through Page');
    assert.strictEqual(mailUrl.searchParams.get('Login'), specialLogin, 'Special characters in Login must be encoded');
}

function testOptionsSaveOrdering() {
    const pendingWrites = [];
    const sentSnapshots = [];
    const storage = { interface: 'old', soundtrek: 'old', timetest: 999, theme: 'old' };
    const context = {
        console,
        setTimeout() { return 1; },
        clearTimeout() {},
        window: { addEventListener() {}, matchMedia() { return { matches: false }; } },
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            createElement() { return { textContent: '', innerHTML: '' }; },
            documentElement: { classList: { add() {}, remove() {} } }
        },
        chrome: {
            storage: {
                local: {
                    get(key, callback) { callback({ [key]: storage[key] }); },
                    set(values, callback) { pendingWrites.push(() => { Object.assign(storage, values); callback(); }); }
                }
            },
            runtime: {
                lastError: null,
                onMessage: { addListener() {} },
                getManifest() { return { version: '1.0.3' }; },
                sendMessage(_request, callback) {
                    sentSnapshots.push({ ...storage });
                    callback({ success: true });
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(textUtilsPath, 'utf8'), context, { filename: 'js/text-utils.js' });
    vm.runInContext(fs.readFileSync(optionsPath, 'utf8'), context, { filename: 'options.js' });
    context.interfacePage = { value: 'win' };
    context.soundNotif = { value: '05-gentle-pop.wav' };
    context.time = { value: '30000' };
    context.messageLimit = { value: '5' };
    context.themeSelect = { value: 'system' };
    context.repeatUnreadSound = { checked: true };
    context.save(false);
    assert.strictEqual(pendingWrites.length, 1, 'Settings must be stored atomically');
    assert.strictEqual(sentSnapshots.length, 0, 'reloadSettings must wait for storage');
    pendingWrites[0]();
    assert.deepStrictEqual(sentSnapshots[0], { interface: 'win', soundtrek: '05-gentle-pop.wav', timetest: 30000, messageLimit: 5, theme: 'system', repeatUnreadSound: true });
    assert.strictEqual(context.formatUnreadCount(1), '1 непрочитанное письмо');
    assert.strictEqual(context.formatUnreadCount(2), '2 непрочитанных письма');
    assert.strictEqual(context.formatUnreadCount(5), '5 непрочитанных писем');
    assert.strictEqual(context.formatUnreadCount(11), '11 непрочитанных писем');
    assert.strictEqual(context.formatUnreadCount(21), '21 непрочитанное письмо');
}

function testPopupStorageFallback() {
    const context = {
        console,
        URL,
        setTimeout() { return 1; },
        clearTimeout() {},
        setInterval() { return 1; },
        clearInterval() {},
        window: { close() {} },
        document: { addEventListener() {} },
        chrome: {
            storage: { local: { get() {} } },
            runtime: { lastError: null, onMessage: { addListener() {} }, sendMessage() { return Promise.resolve(); } },
            alarms: { get() {} }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(textUtilsPath, 'utf8'), context, { filename: 'js/text-utils.js' });
    vm.runInContext(fs.readFileSync(popupPath, 'utf8'), context, { filename: 'js/popup.js' });
    const cached = context.createCachedPublicState({
        timetest: 30000,
        'userState_cached@example.com': { count: '2', messages: [{ id: 'cached-message', folder: '0' }] }
    });
    assert.strictEqual(cached.account.currentEmail, 'cached@example.com');
    assert.strictEqual(cached.account.users['cached@example.com'].count, 2);
    assert.strictEqual(cached.account.users['cached@example.com'].messages[0].id, 'cached-message');
    assert.strictEqual(context.createCachedPublicState({ timetest: 30000 }), null, 'Fallback must reject storage without cached accounts');
    assert.deepStrictEqual(Array.from(context.getVisibleMessages([1, 2, 3, 4, 5, 6], 5)), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(Array.from(context.getVisibleMessages([1, 2, 3, 4, 5, 6], 20)), [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(Array.from(context.getVisibleMessages([1, 2, 3, 4, 5, 6], 7)), [1, 2, 3, 4, 5, 6]);
    assert.strictEqual(context.normalizeMessageDisplayLimit('invalid'), 5, 'Invalid message limit must fall back to five');
    assert.strictEqual(context.normalizeMessageDisplayLimit(0), 5, 'Zero message limit must fall back to five');
}

function testStaticBoundaries() {
    const popupSource = fs.readFileSync(popupPath, 'utf8');
    const backgroundSource = fs.readFileSync(backgroundPath, 'utf8');
    const optionsSource = fs.readFileSync(optionsPath, 'utf8');
    const optionsHtml = fs.readFileSync(optionsHtmlPath, 'utf8');
    const popupHtml = fs.readFileSync(path.join(projectRoot, 'popup.html'), 'utf8');
    const textUtilsSource = fs.readFileSync(textUtilsPath, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert(!popupSource.includes('mesDiv.innerHTML'), 'Message DOM must not be built with innerHTML');
    assert(!popupSource.includes('onerror='), 'Inline event handlers are forbidden by extension CSP');
    assert(!backgroundSource.includes('http://'), 'Mail navigation must use HTTPS');
    assert(textUtilsSource.includes("url.protocol === 'https:'"), 'Avatar URLs must be restricted to HTTPS');
    assert(popupSource.includes('button.dataset.msgId'), 'Message IDs must be assigned through dataset');
    assert.strictEqual(manifest.name, 'Mail.ru Checker Forge');
    assert.strictEqual(manifest.action.default_title, 'Mail.ru Checker Forge');
    assert.strictEqual(manifest.version, '1.0.4');
    if (packageIsFirefox) {
        assert.strictEqual(manifest.browser_specific_settings.gecko.strict_min_version, '142.0');
        assert(!manifest.permissions.includes('offscreen'));
    } else assert.strictEqual(manifest.minimum_chrome_version, '120');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'update_url'), false, 'The fork must not update from the original Web Store listing');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'key'), false, 'The fork must not reuse the original extension ID');
    assert(popupHtml.includes('<script src="js/text-utils.js"></script>'), 'Popup must load shared text utilities');
    assert(optionsHtml.includes('<script src="js/text-utils.js"></script>'), 'Options must load shared text utilities');
    assert(backgroundSource.includes("importScripts('js/text-utils.js')"), 'Background must load shared text utilities');
    assert(!popupSource.includes('function decodeHtmlEntities'), 'Popup must not duplicate shared text utilities');
    assert(!backgroundSource.includes('function decodeHtmlEntities'), 'Background must not duplicate shared text utilities');
    assert(optionsHtml.includes('<label for="theme_select">Тема</label>'), 'Theme setting must use the standard short label');
    assert(optionsHtml.includes('<title>Mail.ru Checker Forge</title>'), 'Options page title must use the product name only');
    assert(optionsHtml.includes('<h1>Mail.ru Checker Forge</h1>'), 'Options heading must use the product name only');
    assert(optionsHtml.includes('<h2>Почтовые ящики</h2>'), 'Account section must describe all mailboxes');
    assert(optionsHtml.includes('<option value="05-gentle-pop.wav" selected>Мягкий pop</option>'), 'Gentle pop must be selected by default');
    assert(optionsHtml.includes('id="message_limit" type="number" min="1" max="100"'), 'Message limit must be a free numeric field');
    assert(optionsSource.includes("messageLimit: messageLimit ? normalizeMessageDisplayLimit(messageLimit.value) : 5"), 'Message limit must be saved with the other settings');
    assert(optionsSource.includes("heading.textContent = 'По почтовым ящикам'"), 'Options must render a per-mailbox list');
    assert(optionsSource.includes("appendAccountSummary(summary, 'Подключено ящиков'"), 'Options must show the mailbox count summary');
    assert(!optionsHtml.includes('— Настройки'), 'The redundant options suffix must be removed');
    assert(!optionsHtml.includes('Оформление'), 'Old theme label must be removed');
    assert(optionsHtml.includes('id="repeat_unread_sound" type="checkbox"'), 'Unread reminder toggle must exist');
    assert(!optionsHtml.includes('id="repeat_unread_sound" type="checkbox" checked'), 'Unread reminder must be off by default');
    ['Стеклянная капля', 'Мягкий колокол', 'Воздушный перелив', 'Тёплый щипок', 'Мягкий pop', 'Чистый двойной', 'Спокойный аккорд', 'Минимальный ping'].forEach(name => {
        assert(optionsHtml.includes(name), `Named sound option is missing: ${name}`);
    });
    ['01-glass-drop.wav', '02-soft-bell.wav', '03-airy-chime.wav', '04-warm-pluck.wav', '05-gentle-pop.wav', '06-clear-double.wav', '07-mellow-triad.wav', '08-minimal-ping.wav'].forEach(file => {
        const sound = fs.readFileSync(path.join(projectRoot, 'sound', file));
        assert.strictEqual(sound.subarray(0, 4).toString('ascii'), 'RIFF');
        assert.strictEqual(sound.subarray(8, 12).toString('ascii'), 'WAVE');
        assert(sound.length > 1000, `Sound ${file} must contain audio data`);
    });
    assert.deepStrictEqual(manifest.host_permissions, [
        'https://portal.mail.ru/*',
        'https://auth.mail.ru/*',
        'https://e.mail.ru/*',
        'https://mailru-checker-api.e.mail.ru/*'
    ]);

}

async function testFirefox() {
    const env = createBackgroundEnvironment(true);
    await wait();
    const { context } = env;
    assert.strictEqual(Object.keys(context.app.account.users).length, 2);
    context.app.sound.play('05-gentle-pop.wav');
    await wait();
    assert.strictEqual(context.backgroundAudio.played, true);
    assert(context.backgroundAudio.src.endsWith('/sound/05-gentle-pop.wav'));
    context.app.sound.play('08-minimal-ping.wav');
    await wait();
    assert(context.backgroundAudio.src.endsWith('/sound/08-minimal-ping.wav'));
    context.app.sound.play('0');
    await wait();
    assert(context.backgroundAudio.src.endsWith('/sound/08-minimal-ping.wav'));
    context.app.view.notifications({ id: 'firefox-test', subject: 'Subject', snippet: 'Preview' }, 'first@example.com');
    const notification = env.notificationOptions.at(-1);
    assert.strictEqual(notification.message, 'Subject\nPreview');
    assert.deepStrictEqual(Object.keys(notification).sort(), ['iconUrl', 'message', 'title', 'type']);
    console.log('PASS: Firefox background scripts, callback messaging, multiple accounts, audio and notifications');
}

module.exports = { createBackgroundEnvironment, wait };
if (require.main === module) (async () => {
    await testBackground();
    await testFirefox();
    testOptionsSaveOrdering();
    testPopupStorageFallback();
    testStaticBoundaries();
    console.log('PASS: synchronization, normalization, storage ordering, cache fallback, message display limit, notification text, public state, DOM boundary, mute isolation, idle state, unread reminder, eight sounds, HTTP validation, HTTPS and permissions');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
