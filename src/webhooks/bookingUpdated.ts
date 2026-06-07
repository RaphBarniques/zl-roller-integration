import {
	checkProcessedEvent,
	getSyncedItem,
	saveProcessedEvent,
	saveSyncedItem,
} from '../utils/db.ts';
import { customLog } from '../utils/logger.ts';
import { allowedPackages } from '../preflight.ts';
import { createZLSession, deleteZLSession } from '../zlAPI.ts';

export async function handleUpdatedWebhook(payload: any) {
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

	// Checker le paiment et continuer seulement si le paiment est complété
	if (booking.paymentStatus !== 'paid') {
		customLog(
			`Booking ${bookingReference} has been skipped because it is not fully paid`,
			'WARN',
		);
		return;
	}

	// Loop through remaining items and process each booking if they are in the allowedPackages list
	const bookingItems = booking.items;
	for (const item of bookingItems) {
		let logMessage = `Processing item ${item.roller_id} for booking ${bookingReference}...\n`;
		const packageConfig = allowedPackages.get(item.roller_id);
		if (!packageConfig) {
			logMessage += `Item ${item.roller_id} is not in the allowed packages list. Skipping this item.`;
			customLog(logMessage, 'WARN');
			continue;
		}

		const packageName = packageConfig.package_name;
		const zlPackageId = packageConfig.zl_id;

		// Vérifier si le booking existe déjà dans la base de données (Create or update)
		const dbItem = await getSyncedItem(
			booking.roller_booking_id,
			item.roller_id,
		);
		if (dbItem) {
			logMessage += `Found existing synced item for booking ${bookingReference} and item ${item.roller_id}. Updating the record and ZL session if necessary...\n`;

			// Si le booking existe déjà, vérifier si les détails ont changé (ex: nombre de joueurs, date, etc.) et mettre à jour la session ZL en conséquence
			if (
				dbItem.players !== item.quantity ||
				dbItem.start_time !== booking.startDate ||
				dbItem.roller_package_id !== item.roller_id
			) {
				await deleteZLSession(dbItem.zl_booking_id, booking.roller_booking_id);
				await createZLSession(
					item.bookingItemId,
					booking.bookingReference,
					dbItem.email,
					zlPackageId,
					booking.startDate,
					item.quantity,
					item.price,
				);
				logMessage += `Updated ZL session for booking ${bookingReference} and item ${item.roller_id} due to changes in booking details.\n`;

				// Todo: Update the record in the database with the new details
				await saveSyncedItem(booking, item);
				logMessage += `Updated synced item for booking ${bookingReference} and item ${item.roller_id}.\n`;
				customLog(logMessage, 'INFO');
			} else {
				logMessage += `No changes detected for booking ${bookingReference} and item ${item.roller_id}. No update needed for ZL session.\n`;
			}
		} else {
			logMessage += `No existing synced item found for booking ${bookingReference} and item ${item.roller_id}. Creating new record and ZL session...\n`;
			const email: string = '';
			// Todo : Query Roller API to get email from customerID

			createZLSession(
				item.bookingItemId,
				booking.bookingReference,
				email,
				zlPackageId,
				booking.startDate,
				item.quantity,
				item.price,
			);

			// Todo: Save the new synced item in the database
		}
	}

	// Todo : Trouver une facon de ne pas recréer une session qui as été bookée manuellement du côté de ZL
	// Todo : Si le prix est à + de 50% de rabais, envoyer une alerte email pour remplir l'ecplicatif du booking manuellement
}
