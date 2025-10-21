# Azure DevOps Data Extraction Tool

This script retrieves Azure DevOps information and exports it to CSV files.

## Features

- **Branch Policies CSV**: Lists all branch policies that apply to main branches of repositories
- **Permissions CSV**: Lists users and groups that can change branch policies, including:
  - Direct repository assignments
  - Project Administrators
  - Project Collection Administrators
  - Members of administrator groups

## Setup

### 1. Install Dependencies

```powershell
npm install
```

### 2. Configure Environment Variables

Edit the `.env` file with your Azure DevOps details:

```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-organization
AZURE_DEVOPS_PROJECT=your-project-name
AZURE_DEVOPS_PAT=your-personal-access-token-here
```

### 3. Create a Personal Access Token (PAT)

1. Go to Azure DevOps
2. Click on User Settings (top right) → Personal Access Tokens
3. Click "New Token"
4. Give it a name and set expiration
5. Select the following scopes:
   - **Code**: Read
   - **Graph**: Read
   - **Project and Team**: Read
   - **Security**: Manage
6. Copy the token and paste it in your `.env` file

## Usage

Run the script:

```powershell
npm start
```

Or directly:

```powershell
node main.js
```

## Output Files

### branch-policies.csv

Contains branch policies for main branches with the following columns:
- Repository Name
- Repository ID
- Policy Type (e.g., "Minimum number of reviewers", "Work item linking")
- Policy ID
- Is Enabled
- Is Blocking
- Settings (JSON format with policy details)

### branch-policy-permissions.csv

Contains users and groups with permissions to modify branch policies:
- Repository
- Identity Type (User/Group)
- Display Name
- Descriptor (unique identifier)
- Permission Source (Repository/Project/Project Collection/Group membership)

## Troubleshooting

- **Authentication Error**: Ensure your PAT token is valid and has the required scopes
- **Project Not Found**: Verify the project name in `.env` matches exactly
- **No Policies Found**: Check that your repositories have branch policies configured
- **Rate Limiting**: The script includes small delays between API calls to avoid rate limits

## Notes

- The script specifically looks for policies on the `main` branch
- Permissions are checked at the repository level and project/collection administrator level
- The Git Repositories namespace permission bit for "Manage Policies" is 2048
- Administrator permission bit is 8192
