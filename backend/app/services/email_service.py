"""
Email Service — thin abstraction over Resend.

All outgoing email goes through this class. Swapping providers requires
changing only this file — no API routes or models change.

Required env vars:
  RESEND_API_KEY   e.g. re_xxxxxxxxxxxx
  FROM_EMAIL       e.g. "AI ChatAssist <noreply@yourdomain.com>"
  FRONTEND_URL     e.g. "https://app.yourdomain.com"
"""

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmailService:
    """Wrapper around the Resend SDK for all transactional email."""

    def _client(self):
        import resend
        api_key = getattr(settings, "RESEND_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("RESEND_API_KEY is not configured")
        resend.api_key = api_key
        return resend

    def _to(self, email: str) -> str:
        """
        Resolve the actual recipient address.

        When RESEND_OVERRIDE_TO_EMAIL is set (e.g. novelwebdevelopers@gmail.com),
        ALL outgoing mail is redirected there regardless of the intended recipient.
        This lets the app work on Resend's shared test domain which can only deliver
        to the verified account email.  Remove the var once a custom domain is set up.
        """
        override = getattr(settings, "RESEND_OVERRIDE_TO_EMAIL", "").strip()
        return override if override else email

    def send_otp_verification(self, to_email: str, name: str, otp: str) -> bool:
        """Send a 6-digit OTP verification email. Returns True on success."""
        try:
            r = self._client()
            from_email = getattr(settings, "FROM_EMAIL", "noreply@example.com")
            r.Emails.send({
                "from": from_email,
                "to": [self._to(to_email)],
                "subject": "Your AI ChatAssist verification code",
                "html": _otp_html(name=name, otp=otp),
            })
            logger.info("otp_email_sent", to=to_email, override=self._to(to_email) != to_email)
            return True
        except Exception:
            logger.exception("otp_email_failed", to=to_email)
            return False

    def send_password_reset(self, to_email: str, name: str, reset_url: str) -> bool:
        """Send a password-reset email. Returns True on success."""
        try:
            r = self._client()
            from_email = getattr(settings, "FROM_EMAIL", "noreply@example.com")
            r.Emails.send({
                "from": from_email,
                "to": [self._to(to_email)],
                "subject": "Reset your AI ChatAssist password",
                "html": _password_reset_html(name=name, reset_url=reset_url),
            })
            logger.info("password_reset_email_sent", to=to_email)
            return True
        except Exception:
            logger.exception("password_reset_email_failed", to=to_email)
            return False

    def send_admin_setup_confirmation(self, to_email: str, name: str) -> bool:
        """Sent to the platform administrator after initial bootstrap."""
        try:
            r = self._client()
            from_email = getattr(settings, "FROM_EMAIL", "noreply@example.com")
            r.Emails.send({
                "from": from_email,
                "to": [self._to(to_email)],
                "subject": "AI ChatAssist platform setup complete",
                "html": _admin_setup_html(name=name),
            })
            logger.info("admin_setup_email_sent", to=to_email)
            return True
        except Exception:
            logger.exception("admin_setup_email_failed", to=to_email)
            return False

    def send_welcome(self, to_email: str, name: str, org_name: str) -> bool:
        """Send a welcome email after org signup. Returns True on success."""
        try:
            r = self._client()
            from_email = getattr(settings, "FROM_EMAIL", "noreply@example.com")
            r.Emails.send({
                "from": from_email,
                "to": [self._to(to_email)],
                "subject": f"Welcome to AI ChatAssist — {org_name}",
                "html": _welcome_html(name=name, org_name=org_name),
            })
            logger.info("welcome_email_sent", to=to_email)
            return True
        except Exception:
            logger.exception("welcome_email_failed", to=to_email)
            return False


# ---------------------------------------------------------------------------
# Email templates (minimal, inline-CSS safe for most clients)
# ---------------------------------------------------------------------------

def _admin_setup_html(*, name: str) -> str:
    frontend_url = getattr(settings, "FRONTEND_URL", "").rstrip("/")
    login_url = f"{frontend_url}/login" if frontend_url else ""
    return f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2>Platform setup complete</h2>
  <p>Hi {name},</p>
  <p>The AI ChatAssist platform has been successfully initialised. Your administrator account is ready.</p>
  <p>You now have full access to the Super Admin portal, where you can monitor organisations,
     users, and platform-wide statistics.</p>
  {"<p style='margin:32px 0'><a href='" + login_url + "' style='background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block'>Go to Super Admin portal →</a></p>" if login_url else ""}
  <p style="color:#6b7280;font-size:13px">Keep your credentials safe — this account controls the entire platform.</p>
  <p style="color:#6b7280;font-size:13px">— The AI ChatAssist team</p>
</body>
</html>
"""


def _password_reset_html(*, name: str, reset_url: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2>Reset your password</h2>
  <p>Hi {name},</p>
  <p>We received a request to reset your AI ChatAssist password.
     Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
  <p style="margin:32px 0">
    <a href="{reset_url}"
       style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;
              text-decoration:none;font-weight:600;display:inline-block">
      Reset password
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px">
    If you didn't request this, you can safely ignore this email — your password won't change.
  </p>
  <p style="color:#6b7280;font-size:13px">
    Or copy this link into your browser:<br>
    <a href="{reset_url}" style="color:#2563eb">{reset_url}</a>
  </p>
</body>
</html>
"""


def _welcome_html(*, name: str, org_name: str) -> str:
    frontend_url = getattr(settings, "FRONTEND_URL", "")
    return f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2>Welcome to AI ChatAssist!</h2>
  <p>Hi {name},</p>
  <p>Your organisation <strong>{org_name}</strong> is ready. You can start adding websites
     and inviting team members right away.</p>
  {"<p><a href='" + frontend_url + "/dashboard/chats' style='color:#2563eb'>Go to dashboard →</a></p>" if frontend_url else ""}
  <p style="color:#6b7280;font-size:13px">— The AI ChatAssist team</p>
</body>
</html>
"""


def _otp_html(*, name: str, otp: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2>Verify your email address</h2>
  <p>Hi {name},</p>
  <p>Use the code below to complete your AI ChatAssist signup.
     It expires in <strong>15 minutes</strong>.</p>
  <div style="margin:32px 0;text-align:center">
    <span style="display:inline-block;background:#f3f4f6;border:1px solid #e5e7eb;
                 border-radius:8px;padding:16px 32px;font-size:32px;font-weight:700;
                 letter-spacing:8px;color:#111827;font-family:monospace">
      {otp}
    </span>
  </div>
  <p style="color:#6b7280;font-size:13px">
    If you did not sign up for AI ChatAssist, please ignore this email.
  </p>
  <p style="color:#6b7280;font-size:13px">— The AI ChatAssist team</p>
</body>
</html>
"""
