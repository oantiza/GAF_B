#!/usr/bin/env python3
"""Carga incremental del Dow Jones y las 100 mayores posiciones del MSCI World.

Las composiciones se descargan de DIA (State Street) y URTH (iShares). El
programa es dry-run por defecto; las escrituras son create-only y requieren
los gates ordinarios de la base maestra.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import tempfile
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "functions_python"))
sys.path.insert(0, str(ROOT / "scripts"))

import admin_panel  # noqa: E402
import ingest_asset as ingest  # noqa: E402
import ingest_requested_equity_universes as previous  # noqa: E402
import search_index  # noqa: E402
from write_governance import require_master_writes_enabled  # noqa: E402

DIA_URL = "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-dia.xlsx"
URTH_URL = "https://www.ishares.com/us/products/239696/ishares-msci-world-etf/latest-holdings.csv"

EXCHANGE_MAP = {
    "NASDAQ": "US",
    "NYSE": "US",
    "Euronext Amsterdam": "AS",
    "London Stock Exchange": "LSE",
    "SIX Swiss Exchange": "SW",
    "Toronto Stock Exchange": "TO",
    "Xetra": "XETRA",
    "Tokyo Stock Exchange": "TSE",
    "Asx - All Markets": "AU",
    "Bolsa De Madrid": "MC",
    "Nyse Euronext - Euronext Paris": "PA",
}

# Diferencias de simbologia entre los ficheros de los fondos y EODHD.
TICKER_ALIASES = {
    ("US", "BRKB"): "BRK-B",
    ("LSE", "RR."): "RR",
}

# EODHD no publica actualmente el maestro de Tokio con esta suscripcion, pero
# su buscador por ISIN ofrece listings equivalentes con historico disponible.
MANUAL_ISINS = {
    ("TSE", "8306"): "JP3902900004",  # Mitsubishi UFJ Financial Group
    ("TSE", "7203"): "JP3633400001",  # Toyota Motor
    ("TSE", "6857"): "JP3122400009",  # Advantest
}


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def dia_holdings() -> tuple[list[dict], str]:
    payload = download(DIA_URL)
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as handle:
        handle.write(payload)
        path = handle.name
    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
        sheet = workbook.active
        as_of = str(sheet.cell(3, 2).value or "").replace("As of ", "")
        rows = []
        for name, ticker, *_ in sheet.iter_rows(min_row=6, values_only=True):
            ticker = str(ticker or "").strip().upper()
            if not ticker or ticker == "-":
                continue
            rows.append({"ticker": ticker, "name": str(name or ticker), "exchange": "US"})
        if len(rows) != 30:
            raise RuntimeError(f"DIA: se esperaban 30 acciones y llegaron {len(rows)}")
        workbook.close()
        return rows, as_of
    finally:
        Path(path).unlink(missing_ok=True)


def urth_top100() -> tuple[list[dict], str]:
    text = download(URTH_URL).decode("utf-8-sig")
    lines = text.splitlines()
    as_of = next((line.split(",", 1)[1].strip('"') for line in lines if line.startswith("Fund Holdings as of,")), "")
    header = next(index for index, line in enumerate(lines) if line.startswith("Ticker,Name,Sector,Asset Class,"))
    rows = []
    for row in csv.DictReader(io.StringIO("\n".join(lines[header:]))):
        if row.get("Asset Class") != "Equity":
            continue
        exchange_name = str(row.get("Exchange") or "").strip()
        exchange = EXCHANGE_MAP.get(exchange_name)
        item = {
            "ticker": str(row.get("Ticker") or "").strip().upper(),
            "name": str(row.get("Name") or "").strip(),
            "exchange": exchange,
            "exchange_name": exchange_name,
            "weight": float(str(row.get("Weight (%)") or "0").replace(",", "")),
        }
        rows.append(item)
        if len(rows) == 100:
            break
    if len(rows) != 100:
        raise RuntimeError(f"URTH: se esperaban 100 acciones y llegaron {len(rows)}")
    return rows, as_of


def exchange_rows(code: str) -> list[dict]:
    return previous.exchange_rows(code)


def normalized_ticker(value: str) -> str:
    return value.upper().replace(" ", "").replace(".", "").replace("-", "")


def build_universe() -> tuple[dict[str, dict], list[dict], dict]:
    dow, dow_as_of = dia_holdings()
    world, world_as_of = urth_top100()
    exchanges = sorted({row["exchange"] for row in dow + world if row.get("exchange") and row["exchange"] != "TSE"})
    masters = {code: exchange_rows(code) for code in exchanges}
    candidates: dict[str, dict] = {}
    unresolved: list[dict] = []

    def add(universe: str, source: dict):
        exchange = source.get("exchange")
        ticker = source["ticker"]
        if not exchange:
            unresolved.append({"universe": universe, **source, "reason": "exchange_not_mapped"})
            return
        manual_isin = MANUAL_ISINS.get((exchange, ticker))
        if manual_isin:
            match = ingest.resolve_symbol(manual_isin)
            if not match or match.get("type_class") != "STOCK":
                unresolved.append({"universe": universe, **source, "isin": manual_isin, "reason": "isin_not_resolved"})
                return
            match["name"] = source.get("name") or match.get("name")
            item = candidates.setdefault(manual_isin, {"isin": manual_isin, "match": match, "universes": [], "sources": []})
            if universe not in item["universes"]:
                item["universes"].append(universe)
            item["sources"].append(source)
            return
        expected = TICKER_ALIASES.get((exchange, ticker), ticker)
        exact = [row for row in masters[exchange] if str(row.get("Code") or "").upper() == expected]
        if not exact:
            norm = normalized_ticker(expected)
            exact = [row for row in masters[exchange] if normalized_ticker(str(row.get("Code") or "")) == norm]
        stocks = [row for row in exact if str(row.get("Type") or "").lower() in ingest.STOCK_TYPES]
        rows = stocks or exact
        if not rows:
            unresolved.append({"universe": universe, **source, "expected_ticker": expected, "reason": "ticker_not_found"})
            return
        row = rows[0]
        isin = previous.row_isin(row)
        if not isin:
            unresolved.append({"universe": universe, **source, "expected_ticker": expected, "reason": "isin_missing"})
            return
        match = {
            "symbol": f"{row['Code']}.{exchange}",
            "ticker": row["Code"],
            "exchange": exchange,
            "currency": row.get("Currency"),
            "type": row.get("Type"),
            "type_class": "STOCK",
            "name": source.get("name") or row.get("Name"),
        }
        item = candidates.setdefault(isin, {"isin": isin, "match": match, "universes": [], "sources": []})
        if universe not in item["universes"]:
            item["universes"].append(universe)
        item["sources"].append(source)

    for row in dow:
        add("DOW_JONES_30", row)
    for row in world:
        add("MSCI_WORLD_TOP100", row)

    source = {
        "DOW_JONES_30": {"count": len(dow), "as_of": dow_as_of, "url": DIA_URL},
        "MSCI_WORLD_TOP100": {"count": len(world), "as_of": world_as_of, "url": URTH_URL, "definition": "primeras 100 posiciones Equity por peso de URTH"},
        "exchange_codes": exchanges,
    }
    return candidates, unresolved, source


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--rebuild-inventory", action="store_true")
    args = parser.parse_args()
    if (args.history or args.rebuild_inventory) and not args.write:
        parser.error("--history y --rebuild-inventory exigen --write")
    if args.write:
        require_master_writes_enabled("ingest_dow_msci_world_top100")

    candidates, unresolved, source = build_universe()
    db = ingest._master_db()
    existing = {snap.id: (snap.to_dict() or {}) for snap in db.collection("assets").stream()}
    missing = [item for isin, item in candidates.items() if isin not in existing]
    report = {
        "mode": "write" if args.write else "dry-run",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "unique_target_isins": len(candidates),
        "already_in_master": len(candidates) - len(missing),
        "missing_before": len(missing),
        "unresolved": unresolved,
        "created": [],
        "root_errors": [],
        "history": [],
    }
    for item in missing:
        try:
            previous.root_for(item, with_fundamentals=False)
        except Exception as exc:
            report["root_errors"].append({"isin": item["isin"], "stage": "validate", "error": str(exc)[:300]})

    if args.write:
        bad = {row["isin"] for row in report["root_errors"]}
        for index, item in enumerate(missing, 1):
            isin = item["isin"]
            if isin in bad:
                continue
            try:
                root = previous.root_for(item, with_fundamentals=True)
                db.collection("assets").document(isin).create(root)
                report["created"].append({"isin": isin, "symbol": item["match"]["symbol"], "universes": item["universes"]})
                print(f"ROOT {index}/{len(missing)} CREATE {isin} {item['match']['symbol']}", flush=True)
            except Exception as exc:
                report["root_errors"].append({"isin": isin, "stage": "create", "error": str(exc)[:300]})
                print(f"ROOT {index}/{len(missing)} ERROR {isin}: {str(exc)[:120]}", flush=True)

        try:
            report["search_index"] = search_index.reconcile_search_index(write=True, db=db)
        except Exception as exc:
            report["search_index"] = {"error": str(exc)[:300]}

        if args.history:
            created_ids = {row["isin"] for row in report["created"]}
            for index, item in enumerate(candidates.values(), 1):
                isin = item["isin"]
                ref = db.collection("assets").document(isin)
                has_history = next(iter(ref.collection("price_series").limit(1).stream()), None) is not None
                if isin not in created_ids and has_history:
                    continue
                try:
                    result = ingest._load_full_history(db, isin, item["match"], write=True)
                except Exception as exc:
                    result = {"loaded": False, "error": str(exc)[:300]}
                report["history"].append({"isin": isin, "symbol": item["match"]["symbol"], **result})
                print(f"HISTORY {index}/{len(candidates)} {isin} loaded={result.get('loaded')} points={result.get('points', 0)}", flush=True)

        if args.rebuild_inventory:
            inventory = admin_panel.build_admin_inventory(db=db)
            db.collection("meta").document(admin_panel.ADMIN_INVENTORY_DOC).set(inventory)
            report["inventory"] = {
                "count": inventory.get("count"),
                "generated_at": inventory.get("generated_at"),
                "truncated": inventory.get("truncated"),
                "active_by_type": dict(Counter(row.get("type") for row in inventory.get("rows", []) if row.get("canonical_active"))),
            }

    output_dir = ROOT / "output" / "equity-universe-ingest"
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = output_dir / f"dow-msci-world-top100-{report['mode']}-{stamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "mode": report["mode"],
        "unique_target_isins": len(candidates),
        "missing_before": len(missing),
        "created": len(report["created"]),
        "root_errors": len(report["root_errors"]),
        "unresolved": len(unresolved),
    }, ensure_ascii=False), flush=True)
    return 1 if unresolved or report["root_errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
