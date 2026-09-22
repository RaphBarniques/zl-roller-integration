import QRCode from 'qrcode';
import { config, db } from '../preflight.ts';
import {
	getAppSettingValue,
	getKioskSignInRecordByPlayerGuid,
	saveKioskSignInRecord,
	setAppSettingValue,
} from '../utils/db.ts';
import { customLog } from '../utils/logger.ts';
import { getKioskIdFromRequest, kioskSessionCookie } from './kioskAuth.ts';
import {
	getBookingById,
	getSiteSessionsForDate,
	searchPlayersByEmail,
	signInPlayerToSession,
	type ZLBooking,
	type ZLPlayerProfile,
	type ZLSiteSession,
} from './zlAPI.ts';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_ROTATE_MS = 45 * 60 * 1000;
const PAIRING_CODE_TTL_MS = 60 * 60 * 1000;

type KioskDeviceRow = {
	id: string;
	label: string | null;
	paired_at: string | null;
	created_at: string;
	updated_at: string;
};

type KioskPairingCodeRow = {
	code: string;
	expires_at: string;
	used_at: string | null;
	created_at: string;
};

type KioskTokenRow = {
	token: string;
	kiosk_id: string;
	issued_at: string;
	refresh_at: string;
	expires_at: string;
	revoked_at: string | null;
	created_at: string;
};

type KioskGuestAccess =
	| { kind: 'kiosk'; kioskId: string }
	| { kind: 'session'; sessionId: number; bookingId: number; date: string };

type KioskDashboardRow = {
	id: string;
	label: string | null;
	paired_at: string | null;
	created_at: string;
	updated_at: string;
};

type KioskSignInBookingSummary = {
	bookingId: number;
	leadName: string;
	playerCount: number;
	occupiedCount: number;
	openSlots: number;
	signedAliases: string[];
	email: string | null;
};

type KioskSignInSessionSummary = {
	sessionId: number;
	gameSpaceId: number;
	startTime: string;
	durationMinutes: number;
	packageName: string;
	imageUrl: string | null;
	bookingSummary: string;
	gameSpaceName: string | null;
	bookings: KioskSignInBookingSummary[];
};

type SignInFieldMode = 'hidden' | 'optional' | 'required';

type CustomSignInField = {
	key: string;
	label: string;
	mode: Exclude<SignInFieldMode, 'hidden'>;
};

type SignInConfig = {
	waiverText: string;
	defaultCountryCode: string;
	attractions: string[];
	customFields: CustomSignInField[];
	fields: {
		phoneNumber: SignInFieldMode;
		postcode: SignInFieldMode;
		dateOfBirth: SignInFieldMode;
		gender: SignInFieldMode;
	};
};

const SIGN_IN_CONFIG_KEY = 'kiosk_sign_in_config';
const DEFAULT_COUNTRY_CODE = '+1';
const DEFAULT_WAIVER_TEXT = `I acknowledge that virtual reality activities may involve physical movement,
risk of minor injury, and exposure to flashing imagery. I confirm that I am
fit to participate and will follow all staff instructions.

I release the venue and its staff from liability for injuries caused by misuse,
failure to follow directions, or pre-existing medical conditions not disclosed.

If participant is under legal age, a guardian consent is required according to
local regulations.`;

const DEFAULT_SIGN_IN_CONFIG: SignInConfig = {
	waiverText: DEFAULT_WAIVER_TEXT,
	defaultCountryCode: DEFAULT_COUNTRY_CODE,
	attractions: [],
	customFields: [],
	fields: {
		phoneNumber: 'required',
		postcode: 'optional',
		dateOfBirth: 'optional',
		gender: 'required',
	},
};

const PACKAGE_IMAGE_FALLBACKS = [
	{
		match: 'far cry vr + outbreak',
		url: 'https://zerolatencyvr.azureedge.net/booking-engine/packages/farcryvr-outbreak.jpg',
	},
	{
		match: 'haunted + undead arena',
		url: 'https://zerolatencyvr.azureedge.net/booking-engine/packages/haunted-undeadarena.jpg',
	},
	{
		match: 'far cry vr',
		url: 'https://zerolatencyvr.azureedge.net/booking-engine/packages/farcryvr.jpg',
	},
];

const LOCAL_PACKAGE_IMAGE_PREFIX = 'package_poster_';
const LOCAL_PACKAGE_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const packageImageDownloads = new Map<string, Promise<string | null>>();

function getIsoTimestampAt(ms: number) {
	return new Date(ms).toISOString();
}

function isExpired(value: string) {
	return Date.now() >= Date.parse(value);
}

