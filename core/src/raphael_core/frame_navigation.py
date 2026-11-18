"""Host navigation heard inside the page and computer frames, whose input cannot bubble to the app.

A frame whose input belongs to someone else defines `window.raphaelOwnsInput`: while it says so (the owner holds a computer's
controls), the side buttons and the keys go to that computer, as every other key does, and nothing is sent to the app."""

FRAME_NAVIGATION = """(() => {
  const mac = /Mac/i.test(navigator.platform);
  const owned = () => typeof window.raphaelOwnsInput === 'function' && window.raphaelOwnsInput();
  const send = direction => parent.postMessage({type: 'raphael-frame-navigation', direction}, '*');
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  let leftAlt = false, rightAlt = false, usedAlt = false;
  addEventListener('blur', () => { leftAlt = rightAlt = usedAlt = false; });
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick']) {
    addEventListener(type, event => {
      if (event.button !== 3 && event.button !== 4 || owned()) return;
      if (type.startsWith('pointer')) { event.stopImmediatePropagation(); return; }
      consume(event);
      if (type === 'mousedown') send(event.button === 3 ? 'back' : 'forward');
    }, true);
  }
  for (const type of ['keydown', 'keyup']) {
    addEventListener(type, event => {
      if (owned()) return;
      const down = type === 'keydown';
      if (event.code === 'AltLeft') {
        leftAlt = down;
        if (!down && usedAlt) { usedAlt = false; event.preventDefault(); }
        return;
      }
      if (event.code === 'AltRight') { rightAlt = down; return; }
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.shiftKey) return;
      const codes = mac ? ['BracketLeft', 'BracketRight'] : ['ArrowLeft', 'ArrowRight'];
      if (!(mac ? event.metaKey && !event.altKey : event.altKey && leftAlt && !rightAlt && !event.metaKey)) return;
      const index = codes.indexOf(event.code);
      if (index < 0) return;
      consume(event);
      if (down && !event.repeat) { usedAlt = !mac; send(index === 0 ? 'back' : 'forward'); }
    }, true);
  }
})();"""
