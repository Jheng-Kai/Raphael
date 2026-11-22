import { Channel, invoke } from "@tauri-apps/api/core";
import { learnedPill, type LearnedEvent } from "./learned";
import { reportMouseRegions } from "./mouse-regions";
import { t } from "../main/i18n";

const mouse = reportMouseRegions(document.body, report => invoke("floating_controls", { ...report }), ".learned-undo");
const pill = learnedPill(document.querySelector<HTMLElement>("#learned-pill")!, {
  layout: (revision, width, height) => invoke("learned_layout", { revision, width, height }),
  finish: revision => invoke("learned_finish", { revision }),
});
const channel = new Channel<LearnedEvent>();
channel.onmessage = event => {
  if (event.type === "dismiss") pill.dismiss(event.revision);
  else if (pill.show(event)) mouse.reset(event.revision);
};
void invoke("learned_subscribe", { channel }).catch(() => {
  document.querySelector<HTMLElement>("#learned-pill")!.textContent = t("missing.learned");
});
