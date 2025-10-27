import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
const project = process.env.AZURE_DEVOPS_PROJECT;
const pat = process.env.AZURE_DEVOPS_PAT;

// Create axios instance with auth header
const azureDevOpsApi = axios.create({
    headers: {
        Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        'Content-Type': 'application/json'
    }
});

/**
 * Build an identity lookup cache
 */
async function buildIdentityCache() {
    console.log('Building identity lookup cache...\n');
    
    const cache = {
        groups: [],
        teams: [],
        users: [],
        serviceIdentities: [],
        timestamp: new Date().toISOString()
    };
    
    try {
        // 1. Get all project teams
        console.log('Fetching teams...');
        const teamsResponse = await azureDevOpsApi.get(`${orgUrl}/_apis/projects/${project}/teams?api-version=7.0`);
        if (teamsResponse.data && teamsResponse.data.value) {
            cache.teams = teamsResponse.data.value.map(team => ({
                id: team.id,
                name: team.name,
                description: team.description || '',
                descriptor: team.identity?.descriptor || null,
                projectName: team.projectName
            }));
            console.log(`  ✓ Found ${cache.teams.length} teams`);
        }
        
        // 2. Get security groups
        console.log('Fetching security groups...');
        const groupsResponse = await azureDevOpsApi.get(`${orgUrl}/_apis/securitynamespaces?api-version=7.0`);
        console.log(`  ℹ Security namespaces API returned ${groupsResponse.data?.value?.length || 0} namespaces`);
        
        // 3. Try to get groups via Graph API
        try {
            const orgName = orgUrl.split('/').pop();
            const graphGroupsUrl = `https://vssps.dev.azure.com/${orgName}/_apis/graph/groups?scopeDescriptor=${project}&api-version=7.1-preview.1`;
            const graphResponse = await azureDevOpsApi.get(graphGroupsUrl);
            if (graphResponse.data && graphResponse.data.value) {
                cache.groups = graphResponse.data.value.map(group => ({
                    descriptor: group.descriptor,
                    displayName: group.displayName || group.principalName,
                    principalName: group.principalName,
                    mailAddress: group.mailAddress || '',
                    origin: group.origin,
                    originId: group.originId
                }));
                console.log(`  ✓ Found ${cache.groups.length} groups via Graph API`);
            }
        } catch (graphError) {
            console.log(`  ✗ Graph API failed: ${graphError.response?.status} - ${graphError.response?.statusText}`);
            
            // Try alternative: list team members to build user cache
            console.log('  ℹ Attempting to build user cache from team memberships...');
            for (const team of cache.teams) {
                try {
                    const membersUrl = `${orgUrl}/_apis/projects/${project}/teams/${team.id}/members?api-version=7.0`;
                    const membersResponse = await azureDevOpsApi.get(membersUrl);
                    if (membersResponse.data && membersResponse.data.value) {
                        for (const member of membersResponse.data.value) {
                            if (member.identity) {
                                const user = {
                                    descriptor: member.identity.descriptor,
                                    displayName: member.identity.displayName,
                                    uniqueName: member.identity.uniqueName,
                                    id: member.identity.id,
                                    imageUrl: member.identity.imageUrl
                                };
                                // Only add if not already in cache
                                if (!cache.users.find(u => u.descriptor === user.descriptor)) {
                                    cache.users.push(user);
                                }
                            }
                        }
                    }
                } catch (memberError) {
                    console.log(`    ✗ Failed to get members for team ${team.name}: ${memberError.message}`);
                }
            }
            console.log(`  ✓ Found ${cache.users.length} users from team memberships`);
        }
        
        // 4. Try to get users via Graph API
        try {
            const orgName = orgUrl.split('/').pop();
            const graphUsersUrl = `https://vssps.dev.azure.com/${orgName}/_apis/graph/users?api-version=7.1-preview.1`;
            const usersResponse = await azureDevOpsApi.get(graphUsersUrl);
            if (usersResponse.data && usersResponse.data.value) {
                const graphUsers = usersResponse.data.value.map(user => ({
                    descriptor: user.descriptor,
                    displayName: user.displayName || user.principalName,
                    principalName: user.principalName,
                    mailAddress: user.mailAddress || '',
                    origin: user.origin,
                    originId: user.originId
                }));
                // Merge with existing users
                for (const user of graphUsers) {
                    if (!cache.users.find(u => u.descriptor === user.descriptor)) {
                        cache.users.push(user);
                    }
                }
                console.log(`  ✓ Total ${cache.users.length} users after Graph API`);
            }
        } catch (userError) {
            console.log(`  ✗ Graph users API failed: ${userError.response?.status}`);
        }
        
        // Write cache to file
        const cacheFile = 'identity-cache.json';
        fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
        console.log(`\n✓ Identity cache saved to ${cacheFile}`);
        console.log(`  - Teams: ${cache.teams.length}`);
        console.log(`  - Groups: ${cache.groups.length}`);
        console.log(`  - Users: ${cache.users.length}`);
        
        return cache;
        
    } catch (error) {
        console.error('Error building identity cache:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

// Run the cache builder
buildIdentityCache()
    .then(() => console.log('\nCache build completed successfully!'))
    .catch(err => console.error('\nCache build failed:', err.message));
