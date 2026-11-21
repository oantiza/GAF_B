"""Regresión auditoría A1 (2026-07-10): el endpoint sal trailingReturn/v3
devuelve ACUMULADOS en periodos >1 año sin flag de anualización, y su mapeo
pisaba los valores anualizados correctos del snapshot (caso real
IE00B28YJQ65: 3a "anualizada" = 22,35 % acumulado vs 6,95 % anualizado)."""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from core.schema import set_path  # noqa: E402
from fetchers import morningstar as ms  # noqa: E402
from fetchers import morningstar_lt as ms_lt  # noqa: E402

# Payload real (recortado) de cache/raw_morningstar_lt/IE00B28YJQ65/
SAL_TRAILING = {
    "columnDefs": ["1Month", "3Month", "YearToDate", "1Year", "3Year",
                   "5Year", "10Year", "15Year", "SinceInception"],
    "totalReturnNAV": ["3.12563", "1.27566", "1.15469", "21.46785",
                       "22.34529", "41.53203", "135.88672", "583.84926",
                       "647.20588"],
    "fundReturnDate": "2026-06-30",
}

SCREENER_REAL = {
    "LegalName": "Polar Capital Funds PLC - Polar Capital Healthcare Opportunities Fund Inc EUR",
    "Currency": "EUR",
    "ReturnM36": 6.11,
    "ReturnM60": 6.64,
    "ReturnM120": 9.54,
}

SNAPSHOT_REAL = {
    "TrailingPerformance": [{
        "Date": "2026-05-31T00:00:00",
        "Type": "MonthEnd",
        "ReturnType": "ItPostTax",
        "Return": [
            {"Value": 22.345293, "TimePeriod": "M36"},
            {"Value": 6.953686, "Annualized": True, "TimePeriod": "M36"},
            {"Value": 41.532033, "TimePeriod": "M60"},
            {"Value": 7.194117, "Annualized": True, "TimePeriod": "M60"},
            {"Value": 135.886722, "TimePeriod": "M120"},
            {"Value": 8.960817, "Annualized": True, "TimePeriod": "M120"},
        ],
    }],
}


def _out_con_snapshot():
    """Estado tras mapear el snapshot: anualizados correctos ya escritos."""
    out: dict = {}
    set_path(out, "rentabilidad.trailing_pct.3a_anualizada.fondo", 6.95)
    set_path(out, "rentabilidad.trailing_pct.5a_anualizada.fondo", 7.20)
    set_path(out, "rentabilidad.trailing_pct.10a_anualizada.fondo", 8.96)
    return out


def test_sal_no_pisa_anualizadas_del_snapshot():
    out = _out_con_snapshot()
    ms._mapea(out, {"trailingReturn": SAL_TRAILING})
    tp = out["rentabilidad"]["trailing_pct"]
    assert tp["3a_anualizada"]["fondo"] == 6.95
    assert tp["5a_anualizada"]["fondo"] == 7.20
    assert tp["10a_anualizada"]["fondo"] == 8.96


def test_sal_no_escribe_acumulados_como_anualizados():
    out: dict = {}
    ms._mapea(out, {"trailingReturn": SAL_TRAILING})
    tp = out.get("rentabilidad", {}).get("trailing_pct", {})
    # Antes del fix: 3a=22.35, 15a=583.85 (acumulados etiquetados anualizados)
    for clave in ("3a_anualizada", "5a_anualizada", "10a_anualizada",
                  "15a_anualizada"):
        assert clave not in tp, f"{clave} no debe mapearse desde sal-service"


def test_sal_sigue_mapeando_periodos_cortos():
    out: dict = {}
    ms._mapea(out, {"trailingReturn": SAL_TRAILING})
    tp = out["rentabilidad"]["trailing_pct"]
    assert tp["1m"]["fondo"] == 3.12563
    assert tp["3m"]["fondo"] == 1.27566
    assert tp["ytd"]["fondo"] == 1.15469
    assert tp["1a"]["fondo"] == 21.46785


def test_orden_real_conserva_anualizadas_del_snapshot_y_descarta_15a():
    out: dict = {}

    # Orden real de morningstar_lt.fetch: screener, snapshot y SAL al final.
    ms_lt._mapea_screener(out, SCREENER_REAL)
    ms_lt._mapea_snapshot(out, SNAPSHOT_REAL)
    ms._mapea(out, {"trailingReturn": SAL_TRAILING})

    tp = out["rentabilidad"]["trailing_pct"]
    assert tp["3a_anualizada"]["fondo"] == 6.953686
    assert tp["5a_anualizada"]["fondo"] == 7.194117
    assert tp["10a_anualizada"]["fondo"] == 8.960817
    assert "15a_anualizada" not in tp
