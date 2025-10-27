# Azure DevOps Data Extraction Tool

This script retrieves Azure DevOps information and exports it to CSV files.

## Features

### Branch Policies Script (main.js)
- **Branch Policies CSV**: Lists all branch policies that apply to main branches of repositories
- **Permissions CSV**: Lists users and groups that can change branch policies, including:
  - Direct repository assignments
  - Project Administrators
  - Project Collection Administrators
  - Members of administrator groups

### Repository Permissions Script (main-repos.js)
- **Complete Repository Permissions**: Lists all Git repository permissions for every user, group, and team
- **All Permission Types**: Includes all Azure DevOps Git permissions:
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
  - Pull request contribute
  - Bypass policies when completing pull requests
- **Direct and Inherited Permissions**: Shows both repository-level (direct) and project-level (inherited) permissions
- **Group Membership Expansion**: Automatically expands groups and teams to show individual user permissions
- **Allow/Deny Status**: Indicates whether each permission is explicitly allowed or denied

### Repository Permissions PowerShell Script (Get-RepoPermissions.ps1)
- **Uses Azure DevOps CLI**: Leverages `az devops` commands for better identity resolution
- **Excel Output**: Exports to `.xlsx` format with formatted tables
- **Improved Group Resolution**: Better success rate at resolving group identities
- **Auto-installs Dependencies**: Automatically installs the ImportExcel PowerShell module
- **Comprehensive Permissions**: Shows all 16 Git repository permission types
- **Inheritance Detection**: Marks inherited permissions from project level

## Setup

### Prerequisites

**For Node.js scripts (main.js, main-repos.js):**
- Node.js (v14 or higher)
- npm

**For PowerShell script (Get-RepoPermissions.ps1):**
- PowerShell 5.1 or higher
- Azure CLI with Azure DevOps extension

### 1. Install Dependencies

**For Node.js scripts:**
```powershell
npm install
```

**For PowerShell script:**
```powershell
# Install Azure CLI if not already installed
# Download from: https://aka.ms/installazurecliwindows

# Install Azure DevOps extension
az extension add --name azure-devops

# The script will automatically install the ImportExcel PowerShell module when run
```

### 2. Configure Environment Variables

Edit the `.env` file with your Azure DevOps details:

```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-organization
AZURE_DEVOPS_PROJECT=your-project-name
AZURE_DEVOPS_PAT=your-personal-access-token-here
```

**Note**: The `.env` file is used by both Node.js scripts and the PowerShell script.

### 3. Create a Personal Access Token (PAT)

1. Go to Azure DevOps
2. Click on User Settings (top right) → Personal Access Tokens
3. Click "New Token"
4. Give it a name and set expiration
5. Select the following scopes:

   **Required (minimum):**
   - **Code**: Read
   - **Project and Team**: Read
   
   **Recommended (for full functionality):**
   - **Code**: Read
   - **Graph**: Read (required to resolve group identities and memberships)
   - **Identity**: Read (required to resolve Team Foundation identities)
   - **Project and Team**: Read
   - **Security**: Read (required to read ACLs and permissions)
   - **User Profile**: Read (helps resolve user information)
   - **Member Entitlement Management**: Read (optional, for organization-level groups)

6. Copy the token and paste it in your `.env` file

**Note**: Without the **Graph** and **Identity** read permissions, some group identities will appear as "Unresolved" in the output CSV files. The scripts will still capture the permission descriptors, but won't be able to show the group names or expand their members.

## Usage

### Branch Policies and Permissions (Node.js)

Run the script to get branch policies and branch policy permissions:

```powershell
npm start
```

Or directly:

```powershell
node main.js
```

### Repository Permissions (Node.js)

Run the script to get all repository permissions for users, groups, and teams:

```powershell
npm run repos
```

Or directly:

```powershell
node main-repos.js
```

### Repository Permissions with Azure DevOps CLI (PowerShell)

Run the PowerShell script for improved identity resolution and Excel output:

```powershell
.\Get-RepoPermissions.ps1
```

**Advantages of the PowerShell CLI script:**
- Better success rate at resolving group identities
- Exports to Excel (.xlsx) format with formatted tables
- Uses Azure DevOps CLI which has better API access
- Auto-installs required PowerShell modules
- Includes inheritance information

## Output Files

### Branch Policies Script (main.js)

#### branch-policies.csv

