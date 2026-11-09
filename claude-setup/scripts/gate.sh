#!/bin/bash
# gate.sh: stage the four account skills without their test files, then run the studio's account-skills gate
# (joyisfree1, branch claude/skill-trims-2026-11-05, scripts/account-skills-check.mjs) and zip what passes.
# It refuses a skill whose live copy moved since its recorded base, any key-shaped string or session link, a
# description over 200 characters, or a key claude.ai rejects. Tests and mutate.mjs stay in the repo, out of the zips.
#   claude-setup/scripts/gate.sh <zip-dir>            check the four and write <zip-dir>/<name>.zip for each pass
#   claude-setup/scripts/gate.sh <zip-dir> --rebase   record the live copies as the bases (claude-setup/skills/bases.json)
# env: STUDIO (default: ../../joyisfree1 from this folder), SYNCED_SKILLS_DIR (default ~/.claude/skills/synced)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?usage: gate.sh <zip-dir> [--rebase]}; mode=${2:-}
STUDIO=${STUDIO:-$here/../../joyisfree1}; BRANCH=claude/skill-trims-2026-11-05
SYNCED=${SYNCED_SKILLS_DIR:-$HOME/.claude/skills/synced}
SKILLS="joy-boot maxx fresh transfer"
stage=$(mktemp -d)
for s in $SKILLS; do cp -R "$here/skills/$s" "$stage/"; done
find "$stage" -name '*.test.mjs' -delete; rm -f "$stage"/*/scripts/mutate.mjs
[ -f "$here/skills/bases.json" ] && cp "$here/skills/bases.json" "$stage/bases.json"
git -C "$STUDIO" fetch -q origin "$BRANCH:refs/remotes/origin/$BRANCH"
gate=$(mktemp -d)/account-skills-check.mjs
git -C "$STUDIO" show "origin/$BRANCH:scripts/account-skills-check.mjs" > "$gate"
if [ "$mode" = "--rebase" ]; then
  ACCOUNT_SKILLS_DIR="$stage" SYNCED_SKILLS_DIR="$SYNCED" node "$gate" --rebase $SKILLS
  cp "$stage/bases.json" "$here/skills/bases.json"; echo "bases recorded in claude-setup/skills/bases.json"; exit 0
fi
ACCOUNT_SKILLS_DIR="$stage" SYNCED_SKILLS_DIR="$SYNCED" node "$gate" $SKILLS --zip "$out"
