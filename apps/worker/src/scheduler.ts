// One loop per source, one request at a time: category firehose + rotating site-wide searches + the categories of
// "Prioridade" watches on a short interval, jittered intervals, exponential backoff and an automatic pause after repeated blocks.
import type { Source, Watch } from "@dh/shared";
import { getSettings, getWatches } from "./config.js";
import { searchTerms } from "./pipeline/match.js";
import { processBatch } from "./pipeline/process.js";
import { fetchCategory, resetOlx, searchOlx } from "./sources/olx.js";
import { BlockedError, type FetchResult } from "./sources/types.js";
import { fetchCatalogs, searchVinted } from "./sources/vinted.js";
import { logRun, reportError, scopeKnown, writeStatus } from "./status.js";
import { errorText, isActive, jitter, log, sleep } from "./util.js";

type Job = { kind: "category" | "search"; scope: string; run: () => Promise<FetchResult> };

const MAX_FAILURES = 3;
const PAUSE_MS = 20 * 60_000;
const GAP_MS = 3_000; // between the requests of one category cycle
/** How often the categories of a watch with "Prioridade" on (priority_until in the future) are read. */
const PRIORITY_MS: Record<Source, number> = { vinted: 10_000, olx: 15_000 };

const priorityWatches = (source: Source) => {
  const now = Date.now();
  return getWatches().filter((w) => w.priority_until != null && Date.parse(w.priority_until) > now && w.sources.includes(source));
};

export class SourceLoop {
  private nextCategory = 0;
  private nextSearch = Date.now() + 20_000;
  private nextPriority = 0;
  private rotation = 0;
  private priorityRotation = 0;
  private failures = 0;
  private holdUntil = 0;
  private paused = false;
  private knownScopes = new Set<string>();

  constructor(readonly source: Source) {}

  private categoryJobs(): Job[] {
    const s = getSettings();
    if (this.source === "vinted") {
      const ids = s.vinted_catalogs;
      return ids.length ? [{ kind: "category", scope: ids.join(","), run: () => fetchCatalogs(ids) }] : [];
    }
    return s.olx_categories.map((id) => ({ kind: "category", scope: String(id), run: () => fetchCategory(id) }));
  }

  private searchJob(): Job | null {
    const terms = searchTerms(getWatches(), this.source);
    if (!terms.length) return null;
    const t = terms[this.rotation++ % terms.length];
    const scope = t.catalogIds.length ? `${t.term} [${t.catalogIds.join(",")}]` : t.term;
    return {
      kind: "search",
      scope,
      run: () => (this.source === "olx" ? searchOlx(t.term) : searchVinted(t.term, t.catalogIds)),
    };
  }

  /** Priority watches: their categories, plus one of the words of those without categories (in rotation). */
  private priorityJobs(): Job[] {
    const vinted = this.source === "vinted";
    const ws = priorityWatches(this.source);
    const cats = (w: Watch) => (vinted ? w.vinted_catalog_ids : w.olx_category_ids);
    const ids = [...new Set(ws.flatMap(cats))];
    const jobs: Job[] = vinted
      ? ids.length
        ? [{ kind: "category", scope: ids.join(","), run: () => fetchCatalogs(ids) }]
        : []
      : ids.map((id) => ({ kind: "category", scope: String(id), run: () => fetchCategory(id) }));
    const terms = searchTerms(
      ws.filter((w) => !cats(w).length).map((w) => ({ ...w, search_remote: true })),
      this.source,
    );
    if (terms.length) {
      const t = terms[this.priorityRotation++ % terms.length];
      jobs.push({ kind: "search", scope: t.term, run: () => (vinted ? searchVinted(t.term) : searchOlx(t.term)) });
    }
    return jobs;
  }

  private intervals() {
    const s = getSettings();
    return this.source === "olx"
      ? { category: s.olx_interval_s * 1000, search: s.olx_search_interval_s * 1000 }
      : { category: s.vinted_interval_s * 1000, search: s.vinted_search_interval_s * 1000 };
  }

