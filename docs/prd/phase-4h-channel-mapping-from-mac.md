# Phase 4H — Channel Mapping from Host via MQTT

## Problem
BBB channel-to-sensor-name mappings (`CH0_NAME`, `CH1_NAME`, etc.) are set in `.plantwise.env` on the BBB. Reassigning a sensor to a different plant (e.g. moving a sensor from one pot to another) requires SSHing into the BBB and editing a file. This is admin-level friction for a day-to-day operation.

## Solution
Manage channel mappings from the CLI. The host publishes the mapping as a retained MQTT message to `plantwise/devices/<device-id>/config`. The BBB subscribes to this topic, stores the config locally, and hot-reloads its sensor list — no restart or SSH required.

## MQTT Config Topic

**Topic:** `plantwise/devices/<device-id>/config`
**QoS:** 1
**Retain:** true (BBB receives latest config on reconnect, even if host is offline)

**Payload:**
```json
{"channels": {"0": "monstera", "1": "basil", "2": "aloe-vera"}}
```

## Host Side Changes

### New SQLite table: `channel_mappings`
```sql
CREATE TABLE IF NOT EXISTS channel_mappings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT NOT NULL,
  channel     INTEGER NOT NULL,
  sensor_name TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(device_id, channel)
);
```

### New CLI commands

```bash
plantwise channel map <device-id> <channel> <sensor-name>
# Maps channel 0 on living-room to "monstera", publishes config via MQTT

plantwise channel unmap <device-id> <channel>
# Removes a channel mapping, republishes updated config

plantwise channel list [device-id]
# Lists all channel mappings (optionally filtered by device)
```

### Behaviour
1. `channel map` saves to SQLite, then publishes the full updated config for that device as a retained MQTT message
2. MQTT must be running (`npm run serve` or Docker stack) for the publish to reach the BBB — if not reachable, the DB is still updated and will be published next time
3. `channel list` reads from SQLite (no MQTT needed)

## BBB Side Changes (`main.py`)

### Config file
Mappings received via MQTT are stored in `~/.plantwise_channels.json`:
```json
{"0": "monstera", "1": "basil", "2": "aloe-vera"}
```

### Priority order (highest to lowest)
1. MQTT config (stored in `~/.plantwise_channels.json`)
2. `CH0_NAME`…`CH7_NAME` env vars (fallback for initial setup / offline)

### Hot-reload
When a new config message arrives on `plantwise/devices/<device-id>/config`, the BBB:
1. Saves the new mapping to `~/.plantwise_channels.json`
2. Updates the in-memory `_SENSORS` list immediately — no restart needed

### MQTT connection change
The BBB currently connects/disconnects per publish (fire-and-forget). To support config subscription, it needs a persistent connection. Switch to a long-lived MQTT client that:
- Subscribes to `plantwise/devices/<device-id>/config` on connect
- Publishes readings on the interval as before

## Backwards Compatibility
- Env vars (`CH0_NAME` etc.) remain supported as fallback
- Existing BBB installs continue to work without running `channel map`
- `.env.example` retains the `CH*_NAME` vars with a note that MQTT config takes priority

## README
Add `channel` command group to the commands reference.

## Out of Scope
- Publishing config when Mac is offline (deferred — MQTT retain handles reconnect case)
- Channel mapping UI in Node-RED or Grafana
- Bulk import of channel mappings
