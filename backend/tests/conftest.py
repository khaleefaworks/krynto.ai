import os
import sys
from pathlib import Path


def pytest_configure():
    # Make `import app.*` work even when pytest is executed in an environment
    # that doesn't automatically prepend the backend root to `sys.path`.
    backend_root = Path(__file__).resolve().parents[1]
    backend_root_str = str(backend_root)
    if backend_root_str not in sys.path:
        sys.path.insert(0, backend_root_str)

    # Ensure tests have a usable default DB, even when the environment
    # doesn't provide DATABASE_URL.
    os.environ.setdefault("ENV", "test")
    os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
