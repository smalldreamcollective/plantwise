# Phase 4J — Version Reporting in Sensor Payload

## Status
In progress — issue #76

## Problem

After running `plantwise-update` on the BBB there is no way to confirm the new version is active without SSHing in. Equally, if a release is deployed and the BBB hasn't been updated yet, the host has no way to know it's running stale code.

## Goals

- Host knows the running version of every device without SSH
- Host notifies when a device is running a stale version
- No remote execution surface introduced

## Approach

### BBB (publisher)

Read the installed package version at startup using `importlib.metadata`:

```python
from importlib.metadata import version
PACKAGE_VERSION = version("plantwise-sensor")
```

Include it in every sensor payload:

```json
{"device_id": "living-room", "sensor_id": "monstera", "moisture_pct": 42, "version": "0.1.0"}
```

### Host (subscriber)

- Read `TARGET_VERSION` from `.env` (optional — if not set, version checking is skipped)
- On each moisture message, if `payload.version` is present and does not match `TARGET_VERSION`, log a warning and call `notify()` if `MQTT_NOTIFY=true`
- Throttle: notify at most once per device per hour to avoid repeated alerts on every reading

Notification format:
```
PlantWise device [living-room] is running v0.1.0 — expected v0.2.0
Run plantwise-update on the device to upgrade.
```

## Release discipline

Bump `version` in `hardware/beaglebone/pyproject.toml` with each release that changes BBB code. Set `TARGET_VERSION` in `.env` on the host to match. The host will detect the mismatch on the next sensor reading.

## No remote execution

The host reads the version field and notifies. It does not publish any command to the device. Updates are always manual: SSH in and run `plantwise-update`.

## What changes

- `hardware/beaglebone/plantwise_sensor/main.py` — read version via `importlib.metadata`, include in payload
- `src/mqtt/subscriber.ts` — read `payload.version`, compare to `TARGET_VERSION`, throttled warn + notify
- `.env.example` — add `TARGET_VERSION`
- `README.md` — document `TARGET_VERSION` and stale version notification

## Acceptance criteria

- [ ] BBB payload includes `version` field matching `pyproject.toml`
- [ ] Host logs version alongside each device's readings
- [ ] Host warns when `payload.version` !== `TARGET_VERSION` (if set)
- [ ] Stale version notification fires at most once per device per hour
- [ ] `TARGET_VERSION` not set → version checking silently skipped
- [ ] Tests cover: version match, version mismatch with notify, mismatch without notify, missing TARGET_VERSION, missing version field in payload
