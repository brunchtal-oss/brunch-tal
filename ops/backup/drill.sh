#!/usr/bin/env bash
# Story 6.3: the restore drill, run by .github/workflows/restore-drill.yml
# (manual only) in the private backup repo.
#
#   TARGET=prod|dev  [TAG=db-YYYY-MM-DD]  DRILL_PRIVATE_KEY  GH_TOKEN
#   bash scripts/drill.sh          (from the repo root)
#
# Downloads a backup Release (the newest of the target when TAG is empty),
# decrypts it with the private key from the temporary Actions secret
# DRILL_PRIVATE_KEY (deleted right after the drill), starts a throwaway
# local Supabase stack on the runner (`supabase start`, Postgres 17; never
# the dev project), restores the dump as Supabase documents it, uploads the
# backed-up images, and compares: every table's row count must equal the
# backup's counts, and every restored public image must be served.
# Prints only table names, row counts and file names.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(pwd)"

CLI="supabase@3.1.0"
# postgres:17.6, pinned to its multi-arch index digest (checked 2026-11-20).
PG_IMAGE="postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929"
PROJECT_ID="restore_drill"
# Local Auth / Storage images (see the pin note at `supabase start` below):
# update when hosted moves ahead.
AUTH_VERSION="v2.198.0"
STORAGE_VERSION="v1.98.2"
# Services the drill does not need (names from `supabase start --help`).
EXCLUDE="realtime,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor,postgres-meta"

die() {
  printf '::error::%s\n' "$*"
  exit 1
}

if [ -z "${DRILL_PRIVATE_KEY:-}" ]; then
  die "חסר הסוד DRILL_PRIVATE_KEY (המפתח הפרטי, זמנית לתרגול בלבד) / missing secret DRILL_PRIVATE_KEY"
fi

target="${TARGET:-prod}"
case "$target" in
  prod) prefix="db-"; media_dir="media" ;;
  dev) prefix="dev-db-"; media_dir="media-dev" ;;
  *) die "TARGET must be prod or dev" ;;
esac

