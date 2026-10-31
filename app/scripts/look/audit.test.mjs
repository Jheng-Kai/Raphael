import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { auditDocument, failedChecks } from "./audit.mjs";
import { checkRendered } from "./checks.mjs";
import { scenes } from "./scenes/index.mjs";
import { LATIN_NAMES } from "./runner.mjs";

describe("rendered look checks", () => {
  it("does not mistake a fallback card's action glyph for a rendered Mermaid diagram", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="page-agent"><section class="rich-block message-diagram"><header><button><svg></svg></button></header><div class="diagram-view"></div><pre>unfinished</pre><p class="rich-note">Still writing</p></section></div>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ right: 110, width: 100, height: 40 });
    vi.stubGlobal('document', window.document); vi.stubGlobal('innerWidth', 1120);
    try {
      expect(() => checkRendered('rich-fallback')).not.toThrow();
      window.document.querySelector('.diagram-view').innerHTML = '<svg></svg>';
      expect(() => checkRendered('rich-fallback')).toThrow('keeps source');
    } finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("measures SVG overflow at its CSS container and allows only rich code's local horizontal scroll", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="page-agent"><div class="chat-message"><div class="rich-block message-code"><pre style="overflow-x:auto">long command</pre></div><svg><text>Diagram</text></svg></div></div>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 50, width: 100, height: 40 });
    const text = window.document.querySelector('text'), pre = window.document.querySelector('pre');
    for (const node of [text, pre]) {
      Object.defineProperty(node, 'clientWidth', { value: 100 });
      Object.defineProperty(node, 'scrollWidth', { value: 300 });
    }
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).horizontalOverflow.elements).toEqual([]);
    vi.stubGlobal('document', window.document); vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window));
    try { expect(() => checkRendered('message-no-inner-scroll')).not.toThrow(); }
    finally { vi.unstubAllGlobals(); window.happyDOM.abort(); }
  });
  it("treats diagram labels and code languages as authored content while still checking rich actions", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="message-diagram"><span class="rich-language">bash</span><div class="diagram-view"><svg><text>Review sources</text></svg></div><button>Copy</button></div><button>Load image</button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Copy", "Load", "image"]);
  });
  it("keeps authored code intact while still checking its interface controls for translation", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="message-code"><pre><code><span class="hljs-comment"># Print a summary</span>const ready = true;</code></pre><button>Copy</button></div><p>Settings</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Copy", "Settings"]);
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).rawMarkdown).toEqual([]);
  });
  it("quick model purpose comes from its localized row label without a helper paragraph", () => {
    const win = new Window();
    win.document.documentElement.lang = "zh-TW";
    win.document.body.innerHTML = '<div data-row="quick-model"><div class="t">快速提問</div><button class="mp-trigger"><span class="mp-tname">GPT</span><span class="mp-source">Codex</span></button><span data-price="quick-model">Subscription</span></div>';
    win.document.querySelector('.mp-trigger').getBoundingClientRect = () => ({ width: 200, height: 60 });
    vi.stubGlobal('document', win.document);
    try {
      expect(() => checkRendered('quick-model-row')).not.toThrow();
      win.document.querySelector('.t').textContent = 'Model';
      expect(() => checkRendered('quick-model-row')).toThrow('row label');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });
  it("allows the Docker brand in localized unavailable states and still rejects untranslated actions", () => {
    const win = new Window();
    win.document.body.innerHTML = '<p class="desktop-status">Docker 目前無法使用</p><p>需要 Docker Desktop。</p><button>Take control</button><button>Desktop</button>';
    for (const element of win.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 });
    const findings = auditDocument(win.document, { width: 1120, height: 900 }, [], LATIN_NAMES.map(name => name.toLowerCase())).mixedLanguage;
    const words = findings.map(item => item.word);
    expect(words).not.toContain("Docker");
    expect(words).toContain("Take");
    expect(findings.filter(item => item.word === "Desktop").map(item => item.text)).toEqual(["Desktop"]);
  });
  it("rejects machine diagnostics in failure replies and sidebar previews, including Markdown italics", () => {
    const win = new Window();
    const natural = "Gmail 還沒登入或缺少金鑰，請到設定 › 連接完成連線。";
    win.document.body.innerHTML = `<div class="tn"><div class="ra"><div class="chat-message" data-expandable>${natural}</div></div></div><div class="mb-col"><div data-member="1" aria-current="true"><span class="mb-row-p">${natural}</span></div></div>`;
    const reply = win.document.querySelector('.chat-message'), preview = win.document.querySelector('.mb-row-p');
    for (const element of [reply, preview]) element.getBoundingClientRect = () => ({ width: 200, height: 40 });
    vi.stubGlobal('document', win.document);
    try {
      expect(checkRendered('failure-owner-copy').preview).toBe(natural);
      for (const element of [reply, preview]) {
        for (const token of ['auth_expired', '(auth<em>expired</em>)', ';', 'not_configured']) {
          element.innerHTML = `${natural} ${token}`;
          expect(() => checkRendered('failure-owner-copy')).toThrow('exposes no machine diagnostic');
        }
        element.textContent = natural;
      }
      preview.remove();
      expect(() => checkRendered('failure-owner-copy')).toThrow('sidebar preview are visible');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });
  it("checks every dialog footer button and accepts hits on its children", () => {
    const win = new Window();
    win.document.body.innerHTML = '<div class="cs-scrim"><div class="cs-dialog"><div class="action-row"><button><span>Retry</span></button><button>Done</button></div></div></div><div class="toast">Saved</div>';
    const buttons = [...win.document.querySelectorAll('button')];
    win.document.querySelector('.cs-dialog').getBoundingClientRect = () => ({ width: 400, height: 300 });
    buttons.forEach((button, i) => { button.getBoundingClientRect = () => ({ left: 20 + i * 100, top: 200, width: 80, height: 32 }); });
    win.document.elementFromPoint = vi.fn(x => x < 100 ? buttons[0].firstElementChild : buttons[1]);
    vi.stubGlobal('document', win.document);
    try {
      expect(checkRendered('connections-dialog-actions')).toEqual({ check: 'connections-dialog-actions', buttons: 2 });
      expect(win.document.elementFromPoint.mock.calls).toEqual([[60, 216], [160, 216]]);
      win.document.elementFromPoint = x => x < 100 ? buttons[0] : win.document.querySelector('.toast');
      expect(() => checkRendered('connections-dialog-actions')).toThrow('footer action "Done" is covered');
      win.document.elementFromPoint = () => win.document.querySelector('.toast');
      expect(() => checkRendered('connections-dialog-actions')).toThrow('footer action "Retry" is covered');
    } finally { vi.unstubAllGlobals(); win.happyDOM.abort(); }
  });

  it("rejects a mixed connection switch while allowing binary permissions", () => {
    const win = new Window(), previous = { window: globalThis.window, document: globalThis.document };
    try {
      globalThis.window = win; globalThis.document = win.document;
      win.document.body.innerHTML = '<div class="cs"><button role="switch" aria-checked="mixed"></button></div>';
      expect(() => checkRendered("connections-binary")).toThrow("never have a mixed");
      win.document.querySelector('button').setAttribute('aria-checked', 'false');
      expect(checkRendered("connections-binary")).toEqual({ check: "connections-binary", switches: 1 });
    } finally { globalThis.window = previous.window; globalThis.document = previous.document; win.happyDOM.abort(); }
  });

  it("rejects an emblem masquerading as Stop after a roster repaint", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div class="page-agent"><form class="composer" data-task-state="running"><button class="cmp-voice" aria-label="停止"><span class="av"></span></button><button class="cmp-send"></button></form></div>';
    const voice = window.document.querySelector('.cmp-voice');
    voice.getBoundingClientRect = () => ({ width: 32, height: 32 });
    vi.stubGlobal('document', window.document);
    try {
      expect(() => checkRendered('composer-stop-slot')).toThrow(/Stop is drawn/);
      voice.innerHTML = '<svg></svg>';
      voice.querySelector('svg').getBoundingClientRect = () => ({ width: 20, height: 20 });
      expect(checkRendered('composer-stop-slot').state).toBe('running');
      voice.classList.add('vm-away');
      expect(() => checkRendered('composer-stop-slot')).toThrow(/animation/);
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects known English interface labels while preserving user content and brands", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button>Save</button><button>Raphael</button><p class="message-text">Save</p><button hidden>Cancel</button>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], null, ['Save', 'Cancel', 'Raphael']);
    expect(result.productRules.map(item => item.rule)).toEqual(['R-UI-14']);
  });
  it("keeps an authored conversation title even when it matches an English interface label", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button class="conversation-trigger" aria-label="Project"><span class="conversation-caption">Project</span></button><button class="conversation-open"><span>Project</span></button><button>Save</button>';
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], null, ['Project', 'Save']);
    expect(result.productRules.map(item => item.text)).toEqual(['Save']);
  });
  const productAudit = html => {
    const window = new Window();
    window.document.body.innerHTML = html;
    for (const element of window.document.querySelectorAll('*')) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    return { window, audit: () => auditDocument(window.document, { width: 1120, height: 900 }, []) };
  };
  it("rejects text that vanishes at rest or under the pointer (R-UI-52)", () => {
    const { window, audit } = productAudit('<div style="background-color:rgb(30,30,30)"><button class="vanish" style="color:rgb(245,245,245)">Show all</button><p class="dim" style="color:rgb(10,10,10)">Link</p></div><style>.vanish:hover{background-color:rgb(245,245,245)}</style>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-52').map(item => item.class)).toEqual(['dim', 'vanish']);
    window.document.querySelector('.dim').style.color = 'rgb(245,245,245)';
    window.document.querySelector('style').textContent = '.vanish:hover{background-color:rgba(245,245,245,.14)}';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-52')).toEqual([]);
  });
  it("rejects a light in the colour of the words it passes over (R-UI-55)", () => {
    const { window, audit } = productAudit('<span class="shimmer" style="background-image:linear-gradient(90deg,rgb(9,9,9),rgb(9,9,9))">x</span>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-55')).toHaveLength(1);
    window.document.querySelector('.shimmer').style.backgroundImage = 'linear-gradient(90deg,rgba(9,9,9,0.4),rgb(9,9,9))';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-55')).toEqual([]);
  });
  it("rejects a crop on a slime (R-UI-54)", () => {
    const { window, audit } = productAudit('<span class="mb-av-slime" style="overflow:hidden"><svg></svg></span>');
    expect(audit().productRules.filter(item => item.rule === 'R-UI-54')).toHaveLength(1);
    window.document.querySelector('.mb-av-slime').style.overflow = 'visible';
    expect(audit().productRules.filter(item => item.rule === 'R-UI-54')).toEqual([]);
  });
  it("rejects words that hug the edge of a hover fill (R-UI-53)", () => {
    const { window, audit } = productAudit('<div class="row" style="color:rgb(10,10,10);background-color:rgb(255,255,255)">Quick questions</div><style>.row:hover{background-color:rgb(230,230,230)}</style>');
    const row = window.document.querySelector('.row');
    row.getBoundingClientRect = () => ({ left: 20, top: 10, right: 220, bottom: 50, width: 200, height: 40 });
    const inset = px => { window.Range.prototype.getClientRects = () => [{ left: 20 + px, right: 120 + px }]; };
    inset(2);
    expect(audit().productRules.filter(item => item.rule === 'R-UI-53').map(item => item.class)).toEqual(['row']);
    inset(8);
    expect(audit().productRules.filter(item => item.rule === 'R-UI-53')).toEqual([]);
  });
  it("rejects a second dots style in the conversation", () => {
    const { window, audit } = productAudit('<section class="page-agent"><p class="ans thinking"><span class="think"></span></p></section>');
    expect(audit().productRules).toContainEqual(expect.objectContaining({ rule: 'R-UI-38', reason: 'Conversation waiting must use the shared work line' }));
    window.document.querySelector('.ans').remove();
    expect(audit().productRules).toEqual([]);
  });
  it("checks visible primary calendar choices without counting the hidden responsive copy", () => {
    const window = new Window();
    window.document.body.innerHTML = '<nav id="nav"><button class="mb-chief"></button></nav><aside hidden><button data-drag-member="0"></button><button data-drag-member="1"></button></aside><div><button data-drag-member="1"></button><button data-drag-member="0"></button></div>';
    for (const element of window.document.querySelectorAll('div button')) element.getBoundingClientRect = () => ({ width: 100, height: 30 });
    window.__look = { data: { primaryId: 1, members: [{ id: 0 }, { id: 1 }] }, calls: [] };
    vi.stubGlobal('document', window.document); vi.stubGlobal('window', window);
    try {
      expect(checkRendered('primary-calendar').members).toEqual([1, 0]);
      window.document.querySelector('div').innerHTML = '<button data-drag-member="0"></button><button data-drag-member="1"></button>';
      for (const element of window.document.querySelectorAll('div button')) element.getBoundingClientRect = () => ({ width: 100, height: 30 });
      expect(() => checkRendered('primary-calendar')).toThrow(/exchange/);
    } finally { vi.unstubAllGlobals(); }
  });
  it("rejects mismatched adjacent import heights and schedule widths (R-UI-17)", () => {
    const { window, audit } = productAudit('<div class="mp-add"><input><button class="btn" style="border:1px solid gray">Import</button></div><label class="au-field"><button class="sel">End</button><input class="mb-fin"></label>');
    const input = window.document.querySelector('.mp-add input');
    input.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 54, width: 100, height: 44 });
    const count = window.document.querySelector('.mb-fin');
    count.getBoundingClientRect = () => ({ left: 10, top: 10, right: 128, bottom: 40, width: 118, height: 30 });
    expect(audit().productRules.filter(item => item.rule === 'R-UI-17')).toHaveLength(2);
    input.getBoundingClientRect = count.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("lets short dictionary entries add columns instead of treating them as long choices", () => {
    const { audit } = productAudit('<div class="wgrid"><div class="wrow"></div><div class="wrow"></div><div class="wrow"></div></div>');
    expect(audit().productRules).toEqual([]);
  });
  it("gives sidebar icon controls no surface of their own", () => {
    const { audit } = productAudit('<nav id="nav"><div class="mb-top"><button class="btn icon mb-tool" data-col="other" style="background:#fff;border:1px solid #888"></button></div></nav>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-16', 'R-UI-18']);
  });
  it("rejects icon surfaces, incorrect glyph sizing and off-center icons (R-UI-16/19)", () => {
    const { window, audit } = productAudit('<button class="btn icon" style="border:0;background:gray"><svg class="i"></svg></button>');
    const button = window.document.querySelector('button'), glyph = button.firstElementChild;
    glyph.getBoundingClientRect = () => ({ left: 10, top: 10, right: 24, bottom: 24, width: 14, height: 14 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-16', 'R-UI-19', 'R-UI-19']);
    button.style.background = 'transparent';
    glyph.getBoundingClientRect = () => ({ left: 52, top: 17, right: 68, bottom: 33, width: 16, height: 16 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects low-contrast selected dates, including hover overrides (R-UI-22)", () => {
    const { window, audit } = productAudit('<div class="au-month-grid"><button class="btn" aria-pressed="true" style="border:0;color:rgb(30,30,30);background:rgb(40,40,40)">28</button></div>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-22']);
    window.document.querySelector('button').style.color = 'white';
    expect(audit().productRules).toEqual([]);
  });
  it("rejects repeated settings subtitles and wrapped shortcut rows (R-UI-02/17)", () => {
    const { window, audit } = productAudit('<div class="modal-body"><p class="purpose">Settings description</p></div><div class="page-overview"><div class="kc-row"><span class="kc-name">Ask</span><span class="kc-keys">Right Alt + Space</span></div></div>');
    window.document.querySelector('.kc-keys').getBoundingClientRect = () => ({ left: 10, top: 45, right: 110, bottom: 75, width: 100, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-02', 'R-UI-17']);
  });
  it("keeps a gap between the model source scrollport and its footer action (R-UI-17)", () => {
    const { window, audit } = productAudit('<aside><div class="mc-source-list"></div><button class="btn" style="border:1px solid gray">Connect</button></aside>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-17']);
    window.document.querySelector('button').getBoundingClientRect = () => ({ left: 10, top: 48, right: 110, bottom: 78, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects a clipped selected model source (R-UI-01)", () => {
    const { window, audit } = productAudit('<div class="mc-source-list"><button class="btn mc-source" aria-pressed="true">OpenRouter</button></div>');
    const selected = window.document.querySelector('button');
    selected.getBoundingClientRect = () => ({ left: 10, top: 30, right: 110, bottom: 60, width: 100, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-01']);
    selected.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects small onboarding headlines and narrow primary actions (R-UI-37)", () => {
    const { window, audit } = productAudit('<div class="ob-col"><h2 style="font-size:20px">Welcome</h2></div><div class="ob-actions"><button class="btn pri" style="border:1px solid gray">Start</button></div>');
    window.document.querySelector('.ob-actions').getBoundingClientRect = () => ({ left: 10, top: 10, right: 410, bottom: 40, width: 400, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-37', 'R-UI-37']);
    window.document.querySelector('h2').style.fontSize = '28px';
    window.document.querySelector('button').getBoundingClientRect = () => ({ left: 10, top: 10, right: 410, bottom: 40, width: 400, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("requires a vertical onboarding ability checklist (R-UI-35)", () => {
    const { window, audit } = productAudit('<div class="ob-abilities"><button class="btn" style="border:1px solid gray">Dictate</button><button class="btn" style="border:1px solid gray">Ask</button></div>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-35']);
    window.document.querySelector('.ob-abilities').lastElementChild.getBoundingClientRect = () => ({ left: 10, top: 50, right: 110, bottom: 80, width: 100, height: 30 });
    expect(audit().productRules).toEqual([]);
  });
  it("rejects duplicate custom and native tooltips", () => {
    const { audit } = productAudit('<button data-tooltip="Save" title="Save">Save</button><button data-tooltip="Open"><svg><title>Open</title></svg></button><button title="Native">Native</button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-26', 'R-UI-26']);
  });
  it("rejects visible row destruction but permits overflow menus", () => {
    const { audit } = productAudit('<div class="mp-resource"><button class="danger">Delete</button></div><div role="menu"><div class="mp-resource"><button class="danger">Delete</button></div></div><div class="mp-resource" hidden><button class="danger">Delete</button></div>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-11']);
  });
  it("rejects a ⋯ that a right click on its row does not reach (R-UI-44)", () => {
    const { window, audit } = productAudit('<div class="row"><button class="btn icon" data-overflow aria-label="更多"></button></div>');
    expect(audit().productRules).toEqual([]);
    const orphan = { tag: "button", id: "", class: "btn icon", text: "更多" };
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], null, [], [orphan]);
    expect(result.productRules.map(item => item.rule)).toEqual(["R-UI-44"]);
    expect(failedChecks({ ...result, runtimeErrors: [] })).toBe(true);
  });
  it("permits the scoped floating latest action without relaxing ordinary icon rules", () => {
    const { audit } = productAudit('<div class="page-agent"><div class="ra-stage"><button class="btn icon conversation-latest" style="border:1px solid gray;background:white"></button></div></div><button class="btn icon conversation-latest" style="border:1px solid gray;background:white"></button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-16', 'R-UI-18']);
  });
  it("checks text frames and bare icon borders", () => {
    const { audit } = productAudit('<button class="btn" style="border: none">Save</button><button class="btn icon" style="border: 1px solid red">X</button><button class="btn" style="border: 1px solid red">Cancel</button>');
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-18', 'R-UI-18']);
  });
  it("checks rendered primary and destructive action positions", () => {
    const { window, audit } = productAudit('<div class="action-row"><button class="pri">Save</button><span class="action-destructive"><button>Delete</button></span></div>');
    const primary = window.document.querySelector('.pri');
    primary.getBoundingClientRect = () => ({ left: 0, top: 10, right: 50, bottom: 40, width: 50, height: 30 });
    expect(audit().productRules.map(item => item.rule)).toEqual(['R-UI-27', 'R-UI-27']);
  });
  it("distinguishes date choices and navigation from ordinary text actions", () => {
    const { audit } = productAudit('<div class="au-month-grid"><button class="btn" style="border:0">25</button></div><button class="btn mb-panel-back" style="border:0">Members</button><button class="btn mc-source" style="border:0">Provider</button><button class="btn cs-main" style="border:0">Notion service details</button><div class="ho-month"><button class="btn ho-day" style="border:0">30</button></div><button class="btn conversation-new" style="border:0">New conversation</button>');
    expect(audit().productRules.map(item => item.text)).toEqual(['New conversation']);
  });
  it.each(scenes.filter(scene => scene.name.endsWith("composer-learn")))("keeps $name correction data distinct from untranslated UI", scene => {
    const window = new Window(), { before, after } = scene.fixture.dictationText;
    expect(scene.steps.find(step => step.action === "dictation-paste").text).toBe(before);
    expect(scene.steps.find(step => step.action === "type").text).toBe(after);
    window.document.body.innerHTML = `<p>${after}</p><p>OpenMausBot</p><button>Message</button>`;
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const allowed = Object.values(scene.fixture.dictationText).flatMap(text => text.match(/[A-Za-z]{2,}/g) ?? []).map(word => word.toLowerCase());
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], allowed).mixedLanguage.map(item => item.word)).toEqual(["Message"]);
  });
  it.each(["# Heading", "## Heading", "Text\n  ### Heading", "- [ ] Pending", "**bold**", "```js\ncode\n```"])("rejects visible raw Markdown: %s", text => {
    const window = new Window();
    const paragraph = window.document.createElement("p");
    paragraph.textContent = text; window.document.body.append(paragraph);
    paragraph.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }), runtimeErrors: [] };
    expect(result.rawMarkdown).toHaveLength(1);
    expect(result.rawMarkdown[0].text).toBe(text);
    expect(failedChecks(result)).toBe(true);
  });
  it("ignores rendered formatting, ordinary hashes, hidden text and Markdown outside a scrollport", () => {
    const window = new Window();
    window.document.body.innerHTML = '<h3>Conclusion</h3><p><strong>Owner</strong>: next step, issue #123, color #fff</p><div hidden>### Hidden</div><div style="overflow-y:auto"><p id="offscreen">**older**</p></div>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    window.document.querySelector("#offscreen").getBoundingClientRect = () => ({ left: 10, top: 200, right: 100, bottom: 230, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }).rawMarkdown).toEqual([]);
  });
  it("permits Markdown inside an editor field but still rejects it in the text beside the field", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea id="skill-text">---\nname: weekly\n---\n# Weekly\n\n- [ ] one\n**bold**</textarea><p>## Heading</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }).rawMarkdown.map(item => item.text)).toEqual(["## Heading"]);
  });
  it("does not translate user-entered textarea data but still audits its UI attributes", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="Message">C:/Work/Team notes</textarea><textarea aria-label="名稱">User supplied text</textarea>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["Message"]);
  });
  it("allows complete product names without allowing their ordinary English words", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>Claude Code</p><p>claude code</p><p>Code required</p><p>Claude Coder</p><p>KEY=value</p><p>value required</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], ["claude", "claude code", "key=value"]).mixedLanguage.map(item => item.word)).toEqual(["Code", "required", "Coder", "value"]);
  });
  it("allows the exact external Composio menu path while rejecting English settings labels", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>Composio「Settings → Project Settings → API Keys」</p><button>Settings</button><button>API Keys</button>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], LATIN_NAMES.map(name => name.toLowerCase())).mixedLanguage.map(item => item.word)).toEqual(["Settings", "Keys"]);
  });
  it("allows the exact command-template token while rejecting input used as English prose", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="指令範本；以 {input} 代入後續文字"></textarea><p>input required</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, [], []).mixedLanguage.map(item => item.word)).toEqual(["input", "required"]);
  });
  it("allows protocol names while still rejecting English prose beside technical examples", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="Authorization=Bearer ..."></textarea><textarea placeholder=\'{"mcpServers": {}}\'></textarea><p>Send request</p>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, [], ["authorization", "bearer", "mcpservers"]);
    expect(result.mixedLanguage.map(item => item.word)).toEqual(["Send", "request"]);
  });
  it("rejects interface copy left in English in a Chinese window, allowing data and product names", () => {
    const window = new Window();
    window.document.body.innerHTML = '<textarea placeholder="Message 紫苑"></textarea><button aria-label="問拉斐爾">Google Calendar</button><p>Finance 已建立</p><a href="#">研究訪談摘要.pdf</a>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }, [], ["google", "calendar", "finance"]), runtimeErrors: [] };
    expect(result.mixedLanguage.map(item => item.word)).toEqual(["Message"]);
    expect(failedChecks(result)).toBe(true);
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).mixedLanguage).toEqual([]);
  });
  it("rejects non-finite durations in visible work summaries", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button class="work-toggle">已處理 NaN 秒</button><div hidden><span class="step-ms">Infinity</span></div>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }, []), runtimeErrors: [] };
    expect(result.invalidDurations).toHaveLength(1);
    expect(failedChecks(result)).toBe(true);
  });
  it("reports visible raw translation keys and native controls, ignoring hidden pages", () => {
    const window = new Window();
    window.document.body.innerHTML = '<p>members.missingLabel</p><select><option>One</option></select><input type="time"><div hidden><select></select><p>settings.hidden</p></div>';
    for (const element of window.document.querySelectorAll("*")) element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, ["members", "settings"]);
    expect(result.missingI18nKeys.map(item => item.key)).toEqual(["members.missingLabel"]);
    expect(result.nativeControls.map(item => item.tag)).toEqual(["select", "input"]);
  });
  it("fails horizontal overflow and reports controls outside the viewport", () => {
    const window = new Window();
    window.document.body.innerHTML = '<button id="outside">Save</button>';
    const button = window.document.querySelector("button");
    button.getBoundingClientRect = () => ({ left: 1100, top: 10, right: 1200, bottom: 40, width: 100, height: 30 });
    Object.defineProperty(window.document.documentElement, "scrollWidth", { value: 1200 });
    const result = { ...auditDocument(window.document, { width: 1120, height: 900 }, []), runtimeErrors: [] };
    expect(result.outsideViewport.map(item => item.id)).toEqual(["outside"]);
    expect(result.horizontalOverflow.document).toBe(true);
    expect(failedChecks(result)).toBe(true);
  });
  it("excludes content deliberately outside a scrolling container", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div style="overflow-y: auto"><button>Older item</button></div>';
    const container = window.document.querySelector("div"), button = window.document.querySelector("button");
    container.getBoundingClientRect = () => ({ left: 10, top: 10, right: 300, bottom: 100, width: 290, height: 90 });
    button.getBoundingClientRect = () => ({ left: 10, top: 910, right: 200, bottom: 940, width: 190, height: 30 });
    expect(auditDocument(window.document, { width: 1120, height: 900 }, []).outsideViewport).toEqual([]);
  });
  it("does not call a native input visible when it is outside its scrollport", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div style="overflow-y: auto"><input type="time" aria-label="settings.offscreen"></div>';
    const container = window.document.querySelector("div"), input = window.document.querySelector("input");
    container.getBoundingClientRect = () => ({ left: 10, top: 10, right: 300, bottom: 100, width: 290, height: 90 });
    input.getBoundingClientRect = () => ({ left: 10, top: 200, right: 200, bottom: 230, width: 190, height: 30 });
    const result = auditDocument(window.document, { width: 1120, height: 900 }, ["settings"]);
    expect(result.nativeControls).toEqual([]);
    expect(result.missingI18nKeys).toEqual([]);
  });
});


