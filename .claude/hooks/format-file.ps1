# PostToolUse hook: formatea con Prettier el archivo recien editado/escrito.
# Lee el JSON del evento por stdin (UTF-8); nunca bloquea (siempre exit 0).
$reader = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$raw = $reader.ReadToEnd()
try { $evt = $raw | ConvertFrom-Json } catch { exit 0 }
$filePath = $null
if ($evt -and $evt.tool_input) { $filePath = $evt.tool_input.file_path }
if (-not $filePath) { exit 0 }
if ($filePath -notmatch '\.(ts|tsx)$') { exit 0 }
if (-not (Test-Path -LiteralPath $filePath)) { exit 0 }

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir -and $evt.cwd) { $projectDir = $evt.cwd }
if (-not $projectDir) { $projectDir = (Get-Location).Path }
$prettier = Join-Path $projectDir "node_modules\.bin\prettier.cmd"
if (-not (Test-Path -LiteralPath $prettier)) { exit 0 }
try { & $prettier --write $filePath | Out-Null } catch {}
exit 0
