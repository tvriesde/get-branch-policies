# Repository Permissions PowerShell Script

## Overview

`Get-RepoPermissions.ps1` is a PowerShell script that uses the Azure DevOps CLI (`az devops`) to extract complete repository permissions and export them to an Excel file.

## Key Advantages

✅ **Successfully resolves group identities** - Unlike the Node.js REST API approach, this script can resolve group names like "Contributors", "Project Administrators", etc.

✅ **Excel output** - Creates a formatted Excel file (`repository-permissions.xlsx`) with auto-sized columns, frozen headers, and auto-filter

✅ **Auto-installation** - Automatically installs the ImportExcel PowerShell module if not already present

✅ **Inherited permissions** - Marks permissions inherited from project level with "(Inherited)" suffix

✅ **Comprehensive permission types** - Captures all 16 Git repository permission types

## Prerequisites

- **PowerShell 5.1 or higher**
- **Azure CLI** with Azure DevOps extension
  ```powershell
  # Install Azure CLI from: https://aka.ms/installazurecliwindows
  
  # Install Azure DevOps extension
  az extension add --name azure-devops
  ```
- **.env file** with Azure DevOps credentials (same format as Node.js scripts)

## Usage

```powershell
.\Get-RepoPermissions.ps1
```

The script will:
1. Load configuration from `.env` file
2. Authenticate with Azure DevOps using your PAT token
3. Fetch all repositories in the project
4. Check permissions for each security group on each repository
5. Check project-level permissions that inherit to all repositories
6. Export results to `repository-permissions.xlsx`

## Output Format

The Excel file contains the following columns:

| Column | Description |
|--------|-------------|
| **Repository** | Repository name |
| **RepositoryId** | GUID of the repository |
| **IdentityDescriptor** | Unique descriptor for the group/user |
| **IdentityDisplayName** | Resolved name (e.g., "Contributors", "Project Administrators") |
| **IdentityType** | "Group" for security groups |
| **Permission** | Permission name (e.g., "Read", "Contribute", "Administer") |
| **Access** | "Allow", "Deny", or "Not Set" |
| **AllowMask** | Numeric bitmask of allowed permissions |
| **DenyMask** | Numeric bitmask of denied permissions |

## Permission Types Captured

The script checks for all Git repository permissions:

1. **Administer** - Full control over repository
2. **Read** - View repository content
3. **Contribute** - Push changes
4. **Force push** - Rewrite history, delete branches/tags
5. **Create branch** - Create new branches
6. **Create tag** - Create new tags
7. **Manage notes** - Manage Git notes
8. **Bypass policies when pushing** - Skip branch policies
9. **Create repository** - Create new repositories
10. **Delete or disable repository** - Remove repositories
11. **Rename repository** - Change repository name
12. **Edit policies** - Modify branch policies
13. **Remove others' locks** - Unlock files locked by others
14. **Manage permissions** - Change repository permissions
15. **Contribute to pull requests** - Review and approve PRs
16. **Bypass policies when completing pull requests** - Merge without policy compliance

## Example Output

```
Repository         IdentityDisplayName              Permission    Access
-----------------  -------------------------------  ------------  ------
frog               Contributors (Inherited)         Read          Allow
frog               Contributors (Inherited)         Contribute    Allow
frog               Project Administrators (Inherited) Administer  Allow
deploymentscript   Readers (Inherited)              Read          Allow
```

## Why This Works Better Than Node.js Scripts

The Azure DevOps CLI (`az devops`) has **better API access** than direct REST API calls with PAT tokens:

| Aspect | Node.js REST API | PowerShell CLI |
|--------|-----------------|----------------|
| **Group Resolution** | ❌ Returns "Unresolved" | ✅ Resolves to group names |
| **Identity API Access** | ❌ 404 errors | ✅ Works correctly |
| **Graph API Access** | ❌ 400/404 errors | ✅ Returns group information |
| **Output Format** | CSV | Excel with formatting |
| **Ease of Use** | Requires Node.js setup | Uses Azure CLI |

## Troubleshooting

### "PAT token has expired"

The PAT token needs to be refreshed. Update it in the `.env` file with a new token from Azure DevOps.

### "az: command not found"

Install Azure CLI from https://aka.ms/installazurecliwindows

### "Azure DevOps extension not found"

Install the extension:
```powershell
az extension add --name azure-devops
```

### "ImportExcel module not found"

The script automatically installs it, but you can manually install with:
```powershell
Install-Module -Name ImportExcel -Scope CurrentUser -Force
```

### No permissions found

This can happen if:
- Your PAT token doesn't have Security:Read permissions
- No project-level permissions are configured (unlikely)
- All permissions are inherited from organization level

## Limitations

- Only checks **project-scoped security groups** (doesn't include organization-level groups)
- Only checks permissions for **groups**, not individual users
- Requires Azure DevOps CLI to be installed and configured

## Comparison with Node.js Scripts

Use this PowerShell script when:
- ✅ You need resolved group names, not just descriptors
- ✅ You want Excel output with formatting
- ✅ You have Azure CLI already installed
- ✅ You're working on Windows with PowerShell

Use the Node.js scripts when:
- ✅ You need branch policy information (main.js)
- ✅ You prefer CSV output
- ✅ You don't have Azure CLI installed
- ✅ You're okay with unresolved group identities

## Related Files

- `main.js` - Branch policies and branch policy permissions (Node.js)
- `main-repos.js` - Repository permissions using REST API (Node.js)
- `build-identity-cache.js` - Identity cache builder (Node.js)
- `.env` - Configuration file (shared by all scripts)
