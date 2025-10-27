# Azure DevOps Identity Resolution Limitations

## Issue Summary

The scripts successfully extract repository permissions and branch policies from Azure DevOps, but **group identities cannot be resolved** to display names. This is a known limitation of the Azure DevOps REST API when using Personal Access Tokens (PAT).

## Root Cause

Azure DevOps uses different descriptor formats for security (ACLs) vs. identity lookups:

### ACL Descriptors (from Security API)
- Format: `Microsoft.TeamFoundation.Identity;S-1-9-1551374245-...`
- Format: `Microsoft.TeamFoundation.ServiceIdentity;2facddce-1502-4b8d-8b1b-0d9dbb13f336:Build:...`
- These are SID-like security identifiers

### Identity API Descriptors
- Format: `aad.YzMyZTEzNDUtZjZmYy03MWI0LWEwNGItOTQ5YzU4ZWI2M2Q3` (Azure AD users)
- Format: `svc.MmZhY2RkY2UtMTUwMi00YjhkLThiMWItMGQ5ZGJiMTNmMzM2OkJ1aWxkOjRjOGU0ZDMzLTk1Y2YtNGU4YS1hZWU0LTg4NzkwMmY5MTI0NQ` (Service identities)

## API Availability Issues

When attempting to resolve TeamFoundation descriptors, the following APIs return errors:

1. **Identities API** (`/_apis/identities`)
   - Status: 404 Not Found
   - Conclusion: Not available for this organization

2. **Graph API** (`https://vssps.dev.azure.com/{org}/_apis/graph/`)
   - Status: 400 Bad Request / 404 Not Found
   - Conclusion: Not accessible with current PAT permissions

## What Works

✅ **Direct user assignments** - When a user is directly assigned permissions using their email in a ClaimsIdentity descriptor:
- Format: `Microsoft.IdentityModel.Claims.ClaimsIdentity;...\\user@domain.com`
- These resolve correctly by parsing the email from the descriptor

✅ **Permission detection** - The scripts correctly identify:
- Which repositories have permissions assigned
- What permission levels are set (Allow/Deny/NotSet)
- Permission inheritance from project level

✅ **Descriptor capture** - All group/team descriptors are captured in the CSV files for manual resolution

## What Doesn't Work

❌ **Group name resolution** - Cannot resolve:
- Azure DevOps security groups (e.g., "Project Administrators", "Contributors")
- Azure DevOps teams
- Azure AD groups synchronized to Azure DevOps

❌ **Group membership expansion** - Cannot list members of groups

## Current Output

The CSV files contain entries like:
```csv
Repository,Identity Type,Identity Display Name,Permission,Access
frog,group,[Unresolved: Microsoft.TeamFoundation.Identity;S-1-9-1551374245-...],Administer,Allow
```

## Workarounds

### Option 1: Manual Resolution via Azure DevOps UI
1. Open Azure DevOps in your browser
2. Navigate to Project Settings → Repositories → [Repository Name] → Security
3. Match the permissions in the CSV with the UI to identify which groups they belong to
4. Manually update the CSV with group names

### Option 2: Azure DevOps CLI
The Azure DevOps CLI may have better access to identity resolution:
```powershell
# Install Azure DevOps extension
az extension add --name azure-devops

# Login
az login

# Set organization and project
az devops configure --defaults organization=https://dev.azure.com/thefrogs project=frog

# List security groups
az devops security group list --scope project --project frog

# List team members
az devops team list --project frog
```

### Option 3: Request Organization Admin Access
Azure DevOps organization administrators have access to the full Graph API, which can resolve all identity types. Request admin access or have an admin run these scripts.

### Option 4: Use Azure DevOps API with Service Principal
Instead of PAT tokens, use Azure Service Principal authentication with Microsoft Graph API permissions. This may provide better access to identity resolution.

## Technical Details

### Attempted Solutions
1. ✗ Identities API with descriptor query parameter
2. ✗ Identities API batch request (POST)
3. ✗ Graph API with vssps subdomain
4. ✗ Graph subjects API
5. ✗ Caching all identities upfront
6. ✓ Parsing ClaimsIdentity descriptors (works for direct users only)
7. ✓ Graph API for user listing (works, but different descriptor format)

### Why PAT Tokens Are Limited
Personal Access Tokens are scoped to the user's permissions. Even with "Full Access" scope, PATs cannot:
- Access organization-level Graph API endpoints
- Translate between descriptor formats
- Query certain identity metadata

This is by design for security reasons.

## Recommendations

1. **Accept the limitation**: The CSV files contain all permission information, just with descriptors instead of names
2. **Manual mapping**: Create a separate mapping file for frequently seen descriptors
3. **UI verification**: Use Azure DevOps UI for final verification of group identities
4. **Admin collaboration**: Work with Azure DevOps admins to run scripts with elevated access

## Related Documentation

- [Azure DevOps Security REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/security/)
- [Azure DevOps Graph REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/graph/)
- [Azure DevOps Identities REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/ims/)
- [Security descriptor formats](https://learn.microsoft.com/en-us/azure/devops/organizations/security/about-security-identity)
