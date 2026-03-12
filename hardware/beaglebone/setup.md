# BeagleBone Black — Setup Guide

The sensor publisher is distributed as a pip-installable Python package. No repo clone required on the BBB.

## Prerequisites

- Debian 12 image on the BBB
- Python 3.11+ (ships with Debian 12)
- NTP configured (see step 4)

## 1. Add a deploy key (private repo auth)

A deploy key is an SSH key scoped to this repo only, with read-only access. It keeps credentials out of URLs, shell history, and pip logs.

**On the BBB** — generate a dedicated key (no passphrase; service runs unattended):
```bash
ssh-keygen -t ed25519 -C "plantwise-bbb" -f ~/.ssh/plantwise_deploy -N ""
cat ~/.ssh/plantwise_deploy.pub
```

**On GitHub** — add the public key as a deploy key:
Settings → Deploy keys → Add deploy key. Paste the output above. Leave "Allow write access" unchecked.

**On the BBB** — configure SSH to use this key only for this repo:
```bash
cat >> ~/.ssh/config << 'EOF'

Host github-plantwise
    HostName github.com
    User git
    IdentityFile ~/.ssh/plantwise_deploy
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Test the connection:
```bash
ssh -T git@github-plantwise
# Expected: Hi smalldreamcollective/plantwise (deploy key)! ...
```

## 2. Install pipx

```bash
sudo apt-get install -y pipx
pipx ensurepath
```

`pipx` installs CLI tools in isolated virtualenvs and exposes them in `~/.local/bin` — no conflicts with system Python.

## 3. Install the package

```bash
pipx install "git+ssh://git@github-plantwise/smalldreamcollective/plantwise.git#subdirectory=hardware/beaglebone"
```

This installs the `plantwise-sensor` command and all dependencies (`smbus2`, `paho-mqtt`, `influxdb-client`) in one step.

## 4. Configure environment

```bash
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

## 5. Configure NTP

Critical for accurate InfluxDB timestamps.

```bash
sudo apt-get install -y ntp
sudo systemctl enable ntp && sudo systemctl start ntp
timedatectl status   # verify sync
```

## 6. Install the systemd service

```bash
# Fetch the service file via SSH (no full repo clone needed)
scp git@github-plantwise:smalldreamcollective/plantwise/hardware/beaglebone/plantwise-sensor.service \
    /tmp/plantwise-sensor.service 2>/dev/null || \
curl -s --key ~/.ssh/plantwise_deploy \
    "https://raw.githubusercontent.com/smalldreamcollective/plantwise/main/hardware/beaglebone/plantwise-sensor.service" \
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
pipx install --force "git+ssh://git@github-plantwise/smalldreamcollective/plantwise.git#subdirectory=hardware/beaglebone"
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
| SSH auth failing | `ssh -vT git@github-plantwise` |