Contains branch policies for main branches with the following columns:
- Repository Name
- Repository ID
- Policy Type (e.g., "Minimum number of reviewers", "Work item linking")
- Policy ID
- Is Enabled
- Is Blocking
- Settings (JSON format with policy details)

#### branch-policy-permissions.csv

Contains users and groups with permissions to modify branch policies:
- Repository
- Identity Type (User/Group)
- Display Name
- Email Address
- Descriptor (unique identifier)
- Permission
- Permission Source (Repository/Project/Project Collection/Group membership)
- Is Direct Assignment

### Repository Permissions Script (main-repos.js)

#### repository-permissions.csv

Contains all repository permissions for users, groups, and teams:
- Repository
- Identity Type (User/Group/Unknown)
- Display Name
- Email Address
- Descriptor (unique identifier)
- Permission (e.g., Read, Contribute, Administer, etc.)
- Allow/Deny (whether permission is allowed or denied)
- Permission Source (Direct assignment, group membership, inherited)
- Is Direct Assignment (Yes/No)

### Repository Permissions PowerShell Script (Get-RepoPermissions.ps1)

#### repository-permissions.xlsx

Excel file with formatted table containing:
- Repository
- RepositoryId
- IdentityDescriptor
- IdentityDisplayName (resolved group/user names, with "(Inherited)" suffix for project-level permissions)
- IdentityType (User/Group/Unknown)
- Permission (e.g., Read, Contribute, Administer, etc.)
- Access (Allow/Deny/Not Set)
- AllowMask (numeric permission mask)
- DenyMask (numeric permission mask)

**Excel Features:**
- Auto-sized columns
- Frozen header row
- Bold headers
- Auto-filter enabled
- Formatted as Excel table

## Troubleshooting

### Unresolved Groups and Identities

If you see entries like `[Unresolved: Microsoft.TeamFoundation.Identity;...]` in your output files, this means the PAT token doesn't have sufficient permissions to resolve those identities.

**To fix this:**

1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Edit your existing token or create a new one
3. Ensure the following scopes are enabled:
   - ✅ **Graph**: Read
   - ✅ **Identity**: Read
   - ✅ **Security**: Read
4. Save and update the token in your `.env` file

**Why this happens:**
- Azure DevOps uses different APIs for different identity types
- The Identities API requires specific read permissions
- Without these permissions, the script can still see that permissions are assigned (via ACLs), but cannot resolve the identity descriptor to a friendly name or expand group memberships

**What you'll get with limited permissions:**
- Direct user assignments: ✅ (works with just Code: Read)
- Group names and memberships: ❌ (requires Graph + Identity: Read)
- Permission descriptors: ✅ (always captured for reference)

### Other Common Issues

- **Authentication Error**: Ensure your PAT token is valid and has the required scopes
- **Project Not Found**: Verify the project name in `.env` matches exactly
- **No Policies Found**: Check that your repositories have branch policies configured
- **Rate Limiting**: The script includes small delays between API calls to avoid rate limits

## Notes

- The scripts specifically look for policies on the `main` branch
- Permissions are checked at both the repository level and project/collection administrator level
- The Git Repositories namespace permission bits are documented in the Azure DevOps API reference

### Permission Scopes Explained

| Scope | Purpose | Impact if Missing |
|-------|---------|-------------------|
| **Code: Read** | Access repository and policy information | Script cannot run |
| **Graph: Read** | Resolve Azure DevOps group identities via Graph API | Groups show as "Unresolved" |
| **Identity: Read** | Resolve Team Foundation identity descriptors | Some identities show as "Unresolved" |
| **Security: Read** | Read Access Control Lists (ACLs) | Cannot retrieve permissions (script will fail) |
| **Project and Team: Read** | Access project and team information | Limited project-level information |
| **User Profile: Read** | Access user profile information | Missing email addresses for some users |

### Identity Resolution Process

The scripts attempt to resolve identities in the following order:

1. **ClaimsIdentity format** (e.g., user@domain.com): Parsed directly from descriptor
2. **Graph API**: Queries the Azure DevOps Graph API for group information
3. **Identities API**: Queries the Team Foundation Identities API
4. **Fallback**: If all fail, marks as "Unresolved" but retains the descriptor

**Unresolved identities typically represent:**
- Azure AD security groups
- Project Administrator groups  
- Project Collection Administrator groups
- Build service accounts
- Other system identities

These require the **Graph: Read** and **Identity: Read** scopes to be properly resolved.