function randomCode(length = 8) {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let value = '';
	for (let index = 0; index < length; index += 1) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

function kioskSignInUrl(origin: string, token: string) {
	return `${origin}/kiosk/sign-in?token=${encodeURIComponent(token)}`;
}

function normalizePackageSlug(value: string) {
	const slug = value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'unknown-package';
}

function extensionFromContentType(contentType: string | null) {
	if (!contentType) return null;
	const normalized = contentType.toLowerCase();
	if (normalized.includes('image/jpeg')) return '.jpg';
	if (normalized.includes('image/png')) return '.png';
	if (normalized.includes('image/webp')) return '.webp';
	return null;
}

function extensionFromImageUrl(imageUrl: string) {
	try {
		const url = new URL(imageUrl);
		const pathname = url.pathname.toLowerCase();
		for (const extension of LOCAL_PACKAGE_IMAGE_EXTENSIONS) {
			if (pathname.endsWith(extension)) {
				return extension;
			}
		}
	} catch {
		// Ignore parse errors and fall back to jpg.
	}

	return '.jpg';
}

async function getLocalPackageImageUrl(
	packageName: string,
	remoteImageUrl: string | null,
) {
	if (!remoteImageUrl) {
		return null;
	}

	const slug = normalizePackageSlug(packageName);
	for (const extension of LOCAL_PACKAGE_IMAGE_EXTENSIONS) {
		const existingFilename = `${LOCAL_PACKAGE_IMAGE_PREFIX}${slug}${extension}`;
		const existingFile = Bun.file(`./app/public/assets/${existingFilename}`);
		if (await existingFile.exists()) {
			return `/assets/${existingFilename}`;
		}
	}

	const downloadKey = `${slug}:${remoteImageUrl}`;
	const existingDownload = packageImageDownloads.get(downloadKey);
	if (existingDownload) {
		return await existingDownload;
	}

	const downloadPromise = (async () => {
		try {
			const response = await fetch(remoteImageUrl);
			if (!response.ok) {
				return remoteImageUrl;
			}

			const contentType = response.headers.get('content-type');
			const extension =
				extensionFromContentType(contentType) ||
				extensionFromImageUrl(remoteImageUrl);
			const filename = `${LOCAL_PACKAGE_IMAGE_PREFIX}${slug}${extension}`;
			const buffer = await response.arrayBuffer();
			await Bun.write(`./app/public/assets/${filename}`, buffer);
			return `/assets/${filename}`;
		} catch {
			return remoteImageUrl;
		} finally {
			packageImageDownloads.delete(downloadKey);
		}
	})();

	packageImageDownloads.set(downloadKey, downloadPromise);
	return await downloadPromise;
}

function normalizeFieldMode(value: unknown): SignInFieldMode {
	return value === 'hidden' || value === 'required' ? value : 'optional';
}

function normalizeCountryCode(value: unknown) {
	const normalized = String(value ?? '').trim();
	return /^\+\d{1,4}$/.test(normalized) ? normalized : DEFAULT_COUNTRY_CODE;
}

function normalizeCustomFields(value: unknown): CustomSignInField[] {
	if (!Array.isArray(value)) return [];

	const fields: CustomSignInField[] = [];
	const keys = new Set<string>();
	for (const item of value.slice(0, 12)) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const raw = item as Record<string, unknown>;
		const key = String(raw.key ?? '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40);
		const label = String(raw.label ?? '').trim().slice(0, 80);
		if (!key || !label || keys.has(key)) continue;
		keys.add(key);
		fields.push({
			key,
			label,
			mode: raw.mode === 'required' ? 'required' : 'optional',
		});
	}
	return fields;
}

function normalizeKioskAttractions(value: unknown) {
	const available = new Set(
		config.venue.attractions.map((attraction) => attraction.name),
	);
	if (!Array.isArray(value)) return [...available];

	const selected = value.filter(
		(item): item is string => typeof item === 'string' && available.has(item),
	);
	return selected.length > 0 ? [...new Set(selected)] : [...available];
}

function normalizeSignInConfig(value: unknown): SignInConfig {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return DEFAULT_SIGN_IN_CONFIG;
	}

	const raw = value as Record<string, unknown>;
	const rawFields =
		typeof raw.fields === 'object' && raw.fields && !Array.isArray(raw.fields)
			? (raw.fields as Record<string, unknown>)
			: {};

	return {
		waiverText:
			typeof raw.waiverText === 'string' && raw.waiverText.trim().length > 0
				? raw.waiverText
				: DEFAULT_SIGN_IN_CONFIG.waiverText,
		defaultCountryCode: normalizeCountryCode(raw.defaultCountryCode),
		attractions: normalizeKioskAttractions(raw.attractions),
		customFields: normalizeCustomFields(raw.customFields),
		fields: {
			phoneNumber: normalizeFieldMode(rawFields.phoneNumber),
			postcode: normalizeFieldMode(rawFields.postcode),
			dateOfBirth: normalizeFieldMode(rawFields.dateOfBirth),
			gender: normalizeFieldMode(rawFields.gender),
		},
	};
}

