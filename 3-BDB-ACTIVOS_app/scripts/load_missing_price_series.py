#!/usr/bin/env python3
"""Load missing Firestore price_series docs from EODHD, normalized to EUR.

Defaults to dry-run. Use --write to update Firestore.

14-10-2026 (ALTA-06): con --write exige el gate de la maestra antes de escribir
(BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES), como el resto de
escritores. La divisa ORIGEN es la del listado segun el proveedor
(`fx_currency.resolve_listing_currency`, la regla unica de price_refresh), no
`asset.currency` ni la del buscador: un ETF de Xetra con ficha en USD cotiza en EUR.
Sin divisa del listado el activo no se escribe; nunca se asume EUR.

14-10-2026 (ALTA-01): tras escribir la serie, si el activo no tiene metrics/latest se
crea (create-only) con `history_backfill.ensure_metrics_latest`, el mismo calculo que
la ingesta; sin el, metrics_refresh se saltaba el activo para siempre. La vista
previa dice si se crearia (`metrics_latest.status`). Exige METRICS_WRITE_ENABLED y no
se crea en fondos cuyas metricas son del puente del proveedor (FONDOSDB_ROOT_ES).
"""

from __future__ import annotations

import argparse
import bisect
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import firestore

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT / "functions_python") not in sys.path:
    sys.path.insert(0, str(APP_ROOT / "functions_python"))

import fx_currency  # noqa: E402
from history_backfill import ensure_metrics_latest  # noqa: E402
from master_project import master_project_id  # noqa: E402
from write_governance import log_master_write_decision, require_master_writes_enabled  # noqa: E402

OPERATION = "load_missing_price_series"


PRICE_SERIES_SCHEMA = "asset-price-series.v1.2"
EODHD_BASE_URL = "https://eodhistoricaldata.com/api"
TODAY = date.today().isoformat()


@dataclass
class ResolvedSymbol:
    symbol: str
    currency: str
    source: str
    raw_search: dict[str, Any] | None = None


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _load_environment() -> None:
    root = Path(__file__).resolve().parents[1]
    _load_env_file(root / "functions_python" / ".env")
    _load_env_file(root / ".env.local")


def _db() -> firestore.Client:
    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"projectId": master_project_id()})
    return firestore.client()


def _api_key() -> str:
    key = os.environ.get("EODHD_API_KEY")
    if not key:
        raise RuntimeError("EODHD_API_KEY is not configured.")
    return key


def _eodhd_get(path: str, **params: str) -> Any:
    params["api_token"] = _api_key()
    params["fmt"] = "json"
    url = f"{EODHD_BASE_URL}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"EODHD HTTP {exc.code} for {path}: {body[:300]}") from exc
    parsed = json.loads(data)
    if isinstance(parsed, dict) and ("Error Message" in parsed or "message" in parsed):
        raise RuntimeError(f"EODHD error for {path}: {parsed}")
    return parsed


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _asset_currency(asset: dict[str, Any]) -> str:
    currency = asset.get("currency")
    if isinstance(currency, dict):
        return str(currency.get("base_currency") or currency.get("currency") or "").upper()
    return str(currency or asset.get("base_currency") or "").upper()


def _asset_isin(asset: dict[str, Any]) -> str:
    identifiers = asset.get("identifiers") or {}
    return str(identifiers.get("isin") or asset.get("isin") or "").upper()


def _asset_eodhd_code(asset_id: str, asset: dict[str, Any]) -> str:
    identifiers = asset.get("identifiers") or {}
    direct = identifiers.get("eodhd_code") or identifiers.get("eodhd") or asset.get("eodhd_code")
    if direct:
        return str(direct).upper()
    if asset_id.startswith("EODHD_"):
        return asset_id.replace("EODHD_", "", 1).upper()
    ticker = identifiers.get("ticker") or asset.get("ticker") or identifiers.get("symbol") or asset.get("symbol")
    if ticker:
        ticker = str(ticker).upper()
        if "." in ticker:
            return ticker
        if _asset_currency(asset) == "USD" or asset_id.lower().startswith("eodhd_"):
            return f"{ticker}.US"
    return ""


