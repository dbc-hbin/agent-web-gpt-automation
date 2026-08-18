[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$AgentHome=$(if($env:AGENT_WEB_GPT_HOME){$env:AGENT_WEB_GPT_HOME}elseif($env:CODEX_HOME){$env:CODEX_HOME}elseif(Test-Path (Join-Path $env:USERPROFILE '.codex')){Join-Path $env:USERPROFILE '.codex'}else{Join-Path $env:USERPROFILE '.agent-web-gpt'}),[string]$Receipt)
# Safe inverse of install: only unchanged created files are removed; unchanged overwritten files are restored.
if(!$Receipt){$dir=Join-Path $AgentHome 'receipts';$Receipt=(Get-ChildItem -LiteralPath $dir -Filter 'codexpro-automation-*.json' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1).FullName}
if(!$Receipt){throw 'no install receipt; refusing to remove unowned files'}
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'rollback.ps1') -Receipt $Receipt -AgentHome $AgentHome -WhatIf:$WhatIfPreference
exit $LASTEXITCODE
