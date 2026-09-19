// Script: getCustomerInfo.ts
//
// Fetches all game results for today, then retrieves player info for each
// participant, sends to Patch API to create/update contacts, and writes a
// formatted report to scripts/getCustomerInfo/output.txt
//
// Usage: bun scripts/getCustomerInfo.ts

import { initConfig, initEnv } from '../app/preflight.ts';
import { getGameResults, getGameResult, getPlayerInfo } from '../app/api/zlAPI.ts';
import { createOrUpdatePatchContact, type PatchContactPayload } from '../app/api/patchAPI.ts';
import * as path from 'node:path';
import * as fs from 'node:fs';

// --TYPES--

type GameResultSummary = {
	GameResultId: number;
	GameName: string;
	StartTime: string;
	EndTime: string;
	PlayerCount: number;
	IsPvp: boolean;
	SessionDateTimeLocal: string;
};

type CoopPlayerStat = {
	Player?: {
		PlayerGuid?: string;
	};
};

type PvpPlayerStat = {
	PlayerGuid?: string;
};

type GameResultDetail = {
	GameResultId?: number;
	GameName?: string;
	StartTime?: string;
	EndTime?: string;
	PlayerCount?: number;
	TeamScore?: number;
	IsPvp?: boolean;
	SessionId?: number;
	SessionDateTimeLocal?: string;
	CoopGameStats?: CoopPlayerStat[];
	PvpGameStats?: {
		ContextPlayerStats?: PvpPlayerStat[];
	};
};

type PlayerInfo = {
	PlayerId?: number;
	PlayerGuid?: string;
	DisplayName?: string;
	FirstName?: string;
	LastName?: string;
	FullName?: string;
	FallbackName?: string;
	Email?: string;
	PhoneNumber?: string;
	DateOfBirth?: string;
	Gender?: string;
	Postcode?: string;
	KnownPlayer?: boolean;
};

// --HELPERS--

function formatDate(iso: string | undefined): string {
	if (!iso) return 'N/A';
	return new Date(iso).toLocaleString('en-CA', { timeZone: 'UTC', hour12: false });
}

