# -*- coding: utf-8 -*-
"""El reparto por clases, con la vara de la plataforma (21-11-2026).

Dos reglas aprobadas por Óscar ese día. La suma del reparto se mide con la
tolerancia de la plataforma, 100 ± 1, y no con la banda 88-112 de antes. Y una
clase que se sale del rango que admite el contrato de la plataforma se avisa
aquí, con una marca informativa que no saca al fondo de la selección: la suma
puede cuadrar y la clase no (ES0116848005, renta variable -101 % y liquidez
+124 %), y la base nueva deja entonces al fondo sin reparto. Hasta hoy eso no lo
veía nadie antes del mapper.

Y desde la decisión C-29 (Óscar, el mismo 21-11-2026) la plataforma acepta el
reparto NETO que suma 100, cortos y apalancamiento incluidos, hasta los topes
de su contrato (-500 % a 600 %): ES0116848005 ya no se avisa. Se avisa lo que
seguirá sin reparto por una clase: la que pasa de los topes, sume lo que sume,
y la que se sale de 0-100 en un reparto que no suma.

Las cifras esperadas son de la regla, escritas a mano.
"""
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad  # noqa: E402
from core.adaptador_bdb import convierte  # noqa: E402

PLATAFORMA = Path(__file__).resolve().parents[2] / "2-plataforma-datos"


def _fondo(asignacion: dict) -> dict:
    return {
        "meta": {"isin": "ES0116848005", "actualizado": "2026-11-16"},
        "identificacion": {"nombre": "Fondo de prueba",
                           "categoria_morningstar": "Global Large-Cap Blend Equity",
                           "divisa_base": "EUR"},
        "costes": {"ter_pct": 0.5},
        "valoracion": {"vl": 10.0, "patrimonio_fondo_meur": 100.0},
        "rentabilidad": {"trailing_pct": {"1a": {"fondo": 5.0},
                                          "3a_anualizada": {"fondo": 4.0}}},
        "riesgo": {"volatilidad_pct": {"3a": {"fondo": 10.0}}, "sri_kid_1a7": 4},
        "cartera": {"fecha": "2026-10-31",
                    "asignacion_activos": {k: {"neto": v} for k, v in asignacion.items()}},
    }


def _flags(asignacion: dict) -> list[str]:
    d = _fondo(asignacion)
    calidad.aplica(d)
    return d["calidad"]["flags"]


# --------------------------------------------------------------- el rango

def test_el_rango_sale_del_contrato_de_la_plataforma():
    esquema = json.loads((PLATAFORMA / "contracts" / "base-nueva"
                          / "instrument-declared-exposure.v2.schema.json").read_text(encoding="utf-8"))
    peso = esquema["$defs"]["peso_de_clase"]
    assert calidad.rango_de_clase_pct() == (peso["minimum"] * 100, peso["maximum"] * 100)
    # Lo que dice hoy (decisión C-29, 21-11-2026): de -5 a 6, los topes del reparto neto.
    assert calidad.rango_de_clase_pct() == pytest.approx((-500.0, 600.0))


def test_la_tolerancia_de_la_suma_es_la_de_la_plataforma():
    vocabulario = (PLATAFORMA / "src" / "config" / "baseNueva" / "vocabulario.ts").read_text(encoding="utf-8")
    m = re.search(r"export const TOLERANCIA_DEL_REPARTO = ([0-9.]+);", vocabulario)
    assert m, "no encuentro TOLERANCIA_DEL_REPARTO en vocabulario.ts"
    assert calidad.TOLERANCIA_DEL_REPARTO_PCT == pytest.approx(float(m.group(1)) * 100)


# --------------------------------------------------- la clase fuera de rango

def test_el_caso_que_lo_motivo_suma_100_y_desde_la_c29_no_se_avisa():
    """ES0116848005: -101,2 + 77,69 + 123,51 + 0 = 100,0. Es un reparto neto que
    cuadra, y la plataforma lo escribe tal cual (decisión C-29, 21-11-2026)."""
    flags = _flags({"rv": -101.20041, "rf": 77.68622, "liquidez": 123.51419, "otros": 0.0})
    assert not any("fuera_de_rango" in f for f in flags)
    assert not any(f.startswith("asignacion_activos_sospechosa") for f in flags)


def test_el_mas_apalancado_del_canonico_tampoco():
    """ES0137396000: 319,81 + 11,54 - 242,57 + 11,22 = 100,0."""
    assert not any("fuera_de_rango" in f for f in
                   _flags({"rv": 319.8089, "rf": 11.5421, "liquidez": -242.5742, "otros": 11.2232}))


