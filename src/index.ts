import { customLog } from "./logger.ts";
import { parse } from "yaml";

const configFile = Bun.file("config.yaml");
const configContent = await configFile.text();
const config = parse(configContent);
console.log(config);

const server = Bun.serve({
  hostname: config.server.host,
  port: config.server.port,

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/status") {
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/webhooks/roller" && req.method === "POST") {
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

    }

    return new Response("Not Found", { status: 404 });
  },


});

async function handleWebhook(payload: any) {
        // Todo : Logique de traitement du webhook
      }

customLog(`Server started at ${server.url}`);
