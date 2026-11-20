# Raphael product rules

Raphael is built so that everyone can reach AI, not only people who already understand models, providers and keys. A small frustration at the start is enough to make someone give up on the app for good, so every flow is designed for a first-time user who has none of our accounts: the app works out what it can by itself, asks one clear thing at a time, says what each choice means and what it costs, never defaults to one particular service, and never leaves a dead end. A screen that makes the user think about how Raphael is built, or stop to wonder what to do next, is a defect like any other.

## Where the rules are

The rules are kept by area, each area a file of its own, so that work in one area never touches another's file. A new section goes at the top of its area's file, under that file's heading; a rule's ID is unique across every file, and the repository's rule tests read them all.

- [Interface](rules/interface.md): Layout, controls, menus, floating surfaces, the sidebar, navigation, colours, words on screen and the guide.
- [Member computers](rules/computer.md): Each member's computer: its engine, image, screen, viewer, hold and takeover, and teaching on it.
- [Conversation and members](rules/conversation.md): How a member answers: the core loop, replies, memory, models, CLI brains, the queue and handoffs.
- [Connections and cards](rules/connections.md): Connected apps and accounts, the store, skills, shared templates and the cards that set them up.
- [Work and schedules](rules/work.md): Group rooms, colleagues, routines, the calendar, connected-app events, owner work and quotas.
- [Privacy and security](rules/privacy.md): Secrets, the vault, the Keychain, keys and what stays private.
- [Files and pages](rules/files.md): Attachments, files a member reads and writes, and pages.
- [Dictation and voice](rules/dictation.md): Dictation, the microphone, paste, text tidy and voice keys.
- [Performance and platform](rules/platform.md): Speed, start-up, the network and how the repository is worked.
- [General](rules/general.md): Sections with no rule row of their own.
