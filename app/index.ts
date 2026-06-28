import {
	getLatestBooking,
	getLogs,
	getLogsStream,
	searchBookings,
	getQueueStatus,
	getQueueItems,
	manageQueueAction,
	manageAdminAction,
} from './api/dashboardAPI.ts';
import {
	dashboardLogin,
	dashboardLogout,
	requireDashboardAuth,
	requireDashboardAdmin,
	getDashboardSessionInfo,
} from './api/dashboardAuth.ts';
import { customLog } from './utils/logger.ts';
import chain from './middleware/middleware.ts';
import logging from './middleware/req_logging.ts';
import {
	config,
	initConfig,
	initDb,
	initEnv,
	initMailer,
} from './preflight.ts';
import { getRollerToken } from './api/rollerAuth.ts';
import { processQueuedWebhooks, queueWebhook } from './webhooks/queue.ts';
import { getSession } from './api/zlAPI.ts';
import { parse } from 'yaml';


customLog('-------------------------------------------------');
const startupVersion = await getStartupVersion();
customLog(`ZL-ROLLER-INTEGRATION v${startupVersion} - Starting server...`);

await initDb();
await initConfig();
await initEnv();
await initMailer();
// await getZLToken(); // ATTENTION AU RATE LIMIT, LE SERVEUR BUN RESTART A CHAQUE FOIS QUE LE SCRIPT EST MODIFIÉ.
await getRollerToken(); // ATTENTION AU RATE LIMIT, LE SERVEUR BUN RESTART A CHAQUE FOIS QUE LE SCRIPT EST MODIFIÉ.

const server = Bun.serve({
	hostname: config.server.host,
	port: config.server.port,
	routes: {
		'/status': chain([logging], async (_req) => {
			await getSession();
			return new Response('OK', { status: 200 });
		}),

		'/': async (req) => {
			const authResponse = requireDashboardAuth(req);
			if (authResponse) return authResponse;

			return new Response(Bun.file('./app/public/dashboard.html'));
		},

		'/dashboard/login': {
			GET: () => new Response(Bun.file('./app/public/dashboard-login.html')),

			POST: async (req) => dashboardLogin(req),
		},

		'/dashboard/logout': () => dashboardLogout(),

		'/dashboard': async (req) => {
			const authResponse = requireDashboardAuth(req);
			if (authResponse) return authResponse;

			return new Response(Bun.file('./app/public/dashboard.html'));
		},

		'/api/dashboard/logs': {
			GET: async (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;
				const adminResponse = requireDashboardAdmin(req);
				if (adminResponse) return adminResponse;

				return getLogs(req);
			},
		},

		'/api/dashboard/logs/stream': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;
				const adminResponse = requireDashboardAdmin(req);
				if (adminResponse) return adminResponse;

				return getLogsStream(req);
			},
		},

		'/api/dashboard/me': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;

				return Response.json(getDashboardSessionInfo(req));
			},
		},

		'/api/dashboard/version': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;

				return Response.json({ version: config.server.version || 'dev' });
			},
		},

		'/api/dashboard/bookings/latest': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;

				return getLatestBooking();
			},
		},

		'/api/dashboard/bookings/search': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;

				return searchBookings(req);
			},
		},
		'/api/dashboard/queue': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;
				const adminResponse = requireDashboardAdmin(req);
				if (adminResponse) return adminResponse;

				return getQueueItems();
			},
			POST: async (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;
				const adminResponse = requireDashboardAdmin(req);
				if (adminResponse) return adminResponse;

				return manageQueueAction(req);
			},
		},
		'/api/dashboard/queue/status': {
			GET: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;
				const adminResponse = requireDashboardAdmin(req);
				if (adminResponse) return adminResponse;

				return getQueueStatus();
			},
		},
		'/api/dashboard/admin/actions': {
			POST: (req) => {
				const authResponse = requireDashboardAuth(req);
				if (authResponse) return authResponse;
				const adminResponse = requireDashboardAdmin(req);
				if (adminResponse) return adminResponse;

				return manageAdminAction(req);
			},
		},
		'/webhooks/roller': {
			POST: chain([logging], async (req) => {
				const secret = req.headers.get('X-Roller-Apikey');

				if (secret !== Bun.env.ROLLER_WEBHOOK_SECRET) {
					customLog(`Unauthorized webhook access attempt`, 'WARN');
					return new Response('Unauthorized', { status: 401 });
				}

				let payload: unknown;
				try {
					payload = await req.json();
				} catch {
					customLog(`Rejected webhook, invalid JSON payload`, 'ERROR');
					return new Response('Bad Request', { status: 400 });
				}

				if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
					customLog(`Rejected webhook, payload must be a JSON object`, 'ERROR');
					return new Response('Bad Request', { status: 400 });
				}

				await queueWebhook(payload as Record<string, unknown>);

				return new Response('OK', { status: 200 });
			}),
		},
	},

	idleTimeout: 255,
	fetch(req) {
		customLog(`${req.method} ${req.url}`);
		return new Response('Not Found', { status: 404 });
	},
});

await processQueuedWebhooks();

// Start a periodic background worker to ensure queued webhooks are processed
// even if resumptions or enqueues race with current processing state.
setInterval(() => {
	void processQueuedWebhooks();
}, 3000);

customLog(`Listening for webhooks at ${server.url}webhooks/roller`);
customLog(`Dashboard up at ${server.url} and ${server.url}dashboard`);


async function getStartupVersion() {
	try {
		const configContent = await Bun.file('./config/config.yaml').text();
		const parsed = parse(configContent) as {
			server?: {
				version?: string;
			};
		};
		return parsed.server?.version || 'dev';
	} catch {
		return 'dev';
	}
}