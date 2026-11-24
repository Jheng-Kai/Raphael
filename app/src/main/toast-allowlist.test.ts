import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript-6";
import { expect, test } from "vitest";

const main = import.meta.dirname;

// Failures and invalid input. A localized failure may include details from the core.
const failureKeys = [
  "agent.attachTooBig", "agent.attachTooMany", "agent.attachTotal", "agent.attachUnreadable",
  "agent.fileUnavailable", "agent.pathUnavailable", "agent.tooLong", "backend.avatarKind", "bgq.gone", "cal.needsEnd",
  "cal.needsTitle", "card.busy", "cards.failed", "cards.templateLinkFailed",
  "cards.templateUnshareFailed", "chat.microphoneDenied", "chat.reattach", "chat.voiceEmpty",
  "chat.voiceFailed", "dictionary.020", "dictionary.021", "dictionary.024", "dictionary.029",
  "dictionary.030", "dictionary.031", "dictionary.032", "dictionary.033", "languages.002",
  "languages.003", "languages.unavailable", "local.deleteFailed", "local.failed",
  "mcp.testFailed", "members.nameEmpty", "members.nameTaken", "members.profile.badCommand",
  "members.profile.noRoutines", "members.sourceBad", "msg.tg.codeGone",
  "onboarding.clipboardEmpty", "page.failed", "page.report.saveFailed", "plugins.connectFailed",
  "rooms.memberCount", "rooms.voiceFailed", "services.urlInvalid", "skillLib.duplicate",
  "skillLib.duplicateIn", "skillLib.failed", "store.notOpen", "store.unavailable", "ui.002", "undo.001",
];

// The result lives outside the current view, or the message asks the owner to review it.
const unseenKeys = [
  "cards.templateLinkCopied", "chat.quotaLow", "chat.quotaReset", "common.keyPasteHint",
  "conn.connected", "conn.relogged", "conn.revokeInApp", "keychain.asked", "mail.updated", "mcp.testOk",
  "models.filled", "page.report.downloads", "page.report.saved", "picker.replaced",
  "rooms.deleted", "settings.085", "update.installed",
];

// These notices contain a recovery, navigation or undo action.
const actionKeys = [
  "agent.title", "conn.lost", "conn.relogin", "dictionary.023", "history.020",
  "keychain.askAgain", "keychain.refused", "models.choose", "reminder.waiting", "rules.deleted", "ui.001",
];
// These existing lookup tables supply details for those failures and notices.
const lookupKeys = [
  "card.needsComposioKey", "card.notConfigured", "conn.emptyInstalled",
  "conn.err.auth", "conn.err.denied", "conn.err.error", "conn.err.gone", "conn.err.invalid_request",
  "conn.err.missing_secret", "conn.err.network", "conn.err.not_found", "conn.err.protocol",
  "conn.err.timeout", "conn.err.toolkit_not_allowed", "missing.accessibility", "missing.allowance",
  "missing.attachment", "missing.audio_decode", "missing.audio_ffmpeg", "missing.audio_transcriber",
  "missing.bad_pdf", "missing.chatgptAuth", "missing.chatgpt_plan_unavailable", "missing.chatgpt_scope",
  "missing.cli", "missing.docker", "missing.encrypted", "missing.hidden", "missing.imageGeneration",
  "missing.installation", "missing.learned", "missing.mail", "missing.memberComputer", "missing.microphone",
  "missing.modelFormat", "missing.models", "missing.newerDatabase", "missing.noModels", "missing.no_text",
  "missing.off", "missing.open", "missing.pdf", "missing.provider", "missing.providerAuth", "missing.read",
  "missing.retired", "missing.routines", "missing.sameVision", "missing.search", "missing.slack",
  "missing.startup", "missing.unknown", "missing.url", "missing.urlRead", "missing.videoGeneration",
  "missing.vision", "models.missing.answer", "models.missing.cleanup", "models.missing.quick",
  "models.missing.stt", "picker.roleAnswer", "picker.roleCleanup", "picker.roleStt", "runs.fiveHour",
  "runs.weekly", "runs.weeklyOpus", "runs.weeklySonnet", "skillLib.badArchive", "skillLib.badName", "skillLib.invalidDocument",
  "skillLib.noSkill", "skillLib.tooLarge", "skillLib.unsupported", "template.file.damaged",
  "template.file.newer", "template.file.notTemplate", "template.file.secret", "template.file.tooLarge",
];
const allowedKeys = new Set([...failureKeys, ...unseenKeys, ...actionKeys, ...lookupKeys]);

