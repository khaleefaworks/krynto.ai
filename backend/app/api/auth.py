from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
import secrets
import hashlib
import random
import re
from datetime import datetime, timedelta, timezone

from app.core.database import get_db, SessionLocal
from app.models.user import User, UserRole
from app.models.organization import Organization
from app.models.password_reset_token import PasswordResetToken
from app.models.email_otp import EmailOTP
from app.models.verification_token import VerificationToken
from app.models.system_settings import SystemSettings
from app.core.security import verify_password, get_password_hash, create_access_token, decode_access_token
from app.core.config import settings
from app.core.limiter import limiter
from app.core.system import is_system_initialized, mark_system_initialized
from app.api.deps import get_current_user, require_admin
from app.repos import login_sessions as login_sessions_repo

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()


def _record_login_session(
    db: Session, request: Request, token: str, user_id: int
) -> None:
    """Extract jti from token and persist a login session row. Best-effort."""
    try:
        payload = decode_access_token(token) or {}
        jti = payload.get("jti")
        if not jti:
            return
        ip = request.client.host if request.client else None
        ua = request.headers.get("user-agent")
        login_sessions_repo.create_session(
            db, jti=jti, user_id=user_id, ip_address=ip, user_agent=ua
        )
    except Exception:
        pass  # never block a login due to session tracking failure


def _slugify(text: str) -> str:
    """Convert a string to a URL-safe slug."""
    slug = text.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_-]+', '-', slug)
    slug = re.sub(r'^-+|-+$', '', slug)
    return slug or "org"


def _unique_slug(db: Session, base: str) -> str:
    """Ensure the slug is unique in the organizations table."""
    slug = base[:90]  # leave room for suffix
    if not db.query(Organization).filter_by(slug=slug).first():
        return slug
    for i in range(2, 10000):
        candidate = f"{slug}-{i}"
        if not db.query(Organization).filter_by(slug=candidate).first():
            return candidate
    return f"{slug}-{secrets.token_hex(4)}"


class LoginRequest(BaseModel):
    email: str  # Changed from EmailStr to allow "Administrator" username
    password: str


class BootstrapRequest(BaseModel):
    """Request model for creating the first admin user"""
    name: str
    email: EmailStr
    password: str
    setup_secret: str  # Must match SECRET_KEY from server .env


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.AGENT


class SignupRequest(BaseModel):
    """Public self-service signup — creates an org + OWNER user atomically."""
    name: str
    email: EmailStr
    password: str
    organization_name: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp: str


class ResendOTPRequest(BaseModel):
    email: EmailStr


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    is_available: bool
    is_active: bool
    avatar_url: str | None = None

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


@router.get("/setup/status")
async def check_setup_status():
    """
    Public endpoint to check if system needs initial setup.
    
    Returns:
        needs_setup: True if system is not initialized
    """
    return {
        "needs_setup": not is_system_initialized()
    }


@router.post("/bootstrap")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def bootstrap_admin(request: Request, bootstrap_request: BootstrapRequest):
    """
    Bootstrap endpoint - creates the first admin user.
    
    This endpoint:
    - Only works ONCE on a fresh installation
    - Creates Administrator user with SYSTEM_MANAGER role
    - Marks the system as initialized
    - Gets disabled forever after first use
    
    This prevents broken installs and ensures proper admin setup.
    """
    db = SessionLocal()
    
    try:
        # Check if system already initialized
        settings_row = db.query(SystemSettings).first()
        if settings_row and settings_row.is_initialized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System already initialized. Use /auth/login instead."
            )
        
        # Validate setup secret — must match SECRET_KEY in server .env
        if bootstrap_request.setup_secret != settings.SECRET_KEY:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid setup key."
            )

        # Ensure no users exist (extra safety check)
        user_count = db.query(User).count()
        if user_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Users already exist. System may be corrupted."
            )

        admin_email = bootstrap_request.email.strip().lower()
        admin_name = bootstrap_request.name or "Administrator"
        
        admin = User(
            name=admin_name,
            email=admin_email,
            password_hash=get_password_hash(bootstrap_request.password),
            role=UserRole.SYSTEM_MANAGER,
            is_active=True,
            is_available=True
        )
        
        db.add(admin)
        
        # Mark system as initialized
        mark_system_initialized(db)
        
        db.commit()
        db.refresh(admin)

        # Send a welcome / account-created email so the admin knows their credentials.
        # Non-blocking — a failure here does not roll back the bootstrap.
        try:
            from app.services.email_service import EmailService
            frontend_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
            EmailService().send_admin_setup_confirmation(
                to_email=admin.email,
                name=admin.name,
            )
        except Exception:
            pass  # email failure must never prevent a successful bootstrap

        return {
            "message": "Admin created successfully. System initialized.",
            "admin": {
                "id": admin.id,
                "name": admin.name,
                "email": admin.email,
                "role": admin.role.value
            }
        }
        
    finally:
        db.close()


