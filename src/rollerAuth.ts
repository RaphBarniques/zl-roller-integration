// ROLLER API AUTHENTICATION FUNCTIONS
//
// Usage: getToken()
// Returns: Access token string or null if failed
// Also stores the token
//
// Usage: refreshToken()
// Returns: New access token string or null if failed
// Technically the Roller API doesnt have a refresh protocol. We just get a new token

import { customLog } from './logger.ts';

export let RollerAuthToken: string | null = null;
let logMessage: string = 'Initializing ROLLER API authentication...\n';

export async function getRollerToken() {
    const retryMax = 3;
        const delay = 1000;
        for (let attempt = 1; attempt <= retryMax; attempt++) {
    
            const response = await fetch(
                'https://api.play.roller.app/token',
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                    "grant_type": "client_credentials",
                    "client_id": Bun.env.ROLLER_CLIENT_ID,
                    "client_secret": Bun.env.ROLLER_CLIENT_SECRET
                    }),
                    method: 'POST'
                },
            );
    
            if (!response.ok) {
                logMessage += `Failed to get ROLLER API auth token: ${response.status} ${response.statusText}. Retrying...`;
                customLog(logMessage, 'WARN');
                logMessage = '';
                setTimeout(() => {}, delay);
            } else {
                const responseJson = await response.json();
                const data = responseJson as {
                    access_token: string;
                };
                RollerAuthToken = data.access_token;
                logMessage += 'Roller API token obtained successfully';
                customLog(logMessage, 'INFO');
                return data.access_token;
            }
        }
        customLog(`Failed to get Roller token after ${retryMax} attempts`, 'ERROR');
        return null;
}

export async function refreshRollerToken() {
    const token = getRollerToken()
    return token;
}