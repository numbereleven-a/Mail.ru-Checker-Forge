var soundNotif = null;
var time = null;
var messageLimit = null;
var interfacePage = null;
var themeSelect = null;
var repeatUnreadSound = null;
var DEFAULT_SOUND_FILE = '05-gentle-pop.wav';

const Storage = {
    get: function(key, callback) {
        chrome.storage.local.get(key, function(result) {
            if (chrome.runtime.lastError) {
                console.error('[MCL] Failed to read setting:', chrome.runtime.lastError.message);
                callback(undefined);
                return;
            }
            callback(result ? result[key] : undefined);
        });
    },
    setMany: function(values, callback) {
        chrome.storage.local.set(values, callback);
    }
};

document.addEventListener('DOMContentLoaded', function() {
    init();
    var saveButton = document.getElementById('save');
    if (saveButton) saveButton.addEventListener('click', function() { save(true); });
    window.addEventListener('focus', loadAccountInfo);
});

chrome.runtime.onMessage.addListener(function(request) {
    if (request.action === 'updateData') loadAccountInfo();
});

function init() {
    var manifest = chrome.runtime.getManifest();
    var versionElement = document.getElementById('app_version');
    if (versionElement && manifest) versionElement.textContent = 'Версия ' + manifest.version;
    loadAccountInfo();
    soundInit();
    timeInit();
    messageLimitInit();
    interfaceInit();
    themeInit();
    reminderInit();
}

function clearElement(element) {
    while (element && element.firstChild) element.removeChild(element.firstChild);
}

function createSvgIcon(pathData) {
    var namespace = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var paths = Array.isArray(pathData) ? pathData : [pathData];
    paths.forEach(function(data) {
        var path = document.createElementNS(namespace, 'path');
        path.setAttribute('d', data);
        svg.appendChild(path);
    });
    return svg;
}

function appendAccountSummary(container, label, value) {
    var item = document.createElement('div');
    item.className = 'account-summary-item';
    var valueElement = document.createElement('strong');
    valueElement.className = 'account-summary-value';
    valueElement.textContent = String(value);
    var labelElement = document.createElement('span');
    labelElement.textContent = label;
    item.appendChild(valueElement);
    item.appendChild(labelElement);
    container.appendChild(item);
}

function formatUnreadCount(value) {
    var count = Math.max(0, Number(value) || 0);
    var mod10 = count % 10;
    var mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return count + ' непрочитанное письмо';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return count + ' непрочитанных письма';
    return count + ' непрочитанных писем';
}

function appendMailbox(container, account) {
    var row = document.createElement('div');
    row.className = 'mailbox-row';
    var icon = document.createElement('div');
    icon.className = 'account-icon';
    icon.appendChild(createSvgIcon(['M4 6h16v12H4z', 'm4 7 8 6 8-6']));
    var details = document.createElement('div');
    details.className = 'mailbox-details';
    var email = document.createElement('div');
    email.className = 'mailbox-email';
    email.textContent = String(account.email || 'Не определён');
    var unread = document.createElement('div');
    unread.className = 'mailbox-unread';
    unread.textContent = formatUnreadCount(account.unreadCount);
    details.appendChild(email);
    details.appendChild(unread);
    var count = document.createElement('span');
    count.className = 'mailbox-count';
    count.textContent = String(Math.max(0, Number(account.unreadCount) || 0));
    count.setAttribute('aria-label', unread.textContent);
    row.appendChild(icon);
    row.appendChild(details);
    row.appendChild(count);
    container.appendChild(row);
}

function renderAccountInfo(data) {
    var container = document.getElementById('account_info');
    if (!container) return;
    clearElement(container);

    if (!data || data.authStatus === false) {
        var error = document.createElement('div');
        error.className = 'account-error';
        error.textContent = data && data.authStatus === false ? 'Вы не авторизованы в Mail.ru.' : 'Не удалось загрузить данные аккаунта.';
        var login = document.createElement('a');
        login.className = 'login-link';
        login.href = 'https://e.mail.ru/login?from=personal';
        login.target = '_blank';
        login.rel = 'noopener noreferrer';
        login.textContent = 'Войти в почту';
        error.appendChild(document.createElement('br'));
        error.appendChild(login);
        container.appendChild(error);
        return;
    }
    var available = Array.isArray(data.accounts) ? data.accounts : [];
    if (data.ready === false && available.length === 0) {
        var loading = document.createElement('div');
        loading.className = 'loading-state';
        loading.textContent = 'Получаем данные почтовых ящиков...';
        container.appendChild(loading);
        return;
    }
    if (available.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'account-error';
        empty.textContent = 'Подключённые почтовые ящики не найдены.';
        container.appendChild(empty);
        return;
    }
    var summary = document.createElement('div');
    summary.className = 'account-summary';
    appendAccountSummary(summary, 'Подключено ящиков', available.length);
    appendAccountSummary(summary, 'Всего непрочитанных', Math.max(0, Number(data.totalUnread) || 0));
    container.appendChild(summary);
    var heading = document.createElement('div');
    heading.className = 'mailbox-section-title';
    heading.textContent = 'По почтовым ящикам';
    container.appendChild(heading);
    var list = document.createElement('div');
    list.className = 'mailbox-list';
    available.forEach(function(account) { appendMailbox(list, account || {}); });
    container.appendChild(list);
    var note = document.createElement('div');
    note.className = 'account-note';
    note.textContent = 'Список и счётчики автоматически обновляются из Mail.ru';
    container.appendChild(note);
}

