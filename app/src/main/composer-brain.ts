/** The model of the open conversation, chosen next to where the owner writes. */
import * as api from "./api";
import { t } from "./i18n";
import { modelPickerHTML, mountModelPicker, type ModelPicker } from "./model-picker";
import { RAPHAEL_ID } from "./members";
import type { BrainSettings, CliBrain, Member, ModelCatalog } from "./types";
import { toaster } from "./ui";
import { describeError } from "./format";

export function mountComposerBrain(slot: HTMLElement, member: () => Member): { draw(): void; reload(): void } {
  let catalog: ModelCatalog | null = null, clis: CliBrain[] = [], answerModel = "", generation = 0;
  let picker: ModelPicker | null = null;
  function draw(): void {
    const who = member(), raphael = who.id === RAPHAEL_ID;
    const look = { role: "answer" as const, current: raphael ? answerModel : who.model || "", catalog, clis, label: t("members.brain"), key: "composer-brain",
      lead: raphael ? undefined : { id: "", name: t("members.inheritBrain") }, inheritFrom: raphael ? undefined : answerModel };
    // A draw that arrives while the list is open only repaints it.
    if (picker) { picker.update(look); return; }
    slot.innerHTML = modelPickerHTML(look);
    picker = mountModelPicker(slot, { ...look, onChoose: model => {
      const chosen = member();
      const saved = chosen.id === RAPHAEL_ID ? api.settingsSet("agent_model", model).then(result => { answerModel = result.settings.agent_model ?? model; })
        : api.membersUpdate(chosen.id, { model }).then(() => { chosen.model = model; });
      void saved.then(draw).catch(error => toaster.info(describeError(error)));
    } });
  }
  async function reload(): Promise<void> {
    const mine = ++generation;
    const [catalogResult, cliResult, settingsResult] = await Promise.allSettled([
      api.core<ModelCatalog>("models.catalog"),
      api.core<{ clis: CliBrain[] }>("brains.cli"),
      api.core<{ settings: BrainSettings }>("settings.get"),
    ]);
    if (mine !== generation) return;
    if (catalogResult.status === "fulfilled" && Array.isArray(catalogResult.value?.llm)) catalog = catalogResult.value;
    if (cliResult.status === "fulfilled") clis = cliResult.value?.clis ?? [];
    if (settingsResult.status === "fulfilled") answerModel = settingsResult.value?.settings?.agent_model ?? "";
    draw();
  }
  draw(); void reload();
  return { draw, reload: () => void reload() };
}
