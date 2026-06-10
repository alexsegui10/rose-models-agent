# Stop hook: si hay cambios en archivos TypeScript sin commitear, exige typecheck + tests en verde.
# exit 0 = permite terminar; exit 2 = bloquea y devuelve el error a Claude por stderr.
# Claude Code corta tras 8 bloqueos consecutivos, asi que no puede quedarse en bucle infinito.
$reader = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$evt = $null
try { $evt = $reader.ReadToEnd() | ConvertFrom-Json } catch {}

# Ejecutar siempre desde la raiz del proyecto (la cwd de la sesion puede haber cambiado)
$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir -and $evt -and $evt.cwd) { $projectDir = $evt.cwd }
if ($projectDir -and (Test-Path -LiteralPath (Join-Path $projectDir "package.json"))) {
    Set-Location $projectDir
}
if (-not (Test-Path "package.json")) { exit 0 }

$changed = git status --porcelain 2>$null | Where-Object { $_ -match '\.(ts|tsx)$' }
if (-not $changed) { exit 0 }

$out = cmd /c "npm run typecheck 2>&1"
if ($LASTEXITCODE -ne 0) {
    $tail = ($out | Select-Object -Last 30) -join "`n"
    [Console]::Error.WriteLine("STOP-GATE: 'npm run typecheck' FALLA. Arregla los errores de tipos antes de terminar:`n$tail")
    exit 2
}

$out = cmd /c "npm test 2>&1"
if ($LASTEXITCODE -ne 0) {
    $tail = ($out | Select-Object -Last 40) -join "`n"
    [Console]::Error.WriteLine("STOP-GATE: 'npm test' FALLA. Deja los tests en verde antes de terminar:`n$tail")
    exit 2
}

exit 0
