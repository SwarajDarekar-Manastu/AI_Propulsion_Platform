CREATE TABLE IF NOT EXISTS pacing_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  agent_id uuid NOT NULL,
  action text NOT NULL,
  reasons text NOT NULL,
  week_pct numeric NOT NULL,
  session_pct numeric NOT NULL
);
