import json
from pathlib import Path

errors = []
for path in Path("specs").rglob("*.json"):
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append((path, exc))

if errors:
    for path, exc in errors:
        print(f"INVALID {path}: {exc}")
    raise SystemExit(1)

print("All JSON specs are valid.")
