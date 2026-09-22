/** Lowercase, strip accents and punctuation, collapse whitespace: "RTX-3060 Ti Avariada!" → "rtx 3060 ti avariada". */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whole-word phrase match on normalized text. Phrases with digits also match with the spaces
 * removed, so "rtx 3060" finds "RTX3060" and "5600x" finds "5600 X".
 */
export function hasPhrase(normalizedText: string, phrase: string): boolean {
  const p = normalize(phrase);
  if (!p) return false;
  if (` ${normalizedText} `.includes(` ${p} `)) return true;
  if (/\d/.test(p)) return normalizedText.replaceAll(" ", "").includes(p.replaceAll(" ", ""));
  return false;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
