@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = '%~dp0'; $sub = Get-ChildItem -Path $d -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'sync.ps1') } | Select-Object -First 1; if ($sub) { $env:SCRIPT_DIR = $sub.FullName; Get-Content (Join-Path $sub.FullName 'sync.ps1') -Raw | Invoke-Expression } else { Write-Error 'System folder not found!' }"
pause