@router.post("/login", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def login(request: Request, login_request: LoginRequest, db: Session = Depends(get_db)):
    """
    User login endpoint with JWT authentication.
    Works for all user roles (SYSTEM_MANAGER, MANAGER, AGENT).
    Special case: 'Administrator' username maps to system admin email.
    """
    # Block login if system not initialized
    if not is_system_initialized():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System not initialized. Create admin first via /auth/bootstrap"
        )
    
    # Special case: Allow "Administrator" as username (even if email changes).
    email = login_request.email.strip().lower() if login_request.email else ""
    if email == "administrator":
        user = (
            db.query(User)
            .filter(User.role == UserRole.SYSTEM_MANAGER)
            .order_by(User.id.asc())
            .first()
        )
    else:
        # Find user by email
        user = db.query(User).filter(User.email == email).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Check permanent or 24-hour lockout
    now = datetime.now(timezone.utc)
    
    if getattr(user, 'is_locked_out', False):
        # If it was an automatic 24-hour lock, check if it expired
        if getattr(user, 'temp_lockout_until', None):
            if user.temp_lockout_until <= now:
                # 24 hours passed, auto-unlock
                user.is_locked_out = False
                user.temp_lockout_until = None
                user.failed_login_attempts = 0
                db.commit()
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account has been Locked for 24 hours. Please contact your organization owner to unblock instantly."
                )
        else:
            # Manual owner lock
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account locked. Please contact your organization owner."
            )

    # Check temporary 5-minute lockout
    if getattr(user, 'temp_lockout_until', None) and user.temp_lockout_until > now:
        remaining = user.temp_lockout_until - now
        minutes = int(remaining.total_seconds() // 60) + 1
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account temporarily locked. Please try again after {minutes} minute{'s' if minutes > 1 else ''}."
        )
    
    # Verify password
    if not verify_password(login_request.password, user.password_hash):
        user.failed_login_attempts = getattr(user, 'failed_login_attempts', 0) + 1
        
        if user.failed_login_attempts >= 6:
            user.is_locked_out = True
            user.temp_lockout_until = datetime.now(timezone.utc) + timedelta(hours=24)
        elif user.failed_login_attempts >= 3:
            user.temp_lockout_until = datetime.now(timezone.utc) + timedelta(minutes=5)
            
        db.commit()
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Reset lockout counters on success
    if getattr(user, 'failed_login_attempts', 0) > 0 or getattr(user, 'temp_lockout_until', None) or getattr(user, 'is_locked_out', False):
        user.failed_login_attempts = 0
        user.temp_lockout_until = None
        user.is_locked_out = False
        db.commit()
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    # Block login if the user's organization is deactivated
    if user.organization_id is not None:
        org = db.query(Organization).filter(Organization.id == user.organization_id).first()
        if org and not org.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your organization has been deactivated. Please contact your platform administrator."
            )

    # Block login if email not yet verified — generate a fresh verification link and resend it
    if not user.is_email_verified:
        try:
            raw_token = _create_verification_token(db, user.id, ttl_hours=24)
            db.commit()
            from app.services.email_service import EmailService
            from app.models.organization import Organization as OrgModel
            frontend_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
            verify_url = f"{frontend_url}/verify-email?token={raw_token}"
            org = db.query(OrgModel).filter_by(id=user.organization_id).first()
            org_name = org.name if org else "your organisation"
            if user.role == UserRole.OWNER:
                EmailService().send_welcome_verify(
                    to_email=user.email, name=user.name, org_name=org_name, verify_url=verify_url
                )
            else:
                EmailService().send_invite_verify(
                    to_email=user.email, name=user.name, org_name=org_name, verify_url=verify_url
                )
        except Exception:
            pass

        return JSONResponse(
            status_code=200,
            content={
                "needs_verification": True,
                "email": user.email,
                "message": "Your email is not yet verified. We've sent a new verification link to your inbox.",
            }
        )

    # Generate JWT token with user_id, role, and organization_id
    access_token = create_access_token(
        data={
            "sub": "user",
            "user_id": user.id,
            "email": user.email,
            "role": user.role.value,
            "organization_id": user.organization_id,  # None for SYSTEM_MANAGER
        }
    )

    # Record the login session for server-side revocation.
    _record_login_session(db, request, access_token, int(user.id))

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.from_orm(user)
    )


