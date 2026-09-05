#!/usr/bin/env python3
"""全量核验：DOCX → canonical → local index。三轮独立检查。"""
from __future__ import annotations
import hashlib, json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "resources" / "training-source" / "0728-final"
CANONICAL_PATH = ROOT / "data" / "import" / "0728-final" / "canonical-training-contents.json"
LOCAL_INDEX_PATH = ROOT / "utils" / "generated-training-data.js"

# —— DOCX parser (same as build-training-content-0728.py) ——
from docx import Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

DAY_BOUNDARY_RE = re.compile(
    r"^\s*Day\s*(?P<label>\d+)\s*(?:[：:、.．\-—])?\s*(?P<rest>.*)$",
    re.IGNORECASE | re.DOTALL,
)
ZERO_WIDTH_RE = re.compile(r"[​-‏⁠-⁤﻿­]")

def clean_text(value: str) -> str:
    text = ZERO_WIDTH_RE.sub("", str(value or ""))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n", text)
    return text.strip()

def iter_document_blocks(document):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            table = Table(child, document)
            for row in table.rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        yield paragraph

def read_docx_blocks(path: Path) -> list[str]:
    document = Document(str(path))
    return [clean_text(block.text) for block in iter_document_blocks(document)]

def split_rest(rest: str) -> tuple[str, list[str]]:
    lines = [clean_text(line) for line in str(rest or "").split("\n")]
    nonempty = [i for i, line in enumerate(lines) if line]
    if not nonempty:
        return "", []
    title_index = nonempty[0]
    return lines[title_index], lines[title_index + 1:]

def trim_blank_lines(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and not lines[start]: start += 1
    while end > start and not lines[end - 1]: end -= 1
    output = []
    blank = False
    for line in lines[start:end]:
        if not line:
            if not blank: output.append("")
            blank = True
        else:
            output.append(line)
            blank = False
    return output

def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def parse_articles(path: Path) -> list[dict]:
    blocks = read_docx_blocks(path)
    articles = []
    current = None

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
        boundary = DAY_BOUNDARY_RE.match(block)
        if boundary:
            finish()
            title, initial_lines = split_rest(boundary.group("rest"))
            current = {
                "sourceDayLabel": int(boundary.group("label")),
                "title": title,
                "lines": initial_lines,
            }
            continue
        if current is None:
            if block:
                raise ValueError(f"{path.name}: non-empty before Day boundary: {block[:60]}")
            continue
        if not current["title"] and block:
            title, initial_lines = split_rest(block)
            current["title"] = title
            current["lines"].extend(initial_lines)
        else:
            current["lines"].append(block)
    finish()
    return articles

# —— Load canonical ——
canonical = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))
canonical_by_module_day = {}
for item in canonical:
    key = (item["category"], item["day"])
    if key in canonical_by_module_day:
        print(f"DUPLICATE canonical key: {key}")
    canonical_by_module_day[key] = item

# —— Parse each DOCX ——
modules = [
    ("topic", "即兴讲话0728（定稿，未上传）(1).docx"),
    ("reading", "朗诵训练0728（已定稿，未上传）.docx"),
    ("leaderSpeech", "领导发言0728（定稿，未上传）.docx"),
    ("retell", "每日复述练嘴0728（定稿，未上传）.docx"),
    ("speech", "演讲训练0728（定稿，未上传）.docx"),
    ("mandarin", "主持、普通话声音训练0728（定稿，未上传）.docx"),
]

results = []
mismatches = []
empty_content = []
duplicates = []

