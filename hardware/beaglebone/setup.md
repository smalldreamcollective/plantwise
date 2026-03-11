# BeagleBone Black — Setup Guide

## Prerequisites

- Debian 11 image on the BBB
- Python 3.9+
- NTP configured (see below)
- Git installed: `sudo apt-get install -y git`

## 1. Clone the repo

```bash
mkdir -p /home/debian/plantwise
git clone https://github.com/smalldreamcollective/plantwise.git /home/debian/plantwise
```

## 2. Install Python dependencies

```bash
sudo apt-get install -y python3-pip python3-smbus
pip3 install smbus2 paho-mqtt influxdb-client
```

## 3. Configure environment

Copy and edit the env file:

```bash
cp /home/debian/plantwise/hardware/beaglebone/.env.example /home/debian/plantwise/.env
nano /home/debian/plantwise/.env
```

Required values:
```
DEVICE_ID=living-room          # unique slug for this device
PLANT_ID=1                     # plantwise DB plant ID this sensor monitors
MQTT_HOST=192.168.1.x          # Mac's LAN IP
INFLUXDB_URL=http://192.168.1.x:8086
INFLUXDB_TOKEN=plantwise-dev-token
```

## 4. Configure NTP

Critical for accurate time-series timestamps in InfluxDB.

```bash
sudo apt-get install -y ntp
sudo systemctl enable ntp
sudo systemctl start ntp
# Verify sync
timedatectl status
```

## 5. Install the systemd service

```bash
sudo cp /home/debian/plantwise/hardware/beaglebone/plantwise-sensor.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable plantwise-sensor
sudo systemctl start plantwise-sensor
```

Check status:
```bash
sudo systemctl status plantwise-sensor
journalctl -u plantwise-sensor -f
```

## 6. Deploying updates

```bash
cd /home/debian/plantwise
git pull
sudo systemctl restart plantwise-sensor
```

## Troubleshooting

| Problem | Command |
|---|---|
| Service won't start | `journalctl -u plantwise-sensor -n 50` |
| InfluxDB not reachable | `curl http://<mac-ip>:8086/ping` |
| I2C device not found | `i2cdetect -y 2` (should show `36` at 0x36) |
| NTP not syncing | `ntpq -p` |
| Check buffer contents | `sqlite3 ~/.plantwise_buffer.db "SELECT * FROM pending_readings ORDER BY id DESC LIMIT 20;"` |
