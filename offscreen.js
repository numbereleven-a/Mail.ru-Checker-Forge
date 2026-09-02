chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "playSound") {
        const audio = document.getElementById("sound");
        if (!audio) {
            sendResponse({ success: false });
            return true;
        }
        const soundFile = msg.soundFile || "05-gentle-pop.wav";
        audio.src = chrome.runtime.getURL("sound/" + soundFile);
        audio.volume = msg.volume || 0.6;
        audio.currentTime = 0;
        audio.play().then(() => sendResponse({ success: true }))
                    .catch((err) => sendResponse({ success: false, error: err.name }));
        return true;
    }
    if (msg.type === "stopSound") {
        const audio = document.getElementById("sound");
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        sendResponse({ success: true });
        return true;
    }
});