work="$(mktemp -d)"
chmod 700 "$work"
stack="$work/stack"
cleanup() {
  if [ -d "$stack/supabase" ]; then
    (cd "$stack" && npx --yes "$CLI" stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -m 700 "$work/gnupg" "$work/dl" "$work/plain" "$stack"
export GNUPGHOME="$work/gnupg"

tag="${TAG:-}"
if [ -z "$tag" ]; then
  gh release list --limit 1000 --json tagName --jq '.[].tagName' >"$work/tags"
  tag="$(node "$here/tool.mjs" latest "$prefix" <"$work/tags")"
fi
case "$tag" in
  "$prefix"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
  *) die "TAG must look like ${prefix}YYYY-MM-DD" ;;
esac
date="${tag#"$prefix"}"
echo "drill: $tag ($target)"

gh release download "$tag" --dir "$work/dl" --pattern "${tag}.tar.gpg" --pattern "counts-${date}.json"
counts="$work/dl/counts-${date}.json"
[ -s "$counts" ] || die "the release has no counts-${date}.json"
[ -s "$work/dl/${tag}.tar.gpg" ] || die "the release has no ${tag}.tar.gpg"

# The import prints the key's id and name: kept out of the log.
printf '%s\n' "$DRILL_PRIVATE_KEY" | gpg --batch --no-tty --quiet --import >/dev/null 2>&1 ||
  die "DRILL_PRIVATE_KEY is not a gpg private key"
unset DRILL_PRIVATE_KEY
if ! gpg --batch --no-tty --quiet --output "$work/db.tar" --decrypt "$work/dl/${tag}.tar.gpg" 2>"$work/gpg.log"; then
  grep -o 'No secret key\|decryption failed[^"]*' "$work/gpg.log" | head -n 2 >&2 || true
  die "decryption failed: the key does not match this backup"
fi
tar -C "$work/plain" -xf "$work/db.tar"
rm -f "$work/db.tar"
for part in roles schema data; do
  [ -s "$work/plain/$part.sql" ] || die "the backup has no $part.sql"
done
if [ -f "$work/plain/cron.sql" ]; then
  echo "decrypted: roles.sql, schema.sql, data.sql, cron.sql"
else
  echo "decrypted: roles.sql, schema.sql, data.sql (no cron.sql: older backup)"
fi

# A throwaway local stack, Postgres 17 like production.
(
  cd "$stack"
  npx --yes "$CLI" init >/dev/null 2>&1
  sed -i "s/^project_id = .*/project_id = \"${PROJECT_ID}\"/" supabase/config.toml
  grep -q '^major_version = 17$' supabase/config.toml || die "the local stack is not Postgres 17"
  # Auth and Storage at least as new as hosted: the CLI's pinned images
  # (3.1.0: gotrue v2.197.0, storage-api v1.90.1) are older, and the backup's
  # auth/storage rows then have columns the local schema lacks (first dev
  # drill: auth.one_time_tokens.link_token_hash). Legacy `supabase start`
  # reads these supabase/.temp pins (the files `supabase link` writes) for
  # an unlinked project too; both services run their migrations at start.
  # Pinned to the versions the first drill passed with (2026-11-20), so a
  # drill is reproducible. Update them when hosted moves ahead (a drill that
  # fails on a missing auth/storage column is the sign): the newest release
  # tags of github.com/supabase/auth and github.com/supabase/storage.
  mkdir -p supabase/.temp
  printf '%s\n' "$AUTH_VERSION" >supabase/.temp/gotrue-version
  printf '%s\n' "$STORAGE_VERSION" >supabase/.temp/storage-version
  echo "local auth: $AUTH_VERSION, local storage: $STORAGE_VERSION (pinned)"
  npx --yes "$CLI" start -x "$EXCLUDE" >"$work/start.log" 2>&1 ||
    { tail -n 20 "$work/start.log" >&2; die "supabase start failed"; }
  # Local demo keys only; never printed.
  npx --yes "$CLI" status -o env >"$work/status.env" 2>/dev/null
)
api_url="$(grep -E '^API_URL=' "$work/status.env" | head -n 1 | cut -d= -f2- | tr -d '"')"
service_key="$(grep -E '^SERVICE_ROLE_KEY=' "$work/status.env" | head -n 1 | cut -d= -f2- | tr -d '"')"
[ -n "$service_key" ] || service_key="$(grep -E '^SECRET_KEY=' "$work/status.env" | head -n 1 | cut -d= -f2- | tr -d '"')"
db_port="$(grep -E '^DB_URL=' "$work/status.env" | head -n 1 | sed -E 's/.*:([0-9]+)\/[^/]*$/\1/')"
[ -n "$api_url" ] && [ -n "$service_key" ] && [ -n "$db_port" ] || die "could not read the local stack's status"
[[ "$db_port" =~ ^[0-9]+$ ]] || die "could not read the local stack's database port"
echo "local stack: up (Postgres 17)"

local_pg() {
  docker run --rm --network host -e PGPASSWORD=postgres \
    -v "$work/plain:/work:ro" -v "$here:/scripts:ro" "$PG_IMAGE" \
    psql -X -h 127.0.0.1 -p "$db_port" -U postgres -d postgres "$@"
}

# Supabase's documented restore, in one transaction.
if ! local_pg --single-transaction -v ON_ERROR_STOP=1 -q \
  -f /work/roles.sql -f /work/schema.sql \
  -c 'SET session_replication_role = replica' \
  -f /work/data.sql >"$work/restore.log" 2>&1; then
  node "$here/tool.mjs" errors <"$work/restore.log" || true
  die "restore failed (nothing kept: one transaction)"
fi
echo "restored: roles, schema, data"

local_pg -At -v ON_ERROR_STOP=1 -f /scripts/counts.sql >"$work/restored.json"
node "$here/tool.mjs" compare "$counts" "$work/restored.json"

# The scheduled jobs travel as cron.sql (the dump skips the cron schema).
# Older backups have none: reported and skipped.
cron_expected="$(node "$here/tool.mjs" cron-jobs "$counts")"
if [ ! -f "$work/plain/cron.sql" ] || [ -z "$cron_expected" ]; then
  echo "cron jobs: this backup has no cron.sql (older backup), skipped"
else
  if ! local_pg -v ON_ERROR_STOP=1 -q \
    -c 'create extension if not exists pg_cron with schema pg_catalog' \
    -f /work/cron.sql >"$work/cron.log" 2>&1; then
    node "$here/tool.mjs" errors <"$work/cron.log" || true
    die "cron.sql failed on the restored database"
  fi
  cron_restored="$(local_pg -At -v ON_ERROR_STOP=1 -c 'select count(*) from cron.job')"
  [[ "$cron_restored" =~ ^[0-9]+$ ]] || die "could not count cron.job"
  [ "$cron_restored" = "$cron_expected" ] ||
    die "cron jobs: backup $cron_expected, restored $cron_restored"
  echo "cron jobs: $cron_restored restored"
fi

# The plain files are not needed any more (the mount stays valid, empty).
rm -rf "$work/plain"
mkdir -m 700 "$work/plain"

local_pg -At -v ON_ERROR_STOP=1 -f /scripts/media-list.sql >"$work/objects.json"
printf 'RESTORE_SUPABASE_URL=%s\nRESTORE_SUPABASE_SECRET_KEY=%s\n' "$api_url" "$service_key" >"$work/restore.env"
node "$here/restore-media.mjs" --dir "$root/$media_dir" --objects "$work/objects.json" \
  --env-file "$work/restore.env" --apply
node "$here/tool.mjs" media-verify "$api_url" "$work/objects.json" "$root/$media_dir" "$counts"

echo "✓ drill $tag passed. Delete the DRILL_PRIVATE_KEY secret now."
