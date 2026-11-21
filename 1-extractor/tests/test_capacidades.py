# -*- coding: utf-8 -*-
"""Los adaptadores declaran lo que saben dar, y la declaración no envejece.

«Si cae X, ¿qué me queda?» solo se puede responder antes de que caiga si cada
proveedor declara sus campos (descubrimiento 04-09, §7.1). Estas pruebas
contrastan la declaración con las rutas que de verdad escriben los fetchers:
una ruta escrita y no declarada rompe la prueba.
"""
import re
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import capacidades, registro  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Endpoint, sin  # noqa: E402
from core.adquisicion.planificador import planifica  # noqa: E402

RE_SET_PATH = re.compile(r'set_path\(\s*out\s*,\s*"([a-zA-Z0-9_.]+)"')
RE_SET_PATH_F = re.compile(r'set_path\(\s*out\s*,\s*f"([^"]+)"')

FICHERO_POR_ADAPTADOR = {
    "morningstar_lt": ("fetchers/morningstar_lt.py", "fetchers/morningstar.py"),
    "justetf": ("fetchers/justetf.py",),
    "cnmv": ("fetchers/cnmv.py",),
    "ishares": ("fetchers/ishares.py",),
    "eodhd": ("fetchers/eodhd.py",),
    "cnmv_ficha": ("fetchers/cnmv_ficha.py",),
    "cssf": ("fetchers/cssf.py",),
    "esma": ("fetchers/esma.py",),
    "gleif": ("fetchers/gleif.py",),
    "amf_geco": ("fetchers/amf_geco.py",),
    "kid_gestora": ("fetchers/kid_gestora.py",),
    "vl_eodhd": ("fetchers/vl_fondos.py",),
    "esma_firds": ("fetchers/esma_firds.py",),
    "emt": ("fetchers/emt.py",),
}


def _rutas_escritas(ficheros) -> set[str]:
    rutas = set()
    for f in ficheros:
        src = (RAIZ / f).read_text(encoding="utf-8")
        rutas |= set(RE_SET_PATH.findall(src))
        for plantilla in RE_SET_PATH_F.findall(src):
            # f"riesgo.{metrica}.{plazo}.fondo" -> riesgo.*.*.fondo
            rutas.add(re.sub(r"\{[^}]+\}", "*", plantilla))
    return rutas


@pytest.mark.parametrize("adaptador_id", sorted(FICHERO_POR_ADAPTADOR))
def test_toda_ruta_escrita_esta_declarada(adaptador_id):
    a = registro.por_id()[adaptador_id]
    escritas = _rutas_escritas(FICHERO_POR_ADAPTADOR[adaptador_id])
    sin_declarar = sorted(r for r in escritas if not capacidades.cubre(a.capacidades, r))
    assert not sin_declarar, f"{adaptador_id} escribe rutas no declaradas: {sin_declarar}"


def test_cubre_con_comodines():
    declaradas = {"riesgo.sharpe.*": "analitica", "cartera.*": "cartera", "costes.ter_pct": "costes"}
    assert capacidades.cubre(declaradas, "riesgo.sharpe.3a.fondo") == "riesgo.sharpe.*"
    assert capacidades.cubre(declaradas, "cartera.renta_fija.ytm_pct") == "cartera.*"
    assert capacidades.cubre(declaradas, "costes.ter_pct") == "costes.ter_pct"
    assert capacidades.cubre(declaradas, "costes.otro") is None
    assert capacidades.familia_de(declaradas, "cartera.fecha") == "cartera"


def test_si_cae_morningstar_que_queda():
    res = sin(registro.ADAPTADORES, {"morningstar_lt", "morningstar"})
    # El SRI del KID y los costes MiFID hoy solo los da Morningstar salvo que
    # otro adaptador los declare: la lista de huérfanas es la deuda visible.
    assert isinstance(res["huerfanas"], list)
    assert "valoracion.vl" in res["respaldadas"]      # CNMV/justETF/EODHD lo respaldan


def test_los_endpoints_del_kid_de_gestora_son_sus_fuentes():
    from fetchers import kid_gestora
    assert tuple(f.id for f in kid_gestora.FUENTES) == registro.KID_GESTORA_FUENTES
    assert [e.nombre for e in registro.KID_GESTORA.endpoints] == list(registro.KID_GESTORA_FUENTES)


