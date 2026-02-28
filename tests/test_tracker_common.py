from __future__ import annotations

from api._tracker_common import (
    normalize_url,
    parse_hash_result,
    should_skip_tracking,
    verify_signature,
)
from src.tracking.link_tracker import _sign


def test_verify_signature_compatible_with_link_tracker() -> None:
    params = {
        "u": "https://example.com/a/b?x=1&y=2",
        "sid": "source_x",
        "aid": "article_1",
        "d": "2026-02-28",
        "ch": "markdown",
        "pt": "engineering_practice",
    }
    secret = "test-signing-secret"
    sig = _sign(params, secret)
    assert verify_signature(params, sig, secret) is True


def test_normalize_url_removes_tracking_params_and_normalizes_host() -> None:
    raw = "HTTPS://Example.COM/path/?utm_source=x&b=2&a=1#frag"
    normalized = normalize_url(raw)
    assert normalized == "https://example.com/path?a=1&b=2"


def test_parse_hash_result_supports_list_and_dict() -> None:
    assert parse_hash_result(["a", "2", "b", 3, "c", "0"]) == {"a": 2, "b": 3}
    assert parse_hash_result({"x": 4, "y": "5", "z": 0}) == {"x": 4, "y": 5}


def test_should_skip_tracking_for_head_and_bot_ua() -> None:
    assert should_skip_tracking("HEAD", "Mozilla/5.0") is True
    assert should_skip_tracking("GET", "Slackbot 1.0") is True
    assert should_skip_tracking("GET", "Mozilla/5.0") is False

