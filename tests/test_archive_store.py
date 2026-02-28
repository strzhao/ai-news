from __future__ import annotations

from typing import Any

import pytest

from src.archive import store


class FakeUpstash:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.zsets: dict[str, dict[str, float]] = {}

    def hset(self, key: str, mapping: dict[str, str | int | float]) -> int:
        row = self.hashes.setdefault(key, {})
        for field, value in mapping.items():
            row[str(field)] = str(value)
        return len(mapping)

    def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    def zadd(self, key: str, score: float, member: str) -> int:
        row = self.zsets.setdefault(key, {})
        existed = 1 if member in row else 0
        row[member] = float(score)
        return 0 if existed else 1

    def pipeline(self, commands: list[list[str | int]]) -> list[dict[str, Any]]:
        responses: list[dict[str, Any]] = []
        for command in commands:
            op = str(command[0]).upper()
            if op == "ZREVRANGE":
                key = str(command[1])
                start = int(command[2])
                stop = int(command[3])
                members = self.zsets.get(key, {})
                ordered = sorted(members.items(), key=lambda item: (item[1], item[0]), reverse=True)
                if stop < start:
                    payload = []
                else:
                    payload = [item[0] for item in ordered[start : stop + 1]]
                responses.append({"result": payload})
                continue
            if op == "HGETALL":
                key = str(command[1])
                row = self.hashes.get(key, {})
                flat: list[str] = []
                for field, value in row.items():
                    flat.extend([field, value])
                responses.append({"result": flat})
                continue
            responses.append({"result": None})
        return responses


@pytest.fixture()
def fake_upstash(monkeypatch: pytest.MonkeyPatch) -> FakeUpstash:
    fake = FakeUpstash()
    monkeypatch.setattr(store, "build_upstash_client", lambda: fake)
    return fake


def test_archive_store_supports_multiple_digests_in_one_day(fake_upstash: FakeUpstash) -> None:
    digest_a = store.build_digest_id("2026-02-28", "2026-02-28T08:00:00+00:00", "A")
    digest_b = store.build_digest_id("2026-02-28", "2026-02-28T09:00:00+00:00", "B")

    store.save_digest_archive(
        digest_id=digest_a,
        report_date="2026-02-28",
        generated_at="2026-02-28T08:00:00+00:00",
        markdown="## 今日速览\nA",
        highlight_count=2,
        has_highlights=True,
        summary_preview="A summary",
    )
    store.save_analysis_archive(
        digest_id=digest_a,
        report_date="2026-02-28",
        generated_at="2026-02-28T08:00:00+00:00",
        analysis_markdown="A analysis",
        analysis_json={"improvement_actions": {"ai_summary": "A ai"}},
    )

    store.save_digest_archive(
        digest_id=digest_b,
        report_date="2026-02-28",
        generated_at="2026-02-28T09:00:00+00:00",
        markdown="## 今日速览\nB",
        highlight_count=3,
        has_highlights=True,
        summary_preview="B summary",
    )
    store.save_analysis_archive(
        digest_id=digest_b,
        report_date="2026-02-28",
        generated_at="2026-02-28T09:00:00+00:00",
        analysis_markdown="B analysis",
        analysis_json={"improvement_actions": {"ai_summary": "B ai"}},
    )

    groups = store.list_archives(days=30, limit_per_day=10)
    assert len(groups) == 1
    assert groups[0]["date"] == "2026-02-28"
    items = groups[0]["items"]
    assert len(items) == 2
    assert items[0]["digest_id"] == digest_b
    assert items[1]["digest_id"] == digest_a
    assert items[0]["analysis_preview"] != ""


def test_archive_store_returns_item_and_analysis(fake_upstash: FakeUpstash) -> None:
    digest_id = store.build_digest_id("2026-02-28", "2026-02-28T10:00:00+00:00", "C")
    store.save_digest_archive(
        digest_id=digest_id,
        report_date="2026-02-28",
        generated_at="2026-02-28T10:00:00+00:00",
        markdown="digest markdown",
        highlight_count=1,
        has_highlights=True,
        summary_preview="digest summary",
    )
    store.save_analysis_archive(
        digest_id=digest_id,
        report_date="2026-02-28",
        generated_at="2026-02-28T10:00:00+00:00",
        analysis_markdown="analysis markdown",
        analysis_json={"diagnostic_flags": ["x"]},
    )

    item = store.get_archive_item(digest_id)
    analysis = store.get_archive_analysis(digest_id)
    assert item is not None
    assert analysis is not None
    assert item["markdown"] == "digest markdown"
    assert analysis["analysis_markdown"] == "analysis markdown"
