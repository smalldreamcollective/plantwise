# BeagleBone Black — Setup Guide

The sensor publisher is distributed as a pip-installable Python package. No repo clone required on the BBB.

## Prerequisites

- Debian 12 image on the BBB (booting from eMMC recommended over SD card)
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
mkdir -p ~/.ssh
touch ~/.ssh/config
chmod 600 ~/.ssh/config
cat >> ~/.ssh/config << 'EOF'

Host github-plantwise
    HostName github.com
    User git
    IdentityFile ~/.ssh/plantwise_deploy
    IdentitiesOnly yes
EOF
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
source ~/.bashrc
```

`pipx` installs CLI tools in isolated virtualenvs and exposes them in `~/.local/bin` — no conflicts with system Python.

## 3. Install the package

Use a shallow clone to avoid connection timeouts on the BBB's slow connection:

```bash
git clone --depth 1 git@github-plantwise:smalldreamcollective/plantwise.git /tmp/plantwise
cd /tmp/plantwise/hardware/beaglebone
pipx install --force .
cd ~ && rm -rf /tmp/plantwise
```

## 4. Configure environment

```bash
nano ~/.plantwise.env
```

Minimum required values:
```
DEVICE_ID=living-room          # unique slug for this BBB
MQTT_HOST=192.168.1.x          # Mac's LAN IP
INFLUXDB_URL=http://192.168.1.x:8086
INFLUXDB_TOKEN=plantwise-dev-token

# Sensor channel names (PCA9548A mux)
CH0_NAME=monstera
CH1_NAME=basil
CH2_NAME=aloe-vera
```

Full template: [`hardware/beaglebone/.env.example`](.env.example)

Then on your Mac, assign each sensor to a plant:
```bash
npx tsx src/cli/index.ts device assign monstera <plant-id>
npx tsx src/cli/index.ts device assign basil <plant-id>
npx tsx src/cli/index.ts device assign aloe-vera <plant-id>
```

Plant assignments live on the server — no plant ID is needed on the device itself.

## 5. Configure NTP

Critical for accurate InfluxDB timestamps. Note: Debian 12 uses `ntpsec`, not `ntp`.

```bash
sudo apt-get install -y ntpsec
sudo systemctl enable ntpsec && sudo systemctl start ntpsec
timedatectl status   # verify sync (System clock synchronized: yes)
```

## 6. Install the systemd service

The service file was already cloned in step 3. Copy it from the clone, or fetch it directly:

```bash
git clone --depth 1 git@github-plantwise:smalldreamcollective/plantwise.git /tmp/plantwise
sudo cp /tmp/plantwise/hardware/beaglebone/plantwise-sensor.service /etc/systemd/system/
rm -rf /tmp/plantwise
sudo systemctl daemon-reload
sudo systemctl enable plantwise-sensor
sudo systemctl start plantwise-sensor
```

Check status:
```bash
sudo systemctl status plantwise-sensor
journalctl -u plantwise-sensor -f
```

## 7. Set up the plantwise-update script

This script updates the package and restarts the service in one command:

```bash
mkdir -p ~/bin
cat > ~/bin/plantwise-update << 'EOF'
#!/usr/bin/env bash
set -e
git clone --depth 1 git@github-plantwise:smalldreamcollective/plantwise.git /tmp/plantwise-update-tmp
cd /tmp/plantwise-update-tmp/hardware/beaglebone
pipx install --force .
cd ~ && rm -rf /tmp/plantwise-update-tmp
sudo systemctl restart plantwise-sensor
echo "plantwise-sensor updated and restarted"
EOF
chmod +x ~/bin/plantwise-update
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

To deploy updates:
```bash
plantwise-update
```

## Troubleshooting

| Problem | Command |
|---|---|
| Service won't start | `journalctl -u plantwise-sensor -n 50` |
| InfluxDB not reachable | `curl http://<mac-ip>:8086/ping` |
| Mux not detected | `sudo i2cdetect -y 2` (should show `70` at 0x70) |
| Sensor not detected | `sudo i2cdetect -y 2` (should show `36` at 0x36 when channel selected) |
| NTP not syncing | `timedatectl status` |
| Check buffer | `sqlite3 ~/.plantwise_buffer.db "SELECT * FROM pending_readings ORDER BY id DESC LIMIT 20;"` |
| SSH auth failing | `ssh -vT git@github-plantwise` |
| plantwise-update not found | `source ~/.bashrc` or run `~/bin/plantwise-update` directly |
