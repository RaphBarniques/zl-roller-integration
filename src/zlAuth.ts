// ZL API AUTHENTICATION FUNCTIONS
//
// UNTESTED - TO REVIEW
//
// Usage: getToken()
// Returns: Access token string or null if failed
// Also stores it and refresh token for next calls
//
// Usage: refreshToken()
// Returns: New access token string or null if failed
// Also stores it and refresh token for next calls

import { customLog } from "./logger.ts";
import { config } from "./preflight.ts";

export let ZLAuthToken: string | null = null;
let ZLRefreshToken: string | null = null;
let logMessage : string = "Initializing ZL API authentication...\n";

export async function getToken() {
  let retryMax = 3;
  let delay = 1000;
  for (let attempt = 1; attempt <= retryMax; attempt++) {
    const response = await fetch(`${config.zl.api_base_url}/auth/user/token`, {
        method: "POST",
        headers: {
        "Content-Type": "application/json",
        },
        body: JSON.stringify({
        username: Bun.env.ZL_USERNAME,
        password: Bun.env.ZL_PASSWORD,
        }),
    });

    if (!response.ok) {
        logMessage += `Failed to get ZL API auth token: ${response.status} ${response.statusText}. Retrying...`;
        customLog(logMessage, "WARN");
        logMessage = "";
        setTimeout(() => {}, delay);
    } else {
        const data = await response.json() as { accessToken: string, refreshToken: string };
        ZLRefreshToken = data.refreshToken;
        ZLAuthToken = data.accessToken;
        logMessage += "ZL API refresh token obtained successfully";
        customLog(logMessage, "INFO");
        return data.accessToken;
    }
  }
    customLog(`Failed to get token after ${retryMax} attempts`, "ERROR");
    return null;
    //process.exit(1);
}

export async function refreshToken() {
  let retryMax = 3;
  let delay = 1000;

  for (let attempt = 1; attempt <= retryMax; attempt++) {
  if (!ZLRefreshToken) {
    customLog(`No refresh token available, cannot refresh access token`, "ERROR");
    return null;
  }
    const response = await fetch(`${config.zl.api_base_url}/auth/user/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: ZLRefreshToken,
      }),
    });
    if (!response.ok) {
      customLog(`Failed to refresh access token: ${response.status} ${response.statusText}`, "ERROR");
      setTimeout(() => {}, delay);
    } else {
      const data = await response.json() as { accessToken: string, refreshToken: string };
      ZLRefreshToken = data.refreshToken;
      ZLAuthToken = data.accessToken;
      customLog(`ZL API access token refreshed successfully`, "INFO");
      return data.accessToken;
    }
  }
    customLog(`Failed to refresh access token after ${retryMax} attempts`, "ERROR");
    return null;
}