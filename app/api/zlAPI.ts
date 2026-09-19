// ZL API USAGE FUNCTIONS
//
// UNTESTED - TO REVIEW
//
// Usage: createZLSession(rollerSessionID, rollerBookingID, email, packageId, bookingDate, slots, price)
// Returns: ZL session ID or null if failed
//
// Usage: deleteZLSession(ZLSessionID, rollerBookingID)
// Returns: true if successful, null if failed

import { config } from '../preflight.ts';
import { customLog } from '../utils/logger.ts';
import { getToken, ZLCookie } from './zlAuth.ts';

export type ZLSessionCreateResult = {
	bookingId: number;
	customerId: string | null;
	needsJustification: boolean;
};

export type ZLPlayerProfile = {
	PlayerGuid: string;
	PlayerId?: number;
	Email?: string | null;
	PhoneNumber?: string | null;
	Postcode?: string | null;
	FirstName?: string | null;
	LastName?: string | null;
	DisplayName?: string | null;
	FullName?: string | null;
	Gender?: string | null;
	Language?: string | null;
	DateOfBirth?: string | null;
	LeftHanded?: boolean | null;
	KnownPlayer?: boolean | null;
	FallbackName?: string | null;
};

export type ZLBookingSlot = {
	BookingSlotId: number;
	PlayerGuid?: string | null;
	HasSignedWaiver?: boolean;
	Player?: ZLPlayerProfile | null;
};

export type ZLBooking = {
	BookingId: number;
	InitialSlotCount?: number;
	BookingSlots?: ZLBookingSlot[] | null;
	Player?: ZLPlayerProfile | null;
	Customer?: {
		Email?: string | null;
		FirstName?: string | null;
		LastName?: string | null;
	} | null;
	StartTime?: string;
	PackageId?: number;
	SessionId?: number;
	Price?: number;
	EmailTasks?: unknown;
	BookingStatusTypeId?: number;
	AccessCode?: string | null;
	SignInUrl?: string | null;
	PlayerGuid?: string | null;
	CustomerGuid?: string | null;
	IsPrivate?: boolean;
	CreatedDateTime?: string;
	ModifiedDateTime?: string;
	LastModified?: string;
	BookingNotes?: string | null;
	Paid?: number;
};

export type ZLSiteSession = {
	SessionId: number;
	StartTime: string;
	EndTime?: string;
	Duration?: number;
	MaximumSlots?: number;
	RemainingSlots?: number;
	BookedSlots?: number;
	Package?: {
		Alias?: string | null;
		HeaderImage?: string | null;
		LanguageData?: Array<{
			ImageUrl?: string | null;
			Name?: string | null;
			Locale?: string | null;
		}> | null;
	} | null;
	Bookings?: ZLBooking[] | null;
	GameSpace?: {
		Name?: string | null;
	} | null;
	IsHidden?: boolean;
};

export type ZLSessionSignInPayload = {
	GameSpaceId: number;
	StartTime: string;
	BookingId: number;
	BookingSlotId: number | null;
	HasSignedWaiver: boolean;
	SignedWaiverDateTime?: string | null;
	IsAbsent: boolean;
	LanguageTypeId: number;
	PlayerGuid: string | null;
	EmailAddress: string;
	DisplayName: string | null;
	FirstName: string | null;
	LastName: string | null;
	PhoneNumber: string | null;
	Postcode: string | null;
	Height: number | null;
	LeftHanded: boolean;
	Gender: string | null;
	DateOfBirth: string | null;
	SessionTimes: unknown;
	SuggestedTeamName: string | null;
	CreateNew: boolean;
	SubscribeEmail: boolean;
	SubscribeSms: boolean;
	CountryCode: string | null;
};

// underchargeStatusId > 0 means ZL flagged the booking as needing a price justification.
function extractNeedsJustification(data: Record<string, unknown>) {
	const candidate =
		data.underchargeStatusId ??
		(data.Product as Record<string, unknown> | undefined)?.underchargeStatusId ??
		(data.Booking as Record<string, unknown> | undefined)?.underchargeStatusId ??
		(data.Charge as Record<string, unknown> | undefined)?.underchargeStatusId;

	return Number(candidate) > 0;
}

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

