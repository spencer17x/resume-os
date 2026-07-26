#!/usr/bin/env bash
# Portable Conventional Commit validator (core type set).
# Copy into the consumer repo as scripts/validate-commit-message.sh
# Types match skills/scripts/validate-commit-message (no "style").
# Compatible with Bash 3.2+ (macOS /bin/bash).
set -euo pipefail

ALLOWED_TYPES='feat|fix|docs|refactor|perf|test|build|ci|chore|revert'
MAX_HEADER_LENGTH=100
ALLOW_FIXUP=0

usage() {
  cat <<'EOF'
Usage: validate-commit-message.sh [--allow-fixup] [commit-message-file]

Read a commit message from the given file, or from standard input when no
file is provided. --allow-fixup permits temporary fixup!, squash!, and
amend! commits for the local commit-msg hook only.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--allow-fixup" ]; then
  ALLOW_FIXUP=1
  shift
fi

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

if [ "$#" -eq 1 ]; then
  if [ ! -f "$1" ]; then
    echo "validate-commit-message: cannot read $1" >&2
    exit 2
  fi
  message=$(cat "$1")
else
  message=$(cat)
fi

message=$(printf '%s' "$message" | tr -d '\r')

# Drop trailing empty lines
tmp=$message
while [ -n "$tmp" ]; do
  last_line=$(printf '%s\n' "$tmp" | tail -n 1)
  if [ -z "$last_line" ]; then
    tmp=$(printf '%s\n' "$tmp" | sed '$d')
  else
    break
  fi
done
message=$tmp

header=$(printf '%s\n' "$message" | sed -n '1p')
second=$(printf '%s\n' "$message" | sed -n '2p')

errfile=$(mktemp)
trap 'rm -f "$errfile"' EXIT

add_error() {
  printf '%s\n' "$1" >>"$errfile"
}

if [ -z "$header" ]; then
  add_error "header must not be empty"
else
  checked_header=$header
  header_label="header"
  skip_rest=0

  case "$header" in
    fixup!\ *|squash!\ *|amend!\ *)
      kind=${header%%!*}
      target=${header#*! }
      if [ "$ALLOW_FIXUP" -eq 0 ]; then
        add_error "temporary ${kind}! commits must be autosquashed before push"
        skip_rest=1
      else
        checked_header=$target
        header_label="fixup target header"
      fi
      ;;
  esac

  if [ "$skip_rest" -eq 0 ]; then
    case "$checked_header" in
      Merge\ *) ;;
      *)
        header_len=${#checked_header}
        if [ "$header_len" -gt "$MAX_HEADER_LENGTH" ]; then
          add_error "${header_label} must be ${MAX_HEADER_LENGTH} characters or fewer (got ${header_len})"
        fi

        if ! printf '%s' "$checked_header" | grep -Eq "^(${ALLOWED_TYPES})(\([a-z0-9]+(-[a-z0-9]+)*\))?\!?: .+$"; then
          add_error "${header_label} must match type(optional-scope)!: summary"
          add_error "allowed types: feat, fix, docs, refactor, perf, test, build, ci, chore, revert"
          add_error "scope, when present, must be lowercase kebab-case"
        else
          summary=${checked_header#*: }
          case "$summary" in
            *.) add_error "summary must not end with a period" ;;
            *。) add_error "summary must not end with a period" ;;
          esac
        fi

        if [ -n "$second" ]; then
          add_error "body must be separated from the header by a blank line"
        fi
        ;;
    esac
  fi
fi

if [ -s "$errfile" ]; then
  while IFS= read -r e; do
    echo "validate-commit-message: $e" >&2
  done <"$errfile"
  exit 1
fi

exit 0
