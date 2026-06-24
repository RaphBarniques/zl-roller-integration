import { customLog } from '../logger.ts';
import {
	allowedVRPackages,
	allowedOtherPackages,
	config,
} from '../preflight.ts';
import { getCustomerEmail } from '../rollerAPI.ts';
import { sendEmail } from '../sendMail.ts';
import {
	checkProcessedEvent,
	getSyncedItem,
	getSyncedItems,
	saveProcessedEvent,
	saveSyncedItem,
	updateSyncedItemStatus,
} from '../utils/db.ts';
import { createZLSession, deleteZLSession } from '../zlAPI.ts';
import { DateTime } from 'luxon';

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
	if (booking.status !== 'Paid' && booking.status !== 'NoPaymentRequired') {
		customLog(
			`Booking ${bookingReference} has been skipped because it is not fully paid`,
			'WARN',
		);
		return;
	}

	// Loop through remaining items and process each booking if they are in the allowedPackages list
	const bookingItems = booking.items;
	const currentRollerItemIds = new Set<string>();

	for (const item of bookingItems) {
		let sync_status = 'Matched';
		let attraction = 'None';
		let booked_status = false;
		let logMessage = `Processing item ${item.bookingItemId} for booking ${bookingReference}...\n`;
		currentRollerItemIds.add(item.bookingItemId);
		const VRPackageConfig = allowedVRPackages.get(item.productId);
		const otherPackageConfig = allowedOtherPackages.get(item.productId);
		let packageConfig: any;

		if (!VRPackageConfig && !otherPackageConfig) {
			logMessage += `Item ${item.bookingItemId} with package ${item.productId} is not in the allowed packages list. Skipping this item.`;
			sync_status = 'Skipped';
			await saveSyncedItem(
				booking,
				item,
				null,
				false,
				{},
				attraction,
				null,
				null,
				null,
				sync_status,
			);
			customLog(logMessage, 'WARN');
			continue;
		}

		if (VRPackageConfig) {
			attraction = 'ZLVR';
			packageConfig = VRPackageConfig;
		}

		if (otherPackageConfig) {
			attraction = 'Other';
			packageConfig = otherPackageConfig;
		}

		const packageName = packageConfig.package_name;
		const zlPackageId = packageConfig.zl_id;
		const isoDate = convertToISO(item.bookingDate, item.sessionStartTime);
		let price = 0;
		if (booking.status !== 'NoPaymentRequired') {
			price =
				Math.round((item.cost * item.quantity - item.discount) * 100) / 100;
		}
		const isPriceTooLow = item.discount / item.quantity > item.cost / 2;

		// Vérifier si le booking existe déjà dans la base de données (Create or update)
		const dbItem = await getSyncedItem(bookingReference, item.bookingItemId);
		if (dbItem) {
			logMessage += `Found existing synced item for booking ${bookingReference} and item ${item.bookingItemId}. Updating the record and ZL session if necessary...\n`;

			booked_status = dbItem.zl_booked;
			// Si le booking existe déjà, vérifier si les détails ont changé (ex: nombre de joueurs, date, etc.) et mettre à jour la session ZL en conséquence
			if (
				dbItem.players !== item.quantity ||
				dbItem.start_time !== isoDate ||
				dbItem.roller_package_id !== item.productId
			) {
				if (booked_status) {
					await deleteZLSession(dbItem.zl_booking_id, booking.bookingReference);
				}

				const created = await createZLSession(
					item.bookingItemId,
					booking.bookingReference,
					dbItem.email,
					zlPackageId,
					isoDate,
					item.quantity,
					price,
				);
				if (created) {
					logMessage += `Updated ZL session for booking ${bookingReference} and item ${item.bookingItemId} due to changes in booking details.\n`;
					booked_status = true;
				} else {
					logMessage += `Unable to create ZL session for booking ${bookingReference} and item ${item.bookingItemId}.\n`;
					customLog(logMessage, 'ERROR');
					logMessage = '';
					sync_status = 'Error';

					sendEmail(config.email.dev_email, 2, {
						bookingReference: bookingReference,
						startDate: item.bookingDate,
						startTime: item.sessionStartTime,
						email: dbItem.email,
						packageName: packageName,
						quantity: item.quantity,
					});
					sendEmail(config.email.info_email, 2, {
						bookingReference: bookingReference,
						startDate: item.bookingDate,
						startTime: item.sessionStartTime,
						email: dbItem.email,
						packageName: packageName,
						quantity: item.quantity,
					});
				}

				// Update the record in the database with the new details
				await saveSyncedItem(
					booking,
					item,
					created,
					packageConfig,
					attraction,
					booked_status,
					dbItem.email,
					isoDate,
					price,
					sync_status,
				);
				logMessage += `Updated synced item for booking ${bookingReference} and item ${item.bookingItemId}.\n`;

				if (isPriceTooLow || booking.status === 'NoPaymentRequired') {
					logMessage += `Discount too high detected. Sending an email alert to justify the session in portal.`;
					sendEmail(config.email.admin_email, 1, {
						bookingReference: bookingReference,
						startDate: item.bookingDate,
						startTime: item.sessionStartTime,
					});
				}
				customLog(logMessage, 'INFO');
			} else {
				sync_status = 'Skipped';
				await saveSyncedItem(
					booking,
					item,
					dbItem.zl_booking_id,
					packageConfig,
					attraction,
					booked_status,
					dbItem.email,
					isoDate,
					price,
					sync_status,
				);
				logMessage += `No changes detected for booking ${bookingReference} and item ${item.bookingItemId}. No update needed for ZL session.\n`;
				customLog(logMessage, 'INFO');
			}
		} else {
			logMessage += `No existing synced item found for booking ${bookingReference} and item ${item.bookingItemId}. Creating new record and ZL session...\n`;
			const email: string = await getCustomerEmail(booking.customerId);

			const created = await createZLSession(
				item.bookingItemId,
				booking.bookingReference,
				email,
				zlPackageId,
				isoDate,
				item.quantity,
				price,
			);

			if (created) {
				logMessage += `Created ZL session for booking ${bookingReference} and item ${item.bookingItemId}.\n`;
				booked_status = true;
			} else {
				logMessage += `Unable to create ZL session for booking ${bookingReference} and item ${item.bookingItemId}.\n`;
				customLog(logMessage, 'ERROR');
				logMessage = '';
				sync_status = 'Error';

				sendEmail(config.email.dev_email, 2, {
					bookingReference: bookingReference,
					startDate: item.bookingDate,
					startTime: item.sessionStartTime,
					email: email,
					packageName: packageName,
					quantity: item.quantity,
				});
				sendEmail(config.email.info_email, 2, {
					bookingReference: bookingReference,
					startDate: item.bookingDate,
					startTime: item.sessionStartTime,
					email: email,
					packageName: packageName,
					quantity: item.quantity,
				});
			}

			// Save into DB
			await saveSyncedItem(
				booking,
				item,
				created,
				packageConfig,
				attraction,
				booked_status,
				email,
				isoDate,
				price,
				sync_status,
			);
			logMessage += `Created synced item for booking ${bookingReference} and item ${item.bookingItemId}.`;

			if (isPriceTooLow || booking.status === 'NoPaymentRequired') {
				logMessage += `\nDiscount too high detected. Sending an email alert to justify the session in portal.`;
				sendEmail(config.email.admin_email, 1, {
					bookingReference: bookingReference,
					startDate: item.bookingDate,
					startTime: item.sessionStartTime,
				});
			}
			customLog(logMessage, 'INFO');
		}
	}
	await cancelDeletedItems(booking.bookingReference, currentRollerItemIds);
}

