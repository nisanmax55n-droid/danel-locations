import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_COORDINATE_PAIR = re.compile(r"(?<![\d.])(-?\d{1,2}(?:\.\d+))\s*[, ]\s*(-?\d{1,3}(?:\.\d+))(?![\d.])")
_GOOGLE_DATA_PAIR = re.compile(r"!3d(-?\d+(?:\.\d+))!4d(-?\d+(?:\.\d+))")
_AT_PAIR = re.compile(r"@(-?\d+(?:\.\d+)),(-?\d+(?:\.\d+))")
_WAZE_TO_PAIR = re.compile(r"(?:^|[?&])to=ll[.%2C]*(-?\d+(?:\.\d+))[,%.]+(-?\d+(?:\.\d+))", re.IGNORECASE)
_ALLOWED_HOST_MARKERS = ("google.", "goo.gl", "maps.app.goo.gl", "waze.com", "waze.to")


def _valid_pair(lat: float, lng: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lng <= 180


def _format_number(value: float) -> str:
    return f"{value:.7f}".rstrip("0").rstrip(".")


def _pair(lat: str | float, lng: str | float) -> tuple[float, float] | None:
    try:
        parsed = (float(lat), float(lng))
    except (TypeError, ValueError):
        return None
    return parsed if _valid_pair(*parsed) else None


def _navigation_provider(url: str) -> str | None:
    try:
        parsed = urllib.parse.urlsplit(url.strip())
    except (TypeError, ValueError):
        return None
    if parsed.scheme not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if host == "waze.com" or host.endswith(".waze.com") or host == "waze.to" or host.endswith(".waze.to"):
        return "waze"
    if (
        host == "goo.gl"
        or host.endswith(".goo.gl")
        or host == "google.com"
        or host.endswith(".google.com")
        or host.startswith("google.")
    ):
        return "google"
    return None


def extract_coordinates(value: str) -> tuple[float, float] | None:
    if not value:
        return None

    decoded = value.strip()
    for _ in range(3):
        next_value = urllib.parse.unquote(decoded)
        if next_value == decoded:
            break
        decoded = next_value

    for pattern in (_GOOGLE_DATA_PAIR, _AT_PAIR, _WAZE_TO_PAIR):
        match = pattern.search(decoded)
        if match:
            result = _pair(match.group(1), match.group(2))
            if result:
                return result

    parsed = urllib.parse.urlsplit(decoded if "://" in decoded else f"https://placeholder.invalid/?q={urllib.parse.quote(decoded)}")
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("ll", "q", "query", "destination", "daddr", "center", "saddr"):
        for candidate in query.get(key, []):
            match = _COORDINATE_PAIR.search(candidate)
            if match:
                result = _pair(match.group(1), match.group(2))
                if result:
                    return result

    for match in _COORDINATE_PAIR.finditer(decoded):
        result = _pair(match.group(1), match.group(2))
        if result:
            return result
    return None


def _expand_navigation_url(url: str) -> tuple[str, str]:
    url = url.strip()
    if not url:
        return "", ""
    parsed = urllib.parse.urlsplit(url)
    host = parsed.netloc.lower()
    if not parsed.scheme or not any(marker in host for marker in _ALLOWED_HOST_MARKERS):
        return url, ""

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; DanelLocations/1.0)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            final_url = response.geturl()
            body = response.read(131072).decode("utf-8", errors="ignore")
            return final_url, body
    except Exception:
        return url, ""


def coordinates_from_navigation_url(url: str) -> tuple[float, float] | None:
    direct = extract_coordinates(url)
    if direct:
        return direct
    final_url, body = _expand_navigation_url(url)
    return extract_coordinates(final_url) or extract_coordinates(body)


def build_navigation_links(lat: float, lng: float) -> dict[str, str]:
    lat_text = _format_number(lat)
    lng_text = _format_number(lng)
    coordinates = f"{lat_text},{lng_text}"
    return {
        "coordinates": coordinates,
        "waze_url": f"https://waze.com/ul?ll={coordinates}&navigate=yes",
        "maps_url": "https://www.google.com/maps/dir/?" + urllib.parse.urlencode({"api": "1", "destination": coordinates}),
    }


def normalize_navigation_payload(payload: dict[str, Any], *, strict: bool = False) -> dict[str, Any]:
    normalized = dict(payload)
    navigation_url = str(normalized.pop("navigation_url", "") or "").strip()
    coordinates_value = str(normalized.get("coordinates") or "").strip()
    waze_url = str(normalized.get("waze_url") or "").strip()
    maps_url = str(normalized.get("maps_url") or "").strip()

    provider = _navigation_provider(navigation_url) if navigation_url else None
    if navigation_url and not waze_url and not maps_url:
        if provider == "waze":
            waze_url = navigation_url
        elif provider == "google":
            maps_url = navigation_url

    coordinates = extract_coordinates(coordinates_value)
    if not coordinates:
        for url in (maps_url, waze_url):
            coordinates = coordinates_from_navigation_url(url)
            if coordinates:
                break

    has_navigation_input = bool(coordinates_value or waze_url or maps_url or navigation_url)
    if not coordinates:
        valid_share_url = bool(
            provider
            or _navigation_provider(waze_url)
            or _navigation_provider(maps_url)
        )
        if strict and has_navigation_input and not valid_share_url:
            raise ValueError("לא ניתן לחלץ נקודת יעד מהקישור. יש להדביק קישור שיתוף מלא של Google Maps או Waze.")
        normalized["coordinates"] = coordinates_value
        normalized["waze_url"] = waze_url
        normalized["maps_url"] = maps_url
        return normalized

    normalized.update(build_navigation_links(*coordinates))
    return normalized


def normalized_request_body(raw_body: bytes) -> bytes:
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw_body
    if not isinstance(payload, dict):
        return raw_body
    try:
        payload = normalize_navigation_payload(payload, strict=True)
    except ValueError as exc:
        return json.dumps({"__navigation_error__": str(exc)}, ensure_ascii=False).encode("utf-8")
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")
