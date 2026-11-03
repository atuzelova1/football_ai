param([switch]$Setup, [switch]$NoBrowser, [switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath $PSScriptRoot
$backend = $null
$frontend = $null

function Assert-PortFree([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    $occupied = $false
    try {
        $attempt = $client.ConnectAsync('127.0.0.1', $Port)
        if ($attempt.Wait(300)) { $occupied = $client.Connected }
    } catch {
        # Отказ подключения означает, что порт свободен.
    } finally { $client.Dispose() }
    if ($occupied) { throw "Порт $Port уже занят. Завершите предыдущий сервер и повторите запуск." }
}

function Wait-Server([string]$Url, [System.Diagnostics.Process]$Process, [bool]$Health) {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw "Сервер завершился с кодом $($Process.ExitCode). Проверьте зависимости через setup.ps1." }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                if (-not $Health -or ($response.Content | ConvertFrom-Json).ready) { return }
            }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    throw "Сервер не готов по адресу $Url. Выполните setup.ps1; для отсутствующей базы добавьте -PrepareData."
}

try {
    if ($Setup) { & (Join-Path $PSScriptRoot 'setup.ps1'); if ($LASTEXITCODE -ne 0) { throw 'Однократная подготовка завершилась ошибкой.' } }
    $python = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
    $vite = Join-Path $PSScriptRoot 'frontend/node_modules/vite/bin/vite.js'
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $vite) -or -not $node) {
        throw 'Сначала выполните: powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Setup'
    }
    Assert-PortFree 8000
    Assert-PortFree 5173
    Write-Host 'Запуск Football AI — Тактический интеллект...' -ForegroundColor Cyan
    $backend = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory (Join-Path $PSScriptRoot 'backend') -WindowStyle Hidden -PassThru
    Wait-Server 'http://127.0.0.1:8000/api/health' $backend $true
    $frontend = Start-Process -FilePath $node.Source -ArgumentList @(('"' + $vite + '"'),'--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') -WindowStyle Hidden -PassThru
    Wait-Server 'http://127.0.0.1:5173/' $frontend $false
    Wait-Server 'http://127.0.0.1:5173/api/health' $frontend $true
    Write-Host ''
    Write-Host 'Приложение: http://127.0.0.1:5173' -ForegroundColor Green
    Write-Host 'API:        http://127.0.0.1:8000/api/docs'
    Write-Host 'Для остановки обоих серверов нажмите Ctrl+C в этом терминале.'
    if ($SmokeTest) { Write-Host 'Проверка запуска и API-прокси пройдена.' -ForegroundColor Green; return }
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173' }
    while (-not $backend.HasExited -and -not $frontend.HasExited) { Start-Sleep -Seconds 1 }
    throw 'Один из серверов остановился. Перезапустите приложение.'
} catch {
    Write-Host ('Ошибка запуска: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    foreach ($server in @($frontend, $backend)) {
        if ($null -ne $server) {
            if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
            $server.Dispose()
        }
    }
}
