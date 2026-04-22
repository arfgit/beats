/**
 * Polishes raw sample display names inherited from the dirt-samples
 * import for readability. The seed pipeline concatenates the source
 * folder name with the file name, leaving duplicate tokens and cryptic
 * abbreviations like "bd-bd-1" or "hh-closed-27-hat".
 *
 * This runs at render time; the backend names stay unchanged so a
 * proper data migration can replace this later without breaking URLs.
 */

const ABBREVIATIONS: Record<string, string> = {
  bd: "kick",
  "808bd": "808 kick",
  sd: "snare",
  "808sd": "808 snare",
  sn: "snare",
  hh: "hihat",
  "808hc": "808 hihat",
  hc: "hihat",
  ho: "open hat",
  oh: "open hat",
  "808oh": "808 open hat",
  cp: "clap",
  cr: "clap",
  cb: "cowbell",
  ht: "tom high",
  mt: "tom mid",
  lt: "tom low",
  "808ht": "808 tom high",
  "808mt": "808 tom mid",
  "808lt": "808 tom low",
  "808lc": "808 low conga",
  "808mc": "808 mid conga",
  cy: "crash",
  "808cy": "808 crash",
  rs: "rimshot",
  gtr: "guitar",
  jvbass: "juno bass",
  jungbass: "jungle bass",
  amencutup: "amen break",
  linnhats: "linn hats",
  hh27: "hihat",
  drumtraks: "drumtraks",
  simplesine: "sine",
};

/**
 * Turn an arbitrary display string into user-friendly title case,
 * collapsing duplicate tokens and expanding known abbreviations.
 *
 * Input shape typically looks like "bd bd 1" or "808 closed hh 02" — the
 * seed pipeline leaves a folder-name token at the head of the basename.
 */
export function polishSampleName(raw: string): string {
  if (!raw) return raw;
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return raw;

  // Expand head abbreviation first, then de-dupe adjacent duplicates so
  // "bd bd 1" → "kick 1" instead of "kick kick 1".
  const expanded: string[] = [];
  for (const token of tokens) {
    const replacement = ABBREVIATIONS[token] ?? token;
    expanded.push(...replacement.split(/\s+/));
  }

  const deduped: string[] = [];
  for (const token of expanded) {
    const last = deduped[deduped.length - 1];
    if (last?.toLowerCase() !== token.toLowerCase()) deduped.push(token);
  }

  return deduped.map(capitalizeWord).join(" ");
}

function capitalizeWord(word: string): string {
  if (!word) return word;
  // Preserve alphanumeric tokens like "808" or "909" as-is (all digits).
  if (/^\d+$/.test(word)) return word;
  return word[0]!.toUpperCase() + word.slice(1);
}
