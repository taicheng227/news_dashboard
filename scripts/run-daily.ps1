param(
  [switch]$Publish
)

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if ($Publish) {
  npm run daily -- --publish
} else {
  npm run daily
}

if ($LASTEXITCODE -ne 0) {
  throw "AI Radar daily run failed with exit code $LASTEXITCODE."
}
