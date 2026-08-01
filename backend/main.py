import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from pwdlib import PasswordHash
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./locations.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-before-production")
BOOTSTRAP_USERNAME = os.getenv("BOOTSTRAP_USERNAME", "owner")
BOOTSTRAP_PASSWORD = os.getenv("BOOTSTRAP_PASSWORD", "ChangeMe123!")
ACCESS_TOKEN_HOURS = int(os.getenv("ACCESS_TOKEN_HOURS", "12"))
CORS_ORIGINS = [origin.strip().rstrip("/") for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]
EMPLOYEE_DIRECTORY_URL = os.getenv("EMPLOYEE_DIRECTORY_URL", "").rstrip("/")
EMPLOYEE_DIRECTORY_KEY = os.getenv("EMPLOYEE_DIRECTORY_KEY", "")
EMPLOYEE_INITIAL_PASSWORD = "Aa1234"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
password_hash = PasswordHash.recommended()

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_digest: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="manager")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(30), index=True)
    place_type: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    km: Mapped[str] = mapped_column(String(40), default="")
    waze_url: Mapped[str] = mapped_column(Text, default="")
    maps_url: Mapped[str] = mapped_column(Text, default="")
    coordinates: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_by: Mapped[User] = relationship()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class EmployeeAccount(Base):
    __tablename__ = "employee_accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    worker_ref: Mapped[int] = mapped_column(index=True)
    id_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_digest: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LocationRequest(Base):
    __tablename__ = "location_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(30), index=True)
    place_type: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    km: Mapped[str] = mapped_column(String(40), default="")
    waze_url: Mapped[str] = mapped_column(Text, default="")
    maps_url: Mapped[str] = mapped_column(Text, default="")
    coordinates: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    review_note: Mapped[str] = mapped_column(Text, default="")
    employee_account_id: Mapped[int] = mapped_column(ForeignKey("employee_accounts.id"))
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    submitted_by: Mapped[EmployeeAccount] = relationship(foreign_keys=[employee_account_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


Base.metadata.create_all(engine)

class LoginIn(BaseModel):
    username: str
    password: str

class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10)

class UserCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=10)
    role: Literal["manager"] = "manager"

class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    is_active: bool
    must_change_password: bool

class LocationIn(BaseModel):
    category: Literal["work_site", "reporting_point"]
    place_type: Literal["station", "segment"]
    name: str = Field(min_length=2, max_length=180)
    km: str = Field(default="", max_length=40)
    waze_url: str = ""
    maps_url: str = ""
    coordinates: str = Field(default="", max_length=80)
    notes: str = ""

    @field_validator("km")
    @classmethod
    def validate_km(cls, value: str) -> str:
        value = value.strip()
        if value and not re.fullmatch(r"\d{1,4}\+\d{3}(?:\s*-\s*\d{1,4}\+\d{3})?", value):
            raise ValueError("פורמט הק״מ צריך להיות 145+000 או טווח 145+000 - 146+500")
        return value

class LocationOut(LocationIn):
    id: int
    created_at: datetime
    updated_at: datetime


class EmployeeLoginIn(BaseModel):
    id_number: str = Field(min_length=5, max_length=32)
    password: str = Field(min_length=6, max_length=256)


class EmployeeOut(BaseModel):
    id: int
    id_number: str
    full_name: str
    must_change_password: bool


class EmployeePasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class LocationRequestOut(LocationIn):
    id: int
    status: str
    review_note: str
    submitted_by_name: str
    created_at: datetime
    reviewed_at: datetime | None


class ReviewIn(BaseModel):
    note: str = Field(default="", max_length=2000)


class EmployeeResetIn(BaseModel):
    id_number: str = Field(min_length=5, max_length=32)

