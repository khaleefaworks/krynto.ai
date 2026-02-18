from __future__ import annotations

import hashlib


AVATAR_COLOR_PALETTE = (
    "#DBEAFE",  # blue-100
    "#D1FAE5",  # emerald-100
    "#FEF3C7",  # amber-100
    "#FFE4E6",  # rose-100
    "#E0E7FF",  # indigo-100
    "#CFFAFE",  # cyan-100
    "#EDE9FE",  # violet-100
    "#F1F5F9",  # slate-100
)


def pick_avatar_color(seed: str) -> str:
    """Pick a stable 'random' light color for a given seed.

    Uses a deterministic hash so the same visitor gets the same color.
    """

    s = str(seed or "").encode("utf-8")
    digest = hashlib.md5(s).hexdigest()
    idx = int(digest, 16) % len(AVATAR_COLOR_PALETTE)
    return AVATAR_COLOR_PALETTE[idx]
