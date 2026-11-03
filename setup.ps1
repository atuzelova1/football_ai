param([switch]$PrepareData)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath $PSScriptRoot
try {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw 'Нужен Python 3.11–3.13 в PATH: https://www.python.org/downloads/' }
    & $pythonCommand.Source -c "import sys; sys.exit(0 if (3,11)<=sys.version_info[:2]<(3,14) else 1)"
    if ($LASTEXITCODE -ne 0) { throw 'Для закреплённых научных библиотек используйте Python 3.11, 3.12 или 3.13.' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Установите Node.js 22 LTS или 24+: https://nodejs.org/' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd не найден. Переустановите Node.js с npm и откройте новый терминал.' }
    node -e "const v=+process.versions.node.split('.')[0];process.exit(v===22||v>=24?0:1)"
    if ($LASTEXITCODE -ne 0) { throw 'Нужен Node.js 22 LTS или 24+.' }
    $venvPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        & $pythonCommand.Source -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать локальное виртуальное окружение.' }
    }
    Write-Host 'Установка Python-зависимостей...' -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade 'pip>=26.2'
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось обновить pip в локальном окружении.' }
    & $venvPython -m pip install -r backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить Python-зависимости. Проверьте доступ к PyPI.' }
    Push-Location -LiteralPath (Join-Path $PSScriptRoot 'frontend')
    try {
        Write-Host 'Установка frontend по package-lock.json...' -ForegroundColor Cyan
        npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить frontend-зависимости. Проверьте доступ к npm.' }
    } finally { Pop-Location }
    Push-Location -LiteralPath (Join-Path $PSScriptRoot 'backend')
    try {
        & $venvPython -c "from app.main import health; import sys; sys.exit(0 if health()['ready'] else 1)"
        $prepared = ($LASTEXITCODE -eq 0)
        if ($PrepareData -or -not $prepared) {
            Write-Host 'Подготовка реальных данных и моделей StatsBomb. Первая загрузка может занять несколько минут.' -ForegroundColor Cyan
            & $venvPython scripts/prepare_data.py
            if ($LASTEXITCODE -ne 0) { throw 'Подготовка данных не завершена. Повторный запуск продолжит обработку из кэша.' }
        } else {
            Write-Host 'Компактная база и модели готовы. Повторная загрузка и обучение пропущены.' -ForegroundColor Green
        }
    } finally { Pop-Location }
    Write-Host 'Готово. Запуск: powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1' -ForegroundColor Green
} catch {
    Write-Host ('Ошибка подготовки: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
exit 0
