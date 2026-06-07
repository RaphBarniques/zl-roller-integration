export {};

// Todo : Envoyer des mails d'alertes pour les cas où une action manuelle est requise (prix à 0, échec de booking, etc.)
async function sendEmail(
	email: string,
	type: number,
	infos: { [key: string]: any },
) {
	// Todo : Implémenter la logique d'envoi d'email
	// Type 1 : Prix à 0, besoin d'explicatif manuel
	// Type 2 : Échec de booking, besoin d'intervention manuelle
	// etc.
}