  /** Runs one request end to end. Returns false on failure (already logged). */
  private async exec(job: Job): Promise<boolean> {
    const started_at = new Date().toISOString();
    const base = { source: this.source, kind: job.kind, scope: job.scope, started_at };
    try {
      const r = await job.run();
      if (r.error) throw new Error(r.error);
      const key = `${job.kind}:${job.scope}`;
      // First fetch of a scope ever (new search term, first run): store matches without announcing them.
      const silent = !this.knownScopes.has(key) && !(await scopeKnown(this.source, job.kind, job.scope));
      const { fresh, matches } = await processBatch(this.source, r.items, silent);
      this.knownScopes.add(key);
      logRun({ ...base, status: "ok", http_status: r.status, duration_ms: r.ms, items_read: r.items.length, items_new: fresh, matches });
      log(`${this.source} ${job.kind} ${job.scope}: ${r.items.length} lidos, ${fresh} novos, ${matches} matches (${r.ms} ms)`);
      this.failures = 0;
      return true;
    } catch (e) {
      const blocked = e instanceof BlockedError;
      logRun({ ...base, status: blocked ? "blocked" : "error", http_status: blocked ? e.status : null, error: errorText(e) });
      log(`${this.source} ${job.kind} ${job.scope}: ${blocked ? "BLOQUEADO" : "erro"} — ${errorText(e)}`);
      reportError(this.source, e);
      await this.onFailure();
      return false;
    }
  }

  private async onFailure(): Promise<void> {
    this.failures++;
    if (this.failures >= MAX_FAILURES) {
      const until = new Date(Date.now() + jitter(PAUSE_MS, 0.25));
      this.holdUntil = until.getTime();
      this.paused = true;
      this.failures = 0;
      log(`${this.source}: em pausa até ${until.toISOString()}`);
      await writeStatus({ [`${this.source}_paused_until`]: until.toISOString() });
      if (this.source === "olx") await resetOlx();
    } else {
      this.holdUntil = Date.now() + 60_000 * 2 ** (this.failures - 1); // 1 min, 2 min
    }
  }

  private async categoryCycle(jobs = this.categoryJobs()): Promise<void> {
    for (const [i, job] of jobs.entries()) {
      if (!(await this.exec(job))) return;
      if (i < jobs.length - 1) await sleep(jitter(GAP_MS));
    }
  }

  /** `--once`: one category cycle and one search, regardless of the active hours. */
  async once(): Promise<void> {
    await this.categoryCycle();
    const search = this.searchJob();
    if (search) await this.exec(search);
  }

  async run(): Promise<never> {
    for (;;) {
      const s = getSettings();
      const now = Date.now();
      if (!isActive(s.active_from, s.active_to, s.timezone)) {
        await sleep(60_000);
        continue;
      }
      if (now < this.holdUntil) {
        await sleep(Math.min(this.holdUntil - now, 30_000));
        continue;
      }
      if (this.paused) {
        this.paused = false;
        await writeStatus({ [`${this.source}_paused_until`]: null });
      }

      const hasSearch = searchTerms(getWatches(), this.source).length > 0;
      const hasPriority = priorityWatches(this.source).length > 0;
      const due = Math.min(this.nextCategory, hasSearch ? this.nextSearch : Infinity, hasPriority ? this.nextPriority : Infinity);
      if (due > now) {
        await sleep(Math.min(due - now, 30_000)); // wake up regularly so config changes apply
        continue;
      }
      const { category, search } = this.intervals();
      if (hasPriority && this.nextPriority <= due) {
        await this.categoryCycle(this.priorityJobs());
        this.nextPriority = Date.now() + jitter(PRIORITY_MS[this.source]);
      } else if (this.nextCategory <= due) {
        await this.categoryCycle();
        this.nextCategory = Date.now() + jitter(category);
      } else {
        const job = this.searchJob();
        if (job) await this.exec(job);
        this.nextSearch = Date.now() + jitter(search);
      }
    }
  }
}
