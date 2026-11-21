"""Runtime gate for writes against the shared master database."""

from __future__ import annotations

import json
import os

MASTER_WRITE_CONFIRMATION = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
MASTER_WRITE_ENV = "BDB_ACTIVOS_ENABLE_MASTER_WRITES"
MASTER_WRITES_DISABLED_CODE = "MASTER_WRITES_DISABLED"


class MasterWritesDisabledError(RuntimeError):
    def __init__(self, operation: str, actor_uid: str | None = None):
        self.operation = operation
        self.actor_uid = actor_uid
        super().__init__(
            f"{MASTER_WRITES_DISABLED_CODE}: Master DB writes are disabled for BDB-ACTIVOS. "
            f"Set {MASTER_WRITE_ENV}={MASTER_WRITE_CONFIRMATION} server-side only after explicit approval."
        )


def master_writes_enabled() -> bool:
    return os.environ.get(MASTER_WRITE_ENV) == MASTER_WRITE_CONFIRMATION


def master_writes_mode() -> str:
    return "enabled" if master_writes_enabled() else "disabled"


def require_master_writes_enabled(operation: str, actor_uid: str | None = None) -> None:
    if not master_writes_enabled():
        log_master_write_decision(operation, enabled=False, dry_run=False, actor_uid=actor_uid)
        raise MasterWritesDisabledError(operation=operation, actor_uid=actor_uid)

    log_master_write_decision(operation, enabled=True, dry_run=False, actor_uid=actor_uid)


def master_writes_disabled_result(operation: str) -> dict:
    return {
        "ok": False,
        "code": MASTER_WRITES_DISABLED_CODE,
        "operation": operation,
        "master_writes_enabled": False,
        "master_writes_mode": "disabled",
        "message": "Master DB writes are disabled for BDB-ACTIVOS."
    }


def log_master_write_decision(operation: str, enabled: bool, dry_run: bool, **meta) -> None:
    payload = {
        "event": "master_write_decision",
        "operation": operation,
        "enabled": bool(enabled),
        "dry_run": bool(dry_run),
    }
    actor_uid = meta.get("actor_uid")
    asset_id = meta.get("asset_id")
    if actor_uid:
        payload["actor_uid"] = str(actor_uid)
    if asset_id:
        payload["asset_id"] = str(asset_id)
    print(json.dumps(payload, ensure_ascii=True, sort_keys=True))
