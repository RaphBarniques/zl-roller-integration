import { customLog, logWebhookPayload } from '../logger.ts';
import { handleDeletedWebhook } from './bookingDeleted.ts';
import { handleUpdatedWebhook } from './bookingUpdated.ts';
import {
	enqueueWebhookItem,
	getQueuedWebhooks,
	getQueuedWebhook,
	getQueuePaused,
	setQueuePaused,
	deleteQueuedWebhook,
	updateQueuedWebhookStatus,
} from '../utils/db.ts';

let isProcessingQueue = false;

function mapEventType(eventType: unknown) {
	if (eventType === 1 || eventType === '1') return 'CREATED';
	if (eventType === 2 || eventType === '2') return 'UPDATED';
	if (eventType === 3 || eventType === '3') return 'DELETED';
	return String(eventType ?? 'UNKNOWN').toUpperCase();
}

export async function queueWebhook(payload: Record<string, unknown>) {
	const pl = payload as Record<string, unknown>;
	const eventId = String((pl['id'] ?? pl['eventId'] ?? '') as string);
	const eventType = mapEventType(pl['eventType']);
	const bookingReference =
		(
			(pl['data'] as Record<string, unknown> | undefined)?.['booking'] as
				| Record<string, unknown>
				| undefined
		)?.['bookingReference'] ??
		pl['bookingId'] ??
		null;

	await enqueueWebhookItem(
		eventId,
		eventType,
		bookingReference,
		JSON.stringify(payload),
	);

	await processQueuedWebhooks();
}

export async function processQueuedWebhooks() {
	if (isProcessingQueue) {
		return;
	}

	if (await getQueuePaused()) {
		return;
	}

	isProcessingQueue = true;
	try {
		const items = await getQueuedWebhooks();
		for (const item of items) {
			if (await getQueuePaused()) {
				break;
			}
			await processQueueItem(item);
		}
	} finally {
		isProcessingQueue = false;
	}
}

export async function processQueueItemById(id: number) {
	const item = await getQueuedWebhook(id);
	if (!item) {
		throw new Error(`Queue item ${id} not found`);
	}

	await processQueueItem(item);
}

async function processQueueItem(item: {
	id: number;
	event_id: string;
	event_type: string;
	booking_reference: string | null;
	status: string;
	created_at: string;
	updated_at: string;
	payload: string;
}) {
	customLog(
		`Processing queued webhook ${item.id} (${item.event_type}) for booking ${item.booking_reference ?? 'unknown'}`,
	);

	try {
		const payload = JSON.parse(item.payload) as Record<string, unknown>;
		await logWebhookPayload(
			item.id,
			item.event_type,
			item.booking_reference,
			payload,
			'processed',
		);

		switch (payload.eventType) {
			case 1:
			case '1':
			case 2:
			case '2':
			case 'UPDATED':
			case 'CREATED':
				await handleUpdatedWebhook(payload);
				break;
			case 3:
			case '3':
			case 'DELETED':
				await handleDeletedWebhook(payload);
				break;
			default:
				customLog(
					`Unknown queued webhook event type: ${payload.eventType}`,
					'WARN',
				);
		}

		await deleteQueuedWebhook(item.id);
		customLog(
			`Queued webhook item ${item.id} processed and removed from queue.`,
			'INFO',
		);
	} catch (error) {
		await updateQueuedWebhookStatus(item.id, 'failed');
		const payload = JSON.parse(item.payload) as Record<string, unknown>;
		await logWebhookPayload(
			item.id,
			item.event_type,
			item.booking_reference,
			payload,
			'failed',
		);
		customLog(
			`Failed to process queued webhook ${item.id}: ${String(error)}`,
			'ERROR',
		);
	}
}

export async function pauseQueue() {
	await setQueuePaused(true);
	customLog('Webhook queue paused', 'WARN');
	return { paused: true };
}

export async function resumeQueue() {
	await setQueuePaused(false);
	customLog('Webhook queue resumed', 'INFO');
	// trigger processing asynchronously to avoid potential race
	// where `isProcessingQueue` may still be toggled by a concurrent run
	if (!isProcessingQueue) {
		setTimeout(() => {
			void processQueuedWebhooks();
		}, 0);
	}

	return { paused: false };
}

export async function getQueueState() {
	return { paused: await getQueuePaused() };
}
