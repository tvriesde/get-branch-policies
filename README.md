# Azure DevOps Data Extraction Tool

This project provides scripts to extract Azure DevOps repository and branch permissions, exporting them to CSV files for auditing and analysis.

## 📁 Project Structure

```
├── nodejs/                          # Node.js scripts for permissions extraction
│   ├── README.md                    # Node.js scripts documentation
│   ├── main.js                      # Branch policies and permissions
│   ├── main-repos.js                # Repository permissions
│   ├── build-identity-cache.js      # Identity cache builder
│   └── package.json                 # Node.js dependencies
│
├── powershell/                      # PowerShell scripts (optimized)
│   ├── README.md                    # PowerShell scripts documentation
│   ├── Get-RepoPermissions.ps1      # Repository permissions extractor
│   └── Get-MainBranchPermissions.ps1 # Main branch permissions extractor
│
├── .env                             # Configuration (not in git)
├── README.md                        # This file
├── LIMITATIONS.md                   # API limitations documentation
└── PAT-PERMISSIONS.md               # PAT token requirements
```

## 🚀 Quick Start

### Option 1: PowerShell Scripts (Recommended)

**Best for:** Production use, complete identity resolution, fastest performance

```powershell
# 1. Install Azure DevOps CLI
az extension add --name azure-devops

# 2. Configure .env file (see Setup section)

# 3. Run scripts
cd powershell
.\Get-RepoPermissions.ps1           # Repository permissions
.\Get-MainBranchPermissions.ps1     # Branch permissions
```

See [powershell/README.md](./powershell/README.md) for detailed documentation.

### Option 2: Node.js Scripts

**Best for:** Quick prototyping, environments without Azure CLI

```bash
# 1. Install dependencies
cd nodejs
npm install

# 2. Configure .env file (see Setup section)

# 3. Run scripts
npm start                            # Branch policies
npm run repos                        # Repository permissions
```

See [nodejs/README.md](./nodejs/README.md) for detailed documentation.

## ⚙️ Setup

### Prerequisites

- PowerShell 5.1 or higher
- Azure CLI with Azure DevOps extension
- Azure DevOps Personal Access Token (PAT)

### Configuration

Create a `.env` file in the project root:

```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-organization
AZURE_DEVOPS_PROJECT=your-project-name
AZURE_DEVOPS_PAT=your-personal-access-token
```

### Creating a Personal Access Token (PAT)

1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Click "New Token"
3. Configure the token:
   - **Name**: Give it a descriptive name
   - **Expiration**: Set appropriate expiration
   - **Scopes**: Select the following:

   **Minimum Required:**
   - Code: Read
   - Project and Team: Read
   
   **Recommended for Full Functionality:**
   - Code: Read
   - Graph: Read (resolves group identities)
   - Identity: Read (resolves Team Foundation identities)
   - Project and Team: Read
   - Security: Read (reads ACLs and permissions)
   - User Profile: Read (resolves user information)

4. Copy the token and add it to your `.env` file

##  Available Scripts

| Script | Purpose | Output File |
|--------|---------|-------------|
| `Get-RepoPermissions.ps1` | Extract all repository permissions for groups and users | `repository-permissions.csv` |
| `Get-MainBranchPermissions.ps1` | Extract main branch permissions for groups and users | `branch-permissions.csv` |

## 📝 Output Files

### Repository Permissions CSV
Contains detailed permission information:
- Repository name and ID
- Identity (user/group) name and descriptor
- Permission type (Read, Contribute, Administer, etc.)
- Access level (Allow, Deny, Not Set)
- Permission source (inherited/explicit)

### Branch Permissions CSV
Contains branch-specific permission information:
- Repository name
- Branch name
- Identity (user/group) name and type
- Permission type (branch-specific permissions)
- Access level (Allow, Deny, Not Set)

## 🔧 Troubleshooting

### Unresolved Group Identities

**Symptom:** Groups show as `[Unresolved: Microsoft.TeamFoundation.Identity;...]`

**Solution:**
- Ensure your PAT token has **Graph: Read** and **Identity: Read** scopes

### Authentication Errors

**Solutions:**
- Verify PAT token is not expired
- Check token has required scopes
- Ensure `.env` file is in the correct location
- Verify organization URL and project name are correct

### No Permissions Found

**Possible causes:**
- No explicit permissions set (everything is inherited)
- User/group has no repository access
- Token lacks Security: Read scope

For more troubleshooting, see:
- [powershell/README.md](./powershell/README.md) - Detailed documentation
- [LIMITATIONS.md](./LIMITATIONS.md) - Known API limitations

## 📚 Documentation

- **[powershell/README.md](./powershell/README.md)** - Detailed scripts documentation
- **[LIMITATIONS.md](./LIMITATIONS.md)** - Azure DevOps API limitations and workarounds
- **[PAT-PERMISSIONS.md](./PAT-PERMISSIONS.md)** - PAT token permission requirements

## 🎯 Use Cases

- **Security Audits**: Review who has access to repositories and branches
- **Compliance**: Document permission structures for compliance requirements
- **Access Reviews**: Identify overprivileged users or groups
- **Migration Planning**: Understand current permission model before migration
- **Troubleshooting**: Debug access issues by examining effective permissions

## ⚡ Performance Notes

The PowerShell scripts are highly optimized:
- Uses ACL-based queries (queries entire permission set at once)
- Fetches identities once and builds lookup table
- ~15-20 API calls total
- Execution time: 5-10 seconds
- Full identity resolution (groups and users)

## 📄 License

This project is provided as-is for Azure DevOps permission auditing and analysis.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 🔍 Features

### Get-RepoPermissions.ps1
- **Complete Repository Permissions**: Lists all Git repository permissions for every user and group
- **All Permission Types**: Includes all 16 Azure DevOps Git permissions:
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
- **Full Identity Resolution**: Resolves all groups and users using Azure CLI + REST API
- **Inheritance Detection**: Marks inherited permissions from project level
- **Optimized Performance**: Uses ACL-based queries for fast execution

### Get-MainBranchPermissions.ps1
- **Branch-Specific Permissions**: Extracts permissions for main/default branches
- **8 Branch Permissions**: Focuses on branch-relevant permissions
- **Multi-Level Queries**: Checks branch, repository, and project ACLs
- **Inheritance Tracking**: Shows which permissions are inherited
- **Full Identity Resolution**: Resolves all groups and users
