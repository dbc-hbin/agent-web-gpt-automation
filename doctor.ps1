[CmdletBinding()]
param(
  [string]$AgentHome = $(if($env:AGENT_WEB_GPT_HOME){$env:AGENT_WEB_GPT_HOME}elseif($env:CODEX_HOME){$env:CODEX_HOME}elseif(Test-Path (Join-Path $env:USERPROFILE '.codex')){Join-Path $env:USERPROFILE '.codex'}else{Join-Path $env:USERPROFILE '.agent-web-gpt'}),
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$CodexRoot = [IO.Path]::GetFullPath($AgentHome)
$ReceiptRoot = Join-Path $CodexRoot 'receipts'
$Issues = @()
$Warnings = @()
$Commands = @('powershell -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf')

function Get-Sha256([string]$Path) {
  $stream = $null
  $sha256 = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    (([BitConverter]::ToString($sha256.ComputeHash($stream))) -replace '-', '').ToLowerInvariant()
  } finally {
    if ($sha256) { $sha256.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}

function Test-IsWithinRoot([string]$Root, [string]$Path) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
  $candidate = [IO.Path]::GetFullPath($Path)
  $candidate.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}

function Get-SafeChild([string]$Root, [string]$Relative) {
  if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\/])\.{1,2}([\/]|$)') {
    throw "unsafe receipt path: $Relative"
  }
  $candidate = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
  if (!(Test-IsWithinRoot $Root $candidate)) { throw "receipt path escapes agent home: $Relative" }
  $candidate
}

$Receipt = Get-ChildItem -LiteralPath $ReceiptRoot -Filter 'codexpro-automation-*.json' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (!$Receipt) {
  $Issues += @{code='RECEIPT_MISSING'; detail='No install receipt found'}
} else {
  try {
    $Value = Get-Content -LiteralPath $Receipt.FullName -Raw | ConvertFrom-Json
    if (@('codexpro.install-receipt/v2','codexpro.install-receipt/v3') -notcontains [string]$Value.schema) {
      throw 'unsupported install receipt schema'
    }
    foreach ($Record in $Value.files) {
      $Path = Get-SafeChild $CodexRoot ([string]$Record.path)
      if (!(Test-Path -LiteralPath $Path)) {
        $Issues += @{code='FILE_MISSING'; path=$Record.path}
        continue
      }
      $Actual = Get-Sha256 $Path
      if ($Actual -ne $Record.installed_sha256) {
        $Issues += @{code='HASH_MISMATCH'; path=$Record.path; actual=$Actual}
      }
    }
  } catch {
    $Issues += @{code='RECEIPT_INVALID'; detail=$_.Exception.Message}
  }
}

$Node = Get-Command node.exe,node -ErrorAction SilentlyContinue | Select-Object -First 1
$Npx = Get-Command npx.cmd,npx -ErrorAction SilentlyContinue | Select-Object -First 1
$GitBash = Get-Item -LiteralPath 'C:\Program Files\Git\bin\bash.exe' -ErrorAction SilentlyContinue
if (!$Node -or !$Npx) {
  $Issues += @{code='ORACLE_DEVSPACE_NODE_TOOLING_MISSING'; detail='Node and npx are required for Oracle and DevSpace'}
} else {
  try {
    $NodeVersion = (& $Node.Source --version).Trim().TrimStart('v')
    $NodeMajor = [int]($NodeVersion.Split('.')[0])
    $NodeMinor = [int]($NodeVersion.Split('.')[1])
    if ($NodeMajor -lt 22 -or $NodeMajor -ge 27 -or ($NodeMajor -eq 22 -and $NodeMinor -lt 19)) {
      $Issues += @{code='DEVSPACE_NODE_VERSION_UNSUPPORTED'; actual=$NodeVersion; required='>=22.19 <27'}
    }
  } catch {
    $Issues += @{code='NODE_VERSION_UNREADABLE'; detail=$_.Exception.Message}
  }
}
if (!$GitBash) {
  $Issues += @{code='DEVSPACE_GIT_BASH_MISSING'; detail='Windows DevSpace requires Git Bash'}
}
$Commands += 'npx -y @steipete/oracle --version'
$Commands += 'python .\skills\chatgpt-workspace-setup\scripts\devspace_tailscale_setup.py doctor --root C:\project --hostname your-device.your-tailnet.ts.net'

[ordered]@{
  schema = 'codexpro.doctor/v2'
  agent_home = $CodexRoot
  receipt = $(if ($Receipt) { $Receipt.FullName } else { $null })
  status = $(if ($Issues) { 'FAIL' } else { 'PASS' })
  issues = $Issues
  warnings = $Warnings
  commands = $Commands
  oracle = @{package='@steipete/oracle';tested_version='0.17.1';resolution='npx at explicit run time'}
  devspace = @{package='@waishnav/devspace';tested_version='1.0.4';setup='explicit setup skill only'}
  what_if = [bool]$WhatIf
} | ConvertTo-Json -Depth 7
if ($Issues) { exit 1 }
