# -*- coding: utf-8 -*-
"""Retención de acciones: lo que el respaldo de Yahoo deja de traer (17-10-2026).

Con la forma de las fichas de julio de AENA y TSK, que no tienen
`meta.procedencia` y traen `fundamentales.source`, `fetched_at` y `quality` de
la integración de julio. La fecha de referencia es la del 17-10.
"""
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import adaptador_bdb  # noqa: E402
from core.adquisicion import retencion  # noqa: E402

TSK = "ES0105394003"
HOY = dt.date(2026, 10, 17)


def _accion(fundamentales: dict | None = None, proc: dict | None = None, **ident) -> dict:
    d = {"identificacion": {"tipo": "accion", "nombre": "TSK", **ident},
         "meta": {"actualizado": "2026-07-18T16:47:34+00:00", "procedencia": dict(proc or {}),
                  "fuentes": {"fundamentales": ["eodhd"], "identificacion": ["eodhd"]}}}
    if fundamentales is not None:
        d["fundamentales"] = fundamentales
    return d


FUND_JULIO = {"market_cap": 694598848.0, "per": 14.87, "roe_pct": 58.078, "source": "yahoo",
              "fuente": "yahoo", "fetched_at": "2026-07-18T16:47:34+00:00",
              "quality": {"coverage_status": "PARTIAL", "warnings": ["fallback_source:yahoo"]}}


def test_sin_fundamentales_nuevos_se_conserva_el_bloque_entero_con_su_fecha():
    anterior = _accion(dict(FUND_JULIO), sector="Industrials")
    final = _accion(None)
    resumen = retencion.aplica(final, anterior, HOY)

    assert final["fundamentales"] == FUND_JULIO
    assert final["identificacion"]["sector"] == "Industrials"
    proc = final["meta"]["procedencia"]
    # Las fichas de julio no tienen procedencia: la fuente es la única del bloque.
    assert proc["fundamentales.roe_pct"] == "retenido:eodhd@2026-07-18"
    assert proc["fundamentales.quality.warnings"] == "retenido:eodhd@2026-07-18"
    assert proc["identificacion.sector"] == "retenido:eodhd@2026-07-18"
    assert {x["ruta"] for x in resumen["retenidos"]} >= {"fundamentales.source", "fundamentales.fetched_at",
                                                          "fundamentales.quality.coverage_status"}
    assert all(x["dias"] == 91 for x in resumen["retenidos"])
    assert retencion.avisos(final) == ["dato_retenido"]


def test_con_fundamentales_nuevos_solo_se_conservan_los_valores_que_faltan():
    anterior = _accion(dict(FUND_JULIO))
    nuevos = {"market_cap": 7.1e8, "per": 15.2, "source": "yahoo", "fuente": "yahoo",
              "fetched_at": "2026-10-17T06:00:00+00:00",
              "quality": {"coverage_status": "PARTIAL", "warnings": ["fallback_source:yahoo"]}}
    final = _accion(json.loads(json.dumps(nuevos)),
                    proc={f"fundamentales.{k}": "eodhd" for k in ("market_cap", "per", "fetched_at")})
    resumen = retencion.aplica(final, anterior, HOY)

    assert final["fundamentales"] == {**nuevos, "roe_pct": 58.078}   # TSK: Yahoo ya no da el ROE
    assert [x["ruta"] for x in resumen["retenidos"]] == ["fundamentales.roe_pct"]
    assert final["meta"]["procedencia"]["fundamentales.fetched_at"] == "eodhd"


def test_los_fundamentales_de_mas_de_120_dias_no_se_conservan():
    viejos = {**FUND_JULIO, "fetched_at": "2026-06-01T00:00:00+00:00"}
    final = _accion(None)
    resumen = retencion.aplica(final, _accion(viejos), HOY)
    assert "fundamentales" not in final
    assert {x["motivo"] for x in resumen["descartados"]} == {"antiguedad_138d_supera_120d"}


