<#
.SYNOPSIS
  Keeps Titan Up running: starts the server, and starts it again if it ever stops.

.DESCRIPTION
  This is what the "Titan Up" scheduled task runs (set up by install.ps1). Stopping
  the task stops this script, and the server shuts itself down when this script is gone.
  You can also run it yourself to start Titan Up in a console window:

    powershell -ExecutionPolicy Bypass -File deploy\run.ps1 -Port 8080
#>
param(
  [int]$Port = 8080,
  [string]$DataDir
)

$AppDir = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $AppDir '.node\node.exe'
if (-not $DataDir) { $DataDir = Join-Path $AppDir 'data' }
$LogFile = Join-Path $DataDir 'titan-up.log'

if (-not (Test-Path $Node)) {
  Write-Host 'Node.js is missing. Run install-windows.cmd first.'
  exit 1
}

Set-Location $AppDir
$delay = 2
while ($true) {
  $started = Get-Date
  & $Node --disable-warning=ExperimentalWarning server\index.js "--port=$Port" "--data-dir=$DataDir" "--log-file=$LogFile" --exit-with-parent
  # If it keeps failing straight away (say the port is taken), wait longer between
  # tries so the log does not fill up. A long healthy run resets the wait.
  if (((Get-Date) - $started).TotalSeconds -gt 30) { $delay = 2 } else { $delay = [Math]::Min($delay * 2, 60) }
  Start-Sleep -Seconds $delay
}
