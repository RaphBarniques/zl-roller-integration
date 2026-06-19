import { transporter } from './preflight.ts';
// Todo : Envoyer des mails d'alertes pour les cas où une action manuelle est requise (prix à 0, échec de booking, etc.)
export async function sendEmail(
	email: string,
	type: number,
	infos: { [key: string]: any },
) {
	// Todo : Implémenter la logique d'envoi d'email
	// Type 1 : Prix à 0, besoin d'explicatif manuel
	// Type 2 : Échec de booking, besoin d'intervention manuelle
	// etc.

	let subject: string = '';
	let text: string = '';

	if (!email) {
		return;
	}

	switch (type) {
		case 1:
			subject = `Justification requise pour le booking ${infos.bookingReference}`;
			text = `Bonjour,\n\nLe booking ZL ${infos.bookingReference} du ${infos.startDate} à ${infos.startTime} a bien été créé mais il se pourrait qu'un justificatif de prix soit requis.\n\nMerci.`;
			// Envoyer un email pour demander un explicatif manuel
			break;
		case 2:
			subject = `Échec de booking ${infos.bookingReference}`;
			text = `Bonjour,\n\nNous avons rencontré un problème lors de la réservation du booking ZL ${infos.bookingReference}. \nMerci de créer la session manuellement.\n\nRoller booking ID: ${infos.bookingReference}\nEmail: ${infos.email}\nDate et heure: ${infos.startDate} à ${infos.startTime}\nPackage: ${infos.packageName}\nJoueurs: ${infos.quantity}\n\nMerci.`;
			// Envoyer un email pour signaler un échec de booking
			break;
		default:
			subject = `Message de l'intégration Roller-ZL`;
			text = `Bonjour,\n\nVoici un message de l'intégration Roller-ZL : ${infos.message}\n\nMerci.`;
			break;
	}

	await transporter.sendMail({
		from: 'alerts@zlintegration.com',
		to: email,
		subject: subject,
		text: text,
	});
}
