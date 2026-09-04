var app = null;
var timerInterval = null;
var timerStartTime = null;
var messageDisplayLimit = 5;
document.addEventListener('DOMContentLoaded', function() { init(); });
function init() {
    document.querySelector('.gomail').addEventListener('click', function(e) { e.preventDefault(); openHome(); });
    document.querySelector('.settings').addEventListener('click', function(e) { e.preventDefault(); openSettings(); });
    document.querySelector('.update').addEventListener('click', function(e) { e.preventDefault(); var btn = this; btn.classList.add('spinning'); setTimeout(function() { btn.classList.remove('spinning'); }, 1500); loadingView(); sendAction({action: "forceUpdate"}); });
    loadingView();
    loadMessageDisplayLimit(refreshData);
}
function loadMessageDisplayLimit(callback) {
    chrome.storage.local.get(['messageLimit'], function(result) {
        if (!chrome.runtime.lastError && result) messageDisplayLimit = normalizeMessageDisplayLimit(result.messageLimit);
        if (typeof callback === 'function') callback();
    });
}
function sendAction(message) {
    chrome.runtime.sendMessage(message, function() { void chrome.runtime.lastError; });
}
function openHome() { sendAction({action: "openInbox"}); window.close(); }
function openSettings() { sendAction({action: "openSettings"}); window.close(); }
function loadingView() {
    var content = document.getElementById('content');
    var skeleton = document.getElementById('skeleton-loader');
    if (content && skeleton) {
        var accounts = content.querySelectorAll('.account');
        var currentHeight = content.offsetHeight;
        if (currentHeight > 100) content.style.minHeight = currentHeight + 'px';
        content.style.overflowY = 'hidden';
        content.querySelectorAll('.mes').forEach(function(msg) { msg.style.display = 'none'; });
        content.querySelectorAll('.empty-state').forEach(function(el) { el.style.display = 'none'; });
        content.querySelectorAll('.not_auth').forEach(function(el) { el.style.display = 'none'; });
        var skelHeader = skeleton.querySelector('.skeleton-header');
        if (accounts.length > 0) { if (skelHeader) skelHeader.style.display = 'none'; }
        else { if (skelHeader) skelHeader.style.display = 'flex'; }
        content.appendChild(skeleton);
        skeleton.classList.add('active');
    }
}
function hideLoading() {
    var skeleton = document.getElementById('skeleton-loader');
    if (skeleton) skeleton.classList.remove('active');
}
function refreshData() { tryGetFromBackground(3, 0); }
function tryGetFromBackground(retries, delay) {
    if (retries <= 0) { tryGetFromStorage(); return; }
    chrome.runtime.sendMessage({action: "getData"}, function(response) {
        if (chrome.runtime.lastError) { setTimeout(function() { tryGetFromBackground(retries - 1, delay + 500); }, delay); return; }
        if (response && response.data && response.data.account && response.data.account.ready === true) { app = response.data; viewMesg(); }
        else tryGetFromStorage();
    });
}
function tryGetFromStorage() {
    chrome.storage.local.get(null, function(result) {
        if (chrome.runtime.lastError || !result) { notAuth(); return; }
        app = createCachedPublicState(result);
        if (!app) { notAuth(); return; }
        viewMesg();
    });
}
function createCachedPublicState(result) {
    var users = {};
    Object.keys(result || {}).forEach(function(key) {
        if (key.indexOf('userState_') !== 0) return;
        var email = key.substring('userState_'.length);
        var state = result[key];
        if (!email || !state || typeof state !== 'object') return;
        users[email] = {
            email: email,
            count: Math.max(0, Number(state.count) || 0),
            messages: Array.isArray(state.messages) ? state.messages : []
        };
    });
    var emails = Object.keys(users);
    if (emails.length === 0) return null;
    return { account: { ready: false, authStatus: true, currentEmail: emails[0], users: users } };
}
var updateDebounceTimer = null;
chrome.runtime.onMessage.addListener(function(request) {
    if (request.action === "updateData") {
        app = request.data;
        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(viewMesg, 50);
    }
});
function viewMesg() {
    hideLoading();
    if (!app || !app.account || !app.account.users) { notAuth(); return; }
    var accountUsers = app.account.users;
    var keys = Object.keys(accountUsers);
    if (keys.length === 0) { notAuth(); return; }
    var content = document.getElementById('content');
    var skeleton = document.getElementById('skeleton-loader');
    var frag = document.createDocumentFragment();
    for(var i = 0; i < keys.length; i++) {
        var userItem = accountUsers[keys[i]];
        if (userItem.email) insertMess(frag, userItem.messages, userItem.email, userItem.count, messageDisplayLimit);
    }
    content.style.minHeight = '';
    content.style.overflowY = '';
    content.innerHTML = '';
    if (skeleton) content.appendChild(skeleton);
    content.appendChild(frag);
    startRefreshTimer();
}
function notAuth() {
    hideLoading();
    var content = document.getElementById('content');
    var skeleton = document.getElementById('skeleton-loader');
    content.innerHTML = '';
    if (skeleton) content.appendChild(skeleton);
    var div = document.createElement('div');
    div.className = 'not_auth';
    div.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><div style="margin-top: 12px; font-weight: 600;">Требуется авторизация</div><div style="font-size: 13px; margin: 8px 0 16px 0; color: #666;">Пожалуйста, войдите в аккаунт Mail.ru</div><a href="https://e.mail.ru/login?from=personal" target="_blank" class="login-btn-popup" style="display: inline-block; background: #005ff9; color: white; text-decoration: none; padding: 8px 20px; border-radius: 8px; font-weight: 500; font-size: 14px; transition: background 0.2s;">Войти в почту</a>';
    var btn = div.querySelector('.login-btn-popup');
    if (btn) { btn.onmouseover = function() { this.style.background = '#0054dd'; }; btn.onmouseout = function() { this.style.background = '#005ff9'; }; }
    content.appendChild(div);
}
function createSvgIcon(paths, color, width, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    var attrs = { viewBox: '0 0 24 24', fill: 'none', stroke: color,
        'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (size) { attrs.width = size; attrs.height = size; }
    Object.keys(attrs).forEach(function(key) { svg.setAttribute(key, attrs[key]); });
    paths.forEach(function(d) {
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });
    return svg;
}
function createMessageAction(action, msgId, email, label, extraClass) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-action tooltip-anchor tooltip-left' + (extraClass ? ' ' + extraClass : '');
    button.setAttribute('data-tooltip', label);
    button.setAttribute('aria-label', label);
    button.dataset.messageAction = action;
    button.dataset.msgId = String(msgId == null ? '' : msgId);
    button.dataset.email = String(email || '');
    var paths = action === 'read'
        ? ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'm4 6 8 6 8-6', 'm9 16 2 2 4-4']
        : ['M3 6h18', 'M8 6V4h8v2', 'm19 6-1 14H6L5 6', 'M10 11v5M14 11v5'];
    button.appendChild(createSvgIcon(paths, 'currentColor', '1.8'));
    return button;
}
function createAvatar(avatarValue) {
    var wrapper = document.createDocumentFragment();
    var fallback = document.createElement('div');
    fallback.className = 'avatar fallback-avatar';
    var avatar = normalizeHttpsUrl(avatarValue);
    if (avatar) {
        var image = document.createElement('img');
        image.className = 'avatar';
        image.src = avatar;
        image.referrerPolicy = 'no-referrer';
        fallback.style.display = 'none';
        image.addEventListener('error', function() {
            image.style.display = 'none';
            fallback.style.display = 'flex';
        });
        wrapper.appendChild(image);
    }
    wrapper.appendChild(fallback);
    return wrapper;
}
function getVisibleMessages(messages, displayLimit) {
    if (!Array.isArray(messages)) return [];
    var limit = normalizeMessageDisplayLimit(displayLimit);
    return limit === 0 ? messages : messages.slice(0, limit);
}
function insertMess(fragment, messages, email, count, displayLimit) {
    var headerDiv = document.createElement('div');
    headerDiv.className = 'account';
    var accountInfo = document.createElement('div');
    accountInfo.className = 'account-info';
    var emailSpan = document.createElement('span');
    emailSpan.className = 'account_name email-with-copy tooltip-anchor';
    emailSpan.textContent = email;
    emailSpan.setAttribute('data-tooltip', 'Открыть почту');
    emailSpan.onclick = function() { sendAction({action: "openInbox", email: email}); window.close(); };
    var copyIcon = document.createElement('span');
    copyIcon.className = 'copy-icon tooltip-anchor';
    copyIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyIcon.setAttribute('data-tooltip', 'Копировать адрес');
    copyIcon.onclick = function(e) { e.stopPropagation(); copyToClipboard(email); };
    accountInfo.appendChild(emailSpan);
    accountInfo.appendChild(copyIcon);
    var accountRight = document.createElement('div');
    accountRight.className = 'account-right';
    var timerSpan = document.createElement('span');
    timerSpan.className = 'timer';
    timerSpan.id = 'refresh-timer';
    var countSpan = document.createElement('span');
    countSpan.className = 'all_mess';
    countSpan.textContent = count > 0 ? count + ' новых' : 'нет новых';
    accountRight.appendChild(timerSpan);
    accountRight.appendChild(countSpan);
    headerDiv.appendChild(accountInfo);
    headerDiv.appendChild(accountRight);
    fragment.appendChild(headerDiv);
    var visibleMessages = getVisibleMessages(messages, displayLimit);
    if (visibleMessages.length > 0) {
        for (var i = 0; i < visibleMessages.length; i++) {
            var msg = visibleMessages[i];
            var from = msg.correspondents && msg.correspondents.from && msg.correspondents.from[0];
            var fromName = from ? (from.name || from.email) : 'Неизвестно';
            var avatar = (from && from.avatars) ? (from.avatars['50x50'] || from.avatars['180x180'] || from.avatars['default'] || '') : '';
            var mesDiv = document.createElement('div');
            mesDiv.className = 'mes';
            mesDiv.onclick = (function(msgId, eml, div) {
                return function(e) {
                    if (e.target.closest && e.target.closest('.message-actions')) return;
                    if (e.target.classList.contains('unread-dot')) return;
                    var dot = div.querySelector('.unread-dot');
                    if (dot && !dot.classList.contains('hidden')) hideMessageElementOptimistically(dot, div);
                    sendAction({action: "openMessage", msgId: msgId, email: eml});
                };
            })(msg.id, email, mesDiv);
            var avatarContainer = document.createElement('div');
            avatarContainer.className = 'avatar-container';
            if (msg.flags && msg.flags.unread) {
                var unreadDot = document.createElement('span');
                unreadDot.className = 'unread-dot tooltip-anchor tooltip-right';
                unreadDot.setAttribute('data-tooltip', 'Пометить прочитанным');
                unreadDot.dataset.msgId = String(msg.id == null ? '' : msg.id);
                unreadDot.dataset.email = String(email || '');
                avatarContainer.appendChild(unreadDot);
            }
            avatarContainer.appendChild(createAvatar(avatar));

            var messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            var fromDiv = document.createElement('div');
            fromDiv.className = 'from';
            var fromSpan = document.createElement('span');
            fromSpan.textContent = decodeHtmlEntities(fromName || 'Неизвестно');
            fromDiv.appendChild(fromSpan);
            if (msg.flags && msg.flags.attach) {
                var attachIcon = document.createElement('span');
                attachIcon.className = 'attach-icon tooltip-anchor';
                attachIcon.setAttribute('data-tooltip', 'Есть вложения');
                attachIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
                fromDiv.appendChild(attachIcon);
            }
            var subject = document.createElement('div');
            subject.className = 'subject';
            subject.textContent = decodeHtmlEntities(msg.subject || 'Без темы');
            var date = document.createElement('div');
            date.className = 'date';
            date.textContent = formatTime(new Date((Number(msg.date) || 0) * 1000));
            messageContent.appendChild(fromDiv);
            messageContent.appendChild(subject);
            messageContent.appendChild(date);

            var messageActions = document.createElement('div');
            messageActions.className = 'message-actions';
            messageActions.setAttribute('aria-label', 'Действия с письмом');
            if (msg.flags && msg.flags.unread) {
                messageActions.appendChild(createMessageAction('read', msg.id, email, 'Прочитать', ''));
            }
            messageActions.appendChild(createMessageAction('delete', msg.id, email, 'Удалить в корзину', 'message-action-delete'));

            mesDiv.appendChild(avatarContainer);
            mesDiv.appendChild(messageContent);
            mesDiv.appendChild(messageActions);
            fragment.appendChild(mesDiv);
        }
    } else {
        var emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6;"><path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9"></path><polyline points="2 6 12 13 22 6"></polyline><circle cx="18" cy="19" r="3"></circle><path d="M17 19l1 1 3-3"></path></svg><div>Непрочитанных писем нет</div>';
        fragment.appendChild(emptyDiv);
    }
}
document.addEventListener('click', function(e) {
    var actionButton = e.target.closest ? e.target.closest('.message-action') : null;
    if (actionButton) {
        e.preventDefault();
        e.stopPropagation();
        var actionMsgId = actionButton.getAttribute('data-msg-id');
        var actionEmail = actionButton.getAttribute('data-email');
        var action = actionButton.getAttribute('data-message-action');
        if (actionMsgId && actionEmail && !actionButton.disabled) {
            actionButton.disabled = true;
            if (action === 'read') markAsRead(actionMsgId, actionEmail, actionButton, actionButton);
            else if (action === 'delete') deleteMessage(actionMsgId, actionEmail, actionButton);
        }
        return;
    }
    if (e.target.classList.contains('unread-dot')) {
        e.stopPropagation();
        var msgId = e.target.getAttribute('data-msg-id'), email = e.target.getAttribute('data-email');
        if (msgId && email) markAsRead(msgId, email, e.target);
    }
});
function hideMessageElementOptimistically(dot, mesDiv) {
    if (dot) dot.classList.add('hidden');
    if (mesDiv) {
        mesDiv.style.overflow = 'hidden'; mesDiv.style.height = mesDiv.offsetHeight + 'px'; mesDiv.style.pointerEvents = 'none';
        mesDiv.offsetHeight;
        mesDiv.style.transition = 'opacity 0.2s ease, transform 0.2s ease, height 0.25s cubic-bezier(0.4, 0, 0.2, 1) 0.1s, padding 0.25s cubic-bezier(0.4, 0, 0.2, 1) 0.1s, border-width 0.25s cubic-bezier(0.4, 0, 0.2, 1) 0.1s';
        mesDiv.style.opacity = '0'; mesDiv.style.transform = 'scale(0.96) translateX(10px)'; mesDiv.style.height = '0px'; mesDiv.style.paddingTop = '0px'; mesDiv.style.paddingBottom = '0px'; mesDiv.style.borderBottomWidth = '0px';
        if (mesDiv._hideTimeout) clearTimeout(mesDiv._hideTimeout);
        mesDiv._hideTimeout = setTimeout(function() { mesDiv.style.display = "none"; }, 400);
        var prev = mesDiv.previousElementSibling;
        while (prev && !prev.classList.contains('account')) prev = prev.previousElementSibling;
        if (prev) {
            var countSpan = prev.querySelector('.all_mess');
            if (countSpan) {
                var c = parseInt(countSpan.textContent);
                if (!isNaN(c) && c > 0) countSpan.textContent = (c - 1) === 0 ? 'нет новых' : (c - 1) + ' новых';
            }
        }
    }
}
function restoreMessageElement(mesDiv) {
    if (!mesDiv) return;
    if (mesDiv._hideTimeout) { clearTimeout(mesDiv._hideTimeout); mesDiv._hideTimeout = null; }
    mesDiv.style.cssText = '';
    mesDiv.style.display = 'flex';
    mesDiv.style.pointerEvents = 'auto';
    var prev = mesDiv.previousElementSibling;
    while (prev && !prev.classList.contains('account')) prev = prev.previousElementSibling;
    if (prev) {
        var countSpan = prev.querySelector('.all_mess');
        if (countSpan) {
            var text = countSpan.textContent || '';
            if (text === 'нет новых') countSpan.textContent = '1 новое';
            else {
                var count = parseInt(text, 10);
                if (!isNaN(count)) countSpan.textContent = (count + 1) + ' новых';
            }
        }
    }
}
function markAsRead(msgId, email, dot, actionButton) {
    var mesDiv = dot && dot.closest ? dot.closest('.mes') : null;
    if (!mesDiv && actionButton) mesDiv = actionButton.closest('.mes');
    hideMessageElementOptimistically(dot, mesDiv);
    chrome.runtime.sendMessage({ action: "markAsRead", msgId: msgId, email: email }, function(res) {
        if (chrome.runtime.lastError || !res || !res.success) {
            if (dot) dot.classList.remove('hidden');
            restoreMessageElement(mesDiv);
            if (actionButton) actionButton.disabled = false;
        }
    });
}
function deleteMessage(msgId, email, actionButton) {
    var mesDiv = actionButton && actionButton.closest ? actionButton.closest('.mes') : null;
    hideMessageElementOptimistically(null, mesDiv);
    chrome.runtime.sendMessage({ action: "deleteMessage", msgId: msgId, email: email }, function(res) {
        if (chrome.runtime.lastError || !res || !res.success) {
            restoreMessageElement(mesDiv);
            if (actionButton) actionButton.disabled = false;
            showActionNotification('Не удалось переместить письмо в корзину', false);
        } else {
            showActionNotification('Письмо перемещено в корзину', true);
        }
    });
}
function startRefreshTimer() {
    if (timerInterval) clearInterval(timerInterval);
    chrome.storage.local.get(['timetest'], function(res) {
        var interval = Number(res.timetest) || 30000;
        chrome.alarms.get('mail_update_alarm', function(alarm) {
            timerStartTime = alarm && alarm.scheduledTime ? alarm.scheduledTime : Date.now() + interval;
            var render = function() { updateTimerDisplay(Math.max(0, timerStartTime - Date.now())); };
            render();
            timerInterval = setInterval(render, 1000);
        });
    });
}
function updateTimerDisplay(ms) {
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60), sec = s % 60;
    var txt = '⏱ ' + (m < 10 ? '0' + m : m) + ':' + (sec < 10 ? '0' + sec : sec);
    document.querySelectorAll('#refresh-timer').forEach(function(el) { el.textContent = txt; });
}
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(showCopyNotification).catch(function() { fallbackCopy(text); });
    else fallbackCopy(text);
}
function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showCopyNotification(); } catch (err) {}
    document.body.removeChild(ta);
}
function showCopyNotification() {
    var existing = document.getElementById('copy-notification'); if (existing) existing.remove();
    var notif = document.createElement('div'); notif.id = 'copy-notification'; notif.className = 'copy-notification';
    notif.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> <span>Скопировано в буфер</span>';
    document.body.appendChild(notif);
    setTimeout(function() { notif.classList.add('show'); }, 10);
    setTimeout(function() { notif.classList.remove('show'); setTimeout(function() { notif.remove(); }, 300); }, 2500);
}
function showActionNotification(message, success) {
    var existing = document.getElementById('action-notification'); if (existing) existing.remove();
    var notif = document.createElement('div'); notif.id = 'action-notification'; notif.className = 'copy-notification';
    var color = success ? '#22c55e' : '#f87171';
    notif.appendChild(createSvgIcon(['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'], color, '2', '18'));
    var messageText = document.createElement('span');
    messageText.textContent = decodeHtmlEntities(message || '');
    notif.appendChild(messageText);
    document.body.appendChild(notif);
    setTimeout(function() { notif.classList.add('show'); }, 10);
    setTimeout(function() { notif.classList.remove('show'); setTimeout(function() { notif.remove(); }, 300); }, 2500);
}
function escapeHtml(text) {
    if (!text) return '';
    return decodeHtmlEntities(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatTime(date) {
    var now = new Date(); var isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    var h = date.getHours(), min = date.getMinutes(); var t = (h < 10 ? '0' + h : h) + ':' + (min < 10 ? '0' + min : min);
    if (isToday) return t;
    var d = date.getDate(), mon = date.getMonth() + 1; return (d < 10 ? '0' + d : d) + '.' + (mon < 10 ? '0' + mon : mon) + ' ' + t;
}
