"""Per-website outbound integrations (e.g. push captured leads to any external
system a customer wants — CRM, ERP, Slack, a spreadsheet automation, etc.).

Any number of rows per website, including several of the same type — e.g. a
website can register multiple independent webhooks (one to Frappe, one to a
Zapier catch hook, one to an internal service). `config` holds whatever that
type needs, kept generic so a new integration type is just a new `type`
value, not a schema migration.
"""

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, JSON, Enum as SQLEnum
from sqlalchemy.orm import relationship
import enum

from app.models.base import TimestampMixin
from app.core.database import Base


class WebsiteIntegrationType(str, enum.Enum):
    WEBHOOK = "webhook"


class WebsiteIntegration(Base, TimestampMixin):
    __tablename__ = "website_integrations"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(
        SQLEnum(
            WebsiteIntegrationType,
            name="website_integration_type",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
    )
    # Admin-chosen label so a website with several webhooks can tell them
    # apart in the list ("Frappe CRM", "Zapier", ...). Not used for any logic.
    name = Column(String(120), nullable=False, server_default="")
    enabled = Column(Boolean, nullable=False, server_default="true")
    # webhook shape: {"url": str, "secret": str | None}. `secret`, if set, HMAC-
    # signs the outgoing payload (see lead_integration_service._push_webhook)
    # so any receiver — Frappe's own webhook doctype, Zapier, a custom
    # endpoint — can verify the request actually came from us.
    config = Column(JSON, nullable=False, default=dict)

    website = relationship("Website")
