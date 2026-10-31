import { env } from "./config";
import { buildApp } from "./app";

const { app, db } = await buildApp({ logger: true });

// Investigations interrupted by a restart are marked resumable rather than left "running" forever.
for (const inv of db.listInvestigations()) {
  if (inv.status === "running") db.saveInvestigation({ ...inv, status: "cancelled", error: "Server restarted during analysis. Resume to continue." });
}

try {
  await app.listen({ port: env.port, host: env.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