_LISTING_CURRENCY: dict[str, tuple[str | None, str | None]] = {}


def _eodhd_json_para_divisas(path: str, params: dict[str, Any] | None) -> Any:
    """Lector que inyecta fx_currency: mismo proveedor, rutas escapadas."""
    return _eodhd_get(urllib.parse.quote(path, safe="/"), **(params or {}))


def listing_currency(symbol: str) -> tuple[str | None, str | None]:
    """(divisa, motivo) del LISTADO segun el proveedor; misma regla que price_refresh.

    Solo se recuerdan las respuestas definitivas: un fallo del proveedor
    (PROVEEDOR_NO_DISPONIBLE) se vuelve a preguntar en el siguiente activo.
    """
    key = str(symbol or "").upper()
    if key in _LISTING_CURRENCY:
        return _LISTING_CURRENCY[key]
    divisa, motivo = fx_currency.resolve_listing_currency(symbol, _eodhd_json_para_divisas)
    if divisa or motivo != fx_currency.PROVEEDOR_NO_DISPONIBLE:
        _LISTING_CURRENCY[key] = (divisa, motivo)
    return divisa, motivo


def _search_eodhd(query: str) -> list[dict[str, Any]]:
    result = _eodhd_get(f"search/{urllib.parse.quote(query)}")
    return result if isinstance(result, list) else []


def _symbol_from_search(asset_type: str, isin: str, asset_currency: str) -> ResolvedSymbol | None:
    if not isin:
        return None
    results = _search_eodhd(isin)
    if not results:
        return None

    def score(item: dict[str, Any]) -> tuple[int, int, int, int]:
        code = str(item.get("Code") or "")
        exchange = str(item.get("Exchange") or "").upper()
        item_type = str(item.get("Type") or "").upper()
        item_isin = str(item.get("ISIN") or "").upper()
        currency = str(item.get("Currency") or "").upper()
        return (
            1 if item_isin == isin else 0,
            1 if item_type == asset_type.upper() else 0,
            1 if asset_type.upper() == "FUND" and exchange == "EUFUND" else 0,
            1 if asset_currency and currency == asset_currency else 0,
        )

    best = sorted(results, key=score, reverse=True)[0]
    code = str(best.get("Code") or "").upper()
    exchange = str(best.get("Exchange") or "").upper()
    currency = str(best.get("Currency") or asset_currency or "").upper()
    if not code:
        return None
    symbol = f"{code}.{exchange}" if exchange and "." not in code else code
    return ResolvedSymbol(symbol=symbol, currency=currency, source="search", raw_search=best)


def resolve_symbol(asset_id: str, asset_type: str, asset: dict[str, Any]) -> ResolvedSymbol:
    asset_currency = _asset_currency(asset)
    isin = _asset_isin(asset)
    if asset_type.upper() == "FUND" and isin:
        found = _symbol_from_search(asset_type, isin, asset_currency)
        if found:
            return found
        return ResolvedSymbol(symbol=f"{isin}.EUFUND", currency=asset_currency, source="fund-isin-fallback")

    found = _symbol_from_search(asset_type, isin, asset_currency)
    if found:
        return found

    direct = _asset_eodhd_code(asset_id, asset)
    if direct:
        return ResolvedSymbol(symbol=direct, currency=asset_currency, source="asset-field")

    raise RuntimeError(f"No EODHD symbol could be resolved for {asset_id}.")


def fetch_eod_points(symbol: str, from_date: str, to_date: str) -> list[dict[str, Any]]:
    result = _eodhd_get(f"eod/{urllib.parse.quote(symbol)}", **{"from": from_date, "to": to_date})
    if not isinstance(result, list):
        raise RuntimeError(f"Unexpected EODHD response for {symbol}: {type(result).__name__}")
    return sorted((row for row in result if isinstance(row, dict) and row.get("date")), key=lambda row: row["date"])


