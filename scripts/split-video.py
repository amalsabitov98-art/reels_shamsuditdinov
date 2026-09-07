#!/usr/bin/env python
"""Расшифровывает видео и режет его на части 8–10 секунд по границам слов."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


# Windows may default redirected Python output to cp1251.  The local helper reads
# subprocess logs as UTF-8, so make the encoding explicit and never crash merely
# because a log message contains a character outside the active console codepage.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


ROOT = Path(__file__).resolve().parents[1]
FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


def fail(message: str) -> None:
    print(f"ОШИБКА: {message}", file=sys.stderr)
    raise SystemExit(1)


def safe_name(value: str, fallback: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-").lower()
    return value[:48] or fallback


def run(args: list[str]) -> None:
    print("RUN:", " ".join(args))
    subprocess.run(args, check=True)


def duration(path: Path) -> float:
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def choose_boundaries(words: list[dict], total: float, target: float, minimum: float, maximum: float) -> list[float]:
    boundaries = [0.0]
    while total - boundaries[-1] > maximum:
        start = boundaries[-1]
        ideal = start + target
        low, high = start + minimum, min(start + maximum, total)
        candidates: list[tuple[float, float]] = []
        for left, right in zip(words, words[1:]):
            cut = float(left["e"])
            if low <= cut <= high:
                gap = max(0.0, float(right["s"]) - cut)
                score = abs(cut - ideal) - min(gap, 0.8) * 1.8
                candidates.append((score, cut))
        if candidates:
            cut = min(candidates)[1]
        else:
            eligible = [float(w["e"]) for w in words if low <= float(w["e"]) <= high]
            cut = min(eligible, key=lambda x: abs(x - ideal)) if eligible else min(ideal, high)
        if cut <= start + 0.5:
            cut = min(start + target, total)
        boundaries.append(round(cut, 3))
    boundaries.append(round(total, 3))
    return boundaries


TIMINGS = [
    "at the opening moment", "just after the opening", "before the middle",
    "around the middle", "shortly after the middle", "at the closing moment",
]
SHOTS = [
    "FULLSCREEN SPEAKER PUSH IN", "CONTENT WITH CIRCLE", "FULLSCREEN SPEAKER",
    "SPLIT-SCREEN L/R", "FULLSCREEN CONTENT NO SPEAKER", "FULLSCREEN SPEAKER PUSH IN WARM",
]


def phrase(words: list[dict], start: float, end: float) -> str:
    picked = [str(w["w"]).strip() for w in words if float(w["s"]) < end and float(w["e"]) > start]
    text = " ".join(picked).strip(" ,.!?—–-")
    if not text:
        return "КЛЮЧЕВАЯ МЫСЛЬ"
    tokens = text.split()
    return " ".join(tokens[:5]).upper()[:54]


def build_spec(slug: str, prefix: str, project_dir: Path, parts: list[dict], words: list[dict]) -> dict:
    spec_parts = []
    for part in parts:
        length = part["end"] - part["start"]
        panels = []
        for index in range(6):
            # Leave enough room before the physical end of the video stream.
            # Container/audio duration may be a few frames longer than video.
            at = min(max(0.15, length * index / 5), max(0.15, length - 0.45))
            absolute = part["start"] + at
            head = phrase(words, absolute - 0.7, absolute + 1.25)
            panels.append({
                "at": round(at, 2),
                "shot": SHOTS[index],
                "timing": TIMINGS[index],
                "desc": f'Show one bold Russian headline: «{head}». Use one simple kinetic visual metaphor, with no other text.',
            })
        spec_parts.append({"n": part["n"], "transcript": part["text"], "panels": panels})
    rel = project_dir.relative_to(ROOT).as_posix()
    return {
        "slug": slug,
        "prefix": prefix,
        "styleName": "кинетик",
        "style": "pure jet black background, bold orange accents, bold condensed sans, kinetic typography with overshoot punches, no gradients, no glass, no texture",
        "srcDir": f"{rel}/parts",
        "outDir": f"{rel}/storyboard",
        "framesDir": f"{rel}/frames",
        "parts": spec_parts,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--prefix", default="r")
    parser.add_argument("--lang", default="ru", choices=["ru", "en", "auto"])
    parser.add_argument("--target", type=float, default=9.0)
    args = parser.parse_args()

    source_input = Path(args.input).resolve()
    if not source_input.is_file():
        fail(f"исходник не найден: {source_input}")
    slug = safe_name(args.slug, "reel")
    prefix = safe_name(args.prefix, "r")[:12]
    project_dir = ROOT / "workspace" / "reels" / slug
    parts_dir = project_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "storyboard").mkdir(exist_ok=True)
    (project_dir / "frames").mkdir(exist_ok=True)
    (project_dir / "omni").mkdir(exist_ok=True)

    source = project_dir / ("source" + (source_input.suffix.lower() or ".mp4"))
    if source_input != source:
        shutil.copy2(source_input, source)
        if source_input.parent.name == "_uploads":
            source_input.unlink(missing_ok=True)
    words_path = project_dir / "words.json"
    run([
        sys.executable, str(ROOT / "scripts" / "transcribe.py"), str(source),
        "--words", "--lang", args.lang, "--out", str(words_path),
    ])
    words = json.loads(words_path.read_text(encoding="utf-8"))
    total = duration(source)
    boundaries = choose_boundaries(words, total, args.target, 6.5, 10.0)
    parts = []
    for number, (start, end) in enumerate(zip(boundaries, boundaries[1:]), start=1):
        out = parts_dir / f"{prefix}{number}-video.mp4"
        run([
            FFMPEG, "-y", "-ss", f"{start:.3f}", "-t", f"{end-start:.3f}", "-i", str(source),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out),
        ])
        text = " ".join(str(w["w"]).strip() for w in words if float(w["s"]) < end and float(w["e"]) > start).strip()
        parts.append({"n": number, "file": out.name, "start": start, "end": end, "duration": round(end-start, 3), "text": text})

    spec = build_spec(slug, prefix, project_dir, parts, words)
    (project_dir / "sb-spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    project = {
        "slug": slug, "prefix": prefix, "language": args.lang,
        "source": source.name, "duration": round(total, 3), "parts": parts,
        "status": "prepared", "final": "final.mp4",
    }
    (project_dir / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ГОТОВО: {slug}, частей: {len(parts)}, длительность: {total:.1f} с")


if __name__ == "__main__":
    main()
