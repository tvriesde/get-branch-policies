import dotenv from 'dotenv';
import axios from 'axios';
import { createObjectCsvWriter } from 'csv-writer';

// Load environment variables
dotenv.config();

const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
const project = process.env.AZURE_DEVOPS_PROJECT;
const pat = process.env.AZURE_DEVOPS_PAT;

// Validate configuration
if (!orgUrl || !project || !pat) {
    console.error('Error: Missing required environment variables.');
    console.error('Please ensure AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT are set in .env file');
    process.exit(1);
}

// Base64 encode PAT for authentication
const authToken = Buffer.from(`:${pat}`).toString('base64');

// Axios instance with authentication
const azureDevOpsApi = axios.create({
    headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
    }
});

/**
 * Get all repositories in the project
 */
async function getRepositories() {
    try {
        const url = `${orgUrl}/${project}/_apis/git/repositories?api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        return response.data.value;
    } catch (error) {
        console.error('Error fetching repositories:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Get all security namespaces
 */
async function getSecurityNamespaces() {
    try {
        const url = `${orgUrl}/_apis/securitynamespaces?api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        return response.data.value;
    } catch (error) {
        console.error('Error fetching security namespaces:', error.response?.data || error.message);
        return [];
    }
}

/**
 * Get ACLs (Access Control Lists) for a specific security namespace and token
 */
async function getACLs(namespaceId, token) {
    try {
        const url = `${orgUrl}/_apis/accesscontrollists/${namespaceId}?api-version=7.0&token=${encodeURIComponent(token)}`;
        const response = await azureDevOpsApi.get(url);
        return response.data.value;
    } catch (error) {
        console.error(`Error fetching ACLs for token ${token}:`, error.response?.data || error.message);
        return [];
    }
}

/**
 * Get identity details using Graph API
 */
async function getIdentity(descriptor) {
    try {
        // Handle different descriptor formats
        // Format 1: Microsoft.IdentityModel.Claims.ClaimsIdentity;...
        // Format 2: Microsoft.TeamFoundation.Identity;S-1-9-...
        // Format 3: Microsoft.TeamFoundation.ServiceIdentity;...
        
        // Extract email from ClaimsIdentity descriptor if present
        if (descriptor.includes('ClaimsIdentity')) {
            const parts = descriptor.split('\\');
            if (parts.length > 1) {
                const email = parts[1];
                return {
                    descriptor: descriptor,
                    displayName: email,
                    mailAddress: email,
                    principalName: email,
                    subjectKind: 'user',
                    isContainer: false,
                    id: descriptor
                };
            }
        }
        
        // Use Graph API with vssps subdomain
        const orgName = orgUrl.split('/').pop();
        const graphUrl = `https://vssps.dev.azure.com/${orgName}/_apis/graph/descriptors/${encodeURIComponent(descriptor)}?api-version=7.1-preview.1`;
        
        try {
            const storageKeyResponse = await azureDevOpsApi.get(graphUrl);
            if (storageKeyResponse.data && storageKeyResponse.data.value) {
                const storageKey = storageKeyResponse.data.value;
                
                // Now get the subject details using storage key
                const subjectUrl = `https://vssps.dev.azure.com/${orgName}/_apis/graph/storagekeys/${storageKey}?api-version=7.1-preview.1`;
                const subjectResponse = await azureDevOpsApi.get(subjectUrl);
                
                if (subjectResponse.data) {
                    const subject = subjectResponse.data;
                    console.log(`      ✓ Resolved via Graph API: ${subject.displayName || subject.principalName}`);
                    return {
                        descriptor: descriptor,
                        displayName: subject.displayName || subject.principalName,
                        mailAddress: subject.mailAddress || '',
                        principalName: subject.principalName || subject.displayName,
                        subjectKind: subject.subjectKind,
                        isContainer: subject.subjectKind === 'group',
                        id: storageKey
                    };
                }
            }
        } catch (graphError) {
            // Graph API failed, try direct lookup
            console.log(`      ✗ Graph descriptor API failed: ${graphError.response?.status}`);
        }
        
        // Try direct Graph subjects lookup
        try {
            const subjectsUrl = `https://vssps.dev.azure.com/${orgName}/_apis/graph/subjects/${encodeURIComponent(descriptor)}?api-version=7.1-preview.1`;
            const response = await azureDevOpsApi.get(subjectsUrl);
            
            if (response.data) {
                const subject = response.data;
                console.log(`      ✓ Resolved via Graph subjects: ${subject.displayName || subject.principalName}`);
                return {
                    descriptor: descriptor,
                    displayName: subject.displayName || subject.principalName,
                    mailAddress: subject.mailAddress || '',
                    principalName: subject.principalName || subject.displayName,
                    subjectKind: subject.subjectKind,
                    isContainer: subject.subjectKind === 'group',
                    id: subject._links?.storageKey?.href?.split('/').pop()
                };
            }
        } catch (subjectsError) {
            console.log(`      ✗ Graph subjects API failed: ${subjectsError.response?.status}`);
        }
        
        return null;
    } catch (error) {
        console.log(`      ✗ All resolution attempts failed for descriptor: ${descriptor.substring(0, 80)}`);
        // Try to extract info from descriptor itself
        if (descriptor.includes('\\')) {
            const parts = descriptor.split('\\');
            const displayName = parts[parts.length - 1];
            return {
                descriptor: descriptor,
                displayName: displayName,
                mailAddress: displayName.includes('@') ? displayName : '',
                principalName: displayName,
                subjectKind: 'user',
                isContainer: false
            };
        }
        return null;
    }
}

