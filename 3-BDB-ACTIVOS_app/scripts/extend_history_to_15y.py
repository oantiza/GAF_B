#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extiende hacia atras el historico (price_series) hasta ~15 anios (2011) para los
activos que YA tienen datos, reutilizando la maquinaria de load_missing_price_series.

Estrategia SEGURA (aditiva): para cada activo busca su fecha mas antigua y solo
ANADE los anios COMPLETOS anteriores a ese inicio (doc ids EODHD_<symbol>_YEAR_<anio>
nuevos). Nunca toca ni pisa los documentos existentes. EODHD devuelve solo lo que
exista, asi que los fondos se extienden hasta su inicio real (no todos llegan a 2011).

Reutiliza el symbol / divisa / tipo guardados en los propios docs existentes
(source_listing_id, source_currency, asset_type), sin re-resolver simbolos.

SEGURO POR DEFECTO: dry-run (no escribe). Usa --write para aplicar.
Hace backup JSON por activo antes de escribir.

Decision 106 (05-11-2026): --write exige el gate de la maestra
(BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES) antes de la primera
lectura, como los demas. El proyecto sale de `master_project`, por load_missing_price_series.
Hasta entonces recorria todos los activos y anadia series sin pedir nada, y en el proyecto
de BDB, que heredaba de aquel sin nombrarlo.

Requisitos (ya los usas para load_missing_price_series):
    pip install firebase-admin
    gcloud auth application-default login   # o GOOGLE_APPLICATION_CREDENTIALS
    EODHD_API_TOKEN en functions_python/.env o .env.local

Uso:
    python scripts/extend_history_to_15y.py            # dry-run: cuantos y cuanto extenderia
    python scripts/extend_history_to_15y.py --write    # aplica (escribe Firestore)
    SAMPLE=20 python scripts/extend_history_to_15y.py  # limita a 20 activos (pruebas)
"""
import os
import sys
import json
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import load_missing_price_series as L  # noqa: E402
from write_governance import log_master_write_decision, require_master_writes_enabled  # noqa: E402

OPERATION = "extend_history_to_15y"
TARGET_START = "2011-01-01"
TARGET_YEAR = 2011
WRITE = "--write" in sys.argv
SAMPLE = int(os.environ.get("SAMPLE", "0"))
SLEEP = float(os.environ.get("SLEEP", "0.12"))  # cortesia con EODHD
BACKUP_DIR = Path(__file__).resolve().parents[1] / "output" / "price-series-extend"


def read_existing(ref):
    out = {}
    for snap in ref.collection("price_series").stream():
        out[snap.id] = snap.to_dict() or {}
    return out


def earliest_date(docs):
    best = None
    for d in docs.values():
        fd = d.get("first_date")
        pts = d.get("points")
        if not fd and isinstance(pts, list) and pts:
            fd = pts[0].get("date")
        if isinstance(fd, str) and len(fd) >= 10 and (best is None or fd < best):
            best = fd[:10]
    return best


def reuse_meta(docs):
    """symbol / divisa origen / tipo a partir de un doc de price_series existente."""
    sample = None
    # preferimos el doc del anio mas antiguo (mas representativo del symbol original)
    for d in sorted(docs.values(), key=lambda x: str(x.get("first_date") or "9999")):
        sample = d
        break
    if sample is None:
        return None, "EUR", "EQUITY"
    sid = sample.get("source_listing_id") or sample.get("source_price_id") or ""
    sym = sid.split("EODHD:", 1)[1] if "EODHD:" in sid else None
    ccy = sample.get("source_currency") or "EUR"
    atype = sample.get("asset_type") or "EQUITY"
    return sym, ccy, atype


def main():
    if WRITE:
        # Antes de la primera lectura, y antes de cargar ningun .env: una puerta no se abre desde un fichero.
        require_master_writes_enabled(OPERATION)
    else:
        log_master_write_decision(OPERATION, enabled=False, dry_run=True)
    L._load_environment()
    db = L._db()
    total = with_hist = already = no_data = extended = 0
    extensibles = 0
    samples = []

    for snap in db.collection("assets").stream():
        if SAMPLE and total >= SAMPLE:
            break
        total += 1
        aid = snap.id
        ref = db.collection("assets").document(aid)
        docs = read_existing(ref)
        docs_pts = {k: v for k, v in docs.items()
                    if isinstance(v.get("points"), list) and v.get("points")}
        if not docs_pts:
            continue  # sin historico -> lo cubre load_missing_price_series.py
        with_hist += 1

        first = earliest_date(docs_pts)
        if first is None:
            continue
        first_year = int(first[:4])
        if first_year <= TARGET_YEAR:
            already += 1
            continue

        sym, ccy, atype = reuse_meta(docs_pts)
        if not sym:
            no_data += 1
            print("  ! %s: sin symbol recuperable en los docs" % aid)
            continue

        early_to = "%d-12-31" % (first_year - 1)  # solo anios COMPLETOS previos
        fx_cache = {}  # fresco por activo: el rango FX coincide con su rango temprano
        try:
            rows = L.fetch_eod_points(sym, TARGET_START, early_to)
            points, fx_meta = L.convert_points_to_eur(rows, ccy, fx_cache, TARGET_START, early_to)
        except Exception as e:  # noqa: BLE001
            no_data += 1
            print("  ! %s (%s): %s" % (aid, sym, e))
            continue
        if not points:
            no_data += 1
            continue

        new_docs = L.build_year_docs(aid, atype, sym, L.group_by_year(points), ccy, fx_meta)
        new_docs = {k: v for k, v in new_docs.items() if k not in docs}  # nunca pisar
        if not new_docs:
            no_data += 1
            continue

        extensibles += 1
        if len(samples) < 15:
            samples.append((aid, sym, points[0]["date"], points[-1]["date"],
                            len(points), first, len(new_docs)))

        if WRITE:
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            (BACKUP_DIR / ("extend-%s-%s.json" % (aid.replace("/", "_"), stamp))).write_text(
                json.dumps({"asset_id": aid, "symbol": sym, "currency": ccy,
                            "added_docs": sorted(new_docs),
                            "first_added": points[0]["date"], "last_added": points[-1]["date"],
                            "earlier_than": first}, ensure_ascii=False, indent=2),
                encoding="utf-8")
            batch = db.batch()
            for doc_id, data in new_docs.items():
                batch.set(ref.collection("price_series").document(doc_id), data)
            batch.commit()
            extended += 1

        time.sleep(SLEEP)

    print("\n=== EXTENSION historico -> 15a (%s) — %s ===" % (TARGET_START, "ESCRITURA" if WRITE else "DRY-RUN"))
    print("Activos revisados: %d  (con historico: %d)" % (total, with_hist))
    print("Ya llegaban a %d o antes: %d" % (TARGET_YEAR, already))
    print("Sin datos anteriores en la fuente (no extensibles): %d" % no_data)
    if WRITE:
        print("EXTENDIDOS (escritos): %d" % extended)
        print("Backups en: %s" % BACKUP_DIR)
    else:
        print("Extensibles (se anadirian anios): %d" % extensibles)
        print("(dry-run: no se ha escrito nada; usa --write para aplicar)")
    print("\nMuestras (asset_id, symbol, rango ANADIDO, nº pts, inicio actual, +docs):")
    for s in samples:
        print("   %-16s %-16s %s -> %s  %5d pts  (actual %s)  +%d" %
              (str(s[0])[:16], str(s[1])[:16], s[2], s[3], s[4], s[5], s[6]))


if __name__ == "__main__":
    main()
