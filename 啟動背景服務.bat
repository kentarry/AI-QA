@echo off
chcp 65001 >nul
title 品檢看板 - 背景服務安裝程式

echo.
echo ============================================================
echo   品檢流程看板 - 一鍵啟動背景服務
echo ============================================================
echo.

:: 檢查 Node.js 是否已安裝
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Node.js，請先安裝 Node.js！
    echo 下載網址: https://nodejs.org/
    pause
    exit /b 1
)

:: 取得目前批次檔所在目錄
set "SCRIPT_DIR=%~dp0"

:: 先關閉任何已在背景執行的舊 server.js 程序
echo [1/3] 正在清除舊的背景程序...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list 2^>nul ^| findstr "PID"') do (
    wmic process where "ProcessId=%%i" get CommandLine 2>nul | findstr /i "server.js" >nul 2>nul
    if not errorlevel 1 (
        taskkill /pid %%i /f >nul 2>nul
        echo    已終止舊程序 PID: %%i
    )
)

:: 透過 VBS 以隱藏視窗模式啟動 Node.js
echo [2/3] 正在以背景模式啟動伺服器...
cscript //nologo "%SCRIPT_DIR%server_hidden.vbs"

:: 等待 2 秒確認啟動
timeout /t 2 /nologo >nul

:: 驗證是否成功啟動
tasklist /fi "imagename eq node.exe" 2>nul | findstr /i "node.exe" >nul
if %errorlevel% equ 0 (
    echo [3/3] 啟動成功！
    echo.
    echo ============================================================
    echo   ✅ 伺服器已在 Windows 背景靜默執行！
    echo ============================================================
    echo.
    echo   📡 本機網頁: http://localhost:3939/
    echo   🌐 區域網路: 請查看 sync_log.txt 取得 LAN IP
    echo   🤖 AI 工具掃描: 每 5 分鐘自動同步
    echo   📂 點工具名稱: 壓縮檔直接下載 / 資料夾直接開啟
    echo   🔕 CMD 視窗已完全隱藏，不會打擾工作
    echo.
    echo   如需停止服務，請執行「停止背景服務.bat」
    echo ============================================================
) else (
    echo [錯誤] 啟動失敗，請檢查 server.js 是否有語法錯誤。
    echo 可嘗試手動執行: node server.js 查看錯誤訊息。
)

echo.
pause
