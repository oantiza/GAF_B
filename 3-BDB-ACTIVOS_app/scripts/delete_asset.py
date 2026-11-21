#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Archiva o borra uno o varios activos de la BBDD MAESTRA: el doc `assets/<id>` +
TODAS sus subcolecciones. Hace BACKUP completo en output/deleted-assets/ ANTES
de tocar Firestore, asi que es reversible.

VIA OPERATIVA: archivar un activo se hace con `archive:assets` de 2-plataforma-datos
(Sistema › Operaciones › Archivar), que ademas lo da de baja del universo del
extractor. Este script es el respaldo manual y hace lo mismo en la maestra.

SEGURO POR DEFECTO: dry-run. Usa --write para mover a `_archived`.
El borrado fisico solo se permite con --write --hard.

Con --write (14-10-2026, ALTA-06):
- exige los gates de escritura ANTES de tocar nada, como el resto de escritores de la
  maestra: BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES y
  SEARCH_INDEX_WRITE_ENABLED=true;
- retira la entrada del activo de `meta/search_index` (como `archive:assets`). Si esa
  retirada fallara, el reconciliador nocturno la quita al reconstruir el indice.

Uso:
    python scripts/delete_asset.py IE00B5BMR087                  # dry-run
    python scripts/delete_asset.py IE00B5BMR087 --write           # archiva y elimina del activo vivo
    python scripts/delete_asset.py IE00B5BMR087 --write --hard    # borra fisicamente
"""
import sys
import json
from datetime import datetime, timezone
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT / "functions_python") not in sys.path:
    sys.path.insert(0, str(APP_ROOT / "functions_python"))

from master_project import master_project_id  # noqa: E402

BACKUP_DIR = APP_ROOT / "output" / "deleted-assets"
OPERATION = "delete_asset"


def parse_args(argv):
    write = "--write" in argv
    hard = "--hard" in argv
    ids = [a for a in argv if not a.startswith("-")]
    return ids, write, hard


def require_write_gates():
    """Gates de la maestra y del indice, antes de la primera escritura."""
    from write_governance import require_master_writes_enabled
    from search_index import require_search_index_writes_enabled

    require_master_writes_enabled(OPERATION)
    require_search_index_writes_enabled(OPERATION)


def _db():
    import firebase_admin
    from firebase_admin import firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"projectId": master_project_id()})
    return firestore.client()


def collect_document_tree(doc_ref):
    snap = doc_ref.get()
    if not snap.exists:
        return None

    tree = {
        "path": doc_ref.path,
        "id": doc_ref.id,
        "data": snap.to_dict() or {},
        "subcollections": {},
    }

    for col_ref in doc_ref.collections():
        docs = []
        for child_snap in col_ref.stream():
            docs.append(collect_document_tree(child_snap.reference))
        tree["subcollections"][col_ref.id] = [doc for doc in docs if doc is not None]

    return tree


def count_tree_docs(tree):
    if not tree:
        return 0
    return 1 + sum(
        count_tree_docs(child)
        for docs in tree.get("subcollections", {}).values()
        for child in docs
    )


def write_tree(doc_ref, tree, metadata=None):
    data = dict(tree.get("data") or {})
    if metadata:
        data.update(metadata)
    doc_ref.set(data)
    for col_id, docs in tree.get("subcollections", {}).items():
        for child in docs:
            write_tree(doc_ref.collection(col_id).document(child["id"]), child)


def delete_tree(doc_ref):
    for col_ref in doc_ref.collections():
        for child_snap in col_ref.stream():
            delete_tree(child_snap.reference)
    doc_ref.delete()


def remove_from_search_index(db, asset_id):
    """Retira la entrada del buscador. Nunca tumba el proceso: el activo ya esta fuera
    de `assets`, y el reconciliador nocturno limpia el indice si esto falla."""
    from search_index import remove_search_index_entry

    try:
        return "RETIRADO" if remove_search_index_entry(db, asset_id) else "NO_ESTABA"
    except Exception as exc:  # noqa: BLE001
        return "PENDIENTE (lo retira el reconciliador nocturno): %s" % str(exc)[:120]


def process(db, ids, write, hard, backup_dir=BACKUP_DIR):
    changed = 0
    for aid in ids:
        ref = db.collection("assets").document(aid)
        tree = collect_document_tree(ref)
        if not tree:
            print("  %s: NO existe, nada que borrar." % aid)
            continue
        sub_counts = {name: len(docs) for name, docs in tree["subcollections"].items()}
        print("  %s: %d documentos en total; subcolecciones=%s." % (aid, count_tree_docs(tree), sub_counts))
        if not write:
            print("    (con --write se retiraria tambien de meta/search_index)")
            continue
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = {
            "asset_id": aid,
            "mode": "hard_delete" if hard else "archive",
            "tree": tree,
        }
        path = backup_dir / ("deleted-%s-%s.json" % (aid.replace("/", "_"), stamp))
        path.write_text(json.dumps(backup, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
        if not hard:
            archive_ref = db.collection("_archived").document(aid)
            write_tree(archive_ref, tree, {
                "archived_at": datetime.now(timezone.utc).isoformat(),
                "archived_from": ref.path,
            })
        delete_tree(ref)
        index_status = remove_from_search_index(db, aid)
        changed += 1
        print("    %s. Buscador: %s. Backup en %s" % (
            "BORRADO HARD" if hard else "ARCHIVADO en _archived y retirado de assets", index_status, path))
    return changed


def main(argv=None):
    ids, write, hard = parse_args(sys.argv[1:] if argv is None else argv)
    if not ids:
        print("Falta el asset_id. Uso: python scripts/delete_asset.py <asset_id> [--write] [--hard]")
        return 1
    if write:
        require_write_gates()
    db = _db()
    changed = process(db, ids, write, hard)

    print("\n=== DELETE — %s ===" % ("BORRADO HARD aplicado" if write and hard else "ARCHIVADO aplicado" if write else "DRY-RUN"))
    if write:
        print("Activos procesados: %d (backups en %s)" % (changed, BACKUP_DIR))
    else:
        print("(dry-run: no se ha tocado nada; usa --write para archivar o --write --hard para borrar fisicamente)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