async function cancelDeletedItems(
	bookingReference: string,
	currentRollerItemIds: Set<string>,
) {
	customLog('Processing missing items.', 'WARN');
	const str = [...currentRollerItemIds].join(", ");
	customLog(str, 'WARN');
	const existingRows = await getSyncedItems(bookingReference);

	for (const row of existingRows) {
		const rollerItemId = String(row.roller_item_id);

		if (currentRollerItemIds.has(rollerItemId)) {
			continue;
		}

		if (!row.zl_booked) {
			customLog(
				`Item ${rollerItemId} no longer exists in ROLLER, but has no ZL booking ID to cancel.`,
				'WARN',
			);

			await updateSyncedItemStatus(
				bookingReference,
				rollerItemId,
				'Cancelled',
				false,
			);

			continue;
		}

		try {
			customLog(
				`Item ${rollerItemId} was removed from ROLLER booking ${bookingReference}. Cancelling ZL booking ${row.zl_booking_id}...`,
				'WARN',
			);

			await deleteZLSession(row.zl_booking_id, bookingReference);

			await updateSyncedItemStatus(
				bookingReference,
				rollerItemId,
				'Cancelled',
				false,
			);

			customLog(
				`Cancelled ZL booking ${row.zl_booking_id} for removed ROLLER item ${rollerItemId}`,
				'INFO',
			);
		} catch (err) {
			await updateSyncedItemStatus(
				bookingReference,
				rollerItemId,
				'Error',
				false,
			);

			customLog(
				`Failed to cancel ZL booking ${row.zl_booking_id} for removed ROLLER item ${rollerItemId}: ${String(err)}`,
				'ERROR',
			);
		}
	}
}

function convertToISO(date: string, time: string) {
	return `${date}T${time}:00.000`;
}
