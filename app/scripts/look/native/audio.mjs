import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const speech = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $speaker.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
  $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $speaker.SetOutputToWaveFile($env:RAPHAEL_NATIVE_SYNTH_WAV, $format)
  $speaker.Speak('Please remember that the project colour is blue.')
} finally { $speaker.Dispose() }
`;

// The owner speaks Taiwan Chinese with English names in it: Hanhan says the Chinese, David the
// names. 「herder」 is how the owner's 「herdr」 sounds, 「grok bot」 his 「grokbot」.
const mixedSpeech = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $speaker.SetOutputToWaveFile($env:RAPHAEL_NATIVE_SYNTH_WAV, $format)
  $prompt = [System.Speech.Synthesis.PromptBuilder]::new()
  foreach ($part in ($env:RAPHAEL_NATIVE_SYNTH_PARTS | ConvertFrom-Json)) {
    $prompt.StartVoice($(if ($part.en) { 'Microsoft David Desktop' } else { 'Microsoft Hanhan Desktop' }))
    $prompt.AppendText($part.text)
    $prompt.EndVoice()
  }
  $speaker.Speak($prompt)
} finally { $speaker.Dispose() }
`;

// A remark, never a request: the corrected message reaches a real model, which must find nothing to do.
export const DICTIONARY_SPEECH = [{ text: "我覺得" }, { text: "herder", en: true }, { text: "跟" }, { text: "grok bot", en: true }, { text: "都很好用" }];

export async function prepareDictionarySample(directory, { executeCommand = execute } = {}) {
  const file = join(directory, "dictation.wav");
  // The words go as data in the environment, never as PowerShell source.
  await executeCommand(join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", mixedSpeech],
    { windowsHide: true, timeout: 30000, env: { ...process.env, RAPHAEL_NATIVE_SYNTH_WAV: file, RAPHAEL_NATIVE_SYNTH_PARTS: JSON.stringify(DICTIONARY_SPEECH) } });
  return { file, source: "Windows System.Speech (Hanhan zh-TW, David en-US)" };
}

export async function prepareVoiceSample(directory, { override = process.env.RAPHAEL_NATIVE_WAV, executeCommand = execute } = {}) {
  const file = join(directory, "voice.wav");
  if (override) await copyFile(override, file);
  else {
    // Pass the destination as data, including spaces and quotes, never as PowerShell source.
    await executeCommand(join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", speech],
      { windowsHide: true, timeout: 30000, env: { ...process.env, RAPHAEL_NATIVE_SYNTH_WAV: file } });
  }
  return { file, source: override ? "RAPHAEL_NATIVE_WAV" : "Windows System.Speech" };
}

export function requireVoiceModels(readiness) {
  if (!readiness.missing.length) return;
  const error = new Error(`Missing local speech model: ${readiness.missing.map(model => `${model.name} folder ${model.folder} (missing ${model.files.join(", ")})`).join("; ")}. Set RAPHAEL_MODELS_DIR to an installed model root. No download or engine fallback is allowed.`);
  error.code = "NATIVE_MODEL_MISSING";
  error.models = readiness.missing;
  throw error;
}