@router.post("/signup", status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def signup(request: Request, signup_request: SignupRequest, db: Session = Depends(get_db)):
    """
    Public self-service signup.
    Atomically creates an Organisation + OWNER user with is_email_verified=False,
    then sends a 6-digit OTP to the user's email address.

    Returns { needs_verification: true, email: "..." } — the frontend must
    show an OTP entry step and call POST /auth/verify-otp to receive the JWT.
    """
    if not is_system_initialized():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="System not initialized. Create admin first via /auth/bootstrap",
        )

    signup_request.email = signup_request.email.strip().lower()
    existing = db.query(User).filter_by(email=signup_request.email).first()
    if existing and not existing.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    try:
        # Create org first (owner_id set after user creation)
        slug = _unique_slug(db, _slugify(signup_request.organization_name))
        org = Organization(
            name=signup_request.organization_name,
            slug=slug,
            plan="free",
            is_active=True,
        )
        db.add(org)
        db.flush()  # get org.id without committing

        user = User(
            name=signup_request.name,
            email=signup_request.email,
            password_hash=get_password_hash(signup_request.password),
            role=UserRole.OWNER,
            organization_id=org.id,
            is_active=True,
            is_available=True,
            is_email_verified=False,
        )
        db.add(user)
        db.flush()  # get user.id

        org.owner_id = user.id

        # Generate a VerificationToken (2-hour TTL) — OTP is NOT sent yet.
        # The user must click the link in the welcome email to reach the
        # "Send Verification Code" page, then explicitly trigger the OTP.
        raw_token = _create_verification_token(db, user.id, ttl_hours=2)
        db.commit()
        db.refresh(user)

        # Send welcome email with verification link (best-effort)
        try:
            from app.services.email_service import EmailService
            frontend_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
            verify_url = f"{frontend_url}/verify-email?token={raw_token}"
            EmailService().send_welcome_verify(
                to_email=user.email,
                name=user.name,
                org_name=org.name,
                verify_url=verify_url,
            )
        except Exception:
            pass

    except Exception:
        db.rollback()
        raise

    return {
        "needs_verification": True,
        "email": user.email,
        "message": "Account created. Check your email for a verification link.",
    }


