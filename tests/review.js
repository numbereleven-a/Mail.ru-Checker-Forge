const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createBackgroundEnvironment, wait } = require('./regression');
const root = process.env.FORGE_PROJECT_ROOT || path.join(__dirname, '..');
function cachedPopupState(storage) {
    const context = { document: { addEventListener() {} }, chrome: { runtime: { onMessage: { addListener() {} } } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/popup.js'), 'utf8'), context);
    return context.createCachedPublicState(storage);
}

const cases = {
    async 'late mailbox response after account removal'() {
        const env = createBackgroundEnvironment(true);
        await wait();
        const user = env.context.app.account.users['first@example.com'];
        const before = env.notificationOptions.length;
        env.context.app.account.reconcileUsers(['second@example.com']);
        user._pendingCount = 1;
        user.parsMessagesUnread(JSON.stringify({ status: 200, body: [{ id: 'late-mail', folder: '0' }] }));
        assert.equal(env.notificationOptions.length, before, 'Removed mailbox must not send notifications');
        assert.notEqual(env.storage['userState_first@example.com'].messages[0]?.id, 'late-mail');
    },
    async 'late NaviData response while idle'() {
        const env = createBackgroundEnvironment(true);
        await wait();
        env.context.app.account.pause();
        const calls = env.calls.length;
        env.context.app.account.parsResult(JSON.stringify({ status: 'ok', data: { list: ['new@example.com'] } }));
        await wait();
        assert.equal(env.calls.length, calls, 'Idle must not start new mailbox requests');
    },
    async 'paused mailbox response and resume'() {
        const env = createBackgroundEnvironment(true);
        await wait();
        const user = env.context.app.account.users['first@example.com'];
        const calls = env.calls.length;
        user.pause();
        user.parsTokenResult(JSON.stringify({ status: 200, body: { token: 'test-placeholder' } }));
        user.parsFoldersResult(JSON.stringify({ status: 200, body: { inbox: { id: '0', messages_unread: 2 } } }));
        assert.equal(env.calls.length, calls);
        user.resume();
        user.start();
        await wait();
        assert(env.calls.length > calls);
        assert.equal(user._startInFlight, false);
    },
    async 'cached state includes only remaining accounts'() {
        const env = createBackgroundEnvironment(true);
        await wait();
        const oldUser = env.context.app.account.users['first@example.com'];
        env.context.app.account.reconcileUsers(['second@example.com']);
        assert.deepEqual(Object.keys(cachedPopupState(env.storage).account.users), ['second@example.com']);
        env.context.app.account.reconcileUsers(['first@example.com', 'second@example.com']);
        assert.notEqual(env.context.app.account.users['first@example.com'], oldUser);
        env.context.app.account.startUsers();
        await wait();
        assert.equal(env.context.app.account.users['first@example.com'].status, true);
    },
    async 'cached accounts after confirmed logout'() {
        const env = createBackgroundEnvironment(true);
        await wait();
        env.context.app.account.parsResult(JSON.stringify({ status: 'noauth' }));
        assert.equal(cachedPopupState(env.storage), null, 'Popup must not resurrect cached accounts after confirmed logout');
    },
    async 'HTML numeric entities in message titles'() {
        const env = createBackgroundEnvironment(true);
        await wait();
        assert.equal(env.context.decodeHtmlEntities('&#x1F600; &#128512;'), '😀 😀');
        assert.equal(env.context.decodeHtmlEntities('&#65oops;'), '&#65oops;');
        assert.equal(env.context.decodeHtmlEntities('&#x110000;'), '�');
    },
    async 'concurrent Chrome audio document creation'() {
        const env = createBackgroundEnvironment();
        await wait();
        let creations = 0;
        let release;
        env.context.chrome.offscreen.hasDocument = async () => false;
        env.context.chrome.offscreen.createDocument = async () => {
            creations++;
            if (creations > 1) throw new Error('Only one offscreen document allowed');
            await new Promise(resolve => { release = resolve; });
        };
        const pending = Promise.allSettled([env.context.createOffscreen(), env.context.createOffscreen()]);
        await wait();
        release();
        const results = await pending;
        assert.equal(creations, 1, 'Concurrent sound requests must share one document');
        assert(results.every(result => result.status === 'fulfilled'));
        env.context.chrome.offscreen.createDocument = async () => { throw new Error('Temporary failure'); };
        await assert.rejects(env.context.createOffscreen());
        env.context.chrome.offscreen.createDocument = async () => { creations++; };
        await env.context.createOffscreen();
        assert.equal(creations, 2, 'A failed creation must not block future sound');
    }
};

(async () => {
    let failures = 0;
    for (const [name, run] of Object.entries(cases)) {
        if (name === 'concurrent Chrome audio document creation' && !fs.existsSync(path.join(root, 'js/chrome-audio.js'))) {
            console.log('SKIP: Chrome audio document is not included in the Firefox package');
            continue;
        }
        try { await run(); console.log('PASS:', name); }
        catch (error) { failures++; console.error('FAIL:', name, '-', error.message); }
    }
    process.exitCode = failures ? 1 : 0;
})();
