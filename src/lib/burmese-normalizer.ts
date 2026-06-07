import type { BurmeseLexiconEntry, BurmeseNormalizationChange, BurmeseNormalizationResult } from "./types";
import { expandBurmeseNumberTokens } from "./burmese-number-words";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAlreadySpokenForm(entry: BurmeseLexiconEntry, text: string, offset: number) {
  if (!entry.spoken.startsWith(entry.source)) return false;
  const spokenSuffix = entry.spoken.slice(entry.source.length);
  if (!spokenSuffix) return false;
  return text.slice(offset + entry.source.length, offset + entry.source.length + spokenSuffix.length) === spokenSuffix;
}

export function applyBurmeseLexiconEntries(script: string, entries: BurmeseLexiconEntry[]) {
  const changes: BurmeseNormalizationChange[] = [];
  let normalizedScript = script;
  const orderedEntries = [...entries].filter((entry) => entry.source.trim() && entry.spoken.trim()).sort((a, b) => b.source.length - a.source.length);

  for (const entry of orderedEntries) {
    const matcher = new RegExp(escapeRegExp(entry.source), "gu");
    let replacements = 0;
    normalizedScript = normalizedScript.replace(matcher, (source, offset: number, fullText: string) => {
      if (isAlreadySpokenForm(entry, fullText, offset)) return source;
      replacements += 1;
      return entry.spoken;
    });
    if (replacements === 0) continue;
    changes.push({
      source: entry.source,
      spoken: entry.spoken,
      reason: entry.note || "Local pronunciation lexicon"
    });
  }

  return { normalizedScript, changes };
}

export function normalizeBurmeseScript(script: string, entries: BurmeseLexiconEntry[], lexiconRevision: string): BurmeseNormalizationResult {
  const originalScript = script;
  const changes: BurmeseNormalizationChange[] = [];
  const canonicalDigits = script.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10));
  if (canonicalDigits !== script) {
    changes.push({ source: "Full-width digits", spoken: "ASCII digits", reason: "Safe numeric canonicalization" });
  }
  let normalizedScript = canonicalDigits
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *([၊။]) */g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lexiconExpansion = applyBurmeseLexiconEntries(normalizedScript, entries);
  normalizedScript = lexiconExpansion.normalizedScript;
  changes.push(...lexiconExpansion.changes);

  const numberExpansion = expandBurmeseNumberTokens(normalizedScript);
  if (numberExpansion.changes.length > 0) {
    normalizedScript = numberExpansion.normalizedScript;
    changes.push(
      ...numberExpansion.changes.map((change) => ({
        source: change.source,
        spoken: change.spoken,
        reason: "Myanmar number spellout"
      }))
    );
  }

  return {
    originalScript,
    normalizedScript,
    changes,
    lexiconRevision
  };
}
