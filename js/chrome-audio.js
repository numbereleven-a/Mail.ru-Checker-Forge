var offscreenCreation = null;
function createOffscreen() {
    if (offscreenCreation) return offscreenCreation;
    offscreenCreation = (async function() {
        if (await chrome.offscreen.hasDocument()) return;
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Sound notification'
        });
    })().finally(function() {
        offscreenCreation = null;
    });
    return offscreenCreation;
}
