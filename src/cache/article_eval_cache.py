from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from src.models import ArticleAssessment, SourceQualityScore


class ArticleEvalCache:
    def __init__(self, db_path: str | None = None) -> None:
        configured = db_path or os.getenv("AI_EVAL_CACHE_DB", ".cache/ai-news/article_eval.sqlite3")
        self.db_path = Path(configured)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS article_assessments (
                    cache_key TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    article_id TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    prompt_version TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS source_stats (
                    source_id TEXT PRIMARY KEY,
                    quality_score REAL NOT NULL,
                    article_count INTEGER NOT NULL,
                    must_read_rate REAL NOT NULL,
                    avg_confidence REAL NOT NULL,
                    freshness REAL NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def get_assessment(self, cache_key: str) -> ArticleAssessment | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM article_assessments WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
        if not row:
            return None
        payload = json.loads(row[0])
        return ArticleAssessment(
            article_id=str(payload.get("article_id", "")),
            worth=str(payload.get("worth", "")),
            quality_score=float(payload.get("quality_score", 0.0)),
            practicality_score=float(payload.get("practicality_score", 0.0)),
            actionability_score=float(payload.get("actionability_score", 0.0)),
            novelty_score=float(payload.get("novelty_score", 0.0)),
            clarity_score=float(payload.get("clarity_score", 0.0)),
            one_line_summary=str(payload.get("one_line_summary", "")),
            reason_short=str(payload.get("reason_short", "")),
            company_impact=float(payload.get("company_impact", 0.0)),
            team_impact=float(payload.get("team_impact", 0.0)),
            personal_impact=float(payload.get("personal_impact", 0.0)),
            execution_clarity=float(payload.get("execution_clarity", 0.0)),
            action_hint=str(payload.get("action_hint", "")),
            best_for_roles=[str(item) for item in payload.get("best_for_roles", []) if str(item).strip()],
            evidence_signals=[str(item) for item in payload.get("evidence_signals", []) if str(item).strip()],
            confidence=float(payload.get("confidence", 0.0)),
            primary_type=str(payload.get("primary_type", "other") or "other"),
            secondary_types=[str(item) for item in payload.get("secondary_types", []) if str(item).strip()],
            cache_key=cache_key,
        )

    def set_assessment(
        self,
        *,
        cache_key: str,
        source_id: str,
        article_id: str,
        content_hash: str,
        model_name: str,
        prompt_version: str,
        assessment: ArticleAssessment,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "article_id": assessment.article_id,
            "worth": assessment.worth,
            "quality_score": assessment.quality_score,
            "practicality_score": assessment.practicality_score,
            "actionability_score": assessment.actionability_score,
            "novelty_score": assessment.novelty_score,
            "clarity_score": assessment.clarity_score,
            "one_line_summary": assessment.one_line_summary,
            "reason_short": assessment.reason_short,
            "company_impact": assessment.company_impact,
            "team_impact": assessment.team_impact,
            "personal_impact": assessment.personal_impact,
            "execution_clarity": assessment.execution_clarity,
            "action_hint": assessment.action_hint,
            "best_for_roles": assessment.best_for_roles,
            "evidence_signals": assessment.evidence_signals,
            "confidence": assessment.confidence,
            "primary_type": assessment.primary_type,
            "secondary_types": assessment.secondary_types,
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO article_assessments (
                    cache_key, source_id, article_id, content_hash, model_name,
                    prompt_version, payload_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    source_id = excluded.source_id,
                    article_id = excluded.article_id,
                    content_hash = excluded.content_hash,
                    model_name = excluded.model_name,
                    prompt_version = excluded.prompt_version,
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (
                    cache_key,
                    source_id,
                    article_id,
                    content_hash,
                    model_name,
                    prompt_version,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                ),
            )

    def prune(self, max_rows: int = 5000) -> None:
        with self._connect() as conn:
            count_row = conn.execute("SELECT COUNT(*) FROM article_assessments").fetchone()
            total = int(count_row[0]) if count_row else 0
            if total <= max_rows:
                return
            to_delete = total - max_rows
            conn.execute(
                """
                DELETE FROM article_assessments
                WHERE cache_key IN (
                    SELECT cache_key
                    FROM article_assessments
                    ORDER BY updated_at ASC
                    LIMIT ?
                )
                """,
                (to_delete,),
            )

    def load_source_scores(self) -> dict[str, SourceQualityScore]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT source_id, quality_score, article_count, must_read_rate, avg_confidence, freshness
                FROM source_stats
                """
            ).fetchall()
        scores: dict[str, SourceQualityScore] = {}
        for row in rows:
            source_id = str(row[0])
            scores[source_id] = SourceQualityScore(
                source_id=source_id,
                quality_score=float(row[1]),
                article_count=int(row[2]),
                must_read_rate=float(row[3]),
                avg_confidence=float(row[4]),
                freshness=float(row[5]),
            )
        return scores

    def upsert_source_scores(self, scores: list[SourceQualityScore]) -> None:
        if not scores:
            return
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            for score in scores:
                conn.execute(
                    """
                    INSERT INTO source_stats (
                        source_id, quality_score, article_count, must_read_rate,
                        avg_confidence, freshness, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(source_id) DO UPDATE SET
                        quality_score = excluded.quality_score,
                        article_count = excluded.article_count,
                        must_read_rate = excluded.must_read_rate,
                        avg_confidence = excluded.avg_confidence,
                        freshness = excluded.freshness,
                        updated_at = excluded.updated_at
                    """,
                    (
                        score.source_id,
                        score.quality_score,
                        score.article_count,
                        score.must_read_rate,
                        score.avg_confidence,
                        score.freshness,
                        now,
                    ),
                )
