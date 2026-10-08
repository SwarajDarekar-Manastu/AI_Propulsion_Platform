export type Mode = "off" | "dry-run" | "enforce";

export interface Settings {
  mode: Mode;
  digestIssueId: string | null;
  maxWakesPerTask: number;
  tokenMultiple: number;
  tokenHistoryRuns: number;
  minBaselineRuns: number;
  exemptAgentIds: string[];
}

export const DEFAULTS: Settings = {
  mode: "dry-run",
  digestIssueId: null,
  maxWakesPerTask: 12,
  tokenMultiple: 6,
  tokenHistoryRuns: 10,
  minBaselineRuns: 5,
  exemptAgentIds: [],
};

export const instanceConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: {
      type: "string",
      enum: ["off", "dry-run", "enforce"],
      default: DEFAULTS.mode,
      description: "off: do nothing. dry-run: count and report, never pause. enforce: pause the agent.",
    },
    digestIssueId: { type: "string", description: "Board issue that receives one comment per decision. Unset means the worker log only." },
    maxWakesPerTask: { type: "integer", minimum: 1, default: DEFAULTS.maxWakesPerTask, description: "Rule W. Pause an agent that starts more than this many runs on one task within 60 minutes." },
    tokenMultiple: { type: "number", exclusiveMinimum: 0, default: DEFAULTS.tokenMultiple, description: "Rule T. Pause an agent whose run tokens exceed this multiple of its median over its recent runs." },
    tokenHistoryRuns: { type: "integer", minimum: 1, default: DEFAULTS.tokenHistoryRuns, description: "Rule T. How many of the agent's most recent runs with usage form the median." },
    minBaselineRuns: { type: "integer", minimum: 1, default: DEFAULTS.minBaselineRuns, description: "Rule T. An agent needs at least this many runs with usage before Rule T can pause it." },
    exemptAgentIds: { type: "array", items: { type: "string" }, description: "Agents the plugin never pauses." },
  },
} as const;

function positiveInteger(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

function positiveNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

export function resolveSettings(raw: Record<string, unknown> | null | undefined): Settings {
  const r = raw ?? {};
  const mode = r.mode === "off" || r.mode === "enforce" || r.mode === "dry-run" ? r.mode : DEFAULTS.mode;
  const digestIssueId = typeof r.digestIssueId === "string" && r.digestIssueId.trim() !== "" ? r.digestIssueId.trim() : null;
  return {
    mode,
    digestIssueId,
    maxWakesPerTask: positiveInteger(r.maxWakesPerTask, DEFAULTS.maxWakesPerTask),
    tokenMultiple: positiveNumber(r.tokenMultiple, DEFAULTS.tokenMultiple),
    tokenHistoryRuns: positiveInteger(r.tokenHistoryRuns, DEFAULTS.tokenHistoryRuns),
    minBaselineRuns: positiveInteger(r.minBaselineRuns, DEFAULTS.minBaselineRuns),
    exemptAgentIds: Array.isArray(r.exemptAgentIds) ? r.exemptAgentIds.filter((x): x is string => typeof x === "string") : [],
  };
}