it("rejects divergent store add classes, row markup and card styling", () => {
  const browser = new Window();
  const row = `<div class="cs-card" style="display:grid;grid-template-columns:240px 64px;border-radius:0px;border-bottom:1px solid;border-left:0px solid"><button class="btn cs-main" data-conn="open-store"><span class="ic"></span><span class="tx"><span class="nm">App</span><span class="sub">Summary</span></span></button><button class="btn sm" data-conn="join">Add</button></div>`;
  browser.document.body.innerHTML = row + row;
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = browser.document; globalThis.window = browser;
  try {
    expect(checkRendered("plugins-store-rows")).toEqual({ check: "plugins-store-rows", rows: 2, addClass: "btn sm" });
    const second = browser.document.querySelectorAll('.cs-card')[1];
    const add = second.querySelector('[data-conn="join"]');
    add.classList.add('pri');
    expect(() => checkRendered("plugins-store-rows")).toThrow("same outlined class list");
    add.classList.remove('pri');
    const main = second.querySelector('.cs-main');
    const oldMain = browser.document.createElement('div'); oldMain.className = 'cs-main';
    oldMain.innerHTML = main.innerHTML; main.replaceWith(oldMain);
    expect(() => checkRendered("plugins-store-rows")).toThrow("same detail button");
    oldMain.replaceWith(main); second.style.display = 'flex';
    expect(() => checkRendered("plugins-store-rows")).toThrow("same compact row and divider");
    second.style.display = 'grid'; second.style.gridTemplateColumns = '304px';
    expect(() => checkRendered("plugins-store-rows")).toThrow("same compact row and divider");
    second.style.gridTemplateColumns = '240px 64px';
    add.getBoundingClientRect = () => new browser.DOMRect(0, 0, 64, 80);
    second.getBoundingClientRect = () => new browser.DOMRect(0, 0, 320, 64);
    expect(() => checkRendered("plugins-store-rows")).toThrow("actions fit inside their row");
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; browser.happyDOM.abort(); }
});
