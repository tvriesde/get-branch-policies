# Azure DevOps Permissions - PowerShell Scripts

This directory contains optimized PowerShell scripts for extracting Azure DevOps repository and branch permissions using Azure DevOps CLI and REST API.

## Prerequisites

- **PowerShell 5.1 or higher** (Windows PowerShell or PowerShell Core)
- **Azure DevOps CLI (`az devops`)** - [Installation Guide](https://learn.microsoft.com/en-us/azure/devops/cli/)
- **Azure DevOps Personal Access Token (PAT)** with appropriate permissions
- **.env file** in the parent directory with the following variables:
  ```
  AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-organization
  AZURE_DEVOPS_PROJECT=your-project-name
  AZURE_DEVOPS_PAT=your-personal-access-token
  ```

## Installation

### Install Azure DevOps CLI

**Windows (via winget):**
```powershell
winget install Microsoft.AzureCLI
az extension add --name azure-devops
```

**macOS/Linux:**
```bash
# Install Azure CLI first
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Add Azure DevOps extension
az extension add --name azure-devops
```

### Verify Installation

```powershell
az devops --version
```

## Scripts

### 1. Get-RepoPermissions.ps1 - Repository Permissions Extractor

Extracts comprehensive repository permissions for all groups and users across all repositories in a project.

**What it does:**
- Fetches all repositories in the project
- Retrieves all security groups and users
- Queries ACLs (Access Control Lists) for repository-level permissions
- Queries ACLs for project-level permissions (inherited by repositories)
- Resolves group and user identities to display names
- Exports detailed permission matrix to CSV

**Usage:**
```powershell
cd powershell
.\Get-RepoPermissions.ps1
```

**Output File:**
- `repository-permissions.csv` - Contains repository name, repository ID, identity name, identity type (Group/User), permission name, access level (Allow/Deny/Not Set), and permission masks

**Permissions Checked (16 types):**
- Administer
- Read
- Contribute
- Force push (rewrite history, delete branches and tags)
- Create branch
- Create tag
- Manage notes
- Bypass policies when pushing
- Create repository
- Delete repository
- Rename repository
- Edit policies
- Remove others' locks
- Manage permissions
- Contribute to pull requests
- Bypass policies when completing pull requests

**Performance:**
- Execution time: ~5-10 seconds for typical projects
- Uses optimized ACL queries (15-20 API calls total)

**Example Output:**
```csv
Repository,RepositoryId,IdentityDescriptor,IdentityDisplayName,IdentityType,Permission,Access,AllowMask,DenyMask
deploymentscript,0c71d0cb-fa97-4001-87db-c84efe4d0580,Microsoft.TeamFoundation.Identity;...,Contributors (Inherited),Group,Contribute,Allow,82038,0
deploymentscript,0c71d0cb-fa97-4001-87db-c84efe4d0580,Microsoft.IdentityModel.Claims.ClaimsIdentity;...,Tyrone Vriesde,User,Manage permissions,Allow,229238,0
```

### 2. Get-MainBranchPermissions.ps1 - Main Branch Permissions Extractor

Extracts permissions specifically for the main/default branch of each repository.

**What it does:**
- Fetches all repositories in the project
- Identifies the default branch (main/master) for each repository
- Queries ACLs for branch-level permissions
- Queries ACLs for repository-level permissions (inherited by branches)
- Queries ACLs for project-level permissions (inherited by repositories and branches)
- Resolves group and user identities to display names
- Exports detailed permission matrix to CSV

**Usage:**
```powershell
cd powershell
.\Get-MainBranchPermissions.ps1
```

**Output File:**
- `branch-permissions.csv` - Contains repository name, branch name, identity name, identity type (Group/User), permission name, access level (Allow/Deny/Not Set), and permission masks

**Permissions Checked (8 branch-specific types):**
- Read
- Contribute
- Force push (rewrite history, delete branches and tags)
- Bypass policies when pushing
- Edit policies
- Remove others' locks
- Manage permissions
- Bypass policies when completing pull requests

**Performance:**
- Execution time: ~5-10 seconds for typical projects
- Uses optimized ACL queries (3 queries per repository: branch, repo, project levels)

**Example Output:**
```csv
Repository,Branch,IdentityDescriptor,IdentityDisplayName,IdentityType,Permission,Access,AllowMask,DenyMask
deploymentscript,main,Microsoft.TeamFoundation.Identity;...,Contributors (Inherited),Group,Contribute,Allow,82038,0
deploymentscript,main,Microsoft.TeamFoundation.Identity;...,Contributors (Inherited),Group,Read,Allow,82038,0
deploymentscript,main,Microsoft.TeamFoundation.Identity;...,Contributors (Inherited),Group,Bypass policies when pushing,Not Set,82038,0
```

## Key Features

### ✅ Full Identity Resolution
These PowerShell scripts successfully resolve:
- **All security group names** (Contributors, Project Administrators, Build Administrators, Readers, etc.)
- **All user names** with direct permissions
- Both Azure AD users and service identities

### ✅ Optimized Performance
- Uses REST API to query ACLs directly (instead of checking each identity individually)
- Fetches identities once and builds a lookup table
- Makes only 15-20 API calls total
- Highly efficient compared to sequential identity checking

### ✅ Comprehensive Permission Data
- Shows "Allow", "Deny", and "Not Set" for each permission
- Includes raw permission masks for advanced analysis
- Distinguishes between explicit and inherited permissions
- Identifies permission sources (branch/repository/project level)

## Understanding the Output

### Access Levels
- **Allow**: Permission is explicitly granted
- **Deny**: Permission is explicitly denied
- **Not Set**: Permission is not explicitly configured (inherits from parent or default)

### Identity Types
- **Group**: Azure DevOps security group (Contributors, Project Administrators, etc.)
- **User**: Individual user with direct permissions

### Inherited Permissions
Permissions marked with "(Inherited)" come from parent scopes:
- Branch permissions inherit from repository level
- Repository permissions inherit from project level
- Groups inherit permissions from their configuration

## Common Use Cases

### 1. Audit Repository Access
```powershell
# Run repository permissions script
.\Get-RepoPermissions.ps1

# Import and filter results
$perms = Import-Csv repository-permissions.csv
$perms | Where-Object { $_.Access -eq 'Allow' } | Group-Object IdentityDisplayName
```

### 2. Check Branch Protection
```powershell
# Run branch permissions script
.\Get-MainBranchPermissions.ps1

# Check who can bypass policies
$branchPerms = Import-Csv branch-permissions.csv
$branchPerms | Where-Object { $_.Permission -like '*Bypass*' -and $_.Access -eq 'Allow' }
```

### 3. Compare Permissions Across Repositories
```powershell
$perms = Import-Csv repository-permissions.csv
$perms | Where-Object { $_.IdentityDisplayName -like '*Administrators*' } | 
         Group-Object Repository | 
         Select-Object Name, Count
```

### 4. Export Specific User Permissions
```powershell
$perms = Import-Csv repository-permissions.csv
$perms | Where-Object { $_.IdentityType -eq 'User' -and $_.Access -eq 'Allow' } | 
         Export-Csv user-permissions.csv -NoTypeInformation
```

## Troubleshooting

### "az devops command not found"
- Install Azure CLI and the Azure DevOps extension (see Installation section)
- Restart your terminal/PowerShell session after installation

### "Failed to access Azure DevOps"
- Verify your PAT token is valid and not expired
- Check that the `.env` file exists in the parent directory
- Ensure the PAT token has the required permissions (Code, Project and Team, Security)

### "No default branch found"
- Some repositories may not have a default branch set
- The script will skip these repositories and continue with others
- You can check/set the default branch in Azure DevOps UI

### Script execution policy errors
```powershell
# If you get execution policy errors, run:
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Advanced Configuration

### Custom PAT Token Scope Requirements
Your PAT token should have these scopes:
- **Code** - Read
- **Project and Team** - Read
- **Security** - Read
- **Identity** - Read (optional but recommended)

### Filtering Large Outputs
For projects with many repositories, consider filtering in the script or post-processing:

```powershell
# Example: Only process specific repositories
$repos = az repos list --project $project --output json | ConvertFrom-Json
$repos = $repos | Where-Object { $_.name -in @('repo1', 'repo2', 'repo3') }
```

## Further Information

For more details about the approach and architecture, see:
- `../README.md` - Overall project documentation
- `../LIMITATIONS.md` - API limitations and workarounds
- `../PAT-PERMISSIONS.md` - PAT token permission requirements
