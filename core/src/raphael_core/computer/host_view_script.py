"""Script for the host transport's loopback canvas page."""

SCRIPT = br"""
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d', { alpha: false });
const input = document.querySelector('textarea');
const tell = (state, details = {}) => parent.postMessage({ type: 'raphael-desktop', state, ...details }, '*');
let stream, connected = false, interactive = false, desired = false, thumbnails = false;
let frame, viewport, thumbnailTimer, controlRevision = 0, pasteId = 0, lastThumbnail = 0;

async function watch() {
    if (stream || document.hidden) return;
    const feed = stream = new AbortController();
    try {
        const response = await fetch('host-frames', { signal: feed.signal });
        if (!response.ok) throw new Error('Stream unavailable');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (stream === feed) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const end = pending.lastIndexOf('\n');
            if (end < 0) continue;
            const start = pending.lastIndexOf('\n', end - 1);
            const next = JSON.parse(pending.slice(start + 1, end));
            pending = pending.slice(end + 1);
            const image = new Image();
            image.src = 'data:image/jpeg;base64,' + next.image;
            await image.decode();
            if (stream !== feed) break;
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            context.drawImage(image, 0, 0);
            viewport = next;
            frame = image.src;
            if (!connected) {
                connected = true;
                tell('connected');
                if (desired) void control(true);
            }
            thumbnail();
        }
    } catch {
        // The parent owns retry and session disposal.
    } finally {
        if (stream === feed) {
            stream = undefined;
            tell(connected ? 'disconnected' : 'unreachable');
        }
    }
}

function stop() {
    stream?.abort();
    stream = undefined;
    connected = interactive = false;
    controlRevision++;
    pasteId++;
    clearTimeout(thumbnailTimer);
}

function thumbnail(force = false) {
    clearTimeout(thumbnailTimer);
    if (!thumbnails || !frame || interactive || !connected) return;
    const now = performance.now();
    const remaining = 2000 - (now - lastThumbnail);
    if (!force && remaining > 0) {
        thumbnailTimer = setTimeout(() => thumbnail(true), remaining);
        return;
    }
    lastThumbnail = now;
    tell('frame', { image: frame });
}

async function control(held) {
    desired = held;
    const revision = ++controlRevision;
    if (!held) {
        interactive = false;
        pasteId++;
        tell('interactive', { held: false });
        return;
    }
    try {
        const response = await fetch('control');
        const value = response.ok && (await response.json()).held;
        if (revision !== controlRevision || !connected) return;
        interactive = value === true;
        if (interactive) input.focus({ preventScroll: true });
        tell('interactive', { held: interactive });
    } catch {
        // The parent handles a takeover that the viewer could not confirm.
    }
}

let sending = false;
const events = [];
async function dispatch(event) {
    if (!interactive) return;
    const revision = controlRevision;
    const latest = events.at(-1);
    if (latest?.event.type === 'mouseMoved' && event.type === 'mouseMoved') events.pop();
    events.push({ revision, event });
    if (sending) return;
    sending = true;
    try {
        while (events.length) {
            const next = events.shift();
            if (!interactive || next.revision !== controlRevision) continue;
            const response = await fetch('host-input', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next.event) });
            if (response.ok && next.revision === controlRevision) tell('input-accepted');
        }
    } catch {
        events.length = 0;
    } finally {
        sending = false;
    }
}

const modifiers = event => Number(event.altKey) + 2 * Number(event.ctrlKey)
    + 4 * Number(event.metaKey) + 8 * Number(event.shiftKey);
function pointer(event, type) {
    if (!interactive || !viewport) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const x = (event.clientX - rect.left - (rect.width - canvas.width * scale) / 2) / (canvas.width * scale);
    const y = (event.clientY - rect.top - (rect.height - canvas.height * scale) / 2) / (canvas.height * scale);
    if (!canvas.hasPointerCapture(event.pointerId) && (x < 0 || x > 1 || y < 0 || y > 1)) return;
    event.preventDefault();
    if (type === 'mousePressed') {
        input.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
    }
    const count = event.detail || 1;
    const delta = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
    void dispatch({ type, x: x * viewport.width, y: y * viewport.height, modifiers: modifiers(event),
        button: ['left', 'middle', 'right', 'back', 'forward'][event.button], buttons: event.buttons,
        count: Math.min(count, 3), deltaX: event.deltaX * delta, deltaY: event.deltaY * delta });
}
canvas.addEventListener('pointerdown', event => pointer(event, 'mousePressed'));
canvas.addEventListener('pointerup', event => pointer(event, 'mouseReleased'));
canvas.addEventListener('pointermove', event => pointer(event, 'mouseMoved'));
canvas.addEventListener('pointercancel', () => void dispatch({ type: 'release' }));
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => pointer(event, 'mouseWheel'), { passive: false });
window.addEventListener('blur', () => void dispatch({ type: 'release' }));

function key(event) {
    if (!interactive || event.isComposing || event.keyCode === 229 || event.key === 'Dead') return;
    event.preventDefault();
    const down = event.type === 'keydown';
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
        if (down) parent.postMessage({ type: 'raphael-desktop-paste-request', id: ++pasteId }, '*');
        return;
    }
    const text = down && [...event.key].length === 1 && (!(event.ctrlKey || event.metaKey) || event.getModifierState('AltGraph'))
        ? event.key : '';
    void dispatch({ type: down ? 'keyDown' : 'keyUp', key: event.key, code: event.code,
        virtual: event.keyCode, modifiers: modifiers(event), text });
}
input.addEventListener('keydown', key);
input.addEventListener('keyup', key);
input.addEventListener('compositionend', event => {
    void dispatch({ type: 'text', text: event.data });
    input.value = '';
});
input.addEventListener('paste', event => {
    event.preventDefault();
    void dispatch({ type: 'text', text: event.clipboardData.getData('text/plain') });
});
window.addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'raphael-desktop-control') void control(event.data.held === true);
    if (event.data?.type === 'raphael-desktop-frames') {
        thumbnails = event.data.on === true;
        thumbnail(true);
    }
    if (event.data?.type === 'raphael-desktop-paste' && event.data.id === pasteId && typeof event.data.text === 'string') {
        void dispatch({ type: 'text', text: event.data.text });
    }
});
document.addEventListener('visibilitychange', () => document.hidden ? stop() : void watch());
window.addEventListener('pagehide', stop);
void watch();
"""
