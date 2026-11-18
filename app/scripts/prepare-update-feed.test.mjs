import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareUpdateFeed } from "./prepare-update-feed.mjs";
const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");

test("publication requires both version-bound assets and never writes a partial feed", () => {
  const cache = new URL("../.test-cache/", import.meta.url);
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(new URL("feed-", cache));
  const win = "Raphael-1.2.3-windows-x64-setup.exe";
  const mac = "Raphael-1.2.3-macos-arm64.app.tar.gz";
  const signature = (name, version) => Buffer.from(
    ["untrusted comment: test", "fixture", "trusted comment: file:" + name + "\tversion:" + version, "fixture"].join("\n")
  ).toString("base64");
  const notes = 'Release notes\nwith "quotes" and $shell characters.';
  const writeFeed = () => prepareUpdateFeed(directory, "1.2.3", notes);
  const path = join(directory, "latest.json");
  try {
    writeFileSync(join(directory, win), "Windows fixture");
    writeFileSync(join(directory, win + ".sig"), signature(win, "1.2.3"));
    assert.throws(writeFeed, /ENOENT/);
    writeFileSync(join(directory, mac), "Mac fixture");
    assert.throws(writeFeed, /ENOENT/);
    writeFileSync(join(directory, mac + ".sig"), signature(mac, "1.2.2"));
    assert.throws(writeFeed, /bind this release version/);
    assert.equal(existsSync(path), false);
    writeFileSync(join(directory, mac + ".sig"), signature(mac, "1.2.3") + "\r\n");
    writeFeed();
    const feed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(feed.notes, notes);
    assert.equal(feed.version, "1.2.3");
    assert.deepEqual(Object.keys(feed.platforms).sort(), ["darwin-aarch64", "windows-x86_64"]);
    for (const [platform, name] of [["darwin-aarch64", mac], ["windows-x86_64", win]]) {
      assert.deepEqual(feed.platforms[platform], {
        url: "https://github.com/Jheng-Kai/Raphael/releases/download/v1.2.3/" + name,
        signature: signature(name, "1.2.3"),
      });
    }
    assert.throws(writeFeed, /EEXIST/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