function toFiniteNumber(value: unknown, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIsoTimestamp(value: unknown) {
	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) {
			return new Date(parsed).toISOString();
		}
	}

	return new Date().toISOString();
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
			paymentMethodTypeId: 15,
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
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to create ZL session: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			const data = (await response.json()) as {
				Product?: {
					BookingId?: number;
					AmountDue?: number;
					CreatedDateTime?: string;
				};
				Charge?: {
					Tax?: number;
				};
			} & Record<string, unknown>;
			const bookingId = data.Product?.BookingId;
			if (!bookingId) {
				customLog(
					`Failed to create ZL session for Roller booking ${rollerBookingID}: missing Product.BookingId in response.`,
					'ERROR',
				);
				await Bun.sleep(delay);
				continue;
			}

			const amountDue = toFiniteNumber(data.Product?.AmountDue, price);
			const taxAmount = toFiniteNumber(data.Charge?.Tax, 0);
			const createdAt = normalizeIsoTimestamp(data.Product?.CreatedDateTime);

			customLog(
				`ZL session created successfully for Roller booking ${rollerBookingID} with ZL session ID: ${bookingId}`,
				'INFO',
			);

			const confirmNeedsJustification = await confirmZLSession(
				Number(rollerBookingID),
				Number(rollerSessionID),
				bookingId,
				amountDue,
				taxAmount,
				createdAt,
				email,
			);
			return {
				bookingId,
				customerId: extractZLCustomerId(data),
				needsJustification:
					extractNeedsJustification(data) || Boolean(confirmNeedsJustification),
			};
		}
	}
	customLog(
		`Failed to create ZL session for Roller booking ${rollerBookingID} after ${retryMax} attempts`,
		'ERROR',
	);
	return null;
}

