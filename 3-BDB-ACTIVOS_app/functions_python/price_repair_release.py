"""Explicit operational release after a complete repair and price verification.

Unset by default. A deployment may set the exact ISINs from its verified repair
manifest. This only releases the static incident list; document-level quality
holds and future REPAIR_REQUIRED flags remain enforced.

The list a deployment must carry is versioned in verified_price_repair_releases.json:
scripts/desplegarFunciones.mjs refuses to deploy without it, because the variable lives
in an unversioned file and was lost once without anything breaking (decision 58).
"""
import os


def repair_released(asset_id):
    return bool(asset_id) and asset_id in {
        item.strip() for item in os.environ.get("BDB_VERIFIED_PRICE_REPAIR_RELEASES", "").split(",")
        if item.strip()
    }
