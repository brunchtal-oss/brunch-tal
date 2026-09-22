#!/bin/bash
# Game Changer App Template — macOS Interactive Installer
#
# Usage (recommended — process substitution keeps stdin on the terminal):
#   bash <(curl -fsSL https://raw.githubusercontent.com/RanNahmany/game-changer-app-template/main/scripts/install-mac.sh)
#
# Or download and run:
#   curl -fsSL https://raw.githubusercontent.com/RanNahmany/game-changer-app-template/main/scripts/install-mac.sh -o /tmp/gc-install.sh && bash /tmp/gc-install.sh

set -euo pipefail

REPO_URL="https://github.com/RanNahmany/game-changer-app-template.git"

# ── Colors ──────────────────────────────────────────────────────────────────
cyan()    { echo -e "\033[36m$*\033[0m"; }
green()   { echo -e "\033[32m$*\033[0m"; }
yellow()  { echo -e "\033[33m$*\033[0m"; }
magenta() { echo -e "\033[35m$*\033[0m"; }
bold()    { echo -e "\033[1m$*\033[0m"; }
dim()     { echo -e "\033[2m$*\033[0m"; }
red()     { echo -e "\033[31m$*\033[0m"; }

ok()   { echo -e "  \033[32m✓\033[0m $*"; }
info() { echo -e "  \033[33m→\033[0m $*"; }
err()  { echo -e "  \033[31m✗\033[0m $*"; }

step() {
  echo ""
  cyan "──────────────────────────────────────────────"
  cyan " $*"
  cyan "──────────────────────────────────────────────"
}

# ── Header ───────────────────────────────────────────────────────────────────
echo ""
magenta "╔══════════════════════════════════════════════╗"
magenta "║                                              ║"
magenta "║   🎮  Game Changer — App Template Setup      ║"
magenta "║                                              ║"
magenta "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 1: Project name ─────────────────────────────────────────────────────
step "Step 1 — Project name"
echo ""
dim "  Give your project a name (lowercase, letters/numbers/hyphens)."
dim "  This becomes the folder name and the name in package.json."
echo ""

while true; do
  printf "  $(bold '→ Project name:') " >&2
  # Read from /dev/tty so this works even when the script is piped via curl | bash
  read -r RAW_NAME </dev/tty

  # Sanitize: lowercase, replace anything invalid with a hyphen, collapse & trim hyphens
  PROJECT_NAME=$(echo "$RAW_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//;s/-$//')

  if [[ -z "$PROJECT_NAME" ]]; then
    err "Name cannot be empty — try again."
  else
    break
  fi
done

ok "Project name: $(bold "$PROJECT_NAME")"

# ── Step 2: Choose install location ──────────────────────────────────────────
step "Step 2 — Choose install location"
echo ""

# Detect Desktop (handles Hebrew "שולחן העבודה")
DESKTOP_PATH=""
for candidate in \
    "$HOME/Desktop" \
    "$HOME/שולחן העבודה"; do
  if [[ -d "$candidate" ]]; then
    DESKTOP_PATH="$candidate"
    break
  fi
done
if [[ -z "$DESKTOP_PATH" ]]; then
  DESKTOP_PATH="$HOME/Desktop"
fi

OPTION1="$DESKTOP_PATH/projects/$PROJECT_NAME"
OPTION2="$HOME/projects/$PROJECT_NAME"

dim "  איפה להתקין את הפרויקט?"
echo ""
echo -e "  $(bold '[1]') $OPTION1  $(dim '(ברירת מחדל — מומלץ)')"
echo -e "  $(bold '[2]') $OPTION2"
echo -e "  $(bold '[3]') נתיב מותאם אישית — אני אקליד בעצמי"
echo ""

TARGET_DIR=""
while [[ -z "$TARGET_DIR" ]]; do
  printf "  $(bold '→ בחירה (1 / 2 / 3) [1]:') " >&2
  read -r CHOICE </dev/tty
  CHOICE="${CHOICE:-1}"

  case "$CHOICE" in
    1)
      TARGET_DIR="$OPTION1"
      ;;
    2)
      TARGET_DIR="$OPTION2"
      ;;
    3)
      echo ""
      dim "  הקלידו את נתיב התיקייה ההורית שבה ייווצר הפרויקט."
      dim "  לדוגמה: $HOME/code   או   /Volumes/Work/dev   או   ~/Documents/projects"
      dim "  הטמפלייט ייווצר בתוך התיקייה הזו, בתת-תיקייה בשם \"$PROJECT_NAME\"."
      echo ""
      printf "  $(bold '→ נתיב תיקייה הורית:') " >&2
      read -r CUSTOM_BASE </dev/tty
      # Expand leading ~
      CUSTOM_BASE="${CUSTOM_BASE/#\~/$HOME}"
      CUSTOM_BASE="$(echo "$CUSTOM_BASE" | sed 's/[[:space:]]*$//;s/^[[:space:]]*//')"
      if [[ -z "$CUSTOM_BASE" ]]; then
        err "הנתיב לא יכול להיות ריק — נסו שוב."
      else
        TARGET_DIR="$CUSTOM_BASE/$PROJECT_NAME"
      fi
      ;;
    *)
      err "אנא הקלידו 1, 2 או 3."
      ;;
  esac
done

ok "Target folder: $(bold "$TARGET_DIR")"

# ── Step 3: Clone ─────────────────────────────────────────────────────────────
step "Step 3 — Cloning template"

if [[ -d "$TARGET_DIR" ]]; then
  err "Folder already exists: $TARGET_DIR"
  echo "  Delete it first, or pick a different project name."
  exit 1
fi

PARENT_DIR="$(dirname "$TARGET_DIR")"
mkdir -p "$PARENT_DIR"
git clone "$REPO_URL" "$TARGET_DIR"
ok "Template cloned"

# ── Step 4: Setup ─────────────────────────────────────────────────────────────
step "Step 4 — Running project setup"

cd "$TARGET_DIR"
npm run setup

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
green "══════════════════════════════════════════════════"
bold "✅  הכל מוכן! הצעדים הבאים:"
echo ""
echo -e "  $(bold '1.') פתחו את $(bold 'Visual Studio Code')"
echo ""
echo -e "  $(bold '2.') $(bold 'File > Open Folder')  (או $(yellow 'Cmd+O'))"
echo -e "     ובחרו את התיקייה:"
echo -e "     $(yellow "$TARGET_DIR")"
echo ""
echo -e "  $(bold '3.') פתחו את $(bold 'Claude Code') דרך התוסף של VS Code"
echo -e "     $(dim '(אייקון Claude בסרגל הצד של VS Code)')"
echo ""
echo -e "  $(bold '4.') הקלידו בתוך Claude Code:"
echo -e "     $(yellow "/start-from-template")"
green "══════════════════════════════════════════════════"
echo ""
