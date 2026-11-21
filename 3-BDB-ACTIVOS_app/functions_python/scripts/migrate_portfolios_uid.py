#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Migra las carteras app-owned de UIDs antiguos al UID actual del usuario.

Contexto (2026-07-11): la rotacion de credenciales recreo la cuenta de Oscar
(mismo email, UID nuevo). Las carteras guardadas viven bajo
bdb_activos/{uid_antiguo}/portfolios y la app (correctamente) solo lista las
del UID de la sesion -> el usuario ve "ninguna cartera guardada".

Uso:
  python scripts/migrate_portfolios_uid.py                 # dry-run: inventario y plan
  python scripts/migrate_portfolios_uid.py --write \
      --approval YES_I_UNDERSTAND_MASTER_DB_WRITES         # ejecuta la migracion

Comportamiento:
  - COPIA (no mueve) cada bdb_activos/{uid_viejo}/portfolios/{pid} a
    bdb_activos/{uid_nuevo}/portfolios/{pid}, actualizando owner_uid.
  - Materializa el doc padre bdb_activos/{uid_nuevo} (leccion A2: sin padre,
    los exportadores antiguos no veian las carteras).
  - Por defecto NO borra los originales. Con ``--delete-source`` solo elimina
    una fuente cuando el destino existe y ambos payloads coinciden salvo owner_uid.
  - Si el destino ya existe con el mismo portfolio_id, lo omite (idempotente).
  - Postverifica: lista el destino y compara conteos.
"""
from __future__ import annotations

import argparse
import json
import sys

from pathlib import Path

from google.cloud import firestore as gcf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from master_project import master_project_id  # noqa: E402
from write_governance import require_master_writes_enabled  # noqa: E402
APPROVAL = "YES_I_UNDERSTAND_MASTER_DB_WRITES"

# UID actual de la sesion de Oscar (verificado en el navegador, 2026-07-11)
NEW_UID = "QMte7jgYd4PdutS3bLLXfY5uKzo1"
# UIDs antiguos con carteras huerfanas (verificados en Firestore/backup)
OLD_UIDS = [
    "2V1ogBZdu2SIreWhgnBqjzIbvEE3",
    "LZjYUZ39r5aJHcavQAsd1DGv7si1",
]


def equivalent_portfolios(source: dict, target: dict) -> bool:
    left = dict(source or {})
    right = dict(target or {})
    left.pop("owner_uid", None)
    right.pop("owner_uid", None)
    return left == right


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--approval")
    parser.add_argument("--delete-source", action="store_true")
    args = parser.parse_args()
    if args.write and args.approval != APPROVAL:
        raise SystemExit("Aprobacion de escritura ausente.")
    if args.delete_source and not args.write:
        raise SystemExit("--delete-source requiere --write.")
    if args.write:
        require_master_writes_enabled("migrate_portfolios_uid")  # hallazgo 31: el cerrojo general, antes de abrir el cliente

    db = gcf.Client(project=master_project_id())
    existing = {
        snap.id: snap.to_dict() or {}
        for snap in db.collection("bdb_activos").document(NEW_UID)
        .collection("portfolios").stream()
    }
    existing_ids = set(existing)
    print(f"[migracion] destino {NEW_UID}: {len(existing_ids)} carteras ya presentes")

    plan = []
    for old_uid in OLD_UIDS:
        for snap in (db.collection("bdb_activos").document(old_uid)
                     .collection("portfolios").stream()):
            data = snap.to_dict() or {}
            if snap.id not in existing_ids:
                action = "COPY"
            elif equivalent_portfolios(data, existing[snap.id]):
                action = "DUPLICATE_SAFE"
            else:
                action = "CONFLICT"
            plan.append({
                "old_uid": old_uid,
                "portfolio_id": snap.id,
                "name": data.get("name"),
                "positions": len(data.get("positions") or []),
                "action": action,
                "data": data,
            })

    for item in plan:
        print(f"[plan] {item['action']:11s} {item['old_uid'][:8]}../{item['portfolio_id']} "
              f"'{item['name']}' ({item['positions']} posiciones)")
    to_copy = [item for item in plan if item["action"] == "COPY"]
    conflicts = [item for item in plan if item["action"] == "CONFLICT"]
    if not plan:
        print("[migracion] no hay carteras bajo los UIDs antiguos; nada que hacer")
        return 0

    if not args.write:
        print(f"[migracion] DRY-RUN: {len(to_copy)} por copiar, "
              f"{len(conflicts)} conflictos, 0 escrituras. "
              "Repite con --write --approval ... para ejecutar.")
        return 0
    if conflicts:
        print(f"ERROR: {len(conflicts)} destinos difieren; no se escribe ni elimina nada.")
        return 3

    db.collection("bdb_activos").document(NEW_UID).set(
        {"owner_uid": NEW_UID}, merge=True)
    copied = 0
    for item in to_copy:
        payload = dict(item["data"])
        payload["owner_uid"] = NEW_UID
        (db.collection("bdb_activos").document(NEW_UID)
         .collection("portfolios").document(item["portfolio_id"]).set(payload))
        copied += 1

    after = [
        {"portfolio_id": snap.id, "name": (snap.to_dict() or {}).get("name")}
        for snap in (db.collection("bdb_activos").document(NEW_UID)
                     .collection("portfolios").stream())
    ]
    print(f"[migracion] copiadas {copied}; destino ahora tiene {len(after)}:")
    print(json.dumps(after, ensure_ascii=False, indent=1))
    expected = len(existing_ids) + len(to_copy)
    if len(after) != expected:
        print(f"ERROR postverify: esperadas {expected}, encontradas {len(after)}")
        return 2
    if args.delete_source:
        deleted = 0
        for item in plan:
            target = (db.collection("bdb_activos").document(NEW_UID)
                      .collection("portfolios").document(item["portfolio_id"]).get())
            if not target.exists or not equivalent_portfolios(item["data"], target.to_dict() or {}):
                print(f"ERROR: destino no verificable para {item['portfolio_id']}; no se borra la fuente")
                return 4
        for item in plan:
            (db.collection("bdb_activos").document(item["old_uid"])
             .collection("portfolios").document(item["portfolio_id"]).delete())
            deleted += 1
        remaining = sum(
            1 for old_uid in OLD_UIDS
            for _ in db.collection("bdb_activos").document(old_uid).collection("portfolios").stream()
        )
        if remaining:
            print(f"ERROR postverify: quedan {remaining} carteras antiguas")
            return 5
        print(f"[migracion] postverify OK. Eliminadas {deleted} copias fuente verificadas.")
    else:
        print("[migracion] postverify OK. Los originales se conservan bajo los UIDs antiguos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
