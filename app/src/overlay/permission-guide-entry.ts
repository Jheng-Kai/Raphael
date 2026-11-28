import { Channel, invoke } from "@tauri-apps/api/core";
import { permissionGuide, type GuideShown } from "./permission-guide";

const guide = permissionGuide(document.querySelector<HTMLElement>("#permission-guide")!, {
  layout: (revision, width, height, tile) => invoke("permission_guide_layout", { revision, width, height, tile }),
  close: revision => invoke("permission_guide_close", { revision }),
});
const channel = new Channel<GuideShown>();
channel.onmessage = shown => { guide.show(shown); };
void invoke("permission_guide_subscribe", { channel }).catch(error => console.warn("the permission guide is not listening", error));
