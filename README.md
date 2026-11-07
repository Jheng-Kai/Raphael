<p align="center">
  <img src="app/public/brand/raphael-portrait.png" width="112" alt="Raphael">
</p>

<h1 align="center">Raphael</h1>

<p align="center">
  A team of AI members on your Windows PC, and dictation that works in every app.
</p>

<p align="center">
  <a href="https://github.com/Jheng-Kai/Raphael/releases/latest">Download</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="LICENSE">MIT License</a>
</p>

## Features

- **Members that work.** Give each member a role, a model and its own memory. Members take on tasks, hand work to each other and report back, and they keep going for hours while you do something else.
- **Group chats.** Put members in a room. Each one reads the conversation and decides whether to speak.
- **Computers of their own.** A member can use its own desktop, which starts only when you allow it. You can watch it, take over at a sign-in, and hand it back.
- **Dictation anywhere.** Press a key, speak, and clean text appears where your cursor is. Filler words are dropped, and your names and terms keep their spelling.
- **Your models.** Sign in with ChatGPT, use an OpenRouter key, or run members on your Claude Code, Codex or Antigravity subscription. A member never switches to another model on its own.
- **Routines and messaging.** Members run tasks on a schedule or when something happens, and you can reach them from Telegram, Slack and Discord.
- **Stays on your PC.** Conversations, memory and settings live in local files you can read and edit.

## Install

Download `Raphael-<version>-windows-x64-setup.exe` from the [latest release](https://github.com/Jheng-Kai/Raphael/releases/latest) and run it. It installs per user and needs no administrator rights.

- Windows 10 or 11, x64.
- At least one model: a ChatGPT account, an [OpenRouter](https://openrouter.ai) key, or a signed-in Claude Code, Codex or Antigravity CLI.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), only if members should use computers of their own.

The installer is not code-signed, so Windows SmartScreen may warn about an unknown publisher.

## Build from source

Requirements: [Node.js](https://nodejs.org) 22.12+, [Rust](https://rustup.rs) 1.98, [uv](https://docs.astral.sh/uv/) and the MSVC C++ build tools.

```powershell
git clone https://github.com/Jheng-Kai/Raphael.git
cd Raphael\core
uv sync --locked --dev
cd ..\app
npm ci
npm run tauri -- dev
```

Development builds keep their data in `Raphael Dev` folders, apart from an installed release. Set `RAPHAEL_DATA_DIR` to use another folder.

Run the checks from `app/`:

```powershell
npm run verify             # TypeScript, unit tests, contrast
npm run verify -- --core   # plus the Python core
npm run verify -- --rust   # plus the Rust shell
```

### Windows releases

The manually dispatched Windows release workflow builds and verifies the installer,
dependency notices, `BUILD-INFO.txt` and `SHA256SUMS.txt`. Publishing requires the
explicit `publish` input and a main-branch or tag build.

With both `TAURI_SIGNING_PRIVATE_KEY` and `RAPHAEL_UPDATER_PUBLIC_KEY` repository
secrets, it also signs the installer with a version-bound trusted comment and
publishes its `.sig` and `latest.json` updater feed. If either key is missing, it
warns once and still releases the verified installer using the release config plus
the small `tauri.release-no-updater.conf.json` override. That mode publishes no
signature or updater feed and records the reason in `BUILD-INFO.txt`.

`prepare-release-assets.mjs` requires `--signature` by default. Only the explicit
`--updater disabled` mode accepts its omission; signed mode still rejects missing
signatures and signatures that do not bind the release version.

## Project layout

```text
app/src         UI (TypeScript)        windows, settings, overlay
app/src-tauri   Shell (Rust, Tauri 2)  hotkeys, paste, tray, windows
core            Core (Python)          members, memory, speech, tools
```

The UI talks to the shell through Tauri commands, and the shell talks to the core through JSON-RPC over stdio.

## License

Raphael is released under the [MIT License](LICENSE). Third-party licenses are in [core/packaging/licenses](core/packaging/licenses).
