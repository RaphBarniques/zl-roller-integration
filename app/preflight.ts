import { Database } from 'bun:sqlite';
import { parse } from 'yaml';
import { customLog } from './utils/logger.ts';

const DB_PATH = './db/sync.db';
const dbExists = await Bun.file(DB_PATH).exists();
export const db = new Database(DB_PATH);
export let allowedVRPackages: Map<number, PackageConfig> = new Map();
export let allowedOtherPackages: Map<number, PackageConfig> = new Map();

type AppConfig = {
	server: {
		host: string;
		port: number;
	};
	venue: {
		location: string;
		timezone: string;
		integration_start_date?: string;
		attractions: AttractionConfig[];
	};
	zl: {
		api_base_url: string;
		site_id: number;
	};
	roller: {
		api_base_url: string;
	};
	email: {
		admin_email: any;
		info_email: any;
		dev_email: any;
	};
	vr_packages: PackageConfig[];
	other_packages: PackageConfig[];
};

export type PackageConfig = {
	package_name: string;
	roller_ids: number[];
	zl_id: number;
	attraction?: string;
	private?: boolean;
};

export type AttractionConfig = {
	name: string;
	gamespace: number;
};

function getTimeZoneOffsetMs(atUtcMs: number, timeZone: string) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(new Date(atUtcMs));

	const map: Record<string, string> = {};
	for (const part of parts) {
		if (part.type !== 'literal') {
			map[part.type] = part.value;
		}
	}

	const asIfUtc = Date.UTC(
		Number(map.year),
		Number(map.month) - 1,
		Number(map.day),
		Number(map.hour),
		Number(map.minute),
		Number(map.second),
	);

	return asIfUtc - atUtcMs;
}

function localDateTimeInTimeZoneToUtcMs(dateTime: string, timeZone: string) {
	const match = dateTime.match(
		/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
	);
	if (!match) {
		return Number.NaN;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4] ?? '0');
	const minute = Number(match[5] ?? '0');
	const second = Number(match[6] ?? '0');

	const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
	const offset1 = getTimeZoneOffsetMs(utcGuess, timeZone);
	let resolved = utcGuess - offset1;

	const offset2 = getTimeZoneOffsetMs(resolved, timeZone);
	if (offset2 !== offset1) {
		resolved = utcGuess - offset2;
	}

	return resolved;
}

export function parseIntegrationStartTimestamp(
	value: string,
	timeZone?: string,
) {
	const trimmed = value.trim();
	if (!trimmed) {
		return Number.NaN;
	}

	const hasExplicitOffset = /([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed);
	if (hasExplicitOffset) {
		return Date.parse(trimmed);
	}

	if (timeZone) {
		try {
			return localDateTimeInTimeZoneToUtcMs(trimmed, timeZone);
		} catch {
			// fallback below
		}
	}

	return Date.parse(trimmed);
}

// --DATABASE INITIALIZATION--
export async function initDb() {
	let logMessage: string = 'Initializing database...\n';

	if (dbExists) {
		logMessage += 'Found database\n';
	} else {
		logMessage += 'Created database\n';
	}

	const itemTableExists = db
		.query(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      AND name='synced_items'
    `)
		.get();

	const eventTableExists = db
		.query(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      AND name='processed_events'
    `)
		.get();

	db.run(`
    CREATE TABLE IF NOT EXISTS synced_items (
      roller_booking_id TEXT NOT NULL,
	roller_booking_unique_id TEXT,
      roller_item_id TEXT NOT NULL,
      zl_booking_id TEXT,
	  attraction TEXT,
      payment_status TEXT,
      sync_status TEXT NOT NULL,
	  zl_booked BOOLEAN,
      email TEXT,
      players INTEGER,
      start_time TEXT,
      roller_package_id INTEGER,
      zl_package_id INTEGER,
      package_name TEXT,
      price REAL,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        roller_booking_id,
        roller_item_id
      )
    )
  `);

	const syncedItemsColumns = db
		.query(`PRAGMA table_info(synced_items)`)
		.all() as Array<{ name: string }>;
	const hasBookingUniqueIdColumn = syncedItemsColumns.some(
		(column) => column.name === 'roller_booking_unique_id',
	);
	if (!hasBookingUniqueIdColumn) {
		db.run(`ALTER TABLE synced_items ADD COLUMN roller_booking_unique_id TEXT`);
		logMessage += 'Added column: synced_items.roller_booking_unique_id\n';
	}

	db.run(`
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT,
    booking_reference TEXT,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

	db.run(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

	db.run(`
  INSERT OR IGNORE INTO app_settings (key, value)
  VALUES ('queue_paused', '0')
`);

	db.run(`
  CREATE TABLE IF NOT EXISTS webhook_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    booking_reference TEXT,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

	if (itemTableExists) {
		logMessage += 'Found table: synced_items\n';
	} else {
		logMessage += 'Created table: synced_items\n';
	}

	if (eventTableExists) {
		logMessage += 'Found table: processed_events\n';
	} else {
		logMessage += 'Created table: processed_events\n';
	}

	logMessage += 'Database ready';
	customLog(logMessage);
}

// --CONFIG INITIALIZATION--

export let config: AppConfig;

export async function initConfig() {
	let logMessage: string = 'Loading config...\n';

	try {
		const configFile = Bun.file('./config/config.yaml');
		const configContent = await configFile.text();
		config = parse(configContent) as AppConfig;
	} catch (error) {
		customLog('Failed to load config.yaml\nShutting down...', 'ERROR');
		process.exit(1);
	}

	if (config != null) {
		logMessage += 'Config loaded successfully';
		allowedVRPackages = new Map();
		for (const pkg of config.vr_packages) {
			for (const rollerId of pkg.roller_ids) {
				allowedVRPackages.set(rollerId, pkg);
			}
		}
		for (const pkg of config.other_packages) {
			for (const rollerId of pkg.roller_ids) {
				allowedOtherPackages.set(rollerId, pkg);
			}
		}
		customLog(logMessage);
	} else {
		customLog('Config file is empty', 'ERROR');
		process.exit(1);
	}
}

// --ENVIRONMENT INITIALIZATION--

export async function initEnv() {
	let logMessage: string = 'Loading environment variables...\n';

	const envFile = Bun.file('./config/.env');
	const envFileExists = await envFile.exists();

	if (!envFileExists) {
		customLog('Environment file not found', 'ERROR');
		process.exit(1);
	}

	const envText = await envFile.text();
	for (const line of envText.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		process.env[key] = value;
	}

	logMessage += 'Environment file loaded successfully';
	customLog(logMessage);
}

const nodemailer = require('nodemailer');
export let transporter: any;

export async function initMailer() {
	let logMessage: string = 'Initializing mailer...\n';

	// Create a transporter using SMTP
	transporter = nodemailer.createTransport({
		host: Bun.env.MAILER_HOST,
		port: parseInt(Bun.env.MAILER_PORT || '0', 10),
		secure: false, // use SSL/TLS
		auth: {
			user: Bun.env.MAILER_USER,
			pass: Bun.env.MAILER_PASS,
		},
	});

	try {
		await transporter.verify();
		logMessage += 'Mailer initialized successfully';
		customLog(logMessage);
	} catch (err) {
		logMessage += `Failed to initialize mailer: ${err}`;
		customLog(logMessage, 'ERROR');
	}
}
