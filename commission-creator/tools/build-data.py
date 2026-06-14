#!/usr/bin/env python3
"""Build public commission creator data from local RPE presets and previews.

This intentionally does not copy source PNGs. It emits resized WebP previews
with metadata stripped plus a static JavaScript manifest for GitHub Pages.
"""

from __future__ import annotations

import json
import math
import re
import shutil
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = REPO_ROOT / "commission-creator"

PRESETS_JSON = Path(
    r"C:\Ai Art\webui_forge_cu121_torch231\webui\extensions\Random_prompt_extender\scripts\presets.json"
)
GALLERY_ROOT = Path(r"C:\Users\EthrealSkull\Pictures\Look Book\Presets - Copy")
PROMPTS_ROOT = Path(r"C:\Users\EthrealSkull\Desktop\Prompts\Prompts")

DATA_DIR = APP_ROOT / "data"
PREVIEW_ROOT = APP_ROOT / "assets" / "previews"
MANIFEST_PATH = DATA_DIR / "manifest.js"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MAX_DIMENSION = 520
WEBP_QUALITY = 70

CATEGORY_DIR_ALIASES = {
    "Emotion": ["Emotion", "Emotions"],
    "Props": ["Props", "props"],
}

PROMPT_FILE_ALIASES = {
    "Props": "props.txt",
}


def slugify(value: str) -> str:
    value = value.strip().replace("&", "and")
    value = re.sub(r"[^\w.\- ]+", "", value, flags=re.UNICODE)
    value = re.sub(r"\s+", "-", value)
    return value.strip("-").lower() or "preset"


def normalize_key(value: str) -> str:
    value = value.casefold().strip()
    value = re.sub(r"\s+", " ", value)
    return value


def load_presets() -> dict[str, dict[str, str]]:
    with PRESETS_JSON.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return {str(category): dict(values) for category, values in raw.items() if isinstance(values, dict)}


def load_prompt_file_map() -> dict[str, str]:
    files = {}
    if PROMPTS_ROOT.exists():
        for path in PROMPTS_ROOT.glob("*.txt"):
            if path.name.startswith("_") or path.name.endswith("negs.txt"):
                continue
            files[path.stem.casefold()] = path.name
    return files


def image_dirs_for(category: str) -> list[Path]:
    names = CATEGORY_DIR_ALIASES.get(category, [category])
    return [GALLERY_ROOT / name for name in names if (GALLERY_ROOT / name).is_dir()]


def build_image_index(categories: list[str]) -> dict[str, dict[str, Path]]:
    index: dict[str, dict[str, Path]] = {}
    for category in categories:
        category_index: dict[str, Path] = {}
        for folder in image_dirs_for(category):
            for path in folder.rglob("*"):
                if path.is_file() and path.suffix.casefold() in IMAGE_EXTS:
                    category_index.setdefault(normalize_key(path.stem), path)
        index[category] = category_index
    return index


def copy_preview(source: Path, category: str, preset_name: str) -> tuple[str, float] | tuple[None, None]:
    target_dir = PREVIEW_ROOT / slugify(category)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{slugify(preset_name)}.webp"

    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            ratio = image.width / image.height if image.height else 1.0
            image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
            clean = Image.new("RGB", image.size, (0, 0, 0))
            if image.mode == "RGBA":
                clean.paste(image, mask=image.getchannel("A"))
            else:
                clean.paste(image.convert("RGB"))
            clean.save(target, "WEBP", quality=WEBP_QUALITY, method=6)
    except Exception as exc:
        print(f"Skipping preview {source}: {exc}")
        return None, None

    return target.relative_to(APP_ROOT).as_posix(), ratio


def majority_ratio(ratios: list[float], category: str) -> float:
    if ratios:
        buckets = Counter(round(ratio * 4) / 4 for ratio in ratios if ratio and math.isfinite(ratio))
        if buckets:
            return buckets.most_common(1)[0][0]
    if category == "BG":
        return 16 / 9
    if category in {"Outfit", "Tops", "Bottoms", "Pose", "Characters", "Sex"}:
        return 3 / 4
    return 1.0


def output_file_for(category: str, prompt_files: dict[str, str]) -> str:
    if category in PROMPT_FILE_ALIASES:
        return PROMPT_FILE_ALIASES[category]
    return prompt_files.get(category.casefold(), f"{category}.txt")


def build_manifest() -> dict:
    presets = load_presets()
    prompt_files = load_prompt_file_map()
    image_index = build_image_index(list(presets))

    if PREVIEW_ROOT.exists():
        shutil.rmtree(PREVIEW_ROOT)
    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)

    categories = []
    for category, values in presets.items():
        ratios: list[float] = []
        items = []
        for name, tags in values.items():
            source = image_index.get(category, {}).get(normalize_key(name))
            preview, ratio = (None, None)
            if source:
                preview, ratio = copy_preview(source, category, name)
                if ratio:
                    ratios.append(ratio)
            items.append(
                {
                    "name": name,
                    "tags": str(tags),
                    "preview": preview,
                    "ratio": round(ratio, 4) if ratio else None,
                }
            )

        categories.append(
            {
                "name": category,
                "outputFile": output_file_for(category, prompt_files),
                "placeholderRatio": round(majority_ratio(ratios, category), 4),
                "items": items,
            }
        )

    return {
        "version": "2026-06-14",
        "source": "local-rpe-presets-public-previews",
        "categories": categories,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest()
    payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    MANIFEST_PATH.write_text(f"window.COMMISSION_DATA={payload};\n", encoding="utf-8")

    preview_count = sum(1 for _ in PREVIEW_ROOT.rglob("*.webp"))
    item_count = sum(len(category["items"]) for category in manifest["categories"])
    print(f"Wrote {MANIFEST_PATH}")
    print(f"Categories: {len(manifest['categories'])}")
    print(f"Presets: {item_count}")
    print(f"Previews: {preview_count}")


if __name__ == "__main__":
    main()