async function getSignInConfig() {
	const raw = await getAppSettingValue(SIGN_IN_CONFIG_KEY);
	if (!raw) {
		return normalizeSignInConfig(DEFAULT_SIGN_IN_CONFIG);
	}

	try {
		return normalizeSignInConfig(JSON.parse(raw));
	} catch {
		return normalizeSignInConfig(DEFAULT_SIGN_IN_CONFIG);
	}
}

async function saveSignInConfig(configValue: SignInConfig) {
	await setAppSettingValue(SIGN_IN_CONFIG_KEY, JSON.stringify(configValue));
}

function getVenueDateStamp() {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone: config.venue.timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	const parts = formatter.formatToParts(new Date());
	const values: Record<string, string> = {};

	for (const part of parts) {
		if (part.type !== 'literal') {
			values[part.type] = part.value;
		}
	}

	return `${values.year}-${values.month}-${values.day}`;
}

function normalizeVenueDateStamp(value: unknown) {
	const normalized = String(value ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
		return null;
	}

	return normalized;
}

function getRequestedSessionDateStamp(req: Request) {
	const dateParam = new URL(req.url).searchParams.get('date');
	return normalizeVenueDateStamp(dateParam) || getVenueDateStamp();
}

function getRequestedSubmitDateStamp(body: Record<string, unknown> | null) {
	return normalizeVenueDateStamp(body?.date) || getVenueDateStamp();
}

async function requireKioskGuestToken(req: Request) {
	const access = await resolveKioskGuestAccess(req);

	if (!access) {
		return {
			error: Response.json(
				{
					error:
						'Kiosk sign-in link is invalid, expired, or missing required parameters.',
				},
				{ status: 410 },
			),
			access: null,
		};
	}

	return {
		error: null,
		access,
	};
}

function formatDisplayName(profile: ZLPlayerProfile | null | undefined) {
	if (!profile) return null;

	const displayName =
		profile.DisplayName ||
		profile.FallbackName ||
		profile.FullName ||
		[profile.FirstName, profile.LastName].filter(Boolean).join(' ').trim();

	return displayName?.trim() || null;
}

function formatLeadName(
	profile: ZLPlayerProfile | null | undefined,
	booking: ZLBooking,
) {
	const firstName =
		profile?.FirstName?.trim() || booking.Customer?.FirstName?.trim();
	const lastName =
		profile?.LastName?.trim() || booking.Customer?.LastName?.trim();

	if (firstName && lastName) {
		return `${firstName.charAt(0).toUpperCase()}. ${lastName}`;
	}

	if (lastName) {
		return lastName;
	}

	if (firstName) {
		return `${firstName.charAt(0).toUpperCase()}.`;
	}

	return formatDisplayName(profile) || 'Guest';
}

function getSignedAliases(booking: ZLBooking) {
	const aliases = (booking.BookingSlots || [])
		.map((slot) => formatDisplayName(slot.Player))
		.filter((value): value is string => Boolean(value));

	return [...new Set(aliases)];
}

function getPrimaryImageUrl(session: ZLSiteSession) {
	const headerImage = session.Package?.HeaderImage?.trim();
	if (headerImage) {
		return headerImage;
	}

	for (const item of session.Package?.LanguageData || []) {
		const imageUrl = item.ImageUrl?.trim();
		if (imageUrl) {
			return imageUrl;
		}
	}

	const packageAlias = session.Package?.Alias?.trim().toLowerCase() || '';
	const fallback = PACKAGE_IMAGE_FALLBACKS.find((entry) =>
		packageAlias.includes(entry.match),
	);
	if (fallback) {
		return fallback.url;
	}

	return null;
}

function summarizeSessionBookings(bookings: KioskSignInBookingSummary[]) {
	const names = [
		...new Set(bookings.map((booking) => booking.leadName).filter(Boolean)),
	];
	if (names.length === 0) {
		return 'No bookings';
	}

	const visible = names.slice(0, 2).join(', ');
	const remaining = names.length - 2;
	return remaining > 0 ? `${visible} + ${remaining} more` : visible;
}

function mapBookingSummary(booking: ZLBooking): KioskSignInBookingSummary {
	const bookingSlots = booking.BookingSlots || [];
	const playerCount = Math.max(
		booking.InitialSlotCount || 0,
		bookingSlots.length,
	);
	const occupiedCount = bookingSlots.filter((slot) =>
		Boolean(slot.PlayerGuid),
	).length;
	const openSlots = Math.max(0, playerCount - occupiedCount);

	return {
		bookingId: booking.BookingId,
		leadName: formatLeadName(booking.Player, booking),
		playerCount,
		occupiedCount,
		openSlots,
		signedAliases: getSignedAliases(booking),
		email: booking.Player?.Email || booking.Customer?.Email || null,
	};
}

