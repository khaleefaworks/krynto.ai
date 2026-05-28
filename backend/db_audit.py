#!/usr/bin/env python3
"""
Database Schema Audit Tool — ai-chatassist

Equivalent of 'bench trim-tables' for the FastAPI / SQLAlchemy / PostgreSQL stack.

Checks:
  1. Orphaned columns  — exist in DB but are NOT in any SQLAlchemy model.
     These are completely safe to drop (Alembic migration never removed them).
  2. Always-null columns — exist in both model and DB, but have 0 non-NULL rows.
     These are candidates for review / removal.
  3. Ghost tables — exist in DB but are NOT in any SQLAlchemy model
     (e.g. dropped models, manual tables).

Usage:
  python db_audit.py                         # full report, read-only
  python db_audit.py --table conversations   # focus on one table
  python db_audit.py --null-threshold 90     # flag columns with >90 % NULL (default 100)
  python db_audit.py --generate-sql          # print DROP COLUMN SQL to stdout
  python db_audit.py --execute               # DESTRUCTIVE: actually runs the drops
"""

import argparse
import os
import sys
from pathlib import Path

# ── bootstrap: add backend/ to sys.path so 'app.*' imports work ──────────────
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

# Load .env (DATABASE_URL, etc.) before importing app modules
from dotenv import load_dotenv  # noqa: E402  (dotenv ships with python-dotenv in requirements)
load_dotenv(BACKEND_DIR / ".env")

import app.models  # noqa: F401,E402  — registers all ORM classes with Base.metadata
from app.models.base import Base  # noqa: E402
from app.core.database import engine  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

# ── ANSI colours ──────────────────────────────────────────────────────────────
_IS_TTY = sys.stdout.isatty()

