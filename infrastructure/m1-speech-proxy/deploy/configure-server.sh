#!/bin/bash
# Run interactively on the server: sudo bash /opt/m1-proxy/infrastructure/m1-speech-proxy/deploy/configure-server.sh
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
if [ "$EUID" -ne 0 ]; then echo 'Run with sudo bash.'; exit 1; fi
if systemctl is-active --quiet m1-proxy; then echo 'Service is already active; stop and drain it before reconfiguration.'; exit 1; fi
read -rsp '讯飞 AppID（输入隐藏）: ' IAT_APP_ID; printf '\n'
read -rsp '讯飞 APIKey（输入隐藏）: ' IAT_API_KEY; printf '\n'
read -rsp '讯飞 APISecret（输入隐藏）: ' IAT_API_SECRET; printf '\n'
[[ "$IAT_APP_ID" =~ ^[a-zA-Z0-9_-]+$ ]]
[[ "$IAT_API_KEY" =~ ^[a-zA-Z0-9]+$ ]]
[[ "$IAT_API_SECRET" =~ ^[a-zA-Z0-9]+$ ]]
read -rp '最大物理连接数（按讯飞权益，长录音轮换需至少2路）: ' MAX_CONNECTIONS
read -rp '每天最多连接尝试数（含预连接与失败尝试）: ' DAILY_ATTEMPTS
read -rp '每月最多连接尝试数: ' MONTHLY_ATTEMPTS
for value in "$MAX_CONNECTIONS" "$DAILY_ATTEMPTS" "$MONTHLY_ATTEMPTS"; do [[ "$value" =~ ^[1-9][0-9]*$ ]]; done
export IAT_APP_ID IAT_API_KEY IAT_API_SECRET MAX_CONNECTIONS DAILY_ATTEMPTS MONTHLY_ATTEMPTS
/usr/local/bin/node <<'JS'
const fs = require('node:fs');
const file = '/etc/m1-proxy.env';
let text = fs.readFileSync(file, 'utf8');
for (const key of ['IAT_APP_ID', 'IAT_API_KEY', 'IAT_API_SECRET', 'MAX_CONNECTIONS', 'DAILY_ATTEMPTS', 'MONTHLY_ATTEMPTS']) {
  const value = process.env[key];
  if (!value) throw new Error('Missing configuration.');
  text = text.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=' + value);
}
fs.writeFileSync(file, text, {mode: 0o600});
JS
unset IAT_APP_ID IAT_API_KEY IAT_API_SECRET
if [ ! -e /var/lib/m1-proxy/quota.sqlite ]; then
  systemd-run --quiet --wait --pipe --collect -p User=m1 -p Group=m1 -p WorkingDirectory=/opt/m1-proxy \
    -p EnvironmentFile=/etc/m1-proxy.env /usr/local/bin/node \
    /opt/m1-proxy/infrastructure/m1-speech-proxy/dist/infrastructure/m1-speech-proxy/node-server.js --init-quota
fi
systemctl start m1-proxy
systemctl is-active m1-proxy
printf '服务已启动，只监听本机8787。需等待90秒恢复冷却；尚未发起讯飞连接。\n'
