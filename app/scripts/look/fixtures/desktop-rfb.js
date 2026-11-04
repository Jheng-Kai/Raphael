// Only the remote RFB transport is synthetic. The production page/bootstrap and
// real app dialog run unchanged; native acceptance uses the image's RFB module.
export default class RFB extends EventTarget {
  constructor(target) {
    super();
    window.__desktopConnections = (window.__desktopConnections ?? 0) + 1;
    this.target = target;
    target.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:hidden;background:rgb(40,40,40)';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 768;
    const hour = new parent.Date().getHours();
    this.wallpaper = new Image();
    this.wallpaper.onload = () => this.draw();
    this.wallpaper.src = `/wallpapers/${hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 16 ? 'noon' : hour >= 16 && hour < 19 ? 'dusk' : hour >= 19 && hour < 22 ? 'evening' : 'night'}.svg`;
    this.canvas.addEventListener('mousemove', () => { if (!this.viewOnly) window.__desktopAcceptedInputs = (window.__desktopAcceptedInputs ?? 0) + 1; });
    target.append(this.canvas);
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(target);
    requestAnimationFrame(() => { this.draw(); this.dispatchEvent(new Event('connect')); });
  }
  set background(value) { this.target.style.background = value; }
  set scaleViewport(value) { this.scale = value; this.draw(); }
  set resizeSession(value) { this.resize = value; this.draw(); }
  focus() { this.canvas.focus(); }
  draw() {
    const { width, height } = this.target.getBoundingClientRect();
    if (this.resize && width && height) { this.canvas.width = Math.round(width); this.canvas.height = Math.round(height); }
    const scale = this.scale ? Math.min(width / this.canvas.width, height / this.canvas.height) : 1;
    this.canvas.style.width = `${this.canvas.width * scale}px`;
    this.canvas.style.height = `${this.canvas.height * scale}px`;
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = '#171717'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.wallpaper.complete && this.wallpaper.naturalWidth) ctx.drawImage(this.wallpaper,0,0,this.canvas.width,this.canvas.height);
    ctx.fillStyle = '#171717'; ctx.fillRect(16, 40, 600, 220);
    ctx.fillStyle = '#dce4ef'; ctx.fillRect(0, 0, this.canvas.width, 28);
    ctx.fillStyle = '#182332'; ctx.font = '14px system-ui'; ctx.fillText('工作區 — 測試桌面', 12, 19);
    ctx.fillStyle = '#eef3fa'; ctx.font = '16px monospace';
    ['$ cat raphael-smoke.txt', 'Raphael VM smoke', '', '$ pwd', '/home/cua/workspace'].forEach((line, i) => ctx.fillText(line, 24, 72 + i * 26));
  }
  disconnect() { this.observer.disconnect(); this.canvas.remove(); this.dispatchEvent(new Event('disconnect')); }
}