// Existing producers for messages whose text depends on a validated error or event.
const forwarded: Record<string, readonly string[]> = {
  "composer-folder.ts": ["message"], // Git refuses the branch switch and explains how to recover.
  "connection-lost.ts": ["connectionLostHTML(lost.name, lost.id)"],
  "connections.ts": ["text", "failureText(result.error)"],
  "conversation-card-actions.ts": ["text"],
  "keychain-refused.ts": ["keychainRefusedHTML"],
  "main.ts": ["missingHTML(event.missing)"],
  "member-templates.ts": ["templateErrorText(error)", 'templateErrorText(error, catalogId ? "store" : "file")'],
  "models-notice.ts": ["modelMissingHTML(role)"],
  "pages/agent.ts": ["words"],
  "pages/dictionary.ts": ["importError(err)"],
  "pages/settings.ts": ["message", "result.reason"],
  "quota-warning.ts": ['`<span class="quota-warning" role="status">${esc(quotaWarningText(warning))}</span>`'],
  "skill-library.ts": ["failureText(error)"],
  "undo.ts": ["action.message", "current.action.failure?.(err)"],
};
const producers: Record<string, readonly string[]> = {
  "connection-lost.ts": ["connectionLostHTML"],
  "keychain-refused.ts": ["keychainRefusedHTML"],
  "languages.ts": ["chooseLanguageVariant", "toggleTranscriptionLanguage"],
  "missing.ts": ["missingText", "missingHTML", "repairButton"],
  "model-picker.ts": ["replacementNotices"],
  "models-notice.ts": ["modelMissingHTML"],
  "pages/dictionary.ts": ["importError"],
  "quota-warning.ts": ["quotaWarningText"],
  "skill-library.ts": ["failureText"],
  "template-file.ts": ["templateErrorText"],
};
// Fixed maps in the producers above choose localized errors or substitution labels.
const lookupTables: Record<string, readonly string[]> = {
  "connections.ts": ["FAILURES"],
  "missing.ts": ["messages", "repairMessages", "key"],
  "model-picker.ts": ["role"],
  "models-notice.ts": ["MISSING"],
  "skill-library.ts": ["CAUSES"],
  "template-file.ts": ["PROBLEM_KEYS"],
  "usage-blocks.ts": ["PERIODS"],
};
const translatedSelectors: Record<string, readonly string[]> = {
  "missing.ts": ["key"],
  "model-picker.ts": ["role[r.role]"],
  "models-notice.ts": ["MISSING[role]"],
  "quota-warning.ts": ["PERIODS[warning.period]"],
  "skill-library.ts": ["CAUSES[kind[1] as keyof typeof CAUSES]"],
};

test("toast messages use only the allowlisted keys and existing message producers", () => {
  const unexpected: string[] = [];
  const files = readdirSync(main, { recursive: true, encoding: "utf8" }).map(path => path.replace(/\\/g, "/"));
  for (const file of files.filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.startsWith("i18n/"))) {
    const code = readFileSync(join(main, file), "utf8");
    const toastSink = /\btoaster\s*\.|\.notifier\s*\.|\.undo\s*\.|\b(?:notify|notice)\s*\(/;
    if (!toastSink.test(code) && !producers[file] && !lookupTables[file]) continue;
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    const reject = (node: ts.Node): void => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      unexpected.push(`${file}:${line + 1} ${node.getText(source)}`);
    };
    function checkKey(node: ts.Expression): void {
      if (ts.isConditionalExpression(node)) {
        checkKey(node.whenTrue);
        checkKey(node.whenFalse);
      } else if (ts.isStringLiteralLike(node)) {
        if (!allowedKeys.has(node.text)) reject(node);
      } else if (!translatedSelectors[file]?.includes(node.getText(source))) {
        reject(node);
      }
    }
    function checkTranslations(node: ts.Node): void {
      if (ts.isCallExpression(node) && ["t", "tr"].includes(node.expression.getText(source))) {
        if (node.arguments[0]) checkKey(node.arguments[0]);
        // Interpolation can contain shorter translated text that is also shown in the toast.
      }
      ts.forEachChild(node, checkTranslations);
    }
    function checkMessage(node: ts.Expression): void {
      if (forwarded[file]?.includes(node.getText(source))) return;
      if (ts.isConditionalExpression(node)) {
        checkMessage(node.whenTrue);
        checkMessage(node.whenFalse);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        checkMessage(node.left);
        checkMessage(node.right);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        // MCP test status appends the tool count or server error.
        checkMessage(node.left);
        checkTranslations(node.right);
      } else if (ts.isCallExpression(node) && node.expression.getText(source) === "describeError") {
        checkTranslations(node);
      } else if (ts.isCallExpression(node) && ["t", "tr"].includes(node.expression.getText(source))) {
        checkTranslations(node);
      } else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        checkMessage(node.body);
      } else if (ts.isArrowFunction(node) && file === "question-reminder.ts") {
        checkTranslations(node.body);
      } else {
        reject(node);
      }
    }
    function checkLookup(node: ts.Node): void {
      if (ts.isStringLiteralLike(node) && /^\w+\.[\w.]+$/.test(node.text)) checkKey(node);
      ts.forEachChild(node, checkLookup);
    }
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.arguments[0]) {
        const call = node.expression.getText(source);
        const message = node.arguments[0];
        if (/^toaster\.(?:info|show|notice)$/.test(call) || call === "this.notifier.show" ||
          (file === "connections.ts" && call === "notify") || (file === "mail-actions.ts" && call === "notice")) {
          checkMessage(message);
        }
        if (call.endsWith(".undo.begin") && ts.isObjectLiteralExpression(message)) {
          for (const entry of message.properties) {
            if (ts.isPropertyAssignment(entry) && ["message", "failure"].includes(entry.name.getText(source))) {
              checkMessage(entry.initializer);
            }
          }
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && producers[file]?.includes(node.name.text)) checkTranslations(node);
      if (ts.isVariableDeclaration(node) && node.initializer && lookupTables[file]?.includes(node.name.getText(source))) {
        const scope = node.parent.parent.parent;
        const localLookup = file !== "model-picker.ts" && file !== "missing.ts"
          || ts.isBlock(scope) && ts.isFunctionDeclaration(scope.parent)
          && producers[file]?.includes(scope.parent.name?.text ?? "");
        if (localLookup || file === "missing.ts" && node.name.getText(source) === "messages") checkLookup(node.initializer);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(unexpected, "A new toast needs a reason the current view cannot show its result").toEqual([]);
});
