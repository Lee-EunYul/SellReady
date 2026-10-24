$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
if (-not (Test-Path $envPath)) { throw 'Project .env file was not found.' }

$envValues = @{}
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') {
        $envValues[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
}

$endpoint = $envValues['AZURE_OPENAI_ENDPOINT']
$deployment = $envValues['AZURE_OPENAI_DEPLOYMENT']
$allowedEmail = (Read-Host 'Microsoft Entra sign-in email allowed to use AI').Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($endpoint) -or [string]::IsNullOrWhiteSpace($deployment)) {
    throw 'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT must be set in .env first.'
}
if ($allowedEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Enter a valid Microsoft sign-in email address.' }

$endpointHost = ([uri]$endpoint).Host.ToLowerInvariant()
$accountsJson = & az cognitiveservices account list --output json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Could not list Azure AI resources in the active subscription.' }
$accounts = $accountsJson | ConvertFrom-Json
$matchingAccounts = @()
foreach ($account in $accounts) {
    $candidateEndpoints = @()
    if ($account.properties.endpoint) { $candidateEndpoints += $account.properties.endpoint }
    if ($account.properties.endpoints) { $candidateEndpoints += $account.properties.endpoints.PSObject.Properties.Value }
    foreach ($candidate in $candidateEndpoints) {
        try {
            if (([uri]$candidate).Host.ToLowerInvariant() -eq $endpointHost) {
                $matchingAccounts += [pscustomobject]@{ Name = $account.name; ResourceGroup = $account.resourceGroup }
                break
            }
        } catch { }
    }
}
$matchingAccounts = @($matchingAccounts | Sort-Object Name, ResourceGroup -Unique)
if ($matchingAccounts.Count -ne 1) {
    throw 'The endpoint must match exactly one Azure AI resource. No keys were rotated.'
}
$resource = $matchingAccounts[0]

Write-Output 'Rotating Azure AI Key1 and Key2; values will remain hidden.'
$newKey1 = & az cognitiveservices account keys regenerate --name $resource.Name --resource-group $resource.ResourceGroup --key-name Key1 --query key1 --output tsv 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($newKey1)) {
    throw 'Key1 rotation failed. No secret value was printed.'
}
$newKey2 = & az cognitiveservices account keys regenerate --name $resource.Name --resource-group $resource.ResourceGroup --key-name Key2 --query key2 --output tsv 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($newKey2)) {
    $newKey1 = $null
    throw 'Key1 was rotated, but Key2 rotation failed. Re-run this script before using AI.'
}

$updatedLines = [System.Collections.Generic.List[string]]::new()
$seenKey = $false
$seenAllowlist = $false
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^\s*AZURE_OPENAI_API_KEY\s*=') {
        if (-not $seenKey) { $updatedLines.Add("AZURE_OPENAI_API_KEY=$newKey1"); $seenKey = $true }
    } elseif ($line -match '^\s*AZURE_OPENAI_ALLOWED_EMAILS\s*=') {
        if (-not $seenAllowlist) { $updatedLines.Add("AZURE_OPENAI_ALLOWED_EMAILS=$allowedEmail"); $seenAllowlist = $true }
    } else {
        $updatedLines.Add($line)
    }
}
if (-not $seenKey) { $updatedLines.Add("AZURE_OPENAI_API_KEY=$newKey1") }
if (-not $seenAllowlist) { $updatedLines.Add("AZURE_OPENAI_ALLOWED_EMAILS=$allowedEmail") }
[System.IO.File]::WriteAllLines($envPath, $updatedLines, [System.Text.UTF8Encoding]::new($false))

$settings = @(
    "AZURE_OPENAI_ENDPOINT=$endpoint",
    "AZURE_OPENAI_API_KEY=$newKey1",
    "AZURE_OPENAI_DEPLOYMENT=$deployment",
    "AZURE_OPENAI_ALLOWED_EMAILS=$allowedEmail"
)
& az staticwebapp appsettings set --name sellready-web-20261018 --resource-group rg-sellready-prod --setting-names $settings --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    $newKey1 = $null
    $newKey2 = $null
    throw 'Keys were rotated and saved locally, but Azure Static Web Apps settings could not be updated. Re-run this script.'
}

$newKey1 = $null
$newKey2 = $null
$settings = $null
Write-Output "Azure resource matched: $($resource.Name) in $($resource.ResourceGroup)."
Write-Output 'Both Azure AI keys were rotated.'
Write-Output 'Endpoint, new API key, deployment and allowed Microsoft email were saved to Azure Static Web Apps Production settings.'
Write-Output 'The local .env API key and allowlist were updated. No secret values were printed.'
