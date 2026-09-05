#!/usr/bin/env python3
"""生成六份锁定训练源文件的逐条审计报告。"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "resources" / "training-source" / "0728-final"
SOURCE_MANIFEST = SOURCE_DIR / "source-manifest.json"
CANONICAL = ROOT / "data" / "import" / "0728-final" / "canonical-training-contents.json"
REPORT_DIR = ROOT / "reports" / "training-source-audit"
EXPECTED_COUNTS = {
    "topic": 276,
    "reading": 216,
    "leaderSpeech": 24,
    "retell": 257,
    "speech": 116,
    "mandarin": 77,
}


def load_builder():
    path = ROOT / "scripts" / "build-training-content-0728.py"
    spec = importlib.util.spec_from_file_location("training_content_builder", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def write_json(name: str, value) -> None:
    (REPORT_DIR / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    builder = load_builder()
    source_manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    canonical = json.loads(CANONICAL.read_text(encoding="utf-8"))
    canonical_by_module = defaultdict(list)
    for item in canonical:
        canonical_by_module[item["moduleId"]].append(item)

    source_files = []
    source_counts = []
    empty_content = []
    malformed = []
    source_day_anomalies = []
    title_checks = []
    all_physical = []

    for module in source_manifest["modules"]:
        module_id = module["moduleId"]
        path = SOURCE_DIR / module["file"]
        raw_blocks = builder.read_docx_blocks(path)
        raw_boundaries = sum(1 for block in raw_blocks if builder.DAY_BOUNDARY_RE.match(block))
        articles = builder.parse_articles(path)
        canonical_items = sorted(canonical_by_module[module_id], key=lambda item: item["sortOrder"])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        source_files.append({
            "path": str(path.resolve()),
            "fileType": ".docx",
            "moduleId": module_id,
            "sha256": digest,
            "manifestSha256": module["sha256"],
            "rawDayBoundaryCount": raw_boundaries,
            "parsedRecordCount": len(articles),
            "expectedRecordCount": EXPECTED_COUNTS[module_id],
        })
        source_counts.append({
            "moduleId": module_id,
            "rawRecordCount": raw_boundaries,
            "parsedRecordCount": len(articles),
            "canonicalRecordCount": len(canonical_items),
            "expectedRecordCount": EXPECTED_COUNTS[module_id],
            "countsMatch": raw_boundaries == len(articles) == len(canonical_items) == EXPECTED_COUNTS[module_id],
        })

        if digest != module["sha256"]:
            malformed.append({"moduleId": module_id, "type": "source_hash_mismatch", "path": str(path)})
        if len(articles) != EXPECTED_COUNTS[module_id]:
            malformed.append({
                "moduleId": module_id,
                "type": "count_mismatch",
                "expected": EXPECTED_COUNTS[module_id],
                "actual": len(articles),
            })

        source_day_counts = Counter(int(article["sourceDayLabel"]) for article in articles)
        for source_day, count in source_day_counts.items():
            if count > 1:
                source_day_anomalies.append({
                    "moduleId": module_id,
                    "type": "duplicate_source_day_label_non_blocking",
                    "sourceDay": source_day,
                    "count": count,
                    "action": "preserve_physical_order; sourceDay_is_audit_only",
                })

        for position, article in enumerate(articles, start=1):
            title = builder.clean_text(article["title"])
            content = builder.clean_text(article["content"])
            canonical_item = canonical_items[position - 1] if position <= len(canonical_items) else None
            fingerprint = hashlib.sha256(f"{title}\0{content}".encode("utf-8")).hexdigest()
            physical = {
                "moduleId": module_id,
                "sourceFile": module["file"],
                "sourceDay": int(article["sourceDayLabel"]),
                "position": position,
                "title": title,
                "fingerprint": fingerprint,
            }
            all_physical.append(physical)
            if not title or not content:
                empty_content.append({**physical, "emptyTitle": not bool(title), "emptyContent": not bool(content)})

            issues = []
            if re.match(r"^Day\s*\d+", title, re.IGNORECASE):
                issues.append("day_label_leaked_into_title")
            if re.search(r"[\u200b-\u200f\u2060-\u2064\ufeff\u00ad]", title + content):
                issues.append("invisible_character")
            content_lines = [line.strip() for line in content.splitlines() if line.strip()]
            if content_lines and content_lines[0] == title:
                issues.append("title_repeated_as_content_first_line")
            if len(content) < 20:
                issues.append("suspiciously_short_content")
            if canonical_item is None:
                issues.append("missing_canonical_record")
            else:
                if canonical_item["title"] != title:
                    issues.append("canonical_title_mismatch")
                if canonical_item["content"] != content:
                    issues.append("canonical_content_mismatch")
                if canonical_item["sourceDay"] != int(article["sourceDayLabel"]):
                    issues.append("canonical_source_day_mismatch")
                if canonical_item["day"] != position or canonical_item["sortOrder"] != position:
                    issues.append("canonical_order_mismatch")

            title_checks.append({
                **physical,
                "contentLength": len(content),
                "canonicalContentId": canonical_item.get("contentId") if canonical_item else "",
                "sourceAndCanonicalExactMatch": not any(issue.startswith("canonical_") or issue == "missing_canonical_record" for issue in issues),
                "issues": issues,
            })
            for issue in issues:
                malformed.append({**physical, "type": issue})

    fingerprint_groups = defaultdict(list)
    for item in all_physical:
        fingerprint_groups[(item["moduleId"], item["fingerprint"])].append(item)
    duplicates = [
        {
            "moduleId": group[0]["moduleId"],
            "fingerprint": group[0]["fingerprint"],
            "count": len(group),
            "records": [{k: record[k] for k in ("sourceFile", "sourceDay", "position", "title")} for record in group],
            "action": "preserved_as_distinct_physical_records",
        }
        for group in fingerprint_groups.values()
        if len(group) > 1
    ]

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json("source-files.json", source_files)
    write_json("source-counts.json", source_counts)
    write_json("empty-content.json", empty_content)
    write_json("duplicate-physical-records.json", duplicates)
    write_json("malformed-records.json", malformed)
    write_json("source-day-anomalies.json", source_day_anomalies)
    write_json("title-content-check.json", title_checks)

    exact_matches = sum(1 for item in title_checks if item["sourceAndCanonicalExactMatch"])
    markdown = [
        "# 训练源文件审计",
        "",
        f"- 锁定源文件：{len(source_files)}",
        f"- 原始物理记录：{sum(item['rawRecordCount'] for item in source_counts)}",
        f"- 解析记录：{sum(item['parsedRecordCount'] for item in source_counts)}",
        f"- canonical 记录：{len(canonical)}",
        f"- 源文件与 canonical 标题/正文逐条精确一致：{exact_matches}/{len(title_checks)}",
        f"- 空标题或正文：{len(empty_content)}",
        f"- 完全重复物理记录组：{len(duplicates)}（保留，不自动去重）",
        f"- 格式或一致性问题：{len(malformed)}",
        f"- 原始 Day 标签异常：{len(source_day_anomalies)}（仅审计，不参与身份或排序）",
        "",
        "## 模块计数",
        "",
        "| moduleId | 原始边界 | 解析 | canonical | 目标 |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in source_counts:
        markdown.append(
            f"| {item['moduleId']} | {item['rawRecordCount']} | {item['parsedRecordCount']} | "
            f"{item['canonicalRecordCount']} | {item['expectedRecordCount']} |"
        )
    markdown.extend([
        "",
        "## 处理原则",
        "",
        "- 完全重复的物理记录不会自动去重；每条记录继续拥有独立永久 contentId。",
        "- 源文件无法证明的语义问题不会编造修复。",
        "- `malformed-records.json` 为空时，表示自动规则未发现空内容、截断征兆、字段错位或 canonical 偏差。",
        "",
    ])
    (REPORT_DIR / "source-audit.md").write_text("\n".join(markdown), encoding="utf-8")

    if sum(item["parsedRecordCount"] for item in source_counts) != 966:
        raise SystemExit("SOURCE_TOTAL_MISMATCH")
    if empty_content:
        raise SystemExit("EMPTY_SOURCE_CONTENT")
    if malformed:
        raise SystemExit(f"SOURCE_AUDIT_BLOCKER: {len(malformed)} issue(s)")
    print(json.dumps({
        "sourceFileCount": len(source_files),
        "parsedTotal": sum(item["parsedRecordCount"] for item in source_counts),
        "exactCanonicalMatches": exact_matches,
        "duplicatePhysicalGroups": len(duplicates),
        "malformedCount": len(malformed),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