def test_una_clase_fuera_de_0_100_en_un_reparto_que_no_suma_se_sigue_avisando():
    """-101,2 + 77,69 + 133,51 = 110,0: no cuadra, así que no es un reparto neto."""
    flags = _flags({"rv": -101.2, "rf": 77.69, "liquidez": 133.51, "otros": 0.0})
    assert "info_clase_fuera_de_rango(rv=-101.2,liquidez=133.51)" in flags
    assert "asignacion_activos_sospechosa(110)" in flags


def test_un_descubierto_de_un_punto_no_se_avisa():
    """Lazard Small Caps Euro I: bolsa 100,04, renta fija -0,08."""
    assert not any("fuera_de_rango" in f
                   for f in _flags({"rv": 100.0401, "rf": -0.0844, "liquidez": 0.0432, "otros": 0.0011}))


@pytest.mark.parametrize("valor, avisa", [(-500.0, False), (-500.01, True), (600.0, False), (600.01, True)])
def test_los_topes_del_contrato_se_avisan_aunque_sume_100(valor, avisa):
    """Más allá de -500 % o de 600 % no es apalancamiento, es un error de unidades."""
    resto = 100 - valor
    flags = _flags({"rv": valor, "rf": resto, "liquidez": 0.0, "otros": 0.0})
    assert any("fuera_de_rango" in f for f in flags) is avisa


@pytest.mark.parametrize("valor, avisa", [(-1.0, False), (-1.01, True), (101.0, False), (101.01, True)])
def test_si_no_suma_los_bordes_de_0_100_son_los_de_la_tolerancia(valor, avisa):
    """Con la suma en 105, una clase cuenta como fuera solo más allá de -1 o de 101."""
    flags = _flags({"rv": valor, "rf": 105 - valor, "liquidez": 0.0, "otros": 0.0})
    fuera = [f for f in flags if "fuera_de_rango" in f]
    assert any(f"rv={valor:g}" in f for f in fuera) is avisa


def test_otros_se_mira_agregado_como_lo_escribe_el_canonico():
    """Convertibles y preferentes van a `other`: lo que la plataforma ve es la suma."""
    # Ninguna se sale por separado; juntas, 105, y el reparto suma 103.
    flags = _flags({"rv": -2.0, "rf": 0.0, "liquidez": 0.0, "otros": 40.0,
                    "convertibles": 40.0, "preferentes": 25.0})
    assert "info_clase_fuera_de_rango(rv=-2,otros=105)" in flags


def test_las_clases_son_las_que_escribe_el_adaptador():
    """La agregación de aquí y la del canónico son la misma, o el aviso mira otra cosa."""
    asignacion = {"rv": -101.20041, "rf": 77.68622, "liquidez": 123.51419, "otros": 1.5,
                  "convertibles": 2.5, "preferentes": 0.25}
    d = _fondo(asignacion)
    calidad.aplica(d)
    mezcla = convierte(d)["portfolio_exposure_v2"]["asset_mix"]
    nombres = {"rv": "equity", "rf": "bond", "liquidez": "cash", "otros": "other"}
    for clase, del_proveedor in calidad.CLASES_DE_LA_PLATAFORMA:
        peso = sum(asignacion[k] for k in del_proveedor if k in asignacion)
        assert mezcla[nombres[clase]] == pytest.approx(peso / 100, abs=1e-6)


def test_es_informativa_no_saca_al_fondo_de_la_seleccion():
    """Prefijo `info_`: no es alerta, no es error, y el canónico sigue `ok`."""
    # Fuera de los topes y sumando 100: solo la marca informativa, sin la alerta de la suma.
    d = _fondo({"rv": -600.0, "rf": 700.0, "liquidez": 0.0, "otros": 0.0})
    calidad.aplica(d)
    marca = [f for f in d["calidad"]["flags"] if "fuera_de_rango" in f]
    assert marca and marca[0].startswith("info_")
    c = convierte(d)
    assert c["validation"]["ok"] is True
    assert c["quality"]["ok"] is True
    assert c["validation"]["diagnostics"]["calidad_alertas"] == 0


# ------------------------------------------------------------ la banda de la suma

@pytest.mark.parametrize("suma, sospechosa", [
    (100.0, False), (101.0, False), (99.0, False),   # el borde es de la plataforma: |suma - 1| > 0,01
    (101.5, True), (98.5, True),
    (95.0, True), (105.0, True),                      # antes, 88-112, estos pasaban
])
def test_la_suma_se_mide_con_un_punto(suma, sospechosa):
    flags = _flags({"rv": suma - 1.0, "rf": 0.5, "liquidez": 0.5})
    assert any(f.startswith("asignacion_activos_sospechosa") for f in flags) is sospechosa


def test_con_menos_de_tres_clases_no_se_mide_la_suma():
    assert not any(f.startswith("asignacion_activos_sospechosa") for f in _flags({"rv": 60.0, "rf": 10.0}))
