// LOGGING FUNCTION
// Usage: customLog("This is a log message", "OK" | "ERROR" | "WARN")
//
// Si aucun type n'est spécifié, "OK" est utilisé par défaut.
// vvv
// [2024-06-01 12:00:00] (OK)   This is a log message
//
// Utilise \n pour plusieurs ligne avec le même timestamp
// Si plusieurs lignes sont utilisées, le type est appliqué à toutes les lignes
// Exemple: customLog("This is a log message\nThis is another line", "ERROR")
// vvv
// [2024-06-01 12:00:00] (ERROR) This is a log message
//                       (ERROR) This is another line

import { appendFile } from "node:fs/promises";

export function customLog(message: string, type: "OK" | "ERROR" | "WARN" = "OK") {
  const timestamp = formatDate(new Date());
  message = message.replaceAll("\n", '\n\t\t\t\t\t(' + type + ')\t');
  appendFile("server.log", `${timestamp} (${type})\t${message}\n`);
}

function padTo2Digits(num: number) {
  return num.toString().padStart(2, '0');
}

function formatDate(date: Date) {
  return (
    [
      date.getFullYear(),
      padTo2Digits(date.getMonth() + 1),
      padTo2Digits(date.getDate()),
    ].join('-') +
    ' ' +
    [
      padTo2Digits(date.getHours()),
      padTo2Digits(date.getMinutes()),
      padTo2Digits(date.getSeconds()),
    ].join(':')
  );
}