def test_lo_ya_retenido_cuenta_desde_que_la_fuente_lo_sirvio():
    proc = {"fundamentales.roe_pct": "retenido:eodhd@2026-07-18"}
    anterior = _accion({"roe_pct": 58.078, "fetched_at": "2026-10-10T00:00:00+00:00"}, proc=proc)
    final = _accion({"market_cap": 1.0})
    retencion.aplica(final, anterior, dt.date(2026, 11, 20))
    assert "roe_pct" not in final["fundamentales"]      # 125 días desde julio, no 41 desde la última pasada
    final = _accion({"market_cap": 1.0})
    retencion.aplica(final, anterior, HOY)
    assert final["meta"]["procedencia"]["fundamentales.roe_pct"] == "retenido:eodhd@2026-07-18"


def test_lo_corregido_a_mano_no_se_retiene():
    anterior = _accion({"per": 14.87, "fetched_at": "2026-10-01"}, proc={"fundamentales.per": "manual:oscar"})
    final = _accion(None)
    assert retencion.aplica(final, anterior, HOY).get("retenidos", []) == [
        {"ruta": "fundamentales.fetched_at", "fecha": "2026-10-01", "dias": 16, "fuente": ["eodhd"]}]
    assert "per" not in final["fundamentales"]


def test_una_accion_sin_nada_que_retener_no_deja_resumen():
    final = _accion(dict(FUND_JULIO))
    assert retencion.aplica(final, _accion(dict(FUND_JULIO)), HOY) == {}
    assert "retencion" not in final["meta"]


def test_el_canonico_de_la_accion_avisa_de_lo_retenido():
    d = _accion(dict(FUND_JULIO))
    d["meta"]["isin"] = TSK
    d["meta"]["retencion"] = {"retenidos": [{"ruta": "fundamentales.roe_pct"}]}
    canonico = adaptador_bdb.convierte_accion(d)
    assert "dato_retenido" in canonico["validation"]["warnings"]


# Las otras 71 acciones traen de julio el resumen anidado de EODHD.
RESUMEN_EODHD_JULIO = {
    "schema_version": "bdb.fundamentals-summary.v1", "source": "eodhd", "fuente": "eodhd",
    "endpoint_version": "v1.1", "symbol": "DBK.XETRA", "as_of_date": "2026-03-31",
    "source_updated_at": "2026-07-17", "fetched_at": "2026-07-18T16:47:11+00:00", "currency": "EUR",
    "raw_payload_sha256": "36573c6a",
    "profile": {"sector": "Financial Services", "gics_sector": "Financials", "country": "DE"},
    "valuation": {"market_cap": 58992398336.0, "pe_trailing": 9.7579},
    "analyst": {"eps_next_year": 3.8827},
    "quality": {"coverage_status": "COMPLETE", "coverage_ratio": 1.0},
    "market_cap": 58992398336.0, "per": 9.7579,
}


def test_con_el_resumen_nuevo_de_yahoo_se_retiene_lo_que_yahoo_no_da_pero_no_lo_que_describe_a_eodhd():
    anterior = _accion(json.loads(json.dumps(RESUMEN_EODHD_JULIO)))
    nuevo = {"schema_version": "bdb.fundamentals-summary.v1", "source": "yahoo", "fuente": "yahoo",
             "symbol": "DBK.DE", "as_of_date": "2026-06-30", "fetched_at": "2026-10-17T06:00:00+00:00",
             "currency": "EUR", "profile": {"sector": "Financial Services"},
             "valuation": {"market_cap": 5.5e10, "pe_trailing": 8.91},
             "quality": {"coverage_status": "PARTIAL", "coverage_ratio": 0.97,
                         "warnings": ["unofficial_source:yahoo"]},
             "market_cap": 5.5e10, "per": 8.91}
    final = _accion(json.loads(json.dumps(nuevo)))
    resumen = retencion.aplica(final, anterior, HOY)
    retenidas = sorted(x["ruta"] for x in resumen["retenidos"])
    assert retenidas == ["fundamentales.analyst.eps_next_year", "fundamentales.profile.country",
                         "fundamentales.profile.gics_sector"]
    f = final["fundamentales"]
    assert (f["source"], f["symbol"], f["as_of_date"]) == ("yahoo", "DBK.DE", "2026-06-30")
    assert "raw_payload_sha256" not in f and "endpoint_version" not in f and "source_updated_at" not in f
    assert f["valuation"]["pe_trailing"] == 8.91
