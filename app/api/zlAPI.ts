// ZL API USAGE FUNCTIONS
//
// UNTESTED - TO REVIEW
//
// Usage: createZLSession(rollerSessionID, rollerBookingID, email, packageId, bookingDate, slots, price)
// Returns: ZL session ID or null if failed
//
// Usage: deleteZLSession(ZLSessionID, rollerBookingID)
// Returns: true if successful, null if failed

import { customLog } from '../utils/logger.ts';
import { config } from '../preflight.ts';
import { getToken, ZLCookie } from './zlAuth.ts';

export type ZLSessionCreateResult = {
	bookingId: number;
	customerId: string | null;
};

function extractZLCustomerId(data: Record<string, unknown>) {
	const candidate =
		(data.CustomerGuid as string | undefined) ??
		((data.Customer as Record<string, unknown> | undefined)?.CustomerGuid as
			| string
			| undefined) ??
		((data.Customer as Record<string, unknown> | undefined)?.CustomerId as
			| string
			| undefined) ??
		((data.Product as Record<string, unknown> | undefined)?.CustomerGuid as
			| string
			| undefined) ??
		((data.Product as Record<string, unknown> | undefined)?.CustomerId as
			| string
			| undefined) ??
		((data.Booking as Record<string, unknown> | undefined)?.CustomerGuid as
			| string
			| undefined) ??
		((data.Booking as Record<string, unknown> | undefined)?.CustomerId as
			| string
			| undefined);

	return candidate ? String(candidate) : null;
}

async function buildZLHeaders() {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${await getToken()}`,
	};

	if (ZLCookie) {
		headers.Cookie = ZLCookie;
	}

	return headers;
}

export async function getSession() {
	const result = await fetch(
		'https://api.zerolatencyvr.com/api/v1/sites/71/session/2428512',
		{
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${await getToken()}`,
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
	overrideGameSpace: number,
	isPrivate: boolean,
): Promise<ZLSessionCreateResult | null> {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();
		const body = {
			accessCode: null,
			emailAddress: email,
			packageId: packageId,
			sessionName: null,
			slots: slots,
			userId: null,
			paymentMethodTypeId: 5,
			overridePrice: price,
			overrideOpenTime: true,
			overrideStartTime: bookingDate,
			overrideGameSpace: overrideGameSpace,
			overrideMaxPlayers: true,
			overrideFreeBookingLimit: true,
			discountCode: null,
			adBlockEnabled: null,
			isPrivate: isPrivate,
			privateEventTypeId: isPrivate ? 3 : null,
			priceCode: null,
			sessionId: null,
			externalBookingId: rollerBookingID,
			bookingSystemId: null,
			payInFull: true,
			rewardFlowData: null,
		};
		const response = await fetch(
			`${config.zl.api_base_url}/sites/${config.zl.site_id}/bookings`,
			{
				method: 'POST',
				headers: headers,
				body: JSON.stringify(body),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when creating ZL session for Roller booking ${rollerBookingID}, refreshing token and retrying...`,
				'WARN',
			);
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to create ZL session: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			const data = (await response.json()) as {
				Product: {
					BookingId: number;
					AmountDue: number;
					CreatedDateTime: string;
				};
				Charge: {
					Tax: number;
				};
			} & Record<string, unknown>;
			customLog(
				`ZL session created successfully for Roller booking ${rollerBookingID} with ZL session ID: ${data.Product.BookingId}`,
				'INFO',
			);

			await confirmZLSession(
				Number(rollerBookingID),
				Number(rollerSessionID),
				data.Product.BookingId,
				data.Product.AmountDue,
				data.Charge.Tax,
				data.Product.CreatedDateTime,
				email,
			);
			return {
				bookingId: data.Product.BookingId,
				customerId: extractZLCustomerId(data),
			};
		}
	}
	customLog(
		`Failed to create ZL session for Roller booking ${rollerBookingID} after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}

export async function updateZLCustomerProfile(
	zlCustomerId: string,
	firstName: string,
	lastName: string,
	phoneNumber?: string | null,
) {
	const retryMax = 3;
	const delay = 1000;
	const modifiedByUserId = Number(Bun.env.ZL_USER_ID || 0);

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();
		const body: {
			firstName: string;
			lastName: string;
			modifiedByUserId?: number;
			phoneNumber?: string;
		} = {
			firstName,
			lastName,
		};

		if (modifiedByUserId > 0) {
			body.modifiedByUserId = modifiedByUserId;
		}

		if (phoneNumber && phoneNumber.trim().length > 0) {
			body.phoneNumber = phoneNumber.trim();
		}

		const response = await fetch(
			`${config.zl.api_base_url}/customers/${zlCustomerId}`,
			{
				method: 'PATCH',
				headers,
				body: JSON.stringify(body),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when updating ZL customer ${zlCustomerId}, refreshing token and retrying...`,
				'WARN',
			);
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to update ZL customer ${zlCustomerId}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			customLog(`ZL customer ${zlCustomerId} updated successfully`, 'INFO');
			return true;
		}
	}

	customLog(
		`Failed to update ZL customer ${zlCustomerId} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}

export async function confirmZLSession(
	rollerBookingID: number,
	_rollerSessionID: number,
	zlBookingID: number,
	amount: number,
	tax: number,
	dateCreated: string,
	email: string,
) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();
		const body = {
			Amount: amount,
			Fee: 0,
			GiftVoucherAmount: null,
			CurrencyCode: 'CAD',
			DateCreated: dateCreated,
			PaymentMethodReference: 'Cash',
			PaymentMethodTypeId: 5,
			SiteId: 71,
			Tax: tax,
			UserId: null,
			EmailAddress: email,
			PhoneNumber: null,
			FullName: null,
			Postcode: null,
		};
		const response = await fetch(
			`${config.zl.api_base_url}/sites/${config.zl.site_id}/bookings/${zlBookingID}/confirm`,
			{
				method: 'PATCH',
				headers: headers,
				body: JSON.stringify(body),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when confirming ZL session for Roller booking ${rollerBookingID}, refreshing token and retrying...`,
				'WARN',
			);
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to confirm ZL session: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			setTimeout(() => {}, delay);
		} else {
			customLog(
				`ZL session confirmed successfully for Roller booking ${rollerBookingID} with ZL session ID: ${zlBookingID}`,
				'INFO',
			);
			return;
		}
	}
	customLog(
		`Failed to confirm ZL session for Roller booking ${rollerBookingID} after ${retryMax} attempts`,
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
		const headers = await buildZLHeaders();
		const response = await fetch(
			`${config.zl.api_base_url}/sites/${config.zl.site_id}/bookings/${ZLSessionID}/cancel`,
			{
				method: 'PATCH',
				headers: headers,
				body: JSON.stringify({}),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when cancelling ZL session ${ZLSessionID} for Roller booking ${rollerBookingID}, refreshing token and retrying...`,
				'WARN',
			);
			setTimeout(() => {}, delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to cancel ZL session ${ZLSessionID} for Roller booking ${rollerBookingID}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
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
