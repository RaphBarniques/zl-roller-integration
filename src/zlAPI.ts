// ZL API USAGE FUNCTIONS
//
// UNTESTED - TO REVIEW
//
// Usage: createZLSession(rollerSessionID, rollerBookingID, email, packageId, bookingDate, slots, price)
// Returns: ZL session ID or null if failed
//
// Usage: deleteZLSession(ZLSessionID, rollerBookingID)
// Returns: true if successful, null if failed

import { config } from './preflight.ts';
import { customLog } from './logger.ts';
import { refreshZLToken, ZLAuthToken } from './zlAuth.ts';
import { sendEmail } from './sendMail.ts';

export async function getSession() {
	await refreshZLToken();

	const result = await fetch(
		'https://api.zerolatencyvr.com/api/v1/sites/71/session/2428512',
		{
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ZLAuthToken}`,
			},
		},
	);

	console.log(result.status);
}

export async function createZLSession(
	rollerSessionID: string,
	rollerBookingID: string,
	email: string,
	packageId: number,
	bookingDate: string,
	slots: number,
	price: number,
) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(
			`${config.zl.api_base_url}/sites/${Bun.env.ZL_SITE_ID}/bookings`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${ZLAuthToken}`,
				},
				body: JSON.stringify({
					sessionID: rollerSessionID,
					externalBookingID: rollerBookingID,
					emailAddress: email,
					packageId: packageId,
					bookingDate: bookingDate,
					slots: slots,
					overridePrice: price,
				}),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when creating ZL session for Roller booking ${rollerBookingID}, refreshing token and retrying...`,
				'WARN',
			);
			await refreshZLToken();
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			customLog(
				`Failed to create ZL session: ${response.status} ${response.statusText}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			const data = (await response.json()) as { sessionId: string };
			customLog(
				`ZL session created successfully for Roller booking ${rollerBookingID} with ZL session ID: ${data.sessionId}`,
				'INFO',
			);
			return data.sessionId;
		}
	}
	customLog(
		`Failed to create ZL session for Roller booking ${rollerBookingID} after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}

export async function deleteZLSession(
	ZLSessionID: string,
	rollerBookingID: string,
) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const response = await fetch(
			`${config.zl.api_base_url}/sites/${Bun.env.ZL_SITE_ID}/bookings/${ZLSessionID}/cancel`,
			{
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${ZLAuthToken}`,
				},
				body: JSON.stringify({}),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when cancelling ZL session ${ZLSessionID} for Roller booking ${rollerBookingID}, refreshing token and retrying...`,
				'WARN',
			);
			await refreshZLToken();
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			customLog(
				`Failed to cancel ZL session ${ZLSessionID} for Roller booking ${rollerBookingID}: ${response.status} ${response.statusText}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			customLog(
				`ZL session ${ZLSessionID} cancelled successfully for Roller booking ${rollerBookingID}`,
				'INFO',
			);
			return true;
		}
	}
	customLog(
		`Failed to cancel ZL session ${ZLSessionID} for Roller booking ${rollerBookingID} after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}
