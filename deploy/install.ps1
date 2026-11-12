<#
.SYNOPSIS
  Installs (or updates) Titan Up on a Windows computer and keeps it running in the background.

.DESCRIPTION
  Easiest: double-click install-windows.cmd in the folder above this one.

  What it does:
    1. Downloads a private copy of Node.js into the app folder (nothing is installed system-wide).
    2. Installs the app's packages.
    3. Registers a scheduled task that starts Titan Up when Windows starts, with no one
       logged in, and restarts it if it stops. Opens the port in Windows Firewall.

  Run it again after updating the files; it restarts Titan Up with the new version.

.PARAMETER Port
  Port to serve on. Default 8080.

.PARAMETER DataDir
  Folder for the database and log. Default: the "data" folder inside the app folder.

.PARAMETER CurrentUser
  For when you have no administrator rights: run Titan Up as you, starting when you log on.
  It only runs while you are logged on (a disconnected Remote Desktop session counts).

.PARAMETER NoService
  Only prepare Node.js and the packages, then print the command to start Titan Up by hand.

.PARAMETER Uninstall
  Stop Titan Up and remove the scheduled task and firewall rule. Files and data are kept.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\install.ps1 -Port 80
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [string]$DataDir,
  [switch]$CurrentUser,
  [switch]$NoService,
  [switch]$Uninstall,
  [string]$TaskName = 'Titan Up',
  [switch]$Pause,     # wait for Enter before closing (used by install-windows.cmd)
  [switch]$NoPause,   # never wait for Enter (for automation)
  [switch]$Elevated   # internal: set when this script restarted itself as administrator
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$NodeLine = 22
$AppDir = Split-Path -Parent $PSScriptRoot
if (-not $DataDir) { $DataDir = Join-Path $AppDir 'data' }
$DataDir = $DataDir.TrimEnd('\')
$LogFile = Join-Path $DataDir 'titan-up.log'
$InstallLog = Join-Path $PSScriptRoot 'install.log'
$NodeDir = Join-Path $AppDir '.node'
$Node = Join-Path $NodeDir 'node.exe'
$LocalServiceSid = '*S-1-5-19'

function Say($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Note($text) { Write-Host ''; Write-Host "Note: $text" -ForegroundColor Yellow }
function Fail($text) { throw $text }

function Test-Admin {
  $me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-NodeOk($exe) {
  if (-not (Test-Path $exe)) { return $false }
  & $exe -e 'const [a, b] = process.versions.node.split(/\./).map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'
  return ($LASTEXITCODE -eq 0)
}

function New-WebClient {
  $client = New-Object Net.WebClient
  # Use the proxy Windows is configured with, signing in as the current user if it asks.
  if ($client.Proxy) { $client.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials }
  return $client
}

# ---------- 1. Node.js ----------
# Always a private copy inside the app folder: it needs no administrator rights,
# changes nothing else on the computer, and the background task can always read it.
function Install-Node {
  Say 'Finding Node.js'
  if (Test-NodeOk $Node) {
    Write-Host "Using Node.js $(& $Node --version) at $Node"
    return
  }
  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Titan Up needs 64-bit Windows.' }
  $arch = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }

  $base = "https://nodejs.org/dist/latest-v$NodeLine.x"
  Write-Host 'Downloading a private copy of Node.js from nodejs.org'
  $client = New-WebClient
  try {
    $sums = $client.DownloadString("$base/SHASUMS256.txt")
  } catch {
    Fail "Could not reach nodejs.org ($($_.Exception.InnerException.Message)). Check that this computer can open https://nodejs.org in a browser, then run this again."
  }
  $line = ($sums -split "`n") | Where-Object { $_.Trim() -match "win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { Fail "nodejs.org lists no Node.js $NodeLine download for Windows $arch." }
  $want, $name = $line.Trim() -split '\s+'

  $work = Join-Path ([IO.Path]::GetTempPath()) "titan-up-node-$PID"
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  try {
    $zip = Join-Path $work $name
    $client.DownloadFile("$base/$name", $zip)
    $got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $want.ToLower()) { Fail 'The Node.js download is corrupt (checksum mismatch). Run this again.' }
    Expand-Archive -Path $zip -DestinationPath $work -Force
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item -Path (Join-Path $work ($name -replace '\.zip$', '')) -Destination $NodeDir
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
  if (-not (Test-NodeOk $Node)) { Fail 'The downloaded Node.js does not run on this computer. It needs Windows 10, Windows Server 2016, or newer.' }
  Write-Host "Using Node.js $(& $Node --version) at $Node"
}

# ---------- 2. Packages ----------
# node_modules\.lock-hash records which package-lock.json the installed packages
# match, so this step is skipped when nothing changed.
function Install-Packages {
  $lockHash = (Get-FileHash -Path (Join-Path $AppDir 'package-lock.json') -Algorithm SHA256).Hash.ToLower()
  $marker = Join-Path $AppDir 'node_modules\.lock-hash'
  if ((Test-Path $marker) -and ((Get-Content -Raw $marker).Trim() -eq $lockHash)) {
    Say 'Packages are already installed'
    return
  }
  Say 'Installing packages'
  $oldPath = $env:Path
  $env:Path = "$NodeDir;$env:Path"
  Push-Location $AppDir
  try {
    $ErrorActionPreference = 'Continue'
    & (Join-Path $NodeDir 'npm.cmd') ci --omit=dev --no-audit --no-fund
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
    $env:Path = $oldPath
  }
  if ($code -ne 0) { Fail 'Could not install the packages. Check that this computer can open https://registry.npmjs.org in a browser, then run this again.' }
  Set-Content -Path $marker -Value $lockHash -NoNewline -Encoding ASCII
}

# ---------- 3. Background task ----------
# The task runs deploy\run.ps1, a small keep-alive script that starts the server
# and starts it again if it stops. Stopping the task stops that script, and the
# server shuts itself down when the script is gone.

# Server processes started from this copy of Titan Up.
function Get-TitanUpProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $Node }
}

function Stop-TitanUp {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  # Give the server a few seconds to notice and exit by itself, then make sure.
  for ($i = 0; $i -lt 10 -and (Get-TitanUpProcess); $i++) { Start-Sleep -Milliseconds 500 }
  Get-TitanUpProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  return [bool]$task
}

function Assert-PortFree {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $owner = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Fail "Port $Port is already used by another program ($owner). Pick a free one, for example: install-windows.cmd -Port 8090"
  }
}

