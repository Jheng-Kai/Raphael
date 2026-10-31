// Browser assertions run against the real app after the scene's user interactions.
export function checkRendered(name, context = {}) {
  const visible = element => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const require = (condition, message) => { if (!condition) throw new Error(`${name}: ${message}`); };
  if (name === 'appearance-focus') {
    const focused = document.activeElement, style = getComputedStyle(focused);
    require(focused?.matches('.menu [data-value]') && document.documentElement.hasAttribute('data-keys'), 'theme menu supports actual keyboard focus');
    require((parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none') || (style.boxShadow.includes('inset') && style.boxShadow.includes('2px')), 'keyboard focus has a visible ring');
    return {check:name, color:style.outlineColor, shadow:style.boxShadow, value:focused.dataset.value};
  }
  if (name === "appearance-settings") {
    const card = document.querySelector('.appearance-settings .slist');
    require(visible(card) && card.getBoundingClientRect().width <= 640, "appearance keeps a narrow reading measure");
    require(card.querySelectorAll('.row').length === 2 && card.querySelectorAll('.sel').length === 2, "theme and language share the row/dropdown component");
    for(const row of card.querySelectorAll('.row')){
      const box=row.getBoundingClientRect(), label=row.querySelector('.lbl').getBoundingClientRect(), picker=row.querySelector('.sel').getBoundingClientRect();
      require(label.left-box.left>=12&&box.right-picker.right>=12,"settings rows keep shared inner padding");
    }
    require(!document.querySelector('.skin-preview, [data-skin-choice]'), "preview gallery is retired");
    const choices=[...document.querySelectorAll('.menu [data-value]')];
    if(choices.length)require(choices.map(item=>item.dataset.value).join(',')==='system,light,dark','theme menu has exactly three appearance choices');
    return { check:name, width:card.getBoundingClientRect().width };
  }
  if (name === "theme-clarity") {
    const elements = [document.documentElement, document.body, document.querySelector('#main'), document.querySelector('.page-agent'), document.querySelector('.mb-chat')].filter(Boolean);
    const surfaces = elements.map(el => { const style = getComputedStyle(el); return { element:el.id || el.className || el.tagName, opacity:style.opacity, filter:style.filter, backdrop:style.backdropFilter, background:style.backgroundImage }; });
    require(surfaces.every(s => s.opacity === '1' && s.filter === 'none' && s.backdrop === 'none'), "root and conversation have no opacity or blur veil");
    require(getComputedStyle(document.querySelector('.mb-chat')).backgroundImage === 'none', "conversation has no tinted gradient");
    const root = getComputedStyle(document.documentElement), tokens = Object.fromEntries(['content', 'panel', 'text-2', 'text-3', 'accent', 'focus', 'selected'].map(key=>[key, root.getPropertyValue(`--${key}`).trim()]));
    require(Object.values(tokens).every(value=>/^#([0-9a-f]{2})\1\1$/i.test(value)), "both themes are neutral greys including text, accent, focus and selection");
    return {check:name, surfaces, tokens};
  }
  if(name==='home-hero'){
    const hero=document.querySelector('.page-home .ho-hero'), emblem=hero.querySelector(':scope > .av'), heading=hero.querySelector('h1'), date=hero.querySelector('.ho-date');
    const expected=innerWidth<=760?96:128, root=getComputedStyle(document.documentElement);
    require(Math.abs(emblem.getBoundingClientRect().width-expected)<1,'Home enlarges only the emblem at each viewport');
    require(getComputedStyle(heading).fontSize===root.getPropertyValue('--fs-h1').trim(),'Home report uses the original heading token');
    require(getComputedStyle(date).fontSize===root.getPropertyValue('--fs-md').trim(),'Home date keeps its existing type size');
    return {check:name,emblem:expected,heading:getComputedStyle(heading).fontSize};
  }
  if (name.startsWith("rich-")) {
    const scope = document.querySelector('.page-agent:not([hidden])');
    const cards = [...scope.querySelectorAll('.rich-block')];
    require(cards.length > 0 && !scope.querySelector('.ans .rich-block, .bubble .rich-block'), "rich cards are timeline blocks outside text bubbles");
    require(document.documentElement.scrollWidth <= innerWidth + 1 && scope.scrollWidth <= scope.clientWidth + 1, "rich content never overflows the page sideways");
    for (const card of cards) {
      require(card.scrollWidth <= card.clientWidth + 1, "each card contains its own overflow");
      require(card.getBoundingClientRect().right <= innerWidth + 1, "card fits the conversation column");
    }
    const diagram = scope.querySelector('.message-diagram');
    if (["rich-content", "rich-diagram", "rich-source", "rich-expand"].includes(name)) {
      require(diagram?.dataset.diagramState === "rendered" && diagram.querySelector('.diagram-view svg'), "Mermaid produces a visible SVG");
      const canvas = diagram.querySelector('.diagram-view > svg'), intrinsicWidth = canvas.viewBox.baseVal.width;
      require(!intrinsicWidth || canvas.getBoundingClientRect().width <= intrinsicWidth + 1, "inline diagrams fit the column without enlarging narrow diagrams into oversized text");
      const rows = [...canvas.querySelectorAll('.row-rect-odd path, .row-rect-even path')];
      if (rows.length) {
        const probe = document.createElement('span'); diagram.append(probe);
        const palette = ['--panel', '--surface-2'].map(token => { probe.style.color = getComputedStyle(scope).getPropertyValue(token); return getComputedStyle(probe).color; });
        probe.remove();
        require(rows.every(row => getComputedStyle(row).fill === 'none' || palette.includes(getComputedStyle(row).fill)), "ER data rows use theme token backgrounds in every theme");
        require([...canvas.querySelectorAll('marker circle')].every(circle => palette.includes(getComputedStyle(circle).fill)), "ER optional markers use the theme panel instead of fixed white");
        const label = canvas.querySelector('.edgeLabel text');
        require(label?.textContent.includes('contains'), "ER relationship retains its source label as SVG text");
        const background = canvas.querySelector('.edgeLabel rect');
        require(visible(label) && (!background || getComputedStyle(label).fill !== getComputedStyle(background).fill), "ER relationship text remains visible against its label background");
      }
      require(!diagram.querySelector('svg foreignObject, svg image, svg a, svg script, svg [onclick]'), "diagram contains no HTML, external images or click handlers");
    }
    if (name === "rich-content") {
      require(scope.querySelector('h2') && scope.querySelector('blockquote') && scope.querySelector('.message-task input:disabled') && scope.querySelector('ul ul'), "text additions stay in the text bubble");
      require(scope.querySelector('.message-table th strong') === null && scope.querySelector('.message-table td strong') && scope.querySelector('.message-table a'), "table cells support inline Markdown");
      require(scope.querySelector('.message-image') && !scope.querySelector('.message-image img'), "remote image is initially a consent card");
    }
    if (["rich-content", "rich-image"].includes(name)) require(!performance.getEntriesByType('resource').some(entry => entry.name.includes('images.example.test')), "no remote image request before consent");
    if (name === "rich-code") {
      const code = scope.querySelector('.message-code:not(.message-diagram)'), pre = code.querySelector('pre');
      require(code.querySelector('.rich-head').textContent.includes('bash') && code.querySelector('.hljs-built_in, .hljs-string'), "code language and syntax highlighting are visible");
      require(getComputedStyle(pre).whiteSpace === 'pre' && pre.scrollWidth > pre.clientWidth, "long commands scroll within their code block without wrapping");
    }
    if (name === "rich-source") require(!diagram.querySelector('pre').hidden && diagram.querySelector('[data-rich-act="view-source"]').getAttribute('aria-expanded') === 'true', "source toggle reveals complete source");
    if (name === "rich-expand") {
      const dialog = document.querySelector('.rich-view-dialog');
      require(visible(dialog?.querySelector('.diagram-view svg')) && dialog.querySelector('[data-dlg="close"]'), "expanded diagram uses the shared accessible dialog");
      require(dialog.getBoundingClientRect().width >= Math.min(1200, innerWidth - 48) - 1, "expanded view uses the large viewport-bound dialog width");
    }
    if (name === "rich-image") require(scope.querySelector('[data-rich-act="load-image"]') && !scope.querySelector('.message-image [src]'), "a real load control precedes any image source");
    if (name === "rich-image-loaded") require(scope.querySelector('.message-image img')?.referrerPolicy === 'no-referrer', "consented image omits referrer");
    if (name === "rich-table-example") {
      require(scope.querySelectorAll('th').length === 3 && scope.querySelector('.message-table a') && scope.querySelector('.message-table td code'), "owner example has three aligned columns, links and inline code");
      require(getComputedStyle(scope.querySelector('.message-table td')).overflowWrap === 'anywhere', "long Chinese cells wrap within the column");
    }
    if (name === "rich-wide-table") {
      const scroller = scope.querySelector('.message-table .rich-scroll');
      require(getComputedStyle(scroller).overflowX === 'auto', "wide table has a local horizontal scrollport");
      if (innerWidth < 1920) require(scroller.scrollWidth > scroller.clientWidth, "many columns use the card's local fallback scrolling");
    }
    if (name === "rich-fallback") require(diagram && !diagram.querySelector('pre').hidden && visible(diagram.querySelector('.rich-note')) && !diagram.querySelector('.diagram-view svg'), "incomplete or invalid diagram keeps source and a quiet note");
    return { check:name, cards:cards.length, diagram:diagram?.dataset.diagramState ?? null };
  }
  const selection = () => {
    const rows = [...document.querySelectorAll('#nav .nav[aria-current="true"], #nav [data-go][aria-current="page"]')];
    const home = !document.querySelector('.page-home').hidden;
    const searching = !!document.querySelector('#nav .mb-find-input')?.value.trim();
    require(rows.length <= 1 && (rows.length === 1 || searching), `only the current destination is selected, found ${rows.length}`);
    if (!rows.length) return 'filtered';
    if (home) require(rows[0].matches('[data-go="home"]'), "Home selects only its own icon");
    else if (!document.querySelector('.page-agent').hidden) require(rows[0].matches('[data-member], [data-room]'), "chat selects only its conversation");
    return rows[0].getAttribute('data-go') ?? rows[0].getAttribute('data-member') ?? rows[0].getAttribute('data-room');
  };
  if (name === "sidebar-selection") return {check:name, selected:selection()};
  if (name === "home-hover-content") {
    const {normal, hovered} = context;
    require(normal.background === hovered.background, "hover preserves the block background");
    require(normal.layer === 'rgba(0, 0, 0, 0)' && hovered.layer === normal.layer, "the full-size click layer stays transparent");
    require(hovered.border === hovered.hoverEdge && hovered.border !== normal.border, "only the edge lights up with the sidebar spend card hover-edge token");
    const changed = hovered.visual.findIndex((value, index) => JSON.stringify(value) !== JSON.stringify(normal.visual[index]));
    require(changed < 0, `hover leaves all block geometry, text, icons, charts and inner colours unchanged: ${changed} ${JSON.stringify(normal.visual[changed])} -> ${JSON.stringify(hovered.visual[changed])}`);
    return {check:name, background:hovered.background, border:hovered.border};
  }
  if (name === "sidebar-shell") {
    selection();
    const nav = document.getElementById("nav"), column = nav.querySelector(".mb-col"), main = document.getElementById("main");
    const compact = matchMedia("(max-width: 859px)").matches, open = document.documentElement.hasAttribute("data-sidebar-open");
    require(document.querySelectorAll(".mb-col").length === 1 && column, "one global conversation list");
    require(!document.querySelector('[data-go="team"], .team-page, [data-col="collapse"], .nav-apps, [data-go="automations"]'), "retired navigation and icon rails are absent");
    const header=nav.querySelector('.mb-top');
    const rail=document.documentElement.hasAttribute('data-sidebar-collapsed');
    require(!nav.querySelector('.brand, .app-icon, [data-col="search"]')&&header.querySelector('[data-sidebar="collapse"]')&&nav.querySelector('.sidebar-foot-row [data-go="home"]'),'no brand; collapse leads the top row and Home sits beside the owner');
    if(!rail)require(header.querySelector('[data-col="add"]')&&visible(nav.querySelector('.mb-find-input'))&&nav.querySelector('.mb-find').getBoundingClientRect().top>=header.getBoundingClientRect().bottom-1,'plus shares the top row and search stands below it');
    require([...nav.querySelectorAll('.side-foot [data-go]')].map(el=>el.dataset.go).join()==='dictation,settings,home','footer lists dictation above the owner and a square Home');
    if(!document.documentElement.hasAttribute('data-sidebar-collapsed')){const square=nav.querySelector('.sidebar-home').getBoundingClientRect();require(Math.abs(square.width-square.height)<1,'Home is a square');}
    require(nav.querySelector('.side-foot [data-go="dictation"]').getAttribute('aria-label')&&(document.documentElement.hasAttribute('data-sidebar-collapsed')||visible(nav.querySelector('.side-foot [data-go="dictation"] .nav-t'))),'dictation is a named row');
    require(nav.querySelector('.sidebar-account .owner-face')&&nav.querySelector('.sidebar-account').getAttribute('aria-label'),'account has its own face and accessible name');
    require(!nav.querySelector('.sidebar-account > svg.i')&&(rail||visible(nav.querySelector('.sidebar-account-name'))),'account shows its face and name, without a gear');
    require(!nav.querySelector('.au-rooms-section .mb-ghead, [data-room-new], .mb-sec[data-group="none"] .mb-ghead'),'only owner-created sections have headings');
    require(getComputedStyle(nav.querySelector('.side-foot')).borderTopWidth==='0px','footer has no separator');
    if (compact) {
      require(visible(document.querySelector('.sidebar-toggle')) && main.getBoundingClientRect().left < 1 && Math.abs(main.getBoundingClientRect().width - innerWidth) < 1, "compact content uses the whole window behind a menu button");
      require(nav.inert === !open && main.inert === open, "drawer owns focus and closes access to covered content");
    } else {
      const listWidth=rail?72:296;
      require(Math.abs(nav.getBoundingClientRect().width - listWidth) < 1 && main.getBoundingClientRect().left >= listWidth - 1, "desktop list retains its fixed width");
      require(!visible(document.querySelector('.sidebar-toggle')) && !visible(nav.querySelector('.sidebar-close')), "desktop has no drawer controls");
    }
    const chief = column.querySelector('.mb-chief');
    if (!column.querySelector('.mb-find-input').value) require(chief && chief.querySelector('b') && chief.querySelector('.av'), "the top member shows its face and name");
    if(chief)require(!document.querySelector('.mb-star'),'no member carries a star');
    if(!rail){const mic=nav.querySelector('.side-foot [data-go="dictation"] .nav-t').getBoundingClientRect(),owner=nav.querySelector('.sidebar-account-name').getBoundingClientRect();require(Math.abs(mic.left-owner.left)<1,'dictation and the owner names line up');}
    if(chief&&!rail&&!chief.matches('.mb-tile')&&(!compact||open))require(Math.abs(chief.querySelector('.av').getBoundingClientRect().width-40)<1&&chief.querySelector('.mb-row-main'),'an unpinned top member is an ordinary row');
    for(const row of column.querySelectorAll('.mb-row')){
      const time=row.querySelector('time');
      if(time&&!row.parentElement.matches(':hover, :focus-within'))require(getComputedStyle(time).opacity==='0','row time stays quiet until hover or focus');
    }
    return { check:name, compact, open, folders:column.querySelectorAll('.mb-sec').length };
  }
  if(name==='sidebar-tile'){
    const tile=document.querySelector('#nav .mb-pinned .mb-tile');
    require(tile,'a pinned member is a tile');
    const box=tile.getBoundingClientRect(),face=tile.querySelector(':scope > .av').getBoundingClientRect(),label=tile.querySelector(':scope > b').getBoundingClientRect();
    require(face.width>=64&&Math.abs(face.left+face.width/2-(box.left+box.width/2))<1,'the tile has a larger centered face');
    require(label.top>=face.bottom&&Math.abs(label.left+label.width/2-(box.left+box.width/2))<1,'the name is centered below the face');
    return {check:name,face:face.width};
  }
  if(name==='sidebar-rail'){
    const nav=document.getElementById('nav'),compact=matchMedia('(max-width: 859px)').matches;
    if(compact){
      require(!document.documentElement.hasAttribute('data-sidebar-collapsed')&&!document.documentElement.hasAttribute('data-sidebar-open'),'on a narrow window the same control closes the drawer');
      return {check:name,compact};
    }
    require(document.documentElement.hasAttribute('data-sidebar-collapsed')&&Math.abs(nav.getBoundingClientRect().width-72)<1,'the list collapses to a 72px rail');
    require(!visible(nav.querySelector('.mb-find-input'))&&!visible(nav.querySelector('.sidebar-account-name')),'the rail shows no search or names');
    const faces=[...nav.querySelectorAll('.mb-row > .av, .mb-row > .room-avatar')];
    require(faces.length>0&&faces.every(face=>{const box=face.getBoundingClientRect();return Math.abs(box.left+box.width/2-36)<1;}),'every face is centered in the rail');
    const add=nav.querySelector('.side-foot [data-col="add"]').getBoundingClientRect(),owner=nav.querySelector('.sidebar-account').getBoundingClientRect();
    require(add.bottom<=owner.top,'plus sits above the owner in the rail');
    return {check:name,faces:faces.length};
  }
  if(name==='sidebar-search-before'||name==='sidebar-search-open'){
    const header=document.querySelector('#nav .mb-top'), buttons=[...header.querySelectorAll('[data-col]')];
    const positions=buttons.map(button=>button.getBoundingClientRect().toJSON());
    if(name==='sidebar-search-before'){
      require(visible(document.querySelector('#nav .mb-find-input')),'search stands ready');
      window.__sidebarSearchPositions=positions;
    }else{
      require(document.activeElement===document.querySelector('#nav .mb-find-input'),'search receives focus');
      require(positions.every((box,index)=>Math.abs(box.x-window.__sidebarSearchPositions[index].x)<1&&Math.abs(box.y-window.__sidebarSearchPositions[index].y)<1),'opening search never moves its icon or plus');
    }
    return {check:name,positions};
  }
  if (name === "sidebar-folded") {
    const folder = document.querySelector('.mb-sec[data-group="1"]');
    require(folder.dataset.open === "false" && folder.querySelector('.mb-gbody').inert, "collapsed folder excludes its rows from focus");
    require(JSON.parse(localStorage.getItem('raphael.sidebar.folders')).includes(1), "folder choice persists");
    return {check:name};
  }
  if (name === "sidebar-room-avatar") {
    const avatar = document.querySelector('.au-room-heading > .room-avatar');
    require(visible(avatar) && avatar.querySelectorAll('.av').length >= 2, "header uses the members' face grid");
    require(!document.querySelector('.au-room-heading > svg.i'), "group identity is its members");
    for (const composite of document.querySelectorAll('.room-avatar')) {
      const box = composite.getBoundingClientRect();
      const expected=40;
      require(Math.abs(box.width-expected)<1&&Math.abs(box.height-expected)<1,'sidebar and header use their shared avatar bounds');
      require(getComputedStyle(composite).display==='grid'&&getComputedStyle(composite).borderRadius==='0px'&&getComputedStyle(composite).backgroundColor==='rgba(0, 0, 0, 0)','composite is a square grid without an outer disc');
      for (const face of composite.children) {
        const style = getComputedStyle(face), rect = face.getBoundingClientRect();
        require(rect.width>=18&&rect.height>=18,'every member face remains readable');
        require(style.borderTopWidth==='0px','grid faces have no separating ring');
        require(rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1, "whole faces fit inside the composite bounds");
      }
      const faces=[...composite.children].map(face=>face.getBoundingClientRect());
      require(faces.every((face,index)=>faces.slice(index+1).every(other=>Math.min(face.right,other.right)-Math.max(face.left,other.left)<=1||Math.min(face.bottom,other.bottom)-Math.max(face.top,other.top)<=1)),'grid faces never overlap');
    }
    return {check:name, faces:avatar.dataset.faces};
  }
  if (name === "sidebar-room-summary") {
    const roomId = context.roomId ?? 1;
    const row = document.querySelector(`.au-room-row [data-room="${roomId}"]`);
    const last = context.latest ?? [...window.__look.data.messages].reverse().find(message => message.room_id === roomId && message.status === 'done' && message.text?.trim() && message.text.trim() !== '(pass)');
    require(last && row?.querySelector('.mb-row-p')?.textContent === last.text.replace(/\s+/g, ' '), "a room with messages shows its latest visible message");
    const time = row.querySelector('time');
    require(visible(time) && time.dateTime === new Date(last.created).toISOString(), "that room's own row shows its latest message time");
    return {check:name, preview:row.querySelector('.mb-row-p').textContent, datetime:time.dateTime};
  }
  if (name === "sidebar-unread") {
    require(document.querySelector('.mb-col .mb-dot.is-unread') && document.querySelector('.mb-col time'), "new messages retain unread and time");
    require(document.querySelector('.au-room-row [data-room="1"] .mb-dot.is-unread'), "the unread room has its own unread marker");
    require(document.querySelector('.mb-col .room-avatar > .av'), "room list uses actual member faces");
    return {check:name};
  }
  if (name === "owner-avatar") {
    require(document.querySelector('[data-owner-photo] .owner-face'), "account exposes the shared photo picker");
    return {check:name};
  }
  if (name === "owner-avatar-saved") {
    const photo = window.__look.data.settings.owner_photo;
    require(photo?.startsWith('data:image/webp;base64,'), "the cropped owner photo is saved as bounded WebP");
    require(window.__look.calls.some(call => call.method === 'settings.set' && call.params.key === 'owner_photo'), "saving crosses the existing settings boundary");
    const faces = [...document.querySelectorAll('.sidebar-account .owner-face img, .me > .owner-face img')];
    require(faces.length >= 2 && faces.every(face => face.getAttribute('src') === photo), "footer and existing outgoing messages share the saved face");
    require(faces.every(face => face.naturalWidth === 192 && face.naturalHeight === 192), "owner photo is bounded to 192px");
    return {check:name, faces:faces.length};
  }
  if (name.startsWith("computer-") || ['desktop-owner','desktop-handback','desktop-viewer','desktop-offline','desktop-absent'].includes(name)) {
    const panel=document.querySelector('.desktop-panel'), frame=panel?.querySelector('iframe'), calls=window.__look.calls;
    if(name==='desktop-absent'){require(!visible(panel),'absent Docker has no computer section');return {check:name};}
    require(visible(panel)&&panel.closest('.mb-det')&&![...document.querySelectorAll('.desktop-viewer, [role="dialog"]')].some(visible),'computer uses the existing side panel without a dialog');
    require(!document.querySelector('.thread iframe, .desktop-card, [data-desktop-card-open]'),'timeline has no screen card or control buttons');
    const screenHit=panel.querySelector('[data-desktop="take"]');
    if(frame&&!screenHit.hidden)require(getComputedStyle(screenHit).backgroundColor==='rgba(0, 0, 0, 0)','screen click target stays transparent including hover');
    const events=document.querySelectorAll('[data-desktop-work]');
    if(name.startsWith('computer-'))require(events.length===1&&events[0].matches('.conversation-event-line')&&events[0].closest('.tn')?.dataset.id==='2','one centered metadata-only event belongs to the private turn');
    if(name==='computer-takeover')require(panel.querySelector('.desktop-request').textContent.includes('登入'),'request sits above the live screen');
    if(name==='computer-takeover-owner')require(panel.querySelector('[data-desktop="return"]').textContent==='我完成了','one explicit done action');
    if(name==='computer-takeover-done')require(calls.filter(call=>call.method==='computer.viewer_control'&&!call.params.held&&call.params.takeover==='private-takeover-request').length===1,'one explicit handback with the current nonce');
    if(name==='computer-takeover-owner'||name==='desktop-owner'){
      require(panel.dataset.interactive==='true'&&getComputedStyle(frame).pointerEvents==='auto','click enables input in place');
        require(calls.filter(call=>call.method==='computer.viewer_open'&&call.params.member_id===1).length===1,'takeover keeps the same member session');
      require(frame.contentDocument.defaultView.__desktopConnections===1,'takeover keeps the same noVNC connection');
      const latency=Number(panel.dataset.controlLatencyMs);require(Number.isFinite(latency)&&latency<300,`local click-to-interactive ${latency}ms < 300ms`);
      const accepted=Number(panel.dataset.acceptedInputLatencyMs);require(Number.isFinite(accepted)&&accepted<300,`local click-to-accepted-input ${accepted}ms < 300ms`);
      return {check:name,clickToInteractiveMs:latency,clickToAcceptedInputMs:accepted,connections:1};
    }
    if(name==='desktop-handback')require(panel.dataset.interactive==='false'&&frame.contentDocument.defaultView.__desktopConnections===1,'handback keeps the stream view-only');
      if(name==='desktop-viewer'){
        require(panel.hasAttribute('data-expanded')&&calls.filter(call=>call.method==='computer.viewer_open'&&call.params.member_id===1).length===1,'expansion uses the same member frame/session');
        require(frame.getBoundingClientRect().width>innerWidth*0.9,'expanded screen uses the window width');
      }
    if(name==='desktop-offline'){
      require(!frame,'offline screen has no blank frame');
      if(['starting','building','preparing'].includes(panel.dataset.desktopState))require(panel.querySelectorAll('.desktop-preparation li').length===3&&visible(panel.querySelector('progress')),'preparation has all steps and progress');
      else require(visible(panel.querySelector('[data-desktop="retry"]')),'failure offers contextual retry');
    }else require(visible(frame),'side panel streams the live screen');
    return {check:name};
  }
  if (name === "desktop-install") {
    const buttons = document.querySelectorAll('[data-act="docker-download"]');
    require(buttons.length === 1 && visible(buttons[0]) && !buttons[0].disabled, "one usable Docker download action");
    return { check: name };
  }
  if (name === "desktop-frame") {
    const doc = document.querySelector('.desktop-panel iframe')?.contentDocument ?? document;
    const win = doc.defaultView, canvas = doc.querySelector('#noVNC_container canvas');
    require(visible(canvas) && canvas.width > 100, "the noVNC framebuffer is rendered");
    const box = canvas.getBoundingClientRect(), width = win.innerWidth, height = win.innerHeight;
    require(Math.min(Math.abs(box.width - width), Math.abs(box.height - height)) <= 2, "the canvas fills the frame on its limiting axis");
    require(box.left >= -1 && box.top >= -1 && box.right <= width + 1 && box.bottom <= height + 1, "the whole desktop fits without clipping");
    require(Math.abs(box.width / box.height - canvas.width / canvas.height) < 0.01, "the desktop keeps its framebuffer aspect ratio");
    const controls = [...doc.querySelectorAll('[id^="noVNC_"]')].filter(el => /control|handle|button|panel|status|dlg|logo|hint/i.test(el.id) && el.checkVisibility({ checkVisibilityCSS: true }) && visible(el));
    require(!controls.length, "no noVNC control element is visible");
    for (let el = canvas; el; el = el.parentElement) {
      const style = win.getComputedStyle(el);
      require([style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].every(value => parseFloat(value || "0") === 0), "no standalone noVNC background curve clips the desktop");
    }
    for (const x of [box.left + 2, box.right - 2]) for (const y of [box.top + 2, box.bottom - 2]) require(doc.elementFromPoint(x, y) === canvas, "every desktop corner is unobscured");
    return { check: name, canvas: box.toJSON(), framebuffer: { width: canvas.width, height: canvas.height }, viewport: { width, height }, visibleControls: controls.length };
  }
  if (name === "skill-learned-notice") {
    const notice = document.querySelector('.conversation-event-line'), reply = notice?.closest('.tn')?.querySelector('.ra');
    require(reply && !!(reply.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING), "learning review notices follow the reply that produced them");
    require([...document.querySelectorAll('.conversation-event-line')].some(el => visible(el) && el.textContent.includes("學會了：research-summary")), "a learned skill has one localized conversation line");
    require(visible(document.querySelector('.conversation-event-line .sys.event-line > .i')), "learned notices use the shared quiet system event with its small icon");
    require(!document.querySelector('.work-section')?.textContent.includes('skill_learned'), "internal skill payload never enters public work");
    return { check: name };
  }
  if (name === "growing-skills") {
    require(document.querySelector('.mb-det').textContent.includes("2026/10/29"), "skill dates follow the Chinese UI rather than the browser locale");
    const editor = document.querySelector('#mp-skill-text');
    require(visible(editor) && editor.value.includes("## Verification"), "the actual saved skill opens in the existing member pane");
    require(document.querySelector('.mb-det').textContent.includes("自行學會"), "learned provenance and date are shown");
    const calls = window.__look.calls;
    require(calls.some(c => c.method === "members.skills.read"), "opening reads the real skill boundary");
    if (window.__look.data.skills[0].member_id === 1) require(!calls.some(c => c.method === "members.skills.update" || c.method === "members.skills.delete"), "reading the editor never mutates skills");
    else require(calls.some(c => c.method === "members.skills.delete") && calls.some(c => c.method === "members.skills.update" && c.params.undo), "Raphael deletes and restores through the same owner boundary");
    return { check: name };
  }
  if (name === "pending-memory") {
    const editor = document.querySelector('[data-mem-space="own"] [data-mem-editor]');
    require(visible(editor), "the pending memory opens in the existing memory editor");
    require(editor.querySelector('textarea')?.readOnly && editor.querySelector('input')?.readOnly, "the exact proposal stays read-only until owner approval");
    require(editor.querySelector('[data-mem="save"]')?.textContent.includes("確認記憶"), "the primary action explicitly approves the memory");
    require(editor.textContent.includes("外部內容"), "the owner is told why approval is required");
    require(editor.textContent.includes("新增記憶") && editor.textContent.includes("私人記憶") && !editor.textContent.includes("????"), "the operation and destination are readable localized words");
    require(!window.__look.calls.some(call => call.method === "memory.update"), "opening and reading never applies the pending change");
    return { check: name };
  }

  if (name === "message-no-inner-scroll") {
    for (const node of document.querySelectorAll('.chat-message, .chat-message .bubble, .chat-message .ans, .message-text, .message-code pre')) {
      if (!visible(node)) continue;
      const style = getComputedStyle(node);
      require(!['auto', 'scroll'].includes(style.overflowY) || node.scrollHeight <= node.clientHeight + 1, `message has an inner vertical scrollbar: ${node.className}`);
      require(node.matches('.rich-block.message-code pre') || !['auto', 'scroll'].includes(style.overflowX) || node.scrollWidth <= node.clientWidth + 1, `message has an inner horizontal scrollbar: ${node.className}`);
    }
    return { check: name };
  }
  if (name === "message-no-raw-envelope") {
    for (const node of document.querySelectorAll('.ra .message-text')) {
      let value;
      try { value = JSON.parse(node.textContent.trim()); } catch { continue; }
      require(!value || Array.isArray(value) || typeof value !== 'object' || !('text' in value || 'messages' in value), "a conversation never renders a raw reply envelope");
    }
    return { check: name };
  }
  if (name === "reply-split") {
    const messages = [...document.querySelectorAll('.tn[data-id="2"] .ra-body .chat-message[data-reply]')];
    require(messages.length === 3, "three authored messages have separate bubbles");
    require(messages[1].querySelector('ul') && messages[2].querySelector('pre'), "lists and code blocks remain whole");
    return { check: name, messages: messages.length };
  }
  if (name === "reply-full") {
    const replies = [...document.querySelectorAll('.ra .chat-message:has(> .ans:not(.progress))')];
    require(replies.length > 0, "reply bubbles are present");
    for (const message of replies) {
      require(!message.hasAttribute('data-expandable') && !message.querySelector('[data-act="expand-message"]'), "replies never collapse");
      const text = message.querySelector('.message-text');
      if (text) require(text.clientHeight >= text.scrollHeight - 1, "the full reply is readable");
    }
    return { check: name, replies: replies.length };
  }
  if (name === "conversation-up" || name === "conversation-bottom") {
    const scroll = [...document.querySelectorAll('.ra-scroll')].find(visible);
    require(scroll, "a conversation scrollport is visible");
    require(getComputedStyle(scroll).scrollbarWidth === 'none' && scroll.offsetWidth - scroll.clientWidth <= 1, "only content occupies the message scrollport");
    const latest = scroll.parentElement.querySelector('.conversation-latest');
    require(visible(latest) === (name === "conversation-up"), "latest is visible only away from the bottom");
    if (visible(latest)) {
      const box = latest.getBoundingClientRect(), style = getComputedStyle(latest);
      require(Math.abs(box.width - box.height) <= 1 && parseFloat(style.borderRadius) >= box.width / 2, "latest is a round button");
      require(style.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(style.borderWidth) >= 1, "latest has its own opaque surface above message content");
    }
    return { check: name, top: scroll.scrollTop, height: scroll.scrollHeight };
  }
  if (name === "learned-pill") {
    const pill = document.querySelector('#learned-pill');
    require(visible(pill) && !!pill.querySelector('img').getAttribute('src'), "one learned pill has Raphael's emblem");
    require(pill.textContent.includes('Composio') && !!pill.querySelector('button').textContent, "the batch and Undo are visible");
    return { check: name };
  }
  if (["message-preview", "message-expanded", "message-preview-member", "message-expanded-member"].includes(name)) {
    const message = [...document.querySelectorAll('.chat-message')].find(node => node.textContent.includes('整理每日新聞素材') && (!name.endsWith('-member') || node.closest('.ra')));
    require(!!message, "the long numbered workflow is visible");
    const text = message.querySelector('.message-text'), toggle = message.querySelector('[data-act="expand-message"]');
    require(visible(toggle), "a long message has one visible expand control");
    require(message.querySelectorAll('[data-act="expand-message"]').length === 1, "a long message has only one expand control");
    const expanded = name.startsWith("message-expanded");
    require(message.classList.contains('is-expanded') === expanded && toggle.getAttribute('aria-expanded') === String(expanded), "the expanded state and accessible control agree");
    const style = getComputedStyle(text);
    require(!!toggle.closest(".bubble"), "owner expansion remains inside the bubble");
    const control = getComputedStyle(toggle);
    require(control.fontSize === style.fontSize && control.color === style.color, "the expand control inherits the owner's message typography");
    require(control.borderColor === 'rgba(0, 0, 0, 0)', "the quiet expand control has no outline at rest or on hover");
    if (!toggle.matches(':hover')) require(control.backgroundColor === 'rgba(0, 0, 0, 0)', "the quiet expand control has no fill at rest");
    if (message.classList.contains('owner-message')) require(text.innerText.includes('\n\n'), "owner paragraphs retain their rendered line breaks");
    if (expanded) require(text.clientHeight >= text.scrollHeight - 1 && style.maskImage === 'none', "expanded text displays its complete body without a fade");
    else {
      require(text.scrollHeight > text.clientHeight + 1 && text.clientHeight <= parseFloat(style.lineHeight) * 8 + 1, "a preview shows at most eight lines");
      require(style.maskImage.includes('linear-gradient'), "the cut edge fades");
    }
    return { check: name, expanded, height: text.clientHeight, fullHeight: text.scrollHeight };
  }
  if (name === "home-lead-width") {
    const lead = document.querySelector('.ho-hero'), copy = lead.querySelector('h1').parentElement;
    require(Math.abs(copy.getBoundingClientRect().right - lead.getBoundingClientRect().right) < 1, "Home report uses all width beside its emblem");
    const title = lead.querySelector('h1'), lines = new Map();
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect(), key = Math.round(box.top);
        lines.set(key, (lines.get(key) ?? '') + node.data[i]);
      }
    }
    require(![...lines.values()].some(line => /^用\s*\d|^\d+%。?》/.test(line)), "the report never splits the budget phrase into a short tail");
    if (innerWidth === 1280 && innerHeight === 800) require([...document.querySelectorAll('.ho-stat')].every(card => card.getBoundingClientRect().bottom <= innerHeight), "all three stats and charts fit the default first screen");
    return { check: name, width: copy.getBoundingClientRect().width };
  }
  if (name === "onboarding-abilities-hero") {
    const title = document.querySelector('.ob-col h2');
    require(parseFloat(getComputedStyle(title).fontSize) >= 40, "abilities use the welcome hero headline size");
    require(!document.querySelector('.ob-sub'), "abilities have no optional-setup helper paragraph");
    return { check: name, fontSize: getComputedStyle(title).fontSize };
  }
  if (name === "details-quick-once") {
    const section = document.querySelector('[data-conversation-section="quick"]');
    require(visible(section) && !section.querySelector('.mb-dh') && section.querySelectorAll('[data-conversation-open]').length === 1, "quick questions appear once as the accessible conversation item");
    return { check: name };
  }
  if (name === "conversation-scroll-edge") {
    const scroller = document.querySelector('.mb-chat .ra-scroll');
    require(getComputedStyle(scroller).maskImage !== 'none', "conversation top fades partially scrolled message fragments");
    require(/rgba\(0, 0, 0, 0\) (?:1[2-9]|[2-9]\d)px/.test(getComputedStyle(scroller).maskImage), "the top edge has a fully transparent band in both themes before the fade");
    return { check: name, scrollTop: scroller.scrollTop };
  }
  if (name === "toast-clearance") {
    const toasts = [...document.querySelectorAll('.toast')].filter(visible);
    const targets = [...document.querySelectorAll('.mb-det .mb-panel-row, .conversation-row, .composer')].filter(visible);
    for (const toast of toasts) for (const target of targets) {
      const a = toast.getBoundingClientRect(), b = target.getBoundingClientRect();
      require(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom, "shared success notices never cover list rows or the composer");
    }
    return { check: name, toasts: toasts.length, targets: targets.length };
  }
  if (name === "member-brain-saved") {
    const saved = window.__look.calls.filter(call => call.method === "members.update" && typeof call.params.model === "string");
    require(saved.length === 1 && saved[0].params.id === 1 && saved[0].params.model.startsWith("cli:codex"), "one member brain selection is persisted");
    require(window.__look.data.members.find(member => member.id === 1).model === saved[0].params.model, "the member retains its own brain");
    require(document.querySelector('.composer .cmp-model .mp-trigger').textContent.includes("Codex"), "reopened details show the selected CLI source");
    if (document.querySelector('.model-chooser')) require(document.querySelector('.model-chooser .mc-row[aria-checked="true"]')?.dataset.model === saved[0].params.model.split('?')[0], "the reopened shared chooser selects the persisted member brain");
    return { check: name, model: saved[0].params.model };
  }
  if (name === "details-sheet") {
    const panel = document.querySelector('.mb-det:not([hidden])');
    require(visible(panel), "details are open");
    const scrim = document.querySelector('.mb-det-scrim'), sheet = getComputedStyle(panel).position === 'absolute';
    require(!!visible(scrim) === sheet, "overlay details have a conversation scrim only while they are a sheet");
    if (sheet) {
      const box = panel.getBoundingClientRect(), chat = document.querySelector('.mb-chat').getBoundingClientRect();
      const hit = document.elementFromPoint(chat.left + 4, Math.max(chat.top + 80, box.top + 80));
      require(hit === scrim, "the scrim intercepts conversation clicks");
      require(parseFloat(getComputedStyle(scrim).backgroundColor.split(',').at(-1)) > 0, "the scrim visibly separates the sheet");
    }
    return { check: name, sheet };
  }
  if (name === "settings-concise") {
    const host = document.querySelector('.modal-body');
    const pane = document.querySelector('.modal-scrim [data-pane][aria-current="page"]')?.dataset.pane;
    const labels = pane === 'general' ? ['[data-k="subtitles"]'] : pane === 'dictation' ? ['[data-k="languages"]'] : [];
    for (const selector of labels) require(!host.querySelector(selector)?.closest('.row')?.querySelector('.d'), "self-explanatory settings have no helper paragraph");
    require(!host.querySelector('.models-purpose-note, .run-retained, [data-price="note"]'), "skin, model and usage helpers are absent");
    if (pane === 'data') require(!host.querySelector('.foot'), "data has no helper footer");
    if (pane === 'messaging') require(!host.querySelector('.msg > .foot'), "Telegram keeps its controls without a setup paragraph");
    return { check: name, pane };
  }
  if (name === "models-responsive") {
    const rows = [...document.querySelectorAll('.row-model')];
    require(rows.length === 4, "all four model purposes remain available");
    for (const row of rows) {
      const label = row.querySelector('.lbl').getBoundingClientRect(), picker = row.querySelector('.ctl').getBoundingClientRect();
      if (innerWidth <= 820) require(picker.top >= label.bottom - 1 && Math.abs(picker.left - label.left) < 1, "narrow model rows place purpose and price above the picker");
    }
    return { check: name, rows: rows.length };
  }
  if (name === "compact-action") {
    const action = document.querySelector('.run-header [data-run-act="export"], .keys-card [data-go="settings"]');
    require(visible(action) && action.classList.contains('icon') && !action.textContent.trim(), "secondary actions use a bare icon");
    require(!!action.getAttribute('aria-label') && action.title === action.getAttribute('aria-label'), "icon actions retain a localized name and tooltip");
    if (action.dataset.runAct === 'export' && document.documentElement.lang === 'zh-TW') require(document.querySelector('.run-tiles').textContent.includes('權杖數') && !document.querySelector('.run-tiles').textContent.includes('Tokens'), "usage headings follow the Traditional Chinese glossary");
    return { check: name, label: action.getAttribute('aria-label') };
  }
  if (name === "details-alignment") {
    const panel=document.querySelector('.mb-det:not([hidden])');
    if (!visible(panel)) return {check:name,open:false};
    const blocks=[...panel.querySelectorAll('.conversation-new, .conversation-tools, .mb-panel-pages, .mb-field > .sel, [data-member-brain] .mp-trigger')].filter(visible);
    const reference=panel.querySelector('.conversation-new').getBoundingClientRect();
    for (const block of blocks) {
      const box=block.getBoundingClientRect();
      const field=block.matches('.conversation-tools') ? block.querySelector('input').getBoundingClientRect() : box;
      require(Math.abs(field.left-reference.left)<1 && Math.abs(field.right-reference.right)<1,"every details block shares the New conversation field inset");
    }
    return {check:name,blocks:blocks.length};
  }
  if (name === "conversation-header") {
    const header=document.querySelector('.mb-chat > .mb-head'), trigger=header.querySelector('.conversation-trigger');
    const caption=trigger.querySelector('.conversation-caption'), identity=trigger.querySelector('.mb-pill');
    const picker=header.querySelector('.mb-pick');
    if (visible(picker)) require(!visible(identity),"compact header shows identity once in the picker");
    for (const line of [caption,identity.querySelector('.mb-pill-t')].filter(visible)) {
      const range=document.createRange();range.selectNodeContents(line);
      const text=range.getBoundingClientRect(), box=line.getBoundingClientRect();
      require(text.top>=box.top-1 && text.bottom<=box.bottom+1 && line.scrollHeight<=line.clientHeight+1,`header text has a complete unclipped line (${line.className}: text=${text.height}, box=${box.height}, scroll=${line.scrollHeight}, client=${line.clientHeight})`);
    }
    return {check:name,captionHeight:caption.getBoundingClientRect().height,identity:visible(identity)};
  }
  if (name === "failure-owner-copy") {
    const replies = [...document.querySelectorAll('.tn .ra .chat-message')].filter(visible);
    const reply = replies.at(-1), preview = document.querySelector('.mb-col [data-member][aria-current="true"] .mb-row-p');
    require(visible(reply) && visible(preview), "the reply and its sidebar preview are visible");
    const copy = { reply: reply.textContent.trim(), preview: preview.textContent.trim() };
    for (const [surface, text] of Object.entries(copy)) {
      require(text.includes("Gmail") && text.includes("還沒登入"), `${surface} explains the connection failure naturally`);
      require(!/[a-z]+_[a-z_]+|[（(]\s*(?:credits|usage_?limit|rate_?limit|overloaded|server|auth_?expired|network|permission_?denied|not_?found|tool_?broken|timeout|refused|unknown)\s*[）)]|;|not_?configured/i.test(text), `${surface} exposes no machine diagnostic or ASCII semicolon`);
    }
    require(!reply.querySelector("em"), "machine underscores cannot become italics in the reply");
    return { check: name, ...copy };
  }
  if (name === "details-pointer-focus") {
    const close = document.querySelector('.mb-det [data-det="close"]');
    require(visible(close), "details opened from the pointer");
    require(!document.documentElement.hasAttribute('data-keys'), "pointer modality is retained");
    require(document.activeElement !== close, "opening from a pointer does not move keyboard focus to Close");
    require(getComputedStyle(close).outlineStyle === 'none', "pointer opening has no focus outline");
    return {check:name};
  }
  if (name === "home-redesign") {
    selection();
    const page=document.querySelector('.page-home'), lead=page.querySelector('.ho-hero'), stats=[...page.querySelectorAll('.ho-stat')];
    require(!!lead.querySelector('h1') && getComputedStyle(lead).backgroundColor === 'rgba(0, 0, 0, 0)', "the report is the page headline without a card");
    require(page.querySelectorAll('.ho-card').length === 4 && !!page.querySelector('.ho-inbox'), "four equal blocks hold attention, spend, allowances and dictation");
    require(stats.length === 3, "three stats share one skeleton");
    require(parseFloat(getComputedStyle(page).maxWidth)===1080,"Home retains the supplied 1080px page measure");
    const boxes=stats.map(el=>el.getBoundingClientRect());
    const emblem=lead.querySelector('.av').getBoundingClientRect(), copy=lead.querySelector('.ho-lead-copy').getBoundingClientRect();
    require(copy.left >= emblem.right - 1 && copy.top < emblem.bottom && copy.bottom > emblem.top, "Home emblem and report stay side by side at narrow widths");
    const cards = [...page.querySelectorAll('.ho-card')].map(card => card.getBoundingClientRect());
    require(cards.every(box => Math.abs(box.width - cards[0].width) < 1 && Math.abs(box.height - cards[0].height) < 1), "all four blocks share their dimensions regardless of data");
    require(Math.abs(cards[0].top - cards[1].top) < 1 && Math.abs(cards[2].top - cards[3].top) < 1 && cards[2].top > cards[0].bottom, "four blocks retain their two-by-two positions");
    require(page.querySelectorAll('.ho-day').length === 42 && page.querySelectorAll('.ho-day[aria-current="date"]').length === 1, "a six-week month calendar marks today");
    require(page.querySelector('.ho-calendar').getBoundingClientRect().top >= cards[3].bottom, "the mini calendar stays below the four blocks");
    require(page.querySelectorAll('.ho-weekday').length === 7, "the month has a weekday header");
    require(page.querySelector('.ho-calendar').getBoundingClientRect().height >= 280, "the month fills a balanced area below the summaries");
    require(Math.abs(emblem.width-(innerWidth<=760?96:128))<1 && getComputedStyle(lead.querySelector('h1')).fontSize === getComputedStyle(document.documentElement).getPropertyValue('--fs-h1').trim(), "only the emblem grows; the report retains its heading token");
    require(!page.querySelector('.ho-week'), "the former week strip is removed");
    const blocks = [...page.querySelectorAll('.ho-card, .ho-calendar')];
    for (const block of blocks) {
      const target = block.querySelector(':scope > .ho-target');
      require(target?.tagName === 'BUTTON' && target.tabIndex === 0 && !!target.getAttribute('aria-label'), "each whole block has one named keyboard target");
      const box = block.getBoundingClientRect(), hit = target.getBoundingClientRect();
      require(['left', 'top', 'right', 'bottom'].every(edge => Math.abs(box[edge] - hit[edge]) <= 1), "the navigation target covers the entire block");
      require(!target.querySelector('button, a, input'), "inner controls remain separate from the block target");
      for (const x of [.1, .5, .9]) for (const y of [.1, .5, .9]) {
        const px = box.x + box.width * x, py = box.y + box.height * y;
        if (py >= innerHeight || py < 0) continue;
        const at = document.elementFromPoint(px, py);
        require(at === target || !!at?.closest('[data-home-item], [data-home-date], [data-home-month], [data-home-select], [data-home-event], [data-home-today]'), `every sampled point opens the block or its own inner action: ${block.className} ${x},${y} hits ${at?.className}`);
      }
    }
    return {check:name,stats:boxes.map(b=>({top:b.top,bottom:b.bottom}))};
  }
  if(name === "dictation-layout") {
    const cards=[...document.querySelectorAll('.page-overview .icard')].map(el=>el.getBoundingClientRect()), keys=document.querySelector('.keys-card').getBoundingClientRect(), activity=document.querySelector('.activity').getBoundingClientRect();
    require(cards.length===4 && Math.abs(cards[0].top-cards[1].top)<1 && cards[2].top>cards[0].bottom && Math.abs(cards[2].top-cards[3].top)<1,"dictation stats form a 2 by 2 grid");
    require(Math.abs(activity.right-cards[1].right)<1,"activity and the two stats columns share the same right edge");
    if(keys.left>cards[1].right) require(Math.abs(keys.top-cards[0].top)<1 && activity.top>=cards[2].bottom && Math.abs(activity.left-cards[0].left)<1,"shortcuts align with stats and activity follows in the left column");
    else require(activity.top>=cards[2].bottom && keys.top>=activity.bottom,"narrow order is stats, activity, shortcuts");
    return {check:name,columns:keys.left>cards[1].right?2:1};
  }
  if(name === "thread-measure") {
    const composer=[...document.querySelectorAll('.page-agent .composer')].find(el=>visible(el)&&!el.closest('[hidden]')), cap=parseFloat(getComputedStyle(composer).maxWidth);
    require(cap===896,"thread and composer use the shared 28-space 896px measure");
    require(composer.getBoundingClientRect().width<=cap+1,"composer respects its measure");
    if(innerWidth<1440) require(!document.querySelector('.page-agent[data-det="open"]'),"details start collapsed before they crowd the thread");
    return {check:name,width:composer.getBoundingClientRect().width,cap};
  }
  if(name === "no-naming") {
    require(!document.querySelector('.first-bot'),"no first Bot setup exists for an unconfigured empty thread");
    require(visible(document.querySelector('.page-agent .composer:not([hidden])')),"the ordinary composer is available immediately");
    return (async () => {
      const img=[...document.querySelectorAll('.ra-hero img')].find(visible);
      await img.decode();
      const size=img.getBoundingClientRect().width * devicePixelRatio;
      require(img.naturalWidth >= size, "the empty conversation avatar has enough source pixels for its display size");
      return {check:name,sourceWidth:img.naturalWidth,displayPixels:size};
    })();
  }
  if(name === "settings-alignment") {
    const host=document.querySelector('.modal-body'), style=getComputedStyle(host), right=host.getBoundingClientRect().left+parseFloat(style.paddingLeft)+Math.min(640,host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
    const rows=[...host.querySelectorAll('.cs, .cs-list, .slist, .cs-toolbar, .cs-head')].filter(el=>visible(el)&&!el.closest('[hidden]'));
    require(rows.length>0,"settings has measurable content");
    for(const row of rows) require(Math.abs(row.getBoundingClientRect().right-right)<2,`settings content shares one right edge: ${row.className}`);
    const close=document.querySelector('.modal-x')?.getBoundingClientRect();
    for(const action of host.querySelectorAll('.set-head > button, .set-head > .sel')) {
      const box=action.getBoundingClientRect();
      require(Math.abs(box.right-right)<2,"settings header actions share the content right edge");
      require(!close || box.right<=close.left || box.left>=close.right || box.bottom<=close.top || box.top>=close.bottom,"settings header actions clear the modal Close button");
    }
    return {check:name,right,rows:rows.length};
  }
  if(name === "welcome-alignment") {
    const col=document.querySelector('.ob-col').getBoundingClientRect(), foot=document.querySelector('.ob-foot').getBoundingClientRect();
    require(foot.top-col.bottom<=32 && foot.top>=col.bottom,"welcome content and Start form one centered block");
    const size=parseFloat(getComputedStyle(document.querySelector('.ob-col h2')).fontSize);
    require(size >= 40 && size <= 48, "welcome title is the 40–48px page hero");
    return {check:name,gap:foot.top-col.bottom};
  }
  if (name === "cancel-armed" || name === "cancel-cleared") {
    const button = document.querySelector('[data-cancel-armed="true"]');
    if(name === "cancel-cleared") { require(!button,"other input clears the gesture");return {check:name}; }
    require(visible(button),"the targeted Stop is visibly armed");
    require(button.dataset.cancelHint === "再按一次取消", "the cancellation hint follows the interface language");
    require(getComputedStyle(button,"::before").content === '"Esc"',"Esc replaces the Stop glyph");
    require(button.classList.contains("task-action"),"Stop shares the Send action component");
    const send=button.closest('form')?.querySelector('.cmp-send');
    if(send)require(getComputedStyle(send).color===getComputedStyle(button).color,"Stop and Send have exactly the same color");
    require(!(window.__look?.calls ?? []).some(call=>["agent_retract","overlay_cancel"].includes(call.command)||["rooms.stop","worker.cancel","agent.history.stop"].includes(call.method)||call.command==="window_hotkey"&&call.kind==="cancel"),"first Escape performs no cancellation");
    require(![...document.querySelectorAll(".message-tooltip")].some(visible),"the Escape hint replaces the ordinary Stop tooltip");
    return {check:name,hint:button.dataset.cancelHint};
  }
  if(name === "cancel-native-result" || name === "cancel-overlay-result" || name === "cancel-recording-result") {
    const command=name==="cancel-overlay-result"?"overlay_cancel":"window_hotkey";
    require(window.__look.calls.filter(call=>call.command===command&&(command!=="window_hotkey"||call.kind==="cancel")).length===1,name === "cancel-recording-result" ? "one Escape cancels recording or STT once" : "only the second Escape cancels once");
    require(!document.querySelector('[data-cancel-armed]'),"the armed state ends with cancellation");return {check:name};
  }
  if(name === "deleted-view") {
    require(visible(document.querySelector('.toast')),"a localized success notice is shown");
    require(![...document.querySelectorAll('.au-room-pane, .au-routine-dialog')].some(el=>visible(el)&&!el.closest('[hidden]')),"the deleted object's view is closed");
    require(!document.body.textContent.includes('not found'),"deletion never lands on a missing object");return {check:name};
  }
  if(name === "overlay-confirmation-content") {
    const title=document.querySelector('#ask-title').textContent.trim().replace(/…$/u,'');
    const details=document.querySelector('#ask-details').textContent.trim();
    require(!!title&&!details.includes(title),"details never repeat the intent title");
    const paragraphs=details.split(/\n+/u).map(line=>line.trim()).filter(Boolean);
    require(new Set(paragraphs).size===paragraphs.length,"each details paragraph is presented once");
    return {check:name,title,paragraphs:paragraphs.length};
  }
  if (name === "overlay-working-no-stop") {
    require(!visible(document.querySelector('#overlay-stop')), "ordinary working orb has no floating Stop button");
    return { check: name };
  }
  if(name === "overlay-stop-content") {
    const stop=document.querySelector('#overlay-stop'),label=stop?.querySelector('.overlay-stop-label');
    require(visible(stop)&&visible(label)&&!!label.textContent.trim(),"desktop Stop has a visible localized label instead of a lone empty square");
    require(label.textContent===stop.getAttribute('aria-label'),"visible Stop wording matches its accessible name");
    require(getComputedStyle(label).visibility==='visible',"the Stop label is readable before Escape is armed");
    return {check:name,label:label.textContent};
  }
  if(name.startsWith("overlay-confirmation")) {
    const card=document.querySelector('#ask'),title=document.querySelector('#ask-title'),details=document.querySelector('#ask-details'),actions=document.querySelector('.ask-actions');
    require(visible(card)&&!!title.textContent.trim(),"the confirmation has a clear intent title");
    const c=card.getBoundingClientRect(),a=actions.getBoundingClientRect(),d=details.getBoundingClientRect();
    require(!getComputedStyle(card).backgroundColor.includes('rgba'),"the card surface is opaque");
    require(c.left>=0&&c.top>=0&&c.right<=innerWidth&&c.bottom<=innerHeight,"the whole card fits the native overlay window");
    require(d.bottom<=a.top&&title.getBoundingClientRect().bottom<=a.top,"details and title never run underneath buttons");
    for(const button of actions.querySelectorAll('button:not([hidden])')){const b=button.getBoundingClientRect();require(b.left>=c.left&&b.right<=c.right&&b.bottom<=c.bottom,"every action stays inside its own card");}
    if(details.scrollHeight>details.clientHeight+1)require(visible(document.querySelector('#ask-expand')),"clamped details always offer See all");
    if(name.endsWith('expanded'))require(card.dataset.expanded==='true'&&getComputedStyle(details).overflowY==='auto',"expanded details remain scrollable");
    return {check:name,nativeViewport:{width:innerWidth,height:innerHeight},card:{width:c.width,height:c.height},details:details.textContent.length};
  }
  if (name === "content-width") {
    const settings = document.querySelector('.modal-scrim:not([hidden]) .set-content');
    if (visible(settings)) {
      const edge = settings.getBoundingClientRect();
      for (const child of settings.children) {
        if (!visible(child) || ['absolute', 'fixed'].includes(getComputedStyle(child).position)) continue;
        const box = child.getBoundingClientRect();
        require(box.left >= edge.left - 1 && box.right <= edge.right + 1, `settings content shares one measure: ${child.className}`);
      }
      const action = settings.querySelector('.set-head > :last-child:not(h1)');
      const form = settings.querySelector('.cs-form .add-grid');
      const contentRight = form ? form.getBoundingClientRect().left + form.clientWidth - parseFloat(getComputedStyle(form).paddingRight) : edge.right;
      if (visible(action)) require(Math.abs(action.getBoundingClientRect().right - contentRight) <= 1, "settings header action shares the content right edge");
      for (const selector of ['.cs:has(.cs-store-groups) .cs-find .field', '.cs-store-groups', '.cs-results']) {
        const control = settings.querySelector(selector);
        if (visible(control)) require(Math.abs(control.getBoundingClientRect().right - edge.right) <= 1, `settings toolbar shares the content right edge: ${selector}`);
      }
    }
    for (const grid of document.querySelectorAll('.cs-store .cs-grid')) {
      if (!visible(grid)) continue;
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).map(Number.parseFloat);
      for (const [index, card] of [...grid.children].entries())
        require(Math.abs(card.getBoundingClientRect().width - tracks[index % tracks.length]) <= 1, "store rows fill their allocated content track");
    }
    // Keep this measurable on the pre-token stylesheet too: all limits derive from the shared 32px space.
    const space = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-6'));
    require(space > 0, "the shared spacing scale is available");
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sp-5'));
    require(gap > 0, "the shared grid gap is available");
    const limits = { word: 10 * space, card: 12 * space, reading: 20 * space, thread: 28 * space, page: 3 * 12 * space + 2 * gap + 2 * space, workspace: 55 * space };
    const groups = [
      ['word', '.wrow'],
      ['card', '.ho-card:not(.page-home .ho-card), .cs-card, .run-tile, .au-occurrence, .icard, .keys-card:not(.page-overview .keys-card), .mb-panel-pages, .mb-det .mb-rt, .mb-det .mem'],
      ['reading', '.ho-row, .ho-slot, .card:not(.activity):not(.keys-card), .row, .list, .slist, .cs-list, .hist-top, .hrow, .cs-item, .mb-row, .mb-rt, .conversation-row, .ask-card, .bgq-card'],
      ['thread', '.ra-col, .composer'],
      ['page', '.page:not(.page-agent), .modal, .ho-hero, .page-overview .keys-card'],
      ['workspace', '.au-page'],
    ];
    const measurements = [];
    for (const [kind, selector] of groups) for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || element.closest('[hidden]')) continue;
      let scale = 1;
      const width = element.getBoundingClientRect().width / scale;
      measurements.push({ kind, class: element.className, width: Math.round(width * 100) / 100, max: limits[kind] });
    }
    const violations = measurements.filter(item => item.width > item.max + 1);
    require(violations.length === 0, `stretched content: ${JSON.stringify(violations)}`);
    const hero = document.querySelector('.page-home:not([hidden]) .ho-hero');
    let home;
    if (visible(hero)) {
      const page = hero.closest('.page-home'), style = getComputedStyle(page);
      const lead = hero.getBoundingClientRect(), bounds = page.getBoundingClientRect();
      const cards = [...page.querySelectorAll('.ho-card')].filter(visible).map(card => card.getBoundingClientRect());
      const available = bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      require(Math.abs(lead.width - available) <= 1, 'Home hero spans the card grid within the page measure');
      require(cards.length > 0 && cards.every(card => card.top >= lead.bottom - 1 && card.width <= lead.width + 1), 'Home hero leads every summary card');
      const rows = [];
      for (const card of cards) {
        let row = rows.find(row => Math.abs(row.top - card.top) <= 1);
        if (!row) rows.push(row = { top: card.top, count: 0 });
        row.count++;
      }
      require(cards.length === 4 && rows.length === 2 && rows.every(row => row.count === 2), `Home summary rows fill their columns: ${JSON.stringify(rows)}`);
      home = { heroWidth: lead.width, available, columns: rows[0].count, rows: rows.map(row => row.count) };
    }
    return { check: name, limits, measurements, ...(home ? { home } : {}) };
  }
  if (name.startsWith("locale-")) return (async () => {
    const { catalogs, getLocale } = await import('/src/main/i18n/index.ts');
    const locale = name.slice(7);
    require(document.documentElement.lang === locale && getLocale() === locale, "the setting is applied to the whole window");
    const current = new Set(Object.values(catalogs[locale]).map(value => value.trim()));
    const foreign = new Set(Object.entries(catalogs).filter(([key]) => key !== locale).flatMap(([, messages]) => Object.values(messages))
      .filter(value => !/[<{}]/.test(value) && !current.has(value.trim())).map(value => value.trim()));
    // User documents, names and backend prose retain the language in which they were written.
    const user = new Set();
    const collect = value => { if (typeof value === "string") user.add(value.trim()); else if (value && typeof value === "object") Object.values(value).forEach(collect); };
    collect(window.__look.data);
    const authored = [...user].filter(value => value && /[\u3400-\u9fff\u3040-\u30ff]/.test(value)).sort((a, b) => b.length - a.length);
    const stale = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const element = node.parentElement, text = node.textContent.trim();
      if (!text || !visible(element) || element.closest('[hidden], [inert], script, style, input, textarea, .message-text, .mb-preview, .mb-pv')) continue;
      if (user.has(text)) continue;
      const interfaceText = authored.reduce((copy, value) => copy.split(value).join(""), text);
      if (foreign.has(text) || (locale === "en" && /[\u3400-\u9fff\u3040-\u30ff]/.test(interfaceText))) stale.push(text.slice(0, 90));
    }
    require(stale.length === 0, `visible interface copy is in ${locale}: ${JSON.stringify(stale)}`);
    require(!/Cannot set properties|TypeError|outerHTML/.test(document.querySelector('.toasts')?.textContent ?? ""), "no error toast");
    const pane = document.querySelector('.modal-scrim:not([hidden]) [data-pane][aria-current="page"]')?.dataset.pane;
    const page = [...document.querySelectorAll('.page[data-page]')].find(visible)?.dataset.page;
    const tab = document.querySelector('.page-dictation:not([hidden]) [data-dictation-tab][aria-selected="true"]')?.dataset.dictationTab;
    return { check: name, locale, surface: pane ? `settings:${pane}` : tab ? `dictation:${tab}` : page, stale };
  })();
  if (name === "conversation-sections") {
    const host = document.querySelector('.mb-det .conversation-list');
    require(visible(host), "the conversation list is visible");
    const quick = host.querySelector('[data-conversation-section="quick"]'), standard = host.querySelector('[data-conversation-section="standard"]');
    require(visible(standard) && standard.querySelector('.mb-dh').textContent === "對話", "ordinary conversations use the existing small heading");
    if (quick) {
      require(!quick.querySelector('.mb-dh') && quick.querySelector('[data-conversation-open]').textContent.includes("快速提問"), "quick questions are named once on their row");
      require(standard.getBoundingClientRect().top - quick.getBoundingClientRect().bottom >= 8, "the two sections have breathing room");
      require(!!quick.querySelector('[data-conversation-more]'), "the quick row has its overflow menu");
    }
    return { check: name, quick: !!quick, headings: [...host.querySelectorAll('.mb-dh')].map(node => node.textContent) };
  }
  if (name === "quick-clear-confirm") {
    const dialog = document.querySelector('.mb-confirm');
    require(visible(dialog) && dialog.querySelector('h2').textContent === '清除「快速提問」的紀錄？', "the shared confirmation names the history");
    require(dialog.querySelector('[data-dlg="delete"]').textContent === "清除紀錄", "the primary action clears history");
    require(!window.__look.calls.some(call => call.method === "conversations.clear"), "nothing clears before confirmation");
    return { check: name, title: dialog.querySelector('h2').textContent };
  }
  if (["quick-cleared", "conversation-empty"].includes(name)) {
    require(visible(document.querySelector('.ra-empty')), "the conversation shows its empty state");
    require(!document.querySelector('.ra-col .tn, .ra-col .day, .ra-col .exchange-row'), "there are no turns, empty event lines or date separators");
    if (name === "quick-cleared") {
      require(window.__look.calls.filter(call => call.method === "conversations.clear" && call.params.id === 4).length === 1, "history is cleared exactly once");
      require(window.__look.data.conversations.some(c => c.id === 4 && c.kind === "quick"), "the quick identity remains");
    }
    return { check: name };
  }
  if (["composer-voice-destination", "composer-voice-answer"].includes(name)) {
    const calls = window.__look.calls.filter(call => call.command === "window_hotkey" && ["agent_down", "agent_up"].includes(call.kind));
    require(calls.length === 2, "one press and release crossed the native boundary");
    const args = calls[0], expected = args.memberId === 1 ? 12 : 2;
    require(args.conversationId === expected && calls[1].conversationId === expected && !args.destination, "voice names the selected non-default conversation");
    const slot = document.querySelector('.cmp-voice'), box = slot.getBoundingClientRect();
    require(slot.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), "the composer's voice or Stop control is unobscured");
    if (name === "composer-voice-destination") require(visible(document.querySelector('[data-key="hearing"]')) && document.querySelector('.composer').dataset.taskState === "ack", "the original thread has a waiting line and Stop");
    else require(visible(document.querySelector('.tn[data-id="301"]')) && !document.querySelector('[data-key="hearing"]'), "the answer replaces the pending line in this thread");
    return { check: name, member: args.memberId, conversation: expected };
  }
  // R-UI-42: system events are one centred grey line that never shows an internal number.
  const eventLines = expected => {
    const lines = [...document.querySelectorAll('.event-line')].filter(visible);
    require(lines.length === expected, `${expected} event lines are visible, found ${lines.length}`);
    for (const line of lines) {
      const box = line.getBoundingClientRect(), column = line.closest('.ra-col').getBoundingClientRect();
      require(Math.abs(box.left + box.width / 2 - column.left - column.width / 2) <= 2, `"${line.textContent}" is centred in the thread`);
      require(!/#\d/.test(line.closest('.handoff-event, .conversation-event-line, li').textContent), `"${line.textContent}" shows no internal number`);
      const size = parseFloat(getComputedStyle(line).fontSize);
      require(!line.closest('.chat-message, .ra-body') && size >= 12 && size <= 14, `event lines sit outside message bodies at a readable small size (${size}px)`);
      const control = line.closest('button');
      if (control) require(getComputedStyle(control).borderTopColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(control).backgroundColor === 'rgba(0, 0, 0, 0)', "an event line is never a pill");
    }
    return lines;
  };
  const plainWords = () => {
    const wrapped = /^\s*《(?:答|告|否|了|問|解|Answer|Notice|Negative|Understood|Question)[。.：:]/i;
    const words = [...document.querySelectorAll('.page-agent .ra .message-text, .page-agent .work-latest, .page-agent .work-progress, .page-agent .ask-q, .page-agent .bgq-line')].filter(visible);
    for (const text of words) require(!wrapped.test(text.textContent) && !/》\s*$/.test(text.textContent.replace(/《[^《》]*》/g, "")), `R-UI-42: Raphael's words read plainly: ${text.textContent.slice(0, 40)}`);
    return words.length;
  };
  if (name.startsWith("composer-stop-")) {
    const form = document.querySelector('.page-agent .composer'), button = form?.querySelector('.cmp-voice');
    require(visible(button), "the shared slot is visible");
    if (name === "composer-stop-slot") {
      require(["ack", "running", "waiting"].includes(form.dataset.taskState), "this thread has a cancellable reply");
      require(button.getAttribute("aria-label") === "停止" && visible(button.querySelector('svg')) && !button.querySelector('.av'), "Stop is drawn, never an emblem with a Stop label");
      require(!visible(form.querySelector('.cmp-send')) && !button.classList.contains('vm-away'), "Stop alone occupies the slot and voice animation cannot hide it");
    } else {
      require(form.dataset.taskState === "idle" && visible(button.querySelector('.av')), "the stopped reply releases the slot");
      const calls = window.__look.calls;
      require(!calls.some(call => call.command === "window_hotkey" && ["agent_down", "agent_up"].includes(call.kind)), "Stop starts no voice recording");
      if (name === "composer-stop-pending-result") {
        const send = calls.find(call => call.command === "agent_ask_text"), stops = calls.filter(call => call.method === "agent.history.stop");
        require(stops.length === 1 && stops[0].params.session_id === send.requestId && stops[0].params.member_id === 0, "exactly the pending request stops");
      } else if (name === "composer-stop-voice-result") {
        require(calls.filter(call => call.command === "window_hotkey" && call.kind === "cancel").length === 1, "the controller cancels processing once");
        require(!calls.some(call => call.method === "agent.history.stop"), "no session is guessed before the turn exists");
      } else {
        const stops = calls.filter(call => call.method === "worker.cancel");
        require(stops.length === 1 && stops[0].params.task_id === 71, "only the displayed background task stops");
      }
    }
    return { check: name, state: form.dataset.taskState };
  }
  if(name.startsWith("p04-")) {
    const messages=[...document.querySelectorAll('.au-room-thread .message-text')];
    if(name==='p04-blocked'){require(document.querySelector('[data-handoff]').textContent.includes('缺少驗收所需的檔案'),'missing artifact reason is actionable');require(!document.querySelector('[data-handoff] .message-quote'),"the request is only ever the delegating member's own message");}
    if(name==='p04-chief-last')require(document.querySelector('.au-room-thread .tn:last-child .au-room-wrapup') || document.querySelector('.au-room-thread .tn:last-child.au-room-wrapup'),'chief is last');
    if(name==='p04-status-only')require(!messages.some(message=>message.textContent.includes('正在發言')),'progress never enters final bodies');
    if(name==='p04-addresses')require(!messages.some(message=>/@(?:\s|$)/u.test(message.textContent)),'no dangling address');
    if(name==='p04-short')require(document.querySelector('.au-room-wrapup').textContent.includes('沒有可驗收的成果'),'zero results are explicit');
    if(name==='p04-task-slot'){
      const form=document.querySelector('.composer[data-task-state="running"]');
      require(visible(form.querySelector('.cmp-voice'))&&!visible(form.querySelector('.cmp-send')),'only Stop occupies the slot');
      require(form.querySelector('.cmp-voice').getAttribute('aria-label')==='停止','Stop is accessible');
      require(visible(form.querySelector('.cmp-voice svg'))&&!form.querySelector('.cmp-voice .av'),'Stop is drawn, not an emblem with a Stop label');
    }
    return {check:name,matched:true};
  }
  if (name.startsWith("p02-")) {
    const data = window.__look.data, calls = window.__look.calls;
    if (name === "p02-roster") require(calls.some(c => c.method === "members.list"), "shared roster boundary is read");
    if (name === "p02-mentions" || name === "p02-room-mentions") {
      const menu = document.querySelector("#app-popover");
      require(visible(menu), "mention menu is visible");
      require(menu.textContent.includes(data.members[1].name), "bot comes from the roster");
      require(data.servers.some(app => menu.textContent.includes(app.name)), "app comes from the same snapshot");
      const rows = [...menu.querySelectorAll('button')], row = label => rows.find(item => item.querySelector('.mt').textContent === label);
      for (const item of rows) require(visible(item.querySelector('.mlead > *')), `${item.textContent} leads with a face or a mark`);
      require(row("@" + data.members[1].name)?.querySelector('.mlead .av'), "a bot shows its member face");
      for (const app of data.servers) require(row("@" + app.name)?.querySelector('.mlead .mono'), `${app.name} shows its connection mark`);
      const columns = selector => rows.map(item => item.querySelector(selector).getBoundingClientRect().left);
      for (const selector of ['.mlead', '.mt']) require(Math.max(...columns(selector)) - Math.min(...columns(selector)) <= 1, `${selector} aligns in one column`);
    }
    if (name === "p02-picker") require(document.querySelectorAll(".room-picked span").length === 2, "Raphael and the selected colleague have chips");
    if (name === "p02-fallback") require(document.querySelector(".au-room-controls").textContent.includes("群組預設"), "fallback is visible");
    if (name === "p02-blocked") {
      const lines = eventLines(3), rows = [...document.querySelectorAll('.au-room-thread > li')];
      require(lines.every(line => line.closest('.au-room-thread > li.room-intent-blocked')), "blocked replies are lines of the thread");
      require(!document.querySelector('.au-room-controls')?.textContent.trim(), "nothing about blocked replies sits above the composer");
      const at = selector => rows.indexOf(document.querySelector(selector)?.closest('li'));
      const blocked = rows.filter(row => row.matches('.room-intent-blocked')).map(row => rows.indexOf(row));
      require(blocked[0] === at('[data-room-message="2"]') + 1 && blocked[1] === at('[data-room-message="7"]') + 1 && blocked[2] === blocked[1] + 1, "each blocked reply stands where its exchange stopped");
      require(lines[0].textContent === "小森 未能回覆：請求太頻繁而被限流" && lines[1].textContent === "小晴 未能回覆：已停止", "blocked replies name the member and why in the window language");
    }
    if (name === "p02-meeting-event") {
      const [line] = eventLines(1);
      require(line.closest('.conversation-event-line [data-meeting-room]') && line.textContent === "已開啟會議 產品方向討論", "the meeting is one centred line that opens its room");
      require(visible(line.querySelector('svg.i')) && !line.closest('.ra'), "a small group icon leads the line, beside no avatar");
    }
    if (name === "p02-meeting-open") require(document.querySelector(".au-room-heading b").textContent === data.rooms[0].name, "meeting link opens the real room pane");
    if (name === "p02-roles") require(calls.some(c => c.method === "rooms.update" && c.params.roles?.[1] === "moderator"), "room roles are persisted at the native boundary");
    if (name === "p02-long-exchange") {
      const exchange = data.roomExchanges.at(-1);
      require(exchange.hops > 3 && exchange.turns_taken > 6, "rendered exchange crosses both admission limits");
      require(exchange.reply_intents.every(intent => intent.state === "done"), "wrap-up has no pending intent");
    }
    return { check: name, matched: true };
  }
  if (name === "admin-description-draft") {
    const input = document.querySelector('.composer textarea');
    require(visible(input) && input.value.includes("整理未讀信並準備回覆"), "description opens the chief's ordinary composer");
    require(input.value.includes("確認後才建立"), "description requests an editable proposal");
    require(!window.__look.calls.some(call => call.method === 'members.create'), "description does not create a member directly");
    return { check: name };
  }
  if (name === "bot-renamed-centred") {
    const lines = [...document.querySelectorAll('.bot-renamed')].filter(visible);
    require(lines.length === 1 && lines[0].textContent === "已重新命名為 晨星", "one saved rename line");
    require(getComputedStyle(lines[0]).textAlign === "center", "rename line is centered");
    require(window.__look.data.members.length === 1 && window.__look.data.members[0].profile_ready, "profile saved without a second Bot");
    const answers = window.__look.calls.filter(call => call.command === 'agent_question_answer');
    require(answers.length === 1 && answers[0].drafts[0].member_id === 0, "shared apply boundary runs once");
    return { check: name };
  }
  if (name === "admin-draft-cancel" || name === "admin-edited-result") {
    const calls = window.__look.calls.filter(call => call.command === 'agent_question_answer');
    require(calls.length === 1 && calls[0].approved === (name === "admin-edited-result"), "one owner decision");
    const created = window.__look.data.members.filter(member => member.id >= 8);
    require(created.length === (name === "admin-edited-result" ? 2 : 0), "only selected drafts are applied");
    if (name === "admin-edited-result") {
      require(created[0].role === "首席營運長" && !created.some(member => member.name === "RD"), "edits and removal persist");
      require(calls[0].groups[0].name === "工作室", "edited group crosses the confirmation boundary");
      require(created.every(member => window.__look.data.groups.some(group => group.id === member.group_id && group.name === "工作室")), "edited group membership persists");
    }
    return { check: name, created: created.length };
  }
  if (name === "plain-bot-chat") {
    const replies = [...document.querySelectorAll('.tn[data-id="1"] .ra .chat-message .message-text')].filter(visible);
    require(replies.length === 2, "the core's two-message reply shows as two answers");
    require(replies[0].textContent.startsWith("這週的研究有三個重點") && replies[1].textContent.trim().endsWith("方便你接著討論。"), "the reply loses only its opening and closing marks");
    return { check: name, words: plainWords() };
  }
  if (name === "centred-system-events") {
    const lines = eventLines(3).map(line => line.textContent);
    require(lines.join("|") === "已轉交給 小晴已完成|已詢問 小森執行中|已開啟會議 產品方向討論", `hand-off, consultation and meeting lines in order: ${lines.join("|")}`);
    const answer = document.querySelector('.tn[data-id="1"] .ra').getBoundingClientRect(), last = document.querySelector('.tn[data-id="1"] .conversation-event-line').getBoundingClientRect();
    require(last.bottom <= answer.top, "events stand between the owner's words and Raphael's answer");
    return { check: name, lines };
  }
    if (name === "member-deleted") {
      require(document.querySelector('.mb-pill-t')?.textContent === window.__look.data.members.find(item => item.id === 0)?.name, "deleting the selected member returns to Raphael");
    require(window.__look.calls.some(call => call.method === "members.delete" && call.params?.id === 2), "the core is asked to delete that member");
    require(!window.__look.data.members.some(item => item.id === 2) && !document.querySelector('[data-member="2"]'), "the member is gone from the team and the list");
    require(document.querySelector(".toast")?.textContent.includes("已刪除「小森」"), "a notice names who was deleted");
    return { check: name };
  }
  if (name === "conversation-made") {
    const made = window.__look.calls.filter(call => call.method === "conversations.create").map(call => call.params?.member_id);
    require(made.length === 2 && made.every(id => id === 1), "each 新對話 makes a conversation with the picked member, also from its empty one");
    const latest = Math.max(...window.__look.data.conversations.filter(item => item.member_id === 1).map(item => item.id));
    require(window.__look.calls.filter(call => call.method === "agent.history.list").at(-1)?.params?.conversation_id === latest, "the newest conversation is the one open");
    require(document.querySelector(".conversation-caption")?.textContent === "新對話", "the open conversation is the new one");
    return { check: name, made };
  }
    if (name === "conversation-deleted") {
      const next=window.__look.data.conversations.find(item=>item.member_id===0&&item.is_default&&item.kind!=="quick");
      require(next && window.__look.calls.filter(call => call.method === "agent.history.list").at(-1)?.params?.conversation_id === next.id, "deletion opens the new server default instead of cached quick history");
    const rows = [...document.querySelectorAll(".mb-det [data-conversation-open]")].map(row => row.textContent);
    require(!rows.some(text => text.includes("這週的研究與安排")), "the deleted conversation is gone");
    require(!rows.some(text => text.includes("新對話")), "no empty 新對話 takes its place");
    require(window.__look.data.conversations.filter(item => item.member_id === 0 && item.is_default).length === 1, "another conversation became the main one");
    require(document.querySelector(".toast")?.textContent.includes("已刪除「這週的研究與安排」"), "a notice names what was deleted");
    return { check: name, rows };
  }
  if (name === "work-dots" || name === "pending-work") {
    const section = document.querySelector(`${name === "pending-work" ? '.tn.is-pending ' : ''}.work-section.is-live`);
    require(visible(section), "the live work line is visible");
    require(!document.querySelector('.page-agent .ans.thinking'), "the conversation never shows a second dots style");
    const dots = [...section.querySelectorAll('.work-toggle .think i')].filter(visible);
    require(dots.length === 3, "the live work row shows its three dots");
    if (name === "work-dots") require(dots.some(dot => getComputedStyle(dot).animationPlayState === "paused" && getComputedStyle(dot).transform !== "none"), "the dots are held mid-bounce");
    for (const dot of dots) {
      const box = dot.getBoundingClientRect();
      for (let parent = dot.parentElement; parent && !parent.matches('.work-section'); parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow === "visible") continue;
        const edge = parent.getBoundingClientRect();
        require(box.top >= edge.top - 0.5 && box.bottom <= edge.bottom + 0.5, "a moving dot is never cut off by the row around it");
      }
    }
    const row = section.querySelector('.work-toggle')?.textContent ?? "";
    require(row.includes("思考中") && !row.includes("處理中"), "a reply that has just started says once what is happening");
    require(/^· \d+ 秒$/.test(section.querySelector('.work-time')?.textContent ?? ""), "the live line includes elapsed seconds");
    if (name === "pending-work") require(!section.querySelector('button, [data-act], .work-chevron, .work-body'), "pending work has nothing empty to expand");
    return { check: name, row };
  }
  if (name === "conversation-running") {
    const calls = window.__look.calls.filter(call => call.method === "agent.history.list");
    require(calls.some(call => (call.params?.member_id ?? 0) === 0 && (call.params?.conversation_id ?? 1) === 1), "R-UI-32: running turn belongs to the open formal conversation");
    require([...document.querySelectorAll('.ra .work-toggle')].some(visible), "R-UI-32: running progress is visible");
    require(![...document.querySelectorAll('.ra .chat-message')].some(visible), "R-UI-32: completed answer is absent while running");
    require(document.querySelector('.work-latest')?.textContent === "已核對三份報告，正在彙整研究結論。", "R-UI-42: the running state shows the latest step plainly");
    return { check: name, running: true, words: plainWords() };
  }
  if (name === "live-scenario-owner-view") {
    const answers = [...document.querySelectorAll('.ra .chat-message > .ans')].filter(visible);
    require(answers.length === 1, "one owner-visible terminal answer");
    require(answers[0].textContent.includes("需要重新登入並授予讀取權限。"), "actionable zh-TW failure survives the real renderer");
    require(!answers[0].textContent.includes("正在查看"), "progress stays outside final messages");
    const calls = window.__look.calls.filter(call => call.method === "agent.history.list");
    require(calls.some(call => (call.params?.member_id ?? 0) === 0), "owner view reads Raphael's production RPC scope");
    return { check: name, answers: answers.length, scope: "personal", status: "missing-connection" };
  }
  if (name === "composer-learn") {
    const calls = window.__look.calls.filter(call => call.method === "dictionary.correct");
    require(calls.length === 1, "one native correction request");
    require(JSON.stringify(calls[0].params.edits) === JSON.stringify([{ before: "Please use Open Mouse", after: "Please use OpenMausBot" }]), "dictation evidence reaches the shared native tracker unchanged");
    require(!document.querySelector(".toast"), "the passive learned pill owns the notice, independently of the composer");
    return { check: name, edits: calls[0].params.edits, nativePill: "separate entry" };
  }
  if (name === "room-required-chief") {
    const chief = document.querySelector('[data-dlg="member"][data-member="0"]');
    require(chief?.disabled && chief.getAttribute('aria-pressed') === 'true', 'Raphael is required');
    return { check: name, chief: 0 };
  }
  if (name === "room-generated-name" || name === "room-edited-name") {
    const input = document.querySelector('#room-name');
    require(name === 'room-edited-name' ? input.value === '上線協作' : input.value.includes('小晴') && input.value.includes('拉斐爾'), 'generated name follows selection and preserves owner edits');
    return { check: name, value: input.value };
  }
  if (name === 'room-isolation-send') {
    require(window.__look.calls.some(c => c.method === 'rooms.send' && c.params.text === 'roomnonce-private-isolation'), 'room send reaches its own boundary');
    require(!window.__look.calls.some(c => c.method === 'agent.ask'), 'room send never uses private ask');
    require(!document.querySelector('[data-room-act="turn"]'), 'room messages have no private navigation');
    return { check: name };
  }
  if (name === 'room-private-isolation') {
    require(!document.querySelector('.mb-chat:not([hidden]) .thread')?.textContent.includes('roomnonce-private-isolation'), 'private history excludes room text');
    return { check: name };
  }
  if (['room-reply-owner','room-reply-peer','room-reply-source-missing'].includes(name)) {
    const id = name === 'room-reply-owner' ? 2 : 3;
    const chip = document.querySelector(`[data-room-message="${id}"] .au-room-reply`);
    require(visible(chip), 'source chip is visible');
    require(chip.textContent === (name === 'room-reply-owner' ? '回覆 你' : name === 'room-reply-peer' ? '回覆 小晴' : '來源訊息已無法取得'), 'chip uses server source identity');
    return { check: name, source: chip.textContent };
  }
  if (name === "quick-model-row") {
    const row = document.querySelector('[data-row="quick-model"]');
    const picker = row?.querySelector('.mp-trigger');
    require(visible(picker) && !!picker.querySelector('.mp-tname')?.textContent && !!picker.querySelector('.mp-source')?.textContent, "quick model uses the shared named provider card");
    const purpose = { 'zh-TW': '快速提問', en: 'Quick questions', ja: 'クイック質問' }[document.documentElement.lang];
    require(!!purpose && row.querySelector('.t')?.textContent.trim() === purpose, "quick questions' row label states their purpose in the window language");
    require(!row.querySelector('.models-purpose-note'), "quick questions need no helper paragraph (R-UI-02)");
    require(!!row.querySelector('[data-price="quick-model"]')?.textContent, "quick questions show the effective model price");
    require(!row.querySelector('[data-k="quick-effort"]') && !row.querySelector('.sel:not(.mp-trigger)'), "quick questions' effort is chosen inside the model list, as the answer model's is, not beside it");
    return { check: name };
  }
  if (name === "quick-conversation-list") {
    const first = document.querySelector('.mb-det [data-conversation-open]');
    require(first?.dataset.conversationOpen === "4", "quick questions are pinned first");
    require(first?.textContent.includes("快速提問"), "the kind uses the window-language title");
    return { check: name, conversation: 4 };
  }
  if (name === "quick-conversation") {
    require(document.querySelector('.conversation-trigger')?.textContent.includes("快速提問"), "the opened conversation keeps its kind title");
    require(document.querySelector('.tn[data-id="90"] .me')?.textContent.includes("今天下午有哪些會議"), "the saved quick question is visible");
    require(!document.querySelector('.tn[data-id="1"]'), "formal history stays out of quick questions");
    return { check: name, conversation: 4 };
  }
  if (name === "quick-question-result") {
    const turn = document.querySelector('.tn[data-id="91"]');
    require(visible(turn) && turn.querySelector('.me')?.textContent.includes("明天早上要帶傘嗎"), "the Alt+Space question arrived in the open quick conversation");
    require(visible(turn.querySelector('.ra .chat-message[data-reply]')) && turn.querySelector('.ra .chat-message[data-reply]').textContent.includes("出門記得帶傘"), "its answer shows below its public step");
    const meta = turn.querySelector('.ra-face')?.getAttribute('title') ?? "";
    require(/luna/i.test(meta) && !/\bsol\b/i.test(meta), `the answer names the quick model that answered it: ${meta}`);
    require(document.querySelector('.conversation-trigger')?.textContent.includes("快速提問"), "the quick conversation stays open");
    require(!document.querySelector('.tn[data-id="1"]'), "formal history stays out of quick questions");
    return { check: name, model: meta, words: plainWords() };
  }
  if (name === "quick-formal-isolation-formal") {
    require(visible(document.querySelector('.tn[data-id="1"]')), "Raphael's formal thread is open");
    require(!document.querySelector('.tn[data-id="90"]'), "quick questions stay out of the formal thread");
    return { check: name };
  }
  if (name === "quick-formal-isolation") {
    const sent = window.__look.calls.filter(call => call.command === "agent_ask_text");
    require(sent.length === 2, `two typed questions reached the native boundary, found ${sent.length}`);
    require(sent[0].text === "整理這週的研究重點" && sent[0].conversationId === 1 && !("destination" in sent[0]), "the formal question names its thread and no quick destination");
    require(sent[1].text === "那明天呢？" && sent[1].conversationId === 4 && sent[1].destination === "quick", "the quick follow-up names the quick destination and its conversation");
    require(visible(document.querySelector('.tn[data-id="90"]')) && !document.querySelector('.tn[data-id="1"]'), "the quick thread shows only quick questions");
    return { check: name, sent: sent.map(call => ({ conversation: call.conversationId, destination: call.destination ?? null })) };
  }
  if (name === "quick-stop") {
    const stops = window.__look.calls.filter(call => call.method === "agent.history.stop");
    require(stops.length === 1 && stops[0].params.session_id === "look-quick" && stops[0].params.member_id === 0, "Stop names the running quick request alone");
    const turn = document.querySelector('.tn[data-id="90"]');
    require(turn?.dataset.status === "denied" && !turn.dataset.live, "the quick question ended where it ran");
    require(!document.querySelector('.composer[data-task-state="running"]'), "the gold slot is free again");
    require(window.__look.data.turns.find(item => item.id === 1)?.status === "done", "the formal thread is untouched");
    return { check: name };
  }
  if (name === "quick-model-selection") {
    const sets = window.__look.calls.filter(call => call.method === "settings.set").map(call => call.params);
    require(sets.some(set => set.key === "quick_model" && set.value === "cli:codex:gpt-6.1"), "the quick model is saved as the subscription model, its effort apart");
    require(sets.some(set => set.key === "quick_effort" && set.value === "high"), "the quick effort is saved on its own");
    require(!sets.some(set => set.key === "agent_model") && window.__look.data.settings.agent_model === "openai/gpt-6-sol", "Raphael's answer model stays as it was");
    const row = document.querySelector('[data-row="quick-model"]');
    require(row.querySelector('[data-k="quick-model"]')?.getAttribute('aria-label')?.includes("GPT-6.1"), "the row shows the chosen model");
    require(row.querySelector('[data-price="quick-model"]')?.textContent.trim() === "訂閱", "a subscription model shows it is billed by subscription");
    return { check: name, saved: sets.filter(set => set.key.startsWith("quick_")) };
  }
  if (name === "overlay-pages") {
    const line = document.querySelector(".subs.on .sub-line"), text = line?.textContent ?? "";
    require(text.startsWith("《答。1. 建立帳號") && !text.endsWith("》"), "the first page of the answer is on screen, the rest to come");
    require(!/https?:|www\.|\]\(|composio\.dev/.test(text), "the corner writes no address or link");
    const box = line.getBoundingClientRect(), height = parseFloat(getComputedStyle(line).lineHeight);
    require(box.height <= 2 * height + 1, `a page is two lines at most (${Math.round(box.height / height)})`);
    // The real window is the emblem's canvas and 40 px over it (overlay.rs `place`); the page must stay inside it.
    const canvas = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--c"));
    require(innerHeight - box.top <= canvas + 40, "the page stays inside the overlay window");
    return { check: name, text };
  }
  if (name === "overlay-step") {
    require(document.getElementById('progress')?.textContent === "《告。正在查看今天下午的行程。》", "the latest shared turn narration is the subtitle");
    return { check: name, text: document.getElementById('progress').textContent };
  }
  if (name === "cleanup-no-effort") {
    const row = document.querySelector('.model-chooser .mc-effort');
    require(row && !visible(row) && !row.querySelector('[data-effort]'), "cleanup has no unused effort row");
    return { check: name };
  }
  if (name === "model-effort-order") {
    const buttons = [...document.querySelectorAll('.model-chooser .mc-effort [data-effort]')];
    const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    require(buttons.length > 1, "the fixture exercises several effort choices");
    const values = buttons.map(button => button.dataset.effort);
    require(values.every((value, index) => index === 0 || order.indexOf(values[index - 1]) < order.indexOf(value)), "efforts run from shallow to deep regardless of catalog order");
    require(buttons.every(visible), "every effort choice is visible");
    return { check: name, efforts: values };
  }
  if (name.startsWith("model-choice-")) {
    const dialog = document.querySelector('.model-chooser');
    const scroller = dialog?.querySelector('.mc-scroll');
    require(visible(scroller), "the model list is visible");
    const rows = [...dialog.querySelectorAll('.mc-row, .lm-row')];
    require(rows.length > 0, "the catalogue contains model choices");
    const viewport = scroller.getBoundingClientRect();
    if (name === "model-choice-scroll") {
      const last = rows.at(-1).getBoundingClientRect();
      require(last.bottom <= viewport.bottom + 1 && last.top >= viewport.top - 1, "the final model can be reached inside the list");
      return { check: name, rows: rows.length };
    }
    if (name === "model-choice-selection") {
      const selected = dialog.querySelector('.lm-main[aria-checked="true"]');
      require(selected?.dataset.name === 'qwen3-asr', "the preview selects exactly the requested local model");
      require(dialog.querySelectorAll('.lm-main[aria-checked="true"]').length === 1, "only one local radio is selected");
      require(document.activeElement === selected && parseFloat(getComputedStyle(selected).outlineWidth) >= 2, "keyboard focus stays visible on the choice");
      const mark = selected.querySelector('.ck svg');
      require(visible(mark) && mark.getBoundingClientRect().width <= 16 && getComputedStyle(mark).fill === 'none' && getComputedStyle(mark).stroke !== 'none', "the selected model has a bounded, visible check mark");
      require(!window.__look.calls.some(call => ['models.download', 'models.use', 'settings.set'].includes(call.method)), "previewing does not download or save settings");
      require(getComputedStyle(selected.closest('.lm-row')).backgroundColor !== getComputedStyle(rows[1]).backgroundColor, "selection has a distinct themed surface");
      return { check: name, selected: selected.dataset.name };
    }
    let minimumGap = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const box = rows[i].getBoundingClientRect(), style = getComputedStyle(rows[i]);
      require(box.left >= viewport.left && box.right <= viewport.right + 1, "model choices fit the scroll pane");
      require(style.borderTopStyle === 'solid' && parseFloat(style.borderTopWidth) <= 1, "choices use subtle designed borders instead of native button frames");
      const button = rows[i].matches('.lm-row') ? rows[i].querySelector('.lm-main') : rows[i];
      const buttonStyle = getComputedStyle(button);
      require(!['outset', 'inset'].includes(buttonStyle.borderTopStyle), "model buttons reset the browser's default border");
      require(parseFloat(buttonStyle.paddingTop) >= 12 && box.height >= 80, "each choice retains breathing room and a comfortable target");
      for (const text of button.querySelectorAll('.mp-line, .mp-sub, .mc-description')) {
        require(text.scrollWidth <= text.clientWidth + 1, "model metadata wraps within its column");
      }
      if (i > 0) minimumGap = Math.min(minimumGap, box.top - rows[i - 1].getBoundingClientRect().bottom);
    }
    require(rows.length < 2 || minimumGap >= 8, "adjacent model choices have at least eight pixels of separation");
    const footer = dialog.querySelector('.mb-dlg-act').getBoundingClientRect();
    require(viewport.bottom <= footer.top + 1, "scrolling choices cannot cover the fixed actions");
    return { check: name, rows: rows.length, minimumGap: Number.isFinite(minimumGap) ? minimumGap : null };
  }
  if (name === "delete-confirmation") {
    const dialogs = [...document.querySelectorAll('.mb-dialog.mb-confirm')];
    const dialog = dialogs.at(-1);
    require(visible(dialog), "the confirmation is visible");
    const buttons = [...dialog.querySelectorAll('.mb-dlg-act .btn')];
    require(buttons.map(button => button.dataset.dlg).join('|') === 'cancel|delete', "Cancel precedes Delete visually and in keyboard order");
    require(document.activeElement === buttons[0], "Cancel receives initial focus");
    require(visible(document.getElementById(dialog.getAttribute('aria-describedby'))), "the irreversible-action description is announced");
    require(buttons[1].classList.contains('pri'), "Delete uses the skin's primary accent");
    require(getComputedStyle(dialog.querySelector('.mb-dlg-act')).borderTopWidth === '0px', "no divider separates the compact footer");
    require(parseFloat(getComputedStyle(buttons[0]).borderRadius) >= 18, "actions have pill corners");
    const box = dialog.getBoundingClientRect();
    const close = dialog.querySelector('[data-dlg="close"]').getBoundingClientRect();
    require(box.width <= 482 && box.left >= 0 && box.right <= innerWidth, "the compact panel fits the window");
    require(close.width >= 32 && close.height >= 32, "the close control retains its hit target");
    return { check: name, width: box.width, height: box.height };
  }
  if (name.startsWith("cli-account-")) {
    const row = document.querySelector('[data-cli-menu="codex"], [data-cli="codex"]')?.closest('.cli-card');
    require(visible(row), "the Codex card is visible");
    const calls = window.__look.calls;
    if (name === "cli-account-menu") {
      require(visible(document.querySelector('#app-popover.mb-menu [data-pick="disconnect"]')), "disconnect uses the shared row menu");
      require(!document.querySelector('select'), "no native select is introduced");
    } else {
      require(calls.filter(call => call.method === 'brains.cli_disconnect' && call.params.id === 'codex').length === 1, "one menu choice disconnects exactly once without confirmation");
      const cli = window.__look.data.clis.find(cli => cli.id === 'codex');
      require(cli.logged_in === true, "the CLI's own login remains intact");
      if (name === "cli-account-disconnected") {
        require(cli.disconnected && !cli.available && cli.models.length === 0, "disconnected CLI supplies no runnable models");
        require(visible(row.querySelector('[data-cli="codex"]')), "reconnection stays on the card");
        require(!row.querySelector('[data-cli-menu]'), "a disconnected card has no connected menu");
      } else {
        require(visible(row.querySelector('[data-cli-menu="codex"]')) && cli.available && !cli.disconnected, "reconnection restores the connected card");
        require(calls.filter(call => call.method === 'brains.cli_login' && call.params.id === 'codex').length === 1, "connect reaches the core once");
      }
    }
    return { check: name, text: row.textContent };
  }
  if (name === "room-discussion") {
    require(document.querySelectorAll('.au-room-reply').length >= 3, "multiple replies identify their colleagues");
    require(document.querySelector('.au-room-thread').textContent.includes('我不同意'), "members can disagree");
    require(visible(document.querySelector('.au-room-crown')), "Raphael has the chief badge");
    const crown = document.querySelector('.au-room-crown').getBoundingClientRect();
    const face = document.querySelector('.au-room-crown').parentElement.getBoundingClientRect();
    require(crown.right <= face.right && crown.left >= face.left, "the chief badge stays inside its participant slot");
    // Messages carry face, name and reply chip only; roles stay with the faces of the header and the member column.
    require(document.querySelectorAll('.au-room-participant[data-tooltip*=" · "]').length === 3, "header faces name each member and role");
    for (const meta of document.querySelectorAll('.au-room-meta')) require([...meta.children].every(child => child.matches('.au-room-author, .au-room-reply')), "no role tag above a message");
    return { check: name, replyChips: document.querySelectorAll('.au-room-reply').length };
  }
  if (name === "room-wrapup") {
    const card = document.querySelector('.au-room-wrapup');
    require(visible(card), "the wrap-up is visible");
    const answer = getComputedStyle(card.querySelector('.ans')), ordinary = getComputedStyle(document.querySelector('.au-room-message:not(.au-room-wrapup) .ra .ans'));
    require(answer.borderLeftWidth === '0px' && answer.borderTopWidth === '0px' && answer.backgroundColor === ordinary.backgroundColor && answer.paddingLeft === ordinary.paddingLeft, "the wrap-up is Raphael's ordinary message, not a bordered card");
    require(card.querySelector('.au-room-author')?.textContent === '拉斐爾' && visible(card.querySelector('.ra-face .av')) && !/討論收束/.test(card.textContent), "face and name lead the wrap-up like every room message");
    require([...card.querySelectorAll('.au-room-wrapup-section h3')].map(heading => heading.textContent).join('|') === '結論|待你決定|下一步', "wrap-up has three labelled sections");
    require(card.querySelectorAll('.au-room-wrapup-owner').length === 3, "next steps style each named owner");
    for (const text of ['小晴：', '小森：', '拉斐爾：']) require(card.textContent.includes(text), `wrap-up preserves ${text}`);
    require(card.getBoundingClientRect().right <= innerWidth, "the wrap-up fits the viewport");
    return { check: name, author: 0 };
  }
  if (name === "room-responder") {
    const menu = document.querySelector('#app-popover');
    for (const value of ['auto', 'member:0', 'member:1', 'everyone']) require(visible(menu?.querySelector(`[data-value="${value}"]`)), `${value} is selectable`);
    const members = [...menu.querySelectorAll('[data-value^="member:"]')].map(row => row.dataset.value);
    require(members.join() === (window.__look.data.primaryId === 1 ? 'member:1,member:0' : 'member:0,member:1'), "responder choices follow the primary display exchange");
    require(!document.querySelector('.mb-dialog select'), "responder uses the app's selector");
    return { check: name, choices: 4 };
  }
  if (name === "room-reply-cancel") {
    require(!visible(document.querySelector('.cmp-quote')), "cancel removes the reply recipient");
    require(!window.__look.calls.some(call => call.method === 'rooms.send'), "cancel does not send a message");
    return { check: name, cancelled: true };
  }
  if (name === "room-reply-send") {
    require(window.__look.calls.some(call => call.method === 'rooms.send' && call.params.reply_to === 2), "reply reaches the core with the target message id");
    return { check: name, replyTo: 2 };
  }
  if (name === "room-stop") {
    require(window.__look.calls.some(call => call.method === 'rooms.stop' && call.params.room_id === 1), "stop reaches the core");
    require(!document.querySelector('[data-room-act="stop"]'), "no separate Stop pill remains");
    require(!document.querySelector('.au-room-pane .composer[data-task-state="running"]'), "terminal snapshot releases Stop");
    return { check: name, stopRequested: true };
  }
  if (name === "room-replies") {
    const chip = document.querySelector('[data-room-message="3"] .au-room-reply');
    require(visible(chip) && chip.textContent === "回覆 小晴", "the reply identifies its recipient");
    require(chip.getBoundingClientRect().right <= innerWidth, "the reply chip fits the viewport");
    return { check: name, recipient: 1 };
  }
  if (name === "room-thinking") {
    const exchange = window.__look.data.roomExchanges.at(-1);
    require(exchange.active_turn === 2 && exchange.reply_intents.filter(intent => intent.state === "running").length === 1, "the fixture matches one active core turn and queued reply intents");
    const rows = [...document.querySelectorAll('.au-room-thinking')];
    require(rows.length === 1 && visible(rows[0]), "only one member is shown speaking");
    require(getComputedStyle(rows[0]).flexDirection === 'row', "speaker face and status share one row");
    require(visible(rows[0].querySelector('.av')), "the speaker's face is visible");
    require(rows[0].textContent === "小晴 正在發言…", "the speaking row names the member");
    return { check: name, speakingRows: rows.length };
  }
  if (name === "p03-handoff" || name === "p03-handoff-expanded") {
    const task = window.__look.data.roomHandoffs[0], event = document.querySelector(`[data-handoff="${task.task_id}"]`);
    require(visible(event) && document.querySelectorAll('[data-handoff]').length === 1, "one durable receipt is visible");
    require(!event.closest('.chat-message'), "handoffs are events outside message bodies");
    require(event.dataset.state === task.state, "receipt and rendered state agree");
    require(event.querySelector('summary').textContent.startsWith('已轉交給 小晴'), "the receipt names its assignee");
    require(visible(event.querySelector('summary .av')), "the compact line includes the member face");
    eventLines(1);
    require(task.ready_at_ms === task.created_at_ms && task.dispatch_policy === 'immediate', "source dates do not schedule work");
    if (name === "p03-handoff-expanded") {
      const detail = event.querySelector('.handoff-detail');
      require(event.open && visible(detail.querySelector('.message-text')), "expansion shows the persisted result");
      require(detail.querySelector('.message-quote')?.textContent === "你請小晴立即整理驗收報告。", "expansion shows what was asked");
      require(detail.querySelector('.handoff-files')?.textContent === "上線驗收報告.html", "expansion names the produced file, not its digest");
      require(!/#\d|digest|fixture-report/.test(detail.textContent), "expansion shows no internal ids");
    } else require(!event.open, "handoff details start collapsed");
    return { check: name, taskId: task.task_id, state: task.state, readyAt: task.ready_at_ms };
  }
  if (name === "room-row-menu") {
    require(!document.querySelector('[data-room-delete]'), "room rows have no direct delete button");
    const menu = document.querySelector('#app-popover');
    for (const action of ["rename", "members", "delete"]) require(visible(menu?.querySelector(`[data-pick="${action}"]`)), `${action} is available from the room menu`);
    return { check: name, actions: 3 };
  }
  if (name === "team-mentions" || name === "slash-commands") {
    const input = [...document.querySelectorAll('.composer textarea')].find(visible);
    const menu = document.querySelector('#app-popover');
    require(visible(input) && visible(menu), "the completion menu and its field are visible");
    const at = name === "team-mentions" ? input.value.lastIndexOf('@', input.selectionStart) : 0;
    require(at >= 0, "a completion character is present");
    const before = input.value.slice(0, at), prefix = before.split('\n').at(-1);
    const style = getComputedStyle(input), field = input.getBoundingClientRect(), box = menu.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const spacing = parseFloat(style.letterSpacing) || 0;
    const expected = field.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + context.measureText(prefix).width + prefix.length * spacing - input.scrollLeft;
    require(Math.abs(box.left - expected) <= 24, `menu starts beside the completion character: ${box.left} versus ${expected}`);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const lineTop = field.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + (before.split('\n').length - 1) * lineHeight - input.scrollTop;
    require(box.bottom <= lineTop + 4 || box.top >= lineTop + lineHeight - 4, "the menu sits above or below its text line");
    require(box.left >= 8 && box.right <= innerWidth - 8, "the menu stays inside the viewport");
    for (const item of menu.querySelectorAll('button')) {
      require(!item.querySelector('.ck'), "text completions do not reserve an empty icon/check column");
      const lead = item.querySelector('.mlead'), first = lead ?? item.querySelector('.mt'), itemBox = item.getBoundingClientRect();
      require(first && first.getBoundingClientRect().left - itemBox.left <= 12 && (!lead || lead.childElementCount > 0), "a completion starts at the row padding with its face, mark or text");
    }
    return { check: name, menuLeft: box.left, characterX: expected, delta: Math.abs(box.left - expected) };
  }
  if (name === "context-menu" || name === "context-menu-key") {
    // R-UI-44: a right click anywhere on a row, or the menu key on it, opens the menu of its ⋯: the same menu a click on the ⋯ opens.
    const labels = () => [...document.querySelectorAll('#app-popover button')].map(button => button.textContent.trim().replace(/\s+/g, ' '));
    const popover = document.querySelector('#app-popover'), opener = document.querySelector('[data-overflow][aria-expanded="true"]');
    require(visible(popover) && opener, "a menu is open and belongs to a ⋯ button");
    const box = popover.getBoundingClientRect(), shown = labels(), at = window.__look.pointer;
    require(shown.length > 0, "the menu has items");
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu is inside the window");
    if (name === "context-menu") {
      require(at, "the scene right-clicked first");
      require(Math.abs(box.left - Math.max(8, Math.min(at.x, innerWidth - box.width - 8))) <= 2, `the menu starts at the pointer: its left edge is ${box.left}, the pointer is at ${at.x}`);
      require(box.top >= at.y || box.bottom <= at.y, "the menu does not cover the pointer");
    } else {
      const anchor = opener.getBoundingClientRect();
      require(Math.abs(box.left - Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8))) <= 2, "a menu the key opens stands under its ⋯");
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    require(!document.querySelector('#app-popover'), "Escape closes the menu");
    opener.click();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        try {
          if (document.querySelector('#app-popover')) {
            require(labels().join('|') === shown.join('|'), `the ⋯ gives the same menu: ${shown.join(' | ')} versus ${labels().join(' | ')}`);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            resolve({ check: name, items: shown, left: box.left, top: box.top, pointer: at ?? null });
          } else if (Date.now() - started > 1500) require(false, "a click on the ⋯ opens a menu too");
          else setTimeout(poll, 50);
        } catch (error) { reject(error); }
      };
      poll();
    });
  }
  if (name === "home-month") {
    const calendar = document.querySelector('.ho-calendar'), grid = calendar.querySelector('.ho-month');
    require(calendar.scrollHeight <= calendar.clientHeight + 1 && grid.scrollHeight <= grid.clientHeight + 1, 'the full month has no inner scroll or clipped week');
    require(grid.querySelectorAll('.ho-day').length === 42 && grid.querySelectorAll('.ho-weekday').length === 7, 'the month has six weeks and seven weekday initials');
    require(calendar.querySelectorAll('.ho-month-actions .btn.icon').length === 2, 'previous and next month are real icon buttons');
    require(!document.querySelector('.au-page:not([hidden])'), 'changing month retains Home');
    const adjacent = grid.querySelector('.ho-other-month .ho-date-btn');
    require(getComputedStyle(adjacent).color !== getComputedStyle(grid.querySelector('.ho-day:not(.ho-other-month) .ho-date-btn')).color, 'neighbouring month days are dimmed');
    const expanded = getComputedStyle(calendar).getPropertyValue('--home-calendar-expanded').trim() === '1';
    const frame = calendar.parentElement.getBoundingClientRect();
    require(expanded === (frame.width >= 900 && frame.height >= 460), 'the available container width and height choose the mode automatically');
    const bounds = calendar.getBoundingClientRect();
    const controls = [...calendar.querySelectorAll(':scope > header, [data-home-month], [data-home-today]')].map(node => {
      const box = node.getBoundingClientRect(); return [box.x - bounds.x, box.y - bounds.y, box.width, box.height];
    });
    const prior = window.__homeMonthBounds;
    if (prior?.width === frame.width && prior.height === frame.height) require(JSON.stringify(controls) === JSON.stringify(prior.controls), 'month changes preserve the header and control positions');
    window.__homeMonthBounds = {width:frame.width,height:frame.height,controls};
    const agenda = calendar.querySelector('.ho-agenda');
    require(expanded ? !visible(agenda) : visible(agenda), 'only compact mode shows the selected-day list');
    if (!expanded && !agenda.querySelector('.ho-agenda-row')) require(agenda.querySelectorAll('.ho-day-empty').length === 1 && agenda.querySelector('.ho-day-empty').textContent.trim(), 'an empty selected day has one quiet line');
    require(calendar.querySelectorAll('[data-home-today]').length === 1, 'Today keeps its fixed place beside both arrows');
    if (expanded) require([...calendar.querySelectorAll('.ho-day')].every(day => [...day.querySelectorAll('.ho-event-chip')].filter(visible).length <= (frame.height >= 600 ? 3 : 2)), 'each full-month day shows only the available two or three chips');
    return {check:name, month:calendar.dataset.month, expanded, width:frame.width, height:frame.height};
  }
  if (name === "home-calendar-day") {
    require(document.querySelectorAll('.au-day-col').length === 1 && !!document.querySelector('.au-day-col[data-day="2026-10-30"]'), "the month opens the exact selected day in the full calendar");
    return {check:name};
  }
  if (name === "home-overview") {
    for (const panel of document.querySelectorAll('.page-home .ho-card, .page-home .ho-card *')) {
      const style = getComputedStyle(panel);
      require(!['auto', 'scroll'].includes(style.overflowY) || panel.scrollHeight <= panel.clientHeight + 1, `Home has no scrolling inner panels: ${panel.className}`);
    }
    const home = document.querySelector('.page-home:not([hidden])');
    for (const card of home.querySelectorAll('.ho-card')) require(card.scrollHeight <= card.clientHeight + 1, `Home block content fits its stable size: ${card.className}`);
    for (const bars of home.querySelectorAll('.ho-bars')) require([...bars.querySelectorAll('rect')].some(rect => Number(rect.getAttribute('height')) > 2), "Home never draws a flat zero chart");
    require(![...home.querySelectorAll('.ho-big, .ho-meter-row b')].some(node => /^[—–-]$/.test(node.textContent.trim())), "Home never presents a lone dash as a stat");
    const emblem = home?.querySelector('.ho-hero > .av');
    require(visible(emblem) && emblem.getBoundingClientRect().width >= 60, "Raphael's emblem is large on Home");
    require(!!home.querySelector('h1.ho-said'), "Raphael reports in the page headline");
    require(!home.querySelector('.ho-hero [data-home-go="agent"], .ho-ask'), "the hero has no ask-Raphael icon: Raphael is asked on his own page");
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pictures = [...emblem.querySelectorAll('img')].map(image => image.getAttribute('src'));
    require(pictures.length === 2 && pictures.every(src => /-loop\.webp$/.test(src) !== reduced), reduced ? "under reduced motion Raphael's emblem is his still picture" : "Raphael's emblem is the turning loop");
    require(!home.querySelector('.ho-pending [data-home-item^="routine:"], .ho-pending [data-home-item^="report:"]'), "Pending lists only what waits for the owner");
    for (const card of home.querySelectorAll('.ho-card')) require(visible(card.querySelector(':scope > header .ho-open')), "every card opens its details from an icon");
    require(document.querySelector('#nav [data-go][aria-current="page"]')?.dataset.go === "home", "Home is the selected rail destination");
    require(document.querySelector('#nav .sidebar-foot-row [data-go="home"]'), "Home sits beside the owner");
    for (const chart of home.querySelectorAll('.ho-bars')) require(chart.getAttribute('aria-label'), "charts have an accessible description");
    // Each page is named on one line in the sidebar, at every width: 連結應用程式 and its number must fit the narrow sidebar too.
    for (const label of document.querySelectorAll('#nav .nav .nav-t')) if (visible(label))
      require(label.getBoundingClientRect().height < (parseFloat(getComputedStyle(label).lineHeight) || 20) * 1.5, `"${label.textContent}" does not fit on one line in the sidebar`);
    return { check: name, items: home.querySelectorAll('[data-home-item]').length, width: home.clientWidth };
  }
  if (name === "home-emblem-motion") {
    // The loop plays by itself, which a canvas cannot show (it draws the first frame), so the check is that the page
    // asks for the loop, and that what it asks for is an animation: its RIFF holds an ANIM header and many frames.
    const picture = [...document.querySelectorAll('.page-home:not([hidden]) .ho-hero > .av img')].find(visible);
    require(!matchMedia('(prefers-reduced-motion: reduce)').matches, "this scene runs with motion allowed");
    require(picture && /app-emblem-(?:light|dark)-loop\.webp$/.test(picture.getAttribute('src')), "Raphael's emblem on Home is the turning loop when motion is allowed");
    require(!document.querySelector('.page-home .ho-hero [data-home-go="agent"]'), "the hero has no ask-Raphael icon");
    return fetch(picture.getAttribute('src')).then(response => response.arrayBuffer()).then(buffer => {
      const view = new DataView(buffer), tag = at => String.fromCharCode(...new Uint8Array(buffer, at, 4));
      require(tag(0) === 'RIFF' && tag(8) === 'WEBP', "the loop is a WebP picture");
      let frames = 0, milliseconds = 0, animated = false;
      for (let at = 12; at + 8 <= buffer.byteLength; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1)) {
        if (tag(at) === 'ANIM') animated = true;
        if (tag(at) === 'ANMF') { frames++; milliseconds += view.getUint8(at + 8 + 12) | view.getUint8(at + 8 + 13) << 8 | view.getUint8(at + 8 + 14) << 16; }
      }
      require(animated && frames > 24 && milliseconds >= 2000, `the loop is an animation of many frames: ${frames} frames, ${milliseconds} ms`);
      return { check: name, frames, milliseconds };
    });
  }
  if (name === "home-report") {
    require(window.__look.calls.some(call => call.method === "agent.history.list" && call.params.member_id === 1), "Reported member history was requested");
    require(visible(document.querySelector('.tn[data-id="2"]')), "The reported turn is rendered");
    require(window.__look.calls.some(call => call.method === "agent.history.list" && call.params.conversation_id === 11 && call.params.around_id === 2), "The reported conversation was loaded around its exact turn");
    return { check: name, turnId: 2, memberId: 1 };
  }
  if (name === "calendar-all-day") {
    require(visible(document.querySelector('.au-all-day-event')), "all-day events remain in the pinned header");
    return { check: name };
  }
  if (name === "calendar-shell") {
    const grid = document.querySelector('.au-page:not([hidden]) .au-calendar-scroll'), side = document.querySelector('.au-page:not([hidden]) .au-calendar-side');
    require(visible(grid), "the calendar grid is visible");
    const hour = grid.querySelector('.au-slot').getBoundingClientRect().height;
    const header = grid.querySelector('.au-grid-head').getBoundingClientRect();
    require(hour <= 54 && hour * 11 <= grid.clientHeight - header.height + 1, "eleven working hours fit the calendar viewport without a long vertical scroll");
    require(visible(grid.querySelector('.au-all-day')), "the all-day row stays at the top of the calendar");
    require(grid.scrollWidth <= grid.clientWidth + 1, "the calendar never scrolls horizontally");
    const box = grid.getBoundingClientRect(), columns = [...grid.querySelectorAll('.au-day-col')];
    for (const column of columns) {
      const day = column.getBoundingClientRect();
      require(day.left >= box.left && day.right <= box.left + grid.clientWidth + 1, "every day fits inside the calendar viewport");
    }
    require(!document.querySelector('.au-page [data-view]'), "the calendar has no list view");
    require(document.querySelector('#nav [data-go][aria-current="page"]')?.dataset.go === "home", "the calendar belongs to Home in the rail");
    require(!document.querySelector('#nav .nav[data-go="automations"]'), "the rail has no automations entry");
    const compact = grid.closest('.au-page').clientWidth <= 760;
    require(visible(side) !== compact, "the month and members remain visible at 1120px; compact tools start below 760px content width");
    require(visible(document.querySelector('[data-au="tools"]')) === compact, "compact calendar tools have a toolbar icon");
    if (visible(side)) {
      require(side.getBoundingClientRect().left >= grid.getBoundingClientRect().right - 1, "the month and members sit on the right");
      for (const day of side.querySelectorAll('.au-month-grid > span')) {
        require(getComputedStyle(day).whiteSpace === "nowrap" && day.scrollWidth <= day.clientWidth + 1, "month weekday labels fit on one line");
      }
    }
    return { check: name, side: visible(side), days: columns.length, clientWidth: grid.clientWidth, scrollWidth: grid.scrollWidth };
  }
  if (name === "calendar-tools" || name === "calendar-tools-awake") {
    const panel = [...document.querySelectorAll('.au-calendar-side')].find(visible);
    require(panel && visible(panel.querySelector('[data-au="awake"]')) && visible(panel.querySelector('[data-drag-member]')), "month, members and keep-awake remain available");
    const weekdays = [...panel.querySelectorAll('.au-month-grid > span')];
    require(weekdays.map(day => day.textContent).join(' ') === '一 二 三 四 五 六 日', "mini month uses single-character weekdays");
    for (const day of weekdays) require(day.scrollWidth <= day.clientWidth + 1, "mini month weekdays fit");
    const popover = document.querySelector('.au-calendar-tools');
    if (popover) {
      const box = popover.getBoundingClientRect();
      require(box.left >= 8 && box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8, "calendar tools fit inside the viewport");
    }
    if (name === "calendar-tools-awake") {
      require(panel.querySelector('[data-au="awake"]').getAttribute('aria-checked') === 'true', "keep-awake persists after redrawing the tools");
      require(window.__look.calls.some(call => call.command === 'schedule_keep_awake_set' && call.enabled), "keep-awake reaches the native boundary");
    }
    return { check: name, popover: !!popover, weekdays: weekdays.map(day => day.textContent) };
  }
  if (name === "admin-approval" || name === "admin-approval-long" || name === "admin-approval-batch") {
    const card = [...document.querySelectorAll('.ask-card')].find(visible);
    require(card, "approval card is visible");
    const details = card.querySelector('.ask-q'), yes = card.querySelector('.ask-yes'), no = card.querySelector('.ask-no');
    const box = card.getBoundingClientRect();
    require(box.top >= 0 && box.bottom <= innerHeight, "complete card fits the viewport");
    require(visible(yes) && visible(no), "both approval actions remain visible");
    require(yes.getBoundingClientRect().right <= box.right && yes.getBoundingClientRect().bottom <= innerHeight, "approval action fits the card");
    require(no.getBoundingClientRect().right <= yes.getBoundingClientRect().left, "primary action stays rightmost");
    if (name === "admin-approval-batch") {
      const text = details.textContent;
      for (const member of ["COO", "PM", "RD", "CEO", "CTO", "Marketing", "Finance", "Design"]) {
        require(text.includes("名稱：" + member), "all eight names are preserved");
      }
      require((text.match(/職責：/g) || []).length === 8 && (text.match(/簡介：/g) || []).length === 8 && (text.match(/群組：/g) || []).length === 8, "every member includes role, blurb and group");
      require(!text.includes(": "), "Chinese field labels use full-width colons");
      require(document.querySelectorAll('.ask-card:not([hidden])').length === 1, "one card covers the whole batch");
    }
    if (name.endsWith("long") || name.endsWith("batch")) {
      if (name.endsWith("long")) require(details.textContent.includes("最後一項指示：保留完整決策紀錄。"), "full instructions are preserved");
      require(["auto", "scroll"].includes(getComputedStyle(details).overflowY), "long details can scroll");
      require(getComputedStyle(details).whiteSpace === "pre-wrap", "field line breaks remain readable");
      require(details.tabIndex === 0, "details can receive keyboard focus for scrolling");
      require(details.scrollTop > 0 && details.scrollTop + details.clientHeight >= details.scrollHeight - 1, "End key reveals the final instructions");
      require(yes.getBoundingClientRect().top >= details.getBoundingClientRect().bottom, "actions remain below the full-width details");
    }
    return { check: name, height: box.height, detailsHeight: details.clientHeight, contentHeight: details.scrollHeight };
  }
  if (name === "member-draft" || name === "member-draft-edit") {
    const panel = [...document.querySelectorAll('.draft-panel')].find(visible);
    require(panel, "draft panel is visible");
    require(!document.querySelector('.ask-card:not([hidden])'), "plain ask card is hidden when draft panel is shown");
    const box = panel.getBoundingClientRect();
    require(box.top >= 0 && box.bottom <= innerHeight, "draft panel fits the viewport");
    const cards = [...panel.querySelectorAll('.draft-card')].filter(visible);
    const confirmBtn = panel.querySelector('[data-draft-act="confirm"]');
    const cancelBtn = panel.querySelector('[data-draft-act="cancel"]');
    require(visible(confirmBtn) && visible(cancelBtn), "confirm and cancel buttons are visible");
    require(cancelBtn.getBoundingClientRect().right <= confirmBtn.getBoundingClientRect().left, "primary action stays rightmost");
    for (const card of cards) {
      const roleInput = card.querySelector('[data-draft-field="role"]');
      const nameInput = card.querySelector('[data-draft-field="name"]');
      const groupBtn = card.querySelector('[data-draft-act="group"]');
      const roleStyle = getComputedStyle(roleInput);
      const roleContentWidth = roleInput.clientWidth - parseFloat(roleStyle.paddingLeft) - parseFloat(roleStyle.paddingRight);
      const roleFontSize = parseFloat(roleStyle.fontSize);
      require(roleContentWidth >= roleFontSize * 8, `role field fits at least 8 CJK characters (${roleContentWidth}px vs ${roleFontSize * 8}px)`);
      require(roleInput.scrollWidth <= roleInput.clientWidth + 1, `role value is not clipped (${roleInput.value})`);
      require(nameInput.clientWidth >= roleFontSize * 4.5, "name field has enough width");
      require(groupBtn.getBoundingClientRect().width < roleInput.getBoundingClientRect().width, "group dropdown is narrower than role field");
    }
    if (name === "member-draft") {
      require(cards.length === 3, "three member draft cards are shown");
      require(confirmBtn.textContent.trim() === "建立 3 位成員", "primary button shows three members to create");
      const names = cards.map(c => c.querySelector('[data-draft-field="name"]')?.value);
      require(names.join(",") === "COO,PM,RD", "all three member draft names are populated");
    } else {
      require(cards.length === 2, "removing one draft leaves two cards");
      require(confirmBtn.textContent.trim() === "建立 2 位成員", "primary button updates count to two members");
      require(cards[0].querySelector('[data-draft-field="role"]')?.value === "首席營運長", "edited role field is preserved");
    }
    return { check: name, cards: cards.length, confirmLabel: confirmBtn.textContent.trim() };
  }
  if (name === "member-draft-submitted") {
    const calls=window.__look.calls.filter(call=>call.command==='agent_question_answer');
    require(calls.length===1&&calls[0].approved&&calls[0].drafts?.length===3,'confirmation submits the edited draft once');
    const turn=window.__look.data.turns.find(turn=>turn.status==='done'&&turn.detail?.includes('COO'));
    require(turn&&turn.text.startsWith('已建立'),'native boundary persists the settled draft');
    return {check:name,turnId:turn.id,conversationId:turn.conversation_id};
  }
  if (name === "member-draft-done") {
    const done = [...document.querySelectorAll('.draft-done')].find(visible);
    require(done, "settled one-line summary is visible");
    require(!document.querySelector('.draft-panel:not([hidden])'), "draft panel is closed after confirmation");
    const sumBtn = done.querySelector('[data-act="draft-done"]');
    require(visible(sumBtn) && sumBtn.textContent.includes("已建立 COO、PM、RD"), "settled summary lists created members");
    const list = done.querySelector('.draft-done-list');
    require(visible(list) && list.querySelectorAll('.draft-done-item').length === 3, "expanded summary shows created member details");
    const members = window.__look.data.members;
    for (const createdName of ["COO", "PM", "RD"]) {
      require(members.some(m => m.name === createdName), `${createdName} was added to members`);
    }
    const column = document.querySelector(".mb-col");
    if (visible(column)) {
      const colText = column.textContent + " " + [...column.querySelectorAll("[aria-label]")].map(el => el.getAttribute("aria-label")).join(" ");
      for (const createdName of ["COO", "PM", "RD"]) {
        require(colText.includes(createdName), `${createdName} appears in the left member column`);
      }
    }
    return { check: name, summary: sumBtn.textContent.trim(), members: members.length };
  }
  if (name === "admin-created" || name === "admin-denied") {
    const calls = window.__look.calls, members = window.__look.data.members;
    require(calls.some(call => call.command === "agent_question_answer" && call.approved === (name === "admin-created")), "owner answer reaches the native boundary");
    require(members.some(member => member.id === 8) === (name === "admin-created"), "team reflects the owner's decision");
    if (name === "admin-created") {
      const details = [...document.querySelectorAll('.mb-det')].find(visible);
      require(details?.querySelector('.mb-who-name')?.value === "COO", "created member details are selected");
      require(details.querySelector('.mb-who-role')?.value === "營運長", "created role is shown");
      const created = members.find(member => member.id === 8);
      require(window.__look.data.groups.find(group => group.id === created.group_id)?.name === "個人公司", "member joins the approved group");
      require(created.preview === "" && created.last_at === null, "new conversation has no inherited activity");
      require(details.querySelector('.mb-av-slime svg'), "a member without a preset is a slime");
    }
    return { check: name, members: members.length };
  }
  if (name === "page-card") {
    const card = document.querySelector(".pg-card"), frame = card?.querySelector("iframe");
    require(frame?.getAttribute("sandbox") === "allow-scripts allow-forms", "the page runs sandboxed with an opaque origin");
    require(card.querySelector(".pg-body").dataset.state === "ready", "the page has loaded");
    const height = frame.getBoundingClientRect().height;
    require(height >= 180 && height !== 320, `the page is as tall as its content, not the reserved height: ${height}`);
    const line = card.closest(".tn, [data-key]").getBoundingClientRect(), box = card.getBoundingClientRect();
    require(box.left >= line.left && box.right <= line.right + 1, "the page stays inside the reply");
    return { check: name, height };
  }
  if (name === "page-spoke") {
    const asked = window.__look.calls.filter(call => call.command === "agent_ask_text");
    require(asked.length === 1 && JSON.stringify(asked[0]).includes("把輕量後背包加入購物車"), "the press became the owner's one next message");
    return { check: name };
  }
  if (name === "page-expanded") {
    const frame = document.querySelector(".pg-view iframe")?.getBoundingClientRect();
    require(frame && frame.width >= Math.min(1100, innerWidth * 0.6) && frame.height > innerHeight * 0.6, "the same page fills the large dialog");
    require(!document.querySelector(".pg-card .pg-body iframe"), "there is one frame, moved, not a second one");
    return { check: name };
  }
  if (name === "page-gone") {
    const failed = document.querySelector(".pg-failed");
    require(failed && !failed.hidden && failed.textContent.includes("NT$ 1,280"), "it says what it knows of the page");
    require(failed.querySelector('[data-page-act="retry"]'), "and offers to try again");
    require(document.querySelector(".pg-body").hidden, "no empty box is left");
    return { check: name };
  }
  if (name === "slime-states") {
    const face = id => document.querySelector(`.mb-row[data-member="${id}"] svg.slime`);
    const wanted = { 1: ["thinking", "slime-thinking-body"], 2: ["working", "slime-working-body"], 3: ["computer", "slime-computer-body"] };
    for (const [id, [state, animation]] of Object.entries(wanted)) {
      const svg = face(id);
      require(svg?.dataset.state === state, `member ${id} shows ${state}, not ${svg?.dataset.state}`);
      require(svg.getAnimations({ subtree: true }).some(running => running.animationName === animation && running.playState === "running"), `member ${id} is really moving as ${state}`);
      const eye = getComputedStyle(svg.querySelector(".slime-eye-l path"));
      require(eye.stroke === "rgb(255, 255, 255)" && eye.d.startsWith("path("), "its eyes are the white bent paths");
    }
    require(getComputedStyle(face(2).querySelector(".slime-eye-l path")).strokeWidth === "4.5px", "working narrows its eyes");
    const rows = [...document.querySelectorAll(".mb-row svg.slime")];
    require(rows.length >= 3 && rows.every(svg => svg.getAnimations({ subtree: true }).length > 0), "every slime in the list is alive");
    for (const svg of rows) {
      const box = svg.getBoundingClientRect(), row = svg.closest(".mb-row").getBoundingClientRect();
      require(box.top >= row.top - 1 && box.bottom <= row.bottom + 1, "a slime stays inside its row");
    }
    return { check: name, rows: rows.length };
  }
  if (name === "slime-picker") {
    const menu = document.querySelector(".mb-avpop");
    require(menu && menu.querySelector('[data-slime-shape="oni"]').getAttribute("aria-pressed") === "true", "the menu stays open on the chosen shape");
    require(menu.querySelector('[data-slime-color="coral"]').getAttribute("aria-pressed") === "true", "and on the chosen colour");
    require(menu.querySelectorAll('[aria-pressed="true"]').length === 2, "nothing else looks chosen");
    require(window.__look.data.members.find(row => row.id === 1)?.avatar === "slime:oni:coral", "the member keeps both");
    return { check: name };
  }
  if (name === "conversation-picker") {
    const list = document.querySelector("#app-popover .conversation-menu-list");
    require(visible(list), "conversation list is visible");
    require(list.scrollWidth <= list.clientWidth + 1, `list overflows: ${list.scrollWidth} > ${list.clientWidth}`);
    const button = list.querySelector("[data-conversation-new]"), box = button.getBoundingClientRect(), parent = list.getBoundingClientRect();
    require(box.left >= parent.left && box.right <= parent.right + 1, "new conversation button fits inside the list");
    return { check: name, width: list.clientWidth, scrollWidth: list.scrollWidth };
  }
  if (name === "apps-count") {
    const tab = document.querySelector('.modal-scrim [data-conn="tab"][data-id="installed"] .n');
    require(visible(tab) && !document.querySelector('.nav-apps'), "Settings alone contains the connected app count");
    const rows = document.querySelectorAll('.modal-scrim .cs-body [data-stagger="installed"] > .cs-item').length;
    return window.__TAURI_INTERNALS__.invoke("core_call", {method:"members.list",params:{}}).then(({team_context:roster})=>{
      require(String(roster.connected) === tab.textContent.trim() && rows === roster.connected, "Settings count agrees with the shared roster and installed rows");
      return {check:name,count:roster.connected,apps:roster.apps.length};
    });
  }
  if (name === "apps-unreadable") {
    const tab=document.querySelector('.modal-scrim [data-conn="tab"][data-id="installed"] .n');
    require(visible(tab) && tab.textContent.trim() === "—", "Settings states an unknown count without inventing a number");
    return window.__TAURI_INTERNALS__.invoke("core_call",{method:"members.list",params:{}}).then(({team_context:roster})=>{
      require(roster.connected === null && roster.inventory_state !== "complete", "the roster states no number either");
      return {check:name,state:roster.inventory_state};
    });
  }
  if (name === "connections-dialog-actions") {
    const dialog = document.querySelector('.cs-scrim .cs-dialog');
    const buttons = [...(dialog?.querySelectorAll('.action-row button') ?? [])];
    require(visible(dialog) && buttons.length > 0, "the dialog has footer actions");
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      require(box.width > 0 && box.height > 0 && (hit === button || button.contains(hit)), `footer action "${button.textContent.trim()}" is covered by a toast or another element`);
    }
    return { check: name, buttons: buttons.length };
  }
  if (name === "connections-binary") {
    const controls = [...document.querySelectorAll('.cs [aria-checked], .cs-scrim [aria-checked]')];
    require(controls.length > 0, "connections has switches");
    require(controls.every(node => ['true', 'false'].includes(node.getAttribute('aria-checked'))), "connections switches never have a mixed or middle state");
    return { check: name, switches: controls.length };
  }
  if (name === "connector-link-refused") {
    require(document.querySelector('.cs-dialog .note[role="alert"]')?.textContent.includes('Composio 尚未允許這個應用程式登入，請重試連結。'), "a toolkit refusal has dedicated actionable copy inside the app dialog");
    require(![...document.querySelectorAll('.toast')].some(node => node.textContent.includes('Composio 尚未允許')), "the sign-in refusal never covers the dialog as a toast");
    require(window.__look.calls.some(call => call.method === 'connectors.connect' && call.params.toolkit === 'notion'), "the real managed sign-in boundary was used");
    require(!document.body.textContent.includes('ToolRouterV2_ToolkitNotAllowed'), "provider error slugs never reach the interface");
    return { check: name };
  }
  if (name === "app-switch-all") {
    const calls = window.__look.calls.filter(call => call.method?.startsWith("integrations.set_") && call.params?.id === "github");
    const server = window.__look.data.servers.find(item => item.id === "github");
    require(calls.length === 2 && calls.every(call => call.method === 'integrations.set_enabled'), "app switches only enable and disable the app");
    require(calls[0].params.enabled === false && calls[1].params.enabled === true, "app turns off then on");
    require(server.enabled && server.tools.filter(tool => !tool.enabled).length === 18, "app changes preserve the 18 tool exclusions");
    return { check: name, calls: calls.length };
  }
  if (name === "connector-folded") {
    const dialog = document.querySelector(".modal-scrim .cs-dialog");
    require(visible(dialog) && dialog.querySelectorAll('[data-conn="enable"]').length === 1, "the app's dialog has its one switch");
    require(dialog.querySelector('[data-conn="enable"]').getAttribute("aria-checked") === "true", "the app stays enabled independently of tools");
    const kinds = [...dialog.querySelectorAll('[data-conn="kind"]')];
    require(kinds.length === 2 && kinds[0].dataset.kind === 'write' && kinds[1].dataset.kind === 'read', "both kinds are reachable above the folded list");
    require(kinds[0].getAttribute('aria-checked') === 'false' && kinds[1].getAttribute('aria-checked') === 'true', "kind switches reflect their own tools only");
    require(!dialog.querySelector('[data-conn="tool"]'), "individual switches remain folded");
    require(dialog.querySelector('[data-k="cs-count"]')?.textContent.includes("30/46"), "one line says how many tools are on");
    const calls = window.__look.calls.filter(call => call.method === 'integrations.set_tools_enabled' && call.params.id === 'github');
    require(calls.length === 3 && calls[0].params.tools.length === 16 && calls[0].params.enabled && calls[1].params.tools.length === 30 && calls[1].params.enabled && !calls[2].params.enabled, "each kind changes in a single bulk RPC");
    require(!window.__look.calls.some(call => call.method === 'integrations.set_tool_enabled' || call.method === 'integrations.set_enabled'), "kind switches never rewrite the app or loop through per-tool RPCs");
    require(dialog.scrollHeight <= dialog.clientHeight + 1, "the folded dialog fits without scrolling");
    return { check: name };
  }
  if (name === "connector-tools") {
    // An app's page: the account it is signed in with, N of its M tools on with a switch for each, and its actions flush with the dialog's edge.
    const dialog = document.querySelector(".modal-scrim .cs-dialog"), switches = [...(dialog?.querySelectorAll('[data-conn="tool"]') ?? [])];
    require(visible(dialog) && switches.length > 0, "the app's page and the switches of its tools are visible");
    require(dialog.querySelectorAll(".cs-acct").length > 0, "the account it is signed in with is listed");
    const on = switches.filter(node => node.getAttribute("aria-checked") === "true").length, count = dialog.querySelector('[data-k="cs-count"]')?.textContent ?? "";
    require(count.includes(`${on}/${switches.length}`), `the page says "${count}" while ${on} of ${switches.length} tools are on`);
    const acts = dialog.querySelector(".action-row.is-sticky"), box = acts.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
    require(acts.contains(document.elementFromPoint(box.left + box.width / 2, frame.bottom - 3)), "no tool shows through under the actions");
    const calls = window.__look.calls.filter(call => call.method === 'connectors.set_tools' && call.params.id === 'composio:notion');
    require(calls.length === 4 && calls.every(call => !('enabled' in call.params)), "managed kind switches only update disabled_tools");
    require(calls[0].params.disabled_tools.length === 3 && calls[1].params.disabled_tools.length === 0 && calls[2].params.disabled_tools.length === 6 && calls[3].params.disabled_tools.length === 0, "write and read permissions change independently and return on");
    return { check: name, on, tools: switches.length };
  }
  if (name === "skill-page") {
    const dialog = document.querySelector(".modal-scrim .cs-dialog.wide"), text = dialog?.querySelector("#skill-text");
    require(visible(dialog) && visible(text), "the page of a skill and its document are visible");
    const acts = [...dialog.querySelectorAll(".action-row > *")].flatMap(node => node.matches("button") ? [node] : [...node.querySelectorAll("button")]);
    const del = dialog.querySelector('[data-conn="skill-delete"]'), save = dialog.querySelector('[data-conn="skill-save"]');
    require(acts.indexOf(del) === 0 && acts.at(-1) === save, "delete is first and save is last in the action row");
    require(text.value.startsWith("---") && /\nname: [^\n]+\ndescription: [^\n]+\n---/.test(text.value), "the document is shown whole, from its first line");
    const box = text.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
    require(box.left >= frame.left && box.right <= frame.right, "the document sits inside its dialog");
    require(text.scrollWidth <= text.clientWidth + 1, "the document does not scroll sideways");
    require(dialog.querySelector('[data-cs-notice][role="status"]')?.textContent.includes('已儲存技能'), "save feedback stays inside the skill dialog");
    require(![...document.querySelectorAll('.toast')].some(node => node.textContent.includes('已儲存技能')), "skill saving never covers the dialog as a toast");
    require(text.scrollTop === 0, `the document starts at its first line, not ${text.scrollTop}px down (${text.clientHeight}px box, ${text.scrollHeight}px of text)`);
    return { check: name, rows: text.rows, chars: text.value.length, box: text.clientHeight, text: text.scrollHeight };
  }
  if (name === "settings-shell") {
    const modal = document.querySelector(".modal"), close = modal?.querySelector(".modal-x");
    require(visible(modal) && visible(close), "settings and its close control are visible");
    require(getComputedStyle(modal).borderTopLeftRadius === "12px", "settings uses the dialog radius rather than a pill");
    const box = close.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    require(close === hit || close.contains(hit), "rounded corners do not clip the close control");
    return { check: name, radius: getComputedStyle(modal).borderTopLeftRadius };
  }
  if (name === "dictation-navigation") {
    const nav = document.querySelector(".dictation-nav"), tabs = [...nav.querySelectorAll('[role="tab"]')];
    const active = tabs.filter(tab => tab.getAttribute("aria-selected") === "true");
    require(nav.getAttribute("aria-orientation") === "horizontal" && active.length === 1, "one selected horizontal tab");
    const panel = document.getElementById(active[0].getAttribute("aria-controls"));
    require(visible(panel) && !panel.hidden, "selected navigation displays its panel");
    const navBox = nav.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
    require(navBox.bottom < panelBox.top, "tabs remain above the content");
    for (let i = 1; i < tabs.length; i++) require(tabs[i].getBoundingClientRect().left >= tabs[i - 1].getBoundingClientRect().right, "tabs form a horizontal row");
    require(panel.scrollWidth <= panel.clientWidth + 1, "selected content fits its column");
    return { check: name, selected: active[0].dataset.dictationTab, panelWidth: panel.clientWidth };
  }
  if (name === "dictation-overview") {
    const cards = [...document.querySelectorAll('.page-overview .icard')];
    require(cards.length === 4, "four independent totals are visible");
    const boxes = cards.map(card => card.getBoundingClientRect());
    const desktop = document.querySelector('.dictation-content').clientWidth >= 760;
    require(boxes[0].top === boxes[1].top && boxes[2].top > boxes[0].bottom && boxes[2].top === boxes[3].top, "totals keep two by two rows at every width");
    for (const card of cards) require(getComputedStyle(card).borderTopWidth === '1px' && getComputedStyle(card).backgroundColor !== 'rgba(0, 0, 0, 0)', "each total has its own card surface");
    const activity = document.querySelector('.page-overview .activity').getBoundingClientRect();
    const shortcuts = document.querySelector('.page-overview .keys-card').getBoundingClientRect();
    require(activity.top >= boxes[3].bottom, "activity follows the totals");
    require(desktop ? shortcuts.left >= activity.right : shortcuts.top >= activity.bottom && Math.abs(shortcuts.width - activity.width) < 1, "compact windows order totals, full-width activity, then full-width shortcuts");
    require(document.querySelector('.heat rect.h1, .heat rect.h2, .heat rect.h3, .heat rect.h4').getBoundingClientRect().width >= 17, "activity days retain larger readable cells");
    return { check: name, desktop, cardWidth: boxes[0].width };
  }
  if (name === "conversation-design") {
    const bubble = document.querySelector(".bubble"), answer = document.querySelector('[data-reply] > .ans');
    for (const element of [bubble, answer]) {
      require(visible(element), "owner and assistant messages are visible");
      const style = getComputedStyle(element);
      require(style.fontSize === "15px" && style.lineHeight === "24px", "messages use 15px type at 1.6 line height");
      require(style.borderTopLeftRadius === "12px", "messages use the shared card radius");
    }
    require(getComputedStyle(answer).borderTopWidth === "0px", "assistant bubble has no decorative border");
    plainWords();
    const column = document.querySelector(".mb-col");
    if (visible(column)) {
      const rows = [...column.querySelectorAll(".mb-row[data-member]")], first = rows[0];
      require(first.dataset.member === "0", "Raphael is first");
      if (!column.classList.contains("is-collapsed")) {
        require(Math.abs(first.querySelector(".av").getBoundingClientRect().width - 40) < 1, "the chief shares the conversation avatar size");
        for (const row of rows.slice(1)) require(Math.abs(row.querySelector(".av").getBoundingClientRect().width - 40) < 1, "other members share 40px faces");
      }
    }
    return { check: name, sidebarVisible: visible(column), fontSize: getComputedStyle(bubble).fontSize };
  }
  if (name === "member-column") return checkRendered("sidebar-shell");
  // Primary is a display position; the room's coordinator remains identity 0.
  if (name === "primary-menu") {
    const menu = document.querySelector('#app-popover');
    require(visible(menu), "the member's menu is open");
    const items = [...menu.querySelectorAll('[data-pick]')], picks = items.map(item => item.dataset.pick), row = items[picks.indexOf('primary')];
    require(row && picks.indexOf('primary') === picks.indexOf('move') + 1 && picks.filter(pick => pick === 'primary').length === 1, "設為主要 is one item, right after 移到分組");
    require(visible(row.querySelector('.ck svg.i')) && row.textContent.trim() !== "" && !row.classList.contains('danger'), "the primary action keeps its label and a non-star icon");
    const box = menu.getBoundingClientRect();
    require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the menu is inside the viewport");
    require(window.__look.calls.every(call => call.method !== "members.set_primary"), "opening the menu sets nothing");
    require(!document.querySelector('.mb-star'),'no member carries a star');
    return { check: name, items: picks.length };
  }
  if (name.startsWith("primary-")) {
    const data = window.__look.data, calls = window.__look.calls;
    const sets = calls.filter(call => call.method === "members.set_primary");
    const column = document.querySelector('.mb-col');
    require(!document.querySelector('.mb-star'),'no member carries a star');
    const order = nodes => [...nodes].map(node => Number(node.dataset.member ?? node.dataset.id ?? node.dataset.value ?? node.dataset.dragMember));
    const swapped = ids => {
      const result = [...ids], chief = result.indexOf(0), primary = result.indexOf(data.primaryId);
      if (chief >= 0 && primary >= 0) [result[chief], result[primary]] = [result[primary], result[chief]];
      return result;
    };
    const columnSwap = () => {
      const rows = [...column.querySelectorAll('.mb-list [data-member]')];
      require(Number(rows[0].dataset.member) === data.primaryId, "the primary occupies the column's top slot");
      require(rows.filter(row => row.dataset.member === '0').length === 1, "Raphael appears exactly once");
      require(column.querySelector('[data-member="0"] .av') && !column.querySelector('[data-member="0"] .mb-av'), "Raphael keeps his emblem in the exchanged slot");
      require(column.querySelector('.mb-sec [data-member="0"]') || data.primaryId === 0 || column.classList.contains('is-collapsed'), "Raphael takes the primary's group slot");
      return order(rows);
    };
    if (name === "primary-picker") {
      const dialog = document.querySelector('.mb-dialog.mb-primary-picker');
      require(visible(dialog), "the picker window is open");
      require(dialog.querySelector('h2').textContent.trim() !== "" && dialog.querySelector('h2').textContent === dialog.querySelector('[role="radiogroup"]').getAttribute('aria-label'), "it is titled 選擇主要成員, and its list is named by the title");
      const choices = [...dialog.querySelectorAll('[role="radio"]')];
      require(choices.length >= 3 && choices.every(button => button.tagName === 'BUTTON' && visible(button)), "the members are real buttons");
      require(!dialog.querySelector('select, input[type=radio], input[type=checkbox]'), "no native controls");
      require(data.primaryId === 1 && choices.some(button => button.dataset.id === '0') && !choices.some(button => button.dataset.id === '1'), "小晴 is the primary now and is not offered, and Raphael can be chosen again");
      const picked = choices.filter(button => button.getAttribute('aria-checked') === 'true');
      require(picked.length === 1 && visible(picked[0].querySelector('svg.i')), "one member is chosen, and it carries a check");
      const set = dialog.querySelector('[data-dlg="set"]'), actions = [...dialog.querySelectorAll('.mb-dlg-act .btn')];
      require(!set.disabled && set.classList.contains('pri'), "設為主要 is the enabled primary action");
      require(actions.at(-1) === set && actions.at(-2)?.dataset.dlg === 'cancel', "the primary action is rightmost and 取消 is just left of it");
      const box = dialog.getBoundingClientRect();
      require(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, "the window is inside the viewport");
      for (const button of choices) {
        const b = button.getBoundingClientRect();
        require(b.left >= box.left && b.right <= box.right && b.height >= 40, `${button.textContent.trim()} is a whole row inside the window`);
      }
      require(sets.length === 0 && data.primaryId === 1, "nothing is set before 設為主要 is pressed");
      return { check: name, choices: choices.length, picked: picked[0].dataset.id };
    }
    if (name === "primary-member-picker" || name === "primary-conversation-picker") {
      const rows = document.querySelectorAll(name === 'primary-member-picker' && !document.querySelector('.mb-chat-picker') ? '#app-popover [data-value]' : '.mb-chat-choices [data-dlg="conversation"]');
      require(JSON.stringify(order(rows)) === JSON.stringify(swapped(data.members.filter(m => !m.hidden).map(m => m.id))), "picker exchanges only Raphael and the primary");
      require(sets.length === 0, "opening a picker sets nothing");
      return { check: name, members: order(rows) };
    }
    if (name === "primary-mentions") {
      const rows = [...document.querySelectorAll('#app-popover[data-team-mentions] [data-value]')].slice(1, data.members.length + 1);
      const expected = swapped(data.members.map(m => m.id)).map(id => data.members.find(m => m.id === id).name);
      require(JSON.stringify(rows.map(row => row.dataset.value)) === JSON.stringify(expected), "mentions swap member order without changing names");
      return { check: name, members: expected };
    }
    if (name === "primary-room-picker" || name === "primary-routine-picker" || name === "primary-calendar") {
      const rows = [...document.querySelectorAll(name === 'primary-calendar' ? '[data-drag-member]' : '[data-dlg="member"]')].filter(visible);
      require(JSON.stringify(order(rows)) === JSON.stringify(swapped(data.members.map(m => m.id))), "member choices exchange only the primary and Raphael");
      if (name === 'primary-room-picker') {
        const chief = document.querySelector(`[data-dlg="member"][data-member="${data.primaryId}"]`);
        require(chief.disabled && chief.getAttribute('aria-pressed') === 'true', "the current chief is required");
        const picked = document.querySelector('[data-picked]');
        if (picked) {
          const expected = [...rows].filter(row => row.getAttribute('aria-pressed') === 'true').map(row => data.members.find(m => m.id === Number(row.dataset.member)).name);
          require(JSON.stringify([...picked.children].map(chip => chip.textContent)) === JSON.stringify(expected), "selected member chips retain the exchanged order after a click");
        }
      }
      if (name === 'primary-routine-picker') require(document.querySelector('[data-dlg="member"][data-member="0"]').getAttribute('aria-pressed') === 'true', "routine selection does not follow the display swap");
      return { check: name, members: order(rows) };
    }
    if (name === "primary-set") {
      require(sets.length === 1 && sets[0].params.id === 1 && data.primaryId === 1, "one boundary call chose 小晴 and nothing else");
      require(!document.querySelector('.mb-dialog'), "the window closed");
      require(!calls.some(call => /^(rooms|routines|worker|agent)\./.test(call.method ?? '') && /(update|create|delete|rerun|cancel|ask|stop)/.test(call.method)), "no room, routine, task or conversation was touched");
      const members = visible(column) ? columnSwap() : [];
      require(visible(document.querySelector('.mb-det .mb-who-face')), "the selected member's details remain available without a star");
      return { check: name, members };
    }
    require(sets.length === 0, "this scene only displays the existing primary");
    const members = visible(column) ? columnSwap() : [];
    if (name === "primary-column") return { check: name, members };
    const room = data.rooms[0], faces = [...document.querySelectorAll('.au-room-heading .au-room-participant')];
    require(room.member_ids.includes(0) && faces.length === room.member_ids.length, "every room member is still present");
    const crowned = faces.filter(face => face.querySelector('.au-room-crown'));
    require(crowned.length === 1 && crowned[0] === faces[0], "only the current chief wears the crown");
    require(data.members.find(m => m.id === data.primaryId).name === faces[0].dataset.tooltip.split(' · ')[0], "the room's face list follows primary display order");
    const card = document.querySelector('.au-room-wrapup');
    require(visible(card) && card.querySelector('.ra-face'), "the current chief writes the wrap-up");
    require(document.querySelectorAll('.au-room-wrapup').length === 1 && (document.querySelector('.au-room-thread .tn:last-child .au-room-wrapup') || document.querySelector('.au-room-thread .tn:last-child.au-room-wrapup')), "the room ends with one wrap-up");
    return { check: name, crowned: crowned[0].dataset.tooltip, members };
  }
  if (name === "usage-allowance-link") {
    const heading = document.querySelector(".run-allowance h3");
    require(document.activeElement === heading, "subscription link moves keyboard focus to allowances");
    require(document.querySelectorAll(".run-subscription").length === 3, "all subscription allowances remain available");
    return { check: name, heading: heading.textContent };
  }
  if (name === "usage-bill-breakdown") {
    const bill = document.querySelector(".run-bill-total");
    require(Number(bill.dataset.billTotal) === window.__look.data.status.spend.month_usd, "month bill uses the sidebar ledger total");
    require(document.querySelectorAll("[data-bill-purpose]").length === 5, "all four purposes and unknown spend are included");
    require(document.querySelector(".run-exclusions").textContent.includes("Fish Audio"), "enabled Fish Audio voice is excluded explicitly");
    require(document.querySelector('[data-run-act="show-allowance"]'), "subscription exclusion links to allowances");
    return { check: name, bill: bill.textContent };
  }
  if (name === "store-toolbar-visible") {
    const pane = document.querySelector('.modal-body'), frame = pane.getBoundingClientRect();
    const strip = document.querySelector('.cs-store-groups').getBoundingClientRect();
    const controls = [document.querySelector('#conn-search'), ...[...document.querySelectorAll('.cs-store-groups button')].filter(button => {
      const box = button.getBoundingClientRect();
      return box.left >= strip.left && box.right <= strip.right;
    })];
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      require(box.top >= frame.top && box.bottom <= frame.bottom && control.contains(hit), "search and group chips stay visible while results scroll");
    }
    const results = document.querySelector('.cs-results');
    require(results && results.scrollTop > 0 && pane.scrollTop === 0, "only the catalog results scroll");
    return { check: name, scrollTop: results.scrollTop, controls: controls.length };
  }
  if (name === "connections-form-edges" || name === "connections-form-end") {
    const grid = document.querySelector('.cs-form .add-grid'), port = grid.getBoundingClientRect();
    const last = document.querySelector('#conn-limit'), edge = last.getBoundingClientRect().right;
    if (name === "connections-form-edges") {
      const add = document.querySelector('[data-k="conn-add"]'), save = document.querySelector('.add-acts [data-conn="connect"]');
      const rights = [add, save].map(button => button.getBoundingClientRect().right);
      require(rights.every(right => Math.abs(right - edge) <= 1), `header and footer actions share the form field right edge: fields ${edge}, actions ${rights.join(', ')}`);
      return { check: name, right: edge };
    }
    const footer = document.querySelector('.cs-form > .trust').getBoundingClientRect();
    for (const field of [document.querySelector('#conn-pairs').closest('.fld'), last.closest('.fld')]) {
      const box = field.getBoundingClientRect();
      require(box.top >= port.top - 1 && box.bottom <= Math.min(port.bottom, footer.top) - 16, "last fields scroll fully above the fixed footer with bottom space");
    }
    return { check: name, bottomGap: port.bottom - last.getBoundingClientRect().bottom };
  }
  if (name === "plugins-store-last-detail") {
    require(document.querySelector('.cs-page h2')?.textContent.includes('360'), "search reaches the last app's detail");
    return { check: name };
  }
  if (name === "plugins-store-empty") {
    require(visible(document.querySelector('.cs-none')) && document.querySelectorAll('.cs-card').length === 0, "empty query has a clear state and no stale rows");
    require(visible(document.querySelector('#conn-search')) && document.querySelectorAll('[data-conn="store-group"]').length === 10, "search and broad groups stay reachable");
    return { check: name };
  }
  if (["plugins-store-groups", "plugins-store-search", "plugins-store-category"].includes(name)) {
    const groups = document.querySelector('.cs-store-groups');
    const style = getComputedStyle(groups), chips = [...groups.querySelectorAll('button')];
    require(style.flexWrap === 'nowrap' && style.overflowX === 'auto' && style.scrollbarWidth === 'none', "category chips scroll on one row without a visible scrollbar");
    require(style.maskImage.includes('linear-gradient') && parseFloat(style.paddingRight) >= 16, "category overflow fades at the edge and leaves the final chip clear");
    require(chips.every(chip => Math.abs(chip.getBoundingClientRect().top - chips[0].getBoundingClientRect().top) <= 1), "every category chip shares one row");
    const rows = [...document.querySelectorAll('.cs-card')];
    const ids = rows.map(row => row.querySelector('[data-conn="open-store"]').dataset.id);
    require(new Set(ids).size === rows.length, "each app appears once");
    require(rows.length <= 42, "connected, popular and result pages keep DOM bounded");
    require(!document.querySelector('[data-k="conn-category"]'), "provider categories do not become a dropdown");
    require(document.querySelectorAll('[data-conn="store-group"]').length === 10, "nine broad groups and All are available");
    require(window.__look.calls.filter(c => c.method === 'connectors.catalog').every(c => !c.params?.search && !c.params?.category && !c.params?.cursor), "query and group changes search the complete local index");
    const pager = document.querySelector('.cs-store-pages .num');
    if (pager) require(Number(pager.textContent.split('/')[1].trim()) === Number(document.querySelector('[data-k="conn-tab:store"] .n').textContent), "store tab and pager count the same addable apps");
    if (name === "plugins-store-search") require(rows.length === 1 && rows[0].textContent.includes('360'), "search reaches the last app across groups");
    if (name === "plugins-store-category") require(document.querySelector('[data-conn="store-group"][data-id="productivity"]').getAttribute('aria-pressed') === 'true', "the chosen broad group stays pressed");
    return { check: name, rows: rows.length, ids };
  }
  if (name === "store-group-focus") {
    const groups = document.querySelector('.cs-store-groups'), chip = document.activeElement;
    require(groups?.contains(chip) && chip.matches('[data-conn="store-group"]'), "keyboard focus reaches a category chip");
    const frame = groups.getBoundingClientRect(), box = chip.getBoundingClientRect();
    require(box.left >= frame.left - 1 && box.right <= frame.right + 1 && chip.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)), "the focused category is fully visible and clickable");
    return { check: name, category: chip.dataset.id, scrollLeft: groups.scrollLeft };
  }
  if (name === "store-group-end") {
    const groups = document.querySelector('.cs-store-groups'), frame = groups.getBoundingClientRect();
    const last = groups.querySelector('[data-id="other"]'), box = last.getBoundingClientRect();
    require(last.getAttribute('aria-pressed') === 'true' && document.activeElement === last, "keyboard selection retains the last category and focus after redraw");
    require(box.left >= frame.left - 1 && box.right <= frame.right + 1 && last.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)), "the last category is fully visible and reachable after horizontal scrolling");
    return { check: name, scrollLeft: groups.scrollLeft };
  }
  if (name === "plugins-store-settled") {
    const rows = [...document.querySelectorAll('.cs-card')];
    require(rows.length > 0 && rows.every(row => Number(getComputedStyle(row).opacity) >= .99), "all popular and result rows have finished fading in");
    const sections = [...document.querySelectorAll('.cs-sec')];
    for (let index = 1; index < sections.length; index++) {
      require(sections[index].getBoundingClientRect().top - sections[index - 1].getBoundingClientRect().bottom <= 32, "sections have only the shared spacing gap");
    }
    return { check: name, rows: rows.length, opacity: rows.map(row => Number(getComputedStyle(row).opacity)) };
  }
  if (name === "plugins-store-rows") {
    const rows = [...document.querySelectorAll('.cs-card')];
    require(rows.length > 0, "the store has app rows");
    const add = [...document.querySelectorAll('.cs-card [data-conn="join"]')];
    require(add.length > 0 && add.every(button => button.className === add[0].className && button.className === 'btn sm'), "every store add button has the same outlined class list");
    for (const row of rows) {
      const [main, action] = row.children;
      require(row.className === 'cs-card' && row.children.length === 2, "every app row has the same two slots");
      require(main.tagName === 'BUTTON' && main.className === 'btn cs-main' && main.dataset.conn === 'open-store', "every source uses the same detail button");
      require(main.children.length === 2 && main.children[0].className === 'ic' && main.children[1].className === 'tx', "every row has the same mark and text structure");
      const [title, summary] = main.children[1].children;
      require(main.children[1].children.length === 2 && title.tagName === 'SPAN' && title.className === 'nm' && summary.tagName === 'SPAN' && ['sub', 'sub wait'].includes(summary.className), "every row has the same name and one-line summary");
      require(action.matches('button.btn.sm[data-conn="join"], button.btn.sm[data-conn="cancel-login"], span.cs-state'), "every state stays in the shared inline action slot");
      const style = window.getComputedStyle(row);
      require(style.display === 'grid' && style.gridTemplateColumns.trim().split(/\s+/).length === 2 && style.borderRadius === '0px' && parseFloat(style.borderBottomWidth) === 1 && parseFloat(style.borderLeftWidth) === 0, "every source keeps the same compact row and divider");
      const frame = row.getBoundingClientRect();
      require([main, action, title, summary].every(node => {
        const box = node.getBoundingClientRect();
        return box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
      }), "store names, summaries and actions fit inside their row");
    }
    return { check: name, rows: rows.length, addClass: add[0].className };
  }
  if (name === "plugins-store") {
    const cards = [...document.querySelectorAll('.cs-card')];
    const ids = cards.map(card => card.querySelector('[data-conn="open-store"]')?.dataset.id);
    require(document.querySelectorAll('.cs-card [data-conn="join"]').length <= Number(document.querySelector('[data-k="conn-tab:store"] .n').textContent), "tab count includes all addable matches beyond the visible page");
    require(document.querySelector('[data-stagger="store:hot"] .cs-card') && document.querySelector('[data-stagger="store:all"] .cs-card'), "popular and all built-in sections remain available");
    require(window.__look.calls.some(c => c.method === 'integrations.catalog'), "built-in catalog uses the real IPC boundary");
    require(!document.querySelector('#conn-key'), "key form does not replace the store");
    require(new Set(ids).size === cards.length, "duplicate apps appear once");
    if (window.__look.data.composioConfigured) {
      require(document.querySelector('.cs-store-groups'), "all catalog sources share broad group chips");
      require(document.querySelector('[data-conn="open-store"][data-id="notion"]'), "the built-in app wins over its managed duplicate");
    } else {
      require(document.querySelector('[data-conn="configure-composio"]'), "optional Composio row follows the built-ins");
      require(!window.__look.calls.some(c => c.method === 'connectors.catalog'), "missing key never requests the managed catalog");
    }
    return { check: name, cards: cards.length };
  }
  if (name === "plugins-builtin-join") {
    require(window.__look.calls.some(c => c.method === 'integrations.connect' && c.params.catalog_id === 'github'), "own sign-in uses the built-in RPC");
    require(!window.__look.calls.some(c => c.method === 'connectors.connect'), "own sign-in is independent of Composio");
    require(visible(document.querySelector('.cs-card .sub.wait')), "the pending sign-in is visible");
    return { check: name };
  }
  if (name === "plugins-key-openrouter" || name === "plugins-key-consumer") {
    require(visible(document.querySelector('[role="dialog"] #conn-key')), "the key field belongs to a small connection dialog");
    const alert = document.querySelector('.cs-key-form [role="alert"]');
    const consumer = name === "plugins-key-consumer";
    const expected = consumer ? {
      "zh-TW": "這是 Composio 的消費者金鑰（ck_ 開頭）。請改用專案金鑰：Composio「Settings → Project Settings → API Keys」。",
      en: "This is a Composio consumer key (starting with ck_). Use a project key from Composio Settings → Project Settings → API Keys.",
      ja: "これは Composio のコンシューマーキー（ck_ で始まるキー）です。Composio の「Settings → Project Settings → API Keys」にあるプロジェクトキーを使用してください。",
    } : {
      "zh-TW": "這是 OpenRouter 的金鑰，請到「設定 → 模型與用量」輸入。",
      en: "This is an OpenRouter key. Enter it in Settings → Models and usage.",
      ja: "これは OpenRouter のキーです。「設定 → モデルと使用量」で入力してください。",
    };
    require(visible(alert) && Object.values(expected).includes(alert.textContent), "the key form explains how to correct the key type");
    require(document.querySelector('#conn-key').value === "", "the key field is cleared");
    require(!document.body.textContent.includes(consumer ? 'ck_look-synthetic' : 'sk-or-look-synthetic'), "the error never echoes the key");
    require(!window.__look.data.composioConfigured, "the wrong key never configures Composio");
    require(window.__look.calls.filter(c => c.method === 'connectors.set_key').length === 1, "the error comes through the real IPC boundary");
    return { check: name, message: alert.textContent };
  }
  if (name === "usage-summary") {
    require(document.querySelectorAll(".run-tile").length === 5, "overview totals remain available");
    require(!document.querySelector(".run-list, .run-timeline, [data-run-id]"), "per-run navigation is absent");
    const tracks = [...document.querySelectorAll(".run-groups .run-bar-track, .run-allowance .run-bar-track")];
    for (const track of tracks) {
      const fill = track.querySelector("i"), box = track.getBoundingClientRect();
      require(box.width > 0 && box.height === 7, "grouping and allowance tracks retain their visible height");
      require(visible(fill) && fill.getBoundingClientRect().height === 7, "bar fills remain visible");
    }
    return { check: name, bars: tracks.length };
  }
  if (name === "overlay-percentage") {
    const caption = document.querySelector("#progress");
    require(visible(caption) && /^\u300a \d+ % \u300b$/.test(caption.textContent), "original percentage caption is visible");
    require(Number(caption.textContent.match(/\d+/)[0]) > 0, "native progress advances beyond the initial zero");
    require(!document.body.textContent.includes("Transcribing") && !document.body.textContent.includes("\u8f49\u9304\u4e2d"), "elapsed-time captions are absent");
    return { check: name, caption: caption.textContent };
  }
  if (name === "member-details") {
    const panel = document.querySelector(".mb-det"), title = document.querySelector(".conversation-trigger");
    require(visible(panel), "details panel is visible");
    require(title.getAttribute("aria-expanded") === "true", "title reflects the panel state");
    require(title.getAttribute("aria-controls") === panel.id && !title.hasAttribute("aria-haspopup"), "title controls details without a popup");
    require([...title.querySelectorAll(".i")].every(icon => icon.closest(".mb-pill-face")), "title has no dropdown glyph outside its member avatar");
    const list = panel.querySelector(".conversation-list");
    require(visible(list) && list.scrollWidth <= list.clientWidth + 1, "conversation management fits the panel");
    const picker = panel.querySelector('[data-member-brain] .mp-trigger');
    if (picker) {
      require(panel.querySelectorAll('.mp-trigger').length === 1, "member details has one shared brain control");
      const mark = picker.querySelector('.mono'), source = picker.querySelector('.mp-source');
      if (mark) {
        const bounds = mark.getBoundingClientRect();
        require(bounds.width <= 28 && bounds.height <= 32, "the shared brain mark stays inside its control");
      }
      require(source.scrollWidth <= source.clientWidth + 1, "the complete brain source remains readable");
    }
    return { check: name, width: list.clientWidth, scrollWidth: list.scrollWidth };
  }
  if (name === "composer-pair") {
    const form = [...document.querySelectorAll(".composer")].find(visible);
    const send = form.querySelector(".cmp-send"), voice = form.querySelector(".cmp-voice");
    const hasDraft = !!form.querySelector("textarea").value.trim();
    const shown = hasDraft ? send : voice, gone = hasDraft ? voice : send, a = shown.getBoundingClientRect();
    require(a.width === 32 && a.height === 32, "the one right-hand control is 32px");
    require(gone.getBoundingClientRect().width === 0, "send and the emblem share one slot: only one shows");
    require(!!voice.querySelector('img[src*="app-emblem"], .av') && !voice.querySelector('.av-custom'), "the voice button is the gold emblem, never a picture");
    require(getComputedStyle(shown).backgroundColor === "rgba(0, 0, 0, 0)", "the slot is a bare icon with no background");
    require(send.disabled === !hasDraft, "send state follows draft text");
    return { check: name, shown: a.width, hasDraft, color: getComputedStyle(send).color };
  }
  if (name === "calendar-chips") {
    const chips = [...document.querySelectorAll(".au-occurrence")];
    require(chips.length > 0, "calendar has event chips");
    for (const chip of chips) {
      const time = chip.querySelector("time, small"), face = chip.querySelector(".av"), label = chip.querySelector("b");
      const bounds = chip.getBoundingClientRect();
      require(visible(face), "member face is visible in every event chip");
      if (visible(face)) {
        const picture = face.getBoundingClientRect();
        require(Math.abs(picture.width - 20) < 1 && Math.abs(picture.height - 20) < 1, "event faces retain their 20px square rather than flexing with the copy");
      }
      require(visible(time) && /^\d{2}:\d{2}$/.test(time.textContent), `complete compact time: ${time?.textContent}`);
      const range = document.createRange(); range.selectNodeContents(time);
      const text = range.getBoundingClientRect();
      require(text.left >= bounds.left + 1 && text.right <= bounds.right - 1 && text.top >= bounds.top && text.bottom <= bounds.bottom,
        `time ${time.textContent} fits chip (${Math.round(text.width)}px text, ${Math.round(bounds.width)}px chip)`);
      require(text.right <= face.getBoundingClientRect().left - 1, "event time and fixed avatar do not overlap");
      require(chip.title.includes(label.textContent) && chip.title.includes(time.textContent), "tooltip preserves full title and time");
      require(getComputedStyle(label).whiteSpace === "normal" && getComputedStyle(label).webkitLineClamp === '2', "calendar titles allow two recognisable lines");
      const titleBox = label.getBoundingClientRect();
      require(titleBox.bottom <= bounds.bottom + 1 && titleBox.height <= parseFloat(getComputedStyle(label).lineHeight) * 2 + 1, "two title lines fit inside the event");
    }
    return { check: name, chips: chips.length };
  }
  if (name === "bot-ask-centred" || name === "bot-ask-expanded") {
    const event = document.querySelector('[data-handoff="x71"]');
    const [line] = eventLines(1);
    require(line.textContent === "已詢問 小晴已完成", `the asker's line names the colleague and the state: ${line.textContent}`);
    require(visible(line.querySelector('.av')) && !event.closest('.chat-message'), "one faced line outside the messages");
    if (name === "bot-ask-expanded") {
      const detail = event.querySelector('.handoff-detail');
      require(event.open && detail.querySelector('.message-quote')?.textContent.includes("下週上市的新品代號是多少？"), "it opens on the question that was sent");
      require(detail.querySelector('.message-text')?.textContent.includes("NX-2026"), "and on the answer that came back");
      require(!/#\d|x71/.test(detail.textContent), "no internal ids");
    } else require(!event.open, "the line starts closed");
    return { check: name, open: event.open };
  }
  if (name === "bot-message-from" || name === "bot-exchange-count" || name === "bot-exchange-expanded") {
    // The asked member's chat: one centred line where the question came, never a pasted transcript.
    const event = document.querySelector('.exchange-event[data-exchange="71"]');
    const [line] = eventLines(1);
    const words = name === "bot-message-from" ? "訊息來自 小森" : "4 則訊息往來：小森";
    require(line.textContent === words, `the line reads ${words}: ${line.textContent}`);
    require(visible(line.querySelector('.av')), "the line carries the asker's face");
    require(document.querySelector('.tn[data-id="2"]').getBoundingClientRect().bottom <= event.getBoundingClientRect().top, "the question sits where it came, after the member's own earlier turn");
    require(!document.querySelector('.exchange-row .bubble'), "a colleague's question is never an owner bubble");
    if (name === "bot-exchange-expanded") {
      const messages = [...event.querySelectorAll('.exchange-message')].filter(visible);
      require(event.open && messages.length === 4, `every question and answer is shown: ${messages.length}`);
      require(messages.map(message => message.querySelector('b').textContent).join("|") === "小森|小晴|小森|小晴", "each speaker is named once, in order");
      require(!/^(?:小森|小晴)[:：]/m.test(messages.map(message => message.querySelector('.message-text').textContent).join("\n")), "no line carries a speaker label");
    } else require(!event.open, "the line starts closed");
    return { check: name, words: line.textContent };
  }
  if (name === "global-private-memory") {
    const shared = document.querySelector('.mb-det [data-mem-space="shared"]'), own = document.querySelector('.mb-det [data-mem-space="own"]');
    require(visible(shared) && visible(own), "the shared and the member's own memory are both on screen");
    require(shared.textContent.includes("品牌主色是金色") && shared.querySelector('.mem-from')?.textContent === "拉斐爾 · 2026/10/27", "the shared note says whom the owner told it to and when in the UI date format");
    require(own.textContent.includes("專案每週三檢查原型") && !shared.textContent.includes("專案每週三檢查原型"), "the member's own note stays in its own memory");
    return { check: name };
  }
  if (name.startsWith("connector-")) {
    // A connector card (connector-card.ts): the app's own bare mark, its name, where its sign-in stands and at most
    // one framed action, all inside the card, below the reply that asked for it.
    const cards = [...document.querySelectorAll('.connector-card')].filter(visible);
    require(cards.length === 1, `one connector card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(300, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    const mark = card.querySelector('.mono'), markStyle = getComputedStyle(mark);
    require(visible(mark) && mark.querySelector('svg.logo path, img.logo'), "R-UI-34: the app's own catalog or bundled mark");
    if (name.startsWith('connector-slack')) require(mark.querySelector('img.logo')?.getAttribute('src') === window.__look.data.pluginCatalog.find(app => app.slug === 'slack').logo, "the card uses exactly the store's catalog logo");
    require(markStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(markStyle.borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    const reply = [...card.closest('.tn').querySelectorAll('.ra .chat-message')].filter(visible).at(-1);
    require(reply && reply.getBoundingClientRect().bottom <= box.top + 1, "the card sits below the reply that asked for it");
    const buttons = [...card.querySelectorAll('button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom, "R-UI-25: the action is inside its card");
    }
    const status = card.querySelector('.cc-state'), said = status?.textContent.trim() ?? "", app = card.querySelector('.cc-name').textContent;
    const expected = {
      "connector-card": ["pending", "", "連結", true],
      "connector-slack": ["pending", "", "連結", true],
      "connector-slack-authorizing": ["authorizing", "等你在瀏覽器登入", "取消", false],
      "connector-authorizing": ["authorizing", "等你在瀏覽器登入", "取消", false],
      "connector-expired": ["pending", "授權已過期", "重新連結", true],
      "connector-reconnected": ["connected", "已重新連結 · 2 個工具", null, false],
    }[name];
    require(expected, `no expectation for ${name}`);
    const [state, words, action, primary] = expected;
    if (!words) require(!status, "R-UI-02: a pending card has no helper line or empty status row");
    require(card.dataset.cardState === state && said === words, `${app}'s card reads "${words}" (${card.dataset.cardState}: "${said}")`);
    require(action === null ? buttons.length === 0 : buttons.length === 1 && buttons[0].textContent.trim() === action
      && buttons[0].classList.contains('pri') === primary, `the card's one action is ${action ?? "none"}`);
    if (name === "connector-authorizing" || name === "connector-slack-authorizing") {
      const text = status.querySelector('span:last-child'), actionBox = buttons[0].getBoundingClientRect();
      require(text.scrollWidth <= text.clientWidth + 1 && text.getBoundingClientRect().right <= actionBox.left - 4 && !/…|\.{3}/.test(text.textContent), "authorizing status uses its available width without truncation");
      require(visible(card.querySelector('.spin')), "the card shows the sign-in under way");
      require(window.__look.calls.some(call => call.method === "integrations.card_connect" && call.params?.id === card.dataset.connector),
        "Connect reached the core with the card's id");
    }
    if (name === "connector-reconnected") {
      const [line] = eventLines(1), resumed = document.querySelector('.tn[data-id="121"]');
      require(line.textContent === "Gmail 已連結，繼續原本的工作", `the resumed task opens with one line naming the app: ${line.textContent}`);
      const markBox = line.querySelector('.mono').getBoundingClientRect();
      require(markBox.width <= 20 && markBox.height <= 20, `the line's mark is no larger than its icons (${markBox.width}x${markBox.height})`);
      require(line.getBoundingClientRect().top >= box.bottom, "the resumed task comes after the card");
      require(!resumed.querySelector('.owner-message'), "the owner's request is not repeated as a new bubble");
      require([...resumed.querySelectorAll('.message-text')].some(text => visible(text) && text.textContent.includes("MC-4F2A")), "the resumed task's answer is shown");
      require(visible(card.querySelector('.cc-done')), "the connected card carries its check");
      plainWords();
    }
    return { check: name, app, state: card.dataset.cardState, words: said };
  }
  if (name.startsWith("secret-") || name.startsWith("pc-")) {
    // The cards of a key (secret-card.ts) and of the owner's turn at the computer (computer-card.ts) are connector cards with a
    // second row: all inside the reply column, below the reply that asked, with real framed buttons inside the card.
    const secret = name.startsWith("secret-"), key = "sk-look-4c9f2b7e81d3";
    const cards = [...document.querySelectorAll(secret ? '.secret-card' : '.computer-card')].filter(visible);
    require(cards.length === 1, `one card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(300, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    const mark = card.querySelector('.mono'), markStyle = getComputedStyle(mark);
    require(visible(mark) && mark.querySelector('svg'), "the card has its mark");
    require(markStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(markStyle.borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    if (secret) require(mark.querySelector('svg.logo path'), "R-UI-34: the connection's own drawn mark, not a letter");
    const reply = [...card.closest('.tn').querySelectorAll('.ra .chat-message')].filter(visible).at(-1);
    require(reply && reply.getBoundingClientRect().bottom <= box.top + 1, "the card sits below the reply that asked for it");
    const buttons = [...card.querySelectorAll('button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom + 1, "R-UI-25: the action is inside its card");
      require(button.classList.contains('btn') && parseFloat(getComputedStyle(button).borderTopWidth) > 0, "R-UI-17/18: a text action is a framed button");
    }
    const state = card.querySelector('.cc-state').textContent.trim(), calls = window.__look.calls;
    const carrying = call => JSON.stringify(call.params ?? {}).includes(key);
    require(!document.documentElement.outerHTML.includes("開啟電腦") && !document.body.innerText.includes("開啟電腦"), "there is no 開啟電腦 step on the owner's own computer");
    if (name === "secret-masked") {
      const field = card.querySelector('input'), save = buttons[0];
      require(card.dataset.cardState === "pending" && state === "NOTION_TOKEN", `the card names the secret it fills (${state})`);
      require(field.type === "password" && field.autocomplete === "off" && visible(field) && field.getBoundingClientRect().width >= 100, "the field is a masked field a key fits in");
      require(field.value === key && !field.hasAttribute('value'), "the characters live in the field only, never in its markup");
      require(!document.body.innerText.includes(key) && !document.documentElement.outerHTML.includes(key), "no characters of the key are drawn or in the page");
      require(buttons.length === 1 && save.textContent.trim() === "安全儲存" && save.classList.contains('pri') && !save.disabled, "one primary 安全儲存, ready");
      require(visible(card.querySelector('.field svg')), "the field carries its lock");
      require(!calls.some(carrying), "nothing was sent before the owner saved it");
    }
    if (name === "secret-saved-not-resumed") {
      require(card.dataset.cardState === "saved" && card.dataset.cardError === "resume_failed", `saved, and the task did not continue (${card.dataset.cardState}/${card.dataset.cardError})`);
      require(state === "金鑰已儲存，這項工作沒有繼續", `the card says both things: "${state}"`);
      require(!card.querySelector('input') && buttons.length === 1 && buttons[0].textContent.trim() === "再試一次" && buttons[0].classList.contains('pri'), "no field is asked again: one primary 再試一次");
      require(visible(card.querySelector('.cc-name')) && !card.querySelector('.cc-done'), "the check is the resumed task's, not the saved key's");
      const sent = calls.filter(carrying);
      require(sent.length === 1 && sent[0].method === "integrations.card_save", "the key crossed one call, integrations.card_save, and no other");
      require(calls.filter(call => call.method === "agent.ask").length === 0 && !calls.some(call => String(call.method ?? "").startsWith("agent.") && carrying(call)), "never through the assistant");
      require(![...document.querySelectorAll('input, textarea')].some(field => field.value.includes(key)), "no field of the page still holds it");
      require(!document.body.innerText.includes(key) && !document.documentElement.outerHTML.includes(key), "the key is nowhere in the page");
      plainWords();
    }
    if (name.startsWith("pc-")) {
      const live = card.querySelector('.cc-live');
      if (name !== "pc-handback") {
        require(card.dataset.cardState === "control", `the owner has the computer (${card.dataset.cardState})`);
        require(visible(live) && live.textContent.trim() === "你正在控制" && visible(live.querySelector('.dot')), "it says the owner is in control, with a dot and a word");
        require(buttons.map(button => button.textContent.trim()).join("|") === "停止|我完成了" && buttons[1].classList.contains('pri') && !buttons[0].classList.contains('pri'),
          "停止 then the primary 我完成了, the primary last");
        require(state.startsWith("請在「Google Chrome」登入你的帳號，完成後交還控制"), `it names the window to use: "${state}"`);
        require(card.querySelector('.mono svg.i') && card.querySelector('.cc-name span').textContent === "電腦", "the card is the computer's, with its icon");
      }
      if (name === "pc-takeover") {
        require(!card.dataset.cardNote && !card.querySelector('.cc-hint'), "a first hand-over has no hint");
        require(!calls.some(call => String(call.method ?? "").startsWith("integrations.card_")), "nothing was pressed");
      }
      if (name === "pc-human-control") {
        require(card.dataset.cardNote === "still" && card.querySelector('.cc-hint')?.textContent === "看起來還沒完成，請再試一次", "the card says the sign-in does not look done");
        require(calls.filter(call => call.method === "integrations.card_done").length === 1 && !calls.some(call => call.method === "integrations.card_stop"), "我完成了 was pressed once, 停止 never");
        require(!document.querySelector('[data-resumed]'), "the task did not resume");
      }
      if (name === "pc-handback") {
        require(card.dataset.cardState === "done" && state === "已交還控制 · 工作已繼續" && visible(card.querySelector('.cc-done')), `the card says control went back and the task continued: "${state}"`);
        require(buttons.length === 0 && !live, "no action is left, and the owner no longer controls");
        const [line] = eventLines(1), resumed = document.querySelector('.tn[data-id="141"]');
        require(line.textContent === "電腦 已交還控制，繼續原本的工作", `the resumed task opens with one line: ${line.textContent}`);
        const markBox = line.querySelector('svg.i').getBoundingClientRect();
        require(markBox.width <= 20 && markBox.height <= 20, `the line's icon is no larger than the other lines' (${markBox.width}x${markBox.height})`);
        require(line.getBoundingClientRect().top >= box.bottom, "the resumed task comes after the card");
        require(!resumed.querySelector('.owner-message'), "the owner's request is not repeated as a new bubble");
        require([...resumed.querySelectorAll('.message-text')].some(text => visible(text) && text.textContent.includes("YT-4F2A")), "the resumed task's answer is shown");
        require(calls.filter(call => call.method === "integrations.card_done").length === 1, "我完成了 was pressed once");
        plainWords();
      }
    }
    return { check: name, state: card.dataset.cardState, words: state };
  }
  if (name === "local-permission-card" || name === "draft-preference-ask-first") {
    // A permission card (permission-card.ts) is a connector card with a second row for its answers, below the turn that asked.
    // The question it follows is answered there, once: the gold card stays away.
    const waiting = name === "local-permission-card";
    const cards = [...document.querySelectorAll('.permission-card')].filter(visible);
    require(cards.length === 1, `one permission card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(300, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    const mark = card.querySelector('.mono'), markStyle = getComputedStyle(mark);
    require(visible(mark) && mark.querySelector('svg.logo path'), "R-UI-34: the service's own drawn mark");
    require(markStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(markStyle.borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    const buttons = [...card.querySelectorAll('button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom + 1, "R-UI-25: the answer is inside its card");
      require(button.classList.contains('btn') && parseFloat(getComputedStyle(button).borderTopWidth) > 0, "R-UI-17/18: a text answer is a framed button");
      require(!button.disabled, "the answers can be pressed");
    }
    const answers = buttons.map(button => button.textContent.trim()).join("|");
    require(answers === (waiting ? "拒絕|一律允許|允許一次" : "拒絕|允許一次"), `the card answers ${waiting ? "three ways" : "two ways, with no 一律允許 where a rule asks first"}: ${answers}`);
    require(buttons.at(-1).classList.contains('pri') && buttons.slice(0, -1).every(button => !button.classList.contains('pri')), "R-UI-27: the primary answer is the last");
    require(card.querySelector('.cc-name').textContent === "Gmail", "it names the service that asks");
    require(card.dataset.cardState === "pending" && card.querySelector('.cc-ask').textContent.trim() === "是否讓「Gmail」執行「send_email」（to: mei@example.com, subject: 週四下午三點的會議）？",
      "it says the exact action in plain words");
    const gold = document.querySelector('.ask-card');
    require(!gold || !visible(gold), "the question is answered by the card, once: the gold card stays away");
    require(!window.__look.calls.some(call => call.command === "agent_question_answer"), "nothing was answered yet");
    if (waiting) require(!card.querySelector('.cc-hint'), "no rule had it asked: there is no hint");
    else {
      const hint = card.querySelector('.cc-hint');
      require(visible(hint) && hint.textContent.trim() === "此操作符合安全規則「寄信前先問」。", "it says which of the owner's rules had it asked");
      require(![...document.querySelectorAll('.mail-card')].some(visible), "a member that writes no draft first asks the owner: there is no draft card");
    }
    plainWords();
    return { check: name, answers };
  }
  if (name === "member-draft-switch") {
    // The preference to write mail as a draft first is a switch beside the one that asks before contacting colleagues.
    const toggle = document.querySelector('.mb-dialog [data-dlg="draft"]');
    require(visible(toggle) && toggle.getAttribute('role') === 'switch' && toggle.classList.contains('tg'), "the draft preference is a real switch");
    require(toggle.getAttribute('aria-checked') === 'false', "this member was set to send mail itself, so the switch is off");
    const row = toggle.closest('.mp-resource');
    require(row.querySelector('b').textContent === "先擬成草稿，由我寄出", `the switch says what it does: ${row.querySelector('b').textContent}`);
    require(row.querySelector('p').textContent.includes("由你按「傳送」才會寄出"), "its line says that only 傳送 sends");
    require(document.querySelectorAll('.mb-dialog .mp-resource [role="switch"]').length === 2, "it stands beside the one that asks before contacting colleagues");
    return { check: name };
  }
  if (name === "mail-handed-first" || name.startsWith("email-draft-")) {
    // An email card (mail-card.ts): who sends it and to whom, the subject and the body, with 捨棄 and 傳送. Only 傳送 sends,
    // and these scenes never press it: editing, discarding and handing over send nothing.
    const draftCalls = window.__look.calls.filter(call => String(call.method ?? "").startsWith("integrations.draft_"));
    require(window.__look.sent.length === 0 && !draftCalls.some(call => call.method === "integrations.draft_send"), "nothing was sent");
    const first = "a".repeat(64), second = "b".repeat(63) + "2", third = "b".repeat(63) + "3";
    if (name === "mail-handed-first") {
      const [line] = eventLines(1);
      require(line.textContent === "已轉交給 小森", `the first chat keeps one line naming the colleague: ${line.textContent}`);
      require(visible(line.querySelector('.av, svg, .mono')), "the colleague's face stands before the name");
      require(!document.querySelector('.mail-card, .mail-offer'), "the card and its choice are not in this chat any more");
      const handed = draftCalls.filter(call => call.method === "integrations.draft_handover");
      require(handed.length === 1 && handed[0].params.choice === "yes" && handed[0].params.id === "mail-1", "the owner's yes reached the core once");
      require(draftCalls.length === 1, "handing over saved and sent nothing");
      return { check: name, words: line.textContent };
    }
    if (name === "email-draft-discard") {
      const done = [...document.querySelectorAll('.mail-done')].filter(visible);
      require(done.length === 1 && done[0].dataset.mailState === "discarded", "the discarded draft is one quiet line");
      require(done[0].querySelector('.cc-state').textContent.trim() === "已捨棄，沒有寄出任何東西", "it says nothing was sent");
      require(!document.querySelector('.mail-card') && ![...done[0].querySelectorAll('input, textarea, button')].length, "no field or action is left");
      require(draftCalls.length === 1 && draftCalls[0].method === "integrations.draft_discard" && draftCalls[0].params.id === "mail-1", "捨棄 reached the core once and nothing else did");
      const box = done[0].getBoundingClientRect(), column = done[0].closest('.ra-body').getBoundingClientRect();
      require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the line fits the reply column");
      return { check: name };
    }
    const cards = [...document.querySelectorAll('.mail-card')].filter(visible);
    require(cards.length === 1, `one email card is visible, found ${cards.length}`);
    const [card] = cards, box = card.getBoundingClientRect(), column = card.closest('.ra-body').getBoundingClientRect();
    require(box.left >= column.left - 1 && box.right <= column.right + 1, "R-UI-29: the card fits the reply column");
    require(box.width >= Math.min(360, column.width) - 1, `the card keeps a card's width, not a chip's (${Math.round(box.width)}px)`);
    require(card.scrollWidth <= card.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, "nothing scrolls sideways");
    const head = card.querySelector('.mail-head .mono');
    require(visible(head) && head.querySelector('svg.logo path'), "R-UI-34: the sending app's own drawn mark");
    require(getComputedStyle(head).backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(getComputedStyle(head).borderTopWidth) === 0, "R-UI-34: the mark is bare, on no tile");
    require(!card.querySelector('select'), "no native select: the sender is a dropdown");
    const labels = [...card.querySelectorAll('.mail-k')].filter(visible);
    require(labels.map(label => label.textContent).join("|") === "寄件者|收件者|副本|主旨", `the rows read 寄件者, 收件者, 副本, 主旨: ${labels.map(label => label.textContent)}`);
    const sender = card.querySelector('.mail-row .sel'), inputs = [...card.querySelectorAll('.mail-in')].filter(visible);
    require(visible(sender) && sender.dataset.act === "mail-from" && sender.textContent.trim() === "Gmail", "the sender is a dropdown showing Gmail");
    require(inputs.length === 3 && [sender, ...inputs].every(control => Math.abs(control.getBoundingClientRect().left - sender.getBoundingClientRect().left) <= 1), "the controls of the rows line up");
    require(labels.every(label => Math.abs(label.getBoundingClientRect().left - labels[0].getBoundingClientRect().left) <= 1), "the labels line up");
    const body = card.querySelector('.mail-body');
    require(visible(body) && body.getBoundingClientRect().height >= 100 && body.getBoundingClientRect().right <= box.right, "the body is a field that can be read");
    const buttons = [...card.querySelectorAll('.mail-actions button')].filter(visible);
    for (const button of buttons) {
      const inside = button.getBoundingClientRect();
      require(inside.left >= box.left && inside.right <= box.right && inside.bottom <= box.bottom + 1, "R-UI-25: the action is inside its card");
      require(button.classList.contains('btn') && parseFloat(getComputedStyle(button).borderTopWidth) > 0 && !button.disabled, "R-UI-17/18: a text action is a framed button that can be pressed");
    }
    require(buttons.map(button => button.textContent.trim()).join("|") === "捨棄|傳送" && buttons[1].classList.contains('pri') && !buttons[0].classList.contains('pri'), "R-UI-27: 捨棄 then the primary 傳送");
    require(!card.closest('.tn').querySelector('.event-line, .mail-offer'), "no other line or choice is in this turn");
    if (name === "email-draft-edit") {
      const value = field => card.querySelector(`[data-mail-field="${field}"]`).value;
      require(value("to") === "mei@example.com" && value("cc") === "boss@example.com", "the recipients are what the owner typed");
      require(value("subject") === "回覆：週四下午三點的會議（改期確認）" && value("body").startsWith("小美，您好："), "the subject is what the owner typed and the body is kept");
      require(card.querySelector('.mail-ver').textContent === "第 3 版" && card.dataset.version === "3" && card.dataset.digest === third, "each edit made a new version with a new digest");
      const saves = draftCalls.filter(call => call.method === "integrations.draft_save");
      require(saves.length === 2 && draftCalls.length === 2, "two edits made two saves and nothing else");
      require(saves[0].params.digest === first && saves[1].params.digest === second, "each save is on the digest the version before came back with");
      require(saves[1].params.cc === "boss@example.com" && saves[1].params.subject === "回覆：週四下午三點的會議（改期確認）" && saves[1].params.via === "mcp:gmail/send_email", "a save carries every field as the owner sees it");
      return { check: name, version: card.dataset.version };
    }
    // email-draft-handed-off: the colleague's chat holds the same version, editable, and says whose draft it is.
    require(name === "email-draft-handed-off", `no expectation for ${name}`);
    require(card.dataset.mailState === "draft" && card.dataset.version === "1" && card.dataset.digest === first, "it is the same version, with the same digest");
    require(card.querySelector('.mail-by').textContent === "來自 小晴 的草稿", "it says whose draft it is");
    require(![...card.querySelectorAll('input, textarea')].some(field => field.disabled) && !document.querySelector('.mail-offer, .event-line'), "it is editable, and asks nothing more");
    require(!document.body.innerText.includes("交給你") && !card.closest('.tn').querySelector('.owner-message'), "what the carrier turn is told is not shown, and no bubble is made of it");
    const handed = draftCalls.filter(call => call.method === "integrations.draft_handover");
    require(handed.length === 1 && handed[0].params.choice === "yes" && draftCalls.length === 1, "handing over was answered once, and nothing was saved");
    return { check: name, version: card.dataset.version };
  }
  throw new Error(`Unknown rendered check: ${name}`);
}
