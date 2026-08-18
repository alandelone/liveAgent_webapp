#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "  🚀 Bootstrapping livechat_agent Deterministic Sandbox "
echo "========================================================"

# 1. Check Node.js and NPM
if command -v node >/dev/null 2>&1; then
  echo "[✓] Node.js $(node -v) detected."
else
  echo "[!] Node.js not found. Please install Node.js >= 18."
fi

# 2. Verify deterministic test fixtures
if [ -f "test-fixtures/seed-data.json" ]; then
  echo "[✓] Deterministic test fixtures verified (test-fixtures/seed-data.json)."
else
  echo "[✕] ERROR: test-fixtures/seed-data.json missing!"
  exit 1
fi

# 3. Verify stage-gates and repository structure
echo "[*] Checking repository invariants and stage gates..."
for gate in "01-discovery-brief.md" "02-tech-design.md" "03-execution-brief.md" "04-verification-report.md"; do
  if [ -f "stage-gates/$gate" ]; then
    echo "    - stage-gates/$gate [OK]"
  fi
done

# 4. Install dependencies if package.json exists
if [ -f "package.json" ]; then
  echo "[*] Installing project dependencies..."
  npm install
fi

echo "========================================================"
echo "  [✓] livechat_agent sandbox initialized successfully! "
echo "========================================================"
