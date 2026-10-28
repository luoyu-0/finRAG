param([switch]$Build)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location -LiteralPath $projectRoot
try {
    $composeArguments = @('compose', 'up', '-d', '--wait')
    if ($Build) {
        $composeArguments += '--build'
    }
    & docker @composeArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose 启动失败，未输出前端入口。'
    }

    $published = & docker compose port frontend 80
    if ($LASTEXITCODE -ne 0 -or -not $published) {
        throw '服务已启动，但无法读取前端映射端口。'
    }

    $address = ($published | Select-Object -First 1).Trim()
    $address = $address -replace '^0\.0\.0\.0:', '127.0.0.1:'
    $address = $address -replace '^\[::\]:', '127.0.0.1:'
    Write-Host "前端入口：http://$address/"
}
finally {
    Pop-Location
}
