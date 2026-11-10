/**
 * Where slimes move (R-SLIME-01; owner, 2026-11-11: 「只有左邊成員列表工作中、對話框思考那一行要有動畫，其他地方放史萊姆的樣子就可以了」).
 * Runs in the page, so it is self-contained. A slime is allowed to move in two places only: a member's row or tile in the
 * left list, and the thinking or waiting line of the open conversation. In every other place it must be a picture: drawn
 * with `data-slime-still`, with no strips, and with nothing running on it or any node inside it.
 */
export function slimePlaces() {
  const where = node => node.closest(".mb-list .mb-row, .mb-list .mb-tile") ? "list" : node.closest(".live-presence") ? "line" : "elsewhere";
  const name = node => `${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? `.${node.className.trim().split(/\s+/).join(".")}` : ""}`;
  const here = surface => {
    const host = surface.closest(".av, .mb-row, .mb-tile, .live-presence, .room-avatar, .ra-face, .mb-det, .mb-head, .ms-pane, .card, .modal-scrim, .ob-floaters, .menu, .store-entry") ?? surface.parentElement;
    return host ? name(host) : "page";
  };
  const found = { list: 0, line: 0, elsewhere: 0 }, offenders = [];
  // What is running now: CSS animations and transitions, and the script's own, on or inside any slime.
  for (const animation of document.getAnimations?.() ?? []) {
    if (animation.playState !== "running") continue;
    const target = animation.effect?.target;
    const surface = target instanceof Element ? target.closest(".slime-surface") : null;
    if (!surface) continue;
    const place = where(surface);
    found[place]++;
    if (place === "elsewhere") offenders.push({ at: here(surface), reason: `${animation.constructor?.name ?? "animation"} ${animation.animationName ?? animation.transitionProperty ?? ""}`.trim() });
  }
  // What could run: a slime outside the two places is a picture, whatever its state.
  const surfaces = [...document.querySelectorAll(".slime-surface")];
  for (const surface of surfaces) {
    if (where(surface) !== "elsewhere") continue;
    if (!surface.hasAttribute("data-slime-still")) offenders.push({ at: here(surface), reason: "is not drawn as a picture" });
    if (surface.querySelector(".slime-loop")) offenders.push({ at: here(surface), reason: "carries animation strips" });
    for (const node of [surface, ...surface.querySelectorAll("*")]) {
      const style = getComputedStyle(node);
      if (style.animationName && style.animationName !== "none") { offenders.push({ at: here(surface), reason: `${name(node)} has animation-name ${style.animationName}` }); break; }
      if (style.transitionDuration && !/^(?:0s,?\s*)+$/.test(style.transitionDuration)) { offenders.push({ at: here(surface), reason: `${name(node)} has a transition (${style.transitionDuration})` }); break; }
    }
  }
  return { surfaces: surfaces.length, found, offenders: offenders.slice(0, 20) };
}

/**
 * What a scene may ask of the places: a member working is moving in the list (`list`) and in the thinking line (`line`),
 * and nothing else is moving, ever. Returns the problems in words; an empty list is a pass.
 */
export function placesProblems(result, expect = {}) {
  const problems = result.offenders.map(offender => `a slime moves or could move at ${offender.at}: ${offender.reason}`);
  if (expect.list && result.found.list === 0) problems.push("no slime moves in the member list while a member works");
  if (expect.line && result.found.line === 0) problems.push("no slime moves in the thinking line while a member works");
  if (expect.picturesOnly && (result.found.list || result.found.line)) problems.push("a slime moves where only pictures were expected");
  return problems;
}
