import { customLog } from './logger';

const COOKIE_NAME = 'dashboard_session';

function makeSessionValue() {
	const secret = Bun.env.DASHBOARD_SESSION_SECRET || 'dev-secret';
	return btoa(`${secret}:${new Date().toISOString()}`);
}

export function isDashboardAuthed(req: Request) {
	const cookie = req.headers.get('cookie') || '';
	return cookie.includes(`${COOKIE_NAME}=`);
}

export async function dashboardLogin(req: Request) {
	const body = await req.formData();
	const password = String(body.get('password') || '');

	if (password !== Bun.env.DASHBOARD_PASSWORD) {
		customLog('Failed dashboard login', 'WARN');

		return new Response('Invalid password', {
			status: 401,
		});
	}

	customLog('Dashboard login successful', 'INFO');

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard',
			'Set-Cookie': `${COOKIE_NAME}=${makeSessionValue()}; HttpOnly; Path=/; SameSite=Lax`,
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

export function dashboardLogout() {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard/login',
			'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`,
		},
	});
}
