from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlencode

from src.models import ScoredArticle


def _canonical_query(params: Mapping[str, str]) -> str:
    return urlencode(sorted((key, value) for key, value in params.items()), doseq=False)


def _sign(params: Mapping[str, str], secret: str) -> str:
    payload = _canonical_query(params).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


@dataclass(slots=True)
class LinkTracker:
    base_url: str = ""
    signing_secret: str = ""

    @classmethod
    def from_env(cls) -> "LinkTracker":
        return cls(
            base_url=os.getenv("TRACKER_BASE_URL", "").strip().rstrip("/"),
            signing_secret=os.getenv("TRACKER_SIGNING_SECRET", "").strip(),
        )

    def enabled(self) -> bool:
        return bool(self.base_url and self.signing_secret)

    def build_tracking_url(self, article: ScoredArticle, *, digest_date: str, channel: str) -> str:
        target_url = article.url.strip()
        if not self.enabled() or not target_url:
            return target_url

        params = {
            "u": target_url,
            "sid": article.source_id,
            "aid": article.id,
            "d": digest_date,
            "ch": channel,
        }
        sig = _sign(params, self.signing_secret)
        query = f"{_canonical_query(params)}&sig={sig}"
        return f"{self.base_url}/api/r?{query}"