def test_una_familia_desconocida_no_se_admite():
    with pytest.raises(ValueError):
        Adaptador(id="x", descripcion="", oficial=False, capacidades={"a.b": "inventada"},
                  endpoints=(Endpoint("e", "precio"),), fetch=lambda i, c: {})


def test_el_plan_respeta_tipo_y_fuentes_activas():
    plan = planifica("LU0000000000", "fondo", registro.ADAPTADORES,
                     fuentes_activas=["cnmv", "morningstar_lt", "justetf"])
    # CNMV no aplica (no es ES), justETF no a fondos; CSSF, el KID de la gestora y
    # ESMA son oficiales y entran; el VL de EODHD es implícito para los fondos
    # (fase 0 del plan sin Morningstar, 28-10-2026).
    # `vl_eodhd` va DETRÁS de `morningstar_lt` desde el 01-11-2026: necesita el
    # historial de repartos de Morningstar para saber si puede calcular métricas
    # de la serie de VL. No lo vuelvas a poner delante (ver `registro.py`).
    # `esma_firds` (06-11-2026) es oficial, aplica a todos los tipos y solo lee un índice
    # local: entra en todos los planes, detrás de EODHD.
    # `indice_kid` (07-11-2026) es implícito para fondos y ETF y va DETRÁS de todos los que leen
    # el KID y de `morningstar_lt`: contrasta el índice y el KID de esta pasada.
    # Y `vl_eodhd` va detrás de `indice_kid` desde ese mismo día: la decisión 20 no calcula relativas
    # si el KID declara un compuesto o ningún índice, y tiene que leer el bloque de esta pasada.
    assert plan.ids() == ["cssf", "esma_firds", "morningstar_lt", "kid_gestora", "indice_kid", "vl_eodhd",
                          "esma"]
    assert plan.omitidos["cnmv"] == "no aplica al activo"

    plan_es = planifica("ES0000000000", "fondo", registro.ADAPTADORES,
                        fuentes_activas=["morningstar_lt"])
    # oficiales: entran aunque no estén en la lista
    assert plan_es.ids() == ["cnmv", "cnmv_ficha", "gleif", "esma_firds", "morningstar_lt", "indice_kid",
                             "vl_eodhd", "esma"]

    plan_accion = planifica("US0378331005", "accion", registro.ADAPTADORES)
    assert plan_accion.ids() == ["eodhd", "esma_firds"]

    plan_etf = planifica("IE00B4L5Y983", "etf", registro.ADAPTADORES,
                         fuentes_activas=["cnmv", "morningstar_lt", "justetf"])
    assert plan_etf.ids() == ["eodhd", "esma_firds", "morningstar_lt", "kid_gestora", "indice_kid", "vl_eodhd",
                              "justetf", "esma"]

    plan_fr = planifica("FR0010149120", "fondo", registro.ADAPTADORES,
                        fuentes_activas=["morningstar_lt"])
    assert plan_fr.ids() == ["gleif", "amf_geco", "esma_firds", "morningstar_lt", "kid_gestora",
                             "indice_kid", "vl_eodhd", "esma"]


def test_las_familias_pedidas_no_recortan_el_plan():
    # Un refresco de «precio» tiene que conservar el SRI del KID y la gestora
    # legal: los adaptadores que no sirven la familia pedida se ejecutan igual
    # y la caché los sirve sin salir a red. (El 05-09, 25 fondos refrescados con
    # --familias precio perdieron sus datos oficiales por recortar aquí.)
    completo = planifica("LU0000000000", "fondo", registro.ADAPTADORES,
                         fuentes_activas=["morningstar_lt", "justetf"])
    solo_precio = planifica("LU0000000000", "fondo", registro.ADAPTADORES,
                            fuentes_activas=["morningstar_lt", "justetf"], familias={"precio"})
    assert solo_precio.ids() == completo.ids() == ["cssf", "esma_firds", "morningstar_lt", "kid_gestora",
                                                   "indice_kid", "vl_eodhd", "esma"]
    assert solo_precio.familias == {"precio"}
