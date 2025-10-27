#Requires -Version 5.1
<#
.SYNOPSIS
    Extract Azure DevOps repository permissions using Azure DevOps CLI
.DESCRIPTION
    This script uses the Azure DevOps CLI (az devops) to extract all repository 
    permissions for a project and exports them to a CSV file.
.EXAMPLE
    .\Get-RepoPermissions.ps1
#>

[CmdletBinding()]
param()

# Load environment variables from .env file
Write-Host "Loading configuration from .env file..." -ForegroundColor Cyan
$envPath = Join-Path $PSScriptRoot "..\\.env"
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
    Write-Error "Missing required environment variables in .env file"
    exit 1
}

Write-Host "Organization: $orgUrl" -ForegroundColor Green
Write-Host "Project: $project" -ForegroundColor Green

# Set PAT token for Azure DevOps CLI
$env:AZURE_DEVOPS_EXT_PAT = $pat

# Configure Azure DevOps CLI defaults
Write-Host "`nConfiguring Azure DevOps CLI..." -ForegroundColor Cyan
az devops configure --defaults organization=$orgUrl project=$project

# Verify CLI is working
Write-Host "Verifying Azure DevOps CLI access..." -ForegroundColor Cyan
$projectTest = az devops project show --project $project 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to access Azure DevOps. Please check your PAT token and permissions."
    exit 1
}
Write-Host "✓ Successfully authenticated" -ForegroundColor Green

# Get Git security namespace ID
Write-Host "`nFetching security namespaces..." -ForegroundColor Cyan
$namespaces = az devops security permission namespace list --output json | ConvertFrom-Json
$gitNamespace = $namespaces | Where-Object { $_.name -eq 'Git Repositories' }
$gitNamespaceId = $gitNamespace.namespaceId

Write-Host "Git Repositories namespace ID: $gitNamespaceId" -ForegroundColor Green

# Get all repositories
Write-Host "`nFetching repositories..." -ForegroundColor Cyan
$repos = az repos list --project $project --output json | ConvertFrom-Json
Write-Host "Found $($repos.Count) repositories" -ForegroundColor Green

# Get project ID
$projectInfo = az devops project show --project $project --output json | ConvertFrom-Json
$projectId = $projectInfo.id
Write-Host "Project ID: $projectId" -ForegroundColor Green

# Collection to store all permissions
$allPermissions = @()

# Git repository permission bits
$gitPermissions = @{
    1 = "Administer"
    2 = "Read"
    4 = "Contribute"
    8 = "Force push (rewrite history, delete branches and tags)"
    16 = "Create branch"
    32 = "Create tag"
    64 = "Manage notes"
    128 = "Bypass policies when pushing"
    256 = "Create repository"
    512 = "Delete repository"
    1024 = "Rename repository"
    2048 = "Edit policies"
    4096 = "Remove others' locks"
    8192 = "Manage permissions"
    16384 = "Contribute to pull requests"
    32768 = "Bypass policies when completing pull requests"
}

function Convert-PermissionMask {
    param(
        [int]$allow,
        [int]$deny,
        [int]$bit
    )
    
    if (($deny -band $bit) -eq $bit) {
        return "Deny"
    }
    elseif (($allow -band $bit) -eq $bit) {
        return "Allow"
    }
    else {
        return "Not Set"
    }
}

# Fetch all identities once (groups and users)
Write-Host "`nFetching all security groups..." -ForegroundColor Cyan
$groupsResponse = az devops security group list --scope project --output json 2>$null | ConvertFrom-Json
$allGroups = $groupsResponse.graphGroups

if (-not $allGroups -or $allGroups.Count -eq 0) {
    Write-Error "Failed to fetch security groups or no groups found"
    exit 1
}
Write-Host "Found $($allGroups.Count) security groups" -ForegroundColor Green

Write-Host "Fetching all users..." -ForegroundColor Cyan
$usersResponse = az devops user list --output json 2>$null | ConvertFrom-Json
$allUsers = @()
if ($usersResponse -and $usersResponse.members) {
    $allUsers = $usersResponse.members
    Write-Host "Found $($allUsers.Count) users" -ForegroundColor Green
}
else {
    Write-Host "⚠ Could not fetch users, continuing with groups only..." -ForegroundColor Yellow
}

