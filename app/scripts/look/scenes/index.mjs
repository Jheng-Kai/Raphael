import chat from "./chat.mjs";
import desktop from "./desktop.mjs";
import automations from "./automations.mjs";
import settings from "./settings.mjs";
import overlay from "./overlay.mjs";
import home from "./home.mjs";
import apps from "./apps.mjs";
import contextMenu from "./context-menu.mjs";
import ownerRound from "./owner-round.mjs";
import ownerRound3 from "./owner-round3.mjs";
import { withOwnerRound4, noNaming } from "./owner-round4.mjs";

export const scenes = withOwnerRound4([...home, ...chat, ...desktop, ...automations, ...settings, ...apps, ...contextMenu, ...overlay, ...ownerRound, ...ownerRound3, noNaming]);
if (new Set(scenes.map(scene => scene.name)).size !== scenes.length) throw new Error("Duplicate look scene name");
