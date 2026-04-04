from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class EmailOTP(Base):
    """
    One-time password records for signup email verification.

    Flow:
    - POST /auth/signup creates the user (is_email_verified=False) and inserts a row here.
    - POST /auth/verify-otp hashes the submitted code, finds the matching unused/unexpired row,
      marks it used, and sets user.is_email_verified = True.
    - Rows are never mutated except to set used_at; expired rows accumulate until cleaned up.

    Security:
    - Raw OTP is never stored — only its SHA-256 hex digest.
    - 15-minute TTL enforced by comparing expires_at against server UTC.
    - Single-use: used_at IS NOT NULL means consumed.
    """

    __tablename__ = "email_otps"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    otp_hash = Column(String(64), nullable=False)  # SHA-256 hex of the 6-digit string
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
