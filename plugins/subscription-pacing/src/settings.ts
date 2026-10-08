export type Mode = "off" | "dry-run" | "enforce";

export interface Settings {
  mode: Mode;
  companyId: string | null;
  digestIssueId: string | null;
  opusPctPerMillion: number | null;
  sonnetPctPerMillion: number | null;
  sessionHours: number;
  sessionAllowancePctOfWeek: number;
  sessionPauseAtPct: number;
  weeklyPaceLeadPts: number;
  agentWeeklySharePct: number | null;
  maxOpusSharePct: number | null;
  opusRuleMinWeekPct: number;
  cancelledRunAllowanceTokens: number;
  maxPausesPerRun: number;
  exemptAgentIds: string[];
  weekResetAnchor: string | null;
  digestIntervalHours: number;
}

export const DEFAULTS: Settings = {
  mode: "dry-run",
  companyId: null,
  digestIssueId: null,
  opusPctPerMillion: null,
  sonnetPctPerMillion: null,
  sessionHours: 5,
  sessionAllowancePctOfWeek: 15,
  sessionPauseAtPct: 80,
  weeklyPaceLeadPts: 10,
  agentWeeklySharePct: null,
  maxOpusSharePct: null,
  opusRuleMinWeekPct: 5,
  cancelledRunAllowanceTokens: 100_000,
  maxPausesPerRun: 2,
  exemptAgentIds: [],
  weekResetAnchor: null,
  digestIntervalHours: 6,
};

export const instanceConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: {
      type: "string",
      enum: ["off", "dry-run", "enforce"],
      default: DEFAULTS.mode,
      description: "off: do nothing. dry-run: estimate and post the digest, never pause or resume. enforce: pause and resume agents.",
    },
    companyId: { type: "string", description: "Company whose agents are paced. Unset means the job does nothing." },
    digestIssueId: { type: "string", description: "Board issue that receives the digest comments. Unset means the digest goes to the worker log only." },
    opusPctPerMillion: { type: "number", exclusiveMinimum: 0, description: "Percent of the weekly plan allowance used per million Opus tokens. Unset disables every rule." },
    sonnetPctPerMillion: { type: "number", exclusiveMinimum: 0, description: "Percent of the weekly plan allowance used per million Sonnet (and other non-Opus) tokens. Unset disables every rule." },
    sessionHours: { type: "number", exclusiveMinimum: 0, default: DEFAULTS.sessionHours, description: "Length of the rolling session window in hours." },
    sessionAllowancePctOfWeek: { type: "number", exclusiveMinimum: 0, maximum: 100, default: DEFAULTS.sessionAllowancePctOfWeek, description: "Percent of the weekly allowance the plan lets one session window use. Session estimate = usage in window / this value." },
    sessionPauseAtPct: { type: "number", exclusiveMinimum: 0, default: DEFAULTS.sessionPauseAtPct, description: "Pause an agent when its session estimate reaches this percent." },
    weeklyPaceLeadPts: { type: "number", minimum: 0, default: DEFAULTS.weeklyPaceLeadPts, description: "Pause an agent when its weekly estimate exceeds the week's elapsed share by more than this many points." },
    agentWeeklySharePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Weekly share each agent may use. Unset means 100 divided by the number of agents." },
    maxOpusSharePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Pause the heaviest Opus users when Opus is more than this percent of the plan's weekly estimate. Unset turns the Opus rule off." },
    opusRuleMinWeekPct: { type: "number", minimum: 0, default: DEFAULTS.opusRuleMinWeekPct, description: "The Opus rule applies only once the plan's weekly estimate is at least this percent." },
    cancelledRunAllowanceTokens: { type: "number", minimum: 0, default: DEFAULTS.cancelledRunAllowanceTokens, description: "Tokens charged at the Sonnet ratio for each cancelled run that has no usage record." },
    maxPausesPerRun: { type: "integer", minimum: 0, default: DEFAULTS.maxPausesPerRun, description: "Most agents the job pauses in one run. Further violators wait for the next run and show in the digest." },
    exemptAgentIds: { type: "array", items: { type: "string" }, description: "Agents the plugin never pauses." },
    weekResetAnchor: { type: "string", format: "date-time", description: "A past instant at which the plan week reset. Unset means Monday 00:00 UTC." },
    digestIntervalHours: { type: "number", exclusiveMinimum: 0, default: DEFAULTS.digestIntervalHours, description: "Post a digest at least this often. A run that pauses or resumes an agent posts at once." },
  },
} as const;

function positive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function nonNegative(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function resolveSettings(raw: Record<string, unknown> | null | undefined): Settings {
  const r = raw ?? {};
  const mode = r.mode === "off" || r.mode === "enforce" || r.mode === "dry-run" ? r.mode : DEFAULTS.mode;
  const anchor = text(r.weekResetAnchor);
  return {
    mode,
    companyId: text(r.companyId),
    digestIssueId: text(r.digestIssueId),
    opusPctPerMillion: positive(r.opusPctPerMillion),
    sonnetPctPerMillion: positive(r.sonnetPctPerMillion),
    sessionHours: positive(r.sessionHours) ?? DEFAULTS.sessionHours,
    sessionAllowancePctOfWeek: positive(r.sessionAllowancePctOfWeek) ?? DEFAULTS.sessionAllowancePctOfWeek,
    sessionPauseAtPct: positive(r.sessionPauseAtPct) ?? DEFAULTS.sessionPauseAtPct,
    weeklyPaceLeadPts: nonNegative(r.weeklyPaceLeadPts) ?? DEFAULTS.weeklyPaceLeadPts,
    agentWeeklySharePct: positive(r.agentWeeklySharePct),
    maxOpusSharePct: positive(r.maxOpusSharePct),
    opusRuleMinWeekPct: nonNegative(r.opusRuleMinWeekPct) ?? DEFAULTS.opusRuleMinWeekPct,
    cancelledRunAllowanceTokens: nonNegative(r.cancelledRunAllowanceTokens) ?? DEFAULTS.cancelledRunAllowanceTokens,
    maxPausesPerRun: typeof r.maxPausesPerRun === "number" && Number.isInteger(r.maxPausesPerRun) && r.maxPausesPerRun >= 0 ? r.maxPausesPerRun : DEFAULTS.maxPausesPerRun,
    exemptAgentIds: Array.isArray(r.exemptAgentIds) ? r.exemptAgentIds.filter((x): x is string => typeof x === "string") : [],
    weekResetAnchor: anchor !== null && !Number.isNaN(Date.parse(anchor)) ? anchor : null,
    digestIntervalHours: positive(r.digestIntervalHours) ?? DEFAULTS.digestIntervalHours,
  };
}
