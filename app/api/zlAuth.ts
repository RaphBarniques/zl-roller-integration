// ZL API AUTHENTICATION FUNCTIONS
//
// Usage: getToken()
// Returns: Access token string or null if failed
// Also stores it and refresh token for next calls
//
// Usage: refreshToken()
// Returns: New access token string or null if failed
// Also stores it and refresh token for next calls

import { jwtDecode } from 'jwt-decode';
import { customLog } from '../utils/logger.ts';
import { config } from '../preflight.ts';

let isFirstRequest = true;
export let ZLAuthToken: string | null = null;
export let ZLCookie: string | null = null;
let ZLRefreshToken: string | null = null;
let logMessage: string = 'Initializing ZL API authentication...\n';

export async function getToken(): Promise<string> {
	if (isFirstRequest === true || !ZLAuthToken) {
		customLog('First request detected. Requesting new token.');
		await getZLToken();
		const token = await refreshZLToken();
		isFirstRequest = false;
		return token ?? '';
	}

	const decoded = jwtDecode(ZLAuthToken);
	if (!decoded.exp) {
		customLog('Could not get expiration (attribute "exp") from JWT Token', "WARN");
		return '';
	}

	const now = new Date();
	const expiration = new Date(decoded.exp * 1000);

	if (now > expiration) {
		customLog('JWT expired. Requesting new token using refreshToken');
		const token = await refreshZLToken();
		return token ?? '';
	}

	return ZLAuthToken;
}

async function getZLToken() {
	const retryMax = 3;
	const delay = 1000;
	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(
			`${config.zl.api_base_url}/auth/user/token`,
			{
				credentials: 'include',
				headers: {
					Accept: 'application/json, text/plain, */*',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					clientId: Bun.env.ZL_USERNAME,
					clientSecret: Bun.env.ZL_PASSWORD,
					otpCode: null,
					apiKey: 'string',
					scopes: [
                        "read:sites",
                        "read:products",
                        "read:maps",
                        "read:gameresults",
                        "modify:gameresults",
                        "read:opentimes",
                        "read:opendates",
                        "modify:opentimes",
                        "create:opentimes",
                        "read:bookings",
                        "create:bookings",
                        "modify:bookings",
                        "read:invoices",
                        "modify:invoices",
                        "read:players",
                        "create:players",
                        "modify:players",
                        "read:customers",
                        "create:customers",
                        "modify:customers",
                        "read:sessions",
                        "modify:session",
                        "read:discountcodes",
                        "create:discountcodes",
                        "modify:discountcodes",
                        "read:giftvouchers",
                        "create:giftvouchers",
                        "modify:giftvouchers",
                        "read:packages",
                        "create:packages",
                        "modify:packages",
                        "read:packagetemplates",
                        "read:addons",
                        "create:addons",
                        "modify:addons",
                        "read:users",
                        "create:users",
                        "modify:users",
                        "modify:sites",
                        "create:sites",
                        "read:clients",
                        "read:games",
                        "create:games",
                        "modify:games",
                        "read:attractions",
                        "create:attractions",
                        "modify:attractions",
                        "read:notifications",
                        "read:gamespaces",
                        "read:reports",
                        "read:brazerequest"
                    ],
					isTrustedDevice: true,
				}),
				method: 'POST',
				mode: 'cors',
			},
		);

		if (!response.ok) {
			logMessage += `Failed to get ZL API auth token: ${response.status} ${response.statusText}. Retrying...`;
			customLog(logMessage, 'WARN');
			logMessage = '';
			setTimeout(() => {}, delay);
		} else {
			const responseJson = await response.json();
			const data = responseJson as {
				AccessToken: string;
				RefreshToken: string;
			};

            const setCookie = response.headers.get("set-cookie");

            if (setCookie) {
                ZLCookie = setCookie
                    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
                    .map(c => c.split(";")[0].trim())
                    .filter(c => 
                        c.startsWith("ARRAffinity=") ||
                        c.startsWith("ARRAffinitySameSite=")
                    )
                    .join("; ");
            }

			ZLRefreshToken = data.RefreshToken;
			ZLAuthToken = data.AccessToken;
			logMessage += 'ZL API token obtained successfully';
			customLog(logMessage, 'INFO');
			return data.AccessToken;
		}
	}
	customLog(`Failed to get ZL token after ${retryMax} attempts`, 'ERROR');
	return null;
	//process.exit(1);
}

async function refreshZLToken() {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		if (!ZLRefreshToken) {
			customLog(
				`No refresh token available, cannot refresh access token`,
				'ERROR',
			);
			return null;
		}

		const response = await fetch(
			'https://api.zerolatencyvr.com/api/v1/auth/user/refresh',
			{
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					refreshToken: ZLRefreshToken,
					grantType: 'refresh_token',
					scopes: [
						'read:sites',
						'read:products',
						'read:maps',
						'read:gameresults',
						'modify:gameresults',
						'read:opentimes',
						'read:opendates',
						'modify:opentimes',
						'create:opentimes',
						'read:bookings',
						'create:bookings',
						'modify:bookings',
						'read:invoices',
						'modify:invoices',
						'read:players',
						'create:players',
						'modify:players',
						'read:customers',
						'create:customers',
						'modify:customers',
						'read:sessions',
						'modify:session',
						'read:discountcodes',
						'create:discountcodes',
						'modify:discountcodes',
						'read:giftvouchers',
						'create:giftvouchers',
						'modify:giftvouchers',
						'read:packages',
						'create:packages',
						'modify:packages',
						'read:packagetemplates',
						'read:addons',
						'create:addons',
						'modify:addons',
						'read:users',
						'create:users',
						'modify:users',
						'modify:sites',
						'create:sites',
						'read:clients',
						'read:games',
						'create:games',
						'modify:games',
						'read:attractions',
						'create:attractions',
						'modify:attractions',
						'read:notifications',
						'read:gamespaces',
						'read:reports',
						'read:brazerequest',
					],
				}),
				method: 'POST',
			},
		);
		if (!response.ok) {
			customLog(
				`Failed to refresh access token: ${response.status} ${response.statusText}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			const data = (await response.json()) as {
				AccessToken: string;
				RefreshToken: string;
			};

            const setCookie = response.headers.get("set-cookie");

            if (setCookie) {
                ZLCookie = setCookie
                    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
                    .map(c => c.split(";")[0].trim())
                    .filter(c => 
                        c.startsWith("ARRAffinity=") ||
                        c.startsWith("ARRAffinitySameSite=")
                    )
                    .join("; ");
                console.log(ZLCookie);
            }

			ZLRefreshToken = data.RefreshToken;
			ZLAuthToken = data.AccessToken;
			customLog(`ZL API access token refreshed successfully`, 'INFO');
			return data.AccessToken;
		}
	}
	customLog(
		`Failed to refresh access token after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}
