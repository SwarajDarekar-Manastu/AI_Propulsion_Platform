# Self-hosted observability: GlitchTip, OpenTelemetry and Jaeger

What the Network and Observability Engineer reads from. Everything runs on the office LAN, so nothing leaves the building and GlitchTip's alerts can reach Paperclip directly.

| Tool | What it gives the department | How apps send to it | How the agent reads it |
|---|---|---|---|
| GlitchTip 6 | errors with stack traces, performance (transactions and spans), logs, uptime checks, alerts | any Sentry SDK, with the project's DSN | GlitchTip's MCP server (`/mcp`), read-only token |
| Jaeger 2.21 | OpenTelemetry traces across services | OpenTelemetry SDK, OTLP to port 4317 or 4318 | Jaeger's MCP server (`/api/ai/mcp/`) or its query API (`/api/v3/...`) |
| Chrome DevTools | what a browser sees: network requests, console errors, performance traces | nothing to send | `chrome-devtools` CLI from the `chrome-devtools-mcp` package (pinned in runbook Stage 8), headless and isolated |

GlitchTip 6.2 also accepts OpenTelemetry logs, and its release notes say OpenTelemetry traces are coming. Until GlitchTip takes traces, send them to Jaeger.

## Before you start

- **Where the apps run decides where this runs.** Apps must reach GlitchTip and Jaeger to report. This setup assumes the apps the department watches run on, or can reach, the office LAN. If production runs in the cloud, run this compose file next to production instead, behind HTTPS. Then GlitchTip's webhook cannot reach Paperclip on the LAN, so use the 15-minute schedule in step 6 instead.
- **Docker, run by an admin.** Run it on the Paperclip machine or another always-on machine on the LAN. Never add the `paperclip` user to the `docker` group: that group is root-equivalent, and agents run as that user.
- **Memory.** About 1 GB for GlitchTip, PostgreSQL and Valkey together, plus Jaeger.

## 1. Start it

```bash
cd templates/observability          # or a copy of this folder
cp .env.example .env && chmod 600 .env
# fill in LAN_IP, GLITCHTIP_DOMAIN, and the two secrets (openssl rand -hex 32)
docker compose up -d
docker compose ps                   # all services up; jaeger-data-permissions exits 0
```

## 2. Claim GlitchTip straight away

Open `GLITCHTIP_DOMAIN` in your browser and register. Self-signup closes after the first user (`ENABLE_USER_REGISTRATION` is False), so register before anyone else can. Then:

1. Create the organization and one project per app. Copy each project's DSN.
2. Invite the second Board member from the organization's members page.
3. Under **Profile > Auth Tokens**, create a token for the department with **read scopes only**. Store it as a Paperclip secret (step 5).

## 3. Point the apps at it

- **Errors, performance and logs:** add the Sentry SDK for the app's language with the project's DSN. Set a traces sample rate (for example 0.1) to get performance data.
- **Traces across services:** add the OpenTelemetry SDK and set
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://<LAN_IP>:4318` and `OTEL_SERVICE_NAME=<app name>`.
- **Uptime:** in GlitchTip, add an uptime monitor for each app's health URL and link it to the app's project.

## 4. Firewall

- Docker publishes ports past ufw. The compose file binds every port to `LAN_IP`, so the ports are open to the office LAN but not to other networks this machine is on.
- GlitchTip runs inside Docker's network `172.30.70.0/24`. With ufw on, let it reach Paperclip for alerts:
  `sudo ufw allow from 172.30.70.0/24 to any port 3100 proto tcp comment 'GlitchTip alerts to Paperclip'`

## 5. Give the Network and Observability Engineer read access

In the Paperclip Board, under **Tools**, connect two remote MCP servers by URL and give only the Network and Observability Engineer access:

| Connection | URL | Authentication |
|---|---|---|
| GlitchTip | `http://<machine>.local:8000/mcp` | bearer, the read-only token from step 2 |
| Jaeger | `http://<LAN_IP>:16686/api/ai/mcp/` | none (Jaeger has no login; anyone on the LAN can read traces) |

In the tool gateway, set GlitchTip's `update_issue` tool to **Off**. The engineer is read-only: it never resolves, mutes, assigns or deletes an issue.

GlitchTip's tools: `list_organizations`, `list_projects`, `list_issues`, `get_issue`, `get_latest_event`, `get_event`, `update_issue`, `list_transaction_groups`, `get_transaction_group`, `list_transaction_spans`, `list_span_groups`, `detect_n_plus_one`, `get_transaction_trend`, `list_alerts`, `list_monitors`, `list_logs`, `get_log`.
Jaeger's tools (all read-only): `get_services`, `get_span_names`, `search_traces`, `get_trace_topology`, `get_trace_errors`, `get_critical_path`, `get_span_details`, `get_service_dependencies`, `read_skill`.

## 6. Alerts wake the engineer

1. Create the routine "GlitchTip alert triage", assigned to the Network and Observability Engineer (runbook Stage 8).
2. Add a webhook trigger with `"signingMode":"none"`. GlitchTip cannot sign its webhooks; the random ID in the trigger URL is the shared secret, so treat the URL as a secret.
3. In GlitchTip, open each project's settings, add a project alert, and add the trigger URL as a webhook recipient.
4. Send a test error from an app and check that the routine created a task.

If GlitchTip refuses the URL or cannot reach Paperclip, use a schedule trigger every 15 minutes instead (`"cronExpression":"*/15 * * * *"`). The engineer then lists new issues since its last run.

## Backups and upgrades

- Back up the `pg-data` volume (GlitchTip) with `docker compose exec postgres pg_dump -U glitchtip glitchtip`. Jaeger keeps traces for 7 days (`jaeger-config.yaml`) and needs no backup.
- Upgrade one tool at a time: `docker compose pull glitchtip && docker compose up -d glitchtip`. Read GlitchTip's blog before a new major version.
