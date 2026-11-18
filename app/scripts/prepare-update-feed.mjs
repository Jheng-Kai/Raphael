import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function versionedSignature(path, version) {
  const signature = readFileSync(path, "utf8").trim();
  const comment = Buffer.from(signature, "base64").toString("utf8").split(/\r?\n/)[2];
  const versions = comment?.replace(/^trusted comment: /, "").split("\t").filter(field => field.startsWith("version:"));
  if (!comment?.startsWith("trusted comment: ") || versions.length !== 1 || versions[0] !== `version:${version}`) {
    throw new Error("Updater signature must bind this release version; use tauri signer sign --app-version.");
  }
  return signature;
}

export function prepareUpdateFeed(directory, version, notes) {
  if (typeof version !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error("Release version must use a numeric major.minor.patch.");
  }
  const platforms = {};
  for (const [platform, suffix] of [["windows-x86_64", "windows-x64-setup.exe"], ["darwin-aarch64", "macos-arm64.app.tar.gz"]]) {
    const name = `Raphael-${version}-${suffix}`;
    const path = join(directory, name);
    const artifact = statSync(path);
    if (!artifact.isFile() || !artifact.size) throw new Error(`Missing updater artifact: ${name}`);
    platforms[platform] = {
      signature: versionedSignature(path + ".sig", version),
      url: `https://github.com/Jheng-Kai/Raphael/releases/download/v${version}/${name}`,
    };
  }
  const feed = { version, notes, pub_date: new Date().toISOString(), platforms };
  writeFileSync(join(directory, "latest.json"), JSON.stringify(feed, null, 2) + "\n", { flag: "wx" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { RELEASE_VERSION, RELEASE_NOTES } = process.env;
  if (process.argv[2] === "--check-signature") versionedSignature(process.argv[3], RELEASE_VERSION);
  else prepareUpdateFeed(process.cwd(), RELEASE_VERSION, RELEASE_NOTES ?? "");
}
