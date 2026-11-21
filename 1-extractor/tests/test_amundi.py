# -*- coding: utf-8 -*-
"""El adaptador de Amundi, sobre respuestas reales recortadas el 08-11-2026.

LU0908500753 es física y acumula; LU1681037609 y LU1900068161 van por swap, con su composición como
cesta de sustitución; FR0007052782, fuera del universo, es la que reparte y declara una política mixta.
"""
import copy
import json
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Respuesta  # noqa: E402
from fetchers import amundi  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "amundi"
SETTINGS = {"max_posiciones_cartera": 10000}
DESCARGA = 1794145285.0


def _lee(isin: str) -> dict:
    return json.loads((FIXTURES / f"{isin}.json").read_text(encoding="utf-8"))


class HttpFalso:
    """Devuelve lo preparado, o `products: []` como la API ante un ISIN que no conoce."""

    def __init__(self, respuesta=None, status: int = 200):
        self.respuesta, self.status = respuesta, status
        self.pedidas: list[tuple[str, dict, str | None]] = []

    def post_json(self, url, params=None, cuerpo=None, familia=None, force=False, **_):
        self.pedidas.append((url, cuerpo, familia))
        if self.respuesta is None:
            ruta = FIXTURES / f"{cuerpo['productIds'][0]}.json"
            texto = ruta.read_text(encoding="utf-8") if ruta.exists() else '{"products":[]}'
        else:
            texto = self.respuesta if isinstance(self.respuesta, str) else json.dumps(self.respuesta)
        return Respuesta(self.status, texto, False, DESCARGA)


def _fetch(isin: str, respuesta=None, previo=None) -> dict:
    return amundi.fetch(isin, HttpFalso(respuesta), SETTINGS, previo=previo)


def test_fisica_que_acumula():
    e = _fetch("LU0908500753")["emisor"]
    assert e["fuente"] == "amundi" and e["id_emisor"] == "LU0908500753"
    assert e["nombre"] == "Amundi Core Stoxx Europe 600 UCITS ETF Acc"
    assert e["clase_activo"] == "Equity" and e["divisa_clase"] == "EUR"
    assert e["ter_pct"] == 0.07
    assert e["politica"] == {"valor": "acumulacion", "texto": "Capitalisation"}, "`None` como frecuencia es ausencia"
    assert e["replica"] == {"tipo": "fisica", "estructura": "Direct (Physical)"}
    assert e["indice"] == {"nombre": "STOXX Europe 600 (Net Return) EUR", "ticker": "SXXR"}
    assert e["patrimonio"]["clase"] == {"valor": 22311282034.0746, "divisa": "EUR", "fecha": "2026-11-05"}
    assert e["patrimonio"]["fondo"] == {"valor": 22784871343.22, "divisa": "EUR", "fecha": "2026-11-05"}
    assert "distribuciones" not in e, "una clase que acumula y no ha pagado no lleva el bloque"


def test_la_forma_del_bloque_de_vl():
    out = _fetch("LU0908500753")
    vl, serie = out["emisor"]["vl"], out["series"]["vl_emisor"]
    assert vl["clase_de_serie"] == "VL_EMISOR" and vl["divisa"] == "EUR"
    assert vl["fuente"] == "amundi:api_producto"
    assert vl["fecha_descarga"].startswith("2026-11-08")
    assert vl["ultima_fecha"] == "2026-11-05" and serie[-1] == {"fecha": "2026-11-05", "vl": 322.8261}
    assert vl["observaciones"] == len(serie) > 20
    assert [f["fecha"] for f in serie] == sorted(f["fecha"] for f in serie)
    assert vl["primera_fecha"] == serie[0]["fecha"] == "2013-04-03"


def test_el_cuerpo_no_contesta_el_aviso():
    # La web pregunta con los botones INSTIT y RETAIL: `context.userProfileName` sería contestarle.
    http = HttpFalso()
    amundi.fetch("LU0908500753", http, SETTINGS)
    url, cuerpo, familia = http.pedidas[0]
    assert url == amundi.URL_API and familia == "precio"
    assert "context" not in cuerpo and "userProfileName" not in json.dumps(cuerpo)
    assert len(http.pedidas) == 1


def test_swap_declara_que_la_composicion_es_cesta_de_sustitucion():
    e = _fetch("LU1681037609")["emisor"]
    assert e["replica"] == {"tipo": "sintetica", "estructura": "Indirect (Unfunded swap)"}
    assert e["cartera"]["naturaleza"] == "cesta_de_sustitucion"
    assert e["cartera"]["posiciones"][0]["nombre"] == "APPLE INC"
    assert e["indice"]["nombre"] == "Topix Total Return Index JPY"
    assert e["patrimonio"]["clase"]["valor"] != e["patrimonio"]["fondo"]["valor"]


def test_la_otra_swap_tambien():
    e = _fetch("LU1900068161")["emisor"]
    assert e["replica"]["tipo"] == "sintetica" and e["cartera"]["naturaleza"] == "cesta_de_sustitucion"
    assert e["ter_pct"] == 0.5 and e["politica"]["valor"] == "acumulacion"


