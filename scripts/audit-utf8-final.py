# -*- coding: utf-8 -*-
"""Final audit for emoji/dash corruption stubs."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
out = []
for f in sorted(list(ROOT.glob("*.html")) + list(ROOT.glob("*.js"))):
    if f.name.startswith(("_", "tmp", "google")):
        continue
    text = f.read_text(encoding="utf-8")
    issues = []
    if "16?17" in text:
        issues.append("16?17")
    if "?? Errands" in text or "?? Light" in text:
        issues.append("?? labels")
    # class=...emoji...>?</ 
    for m in re.finditer(
        r'class="[^"]*(?:emoji|icon|spark|spinner|camera|arrow|badge)[^"]*"[^>]*>\?(</)',
        text,
        re.I,
    ):
        issues.append("single-? stub: " + m.group(0)[:60])
    # quoted ??
    if "'??'" in text or '"??"' in text:
        issues.append("quoted ??")
    if issues:
        out.append(f.name + ": " + "; ".join(issues[:8]))

# charset
bad = []
for f in ROOT.glob("*.html"):
    if f.name.startswith("google"):
        continue
    text = f.read_text(encoding="utf-8")
    m = re.search(r"<head[^>]*>(.*?)</head>", text, re.I | re.S)
    if not m:
        continue
    inner = re.sub(r"^(?:\s*<!--.*?-->\s*)+", "", m.group(1).lstrip(), flags=re.S)
    if not inner.lower().startswith('<meta charset="utf-8">') and not inner.lower().startswith(
        "<meta charset='utf-8'>"
    ):
        bad.append(f.name)

log = ROOT / "_utf8_final_audit.txt"
log.write_text(
    "\n".join(out + [f"BAD_CHARSET={bad}", f"ISSUE_FILES={len(out)}"]) + "\n",
    encoding="utf-8",
)
print(log.read_text(encoding="utf-8"))
