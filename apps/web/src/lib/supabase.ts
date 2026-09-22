import { createClient } from "@supabase/supabase-js";
import type { Database } from "@dh/shared";

// The publishable key is public by design; RLS limits data to the signed-in user.
const url = import.meta.env.VITE_SUPABASE_URL ?? "https://suldkcbhpmvhpxksrlot.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_46BTnsZgL4jZN_ZwW0rSWw_rGR3fjIl";

export const supabase = createClient<Database>(url, key);
