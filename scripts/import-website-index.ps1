param(
  [Parameter(Mandatory=$true)][string]$SnapshotPath,
  [Parameter(Mandatory=$true)][string]$ReportDirectory,
  [string]$CredentialPath="$env:USERPROFILE/.codex/private/pulserx-admin.credential.xml",
  [string]$ApiBase='https://api.pulserx.ai'
)
$ErrorActionPreference='Stop'
$snapshot=Get-Content -LiteralPath $SnapshotPath -Raw
$parsed=$snapshot|ConvertFrom-Json
if($parsed.surveySlug -notin @('nubeqa','brukinsa','padcev')) { throw 'Unknown bot' }
if(([uri]$ApiBase).Scheme -ne 'https') { throw 'Admin requests require HTTPS' }
$credential=Import-Clixml -LiteralPath $CredentialPath
$login=Invoke-RestMethod -Uri "$ApiBase/admin/auth/login" -Method Post -ContentType 'application/json' -Body (@{password=$credential.GetNetworkCredential().Password}|ConvertTo-Json)
$headers=@{Authorization="Bearer $($login.token)"}
New-Item -ItemType Directory -Path $ReportDirectory -Force|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$brand=$parsed.surveySlug
$backup=Invoke-RestMethod -Uri "$ApiBase/admin/source-library/export?surveySlug=$brand" -Headers $headers -TimeoutSec 120
$backup|ConvertTo-Json -Depth 60|Set-Content -LiteralPath (Join-Path $ReportDirectory "$brand-before-$stamp.json") -Encoding utf8
$result=Invoke-RestMethod -Uri "$ApiBase/admin/source-library/website-index" -Headers $headers -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($snapshot)) -TimeoutSec 180
$result|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $ReportDirectory "$brand-import-$stamp.json") -Encoding utf8
$inventory=Invoke-RestMethod -Uri "$ApiBase/admin/source-library/documents?surveySlug=$brand" -Headers $headers
$inventory|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $ReportDirectory "$brand-after-$stamp.json") -Encoding utf8
$active=@($inventory.documents|Where-Object {$_.status -eq 'ACTIVE' -and $_.tags -contains 'website-index:v1'})
if($active.Count -lt $parsed.pages.Count) { throw 'Post-import active-page count is smaller than the snapshot' }
[pscustomobject]@{Bot=$brand;Created=$result.created;Unchanged=$result.unchanged;Archived=$result.archived;ActiveIndexedPages=$active.Count;ReportedIssues=$result.issues.Count;ReportId=$result.reportId}|ConvertTo-Json
