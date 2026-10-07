---
feature_id: search
surface: web                    # web | cli | tui | api
route: /notes                   # expected URL after entry (regex allowed)
app_marker: 'data-testid="app-root"'   # proves this is the right app
viewport: 1280x800
baseline_dir: .claude/verify/baselines/search/   # changed only through Board-approved PRs
diff_threshold: 0.1%            # pixel ratio allowed for a screenshot diff
perf_budget: { trace: reload, cpu_throttle: 4, LCP_ms: 2500, INP_ms: 200 }
verified_at: <commit sha> <date>
---
# Search notes

One paragraph: what the user sees and can do with this feature.

## Sub-features
- `search-open`: open the search dialog
- `search-results`: type a query and see matching notes

## How to get to it (user POV)
- Toolbar "Search" button
- Keyboard shortcut `/`
- CLI: `notes search <query>`

## Expected layout
| Element ID | Role + accessible name | data-testid | Landmark / parent | Expected placement | Present in states |
|---|---|---|---|---|---|
| search-btn | button "Search" | toolbar-search | banner > toolbar | header, right of "New note" | all |
| search-box | searchbox "Search notes" | search-input | dialog "Search notes" | top of dialog, focused | open, results, empty |

## States and expected signatures
| State | Reach via | Must show | Must NOT show | Console | Network | Baseline |
|---|---|---|---|---|---|---|
| open | click search-btn | dialog "Search notes" | none | no `error` | none | open.png, open.aria.txt |
| results | fill "quarterly" | list "Search results" contains "Quarterly plan" | "Grocery list" | no `error` | GET /api/search?q=quarterly -> 200, once | results.png |
| empty | fill "volcano" | status "No matching notes" | list | no `error` | GET /api/search -> 200 `[]` | empty.png |
| error | fixture: search service down | alert "Search unavailable" | spinner | one known warning allowed | GET /api/search -> 503 | error.png |

## CLI contract (cli and tui features only)
| Step | Send | Wait for (regex) | Expect stdout / screen | Exit | Timeout |
|---|---|---|---|---|---|
| launch | `notes search quarterly --format json` | none | one object, title "Quarterly plan" | 0 | 10s |
| tui-open | `notes tui` | `^Notes v\d` | footer "? help" | n/a | 15s |

## Driving it with agent-browser / chrome-devtools / tmux
Preconditions: dev server ready on the run's port; signed in as the fixture user.
- **Toolbar entry.** `agent-browser find role button --name "Search" click` -> dialog "Search notes" visible; screenshot `$ART/search/open.png`.
- **Keyboard entry.** `agent-browser press /` (focus not in a text field) -> same dialog.

## Gotchas
- `/` typed inside an editable field inserts a slash instead of opening search.

<!-- Selector rules: accessible role + name first, data-testid second. Never generated class names, hashes or child indexes. -->
