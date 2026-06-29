//Todo: Implement retry and refresh logic (see ZL API)

import { customLog } from '../utils/logger.ts';
import { RollerAuthToken, refreshRollerToken } from './rollerAuth.ts';
import { config } from '../preflight.ts';

function normalizeComments(value: string | null | undefined) {
	return String(value ?? '')
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join('\n');
}

async function getRollerBookingComments(rollerBookingId: string) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(
			`${config.roller.api_base_url}/bookings/${rollerBookingId}`,
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
				`Unauthorized when fetching comments for Roller booking ${rollerBookingId}, refreshing token and retrying...`,
				'WARN',
			);
			await refreshRollerToken();
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to fetch comments for Roller booking ${rollerBookingId}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			const data = (await response.json()) as { comments?: string | null };
			return data.comments ?? '';
		}
	}

	return null;
}

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
	currentComments?: string | null,
) {
	const retryMax = 3;
	const delay = 1000;

	const links = [...new Set(zlBookingIds.map((id) => String(id)))].sort(
		(a, b) => a.localeCompare(b),
	);
	const nextComments = links
		.map(
			(zlBookingId) =>
				`portal.zerolatencyvr.com/${config.zl.site_id}/bookings/${zlBookingId}`,
		)
		.join('\n');

	let sourceComments = currentComments;
	if (sourceComments == null) {
		sourceComments = await getRollerBookingComments(rollerBookingId);
	}

	if (normalizeComments(sourceComments) === normalizeComments(nextComments)) {
		customLog(
			`Skipping Roller booking ${rollerBookingId} comment update: links unchanged`,
			'INFO',
		);
		return true;
	}

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
				body: JSON.stringify({ comments: nextComments }),
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
				`Updated comments for Roller booking ${rollerBookingId} with ${links.length} ZL link(s)`,
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
