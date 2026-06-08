import { customLog } from './logger.ts';
import chain from './middleware/middleware.ts';
import logging from './middleware/req_logging.ts';
import {
	config,
	initConfig,
	initDb,
	initEnv,
	initMailer,
} from './preflight.ts';
import { getRollerToken } from './rollerAuth.ts';
import { handleDeletedWebhook } from './webhooks/bookingDeleted.ts';
import { handleUpdatedWebhook } from './webhooks/bookingUpdated.ts';
import { getSession } from './zlAPI.ts';
import { getZLToken } from './zlAuth.ts';
import { getCustomerEmail } from './rollerAPI.ts';

customLog('-------------------------------------------------');
customLog('ZL-ROLLER-INTEGRATION v0.1.0 - Starting server...');

await initDb();
await initConfig();
await initEnv();
await initMailer();
//await getZLToken(); // ATTENTION AU RATE LIMIT, LE SERVEUR BUN RESTART A CHAQUE FOIS QUE LE SCRIPT EST MODIFIÉ.
//await getRollerToken(); // ATTENTION AU RATE LIMIT, LE SERVEUR BUN RESTART A CHAQUE FOIS QUE LE SCRIPT EST MODIFIÉ.

customLog(await getCustomerEmail(15681739))

const server = Bun.serve({
	hostname: config.server.host,
	port: config.server.port,
	routes: {
		'/status': chain([logging], async (req) => {
			await getSession();
			return new Response('OK', { status: 200 });
		}),
		'/webhooks/roller': {
			POST: chain([logging], async (req) => {
				const url = new URL(req.url);
				const secret = url.searchParams.get('apiKey');

				if (secret !== Bun.env.ROLLER_WEBHOOK_SECRET) {
					customLog(`Unauthorized webhook access attempt`, 'WARN');
					return new Response('Unauthorized', { status: 401 });
				}

				let payload: any;
				try {
					payload = await req.json();
				} catch {
					customLog(`Rejected webhook, invalid JSON payload`, 'ERROR');
					return new Response('Bad Request', { status: 400 });
				}

				let reqType = '';
				switch (payload.eventType) {
					case 1:
						reqType = 'CREATED';
						customLog(
							`Received webhook from ROLLER with Booking ID: ${payload.bookingId} and type: ${reqType}`,
						);
						await handleUpdatedWebhook(payload);
						break;
					case 2:
						reqType = 'UPDATED';
						customLog(
							`Received webhook from ROLLER with Booking ID: ${payload.bookingId} and type: ${reqType}`,
						);
						await handleUpdatedWebhook(payload);
						break;
					case 3:
						reqType = 'DELETED';
						customLog(
							`Received webhook from ROLLER with Booking ID: ${payload.bookingId} and type: ${reqType}`,
						);
						await handleDeletedWebhook(payload);
						break;
					default:
						reqType = 'UNKNOWN';
						customLog(
							`Received webhook from ROLLER with Booking ID: ${payload.bookingId} and type: ${reqType}`,
							'WARN',
						);
				}

				return new Response('OK', { status: 200 });
			}),
		},
	},

	fetch(req) {
		customLog(`${req.method} ${req.url}`);
		return new Response('Not Found', { status: 404 });
	},
});

customLog(`Listening for webhooks at ${server.url}webhooks/roller`);
