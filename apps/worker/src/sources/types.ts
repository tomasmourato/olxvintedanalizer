import type { Insert, Source } from "@dh/shared";

/** A listing as read from a source, before it is stored. */
export type ScrapedListing = Omit<Insert<"listings">, "id" | "first_seen_at" | "previous_price" | "price_changed_at"> & {
  source: Source;
  external_id: string;
  title: string;
  url: string;
  price: number | null;
  /** OLX paid "top ad": old listings injected at the top of newest-first results. */
  promoted?: boolean;
  /** Vinted: catalog ids from the item's breadcrumbs (root → leaf), known after enrichment. */
  category_path?: number[];
};

export type FetchResult = {
  status: number;
  ms: number;
  items: ScrapedListing[];
  error?: string;
};

/** Thrown for 403/429-like responses so the scheduler can back off. */
export class BlockedError extends Error {
  constructor(public status: number, message = `blocked (HTTP ${status})`) {
    super(message);
  }
}
