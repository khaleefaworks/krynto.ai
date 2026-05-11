from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# JWT settings
SECRET_KEY = getattr(settings, "SECRET_KEY", "")
ALGORITHM = "HS256"


def _get_secret_key() -> str:
    key = (SECRET_KEY or "").strip()
    if key:
        return key

    # Development fallback to keep local runs working.
    # Production must set SECRET_KEY explicitly (validated at startup).
    logger.warning("secret_key_missing_using_dev_fallback")
    return "dev-insecure-secret-key-change-me"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash using bcrypt directly."""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt directly."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)  # timezone-aware; .timestamp() is unambiguously UTC
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=int(settings.ACCESS_TOKEN_EXPIRE_MINUTES))

    to_encode.update({
        "exp": expire,
        # Used for password-change invalidation checks in deps.py.
        # Must use timezone-aware datetime so .timestamp() returns correct UTC epoch
        # regardless of server local timezone (e.g. IST UTC+5:30).
        "iat": int(now.timestamp()),
    })
    encoded_jwt = jwt.encode(to_encode, _get_secret_key(), algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT token."""
    try:
        payload = jwt.decode(token, _get_secret_key(), algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None
