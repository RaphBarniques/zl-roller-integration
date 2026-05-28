import { customLog } from "./logger.ts";
import { initDb, initConfig, db, config, initEnv} from "./preflight.ts";
import chain from "./middleware/middleware.ts";
import logging from "./middleware/req_logging.ts";

customLog("-------------------------------------------------");
customLog("ZL-ROLLER-INTEGRATION v0.1.0 - Starting server...");

await initDb();
await initConfig();
await initEnv();

const server = Bun.serve({
  hostname: config.server.host,
  port: config.server.port,
  routes: {
    "/status": chain([logging], async (req) => {
      return new Response("OK", { status: 200 });
    }),
    "/webhooks/roller": {
      POST: chain([logging], async (req) => {
        const url = new URL(req.url);
        const secret = url.searchParams.get("secret");

        if (secret !== Bun.env.ROLLER_WEBHOOK_SECRET) {
          customLog(`Unauthorized webhook access attempt`, "WARN");
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: any;
        try {
          payload = await req.json();
        } catch {
          customLog(`Rejected webhook, invalid JSON payload`, "ERROR");
          return new Response("Bad Request", { status: 400 });
        }

        // Todo : Ajouter l'ID et le type de request dans le log
        customLog(`Received webhook from ROLLER with ID: id and type: type`);

        await handleWebhook(payload);

        return new Response("OK", { status: 200 });
      }),
    },
  },

  fetch(req) {
    customLog(`${req.method} ${req.url}`);
    return new Response("Not Found", { status: 404 });
  },
});

async function handleWebhook(payload: any) {
  // Todo : Logique de traitement du webhook
}

customLog(`Listening for webhooks at ${server.url}`);
