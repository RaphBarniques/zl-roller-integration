//Todo: Implement retry and refresh logic (see ZL API)

import { customLog } from './logger.ts';
import { RollerAuthToken, refreshRollerToken } from './rollerAuth.ts';
import { config } from './preflight.ts';

export async function getCustomerEmail(customerID: string) {
	const retryMax = 3;
	const delay = 1000;
	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(
			`${config.roller.api_base_url}/guests/${customerID}`,
			{
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${RollerAuthToken}`,
				},
				method: 'GET',
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when fetching custumer email for customer ${customerID}, refreshing token and retrying...`,
				'WARN',
			);
			await refreshRollerToken();
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			customLog(
				`Failed to fetch customer email: ${response.status} ${response.statusText}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			const data = (await response.json()) as { email: string; phone: string };
			customLog(
				`Customer email fetched successfully for customer ${customerID}`,
				'INFO',
			);
			return data.email || `${data.phone}@phone.com`;
		}
	}
	customLog(
		`Failed to get customer email for customer ${customerID} after ${retryMax} attempts`,
		'ERROR',
	);
	return 'undefined';
}