def _c(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if _IS_TTY else s

RED    = lambda s: _c("31;1", s)
YELLOW = lambda s: _c("33;1", s)
GREEN  = lambda s: _c("32;1", s)
CYAN   = lambda s: _c("36",   s)
BOLD   = lambda s: _c("1",    s)
DIM    = lambda s: _c("2",    s)

# ── helpers ───────────────────────────────────────────────────────────────────

def get_model_columns() -> dict[str, set[str]]:
    """Return {table_name: {col_name, ...}} from SQLAlchemy metadata."""
    return {
        tbl_name: {c.name for c in tbl.columns}
        for tbl_name, tbl in Base.metadata.tables.items()
    }


def get_db_schema(conn) -> dict[str, list[dict]]:
    """Return {table_name: [{'name': ..., 'type': ...}, ...]} from live DB."""
    inspector = inspect(conn)
    result: dict[str, list[dict]] = {}
    for tbl in inspector.get_table_names():
        result[tbl] = [
            {"name": col["name"], "type": str(col["type"])}
            for col in inspector.get_columns(tbl)
        ]
    return result


def get_null_rates(conn, table_name: str, col_names: list[str]) -> dict[str, float]:
    """
    Execute a single query against `table_name` and return the NULL-rate
    (0.0–100.0) for each column in `col_names`.
    Returns {} if the table is empty.
    """
    if not col_names:
        return {}

    # Build COUNT(col) expressions — safe: col names come from SQLAlchemy metadata.
    count_exprs = ", ".join(
        f'COUNT("{c}") AS "{c}"' for c in col_names
    )
    sql = text(f'SELECT COUNT(*) AS _total, {count_exprs} FROM "{table_name}"')
    row = conn.execute(sql).mappings().first()
    if row is None:
        return {c: 0.0 for c in col_names}
    total = row["_total"]
    if total == 0:
        return {c: 100.0 for c in col_names}  # empty table: every col is "all null"
    return {c: round((1 - row[c] / total) * 100, 1) for c in col_names}


def _bar(pct: float, width: int = 10) -> str:
    filled = round(pct / 100 * width)
    bar = "█" * filled + "░" * (width - filled)
    if pct == 100.0:
        return RED(bar)
    elif pct >= 90.0:
        return YELLOW(bar)
    return DIM(bar)


# ── main ──────────────────────────────────────────────────────────────────────

def run_audit(
    target_table: str | None = None,
    null_threshold: float = 100.0,
    generate_sql: bool = False,
    execute: bool = False,
) -> None:
    model_cols = get_model_columns()  # {table: {col, ...}}
    model_tables = set(model_cols.keys())

    with engine.connect() as conn:
        db_schema = get_db_schema(conn)     # {table: [{name, type}, ...]}
        db_tables = set(db_schema.keys())

        # ── Ghost tables: in DB but not in any model ──────────────────────────
        known_meta_tables = {"alembic_version"}  # always expected
        ghost_tables = db_tables - model_tables - known_meta_tables

        # ── Per-table analysis ────────────────────────────────────────────────
        orphaned_columns: list[tuple[str, str, str]] = []   # (table, col, type)
        always_null_columns: list[tuple[str, str, float]] = []  # (table, col, pct)

        tables_to_scan = (
            [target_table] if target_table else sorted(db_tables - known_meta_tables)
        )

        print(BOLD("\n════════════════════════════════════════════════════════"))
        print(BOLD("  ai-chatassist  ·  Database Schema Audit"))
        print(BOLD("════════════════════════════════════════════════════════\n"))

        for tbl in tables_to_scan:
            if tbl not in db_schema:
                print(RED(f"  Table '{tbl}' not found in database."))
                continue

            db_cols = {c["name"]: c["type"] for c in db_schema[tbl]}
            model_col_set = model_cols.get(tbl, set())

            orphans = {c: t for c, t in db_cols.items() if c not in model_col_set}
            shared  = {c: t for c, t in db_cols.items() if c in model_col_set}

            # null rates for shared columns only (orphans may also be checked)
            all_check_cols = list(shared.keys()) + list(orphans.keys())
            null_rates = get_null_rates(conn, tbl, all_check_cols)

            # Collect for summary
            for col, col_type in orphans.items():
                orphaned_columns.append((tbl, col, col_type))
            for col in shared:
                rate = null_rates.get(col, 0.0)
                if rate >= null_threshold:
                    always_null_columns.append((tbl, col, rate))

            # ── Print table section ──────────────────────────────────────────
            is_ghost = tbl in ghost_tables
            header_flag = RED(" ⚠ GHOST TABLE (no model)") if is_ghost else ""
            print(BOLD(f"  ┌── {tbl}") + header_flag)

            if tbl not in model_tables:
                print(RED(f"  │  This table has no matching SQLAlchemy model!"))
            
            if not all_check_cols:
                print(DIM("  │  (no columns)"))
            else:
                # Header row
                print(DIM(f"  │  {'Column':<38} {'Source':<12} {'Type':<22} {'NULL%':>6}  {'':10}"))
                print(DIM("  │  " + "─" * 92))

                for col, col_type in sorted(db_cols.items()):
                    source = "model+db" if col in model_col_set else RED("db only ")
                    rate   = null_rates.get(col, 0.0)
                    rate_s = f"{rate:5.1f}%"
                    if rate == 100.0:
                        rate_s = RED(rate_s)
                    elif rate >= null_threshold:
                        rate_s = YELLOW(rate_s)

                    flag = ""
                    if col not in model_col_set:
                        flag = RED("← ORPHAN (no model)")
                    elif rate >= null_threshold:
                        flag = YELLOW("← always null") if rate == 100.0 else YELLOW(f"← >{null_threshold:.0f}% null")

                    print(f"  │  {col:<38} {source:<12} {col_type:<22} {rate_s:>9}  {_bar(rate)}  {flag}")

            print()

        # ── Ghost tables summary ──────────────────────────────────────────────
        if ghost_tables:
            print(BOLD("━━━  GHOST TABLES (in DB, no matching model)  ━━━"))
            for t in sorted(ghost_tables):
                print(f"  {RED('●')} {t}")
            print()

        # ── Summary ───────────────────────────────────────────────────────────
        print(BOLD("════════  SUMMARY  ════════"))
        total_model_cols = sum(len(c) for c in model_cols.values())
        print(f"  Model tables        : {len(model_tables)}")
        print(f"  DB tables           : {len(db_tables)}")
        print(f"  Ghost tables        : {RED(str(len(ghost_tables))) if ghost_tables else GREEN('0')}")
        print(f"  Total model columns : {total_model_cols}")
        print(
            f"  Orphaned columns    : "
            + (RED(str(len(orphaned_columns))) if orphaned_columns else GREEN("0"))
        )
        print(
            f"  Always-null columns : "
            + (YELLOW(str(len(always_null_columns))) if always_null_columns else GREEN("0"))
            + DIM(f"  (threshold {null_threshold:.0f}%)")
        )
        print()

        # ── Orphaned column detail ────────────────────────────────────────────
        if orphaned_columns:
            print(BOLD("━━━  ORPHANED COLUMNS (safe to drop)  ━━━"))
            print(DIM("  These columns exist in the DB but have no matching SQLAlchemy model column."))
            print(DIM("  They were likely left behind by an Alembic migration that dropped the field"))
            print(DIM("  from the model but forgot to issue ALTER TABLE ... DROP COLUMN.\n"))
            for tbl, col, col_type in orphaned_columns:
                print(f"  {RED('●')} {BOLD(tbl)}.{col}  {DIM(col_type)}")
            print()

        # ── Always-null column detail ─────────────────────────────────────────
        if always_null_columns:
            print(BOLD("━━━  ALWAYS-NULL COLUMNS (review before dropping)  ━━━"))
            print(DIM("  These columns exist in both model and DB, but contain no data."))
            print(DIM("  Verify that no code path writes to them before removing.\n"))
            for tbl, col, rate in always_null_columns:
                print(f"  {YELLOW('●')} {BOLD(tbl)}.{col}  {YELLOW(f'{rate:.1f}% NULL')}")
            print()

        # ── Generate / execute SQL ────────────────────────────────────────────
        drop_targets = orphaned_columns  # only orphans are auto-safe to drop
        sql_statements = [
            f'ALTER TABLE "{tbl}" DROP COLUMN IF EXISTS "{col}";'
            for tbl, col, _ in drop_targets
        ]

        if generate_sql or execute:
            if sql_statements:
                print(BOLD("━━━  DROP COLUMN SQL  ━━━"))
                for stmt in sql_statements:
                    print(f"  {stmt}")
                print()
            else:
                print(GREEN("  No orphaned columns found — nothing to drop.\n"))

        if execute:
            if not sql_statements:
                print(GREEN("  Nothing to execute."))
                return
            print(RED(BOLD("  ⚠  DESTRUCTIVE: About to execute DROP COLUMN statements.")))
            confirm = input("  Type 'yes' to proceed: ").strip().lower()
            if confirm != "yes":
                print("  Aborted.")
                return
            with engine.begin() as write_conn:
                for stmt in sql_statements:
                    print(f"  Executing: {stmt}")
                    write_conn.execute(text(stmt))
            print(GREEN("\n  Done. Run Alembic 'stamp' or create a migration to record the change."))

        if not generate_sql and not execute:
            if orphaned_columns or always_null_columns:
                print(DIM("  Tip: run with --generate-sql to see the DROP COLUMN statements."))
                print(DIM("       run with --execute    to drop orphaned columns (asks for confirmation)."))
            else:
                print(GREEN("  ✓ Schema looks clean — no orphaned or always-null columns found."))
        print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit the database schema against SQLAlchemy models.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--table", "-t",
        metavar="TABLE_NAME",
        help="Audit a single table only.",
    )
    parser.add_argument(
        "--null-threshold",
        type=float,
        default=100.0,
        metavar="PCT",
        help="Flag model columns with at least this NULL %% (default: 100 = always-null only).",
    )
    parser.add_argument(
        "--generate-sql",
        action="store_true",
        help="Print DROP COLUMN SQL for orphaned columns (does not execute).",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="DESTRUCTIVE: execute DROP COLUMN for orphaned columns after confirmation.",
    )
    args = parser.parse_args()

    try:
        run_audit(
            target_table=args.table,
            null_threshold=args.null_threshold,
            generate_sql=args.generate_sql,
            execute=args.execute,
        )
    except Exception as exc:
        print(RED(f"\n  ERROR: {exc}"))
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
