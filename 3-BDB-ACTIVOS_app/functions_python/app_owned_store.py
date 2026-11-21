"""Escrituras app-owned consistentes y sin rematerializar padres en cada guardado."""
from __future__ import annotations

import threading


APP_NAMESPACE = "bdb_activos"
_KNOWN_OWNERS: set[str] = set()
_OWNER_LOCK = threading.RLock()


def save_owned_document(db, uid: str, collection: str, document_id: str, doc: dict) -> None:
    """Guarda padre+hijo atomicamente la primera vez por instancia; despues solo el hijo."""
    with _OWNER_LOCK:
        if uid in _KNOWN_OWNERS:
            db.collection(APP_NAMESPACE).document(uid).collection(collection).document(document_id).set(doc)
            return
        batch = db.batch()
        owner_ref = db.collection(APP_NAMESPACE).document(uid)
        child_ref = owner_ref.collection(collection).document(document_id)
        batch.set(owner_ref, {"owner_uid": uid}, merge=True)
        batch.set(child_ref, doc)
        batch.commit()
        _KNOWN_OWNERS.add(uid)


def clear_owner_cache() -> None:
    """Seam para pruebas."""
    with _OWNER_LOCK:
        _KNOWN_OWNERS.clear()
