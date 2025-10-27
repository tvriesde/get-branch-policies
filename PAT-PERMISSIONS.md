# Azure DevOps PAT Token Permissions Guide

## Required Permissions to Resolve All Identities

To ensure the scripts can fully resolve all groups, teams, and users, your Personal Access Token (PAT) needs the following permissions:

### Minimum (Basic Functionality)
```
✅ Code: Read
✅ Project and Team: Read
```
**What works**: Direct user assignments, repository information, branch policies
**What doesn't work**: Group name resolution, group member expansion

---

### Recommended (Full Functionality)
```
✅ Code: Read
✅ Graph: Read               ← Resolves Azure DevOps groups
✅ Identity: Read             ← Resolves Team Foundation identities
✅ Project and Team: Read
✅ Security: Read             ← Reads ACLs and permission assignments
✅ User Profile: Read         ← Gets complete user information
```

**What works**: Everything! All groups resolved, all members expanded, complete information

---

## How to Update Your PAT Token

### Step 1: Access Token Settings
1. Go to Azure DevOps (https://dev.azure.com/your-organization)
2. Click your profile icon (top right)
3. Select **Personal Access Tokens**

### Step 2: Create or Edit Token
- **New token**: Click "New Token"
- **Existing token**: Find your token, click the three dots (⋯), select "Edit"

### Step 3: Configure Scopes
Click "Show all scopes" at the bottom of the scope selector

Find and enable these scopes:
- [ ] **Code** → Read
- [ ] **Graph** → Read
- [ ] **Identity** → Read  
- [ ] **Project and Team** → Read
- [ ] **Security** → Read
- [ ] **User Profile** → Read

### Step 4: Save and Update
1. Click "Create" (or "Save" for existing token)
2. Copy the token value
3. Update your `.env` file:
   ```
   AZURE_DEVOPS_PAT=your-new-token-here
   ```

---

## What Each Permission Enables

| Permission Scope | API Access | What Gets Resolved |
|-----------------|------------|-------------------|
| **Code: Read** | Git Repositories API | Repos, branches, policies |
| **Graph: Read** | Graph API | Azure AD groups, project groups |
| **Identity: Read** | Identities API | Team Foundation identities, SIDs |
| **Security: Read** | Security Namespaces, ACLs | Permission assignments |
| **Project and Team: Read** | Project API, Teams API | Project info, team memberships |
| **User Profile: Read** | Profile API | User emails, display names |

---

## Identifying Missing Permissions

### In `branch-policy-permissions.csv`
Look for entries like:
```
[Unresolved Group or User: Microsoft.TeamFoundation.Identity;...]
```

### In `repository-permissions.csv`
Look for entries like:
```
[Unresolved: Microsoft.TeamFoundation.Identity;S-1-9-...]
[Unresolved: Microsoft.TeamFoundation.ServiceIdentity;...]
```

### Console Output
Watch for messages like:
```
Could not resolve identity: Microsoft.TeamFoundation.Identity;...
```

---

## Security Considerations

### Least Privilege Principle
Only grant the permissions you need:
- **For branch policies only**: Code: Read, Project: Read
- **For complete permissions**: Add Graph: Read, Identity: Read, Security: Read

### Token Expiration
- Set an appropriate expiration date (30-90 days recommended)
- Create a reminder to regenerate before expiration
- Don't commit tokens to source control (they're in `.gitignore`)

### Scope Levels
- **Read only**: Recommended for these scripts
- **Write/Manage**: Not required, don't enable unless needed for other purposes

---

## Alternative: Using Azure DevOps CLI

If you prefer not to create a PAT with Graph permissions, you can:
1. Use Azure DevOps CLI with your Azure AD credentials
2. The CLI automatically handles authentication
3. Install: `az extension add --name azure-devops`

However, the Node.js scripts are designed for PAT authentication for simplicity and CI/CD compatibility.

---

## Verification

After updating your PAT token permissions, re-run the scripts:

```powershell
# Test branch policy permissions
npm start

# Test repository permissions  
npm run repos
```

Check the output for:
- ✅ Fewer or no "Unresolved" entries
- ✅ Group names displayed instead of descriptors
- ✅ Console messages showing group member expansion

---

## Still Having Issues?

### Check Token Status
```powershell
# The scripts will show authentication errors if the token is invalid
node main.js
```

### Verify Scopes
1. Go to Personal Access Tokens in Azure DevOps
2. Click on your token name
3. Review the "Scopes" section
4. Ensure all required scopes are listed with "Read" access

### Organization Policies
Some organizations restrict which scopes can be granted to PAT tokens. Contact your Azure DevOps administrator if certain scopes are unavailable.
