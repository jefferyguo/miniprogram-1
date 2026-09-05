#!/usr/bin/env python3
"""从锁定的 0728 DOCX 生成完整 canonical 数据和主包轻量索引。

v3-final: 纯随机永久 contentId (tc_<32hex>)，清单驱动，确定性可重复。
contentId 一次分配永不改变。不包含 day/hash/module/version。
"""
from __future__ import annotations
import argparse, hashlib, html, json, os, re, sys
from collections import defaultdict
from pathlib import Path

from training_id_manifest import ManifestMatchError, resolve_manifest_records

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "resources" / "training-source" / "0728-final"
MANIFEST_PATH = SOURCE_DIR / "source-manifest.json"
ID_MANIFEST_PATH = ROOT / "data" / "import" / "0728-final" / "training-content-id-manifest.json"
IMPORT_DIR = ROOT / "data" / "import" / "0728-final"
CANONICAL_PATH = IMPORT_DIR / "canonical-training-contents.json"
LOCAL_INDEX_PATH = ROOT / "utils" / "generated-training-data.js"

DAY_BOUNDARY_RE = re.compile(
    r"^\s*Day\s*(?P<label>\d+)\s*(?:[：:、.．\-—])?\s*(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
ZERO_WIDTH_RE = re.compile(r"[​-‏⁠-⁤﻿­]")
TITLE_RED = "#b91c1c"
CONTENT_GREEN = "#0f766e"
SOURCE_STYLE = {"fontSize": "small", "color": "green", "bold": True}
CANONICAL_UPDATED_AT = "2026-07-28T00:00:00.000Z"

def sha256_bytes(data: bytes) -> str: return hashlib.sha256(data).hexdigest()
def sha256_text(value: str) -> str: return sha256_bytes(value.encode("utf-8"))
def clean_text(value: str) -> str:
    text = ZERO_WIDTH_RE.sub("", str(value or ""))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n", text)
    return text.strip()

from docx import Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

def iter_document_blocks(document):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P): yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            for row in Table(child, document).rows:
                for cell in row.cells:
                    for p in cell.paragraphs: yield p

def read_docx_blocks(path: Path) -> list[str]:
    return [clean_text(b.text) for b in iter_document_blocks(Document(str(path)))]

def split_rest(rest: str) -> tuple[str, list[str]]:
    lines = [clean_text(l) for l in str(rest or "").split("\n")]
    nonempty = [i for i, l in enumerate(lines) if l]
    if not nonempty: return "", []
    return lines[nonempty[0]], lines[nonempty[0] + 1:]

def trim_blank_lines(lines: list[str]) -> list[str]:
    s, e = 0, len(lines)
    while s < e and not lines[s]: s += 1
    while e > s and not lines[e - 1]: e -= 1
    out, blank = [], False
    for l in lines[s:e]:
        if not l:
            if not blank: out.append(""); blank = True
        else: out.append(l); blank = False
    return out

def parse_articles(path: Path) -> list[dict]:
    blocks = read_docx_blocks(path)
    articles, current = [], None
    def finish():
        nonlocal current
        if not current: return
        lines = trim_blank_lines(current.pop("lines"))
        if not current.get("title"):
            while lines and not lines[0]: lines.pop(0)
            current["title"] = lines.pop(0) if lines else ""
        current["content"] = "\n".join(trim_blank_lines(lines))
        articles.append(current)
        current = None
    for block in blocks:
        m = DAY_BOUNDARY_RE.match(block)
        if m:
            finish()
            title, il = split_rest(m.group("rest"))
            current = {"sourceDayLabel": int(m.group("label")), "title": title, "lines": il}
            continue
        if current is None:
            if block: raise ValueError(f"{path.name}: non-empty before Day: {block[:60]}")
            continue
        if not current["title"] and block:
            t, il = split_rest(block)
            current["title"] = t; current["lines"].extend(il)
        else: current["lines"].append(block)
    finish()
    return articles

