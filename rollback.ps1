[CmdletBinding(SupportsShouldProcess=$true)]
param([Parameter(Mandatory=$true)][string]$Receipt,[string]$AgentHome=$(if($env:AGENT_WEB_GPT_HOME){$env:AGENT_WEB_GPT_HOME}elseif($env:CODEX_HOME){$env:CODEX_HOME}elseif(Test-Path (Join-Path $env:USERPROFILE '.codex')){Join-Path $env:USERPROFILE '.codex'}else{Join-Path $env:USERPROFILE '.agent-web-gpt'}))
$ErrorActionPreference='Stop';$CodexRoot=[IO.Path]::GetFullPath($AgentHome);$ReceiptRoot=Join-Path $CodexRoot 'receipts'
function Get-Hash([string]$p){
  $stream=$null;$sha256=$null
  try{
    $stream=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $sha256=[Security.Cryptography.SHA256]::Create()
    (([BitConverter]::ToString($sha256.ComputeHash($stream))) -replace '-','').ToLowerInvariant()
  } finally {
    if($sha256){$sha256.Dispose()}
    if($stream){$stream.Dispose()}
  }
}
function Test-IsWithinRoot([string]$r,[string]$p){$r=[IO.Path]::GetFullPath($r).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar);$p=[IO.Path]::GetFullPath($p);$p.StartsWith($r+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)}
function Get-SafeChild([string]$r,[string]$x){if([string]::IsNullOrWhiteSpace($x)-or[IO.Path]::IsPathRooted($x)-or$x -match '(^|[\\/])\.{1,2}([\\/]|$)'){throw "unsafe relative path: $x"};$p=[IO.Path]::GetFullPath((Join-Path $r $x));if(!(Test-IsWithinRoot $r $p)){throw "path escapes root: $x"};$p}
$fullReceipt=[IO.Path]::GetFullPath($Receipt);if(!(Test-IsWithinRoot $ReceiptRoot $fullReceipt) -or !(Test-Path -LiteralPath $fullReceipt) -or (Get-Item -LiteralPath $fullReceipt -Force).LinkType){throw 'receipt must be owned by this agent home'}
$value=Get-Content -LiteralPath $fullReceipt -Raw|ConvertFrom-Json;if($value.schema -notin @('codexpro.install-receipt/v2','codexpro.install-receipt/v3')){throw 'unsupported receipt schema'};if(!(Test-IsWithinRoot (Join-Path $CodexRoot 'backups') $value.backup)){throw 'receipt backup must be owned by this agent home'}
$conflicts=@();foreach($record in $value.files){$destination=Get-SafeChild $CodexRoot $record.path;if($record.action -eq 'created'){if(!(Test-Path -LiteralPath $destination)){continue};if((Get-Item -LiteralPath $destination -Force).LinkType){throw "destination symlink refused: $($record.path)"};if((Get-Hash $destination)-eq $record.installed_sha256){if($PSCmdlet.ShouldProcess($destination,'remove unchanged receipt-created file')){Remove-Item -LiteralPath $destination -Force}}else{$conflicts+=@{path=$record.path;action='preserved_modified_created'}};continue};if($record.action -ne 'overwritten'){throw "invalid receipt action: $($record.action)"};$relative=[string]$record.path;$backup=Get-SafeChild $value.backup $relative;if(!(Test-Path -LiteralPath $backup) -or (Get-Item -LiteralPath $backup -Force).LinkType -or (Get-Hash $backup)-ne $record.backup_sha256){throw "backup invalid: $relative"};if((Test-Path -LiteralPath $destination) -and !(Get-Item -LiteralPath $destination -Force).LinkType -and (Get-Hash $destination)-eq $record.installed_sha256){if($PSCmdlet.ShouldProcess($destination,'restore unchanged receipt-overwritten file')){Copy-Item -LiteralPath $backup -Destination $destination -Force}}else{$conflicts+=@{path=$relative;action='preserved_modified_overwritten'}}}
$status=if($conflicts.Count){'CONFLICT'}else{'COMPLETE'};$result=[ordered]@{schema='codexpro.rollback-result/v1';receipt=$fullReceipt;status=$status;conflicts=$conflicts};$result|ConvertTo-Json -Depth 5
if($conflicts.Count){exit 2}
