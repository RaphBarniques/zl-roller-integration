// ZL API AUTHENTICATION FUNCTIONS
//
// Two auth modes, selected via config.zl.auth_mode:
// - "service_account" (recommended): OAuth2 client-credentials grant using
//   ZL_CLIENT_ID / ZL_CLIENT_SECRET against POST /auth/token.
// - "user" (legacy, default when unset): username/password grant against
//   /auth/user/token with refresh via /auth/user/refresh.
//
// Usage: getToken()
// Returns: Access token string or null if failed
// Also stores it and refresh token for next calls

import { jwtDecode } from 'jwt-decode';
import { customLog } from '../utils/logger.ts';
import { config } from '../preflight.ts';

let isFirstRequest = true;
export let ZLAuthToken: string | null = null;
export let ZLCookie: string | null = null;
let ZLRefreshToken: string | null = null;
let ZLTokenExpiresAt: number | null = null;
let logMessage: string = 'Initializing ZL API authentication...\n';

function usesServiceAccount() {
	return config.zl.auth_mode === 'service_account';
}

export async function getToken(): Promise<string> {
	if (usesServiceAccount()) {
		return getServiceAccountToken();
	}

	return getUserToken();
}

// -- Service account (OAuth2 client-credentials) auth --

async function getServiceAccountToken(): Promise<string> {
	const hasValidToken =
		ZLAuthToken !== null &&
		ZLTokenExpiresAt !== null &&
		Date.now() < ZLTokenExpiresAt;

	if (hasValidToken) {
		return ZLAuthToken as string;
	}

	const token = await requestServiceAccountToken();
	return token ?? '';
}

async function requestServiceAccountToken() {
	const retryMax = 3;
	const delay = 1000;
	// Refresh a bit before actual expiry to avoid racing a 401 on in-flight requests.
	const expiryBufferMs = 30_000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(`${config.zl.api_base_url}/auth/token`, {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				grant_type: 'client_credentials',
				client_id: Bun.env.ZL_CLIENT_ID,
				client_secret: Bun.env.ZL_CLIENT_SECRET,
			}),
			method: 'POST',
		});

		if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to get ZL service account token: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'WARN',
			);
			await Bun.sleep(delay);
			continue;
		}

		const data = (await response.json()) as {
			accessToken: string;
			tokenType?: string;
			expiresIn?: number;
		};

		ZLAuthToken = data.accessToken;
		ZLTokenExpiresAt =
			Date.now() + (data.expiresIn ?? 0) * 1000 - expiryBufferMs;
		customLog('ZL API service account token obtained successfully', 'INFO');
		return data.accessToken;
	}

	customLog(
		`Failed to get ZL service account token after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}

// -- Legacy user (username/password) auth --

async function getUserToken(): Promise<string> {
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
