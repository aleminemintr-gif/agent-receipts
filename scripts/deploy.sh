#!/usr/bin/env bash
# One-shot Cloudflare deploy. Needs CLOUDFLARE_API_TOKEN (Workers Scripts:Edit, D1:Edit)
# and CLOUDFLARE_ACCOUNT_ID in the environment. Never prints secrets.
set -euo pipefail
W="npx --yes wrangler@4"
$W d1 create agent-receipts 2>&1 | tee /tmp/d1.out || true
ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f-]{27}' /tmp/d1.out | head -1 || true)
if [ -z "$ID" ]; then ID=$($W d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0));console.log(l.find(d=>d.name==="agent-receipts").uuid)'); fi
sed -i "s/database_id = .*/database_id = \"$ID\"/" wrangler.toml
$W d1 execute agent-receipts --remote --file worker/schema.sql
$W deploy
