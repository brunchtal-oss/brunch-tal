#!/usr/bin/env bash
# Story 6.3: the daily backup, run by .github/workflows/backup.yml in the
# business's private backup repo (never in the public site repo).
#
#   TARGET=prod|dev  PROD_BACKUP_DB_URL / DEV_BACKUP_DB_URL  GH_TOKEN
#   bash scripts/backup.sh          (from the repo root)
#
# 1. Dumps the database the way Supabase documents it (roles / schema /
#    data, `supabase db dump`), as the read-only role backup_reader. The CLI
#    only prints its pg_dump scripts (--dry-run); they run in a pinned
#    postgres:17 image without the CLI's `--role "postgres"` (see
#    prepareDumpScript in lib.mjs). The dump skips the cron schema, so the
#    scheduled jobs are written as cron.sql (cron-dump.sql).
# 2. Counts the rows in the dump (every public table, auth.users,
#    storage.objects) next to a live count (counts.sql), and the jobs in
#    cron.sql (cron_jobs).
# 3. Packs the four files into a tar and encrypts it with gpg to
#    keys/backup-public.asc. Only the encrypted file leaves the runner; the
#    plain files are deleted at once and on any exit.
# 4. Stores one GitHub Release per day (db-<date>, dev-db-<date> for dev;
#    a rerun the same day replaces its files).
# 5. Copies new public images into media/ (media-dev/ for dev), add-only,
#    and commits them.
# 6. Deletes old Releases: kept are the last 30 daily plus the first of
#    each month for 12 months.
#
# A failure before step 4 stores nothing. A failure in step 5 keeps the
# day's database Release, still runs step 6, and fails the run. Every
# failure fails the run (GitHub then emails whoever last changed the cron
# line). The log shows only file names,
# sizes, table names and row counts: no secret, no connection string, no row.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(pwd)"

CLI="supabase@3.1.0"
# postgres:17.6, pinned to its multi-arch index digest (checked 2026-11-20).
PG_IMAGE="postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929"
# Any URL: the CLI only prints its scripts and never connects (--dry-run).
PLACEHOLDER_URL="postgresql://backup_reader@db.invalid:5432/postgres"

die() {
  printf '::error::%s\n' "$*"
  exit 1
}

target="${TARGET:-prod}"
case "$target" in
  prod)
    db_url="${PROD_BACKUP_DB_URL:-}"
    prefix="db-"
    media_dir="media"
    secret_name="PROD_BACKUP_DB_URL"
    ;;
  dev)
    db_url="${DEV_BACKUP_DB_URL:-}"
    prefix="dev-db-"
    media_dir="media-dev"
    secret_name="DEV_BACKUP_DB_URL"
    ;;
  *) die "TARGET must be prod or dev" ;;
esac
unset PROD_BACKUP_DB_URL DEV_BACKUP_DB_URL
[ -n "$db_url" ] || die "חסר הסוד ${secret_name} / missing secret ${secret_name}"
export BACKUP_DB_URL="$db_url"
unset db_url

pubkey="$root/keys/backup-public.asc"
[ -s "$pubkey" ] || die "missing keys/backup-public.asc (the public key)"
# The Actions Variable BACKUP_KEY_FINGERPRINT pins the key file: a replaced
# public key (one whose private half nobody holds) stops the run.
expected_fpr="$(printf '%s' "${BACKUP_KEY_FINGERPRINT:-}" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
[ -n "$expected_fpr" ] || die "missing Actions Variable BACKUP_KEY_FINGERPRINT"

date="$(TZ=Asia/Jerusalem date +%F)"
tag="${prefix}${date}"

work="$(mktemp -d)"
chmod 700 "$work"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
mkdir -m 700 "$work/plain" "$work/out" "$work/gnupg"
export GNUPGHOME="$work/gnupg"

actual_fpr="$(gpg --batch --no-tty --show-keys --with-colons "$pubkey" 2>/dev/null |
  awk -F: '$1 == "fpr" { print $10; exit }')"
[ "$actual_fpr" = "$expected_fpr" ] ||
  die "keys/backup-public.asc does not match BACKUP_KEY_FINGERPRINT"

# libpq variables for the containers (docker --env-file reads values
# literally); prints ::add-mask:: for the password, host and user.
node "$here/tool.mjs" pg-env "$work/pg.env" "$work/ref"
ref="$(cat "$work/ref")"

pg() {
  docker run --rm --network host --env-file "$work/pg.env" \
    -v "$work:/work:ro" -v "$here:/scripts:ro" "$PG_IMAGE" "$@"
}

docker pull --quiet "$PG_IMAGE" >/dev/null

echo "target: $target, release: $tag"

if ! pg psql -X -At -v ON_ERROR_STOP=1 -c "select 1" >/dev/null 2>"$work/connect.log"; then
  node "$here/tool.mjs" errors <"$work/connect.log" || true
  die "הגיבוי נכשל: אין חיבור למסד (פרויקט מושהה? סוד שגוי?) / backup failed: database unreachable (paused project or wrong secret)"
fi

