import json
import re
import urllib.parse
from typing import Any, Awaitable, Callable

from backend.main import app as main_app


_WARNING = "⚠️ הקישור שהוזן לא זוהה אוטומטית כ-Waze או Google Maps. יש לבדוק אותו לפני אישור."
_WRITE_PATHS = {"/api/employee/location-requests", "/api/locations"}


def _normalize_km(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return re.sub(r"(?<=\d)\s*[:：]\s*(?=\d{3}(?:\D|$))", "+", value.strip())


def _provider(value: str) -> str | None:
    try:
        parsed = urllib.parse.urlsplit(value.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if host == "waze.com" or host.endswith(".waze.com") or host == "waze.to" or host.endswith(".waze.to"):
        return "waze"
    if host == "goo.gl" or host.endswith(".goo.gl") or host == "google.com" or host.endswith(".google.com") or host.startswith("google."):
        return "google"
    return None


def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    normalized["km"] = _normalize_km(normalized.get("km", ""))

    navigation_url = str(normalized.pop("navigation_url", "") or "").strip()
    if not navigation_url:
        return normalized

    provider = _provider(navigation_url)
    normalized["waze_url"] = navigation_url if provider == "waze" else ""
    normalized["maps_url"] = navigation_url if provider != "waze" else ""
    normalized["coordinates"] = str(normalized.get("coordinates") or "")

    if provider is None:
        existing_notes = str(normalized.get("notes") or "").strip()
        warning = f"{_WARNING}\nקישור שהוזן: {navigation_url}"
        normalized["notes"] = f"{existing_notes}\n\n{warning}".strip()

    return normalized


class RequestNormalizer:
    def __init__(self, app: Callable[..., Awaitable[None]]):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Callable[..., Awaitable[dict[str, Any]]], send: Callable[..., Awaitable[None]]) -> None:
        if scope.get("type") != "http" or not self._should_normalize(scope):
            await self.app(scope, receive, send)
            return

        body_parts: list[bytes] = []
        while True:
            message = await receive()
            body_parts.append(message.get("body", b""))
            if not message.get("more_body", False):
                break

        raw_body = b"".join(body_parts)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
            if isinstance(payload, dict):
                raw_body = json.dumps(normalize_payload(payload), ensure_ascii=False).encode("utf-8")
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass

        delivered = False

        async def normalized_receive() -> dict[str, Any]:
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": raw_body, "more_body": False}

        headers = [(key, value) for key, value in scope.get("headers", []) if key.lower() != b"content-length"]
        headers.append((b"content-length", str(len(raw_body)).encode("ascii")))
        normalized_scope = dict(scope)
        normalized_scope["headers"] = headers
        await self.app(normalized_scope, normalized_receive, send)

    @staticmethod
    def _should_normalize(scope: dict[str, Any]) -> bool:
        method = str(scope.get("method", "")).upper()
        path = str(scope.get("path", "")).rstrip("/") or "/"
        if method == "POST" and path in _WRITE_PATHS:
            return True
        return method == "PUT" and path.startswith("/api/locations/")


app = RequestNormalizer(main_app)