def _point_value(row: dict[str, Any]) -> float | None:
    raw = row.get("adjusted_close", row.get("close"))
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _round_price(value: float) -> float:
    return round(value, 6)


def _normalise_currency(currency: str) -> str:
    return (currency or "EUR").upper()


def _fx_pair(currency: str) -> str:
    return f"EUR{currency}.FOREX"


# Divisas "menores" cotizadas en subunidades: {menor: (mayor, factor)}. EODHD cotiza
# .LSE en peniques (GBX) y .TA en agorot (ILA); su par EUR<menor>.FOREX no existe, asi
# que hay que convertir a la divisa mayor (GBP/ILS, x0.01) y usar EURGBP/EURILS.
_MINOR_CURRENCY = {
    "GBX": ("GBP", 0.01),
    "GBP_PENCE": ("GBP", 0.01),
    "ILA": ("ILS", 0.01),
    "ZAC": ("ZAR", 0.01),
}


def _major_currency(currency: str) -> tuple[str, float]:
    return _MINOR_CURRENCY.get((currency or "").upper(), ((currency or "EUR").upper(), 1.0))


def fetch_fx_rates(currency: str, from_date: str, to_date: str) -> tuple[str, list[str], list[float]]:
    pair = _fx_pair(currency)
    rows = fetch_eod_points(pair, from_date, to_date)
    dates: list[str] = []
    rates: list[float] = []
    for row in rows:
        value = _point_value(row)
        if value is None:
            continue
        dates.append(str(row["date"]))
        rates.append(value)
    if not rates:
        raise RuntimeError(f"No FX rates returned for {pair}.")
    return pair, dates, rates


def _fx_rate_for_date(day: str, fx_dates: list[str], fx_rates: list[float]) -> float:
    index = bisect.bisect_right(fx_dates, day) - 1
    if index < 0:
        raise RuntimeError(f"No previous FX rate available for {day}.")
    return fx_rates[index]


