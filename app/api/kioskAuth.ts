const COOKIE_NAME = 'kiosk_session';

function makeSessionValue(kioskId: string) {
	const secret = Bun.env.KIOSK_SESSION_SECRET || 'dev-secret';
	return btoa(`${secret}:${kioskId}`);
}

function getSessionCookieValue(req: Request) {
	const cookie = req.headers.get('cookie') || '';
	const parts = cookie.split(';').map((part) => part.trim());
	const sessionPart = parts.find((part) => part.startsWith(`${COOKIE_NAME}=`));
	if (!sessionPart) return null;
	return sessionPart.slice(`${COOKIE_NAME}=`.length);
}

export function getKioskIdFromRequest(req: Request) {
	const session = getSessionCookieValue(req);
	if (!session) return null;

	try {
		const decoded = atob(session);
		const secret = Bun.env.KIOSK_SESSION_SECRET || 'dev-secret';
		const prefix = `${secret}:`;
		if (!decoded.startsWith(prefix)) return null;
		return decoded.slice(prefix.length) || null;
	} catch {
		return null;
	}
}

export function kioskSessionCookie(kioskId: string) {
	return `${COOKIE_NAME}=${makeSessionValue(kioskId)}; HttpOnly; Path=/; SameSite=Lax`;
}
