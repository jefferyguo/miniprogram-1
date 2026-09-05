#!/usr/bin/env python3
"""永久 ID 清单的真实行为 fixture。"""
from __future__ import annotations

import copy
import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from training_id_manifest import ManifestMatchError, resolve_manifest_records


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def source(day: int, title: str, content: str, *, source_key: str = "") -> dict:
    item = {
        "moduleId": "reading",
        "sourceFile": "reading.docx",
        "sourceDay": day,
        "day": day,
        "title": title,
        "titleHash": digest(title),
        "contentHash": digest(content),
    }
    if source_key:
        item["sourceKey"] = source_key
    return item


def make_manifest(records: list[dict]) -> tuple[dict, list[dict]]:
    counter = iter(range(1, 100))
    return resolve_manifest_records(
        {"schemaVersion": 3, "articles": {}},
        records,
        allow_new=True,
        content_id_factory=lambda: f"tc_{next(counter):032x}",
        source_key_factory=lambda: f"sk_{next(counter):032x}",
    )


class TrainingIdManifestTest(unittest.TestCase):
    def setUp(self):
        self.original = [source(1, "甲", "正文甲"), source(2, "乙", "正文乙"), source(3, "丙", "正文丙")]
        self.manifest, resolved = make_manifest(self.original)
        self.ids = {item["title"]: item["contentId"] for item in resolved}

    def resolve(self, records, allow_new=True):
        counter = iter(range(100, 200))
        return resolve_manifest_records(
            copy.deepcopy(self.manifest),
            records,
            allow_new=allow_new,
            content_id_factory=lambda: f"tc_{next(counter):032x}",
            source_key_factory=lambda: f"sk_{next(counter):032x}",
        )

    def test_reorder_keeps_ids(self):
        _, rows = self.resolve([source(3, "丙", "正文丙"), source(1, "甲", "正文甲"), source(2, "乙", "正文乙")])
        self.assertEqual({r["title"]: r["contentId"] for r in rows}, self.ids)

    def test_insert_assigns_only_one_new_id(self):
        _, rows = self.resolve([source(1, "甲", "正文甲"), source(4, "新", "新正文"), source(2, "乙", "正文乙"), source(3, "丙", "正文丙")])
        by_title = {r["title"]: r["contentId"] for r in rows}
        self.assertEqual(by_title["甲"], self.ids["甲"])
        self.assertEqual(by_title["乙"], self.ids["乙"])
        self.assertEqual(by_title["丙"], self.ids["丙"])
        self.assertNotIn(by_title["新"], self.ids.values())

    def test_title_edit_keeps_id(self):
        _, rows = self.resolve([source(1, "甲（修订）", "正文甲"), *self.original[1:]])
        self.assertEqual(rows[0]["contentId"], self.ids["甲"])

    def test_content_edit_keeps_id(self):
        _, rows = self.resolve([source(1, "甲", "正文甲（修订）"), *self.original[1:]])
        self.assertEqual(rows[0]["contentId"], self.ids["甲"])

    def test_title_and_content_edit_keeps_id_by_source_location(self):
        _, rows = self.resolve([source(1, "甲（修订）", "正文甲（修订）"), *self.original[1:]])
        self.assertEqual(rows[0]["contentId"], self.ids["甲"])

    def test_delete_does_not_change_other_ids(self):
        manifest, rows = self.resolve([self.original[0], self.original[2]])
        self.assertEqual([r["contentId"] for r in rows], [self.ids["甲"], self.ids["丙"]])
        self.assertEqual(manifest["articles"][self.ids["乙"]]["status"], "retired")

    def test_duplicate_content_distinct_source_days(self):
        first = [source(1, "相同", "相同正文"), source(2, "相同", "相同正文")]
        manifest, rows = make_manifest(first)
        ids = [row["contentId"] for row in rows]
        self.assertEqual(len(set(ids)), 2)
        _, rerun = resolve_manifest_records(manifest, first, allow_new=False)
        self.assertEqual([row["contentId"] for row in rerun], ids)

    def test_ambiguous_match_blocks(self):
        changed = [source(10, "全新甲", "全新正文甲"), source(11, "全新乙", "全新正文乙")]
        with self.assertRaisesRegex(ManifestMatchError, "AMBIGUOUS_SOURCE_MATCH"):
            self.resolve(changed)


if __name__ == "__main__":
    unittest.main()
