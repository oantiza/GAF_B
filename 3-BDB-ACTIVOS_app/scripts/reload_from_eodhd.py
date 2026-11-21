#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RELOAD del histórico desde EODHD como fuente PRIORITARIA.

Para los activos donde EODHD aporta histórico (sobre todo FONDOS: EODHD EUFUND tiene
su NAV desde ~2011, frente al NAV de fondosdb que arranca ~2021), descarga la serie
COMPLETA desde 2011, la normaliza a EUR y REEMPLAZA el price_series existente:
    backup -> escribe los docs nuevos (por año) -> borra los docs viejos que sobran.

- FONDOS: símbolo FORZADO a {ISIN}.EUFUND (la sonda confirmó 394/395 ahí; evita el
  único match dudoso del buscador, AXBL.MU).
- Resto: símbolo vía resolve_symbol (acciones/ETF ya suelen llegar a 2011).
- Por defecto SOLO reemplaza cuando EODHD aporta histórico ANTERIOR al actual (GAIN);
  con --force reemplaza siempre que EODHD tenga datos.

SEGURO POR DEFECTO: dry-run. Usa --write para aplicar.
DESTRUCTIVO (borra los docs viejos del activo) -> backup por activo en
output/price-series-reload/ + dry-run primero. El backup guarda los docs viejos
completos para poder restaurar.

Requisitos: los mismos que load_missing_price_series.py (firebase-admin, ADC, EODHD token).

14-10-2026 (ALTA-06): con --write exige el gate de la maestra antes de escribir
(BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES). La divisa ORIGEN es
la del listado segun el proveedor (`fx_currency.resolve_listing_currency`, via
`load_missing_price_series.listing_currency`), no `asset.currency`: la ficha dice la
divisa de la clase, no la de la cotizacion. Sin divisa del listado el activo se salta.

Uso:
    SAMPLE=10 python scripts/reload_from_eodhd.py           # dry-run de 10 (prueba)
    SAMPLE=10 python scripts/reload_from_eodhd.py --write    # aplica solo a 10 (validar)
    python scripts/reload_from_eodhd.py                      # dry-run de todos
    python scripts/reload_from_eodhd.py --write             # aplica a todos los GAIN
    python scripts/reload_from_eodhd.py --write --force      # reemplaza aunque no haya GAIN
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

OPERATION = "reload_from_eodhd"

START = "2011-01-01"
WRITE = "--write" in sys.argv
FORCE = "--force" in sys.argv
SAMPLE = int(os.environ.get("SAMPLE", "0"))
ASSET_IDS = [s.strip() for s in os.environ.get("ASSET_IDS", "").split(",") if s.strip()]
# Forzar un simbolo EODHD concreto para ciertos activos (p.ej. espanolas a su cotizacion
# de Madrid .MC en EUR nativo, en vez de Londres GBP).
SYMBOL_OVERRIDES = {
    "ES0113900J37": "SAN.MC",   # Banco Santander -> Madrid (EUR)
    "ES0177542018": "IAG.MC",   # IAG -> Madrid (EUR)
}
SLEEP = float(os.environ.get("SLEEP", "0.12"))
BACKUP_DIR = Path(__file__).resolve().parents[1] / "output" / "price-series-reload"


def asset_type_of(d):
    t = (d.get("instrument_type") or d.get("asset_type")
         or (d.get("classification") or {}).get("asset_class") or "")
    return str(t).upper() or "EQUITY"


def existing_docs(ref):
    return {s.id: (s.to_dict() or {}) for s in ref.collection("price_series").stream()}


def earliest(docs):
    best = None
    for d in docs.values():
        fd = d.get("first_date")
        pts = d.get("points")
        if not fd and isinstance(pts, list) and pts:
            fd = pts[0].get("date")
        if isinstance(fd, str) and len(fd) >= 10 and (best is None or fd < best):
            best = fd[:10]
    return best


def source_currency_for(symbol):
    """(divisa, motivo) del listado; None si el proveedor no la da (no se asume EUR)."""
    divisa, motivo = L.listing_currency(symbol)
    return (L._normalise_currency(divisa) if divisa else None), motivo


