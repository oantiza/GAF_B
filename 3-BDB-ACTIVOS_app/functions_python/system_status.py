# -*- coding: utf-8 -*-
"""Lectura read-only del estado operativo publicado en ``meta/*``.

El modulo no deriva ni corrige estados: expone los documentos tal como estan
publicados por los jobs existentes. Aceptar ``db`` como dependencia mantiene la
funcion testeable sin credenciales ni acceso a Firestore real.
"""
_STATUS_DOCUMENTS = {
    "integrity": "integrity_status",
    "backup": "backup_status",
    "prices": "price_refresh",
    "metrics": "metrics_refresh",
}


def _read_meta_document(db, document_id: str) -> dict | None:
    snapshot = db.collection("meta").document(document_id).get()
    if not getattr(snapshot, "exists", False):
        return None
    return snapshot.to_dict() or {}


def read_system_status(db=None) -> dict:
    """Devuelve el snapshot operativo; un documento ausente se representa con ``None``."""
    # MEDIA-7 (14-10-2026): cliente del lector cacheado por proceso (get_system_status
    # corre con el service account de lectura y aqui solo se lee).
    if db is None:
        from readmodel.firestore_client import get_master_db
        db = get_master_db()
    database = db
    result = {
        key: _read_meta_document(database, document_id)
        for key, document_id in _STATUS_DOCUMENTS.items()
    }
    for key, report_type in (("daily_report", "daily_report"), ("weekly_report", "weekly_report")):
        document = _read_meta_document(database, "report_status_" + report_type)
        if document is not None:
            result[key] = document
    return result
