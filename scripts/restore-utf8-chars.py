# -*- coding: utf-8 -*-
"""Restore emoji/en-dash corruption (?? / 16?17) from last clean UTF-8 commit.
Always read/write UTF-8 (no BOM)."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GOOD_COMMIT = "0964579"
LOG = ROOT / "_utf8_restore_log.txt"


def write_utf8(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def read_utf8(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    return raw.decode("utf-8")


def git_show(commit: str, rel: str) -> str | None:
    try:
        data = subprocess.check_output(
            ["git", "show", f"{commit}:{rel}"],
            cwd=ROOT,
        )
    except subprocess.CalledProcessError:
        return None
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return data.decode("utf-8")


# Explicit high-confidence maps (survive even if good commit lacks a page)
EXPLICIT = [
    ("16?17", "16–17"),
    ("16? 17", "16–17"),
    ("?? Errands", "🚗 Errands"),
    ("?? Home", "🏠 Home"),
    ("?? Tutoring", "📚 Tutoring"),
    ("?? Beauty", "💅 Beauty"),
    ("?? Moving", "📦 Moving"),
    ("?? Cooking", "🍳 Cooking"),
    ("?? Tech", "💻 Tech"),
    ("?? Care", "👶 Care"),
    ("?? Gardening", "🌱 Gardening"),
    ("?? Garden", "🌱 Garden"),
    ("?? Events", "🎉 Events"),
    ("?? Trades", "🔧 Trades"),
    ("?? Other", "📋 Other"),
    ("?? Admin", "📋 Admin"),
    ("?? Quick", "⚡ Quick"),
    ("?? Standard", "📋 Standard"),
    ("?? Recurring", "🔄 Recurring"),
    ("?? Negotiable", "💬 Negotiable"),
    ("?? Light", "☀️ Light"),
    ("?? Dark", "🌙 Dark"),
    ("?? Poster mode", "📌 Poster mode"),
    ("?? Tasker mode", "🔧 Tasker mode"),
    ("?? View profile", "👤 View profile"),
    ("?? Switch mode", "🔄 Switch mode"),
    ("?? Add to Home Screen", "📲 Add to Home Screen"),
    ("?? Beta feedback", "💬 Beta feedback"),
    ("?? Log out", "🚪 Log out"),
    ("?? Post a task", "✏️ Post a task"),
    ("?? Add photos", "📷 Add photos"),
    ("?? Add a payment method to post", "💳 Add a payment method to post"),
    ("?? Verify your email to start working", "✉️ Verify your email to start working"),
    ("?? Switch to Tasker", "🔄 Switch to Tasker"),
    ("?? Switch to Poster", "🔄 Switch to Poster"),
    ("?? Start finding work", "🔍 Start finding work"),
    ("?? Become a Poster", "📌 Become a Poster"),
    ("?? Pay to unlock chat", "💳 Pay to unlock chat"),
    ("?? Photo updates requested", "📷 Photo updates requested"),
    ("icon:'??'", None),  # filled from good commit later
]

# Category icon codepoints used in CAT_ICONS / chips
CAT_ICON = {
    "Errands": "🚗",
    "Home": "🏠",
    "Tutoring": "📚",
    "Beauty": "💅",
    "Moving": "📦",
    "Cooking": "🍳",
    "Tech": "💻",
    "Care": "👶",
    "Gardening": "🌱",
    "Garden": "🌱",
    "Events": "🎉",
    "Trades": "🔧",
    "Other": "📋",
    "Admin": "📋",
}


def build_maps_from_good(good: str) -> list[tuple[str, str]]:
    maps: list[tuple[str, str]] = []
    # emoji (incl ZWJ/variation) + optional space + label
    for m in re.finditer(
        r"((?:[\U0001F300-\U0001FAFF]|[\u2600-\u27BF]|[\uFE0F]|[\u200D])+)\s*"
        r"([A-Za-z][A-Za-z0-9 &'/.-]{0,48})",
        good,
    ):
        emoji, label = m.group(1), m.group(2).rstrip()
        if not label or len(label) < 2:
            continue
        maps.append((f"?? {label}", f"{emoji} {label}"))
        maps.append((f"??{label}", f"{emoji}{label}"))
        maps.append((f"'{emoji} {label}'".replace(emoji, "??"), f"'{emoji} {label}'"))
        # JS icon:'🚗' style when corrupted to icon:'??'
    # en-dashes between digits / money
    for m in re.finditer(r"(\d+)\s*–\s*(\d+)", good):
        a, b = m.group(1), m.group(2)
        maps.append((f"{a}?{b}", f"{a}–{b}"))
        maps.append((f"{a} ? {b}", f"{a} – {b}"))
    for m in re.finditer(r"(\$\d+)\s*–\s*(\$\d+)", good):
        a, b = m.group(1), m.group(2)
        maps.append((f"{a} ? {b}", f"{a} – {b}"))
        maps.append((f"{a}?{b}", f"{a}–{b}"))
    # arrows
    if "→" in good:
        maps.append((" â ", " → "))
        maps.append(("?", "→"))  # too aggressive — skip bare ?
    return maps


def restore_file(rel: str, log: list[str]) -> bool:
    path = ROOT / rel
    if not path.is_file():
        return False
    cur = read_utf8(path)
    if "??" not in cur and "16?17" not in cur and " ? " not in cur:
        # still fix 16?17 style
        if not re.search(r"\d\?\d", cur):
            return False

    good = git_show(GOOD_COMMIT, rel.replace("\\", "/"))
    maps: list[tuple[str, str]] = []
    maps.extend(EXPLICIT)
    if good:
        maps.extend(build_maps_from_good(good))

    # CAT_ICONS style: icon:'??' near catLabel
    for label, icon in CAT_ICON.items():
        maps.append((f"catLabel:'{label}',icon:'??'", f"catLabel:'{label}',icon:'{icon}'"))
        maps.append((f'catLabel:"{label}",icon:"??"', f'catLabel:"{label}",icon:"{icon}"'))
        maps.append((f"'{label}': '??'", f"'{label}': '{icon}'"))
        maps.append((f'"{label}": "??"', f'"{label}": "{icon}"'))

    # Theme / greeting fallbacks
    maps.extend(
        [
            ("Good evening ??", "Good evening 👋"),
            ("Good morning ??", "Good morning 👋"),
            ("Good afternoon ??", "Good afternoon 👋"),
            ("' ??'", "' 👋'"),
            ('" ??"', '" 👋"'),
            ("?? <strong>Set up payouts</strong>", "🏦 <strong>Set up payouts</strong>"),
            ("Set up payouts</strong> ? ", "Set up payouts</strong> — "),
            (" ? ?? ", " · 🗓 "),
            (" ? ?? Photo", " · 📷 Photo"),
            ("My Tasks ? Posted", "My Tasks → Posted"),
            ("tasks ? not", "tasks — not"),
            ("method ? drafts", "method — drafts"),
            ("Posting?", "Posting…"),
            ("Saving draft?", "Saving draft…"),
            ("Opening Stripe?", "Opening Stripe…"),
            ("content:'??'", "content:'✨'"),
            ('content:"??"', 'content:"✨"'),
            ("nav-icon\">??</button>", "nav-icon\">🔔</button>"),
            ("schedule-preview-icon\" aria-hidden=\"true\">??</span>", "schedule-preview-icon\" aria-hidden=\"true\">📅</span>"),
            ("success-icon\">??</div>", "success-icon\">🎉</div>"),
            ("font-size:16px\">??</span>", "font-size:16px\">💡</span>"),
            ("font-size:16px;\">??</span>", "font-size:16px;\">💡</span>"),
            ("openMoreDates()\">??<br>", "openMoreDates()\">📅<br>"),
            ("mode === 'recurring' ? '?? Recurring'", "mode === 'recurring' ? '🔄 Recurring'"),
            ("badge-recurring\">?? Recurring", "badge-recurring\">🔄 Recurring"),
            ("badge-standard\">?? Standard", "badge-standard\">📋 Standard"),
            ("badge-negotiable\">?? Negotiable", "badge-negotiable\">💬 Negotiable"),
            # en-dash money ranges commonly mangled
            ("$20 ? $60", "$20 – $60"),
            ("$20 ? $40", "$20 – $40"),
            ("$40 ? $150", "$40 – $150"),
            ("8am ? 12pm", "8am – 12pm"),
            ("12pm ? 5pm", "12pm – 5pm"),
            ("5pm ? 9pm", "5pm – 9pm"),
            ("Flexible ? tasker", "Flexible — tasker"),
            ("Post task ?", "Post task →"),
            ("'Post task ?'", "'Post task →'"),
            # profile skills list style
            ("?? Tech", "💻 Tech"),
            ("?? Tutoring", "📚 Tutoring"),
        ]
    )

    # Deduplicate keeping first
    seen = set()
    ordered: list[tuple[str, str]] = []
    for a, b in maps:
        if b is None or not a or a == b:
            continue
        if a in seen:
            continue
        # skip dangerous single-char maps
        if a in {"?", "??"}:
            continue
        seen.add(a)
        ordered.append((a, b))

    # Longest first so "?? Add a payment..." beats "?? Add"
    ordered.sort(key=lambda pair: len(pair[0]), reverse=True)

    out = cur
    hits = 0
    for a, b in ordered:
        if a in out:
            c = out.count(a)
            out = out.replace(a, b)
            hits += c

    # Remaining ?? Light / Dark in ternary
    out2, n = re.subn(r"\?\? Light", "☀️ Light", out)
    out, hits = out2, hits + n
    out2, n = re.subn(r"\?\? Dark", "🌙 Dark", out)
    out, hits = out2, hits + n
    out2, n = re.subn(r"16\?17", "16–17", out)
    out, hits = out2, hits + n

    # If good file exists, restore standalone ?? that match unique emoji-only tags from good
    # e.g. <button class="nav-icon">🔔</button>
    if good:
        for m in re.finditer(
            r">((?:[\U0001F300-\U0001FAFF]|[\u2600-\u27BF]|[\uFE0F]|[\u200D])+)</",
            good,
        ):
            emoji = m.group(1)
            # only replace ?? in same tag shape when unique enough — skip

    if out == cur:
        log.append(f"{rel}: no changes (remaining ??={cur.count('??')})")
        return False

    write_utf8(path, out)
    rem = out.count("??")
    log.append(f"{rel}: replaced~{hits}, remaining ??={rem}")
    return True


def main() -> None:
    log: list[str] = []
    # Prefer HTML/JS that commonly hold UI chrome
    targets: list[str] = []
    for p in sorted(ROOT.iterdir()):
        if p.suffix.lower() in {".html", ".js", ".css", ".md"} and p.is_file():
            if p.name.startswith("tmp-") or p.name.startswith("_"):
                continue
            targets.append(p.name)
    for folder in ("scripts",):
        d = ROOT / folder
        if d.is_dir():
            for p in d.rglob("*"):
                if p.suffix.lower() in {".html", ".js", ".md"} and p.is_file():
                    targets.append(str(p.relative_to(ROOT)).replace("\\", "/"))

    changed = 0
    for rel in targets:
        try:
            if restore_file(rel, log):
                changed += 1
        except Exception as e:
            log.append(f"{rel}: ERROR {e}")

    # Charset check
    bad_charset = []
    for p in ROOT.glob("*.html"):
        text = read_utf8(p)
        head = text[:800]
        if "<meta charset=\"UTF-8\">" not in head and "<meta charset='UTF-8'>" not in head:
            bad_charset.append(p.name)
        # ensure charset is first in head
        m = re.search(r"<head[^>]*>(.*?)</head>", text, re.I | re.S)
        if m:
            inner = m.group(1).lstrip()
            if not re.match(r'<!--.*?-->\s*<meta charset="UTF-8">|<meta charset="UTF-8">', inner, re.I | re.S):
                # allow qg-build comment after charset; require charset near start
                if not re.search(r"<meta charset=\"UTF-8\">", inner[:200], re.I):
                    bad_charset.append(p.name + " (order)")

    log.append(f"FILES_CHANGED={changed}")
    log.append(f"BAD_CHARSET={bad_charset}")
    write_utf8(LOG, "\n".join(log) + "\n")
    print(f"Wrote {LOG.name}; changed={changed}")


if __name__ == "__main__":
    main()
