param(
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$Time = '19:00',
  [switch]$Publish
)

$runner = Join-Path $PSScriptRoot 'run-daily.ps1'
$publishArgument = if ($Publish) { ' -Publish' } else { '' }
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`"$publishArgument"

& schtasks.exe /Create /F /SC DAILY /ST $Time /TN 'AI Radar Daily' /TR $taskCommand
if ($LASTEXITCODE -ne 0) {
  throw "Could not create the AI Radar scheduled task (exit code $LASTEXITCODE)."
}

Write-Output "AI Radar is scheduled daily at $Time."
