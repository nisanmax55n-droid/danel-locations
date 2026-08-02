import json

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from backend import main
from backend.navigation_links import normalize_navigation_payload

app = main.app

_NAVIGATION_WRITE_PATHS = {
    "/api/locations",
    "/api/employee/location-requests",
}


def _is_navigation_write(request: Request) -> bool:
    path = request.url.path.rstrip("/") or "/"
    if request.method == "POST" and path in _NAVIGATION_WRITE_PATHS:
        return True
    return request.method == "PUT" and path.startswith("/api/locations/")


def _navigation_error_response(request: Request, message: str) -> JSONResponse:
    response = JSONResponse(status_code=422, content={"detail": message})
    origin = request.headers.get("origin", "").rstrip("/")
    if origin and origin in main.CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response


@app.middleware("http")
async def normalize_navigation_links(request: Request, call_next):
    if not _is_navigation_write(request):
        return await call_next(request)

    raw_body = await request.body()
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return await call_next(request)

    if not isinstance(payload, dict):
        return await call_next(request)

    try:
        normalized = normalize_navigation_payload(payload, strict=True)
    except ValueError as exc:
        return _navigation_error_response(request, str(exc))
    except Exception:
        return _navigation_error_response(
            request,
            "לא הצלחנו לקרוא את הקישור כרגע. יש להעתיק מחדש קישור שיתוף מלא של Google Maps או Waze.",
        )

    body = json.dumps(normalized, ensure_ascii=False).encode("utf-8")
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = receive
    request.scope["headers"] = [
        (key, value)
        for key, value in request.scope["headers"]
        if key.lower() != b"content-length"
    ] + [(b"content-length", str(len(body)).encode("ascii"))]
    return await call_next(request)


def _backfill_model(db, model) -> int:
    changed = 0
    for item in db.scalars(select(model)).all():
        original = {
            "coordinates": item.coordinates or "",
            "waze_url": item.waze_url or "",
            "maps_url": item.maps_url or "",
        }
        normalized = normalize_navigation_payload(original, strict=False)
        if normalized == original:
            continue
        item.coordinates = normalized["coordinates"]
        item.waze_url = normalized["waze_url"]
        item.maps_url = normalized["maps_url"]
        db.add(item)
        changed += 1
    return changed


@app.on_event("startup")
def backfill_existing_navigation_links() -> None:
    with main.SessionLocal() as db:
        changed = _backfill_model(db, main.Location)
        changed += _backfill_model(db, main.LocationRequest)
        if changed:
            db.commit()