/**
 * Get group members
 */
async function getGroupMembers(identity) {
    try {
        const teamFoundationId = identity.id || identity.teamFoundationId;
        if (!teamFoundationId) {
            return [];
        }
        
        const url = `${orgUrl}/_apis/identities/${teamFoundationId}/members?api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        return response.data.value || [];
    } catch (error) {
        return [];
    }
}

/**
 * Get identity by ID
 */
async function getIdentityById(identityId) {
    try {
        const url = `${orgUrl}/_apis/identities/${identityId}?api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        return response.data;
    } catch (error) {
        return null;
    }
}

/**
 * Recursively expand all group members to get individual users
 */
async function expandGroupMembers(identity, visited = new Set()) {
    const identityId = identity.id || identity.teamFoundationId;
    if (!identityId || visited.has(identityId)) {
        return [];
    }
    visited.add(identityId);
    
    const allMembers = [];
    const members = await getGroupMembers(identity);
    
    for (const member of members) {
        const memberId = member.id || member.teamFoundationId;
        if (!memberId) continue;
        
        const memberIdentity = await getIdentityById(memberId);
        if (memberIdentity) {
            if (memberIdentity.isContainer) {
                // If it's a group, recursively expand it
                const subMembers = await expandGroupMembers(memberIdentity, visited);
                allMembers.push(...subMembers);
            } else {
                // It's a user
                allMembers.push({
                    descriptor: memberIdentity.descriptor || memberId,
                    displayName: memberIdentity.providerDisplayName || memberIdentity.customDisplayName || memberIdentity.displayName || memberId,
                    mailAddress: memberIdentity.properties?.Account?.$value || memberIdentity.properties?.Mail?.$value || '',
                    subjectKind: 'user',
                    id: memberId
                });
            }
        }
    }
    
    return allMembers;
}

/**
 * Get all repository permissions
 */
