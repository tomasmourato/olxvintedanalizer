// Entry point. Flags: --once (one cycle per source, then exit), --dry-run (no DB writes),
// --olx / --vinted (only that source).
import type { Source } from "@dh/shared";
import { getWatches, loadConfig, watchConfig } from "./config.js";
import { SourceLoop } from "./scheduler.js";
import { closeOlx } from "./sources/olx.js";
import { startHeartbeat, VERSION, writeStatus } from "./status.js";
import { errorText, flags, log } from "./util.js";

const args = new Set(process.argv.slice(2));
flags.dryRun = args.has("--dry-run");
const sources: Source[] = args.has("--olx") ? ["olx"] : args.has("--vinted") ? ["vinted"] : ["olx", "vinted"];

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
