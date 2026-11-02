// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { copyButton, iconButton, toaster } from "./ui";
import { t } from "./i18n";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

test("copy answers on the same button, restarts its tick and restores the original name and words", async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  document.body.innerHTML = iconButton('copy', 'Copy sample').replace(' title=', ' data-tooltip=') + '<button class="btn">Copy address</button>';
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    const html = button.innerHTML;
    await copyButton(button, 'Sample');
    expect(button.getAttribute('aria-label')).toBe(t('setup.copied'));
    expect(button.dataset.tooltip ?? button.title).toBe(t('setup.copied'));
    if (button.classList.contains('icon')) expect(button.dataset.tooltip).toBe(t('setup.copied'));
    expect(button.querySelector('svg')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    await copyButton(button, 'Sample again');
    await vi.advanceTimersByTimeAsync(1000);
    expect(button.dataset.tooltip ?? button.title).toBe(t('setup.copied'));
    await vi.advanceTimersByTimeAsync(600);
    expect(button.innerHTML).toBe(html);
    expect(button.title).toBe('');
    if(button.classList.contains('icon'))expect(button.dataset.tooltip).toBe('Copy sample');
  }
});

test("a failed copy gives the existing failure toast and no success tick", async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('unavailable'));
  Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
  const toast = vi.spyOn(toaster, 'info').mockImplementation(() => {});
  const button = document.createElement('button'); button.textContent = 'Copy';
  expect(await copyButton(button, 'Sample')).toBe(false);
  expect(button.textContent).toBe('Copy'); expect(button.querySelector('svg')).toBeNull();
  expect(toast).toHaveBeenCalledOnce();
});
