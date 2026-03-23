from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class PasswordResetToken(Base):
    """
    Single-use, time-limited password reset tokens.

    Security design:
    - Only the SHA-256 hash of the raw token is stored here.
    - The raw token is sent in the email link and never persisted.
    - On reset: hash the incoming raw token, look up by hash, validate expiry + used_at.
    """
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # SHA-256 hex digest of the raw token sent in the email.
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    # Token expires 1 hour after issuance.
    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Set when the token is consumed; further uses are rejected.
    used_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")
