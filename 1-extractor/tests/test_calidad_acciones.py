# -*- coding: utf-8 -*-
"""Calidad de las acciones: sus esenciales, y las métricas solo si la historia
las permite (TSK cotiza desde el 13-05-2026 y salía BLOQUEADO con 2/10)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad  # noqa: E402
from core.schema import set_path  # noqa: E402


def _calidad_accion(first: str | None, last: str | None, **metricas) -> dict:
    d = {"identificacion": {"tipo": "accion", "nombre": "TSK", "ticker": "TSK", "mercado": "MC",
                            "sector": "Industrials"},
         "valoracion": {"vl": 6.6, "vl_fecha": "2026-10-16"},
         "riesgo": {"historial_precios": {"source_listing_id": "EODHD:TSK.MC"}},
         "fundamentales": {"market_cap": 7e8}}
    if first:
        d["riesgo"]["historial_precios"].update(first_date=first, last_date=last)
    for ruta, v in metricas.items():
        set_path(d, ruta.replace("__", "."), v)
    calidad.aplica(d)
    return d["calidad"]


def test_una_accion_recien_cotizada_no_queda_bloqueada_por_tener_poca_historia():
    c = _calidad_accion("2026-05-13", "2026-10-16")
    assert c["bucket"] != "BLOQUEADO"
    assert c["esenciales"] == "8/8"
    assert c["flags"] == ["info_historia_corta"]


def test_con_un_ano_de_historia_se_exige_la_rentabilidad_a_un_ano():
    c = _calidad_accion("2025-05-13", "2026-10-16")
    assert c["esenciales"] == "8/9" and "info_historia_corta" in c["flags"]
    c = _calidad_accion("2015-02-11", "2026-10-16", rentabilidad__trailing_pct__1a__fondo=12.0,
                        rentabilidad__trailing_pct__3a_anualizada__fondo=20.0,
                        riesgo__volatilidad_pct__3a__fondo=19.9)
    assert (c["esenciales"], c["bucket"], c["flags"]) == ("11/11", "ALTO", [])


def test_sin_traza_del_historico_se_exigen_todas_las_metricas():
    assert _calidad_accion(None, None)["esenciales"] == "8/11"


def test_los_fondos_siguen_con_sus_esenciales():
    d = {"identificacion": {"tipo": "fondo", "nombre": "F"}, "valoracion": {"vl": 1.0}}
    calidad.aplica(d)
    assert d["calidad"]["esenciales"] == "2/10" and d["calidad"]["bucket"] == "BLOQUEADO"
