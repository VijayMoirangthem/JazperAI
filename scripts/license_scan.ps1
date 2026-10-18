# Report-only SBOM + license scan -> docs/compliance/
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'docs\compliance'
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
& $py -m pip install -q cyclonedx-bom pip-licenses
& $py -m cyclonedx_py environment -o "$out\sbom.cdx.json" --of JSON 2>$null
$rows = & $py -m piplicenses --format=csv --with-urls 2>$null | ConvertFrom-Csv
$flag = $rows | Where-Object { $_.License -match 'GPL|AGPL|SSPL' }
Push-Location (Join-Path $root 'frontend')
$js = npx --yes license-checker --summary --json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
Pop-Location
$md = "# License report (report-only)`n`nPython packages: $($rows.Count). Flagged GPL/AGPL/SSPL: $($flag.Count)`n`n"
$md += ($flag | ForEach-Object { "- $($_.Name) $($_.Version): $($_.License)" }) -join "`n"
$md += "`n`n## Assets`n- LimeZu tilesets (see D-9/C-14): personal-use licence; replace in P3-10.`n"
Set-Content "$out\licenses.md" $md -Encoding utf8
