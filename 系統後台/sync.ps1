$scriptDir = $env:SCRIPT_DIR
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$aiToolsDir = Split-Path -Parent $scriptDir

# Check if node.exe is installed
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host '[Sync] Scanning and uploading AI tools...' -ForegroundColor Cyan
    
    # Run server.js passing its absolute path to Node.js
    node "$scriptDir\server.js"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host '[Done] Sync completed successfully!' -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host '==================================================' -ForegroundColor Red
        Write-Host '  ERROR: server.js execution failed!' -ForegroundColor Red
        Write-Host '==================================================' -ForegroundColor Red
        Read-Host 'Press Enter to close...'
    }
} else {
    Write-Host '==================================================' -ForegroundColor Red
    Write-Host '  ERROR: Node.js is not installed!' -ForegroundColor Red
    Write-Host '==================================================' -ForegroundColor Red
    Write-Host 'Downloading official Node.js installer (.msi)...'
    
    $msiPath = Join-Path $env:TEMP 'node_install.msi'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        (New-Object Net.WebClient).DownloadFile('https://nodejs.org/dist/v20.13.1/node-v20.13.1-x64.msi', $msiPath)
    } catch {
        Write-Host 'Download failed!' -ForegroundColor Red
    }
    
    if (Test-Path $msiPath) {
        Write-Host 'Starting Node.js installer wizard...'
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`"" -Wait
        Write-Host 'Please re-run this script after installation.'
    } else {
        Write-Host 'Download failed. Opening Node.js website...' -ForegroundColor Red
        Start-Process 'https://nodejs.org/'
    }
    Read-Host 'Press Enter to exit...'
}