function loadAccountInfo() {
    var container = document.getElementById('account_info');
    if (!container) return;
    chrome.runtime.sendMessage({ action: 'getAccountInfo' }, function(response) {
        if (chrome.runtime.lastError) {
            renderAccountInfo(null);
            return;
        }
        renderAccountInfo(response && response.data ? response.data : null);
    });
}

function setSelectText(select, textElement) {
    if (!select || !textElement) return;
    var option = select.options[select.selectedIndex];
    textElement.textContent = option ? option.textContent : '';
}

function selectStoredValue(select, storedValue, fallbackValue) {
    if (!select) return;
    var target = storedValue == null ? String(fallbackValue) : String(storedValue);
    var found = false;
    for (var i = 0; i < select.options.length; i++) {
        if (String(select.options[i].value) === target) {
            select.selectedIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        for (var j = 0; j < select.options.length; j++) {
            if (String(select.options[j].value) === String(fallbackValue)) {
                select.selectedIndex = j;
                break;
            }
        }
    }
}

function soundInit() {
    soundNotif = document.getElementById('sound_notif');
    if (!soundNotif) return;
    var text = document.getElementById('sound_notif_text');
    var previewButton = document.getElementById('test_sound');
    Storage.get('soundtrek', function(value) {
        selectStoredValue(soundNotif, value, DEFAULT_SOUND_FILE);
        setSelectText(soundNotif, text);
        if (previewButton) previewButton.disabled = soundNotif.value === '0';
    });
    soundNotif.addEventListener('change', function() {
        setSelectText(soundNotif, text);
        if (previewButton) previewButton.disabled = soundNotif.value === '0';
        if (soundNotif.value !== '0') play(soundNotif.value);
        save(false);
    });
    if (previewButton) {
        previewButton.addEventListener('click', function() {
            if (soundNotif.value !== '0') play(soundNotif.value);
        });
    }
}

function timeInit() {
    time = document.getElementById('time');
    if (!time) return;
    var text = document.getElementById('time_text');
    Storage.get('timetest', function(value) {
        selectStoredValue(time, value, 30000);
        setSelectText(time, text);
    });
    time.addEventListener('change', function() {
        setSelectText(time, text);
        save(false);
    });
}

function messageLimitInit() {
    messageLimit = document.getElementById('message_limit');
    if (!messageLimit) return;
    Storage.get('messageLimit', function(value) {
        messageLimit.value = String(normalizeMessageDisplayLimit(value));
    });
    messageLimit.addEventListener('change', function() {
        messageLimit.value = String(normalizeMessageDisplayLimit(messageLimit.value));
        save(false);
    });
}

function interfaceInit() {
    interfacePage = document.getElementById('interface');
    if (!interfacePage) return;
    var text = document.getElementById('interface_text');
    Storage.get('interface', function(value) {
        selectStoredValue(interfacePage, value, 'win');
        setSelectText(interfacePage, text);
    });
    interfacePage.addEventListener('change', function() {
        setSelectText(interfacePage, text);
        save(false);
    });
}

function applySelectedTheme() {
    var theme = themeSelect ? themeSelect.value : 'system';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-theme', dark);
}

function themeInit() {
    themeSelect = document.getElementById('theme_select');
    if (!themeSelect) return;
    var text = document.getElementById('theme_text');
    Storage.get('theme', function(value) {
        selectStoredValue(themeSelect, value, 'system');
        setSelectText(themeSelect, text);
    });
    themeSelect.addEventListener('change', function() {
        setSelectText(themeSelect, text);
        applySelectedTheme();
        save(false);
    });
}

function reminderInit() {
    repeatUnreadSound = document.getElementById('repeat_unread_sound');
    if (!repeatUnreadSound) return;
    Storage.get('repeatUnreadSound', function(value) {
        repeatUnreadSound.checked = value === true;
    });
    repeatUnreadSound.addEventListener('change', function() { save(false); });
}

function save(showMessage) {
    showMessage = showMessage === undefined ? true : Boolean(showMessage);
    var settings = {
        interface: interfacePage ? interfacePage.value : 'win',
        soundtrek: soundNotif ? soundNotif.value : DEFAULT_SOUND_FILE,
        timetest: time ? (parseInt(time.value, 10) || 30000) : 30000,
        messageLimit: messageLimit ? normalizeMessageDisplayLimit(messageLimit.value) : 5,
        theme: themeSelect ? themeSelect.value : 'system',
        repeatUnreadSound: repeatUnreadSound ? Boolean(repeatUnreadSound.checked) : false
    };
    Storage.setMany(settings, function() {
        if (chrome.runtime.lastError) {
            console.error('[MCL] Failed to save settings:', chrome.runtime.lastError.message);
            return;
        }
        chrome.runtime.sendMessage({ action: 'reloadSettings', changed: Object.keys(settings) }, function() {
            if (chrome.runtime.lastError) {
                console.error('[MCL] Failed to reload settings:', chrome.runtime.lastError.message);
                return;
            }
            if (showMessage) shownMess();
        });
    });
}

function shownMess() {
    var message = document.getElementById('options_mess');
    if (!message) return;
    message.classList.add('show');
    setTimeout(function() { message.classList.remove('show'); }, 2600);
}

function play(soundFile) {
    var audio = document.getElementById('sound');
    if (!audio || !soundFile || soundFile === '0') return;
    audio.src = 'sound/' + soundFile;
    audio.currentTime = 0;
    var promise = audio.play();
    if (promise && typeof promise.catch === 'function') promise.catch(function() {});
}
