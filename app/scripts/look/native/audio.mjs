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