def test_fisica_no_lleva_naturaleza():
    assert "naturaleza" not in _fetch("LU0908500753")["emisor"]["cartera"]


def test_posiciones_con_pesos_y_fecha():
    c = _fetch("LU0908500753")["emisor"]["cartera"]
    assert c["fecha"] == "2026-11-04" and c["num_posiciones_declarado"] == 613
    assert c["num_posiciones"] == len(c["posiciones"]) == 12, "la fixture lleva 12"
    p = c["posiciones"][0]
    assert p == {"ticker": "ASML NA", "nombre": "ASML HOLDING NV", "isin": "NL0010273215",
                 "sector": "Information Technology", "clase_activo": "EQUITY_ORDINARY",
                 "divisa": "EUR", "pais": "Netherlands", "peso_pct": 3.788609}
    pesos = [x["peso_pct"] for x in c["posiciones"]]
    assert pesos == sorted(pesos, reverse=True)
    assert c["peso_top10_pct"] == round(sum(pesos[:10]), 2)


def test_recorta_al_maximo_de_posiciones_y_lo_dice():
    c = amundi.fetch("LU0908500753", HttpFalso(), {"max_posiciones_cartera": 3})["emisor"]["cartera"]
    assert len(c["posiciones"]) == 3 and c["posiciones_guardadas"] == 3 and c["num_posiciones"] == 12


def test_clase_que_reparte_trae_dividendos():
    e = _fetch("FR0007052782")["emisor"]
    d = e["distribuciones"]
    assert d["historial_consultado"] is True and d["divisa"] == "EUR" and d["divisa_origen"] == "declarada"
    assert d["historial"][0] == {"fecha_ex": "2012-12-12", "importe": 0.2}
    assert d["historial"][-1] == {"fecha_ex": "2025-12-09", "importe": 2.32}
    assert len(d["historial"]) == 24


def test_la_politica_mixta_no_se_traduce():
    # 29 de los 686 productos: el emisor no dice cuál de las dos. El nombre acaba en Dist y no se usa.
    p = _fetch("FR0007052782")["emisor"]["politica"]
    assert p == {"texto": "Capitalisation and/or distribution", "frecuencia": "Annual"}


def test_varias_divisas_de_dividendo_van_fila_a_fila():
    d = _lee("FR0007052782")
    for h in d["products"][0]["historics"]:
        if h["indicator"] == "dividendCurrency":
            h["historicalData"][-1]["data"] = "USD"
    dist = _fetch("FR0007052782", respuesta=d)["emisor"]["distribuciones"]
    assert "divisa" not in dist and dist["historial"][-1]["divisa"] == "USD"
    assert dist["historial"][0]["divisa"] == "EUR"


def test_isin_desconocido_es_ausencia_y_no_error():
    http = HttpFalso()
    assert amundi.fetch("IE00B4L5Y983", http, SETTINGS) == {}
    assert len(http.pedidas) == 1


def test_respuesta_de_otro_producto_no_se_usa():
    assert _fetch("LU1681037609", respuesta=_lee("LU0908500753")) == {}


@pytest.mark.parametrize("status", [400, 500])
def test_error_http_es_ausencia(status):
    assert amundi.fetch("LU0908500753", HttpFalso("{}", status=status), SETTINGS) == {}


def test_lo_que_no_es_json_es_ausencia():
    assert _fetch("LU0908500753", respuesta="<!doctype html><html></html>") == {}


@pytest.mark.parametrize("composicion", [None, {}, {"compositionData": []}])
def test_sin_composicion_no_rompe(composicion):
    d = _lee("LU0908500753")
    d["products"][0]["composition"] = composicion
    e = _fetch("LU0908500753", respuesta=d)["emisor"]
    assert "cartera" not in e and e["vl"]["observaciones"] > 20


def test_sin_serie_no_rompe():
    d = _lee("LU0908500753")
    d["products"][0]["historics"] = []
    out = _fetch("LU0908500753", respuesta=d)
    assert "series" not in out and "vl" not in out["emisor"] and "patrimonio" not in out["emisor"]
    assert out["emisor"]["ter_pct"] == 0.07


def test_nan_en_texto_es_ausencia():
    d = _lee("LU0908500753")
    for h in d["products"][0]["historics"]:
        if h["indicator"] == "officialNav":
            h["historicalData"][-1]["data"] = "NaN"
    out = _fetch("LU0908500753", respuesta=d)
    assert out["emisor"]["vl"]["ultima_fecha"] == "2026-11-04"
    assert all(isinstance(f["vl"], float) for f in out["series"]["vl_emisor"])


def test_campo_ausente_queda_ausente():
    d = _lee("LU0908500753")
    del d["products"][0]["characteristics"]["TER"]
    del d["products"][0]["characteristics"]["BENCHMARK_TICKER"]
    e = _fetch("LU0908500753", respuesta=d)["emisor"]
    assert "ter_pct" not in e and e["indice"] == {"nombre": "STOXX Europe 600 (Net Return) EUR"}


@pytest.mark.parametrize("texto,valor", [("Capitalisation", "acumulacion"), ("Distribution", "distribucion"),
                                         ("Otra cosa", None)])
