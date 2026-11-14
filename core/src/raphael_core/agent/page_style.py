"""The base style of an HTML page a member writes (R-PAGE-06).

A page is model-written HTML in a sandbox, and the app gave it only its theme's colour words, so every page set its own type and
every page came out different: a table with no lines, a heading as small as the text, a note that was a plain paragraph. This is
the app's own default for a page, put in front of the page's own style by `pages.document`: readable type, tables, links, code,
and a few classes a page may use (`.callout`, `.toc`, `.chips`, `.cards`, `.kpis`) named in the tool's words.

Every rule is under `:where()`, which has no specificity, so any rule the page writes for the same thing wins whatever its
order (a pseudo-element cannot stand in `:where()`, so those few rules keep the lowest specificity a pseudo-element has); and it
speaks only in the theme's words (agent/pages.py THEME), so it follows the owner's light or dark theme. It names no address (no
font, picture or `@import`): the page's policy would not load one, and a test holds it to that.
"""

# The page keeps readable lines on a wide window by narrowing the root (a page that resets its body's margin stays centred), with
# a gutter at its sides; the body keeps only its own space above and below.
_PAGE = """
:where(:root){--pg-max:1120px;--pg-gutter:24px}
:where(html){max-width:var(--pg-max);margin:0 auto;padding:0 var(--pg-gutter);scroll-padding-top:16px;-webkit-text-size-adjust:100%}
:where(body){margin:0;padding:32px 0 48px;font-size:15px;line-height:1.6;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}
:where(*),:where(*)::before,:where(*)::after{box-sizing:border-box}
@media (max-width:640px){:where(:root){--pg-gutter:16px}:where(body){padding-top:20px;padding-bottom:32px}}
"""

_TYPE = """
:where(h1,h2,h3,h4,h5,h6){margin:1.6em 0 .5em;font-weight:600;line-height:1.3;text-wrap:balance}
:where(h1){margin-top:0;font-size:32px;line-height:1.25}
:where(h2){font-size:22px}
:where(h3){font-size:17px}
:where(h4,h5,h6){font-size:15px}
:where(h1+*,h2+*,h3+*){margin-top:0}
:where(p,ul,ol,dl,pre,blockquote,figure,table){margin:0 0 1em}
:where(p,li,dd,blockquote){max-width:44em}
:where(ul,ol){padding-inline-start:1.5em}
:where(li+li){margin-top:.25em}
:where(small){font-size:13px;color:var(--muted)}
:where(strong,b){font-weight:600}
:where(a){color:var(--link);text-underline-offset:3px;text-decoration-thickness:1px}
:where(a:hover){text-decoration-thickness:2px}
:where(hr){margin:2em 0;border:0;border-top:1px solid var(--line)}
:where(img,svg,video,canvas){max-width:100%}
:where(img,video){height:auto}
:where(blockquote){padding:2px 0 2px 16px;border-inline-start:3px solid var(--line);color:var(--fg-2)}
:where(code,kbd,samp){padding:.1em .4em;border-radius:6px;background:var(--surface);font-family:"Cascadia Mono",Consolas,monospace;font-size:.9em}
:where(pre){padding:14px 16px;border-radius:10px;background:var(--surface);overflow-x:auto;line-height:1.5;overflow-wrap:normal}
:where(pre code){padding:0;background:none;font-size:13px}
:where(mark){padding:0 .2em;border-radius:3px;background:var(--surface);color:var(--fg)}
:where(details){margin:0 0 1em}
:where(summary){cursor:pointer;font-weight:600}
"""

# A table reads as a table: a header row and hairlines between the rows; where the page is narrow it scrolls inside itself
# instead of making the page wider. `.num` right-aligns a column of figures (on its th and td).
_TABLE = """
:where(table){width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:12px;font-size:14px;line-height:1.5}
:where(th,td){padding:10px 14px;text-align:start;vertical-align:top;border-bottom:1px solid var(--line)}
:where(th){background:var(--surface);color:var(--fg);font-weight:600;white-space:nowrap}
:where(td){color:var(--fg-2)}
:where(td:first-child){color:var(--fg)}
:where(tr:last-child>td,tbody:last-child>tr:last-child>td,tfoot>tr:last-child>td){border-bottom:0}
:where(thead>tr:first-child>th:first-child){border-top-left-radius:11px}
:where(thead>tr:first-child>th:last-child){border-top-right-radius:11px}
:where(.num){text-align:end;font-variant-numeric:tabular-nums}
:where(caption){padding:0 0 8px;color:var(--muted);font-size:13px;text-align:start;caption-side:top}
@media (max-width:720px){:where(table){display:block;width:auto;max-width:100%;overflow-x:auto}:where(th,td){min-width:5.5em}}
"""

