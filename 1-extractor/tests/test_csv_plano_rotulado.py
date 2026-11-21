# -*- coding: utf-8 -*-
"""MET-8 (auditoría integral del 16-11-2026): el CSV plano dice de qué cuenta sale cada cifra.

`fondos_plano.csv` ponía en la misma columna el Sharpe mensual de un fondo, el diario de una acción y el del
proveedor, y en `max_drawdown_pct` una caída a tres años junto a otra a cinco, sin nada que lo dijera. Medido el
17-11-2026 sobre las 1.341 fichas: 761 llevan riesgo propio mensual, 526 propio diario y 41 el del proveedor.

Las cifras no cambian: cada grupo lleva al lado su fuente y su fecha, y la caída máxima su ventana.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import exporta  # noqa: E402


def _ficha(riesgo, rentabilidad, procedencia):
    return {"identificacion": {"nombre": "x"}, "riesgo": riesgo, "rentabilidad": rentabilidad,
            "meta": {"procedencia": procedencia}}


FONDO = _ficha(
    {"fecha_dato": "2026-10-31", "volatilidad_pct": {"3a": {"fondo": 5.2488}}, "sharpe": {"3a": {"fondo": -0.1017}},
     "beta": {"3a": {"fondo": 1.071}}, "max_drawdown": {"pct": -5.8201, "periodo": "3a"},
     "historial_precios": {"metodo": "core.metricas v3: cierre de mes, en euros, riesgo con rentabilidades mensuales"}},
    {"fecha_dato": "2026-10-31", "trailing_pct": {"1a": {"fondo": -3.2799}}},
    {"riesgo.volatilidad_pct.3a.fondo": "vl_eodhd:estr", "riesgo.sharpe.3a.fondo": "vl_eodhd:estr",
     "riesgo.beta.3a.fondo": "morningstar_lt:sal_riskVolatility", "rentabilidad.trailing_pct.1a.fondo": "vl_eodhd:eod"})

ACCION = _ficha(
    {"fecha_dato": "2026-11-13", "volatilidad_pct": {"3a": {"fondo": 60.988}}, "sharpe": {"3a": {"fondo": 1.0053}},
     "max_drawdown": {"pct": -63.1861, "periodo": "5a"},
     "historial_precios": {"metodo": "core.metricas v3: rentabilidades diarias, en euros, volatilidad anualizada con las observaciones de la ventana"}},
    {"fecha_dato": "2026-11-13", "trailing_pct": {"1a": {"fondo": 71.2}}},
    {"riesgo.volatilidad_pct.3a.fondo": "eodhd", "riesgo.sharpe.3a.fondo": "eodhd",
     "rentabilidad.trailing_pct.1a.fondo": "eodhd"})

DEL_PROVEEDOR = _ficha(
    {"fecha_dato": "2026-09-30", "volatilidad_pct": {"3a": {"fondo": 7.1}}, "sharpe": {"3a": {"fondo": 0.4}},
     "beta": {"3a": {"fondo": 0.9}}},
    {"fecha_dato": "2026-10-31", "trailing_pct": {"3a_anualizada": {"fondo": 4.4}}},
    {"riesgo.volatilidad_pct.3a.fondo": "morningstar_lt:sal_riskVolatility",
     "riesgo.sharpe.3a.fondo": "morningstar_lt:sal_riskVolatility", "riesgo.beta.3a.fondo": "morningstar_lt:sal_riskVolatility",
     "rentabilidad.trailing_pct.3a_anualizada.fondo": "morningstar_lt:sal_trailingReturn"})


def _rotulos(ficha):
    fila = exporta._fila_plana("LU0000000001", ficha)
    return {k: fila[k] for k in ("rent_fuente", "rent_fecha", "riesgo_fuente", "riesgo_fecha", "sharpe_fuente",
                                 "relativas_fuente", "max_drawdown_periodo")}, fila


def test_un_fondo_dice_que_su_riesgo_es_propio_y_mensual_y_sus_relativas_del_proveedor():
    rotulos, fila = _rotulos(FONDO)
    assert rotulos == {"rent_fuente": "vl_eodhd", "rent_fecha": "2026-10-31", "riesgo_fuente": "vl_eodhd",
                       "riesgo_fecha": "2026-10-31", "sharpe_fuente": "vl_eodhd", "relativas_fuente": "morningstar_lt",
                       "max_drawdown_periodo": "3a"}
    assert fila["metricas_metodo"].startswith("core.metricas v3: cierre de mes")
    # Las cifras, las de siempre.
    assert (fila["vol_3a"], fila["sharpe_3a"], fila["beta_3a"], fila["max_drawdown_pct"]) == (5.2488, -0.1017, 1.071, -5.8201)


def test_una_accion_dice_que_su_riesgo_es_diario_y_su_caida_a_cinco_anos():
    rotulos, fila = _rotulos(ACCION)
    assert rotulos == {"rent_fuente": "eodhd", "rent_fecha": "2026-11-13", "riesgo_fuente": "eodhd",
                       "riesgo_fecha": "2026-11-13", "sharpe_fuente": "eodhd", "relativas_fuente": None,
                       "max_drawdown_periodo": "5a"}
    assert fila["metricas_metodo"].startswith("core.metricas v3: rentabilidades diarias")


def test_donde_nuestra_serie_no_llega_dice_que_la_cifra_es_del_proveedor_y_no_lleva_metodo():
    rotulos, fila = _rotulos(DEL_PROVEEDOR)
    assert rotulos == {"rent_fuente": "morningstar_lt", "rent_fecha": "2026-10-31", "riesgo_fuente": "morningstar_lt",
                       "riesgo_fecha": "2026-09-30", "sharpe_fuente": "morningstar_lt",
                       "relativas_fuente": "morningstar_lt", "max_drawdown_periodo": None}
    assert fila["metricas_metodo"] is None


def test_las_tres_filas_tienen_las_mismas_columnas_y_los_rotulos_van_junto_a_su_cifra():
    columnas = [list(exporta._fila_plana("X", f)) for f in (FONDO, ACCION, DEL_PROVEEDOR)]
    assert columnas[0] == columnas[1] == columnas[2]
    c = columnas[0]
    assert c.index("rent_fecha") == c.index("rent_10a") + 1
    assert c.index("riesgo_fuente") == c.index("vol_3a") + 2
    assert c.index("sharpe_fuente") == c.index("sharpe_3a") + 1
    assert c.index("max_drawdown_periodo") == c.index("max_drawdown_pct") + 1
