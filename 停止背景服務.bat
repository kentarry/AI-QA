@echo off
chcp 65001 >nul
title 品檢看板 - 停止背景服務

echo.
echo ============================================================
echo   品檢流程看板 - 停止背景服務
echo ============================================================
echo.

set "FOUND=0"
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list 2^>nul ^| findstr "PID"') do (
    wmic process where "ProcessId=%%i" get CommandLine 2>nul | findstr /i "server.js" >nul 2>nul
    if not errorlevel 1 (
        taskkill /pid %%i /f >nul 2>nul
        echo   已終止背景程序 PID: %%i
        set "FOUND=1"
    )
)

if "%FOUND%"=="0" (
    echo   目前沒有正在執行的看板背景服務。
) else (
    echo.
    echo   ✅ 所有看板背景服務已停止！
)

echo.
echo ============================================================
echo.
pause
