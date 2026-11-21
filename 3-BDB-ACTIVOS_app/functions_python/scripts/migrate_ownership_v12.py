#!/usr/bin/env python3
"""Migracion de propiedad de assets/{id} a los contratos master.asset.v1.2 / asset-stock.v1.1.

Saca de la raiz lo que no es de la plataforma y normaliza las altas documentales, para que ni el
republish ni migrate_provisional_roots tengan nada que pisar o reconstruir:

- Bloqueos escritos a mano (tmp/_flag4.py, 30-09): `is_investable` y `quality.review_note` salen de
  la raiz; la decision vive en asset_selection_controls.json, que hay que DESPLEGAR ANTES. Sin
  entrada en ese fichero el script se niega (el bloqueo se perderia). El flag
  PRICE_HISTORY_ARTIFACT_UNRESOLVED se queda en quality.review_flags: describe el dato EODHD.
- Altas documentales fuera del canonico (output/alta-river-20260929, output/alta-robeco-20260929):
  source_metadata.source -> MANUAL_DOCUMENTARY (+ source_detail), costes al contrato v1.2 y sello
  master.asset.v1.2.

No toca risk.sri_kid_evidence: esas 481 las asume el republish de la plataforma.

  python scripts/migrate_ownership_v12.py --backup ../../2-plataforma-datos/data/backups/<marca> --json out.json
  python scripts/migrate_ownership_v12.py                    # en seco contra Firestore (ADC)
  python scripts/migrate_ownership_v12.py --write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES

Reversion (devuelve desde la copia las claves que toca la migracion; el resto queda como esta vivo):
  python scripts/migrate_ownership_v12.py --restore-from ../../2-plataforma-datos/data/backups/<marca> --ids A,B
  python scripts/migrate_ownership_v12.py --restore-from <copia> --ids A,B --write --approval YES_I_UNDERSTAND_MASTER_DB_WRITES
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from asset_eligibility import selection_controls  # noqa: E402
from contract_validation import ContractValidationError, validate_contract  # noqa: E402
from master_project import master_project_id  # noqa: E402
from write_governance import require_master_writes_enabled  # noqa: E402

APPROVAL = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
FUND_SCHEMA_VERSION = "master.asset.v1.2"

# Altas hechas a mano desde documentos, fuera del canonico del extractor (29-09-2026).
MANUAL_ALTAS = {
    "ES0173985005": {"source_detail": "Andbank/CNMV", "registered_by": "output/alta-river-20260929/register.py"},
    "LU0591059224": {"source_detail": "Robeco", "registered_by": "output/alta-robeco-20260929 (register.py + enrich.py)"},
}


# Claves raiz que puede cambiar migrate_root: las unicas que devuelve la reversion.
MIGRATION_KEYS = ("is_investable", "quality", "source_metadata", "costs", "schema_version")


class MigrationError(ValueError):
    pass


def restore_root(live: dict, backup_doc: dict) -> dict:
    """Raiz viva con las claves de la migracion tal como estaban en la copia."""
    restored = deepcopy(live)
    for key in MIGRATION_KEYS:
        if key in backup_doc:
            restored[key] = deepcopy(backup_doc[key])
        else:
            restored.pop(key, None)
    return restored


def schema_for(root: dict) -> str:
    if root.get("asset_type") == "STOCK":
        return "asset-stock.v1.1.schema.json"
    if root.get("schema_version") == "master.asset-eodhd-market.v1":
        return "asset-market.v1.schema.json"
    return "asset.v1.2.schema.json"


def contract_errors(root: dict) -> str | None:
    try:
        validate_contract(root, schema_for(root))
        return None
    except ContractValidationError as exc:
        return str(exc)


def _split_cost_evidence(asset_id: str, costs: dict, changes: list[str]) -> None:
    """costs.evidence como mapa {nombre: documento} -> kid_evidence (el KID) + evidence (el resto)."""
    evidence = costs.get("evidence")
    if not (isinstance(evidence, dict) and evidence and "url" not in evidence
            and all(isinstance(v, dict) for v in evidence.values())):
        return
    kids = [k for k, v in evidence.items() if v.get("document_type") == "PRIIPS_KID"]
    others = [k for k in evidence if k not in kids]
    if len(kids) > 1 or len(others) > 1 or (kids and costs.get("kid_evidence")):
        raise MigrationError(f"{asset_id}: costs.evidence con documentos ambiguos ({', '.join(evidence)})")
    if kids:
        costs["kid_evidence"] = evidence[kids[0]]
    if others:
        costs["evidence"] = evidence[others[0]]
    else:
        costs.pop("evidence")
    changes.append(f"costs.evidence {{{', '.join(evidence)}}} -> kid_evidence ({', '.join(kids) or '-'}) / evidence ({', '.join(others) or '-'})")


def migrate_root(root: dict, controls: dict) -> tuple[dict, list[str]]:
    """Documento migrado y lista de cambios. Pura: no lee ni escribe Firestore."""
    asset_id = str(root.get("asset_id") or "")
    new = deepcopy(root)
    changes: list[str] = []
    control = controls.get(asset_id) or {}

    if "is_investable" in new:
        value = new.pop("is_investable")
        if value is False and not control.get("blocked"):
            raise MigrationError(f"{asset_id}: is_investable=false sin entrada blocked en asset_selection_controls.json")
        changes.append(f"borra is_investable={json.dumps(value)} (bloqueo en asset_selection_controls.json)")

    quality = new.get("quality")
    if isinstance(quality, dict) and "review_note" in quality:
        if not control.get("note"):
            raise MigrationError(f"{asset_id}: quality.review_note sin nota en asset_selection_controls.json")
        quality = dict(quality)
        quality.pop("review_note")
        new["quality"] = quality
        changes.append("borra quality.review_note (nota en asset_selection_controls.json)")

    source_metadata = new.get("source_metadata")
    if asset_id in MANUAL_ALTAS and isinstance(source_metadata, dict) and source_metadata.get("source") != "MANUAL_DOCUMENTARY":
        alta = MANUAL_ALTAS[asset_id]
        if source_metadata.get("source") != alta["source_detail"]:
            raise MigrationError(f"{asset_id}: source_metadata.source inesperado {source_metadata.get('source')!r}")
        new["source_metadata"] = {**source_metadata, "source": "MANUAL_DOCUMENTARY", **alta}
        changes.append(f"source_metadata.source {alta['source_detail']!r} -> 'MANUAL_DOCUMENTARY' (+source_detail, registered_by)")

    costs = new.get("costs")
    if isinstance(costs, dict) and new.get("asset_type") != "STOCK":
        costs = dict(costs)
        _split_cost_evidence(asset_id, costs, changes)
        if (costs.get("performance_fee_basis") and isinstance(costs.get("performance_fee_pct"), (int, float))
                and "performance_fee_rate_pct" not in costs):
            costs["performance_fee_rate_pct"] = costs.pop("performance_fee_pct")
            changes.append("costs.performance_fee_pct -> performance_fee_rate_pct (tipo contractual, no impacto anual del KID)")
        new["costs"] = costs

    if changes and schema_for(new) == "asset.v1.2.schema.json" and new.get("schema_version") != FUND_SCHEMA_VERSION:
        changes.append(f"schema_version {new.get('schema_version')!r} -> {FUND_SCHEMA_VERSION!r}")
        new["schema_version"] = FUND_SCHEMA_VERSION
    return new, changes


def plan(roots: dict[str, dict], controls: dict) -> dict:
    """Pasada en seco: que cambia, y validacion de contrato antes y despues para TODAS las raices."""
    summary = {"roots": len(roots), "invalid_before": {}, "invalid_after": {}, "to_migrate": [], "errors": []}
    migrated: dict[str, dict] = {}
    for asset_id, root in sorted(roots.items()):
        before = contract_errors(root)
        if before:
            summary["invalid_before"][asset_id] = before
        try:
            new, changes = migrate_root(root, controls)
        except MigrationError as exc:
            summary["errors"].append(str(exc))
            continue
        after = contract_errors(new)
        if after:
            summary["invalid_after"][asset_id] = after
        if changes:
            migrated[asset_id] = new
            summary["to_migrate"].append({
                "asset_id": asset_id,
                "name": (root.get("identity") or {}).get("name"),
                "changes": changes,
                "valid_after": after is None,
            })
    summary["counts"] = {
        "roots": len(roots),
        "invalid_before": len(summary["invalid_before"]),
        "to_migrate": len(summary["to_migrate"]),
        "invalid_after": len(summary["invalid_after"]),
        "errors": len(summary["errors"]),
    }
    return {"summary": summary, "migrated": migrated}


def read_backup_roots(backup: Path) -> dict[str, dict]:
    roots = {}
    with gzip.open(backup / "assets.ndjson.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            record = json.loads(line)
            parts = str(record.get("path") or "").split("/")
            if len(parts) == 2 and parts[0] == "assets" and ISIN_RE.fullmatch(parts[1]):
                roots[parts[1]] = record.get("data") or {}
    return roots


def _write(db, result: dict, now: str) -> dict:
    from google.cloud import firestore as gcf

    written, verified = 0, 0
    for asset_id, new in result["migrated"].items():
        ref = db.collection("assets").document(asset_id)
        snap = ref.get()
        live = snap.to_dict() or {}
        live_new, _changes = migrate_root(live, selection_controls())
        if live_new != new:
            raise MigrationError(f"{asset_id}: el documento vivo cambio desde la pasada en seco; repetirla")
        payload = {key: value for key, value in live_new.items() if live.get(key) != value}
        for key in live:
            if key not in live_new:
                payload[key] = gcf.DELETE_FIELD
        payload["updated_at"] = now
        ref.update(payload, option=db.write_option(last_update_time=snap.update_time))
        written += 1
        after = ref.get().to_dict() or {}
        after_cmp = {k: v for k, v in after.items() if k != "updated_at"}
        expected_cmp = {k: v for k, v in live_new.items() if k != "updated_at"}
        if after_cmp == expected_cmp and contract_errors(after) is None:
            verified += 1
    return {"written": written, "postverify_ok": verified}


def _restore(args) -> int:
    from google.cloud import firestore as gcf

    if not args.ids:
        raise SystemExit("--restore-from exige --ids (lista explicita de ISIN).")
    backup = read_backup_roots(Path(args.restore_from))
    db = gcf.Client(project=master_project_id())
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report = {"mode": "RESTORE_WRITE" if args.write else "RESTORE_DRY_RUN", "restored": [], "unchanged": [], "errors": []}
    for asset_id in [i.strip().upper() for i in args.ids.split(",") if i.strip()]:
        backup_doc = backup.get(asset_id)
        ref = db.collection("assets").document(asset_id)
        snap = ref.get()
        if backup_doc is None or not snap.exists:
            report["errors"].append(f"{asset_id}: falta en la copia o en la maestra; no se toca")
            continue
        live = snap.to_dict() or {}
        restored = restore_root(live, backup_doc)
        keys = sorted(k for k in set(live) | set(restored) if live.get(k) != restored.get(k))
        if not keys:
            report["unchanged"].append(asset_id)
            continue
        report["restored"].append({"asset_id": asset_id, "keys": keys})
        if args.write:
            payload = {k: restored[k] for k in keys if k in restored}
            payload.update({k: gcf.DELETE_FIELD for k in keys if k not in restored})
            payload["updated_at"] = now
            ref.update(payload, option=db.write_option(last_update_time=snap.update_time))
    print(json.dumps(report, ensure_ascii=False))
    return 0 if not report["errors"] else 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--restore-from", help="reversion: copia de backup:export de la que devolver las claves migradas")
    parser.add_argument("--ids", help="con --restore-from: ISIN separados por comas")
    parser.add_argument("--backup", help="copia local de npm run backup:export (pasada en seco sin red)")
    parser.add_argument("--json", help="fichero de salida con el plan completo")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--approval")
    args = parser.parse_args()
    if args.write and (args.approval != APPROVAL or args.backup):
        raise SystemExit("Escritura: --approval YES_I_UNDERSTAND_MASTER_DB_WRITES y sin --backup.")
    if args.write:
        require_master_writes_enabled("migrate_ownership_v12")  # hallazgo 31: el cerrojo general, antes de abrir el cliente
    if args.restore_from:
        return _restore(args)

    controls = selection_controls()
    db = None
    if args.backup:
        roots = read_backup_roots(Path(args.backup))
    else:
        from google.cloud import firestore as gcf

        db = gcf.Client(project=master_project_id())
        roots = {s.id: s.to_dict() or {} for s in db.collection("assets").stream() if ISIN_RE.fullmatch(s.id)}

    result = plan(roots, controls)
    summary = result["summary"]
    if args.write:
        if summary["errors"] or summary["invalid_after"]:
            raise SystemExit("La pasada en seco tiene errores o deja raices invalidas: no se escribe.")
        summary["write"] = _write(db, result, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
    if args.json:
        Path(args.json).write_text(json.dumps({"summary": summary, "after": result["migrated"]}, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8", newline="\n")
    print(json.dumps({"mode": "WRITE" if args.write else "DRY_RUN", **summary["counts"],
                      "to_migrate": [(r["asset_id"], len(r["changes"])) for r in summary["to_migrate"]],
                      "errors": summary["errors"]}, ensure_ascii=False))
    return 0 if not summary["errors"] and not summary["invalid_after"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