def main():
    L._load_environment()
    if WRITE:
        require_master_writes_enabled(OPERATION)
    else:
        log_master_write_decision(OPERATION, enabled=False, dry_run=True)
    db = L._db()
    # Materializa la lista para no mantener abierto el cursor de Firestore mientras
    # hacemos las llamadas lentas a EODHD (si no -> DeadlineExceeded).
    assets = list(db.collection("assets").stream())
    if ASSET_IDS:
        wanted = set(ASSET_IDS)
        assets = [a for a in assets if a.id in wanted]
    elif SAMPLE:
        assets = assets[:SAMPLE]

    total = targeted = replaced = skipped = nodata = 0
    samples = []
    for snap in assets:
        total += 1
        aid = snap.id
        d = snap.to_dict() or {}
        atype = asset_type_of(d)
        ref = db.collection("assets").document(aid)

        # símbolo EODHD + divisa origen (la del LISTADO, no la de la ficha)
        try:
            if aid in SYMBOL_OVERRIDES:
                sym = SYMBOL_OVERRIDES[aid]
            elif atype == "FUND":
                isin = L._asset_isin(d) or aid
                sym = "%s.EUFUND" % isin
            else:
                r = L.resolve_symbol(aid, atype, d)
                sym = r.symbol
            ccy, motivo = source_currency_for(sym)
        except Exception as e:  # noqa: BLE001
            nodata += 1
            print("  ! %s sin símbolo: %s" % (aid, str(e)[:50]))
            time.sleep(SLEEP)
            continue
        if not ccy:
            nodata += 1
            print("  ! %s (%s) sin divisa del listado (%s): no se asume EUR" % (aid, sym, motivo))
            time.sleep(SLEEP)
            continue

        # descarga completa desde EODHD + normaliza a EUR
        try:
            rows = L.fetch_eod_points(sym, START, L.TODAY)
            fx = {}  # fresco por activo: el rango FX coincide con el del activo
            points, fx_meta = L.convert_points_to_eur(rows, ccy, fx, START, L.TODAY)
        except Exception as e:  # noqa: BLE001
            nodata += 1
            print("  ! %s (%s): %s" % (aid, sym, str(e)[:50]))
            time.sleep(SLEEP)
            continue
        if not points:
            nodata += 1
            time.sleep(SLEEP)
            continue

        old = existing_docs(ref)
        cur = earliest(old)
        new_first = points[0]["date"]
        gain = (cur is None) or (new_first < cur)
        if not gain and not FORCE and not ASSET_IDS:
            skipped += 1
            time.sleep(SLEEP)
            continue

        targeted += 1
        new_docs = L.build_year_docs(aid, atype, sym, L.group_by_year(points), ccy, fx_meta)
        to_delete = [k for k in old if k not in new_docs]

        if len(samples) < 15:
            samples.append((aid, atype, sym, new_first, points[-1]["date"],
                            len(points), cur or "-", len(new_docs), len(to_delete)))

        if WRITE:
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            (BACKUP_DIR / ("reload-%s-%s.json" % (aid.replace("/", "_"), stamp))).write_text(
                json.dumps({"asset_id": aid, "symbol": sym, "currency": ccy,
                            "prev_earliest": cur, "new_first": new_first,
                            "new_last": points[-1]["date"], "new_docs": sorted(new_docs),
                            "deleted_docs": sorted(to_delete),
                            "old_docs_backup": L._json_safe(old)},
                           ensure_ascii=False, indent=2), encoding="utf-8")
            batch = db.batch()
            for doc_id, data in new_docs.items():
                batch.set(ref.collection("price_series").document(doc_id), data)
            for doc_id in to_delete:
                batch.delete(ref.collection("price_series").document(doc_id))
            batch.commit()
            replaced += 1

        time.sleep(SLEEP)

    print("\n=== RELOAD desde EODHD — %s%s ===" % ("ESCRITURA" if WRITE else "DRY-RUN", " (FORCE)" if FORCE else ""))
    print("Activos revisados: %d" % total)
    if WRITE:
        print("REEMPLAZADOS (escritos): %d" % replaced)
        print("Backups en: %s" % BACKUP_DIR)
    else:
        print("Se reemplazarían (GAIN%s): %d" % ("/FORCE" if FORCE else "", targeted))
        print("(dry-run: no se ha escrito nada; usa --write para aplicar)")
    print("Saltados (EODHD no aporta histórico): %d" % skipped)
    print("Sin símbolo / sin datos en EODHD: %d" % nodata)
    print("\nMuestras (asset, tipo, symbol, rango nuevo, nº pts, inicio previo, +docs, -docs):")
    for s in samples:
        print("   %-15s %-5s %-24s %s->%s %5dp  prev %s  +%d -%d" %
              (str(s[0])[:15], s[1], str(s[2])[:24], s[3], s[4], s[5], s[6], s[7], s[8]))


if __name__ == "__main__":
    main()
