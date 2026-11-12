@echo off
rem Double-click this file to install or update Titan Up on this Windows computer.
rem Options can be added when run from a command prompt, for example:
rem   install-windows.cmd -Port 80
rem   install-windows.cmd -CurrentUser     (no administrator rights)
rem   install-windows.cmd -Uninstall
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\install.ps1" -Pause %*
