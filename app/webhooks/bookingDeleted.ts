import { customLog } from '../utils/logger.ts';
import { config } from '../preflight.ts';
import {
	checkProcessedEvent,
	updateSyncedItemStatus,
	getSyncedItem,
	getSyncedItems,
	saveProcessedEvent,
} from '../utils/db.ts';
import { deleteZLSession } from '../api/zlAPI.ts';
import { updateRollerBookingComments } from '../api/rollerAPI.ts';

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

	const integrationStartDate = config.venue.integration_start_date;
	const bookingCreatedAt = Date.parse(String(booking.createdDate ?? ''));
	const integrationStartAt = Date.parse(String(integrationStartDate ?? ''));

	if (
		integrationStartDate &&
		!Number.isNaN(bookingCreatedAt) &&
		!Number.isNaN(integrationStartAt) &&
		bookingCreatedAt < integrationStartAt
	) {
		customLog(
			`Booking ${bookingReference} delete event has been skipped because it was created before integration start date ${integrationStartDate}`,
			'INFO',
		);
		return;
	}

	// Todo : Update la DB
	// Todo : Supprimer la session ZL
	for (const item of booking.items) {
		let logMessage = `Processing item ${item.bookingItemId} for booking ${bookingReference}...\n`;
		const session = await getSyncedItem(bookingReference, item.bookingItemId);
		if (session?.zl_booked) {
			await deleteZLSession(session.zl_booking_id, bookingReference);
			await updateSyncedItemStatus(
				bookingReference,
				item.bookingItemId,
				'Cancelled',
				false,
			);
			logMessage = `Deleted record and ZL session ${item.bookingItemId} for booking ${bookingReference}...\n`;
			customLog(logMessage, 'INFO');
		} else if (session?.sync_status === 'Skipped') {
			await updateSyncedItemStatus(
				bookingReference,
				item.bookingItemId,
				'Cancelled',
				false,
			);
			logMessage = `Item was skipped. Deleted record ${item.bookingItemId} for booking ${bookingReference}...\n`;
			customLog(logMessage, 'WARN');
		} else {
			logMessage = `Unable to find item ${item.bookingItemId} for booking ${bookingReference}\n`;
			customLog(logMessage, 'ERROR');
		}
	}

	await syncRollerBookingComments(
		booking.bookingReference,
		String(booking.uniqueId ?? booking.bookingReference),
		booking.comments,
	);
}

async function syncRollerBookingComments(
	bookingReference: string,
	rollerBookingId: string,
	currentComments?: string | null,
) {
	const syncedRows = await getSyncedItems(bookingReference);
	const zlBookingIds = syncedRows
		.filter((row) => row.zl_booked && row.zl_booking_id)
		.map((row) => String(row.zl_booking_id));

	await updateRollerBookingComments(
		rollerBookingId,
		zlBookingIds,
		currentComments,
	);
}
