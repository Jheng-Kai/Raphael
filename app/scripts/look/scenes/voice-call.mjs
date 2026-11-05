import { scene, member, wait, click, hover, check } from "./steps.mjs";

const idle = [member(1), wait('[data-voice-call-start="true"]')];
const start = [...idle, click('[data-voice-call-start="true"]')];
const call = state => [...start, wait(`.voice-call [data-call-state="${state}"]`)];

export default [
  scene("voice-call-idle-button", "The member voice button explains hold to speak and click to call", [...idle, hover('[data-voice-call-start="true"]'), wait('.message-tooltip:not([hidden])'), check("voice-call-idle")], {voiceCall: "idle"}),
  scene("voice-call-connecting", "The call replaces the composer while connecting", [...call("connecting"), check("voice-call-panel")], {voiceCall: "connecting"}),
  scene("voice-call-listening", "The member listens with mute and hang-up controls", [...call("listening"), check("voice-call-panel")], {voiceCall: "listening"}),
  scene("voice-call-speaking", "Member speech uses the existing character motion", [...call("speaking"), check("voice-call-panel")], {voiceCall: "speaking"}),
  scene("voice-call-transcript", "The live transcript is an explicit quiet disclosure", [...call("listening"), click('[data-call-act="transcript"]'), wait('.voice-call .vc-transcript'), check("voice-call-transcript")], {voiceCall: "listening"}),
  scene("voice-call-settings", "Voice, speed and auto-detected language reuse shared dropdown rows", [...call("listening"), click('[data-call-act="settings"]'), wait('.vc-settings'), check("voice-call-settings")], {voiceCall: "listening"}),
  scene("voice-call-ended-card", "Hang-up folds normal messages into one receipt and saves local feedback", [...call("listening"), click('[data-call-act="end"]'), wait('[data-call-card]'), click('[data-call-rating="good"]'), wait('[data-call-rating="good"][aria-pressed="true"]'), click('[data-call-card] summary'), wait('[data-call-card] details[open]'), check("voice-call-ended")], {voiceCall: "listening"}),
  scene("voice-call-no-mic", "The microphone repair keeps background questions directly above the composer", [...start, wait('.vc-card [data-missing-repair="dictation"]'), check("voice-call-no-mic")], {voiceCall: "no-mic"}),
  scene("voice-call-busy-confirm", "Starting another member call asks before ending the current one", [...start, wait('.vc-confirm'), check("voice-call-busy")], {voiceCall: "busy"}),
];