@router.post("/verify-otp", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def verify_otp(request: Request, body: VerifyOTPRequest, db: Session = Depends(get_db)):
    """
    Verify a signup OTP and issue a JWT.

    Consumes the one-time code sent to the user's email during signup.
    On success, marks the user as email-verified and returns a JWT exactly
    like the login endpoint does.
    """
    body.email = body.email.strip().lower()
    user = db.query(User).filter_by(email=body.email, is_deleted=False).first()
    # Avoid leaking whether the email exists
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    if user.is_email_verified:
        # Already verified — just issue a token (handles double-submit gracefully)
        access_token = create_access_token(data={
            "sub": "user",
            "user_id": user.id,
            "email": user.email,
            "role": user.role.value,
            "organization_id": user.organization_id,
        })
        _record_login_session(db, request, access_token, int(user.id))
        return LoginResponse(access_token=access_token, token_type="bearer", user=UserResponse.from_orm(user))

    now = datetime.now(timezone.utc)
    otp_hash = hashlib.sha256(body.otp.strip().encode()).hexdigest()

    otp_record = (
        db.query(EmailOTP)
        .filter(
            EmailOTP.user_id == user.id,
            EmailOTP.otp_hash == otp_hash,
            EmailOTP.used_at.is_(None),
        )
        .first()
    )
    if not otp_record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    expires = otp_record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Code has expired. Request a new one.")

    otp_record.used_at = now
    user.is_email_verified = True
    db.commit()
    db.refresh(user)

    access_token = create_access_token(data={
        "sub": "user",
        "user_id": user.id,
        "email": user.email,
        "role": user.role.value,
        "organization_id": user.organization_id,
    })
    _record_login_session(db, request, access_token, int(user.id))
    return LoginResponse(access_token=access_token, token_type="bearer", user=UserResponse.from_orm(user))


@router.post("/resend-otp")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def resend_otp(request: Request, body: ResendOTPRequest, db: Session = Depends(get_db)):
    """
    Re-send the signup OTP.  Always returns 200 to prevent email enumeration.
    Invalidates any existing unused OTP records for this user first.
    """
    body.email = body.email.strip().lower()
    user = db.query(User).filter_by(email=body.email, is_deleted=False).first()
    if user and user.is_active and not user.is_email_verified:
        # Invalidate previous unused OTPs
        db.query(EmailOTP).filter(
            EmailOTP.user_id == user.id,
            EmailOTP.used_at.is_(None),
        ).delete(synchronize_session=False)

        raw_otp = f"{random.randint(0, 999999):06d}"
        otp_hash = hashlib.sha256(raw_otp.encode()).hexdigest()
        otp_record = EmailOTP(
            user_id=user.id,
            otp_hash=otp_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        )
        db.add(otp_record)
        db.commit()

        try:
            from app.services.email_service import EmailService
            EmailService().send_otp_verification(
                to_email=user.email,
                name=user.name,
                otp=raw_otp,
            )
        except Exception:
            pass

    return {"message": "If that email is pending verification, a new code has been sent."}


def _create_verification_token(db: Session, user_id: int, ttl_hours: int) -> str:
    """Generate a VerificationToken, persist it, and return the raw (unhashed) token."""
    # Invalidate any existing unused tokens for this user
    db.query(VerificationToken).filter(
        VerificationToken.user_id == user_id,
        VerificationToken.used_at.is_(None),
    ).delete(synchronize_session=False)

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    vt = VerificationToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
    )
    db.add(vt)
    db.flush()  # persist without committing so callers can batch with other writes
    return raw_token


@router.get("/verify-email")
async def get_verify_email(token: str, db: Session = Depends(get_db)):
    """
    Validate a magic-link verification token and return the associated user's
    email and name for display on the frontend.

    Does NOT consume the token — user can reload the page safely.
    Returns HTTP 200 in all cases; check the 'valid' field.
    """
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    vt = db.query(VerificationToken).filter_by(token_hash=token_hash).first()

    if not vt:
        return {"valid": False, "message": "This verification link is invalid."}

    if vt.used_at is not None:
        return {"valid": False, "message": "This verification link has already been used."}

    now = datetime.now(timezone.utc)
    expires = vt.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        return {"valid": False, "message": "This verification link has expired."}

    user = db.query(User).filter_by(id=vt.user_id, is_deleted=False).first()
    if not user or not user.is_active:
        return {"valid": False, "message": "This verification link is invalid."}

    if user.is_email_verified:
        return {"valid": False, "message": "Your email is already verified. Please log in."}

    return {"valid": True, "email": user.email, "name": user.name}


class SendOTPRequest(BaseModel):
    token: str


@router.post("/send-otp")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def send_otp(request: Request, body: SendOTPRequest, db: Session = Depends(get_db)):
    """
    Consume a VerificationToken, generate a fresh OTP, and send it to the user's email.

    This is the second step of the magic-link verification flow:
    1. User clicks /verify-email?token=xxx link in email
    2. Frontend calls GET /auth/verify-email to display the user's email
    3. User clicks "Send verification code" → this endpoint is called
    4. User enters the OTP → POST /auth/verify-otp issues a JWT

    Returns { email } so the frontend can pre-fill the OTP form.
    """
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    vt = db.query(VerificationToken).filter_by(token_hash=token_hash).first()

    now = datetime.now(timezone.utc)

    if not vt:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link")

    if vt.used_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This verification link has already been used")

    expires = vt.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This verification link has expired")

    user = db.query(User).filter_by(id=vt.user_id, is_deleted=False).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link")

    if user.is_email_verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already verified — please log in")

    # Mark token as used
    vt.used_at = now

    # Invalidate previous unused OTPs and generate a fresh one
    db.query(EmailOTP).filter(
        EmailOTP.user_id == user.id,
        EmailOTP.used_at.is_(None),
    ).delete(synchronize_session=False)

    raw_otp = f"{random.randint(0, 999999):06d}"
    otp_hash = hashlib.sha256(raw_otp.encode()).hexdigest()
    otp_record = EmailOTP(
        user_id=user.id,
        otp_hash=otp_hash,
        expires_at=now + timedelta(minutes=15),
    )
    db.add(otp_record)
    db.commit()

    try:
        from app.services.email_service import EmailService
        EmailService().send_otp_verification(
            to_email=user.email,
            name=user.name,
            otp=raw_otp,
        )
    except Exception:
        pass

    return {"email": user.email}


