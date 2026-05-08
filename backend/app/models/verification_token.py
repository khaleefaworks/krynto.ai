from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class VerificationToken(Base):
    """
    Magic-link tokens for email-gated verification flow.

    Flow:
    - POST /auth/signup or POST /auth/register creates a row here and emails the
      raw token to the user as a link: /verify-email?token=<raw>
    - GET /auth/verify-email validates the token (not used, not expired) and returns
      the user's email/name so the frontend can display them — does NOT consume the token.
    - POST /auth/send-otp marks the token as used, generates an EmailOTP, and sends it.

    Security:
    - Raw token is never stored — only its SHA-256 hex digest.
    - 2-hour TTL for signup, 48-hour TTL for admin invites (set by caller).
    - Single-use: used_at IS NOT NULL means the OTP has already been dispatched.
    """

    __tablename__ = "verification_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(64), unique=True, index=True, nullable=False)  # SHA-256 hex
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
