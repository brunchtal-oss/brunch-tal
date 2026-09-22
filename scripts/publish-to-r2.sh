#!/usr/bin/env bash
# Publishes the current template state to the platform R2 bucket.
# Manual replacement for .github/workflows/release.yml while the workflow
# dispatch is blocked on the GitHub side. Run from the template repo root:
#   bash scripts/publish-to-r2.sh
#
# Requires:
#   - wrangler installed and authenticated (pnpm i -g wrangler && wrangler login)
#   - access to the game-changer-bucket R2 bucket on the brainai Cloudflare account

set -euo pipefail

BUCKET="game-changer-bucket"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

SHA="$(git rev-parse --short HEAD)"
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TARBALL="$(mktemp -t template.XXXXXX.tar.gz)"
MANIFEST="$(mktemp -t manifest.XXXXXX.json)"
trap 'rm -f "$TARBALL" "$MANIFEST"' EXIT

echo "→ Packing tarball (sha=$SHA)..."
# NOTE: only exclude REAL env files. Do NOT use './.env.*' here — it would
# also strip .env.example, which `npm run setup` needs to create .env.local.
# Keep this list in sync with .github/workflows/publish-template.yml.
tar --exclude='./.git' \
    --exclude='./.github' \
    --exclude='./node_modules' \
    --exclude='./.next' \
    --exclude='./.env' \
    --exclude='./.env.local' \
    --exclude='./.env.development' \
    --exclude='./.env.development.local' \
    --exclude='./.env.production' \
    --exclude='./.env.production.local' \
    --exclude='./.env.test' \
    --exclude='./.env.test.local' \
    --exclude='./.mcp.json' \
    --exclude='.DS_Store' \
    --exclude='./context-practice-files' \
    --exclude='./.agent' \
    --exclude='./CLAUDE.md' \
    -czf "$TARBALL" .

SIZE="$(wc -c < "$TARBALL" | tr -d ' ')"
SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"

cat > "$MANIFEST" <<EOF
{
  "version": "$SHA",
  "publishedAt": "$PUBLISHED_AT",
  "size": $SIZE,
  "sha256": "$SHA256"
}
EOF

echo "→ Manifest:"
cat "$MANIFEST"
echo ""

echo "→ Uploading to R2..."
wrangler r2 object put "$BUCKET/template/$SHA.tar.gz" \
  --file="$TARBALL" --content-type=application/gzip --remote
wrangler r2 object put "$BUCKET/template/latest.tar.gz" \
  --file="$TARBALL" --content-type=application/gzip --remote
wrangler r2 object put "$BUCKET/template/README.md" \
  --file="$REPO_ROOT/README.md" \
  --content-type="text/markdown; charset=utf-8" --remote
wrangler r2 object put "$BUCKET/template/manifest.json" \
  --file="$MANIFEST" --content-type=application/json --remote

echo ""
echo "✅ Published v$SHA to R2."
