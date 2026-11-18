// signer generate has no password environment option. Use the same CLI entry as
// npx tauri signer generate, so the password is an in-process argument only.
const { readFileSync } = require("node:fs");
const cli = require("@tauri-apps/cli/main");

const [file, ...options] = process.argv.slice(2);
const password = readFileSync(0, "utf8");
if (!file || !password || options.some(option => option !== "--force")) process.exit(1);
cli.run(["signer", "generate", "--ci", "--write-keys", file, `--password=${password}`, ...options])
  .catch(() => { process.exitCode = 1; });