app = FastAPI(title="Danel Locations API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def bootstrap_owner() -> None:
    with SessionLocal() as db:
        exists = db.scalar(select(User).where(User.role == "owner"))
        if exists:
            return
        db.add(User(
            username=BOOTSTRAP_USERNAME.strip().lower(),
            full_name="בעלים ראשי",
            password_digest=password_hash.hash(BOOTSTRAP_PASSWORD),
            role="owner",
            must_change_password=True,
        ))
        db.commit()

bootstrap_owner()


def issue_token(user: User) -> str:
    payload = {"sub": str(user.id), "kind": "internal", "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_HOURS)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def issue_employee_token(employee: EmployeeAccount) -> str:
    payload = {"sub": str(employee.id), "kind": "employee", "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_HOURS)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def bearer_payload(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="נדרשת התחברות")
    try:
        return jwt.decode(auth[7:], SECRET_KEY, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="החיבור פג או אינו תקין") from exc


def normalize_id_number(value: str) -> str:
    normalized = re.sub(r"\D", "", value)
    if not 5 <= len(normalized) <= 9:
        raise HTTPException(status_code=400, detail="יש להזין תעודת זהות תקינה")
    return normalized


def directory_worker(id_number: str) -> dict:
    if not EMPLOYEE_DIRECTORY_URL or not EMPLOYEE_DIRECTORY_KEY:
        raise HTTPException(status_code=503, detail="החיבור למאגר העובדים טרם הוגדר")
    url = f"{EMPLOYEE_DIRECTORY_URL}/{urllib.parse.quote(id_number)}"
    req = urllib.request.Request(url, headers={"X-Integration-Key": EMPLOYEE_DIRECTORY_KEY})
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=401, detail="תעודת הזהות או הסיסמה שגויות") from exc
        if exc.code == 401:
            raise HTTPException(status_code=503, detail="החיבור למאגר העובדים אינו מורשה") from exc
        raise HTTPException(status_code=503, detail="מאגר העובדים אינו זמין כעת") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail="מאגר העובדים אינו זמין כעת") from exc


def current_user(request: Request, db: Session = Depends(db_session)) -> User:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="נדרשת התחברות")
    try:
        payload = jwt.decode(auth[7:], SECRET_KEY, algorithms=["HS256"])
        if payload.get("kind", "internal") != "internal":
            raise ValueError("wrong token kind")
        user = db.get(User, int(payload["sub"]))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="החיבור פג או אינו תקין") from exc
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="המשתמש אינו פעיל")
    return user


def current_employee(request: Request, db: Session = Depends(db_session)) -> EmployeeAccount:
    payload = bearer_payload(request)
    if payload.get("kind") != "employee":
        raise HTTPException(status_code=401, detail="נדרשת התחברות למערכת העובדים")
    employee = db.get(EmployeeAccount, int(payload["sub"]))
    if not employee or not employee.is_active:
        raise HTTPException(status_code=401, detail="חשבון העובד אינו פעיל")
    return employee


def active_employee(employee: EmployeeAccount = Depends(current_employee)) -> EmployeeAccount:
    if employee.must_change_password:
        raise HTTPException(status_code=403, detail="יש להחליף את הסיסמה הראשונית")
    return employee


def owner_only(user: User = Depends(current_user)) -> User:
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="פעולה זו מיועדת לבעלים בלבד")
    return user


def user_payload(user: User) -> UserOut:
    return UserOut.model_validate(user, from_attributes=True)


def location_payload(item: Location) -> LocationOut:
    return LocationOut.model_validate(item, from_attributes=True)


def employee_payload(employee: EmployeeAccount) -> EmployeeOut:
    return EmployeeOut.model_validate(employee, from_attributes=True)


def location_request_payload(item: LocationRequest) -> LocationRequestOut:
    return LocationRequestOut(
        id=item.id,
        category=item.category,
        place_type=item.place_type,
        name=item.name,
        km=item.km,
        waze_url=item.waze_url,
        maps_url=item.maps_url,
        coordinates=item.coordinates,
        notes=item.notes,
        status=item.status,
        review_note=item.review_note,
        submitted_by_name=item.submitted_by.full_name,
        created_at=item.created_at,
        reviewed_at=item.reviewed_at,
    )

@app.get("/api/health")
def health():
    return {"status": "ok", "employee_auth_version": 2}

@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(db_session)):
    user = db.scalar(select(User).where(User.username == data.username.strip().lower()))
    if not user or not password_hash.verify(data.password, user.password_digest):
        raise HTTPException(status_code=401, detail="שם המשתמש או הסיסמה שגויים")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="המשתמש אינו פעיל")
    return {"token": issue_token(user), "user": user_payload(user)}

@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return user_payload(user)