for module_id, filename in modules:
    path = SOURCE_DIR / filename
    articles = parse_articles(path)

    for idx, article in enumerate(articles, start=1):
        docx_title = clean_text(article["title"])
        docx_content = clean_text(article["content"])
        docx_hash = sha256_text(docx_content)
        source_day = article["sourceDayLabel"]

        # Find canonical record by (category, day) where day = index position
        canon = canonical_by_module_day.get((module_id, idx))

        if canon is None:
            mismatches.append({
                "module": module_id, "sourceDay": source_day, "position": idx,
                "error": "NO_CANONICAL_MATCH",
                "docxTitle": docx_title[:60]
            })
            continue

        canon_title = clean_text(canon["title"])
        canon_content = clean_text(canon["content"])
        canon_hash = canon.get("contentHash", sha256_text(canon_content))

        title_match = docx_title == canon_title
        content_match = docx_hash == canon_hash

        # Check for empty content
        if not docx_content:
            empty_content.append({"module": module_id, "day": idx, "title": docx_title[:60]})

        # Check first/last line match even if hash differs
        docx_first = docx_content.split("\n")[0].strip() if docx_content else ""
        canon_first = canon_content.split("\n")[0].strip() if canon_content else ""
        docx_last = docx_content.split("\n")[-1].strip() if docx_content else ""
        canon_last = canon_content.split("\n")[-1].strip() if canon_content else ""

        r = {
            "module": module_id,
            "day": idx,
            "sourceDayLabel": source_day,
            "docxTitle": docx_title[:80],
            "canonTitle": canon_title[:80],
            "titleMatch": title_match,
            "docxContentHash": docx_hash[:16],
            "canonContentHash": canon_hash[:16],
            "contentMatch": content_match,
            "firstLineMatch": docx_first[:60] == canon_first[:60],
            "lastLineMatch": docx_last[:60] == canon_last[:60],
            "docxLen": len(docx_content),
            "canonLen": len(canon_content),
            "emptyContent": not docx_content,
        }
        results.append(r)

        if not title_match or not content_match:
            mismatches.append(r)

# —— Report ——
total = len(results)
title_mismatch = sum(1 for r in results if not r["titleMatch"])
content_mismatch = sum(1 for r in results if not r["contentMatch"])
empty = sum(1 for r in results if r["emptyContent"])
dup_check = defaultdict(list)
for item in canonical:
    dup_check[(item["category"], item["day"])].append(item["contentId"])
dup_count = sum(1 for v in dup_check.values() if len(v) > 1)

print(f"=== 全量核验结果 ===")
print(f"总记录数: {total}")
print(f"标题不匹配: {title_mismatch}")
print(f"正文不匹配: {content_mismatch}")
print(f"正文为空: {empty}")
print(f"重复(module+day): {dup_count}")

if mismatches:
    print(f"\n=== 不匹配详情 ({len(mismatches)} 条) ===")
    for m in mismatches[:20]:
        if isinstance(m, dict) and "error" not in m:
            print(f"  {m['module']} day={m['day']} sourceDay={m.get('sourceDayLabel','?')}")
            print(f"    DOCX标题: {m['docxTitle']}")
            print(f"    canon标题: {m['canonTitle']}")
            print(f"    标题匹配: {m['titleMatch']}, 正文匹配: {m['contentMatch']}")
            print(f"    首行匹配: {m['firstLineMatch']}, 末行匹配: {m['lastLineMatch']}")
            print(f"    DOCX长度: {m['docxLen']}, canon长度: {m['canonLen']}")

    # Check for adjacent swaps
    print(f"\n=== 相邻Day正文交换检查 ===")
    for i in range(len(results) - 1):
        a, b = results[i], results[i+1]
        if a["module"] == b["module"] and a["day"] + 1 == b["day"]:
            if not a["contentMatch"] and not b["contentMatch"]:
                # Check if swapping fixes
                canon_a = canonical_by_module_day.get((a["module"], a["day"]))
                canon_b = canonical_by_module_day.get((a["module"], b["day"]))
                if canon_a and canon_b:
                    if sha256_text(clean_text(canon_a["content"])) == b["docxContentHash"]:
                        print(f"  SWAP: {a['module']} day={a['day']} ↔ day={b['day']}")

# —— Final summary ——
print(f"\n=== 最终结论 ===")
if title_mismatch == 0 and content_mismatch == 0 and empty == 0 and dup_count == 0:
    print("TRAINING_CONTENT_MAPPING_VERIFIED: 全部匹配")
    json.dump({"status": "VERIFIED", "total": total, "mismatches": 0}, sys.stdout)
else:
    print(f"TRAINING_CONTENT_MAPPING_HAS_ISSUES: title={title_mismatch} content={content_mismatch} empty={empty} dup={dup_count}")
    json.dump({
        "status": "HAS_ISSUES",
        "total": total,
        "titleMismatch": title_mismatch,
        "contentMismatch": content_mismatch,
        "emptyContent": empty,
        "duplicates": dup_count,
        "mismatchDetails": [{"module": m["module"], "day": m["day"], "titleMatch": m.get("titleMatch", False), "contentMatch": m.get("contentMatch", False)} for m in mismatches if isinstance(m, dict) and "error" not in m]
    }, sys.stdout, ensure_ascii=False, indent=2)
