/** Persistent view controls under test. Navigation owned by the parallel sidebar/Home work is excluded. */
export const stableControls = '[role="tab"], [role="switch"], button[aria-pressed], [data-pane], [data-models-tab], [data-filter], [data-au="view"], [data-conn="store-group"]';

export function assertStableClick(before, after, tolerance = 1) {
  if (!before.length) throw new Error("stable-click: no visible control was recorded");
  for (const item of before) {
    const next = after.find(value => value.selector === item.selector);
    if (!next) throw new Error(`stable-click: control/anchor disappeared: ${item.selector}`);
    for (const edge of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(item[edge]) || !Number.isFinite(next[edge]) || Math.abs(item[edge] - next[edge]) > tolerance) {
        throw new Error(`stable-click: ${item.selector} moved (${edge}: ${item[edge]} -> ${next[edge]}; tolerance ${tolerance}px)`);
      }
    }
  }
  return { check: "stable-click", before, after, tolerance };
}

/** Record the clicked control and persistent layout above it, using locators that survive redraws. */
export function stableSnapshot(selector, keys) {
  const path = element => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`);
    }
    return parts.join(' > ');
  };
  const control = [...document.querySelectorAll(selector)].find(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  if (!control) return [];
  const items = keys ? keys.map(key => ({ selector: key, node: [...document.querySelectorAll(key)].find(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0) })).filter(item => item.node) : [{ selector, node: control }];
  if (!keys) {
    const top = control.getBoundingClientRect().top;
    const boundary = control.closest('.modal, .mp-dialog, .cr-dialog, .page') ?? document.body;
    for (let node = control; node && node !== boundary; node = node.parentElement) {
      for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) {
        const bounds = previous.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0 && bounds.bottom <= top + 1) items.push({ selector: path(previous), node: previous });
      }
    }
  }
  return items.map(({ selector, node }) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { selector, x, y, width, height };
  });
}
