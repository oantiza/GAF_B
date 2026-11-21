#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pasada en seco del refresco de metrics/latest sobre la copia local.

Ejecuta `run_metrics_refresh.py` (por defecto `--force-windows`, la puesta al
dia de las ventanas congeladas) con el mismo tope POR CICLO que la ejecucion
programada, pero contra un cliente Firestore en memoria cargado desde el backup
verificado (`2-plataforma-datos/data/backups/<marca>/`). No abre Firestore ni
sale a la red, y cualquier intento de escritura lanza excepcion.

    python scripts/dryrun_metrics_refresh_backup.py --backup <dir_backup> --json detalle.json

El €STR no se resuelve (tasa fija del 2 %): rentabilidad, volatilidad, YTD y
drawdowns no dependen de ella; el Sharpe si, y no se informa. Tampoco se ensaya
la guarda NO_RATE (en real, si el BCE falla, el activo se deja como esta).
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import datetime as dt
import gzip
import io
import json
import os
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

EPS = 1e-6


class NoWrites(RuntimeError):
    pass


class _Snap:
    def __init__(self, id_, data, reference=None):
        self.id = id_
        self._data = data
        self.exists = data is not None
        self.reference = reference
        self.update_time = "backup"

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data is not None else None


class _ReadOnly:
    def set(self, *_a, **_k):
        raise NoWrites("escritura en una pasada en seco")

    update = create = delete = set


class _DocRef(_ReadOnly):
    def __init__(self, id_, getter):
        self.id = id_
        self._getter = getter

    def get(self):
        return _Snap(self.id, self._getter(), self)


class _SubQuery:
    def __init__(self, store, asset_id, name, order=None, max_docs=None, filters=()):
        self.store, self.asset_id, self.name = store, asset_id, name
        self.order, self.max_docs, self.filters = order, max_docs, tuple(filters)

    def _clone(self, **kw):
        base = dict(order=self.order, max_docs=self.max_docs, filters=self.filters)
        base.update(kw)
        return _SubQuery(self.store, self.asset_id, self.name, **base)

    def document(self, doc_id):
        return _DocRef(doc_id, lambda: self.store.subdocs[self.asset_id][self.name].get(doc_id))

    def order_by(self, field, direction="ASCENDING"):
        return self._clone(order=(field, direction))

    def limit(self, n):
        return self._clone(max_docs=n)

    def where(self, filter=None, **_k):
        return self._clone(filters=self.filters + (filter,))

    def stream(self):
        docs = list(self.store.subdocs[self.asset_id][self.name].items())
        for f in self.filters:
            if f.op_string != ">":
                raise AssertionError("filtro no soportado: %s" % f.op_string)
            docs = [(i, d) for i, d in docs
                    if isinstance(d.get(f.field_path), int) and d[f.field_path] > f.value]
        if self.order:
            field, direction = self.order
            docs.sort(key=lambda item: str(item[1].get(field) or ""),
                      reverse=str(direction).upper().startswith("DESC"))
        if self.max_docs is not None:
            docs = docs[:self.max_docs]
        return [_Snap(i, d) for i, d in docs]


class _AssetRef(_ReadOnly):
    def __init__(self, store, asset_id):
        self.store, self.id = store, asset_id

    def collection(self, name):
        return _SubQuery(self.store, self.id, name)

    def get(self):
        return _Snap(self.id, self.store.roots.get(self.id), self)


class _RootQuery:
    def __init__(self, store, name, after=None, max_docs=None):
        self.store, self.name, self.after, self.max_docs = store, name, after, max_docs

    def document(self, doc_id):
        if self.name == "assets":
            return _AssetRef(self.store, doc_id)
        return _DocRef(doc_id, lambda: self.store.meta.get(doc_id))

    def order_by(self, *_a, **_k):
        return self

    def select(self, *_a, **_k):
        return self

    def limit(self, n):
        return _RootQuery(self.store, self.name, self.after, n)

    def start_after(self, cursor):
        return _RootQuery(self.store, self.name, next(iter(cursor.values())), self.max_docs)

    def stream(self):
        if self.name != "assets":
            raise AssertionError("coleccion no soportada: %s" % self.name)
        ids = sorted(self.store.roots)
        if self.after:
            ids = [i for i in ids if i > self.after]
        if self.max_docs is not None:
            ids = ids[:self.max_docs]
        return [_Snap(i, self.store.roots[i], _AssetRef(self.store, i)) for i in ids]


