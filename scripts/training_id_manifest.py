#!/usr/bin/env python3
"""训练内容永久 ID 清单解析器。

运行时只使用 ``tc_<32hex>``。本模块仅供构建阶段把当前源记录与持久清单
进行一一匹配；任何无法唯一判断的关系都会中止构建，不会静默分配新身份。
"""
from __future__ import annotations

import copy
import hashlib
import re
import secrets
from collections import defaultdict
from typing import Callable, Iterable


CONTENT_ID_RE = re.compile(r"^tc_[0-9a-f]{32}$")
SOURCE_KEY_RE = re.compile(r"^sk_[0-9a-f]{32}$")


class ManifestMatchError(RuntimeError):
    """源记录无法与永久 ID 清单安全匹配。"""


def _stable_source_key(content_id: str) -> str:
    """为旧版清单补充稳定 sourceKey，不改变既有 contentId。"""
    digest = hashlib.sha256(f"training-source-key:{content_id}".encode("utf-8")).hexdigest()
    return f"sk_{digest[:32]}"


def _new_source_key() -> str:
    return f"sk_{secrets.token_hex(16)}"


def _new_content_id() -> str:
    return f"tc_{secrets.token_hex(16)}"


def upgrade_manifest(raw_manifest: dict) -> dict:
    """把旧清单无损升级到 schema v3。"""
    manifest = copy.deepcopy(raw_manifest or {})
    manifest["schemaVersion"] = 3
    manifest["idFormat"] = "tc_<32hex_random>"
    manifest["sourceKeyFormat"] = "sk_<32hex>"
    articles = manifest.setdefault("articles", {})

    seen_source_keys: set[str] = set()
    for content_id, info in articles.items():
        if not CONTENT_ID_RE.fullmatch(str(content_id)):
            raise ManifestMatchError(f"非法永久 contentId: {content_id}")
        if str(info.get("contentId") or content_id) != content_id:
            raise ManifestMatchError(f"清单键与 contentId 不一致: {content_id}")
        info["contentId"] = content_id
        source_key = str(info.get("sourceKey") or _stable_source_key(content_id))
        if not SOURCE_KEY_RE.fullmatch(source_key):
            raise ManifestMatchError(f"非法 sourceKey: {source_key}")
        if source_key in seen_source_keys:
            raise ManifestMatchError(f"重复 sourceKey: {source_key}")
        seen_source_keys.add(source_key)
        info["sourceKey"] = source_key
        info.setdefault("titleHash", "")
        info.setdefault("contentVersion", 1)
        info.setdefault("status", "active")
    return manifest


def _group_unique(items: Iterable[str], key_fn: Callable[[str], object]) -> dict[object, str]:
    grouped: dict[object, list[str]] = defaultdict(list)
    for item_id in items:
        grouped[key_fn(item_id)].append(item_id)
    return {key: values[0] for key, values in grouped.items() if key and len(values) == 1}


def _match_unique_round(
    source_ids: set[int],
    manifest_ids: set[str],
    source_key_fn: Callable[[int], object],
    manifest_key_fn: Callable[[str], object],
) -> list[tuple[int, str]]:
    source_unique = _group_unique(source_ids, source_key_fn)
    manifest_unique = _group_unique(manifest_ids, manifest_key_fn)
    return [
        (source_id, manifest_unique[key])
        for key, source_id in source_unique.items()
        if key in manifest_unique
    ]


