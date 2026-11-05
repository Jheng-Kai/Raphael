// A single full routine editor, shared by the member panel, calendar and automation list.
import { routineRunState, runStatusWords, testRoutine, watchRoutineRuns } from "./routine-run";
import type { RoutineRun } from "./types";
import { detectedTimezone, zonedTime } from "./timezones";
import * as api from "./api";
import { dayLabel, describeError, formatClock } from "./format";
import { t } from "./i18n";
import { openDialog, confirmDelete, type Dialog } from "./member-dialogs";
import { dayName, faceHTML, HOUR_STEPS, isTime, ROUTINE_TITLE_MAX, ROUTINE_PROMPT_MAX, routineSentenceHTML, routineStatus } from "./members";
import { dateKey, openDatePicker, windowTimes } from "./schedule-picker";
import type { Member, Routine, RoutineSchedule, RoutineWhen } from "./types";
import { btn, copyButton, copyLabel, esc, ico, openMenu, sel, tg, toaster } from "./ui";
import "./automations.css";

export interface RoutineDialogOptions {
  members: readonly Member[];
  memberId?: number;
  routine?: Routine;
  date?: string;
  time?: string;
  onSaved?(routine: Routine): void;
  onDeleted?(): void;
  /** Profiles can keep routines local until a new member has been created. */
  save?(fields: Pick<Routine, "member_id" | "title" | "prompt" | "schedule" | "when">): Promise<Routine>;
  delete?(): Promise<void>;
}

