// Entry point. Flags: --once (one cycle per source, then exit), --dry-run (no DB writes),
// --olx / --vinted (only that source), --test-push (send a test notification, then exit).
import type { Source } from "@dh/shared";
import { getWatches, loadConfig, watchConfig } from "./config.js";
import { sendPush } from "./push.js";
import { SourceLoop } from "./scheduler.js";
import { closeOlx } from "./sources/olx.js";
import { startHeartbeat, VERSION, writeStatus } from "./status.js";
import { errorText, flags, log } from "./util.js";

const args = new Set(process.argv.slice(2));
flags.dryRun = args.has("--dry-run");
const sources: Source[] = args.has("--olx") ? ["olx"] : args.has("--vinted") ? ["vinted"] : ["olx", "vinted"];

if (args.has("--test-push")) {
  const r = await sendPush("test", { title: "Push de teste do worker ✅", body: "O worker consegue enviar notificações.", url: "/", tag: "test" });
  log(`push de teste: ${r.ok} ok, ${r.failed} falharam${r.error ? ` — ${r.error}` : ""}`);
  process.exit(r.ok ? 0 : 1);
}

await loadConfig();
log(`worker ${VERSION}: ${sources.join(" + ")}, ${getWatches().length} pesquisas ativas${flags.dryRun ? ", dry-run" : ""}`);

if (args.has("--once")) {
  for (const s of sources) await new SourceLoop(s).once();
  await closeOlx();
  process.exit(0);
}

const stopHeartbeat = startHeartbeat();
const stopConfig = watchConfig();
for (const s of sources) {
  new SourceLoop(s).run().catch(async (e) => {
    log(`${s}: ciclo terminou com erro — ${errorText(e)}`);
    await writeStatus({ last_error: `${s}: ${errorText(e)}`, last_error_at: new Date().toISOString() });
    process.exit(1); // pm2 restarts the worker
  });
}

async function shutdown(signal: string) {
  log(`${signal}: a terminar`);
  stopHeartbeat();
  stopConfig();
  await closeOlx();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
