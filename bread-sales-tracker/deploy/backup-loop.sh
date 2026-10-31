#!/bin/sh
# Daily database backup into /backups (./backups on the server), keeping KEEP_DAYS days.
# Restore a backup with:
#   gunzip -c backups/bread-YYYY-MM-DD_HHMM.sql.gz | docker compose exec -T db psql -U bread -d bread
set -u
echo "Backup service started. First backup in 2 minutes, then every 24 hours."
sleep 120
while true; do
  name="/backups/bread-$(date +%Y-%m-%d_%H%M).sql.gz"
  if pg_dump --no-owner --clean --if-exists | gzip > "$name.tmp"; then
    mv "$name.tmp" "$name"
    echo "Backup written: $name ($(du -h "$name" | cut -f1))"
  else
    rm -f "$name.tmp"
    echo "BACKUP FAILED at $(date)" >&2
  fi
  find /backups -name 'bread-*.sql.gz' -mtime +"${KEEP_DAYS:-30}" -delete
  sleep 86400
done