function Get-RunArguments {
  return "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'run.ps1')`" -Port $Port -DataDir `"$DataDir`""
}

function Register-MachineTask {
  Say "Setting up the background task `"$TaskName`" (starts with Windows)"
  # Run as the built-in low-privilege "Local Service" account rather than as an administrator.
  & icacls $AppDir /grant "${LocalServiceSid}:(OI)(CI)RX" /Q | Out-Null
  & icacls $DataDir /grant "${LocalServiceSid}:(OI)(CI)M" /Q | Out-Null

  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount
  Register-TitanUpTask $trigger $principal

  Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $TaskName -Description 'Lets other computers open Titan Up.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program $Node | Out-Null
  Write-Host "Opened port $Port in Windows Firewall."
}

function Register-UserTask {
  Say "Setting up the background task `"$TaskName`" (starts when $env:USERNAME logs on)"
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  Register-TitanUpTask $trigger $principal
  Note "Titan Up runs only while $env:USERNAME is logged on to this computer. If teammates cannot reach it, an administrator also needs to allow port $Port through Windows Firewall."
}

function Register-TitanUpTask($trigger, $principal) {
  # The window is hidden so nothing sits on the desktop when the task runs as a logged-on user.
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (Get-RunArguments) -WorkingDirectory $AppDir
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Description 'Titan Up team retrospectives (web server).' `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

function Wait-ForTitanUp {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $reply = (New-Object Net.WebClient).DownloadString("http://127.0.0.1:$Port/healthz")
      if ($reply -match '"ok"\s*:\s*true') { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  $tail = ''
  if (Test-Path $LogFile) { $tail = "`n`nLast lines of ${LogFile}:`n" + ((Get-Content $LogFile -Tail 15) -join "`n") }
  Fail "Titan Up was set up but is not answering on port $Port.$tail"
}

function Show-Result {
  $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress
  Say 'Titan Up is running'
  Write-Host "  On this computer:    http://localhost:$Port"
  Write-Host "  For your teammates:  http://$($env:COMPUTERNAME.ToLower()):$Port"
  if ($address) { Write-Host "                       http://${address}:$Port" }
  Write-Host "  Data and log:        $DataDir"
  Write-Host "  Stop or start it:    Task Scheduler, task `"$TaskName`""
  Write-Host '  Update:              replace the files, then run this installer again'
}

function Uninstall-TitanUp {
  Say "Removing the background task `"$TaskName`""
  if (Stop-TitanUp) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host 'Stopped and removed the task.'
  } else {
    Write-Host 'There was no task to remove.'
  }
  if (Test-Admin) {
    Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    & icacls $AppDir /remove $LocalServiceSid /Q | Out-Null
  }
  Write-Host "Your files and data are still in $AppDir. Delete that folder to remove everything."
}

function Main {
  if ($Port -lt 1 -or $Port -gt 65535) { Fail "Port must be between 1 and 65535, got $Port." }

  if ($Uninstall) {
    Uninstall-TitanUp
    return
  }

  Install-Node
  Install-Packages
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

  if ($NoService) {
    Say 'Ready. Start Titan Up with:'
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'run.ps1')`" -Port $Port -DataDir `"$DataDir`""
    return
  }

  Stop-TitanUp | Out-Null
  Assert-PortFree
  if ($CurrentUser) { Register-UserTask } else { Register-MachineTask }
  Wait-ForTitanUp
  Show-Result
}

# ---------- entry ----------
# Setting up a task that runs without anyone logged in needs administrator
# rights, so restart as administrator (Windows asks for permission).
$needsAdmin = -not $CurrentUser -and -not $NoService
if ($needsAdmin -and -not (Test-Admin)) {
  if ($Elevated) {
    Write-Host 'Error: administrator rights were not granted.' -ForegroundColor Red
    exit 1
  }
  Write-Host 'Titan Up needs administrator rights to run in the background. Windows will ask for permission.'
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port, '-DataDir', "`"$DataDir`"", '-TaskName', "`"$TaskName`"", '-Elevated')
  if ($Uninstall) { $arguments += '-Uninstall' }
  if ($NoPause) { $arguments += '-NoPause' }
  try {
    $child = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  } catch {
    Write-Host ''
    Write-Host "Error: administrator rights were not granted ($($_.Exception.Message.Trim()))." -ForegroundColor Red
    Write-Host 'If you have no administrator rights on this computer, run:  install-windows.cmd -CurrentUser'
    if ($Pause -and -not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
  }
  if ($child.ExitCode -eq 0) { Write-Host 'Done. Details are in the other window and in deploy\install.log.' }
  exit $child.ExitCode
}

$exitCode = 0
try { Start-Transcript -Path $InstallLog -Force | Out-Null } catch {}
try {
  Main
} catch {
  Write-Host ''
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
if (($Pause -or $Elevated) -and -not $NoPause) {
  Write-Host ''
  Read-Host 'Press Enter to close' | Out-Null
}
exit $exitCode
