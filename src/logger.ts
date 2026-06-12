// LOGGING FUNCTION
// Usage: customLog("This is a log message", LogPriority)
//
// Si aucun type n'est spécifié, "INFO" est utilisé par défaut.
// vvv
// [2024-06-01 12:00:00] (INFO)   This is a log message
//
// Utilise \n pour plusieurs ligne avec le même timestamp
// Si plusieurs lignes sont utilisées, le type est appliqué à toutes les lignes
// Exemple: customLog("This is a log message\nThis is another line", "ERROR")
// vvv
// [2024-06-01 12:00:00] (ERROR) This is a log message
//                       (ERROR) This is another line

import { appendFile } from 'node:fs/promises';

const logClients = new Set<ReadableStreamDefaultController>();

type LogPriority = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export function customLog(message: string, type: LogPriority = 'INFO') {
	const date = new Date();
	const timestamp = formatDate(date);
	message = message.replaceAll('\n', `\n\t\t\t\t\t(${type})\t`);
	message = `${timestamp} (${type})\t${message}`;
	console.log(message);
	appendFile(`./logs/server-${formatDate(date, false)}.log`, `${message}\n`);
	for (const client of logClients) {
		try {
			client.enqueue(`data: ${JSON.stringify(message)}\n\n`);
		} catch {
			logClients.delete(client);
		}
	}
}

function padTo2Digits(num: number) {
	return num.toString().padStart(2, '0');
}

export function formatDate(date: Date, includeHours = true) {
	const dateOnly = [
		date.getFullYear(),
		padTo2Digits(date.getMonth() + 1),
		padTo2Digits(date.getDate()),
	].join('-');

	if (!includeHours) {
		return dateOnly;
	}

	return (
		dateOnly +
		' ' +
		[
			padTo2Digits(date.getHours()),
			padTo2Digits(date.getMinutes()),
			padTo2Digits(date.getSeconds()),
		].join(':')
	);
}

export function streamLogs() {
	let heartbeat: Timer | undefined;

	return new Response(
		new ReadableStream({
			start(controller) {
				logClients.add(controller);

				controller.enqueue(`data: ${JSON.stringify('connected')}\n\n`);
				heartbeat = setInterval(() => {
					try {
						controller.enqueue(`: heartbeat\n\n`);
					} catch {
						logClients.delete(controller);
						if (heartbeat) clearInterval(heartbeat);
					}
				}, 15000);
			},

			cancel(controller) {
				logClients.delete(controller);
				if (heartbeat) {
					clearInterval(heartbeat);
				}
			},
		}),
		{
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
			},
		},
	);
}