def resolve_manifest_records(
    raw_manifest: dict,
    source_records: list[dict],
    *,
    allow_new: bool,
    content_id_factory: Callable[[], str] = _new_content_id,
    source_key_factory: Callable[[], str] = _new_source_key,
) -> tuple[dict, list[dict]]:
    """解析当前源记录，返回升级后的清单和带 contentId/sourceKey 的记录。

    匹配过程按强到弱执行。弱匹配只能在两侧都唯一时生效。最后仍有多个可能
    候选时立即 BLOCKER；只有完全没有候选的记录才会被视为真正新增。
    """
    manifest = upgrade_manifest(raw_manifest)
    articles: dict[str, dict] = manifest["articles"]

    normalized: list[dict] = []
    for index, source in enumerate(source_records):
        item = dict(source)
        item["_index"] = index
        item["moduleId"] = str(item.get("moduleId") or "").strip()
        item["sourceFile"] = str(item.get("sourceFile") or "").strip()
        item["sourceDay"] = int(item.get("sourceDay") or 0)
        item["titleHash"] = str(item.get("titleHash") or "")
        item["contentHash"] = str(item.get("contentHash") or "")
        if not item["moduleId"] or not item["sourceFile"] or item["sourceDay"] <= 0:
            raise ManifestMatchError(f"源记录定位字段不完整: index={index}")
        if not item["titleHash"] or not item["contentHash"]:
            raise ManifestMatchError(f"源记录哈希不完整: index={index}")
        normalized.append(item)

    unmatched_source = {item["_index"] for item in normalized}
    unmatched_manifest = set(articles)
    matches: dict[int, str] = {}

    def source_at(source_id: int) -> dict:
        return normalized[source_id]

    def bind(pairs: list[tuple[int, str]], reason: str) -> None:
        for source_id, content_id in pairs:
            if source_id not in unmatched_source or content_id not in unmatched_manifest:
                continue
            source = source_at(source_id)
            info = articles[content_id]
            if source["moduleId"] != info.get("moduleId"):
                raise ManifestMatchError(
                    f"跨模块匹配被拒绝: {source['moduleId']} -> {info.get('moduleId')} ({content_id})"
                )
            matches[source_id] = content_id
            source["matchReason"] = reason
            unmatched_source.remove(source_id)
            unmatched_manifest.remove(content_id)

    # 1. 源记录显式携带 sourceKey 时，它是最高优先级身份。
    source_keys = {}
    for content_id, info in articles.items():
        source_keys.setdefault(info["sourceKey"], []).append(content_id)
    explicit_pairs: list[tuple[int, str]] = []
    for source_id in list(unmatched_source):
        source_key = str(source_at(source_id).get("sourceKey") or "")
        if not source_key:
            continue
        candidates = source_keys.get(source_key, [])
        if len(candidates) != 1:
            raise ManifestMatchError(f"显式 sourceKey 无唯一匹配: {source_key}")
        explicit_pairs.append((source_id, candidates[0]))
    bind(explicit_pairs, "sourceKey")

    rounds = [
        (
            "title+content",
            lambda source_id: (
                source_at(source_id)["moduleId"],
                source_at(source_id)["titleHash"],
                source_at(source_id)["contentHash"],
            ),
            lambda content_id: (
                articles[content_id].get("moduleId"),
                articles[content_id].get("titleHash"),
                articles[content_id].get("contentHash"),
            ),
        ),
        (
            "content",
            lambda source_id: (source_at(source_id)["moduleId"], source_at(source_id)["contentHash"]),
            lambda content_id: (articles[content_id].get("moduleId"), articles[content_id].get("contentHash")),
        ),
        (
            "title",
            lambda source_id: (source_at(source_id)["moduleId"], source_at(source_id)["titleHash"]),
            lambda content_id: (articles[content_id].get("moduleId"), articles[content_id].get("titleHash")),
        ),
        (
            "source-location",
            lambda source_id: (
                source_at(source_id)["moduleId"],
                source_at(source_id)["sourceFile"],
                source_at(source_id)["sourceDay"],
            ),
            lambda content_id: (
                articles[content_id].get("moduleId"),
                articles[content_id].get("sourceFile"),
                int(articles[content_id].get("sourceDay") or 0),
            ),
        ),
    ]
    for reason, source_key_fn, manifest_key_fn in rounds:
        bind(
            _match_unique_round(unmatched_source, unmatched_manifest, source_key_fn, manifest_key_fn),
            reason,
        )

    # 若同模块仍有未匹配旧记录，新记录可能是“标题+正文同时修改”或替换，不能猜。
    manifest_by_module: dict[str, list[str]] = defaultdict(list)
    for content_id in unmatched_manifest:
        if articles[content_id].get("status") != "retired":
            manifest_by_module[str(articles[content_id].get("moduleId") or "")].append(content_id)
    blocked = []
    for source_id in sorted(unmatched_source):
        source = source_at(source_id)
        candidates = manifest_by_module.get(source["moduleId"], [])
        if candidates:
            blocked.append({
                "source": source,
                "candidateContentIds": sorted(candidates),
            })
    if blocked:
        sample = blocked[0]
        raise ManifestMatchError(
            "AMBIGUOUS_SOURCE_MATCH: "
            f"module={sample['source']['moduleId']} sourceDay={sample['source']['sourceDay']} "
            f"candidates={sample['candidateContentIds'][:5]}"
        )

    # 没有任何旧候选才是明确的新文章。
    for source_id in sorted(list(unmatched_source)):
        if not allow_new:
            source = source_at(source_id)
            raise ManifestMatchError(
                f"NEW_SOURCE_RECORD_REQUIRES_BUILD: {source['moduleId']} sourceDay={source['sourceDay']}"
            )
        content_id = content_id_factory()
        while content_id in articles or not CONTENT_ID_RE.fullmatch(content_id):
            content_id = content_id_factory()
        source_key = source_key_factory()
        existing_source_keys = {entry["sourceKey"] for entry in articles.values()}
        while source_key in existing_source_keys or not SOURCE_KEY_RE.fullmatch(source_key):
            source_key = source_key_factory()
        source = source_at(source_id)
        articles[content_id] = {
            "contentId": content_id,
            "sourceKey": source_key,
            "moduleId": source["moduleId"],
            "status": "active",
            "contentVersion": 1,
        }
        matches[source_id] = content_id
        source["matchReason"] = "new"
        unmatched_source.remove(source_id)

    # 当前源文件未出现的记录仍保留在清单中，标记 retired，避免未来 ID 被重用。
    matched_ids = set(matches.values())
    for content_id, info in articles.items():
        if content_id not in matched_ids:
            info["status"] = "retired"

    resolved: list[dict] = []
    for source in normalized:
        content_id = matches[source["_index"]]
        info = articles[content_id]
        previous_title_hash = str(info.get("titleHash") or "")
        previous_content_hash = str(info.get("contentHash") or "")
        changed = bool(previous_title_hash and previous_content_hash) and (
            previous_title_hash != source["titleHash"]
            or previous_content_hash != source["contentHash"]
        )
        version = max(1, int(info.get("contentVersion") or 1)) + (1 if changed else 0)
        info.update({
            "contentId": content_id,
            "moduleId": source["moduleId"],
            "sourceFile": source["sourceFile"],
            "sourceDay": source["sourceDay"],
            "day": int(source.get("day") or source["sourceDay"]),
            "title": str(source.get("title") or ""),
            "titleHash": source["titleHash"],
            "contentHash": source["contentHash"],
            "contentVersion": version,
            "status": "active",
        })
        item = {key: value for key, value in source.items() if not key.startswith("_")}
        item["contentId"] = content_id
        item["sourceKey"] = info["sourceKey"]
        item["contentVersion"] = version
        resolved.append(item)

    if len({item["contentId"] for item in resolved}) != len(resolved):
        raise ManifestMatchError("解析后 contentId 不唯一")
    return manifest, resolved