def test_la_politica_solo_sale_de_lo_que_declara(texto, valor):
    d = _lee("LU0908500753")
    d["products"][0]["characteristics"]["DISTRIBUTION_POLICY"] = texto
    p = _fetch("LU0908500753", respuesta=d)["emisor"]["politica"]
    assert p.get("valor") == valor and p["texto"] == texto


def test_replica_desconocida_no_se_interpreta():
    d = _lee("LU0908500753")
    d["products"][0]["characteristics"]["REPLICATION_METHODOLOGY"] = "Algo nuevo"
    assert _fetch("LU0908500753", respuesta=d)["emisor"]["replica"] == {"estructura": "Algo nuevo"}


def test_cambio_de_divisa_del_vl_no_mezcla():
    d = _lee("LU0908500753")
    for h in d["products"][0]["historics"]:
        if h["indicator"] == "navCurrency":
            h["historicalData"][0]["data"] = "USD"
    out = _fetch("LU0908500753", respuesta=d)
    assert out["emisor"]["avisos"] == [{"codigo": "divisa_de_vl_cambia", "divisas": ["EUR", "USD"],
                                        "se_conserva": "EUR"}]
    assert out["series"]["vl_emisor"][0]["fecha"] != "2013-04-03"


def _kid(politica):
    return {"vl_eodhd": {"documentos_oficiales": {"kid_politica": politica}}}


def test_politica_distinta_del_kid_avisa_y_no_lo_toca():
    previo = _kid("distribucion")
    copia = copy.deepcopy(previo)
    out = _fetch("LU0908500753", previo=previo)
    assert out["emisor"]["avisos"] == [{"codigo": "politica_distinta_del_kid", "emisor": "acumulacion",
                                        "kid": "distribucion"}]
    assert "documentos_oficiales" not in out and previo == copia


def test_politica_igual_a_la_del_kid_no_avisa():
    assert "avisos" not in _fetch("LU0908500753", previo=_kid("acumulacion"))["emisor"]


def test_sin_kid_no_avisa():
    assert "avisos" not in _fetch("LU0908500753", previo={"_anterior": {"identificacion": {}}})["emisor"]


def test_la_politica_mixta_no_se_compara_con_el_kid():
    assert "avisos" not in _fetch("FR0007052782", previo=_kid("acumulacion"))["emisor"]


def test_solo_escribe_el_bloque_emisor_y_su_serie():
    out = _fetch("FR0007052782")
    assert set(out) == {"emisor", "series"} and set(out["series"]) == {"vl_emisor"}


def test_procedencia_por_etapa():
    with procedencia.activa("amundi") as reg:
        datos = amundi.fetch("FR0007052782", HttpFalso(), SETTINGS)
    etiquetas = {r: reg.resuelve(r) for r, _v in procedencia.hojas(datos)}
    assert etiquetas["series.vl_emisor"] == "amundi:api_producto"
    assert etiquetas["emisor.distribuciones.historial"] == "amundi:api_producto"
    assert reg.endpoints["amundi:api_producto"]["url"] == amundi.URL_API


def test_el_nucleo_lo_funde_sin_mezclarlo_con_lo_demas(tmp_path):
    """Con otra fuente que trae su TER y su cartera, el emisor no las desplaza."""
    from core.adquisicion import registro
    from core.adquisicion.adaptador import Adaptador, Endpoint

    otra = Adaptador(id="justetf", descripcion="", oficial=False,
                     capacidades={"costes.ter_pct": "costes", "cartera.fecha": "cartera"},
                     endpoints=(Endpoint("x", "costes"),),
                     fetch=lambda i, c: {"costes": {"ter_pct": 0.19}, "cartera": {"fecha": "2026-10-01"},
                                         "identificacion": {"nombre": "Otra"},
                                         "valoracion": {"vl": 100.0, "vl_fecha": "2026-11-03"}},
                     aplica=lambda i, t: True, orden=30)
    (tmp_path / "config").mkdir()
    ctx = Contexto(http=HttpFalso(), settings=SETTINGS, base=tmp_path)
    r = nucleo.adquiere("LU0908500753", "etf", ctx, [otra, registro.AMUNDI],
                        fuentes_activas=["justetf", "amundi"])
    assert r.datos["costes"]["ter_pct"] == 0.19 and r.datos["cartera"]["fecha"] == "2026-10-01"
    assert r.datos["emisor"]["ter_pct"] == 0.07
    assert r.datos["meta"]["procedencia"]["series.vl_emisor"] == "amundi:api_producto"


def test_fuera_de_las_fuentes_activas_no_se_pide():
    from core.adquisicion import registro
    from core.adquisicion.planificador import planifica
    plan = planifica("LU0908500753", "etf", registro.ADAPTADORES, fuentes_activas=["morningstar_lt"])
    assert "amundi" not in plan.ids()
    assert plan.omitidos["amundi"] == "fuera de las fuentes activas"


def test_esta_en_la_pasada_general():
    settings = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    assert "amundi" in settings["prioridad_fuentes"]
