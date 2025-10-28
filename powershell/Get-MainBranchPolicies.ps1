#Requires -Version 5.1
<#
.SYNOPSIS
    Extract Azure DevOps main branch policies using Azure DevOps CLI
.DESCRIPTION
    This script uses the Azure DevOps CLI (az devops) and REST API to extract all 
    branch policies for the default branch of each repository in a project and exports 
    them to a CSV file. Each policy setting is exported as a separate row.
.EXAMPLE
    .\Get-MainBranchPolicies.ps1
#>

[CmdletBinding()]
param()

# Load environment variables from .env file
Write-Host "Loading configuration from .env file..." -ForegroundColor Cyan
$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) {
    Write-Error ".env file not found at $envPath. Please create it with AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT"
    exit 1
}

$envVars = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        $envVars[$matches[1]] = $matches[2]
    }
}

$orgUrl = $envVars['AZURE_DEVOPS_ORG_URL']
$project = $envVars['AZURE_DEVOPS_PROJECT']
$pat = $envVars['AZURE_DEVOPS_PAT']

if (-not $orgUrl -or -not $project -or -not $pat) {
    Write-Error "Missing required environment variables. Please ensure AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT are set in .env"
    exit 1
}

Write-Host "Organization: $orgUrl" -ForegroundColor Green
Write-Host "Project: $project" -ForegroundColor Green

# Configure Azure DevOps CLI
Write-Host "`nConfiguring Azure DevOps CLI..." -ForegroundColor Cyan
$env:AZURE_DEVOPS_EXT_PAT = $pat
az devops configure --defaults organization=$orgUrl project=$project | Out-Null

# Get all repositories
Write-Host "Fetching repositories..." -ForegroundColor Cyan
$reposJson = az repos list --project $project --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to fetch repositories: $reposJson"
    exit 1
}

$repos = $reposJson | ConvertFrom-Json
Write-Host "Found $($repos.Count) repositories" -ForegroundColor Green

# Prepare output array
$outputData = @()

# Define all known policy types and their typical settings
$allPolicyTypes = @{
    "Minimum number of reviewers" = @{
        TypeId = "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"
        Settings = @("minimumApproverCount", "creatorVoteCounts", "allowDownvotes", "resetOnSourcePush", "requireVoteOnLastIteration", "resetRejectionsOnSourcePush")
    }
    "Work item linking" = @{
        TypeId = "40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e"
        Settings = @("isBlocking")
    }
    "Comment requirements" = @{
        TypeId = "c6a1889d-b943-4856-b76f-9e46bb6b0df2"
        Settings = @("isBlocking")
    }
    "Required reviewers" = @{
        TypeId = "fd2167ab-b0be-447a-8ec8-39368250530e"
        Settings = @("requiredReviewerIds", "message", "filenamePatterns")
    }
    "Build validation" = @{
        TypeId = "0609b952-1397-4640-95ec-e00a01b2c241"
        Settings = @("buildDefinitionId", "displayName", "queueOnSourceUpdateOnly", "manualQueueOnly", "validDuration")
    }
    "Status checks" = @{
        TypeId = "cbdc66da-9728-4af2-8139-47b6c9a6d8c8"
        Settings = @("statusName", "statusGenre", "authorId", "invalidateOnUpdate")
    }
    "Automatically included reviewers" = @{
        TypeId = "fd2167ab-b0be-447a-8ec8-39368250530e"
        Settings = @("requiredReviewerIds", "filenamePatterns", "addedFilenamePatterns", "message")
    }
    "Require a merge strategy" = @{
        TypeId = "fa4e907d-c16b-4a4c-9dfa-4916e5d171ab"
        Settings = @("allowSquash", "allowNoFastForward", "allowRebase", "allowRebaseMerge")
    }
}

# Get project ID
Write-Host "`nFetching project details..." -ForegroundColor Cyan
$projectJson = az devops project show --project $project --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to fetch project details: $projectJson"
    exit 1
}
$projectInfo = $projectJson | ConvertFrom-Json
$projectId = $projectInfo.id

# Create authorization header for REST API calls
$base64AuthInfo = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
$headers = @{
    Authorization = "Basic $base64AuthInfo"
    "Content-Type" = "application/json"
}

