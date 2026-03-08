#!/usr/bin/env bash
set -euo pipefail

ISSUE_NUMBER="${1:?Usage: npm run start-work -- <issue-number>}"

# Fetch issue title and labels
TITLE=$(gh issue view "$ISSUE_NUMBER" --json title -q '.title')
LABELS=$(gh issue view "$ISSUE_NUMBER" --json labels -q '[.labels[].name] | join(" ")')

# Infer branch prefix from labels
PREFIX="feat"
if echo "$LABELS" | grep -qiE "bug|fix"; then PREFIX="fix"; fi
if echo "$LABELS" | grep -qiE "chore|maintenance|infrastructure"; then PREFIX="chore"; fi
if echo "$LABELS" | grep -qiE "documentation|docs"; then PREFIX="docs"; fi

# Slugify title: lowercase, strip special chars, spaces to dashes, max 50 chars
SLUG=$(echo "$TITLE" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9 ]//g' \
  | tr -s ' ' '-' \
  | sed 's/^-//;s/-$//' \
  | cut -c1-50)

BRANCH="${PREFIX}/${ISSUE_NUMBER}-${SLUG}"

# Ensure we're on an up-to-date main
git checkout main
git pull origin main

# Create and push the branch
git checkout -b "$BRANCH"
git push -u origin "$BRANCH"

echo ""
echo "Branch: $BRANCH"
echo ""

# Open a draft PR linked to the issue
gh pr create \
  --draft \
  --title "$TITLE" \
  --body "$(cat <<EOF
Closes #${ISSUE_NUMBER}

## Summary
<!-- describe what this PR does -->

## Test plan
- [ ] Tests pass (\`npm test\`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