export function openRoutineDialog(o: RoutineDialogOptions): Dialog {
  const routine = o.routine, plan = routine?.schedule;
  let timezone = plan?.timezone ?? detectedTimezone();
  let when: RoutineWhen | null = routine?.when ? structuredClone(routine.when) : null;
  let trigger = when?.webhook ? "webhook" : when ? "event" : "schedule";
  let history: RoutineRun[] = [], historyError = "", recipe = "sentry", eventContains = "";
  let stopWatching = (): void => {};
  let address = "", secret = "", hookError = "";
  let tunnel = false, tunnelTool = "tailscale", tunnelUrl = "", tunnelResult = "", tunnelBusy = false, hookAuth = "bearer";
  let addressChanged = false;
  let choices: api.RoutineEventChoice[] = [], eventId = "", eventValue = "", eventError = "", checking = false, generation = 0;
  const selectedEvent = () => choices.find(choice => choice.id === eventId);
  let noApps = false;
  const triggerChoices = () => ["schedule", "event", "webhook"].map(value => ({value, label:t(`trigger.${value}` as "trigger.schedule" | "trigger.event" | "trigger.webhook")}));
  let memberId = routine?.member_id ?? o.memberId ?? 0;
  let kind: RoutineSchedule["kind"] = plan?.kind ?? "once";
  const next = new Date(Date.now() + 3600000);
  let date = plan?.start_date ?? o.date ?? dateKey(next);
  let time = plan?.time ?? o.time ?? `${String(next.getHours()).padStart(2, "0")}:00`;
  let days = new Set(plan?.kind === "weekly" ? plan.days : [new Date(`${date}T00:00`).getDay()]);
  let hours = plan?.kind === "every" ? plan.hours ?? 3 : 3;
  let minutes = plan?.kind === "every" ? plan.minutes ?? 0 : 0;
  let monthDay = String(plan?.kind === "monthly" ? plan.day : 1);
  const intervalChoices = () => [...[5,10,15,30].map(n=>({value:`m${n}`,label:t("trigger.minutes",{p0:n})})), ...HOUR_STEPS.map(n=>({value:String(n),label:t("members.everyHours",{p0:n})}))];
  let windowFrom = plan?.kind === "every" ? plan.from ?? "" : "";
  let windowTo = plan?.kind === "every" ? plan.to ?? "" : "";
  let ending = plan?.max_runs ? "after" : plan?.until ? "until" : "never";
  let until = plan?.until ?? date;
  let count = String(plan?.max_runs ?? 10);
  let title = routine?.title ?? "", prompt = routine?.prompt ?? "";
  let enabled = routine?.enabled ?? true;
  let more = !!(plan?.max_runs || plan?.until), saving = false;
  let dialog: Dialog;
  function currentSchedule(): RoutineSchedule {
    const common = {start_date:date, timezone, ...(ending === "after" ? {max_runs:Number(count)} : {}), ...(ending === "until" ? {until} : {})};
    return kind === "every" ? {kind, ...(minutes ? {minutes} : {hours}), time, ...common, ...(windowFrom ? {from:windowFrom,to:windowTo} : {})}
      : kind === "weekly" ? {kind,days:[...days].sort(),time,...common}
      : kind === "monthly" ? {kind,day:Number(monthDay),time,...common} : {kind,time,...common};
  }
  const endChoices = (): { value: string; label: string }[] => [
    { value: "never", label: t("auto.never") }, { value: "after", label: t("auto.after") }, { value: "until", label: t("auto.until") },
  ];
  function read(): void {
    tunnelUrl = dialog.el.querySelector<HTMLInputElement>("[data-tunnel-url]")?.value ?? tunnelUrl;
    eventContains = dialog.el.querySelector<HTMLInputElement>("#au-event-contains")?.value ?? eventContains;
    eventValue = dialog.el.querySelector<HTMLInputElement>("#au-event-value")?.value ?? eventValue;
    if (when && !when.webhook) when.filter.equals = dialog.el.querySelector<HTMLInputElement>("#au-filter")?.value ?? when.filter.equals;
    monthDay = dialog.el.querySelector<HTMLInputElement>("#au-month-day")?.value ?? monthDay;
    title = dialog.el.querySelector<HTMLInputElement>("#au-title")?.value ?? title;
    prompt = dialog.el.querySelector<HTMLTextAreaElement>("#au-prompt")?.value ?? prompt;
    time = dialog.el.querySelector<HTMLInputElement>("#au-time")?.value ?? time;
    count = dialog.el.querySelector<HTMLInputElement>("#au-count")?.value ?? count;
  }
  function runBody(): string {
    if (!routine) return "";
    const state = routineRunState(routine.id);
    const now = Date.now();
    const runTime = (run: RoutineRun): string => `${dayLabel(run.started, now)} ${formatClock(run.started)}`;
    return `<section class="au-field au-test"><div class="au-chips">${btn(esc(t(state.running ? "routine.testing" : "routine.test")), "sm", ` data-dlg="test"${state.running ? ' disabled aria-busy="true"' : ""}`)}</div><p class="note">${esc(t("routine.testHelp"))}</p><p role="${state.reason ? "alert" : "status"}" class="au-test-status">${esc(state.reason || (state.run ? `${runStatusWords(state.run.status)} · ${runTime(state.run)}${state.run.summary ? ` · ${state.run.summary}` : ""}` : ""))}</p></section><section class="au-field au-run-history"><h3>${esc(t("routine.history"))}</h3>${historyError ? `<p role="alert">${esc(historyError)}</p>` : history.length ? history.map(run => `<p data-run-status="${esc(run.status)}"><strong>${esc(runStatusWords(run.status))}</strong> · ${esc(runTime(run))}${run.summary ? `<br>${esc(run.summary)}` : ""}</p>`).join("") : `<p class="note">${esc(t("routine.noRuns"))}</p>`}</section>`;
  }
  async function loadHistory(): Promise<void> {
    if (!routine) return;
    try { history = (await api.routineRuns(routine.id)).runs; historyError = ""; }
    catch (error) { historyError = describeError(error); }
    if (dialog.el.isConnected) paintRuns();
  }
  function paintRuns(): void {
    const section = dialog.el.querySelector(".au-run-section");
    if (section) section.innerHTML = runBody();
  }
  function recipeBody(): string {
    return `<div class="au-chips">${sel([{value:"sentry",label:"Sentry"},{value:"pagerduty",label:"PagerDuty"}],recipe,t("recipe.title"),' data-dlg="recipe"')}</div><p class="note">${esc(t(recipe === "sentry" ? "recipe.sentry" : "recipe.pagerduty"))}</p><code class="au-recipe-fields" data-json-paths>${esc(recipe === "sentry" ? 'action · data.issue.id · data.issue.title · data.issue.permalink · data.event.event_id · data.event.message' : 'event.id · event.event_type · event.occurred_at · event.data.id · event.data.title · event.data.html_url · event.data.urgency')}</code>`;
  }
  function body(): string {
    const kinds: [RoutineSchedule["kind"], string][] = [["once", t("auto.once")], ["daily", t("members.daily")], ["weekdays", t("auto.weekdays")], ["weekly", t("members.weekly")], ["monthly", t("trigger.monthly")], ["every", t("trigger.every")]];
    return `<input class="mb-fin au-title" id="au-title" maxlength="${ROUTINE_TITLE_MAX}" placeholder="${esc(t("auto.what"))}" aria-label="${esc(t("auto.what"))}" value="${esc(title)}">` +
      (routine ? `<div class="mp-resource"><span>${esc(t(enabled ? "computer.routineOn" : "computer.routinePaused"))}</span>${tg(enabled, t("members.routineSwitch", {p0: routine.title}), ' data-dlg="enabled"')}</div>` : "") +
      `<section class="au-field"><h3>${esc(t("auto.when"))}</h3>${sel(triggerChoices(),trigger,t("trigger.trigger"),' data-dlg="trigger"')}</section>` +
      (trigger === "webhook" ? `<section class="au-field au-webhook"><p>${routineSentenceHTML({schedule:null,when:{webhook:true}})}</p><p class="note">${esc(t("trigger.hookHelp"))}</p><p class="note">${esc(t("recipe.public"))}</p>${recipeBody()}${routine && routine.when?.webhook ? `<code class="au-hook-address">${esc(address)}</code><label class="field sc-field">${ico("lock")}<input class="au-hook-secret" readonly type="${secret ? "text" : "password"}" value="${esc(secret || "********")}" aria-label="${esc(t("trigger.secret"))}" autocomplete="off" spellcheck="false"></label><div class="au-chips">${btn(esc(t(secret ? "trigger.hideSecret" : "tunnel.key")),"sm",' data-dlg="hook-show"')}${btn(copyLabel(t("trigger.copySecret")),"sm",` data-dlg="hook-copy"${secret ? "" : " disabled"}`)}${btn(copyLabel(t("recipe.copyUrl")),"sm",' data-dlg="hook-url"')}${btn(copyLabel(t("recipe.copyHeader")),"sm",` data-dlg="hook-header"${secret ? "" : " disabled"}`)}</div>${tunnelBody()}${secret ? `<p class="note">${esc(t("tunnel.once"))}</p>` : ""}${addressChanged ? `<p role="status">${esc(t("trigger.addressChanged"))}</p>` : ""}${hookError ? `<p role="alert">${esc(hookError)}</p>` : ""}` : `<p class="note">${esc(t("trigger.hookSaved"))}</p>`}</section>` :
      trigger === "event" && (!when || eventId) ? eventBody() :
      when && !when.webhook ? `<section class="au-field au-event"><h3>${esc(t("auto.onEvent"))}</h3><p>${routineSentenceHTML({ schedule:null, app_name:routine?.app_name, when })}</p>${when.filter.field ? `<label>${esc(t("auto.triggerFilter"))}<input class="mb-fin" id="au-filter" maxlength="300" value="${esc(when.filter.equals)}"></label>` : ""}<p class="note">${esc(t("auto.triggerHelp"))}</p><p class="note">${esc(routine ? routineStatus(routine) : "")}</p>${routine?.last_error ? btn(esc(t("auto.connections")), "sm", ' data-dlg="connections" data-missing-repair="connections"') : ""}</section>` : `<section class="au-field"><p class="au-trigger-preview">${routineSentenceHTML({schedule:currentSchedule()})}</p><div class="au-start"><span>${esc(t("auto.starts"))}</span>${btn(esc(date), "", ' data-dlg="date" aria-label="' + esc(t("auto.date")) + '"')}<input class="mb-fin au-time" id="au-time" type="text" inputmode="numeric" maxlength="5" value="${esc(kind === "every" && windowFrom ? windowFrom : time)}"${kind === "every" && windowFrom ? " disabled" : ""} aria-label="${esc(t("auto.time"))}" placeholder="00:00"></div>` +
      `<div class="au-chips">${kinds.map(([value, label]) => btn(esc(label), "sm", ` data-dlg="kind" data-kind="${value}" aria-pressed="${kind === value}"`)).join("")}</div>` +
      (kind === "weekly" ? `<div class="au-chips">${[1,2,3,4,5,6,0].map(n => btn(esc(dayName(n)), "sm", ` data-dlg="day" data-day="${n}" aria-pressed="${days.has(n)}"`)).join("")}</div>` : "") +
      `<div class="au-repeat-options${kind === "every" || kind === "monthly" ? "" : " is-reserved"}"${kind === "every" || kind === "monthly" ? "" : ' inert aria-hidden="true"'}>` +
      (kind === "monthly" ? `<label>${esc(t("trigger.monthDay"))}<input id="au-month-day" class="mb-fin" type="number" min="1" max="31" value="${esc(monthDay)}"></label>` : sel(intervalChoices(), minutes ? `m${minutes}` : String(hours), t("members.hours"), ' data-dlg="hours"')) +
      `<div class="au-window"${kind === "monthly" ? " hidden" : ""}>${sel([{value:"",label:t("auto.anyTime")}, ...windowTimes(windowFrom || "08:00")], windowFrom, t("auto.windowFrom"), ' data-dlg="window-from"')}` +
      `<span>–</span>${sel(windowTimes(windowTo || "23:00"), windowTo || "23:00", t("auto.windowTo"), ' data-dlg="window-to"')}</div></div></section>`) +
      `<section class="au-field"><h3>${esc(t("auto.who"))}</h3><div class="au-members">${o.members.filter(m => !when || when.webhook || m.id === memberId).map(m => btn(faceHTML(m, 30) + `<span>${esc(m.name)}</span>${memberId === m.id ? ico("check") : ""}`, "", ` data-dlg="member" data-member="${m.id}" aria-pressed="${memberId === m.id}"${routine ? " disabled" : ""}`)).join("")}</div></section>` +
      `<label class="au-field"><span class="au-label">${esc(t("members.instructions"))}</span><textarea id="au-prompt" class="mb-fin mb-ta" rows="4" maxlength="${ROUTINE_PROMPT_MAX}" aria-label="${esc(t("members.instructions"))}">${esc(prompt)}</textarea></label>` +
      (trigger !== "schedule" ? "" : btn(ico(more ? "down" : "right") + esc(t(more ? "auto.less" : "auto.more")), "sm", ` data-dlg="more" aria-expanded="${more}"`) +
      (more ? `<section class="au-more"><label class="au-field"><span>${esc(t("auto.end"))}</span>${sel(endChoices(), ending, t("auto.end"), ' data-dlg="end"')}` +
      (ending === "after" ? `<input id="au-count" class="mb-fin" type="number" min="1" max="10000" value="${esc(count)}" aria-label="${esc(t("auto.after"))}">` : ending === "until" ? btn(esc(until), "", ' data-dlg="until"') : "") +
      `</label><div class="au-field"><span>${esc(t("auto.results"))}</span>${sel([{ value: "main", label: t("auto.mainThread") }], "main", t("auto.results"), ' data-dlg="destination"')}</div></section>` : "")) + (routine ? `<div class="au-run-section">${runBody()}</div>` : "");
  }
  function tunnelCommand(): string {
    const port = /^http:\/\/127\.0\.0\.1:(\d+)\//.exec(address)?.[1];
    if (!port) return "";
    return tunnelTool === "tailscale" ? `tailscale funnel --bg http://127.0.0.1:${port}` : tunnelTool === "cloudflare" ? `cloudflared tunnel --url http://127.0.0.1:${port}` : `ngrok http http://127.0.0.1:${port}`;
  }
  function tunnelBody(): string {
    return btn(esc(t("tunnel.title")), "sm", ` data-dlg="tunnel" aria-expanded="${tunnel}"`) + (!tunnel ? "" :
      `<section class="au-tunnel"><p class="note">${esc(t("tunnel.help"))}</p><div class="au-chips">${["tailscale", "cloudflare", "ngrok"].map(value => btn(esc({tailscale:"Tailscale Funnel",cloudflare:"Cloudflare Tunnel",ngrok:"ngrok"}[value]!), "sm", ` data-dlg="tunnel-tool" data-tool="${value}" aria-pressed="${tunnelTool === value}"`)).join("")}</div>` +
      `<code class="au-hook-address">${esc(tunnelCommand())}</code>${btn(copyLabel(t("tunnel.copyCommand")), "sm", ' data-dlg="tunnel-command"')}` +
      `<label class="au-field">${esc(t("tunnel.url"))}<input class="mb-fin" data-tunnel-url value="${esc(tunnelUrl)}" type="url" placeholder="https://example.ts.net" autocomplete="off"></label>` +
      `${btn(esc(t(tunnelBusy ? "tunnel.testing" : "tunnel.test")), "sm", ` data-dlg="tunnel-test"${tunnelBusy ? " disabled" : ""}`)}<p role="status">${esc(tunnelResult)}</p>` +
      `<div class="au-chips"><span>${esc(t("tunnel.auth"))}</span>${["bearer", "hmac"].map(value => btn(value === "bearer" ? "Bearer" : "HMAC-SHA256", "sm", ` data-dlg="hook-auth" data-auth="${value}" aria-pressed="${hookAuth === value}"`)).join("")}</div><p class="note">${esc(t("tunnel.on"))}</p></section>`);
  }
  async function testTunnel(): Promise<void> {
    if (!routine || tunnelBusy) return;
    tunnelUrl = dialog.el.querySelector<HTMLInputElement>("[data-tunnel-url]")?.value.trim() || "";
    tunnelBusy = true; tunnelResult = ""; read(); draw();
    try {
      const result = await api.core<{tested: boolean; address: string}>("routines.webhook", {id:routine.id, url:tunnelUrl});
      if (result.tested) {tunnelUrl = result.address; tunnelResult = t("tunnel.passed");}
    } catch (error) {tunnelResult = describeError(error);}
    finally {tunnelBusy = false; if (dialog.el.isConnected) draw();}
  }
  function eventBody(): string {
    const choice = selectedEvent();
    if (!choices.length) return `<section class="au-field au-event"><p>${esc(eventError || t(noApps ? "trigger.noApps" : "trigger.emptyEvents"))}</p>${btn(esc(t("auto.connections")),"sm",' data-dlg="connections" data-missing-repair="connections"')}</section>`;
    return `<section class="au-field au-event"><div class="au-chips">${sel([{value:"",label:t("trigger.pickEvent")},...choices.map(c=>({value:c.id,label:`${c.app_name} · ${c.label}`}))],eventId,t("auto.onEvent"),' data-dlg="event"')}` +
      (choice?.input ? `<label>${esc(t(choice.input === "repository" ? "trigger.repository" : "trigger.channel"))}<input class="mb-fin" id="au-event-value" maxlength="500" value="${esc(eventValue)}" aria-label="${esc(t(choice.input === "repository" ? "trigger.repository" : "trigger.channel"))}" placeholder="${esc(choice.input === "repository" ? t("trigger.repositoryHint") : "")}"></label>` : "") +
      (choice?.id === "slack-message" ? `<label>${esc(t("recipe.slackFilter"))}<input class="mb-fin" id="au-event-contains" maxlength="300" value="${esc(eventContains)}" placeholder="${esc(t("recipe.slackHint"))}"></label>` : "") +
      (choice ? btn(esc(t(checking ? "trigger.checking" : eventError ? "trigger.retry" : "trigger.checkEvent")),"sm",` data-dlg="event-check"${checking ? " disabled" : ""}`) : "") +
      `</div><p class="note au-event-status" role="${eventError ? "alert" : "status"}">${esc(eventError || (when ? t("trigger.eventReady") : t("trigger.eventHelp")))}</p></section>`;
  }
  async function loadEvents(): Promise<void> {
    const ticket = ++generation;
    try {
      const result = await api.routinesList(memberId);
      if (!dialog.el.isConnected || ticket !== generation || trigger !== "event") return;
      read(); choices=result.events ?? []; noApps=result.event_apps?.length === 0; eventError=""; draw();
    } catch (error) {
      if (dialog.el.isConnected && ticket === generation) { eventError=describeError(error); draw(); }
    }
  }
  async function checkEvent(): Promise<void> {
    if (checking || !selectedEvent()) return;
    read();
    const ticket = ++generation;
    checking=true; when=null; eventError=""; draw();
    try {
      const result = await api.routinesList(memberId,{event:eventId,value:eventValue,...(eventId === "slack-message" ? {contains:eventContains} : {})});
      if (!dialog.el.isConnected || ticket !== generation || trigger !== "event") return;
      when=result.when ?? null; eventError=result.event_error ?? "";
    } catch (error) {
      if (ticket === generation) eventError=describeError(error);
    } finally {
      if (dialog.el.isConnected && ticket === generation) { checking=false; read(); draw(); }
    }
  }
  function draw(): void {
    dialog.el.querySelector(".mb-dlg-body")!.innerHTML = body();
    dialog.el.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled = trigger === "event" && !when;
  }
  async function hookAction(action: string, control?: HTMLElement): Promise<void> {
    if (!routine || !routine.when?.webhook) return;
    if (action === "hook-show" && secret) { secret = ""; read(); draw(); return; }
    control?.setAttribute("aria-busy", "true");
    if (control instanceof HTMLButtonElement) control.disabled = true;
    try {
      if (action === "hook-copy" || action === "hook-header") {
        if (!secret) return;
        if (control) await copyButton(control, action === "hook-copy" ? secret : hookAuth === "bearer" ? `Authorization: Bearer ${secret}` : `X-Raphael-Signature: sha256=<HMAC-SHA256(${secret}, raw request body)>`);
        return;
      }
      const result = action === "hook-show" ? await api.core<{address:string;secret?:string;address_changed?:boolean}>("routines.webhook", {id:routine.id,reveal:true,rotate:true}) : await api.routineWebhook(routine.id);
      if (!dialog.el.isConnected) return;
      address = result.address;
      addressChanged = !!result.address_changed;
      if (action === "hook-url") { if (control) await copyButton(control, result.address); return; }
      if (action === "hook-show") secret = result.secret ?? "";
      hookError = "";
    } catch (error) { hookError = describeError(error); }
    finally { control?.removeAttribute("aria-busy"); if (control instanceof HTMLButtonElement) control.disabled = false; }
    if (dialog.el.isConnected) { read(); draw(); }
  }
  async function save(): Promise<void> {
    if (saving || (trigger === "event" && !when)) return;
    read();
    if (trigger === "schedule" && kind === "every" && windowFrom && (!isTime(windowFrom) || !isTime(windowTo) || windowFrom >= windowTo)) { toaster.info(t("auto.needsWindow")); return; }
    const start = new Date(zonedTime(date, time, timezone));
    if (!title.trim() || !prompt.trim() || (when ? (!when.webhook && !!when.filter.field && !when.filter.equals.trim()) : !isTime(time) || !Number.isFinite(start.getTime()) || (kind === "monthly" && (!/^\d+$/.test(monthDay) || Number(monthDay)<1 || Number(monthDay)>31)) || (kind === "weekly" && !days.size) || (ending === "after" && (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 10000)) || (ending === "until" && until < date))) {
      toaster.info(t("auto.needs")); return;
    }
    if (!when && !routine && kind === "once" && start.getTime() <= Date.now()) { toaster.info(t("auto.future")); return; }
    const schedule = currentSchedule();
    saving = true;
    dialog.el.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled = true;
    try {
      const fields = { member_id: memberId, title: title.trim(), prompt: prompt.trim(), schedule: when ? null : schedule, ...(when ? { when } : {}) };
      const result = o.save ? { routine: await o.save(fields) } : routine ? await api.routinesUpdate(routine.id, { title: fields.title, prompt: fields.prompt, ...(enabled !== routine.enabled ? {enabled} : {}), ...(when ? { when } : { schedule }) }) : await api.routinesCreate(fields);
      dialog.close(); o.onSaved?.(result.routine);
    } catch (error) { toaster.info(describeError(error)); }
    finally { saving = false; const save = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="save"]'); if (save) save.disabled = false; }
  }
  dialog = openDialog({ title: t(routine ? "auto.editRoutine" : "auto.newRoutine"), body: body(), cls: "au-routine-dialog",
    actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), destructive: routine ? { label: esc(t("auto.delete")), attrs: ' data-dlg="delete"' } : undefined, primary: { label: esc(t("members.save")), attrs: ' data-dlg="save"' } },
    onClose: () => {secret = ""; const field = dialog.el.querySelector<HTMLInputElement>(".au-hook-secret"); if (field) field.value = ""; stopWatching();}, canClose: () => !saving, onEnter: () => void save(),
    onAct(act, target) {
      read();
      if (act === "tunnel") {tunnel = !tunnel; draw();}
      else if (act === "tunnel-tool") {tunnelUrl = dialog.el.querySelector<HTMLInputElement>("[data-tunnel-url]")?.value || tunnelUrl; tunnelTool = target.dataset.tool!; draw();}
      else if (act === "tunnel-command") void copyButton(target, tunnelCommand());
      else if (act === "tunnel-test") void testTunnel();
      else if (act === "hook-auth") {hookAuth = target.dataset.auth!; draw();}
      else if (act === "test" && routine) void testRoutine(routine.id);
      else if (act === "recipe") openMenu(target, [{value:"sentry",label:"Sentry"},{value:"pagerduty",label:"PagerDuty"}], recipe, value => {recipe=value; draw();});
      else if (act === "save") void save();
      else if (act === "connections") dialog.close();
      else if (act === "cancel") dialog.close();
      else if (act === "enabled") { enabled = !enabled; draw(); }
      else if (act === "trigger") openMenu(target, triggerChoices(),trigger,value=>{
        generation++; checking=false; eventId=""; eventValue=""; eventError=""; trigger=value; when=value === "webhook" ? {webhook:true} : value === "event" ? routine?.when && !routine.when.webhook ? structuredClone(routine.when) : null : null; secret=""; draw();
        if (value === "event" && !when) void loadEvents();
      });
      else if (act === "event") openMenu(target, choices.map(choice=>({value:choice.id,label:`${choice.app_name} · ${choice.label}`})), eventId, value=>{
        generation++; checking=false; eventId=value; eventValue=""; eventError=""; when=null; draw();
        if (!selectedEvent()?.input) void checkEvent();
      });
      else if (act === "event-check") void checkEvent();
      else if (act === "hook-show" || act === "hook-copy" || act === "hook-url" || act === "hook-header") void hookAction(act, target);
      else if (act === "kind") { kind = target.dataset.kind as typeof kind; draw(); }
      else if (act === "day") { const n = Number(target.dataset.day); if (days.has(n)) days.delete(n); else days.add(n); draw(); }
      else if (act === "destination") openMenu(target, [{ value: "main", label: t("auto.mainThread") }], "main", () => {});
      else if (act === "member") { memberId = Number(target.dataset.member); if (trigger === "event" && eventId) { generation++; checking=false; when=null; eventError=""; } draw(); }
      else if (act === "more") { more = !more; draw(); }
      else if (act === "date" || act === "until") openDatePicker(target, act === "date" ? date : until, key => { if (act === "date") date = key; else until = key; draw(); dialog.el.querySelector<HTMLElement>(`[data-dlg="${act}"]`)?.focus(); });
      else if (act === "hours") openMenu(target, intervalChoices(), minutes ? `m${minutes}` : String(hours), n => { minutes = n.startsWith("m") ? Number(n.slice(1)) : 0; if (!minutes) hours=Number(n); draw(); });
      else if (act === "window-from") openMenu(target, [{value:"",label:t("auto.anyTime")}, ...windowTimes(windowFrom || "08:00")], windowFrom, value => { windowFrom = value; if (value && !windowTo) windowTo = "23:00"; draw(); dialog.el.querySelector<HTMLElement>('[data-dlg="window-from"]')?.focus(); });
      else if (act === "window-to") openMenu(target, windowTimes(windowTo || "23:00"), windowTo, value => { windowTo = value; if (!windowFrom) windowFrom = "08:00"; draw(); dialog.el.querySelector<HTMLElement>('[data-dlg="window-to"]')?.focus(); });
      else if (act === "end") openMenu(target, endChoices(), ending, value => { ending = value; draw(); });
      else if (act === "delete" && routine) void confirmDelete(routine.title).then(async yes => {
        if (!yes) return;
        try { if (o.delete) await o.delete(); else await api.routinesDelete(routine.id); dialog.close(); o.onDeleted?.(); toaster.info(t("members.deleted", {p0:routine.title})); } catch (error) { toaster.info(describeError(error)); }
      });
    },
  });
  dialog.el.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement && ["au-event-value", "au-event-contains"].includes(event.target.id)) {
      read(); generation++; checking=false; when=null; eventError="";
      dialog.el.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled=true;
      const check = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="event-check"]');
      if (check) { check.disabled=false; check.textContent=t("trigger.checkEvent"); }
      const status = dialog.el.querySelector(".au-event-status");
      if (status) { status.textContent=t("trigger.eventHelp"); status.setAttribute("role","status"); }
      return;
    }
    if (!(event.target instanceof HTMLElement) || !["au-time", "au-month-day"].includes(event.target.id)) return;
    read();
    const preview = dialog.el.querySelector(".au-trigger-preview"), html = routineSentenceHTML({schedule:currentSchedule()});
    if (preview && preview.innerHTML !== html) preview.innerHTML = html;
  });
  if (routine) { stopWatching = watchRoutineRuns(() => { if (!dialog.el.isConnected) { stopWatching(); return; } paintRuns(); void loadHistory(); }); void loadHistory(); }
  if (!plan?.timezone) void (async () => {
    try {
      const {settings} = await api.settingsGet();
      if (!dialog.el.isConnected) return;
      timezone = settings.routine_timezone || detectedTimezone();
      read();
      const preview = dialog.el.querySelector(".au-trigger-preview");
      if (preview) preview.innerHTML = routineSentenceHTML({schedule:currentSchedule()});
    } catch { /* Keep the detected zone while settings are unavailable. */ }
  })();
  if (routine?.when?.webhook) void hookAction("address");
  return dialog;
}