export async function getGameResults(fromDate: string, toDate: string) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();

		const response = await fetch(
			`${config.zl.api_base_url}/sites/${config.zl.site_id}/game-results?fromDateTime=${encodeURIComponent(fromDate)}&toDateTime=${encodeURIComponent(toDate)}`,
			{
				method: 'GET',
				headers,
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when fetching game results from ${fromDate} to ${toDate}, refreshing token and retrying...`,
				'WARN',
			);
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to fetch game results from ${fromDate} to ${toDate}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			customLog(
				`Successfully fetched game results from ${fromDate} to ${toDate}`,
				'INFO',
			);
			return response.json();
		}
	}

	customLog(
		`Failed to fetch game results from ${fromDate} to ${toDate} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}

export async function getGameResult(gameResultID: string) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();

		const response = await fetch(
			`${config.zl.api_base_url}/game-results/${encodeURIComponent(gameResultID)}`,
			{
				method: 'GET',
				headers,
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when fetching game result ${gameResultID}, refreshing token and retrying...`,
				'WARN',
			);
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to fetch game result ${gameResultID}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			customLog(`Successfully fetched game result ${gameResultID}`, 'INFO');
			return response.json();
		}
	}

	customLog(
		`Failed to fetch game result ${gameResultID} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}

export async function getPlayerInfo(playerGUID: string) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();

		const response = await fetch(
			`${config.zl.api_base_url}/players/${encodeURIComponent(playerGUID)}`,
			{
				method: 'GET',
				headers,
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when fetching player info ${playerGUID}, refreshing token and retrying...`,
				'WARN',
			);
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to fetch player info ${playerGUID}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			customLog(`Successfully fetched player info ${playerGUID}`, 'INFO');
			return response.json();
		}
	}

	customLog(
		`Failed to fetch player info ${playerGUID} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}

export async function getSiteSessionsForDate(date: string) {
	const retryMax = 3;
	const delay = 1000;

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();

		const response = await fetch(
			`${config.zl.api_base_url}/sites/${config.zl.site_id}/sessions/${encodeURIComponent(date)}`,
			{
				method: 'GET',
				headers,
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when fetching site sessions for ${date}, refreshing token and retrying...`,
				'WARN',
			);
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to fetch site sessions for ${date}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			customLog(`Successfully fetched site sessions for ${date}`, 'INFO');
			return (await response.json()) as ZLSiteSession[];
		}
	}

	customLog(
		`Failed to fetch site sessions for ${date} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}

export async function searchPlayersByEmail(email: string) {
	const retryMax = 3;
	const delay = 1000;
	const normalizedEmail = email.trim().toLowerCase();

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();

		const response = await fetch(
			`${config.zl.api_base_url}/players?searchTerm=${encodeURIComponent(normalizedEmail)}`,
			{
				method: 'GET',
				headers,
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when searching players for ${normalizedEmail}, refreshing token and retrying...`,
				'WARN',
			);
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to search players for ${normalizedEmail}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			const data = (await response.json()) as ZLPlayerProfile[];
			customLog(`Successfully searched players for ${normalizedEmail}`, 'INFO');
			return data.filter(
				(player) => player.Email?.trim().toLowerCase() === normalizedEmail,
			);
		}
	}

	customLog(
		`Failed to search players for ${normalizedEmail} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
}

export async function signInPlayerToSession(payload: ZLSessionSignInPayload) {
	const retryMax = 3;
	const delay = 1000;

	customLog(
		`ZL sign-in payload: booking=${payload.BookingId}, slot=${payload.BookingSlotId ?? 'null'}, playerGuid=${payload.PlayerGuid ?? 'null'}, hasSignedWaiver=${String(payload.HasSignedWaiver)}, signedWaiverDateTime=${payload.SignedWaiverDateTime ?? 'null'}, subscribeEmail=${String(payload.SubscribeEmail)}, subscribeSms=${String(payload.SubscribeSms)}`,
		'INFO',
	);

	for (let attempt = 1; attempt <= retryMax; attempt++) {
		const headers = await buildZLHeaders();

		const response = await fetch(
			`${config.zl.api_base_url}/sites/${config.zl.site_id}/session/signin`,
			{
				method: 'POST',
				headers,
				body: JSON.stringify(payload),
			},
		);

		if (!response.ok && response.status === 401) {
			customLog(
				`Unauthorized when signing player into booking ${payload.BookingId}, refreshing token and retrying...`,
				'WARN',
			);
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to sign player into booking ${payload.BookingId}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			const rawBody = await response.text();
			customLog(
				`Successfully signed player into booking ${payload.BookingId}`,
				'INFO',
			);
			customLog(
				`ZL sign-in response for booking ${payload.BookingId}: ${rawBody || 'No response body'}`,
				'INFO',
			);

			try {
				return JSON.parse(rawBody) as Record<string, unknown>;
			} catch {
				return { rawBody };
			}
		}
	}

	customLog(
		`Failed to sign player into booking ${payload.BookingId} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
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
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to update ZL customer ${zlCustomerId}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
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
			DateCreated: normalizeIsoTimestamp(dateCreated),
			PaymentMethodReference: 'Cash',
			PaymentMethodTypeId: 15,
			SiteId: Number(config.zl.site_id),
			Tax: tax,
			EmailAddress: email,
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
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to confirm ZL session: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
		} else {
			customLog(
				`ZL session confirmed successfully for Roller booking ${rollerBookingID} with ZL session ID: ${zlBookingID}`,
				'INFO',
			);
			const data = (await response.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			return extractNeedsJustification(data);
		}
	}
	customLog(
		`Failed to confirm ZL session for Roller booking ${rollerBookingID} after ${retryMax} attempts`,
		'ERROR',
	);
	return false;
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
			await Bun.sleep(delay);
		} else if (!response.ok) {
			const text = await response.text();
			customLog(
				`Failed to cancel ZL session ${ZLSessionID} for Roller booking ${rollerBookingID}: ${response.status} ${response.statusText}. ${text || 'No response body'}`,
				'ERROR',
			);
			await Bun.sleep(delay);
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
