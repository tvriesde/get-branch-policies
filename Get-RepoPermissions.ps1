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
if (-not (Test-Path ".env")) {
    Write-Error ".env file not found. Please create it with AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT"
    exit 1
}

$envVars = @{}
Get-Content ".env" | ForEach-Object {
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

# Process each repository
foreach ($repo in $repos) {
    Write-Host "`nProcessing repository: $($repo.name)" -ForegroundColor Cyan
    
    # Get ACLs for repository
    $repoToken = "repoV2/$projectId/$($repo.id)"
    Write-Host "  Repository token: $repoToken" -ForegroundColor DarkGray
    
    try {
        # Get all security groups first
        Write-Host "  Fetching security groups..." -ForegroundColor DarkGray
        $groupsResponse = az devops security group list --scope project --output json 2>$null | ConvertFrom-Json
        $allGroups = $groupsResponse.graphGroups
        
        if (-not $allGroups -or $allGroups.Count -eq 0) {
            Write-Host "  ✗ Failed to fetch security groups or no groups found" -ForegroundColor Red
            continue
        }
        
        Write-Host "  Found $($allGroups.Count) security groups" -ForegroundColor DarkGray
        
        # Get all users
        Write-Host "  Fetching users..." -ForegroundColor DarkGray
        $orgName = $orgUrl.Split('/')[-1]
        $usersResponse = az devops user list --output json 2>$null | ConvertFrom-Json
        $allUsers = @()
        if ($usersResponse -and $usersResponse.members) {
            $allUsers = $usersResponse.members
            Write-Host "  Found $($allUsers.Count) users" -ForegroundColor DarkGray
        }
        else {
            Write-Host "  ✗ Could not fetch users" -ForegroundColor Yellow
        }
        
        # Process each group to check their permissions
        foreach ($group in $allGroups) {
            $descriptor = $group.descriptor
            
            try {
                # Get permissions for this specific identity on this repository
                $permissionsJson = az devops security permission show `
                    --namespace-id $gitNamespaceId `
                    --subject $descriptor `
                    --token $repoToken `
                    --output json 2>$null
                
                if ($permissionsJson) {
                    $permissions = $permissionsJson | ConvertFrom-Json
                    
                    # The response is an array with one element
                    if ($permissions -and $permissions.Count -gt 0) {
                        $permissionObj = $permissions[0]
                        
                        if ($permissionObj.acesDictionary) {
                            $identityDisplayName = $group.displayName
                            $identityType = "Group"
                            
                            # Get the first ACE from the dictionary
                            $aceKey = ($permissionObj.acesDictionary | Get-Member -MemberType NoteProperty)[0].Name
                            $ace = $permissionObj.acesDictionary.$aceKey
                            
                            if ($ace) {
                                $allow = [int]$ace.allow
                                $deny = [int]$ace.deny
                                
                                # Check if any permissions are set (not inherited/default)
                                if ($allow -gt 0 -or $deny -gt 0) {
                                    Write-Host "    ✓ Found permissions for group: $identityDisplayName (Allow: $allow, Deny: $deny)" -ForegroundColor Green
                                    
                                    # Process each permission bit
                                    foreach ($permission in $gitPermissions.GetEnumerator()) {
                                        $bit = $permission.Key
                                        $permissionName = $permission.Value
                                        $access = Convert-PermissionMask -allow $allow -deny $deny -bit $bit
                                        
                                        # Only add if permission is explicitly set
                                        if ($access -ne "Not Set") {
                                            $allPermissions += [PSCustomObject]@{
                                                Repository = $repo.name
                                                RepositoryId = $repo.id
                                                IdentityDescriptor = $descriptor
                                                IdentityDisplayName = $identityDisplayName
                                                IdentityType = $identityType
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
                # Silently continue if permission check fails for this group
            }
        }
        
        # Process each user to check their permissions
        foreach ($user in $allUsers) {
            $descriptor = $user.user.descriptor
            
            try {
                # Get permissions for this specific user on this repository
                $permissionsJson = az devops security permission show `
                    --namespace-id $gitNamespaceId `
                    --subject $descriptor `
                    --token $repoToken `
                    --output json 2>$null
                
                if ($permissionsJson) {
                    $permissions = $permissionsJson | ConvertFrom-Json
                    
                    # The response is an array with one element
                    if ($permissions -and $permissions.Count -gt 0) {
                        $permissionObj = $permissions[0]
                        
                        if ($permissionObj.acesDictionary) {
                            $identityDisplayName = $user.user.displayName
                            $identityType = "User"
                            
                            # Get the first ACE from the dictionary
                            $aceKey = ($permissionObj.acesDictionary | Get-Member -MemberType NoteProperty)[0].Name
                            $ace = $permissionObj.acesDictionary.$aceKey
                            
                            if ($ace) {
                                $allow = [int]$ace.allow
                                $deny = [int]$ace.deny
                                
                                # Check if any permissions are set (not inherited/default)
                                if ($allow -gt 0 -or $deny -gt 0) {
                                    Write-Host "    ✓ Found permissions for user: $identityDisplayName (Allow: $allow, Deny: $deny)" -ForegroundColor Cyan
                                    
                                    # Process each permission bit
                                    foreach ($permission in $gitPermissions.GetEnumerator()) {
                                        $bit = $permission.Key
                                        $permissionName = $permission.Value
                                        $access = Convert-PermissionMask -allow $allow -deny $deny -bit $bit
                                        
                                        # Only add if permission is explicitly set
                                        if ($access -ne "Not Set") {
                                            $allPermissions += [PSCustomObject]@{
                                                Repository = $repo.name
                                                RepositoryId = $repo.id
                                                IdentityDescriptor = $descriptor
                                                IdentityDisplayName = $identityDisplayName
                                                IdentityType = $identityType
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
                # Silently continue if permission check fails for this user
            }
        }
        
        # Also check project-level permissions (they inherit to repos)
        Write-Host "  Checking project-level permissions..." -ForegroundColor DarkGray
        $projectToken = "repoV2/$projectId"
        
        $projectGroupCount = 0
        foreach ($group in $allGroups) {
            $descriptor = $group.descriptor
            
            try {
                $permissionsJson = az devops security permission show `
                    --namespace-id $gitNamespaceId `
                    --subject $descriptor `
                    --token $projectToken `
                    --output json 2>$null
                
                if ($permissionsJson) {
                    $permissions = $permissionsJson | ConvertFrom-Json
                    
                    if ($permissions -and $permissions.Count -gt 0) {
                        $permissionObj = $permissions[0]
                        
                        if ($permissionObj.acesDictionary) {
                            $identityDisplayName = $group.displayName
                            $identityType = "Group"
                            
                            $aceKey = ($permissionObj.acesDictionary | Get-Member -MemberType NoteProperty)[0].Name
                            $ace = $permissionObj.acesDictionary.$aceKey
                            
                            if ($ace) {
                                $allow = [int]$ace.allow
                                $deny = [int]$ace.deny
                                
                                if ($allow -gt 0 -or $deny -gt 0) {
                                    $projectGroupCount++
                                    Write-Host "    ✓ Project-level permissions for group: $identityDisplayName (Allow: $allow)" -ForegroundColor Green
                                    
                                    foreach ($permission in $gitPermissions.GetEnumerator()) {
                                        $bit = $permission.Key
                                        $permissionName = $permission.Value
                                        $access = Convert-PermissionMask -allow $allow -deny $deny -bit $bit
                                        
                                        if ($access -ne "Not Set") {
                                            # Check if we already have this permission from repo level
                                            $exists = $allPermissions | Where-Object {
                                                $_.Repository -eq $repo.name -and
                                                $_.IdentityDescriptor -eq $descriptor -and
                                                $_.Permission -eq $permissionName
                                            }
                                            
                                            if (-not $exists) {
                                                $allPermissions += [PSCustomObject]@{
                                                    Repository = $repo.name
                                                    RepositoryId = $repo.id
                                                    IdentityDescriptor = $descriptor
                                                    IdentityDisplayName = "$identityDisplayName (Inherited)"
                                                    IdentityType = $identityType
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
            }
            catch {
                Write-Host "    ✗ Error checking project permissions for group $($group.displayName): $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        
        # Check project-level permissions for users
        $projectUserCount = 0
        foreach ($user in $allUsers) {
            $descriptor = $user.user.descriptor
            
            try {
                $permissionsJson = az devops security permission show `
                    --namespace-id $gitNamespaceId `
                    --subject $descriptor `
                    --token $projectToken `
                    --output json 2>$null
                
                if ($permissionsJson) {
                    $permissions = $permissionsJson | ConvertFrom-Json
                    
                    if ($permissions -and $permissions.Count -gt 0) {
                        $permissionObj = $permissions[0]
                        
                        if ($permissionObj.acesDictionary) {
                            $identityDisplayName = $user.user.displayName
                            $identityType = "User"
                            
                            $aceKey = ($permissionObj.acesDictionary | Get-Member -MemberType NoteProperty)[0].Name
                            $ace = $permissionObj.acesDictionary.$aceKey
                            
                            if ($ace) {
                                $allow = [int]$ace.allow
                                $deny = [int]$ace.deny
                                
                                if ($allow -gt 0 -or $deny -gt 0) {
                                    $projectUserCount++
                                    Write-Host "    ✓ Project-level permissions for user: $identityDisplayName (Allow: $allow)" -ForegroundColor Cyan
                                    
                                    foreach ($permission in $gitPermissions.GetEnumerator()) {
                                        $bit = $permission.Key
                                        $permissionName = $permission.Value
                                        $access = Convert-PermissionMask -allow $allow -deny $deny -bit $bit
                                        
                                        if ($access -ne "Not Set") {
                                            # Check if we already have this permission from repo level
                                            $exists = $allPermissions | Where-Object {
                                                $_.Repository -eq $repo.name -and
                                                $_.IdentityDescriptor -eq $descriptor -and
                                                $_.Permission -eq $permissionName
                                            }
                                            
                                            if (-not $exists) {
                                                $allPermissions += [PSCustomObject]@{
                                                    Repository = $repo.name
                                                    RepositoryId = $repo.id
                                                    IdentityDescriptor = $descriptor
                                                    IdentityDisplayName = "$identityDisplayName (Inherited)"
                                                    IdentityType = $identityType
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
            }
            catch {
                Write-Host "    ✗ Error checking project permissions for user $($user.user.displayName): $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        
        if ($projectGroupCount -gt 0) {
            Write-Host "  ✓ Found project-level permissions for $projectGroupCount groups" -ForegroundColor Green
        }
        if ($projectUserCount -gt 0) {
            Write-Host "  ✓ Found project-level permissions for $projectUserCount users" -ForegroundColor Cyan
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
