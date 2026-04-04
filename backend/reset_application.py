#!/usr/bin/env python3
"""
Reset the AI ChatAssist application to fresh state.
This will delete ALL data and reset system initialization.

Use this for:
- Testing onboarding flow
- Fresh start
- Development reset

WARNING: This is DESTRUCTIVE and cannot be undone!

Usage:
  python reset_application.py          # Fresh reset (onboarding flow)
  python reset_application.py --seed   # Reset with test data
"""

import sys
from pathlib import Path
import shutil
from app.core.database import SessionLocal
from app.models.base import Base
from app.models.system_settings import SystemSettings
from app.models.user import User
from app.models.website import Website
from app.models.organization import Organization
from app.models.conversation import Conversation
from seed_data import seed_database

# Ensure all models are imported so Base.metadata knows about every table.
# This keeps the reset logic resilient as new tables are added.
import app.models  # noqa: F401


def _get_existing_table_names(db_session) -> set[str]:
    """Return the set of existing table names in the connected database.

    This makes reset resilient when the database schema is behind the current
    code's SQLAlchemy metadata (e.g. migrations not applied yet).
    """
    from sqlalchemy import inspect

    inspector = inspect(db_session.get_bind())
    table_names: set[str] = set()

    # Prefer the default Postgres schema.
    try:
        table_names.update(inspector.get_table_names(schema="public"))
    except Exception:
        pass

    # Fallback: some DBs/tests may not use 'public' explicitly.
    try:
        table_names.update(inspector.get_table_names())
    except Exception:
        pass

    return table_names


def _clean_uploads_dir(uploads_dir: Path) -> None:
    """Remove all files/folders inside *uploads_dir*, keeping the directory itself."""
    if not uploads_dir.exists() or not uploads_dir.is_dir():
        return

    for child in uploads_dir.iterdir():
        # keep placeholder files if you ever add them
        if child.name == ".gitkeep":
            continue
        try:
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink(missing_ok=True)
        except Exception as e:
            print(f"  ⚠️  Failed to delete uploaded file(s) at {child}: {e}")


def delete_uploaded_files():
    """Delete uploaded files from all upload directories.

    The canonical uploads root lives at <repo-root>/uploads (matches
    app.core.uploads.get_uploads_root).  A legacy backend/uploads may
    also contain files, so we clean both.
    """
    repo_root = Path(__file__).resolve().parent.parent  # backend/ -> repo root
    primary_uploads = repo_root / "uploads"
    legacy_uploads = Path(__file__).resolve().parent / "uploads"  # backend/uploads

    _clean_uploads_dir(primary_uploads)
    if legacy_uploads.resolve() != primary_uploads.resolve():
        _clean_uploads_dir(legacy_uploads)

def confirm_reset(with_seed):
    """Ask for confirmation before resetting"""
    print("⚠️  WARNING: This will DELETE ALL DATA from the database!")
    print("   - All users")
    print("   - All websites")
    print("   - All conversations and messages")
    if with_seed:
        print("   - Will seed with test data (admin + agent)")
    else:
        print("   - Fresh start (will trigger onboarding)")
    print()
    response = input("Are you sure you want to continue? Type 'YES' to confirm: ")
    return response == "YES"

def reset_database(with_seed=False):
    """Reset the database to fresh state"""
    if not confirm_reset(with_seed):
        print("❌ Reset cancelled.")
        return
    
    print("\n🔄 Resetting database...")

    print("  Deleting uploaded files...")
    delete_uploaded_files()
    
    db = SessionLocal()
    try:
        # Delete all data in reverse table dependency order (FK-safe).
        # This prevents failures when new tables are added (e.g. push_subscriptions).
        print("  Deleting database rows...")
        from sqlalchemy import text
        from sqlalchemy.exc import ProgrammingError

        existing_tables = _get_existing_table_names(db)
        if not existing_tables:
            print("  ⚠️  No tables detected in the database. If this is a fresh DB, run: alembic upgrade head")

        dialect = db.get_bind().dialect.name

        if dialect == "postgresql":
            # Fast and reliable wipe for all known tables, handling FK cycles.
            truncatable = [
                table.name
                for table in Base.metadata.tables.values()
                if table.name != "alembic_version" and table.name in existing_tables
            ]
            if truncatable:
                quoted = ", ".join(f'"{name}"' for name in truncatable)
                db.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
                db.commit()
            else:
                db.commit()
        else:
            # Generic fallback for SQLite/other DBs.
            # Commit per table so a rollback on one table does not undo prior deletions.
            for table in reversed(Base.metadata.sorted_tables):
                if table.name == "alembic_version":
                    continue
                if table.name not in existing_tables:
                    continue

                try:
                    db.execute(table.delete())
                    db.commit()
                except ProgrammingError as e:
                    msg = str(getattr(e, "orig", e))
                    if "UndefinedTable" in msg or "does not exist" in msg:
                        print(f"  ⚠️  Skipping missing table: {table.name}")
                        db.rollback()
                        continue
                    raise
        
        # Reset all sequences to start from 1 (Postgres only).
        if dialect == "postgresql":
            print("  Resetting ID sequences...")

            seq_rows = db.execute(
                text(
                    """
                    SELECT sequence_name
                    FROM information_schema.sequences
                    WHERE sequence_schema = 'public'
                    """
                )
            ).fetchall()

            for (seq_name,) in seq_rows:
                db.execute(text(f'ALTER SEQUENCE "{seq_name}" RESTART WITH 1'))

            db.commit()
        
        # Final sanity check to prove full wipe happened.
        print("\n🔎 Verifying reset state...")
        print(f"   users={db.query(User).count()}")
        print(f"   organizations={db.query(Organization).count()}")
        print(f"   websites={db.query(Website).count()}")
        print(f"   conversations={db.query(Conversation).count()}")

        print("\n✅ Database reset successfully!")
        
        if with_seed:
            # Seed database with test data
            print("\n📦 Seeding database with test data...")
            seed_database()
            
            # Set reset timestamp to invalidate old tokens
            from datetime import datetime, timezone
            settings = db.query(SystemSettings).first()
            if settings:
                settings.last_reset_at = datetime.now(timezone.utc)
                db.commit()
                print("\n🔐 All previous auth tokens invalidated")
            
            print("\n🎉 System is now ready!")
            print("\n📍 Next Steps:")
            print("   1. Navigate to http://localhost:5173 to login")
            print("   2. Widget demo: http://localhost:8080/demo.html")
        else:
            print("\n🎉 Fresh database created!")
            print("\n📍 Next Steps:")
            print("   1. Navigate to http://localhost:5173")
            print("   2. Complete the onboarding process")
            print("   3. Create your admin account and first website")
        
    except Exception as e:
        print(f"\n❌ Error during reset: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    # Check for --seed argument
    with_seed = "--seed" in sys.argv
    reset_database(with_seed=with_seed)
