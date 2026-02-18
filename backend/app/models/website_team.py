from sqlalchemy import Column, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class WebsiteTeam(Base, TimestampMixin):
    __tablename__ = "website_teams"

    id = Column(Integer, primary_key=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("website_id", "name", name="uq_website_team_name"),
        Index("ix_website_teams_website_id", "website_id"),
    )

    website = relationship("Website", back_populates="teams")
    members = relationship(
        "WebsiteTeamMember",
        back_populates="team",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WebsiteTeamMember(Base, TimestampMixin):
    __tablename__ = "website_team_members"

    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("website_teams.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_website_team_member"),
        Index("ix_website_team_members_team_id", "team_id"),
        Index("ix_website_team_members_user_id", "user_id"),
    )

    team = relationship("WebsiteTeam", back_populates="members")
    user = relationship("User")