async function getRepositoryPermissions(repositoryId, repositoryName, projectId) {
    const permissions = [];
    const processedIdentities = new Set(); // To avoid duplicates
    
    try {
        // Get security namespaces
        const namespaces = await getSecurityNamespaces();
        
        // Find the Git Repositories namespace
        const gitNamespace = namespaces.find(ns => ns.name === 'Git Repositories');
        if (!gitNamespace) {
            console.warn('Git Repositories namespace not found');
            return permissions;
        }
        
        // Git repository permission bits (from Azure DevOps documentation)
        const permissionsBits = {
            'Administer': 8192,
            'Read': 2,
            'Contribute': 4,
            'Force push (rewrite history, delete branches and tags)': 8,
            'Create branch': 16,
            'Create tag': 32,
            'Manage notes': 64,
            'Bypass policies when pushing': 128,
            'Create repository': 256,
            'Delete repository': 512,
            'Rename repository': 1024,
            'Edit policies': 2048,
            'Remove others\' locks': 4096,
            'Manage permissions': 8192,
            'Pull request contribute': 16384,
            'Bypass policies when completing pull requests': 32768
        };
        
        // Helper function to add permission entry
        const addPermission = (descriptor, identity, permissionName, allowDeny, source, isDirectAssignment = false) => {
            const key = `${descriptor}|${repositoryName}|${permissionName}`;
            if (!processedIdentities.has(key)) {
                processedIdentities.add(key);
                permissions.push({
                    repository: repositoryName,
                    identityType: identity.subjectKind || 'Unknown',
                    displayName: identity.displayName || identity.principalName || descriptor,
                    mailAddress: identity.mailAddress || '',
                    descriptor: descriptor,
                    permission: permissionName,
                    allow: allowDeny,
                    permissionSource: source,
                    isDirectAssignment: isDirectAssignment ? 'Yes' : 'No'
                });
            }
        };
        
        // Get repository-level ACLs
        const repoToken = `repoV2/${projectId}/${repositoryId}`;
        const repoAcls = await getACLs(gitNamespace.namespaceId, repoToken);
        
        console.log(`    Processing ${repoAcls.length} repository-level ACLs`);
        
        // Process repository-level ACL assignments
        for (const acl of repoAcls) {
            if (acl.acesDictionary) {
                for (const [descriptor, ace] of Object.entries(acl.acesDictionary)) {
                    const allowBits = ace.allow || 0;
                    const denyBits = ace.deny || 0;
                    
                    // Check each permission
                    for (const [permissionName, bitValue] of Object.entries(permissionsBits)) {
                        let allowDeny = 'Not Set';
                        
                        if (denyBits & bitValue) {
                            allowDeny = 'Deny';
                        } else if (allowBits & bitValue) {
                            allowDeny = 'Allow';
                        } else {
                            continue; // Skip if neither allowed nor denied
                        }
                        
                        const identity = await getIdentity(descriptor);
                        if (identity) {
                            const displayName = identity.providerDisplayName || identity.customDisplayName || identity.displayName || identity.principalName || descriptor;
                            const normalizedIdentity = {
                                descriptor: identity.descriptor || descriptor,
                                displayName: displayName,
                                mailAddress: identity.mailAddress || identity.properties?.Account?.$value || identity.properties?.Mail?.$value || '',
                                subjectKind: identity.subjectKind || (identity.isContainer ? 'group' : 'user')
                            };
                            
                            if (identity.isContainer || identity.subjectKind === 'group') {
                                // It's a group - add the group itself
                                addPermission(descriptor, normalizedIdentity, permissionName, allowDeny, `Direct Group Assignment`, true);
                                
                                // Expand group members
                                console.log(`      Expanding group: ${displayName}`);
                                const identityForExpansion = await getIdentityById(identity.id || identity.teamFoundationId);
                                if (identityForExpansion) {
                                    const members = await expandGroupMembers(identityForExpansion);
                                    console.log(`        Found ${members.length} members`);
                                    for (const member of members) {
                                        addPermission(
                                            member.descriptor, 
                                            member, 
                                            permissionName,
                                            allowDeny,
                                            `Member of ${displayName}`,
                                            false
                                        );
                                    }
                                }
                            } else {
                                // Direct user assignment
                                addPermission(descriptor, normalizedIdentity, permissionName, allowDeny, 'Direct User Assignment', true);
                            }
                        } else {
                            // Could not resolve identity - add it with descriptor as name
                            const unresolvedIdentity = {
                                descriptor: descriptor,
                                displayName: `[Unresolved: ${descriptor.substring(0, 60)}...]`,
                                mailAddress: '',
                                subjectKind: 'unknown'
                            };
                            addPermission(descriptor, unresolvedIdentity, permissionName, allowDeny, 'Direct Assignment (unresolved)', true);
                        }
                    }
                }
            }
        }
        
        // Get Project-level permissions (inherited)
        console.log(`    Checking project-level permissions...`);
        const projectToken = `repoV2/${projectId}`;
        const projectAcls = await getACLs(gitNamespace.namespaceId, projectToken);
        
        // Process project-level ACL assignments
        for (const acl of projectAcls) {
            if (acl.acesDictionary) {
                for (const [descriptor, ace] of Object.entries(acl.acesDictionary)) {
                    const allowBits = ace.allow || 0;
                    const denyBits = ace.deny || 0;
                    
                    // Check each permission
                    for (const [permissionName, bitValue] of Object.entries(permissionsBits)) {
                        let allowDeny = 'Not Set';
                        
                        if (denyBits & bitValue) {
                            allowDeny = 'Deny';
                        } else if (allowBits & bitValue) {
                            allowDeny = 'Allow';
                        } else {
                            continue; // Skip if neither allowed nor denied
                        }
                        
                        const identity = await getIdentity(descriptor);
                        if (identity) {
                            const displayName = identity.providerDisplayName || identity.customDisplayName || identity.displayName || identity.principalName || descriptor;
                            const normalizedIdentity = {
                                descriptor: identity.descriptor || descriptor,
                                displayName: displayName,
                                mailAddress: identity.mailAddress || identity.properties?.Account?.$value || identity.properties?.Mail?.$value || '',
                                subjectKind: identity.subjectKind || (identity.isContainer ? 'group' : 'user')
                            };
                            
                            if (identity.isContainer || identity.subjectKind === 'group') {
                                // It's a group - add the group itself
                                addPermission(descriptor, normalizedIdentity, permissionName, allowDeny, `Project-level Group Assignment (inherited)`, false);
                                
                                // Expand group members
                                console.log(`      Expanding project-level group: ${displayName}`);
                                const identityForExpansion = await getIdentityById(identity.id || identity.teamFoundationId);
                                if (identityForExpansion) {
                                    const members = await expandGroupMembers(identityForExpansion);
                                    console.log(`        Found ${members.length} members`);
                                    for (const member of members) {
                                        addPermission(
                                            member.descriptor, 
                                            member, 
                                            permissionName,
                                            allowDeny,
                                            `Member of ${displayName} (inherited)`,
                                            false
                                        );
                                    }
                                }
                            } else {
                                // Project-level user assignment
                                addPermission(descriptor, normalizedIdentity, permissionName, allowDeny, 'Project-level User Assignment (inherited)', false);
                            }
                        } else {
                            // Could not resolve identity - add it with descriptor as name
                            const unresolvedIdentity = {
                                descriptor: descriptor,
                                displayName: `[Unresolved: ${descriptor.substring(0, 60)}...]`,
                                mailAddress: '',
                                subjectKind: 'unknown'
                            };
                            addPermission(descriptor, unresolvedIdentity, permissionName, allowDeny, 'Project-level (unresolved, inherited)', false);
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error(`Error getting permissions for repository ${repositoryName}:`, error.response?.data || error.message);
    }
    
    return permissions;
}

/**
 * Main execution function
 */
async function main() {
    console.log('Starting Azure DevOps Repository Permissions extraction...\n');
    
    try {
        // Get all repositories
        console.log('Fetching repositories...');
        const repositories = await getRepositories();
        console.log(`Found ${repositories.length} repositories\n`);
        
        // Get project ID
        const projectUrl = `${orgUrl}/_apis/projects/${project}?api-version=7.0`;
        const projectResponse = await azureDevOpsApi.get(projectUrl);
        const projectId = projectResponse.data.id;
        console.log(`Project ID: ${projectId}\n`);
        
        // Collect all permissions
        const allPermissions = [];
        
        for (const repo of repositories) {
            console.log(`Processing repository: ${repo.name}`);
            
            // Get repository permissions
            const permissions = await getRepositoryPermissions(repo.id, repo.name, projectId);
            console.log(`  ✓ Found ${permissions.length} permission entries\n`);
            allPermissions.push(...permissions);
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Write permissions to CSV
        console.log('Writing permissions to CSV...');
        const permissionsCsvWriter = createObjectCsvWriter({
            path: 'repository-permissions.csv',
            header: [
                { id: 'repository', title: 'Repository' },
                { id: 'identityType', title: 'Identity Type' },
                { id: 'displayName', title: 'Display Name' },
                { id: 'mailAddress', title: 'Email Address' },
                { id: 'descriptor', title: 'Descriptor' },
                { id: 'permission', title: 'Permission' },
                { id: 'allow', title: 'Allow/Deny' },
                { id: 'permissionSource', title: 'Permission Source' },
                { id: 'isDirectAssignment', title: 'Is Direct Assignment' }
            ]
        });
        
        await permissionsCsvWriter.writeRecords(allPermissions);
        console.log(`✓ Exported ${allPermissions.length} permission entries to repository-permissions.csv\n`);
        
        console.log('Repository permissions extraction completed successfully!');
        
    } catch (error) {
        console.error('Fatal error during execution:', error);
        process.exit(1);
    }
}

// Run the script
main();
