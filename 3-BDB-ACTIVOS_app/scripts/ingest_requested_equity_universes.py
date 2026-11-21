#!/usr/bin/env python3
"""Carga incremental y auditable de los universos de acciones pedidos el 21-08-2026.

Dry-run por defecto. La escritura exige los gates ordinarios de la maestra.
La identidad BME se obtiene de la API publica SIBE; los simbolos/ISIN restantes
se contrastan con los maestros de EODHD. Los roots son create-only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "functions_python"))

import admin_panel  # noqa: E402
import ingest_asset as ingest  # noqa: E402
import search_index  # noqa: E402
from contract_validation import validate_contract  # noqa: E402
from write_governance import require_master_writes_enabled  # noqa: E402

BME_URL = (
    "https://apiweb.bolsasymercados.es/Market/v1/EQ/ListedCompanies"
    "?ISIN=&sectorKey=&subsectorKey=&tradingSystem=SIBE&mtfSegment=&page=0&pageSize=0"
)

DAX40_ISINS = """
DE0007236101 DE0007164600 DE0008404005 DE000ENER6Y0 NL0000235190
DE0005557508 DE0006231004 DE0008430026 DE0005140008 DE0007030009
DE0005810055 DE0005552004 DE000BAY0017 DE000BASF111 DE000ENAG999
DE0007037129 DE0007100000 DE000A1EWWW0 DE000DTR0CK8 DE000A0D9PT0
DE0006047004 DE0005190003 DE000FRE5EN2 DE000CBK1001 DE0006599905
DE0008402215 DE0007664039 DE000A1ML7J1 DE000SHL1006 DE000SYM9999
DE0006048432 DE0006602006 DE0005785802 NL0015002SN0 DE0006070006
DE0005439004 DE000A1DAHH0 DE0005200000 DE000A12DM80 DE000ZAL1111
""".split()

CAC40_ISINS = """
FR0000120404 FR0000120073 NL0000235190 LU1598757687 FR0000120628
FR0000131104 FR0000120503 FR0006174348 FR0000125338 FR0000120172
FR0000045072 FR0000120644 FR0014003TT8 FR0000130452 FR0010208488
FR0000121667 FR0014000MR3 NL0006294274 FR0000052292 FR0000121485
FR0000120321 FR0010307819 FR0000121014 FR001400AJ45 FR0000133308
FR0000120693 FR0000130577 FR0000131906 FR0000073272 FR0000125007
FR0000120578 FR0000121972 FR0000130809 NL00150001Q9 NL0000226223
FR0000121329 FR0000120271 FR0013326246 FR0000124141 FR0000125486
""".split()

SP500_TOP20 = "NVDA AAPL MSFT AMZN GOOGL AVGO GOOG META MU JPM LLY TSLA BRK-B AMD XOM JNJ V WMT INTC MA".split()
NASDAQ100_TOP20 = "NVDA AAPL MSFT AMZN GOOGL GOOG SPCX AVGO META TSLA MU WMT AMD ASML INTC CSCO PLTR COST AMAT LRCX".split()

# BME ya publica estos ISIN, pero EODHD aun conserva el anterior o no informa ISIN.
BME_SYMBOL_OVERRIDES = {
    "ES0109260291": "AMP.MC",
    "ES0105376059": "ARM.MC",
    "ES0114400007": "CAM.MC",
    "ES0158300410": "CLEO.MC",
    "ES0126251018": "DESA.MC",
    "ES0106043005": "DIGIS.MC",
    "ES0162600003": "MDF.MC",
    "ES0105836003": "IMC.MC",
    "NL0015001OI1": "MFEA.MC",
    "ES01717430J3": "PRS.MC",
}


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=90) as response:
        return json.load(response)


def row_isin(row: dict) -> str:
    return str(row.get("Isin") or row.get("ISIN") or "").strip().upper()


def exchange_rows(code: str) -> list[dict]:
    token = os.environ.get("EODHD_API_KEY")
    if not token:
        raise RuntimeError("EODHD_API_KEY no configurada")
    return get_json(f"https://eodhd.com/api/exchange-symbol-list/{code}?api_token={token}&fmt=json")


def build_universe() -> tuple[dict[str, dict], list[dict], dict]:
    bme = get_json(BME_URL)["data"]
    exchanges = {code: exchange_rows(code) for code in ("MC", "XETRA", "PA", "US")}
    by_isin, by_code = {}, {}
    for exchange, rows in exchanges.items():
        by_isin[exchange] = {}
        by_code[exchange] = {}
        for row in rows:
            isin = row_isin(row)
            if isin:
                by_isin[exchange].setdefault(isin, []).append(row)
            by_code[exchange].setdefault(str(row.get("Code") or "").upper(), []).append(row)

    candidates: dict[str, dict] = {}
    unresolved: list[dict] = []

    def add(universe: str, isin: str, exchange: str, ticker: str = "", name: str = ""):
        # Un mismo ISIN puede pertenecer a varios universos. Conservamos el
        # primer listing preferido y solo acumulamos la pertenencia posterior.
        if isin and isin in candidates:
            if universe not in candidates[isin]["universes"]:
                candidates[isin]["universes"].append(universe)
            return
        rows = by_isin[exchange].get(isin, []) if isin else by_code[exchange].get(ticker, [])
        if ticker:
            rows = [row for row in rows if str(row.get("Code") or "").upper() == ticker]
        stocks = [row for row in rows if str(row.get("Type") or "").lower() in ingest.STOCK_TYPES]
        rows = stocks or rows
        if not rows:
            unresolved.append({"universe": universe, "isin": isin, "ticker": ticker, "exchange": exchange, "name": name})
            return
        row = rows[0]
        resolved_isin = row_isin(row)
        if not resolved_isin:
            unresolved.append({"universe": universe, "isin": isin, "ticker": ticker, "exchange": exchange, "name": name})
            return
        match = {
            "symbol": f"{row['Code']}.{exchange}", "ticker": row["Code"], "exchange": exchange,
            "currency": row.get("Currency"), "type": row.get("Type"), "type_class": "STOCK",
            "name": name or row.get("Name"),
        }
        item = candidates.setdefault(resolved_isin, {"isin": resolved_isin, "match": match, "universes": []})
        if universe not in item["universes"]:
            item["universes"].append(universe)

    for row in bme:
        isin = str(row["isin"]).upper()
        before = len(unresolved)
        add("BME_SIBE", isin, "MC", name=row.get("shareName") or row.get("name") or isin)
        if len(unresolved) > before and isin in BME_SYMBOL_OVERRIDES:
            unresolved.pop()
            symbol = BME_SYMBOL_OVERRIDES[isin]
            ticker, exchange = symbol.rsplit(".", 1)
            match = {
                "symbol": symbol, "ticker": ticker, "exchange": exchange, "currency": "EUR",
                "type": "Common Stock", "type_class": "STOCK",
                "name": row.get("shareName") or row.get("name") or isin,
            }
            candidates[isin] = {"isin": isin, "match": match, "universes": ["BME_SIBE"], "manual_symbol": True}
    for isin in DAX40_ISINS:
        add("DAX40", isin, "XETRA")
    for isin in CAC40_ISINS:
        add("CAC40", isin, "PA")
    for ticker in SP500_TOP20:
        add("SP500_TOP20", "", "US", ticker=ticker)
    for ticker in NASDAQ100_TOP20:
        add("NASDAQ100_TOP20", "", "US", ticker=ticker)

    source_counts = {
        "BME_SIBE": len(bme), "DAX40": len(DAX40_ISINS), "CAC40": len(CAC40_ISINS),
        "SP500_TOP20": len(SP500_TOP20), "NASDAQ100_TOP20": len(NASDAQ100_TOP20),
    }
    return candidates, unresolved, source_counts


def root_for(candidate: dict, with_fundamentals: bool) -> dict:
    isin, match = candidate["isin"], candidate["match"]
    fundamentals = ingest.fetch_fundamentals(isin, match) if with_fundamentals else {}
    root = ingest._omit_nulls(ingest.build_stock_root(isin, match, fundamentals))
    validate_contract(root, "asset-stock.v1.schema.json")
    return root


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--rebuild-inventory", action="store_true")
    args = parser.parse_args()
    if args.history and not args.write:
        parser.error("--history exige --write")
    if args.rebuild_inventory and not args.write:
        parser.error("--rebuild-inventory exige --write")
    if args.write:
        require_master_writes_enabled("ingest_requested_equity_universes")

    candidates, unresolved, source_counts = build_universe()
    db = ingest._master_db()
    existing = {snap.id: (snap.to_dict() or {}) for snap in db.collection("assets").stream()}
    missing = [item for isin, item in candidates.items() if isin not in existing]
    report = {
        "mode": "write" if args.write else "dry-run", "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_counts": source_counts, "unique_target_isins": len(candidates),
        "already_in_master": len(candidates) - len(missing), "missing_before": len(missing),
        "unresolved": unresolved, "created": [], "root_errors": [], "history": [],
    }

    # El dry-run valida todos los roots sin consumir fundamentales.
    for item in missing:
        try:
            root_for(item, with_fundamentals=False)
        except Exception as exc:
            report["root_errors"].append({"isin": item["isin"], "stage": "validate", "error": str(exc)[:300]})

    if args.write:
        bad = {row["isin"] for row in report["root_errors"]}
        for index, item in enumerate(missing, 1):
            isin = item["isin"]
            if isin in bad:
                continue
            try:
                root = root_for(item, with_fundamentals=True)
                db.collection("assets").document(isin).create(root)
                report["created"].append({"isin": isin, "symbol": item["match"]["symbol"], "universes": item["universes"]})
                print(f"ROOT {index}/{len(missing)} CREATE {isin} {item['match']['symbol']}", flush=True)
            except Exception as exc:
                report["root_errors"].append({"isin": isin, "stage": "create", "error": str(exc)[:300]})
                print(f"ROOT {index}/{len(missing)} ERROR {isin}: {str(exc)[:120]}", flush=True)

        # Una sola reconciliacion evita reescribir el documento completo por cada alta.
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
                "count": inventory.get("count"), "generated_at": inventory.get("generated_at"),
                "truncated": inventory.get("truncated"),
                "active_by_type": dict(Counter(row.get("type") for row in inventory.get("rows", []) if row.get("canonical_active"))),
            }

    output_dir = ROOT / "output" / "equity-universe-ingest"
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = output_dir / f"requested-universes-{report['mode']}-{stamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(report_path), "mode": report["mode"], "unique_target_isins": len(candidates),
        "missing_before": len(missing), "created": len(report["created"]),
        "root_errors": len(report["root_errors"]), "unresolved": len(unresolved),
    }, ensure_ascii=False), flush=True)
    return 1 if unresolved or report["root_errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
