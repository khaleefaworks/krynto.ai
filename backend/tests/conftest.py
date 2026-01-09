import os


def pytest_configure():
    # Ensure tests have a usable default DB, even when the environment
    # doesn't provide DATABASE_URL.
    os.environ.setdefault("ENV", "test")
    os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
