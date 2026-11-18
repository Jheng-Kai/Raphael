#requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = 'Generate')]
param(
    [string]$Directory = (Join-Path $env:USERPROFILE '.raphael-updater'),
    [Parameter(ParameterSetName = 'Generate')][switch]$Force,
    [Parameter(Mandatory, ParameterSetName = 'Upload')][switch]$UploadExisting
)

$ErrorActionPreference = 'Stop'
$directoryPath = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Directory))
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
for ($parent = [IO.DirectoryInfo]$directoryPath; $null -ne $parent; $parent = $parent.Parent) {
    if ($parent.FullName -eq $repository -or (Test-Path -LiteralPath (Join-Path $parent.FullName '.git'))) {
        throw 'Choose a key directory outside the repository.'
    }
    if ($parent.Exists -and ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Choose a key directory outside junctions and symbolic links.'
    }
}
$keyFile = Join-Path $directoryPath 'updater.key'
$publicFile = "$keyFile.pub"
foreach ($path in @($keyFile, $publicFile)) {
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))) {
        throw 'Key files must be regular files.'
    }
    if ($item -and !$Force -and !$UploadExisting) {
        throw 'A key already exists. Use -UploadExisting to retry uploading it, or -Force to replace it.'
    }
    if (!$item -and $UploadExisting) { throw 'Both existing key files are required.' }
}

# Both children receive exact UTF-8 bytes. PowerShell 5.1 text pipelines change the
# encoding and append a newline, and its error stream can surface native diagnostics.
function Invoke-WithPrivateInput([string]$Program, [string]$Arguments, [string]$Value) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Program
    $start.Arguments = $Arguments
    $start.WorkingDirectory = $PSScriptRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    try {
        $out = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
        $err = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        try {
            $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
        } finally {
            [Array]::Clear($bytes, 0, $bytes.Length)
            $process.StandardInput.BaseStream.Close()
        }
        $process.WaitForExit()
        [void]$out.GetAwaiter().GetResult()
        [void]$err.GetAwaiter().GetResult()
        return $process.ExitCode
    } finally {
        $process.Dispose()
    }
}

function Send-Secret([string]$Name, [string]$Value) {
    $code = Invoke-WithPrivateInput $ghPath "secret set $Name --repo Jheng-Kai/Raphael" $Value
    if ($code -ne 0) { throw "Could not set $Name. Retry with -UploadExisting." }
}

$ghPath = (Get-Command gh.exe -CommandType Application).Source
$password = Read-Host 'Updater key password' -AsSecureString
$again = $null
try {
    if (!$password.Length) { throw 'A nonempty password is required.' }
    $plainPassword = [Net.NetworkCredential]::new('', $password).Password
    if (!$UploadExisting) {
        # A new key's password is typed twice: a typo would leave a key nobody can unlock.
        $again = Read-Host 'Type the password again' -AsSecureString
        if ([Net.NetworkCredential]::new('', $again).Password -cne $plainPassword) { throw 'The two passwords differ. Nothing was created.' }
    }
    if (!$UploadExisting) {
        $nodePath = (Get-Command node.exe -CommandType Application).Source
        $generate = 'generate-updater-key.cjs "' + $keyFile + '"'
        if ($Force) { $generate += ' --force' }
        $code = Invoke-WithPrivateInput $nodePath $generate $plainPassword
        if ($code -ne 0) { throw 'Tauri key generation failed. Check the local app dependencies and key directory.' }
    }
    $publicKey = [IO.File]::ReadAllText($publicFile).Trim()
    Send-Secret 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' $plainPassword
    Send-Secret 'TAURI_SIGNING_PRIVATE_KEY' ([IO.File]::ReadAllText($keyFile).Trim())
    Send-Secret 'RAPHAEL_UPDATER_PUBLIC_KEY' $publicKey
    Write-Output $publicKey
    Write-Output "Private key file: $keyFile"
    Write-Warning 'If you lose the private key or its password, installed apps can no longer update.'
} finally {
    $plainPassword = $null
    $password.Dispose()
    if ($again) { $again.Dispose() }
}