for part in roles schema data; do
  case "$part" in
    roles) flags=(--role-only) ;;
    schema) flags=() ;;
    data) flags=(--data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes) ;;
  esac
  if ! npx --yes "$CLI" db dump --remote="$PLACEHOLDER_URL" "${flags[@]}" --dry-run \
    >"$work/$part.cli" 2>"$work/$part.cli.log"; then
    tail -n 5 "$work/$part.cli.log" >&2 || true
    die "supabase db dump --dry-run ($part) failed"
  fi
  node "$here/tool.mjs" prepare-dump "$work/$part.cli" "$work/$part.sh"
  if ! pg bash "/work/$part.sh" >"$work/plain/$part.sql" 2>"$work/$part.log"; then
    node "$here/tool.mjs" errors <"$work/$part.log" || true
    die "הגיבוי נכשל: ${part}.sql / backup failed: the $part dump"
  fi
  [ -s "$work/plain/$part.sql" ] || die "backup failed: $part.sql is empty"
  echo "$part.sql: $(stat -c %s "$work/plain/$part.sql") bytes"
done
grep -q '^COPY ' "$work/plain/data.sql" || die "backup failed: data.sql has no COPY"

pg psql -X -At -v ON_ERROR_STOP=1 -f /scripts/counts.sql >"$work/live.json" 2>"$work/counts.log" ||
  { node "$here/tool.mjs" errors <"$work/counts.log" || true; die "backup failed: counts.sql"; }
pg psql -X -At -v ON_ERROR_STOP=1 -f /scripts/media-list.sql >"$work/objects.json" 2>"$work/media.log" ||
  { node "$here/tool.mjs" errors <"$work/media.log" || true; die "backup failed: media-list.sql"; }
# The scheduled jobs: `supabase db dump` skips the cron schema, so they
# travel as cron.sql (one cron.schedule per job), inside the encryption only.
pg psql -X -At -v ON_ERROR_STOP=1 -f /scripts/cron-dump.sql >"$work/plain/cron.sql" 2>"$work/cron.log" ||
  { node "$here/tool.mjs" errors <"$work/cron.log" || true; die "backup failed: cron-dump.sql"; }
echo "cron.sql: $(grep -c '^select cron.schedule(' "$work/plain/cron.sql" || true) jobs"

counts="$work/out/counts-${date}.json"
node "$here/tool.mjs" count-dump "$work/plain/data.sql" "$work/live.json" \
  "$work/objects.json" "$tag" "$counts" "$work/plain/cron.sql"

encrypted="$work/out/${tag}.tar.gpg"
tar -C "$work/plain" -cf - roles.sql schema.sql data.sql cron.sql |
  gpg --batch --no-tty --quiet --yes --recipient-file "$pubkey" \
    --encrypt --output "$encrypted"
rm -rf "$work/plain"

# The stored file must be a gpg message, not readable text.
if LC_ALL=C grep -aq -e 'CREATE ' -e 'COPY ' "$encrypted"; then
  die "backup failed: the encrypted file contains plain SQL"
fi
# --list-only: without the secret key gpg would try to decrypt and exit 2.
packets="$(gpg --batch --no-tty --list-only --list-packets "$encrypted" 2>/dev/null || true)"
case "$packets" in
  *"pubkey enc packet"*) ;;
  *) die "backup failed: the file is not a gpg public-key message" ;;
esac
echo "$(basename "$encrypted"): $(stat -c %s "$encrypted") bytes, encrypted"

# The database backup is stored first: a later failure (an image, the push)
# still fails the run, but the day's Release stays and retention still runs.
if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" "$encrypted" "$counts" --clobber >/dev/null
  echo "release $tag: files replaced"
else
  gh release create "$tag" "$encrypted" "$counts" --title "$tag" \
    --notes "Encrypted database backup ($target). Restore: README of the site repo, \"גיבוי ושחזור\"." \
    --latest=false >/dev/null
  echo "release $tag: created"
fi

# Not `if ! ( ... )`: bash ignores set -e inside an if condition.
media_failed=""
set +e
(
  set -euo pipefail
  node "$here/media.mjs" "$work/objects.json" "$root/$media_dir" "https://${ref}.supabase.co"
  git add -A -- "$media_dir"
  if ! git diff --cached --quiet; then
    git -c user.name="github-actions[bot]" \
      -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      commit -q -m "media $tag"
    git pull -q --rebase
    git push -q
    echo "$media_dir: committed"
  else
    echo "$media_dir: no new images"
  fi
)
media_status=$?
set -e
if [ "$media_status" -ne 0 ]; then
  media_failed=1
  printf '::error::%s\n' "images failed; the database Release $tag is stored, retention still runs"
fi

gh release list --limit 1000 --json tagName --jq '.[].tagName' >"$work/tags"
node "$here/tool.mjs" retention "$prefix" <"$work/tags" >"$work/old-tags"
while read -r old; do
  [ -n "$old" ] || continue
  gh release delete "$old" --yes --cleanup-tag >/dev/null
  echo "retention: deleted $old"
done <"$work/old-tags"

[ -z "$media_failed" ] || die "backup $tag: database stored, images not (see above)"
echo "✓ backup $tag done"
