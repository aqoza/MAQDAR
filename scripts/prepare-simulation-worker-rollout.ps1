param([string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$revision = (git -C $sourceRoot rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the release revision' }
if (-not $Destination) { $Destination = Join-Path $sourceRoot ".tmp/simulation-rollout-$revision" }
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists; inspect it or choose a new empty path' }
$migrationDirectory = Join-Path $Destination 'supabase/migrations'
New-Item -ItemType Directory -Path $migrationDirectory -Force | Out-Null
# This pending workbench is unrelated to simulations and is deliberately excluded.
$excluded = '20261019153205_disposition_integration_workbench.sql'
$required = @(
 '20261019194823_policy_sensitivity.sql',
 '20261019210852_policy_configurations.sql',
 '20261019220301_scoped_simulation_worker.sql'
)
foreach ($name in $required) {
 if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "supabase/migrations/$name"))) { throw "Missing required migration: $name" }
}
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'supabase/migrations') -File -Filter '*.sql' |
 Where-Object { ($_.Name -le '20261019180044_policy_simulations.sql' -and $_.Name -ne $excluded) -or $_.Name -in $required } |
 Copy-Item -Destination $migrationDirectory
@'
project_id = "maqdar-simulation-rollout-review"
[db]
major_version = 17
[db.seed]
enabled = false
'@ | Set-Content -LiteralPath (Join-Path $Destination 'supabase/config.toml') -Encoding utf8
$manifest = Get-ChildItem -LiteralPath $migrationDirectory -File | Sort-Object Name |
 ForEach-Object { "$(($_ | Get-FileHash -Algorithm SHA256).Hash.ToLower())  $($_.Name)" }
$manifest | Set-Content -LiteralPath (Join-Path $Destination 'migration-sha256.txt') -Encoding utf8
Write-Output "Prepared local-only rollout at $Destination from $revision"
Write-Output 'No database connection or migration push was performed.'
