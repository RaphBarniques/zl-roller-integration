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

import { customLog } from './logger.ts';

export let ZLAuthToken: string | null = null;
let ZLRefreshToken: string | null = null;
let logMessage: string = 'Initializing ZL API authentication...\n';

export async function getToken() {
	const retryMax = 3;
	const delay = 1000;
	for (let attempt = 1; attempt <= retryMax; attempt++) {
		// const response = await fetch(`${config.zl.api_base_url}/auth/user/token`, {
		// 	method: 'POST',
		// 	headers: {
		// 		'Content-Type': 'application/json',
		// 	},
		// 	body: JSON.stringify({
		// 		clientId: Bun.env.ZL_USERNAME,
		// 		clientSecret: Bun.env.ZL_PASSWORD,
		// 		otpCode: null,
		// 		apiKey: 'string',
		// 		scopes: [],
		// 		isTrustedDevice: true,
		// 	}),
		// });

		const response = await fetch(
			'https://api.zerolatencyvr.com/api/v1/auth/user/token',
			{
				credentials: 'include',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0',
					Accept: 'application/json, text/plain, */*',
					'Accept-Language': 'en-US,en;q=0.9',
					'Content-Type': 'application/json',
					'Sec-Fetch-Dest': 'empty',
					'Sec-Fetch-Mode': 'cors',
					'Sec-Fetch-Site': 'same-site',
					Priority: 'u=0',
					Host: 'api.zerolatencyvr.com',
					Origin: 'https://auth.zerolatencyvr.com',
				},
				body: JSON.stringify({
					clientId: Bun.env.ZL_USERNAME,
					clientSecret: Bun.env.ZL_PASSWORD,
					otpCode: null,
					apiKey: 'string',
					scopes: [],
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
			ZLRefreshToken = data.RefreshToken;
			ZLAuthToken = data.AccessToken;
			console.log(responseJson, 'INFO');
			logMessage += 'ZL API refresh token obtained successfully';
			customLog(logMessage, 'INFO');
			return data.AccessToken;
		}
	}
	customLog(`Failed to get token after ${retryMax} attempts`, 'ERROR');
	return null;
	//process.exit(1);
}

export async function refreshToken() {
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
