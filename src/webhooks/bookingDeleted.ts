import { customLog } from '../logger.ts';
import {
	checkProcessedEvent,
	deleteSyncedItem,
	getSyncedItem,
	saveProcessedEvent,
} from '../utils/db.ts';
import { deleteZLSession } from '../zlAPI.ts';

export async function handleDeletedWebhook(payload: any) {
	const eventId = payload.id;
	const eventType = String(payload.eventType);
	const booking = payload.data.booking;
	const bookingReference = booking.bookingReference;

	// Check if the event has already been processed
	if (await checkProcessedEvent(eventId)) {
		customLog(
			`Event ${eventId} has been skipped because it has already been processed.`,
			'WARN',
		);
		return;
	}
	// Save the event as processed
	await saveProcessedEvent(eventId, eventType, bookingReference);

	// Todo : Update la DB
	// Todo : Supprimer la session ZL
	for (const item of booking.items) {
		let logMessage = `Processing item ${item.bookingItemId} for booking ${bookingReference}...\n`;
		const session = await getSyncedItem(bookingReference, item.bookingItemId);
		if (session && session.sync_status === 'Matched') {
			await deleteZLSession(bookingReference, item.bookingItemId);
			await deleteSyncedItem(bookingReference, item.bookingItemId);
			logMessage = `Deleted record and ZL session ${item.bookingItemId} for booking ${bookingReference}...\n`;
			customLog(logMessage, 'INFO');
		} else if (session && session.sync_status === 'Skipped') {
			await deleteSyncedItem(bookingReference, item.bookingItemId);
			logMessage = `Item was skipped. Deleted record ${item.bookingItemId} for booking ${bookingReference}...\n`;
		} else {
			logMessage = `Unable to find item ${item.bookingItemId} for booking ${bookingReference}\n`;
			customLog(logMessage, 'ERROR');
		}
	}
}