@router.post("/forgot-password")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Request a password-reset email.
    Always returns HTTP 200 regardless of whether the email exists
    — prevents email enumeration attacks.
    """
    body.email = body.email.strip().lower()
    user = db.query(User).filter_by(email=body.email, is_deleted=False).first()
    if user and user.is_active:
        # Invalidate any existing unused tokens for this user.
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        ).delete(synchronize_session=False)

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        reset_token = PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.add(reset_token)
        db.commit()

        frontend_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        reset_url = f"{frontend_url}/reset-password?token={raw_token}"

        try:
            from app.services.email_service import EmailService
            EmailService().send_password_reset(
                to_email=user.email,
                name=user.name,
                reset_url=reset_url,
            )
        except Exception:
            pass  # Never expose email errors to the caller

    # Always 200 — do not reveal whether the email exists.
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Consume a password-reset token and update the user's password.
    Token is single-use and expires after 1 hour.
    """
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    reset_token = db.query(PasswordResetToken).filter_by(token_hash=token_hash).first()

    now = datetime.now(timezone.utc)

    if not reset_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    if reset_token.used_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token has already been used")

    expires = reset_token.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token has expired")

    user = db.query(User).filter_by(id=reset_token.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")

    user.password_hash = get_password_hash(body.new_password)
    user.password_changed_at = now  # Invalidates all existing sessions
    reset_token.used_at = now
    db.commit()

    return {"message": "Password updated successfully. Please log in again."}


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    request: Request,
    register_request: RegisterRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)  # Only admins can create users
):
    """
    Register a new user account.
    Only accessible by admins (FULL_ACCESS).
    """
    # Check if user already exists
    register_request.email = register_request.email.strip().lower()
    existing_user = db.query(User).filter_by(email=register_request.email).first()
    if existing_user:
        if existing_user.is_deleted:
            # Re-enable the previously deleted account instead of rejecting.
            # Only SYSTEM_MANAGER may never be recreated via this endpoint.
            if register_request.role == UserRole.SYSTEM_MANAGER:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="System Manager role can only be set during bootstrap",
                )
            # Allow re-enabling as OWNER only when caller is an existing Owner or SYSTEM_MANAGER.
            if register_request.role == UserRole.OWNER:
                if not (_admin.role == UserRole.OWNER or _admin.is_superadmin()):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Only Owners or administrators can create Owner accounts",
                    )
            existing_user.is_deleted = False
            existing_user.is_active = True
            existing_user.is_available = False
            existing_user.is_email_verified = False
            existing_user.name = register_request.name
            existing_user.password_hash = get_password_hash(register_request.password)
            existing_user.password_changed_at = datetime.now(timezone.utc)
            existing_user.role = register_request.role

            # Fresh VerificationToken for re-invited user (48-hour TTL)
            raw_token = _create_verification_token(db, existing_user.id, ttl_hours=48)
            db.commit()
            db.refresh(existing_user)

            try:
                from app.services.email_service import EmailService
                from app.models.organization import Organization as OrgModel
                org = db.query(OrgModel).filter_by(id=existing_user.organization_id).first()
                org_name = org.name if org else "your organisation"
                frontend_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
                verify_url = f"{frontend_url}/verify-email?token={raw_token}"
                EmailService().send_invite_verify(
                    to_email=existing_user.email,
                    name=existing_user.name,
                    org_name=org_name,
                    verify_url=verify_url,
                )
            except Exception:
                pass

            return {
                "needs_verification": True,
                "message": "User re-enabled. An invitation email with a verification link has been sent.",
                "user": {
                    "id": existing_user.id,
                    "name": existing_user.name,
                    "email": existing_user.email,
                    "role": existing_user.role.value,
                },
            }
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # System Manager accounts cannot be created via this endpoint.
    if register_request.role == UserRole.SYSTEM_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System Manager role can only be set during bootstrap",
        )
    # Owner accounts may only be created by an existing Owner (within the same org)
    # or by a platform SYSTEM_MANAGER.
    if register_request.role == UserRole.OWNER:
        calling_admin: User = _admin
        if not (calling_admin.role == UserRole.OWNER or calling_admin.is_superadmin()):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Owner role can only be created by an existing Owner or administrator",
            )

    # New users automatically inherit the calling admin's organisation.
    # A SYSTEM_MANAGER (organization_id=None) must be handled by /auth/signup instead.
    calling_admin: User = _admin
    if calling_admin.organization_id is None and not calling_admin.is_superadmin():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot determine organisation — use /auth/signup to create an org first",
        )

    # Create new user — requires email verification before first login.
    user = User(
        name=register_request.name,
        email=register_request.email,
        password_hash=get_password_hash(register_request.password),
        role=register_request.role,
        organization_id=calling_admin.organization_id,  # inherits caller's org (None for superadmin)
        is_active=True,
        is_available=False,
        is_email_verified=False,
    )

    db.add(user)
    db.flush()  # get user.id without committing

    # Generate a VerificationToken (48-hour TTL for invites — OTP is NOT sent yet)
    raw_token = _create_verification_token(db, user.id, ttl_hours=48)
    db.commit()
    db.refresh(user)

    # Send invite email with verification link (best-effort — failure must not block user creation)
    try:
        from app.services.email_service import EmailService
        from app.models.organization import Organization as OrgModel
        org = db.query(OrgModel).filter_by(id=user.organization_id).first()
        org_name = org.name if org else "your organisation"
        frontend_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        verify_url = f"{frontend_url}/verify-email?token={raw_token}"
        EmailService().send_invite_verify(
            to_email=user.email,
            name=user.name,
            org_name=org_name,
            verify_url=verify_url,
        )
    except Exception:
        pass

    return {
        "needs_verification": True,
        "message": "User created. An invitation email with a verification link has been sent.",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
        },
    }


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user details."""
    return current_user


@router.get("/users")
async def list_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin)  # Only admins can list users
):
    """
    List all users (for admin purposes).
    Only accessible by admins.
    """
    if _admin.is_superadmin():
        users = db.query(User).filter(User.is_deleted == False).all()
    else:
        users = db.query(User).filter(
            User.organization_id == _admin.organization_id,
            User.is_deleted == False,
        ).all()
    return [
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
            "is_available": user.is_available,
            "is_active": user.is_active,
            "avatar_url": user.avatar_url,
        }
        for user in users
    ]


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------

@router.post("/logout")
async def logout(
    request: Request,
    credentials: HTTPBearer = Depends(security),
    db: Session = Depends(get_db),
):
    """Revoke the current JWT session.

    Extracts the jti from the bearer token and marks the session as inactive
    so subsequent requests with the same token receive 401 even before expiry.
    Clients must still clear the token from localStorage.

    Tokens without a jti claim (issued before this feature) are accepted and
    silently ignored — they expire naturally via the exp claim.
    """
    try:
        payload = decode_access_token(credentials.credentials) or {}
        jti = payload.get("jti")
        if jti:
            login_sessions_repo.revoke_session(db, jti)
    except Exception:
        pass  # best-effort; always return success to avoid leaking token state
    return {"ok": True}


# ---------------------------------------------------------------------------
# Session Management
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all active login sessions for the current user."""
    sessions = login_sessions_repo.list_active_for_user(db, user_id=int(current_user.id))
    return [
        {
            "jti": s.jti,
            "ip_address": s.ip_address,
            "user_agent": s.user_agent,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "last_used_at": s.last_used_at.isoformat() if s.last_used_at else None,
        }
        for s in sessions
    ]


@router.delete("/sessions/{jti}")
async def revoke_session_by_jti(
    jti: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke a specific session by jti. Only the session owner can revoke it."""
    session = login_sessions_repo.get_by_jti(db, jti)
    if not session or session.user_id != int(current_user.id):
        raise HTTPException(status_code=404, detail="Session not found")
    login_sessions_repo.revoke_session(db, jti)
    return {"ok": True}

