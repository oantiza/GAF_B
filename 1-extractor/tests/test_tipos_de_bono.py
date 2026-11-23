# -*- coding: utf-8 -*-
"""El reparto de la renta fija por tipo de emisor llega al canónico con sus seis partes (decisión C-33 de Óscar, 21-11-2026).

Hasta ese día el adaptador pasaba gobierno, corporativa, titulizada y liquidez, y dejaba fuera el municipal y los derivados
que da el proveedor (GlobalBondSectorBreakdownLevel1 de Morningstar). Un fondo con la liquidez en negativo y los derivados en
positivo no sumaba 100 en el canónico, aunque sí en su ficha, y la plataforma no podía guardarlo neto (C-31).

Los números son los de `cartera.renta_fija.sectores_pct` de dos fichas de `data/funds` del 17-11-2026, y las sumas están
hechas a mano en los comentarios, no copiadas del código.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import adaptador_bdb as a  # noqa: E402
from core.contratos import valida  # noqa: E402

# Gestión Talento, FI (ES0141991002): 36,71048 + 6,023649 - 134,018866 + 191,284737 = 100,000000.
GESTION_TALENTO = {"gobierno": 36.71048, "corporativa": 6.023649, "liquidez": -134.018866, "derivados": 191.284737}
# Abante Selección, FI (ES0162946034): 42,069783 + 0,001308 + 47,825571 + 19,689918 - 9,118344 - 0,468235 = 100,000001.
ABANTE = {"gobierno": 42.069783, "municipal": 0.001308, "corporativa": 47.825571, "titulizada": 19.689918,
          "liquidez": -9.118344, "derivados": -0.468235}


def _ficha(sectores: dict | None) -> dict:
    renta_fija = {} if sectores is None else {"sectores_pct": sectores}
    return {"meta": {"isin": "ES0000000001"},
            "identificacion": {"nombre": "Fondo", "tipo": "fondo", "divisa_base": "EUR"},
            "cartera": {"asignacion_activos": {"rf": {"neto": 90.0}, "liquidez": {"neto": 10.0}},
                        "renta_fija": renta_fija}}


def _canonico(sectores: dict | None) -> dict:
    return a.convierte(_ficha(sectores))


def test_los_derivados_y_el_municipal_llegan_con_su_nombre_y_en_fraccion():
    tipos = _canonico(ABANTE)["portfolio_exposure_v2"]["bond_types"]
    assert tipos == {"government": 0.420698, "municipal": 0.000013, "corporate": 0.478256,
                     "securitized": 0.196899, "cash": -0.091183, "derivative": -0.004682}


def test_con_los_derivados_el_reparto_neto_suma_100_y_sin_ellos_no():
    tipos = _canonico(GESTION_TALENTO)["portfolio_exposure_v2"]["bond_types"]
    assert tipos == {"government": 0.367105, "corporate": 0.060236, "cash": -1.340189, "derivative": 1.912847}
    assert sum(tipos.values()) == pytest.approx(1.0, abs=5e-6)
    # Sin los derivados, que es lo que llegaba antes de la C-33: 0,367105 + 0,060236 - 1,340189 = -0,912848.
    assert sum(v for k, v in tipos.items() if k != "derivative") == pytest.approx(-0.912848, abs=5e-6)


def test_en_el_bloque_ms_van_las_seis_en_porcentaje_y_la_que_falta_como_nula():
    sectores = _canonico(GESTION_TALENTO)["ms"]["fixed_income"]["bond_sectors"]
    assert sectores == {"government": 36.71048, "municipal": None, "corporate": 6.023649,
                        "securitized": None, "cash": -134.018866, "derivative": 191.284737}


def test_una_parte_que_no_viene_no_entra_en_el_mapa_como_un_cero():
    tipos = _canonico({"gobierno": 70.0, "corporativa": 30.0})["portfolio_exposure_v2"]["bond_types"]
    assert tipos == {"government": 0.7, "corporate": 0.3}


def test_sin_reparto_no_hay_mapa():
    assert _canonico(None)["portfolio_exposure_v2"]["bond_types"] is None


@pytest.mark.parametrize("sectores", [GESTION_TALENTO, ABANTE])
def test_el_canonico_con_las_seis_partes_cumple_su_contrato(sectores):
    valida(_canonico(sectores))