@app.post("/api/auth/change-password")
def change_password(data: PasswordChangeIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    if not password_hash.verify(data.current_password, user.password_digest):
        raise HTTPException(status_code=400, detail="הסיסמה הנוכחית שגויה")
    user.password_digest = password_hash.hash(data.new_password)
    user.must_change_password = False
    db.add(user)
    db.commit()
    return {"token": issue_token(user), "user": user_payload(user)}

@app.get("/api/users")
def list_users(_: User = Depends(owner_only), db: Session = Depends(db_session)):
    return [user_payload(x) for x in db.scalars(select(User).order_by(User.full_name)).all()]

@app.post("/api/users", status_code=status.HTTP_201_CREATED)
def create_user(data: UserCreateIn, _: User = Depends(owner_only), db: Session = Depends(db_session)):
    username = data.username.strip().lower()
    if db.scalar(select(User).where(User.username == username)):
        raise HTTPException(status_code=409, detail="שם המשתמש כבר קיים")
    user = User(username=username, full_name=data.full_name.strip(), password_digest=password_hash.hash(data.password), role="manager", must_change_password=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_payload(user)

@app.patch("/api/users/{user_id}/toggle")
def toggle_user(user_id: int, owner: User = Depends(owner_only), db: Session = Depends(db_session)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
    if user.id == owner.id or user.role == "owner":
        raise HTTPException(status_code=400, detail="לא ניתן להשבית את משתמש הבעלים")
    user.is_active = not user.is_active
    db.commit()
    return user_payload(user)

@app.post("/api/employee-auth/login")
def employee_login(data: EmployeeLoginIn, db: Session = Depends(db_session)):
    id_number = normalize_id_number(data.id_number)
    worker = directory_worker(id_number)
    if not worker.get("is_active", False):
        raise HTTPException(status_code=403, detail="העובד אינו פעיל במאגר העובדים")
    employee = db.scalar(select(EmployeeAccount).where(EmployeeAccount.id_number == id_number))
    if not employee:
        employee = EmployeeAccount(
            worker_ref=int(worker["worker_id"]),
            id_number=id_number,
            full_name=str(worker["full_name"]).strip(),
            password_digest=password_hash.hash(EMPLOYEE_INITIAL_PASSWORD),
            must_change_password=True,
        )
        db.add(employee)
        db.flush()
    employee.worker_ref = int(worker["worker_id"])
    employee.full_name = str(worker["full_name"]).strip()
    employee.is_active = True
    password_is_valid = password_hash.verify(data.password, employee.password_digest)
    initial_password_recovery = employee.must_change_password and data.password == EMPLOYEE_INITIAL_PASSWORD
    if not password_is_valid and not initial_password_recovery:
        db.rollback()
        raise HTTPException(status_code=401, detail="תעודת הזהות או הסיסמה שגויות")
    if initial_password_recovery and not password_is_valid:
        employee.password_digest = password_hash.hash(EMPLOYEE_INITIAL_PASSWORD)
    employee.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(employee)
    return {"token": issue_employee_token(employee), "employee": employee_payload(employee)}


@app.get("/api/employee-auth/me")
def employee_me(employee: EmployeeAccount = Depends(current_employee)):
    return employee_payload(employee)


@app.post("/api/employee-auth/change-password")
def employee_change_password(
    data: EmployeePasswordChangeIn,
    employee: EmployeeAccount = Depends(current_employee),
    db: Session = Depends(db_session),
):
    if not password_hash.verify(data.current_password, employee.password_digest):
        raise HTTPException(status_code=400, detail="הסיסמה הנוכחית שגויה")
    if data.new_password == EMPLOYEE_INITIAL_PASSWORD:
        raise HTTPException(status_code=400, detail="יש לבחור סיסמה אישית חדשה")
    employee.password_digest = password_hash.hash(data.new_password)
    employee.must_change_password = False
    db.commit()
    db.refresh(employee)
    return {"token": issue_employee_token(employee), "employee": employee_payload(employee)}


@app.get("/api/employee/locations")
def employee_locations(_: EmployeeAccount = Depends(active_employee), db: Session = Depends(db_session)):
    stmt = select(Location).order_by(Location.category, Location.place_type, Location.name)
    return [location_payload(x) for x in db.scalars(stmt).all()]


@app.get("/api/employee/location-requests")
def employee_requests(employee: EmployeeAccount = Depends(active_employee), db: Session = Depends(db_session)):
    stmt = select(LocationRequest).where(LocationRequest.employee_account_id == employee.id).order_by(LocationRequest.created_at.desc())
    return [location_request_payload(x) for x in db.scalars(stmt).all()]


@app.post("/api/employee/location-requests", status_code=status.HTTP_201_CREATED)
def create_employee_request(
    data: LocationIn,
    employee: EmployeeAccount = Depends(active_employee),
    db: Session = Depends(db_session),
):
    item = LocationRequest(**data.model_dump(), employee_account_id=employee.id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return location_request_payload(item)


@app.get("/api/location-requests")
def internal_requests(
    request_status: str = "pending",
    _: User = Depends(current_user),
    db: Session = Depends(db_session),
):
    stmt = select(LocationRequest)
    if request_status != "all":
        stmt = stmt.where(LocationRequest.status == request_status)
    stmt = stmt.order_by(LocationRequest.created_at.desc())
    return [location_request_payload(x) for x in db.scalars(stmt).all()]


@app.post("/api/location-requests/{request_id}/approve")
def approve_location_request(
    request_id: int,
    data: ReviewIn,
    user: User = Depends(current_user),
    db: Session = Depends(db_session),
):
    item = db.get(LocationRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    if item.status != "pending":
        raise HTTPException(status_code=409, detail="הבקשה כבר טופלה")
    location = Location(
        category=item.category,
        place_type=item.place_type,
        name=item.name,
        km=item.km,
        waze_url=item.waze_url,
        maps_url=item.maps_url,
        coordinates=item.coordinates,
        notes=item.notes,
        created_by_id=user.id,
    )
    item.status = "approved"
    item.review_note = data.note.strip()
    item.reviewed_by_id = user.id
    item.reviewed_at = datetime.now(timezone.utc)
    db.add(location)
    db.commit()
    db.refresh(item)
    return location_request_payload(item)


@app.post("/api/location-requests/{request_id}/reject")
def reject_location_request(
    request_id: int,
    data: ReviewIn,
    user: User = Depends(current_user),
    db: Session = Depends(db_session),
):
    item = db.get(LocationRequest, request_id)
    if not item:
        raise HTTPException(status_code=404, detail="הבקשה לא נמצאה")
    if item.status != "pending":
        raise HTTPException(status_code=409, detail="הבקשה כבר טופלה")
    item.status = "rejected"
    item.review_note = data.note.strip()
    item.reviewed_by_id = user.id
    item.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return location_request_payload(item)


@app.post("/api/employee-accounts/reset-password")
def reset_employee_password(
    data: EmployeeResetIn,
    _: User = Depends(owner_only),
    db: Session = Depends(db_session),
):
    id_number = normalize_id_number(data.id_number)
    employee = db.scalar(select(EmployeeAccount).where(EmployeeAccount.id_number == id_number))
    if not employee:
        worker = directory_worker(id_number)
        if not worker.get("is_active", False):
            raise HTTPException(status_code=403, detail="העובד אינו פעיל במאגר העובדים")
        employee = EmployeeAccount(
            worker_ref=int(worker["worker_id"]),
            id_number=id_number,
            full_name=str(worker["full_name"]).strip(),
            password_digest=password_hash.hash(EMPLOYEE_INITIAL_PASSWORD),
            must_change_password=True,
            is_active=True,
        )
        db.add(employee)
    else:
        employee.password_digest = password_hash.hash(EMPLOYEE_INITIAL_PASSWORD)
        employee.must_change_password = True
        employee.is_active = True
    db.commit()
    db.refresh(employee)
    return employee_payload(employee)


@app.get("/api/locations")
def list_locations(_: User = Depends(current_user), db: Session = Depends(db_session)):
    stmt = select(Location).order_by(Location.category, Location.place_type, Location.name)
    return [location_payload(x) for x in db.scalars(stmt).all()]

@app.post("/api/locations", status_code=status.HTTP_201_CREATED)
def create_location(data: LocationIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    item = Location(**data.model_dump(), created_by_id=user.id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return location_payload(item)

@app.put("/api/locations/{location_id}")
def update_location(location_id: int, data: LocationIn, _: User = Depends(current_user), db: Session = Depends(db_session)):
    item = db.get(Location, location_id)
    if not item:
        raise HTTPException(status_code=404, detail="המיקום לא נמצא")
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return location_payload(item)

@app.delete("/api/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int, _: User = Depends(current_user), db: Session = Depends(db_session)):
    item = db.get(Location, location_id)
    if not item:
        raise HTTPException(status_code=404, detail="המיקום לא נמצא")
    db.delete(item)
    db.commit()

DIST = Path(__file__).resolve().parent.parent / "dist"
if DIST.exists():
    assets = DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
