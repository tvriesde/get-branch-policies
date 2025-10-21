import dotenv from 'dotenv';
import axios from 'axios';
import { createObjectCsvWriter } from 'csv-writer';
import { promises as fs } from 'fs';

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
 * Get branch policies for a specific branch in a repository
 */
async function getBranchPolicies(repositoryId, branchName = 'main') {
    try {
        const url = `${orgUrl}/${project}/_apis/policy/configurations?api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        
        // Filter policies that apply to the main branch of this repository
        const policies = response.data.value.filter(policy => {
            if (!policy.isEnabled) return false;
            
            // Check if policy applies to this repository and branch
            const settings = policy.settings;
            if (settings && settings.scope) {
                return settings.scope.some(scope => {
                    const matchesRepo = scope.repositoryId === repositoryId;
                    const matchesBranch = scope.refName === `refs/heads/${branchName}` || 
                                         scope.refName === `refs/heads/main` ||
                                         scope.matchKind === 'Prefix'; // Catches wildcard policies
                    return matchesRepo && (matchesBranch || !scope.refName);
                });
            }
            return false;
        });
        
        return policies;
    } catch (error) {
        console.error(`Error fetching policies for repository ${repositoryId}:`, error.response?.data || error.message);
        return [];
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
        console.error(`Error fetching ACLs for namespace ${namespaceId}:`, error.response?.data || error.message);
        return [];
    }
}

/**
 * Get group members recursively
 */
async function getGroupMembers(identity) {
    try {
        // Use the readMembers endpoint
        const teamFoundationId = identity.id || identity.teamFoundationId;
        if (!teamFoundationId) {
            return [];
        }
        
        const url = `${orgUrl}/_apis/identities/${teamFoundationId}/members?api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        return response.data.value || [];
    } catch (error) {
        console.warn(`Could not fetch members for group ${identity.displayName || identity.id}`);
        return [];
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
 * Get all identities for the project (cached)
 */
let allIdentitiesCache = null;
async function getAllIdentities() {
    if (allIdentitiesCache) {
        return allIdentitiesCache;
    }
    
    try {
        const url = `${orgUrl}/_apis/identities?searchFilter=General&filterValue=&queryMembership=Direct&api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        allIdentitiesCache = response.data.value || [];
        return allIdentitiesCache;
    } catch (error) {
        return [];
    }
}

/**
 * Get identity details
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
        
        // For TeamFoundation.Identity descriptors, try matching from the full list
        if (descriptor.includes('TeamFoundation.Identity') || descriptor.includes('TeamFoundation.ServiceIdentity')) {
            // Get all identities and find a match
            const allIdentities = await getAllIdentities();
            const match = allIdentities.find(i => i.descriptor === descriptor);
            if (match) {
                return {
                    descriptor: match.descriptor,
                    displayName: match.providerDisplayName || match.customDisplayName || match.displayName,
                    mailAddress: match.properties?.Account?.$value || match.properties?.Mail?.$value || '',
                    principalName: match.properties?.Account?.$value || match.displayName,
                    subjectKind: match.isContainer ? 'group' : 'user',
                    isContainer: match.isContainer,
                    id: match.id || match.teamFoundationId,
                    memberIds: match.memberIds || [],
                    members: match.members || []
                };
            }
        }
        
        // Try identities API
        const url = `${orgUrl}/_apis/identities?descriptors=${encodeURIComponent(descriptor)}&queryMembership=Direct&api-version=7.0`;
        const response = await azureDevOpsApi.get(url);
        if (response.data.value && response.data.value.length > 0) {
            const identity = response.data.value[0];
            // Normalize the response structure
            return {
                descriptor: identity.descriptor,
                displayName: identity.providerDisplayName || identity.customDisplayName || identity.displayName,
                mailAddress: identity.properties?.Account?.$value || identity.properties?.Mail?.$value || '',
                principalName: identity.properties?.Account?.$value || identity.displayName,
                subjectKind: identity.isContainer ? 'group' : 'user',
                isContainer: identity.isContainer,
                id: identity.id || identity.teamFoundationId,
                memberIds: identity.memberIds || [],
                members: identity.members || []
            };
        }
        return null;
    } catch (error) {
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
        console.warn(`Could not resolve identity: ${descriptor.substring(0, 80)}`);
        return null;
    }
}

/**
 * Get project-level groups and team members
 */
async function getProjectGroups(projectId) {
    const groups = [];
    
    try {
        // Get teams in the project (which includes administrator groups)
        const teamsUrl = `${orgUrl}/_apis/projects/${projectId}/teams?api-version=7.0`;
        const teamsResponse = await azureDevOpsApi.get(teamsUrl);
        
        // Also try to get security groups through access control
        const securityUrl = `${orgUrl}/_apis/securityroles/scopes/distributedtask.project/roleassignments/resources/${projectId}?api-version=7.1-preview.1`;
        
        // Get project identity using a known working API
        const identitiesUrl = `${orgUrl}/_apis/identities?searchFilter=General&filterValue=&queryMembership=None&api-version=7.0`;
        const identitiesResponse = await azureDevOpsApi.get(identitiesUrl);
        
        if (identitiesResponse.data.value) {
            for (const identity of identitiesResponse.data.value) {
                const displayName = identity.providerDisplayName || identity.customDisplayName || identity.displayName || '';
                
                // Filter for admin groups related to this project
                if (identity.isContainer && displayName) {
                    if (displayName.includes('Project Administrators') ||
                        displayName.includes('Build Administrators') ||
                        displayName.includes('Project Collection Administrators')) {
                        // Check if it's related to our project or global
                        if (displayName.includes(`[${project}]`) || !displayName.includes('[')) {
                            groups.push(identity);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.warn('Could not fetch all project groups, will use partial data');
    }
    
    return groups;
}

/**
 * Get users and groups with permission to modify branch policies
 */
async function getUsersWithBranchPolicyPermissions(repositoryId, repositoryName) {
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
        
        // Token format for repository: repoV2/{projectId}/{repositoryId}
        const projectUrl = `${orgUrl}/_apis/projects/${project}?api-version=7.0`;
        const projectResponse = await azureDevOpsApi.get(projectUrl);
        const projectId = projectResponse.data.id;
        
        const token = `repoV2/${projectId}/${repositoryId}`;
        
        // Get ACLs for this repository
        const acls = await getACLs(gitNamespace.namespaceId, token);
        
        // Git repository permission bits (from Azure DevOps documentation)
        const permissions_bits = {
            'Bypass policies when completing pull requests': 32768,
            'Bypass policies when pushing': 128,
            'Contribute': 4,
            'Edit policies': 2048,
            'Force push (rewrite history, delete branches and tags)': 8,
            'Manage permissions': 8192,
            'Remove others\' locks': 4096
        };
        
        // Helper function to add permission entry
        const addPermission = (descriptor, identity, permissionName, source, isDirectAssignment = false) => {
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
                    permissionSource: source,
                    isDirectAssignment: isDirectAssignment ? 'Yes' : 'No'
                });
            }
        };
        
        // Process direct ACL assignments
        for (const acl of acls) {
            if (acl.acesDictionary) {
                for (const [descriptor, ace] of Object.entries(acl.acesDictionary)) {
                    const allowBits = ace.allow || 0;
                    
                    // Check each permission
                    for (const [permissionName, bitValue] of Object.entries(permissions_bits)) {
                        if (allowBits & bitValue) {
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
                                    addPermission(descriptor, normalizedIdentity, permissionName, `Direct Group Assignment`, true);
                                    
                                    // Expand group members
                                    console.log(`    Expanding group: ${displayName}`);
                                    const identityForExpansion = await getIdentityById(identity.id || identity.teamFoundationId);
                                    if (identityForExpansion) {
                                        const members = await expandGroupMembers(identityForExpansion);
                                        console.log(`      Found ${members.length} members`);
                                        for (const member of members) {
                                            addPermission(
                                                member.descriptor, 
                                                member, 
                                                permissionName, 
                                                `Member of ${displayName}`,
                                                false
                                            );
                                        }
                                    }
                                } else {
                                    // Direct user assignment
                                    addPermission(descriptor, normalizedIdentity, permissionName, 'Direct User Assignment', true);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Get Project-level permissions (check project-level security token)
        const projectToken = `repoV2/${projectId}`;
        const projectAcls = await getACLs(gitNamespace.namespaceId, projectToken);
        console.log(`    Checking ${projectAcls.length} project-level ACLs with ${Object.keys(projectAcls[0]?.acesDictionary || {}).length} ACEs`);
        
        // Process project-level ACL assignments
        for (const acl of projectAcls) {
            if (acl.acesDictionary) {
                for (const [descriptor, ace] of Object.entries(acl.acesDictionary)) {
                    const allowBits = ace.allow || 0;
                    
                    // Check each permission
                    for (const [permissionName, bitValue] of Object.entries(permissions_bits)) {
                        if (allowBits & bitValue) {
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
                                    addPermission(descriptor, normalizedIdentity, permissionName, `Project-level Group Assignment`, false);
                                    
                                    // Expand group members
                                    console.log(`    Expanding project-level group: ${displayName}`);
                                    const identityForExpansion = await getIdentityById(identity.id || identity.teamFoundationId);
                                    if (identityForExpansion) {
                                        const members = await expandGroupMembers(identityForExpansion);
                                        console.log(`      Found ${members.length} members`);
                                        for (const member of members) {
                                            addPermission(
                                                member.descriptor, 
                                                member, 
                                                permissionName, 
                                                `Member of ${displayName} (project-level)`,
                                                false
                                            );
                                        }
                                    }
                                } else {
                                    // Project-level user assignment
                                    addPermission(descriptor, normalizedIdentity, permissionName, 'Project-level User Assignment', false);
                                }
                            } else {
                                // Could not resolve identity - add it with descriptor as name
                                const unresolvedIdentity = {
                                    descriptor: descriptor,
                                    displayName: `[Unresolved Group or User: ${descriptor.substring(0, 60)}...]`,
                                    mailAddress: '',
                                    subjectKind: 'unknown'
                                };
                                addPermission(descriptor, unresolvedIdentity, permissionName, 'Project-level (unresolved)', false);
                            }
                        }
                    }
                }
            }
        }
        
        // Get Project-level groups with elevated permissions
        const projectGroups = await getProjectGroups(projectId);
        
        const adminGroups = projectGroups.filter(g => {
            const name = g.displayName || g.providerDisplayName || g.customDisplayName || '';
            return name.includes('Administrators') || 
                   name.includes('Build Administrators');
        });
        
        for (const group of adminGroups) {
            const groupName = group.providerDisplayName || group.customDisplayName || group.displayName || 'Unknown Group';
            const groupDescriptor = group.descriptor || group.id;
            const groupId = group.id || group.teamFoundationId;
            
            // Add the group itself for all permissions (admins have all rights)
            for (const permissionName of Object.keys(permissions_bits)) {
                addPermission(
                    groupDescriptor,
                    {
                        displayName: groupName,
                        mailAddress: '',
                        subjectKind: 'group',
                        descriptor: groupDescriptor
                    },
                    permissionName,
                    `${groupName} (inherited)`,
                    false
                );
            }
            
            // Get and add all members of admin groups
            console.log(`    Expanding admin group: ${groupName}`);
            const members = await expandGroupMembers(group);
            console.log(`      Found ${members.length} members`);
            for (const member of members) {
                for (const permissionName of Object.keys(permissions_bits)) {
                    addPermission(
                        member.descriptor,
                        member,
                        permissionName,
                        `Member of ${groupName}`,
                        false
                    );
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
    console.log('Starting Azure DevOps data extraction...\n');
    
    try {
        // Pre-load all identities for faster lookups
        console.log('Loading identities...');
        const identities = await getAllIdentities();
        console.log(`✓ Loaded ${identities.length} identities\n`);
        
        // Get all repositories
        console.log('Fetching repositories...');
        const repositories = await getRepositories();
        console.log(`Found ${repositories.length} repositories\n`);
        
        // Collect branch policies
        const allBranchPolicies = [];
        const allPermissions = [];
        
        for (const repo of repositories) {
            console.log(`Processing repository: ${repo.name}`);
            
            // Get branch policies for main branch
            const policies = await getBranchPolicies(repo.id, 'main');
            console.log(`  - Found ${policies.length} policies for main branch`);
            
            for (const policy of policies) {
                allBranchPolicies.push({
                    repositoryName: repo.name,
                    repositoryId: repo.id,
                    policyType: policy.type.displayName,
                    policyId: policy.id,
                    isEnabled: policy.isEnabled,
                    isBlocking: policy.isBlocking,
                    settings: JSON.stringify(policy.settings)
                });
            }
            
            // Get users/groups with permissions to modify branch policies
            console.log(`  - Fetching permissions...`);
            const permissions = await getUsersWithBranchPolicyPermissions(repo.id, repo.name);
            console.log(`  - Found ${permissions.length} permission entries\n`);
            allPermissions.push(...permissions);
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Write branch policies to CSV
        console.log('Writing branch policies to CSV...');
        const branchPolicyCsvWriter = createObjectCsvWriter({
            path: 'branch-policies.csv',
            header: [
                { id: 'repositoryName', title: 'Repository Name' },
                { id: 'repositoryId', title: 'Repository ID' },
                { id: 'policyType', title: 'Policy Type' },
                { id: 'policyId', title: 'Policy ID' },
                { id: 'isEnabled', title: 'Is Enabled' },
                { id: 'isBlocking', title: 'Is Blocking' },
                { id: 'settings', title: 'Settings (JSON)' }
            ]
        });
        
        await branchPolicyCsvWriter.writeRecords(allBranchPolicies);
        console.log(`✓ Exported ${allBranchPolicies.length} branch policies to branch-policies.csv\n`);
        
        // Write permissions to CSV
        console.log('Writing permissions to CSV...');
        const permissionsCsvWriter = createObjectCsvWriter({
            path: 'branch-policy-permissions.csv',
            header: [
                { id: 'repository', title: 'Repository' },
                { id: 'identityType', title: 'Identity Type' },
                { id: 'displayName', title: 'Display Name' },
                { id: 'mailAddress', title: 'Email Address' },
                { id: 'descriptor', title: 'Descriptor' },
                { id: 'permission', title: 'Permission' },
                { id: 'permissionSource', title: 'Permission Source' },
                { id: 'isDirectAssignment', title: 'Is Direct Assignment' }
            ]
        });
        
        await permissionsCsvWriter.writeRecords(allPermissions);
        console.log(`✓ Exported ${allPermissions.length} permission entries to branch-policy-permissions.csv\n`);
        
        console.log('Data extraction completed successfully!');
        
    } catch (error) {
        console.error('Fatal error during execution:', error);
        process.exit(1);
    }
}

// Run the script
main();
