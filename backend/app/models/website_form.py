"""Website forms model.

Stores configurable contact/lead capture forms per website.
Forms can be displayed to visitors via the show_form automation action.
"""

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship

from app.models.base import TimestampMixin
from app.core.database import Base


class WebsiteForm(Base, TimestampMixin):
    __tablename__ = "website_forms"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)   # Admin label e.g. "Offline contact"
    slug = Column(String(60), nullable=False)     # Machine key, unique per website
    fields = Column(JSON, nullable=False, default=list)  # Ordered field descriptors
    submit_label = Column(String(80), nullable=False, server_default="Send")
    enabled = Column(Boolean, nullable=False, server_default="true")
    # The one form (per website) usable as the live-chat "contact card" (agent-
    # triggered) and as the offline gate's extra-fields extension. Only one
    # true per website — enforced in the API layer, not a DB constraint, since
    # it's a simple admin toggle rather than a hard invariant worth an index.
    is_contact_card = Column(Boolean, nullable=False, server_default="false")
    # Whether a submission of this form gets folded into the lead JSON sent
    # to webhooks (see lead_integration_service._enrich_payload_with_form_submissions).
    # Opt-out (defaults true) so existing forms keep today's behavior; an
    # admin flips this off for forms that shouldn't reach the CRM (internal
    # surveys, anything privacy-sensitive).
    include_in_lead = Column(Boolean, nullable=False, server_default="true")

    website = relationship("Website")
