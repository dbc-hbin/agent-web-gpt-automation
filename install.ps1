[CmdletBinding(SupportsShouldProcess=$true)]
param(
 [string]$AgentHome=$(if($env:AGENT_WEB_GPT_HOME){$env:AGENT_WEB_GPT_HOME}elseif($env:CODEX_HOME){$env:CODEX_HOME}elseif(Test-Path (Join-Path $env:USERPROFILE '.codex')){Join-Path $env:USERPROFILE '.codex'}else{Join-Path $env:USERPROFILE '.agent-web-gpt'})
)
$ErrorActionPreference='Stop'
$RepoRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest=Get-Content (Join-Path $RepoRoot 'install-manifest.json') -Raw|ConvertFrom-Json
$HomeRoot=[IO.Path]::GetFullPath($AgentHome)
$Nonce=[guid]::NewGuid().ToString('N'); $Stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
$BackupRoot=Join-Path $HomeRoot "backups/codexpro-automation-$Stamp-$Nonce"; $ReceiptRoot=Join-Path $HomeRoot 'receipts'
$StageRoot=Join-Path ([IO.Path]::GetTempPath()) "codexpro-stage-$Nonce"
function Get-Hash([string]$Path){
  $stream=$null;$sha256=$null
  try{
    $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $sha256=[Security.Cryptography.SHA256]::Create()
    (([BitConverter]::ToString($sha256.ComputeHash($stream))) -replace '-','').ToLowerInvariant()
  } finally {
    if($sha256){$sha256.Dispose()}
    if($stream){$stream.Dispose()}
  }
}
function Copy-FileDurable([string]$Source,[string]$Destination){
  $directory=Split-Path -Parent $Destination;New-Item -ItemType Directory -Force -Path $directory|Out-Null
  $temporary=Join-Path $directory ".codexpro-$([guid]::NewGuid().ToString('N')).tmp";$input=$null;$output=$null
  try{
    $input=[IO.File]::Open($Source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $output=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $input.CopyTo($output);$output.Flush($true);$output.Dispose();$output=$null;$input.Dispose();$input=$null
    if(Test-Path -LiteralPath $Destination){
      $replaceBackup=Join-Path $directory ".codexpro-$([guid]::NewGuid().ToString('N')).bak"
      try{[IO.File]::Replace($temporary,$Destination,$replaceBackup,$true)}finally{if(Test-Path -LiteralPath $replaceBackup){Remove-Item -LiteralPath $replaceBackup -Force}}
    }else{[IO.File]::Move($temporary,$Destination)}
  } finally {
    if($output){$output.Dispose()};if($input){$input.Dispose()};if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}
  }
}
function Write-JsonDurable([string]$Path,$Value){
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path)|Out-Null;$temporary="$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try{[IO.File]::WriteAllText($temporary,($Value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false));$stream=[IO.File]::Open($temporary,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{$stream.Flush($true)}finally{$stream.Dispose()};Copy-FileDurable $temporary $Path}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
}
function Test-IsWithinRoot([string]$Root,[string]$Path){$r=[IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar);$p=[IO.Path]::GetFullPath($Path);$p.StartsWith($r+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)}
function Get-SafeChild([string]$Root,[string]$Relative){if([string]::IsNullOrWhiteSpace($Relative)-or[IO.Path]::IsPathRooted($Relative)-or$Relative -match '(^|[\\/])\.{1,2}([\\/]|$)'){throw "unsafe relative path: $Relative"};$p=[IO.Path]::GetFullPath((Join-Path $Root $Relative));if(!(Test-IsWithinRoot $Root $p)){throw "path escapes root: $Relative"};$cursor=Split-Path -Parent $p;while((Test-IsWithinRoot $Root $cursor) -and $cursor -ne [IO.Path]::GetFullPath($Root)){if(Test-Path -LiteralPath $cursor){$i=Get-Item -LiteralPath $cursor -Force;if($i.LinkType){throw "symlink/reparse path refused: $cursor"}};$cursor=Split-Path -Parent $cursor};$p}
function Get-ManifestFiles([string]$Root,$Patterns){$files=@();foreach($pattern in @($Patterns)){if($pattern -match '(^|/)\.{1,2}($|/)' -or [IO.Path]::IsPathRooted($pattern)){throw "unsafe manifest pattern: $pattern"};$base=if($pattern.StartsWith('bin/')){Join-Path $Root 'bin'}elseif($pattern.StartsWith('skills/')){Join-Path $Root 'skills'}elseif($pattern.StartsWith('mcp_servers/')){Join-Path $Root 'mcp_servers'}elseif($pattern.StartsWith('scripts/')){Join-Path $Root 'scripts'}elseif($pattern.StartsWith('contracts/')){Join-Path $Root 'contracts'}elseif($pattern.StartsWith('docs/')){Join-Path $Root 'docs'}elseif($pattern.StartsWith('marketplace/')){Join-Path $Root 'marketplace'}elseif($pattern.StartsWith('tests/fixtures/')){Join-Path $Root 'tests/fixtures'}else{throw "unsupported manifest root: $pattern"};$patternMatches=@();foreach($item in @(Get-ChildItem -LiteralPath $base -File -Recurse -Force)){if($item.LinkType){throw "manifest refuses symlink: $($item.FullName)"};$relative=$item.FullName.Substring($Root.Length).TrimStart([char[]]'\/').Replace('\','/');if($relative -like $pattern){[void](Get-SafeChild $Root $relative);$patternMatches+=$relative}};if(!$patternMatches.Count){throw "manifest pattern matched no files: $pattern"};$files+=$patternMatches};@($files|Sort-Object -Unique)}
function Resume-PendingInstallTransactions([string]$Root){
  $backupBase=Join-Path $Root 'backups';if(!(Test-Path -LiteralPath $backupBase)){return}
  foreach($journalPath in @(Get-ChildItem -LiteralPath $backupBase -Filter 'install.wal.json' -File -Recurse -Force -ErrorAction SilentlyContinue|Sort-Object FullName)){
    $journal=Get-Content -LiteralPath $journalPath.FullName -Raw|ConvertFrom-Json
    if($journal.schema -ne 'codexpro.install-wal/v1' -or $journal.status -eq 'COMPLETE' -or $journal.status -eq 'ROLLED_BACK_AFTER_CRASH'){continue}
    $conflicts=@();$entries=@($journal.files)
    for($index=$entries.Count-1;$index -ge 0;$index--){
      $entry=$entries[$index];$destination=Get-SafeChild $Root ([string]$entry.path)
      if(!(Test-Path -LiteralPath $destination)){continue}
      $destinationHash=Get-Hash $destination
      if($entry.phase -eq 'INTENT' -and $destinationHash -ne [string]$entry.installed_sha256){
        if($entry.action -eq 'overwritten' -and $destinationHash -eq [string]$entry.backup_sha256){continue}
        $conflicts+=@{path=$entry.path;action='preserved_modified_after_interrupted_install'};continue
      }
      if($destinationHash -ne [string]$entry.installed_sha256){$conflicts+=@{path=$entry.path;action='preserved_modified_after_interrupted_install'};continue}
      if($entry.action -eq 'created'){Remove-Item -LiteralPath $destination -Force;continue}
      $backup=Get-SafeChild ([string]$journal.backup) ([string]$entry.path)
      if(!(Test-Path -LiteralPath $backup) -or (Get-Hash $backup)-ne [string]$entry.backup_sha256){$conflicts+=@{path=$entry.path;action='missing_interrupted_backup'};continue}
      Copy-FileDurable $backup $destination
    }
    if($conflicts.Count){throw ("INSTALL_CRASH_RECOVERY_CONFLICT: "+($conflicts|ConvertTo-Json -Compress))}
    $journal.status='ROLLED_BACK_AFTER_CRASH';$journal|Add-Member -NotePropertyName recovered_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force;Write-JsonDurable $journalPath.FullName $journal
  }
}
$Patterns=@($Manifest.include)
$Files=@(Get-ManifestFiles $RepoRoot $Patterns)
if($WhatIfPreference){$Files|ForEach-Object{"Would stage and install $_"};exit 0}
$records=@();$installed=@();$receipt=$null
Resume-PendingInstallTransactions $HomeRoot
try{
 foreach($relative in $Files){$source=Get-SafeChild $RepoRoot $relative;$stage=Get-SafeChild $StageRoot $relative;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stage)|Out-Null;Copy-FileDurable $source $stage;if((Get-Hash $source)-ne(Get-Hash $stage)){throw "staging hash verification failed: $relative"}}
 $journalPath=Join-Path $BackupRoot 'install.wal.json';$journal=[ordered]@{schema='codexpro.install-wal/v1';status='ACTIVE';backup=$BackupRoot;created_at=[DateTime]::UtcNow.ToString('o');files=@()};Write-JsonDurable $journalPath $journal;$stepIndex=0
 foreach($relative in $Files){
  $destination=Get-SafeChild $HomeRoot $relative;$stage=Get-SafeChild $StageRoot $relative;$action='created';$backup=$null;$backupHash=$null
  if(Test-Path -LiteralPath $destination){$i=Get-Item -LiteralPath $destination -Force;if($i.LinkType){throw "destination symlink refused: $relative"};$action='overwritten';$backup=Get-SafeChild $BackupRoot $relative;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup)|Out-Null;Copy-FileDurable $destination $backup;$backupHash=Get-Hash $backup}
  $replacementPath=Join-Path $BackupRoot "steps/$stepIndex/replacement.json";$record=[ordered]@{path=$relative;action=$action;installed_sha256=(Get-Hash $stage);backup_sha256=$backupHash;phase='INTENT';transitions=@('INTENT');replacement=$replacementPath};$journal.files+=@($record);Write-JsonDurable $journalPath $journal
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination)|Out-Null;Copy-FileDurable $stage $destination;$record.phase='MUTATED';$record.transitions+=@('MUTATED');Write-JsonDurable $journalPath $journal
  Write-JsonDurable $replacementPath ([ordered]@{schema='codexpro.install-replacement/v1';path=$relative;action=$action;installed_sha256=$record.installed_sha256;backup_sha256=$backupHash;mutated_at=[DateTime]::UtcNow.ToString('o')})
  if($record.installed_sha256 -ne (Get-Hash $destination)){throw "commit hash verification failed: $relative"};$record.phase='VERIFIED';$record.transitions+=@('VERIFIED');Write-JsonDurable $journalPath $journal;$record.phase='COMPLETE';$record.transitions+=@('COMPLETE');Write-JsonDurable $journalPath $journal;$receiptRecord=[ordered]@{path=$relative;action=$action;installed_sha256=$record.installed_sha256;backup_sha256=$backupHash};$records+=$receiptRecord;$installed+=$receiptRecord;$stepIndex++
 }
 $journal.status='COMPLETE';$journal.completed_at=[DateTime]::UtcNow.ToString('o');Write-JsonDurable $journalPath $journal
 New-Item -ItemType Directory -Force -Path $ReceiptRoot|Out-Null;$receipt=Get-SafeChild $ReceiptRoot "codexpro-automation-$Stamp-$Nonce.json";Write-JsonDurable $receipt ([ordered]@{schema='codexpro.install-receipt/v3';installed_at=[DateTime]::UtcNow.ToString('o');manifest_version=$Manifest.version;backup=$BackupRoot;files=$records;wal=$journalPath})
 "Installed $($Files.Count) files. Receipt: $receipt"
} catch {
  $conflicts=@()
  foreach($record in @($installed|Sort-Object -Descending path)) {
    try {
      $destination=Get-SafeChild $HomeRoot $record.path
      if($record.action -eq 'created') {
        if((Test-Path -LiteralPath $destination) -and (Get-Hash $destination)-eq $record.installed_sha256) { Remove-Item -LiteralPath $destination -Force }
        else { $conflicts+=@{path=$record.path;action='preserved_modified_created'} }
      } else {
        $backup=Get-SafeChild $BackupRoot $record.path
        if((Test-Path -LiteralPath $destination) -and (Get-Hash $destination)-eq $record.installed_sha256 -and (Test-Path -LiteralPath $backup) -and (Get-Hash $backup)-eq $record.backup_sha256) { Copy-Item -LiteralPath $backup -Destination $destination -Force }
        else { $conflicts+=@{path=$record.path;action='preserved_modified_overwritten'} }
      }
    } catch { $conflicts+=@{path=$record.path;action='rollback_error';detail=$_.Exception.Message} }
  }
  if($conflicts.Count){[ordered]@{code='INSTALL_ROLLBACK_CONFLICT';conflicts=$conflicts}|ConvertTo-Json -Compress|Write-Error}
  elseif($receipt -and (Test-Path -LiteralPath $receipt)){Remove-Item -LiteralPath $receipt -Force}
  throw
} finally {
  if(Test-Path -LiteralPath $StageRoot){Remove-Item -LiteralPath $StageRoot -Recurse -Force}
}
