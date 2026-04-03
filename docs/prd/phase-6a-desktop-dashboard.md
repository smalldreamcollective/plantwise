# Phase 6A — Desktop Dashboard (Placeholder)

## Status
**Planning** — not yet started. Details TBD.

## Concept
A native desktop application for PlantWise. Two tracks under consideration:

### Track A — Electron App
- Native desktop app (cross-platform; Mac/Linux/Windows)
- Reads from local SQLite DB and InfluxDB
- No API layer needed — direct DB access
- Full UI: current moisture, historical charts, plant health, care log, watering triggers

### Track B — Terminal Dashboard (TUI)
- Terminal UI for advanced users
- Candidate libraries: `blessed`, `ink` (React for CLI), or `bubbletea` (Go)
- Lower overhead than Electron, stays in the terminal workflow
- Good fit for the existing CLI-first approach

## Open Questions
- Does this replace Grafana or complement it?
- Read-only or interactive (trigger watering, log care events)?
- Electron vs TUI vs both?
- Desktop-only or also web-based?
- Where does this fit relative to Phase 4F cloud observability (#25)?

## Related
- Phase 4F — Grafana Cloud observability (#25)
- Phase 5 — Pump actuation (watering triggers would surface here)
