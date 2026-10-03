#!/usr/bin/env bash
# Rebuilds contracts and writes ../artifacts/deploy.json (ABI + creation bytecode)
# for the browser-based deploy on admin.html. Run after changing any contract.
set -euo pipefail
cd "$(dirname "$0")"
forge build >/dev/null 2>&1
python3 - <<'PY'
import json
out = {}
for name in ["Registry", "Raffles", "SweepVault", "FeeRouter", "Launcher", "ExternalVault", "ExternalLauncher", "BatchLister"]:
    a = json.load(open(f"out/{name}.sol/{name}.json"))
    out[name] = {"abi": a["abi"], "bytecode": a["bytecode"]["object"]}
json.dump(out, open("../artifacts/deploy.json", "w"))
print("wrote artifacts/deploy.json")
PY
