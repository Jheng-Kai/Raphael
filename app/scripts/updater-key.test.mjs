import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");

test("key setup keeps secret values out of output, files and process arguments", () => {
  const ps = readFileSync(new URL("updater-key.ps1", import.meta.url), "utf8");
  const lines = ps.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  // Allow only the intended reads, transfers and cleanup of sensitive values. This also
  // catches bare expressions (implicit PowerShell output) and new aliases for a secret.
  assert.deepEqual(lines.filter(line => /\$(?:plainPassword|password|again|Value|bytes|keyFile)\b/i.test(line)), [
    "$keyFile = Join-Path $directoryPath 'updater.key'",
    '$publicFile = "$keyFile.pub"',
    "foreach ($path in @($keyFile, $publicFile)) {",
    "function Invoke-WithPrivateInput([string]$Program, [string]$Arguments, [string]$Value) {",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($Value)",
    "$process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)",
    "[Array]::Clear($bytes, 0, $bytes.Length)",
    "function Send-Secret([string]$Name, [string]$Value) {",
    '$code = Invoke-WithPrivateInput $ghPath "secret set $Name --repo Jheng-Kai/Raphael" $Value',
    "$password = Read-Host 'Updater key password' -AsSecureString",
    "$again = $null",
    "if (!$password.Length) { throw 'A nonempty password is required.' }",
    "$plainPassword = [Net.NetworkCredential]::new('', $password).Password",
    "$again = Read-Host 'Type the password again' -AsSecureString",
    "if ([Net.NetworkCredential]::new('', $again).Password -cne $plainPassword) { throw 'The two passwords differ. Nothing was created.' }",
    `$generate = 'generate-updater-key.cjs "' + $keyFile + '"'`,
    "$code = Invoke-WithPrivateInput $nodePath $generate $plainPassword",
    "Send-Secret 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' $plainPassword",
    "Send-Secret 'TAURI_SIGNING_PRIVATE_KEY' ([IO.File]::ReadAllText($keyFile).Trim())",
    'Write-Output "Private key file: $keyFile"',
    "$plainPassword = $null",
    "$password.Dispose()",
    "if ($again) { $again.Dispose() }",
  ]);
  assert.deepEqual(lines.filter(line => /(?:Write-(?:Output|Host|Warning|Verbose|Debug|Information)|\becho\b|(?:Get|Set|Add)-Content|Out-File|ReadAllText|\.Arguments\s*=)/i.test(line)), [
    "$start.Arguments = $Arguments",
    "$publicKey = [IO.File]::ReadAllText($publicFile).Trim()",
    "Send-Secret 'TAURI_SIGNING_PRIVATE_KEY' ([IO.File]::ReadAllText($keyFile).Trim())",
    "Write-Output $publicKey",
    'Write-Output "Private key file: $keyFile"',
    "Write-Warning 'If you lose the private key or its password, installed apps can no longer update.'",
  ]);
  assert.match(ps, /Send-Secret 'RAPHAEL_UPDATER_PUBLIC_KEY' \$publicKey/);
  const helper = readFileSync(new URL("generate-updater-key.cjs", import.meta.url), "utf8");
  assert.match(helper, /require\("@tauri-apps\/cli\/main"\)/);
  assert.match(helper, /cli\.run\(\["signer", "generate", "--ci", "--write-keys", file,/);
  assert.doesNotMatch(helper, /child_process|console\.|process\.(?:stdout|stderr)|writeFile|process\.env\b|throw /);
});

if (process.platform === "win32") test("PowerShell 5.1 passes exact UTF-8 on stdin and discards both child output streams", () => {
  // Load only the pipe helper. The owner entry point, Tauri and gh never run.
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'updater-key.ps1'), [ref]$tokens, [ref]$errors)
if ($errors) { exit 1 }
$function = $ast.Find({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Invoke-WithPrivateInput' }, $false)
. ([scriptblock]::Create($function.Extent.Text))
$value = ' ' + [char]0x6e2c + '"&%' + ' '
$arguments = '-e "const b=require(\'\'fs\'\').readFileSync(0);process.stdout.write(b);process.stderr.write(b);process.exit(b.toString(\'\'hex\'\')===\'\'20e6b8ac22262520\'\'?0:1)"'
$code = Invoke-WithPrivateInput (Get-Command node.exe).Source $arguments $value
exit $code`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    cwd: import.meta.dirname, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