# Process each repository
foreach ($repo in $repos) {
    Write-Host "`nProcessing repository: $($repo.name)" -ForegroundColor Cyan
    
    # Get default branch
    $defaultBranch = $repo.defaultBranch
    if (-not $defaultBranch) {
        Write-Host "  No default branch found, skipping..." -ForegroundColor Yellow
        
        # Still add rows showing no policies enabled
        foreach ($policyTypeName in $allPolicyTypes.Keys) {
            $policyType = $allPolicyTypes[$policyTypeName]
            foreach ($setting in $policyType.Settings) {
                $outputData += [PSCustomObject]@{
                    Repository = $repo.name
                    RepositoryId = $repo.id
                    Branch = "N/A"
                    PolicyType = $policyTypeName
                    PolicyId = "N/A"
                    IsEnabled = "No Default Branch"
                    SettingName = $setting
                    SettingValue = "N/A"
                }
            }
        }
        continue
    }
    
    # Remove refs/heads/ prefix if present
    $branchName = $defaultBranch -replace '^refs/heads/', ''
    Write-Host "  Default branch: $branchName" -ForegroundColor Gray
    
    # Fetch branch policies using REST API
    $policiesUrl = "$orgUrl/$project/_apis/policy/configurations?api-version=7.1"
    
    try {
        $response = Invoke-RestMethod -Uri $policiesUrl -Headers $headers -Method Get
        $allPolicies = $response.value
        
        # Filter policies for this repository and branch
        $branchPolicies = $allPolicies | Where-Object {
            $_.isEnabled -ne $null -and
            $_.settings.scope -and
            $_.settings.scope.Count -gt 0 -and
            ($_.settings.scope | Where-Object {
                $_.repositoryId -eq $repo.id -and
                $_.refName -eq "refs/heads/$branchName"
            })
        }
        
        Write-Host "  Found $($branchPolicies.Count) enabled policies" -ForegroundColor Gray
        
        # Track which policy types are configured
        $configuredPolicyTypes = @{}
        
        # Process enabled policies
        foreach ($policy in $branchPolicies) {
            $policyTypeName = switch ($policy.type.id) {
                "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd" { "Minimum number of reviewers" }
                "40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e" { "Work item linking" }
                "c6a1889d-b943-4856-b76f-9e46bb6b0df2" { "Comment requirements" }
                "fd2167ab-b0be-447a-8ec8-39368250530e" { "Required reviewers" }
                "0609b952-1397-4640-95ec-e00a01b2c241" { "Build validation" }
                "cbdc66da-9728-4af2-8139-47b6c9a6d8c8" { "Status checks" }
                "fa4e907d-c16b-4a4c-9dfa-4916e5d171ab" { "Require a merge strategy" }
                default { $policy.type.displayName }
            }
            
            $configuredPolicyTypes[$policyTypeName] = $true
            
            # Extract all settings from the policy
            $settings = $policy.settings
            
            # Get the expected settings for this policy type
            $expectedSettings = if ($allPolicyTypes.ContainsKey($policyTypeName)) {
                $allPolicyTypes[$policyTypeName].Settings
            } else {
                # For unknown policy types, extract all properties from settings
                $settings.PSObject.Properties.Name | Where-Object { $_ -ne 'scope' }
            }
            
            # Create a row for each setting
            foreach ($settingName in $expectedSettings) {
                $settingValue = if ($settingName -eq 'isBlocking') {
                    # isBlocking is at the policy level, not in settings
                    if ($policy.isBlocking) { "Required" } else { "Optional" }
                } elseif ($settings.PSObject.Properties.Name -contains $settingName) {
                    $value = $settings.$settingName
                    if ($value -is [Array]) {
                        ($value | ConvertTo-Json -Compress)
                    } elseif ($value -is [PSCustomObject]) {
                        ($value | ConvertTo-Json -Compress)
                    } elseif ($null -eq $value) {
                        "null"
                    } else {
                        $value.ToString()
                    }
                } else {
                    "Not Set"
                }
                
                $outputData += [PSCustomObject]@{
                    Repository = $repo.name
                    RepositoryId = $repo.id
                    Branch = $branchName
                    PolicyType = $policyTypeName
                    PolicyId = $policy.id
                    IsEnabled = if ($policy.isEnabled) { "Yes" } else { "No" }
                    SettingName = $settingName
                    SettingValue = $settingValue
                }
            }
        }
        
        # Add rows for policy types that are not configured
        foreach ($policyTypeName in $allPolicyTypes.Keys) {
            if (-not $configuredPolicyTypes.ContainsKey($policyTypeName)) {
                $policyType = $allPolicyTypes[$policyTypeName]
                foreach ($setting in $policyType.Settings) {
                    $outputData += [PSCustomObject]@{
                        Repository = $repo.name
                        RepositoryId = $repo.id
                        Branch = $branchName
                        PolicyType = $policyTypeName
                        PolicyId = "Not Configured"
                        IsEnabled = "No"
                        SettingName = $setting
                        SettingValue = "Not Set"
                    }
                }
            }
        }
        
    } catch {
        Write-Warning "  Failed to fetch policies for $($repo.name): $_"
        
        # Add rows showing error state
        foreach ($policyTypeName in $allPolicyTypes.Keys) {
            $policyType = $allPolicyTypes[$policyTypeName]
            foreach ($setting in $policyType.Settings) {
                $outputData += [PSCustomObject]@{
                    Repository = $repo.name
                    RepositoryId = $repo.id
                    Branch = $branchName
                    PolicyType = $policyTypeName
                    PolicyId = "Error"
                    IsEnabled = "Error"
                    SettingName = $setting
                    SettingValue = "Error fetching policies"
                }
            }
        }
    }
}

# Export to CSV
$outputFile = Join-Path $PSScriptRoot "..\branch-policies.csv"
Write-Host "`nExporting results to CSV..." -ForegroundColor Cyan
$outputData | Export-Csv -Path $outputFile -NoTypeInformation -Encoding UTF8

Write-Host "`nComplete! Exported $($outputData.Count) policy setting rows to: $outputFile" -ForegroundColor Green
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  - Repositories processed: $($repos.Count)" -ForegroundColor Gray
Write-Host "  - Total policy setting rows: $($outputData.Count)" -ForegroundColor Gray
