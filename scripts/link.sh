#!/usr/bin/env bash
set -euo pipefail

DOTBRAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
    echo "Usage: $(basename "$0") <project-path> <type>"
    echo ""
    echo "Symlink CLAUDE.md and .cursorrules from dotbrain into a project."
    echo ""
    echo "Arguments:"
    echo "  project-path   Path to the target project directory"
    echo "  type           Template type: 'software' or 'corporate'"
    echo ""
    echo "Examples:"
    echo "  $(basename "$0") ~/repos/myapp software"
    echo "  $(basename "$0") ~/Projects/26-03-board-report corporate"
    exit 1
}

if [[ $# -ne 2 ]]; then
    usage
fi

PROJECT_PATH="$(realpath "$1")"
TYPE="$2"

if [[ ! -d "$PROJECT_PATH" ]]; then
    echo "Error: $PROJECT_PATH is not a directory"
    exit 1
fi

if [[ "$TYPE" != "software" && "$TYPE" != "corporate" ]]; then
    echo "Error: type must be 'software' or 'corporate', got '$TYPE'"
    exit 1
fi

CLAUDE_TEMPLATE="$DOTBRAIN_DIR/templates/CLAUDE.md.$TYPE"
CURSOR_TEMPLATE="$DOTBRAIN_DIR/templates/cursorrules.$TYPE"

link_file() {
    local src="$1"
    local dest="$2"
    local name="$(basename "$dest")"

    if [[ -e "$dest" || -L "$dest" ]]; then
        echo "  $name: already exists, skipping (remove it first to re-link)"
    else
        ln -s "$src" "$dest"
        echo "  $name: linked"
    fi
}

echo "Linking dotbrain templates ($TYPE) into $PROJECT_PATH"
echo ""

link_file "$CLAUDE_TEMPLATE" "$PROJECT_PATH/CLAUDE.md"
link_file "$CURSOR_TEMPLATE" "$PROJECT_PATH/.cursorrules"

echo ""
echo "Done. Remember to fill in the <PLACEHOLDERS> in the templates."