# Build identity lookup (descriptor -> display name and type)
$identityLookup = @{}
foreach ($group in $allGroups) {
    $identityLookup[$group.descriptor] = @{
        DisplayName = $group.displayName
        Type = "Group"
    }
    
    # Also add TeamFoundation identity descriptor if available
    # The vssgp descriptor encodes the SID in URL-safe Base64
    try {
        $tfDescriptor = $group.descriptor -replace '^vssgp\.', ''
        # Convert URL-safe Base64 to standard Base64
        $tfDescriptor = $tfDescriptor.Replace('-', '+').Replace('_', '/')
        # Add padding if needed
        while ($tfDescriptor.Length % 4 -ne 0) {
            $tfDescriptor += '='
        }
        $decodedBytes = [Convert]::FromBase64String($tfDescriptor)
        $sid = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
        $tfFullDescriptor = "Microsoft.TeamFoundation.Identity;$sid"
        
        $identityLookup[$tfFullDescriptor] = @{
            DisplayName = $group.displayName
            Type = "Group"
        }
    }
    catch {
        # If decoding fails, skip this mapping
    }
}
foreach ($user in $allUsers) {
    $identityLookup[$user.user.descriptor] = @{
        DisplayName = $user.user.displayName
        Type = "User"
    }
    
    # Query the identity API to get the ClaimsIdentity descriptor
    try {
        if ($user.user.mailAddress) {
            $identityUrl = "https://vssps.dev.azure.com/$($orgUrl.Split('/')[-1])/_apis/identities?searchFilter=General&filterValue=$($user.user.mailAddress)&api-version=7.1"
            $base64AuthInfo = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
            $headers = @{
                Authorization = "Basic $base64AuthInfo"
            }
            
            $identityResponse = Invoke-RestMethod -Uri $identityUrl -Headers $headers -ErrorAction SilentlyContinue
            
            if ($identityResponse.value -and $identityResponse.value.Count -gt 0) {
                $identity = $identityResponse.value[0]
                if ($identity.descriptor) {
                    # Add the ClaimsIdentity descriptor
                    $identityLookup[$identity.descriptor] = @{
                        DisplayName = $user.user.displayName
                        Type = "User"
                    }
                }
            }
        }
    }
    catch {
        # Skip if identity query fails
    }
}
Write-Host "Built identity lookup with $($identityLookup.Count) identities" -ForegroundColor Green