function playerName(p: PlayerInfo): string {
	return p.FullName?.trim() || p.FallbackName?.trim() || `${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim() || p.DisplayName?.trim() || p.PlayerGuid || 'Unknown';
}

function line(char = '-', length = 60): string {
	return char.repeat(length);
}

// --MAIN--

await initConfig();
await initEnv();

const useToday = false;

let fromDate: string;
let toDate: string;

if (useToday) {
	const today = new Date();
	const yyyy = today.getUTCFullYear();
	const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(today.getUTCDate()).padStart(2, '0');
	fromDate = `${yyyy}-${mm}-${dd}T00:00:00Z`;
	toDate = `${yyyy}-${mm}-${dd}T23:59:59Z`;
} else {
	// Set custom date range here
	fromDate = '2026-07-06T00:00:00Z';
	toDate = '2026-07-06T23:59:59Z';
}

console.log(`Fetching game results for ${fromDate} to ${toDate}...`);

const rawResults = await getGameResults(fromDate, toDate);

if (!rawResults || rawResults === false) {
	console.error('Failed to fetch game results. Exiting.');
	process.exit(1);
}

const gameResultList = (Array.isArray(rawResults) ? rawResults : [rawResults]) as GameResultSummary[];

if (gameResultList.length === 0) {
	console.log('No game results found for today.');
	process.exit(0);
}

console.log(`Found ${gameResultList.length} game result(s). Fetching player details...`);

const outputLines: string[] = [];

outputLines.push(line('='));
outputLines.push(`PLAYER REPORT — ${fromDate} to ${toDate}`);
outputLines.push(`Generated: ${new Date().toUTCString()}`);
outputLines.push(`Total sessions: ${gameResultList.length}`);
outputLines.push(line('='));
outputLines.push('');

for (const summary of gameResultList) {
	const detail = (await getGameResult(String(summary.GameResultId))) as GameResultDetail | false;

	if (!detail) {
		outputLines.push(`[WARN] Could not fetch details for GameResultId ${summary.GameResultId}`);
		outputLines.push('');
		continue;
	}

	// Game header
	outputLines.push(line('-'));
	outputLines.push(`GAME: ${summary.GameName}`);
	outputLines.push(`  Date     : ${formatDate(summary.SessionDateTimeLocal)}`);
	outputLines.push(`  Start    : ${formatDate(summary.StartTime)}`);
	outputLines.push(`  End      : ${formatDate(summary.EndTime)}`);
	outputLines.push(`  Players  : ${summary.PlayerCount}`);
	outputLines.push('');

	// Collect player GUIDs
	const playerGuids: string[] = [];

	if (!summary.IsPvp && detail.CoopGameStats) {
		for (const stat of detail.CoopGameStats) {
			const guid = stat.Player?.PlayerGuid;
			if (guid && !playerGuids.includes(guid)) {
				playerGuids.push(guid);
			}
		}
	} else if (summary.IsPvp && detail.PvpGameStats?.ContextPlayerStats) {
		for (const stat of detail.PvpGameStats.ContextPlayerStats) {
			const guid = stat.PlayerGuid;
			if (guid && !playerGuids.includes(guid)) {
				playerGuids.push(guid);
			}
		}
	}

	if (playerGuids.length === 0) {
		outputLines.push('  No player GUIDs found for this session.');
		outputLines.push('');
		continue;
	}

	outputLines.push(`  PLAYERS (${playerGuids.length}):`);

	for (const guid of playerGuids) {
		const info = (await getPlayerInfo(guid)) as PlayerInfo | false;

		if (!info) {
			outputLines.push(`    ${line('·', 40)}`);
			outputLines.push(`    GUID     : ${guid}`);
			outputLines.push('    [Could not fetch player info]');
			continue;
		}

		// Send player info to Patch API
		const patchPayload: PatchContactPayload = {
			email: info.Email || undefined,
			first_name: info.FirstName || undefined,
			last_name: info.LastName || undefined,
			phone: info.PhoneNumber || undefined,
			gender: info.Gender || undefined,
			date_of_birth: info.DateOfBirth || undefined,
			postal_code: info.Postcode || undefined,
			custom_fields: {
				game_played: summary.GameName,
			},
		};

		const patchResult = await createOrUpdatePatchContact(patchPayload);
		if (!patchResult) {
			outputLines.push(`    ${line('·', 40)}`);
			outputLines.push(`    Name     : ${playerName(info)}`);
			outputLines.push(`    [WARNING] Failed to sync with Patch API`);
		} else {
			outputLines.push(`    ${line('·', 40)}`);
			outputLines.push(`    Name     : ${playerName(info)}`);
			outputLines.push(`    GUID     : ${info.PlayerGuid ?? guid}`);
			outputLines.push(`    Email    : ${info.Email || 'N/A'}`);
			outputLines.push(`    Phone    : ${info.PhoneNumber || 'N/A'}`);
			outputLines.push(`    Gender   : ${info.Gender || 'N/A'}`);
			outputLines.push(`    DOB      : ${info.DateOfBirth ? formatDate(info.DateOfBirth) : 'N/A'}`);
			outputLines.push(`    Postcode : ${info.Postcode || 'N/A'}`);
			outputLines.push(`    Known    : ${info.KnownPlayer ? 'Yes' : 'No'}`);
		}
	}

	outputLines.push('');
}

outputLines.push(line('='));
outputLines.push('END OF REPORT');
outputLines.push(line('='));

// Write output
const outputDir = path.resolve('./scripts/getCustomerInfo');
if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

const safeFrom = fromDate.replace(/[:/\\?*|"<>]/g, '-');
const safeTo = toDate.replace(/[:/\\?*|"<>]/g, '-');
const outputPath = path.join(outputDir, `players_${safeFrom}_to_${safeTo}.txt`);
await Bun.write(outputPath, outputLines.join('\n'));

console.log(`Done. Report written to ${outputPath}`);
