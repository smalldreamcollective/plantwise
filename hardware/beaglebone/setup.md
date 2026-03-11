# BeagleBone Black — Setup Guide

The sensor publisher is distributed as a pip-installable Python package. No repo clone required on the BBB.

## Prerequisites

- Debian 11 image on the BBB
- Python 3.9+ and pip
- NTP configured (see step 3)

## 1. Install the package

```bash
pip install "git+https://github.com/smalldreamcollective/plantwise.git#subdirectory=hardware/beaglebone"
```

This installs the `plantwise-sensor` command and all dependencies (`smbus2`, `paho-mqtt`, `influxdb-client`) in one step.

> **Private repo?** Use a GitHub personal access token:
> ```bash
> pip install "git+https://oauth2:<TOKEN>@github.com/smalldreamcollective/plantwise.git#subdirectory=hardware/beaglebone"
> ```

## 2. Configure environment

```bash
cp ~/.plantwise.env.example ~/.plantwise.env  # or create manually
nano ~/.plantwise.env
```

Minimum required values:
```
DEVICE_ID=living-room          # unique slug for this BBB
PLANT_ID=1                     # plantwise DB plant ID this sensor monitors
MQTT_HOST=192.168.1.x          # Mac's LAN IP
INFLUXDB_URL=http://192.168.1.x:8086
INFLUXDB_TOKEN=plantwise-dev-token
```

Full template: [`hardware/beaglebone/.env.example`](.env.example)

## 3. Configure NTP

Critical for accurate InfluxDB timestamps.

```bash
sudo apt-get install -y ntp
sudo systemctl enable ntp && sudo systemctl start ntp
timedatectl status   # verify sync
```

## 4. Install the systemd service

```bash
# Download the service file (no full repo clone needed)
curl -sL "https://raw.githubusercontent.com/smalldreamcollective/plantwise/main/hardware/beaglebone/plantwise-sensor.service" \
  -o /tmp/plantwise-sensor.service
sudo cp /tmp/plantwise-sensor.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable plantwise-sensor
sudo systemctl start plantwise-sensor
```

Check status:
```bash
sudo systemctl status plantwise-sensor
journalctl -u plantwise-sensor -f
```

## Deploying updates

```bash
pip install --upgrade "git+https://github.com/smalldreamcollective/plantwise.git#subdirectory=hardware/beaglebone"
sudo systemctl restart plantwise-sensor
```

## Troubleshooting

| Problem | Command |
|---|---|
| Service won't start | `journalctl -u plantwise-sensor -n 50` |
| InfluxDB not reachable | `curl http://<mac-ip>:8086/ping` |
| I2C device not found | `i2cdetect -y 2` (should show `36` at 0x36) |
| NTP not syncing | `ntpq -p` |
| Check buffer | `sqlite3 ~/.plantwise_buffer.db "SELECT * FROM pending_readings ORDER BY id DESC LIMIT 20;"` |
