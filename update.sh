#!/usr/bin/env sh
# Update this SpellDirector checkout to the latest main.
# Usage: ./update.sh
# Safe: it never discards your work. If you have uncommitted changes it stops and tells you.
cd "$(dirname "$0")" || exit 1

fail() { echo; echo "$1"; echo "Update did not finish."; exit 1; }

command -v git >/dev/null 2>&1 || fail "Git was not found. Install it and try again."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "This folder is not a git checkout, so there is nothing to update."

# Stop if tracked files have uncommitted changes. Untracked files are left alone.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "You have uncommitted changes, so nothing was updated:"
  git status --short --untracked-files=no
  fail "Commit or stash them (or ask Claude), then run ./update.sh again."
fi

old_req=$(git rev-parse HEAD:requirements-dev.txt 2>/dev/null)

echo "Fetching from GitHub..."
git fetch --prune origin || fail "Could not reach GitHub. Check your internet connection or sign-in and try again."

branch=$(git branch --show-current)
if [ "$branch" != "main" ]; then
  echo "Switching from \"$branch\" to main..."
  git switch main || fail "Could not switch to main. See the message above."
fi

echo "Updating main..."
git pull --ff-only origin main || fail "Your local main has commits that are not on GitHub, so it can't be fast-forwarded. Nothing was changed. Ask Claude to help sort it out."

# List local branches whose GitHub branch was deleted (usually merged). They are kept.
gone=$(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | awk '$2 == "[gone]" { print "  " $1 }')
if [ -n "$gone" ]; then
  echo
  echo "These local branches were deleted on GitHub. Remove one with \"git branch -D name\" when you are done with it:"
  echo "$gone"
fi

new_req=$(git rev-parse HEAD:requirements-dev.txt 2>/dev/null)
if [ "$old_req" != "$new_req" ]; then
  echo
  echo "Python packages changed. Updating them..."
  PY=python3
  command -v "$PY" >/dev/null 2>&1 || PY=python
  if command -v "$PY" >/dev/null 2>&1; then
    "$PY" -m pip install -r requirements-dev.txt || echo "Packages could not be updated. The viewer still works; the breakdown tool and tests may need them."
  else
    echo "Python was not found, so packages were not updated. The viewer still works."
  fi
fi

echo
echo "Up to date: SpellDirector $(cat VERSION) on main."
git log -1 --format='Latest change: %s (%cr)'
