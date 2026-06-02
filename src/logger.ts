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

type LogPriority = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export function customLog(message: string, type: LogPriority = 'INFO') {
	const date = new Date();
	const timestamp = formatDate(date);
	message = message.replaceAll('\n', '\n\t\t\t\t\t(' + type + ')\t');
	message = `${timestamp} (${type})\t${message}`;
	console.log(message);
	appendFile(`server-${formatDate(date, false)}.log`, `${message}\n`);
}

function padTo2Digits(num: number) {
	return num.toString().padStart(2, '0');
}

function formatDate(date: Date, includeHours = true) {
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