class BackupClient:
    """Lo justo del cliente Firestore que usa metrics_refresh, en solo lectura."""

    def __init__(self, backup: Path):
        self.roots, self.meta = {}, {}
        self.subdocs = defaultdict(lambda: defaultdict(dict))
        with gzip.open(backup / "assets.ndjson.gz", "rt", encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                parts = rec["path"].split("/")
                if len(parts) == 2:
                    self.roots[parts[1]] = rec["data"]
                elif len(parts) == 4 and parts[2] in ("price_series", "metrics"):
                    self.subdocs[parts[1]][parts[2]][parts[3]] = rec["data"]
        with gzip.open(backup / "meta.ndjson.gz", "rt", encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                parts = rec["path"].split("/")
                if len(parts) == 2:
                    self.meta[parts[1]] = rec["data"]

    def collection(self, name):
        return _RootQuery(self, name)

    def batch(self):
        raise NoWrites("batch en una pasada en seco")

    def collection_group(self, _name):
        raise AssertionError("collection_group no soportado")


def _old_ytd(values, dates):
    """YTD con la base anterior al 14-10-2026 (primer punto del anio)."""
    year_values = [v for v, d in zip(values, dates) if d >= dt.date(dates[-1].year, 1, 1)] if dates else []
    if len(year_values) < 2:
        return None
    return round(year_values[-1] / year_values[0] - 1.0, 8)


def _differs(before, after):
    if before is None or after is None:
        return before != after
    return abs(before - after) > EPS


def _pct(x):
    return "—" if x is None else ("%.2f %%" % (x * 100)).replace(".", ",")


def _pair(pair):
    before, after = pair
    return "%s -> %s" % (_pct(before), _pct(after)) if _differs(before, after) else "%s (=)" % _pct(before)


def _releases_from_env_file(path: Path) -> None:
    """Misma liberacion de reparaciones de precio que el entorno desplegado."""
    if os.environ.get("BDB_VERIFIED_PRICE_REPAIR_RELEASES") or not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("BDB_VERIFIED_PRICE_REPAIR_RELEASES="):
            os.environ["BDB_VERIFIED_PRICE_REPAIR_RELEASES"] = line.split("=", 1)[1].strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", required=True, type=Path, help="carpeta del backup (assets/meta.ndjson.gz)")
    parser.add_argument("--max-reads", type=int, default=6000, help="tope POR CICLO, como el desplegado")
    parser.add_argument("--max-cycles", type=int, default=12)
    parser.add_argument("--no-force-windows", action="store_true",
                        help="simula la ejecucion programada (sin forzar el recalculo)")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.bdb-gestor-de-activos",
                        help="de aqui solo se lee BDB_VERIFIED_PRICE_REPAIR_RELEASES")
    parser.add_argument("--sample", default="ES0182769002",
                        help="ISIN separados por comas para el antes/despues")
    parser.add_argument("--json", type=Path, help="volcar el detalle por activo")
    args = parser.parse_args()

    os.environ.pop("BDB_ACTIVOS_ENABLE_MASTER_WRITES", None)
    os.environ.pop("METRICS_WRITE_ENABLED", None)
    _releases_from_env_file(args.env_file)

    import metrics_refresh
    import run_metrics_refresh
    from fund_history_quality import usable_documents
    from fund_ingest import ytd_return

    client = BackupClient(args.backup)
    series = {}
    original_recompute = metrics_refresh._recomputed_metrics

    def recompute_spy(asset_id, existing, values, dates, now_iso, **kwargs):
        series[asset_id] = (list(values), list(dates))
        return original_recompute(asset_id, existing, values, dates, now_iso, **kwargs)

    validated = {}
    original_validate = metrics_refresh.validate_contract

    def validate_spy(payload, schema):
        original_validate(payload, schema)
        if isinstance(payload, dict) and payload.get("asset_id"):
            validated[payload["asset_id"]] = copy.deepcopy(payload)

    patched = {
        "_master_db": lambda: client,
        "_risk_free_resolver": lambda: (lambda _s, _e: {"rate": 0.02, "source": "DRYRUN_FIXED"}),
        "_recomputed_metrics": recompute_spy,
        "validate_contract": validate_spy,
    }
    originals = {name: getattr(metrics_refresh, name) for name in patched}
    for name, value in patched.items():
        setattr(metrics_refresh, name, value)

    tmp = tempfile.TemporaryDirectory()
    detail_path = Path(tmp.name) / "ventanas.json"
    argv = ["run_metrics_refresh.py", "--max-reads", str(args.max_reads), "--max-cycles", str(args.max_cycles),
            "--detail-out", str(detail_path)]
    if not args.no_force_windows:
        argv.append("--force-windows")
    saved_argv, sys.argv = sys.argv, argv
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            exit_code = run_metrics_refresh.main()
    finally:
        sys.argv = saved_argv
        for name, value in originals.items():
            setattr(metrics_refresh, name, value)
    lines = [json.loads(line) for line in out.getvalue().splitlines() if line.startswith("{")]
    cycles = [line for line in lines if "cycle" in line]
    summary = lines[-1]["summary"]
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    tmp.cleanup()

    reasons = Counter()
    rows = []
    for row in detail:
        values, dates = series[row["asset_id"]]
        tags = [label for label, node in row["windows"].items()
                if _differs(*node["return"]) or node["method"][0] != node["method"][1]]
        tags = ["ventanas"] if tags else []
        if _differs(*row["ytd_return"]):
            tags.append("ytd")
        if _differs(*row["max_drawdown_5y"]):
            tags.append("mdd5y")
        if row["source_before"] != row["source_after"]:
            tags.append("firma")
        reasons.update(tags or ["sin_cambio_material"])
        old = _old_ytd(values, dates)
        rows.append({**row, "tags": tags, "ytd_old_base_same_series": old,
                     "ytd_base_effect": _differs(old, row["ytd_return"][1])})

    provider = []
    for aid in sorted(client.roots):
        latest = client.subdocs[aid]["metrics"].get("latest") or {}
        if latest.get("source") != "FONDOSDB_ROOT_ES" or not metrics_refresh._is_active_canonical_asset(
                aid, client.roots[aid]):
            continue
        points = []
        for doc in client.subdocs[aid]["price_series"].values():
            reviewed = usable_documents(doc.get("asset_id"), [doc])
            points.extend((reviewed[0].get("points") if reviewed else []) or [])
        after = validated.get(aid)
        provider.append({
            "asset_id": aid, "has_series": bool(points), "would_write": after is not None,
            "last_date": [latest.get("last_date"), (after or latest).get("last_date")],
            "max_drawdown_hist": [(latest.get("max_drawdown_hist") or {}).get("value"),
                                  ((after or latest).get("max_drawdown_hist") or {}).get("value")],
            "windows_untouched": after is None or after.get("windows") == latest.get("windows"),
            "ytd_provider": latest.get("ytd_return"), "ytd_own_series": ytd_return(points),
        })

    print("PASADA EN SECO - refresco de metrics/latest (%s)" % ("--force-windows" if not args.no_force_windows
                                                             else "ejecucion programada"))
    print("copia: %s" % args.backup)
    print("tope por ciclo: %d lecturas" % args.max_reads)
    print()
    print("ciclo  lecturas  raices  recalculos  solo_drawdown  sin_avance  errores  tope  cursor_salida")
    for c in cycles:
        print("%5s  %8d  %6d  %10d  %13d  %10d  %7d  %4s  %s" % (
            c["cycle"], c["read_budget_used"], c["scanned_assets"], c["windows_recomputed"],
            c["would_write"] - c["windows_recomputed"], c["skipped_not_newer"], c["errors"],
            "si" if c["stopped_by_budget"] else "no", c["next_scan_after_asset_id"] or "(ciclo completo)"))
    print("total: %d lecturas en %d ciclos; ciclo completo: %s; escribiria %d documentos" % (
        summary["reads_total"], summary["runs"], summary["cycle_completed"], summary["would_write"]))
    errors = [e for c in cycles for e in c.get("error_sample") or []]
    if errors:
        print("errores:", "; ".join("%s %s" % (e["asset_id"], e["error"]) for e in errors))
    print("excluidos (METRICS_REFRESH_EXCLUDED): %s" % (", ".join(summary["excluded_assets"]) or "ninguno"))
    if summary["windows_skipped"]:
        print("no recalculados:", Counter(item["reason"] for item in summary["windows_skipped"]))
    print()
    print("Calculo propio recalculado: %d" % len(rows))
    for tag in ("ventanas", "ytd", "mdd5y", "firma", "sin_cambio_material"):
        print("  %-20s %5d" % (tag, reasons.get(tag, 0)))
    print("  YTD movido por la base nueva (misma serie): %d" % sum(1 for r in rows if r["ytd_base_effect"]))
    for r in rows:
        if "firma" in r["tags"]:
            print("  firma: %s %s -> %s" % (r["asset_id"], r["source_before"], r["source_after"]))
    print()
    with_series = [p for p in provider if p["has_series"]]
    print("Proveedor (FONDOSDB_ROOT_ES): %d activos, %d con serie; %d solo drawdown/last_date; ventanas intactas: %s"
          % (len(provider), len(with_series), sum(1 for p in provider if p["would_write"]),
             all(p["windows_untouched"] for p in provider)))
    print()
    by_id = {r["asset_id"]: r for r in rows}
    for aid in [a.strip() for a in args.sample.split(",") if a.strip()]:
        r = by_id.get(aid)
        if r is None:
            print("%s: no se recalcula" % aid)
            continue
        print("%s  last_date %s  firma %s" % (aid, r["last_date"], r["source_after"]))
        for label, node in r["windows"].items():
            print("  %-4s %s" % (label, _pair(node["return"])))
        print("  ytd  %s  (base anterior: %s)" % (_pair(r["ytd_return"]), _pct(r["ytd_old_base_same_series"])))
        print("  mdd5 %s" % _pair(r["max_drawdown_5y"]))

    if args.json:
        args.json.write_text(json.dumps({"summary": summary, "cycles": cycles, "reasons": reasons,
                                         "rows": rows, "provider": provider},
                                        ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
