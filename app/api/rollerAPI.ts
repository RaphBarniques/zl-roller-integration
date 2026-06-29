//Todo: Implement retry and refresh logic (see ZL API)

import { customLog } from '../utils/logger.ts';
import { RollerAuthToken, refreshRollerToken } from './rollerAuth.ts';
import { config } from '../preflight.ts';

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

export async function updateRollerBookingComments(
	rollerBookingId: string,
	zlBookingIds: Array<string | number>,
) {
	const retryMax = 3;
	const delay = 1000;
	const comments = zlBookingIds
		.map(
			(zlBookingId) =>
				`portal.zerolatencyvr.com/${config.zl.site_id}/bookings/${zlBookingId}`,
		)
		.join('\n');

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(
			`${config.roller.api_base_url}/bookings/${rollerBookingId}`,
			{
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Authorization: `Bearer ${RollerAuthToken}`,
				},
				method: 'PUT',
				body: JSON.stringify({ comments }),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when updating comments for Roller booking ${rollerBookingId}, refreshing token and retrying...`,
				'WARN',
			);
			await refreshRollerToken();
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to update comments for Roller booking ${rollerBookingId}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			customLog(
				`Updated comments for Roller booking ${rollerBookingId} with ${zlBookingIds.length} ZL link(s)`,
				'INFO',
			);
			return true;
		}
	}

	customLog(
		`Failed to update comments for Roller booking ${rollerBookingId} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}
