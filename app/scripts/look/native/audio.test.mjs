import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareVoiceSample, requireVoiceModels } from "./audio.mjs";

const directories = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "raphael-native-audio-"));
  directories.push(root);
  const run = join(root, "speech's run");
  await mkdir(run);
  return run;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

it("creates its own offline speech sample with no owner data directory", async () => {
  const run = await directory();
  vi.stubEnv("APPDATA", join(run, "absent-owner-data"));
  vi.stubEnv("RAPHAEL_NATIVE_WAV", "");
  const executeCommand = vi.fn(async (_program, _args, options) => {
    await writeFile(options.env.RAPHAEL_NATIVE_SYNTH_WAV, "generated speech");
  });
  const sample = await prepareVoiceSample(run, { executeCommand });
  expect(await readFile(sample.file, "utf8")).toBe("generated speech");
  expect(sample.source).toBe("Windows System.Speech");
  expect(executeCommand).toHaveBeenCalledOnce();
  const [program, args, options] = executeCommand.mock.calls[0];
  expect(program).toMatch(/WindowsPowerShell[/\\]v1\.0[/\\]powershell\.exe$/);
  expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
  expect(args[3]).toContain("System.Speech");
  expect(args[3]).not.toContain(run);
  expect(options).toMatchObject({ windowsHide: true, timeout: 30000, env: { RAPHAEL_NATIVE_SYNTH_WAV: join(run, "voice.wav") } });
});

it("copies the explicit WAV override without invoking speech synthesis", async () => {
  const run = await directory(), override = join(run, "custom.wav");
  await writeFile(override, "custom speech");
  vi.stubEnv("RAPHAEL_NATIVE_WAV", override);
  const executeCommand = vi.fn();
  const sample = await prepareVoiceSample(run, { executeCommand });
  expect(await readFile(sample.file, "utf8")).toBe("custom speech");
  expect(sample.source).toBe("RAPHAEL_NATIVE_WAV");
  expect(executeCommand).not.toHaveBeenCalled();
});

it("fails on an invalid override and never silently substitutes another sample", async () => {
  const run = await directory(), executeCommand = vi.fn();
  await expect(prepareVoiceSample(run, { override: join(run, "missing.wav"), executeCommand })).rejects.toThrow(/ENOENT/);
  expect(executeCommand).not.toHaveBeenCalled();
});

it("reports offline synthesizer failures without an owner sample fallback", async () => {
  const run = await directory();
  vi.stubEnv("APPDATA", join(run, "absent-owner-data"));
  vi.stubEnv("RAPHAEL_NATIVE_WAV", "");
  const executeCommand = vi.fn().mockRejectedValue(new Error("No installed speech voice"));
  await expect(prepareVoiceSample(run, { executeCommand })).rejects.toThrow("No installed speech voice");
});

it("blocks missing speech prerequisites with the exact model folder and keeps a ready model on the real path", () => {
  expect(() => requireVoiceModels({ missing: [] })).not.toThrow();
  const missing = [{ name: "qwen3-asr", folder: "Z:/absent/models/qwen3-asr", files: ["encoder.int8.onnx"] }];
  let blocked;
  try { requireVoiceModels({ missing }); } catch (error) { blocked = error; }
  expect(blocked).toMatchObject({ code: "NATIVE_MODEL_MISSING", models: missing });
  expect(blocked.message).toContain("qwen3-asr folder Z:/absent/models/qwen3-asr");
  expect(blocked.message).toContain("encoder.int8.onnx");
  expect(blocked.message).toContain("No download or engine fallback");
});
