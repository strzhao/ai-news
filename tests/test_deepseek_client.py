from src.llm.deepseek_client import _extract_json_payload


def test_extract_json_payload_from_code_fence() -> None:
    raw = "```json\n{\"a\": 1}\n```"
    assert _extract_json_payload(raw) == "{\"a\": 1}"
