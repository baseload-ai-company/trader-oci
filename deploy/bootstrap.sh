#!/usr/bin/env bash
# trader-oci kurulum: repo'yu ceker, 5 dk'da bir otomatik guncelleme ve saatlik calisma cron'unu kurar.
set -euo pipefail
DIR="$HOME/trader"
mkdir -p "$HOME/trader-data" "$HOME/trader-logs"
if [ ! -d "$DIR/.git" ]; then
  git clone -q https://github.com/alibingul-dev/trader-oci "$DIR"
fi
cd "$DIR" && git pull -q
CRON=$(mktemp)
(crontab -l 2>/dev/null || true) | grep -v '# trader-oci' > "$CRON" || true
echo "*/5 * * * * cd $DIR && git pull -q >> $HOME/trader-logs/deploy.log 2>&1 # trader-oci" >> "$CRON"
echo "1 * * * * cd $DIR && /usr/bin/node src/hour.js >> $HOME/trader-logs/hour.log 2>&1 # trader-oci" >> "$CRON"
crontab "$CRON"
rm -f "$CRON"
echo "--- ilk deneme calismasi ---"
/usr/bin/node src/hour.js
echo "--- kurulu cron satirlari ---"
crontab -l | grep trader-oci
echo "KURULUM TAMAM"
