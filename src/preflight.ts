import { parse } from "yaml";
import { Database } from "bun:sqlite";
import { customLog } from "./logger";

const DB_PATH = "sync.db";
const dbExists = await Bun.file(DB_PATH).exists();
export const db = new Database(DB_PATH);


// --DATABASE INITIALIZATION--
export async function initDb() {

  let logMessage : string = "Initializing database...\n";

  if (dbExists) {
    logMessage += "Found database\n";
  } else {
    logMessage += "Created database\n";
  }


  const tableExists = db
    .query(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      AND name='synced_items'
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

      last_signature TEXT,
      message TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (
        roller_booking_id,
        roller_item_id
      )
    )
  `);


  if (tableExists) {
    logMessage += "Found table: synced_items\n";
  } else {
    logMessage += "Created table: synced_items\n";
  }

  logMessage += "Database ready";
  customLog(logMessage);
}


// --CONFIG INITIALIZATION--

export let config : any = null;

export async function initConfig() {

  let logMessage : string = "Loading config...\n";

  try {
    const configFile = Bun.file("config.yaml");
    const configContent = await configFile.text();
    config = parse(configContent);
  } catch (error) {
    customLog("Failed to load config.yaml\nShutting down...", "ERROR");
    process.exit(1);
  }

if (config != null) {
    logMessage += "Config loaded successfully";
    customLog(logMessage);
  } else {
    customLog("Config file is empty", "ERROR");
    process.exit(1);
  }

}

// --ENVIRONMENT INITIALIZATION--

export async function initEnv() {

  let logMessage : string = "Loading environment variables...\n";

  const envFileExists = await Bun.file(".env").exists();

  if (envFileExists) {

    logMessage += "Environment file loaded successfully";
    customLog(logMessage);
  } else {
    customLog("Environment file not found", "ERROR");
    process.exit(1);
  }
}
