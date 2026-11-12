<#
.SYNOPSIS
  Keeps Titan Up running: starts the server, and starts it again if it ever stops.

.DESCRIPTION
  This is what the "Titan Up" scheduled task runs (set up by install.ps1). Stopping
  the task stops this script, and the server shuts itself down when this script is gone.
  Starts, stops and anything the server reports as an error go to titan-up.log in the
  data folder.

  You can also run it yourself to start Titan Up from a console window:

    powershell -ExecutionPolicy Bypass -File deploy\run.ps1 -Port 8080
#>
param(
  [int]$Port = 8080,
  [string]$DataDir
)

$AppDir = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $AppDir '.node\node.exe'
if (-not $DataDir) { $DataDir = Join-Path $AppDir 'data' }
$DataDir = $DataDir.TrimEnd('\')
$LogFile = Join-Path $DataDir 'titan-up.log'

function Log($text) {
  Write-Host $text
  try { Add-Content -Path $LogFile -Value "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $text" -Encoding UTF8 } catch {}
}

New-Item -ItemType Directory -Force -Path $DataDir -ErrorAction SilentlyContinue | Out-Null
if (-not (Test-Path $Node)) {
  Log 'Node.js is missing. Run install-windows.cmd first.'
  exit 1
}

$delay = 2
while ($true) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $Node
  $info.Arguments = "--disable-warning=ExperimentalWarning server\index.js --port=$Port `"--data-dir=$DataDir`" --exit-with-parent"
  $info.WorkingDirectory = $AppDir
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardError = $true

  $started = Get-Date
  try {
    $server = [Diagnostics.Process]::Start($info)
    Log "Server started on port $Port (process $($server.Id))."
    # Copy anything the server reports as an error into the log, as it happens.
    while ($null -ne ($line = $server.StandardError.ReadLine())) { Log $line }
    $server.WaitForExit()
    Log "Server stopped (exit code $($server.ExitCode)). Starting it again."
  } catch {
    Log "Could not start the server: $($_.Exception.Message)"
  }

  # If it keeps failing straight away (say the port is taken), wait longer between
  # tries so the log does not fill up. A long healthy run resets the wait.
  if (((Get-Date) - $started).TotalSeconds -gt 30) { $delay = 2 } else { $delay = [Math]::Min($delay * 2, 60) }
  Start-Sleep -Seconds $delay
}
