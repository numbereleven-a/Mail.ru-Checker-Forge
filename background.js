self.addEventListener('error', function(event) {
    console.error('[MCL] Uncaught error:', event.message, event.filename, event.lineno);
    event.preventDefault();
});
self.addEventListener('unhandledrejection', function(event) {
    console.error('[MCL] Unhandled rejection:', event.reason);
    event.preventDefault();
});
if (typeof importScripts === 'function') {
    try { importScripts('js/punycode.min.js'); } catch(e) { console.error('Failed to load punycode:', e); }
    try { importScripts('js/text-utils.js'); } catch(e) { console.error('Failed to load text utilities:', e); }
}
function safeJsonParse(data) {
    try { return JSON.parse(data); } catch(e) { return null; }
}
var app = {
    mutedMessages: {},
    lastUserActionTime: 0
};
var MUTED_MESSAGES_STORAGE_KEY = 'mutedMessages';
var MUTED_MESSAGE_TTL = 120000;
var DEFAULT_SOUND_FILE = '05-gentle-pop.wav';
var SOUND_FILES = ['01-glass-drop.wav', '02-soft-bell.wav', '03-airy-chime.wav', '04-warm-pluck.wav', '05-gentle-pop.wav', '06-clear-double.wav', '07-mellow-triad.wav', '08-minimal-ping.wav'];
function normalizeSoundFile(value) {
    if (value === 0 || value === '0') return '0';
    return SOUND_FILES.indexOf(value) !== -1 ? value : DEFAULT_SOUND_FILE;
}
function idKey(value) {
    return value === undefined || value === null ? '' : String(value);
}
function toCount(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}
function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function mutedMessageKey(email, messageId) {
    return normalizeEmail(email) + '\u0000' + idKey(messageId);
}
function normalizeMessage(message) {
    if (!message || typeof message !== 'object') return null;
    var normalized = Object.assign({}, message);
    normalized.id = idKey(message.id);
    normalized.folder = idKey(message.folder);
    return normalized.id ? normalized : null;
}
function sanitizeMessageForUi(message) {
    var normalized = normalizeMessage(message);
    if (!normalized) return null;
    var from = normalized.correspondents && normalized.correspondents.from;
    var sender = Array.isArray(from) && from[0] && typeof from[0] === 'object' ? from[0] : null;
    var avatars = sender && sender.avatars && typeof sender.avatars === 'object' ? sender.avatars : {};
    return {
        id: normalized.id,
        folder: normalized.folder,
        date: Number(normalized.date) || 0,
        subject: typeof normalized.subject === 'string' ? normalized.subject : '',
        flags: {
            unread: Boolean(normalized.flags && normalized.flags.unread),
            attach: Boolean(normalized.flags && normalized.flags.attach)
        },
        correspondents: {
            from: sender ? [{
                name: typeof sender.name === 'string' ? sender.name : '',
                email: typeof sender.email === 'string' ? sender.email : '',
                avatars: {
                    '50x50': typeof avatars['50x50'] === 'string' ? avatars['50x50'] : '',
                    '180x180': typeof avatars['180x180'] === 'string' ? avatars['180x180'] : '',
                    'default': typeof avatars['default'] === 'string' ? avatars['default'] : ''
                }
            }] : []
        }
    };
}
function createPublicState() {
    var users = {};
    var sourceUsers = app && app.account && app.account.users ? app.account.users : {};
    for (var email in sourceUsers) {
        var user = sourceUsers[email];
        if (!user) continue;
        users[email] = {
            email: user.email,
            count: toCount(user.count),
            messages: Array.isArray(user.messages) ? user.messages.map(sanitizeMessageForUi).filter(Boolean) : []
        };
    }
    return {
        account: {
            ready: isAccountReadyForUi(),
            authStatus: app && app.account ? app.account.authStatus : false,
            currentEmail: app && app.account ? app.account.currentEmail : null,
            users: users
        }
    };
}
function isAccountReadyForUi() {
    if (!app || !app.account || app.account.ready !== true) return false;
    var users = app.account.users || {};
    for (var email in users) {
        if (users[email] && users[email]._ready !== true) return false;
    }
    return true;
}
function createAccountInfo() {
    if (!app || !app.account) return { ready: false, authStatus: true, accounts: [], totalUnread: 0 };
    var users = app.account.users || {};
    var emails = [];
    var seen = {};
    (app.account.emails || []).forEach(function(email) {
        email = typeof email === 'string' ? email.trim() : '';
        if (email && !seen[email]) { seen[email] = true; emails.push(email); }
    });
    Object.keys(users).forEach(function(email) {
        if (email && !seen[email]) { seen[email] = true; emails.push(email); }
    });
    var accounts = emails.map(function(email) {
        return { email: email, unreadCount: users[email] ? toCount(users[email].count) : 0 };
    });
    return {
        ready: isAccountReadyForUi(),
        authStatus: app.account.authStatus !== false,
        accounts: accounts,
        totalUnread: accounts.reduce(function(total, account) { return total + account.unreadCount; }, 0)
    };
}
function broadcastPublicState() {
    if (!app || !app.account) return;
    chrome.runtime.sendMessage({ action: 'updateData', data: createPublicState() }, function() { void chrome.runtime.lastError; });
}
const Storage = {
    get: function(key, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(key, function(result) {
                if (chrome.runtime.lastError) {
                    console.error('Storage get error:', chrome.runtime.lastError);
                    callback(undefined);
                } else {
                    callback(result ? result[key] : undefined);
                }
            });
        } else {
            callback(undefined);
        }
    },
    set: function(key, value, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            var obj = {};
            obj[key] = value;
            chrome.storage.local.set(obj, function() {
                if (chrome.runtime.lastError) {
                    console.error('Storage set error:', chrome.runtime.lastError);
                }
                if (callback) callback();
            });
        } else {
            if (callback) callback();
        }
    },
    getAll: function(callback) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(null, function(result) {
                if (chrome.runtime.lastError) {
                    console.error('Storage getAll error:', chrome.runtime.lastError);
                    callback({});
                } else {
                    callback(result || {});
                }
            });
        } else {
            callback({});
        }
    },
    getMany: function(keys, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(keys, function(result) {
                if (chrome.runtime.lastError) {
                    console.error('Storage getMany error:', chrome.runtime.lastError);
                    callback({});
                } else {
                    callback(result || {});
                }
            });
        } else {
            callback({});
        }
    }
};
function persistMutedMessages() {
    if (!chrome.storage || !chrome.storage.session) return;
    var value = {};
    value[MUTED_MESSAGES_STORAGE_KEY] = app.mutedMessages || {};
    chrome.storage.session.set(value, function() {
        if (chrome.runtime.lastError) console.warn('[MCL] Failed to persist muted messages:', chrome.runtime.lastError.message);
    });
}
function cleanupMutedMessages() {
    if (!app || !app.mutedMessages) return;
    var now = Date.now();
    var changed = false;
    for (var key in app.mutedMessages) {
        if (now - app.mutedMessages[key] > MUTED_MESSAGE_TTL) {
            delete app.mutedMessages[key];
            changed = true;
        }
    }
    if (changed) persistMutedMessages();
}
function loadMutedMessages(callback) {
    if (!chrome.storage || !chrome.storage.session) { callback(); return; }
    chrome.storage.session.get(MUTED_MESSAGES_STORAGE_KEY, function(result) {
        if (!chrome.runtime.lastError && result && result[MUTED_MESSAGES_STORAGE_KEY]) {
            app.mutedMessages = result[MUTED_MESSAGES_STORAGE_KEY];
        }
        cleanupMutedMessages();
        callback();
    });
}
function muteMessage(email, messageId) {
    if (!app.mutedMessages) app.mutedMessages = {};
    app.mutedMessages[mutedMessageKey(email, messageId)] = Date.now();
    persistMutedMessages();
}
function isMessageMuted(email, messageId) {
    var key = mutedMessageKey(email, messageId);
    var timestamp = app.mutedMessages && app.mutedMessages[key];
    if (!timestamp) return false;
    if (Date.now() - timestamp < MUTED_MESSAGE_TTL) return true;
    delete app.mutedMessages[key];
    persistMutedMessages();
    return false;
}
function initSettings() {
    Storage.get("interface", function(val) {
        if (val === undefined) Storage.set("interface", "win");
    });
    Storage.get("soundtrek", function(val) {
        var normalized = normalizeSoundFile(val);
        if (val !== normalized) Storage.set("soundtrek", normalized);
    });
    Storage.get("timetest", function(val) {
        if (val === undefined) Storage.set("timetest", 30000);
    });
    Storage.get("messageLimit", function(val) {
        var normalized = normalizeMessageDisplayLimit(val);
        if (val !== normalized) Storage.set("messageLimit", normalized);
    });
    Storage.get("repeatUnreadSound", function(val) {
        if (val === undefined) Storage.set("repeatUnreadSound", false);
    });
}
chrome.runtime.onInstalled.addListener(function() {
    initSettings();
});
function getStorageValue(key, callback) {
    Storage.get(key, callback);
}
function setStorageValue(key, value) {
    Storage.set(key, value);
}
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "openHome") {
        openTab.openHome();
    } else if (request.action === "openSettings") {
        openTab.openSettings();
    } else if (request.action === "openLogin") {
        openTab.goToLogin();
    } else if (request.action === "openInbox") {
        openTab.goToInbox(request.email);
    } else if (request.action === "openMessage") {
        openAndReconcileMessage(request.msgId, request.email);
    } else if (request.action === "getData") {
        sendResponse({ data: createPublicState() });
    } else if (request.action === "getAccountInfo") {
        sendResponse({ data: createAccountInfo() });
    } else if (request.action === "markAsRead") {
        var msgId = request.msgId;
        var email = request.email;
        markMessageAsRead(msgId, email, function(success) {
            app.lastUserActionTime = Date.now();
            resetAlarm();
            sendResponse({ success: success });
        });
        return true;
    } else if (request.action === "deleteMessage") {
        var deleteMsgId = request.msgId;
        var deleteEmail = request.email;
        moveMessageToTrash(deleteMsgId, deleteEmail, function(success) {
            app.lastUserActionTime = Date.now();
            resetAlarm();
            sendResponse({ success: success });
        });
        return true;
    } else if (request.action === "forceUpdate") {
        if (app && app.account) {
            app.account.start();
        }
        sendResponse({ success: true });
        return true;
    } else if (request.action === "testSound") {
        if (app && app.sound) {
            getStorageValue("soundtrek", function(trek) {
                var targetSound = normalizeSoundFile(request.soundFile || trek);
                if (targetSound !== '0' && targetSound !== 0) {
                    app.sound.play(targetSound);
                }
            });
        }
        sendResponse({ success: true });
        return true;
    } else if (request.action === "reloadSettings") {
        syncAlarms();
        sendResponse({ success: true });
        return true;
    } else if (request.value !== undefined) {
        Storage.get(request.value, function(val) {
            sendResponse({ val: val });
        });
        return true;
    }
});
async function createOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Sound notification'
    });
}
var lastSoundTime = 0;
function safePlaySound() {
    const now = Date.now();
    if (now - lastSoundTime > 5000) {
        if (app.sound) app.sound.play();
        lastSoundTime = now;
    }
}
function Sound() {}
var backgroundAudio;
Sound.prototype.play = function(soundFile) {
    getStorageValue("soundtrek", async function(trek) {
        trek = normalizeSoundFile(soundFile || trek);
        if (trek === '0' || trek === 0 || trek === "0") return;
        try {
            if (!chrome.offscreen) {
                if (!backgroundAudio) backgroundAudio = new Audio();
                backgroundAudio.pause();
                backgroundAudio.src = chrome.runtime.getURL('sound/' + trek);
                backgroundAudio.volume = 0.6;
                backgroundAudio.currentTime = 0;
                await backgroundAudio.play();
                return;
            }
            await createOffscreen();
            var retries = 0;
            var maxRetries = 5;
            const tryPlay = () => {
                if (retries >= maxRetries) return;
                retries++;
                chrome.runtime.sendMessage({
                    type: "playSound",
                    soundFile: trek,
                    volume: 0.6
                }, (response) => {
                    if (chrome.runtime.lastError && retries < maxRetries) {
                        setTimeout(tryPlay, 300);
                    }
                });
            };
            setTimeout(tryPlay, 300);
        } catch (err) { console.warn('Sound playback failed:', err.name); }
    });
};
function Utils() {}
Utils.prototype.request = function(options, callback, errorCallback) {
    var url = options.url;
    var params = options.params || null;
    var method = options.method || 'GET';
    var header = options.header || null;
    var timeoutMs = toCount(options.timeoutMs) || 15000;
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);
    var fetchOptions = {
        method: method,
        credentials: 'include',
        signal: controller.signal
    };
    if (params) fetchOptions.body = params;
    if (header) fetchOptions.headers = header;
    fetch(url, fetchOptions)
    .then(function(response) {
        if (!response.ok) throw new Error('Network error: ' + response.status);
        var ct = response.headers.get('content-type') || '';
        if (ct.indexOf('text/html') !== -1 && url.indexOf('/api/') !== -1) {
            throw new Error('Unexpected HTML response from API');
        }
        return response.text();
    })
    .then(function(data) {
        if (callback) callback(data);
    })
    .catch(function(error) {
        if (errorCallback) errorCallback(error);
    })
    .finally(function() {
        clearTimeout(timeoutId);
    });
};
Utils.prototype.send = function(obj) {
    chrome.runtime.sendMessage(obj, function() { void chrome.runtime.lastError; });
};
Utils.prototype.guid = function() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }
    return function() {
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
    }();
};
function View() {
    this.ico = {
        'activ': 'img/ico_panel_activ.png',
        'notActiv': 'img/ico_panel.png'
    };
    this.messNotif = {};
    this.init();
}
View.prototype.init = function() {
    this.addListener();
};
View.prototype.showNumber = function() {
    var unread = 0;
    var users = (app && app.account && app.account.users) ? app.account.users : {};
    var hasAnyUser = false;
    for (var key in users) {
        if (users[key] && users[key].email) {
            hasAnyUser = true;
            unread += toCount(users[key].count);
        }
    }
    if (!hasAnyUser) unread = -1;
    if(unread > 999) unread = "999+";
    if (unread == -1) {
        chrome.action.setBadgeText({ text: "?" });
        chrome.action.setIcon({ path: this.ico['notActiv'] });
        chrome.action.setBadgeBackgroundColor({ color: [190, 190, 190, 230] });
    } else {
        var col = (unread == 0) ? '' : unread + '';
        chrome.action.setBadgeText({ text: col });
        chrome.action.setIcon({ path: this.ico['activ'] });
        chrome.action.setBadgeBackgroundColor({ color: '#ff536a' });
    }
};
View.prototype.addListener = function() {
    chrome.notifications.onClosed.addListener(function callback(notificationId, byUser) {
        delete(this.messNotif[notificationId]);
    }.bind(this));
    chrome.notifications.onClicked.addListener(function callback(notificationId) {
        var item = this.messNotif[notificationId];
        if (item && item.mess) openAndReconcileMessage(item.mess.id, item.email);
        chrome.notifications.clear(notificationId, function() {});
        delete(this.messNotif[notificationId]);
    }.bind(this));
    if (chrome.notifications.onButtonClicked) chrome.notifications.onButtonClicked.addListener(function callback(notificationId, buttonIndex) {
        var item = this.messNotif[notificationId];
        if (buttonIndex == 0) {
            if (item && item.mess) markMessageAsRead(item.mess.id, item.email, function() {});
        }
        chrome.notifications.clear(notificationId, function() {});
        delete(this.messNotif[notificationId]);
    }.bind(this));
};
View.prototype.notifications = function(mess, email) {
    var name = decodeHtmlEntities(getFromName(mess));
    var from = mess.correspondents && mess.correspondents.from && mess.correspondents.from[0];
    var avatars = from && from.avatars;
    var avatar = avatars ? normalizeHttpsUrl(avatars['50x50'] || avatars['180x180'] || avatars['default'] || '') : '';
    if (!avatar) avatar = chrome.runtime.getURL('img/48_activ.png');
    var subject = decodeHtmlEntities(mess.subject || 'Без темы');
    var snippet = decodeHtmlEntities(mess.snippet || '');
    var opt = {
        type: "basic",
        title: name,
        message: subject == '' ? 'Без темы': subject,
        contextMessage: snippet,
        iconUrl: avatar,
        priority: 1,
        buttons: [{title: "Прочитать"}, {title: "Закрыть"}]
    };
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) {
        opt.message += snippet ? '\n' + snippet : '';
        delete opt.contextMessage;
        delete opt.priority;
        delete opt.buttons;
    }
    chrome.notifications.create("", opt, function(notificationId){
        if (chrome.runtime.lastError) {
            console.warn('[MCL] Notification error:', chrome.runtime.lastError.message);
            return;
        }
        this.messNotif[notificationId] = {'mess': mess, 'email': email};
        setTimeout(function() {
            chrome.notifications.clear(notificationId, function(){});
            delete this.messNotif[notificationId];
        }.bind(this), 10000);
    }.bind(this));
};
function shortTime(str) {
    var currentDate = new Date();
    var date = new Date(str * 1000);
    var strOut = '';
    if (currentDate.getDate() == date.getDate()) {
        strOut += date.getHours() < 10 ? '0' + date.getHours() : date.getHours();
        strOut += ':';
        strOut += date.getMinutes() < 10 ? '0' + date.getMinutes() : date.getMinutes();
    } else {
        strOut += date.getDate() < 10 ? '0' + date.getDate() : date.getDate();
        strOut += '.';
        strOut += (date.getMonth() + 1) < 10 ? '0' + (date.getMonth() + 1) : date.getMonth() + 1;
        strOut += '.' + date.getFullYear();
    }
    return strOut;
}
function getFromName(mess) {
    if (!mess.correspondents || !mess.correspondents.from || !mess.correspondents.from[0]) return 'Неизвестно';
    var sender = mess.correspondents.from[0];
    var result = sender.name || sender.email || 'Неизвестно';
    result = decodeRU(result);
    return result;
}
function decodeRU(str) {
    try {
        if (typeof punycode === 'undefined') return str;
        var arrStr = str.split("@");
        if(arrStr.length > 1) str = arrStr[0] + '@' + punycode.toUnicode(arrStr[1]);
        else str = punycode.toUnicode(str);
    } catch(e) {
        console.error('[MCL] decodeRU error:', e);
    }
    return str;
}
var openTab = {
    newMessUrl: {'win': 'https://e.mail.ru/compose/?from=personal', 'tel': 'https://touch.mail.ru/cgi-bin/msglist?from=personal#sentmsg'},
    messUrl : {'win' : 'https://e.mail.ru/cgi-bin/readmsg?from=personal&id=', 'tel' : 'https://touch.mail.ru/cgi-bin/msglist?from=personal#readmsg/'},
    homeMailUrl : {'win' : 'https://e.mail.ru/cgi-bin/msglist?from=personal', 'tel' : 'https://touch.mail.ru/cgi-bin/msglist?from=personal#msglist'},
    loginUrl: {'win' : 'https://e.mail.ru/login?from=personal', 'tel' : 'https://touch.mail.ru/cgi-bin/login?from=personal'},
    unreadUrl : {'win' : 'https://e.mail.ru/search/?q_read=2&q_folder=all&from=personal', 'tel' : 'https://touch.mail.ru/cgi-bin/msglist?from=personal#search/unread'},
    settingsApp : chrome.runtime.getURL("options.html"),
    homeUrl: "https://www.mail.ru/?from=personal",
    getInterface: function(callback) {
        getStorageValue("interface", function(val) { callback(val || 'win'); });
    },
    openHome : function () { openTab.open(this.homeUrl); },
    openSettings : function (){ openTab.open(this.settingsApp); },
    createNewMess : function (uid){
        this.getInterface(function(val) {
            openTab.open(openTab.getMailUrl(this.newMessUrl[val], uid));
        }.bind(this));
    },
    openNewMess : function (id, email) {
        app.lastUserActionTime = Date.now();
        resetAlarm();
        this.getInterface(function(val) {
            openTab.open(openTab.getMailUrl(this.messUrl[val] + encodeURIComponent(idKey(id)), email));
        }.bind(this));
    },
    goToInbox : function (uid) {
        this.getInterface(function(val) {
            var url = this.homeMailUrl[val];
            if(uid) url = openTab.getMailUrl(url, uid);
            openTab.open(url);
        }.bind(this));
    },
    goToLogin: function() {
        this.getInterface(function(val) { openTab.open(this.loginUrl[val]); }.bind(this));
    },
    open : function (url){ chrome.tabs.create({ url: url }); },
    getMailUrl : function (page, uid) {
        var url = new URL('https://auth.mail.ru/cgi-bin/auth');
        url.searchParams.set('Page', page);
        if (uid) url.searchParams.set('Login', uid);
        return url.href;
    },
    switchIcoAction : function() { chrome.action.setPopup({'popup': 'popup.html'}); }
};
function Account(startPaused) {
    this.url = 'https://portal.mail.ru/NaviData?mac=1';
    this.status = false;
    this.authStatus = true;
    this.users = {};
    this.currentEmail = null;
    this.unreadCount = 0;
    this.emails = [];
    this._requestInFlight = false;
    this.ready = false;
    this.paused = Boolean(startPaused);
    if (!this.paused) this.start();
}
Account.prototype.init = function() { this.getEmail(); };
Account.prototype.getEmail = function() {
    app.utils.request({ url: this.url, method: "GET" }, this.parsResult.bind(this), function(){
        this._requestInFlight = false;
        this.status = false;
        this.ready = true;
        this.startUsers();
        broadcastPublicState();
    }.bind(this));
};
Account.prototype.parsResult = function(data) {
    this._requestInFlight = false;
    var result = safeJsonParse(data);
    this.ready = true;
    if (!result) { this.status = false; app.view.showNumber(); broadcastPublicState(); return; }
    if (result.status == 'ok') {
        var resData = result.data || {};
        var emails = resData.list;
        this.status = true;
        this.authStatus = true;
        this.currentEmail = resData.email || null;
        this.unreadCount = parseInt(resData.mail_cnt) || 0;
        this.emails = Array.isArray(emails) ? emails : [];
        this.reconcileUsers(this.emails);
        this.startUsers();
        broadcastPublicState();
    } else if (result.status == 'noauth') {
        this.status = false;
        this.authStatus = false;
        this.clear();
        app.view.showNumber();
    } else {
        this.status = false;
        app.view.showNumber();
    }
};
Account.prototype.reconcileUsers = function(emailList) {
    var nextUsers = {};
    var seen = {};
    for (var i = 0; i < emailList.length; i++) {
        var email = emailList[i];
        if (typeof email !== 'string') continue;
        email = email.trim();
        if (!email || seen[email]) continue;
        seen[email] = true;
        nextUsers[email] = this.users[email] || new User(email);
    }
    this.users = nextUsers;
};
Account.prototype.addUser = function(email) {
    if (this.users[email] == undefined) this.users[email] = new User(email);
};
Account.prototype.start = function () {
    if (this.paused) return;
    if (this._requestInFlight) return;
    this._requestInFlight = true;
    this.init();
};
Account.prototype.startUsers = function () {
    for (var key in this.users) {
        if (this.users[key] && typeof this.users[key].start === 'function') this.users[key].start();
    }
};
Account.prototype.pause = function() {
    this.paused = true;
    for (var key in this.users) this.users[key].pause();
};
Account.prototype.resume = function() {
    this.paused = false;
    for (var key in this.users) {
        if (this.users[key] && typeof this.users[key].resume === 'function') this.users[key].resume();
    }
};
Account.prototype.clear = function() {
    this.currentEmail = null;
    this.unreadCount = 0;
    this.emails = [];
    this.users = {};
    broadcastPublicState();
};
function User(email) {
    this.email = email;
    this.count = 0;
    this.excludeFolder = ['950', '500000', '500001', '500002'];
    this.userExcludeFolder = [];
    this.guid = app.utils.guid();
    this.status = false;
    this.token = null;
    this.folders = null;
    this.messages = null;
    this._ready = false;
    this._startPending = false;
    this._startInFlight = false;
    this.paused = false;
    var self = this;
    var stateKey = "userState_" + this.email;
    Storage.getMany(["userExcludeFolder", stateKey], function(result) {
        var val = result.userExcludeFolder;
        if (val != undefined) {
            try {
                var res = (typeof val === 'string') ? JSON.parse(val) : val;
                if (res && res[self.email] != undefined && Array.isArray(res[self.email])) {
                    self.userExcludeFolder = res[self.email].map(idKey);
                }
            } catch(e) {}
        }
        var state = result[stateKey];
        if (state) {
            self.count = toCount(state.count);
            self.messages = Array.isArray(state.messages) ? state.messages.map(normalizeMessage).filter(Boolean) : null;
        }
        self._ready = true;
        broadcastPublicState();
        if (self._startPending) {
            self._startPending = false;
            self.start();
        }
    });
}
User.prototype.init = function() { this.getToken(); };
User.prototype.start = function() {
    if (this.paused) return;
    if (this._startInFlight) return;
    if (!this._ready) {
        this._startPending = true;
        return;
    }
    this._startInFlight = true;
    this.init();
};
User.prototype.finishStart = function() { this._startInFlight = false; };
User.prototype.pause = function() { this.paused = true; };
User.prototype.resume = function() { this.paused = false; };
User.prototype.saveState = function() {
    var storedMessages = Array.isArray(this.messages) ? this.messages.map(sanitizeMessageForUi).filter(Boolean) : [];
    setStorageValue("userState_" + this.email, { count: this.count, messages: storedMessages });
};
User.prototype.getToken = function() {
    var encodedEmail = encodeURIComponent(this.email);
    var url = 'https://mailru-checker-api.e.mail.ru/api/v1/tokens?email=' + encodedEmail + '&x-email=' + encodedEmail;
    app.utils.request({ url: url, method: "GET" }, this.parsTokenResult.bind(this), this.errorRequestToken.bind(this))
};
User.prototype.getTokenSdc = function() {
    var encodedEmail = encodeURIComponent(this.email);
    var url = 'https://mailru-checker-api.e.mail.ru/api/v1/tokens?email=' + encodedEmail + '&x-email=' + encodedEmail;
    var urlSdc = 'https://auth.mail.ru/sdc?from=' + encodeURIComponent(url);
    app.utils.request({ url: urlSdc, method: "GET" }, this.parsTokenSdcResult.bind(this), this.errorRequestToken.bind(this))
};
User.prototype.errorRequestToken = function(error) {
    this.status = false;
    this.finishStart();
};
User.prototype.parsTokenSdcResult = function(data) {
    var result = safeJsonParse(data);
    if (!result) { this.status = false; this.finishStart(); return; }
    if (result.status == 200 && result.body) {
        this.status = true;
        this.token = result.body.token;
        this.getFolders();
    } else {
        this.status = false;
        this.finishStart();
    }
};
User.prototype.parsTokenResult = function(data) {
    var result = safeJsonParse(data);
    if (!result) { this.status = false; this.finishStart(); return; }
    if (result.status == 200 && result.body) {
        this.status = true;
        this.token = result.body.token;
        this.getFolders();
    } else if (result.status == 403 && result.body == 'nosdc') {
        this.getTokenSdc();
    } else {
        this.status = false;
        this.finishStart();
    }
};
User.prototype.getFolders = function() {
    if (this.token == null) { this.getToken(); return; }
    var encodedEmail = encodeURIComponent(this.email);
    var encodedToken = encodeURIComponent(this.token);
    var url = 'https://mailru-checker-api.e.mail.ru/api/v1/folders?email=' + encodedEmail + '&x-email=' + encodedEmail + '&token=' + encodedToken + '&limit=100&last_modified=0';
    app.utils.request({ url: url, method: "GET" }, this.parsFoldersResult.bind(this), function(){
        this.status = false;
        this.finishStart();
    }.bind(this));
};
User.prototype.parsFoldersResult = function(data) {
    var result = safeJsonParse(data);
    if (!result) { this.status = false; this.finishStart(); return; }
    if (result.status == 200) {
        this.status = true;
        this.folders = result.body;
    } else {
        this.status = false;
        if (result.status == 401 || result.status == 403) this.token = null;
        this.finishStart();
        return;
    }
    this.countUnreadMess();
};
User.prototype.getExcludedFolderSet = function() {
    var result = new Set(this.excludeFolder.map(idKey));
    var custom = Array.isArray(this.userExcludeFolder) ? this.userExcludeFolder : [];
    for (var i = 0; i < custom.length; i++) result.add(idKey(custom[i]));
    return result;
};
User.prototype.countUnreadMess = function() {
    var countMess = 0;
    if (!this.folders || typeof this.folders !== 'object') { this.finishStart(); return; }
    var excludedFolders = this.getExcludedFolderSet();
    for (var key in this.folders) {
        if (this.folders[key] && typeof this.folders[key] === 'object') {
            var id = idKey(this.folders[key].id);
            if (id && !excludedFolders.has(id)) countMess += toCount(this.folders[key].messages_unread);
        }
    }
    this._pendingCount = countMess;
    this.getMessagesUnread();
};
User.prototype.getMessagesUnread = function() {
    var encodedEmail = encodeURIComponent(this.email);
    var encodedToken = encodeURIComponent(this.token);
    var url = 'https://mailru-checker-api.e.mail.ru/api/v1/messages/status/unread?email=' + encodedEmail + '&x-email=' + encodedEmail + '&token=' + encodedToken + '&limit=100&last_modified=0';
    app.utils.request({ url: url, method: "GET" }, this.parsMessagesUnread.bind(this), function() {
        delete this._pendingCount;
        this.status = false;
        this.finishStart();
    }.bind(this));
};
User.prototype.parsMessagesUnread = function(data) {
    var result = safeJsonParse(data);
    if (!result) { delete this._pendingCount; this.finishStart(); return; }
    if (result.status == 200 && Array.isArray(result.body)) {
        var excludedFolders = this.getExcludedFolderSet();
        var self = this;
        var mutedUnreadCount = 0;
        var nextMessages = result.body.map(normalizeMessage).filter(function(message) {
            if (!message || excludedFolders.has(idKey(message.folder))) return false;
            if (isMessageMuted(self.email, message.id)) {
                mutedUnreadCount++;
                return false;
            }
            return true;
        });
        var notifMess = this.checkMessages(nextMessages);
        var nextCount = Math.max(0, toCount(this._pendingCount) - mutedUnreadCount);
        var stateChanged = this.count !== nextCount || JSON.stringify(this.messages || []) !== JSON.stringify(nextMessages);
        this.count = nextCount;
        this.messages = nextMessages;
        if (notifMess.length > 0 && Date.now() - app.lastUserActionTime >= 5000) safePlaySound();
        if (notifMess.length > 0) app.view.notifications(notifMess[0], this.email);
        if (stateChanged) {
            this.saveState();
            broadcastPublicState();
        }
        app.view.showNumber();
        this.status = true;
    } else {
        this.status = false;
        if (result.status == 401 || result.status == 403) this.token = null;
    }
    delete this._pendingCount;
    this.finishStart();
};
User.prototype.checkMessages = function(newMess) {
    if (!Array.isArray(newMess) || !Array.isArray(this.messages)) return [];
    var idsOldMess = new Set(this.messages.map(function(item) { return item ? idKey(item.id) : ''; }));
    var self = this;
    var excludedFolders = this.getExcludedFolderSet();
    return newMess.filter(function(item) {
        if (!item || !item.id) return false;
        if (isMessageMuted(self.email, item.id)) return false;
        if (excludedFolders.has(idKey(item.folder))) return false;
        return !idsOldMess.has(idKey(item.id));
    });
};
User.prototype.clear = function() {
    this.token = null; this.folders = null; this.messages = null; this.count = 0; delete this._pendingCount; this.saveState();
};
function main() {
    initSettings();
    app.utils = new Utils();
    app.view = new View();
    app.sound = new Sound();
    openTab.switchIcoAction();
    var states = { active: 'active', locked: 'locked', idle: 'idle' };
    var prevState = states.active;
    chrome.idle.onStateChanged.addListener(function (newState) {
        if (!app.account) { prevState = newState; return; }
        if (newState === states.active && prevState !== states.active) {
            app.account.resume();
            app.account.start();
        } else if (newState === states.locked || newState === states.idle) {
            app.account.pause();
        }
        prevState = newState;
    });
    loadMutedMessages(function() {
        var initializeAccount = function(state) {
            prevState = state || states.active;
            app.account = new Account(state === states.locked || state === states.idle);
            syncAlarms();
        };
        if (chrome.idle.queryState) {
            chrome.idle.queryState(60, function(state) {
                initializeAccount(state);
            });
        } else initializeAccount(states.active);
    });
}
function markMessageAsRead(msgId, email, callback) {
    if (!app || !app.account || !app.account.users || !app.account.users[email]) { callback(false); return; }
    var user = app.account.users[email];
    if (!user || !user.token) { callback(false); return; }
    var token = user.token;
    var url = 'https://e.mail.ru/api/v1/threads/marks';
    var folderId = "0";
    var message = getMessageRecord(user, msgId);
    if (message) folderId = idKey(message.folder) || folderId;
    var normalizedMessageId = idKey(msgId);
    var threadId = "0:" + normalizedMessageId + ":" + folderId;
    var marksData = JSON.stringify([{"name":"unread","unset":[threadId],"folder":0}]);
    var messageIdLastObj = {};
    messageIdLastObj[threadId] = normalizedMessageId;
    var params = new URLSearchParams();
    params.append('marks', marksData);
    params.append('message_id_last', JSON.stringify(messageIdLastObj));
    params.append('email', email);
    params.append('htmlencoded', 'false');
    params.append('token', token);
    app.utils.request({
        url: url,
        method: 'POST',
        header: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json, text/plain, */*' },
        params: params.toString()
    }, function(data) {
        var result = safeJsonParse(data);
        var isSuccess = Boolean(result && result.status === 200);
        if (isSuccess) {
            muteMessage(email, normalizedMessageId);
            removeMessageFromUser(user, normalizedMessageId);
            broadcastPublicState();
        } else if (result && (result.status === 401 || result.status === 403)) {
            user.token = null;
        }
        callback(isSuccess);
    }, function() { callback(false); });
}
function getMessageRecord(user, msgId) {
    if (!user || !Array.isArray(user.messages)) return null;
    for (var i = 0; i < user.messages.length; i++) {
        if (user.messages[i] && String(user.messages[i].id) === String(msgId)) return user.messages[i];
    }
    return null;
}
function getFolderIdByKind(user, kind, fallback) {
    var folders = user && user.folders;
    if (folders && typeof folders === 'object') {
        var names = kind === 'trash' ? ['trash', 'корз'] : [];
        for (var key in folders) {
            var folder = folders[key];
            if (!folder || typeof folder !== 'object' || folder.id === undefined) continue;
            var haystack = [folder.name, folder.title, folder.label, folder.type, folder.folder_type]
                .filter(function(value) { return value !== undefined && value !== null; })
                .join(' ').toLowerCase();
            for (var i = 0; i < names.length; i++) {
                if (haystack.indexOf(names[i]) !== -1) return String(folder.id);
            }
        }
    }
    return fallback;
}
function removeMessageFromUser(user, msgId) {
    if (!user || !Array.isArray(user.messages)) return false;
    var index = -1;
    for (var i = 0; i < user.messages.length; i++) {
        if (user.messages[i] && String(user.messages[i].id) === String(msgId)) { index = i; break; }
    }
    if (index !== -1) {
        user.messages.splice(index, 1);
        user.count = Math.max(0, toCount(user.count) - 1);
        user.saveState();
        app.view.showNumber();
        return true;
    }
    return false;
}
function openAndReconcileMessage(msgId, email) {
    openTab.openNewMess(msgId, email);
    muteMessage(email, msgId);
    if (app && app.account && app.account.users && app.account.users[email]) {
        removeMessageFromUser(app.account.users[email], msgId);
        broadcastPublicState();
    }
    app.lastUserActionTime = Date.now();
    setTimeout(function() {
        if (app.account && !app.account.paused) app.account.start();
    }, 3000);
}
function moveMessageToTrash(msgId, email, callback) {
    if (typeof callback !== 'function') callback = function() {};
    if (!app || !app.account || !app.account.users || !app.account.users[email]) { callback(false); return; }
    var user = app.account.users[email];
    if (!user || !user.token) { callback(false); return; }
    var message = getMessageRecord(user, msgId);
    if (!message) { callback(false); return; }
    var sourceFolder = String(message.folder !== undefined ? message.folder : '0');
    var threadValue = message.thread_id || message.threadId || message.thread || message.threadID || message.id;
    if (threadValue && typeof threadValue === 'object') threadValue = threadValue.id || threadValue.thread_id || threadValue.threadId;
    var threadId = threadValue;
    threadId = String(threadId || '');
    if (!threadId || threadId.indexOf(':') === -1) threadId = '0:' + String(msgId) + ':' + sourceFolder;
    var lastMessageId = message.expand || message.message_id_last || message.messageIdLast || message.message_id || message.id;
    if (lastMessageId === undefined || lastMessageId === null || lastMessageId === '') lastMessageId = msgId;
    var trashFolder = getFolderIdByKind(user, 'trash', '500002');
    var url = 'https://e.mail.ru/api/v1/threads/move';
    var params = new URLSearchParams();
    params.append('ids', JSON.stringify([threadId]));
    params.append('msg_ids', JSON.stringify([{ id: threadId, folder: sourceFolder }]));
    params.append('folder', trashFolder);
    var messageIdLastObj = {};
    messageIdLastObj[threadId] = String(lastMessageId);
    params.append('message_id_last', JSON.stringify(messageIdLastObj));
    params.append('email', email);
    params.append('htmlencoded', 'false');
    params.append('token', user.token);
    app.utils.request({
        url: url,
        method: 'POST',
        header: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json, text/plain, */*' },
        params: params.toString()
    }, function(data) {
        var result = safeJsonParse(data);
        var isSuccess = Boolean(result && result.status === 200);
        if (isSuccess) {
            muteMessage(email, msgId);
            removeMessageFromUser(user, msgId);
            broadcastPublicState();
        } else if (result && (result.status === 401 || result.status === 403)) {
            user.token = null;
        }
        callback(isSuccess);
    }, function() { callback(false); });
}
main();
chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === 'mail_update_alarm') {
        cleanupMutedMessages();
        if (app && app.account && !app.account.paused) app.account.start();
    } else if (alarm.name === 'unread_sound_reminder') {
        getStorageValue('repeatUnreadSound', function(enabled) {
            if (enabled === true && app && app.account && !app.account.paused && hasUnreadMessages()) safePlaySound();
        });
    }
});
function hasUnreadMessages() {
    var users = app && app.account && app.account.users ? app.account.users : {};
    for (var email in users) {
        if (users[email] && toCount(users[email].count) > 0) return true;
    }
    return false;
}
function syncUnreadSoundReminder() {
    getStorageValue('repeatUnreadSound', function(enabled) {
        if (enabled === true) {
            chrome.alarms.get('unread_sound_reminder', function(alarm) {
                if (!alarm || Math.abs(alarm.periodInMinutes - 0.5) > 0.01) {
                    chrome.alarms.create('unread_sound_reminder', { periodInMinutes: 0.5, delayInMinutes: 0.5 });
                }
            });
        } else {
            chrome.alarms.clear('unread_sound_reminder');
        }
    });
}
function syncAlarms() {
    getStorageValue("timetest", function(val) {
        var periodMinutes = Math.max(0.5, (val || 30000) / 60000);
        chrome.alarms.get('mail_update_alarm', function(alarm) {
            if (!alarm || Math.abs(alarm.periodInMinutes - periodMinutes) > 0.01) {
                chrome.alarms.create('mail_update_alarm', { periodInMinutes: periodMinutes, delayInMinutes: periodMinutes });
            }
        });
    });
    syncUnreadSoundReminder();
}
function resetAlarm() {
    getStorageValue("timetest", function(val) {
        var periodMinutes = Math.max(0.5, (val || 30000) / 60000);
        chrome.alarms.create('mail_update_alarm', { periodInMinutes: periodMinutes, delayInMinutes: periodMinutes });
    });
}