def load_id_manifest() -> dict:
    if ID_MANIFEST_PATH.exists():
        return json.loads(ID_MANIFEST_PATH.read_text(encoding="utf-8"))
    return {"schemaVersion": 3, "idFormat": "tc_<32hex_random>", "articles": {}}

def save_id_manifest(manifest: dict) -> None:
    ID_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    ID_MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ——— Build canonical ———
def build_canonical(manifest: dict, *, allow_new: bool) -> tuple[list[dict], dict, dict]:
    source_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    id_manifest = load_id_manifest()
    parsed_modules, source_records = [], []
    revision = source_manifest["sourceRevision"]

    for module in source_manifest["modules"]:
        path = SOURCE_DIR / module["file"]
        if sha256_bytes(path.read_bytes()) != module["sha256"]:
            raise ValueError(f"{module['moduleId']}: source hash mismatch")
        articles = parse_articles(path)
        if len(articles) != int(module["physicalCount"]):
            raise ValueError(f"{module['moduleId']}: expected {module['physicalCount']}, got {len(articles)}")
        if articles[0]["title"] != module["firstTitle"]:
            raise ValueError(f"{module['moduleId']}: first title mismatch")

        parsed_modules.append((module, articles))
        for index, article in enumerate(articles, start=1):
            title = clean_text(article["title"])
            content = clean_text(article["content"])
            if not title or not content:
                raise ValueError(f"{module['moduleId']} index={index}: empty title/content")
            source_records.append({
                "moduleId": module["moduleId"],
                "sourceFile": module["file"],
                "sourceDay": article["sourceDayLabel"],
                "day": index,
                "title": title,
                "titleHash": sha256_text(title),
                "contentHash": sha256_text(content),
            })

    id_manifest, resolved_sources = resolve_manifest_records(
        id_manifest,
        source_records,
        allow_new=allow_new,
    )
    resolved_by_order = {
        (item["moduleId"], item["day"]): item
        for item in resolved_sources
    }

    all_records = []
    for module, articles in parsed_modules:
        mid, records = module["moduleId"], []
        for index, article in enumerate(articles, start=1):
            title = clean_text(article["title"])
            content = clean_text(article["content"])
            ch = sha256_text(content)
            resolved = resolved_by_order[(mid, index)]
            pid = resolved["contentId"]
            body_html = "\n".join(
                f'<p><span style="font-size:14px;color:{CONTENT_GREEN};font-weight:700;">{html.escape(l, quote=True)}</span></p>'
                if l else "<p><br></p>" for l in content.split("\n"))
            records.append({
                "moduleId": mid, "category": module["category"],
                "contentId": pid,
                "day": index, "sortOrder": index, "sourceDay": article["sourceDayLabel"],
                "title": title, "content": content,
                "titleHash": sha256_text(title), "contentHash": ch,
                "richContentHtml": body_html, "richContentHash": sha256_text(body_html),
                "titleStyle": {"color": TITLE_RED} if index == 1 else None,
                "contentStyle": dict(SOURCE_STYLE), "contentStylePreset": "small-green-bold",
                "membershipLevel": "free" if index <= 3 else "member",
                "status": "active", "active": True, "visible": True,
                "origin": "docx_baseline",
                "sourceDocument": module["file"], "sourceDocumentHash": module["sha256"],
                "sourceRevision": revision,
                "contentVersion": resolved["contentVersion"],
                "updatedAt": CANONICAL_UPDATED_AT,
                "updateSource": "controlled_import",
            })
        all_records.extend(records)

    if len({r["contentId"] for r in all_records}) != len(all_records):
        raise ValueError("duplicate contentId — this is a bug in resolve_content_id")
    if len(all_records) != 966:
        raise ValueError(f"expected 966 canonical records, got {len(all_records)}")

    # Module versions and stats
    module_stats = []
    for module in source_manifest["modules"]:
        mid = module["moduleId"]
        mod_records = [r for r in all_records if r["moduleId"] == mid]
        mv = sha256_text("\n".join(f"{r['contentId']}:{r['contentHash']}" for r in mod_records))[:20]
        for r in mod_records: r["moduleVersion"] = mv
        module_stats.append({"moduleId": mid, "count": len(mod_records),
            "firstTitle": mod_records[0]["title"], "lastTitle": mod_records[-1]["title"],
            "moduleVersion": mv, "sourceHash": module["sha256"]})

    return all_records, {
        "manifestVersion": source_manifest["manifestVersion"],
        "sourceRevision": revision, "totalCount": len(all_records),
        "modules": module_stats,
        "canonicalHash": sha256_text(json.dumps(all_records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))),
    }, id_manifest