def convert_points_to_eur(
    rows: list[dict[str, Any]],
    source_currency: str,
    fx_cache: dict[str, tuple[str, list[str], list[float]]],
    from_date: str,
    to_date: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    currency = _normalise_currency(source_currency)
    fx_meta: dict[str, Any] = {"source_currency": currency}
    if currency == "EUR":
        converted: list[dict[str, Any]] = []
        for row in rows:
            value = _point_value(row)
            if value is None:
                continue
            point = {"date": str(row["date"]), "value": _round_price(value)}
            for key in ("open", "high", "low", "close", "adjusted_close", "volume"):
                if row.get(key) is not None:
                    point[key] = row[key]
            converted.append(point)
        return converted, fx_meta

    major, scale = _major_currency(currency)
    if major not in fx_cache:
        fx_cache[major] = fetch_fx_rates(major, from_date, to_date)
    pair, fx_dates, fx_rates = fx_cache[major]
    converted = []
    for row in rows:
        native_value = _point_value(row)
        if native_value is None:
            continue
        rate = _fx_rate_for_date(str(row["date"]), fx_dates, fx_rates)
        eur_value = (native_value * scale) / rate
        point = {
            "date": str(row["date"]),
            "value": _round_price(eur_value),
            "source_currency": currency,
            "source_value": _round_price(native_value),
            "fx_pair": pair,
            "fx_rate": _round_price(rate),
        }
        for key in ("open", "high", "low", "close", "adjusted_close"):
            if row.get(key) is None:
                continue
            try:
                point[key] = _round_price((float(row[key]) * scale) / rate)
                point[f"source_{key}"] = row[key]
            except (TypeError, ValueError):
                pass
        if row.get("volume") is not None:
            point["volume"] = row["volume"]
        converted.append(point)
    fx_meta.update({"fx_pair": pair, "minor_scale": scale,
                    "fx_policy": "price_EUR = (price_source * scale) / EURMAJOR.FOREX"})
    return converted, fx_meta


def group_by_year(points: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        grouped[int(str(point["date"])[:4])].append(point)
    return dict(sorted(grouped.items()))


def _doc_id(symbol: str, year: int) -> str:
    safe_symbol = symbol.replace(":", "_")
    return f"EODHD_{safe_symbol}_YEAR_{year}"


def _series_type(asset_type: str) -> str:
    return "NAV" if asset_type.upper() == "FUND" else "ADJUSTED_CLOSE"


def build_year_docs(
    asset_id: str,
    asset_type: str,
    symbol: str,
    points_by_year: dict[int, list[dict[str, Any]]],
    source_currency: str,
    fx_meta: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    docs: dict[str, dict[str, Any]] = {}
    for year, points in points_by_year.items():
        doc_id = _doc_id(symbol, year)
        docs[doc_id] = {
            "asset_id": asset_id,
            "asset_type": asset_type,
            "currency": "EUR",
            "document_id": doc_id,
            "first_date": points[0]["date"],
            "history_quality_status": "COMPLETE",
            "interval": "1d",
            "last_date": points[-1]["date"],
            "observations_count": len(points),
            "points": points,
            "schema_version": PRICE_SERIES_SCHEMA,
            "series_type": _series_type(asset_type),
            "source": "EODHD",
            "source_currency": _normalise_currency(source_currency),
            "source_listing_id": f"EODHD:{symbol}",
            "source_price_id": f"EODHD:{symbol}",
            "updated_at": now,
            "year": year,
        }
        docs[doc_id].update(fx_meta)
    return docs


def _start_date(asset_type: str) -> str:
    # Ventana objetivo: ~15 anios de historico para TODOS los activos posibles.
    # EODHD solo devuelve lo que exista (muchos fondos empiezan mas tarde -> se carga
    # desde su inicio real). Antes: fondos 2021, resto 2015.
    return "2011-01-01"


def _existing_price_docs(asset_ref: firestore.DocumentReference) -> dict[str, dict[str, Any]]:
    return {snap.id: snap.to_dict() or {} for snap in asset_ref.collection("price_series").stream()}


def _points_count(doc: dict[str, Any]) -> int:
    points = doc.get("points")
    return len(points) if isinstance(points, list) else 0


def _empty_docs(existing_docs: dict[str, dict[str, Any]]) -> list[str]:
    return [doc_id for doc_id, doc in existing_docs.items() if _points_count(doc) == 0]


def _write_backup(records: list[dict[str, Any]], backup_dir: Path, label: str = "") -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    suffix = f"-{label}" if label else ""
    path = backup_dir / f"missing-price-series-backup-{stamp}{suffix}.json"
    path.write_text(json.dumps(_json_safe(records), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_pending_assets(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data.get("sin_historico") or [])


def process_asset(
    db: firestore.Client,
    item: dict[str, Any],
    fx_cache: dict[str, tuple[str, list[str], list[float]]],
    write: bool,
    backup_dir: Path,
) -> dict[str, Any]:
    asset_id = str(item["asset_id"])
    asset_type = str(item["type"])
    asset_ref = db.collection("assets").document(asset_id)
    asset_snap = asset_ref.get()
    if not asset_snap.exists:
        raise RuntimeError(f"Asset not found: {asset_id}.")
    asset = asset_snap.to_dict() or {}
    resolved = resolve_symbol(asset_id, asset_type, asset)
    listed, motivo = listing_currency(resolved.symbol)
    if not listed:
        raise RuntimeError(
            f"Sin divisa del listado para {asset_id} ({resolved.symbol}): {motivo}. No se asume EUR."
        )
    source_currency = _normalise_currency(listed)
    metadata_currency = (resolved.currency or _asset_currency(asset) or "").upper() or None
    start = _start_date(asset_type)
    rows = fetch_eod_points(resolved.symbol, start, TODAY)
    points, fx_meta = convert_points_to_eur(rows, source_currency, fx_cache, start, TODAY)
    if not points:
        raise RuntimeError(f"No valid EOD points for {asset_id} ({resolved.symbol}).")
    docs = build_year_docs(asset_id, asset_type, resolved.symbol, group_by_year(points), source_currency, fx_meta)
    existing_docs = _existing_price_docs(asset_ref)
    existing_non_empty = [doc_id for doc_id, doc in existing_docs.items() if _points_count(doc) > 0]
    if existing_non_empty:
        raise RuntimeError(f"{asset_id} already has non-empty price_series docs: {existing_non_empty[:3]}")

    empty_docs = _empty_docs(existing_docs)
    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    summary = {
        "asset_id": asset_id,
        "type": asset_type,
        "symbol": resolved.symbol,
        "symbol_source": resolved.source,
        "source_currency": source_currency,
        "currency_metadata": metadata_currency,
        "currency_mismatch": bool(metadata_currency and metadata_currency != source_currency),
        "points": len(points),
        "first_date": points[0]["date"],
        "last_date": points[-1]["date"],
        "year_docs": len(docs),
        "empty_docs_to_replace_or_delete": empty_docs,
        "fx_pair": fx_meta.get("fx_pair"),
        "backup": None,
        "metrics_latest": None,
    }

    if not write:
        summary["metrics_latest"] = ensure_metrics_latest(asset_ref, asset_id, asset_type, points, now_iso, False, root=asset)
        return summary

    asset_backup_records: list[dict[str, Any]] = []
    for doc_id in sorted(set(empty_docs) | set(docs)):
        if doc_id in existing_docs:
            asset_backup_records.append(
                {
                    "asset_id": asset_id,
                    "doc_id": doc_id,
                    "path": asset_ref.collection("price_series").document(doc_id).path,
                    "data": existing_docs[doc_id],
                }
            )
    if asset_backup_records:
        summary["backup"] = str(_write_backup(asset_backup_records, backup_dir, asset_id.replace("/", "_")))

    batch = db.batch()
    for doc_id in empty_docs:
        if doc_id not in docs:
            batch.delete(asset_ref.collection("price_series").document(doc_id))
    for doc_id, doc in docs.items():
        batch.set(asset_ref.collection("price_series").document(doc_id), doc)
    batch.commit()
    summary["metrics_latest"] = ensure_metrics_latest(asset_ref, asset_id, asset_type, points, now_iso, True, root=asset)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Load missing Firestore price_series from EODHD.")
    parser.add_argument("--pending-file", default="intake/historicos_pendientes.json")
    parser.add_argument("--asset-id", action="append", help="Limit to one or more asset ids.")
    parser.add_argument("--exclude-asset-id", action="append", help="Skip one or more asset ids.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of assets processed.")
    parser.add_argument("--write", action="store_true", help="Apply Firestore writes. Default is dry-run.")
    parser.add_argument("--backup-dir", default="output/price-series-repair")
    parser.add_argument("--sleep", type=float, default=0.05, help="Small delay between EODHD calls.")
    args = parser.parse_args()

    _load_environment()
    if args.write:
        # Antes de la primera lectura: sin gate no se hace nada.
        require_master_writes_enabled(OPERATION)
    else:
        log_master_write_decision(OPERATION, enabled=False, dry_run=True)
    db = _db()
    pending = load_pending_assets(Path(args.pending_file))
    if args.asset_id:
        wanted = set(args.asset_id)
        pending = [item for item in pending if item.get("asset_id") in wanted]
    if args.exclude_asset_id:
        excluded = set(args.exclude_asset_id)
        pending = [item for item in pending if item.get("asset_id") not in excluded]
    if args.limit:
        pending = pending[: args.limit]

    fx_cache: dict[str, tuple[str, list[str], list[float]]] = {}
    summaries: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    backup_dir = Path(args.backup_dir)
    for item in pending:
        try:
            summaries.append(process_asset(db, item, fx_cache, args.write, backup_dir))
        except Exception as exc:  # noqa: BLE001 - CLI should continue and report all failures.
            errors.append({"asset_id": str(item.get("asset_id")), "error": str(exc)})
        time.sleep(args.sleep)

    result = {
        "write": args.write,
        "processed": len(summaries),
        "errors": errors,
        "assets": summaries,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
