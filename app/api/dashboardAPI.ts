import { formatDate, streamLogs } from '../utils/logger.ts';
import { db } from '../preflight.ts';
import { customLog } from '../utils/logger.ts';
import {
	getWebhookQueueItems,
	deleteQueuedWebhook,
	getQueuedWebhookById,
} from '../utils/db.ts';
import {
	pauseQueue,
	resumeQueue,
	processQueueItemById,
	getQueueState,
} from '../webhooks/queue.ts';

export async function getLogs(req: Request) {
	const url = new URL(req.url);
	const level = url.searchParams.get('level') || 'ALL';

	const date = formatDate(new Date(), false);
	const file = Bun.file(`./logs/server-${date}.log`);

	if (!(await file.exists())) {
		return Response.json([]);
	}

	const text = await file.text();

	let lines = text.split('\n').filter(Boolean).reverse();

	if (level !== 'ALL') {
		lines = lines.filter((line) => line.includes(`(${level})`));
	}

	return Response.json(lines.slice(0, 500));
}

export function getLogsStream(_req: Request) {
	return streamLogs();
}

export function getLatestBooking() {
	const row = db
		.query(`
      SELECT *
      FROM synced_items
      ORDER BY updated_at DESC
      LIMIT 1
    `)
		.get();

	return Response.json(row ?? null);
}

export function searchBookings(req: Request) {
	const url = new URL(req.url);
	const q = `%${(url.searchParams.get('q') || '').trim()}%`;
	const status = (url.searchParams.get('status') || 'ALL').trim();

	let rows: Record<string, unknown>[];

	if (status.toUpperCase() === 'ALL') {
		rows = db
			.query(`
        SELECT *
        FROM synced_items
        WHERE roller_booking_id LIKE ?
           OR roller_item_id LIKE ?
           OR zl_booking_id LIKE ?
					 OR email LIKE ?
					 OR package_name LIKE ?
					 OR start_time LIKE ?
           OR sync_status LIKE ?
        ORDER BY updated_at DESC
        LIMIT 100
      `)
			.all(q, q, q, q, q, q, q);
	} else {
		rows = db
			.query(`
        SELECT *
        FROM synced_items
				WHERE LOWER(sync_status) = LOWER(?)
          AND (
            roller_booking_id LIKE ?
            OR roller_item_id LIKE ?
            OR zl_booking_id LIKE ?
			OR email LIKE ?
			OR attraction LIKE ?
			OR package_name LIKE ?
			OR start_time LIKE ?
            OR sync_status LIKE ?
          )
        ORDER BY updated_at DESC
        LIMIT 100
      `)
			.all(status, q, q, q, q, q, q, q, q);
	}

	return Response.json(rows) ?? null;
}
export async function getQueueStatus() {
	const state = await getQueueState();
	return Response.json(state);
}

export async function getQueueItems() {
	const items = await getWebhookQueueItems();
	return Response.json(items);
}

export async function manageAdminAction(req: Request) {
	const body = await req.json();

	if (!body.action) {
		return new Response(JSON.stringify({ error: 'Missing action.' }), {
			status: 400,
		});
	}

	if (body.action === 'restart') {
		customLog('Admin requested service restart', 'WARN');
		setTimeout(() => {
			process.exit(0);
		}, 150);

		return Response.json({ ok: true, message: 'Restarting service...' });
	}

	if (body.action === 'update') {
		customLog('Admin requested update + restart', 'WARN');
		const repoDir = process.cwd().replaceAll('\\', '/');

		const pull = Bun.spawnSync(
			['git', '-c', `safe.directory=${repoDir}`, 'pull', '--ff-only'],
			{
				cwd: process.cwd(),
				stdout: 'pipe',
				stderr: 'pipe',
			},
		);

		if (pull.exitCode !== 0) {
			const stderr = new TextDecoder().decode(pull.stderr).trim();
			const stdout = new TextDecoder().decode(pull.stdout).trim();
			const details = stderr || stdout || 'Unknown git pull error';
			customLog(`Update failed: ${details}`, 'ERROR');
			return new Response(
				JSON.stringify({ error: `Update failed: ${details}` }),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
					},
				},
			);
		}

		customLog('Update completed successfully. Restarting service...', 'INFO');
		setTimeout(() => {
			process.exit(0);
		}, 200);

		return Response.json({
			ok: true,
			message: 'Updated and restarting service...',
		});
	}

	if (body.action === 'backup') {
		customLog('Admin requested manual backup', 'WARN');
		const scriptPath = './scripts/manualbackup.ps1';
		const repoDir = process.cwd().replaceAll('\\', '/');

		const backup = Bun.spawnSync(['powershell', '-File', scriptPath], {
			cwd: process.cwd(),
			stdout: 'pipe',
			stderr: 'pipe',
		});

		if (backup.exitCode !== 0) {
			const stderr = new TextDecoder().decode(backup.stderr).trim();
			const stdout = new TextDecoder().decode(backup.stdout).trim();
			const details = stderr || stdout || 'Unknown backup script error';
			customLog(`Backup failed: ${details}`, 'ERROR');
			return new Response(
				JSON.stringify({ error: `Backup failed: ${details}` }),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
					},
				},
			);
		}

		const output = new TextDecoder().decode(backup.stdout).trim();
		customLog(`Backup completed: ${output}`, 'INFO');

		return Response.json({
			ok: true,
			message: 'Manual backup completed successfully.',
		});
	}

	return new Response(JSON.stringify({ error: 'Unknown action.' }), {
		status: 400,
	});
}

export async function manageQueueAction(req: Request) {
	const body = await req.json();

	if (!body.action) {
		return new Response(JSON.stringify({ error: 'Missing action.' }), {
			status: 400,
		});
	}

	switch (body.action) {
		case 'pause':
			return Response.json(await pauseQueue());
		case 'resume':
			return Response.json(await resumeQueue());
		case 'delete':
			if (!body.id) {
				return new Response(JSON.stringify({ error: 'Missing id.' }), {
					status: 400,
				});
			}
			await deleteQueuedWebhook(body.id);
			return Response.json({ ok: true });
		case 'bypass':
			if (!body.id) {
				return new Response(JSON.stringify({ error: 'Missing id.' }), {
					status: 400,
				});
			}
			await processQueueItemById(body.id);
			return Response.json({ ok: true });
		default:
			return new Response(JSON.stringify({ error: 'Unknown action.' }), {
				status: 400,
			});
	}
}

export async function getQueueItem(req: Request) {
	const url = new URL(req.url);
	const id = Number(url.searchParams.get('id'));
	if (!id) {
		return new Response(JSON.stringify({ error: 'Missing id.' }), {
			status: 400,
		});
	}

	const item = await getQueuedWebhookById(id);
	return Response.json(item);
}
