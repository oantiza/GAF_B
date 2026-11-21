# -*- coding: utf-8 -*-
"""Procedencia por campo y fusión hoja a hoja.

Antes del 04-09 `meta.fuentes` solo decía qué fuentes tocaron cada bloque; no
había forma de saber si `riesgo.sri_kid_1a7` venía del KID oficial o de
Morningstar, ni de medir qué campos dejan de depender de una fuente. Estas
pruebas fijan: (1) la fusión conserva la semántica de siempre (primer valor no
vacío gana, los huecos se rellenan), (2) cada hoja lleva su etiqueta
`fuente:endpoint`, (3) las escrituras fuera de etapa se atribuyen al
adaptador, y (4) el VL lo pone la fuente con la fecha más reciente.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import procedencia  # noqa: E402
from core.schema import merge, set_path  # noqa: E402


def test_la_fusion_conserva_primero_gana_y_rellena_huecos():
    a = {"identificacion": {"nombre": "A", "ucits": True},
         "costes": {"ter_pct": 0.5}}
    b = {"identificacion": {"nombre": "B", "domicilio": "LUX"},
         "costes": {"ter_pct": 0.7, "comision_gestion_max_pct": 1.0},
         "cartera": {"posiciones": [{"nombre": "X"}]}}

    r = merge([("b", b), ("a", a)], ["a", "b"], "LU0000000000")

    assert r["identificacion"] == {"nombre": "A", "ucits": True, "domicilio": "LUX"}
    assert r["costes"] == {"ter_pct": 0.5, "comision_gestion_max_pct": 1.0}
    assert r["cartera"]["posiciones"] == [{"nombre": "X"}]
    assert r["meta"]["fuentes"] == {"identificacion": ["a", "b"], "costes": ["a", "b"],
                                    "cartera": ["b"]}
    assert r["meta"]["isin"] == "LU0000000000"


def test_los_vacios_no_ganan():
    a = {"cartera": {"posiciones": [], "sectores_pct": {}}}
    b = {"cartera": {"posiciones": [{"nombre": "Y"}], "sectores_pct": {"salud": 3}}}

    r = merge([("a", a), ("b", b)], ["a", "b"], "X")

    assert r["cartera"]["posiciones"] == [{"nombre": "Y"}]
    assert r["cartera"]["sectores_pct"] == {"salud": 3}
    # meta.fuentes sigue siendo por bloque, como siempre: "a" tocó el bloque
    # (aunque con vacíos) y se lista; la procedencia por hoja es la que afina.
    assert r["meta"]["fuentes"] == {"cartera": ["a", "b"]}
    assert r["meta"]["procedencia"] == {"cartera.posiciones": "b", "cartera.sectores_pct.salud": "b"}


def test_cada_hoja_lleva_su_etiqueta():
    a = {"identificacion": {"nombre": "A"}, "costes": {"ter_pct": 0.5}}
    b = {"identificacion": {"domicilio": "LUX"}}
    etiquetas = {"a": {"identificacion.nombre": "a:snapshot", "costes.ter_pct": "a:screener"}}

    r = merge([("a", a), ("b", b)], ["a", "b"], "X", procedencias=etiquetas)

    assert r["meta"]["procedencia"] == {
        "costes.ter_pct": "a:screener",
        "identificacion.domicilio": "b",
        "identificacion.nombre": "a:snapshot",
    }


def test_set_path_registra_dentro_de_una_etapa_y_resuelve_por_ancestro():
    out: dict = {}
    with procedencia.activa("ms") as reg:
        with procedencia.etapa("screener", fetched_at=1_700_000_000):
            set_path(out, "costes.ter_pct", 0.2)
        set_path(out, "documentos", {"n": 3, "ultima_fecha": "2026-01-01"})
        set_path(out, "cartera.nada", None)

    assert reg.resuelve("costes.ter_pct") == "ms:screener"
    assert reg.resuelve("documentos.n") == "ms"          # ancestro escrito fuera de etapa
    assert reg.resuelve("cartera.nada") == "ms"          # None no se registra: cae al adaptador
    assert reg.endpoints["ms:screener"]["fetched_at"].startswith("2023-11-14")
    assert procedencia.registro_activo() is None        # el contexto se cierra


def test_el_vl_lo_pone_la_fecha_mas_reciente():
    cnmv = {"valoracion": {"vl": 100.0, "vl_fecha": "2026-01-31",
                           "cnmv_fin_mes": {"vl": 100.0}}}
    ms = {"valoracion": {"vl": 104.5, "vl_fecha": "2026-07-15", "vl_divisa": "EUR"}}

    r = merge([("cnmv", cnmv), ("morningstar_lt", ms)], ["cnmv", "morningstar_lt"], "ES1")

    assert r["valoracion"]["vl"] == 104.5
    assert r["valoracion"]["vl_fecha"] == "2026-07-15"
    assert r["valoracion"]["cnmv_fin_mes"] == {"vl": 100.0}   # el resto sigue la prioridad
    assert r["meta"]["procedencia"]["valoracion.vl"] == "morningstar_lt"


def test_a_igual_fecha_manda_la_prioridad():
    cnmv = {"valoracion": {"vl": 100.0, "vl_fecha": "2026-07-15"}}
    ms = {"valoracion": {"vl": 100.1, "vl_fecha": "2026-07-15"}}

    r = merge([("morningstar_lt", ms), ("cnmv", cnmv)], ["cnmv", "morningstar_lt"], "ES1")

    assert r["valoracion"]["vl"] == 100.0
    assert r["meta"]["procedencia"]["valoracion.vl"] == "cnmv"


TRES_RUTAS = ("valoracion.vl", "valoracion.vl_fecha", "valoracion.vl_divisa")


def test_una_fecha_sin_vl_no_compite_ni_mezcla_la_tupla():
    # Caso reproducido en la auditoría 16-10 (ALTA-16a): antes salía el vl 10.0
    # del 10-10 con fecha del 15-10 y se perdía el 9.1 del 14-10.
    ms = {"valoracion": {"vl": 10.0, "vl_fecha": "2026-10-10", "vl_divisa": "USD"}}
    cnmv = {"valoracion": {"vl_fecha": "2026-10-15"}}
    justetf = {"valoracion": {"vl": 9.1, "vl_fecha": "2026-10-14", "vl_divisa": "EUR"}}

    r = merge([("morningstar_lt", ms), ("cnmv", cnmv), ("justetf", justetf)],
              ["morningstar_lt", "cnmv", "justetf"], "LU1")

    assert r["valoracion"] == {"vl": 9.1, "vl_fecha": "2026-10-14", "vl_divisa": "EUR"}
    assert {ruta: r["meta"]["procedencia"][ruta] for ruta in TRES_RUTAS} == dict.fromkeys(TRES_RUTAS, "justetf")


def test_una_ganadora_sin_divisa_no_hereda_la_de_otra_fuente():
    ms = {"valoracion": {"vl": 10.0, "vl_fecha": "2026-10-10", "vl_divisa": "USD"}}
    cnmv = {"valoracion": {"vl": 9.5, "vl_fecha": "2026-10-15"}}

    r = merge([("morningstar_lt", ms), ("cnmv", cnmv)], ["morningstar_lt", "cnmv"], "ES1")

    assert r["valoracion"] == {"vl": 9.5, "vl_fecha": "2026-10-15"}
    assert r["meta"]["procedencia"]["valoracion.vl"] == "cnmv"
    assert "valoracion.vl_divisa" not in r["meta"]["procedencia"]


def test_con_una_sola_candidata_la_tupla_tampoco_se_mezcla():
    # La fusión por hoja daba la fecha de la primera fuente (que no trae vl) y
    # el vl de la segunda.
    cnmv = {"valoracion": {"vl_fecha": "2026-10-15", "vl_divisa": "EUR"}}
    ms = {"valoracion": {"vl": 10.0, "vl_fecha": "2026-10-10"}}

    r = merge([("cnmv", cnmv), ("morningstar_lt", ms)], ["cnmv", "morningstar_lt"], "ES1")

    assert r["valoracion"] == {"vl": 10.0, "vl_fecha": "2026-10-10"}
    assert r["meta"]["procedencia"]["valoracion.vl_fecha"] == "morningstar_lt"


def test_sin_ninguna_fuente_con_vl_y_fecha_la_tupla_es_la_del_vl():
    # Revisión de la rama, MEN-2: nadie trae vl y fecha a la vez. Antes la
    # fusión por prioridad pegaba la fecha de una fuente al vl de otra.
    cnmv = {"valoracion": {"vl_fecha": "2026-10-15", "vl_divisa": "EUR"}}
    ms = {"valoracion": {"vl": 10.0, "patrimonio_fondo_meur": 12.0}}

    r = merge([("cnmv", cnmv), ("morningstar_lt", ms)], ["cnmv", "morningstar_lt"], "ES1")

    assert r["valoracion"] == {"vl": 10.0, "patrimonio_fondo_meur": 12.0}
    assert r["meta"]["procedencia"]["valoracion.vl"] == "morningstar_lt"
    assert "valoracion.vl_fecha" not in r["meta"]["procedencia"]


def test_sin_vl_una_fecha_suelta_no_se_queda():
    # Hasta la revisión, este test fijaba lo contrario: una vl_fecha sin vl
    # quedaba en la ficha. Una fecha de valoración sin precio no dice nada y
    # se tomaría por la fecha de un vl que no existe.
    cnmv = {"valoracion": {"vl_fecha": "2026-10-15"}}
    ms = {"valoracion": {"patrimonio_fondo_meur": 12.0}}

    r = merge([("cnmv", cnmv), ("morningstar_lt", ms)], ["cnmv", "morningstar_lt"], "ES1")

    assert r["valoracion"] == {"patrimonio_fondo_meur": 12.0}
    assert "valoracion.vl_fecha" not in r["meta"]["procedencia"]

    solo_fecha = merge([("cnmv", cnmv)], ["cnmv"], "ES1")
    assert "valoracion" not in solo_fecha        # no queda un bloque vacío


def test_por_fuente_cuenta_rutas():
    assert procedencia.por_fuente({"a.b": "x:e1", "a.c": "x:e2", "d": "y"}) == {"x": 2, "y": 1}
