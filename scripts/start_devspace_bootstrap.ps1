[CmdletBinding()]
param(
  [string]$AgentHome = $(if($env:AGENT_WEB_GPT_HOME){$env:AGENT_WEB_GPT_HOME}elseif($env:CODEX_HOME){$env:CODEX_HOME}elseif(Test-Path (Join-Path $env:USERPROFILE '.codex')){Join-Path $env:USERPROFILE '.codex'}else{Join-Path $env:USERPROFILE '.agent-web-gpt'}),
  [string]$ConfigPath = '',
  [string]$DevSpaceConfigPath = '',
  [ValidateSet('Once', 'Watch')]
  [string]$Mode = 'Once',
  [ValidateRange(0, 86400)]
  [int]$WatchIntervalSeconds = 300,
  [ValidateRange(0, 86400)]
  [int]$FailureRetrySeconds = 60,
  [ValidateRange(0, 1000000)]
  [int]$MaxCycles = 0,
  [ValidatePattern('^[A-Za-z0-9_.-]{1,120}$')]
  [string]$MutexName = 'CodexProDevSpaceBootstrap'
)

$ErrorActionPreference = 'Stop'
$CodexRoot = [IO.Path]::GetFullPath($AgentHome)
if (!$ConfigPath) { $ConfigPath = Join-Path $CodexRoot 'config/codexpro-devspace-bootstrap.json' }
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
if (!$DevSpaceConfigPath) { $DevSpaceConfigPath = Join-Path $env:USERPROFILE '.devspace/config.json' }
$DevSpaceConfigPath = [IO.Path]::GetFullPath($DevSpaceConfigPath)
$LogRoot = Join-Path $CodexRoot 'logs/codexpro-devspace'
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$LogPath = Join-Path $LogRoot ("bootstrap-{0}.log" -f (Get-Date -Format 'yyyy-MM'))

function Write-BootstrapLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

$Mutex = New-Object Threading.Mutex($false, ("Local\{0}" -f $MutexName))
$Acquired = $false
try {
  $Acquired = $Mutex.WaitOne(0)
  if (!$Acquired) { exit 0 }
  Write-BootstrapLog ("Bootstrap started in {0} mode." -f $Mode)
  if (!(Test-Path -LiteralPath $ConfigPath)) { throw "Bootstrap config missing: $ConfigPath" }
  $Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$Config.schema -ne 'codexpro.devspace-bootstrap/v1') { throw 'Unsupported bootstrap config schema.' }
  if (!(Test-Path -LiteralPath $DevSpaceConfigPath)) { throw "DevSpace config missing: $DevSpaceConfigPath" }
  $DevSpaceConfig = Get-Content -LiteralPath $DevSpaceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $AllowedRoots = @($DevSpaceConfig.allowedRoots)
  if ($AllowedRoots.Count -eq 0) { throw 'DevSpace config allowedRoots is missing or empty.' }
  foreach ($Root in $AllowedRoots) {
    if (![IO.Path]::IsPathRooted([string]$Root)) {
      throw "DevSpace config allowedRoot is not absolute: $Root"
    }
  }
  $Python = [string]$Config.python_path
  if (!$Python) {
    $PythonCommand = Get-Command python.exe,python -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$PythonCommand) { throw 'Python is unavailable.' }
    $Python = $PythonCommand.Source
  }
  if (!(Test-Path -LiteralPath $Python)) { throw "Python is unavailable: $Python" }
  $Helper = Join-Path $CodexRoot 'skills/chatgpt-workspace-setup/scripts/devspace_tailscale_setup.py'
  if (!(Test-Path -LiteralPath $Helper)) { throw "DevSpace recovery helper missing: $Helper" }
  if (Test-Path -LiteralPath 'C:\Program Files\Tailscale') {
    $env:PATH = 'C:\Program Files\Tailscale;' + $env:PATH
  }
  $Arguments = @($Helper, 'recover')
  foreach ($Root in $AllowedRoots) { $Arguments += @('--root', [IO.Path]::GetFullPath([string]$Root)) }
  $Arguments += @('--hostname', [string]$Config.hostname)
  if ($Config.local_port) { $Arguments += @('--local-port', [string]$Config.local_port) }
  if ($Config.public_port) { $Arguments += @('--public-port', [string]$Config.public_port) }
  Write-BootstrapLog ("Loaded {0} allowed roots from {1}." -f $AllowedRoots.Count, $DevSpaceConfigPath)

  $Cycle = 0
  $PreviouslyHealthy = $false
  while ($true) {
    $Cycle++
    $Healthy = $false
    for ($Attempt = 1; $Attempt -le 6; $Attempt++) {
      $PreviousPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        & $Python @Arguments *> $null
        $ExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $PreviousPreference
      }
      if ($ExitCode -eq 0) {
        $Healthy = $true
        break
      }
      Write-BootstrapLog "Recovery cycle $Cycle attempt $Attempt failed with exit code $ExitCode."
      if ($Attempt -lt 6) { Start-Sleep -Seconds 15 }
    }

    if ($Healthy) {
      if (!$PreviouslyHealthy) {
        Write-BootstrapLog "DevSpace and Funnel are healthy (cycle $Cycle, attempt $Attempt)."
      }
      $PreviouslyHealthy = $true
      if ($Mode -eq 'Once' -or ($MaxCycles -gt 0 -and $Cycle -ge $MaxCycles)) { exit 0 }
      Start-Sleep -Seconds $WatchIntervalSeconds
      continue
    }

    $PreviouslyHealthy = $false
    if ($Mode -eq 'Once') { throw 'DevSpace recovery retries exhausted.' }
    Write-BootstrapLog ("Recovery cycle {0} exhausted; watchdog remains active." -f $Cycle)
    if ($MaxCycles -gt 0 -and $Cycle -ge $MaxCycles) { exit 1 }
    Start-Sleep -Seconds $FailureRetrySeconds
  }
} catch {
  Write-BootstrapLog ("Bootstrap failed: {0}" -f $_.Exception.Message)
  exit 1
} finally {
  if ($Acquired) { $Mutex.ReleaseMutex() }
  $Mutex.Dispose()
}