# Function to process ACL entries for a token
function Process-ACLEntries {
    param(
        [string]$token,
        [string]$repository,
        [string]$repositoryId,
        [hashtable]$identityLookup,
        [bool]$isInherited = $false
    )
    
    $results = @()
    
    # Use REST API to get ACLs (CLI doesn't support listing all ACLs without --subject)
    $aclUrl = "$orgUrl/_apis/accesscontrollists/$gitNamespaceId`?token=$token&api-version=7.1"
    
    try {
        $base64AuthInfo = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
        $headers = @{
            Authorization = "Basic $base64AuthInfo"
        }
        
        $aclResponse = Invoke-RestMethod -Uri $aclUrl -Headers $headers -Method Get
        
        # Process each ACL
        if ($aclResponse.value -and $aclResponse.value.Count -gt 0) {
            foreach ($acl in $aclResponse.value) {
                if ($acl.acesDictionary) {
                    $aceKeys = $acl.acesDictionary | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
                    
                    foreach ($aceKey in $aceKeys) {
                        $ace = $acl.acesDictionary.$aceKey
                        $descriptor = $aceKey
                        
                        # Look up identity info
                        $identityInfo = $identityLookup[$descriptor]
                        if (-not $identityInfo) {
                            # Unknown identity, skip
                            continue
                        }
                        
                        $allow = [int]$ace.allow
                        $deny = [int]$ace.deny
                        
                        # Only process if permissions are explicitly set
                        if ($allow -gt 0 -or $deny -gt 0) {
                            $displayName = $identityInfo.DisplayName
                            if ($isInherited) {
                                $displayName = "$displayName (Inherited)"
                            }
                            
                            # Process each permission bit
                            foreach ($permission in $gitPermissions.GetEnumerator()) {
                                $bit = $permission.Key
                                $permissionName = $permission.Value
                                $access = Convert-PermissionMask -allow $allow -deny $deny -bit $bit
                                
                                # Only add if permission is explicitly set
                                if ($access -ne "Not Set") {
                                    $results += [PSCustomObject]@{
                                        Repository = $repository
                                        RepositoryId = $repositoryId
                                        IdentityDescriptor = $descriptor
                                        IdentityDisplayName = $displayName
                                        IdentityType = $identityInfo.Type
                                        Permission = $permissionName
                                        Access = $access
                                        AllowMask = $allow
                                        DenyMask = $deny
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-Host "    ⚠ REST API error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    return $results
}

# Process each repository
foreach ($repo in $repos) {
    Write-Host "`nProcessing repository: $($repo.name)" -ForegroundColor Cyan
    
    # Get ACLs for repository
    $repoToken = "repoV2/$projectId/$($repo.id)"
    
    try {
        # Get repository-level permissions
        Write-Host "  Fetching repository-level ACLs..." -ForegroundColor DarkGray
        $repoPermissions = Process-ACLEntries `
            -token $repoToken `
            -repository $repo.name `
            -repositoryId $repo.id `
            -identityLookup $identityLookup `
            -isInherited $false
        
        if ($repoPermissions.Count -gt 0) {
            Write-Host "  ✓ Found $($repoPermissions.Count) explicit permission entries" -ForegroundColor Green
            $allPermissions += $repoPermissions
        }
        
        # Get project-level permissions (inherited by this repo) - check for duplicates
        Write-Host "  Fetching project-level ACLs..." -ForegroundColor DarkGray
        $projectToken = "repoV2/$projectId"
        $projectPermissions = Process-ACLEntries `
            -token $projectToken `
            -repository $repo.name `
            -repositoryId $repo.id `
            -identityLookup $identityLookup `
            -isInherited $true
        
        if ($projectPermissions.Count -gt 0) {
            # Only add project permissions that don't already exist at repo level
            $addedCount = 0
            foreach ($projPerm in $projectPermissions) {
                $exists = $allPermissions | Where-Object {
                    $_.Repository -eq $projPerm.Repository -and
                    $_.IdentityDescriptor -eq $projPerm.IdentityDescriptor -and
                    $_.Permission -eq $projPerm.Permission
                }
                
                if (-not $exists) {
                    $allPermissions += $projPerm
                    $addedCount++
                }
            }
            
            if ($addedCount -gt 0) {
                Write-Host "  ✓ Added $addedCount inherited permission entries" -ForegroundColor Green
            }
        }
    }
    catch {
        Write-Host "  ✗ Error processing repository: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Export to CSV
$outputFile = "repository-permissions.csv"
Write-Host "`nExporting permissions to CSV..." -ForegroundColor Cyan
Write-Host "Total permission entries: $($allPermissions.Count)" -ForegroundColor Green

if ($allPermissions.Count -gt 0) {
    # Export to CSV with proper formatting
    $allPermissions | Export-Csv -Path $outputFile -NoTypeInformation -Encoding UTF8
    
    Write-Host "`n✓ Successfully exported to: $outputFile" -ForegroundColor Green
    Write-Host "  - Total entries: $($allPermissions.Count)" -ForegroundColor Green
    
    # Group by identity type and count
    $groupCount = ($allPermissions | Where-Object { $_.IdentityType -eq "Group" } | Select-Object -Unique IdentityDisplayName).Count
    $userCount = ($allPermissions | Where-Object { $_.IdentityType -eq "User" } | Select-Object -Unique IdentityDisplayName).Count
    
    Write-Host "  - Groups with permissions: $groupCount" -ForegroundColor Green
    Write-Host "  - Users with permissions: $userCount" -ForegroundColor Green
}
else {
    Write-Host "`n⚠ No permissions found to export" -ForegroundColor Yellow
}

Write-Host "`nScript completed!" -ForegroundColor Green
