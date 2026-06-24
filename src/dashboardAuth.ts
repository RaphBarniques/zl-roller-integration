import { customLog } from './logger';

const COOKIE_NAME = 'dashboard_session';
type DashboardRole = 'user' | 'admin';

function makeSessionValue(role: DashboardRole) {
	const secret = Bun.env.DASHBOARD_SESSION_SECRET || 'dev-secret';
	return btoa(`${secret}:${new Date().toISOString()}:${role}`);
}

function getSessionCookieValue(req: Request) {
	const cookie = req.headers.get('cookie') || '';
	const parts = cookie.split(';').map((part) => part.trim());
	const sessionPart = parts.find((part) => part.startsWith(`${COOKIE_NAME}=`));
	if (!sessionPart) return null;
	return sessionPart.slice(`${COOKIE_NAME}=`.length);
}

export function getDashboardRole(req: Request): DashboardRole | null {
	const session = getSessionCookieValue(req);
	if (!session) return null;

	try {
		const decoded = atob(session);
		const parts = decoded.split(':');
		const role = parts[parts.length - 1];
		if (role === 'admin' || role === 'user') {
			return role;
		}
	} catch {
		return null;
	}

	return null;
}

export function isDashboardAuthed(req: Request) {
	return getDashboardRole(req) !== null;
}

export async function dashboardLogin(req: Request) {
	const body = await req.formData();
	const password = String(body.get('password') || '');
	const dashboardPassword = Bun.env.DASHBOARD_PASSWORD;
	const adminPassword = Bun.env.DASHBOARD_ADMIN_PASSWORD;

	let role: DashboardRole | null = null;
	if (adminPassword && password === adminPassword) {
		role = 'admin';
	} else if (dashboardPassword && password === dashboardPassword) {
		role = 'user';
	}

	if (!role) {
		customLog('Failed dashboard login', 'WARN');

		return new Response('Invalid password', {
			status: 401,
		});
	}

	customLog(`Dashboard login successful (${role})`, 'INFO');

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard',
			'Set-Cookie': `${COOKIE_NAME}=${makeSessionValue(role)}; HttpOnly; Path=/; SameSite=Lax`,
		},
	});
}

export function requireDashboardAuth(req: Request) {
	if (!isDashboardAuthed(req)) {
		return new Response(null, {
			status: 302,
			headers: {
				Location: '/dashboard/login',
			},
		});
	}

	return null;
}

export function requireDashboardAdmin(req: Request) {
	const role = getDashboardRole(req);
	if (role !== 'admin') {
		return new Response(JSON.stringify({ error: 'Admin access required.' }), {
			status: 403,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}

	return null;
}

export function getDashboardSessionInfo(req: Request) {
	const role = getDashboardRole(req);
	return {
		role: role ?? 'user',
		isAdmin: role === 'admin',
	};
}

export function dashboardLogout() {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard/login',
			'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`,
		},
	});
}
