# PRD — Phase 4B: Push Notifications

## Status
Planned

## Goal
Fire a native desktop notification when plants are overdue for watering. Works without the Pi — runs today as a scheduled job. When the Pi arrives, it can trigger the same notification path after posting a sensor reading.

## Approach
macOS native notifications via `osascript` (no extra dependencies). Cross-platform support (Linux/Windows) is future work — the notifier is abstracted behind a single `notify()` function so swapping it out later is trivial.

A new `--notify` flag on the existing `remind` command triggers notifications. This keeps the CLI surface clean and makes it trivial to wire into a cron job or launchd plist.

## CLI change

```bash
# Existing — unchanged
npm run remind

# New — fires a notification for each overdue plant
npm run remind -- --notify

# Typical cron usage (every 30 min)
*/30 * * * * cd /path/to/plantwise && npm run remind -- --notify >> /tmp/plantwise.log 2>&1
```

### Notification format
One notification per overdue plant:

- **Title:** `PlantWise 🌿`
- **Body (time-based):** `Basil needs water — last watered 3 days ago`
- **Body (sensor-based):** `Basil needs water — soil moisture 12%`
- **Body (never watered):** `Basil needs water — never watered`

Only fires notifications when `--notify` is passed — silent by default so cron output stays clean.

## Implementation

### `src/utils/notify.ts`
```ts
export function notify(title: string, body: string): void
```
- macOS: `osascript -e 'display notification "..." with title "..."'`
- Spawns synchronously via `child_process.execSync`
- Catches and silently swallows errors (notification failure must never crash the CLI)

### Updated `remind` action in `src/cli/index.ts`
- Add `--notify` flag (boolean)
- After building the overdue list, call `notify()` for each plant if flag is set
- Notification body uses sensor data if a fresh reading exists, otherwise time-based copy

### Updated `PLANT_WITH_WATERING_SQL` join
`remind` needs the latest moisture reading to write sensor-aware notification copy. Add a left join to `sensor_readings` in the query result, or call `getLatestSensorReading()` per plant in the CLI action (simpler, acceptable for small collections).

## npm script
No new script needed — `remind` already exists. Usage via cron:
```
npm run remind -- --notify
```

## launchd plist (macOS, optional — documented in README)
```xml
<key>ProgramArguments</key>
<array>
  <string>/usr/local/bin/npm</string>
  <string>run</string>
  <string>remind</string>
  <string>--</string>
  <string>--notify</string>
</array>
<key>StartInterval</key>
<integer>1800</integer>
```

## Out of scope
- iOS / Android push (requires a hosted backend)
- Email or Slack notifications
- Notification deduplication / cooldown (future: track last-notified-at per plant)
- Cross-platform (Linux `notify-send`, Windows toast) — abstracted but not implemented

## Success criteria
- `npm run remind -- --notify` fires a macOS notification for each overdue plant
- Silent (no notification, no error) when all plants are on schedule
- Notification failure never crashes the CLI
- No new dependencies added
- All existing tests pass; new unit test for `notify.ts` (mocked `execSync`)
