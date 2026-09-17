#!/usr/bin/env python3
import urllib.request
import json
import subprocess

token = subprocess.check_output(["gh", "auth", "token"]).decode().strip()
url = "https://api.github.com/repos/ducnm9/project-memory/issues?state=all&per_page=100"
req = urllib.request.Request(url, headers={
    "Authorization": "token " + token,
    "Accept": "application/vnd.github.v3+json"
})
with urllib.request.urlopen(req) as r:
    issues = json.loads(r.read())

print(f"Total issues: {len(issues)}")
for i in sorted(issues, key=lambda x: x["number"]):
    print(f"  #{i['number']:3d}  {i['title'][:80]}")