function mapSessionSummary(session: ZLSiteSession): KioskSignInSessionSummary {
	const bookings = (session.Bookings || []).map(mapBookingSummary);

	return {
		sessionId: session.SessionId,
		gameSpaceId: session.GameSpaceId,
		startTime: session.StartTime,
		durationMinutes: session.Duration || 0,
		packageName: session.Package?.Alias?.trim() || 'Experience',
		imageUrl: getPrimaryImageUrl(session),
		bookingSummary: summarizeSessionBookings(bookings),
		gameSpaceName: session.GameSpace?.Name?.trim() || null,
		bookings,
	};
}

function normalizeOptionalString(value: unknown) {
	const normalized = String(value ?? '').trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeDateOfBirth(value: unknown) {
	const normalized = normalizeOptionalString(value);
	if (!normalized) return null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
		return `${normalized}T00:00:00Z`;
	}

	const parsed = Date.parse(normalized);
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function isValidEmailAddress(value: string) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhoneNumber(value: string) {
	if (!/^\+?[\d\s().-]+$/.test(value)) {
		return false;
	}

	const digitsOnly = value.replace(/\D/g, '');
	return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

function isValidPostcode(value: string) {
	return /^[A-Za-z0-9][A-Za-z0-9\s-]{1,9}$/.test(value);
}

function isValidGenderCode(value: string) {
	return value === 'M' || value === 'F' || value === 'O';
}

function getNextOpenBookingSlotId(booking: ZLBooking) {
	const openSlot = (booking.BookingSlots || []).find(
		(slot) => !slot.PlayerGuid,
	);
	return openSlot?.BookingSlotId ?? null;
}

async function getKioskDeviceById(id: string) {
	return db
		.query('SELECT * FROM kiosk_devices WHERE id = ?')
		.get(id) as KioskDeviceRow | null;
}

async function getKioskPairingCode(code: string) {
	return db
		.query('SELECT * FROM kiosk_pairing_codes WHERE code = ?')
		.get(code) as KioskPairingCodeRow | null;
}

async function createKioskDevice(id: string, label: string | null) {
	db.run(
		`
    INSERT INTO kiosk_devices (id, label, paired_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      paired_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    `,
		[id, label],
	);

	return getKioskDeviceById(id);
}

async function createKioskPairingCode(code: string, expiresAt: string) {
	db.run(
		`
    INSERT INTO kiosk_pairing_codes (code, expires_at)
    VALUES (?, ?)
    `,
		[code, expiresAt],
	);
}

async function consumeKioskPairingCode(code: string) {
	db.run(
		`
    UPDATE kiosk_pairing_codes
    SET used_at = CURRENT_TIMESTAMP
    WHERE code = ?
    `,
		[code],
	);
}

async function createKioskQrToken(
	token: string,
	kioskId: string,
	issuedAt: string,
	refreshAt: string,
	expiresAt: string,
) {
	db.run(
		`
    INSERT INTO kiosk_qr_tokens (
      token,
      kiosk_id,
      issued_at,
      refresh_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?)
    `,
		[token, kioskId, issuedAt, refreshAt, expiresAt],
	);
}

async function getKioskQrToken(token: string) {
	return db
		.query('SELECT * FROM kiosk_qr_tokens WHERE token = ?')
		.get(token) as KioskTokenRow | null;
}

// No stored token for these links: fetch the booking directly by ID (gives
// SessionId + StartTime), then a single date-scoped session lookup for the
// richer package/gamespace/sibling-bookings data. No need to scan dates.
async function findSessionAndBooking(sessionId: number, bookingId: number) {
	const booking = await getBookingById(bookingId);
	if (!booking?.StartTime) {
		return null;
	}

	if (booking.SessionId && booking.SessionId !== sessionId) {
		customLog(
			`Booking ${bookingId} belongs to session ${booking.SessionId}, not requested session ${sessionId}`,
			'WARN',
		);
		return null;
	}

	const dateStamp = booking.StartTime.slice(0, 10);
	const sessions = await getSiteSessionsForDate(dateStamp);
	if (!sessions) {
		return null;
	}

	const session = sessions.find((entry) => entry.SessionId === sessionId);
	const matchedBooking = session?.Bookings?.find(
		(entry) => entry.BookingId === bookingId,
	);
	if (!session || !matchedBooking) {
		return null;
	}

	return { date: dateStamp, session, booking: matchedBooking };
}

async function resolveKioskGuestAccess(
	req: Request,
): Promise<KioskGuestAccess | null> {
	const url = new URL(req.url);
	const token = url.searchParams.get('token') || '';

	if (token) {
		const kioskRecord = await getKioskQrToken(token);
		if (
			kioskRecord &&
			!kioskRecord.revoked_at &&
			!isExpired(kioskRecord.expires_at)
		) {
			return { kind: 'kiosk', kioskId: kioskRecord.kiosk_id };
		}
		return null;
	}

	const sessionId = Number(url.searchParams.get('session'));
	const bookingId = Number(url.searchParams.get('booking'));
	if (!Number.isFinite(sessionId) || !Number.isFinite(bookingId)) {
		return null;
	}

	const explicitDate = normalizeVenueDateStamp(url.searchParams.get('date'));
	if (explicitDate) {
		return { kind: 'session', sessionId, bookingId, date: explicitDate };
	}

	const found = await findSessionAndBooking(sessionId, bookingId);
	if (!found) {
		return null;
	}

	return { kind: 'session', sessionId, bookingId, date: found.date };
}

async function getLatestKioskQrToken(kioskId: string) {
	return db
		.query(
			`SELECT *
			 FROM kiosk_qr_tokens
			 WHERE kiosk_id = ?
			   AND revoked_at IS NULL
			 ORDER BY issued_at DESC
			 LIMIT 1`,
		)
		.get(kioskId) as KioskTokenRow | null;
}

async function getAllKioskDevices() {
	return db
		.query(
			`SELECT id, label, paired_at, created_at, updated_at
			 FROM kiosk_devices
			 ORDER BY COALESCE(updated_at, created_at) DESC`,
		)
		.all() as KioskDashboardRow[];
}

async function issueKioskToken(kioskId: string, origin: string) {
	const issuedAtMs = Date.now();
	const token = crypto.randomUUID().replaceAll('-', '');
	const issuedAt = getIsoTimestampAt(issuedAtMs);
	const refreshAt = getIsoTimestampAt(issuedAtMs + TOKEN_ROTATE_MS);
	const expiresAt = getIsoTimestampAt(issuedAtMs + TOKEN_TTL_MS);
	await createKioskQrToken(token, kioskId, issuedAt, refreshAt, expiresAt);

	const qrUrl = kioskSignInUrl(origin, token);
	const qrDataUrl = await QRCode.toDataURL(qrUrl, {
		margin: 1,
		width: 280,
		color: {
			dark: '#0f1018',
			light: '#ffffff',
		},
	});

	return {
		token,
		qrUrl,
		qrDataUrl,
		issuedAt,
		refreshAt,
		expiresAt,
	};
}

export async function getKioskPairingCodeForAdmin() {
	const code = randomCode();
	const expiresAt = getIsoTimestampAt(Date.now() + PAIRING_CODE_TTL_MS);
	await createKioskPairingCode(code, expiresAt);
	customLog(`Generated kiosk pairing code ${code}`, 'INFO');
	return Response.json({ code, expiresAt });
}

export async function getKioskDashboardData(req: Request) {
	const origin = new URL(req.url).origin;
	const kioskUrl = `${origin}/kiosk`;
	const kioskQrDataUrl = await QRCode.toDataURL(kioskUrl, {
		margin: 1,
		width: 220,
		color: {
			dark: '#101014',
			light: '#ffffff',
		},
	});

	const devices = await getAllKioskDevices();
	const signInConfig = await getSignInConfig();

	return Response.json({
		kioskUrl,
		kioskQrDataUrl,
		devices,
		attractions: config.venue.attractions,
		signInConfig,
	});
}

export async function updateKioskSignInConfig(req: Request) {
	const body = (await req.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const signInConfig = normalizeSignInConfig(body ?? {});
	await saveSignInConfig(signInConfig);
	customLog('Updated kiosk sign-in configuration', 'INFO');
	return Response.json({ ok: true, signInConfig });
}

export async function pairKiosk(req: Request) {
	const body = (await req.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const code = String(body?.code ?? '')
		.trim()
		.toUpperCase();
	const label = String(body?.label ?? '').trim() || null;

	if (!code) {
		return Response.json({ error: 'Missing pairing code.' }, { status: 400 });
	}

	const pairingCode = await getKioskPairingCode(code);
	if (!pairingCode) {
		return Response.json({ error: 'Invalid pairing code.' }, { status: 404 });
	}

	if (pairingCode.used_at) {
		return Response.json(
			{ error: 'Pairing code already used.' },
			{ status: 409 },
		);
	}

	if (isExpired(pairingCode.expires_at)) {
		return Response.json({ error: 'Pairing code expired.' }, { status: 410 });
	}

	const kioskId = `kiosk_${crypto.randomUUID()}`;
	const kiosk = await createKioskDevice(kioskId, label);
	await consumeKioskPairingCode(code);

	customLog(`Paired kiosk ${kioskId}${label ? ` (${label})` : ''}`, 'INFO');

	return Response.json(
		{ ok: true, kiosk },
		{
			headers: {
				'Set-Cookie': kioskSessionCookie(kioskId),
			},
		},
	);
}

export async function getKioskState(req: Request) {
	const kioskId = getKioskIdFromRequest(req);
	if (!kioskId) {
		return Response.json({ paired: false });
	}

	const kiosk = await getKioskDeviceById(kioskId);
	if (!kiosk) {
		return Response.json({ paired: false });
	}

	const url = new URL(req.url);
	const origin = url.origin;
	const latestToken = await getLatestKioskQrToken(kioskId);
	const shouldRotate =
		!latestToken ||
		isExpired(latestToken.expires_at) ||
		Date.now() >= Date.parse(latestToken.refresh_at);
	const tokenData = shouldRotate
		? await issueKioskToken(kioskId, origin)
		: {
				token: latestToken.token,
				kiosk_id: latestToken.kiosk_id,
				issuedAt: latestToken.issued_at,
				refreshAt: latestToken.refresh_at,
				expiresAt: latestToken.expires_at,
				created_at: latestToken.created_at,
				qrUrl: kioskSignInUrl(origin, latestToken.token),
				qrDataUrl: await QRCode.toDataURL(
					kioskSignInUrl(origin, latestToken.token),
					{
						margin: 1,
						width: 280,
						color: {
							dark: '#0f1018',
							light: '#ffffff',
						},
					},
				),
			};

	return Response.json({
		paired: true,
		kiosk,
		...tokenData,
	});
}

export async function renderKioskSignInPage(req: Request) {
	const url = new URL(req.url);
	const token = url.searchParams.get('token') || '';
	const record = token ? await getKioskQrToken(token) : null;

	if (!record || record.revoked_at || isExpired(record.expires_at)) {
		return new Response(
			`<!doctype html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Sign in unavailable</title></head>
<body style="font-family:sans-serif;display:grid;place-items:center;min-height:100vh;background:#0f1018;color:#fff;margin:0;">
<main style="text-align:center;max-width:28rem;padding:2rem;">
<h1>Sign in unavailable</h1>
<p>This QR code has expired. Please scan the latest code shown on the kiosk.</p>
</main>
</body>
</html>`,
			{
				status: 410,
				headers: { 'Content-Type': 'text/html; charset=UTF-8' },
			},
		);
	}

	const kiosk = await getKioskDeviceById(record.kiosk_id);
	customLog(
		`Serving kiosk sign-in flow for token ${token}${kiosk?.label ? ` (${kiosk.label})` : ''}`,
		'INFO',
	);

	return new Response(Bun.file('./app/public/kiosk-signin.html'), {
		status: 200,
		headers: { 'Content-Type': 'text/html; charset=UTF-8' },
	});
}

export function renderKioskSessionSignInPage(_req: Request) {
	// Stateless: no token to check. The page itself resolves the session/booking client-side.
	return new Response(Bun.file('./app/public/kiosk-signin.html'), {
		status: 200,
		headers: { 'Content-Type': 'text/html; charset=UTF-8' },
	});
}


export async function getKioskSignInBootstrap(req: Request) {
	const guestToken = await requireKioskGuestToken(req);
	if (guestToken.error) {
		return guestToken.error;
	}
	const access = guestToken.access;

	const requestedDateStamp =
		access.kind === 'session'
			? access.date
			: getRequestedSessionDateStamp(req);
	const sessions = await getSiteSessionsForDate(requestedDateStamp);
	if (!sessions) {
		return Response.json(
			{ error: 'Unable to load sessions from ZL.' },
			{ status: 502 },
		);
	}
	const signInConfig = await getSignInConfig();
	const selectedAttractions = new Set(signInConfig.attractions);

	// A direct booking link only ever exposes the one session/booking it was created for.
	const scopedSessions =
		access.kind === 'session'
			? sessions
					.filter((session) => session.SessionId === access.sessionId)
					.map((session) => ({
						...session,
						Bookings: (session.Bookings || []).filter(
							(booking) => booking.BookingId === access.bookingId,
						),
					}))
			: sessions;

	const mappedSessions = scopedSessions
		.filter((session) => access.kind === 'session' || !session.IsHidden)
		.filter((session) => {
			const attraction = config.venue.attractions.find(
				(entry) => entry.gamespace === session.GameSpaceId,
			);
			return (
				selectedAttractions.size === 0 ||
				!attraction ||
				selectedAttractions.has(attraction.name)
			);
		})
		.filter((session) => (session.Bookings || []).length > 0)
		.map(mapSessionSummary);

	const visibleSessions = (
		await Promise.all(
			mappedSessions.map(async (sessionSummary) => ({
				...sessionSummary,
				imageUrl:
					(await getLocalPackageImageUrl(
						sessionSummary.packageName,
						sessionSummary.imageUrl,
					)) || null,
			})),
		)
	).sort(
		(left, right) => Date.parse(left.startTime) - Date.parse(right.startTime),
	);

	return Response.json({
		date: requestedDateStamp,
		timeZone: config.venue.timezone,
		signInConfig: signInConfig,
		sessions: visibleSessions,
		directAccess: access.kind === 'session',
	});
}

export async function getKioskSignInPlayerMatches(req: Request) {
	const guestToken = await requireKioskGuestToken(req);
	if (guestToken.error) {
		return guestToken.error;
	}

	const email = new URL(req.url).searchParams.get('email')?.trim() || '';
	if (!email) {
		return Response.json({ error: 'Missing email address.' }, { status: 400 });
	}

	const players = await searchPlayersByEmail(email);
	if (players === false) {
		return Response.json(
			{ error: 'Unable to search player profiles.' },
			{ status: 502 },
		);
	}

	return Response.json({
		email,
		players: players.map((player) => ({
			playerGuid: player.PlayerGuid,
			displayName: formatDisplayName(player),
			firstName: player.FirstName || null,
			lastName: player.LastName || null,
			email: player.Email || null,
			phoneNumber: player.PhoneNumber || null,
			postcode: player.Postcode || null,
			gender: player.Gender || null,
			dateOfBirth: player.DateOfBirth || null,
			leftHanded: Boolean(player.LeftHanded),
			language: player.Language || null,
			knownPlayer: Boolean(player.KnownPlayer),
		})),
	});
}

export async function getKioskSignInMarketingPreferences(req: Request) {
	const guestToken = await requireKioskGuestToken(req);
	if (guestToken.error) {
		return guestToken.error;
	}

	const playerGuid = normalizeOptionalString(
		new URL(req.url).searchParams.get('playerGuid'),
	);
	if (!playerGuid) {
		return Response.json({ error: 'Missing player guid.' }, { status: 400 });
	}

	const row = await getKioskSignInRecordByPlayerGuid(playerGuid);
	const subscribeEmail = Boolean(row?.subscribe_email);
	const subscribeSms = Boolean(row?.subscribe_sms);
	const hasStoredPreferences = Boolean(row);
	const shouldShowMarketing =
		!hasStoredPreferences || !subscribeEmail || !subscribeSms;

	return Response.json({
		playerGuid,
		hasStoredPreferences,
		subscribeEmail,
		subscribeSms,
		shouldShowMarketing,
	});
}

export async function submitKioskSignIn(req: Request) {
	const guestToken = await requireKioskGuestToken(req);
	if (guestToken.error) {
		return guestToken.error;
	}
	const access = guestToken.access;

	const body = (await req.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	const sessionId = Number(body?.sessionId);
	const bookingId = Number(body?.bookingId);
	const playerGuid = normalizeOptionalString(body?.playerGuid);
	const profile =
		typeof body?.profile === 'object' &&
		body.profile &&
		!Array.isArray(body.profile)
			? (body.profile as Record<string, unknown>)
			: null;

	if (!Number.isFinite(sessionId) || !Number.isFinite(bookingId) || !profile) {
		return Response.json(
			{ error: 'Missing sign-in session, booking, or profile data.' },
			{ status: 400 },
		);
	}

	if (
		access.kind === 'session' &&
		(access.sessionId !== sessionId || access.bookingId !== bookingId)
	) {
		return Response.json(
			{ error: 'This link is only valid for a specific booking.' },
			{ status: 403 },
		);
	}

	const emailAddress = normalizeOptionalString(profile.email);

	if (!emailAddress) {
		return Response.json(
			{ error: 'Email address is required to sign in.' },
			{ status: 400 },
		);
	}

	if (!isValidEmailAddress(emailAddress)) {
		return Response.json(
			{ error: 'Email address format is invalid.' },
			{ status: 400 },
		);
	}

	const submitDateStamp =
		access.kind === 'session' ? access.date : getRequestedSubmitDateStamp(body);
	const sessions = await getSiteSessionsForDate(submitDateStamp);
	if (!sessions) {
		return Response.json(
			{ error: 'Unable to load current sessions from ZL.' },
			{ status: 502 },
		);
	}

	const session = sessions.find((entry) => entry.SessionId === sessionId);
	if (!session) {
		return Response.json(
			{ error: 'Selected session was not found.' },
			{ status: 404 },
		);
	}

	const booking = (session.Bookings || []).find(
		(entry) => entry.BookingId === bookingId,
	);
	if (!booking) {
		return Response.json(
			{ error: 'Selected booking was not found.' },
			{ status: 404 },
		);
	}

	const firstName = normalizeOptionalString(profile.firstName);
	const lastName = normalizeOptionalString(profile.lastName);
	const displayName = normalizeOptionalString(profile.displayName);
	const phoneNumber = normalizeOptionalString(profile.phoneNumber);
	const postcode = normalizeOptionalString(profile.postcode);
	const gender = normalizeOptionalString(profile.gender);
	const dateOfBirth = normalizeDateOfBirth(profile.dateOfBirth);
	const signedWaiverDateTime = normalizeOptionalString(
		profile.signedWaiverDateTime,
	);
	const signInConfig = await getSignInConfig();
	const submittedCustomFields =
		typeof profile.customFields === 'object' &&
		profile.customFields &&
		!Array.isArray(profile.customFields)
			? (profile.customFields as Record<string, unknown>)
			: {};
	const customFields: Record<string, string> = {};
	for (const field of signInConfig.customFields) {
		const value = normalizeOptionalString(submittedCustomFields[field.key]);
		if (field.mode === 'required' && !value) {
			return Response.json(
				{ error: `${field.label} is required.` },
				{ status: 400 },
			);
		}
		if (value) customFields[field.key] = value.slice(0, 500);
	}
	customLog(
		`Kiosk sign-in request for booking ${bookingId}: client playerGuid=${String(body?.playerGuid ?? '') || 'null'}, profile playerGuid=${String(profile.playerGuid ?? '') || 'null'}, resolved playerGuid=${playerGuid || 'null'}`,
		'INFO',
	);
	if (!playerGuid && (!firstName || !lastName)) {
		return Response.json(
			{ error: 'First name and last name are required for new players.' },
			{ status: 400 },
		);
	}

	if (phoneNumber && !isValidPhoneNumber(phoneNumber)) {
		return Response.json(
			{ error: 'Phone number format is invalid.' },
			{ status: 400 },
		);
	}

	if (postcode && !isValidPostcode(postcode)) {
		return Response.json(
			{ error: 'Postcode format is invalid.' },
			{ status: 400 },
		);
	}

	if (gender && !isValidGenderCode(gender)) {
		return Response.json(
			{ error: 'Gender format is invalid.' },
			{ status: 400 },
		);
	}

	if (normalizeOptionalString(profile.dateOfBirth) && !dateOfBirth) {
		return Response.json(
			{ error: 'Date of birth format is invalid.' },
			{ status: 400 },
		);
	}

	const nextOpenBookingSlotId = getNextOpenBookingSlotId(booking);
	if (!nextOpenBookingSlotId) {
		return Response.json(
			{
				error:
					'Selected booking is already full. Please choose another booking.',
			},
			{ status: 409 },
		);
	}

	const response = await signInPlayerToSession({
		GameSpaceId: session.GameSpaceId,
		StartTime: session.StartTime,
		BookingId: booking.BookingId,
		BookingSlotId: nextOpenBookingSlotId,
		HasSignedWaiver: true,
		SignedWaiverDateTime: signedWaiverDateTime,
		IsAbsent: false,
		LanguageTypeId: 1,
		PlayerGuid: playerGuid,
		EmailAddress: emailAddress,
		DisplayName: displayName,
		FirstName: firstName,
		LastName: lastName,
		PhoneNumber: phoneNumber,
		Postcode: postcode,
		Height: null,
		LeftHanded: Boolean(profile.leftHanded),
		Gender: gender,
		DateOfBirth: dateOfBirth,
		SessionTimes: null,
		SuggestedTeamName: null,
		CreateNew: !playerGuid,
		SubscribeEmail: Boolean(profile.subscribeEmail),
		SubscribeSms: Boolean(profile.subscribeSms),
		CountryCode: normalizeOptionalString(profile.countryCode),
	});

	if (!response) {
		return Response.json(
			{ error: 'ZL rejected the sign-in request.' },
			{ status: 502 },
		);
	}

	const persistedPlayerGuid = String(
		response.PlayerGuid ??
			(response.Player as Record<string, unknown> | undefined)?.PlayerGuid ??
			playerGuid ??
			'',
	).trim();

	if (persistedPlayerGuid) {
		await saveKioskSignInRecord({
			playerGuid: persistedPlayerGuid,
			subscribeEmail: Boolean(profile.subscribeEmail),
			subscribeSms: Boolean(profile.subscribeSms),
			customFields,
			syncedWithPatch: false,
		});
	}

	return Response.json({
		ok: true,
		bookingId,
		sessionId,
		playerName:
			displayName ||
			[firstName, lastName].filter(Boolean).join(' ') ||
			emailAddress,
	});
}

