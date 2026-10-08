export const WAKE_WINDOW_MS = 60 * 60 * 1000;

export interface WakeEntry {
  runId: string;
  issueId: string;
  at: string;
}

export function pruneWakes(entries: WakeEntry[], now: Date): WakeEntry[] {
  const cutoff = now.getTime() - WAKE_WINDOW_MS;
  return entries.filter((entry) => Date.parse(entry.at) > cutoff);
}

export function countWakes(entries: WakeEntry[], issueId: string, now: Date): number {
  return pruneWakes(entries, now).filter((entry) => entry.issueId === issueId).length;
}

export function tokensOf(usage: unknown): number | null {
  if (usage === null || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const total = tokenField(record.inputTokens) + tokenField(record.cachedInputTokens) + tokenField(record.outputTokens);
  return total > 0 ? total : null;
}

function tokenField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TokenBreach {
  tokens: number;
  median: number;
  multiple: number;
}

export function tokenBreach(
  tokens: number,
  baseline: number[],
  settings: { tokenMultiple: number; minBaselineRuns: number },
): TokenBreach | null {
  if (baseline.length < settings.minBaselineRuns) return null;
  const typical = median(baseline);
  return tokens > settings.tokenMultiple * typical ? { tokens, median: typical, multiple: settings.tokenMultiple } : null;
}