def local_index(records, meta):
    grouped = defaultdict(list)
    for item in records:
        entry = {
            "contentId": item["contentId"],
            "moduleId": item["moduleId"],
            "day": item["day"],
            "sortOrder": item["sortOrder"],
            "title": item["title"],
            "status": item["status"],
            "contentVersion": item["contentVersion"],
            "membershipLevel": item["membershipLevel"],
        }
        if item.get("titleStyle"):
            entry["titleStyle"] = item["titleStyle"]
        grouped[item["moduleId"]].append(entry)
    compact = {"source": "cloud-first-lightweight-index", "sourceRevision": meta["sourceRevision"],
        "totalCount": meta["totalCount"], "canonicalHash": meta["canonicalHash"],
        "counts": {m["moduleId"]: m["count"] for m in meta["modules"]},
        "moduleVersions": {m["moduleId"]: m["moduleVersion"] for m in meta["modules"]}}
    return ("// 由 scripts/build-training-content-0728.py 确定性生成；仅含导航与离线索引，不含完整正文。\n"
        f"const generatedTrainingDays = {json.dumps(dict(grouped), ensure_ascii=False, separators=(',',':'))}\n\n"
        f"const generatedTrainingMeta = {json.dumps(compact, ensure_ascii=False, separators=(',',':'))}\n\n"
        "module.exports = { generatedTrainingDays, generatedTrainingMeta }\n")

def write_outputs(records, meta):
    IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    CANONICAL_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for mid in ["topic", "reading", "leaderSpeech", "retell", "speech", "mandarin"]:
        mod = [r for r in records if r["moduleId"] == mid]
        (IMPORT_DIR / f"{mid}-complete.json").write_text(
            json.dumps(mod, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    LOCAL_INDEX_PATH.write_text(local_index(records, meta), encoding="utf-8")
    # Generate per-module full-content bundles for local fallback

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    source_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    try:
        records, meta, id_manifest = build_canonical(source_manifest, allow_new=not args.check)
    except ManifestMatchError as error:
        raise SystemExit(f"BLOCKER: {error}") from error

    canonical_text = json.dumps(records, ensure_ascii=False, indent=2) + "\n"
    index_text = local_index(records, meta)
    if args.check:
        failures = []
        if not CANONICAL_PATH.exists() or CANONICAL_PATH.read_text(encoding="utf-8") != canonical_text:
            failures.append(str(CANONICAL_PATH.relative_to(ROOT)))
        if not LOCAL_INDEX_PATH.exists() or LOCAL_INDEX_PATH.read_text(encoding="utf-8") != index_text:
            failures.append(str(LOCAL_INDEX_PATH.relative_to(ROOT)))
        manifest_text = json.dumps(id_manifest, ensure_ascii=False, indent=2) + "\n"
        if not ID_MANIFEST_PATH.exists() or ID_MANIFEST_PATH.read_text(encoding="utf-8") != manifest_text:
            failures.append(str(ID_MANIFEST_PATH.relative_to(ROOT)))
        if failures:
            raise SystemExit("deterministic output mismatch: " + ", ".join(failures))
    else:
        write_outputs(records, meta)
        save_id_manifest(id_manifest)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
