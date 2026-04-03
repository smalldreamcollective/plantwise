# Phase 4I — Device Error Reporting via MQTT

## Status
In progress — issue #39

## Problem

When the BBB encounters errors (InfluxDB write failures, sensor read errors), there is no way to know without SSHing into the device and checking `journalctl`. The errors are logged locally but never surfaced to the host.

## Goals

- Host receives a notification when the BBB encounters a significant error
- No SSH required for day-to-day monitoring
- Follows the existing `MQTT_NOTIFY` pattern — no new config needed
- Does not flood the user with repeated alerts for the same persistent failure

## Approach

### BBB (publisher)

Add `publish_error(code, message)` — publishes an error event to the existing `STATUS_TOPIC`:

```json
{"event": "error", "code": "influxdb_flush_failed", "message": "..."}
{"event": "error", "code": "sensor_read_error", "message": "OSError: ..."}
```

- Error events are **not retained** (unlike online/offline status)
- Throttled per error code: max once per 5 minutes to prevent alert storms
- Wired into: InfluxDB flush failures, sensor read errors in the main loop

The existing `{"status": "online/offline"}` messages are unchanged.

### Host (subscriber)

Subscribe to `plantwise/devices/+/status` in addition to the existing moisture topic.

Handle two message shapes on the same topic:
- `{"status": "online|offline"}` → log to console
- `{"event": "error", "code": "...", "message": "..."}` → log to console + `notify()` if `MQTT_NOTIFY=true`

Notification format:
```
PlantWise device alert [living-room]
influxdb_flush_failed: connection refused
```

## Error sites instrumented

| Location | Error code |
|---|---|
| `flush_buffer_to_influx` exception | `influxdb_flush_failed` |
| Main loop sensor read exception | `sensor_read_error` |

Note: MQTT disconnect is not instrumented — MQTT being down means we can't publish the error over MQTT.

## Out of scope

- Error history / log storage in SQLite
- Grafana alerting
- Per-device notification toggle (use `MQTT_NOTIFY` in `.env`)
- Warning-level events (keep it simple — errors only for now)

## Acceptance criteria

- [ ] BBB publishes `{"event": "error", ...}` to status topic on InfluxDB flush failure
- [ ] BBB publishes `{"event": "error", ...}` to status topic on sensor read error
- [ ] Same error code is not published more than once per 5 minutes
- [ ] Error events are not retained
- [ ] Host subscriber subscribes to `plantwise/devices/+/status`
- [ ] Online/offline status messages are logged to console
- [ ] Error events trigger `notify()` when `MQTT_NOTIFY=true`
- [ ] Error events are logged to console regardless of `MQTT_NOTIFY`
- [ ] Tests cover both message shapes in the host subscriber
