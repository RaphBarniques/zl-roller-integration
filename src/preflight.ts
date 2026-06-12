import { Database } from 'bun:sqlite';
import { parse } from 'yaml';
import { customLog } from './logger.ts';

const DB_PATH = 'sync.db';
const dbExists = await Bun.file(DB_PATH).exists();
export const db = new Database(DB_PATH);
export let allowedPackages: Map<number, PackageConfig> = new Map();

type AppConfig = {
	server: {
		host: string;
		port: number;
	};
	zl: {
		api_base_url: string;
		site_id: number;
	};
	email: {
		admin_email: any;
		info_email: any;
		dev_email: any;
	};
	packages: PackageConfig[];
};

type PackageConfig = {
	package_name: string;
	roller_id: number;
	zl_id: number;
};

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
      roller_item_id TEXT NOT NULL,
      zl_booking_id TEXT,
      payment_status TEXT,
      sync_status TEXT NOT NULL,

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

	db.run(`
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT,
    booking_reference TEXT,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
		const configFile = Bun.file('config.yaml');
		const configContent = await configFile.text();
		config = parse(configContent) as AppConfig;
	} catch (error) {
		customLog('Failed to load config.yaml\nShutting down...', 'ERROR');
		process.exit(1);
	}

	if (config != null) {
		logMessage += 'Config loaded successfully';
		allowedPackages = new Map(
			config.packages.map((pkg) => [pkg.roller_id, pkg]),
		);
		customLog(logMessage);
	} else {
		customLog('Config file is empty', 'ERROR');
		process.exit(1);
	}
}

// --ENVIRONMENT INITIALIZATION--

export async function initEnv() {
	let logMessage: string = 'Loading environment variables...\n';

	const envFileExists = await Bun.file('.env').exists();

	if (envFileExists) {
		logMessage += 'Environment file loaded successfully';
		customLog(logMessage);
	} else {
		customLog('Environment file not found', 'ERROR');
		process.exit(1);
	}
}

const nodemailer = require('nodemailer');
export let transporter: any;

export async function initMailer() {
	let logMessage: string = 'Initializing mailer...\n';

	// Create a transporter using SMTP
	transporter = nodemailer.createTransport({
		host: process.env.MAILER_HOST,
		port: parseInt(process.env.MAILER_PORT || '0', 10),
		secure: true, // use SSL/TLS
		auth: {
			user: process.env.MAILER_USER,
			pass: process.env.MAILER_PASS,
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