# What a page may use by name. A note in the tone of its content: info, warn or ok, a tint of the theme's own colour, with a mark
# drawn in CSS. A box that lists the page's sections. A row of choices. Cards and figures in a grid that fills the width.
_CLASSES = """
:where(.callout){position:relative;margin:0 0 1em;padding:14px 18px 14px 48px;border-radius:12px;background:var(--surface);color:var(--fg-2);--tone:var(--link)}
:where(.callout.info){--tone:var(--link)}
:where(.callout.warn){--tone:var(--warn)}
:where(.callout.ok){--tone:var(--ok)}
:where(.callout)::before{content:"i";position:absolute;inset:16px auto auto 16px;width:20px;height:20px;border:1.5px solid var(--tone);
  border-radius:50%;color:var(--tone);font:600 12px/17px var(--font);text-align:center}
:where(.callout.warn)::before{content:"!"}
:where(.callout.ok)::before{content:"\\2713"}
@supports (background:color-mix(in srgb,red 10%,blue)){:where(.callout){background:color-mix(in srgb,var(--tone) 12%,var(--bg))}}
:where(.callout>:first-child){margin-top:0}
:where(.callout>:last-child){margin-bottom:0}
:where(.callout>:is(h1,h2,h3,h4,h5,h6,strong,b,.title):first-child){color:var(--tone);font-size:15px}
:where(.toc){margin:0 0 1.5em;padding:14px 20px;border:1px solid var(--line);border-radius:12px}
:where(.toc>:is(p,span,h2,h3,h4,.title):first-child){display:block;margin:0 0 6px;color:var(--muted);font-size:13px;font-weight:400}
:where(.toc ul,.toc ol){margin:0;padding:0;list-style:none}
:where(.toc li){max-width:none;margin:0;padding:3px 0}
:where(.toc a){color:var(--fg);font-weight:600;text-decoration:none}
:where(.toc a:hover){text-decoration:underline}
:where(.toc li li){padding-inline-start:16px}
:where(.toc li li a){color:var(--fg-2);font-weight:400}
:where(.chips){display:flex;flex-wrap:wrap;gap:4px 20px;margin:0 0 1em;padding:0;list-style:none;font-size:14px}
:where(.chips>*){margin:0;padding:6px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:none;color:var(--muted);
  font:inherit;text-decoration:none;cursor:pointer}
:where(.chips>:hover,.chips>:is(.on,.active,[aria-selected="true"],[aria-pressed="true"],[aria-current])){color:var(--fg)}
:where(.chips>:is(.on,.active,[aria-selected="true"],[aria-pressed="true"],[aria-current])){border-bottom-color:var(--fg);font-weight:600}
:where(.cards){display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:16px;margin:0 0 1em;padding:0;list-style:none}
:where(.cards>*){min-width:0;margin:0;padding:16px 18px;border-radius:12px;background:var(--surface)}
:where(.cards>*>:first-child){margin-top:0}
:where(.cards>*>:last-child){margin-bottom:0}
:where(.kpis){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));gap:12px;margin:0 0 1em;padding:0;list-style:none}
:where(.kpis>*){min-width:0;margin:0;padding:14px 16px;border-radius:12px;background:var(--surface);color:var(--muted);font-size:13px;line-height:1.4}
:where(.kpis :is(b,strong,.value)){display:block;color:var(--fg);font-size:28px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums}
:where(.kpis :is(small,.label,.sub)){display:block;font-size:13px}
:where(.muted){color:var(--muted)}
"""

# A control the page draws as it is: the page's own face and the theme's colours (its own rules win).
_CONTROLS = """
:where(button,input,select,textarea){font:inherit;color:var(--fg)}
:where(select,input:not([type=checkbox],[type=radio],[type=range],[type=color]),textarea){padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
:where(button){padding:6px 14px;border:0;border-radius:8px;background:var(--surface);cursor:pointer}
:where(button:hover){background:var(--line)}
:where(button:disabled){opacity:.5;cursor:default}
:where(label){color:var(--fg-2);font-size:13px}
"""

# Every rule has the same (no) specificity, so what stands later wins: the classes a page names come after the plain controls and elements.
BASE = "\n".join(" ".join(part.split()) for part in (_PAGE, _TYPE, _TABLE, _CONTROLS, _CLASSES))
