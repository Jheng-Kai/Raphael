"""First input waits inside the viewer until its authenticated lease is ready."""

INPUT_TAKEOVER = b"""
function bindViewerInput(pointerEvents, surface, ownsInput, replayPointer, target = () => surface()) {
  let enabled = false, expanded = false, queuedTarget, pending = false, timeout;
  const queued = [];
  window.raphaelFoldsInput = () => expanded;
  function clear() {
    clearTimeout(timeout);
    queued.length = 0;
    pending = false;
  }
  addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'raphael-desktop-surface') {
      enabled = event.data.enabled === true;
      expanded = enabled && event.data.expanded === true;
      if (!enabled) clear();
    }
    if (event.data?.type === 'raphael-desktop-control' && !event.data.held) clear();
    if (event.data?.type === 'raphael-desktop-input-ready' && ownsInput()) {
      if (enabled && target() === queuedTarget) for (const replay of queued) replay();
      clear();
    }
  });
  addEventListener('blur', clear);
  for (const type of [...pointerEvents, 'wheel', 'keydown', 'keyup']) {
    addEventListener(type, event => {
      if (!enabled || !event.isTrusted || event.defaultPrevented || !pending && ownsInput()) return;
      const canvas = surface();
      const keyboard = event instanceof KeyboardEvent;
      if (!canvas || !keyboard && event.target !== canvas) return;
      if (keyboard && (event.isComposing || event.keyCode === 229)) return;
      if (!pending && (type === 'keyup' || /(?:move|up|cancel)$/.test(type))) return;
      if (!pending && keyboard && expanded && event.key === 'Alt') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!pending) {
        pending = true;
        queuedTarget = target();
        timeout = setTimeout(clear, 12000);
        parent.postMessage({ type: 'raphael-desktop', state: 'take-input' }, '*');
      }
      if (queued.length >= 96) { clear(); return; }
      if (keyboard) {
        queued.push(() => {
          const key = new KeyboardEvent(type, event);
          Object.defineProperties(key, {
            keyCode: { value: event.keyCode },
            getModifierState: { value: event.getModifierState.bind(event) },
          });
          (document.activeElement || event.target).dispatchEvent(key);
        });
      } else {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
        queued.push(() => replayPointer(canvas, event, x, y));
      }
    }, { capture: true, passive: false });
  }
}
"""

VM_INPUT = b"""
bindViewerInput(['mousedown', 'mousemove', 'mouseup'], () => screen.querySelector('canvas'),
  window.raphaelOwnsInput, (canvas, event, x, y) => {
    const rect = canvas.getBoundingClientRect();
    const EventClass = event.type === 'wheel' ? WheelEvent : MouseEvent;
    const point = { bubbles: true, cancelable: true, clientX: rect.left + rect.width*x, clientY: rect.top + rect.height*y,
      button: event.button, buttons: event.buttons, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode };
    canvas.dispatchEvent(new EventClass(event.type, point));
  });
"""

