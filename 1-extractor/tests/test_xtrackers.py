# -*- coding: utf-8 -*-
"""El adaptador de Xtrackers, sobre respuestas reales recortadas el 08-11-2026.

IE00BM67HK77 es física y acumula; LU0290358497 va por swap, con una contraparte; LU0292096186, fuera del
universo, va por swap y reparte. Los Excel llevan las 24 últimas filas y la primera.
"""
import copy
import json
import os
import shutil
import sys
import time
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Respuesta  # noqa: E402
from fetchers import xtrackers  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "xtrackers"
SETTINGS = {"max_posiciones_cartera": 10000}
DESCARGA = 1794145285.0
FISICA, SWAP, REPARTE = "IE00BM67HK77", "LU0290358497", "LU0292096186"
FICHA_VACIA = {"pdpResult": {"pageFrame": {"main": {}}, "pageSections": {}}, "tealium": {"attributes": {}}}


def _lee(isin: str, parte: str = "ficha") -> dict:
    return json.loads((FIXTURES / f"{isin}_{parte}.json").read_text(encoding="utf-8"))


class HttpFalso:
    """Sirve lo preparado o, si no, las fixtures. Un ISIN sin fixture responde como la web: vacío."""

    sin_red = False

    def __init__(self, cache_dir, ficha=None, posiciones=None, excel=None, status: int = 200, ttl: float = 1.0):
        self.cache_dir = Path(cache_dir)
        self.ficha, self.posiciones, self.excel, self.status, self.ttl = ficha, posiciones, excel, status, ttl
        self.pedidas: list[tuple[str, str | None]] = []
        self.descargas: list[tuple[str, bool]] = []

    def ttl_para(self, familia):
        return self.ttl

    def _isin(self, url: str) -> str:
        return next(t for t in url.split("?")[0].split("/") if len(t) == 12 and t[:2].isalpha())

    def get(self, url, familia=None, force=False, **_):
        self.pedidas.append((url, familia))
        isin = self._isin(url)
        if url.endswith("pdpMetaTagsTealium"):
            ruta, propio, vacio = FIXTURES / f"{isin}_ficha.json", self.ficha, json.dumps(FICHA_VACIA)
        else:
            ruta, propio, vacio = FIXTURES / f"{isin}_posiciones.json", self.posiciones, ""
        if propio is not None:
            texto = propio if isinstance(propio, str) else json.dumps(propio)
        else:
            texto = ruta.read_text(encoding="utf-8") if ruta.exists() else vacio
        estado = self.status if texto else 204
        return Respuesta(estado, texto, False, DESCARGA)

    def download(self, url, destino, force=False, opcional=False, familia=None, **_):
        self.descargas.append((url, force))
        destino = Path(destino)
        if destino.exists() and not force:
            return destino
        origen = self.excel if self.excel is not None else FIXTURES / f"{self._isin(url)}.xlsx"
        if origen is False or not Path(origen).exists():
            return None
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(origen, destino)
        os.utime(destino, (DESCARGA, DESCARGA))
        return destino


@pytest.fixture
def http(tmp_path):
    return HttpFalso(tmp_path)


def _fetch(isin, tmp_path, previo=None, **kw) -> dict:
    return xtrackers.fetch(isin, HttpFalso(tmp_path, **kw), SETTINGS, previo=previo)


def test_fisica_que_acumula(tmp_path):
    e = _fetch(FISICA, tmp_path)["emisor"]
    assert e["fuente"] == "xtrackers" and e["id_emisor"] == FISICA
    assert e["nombre"] == "MSCI World Health Care UCITS ETF 1C"
    assert e["clase_activo"] == "Equities" and e["divisa_clase"] == "USD"
    assert e["region"] == ["Sector", "Developed Markets", "Global"]
    assert e["ter_pct"] == 0.25
    assert e["politica"] == {"valor": "acumulacion", "texto": "Capitalizing"}
    assert e["replica"] == {"tipo": "fisica", "estructura": "Direct Replication (physically)",
                            "muestreo": False, "metodo": "Full Replication"}
    assert e["indice"] == {"nombre": "MSCI WORLD HEALTH CARE TRN INDEX", "ticker": "NDWUHC"}
    assert "distribuciones" not in e, "una clase que acumula y no ha pagado no lleva el bloque"


def test_la_region_no_lee_las_tarjetas_de_otros_etf(tmp_path):
    # «Popular products» trae `Asset class` y `Region` con nombre, y son de otros ETF.
    d = _lee(FISICA)
    d["tealium"]["attributes"]["product_subcategory"] = ["Capitalizing"]
    d["tealium"]["attributes"].pop("product_category")
    e = _fetch(FISICA, tmp_path, ficha=d)["emisor"]
    assert "region" not in e and "clase_activo" not in e


def test_la_forma_del_bloque_de_vl(tmp_path):
    out = _fetch(FISICA, tmp_path)
    vl, serie = out["emisor"]["vl"], out["series"]["vl_emisor"]
    assert vl["clase_de_serie"] == "VL_EMISOR" and vl["divisa"] == "USD"
    assert vl["fuente"] == "xtrackers:excel_historico"
    assert vl["fecha_descarga"].startswith("2026-11-08")
    assert vl["ultima_fecha"] == "2026-11-05" and serie[-1] == {"fecha": "2026-11-05", "vl": 67.9079}
    assert vl["primera_fecha"] == serie[0]["fecha"] == "2010-11-22"
    assert vl["observaciones"] == len(serie) == 25
    assert [f["fecha"] for f in serie] == sorted(f["fecha"] for f in serie)


def test_en_una_clase_de_reparto_el_vl_es_el_declarado(tmp_path):
    # La serie del gráfico da 100,78 ese día: es rendimiento con dividendos, no VL. No se pide.
    http = HttpFalso(tmp_path)
    out = xtrackers.fetch(REPARTE, http, SETTINGS)
    assert out["series"]["vl_emisor"][-1] == {"fecha": "2026-11-05", "vl": 39.8958}
    assert not any("performancechart" in u for u, _ in http.pedidas)


def test_el_patrimonio_es_el_del_excel_sin_convertir(tmp_path):
    p = _fetch(FISICA, tmp_path)["emisor"]["patrimonio"]
    assert p == {"fondo": {"valor": 4632235667.15, "divisa": "USD", "fecha": "2026-11-05"}}


def test_patrimonio_na_es_ausencia_sin_perder_el_vl(tmp_path):
    # LU0290358497 trae 'N/A' en sus primeras filas: la serie la conserva, el patrimonio no la usa.
    out = _fetch(SWAP, tmp_path)
    assert out["series"]["vl_emisor"][0] == {"fecha": "2007-01-06", "vl": 129.346}
    assert out["emisor"]["patrimonio"]["fondo"]["fecha"] == "2026-11-05"


def test_peticiones_sin_contestar_aviso_y_con_su_familia(tmp_path):
    http = HttpFalso(tmp_path)
    xtrackers.fetch(FISICA, http, SETTINGS)
    assert http.pedidas == [(xtrackers.URL_FICHA.format(isin=FISICA), "precio"),
                            (xtrackers.URL_POSICIONES.format(isin=FISICA), "cartera")]
    assert len(http.descargas) == 1 and "/LUX/ENG/excel/product/composite/" in http.descargas[0][0]


def test_swap_declara_que_las_posiciones_son_cesta_de_sustitucion(tmp_path):
    c = _fetch(SWAP, tmp_path)["emisor"]["cartera"]
    assert c["naturaleza"] == "cesta_de_sustitucion"
    assert c["contrapartes"] == [{"nombre": "Deutsche Bank AG", "exposicion_bruta_pct": 100.0006}]


def test_el_indice_no_arrastra_la_nota_al_pie(tmp_path):
    e = _fetch(SWAP, tmp_path)["emisor"]
    assert e["indice"] == {"nombre": "Solactive €STR +8.5 Daily Total Return Index", "ticker": "SOESTR85"}


def test_swap_tipo_y_sin_muestreo(tmp_path):
    r = _fetch(SWAP, tmp_path)["emisor"]["replica"]
    assert r == {"tipo": "sintetica", "estructura": "Indirect Replication (Swap)",
                 "metodo": "Fixed Income Portfolio + Swap"}


def test_contrapartes_de_mayor_a_menor(tmp_path):
    c = _fetch(REPARTE, tmp_path)["emisor"]["cartera"]["contrapartes"]
    assert [x["nombre"] for x in c] == ["J.P. Morgan Securities plc", "Goldman Sachs Bank Europe SE"]


def test_la_cabecera_del_emisor_basta_para_marcar_la_cesta(tmp_path):
    d = _lee(FISICA)
    d["pdpResult"]["pageSections"]["portfolio"]["headlineText"] = "Substitute basket"
    assert _fetch(FISICA, tmp_path, ficha=d)["emisor"]["cartera"]["naturaleza"] == "cesta_de_sustitucion"


def test_fisica_no_lleva_naturaleza_ni_contrapartes(tmp_path):
    c = _fetch(FISICA, tmp_path)["emisor"]["cartera"]
    assert "naturaleza" not in c and "contrapartes" not in c


def test_posiciones_con_pesos_y_fecha(tmp_path):
    c = _fetch(FISICA, tmp_path)["emisor"]["cartera"]
    assert c["fecha"] == "2026-11-05" and c["num_posiciones"] == len(c["posiciones"]) == 12
    assert c["posiciones"][0] == {"isin": "US5324571083", "nombre": "ELI LILLY", "pais": "United States",
                                  "sector": "Pharmaceuticals", "clase_activo": "Equities",
                                  "peso_pct": 11.863331}
    pesos = [x["peso_pct"] for x in c["posiciones"]]
    assert pesos == sorted(pesos, reverse=True) and c["peso_top10_pct"] == round(sum(pesos[:10]), 2)


def test_lo_marcado_sin_dato_no_se_guarda(tmp_path):
    p = _fetch(SWAP, tmp_path)["emisor"]["cartera"]["posiciones"]
    fila = next(x for x in p if x["nombre"] == "EUROPEAN UNION")
    assert "pais" not in fila, "viene como `--`"
    assert "sector" not in fila, "viene como `Unknown`"


def test_fila_con_isin_y_peso_sin_nombre_es_una_posicion(tmp_path):
    d = _lee(FISICA, "posiciones")
    d["tables"][0]["values"][0]["column_0"] = {"value": "--", "type": "empty"}
    c = _fetch(FISICA, tmp_path, posiciones=d)["emisor"]["cartera"]
    assert c["num_posiciones"] == 12
    assert c["posiciones"][0] == {"isin": "US5324571083", "pais": "United States", "sector": "Pharmaceuticals",
                                  "clase_activo": "Equities", "peso_pct": 11.863331}


def test_recorta_al_maximo_y_lo_dice(tmp_path):
    c = xtrackers.fetch(FISICA, HttpFalso(tmp_path), {"max_posiciones_cartera": 3})["emisor"]["cartera"]
    assert len(c["posiciones"]) == 3 and c["posiciones_guardadas"] == 3 and c["num_posiciones"] == 12


def test_exposicion_en_porcentaje_y_no_el_texto_mal_escalado(tmp_path):
    x = _fetch(FISICA, tmp_path)["emisor"]["cartera"]["exposicion"]
    assert x["Security type"] == {"fecha": "2026-11-05", "pesos_pct": {"Equities": 99.8293, "Cash": 0.1707}}


def test_clase_que_reparte_trae_dividendos(tmp_path):
    e = _fetch(REPARTE, tmp_path)["emisor"]
    assert e["politica"] == {"valor": "distribucion", "texto": "Distributing"}
    d = e["distribuciones"]
    assert d["historial_consultado"] is True and d["divisa"] == "EUR"
    assert d["divisa_origen"] == "divisa_de_la_clase", "la tabla no declara divisa"
    assert len(d["historial"]) == 33
    assert d["historial"][-1] == {"fecha_ex": "2026-08-19", "fecha_pago": "2026-09-03",
                                  "fecha_registro": "2026-08-20", "importe": 0.4129}
    assert d["historial"][0]["fecha_ex"] == "2008-08-22"


def test_reparte_y_sin_tabla_consta_consultado(tmp_path):
    d = _lee(REPARTE)
    kf = d["pdpResult"]["pageSections"]["keyFacts"]
    kf["accordionItems"] = [a for a in kf["accordionItems"] if not a["id"].endswith("dividends")]
    dist = _fetch(REPARTE, tmp_path, ficha=d)["emisor"]["distribuciones"]
    assert dist["historial_consultado"] is True and "historial" not in dist


def test_isin_desconocido_es_ausencia_y_no_error(http):
    assert xtrackers.fetch("XX0000000000", http, SETTINGS) == {}
    assert len(http.pedidas) == 1 and not http.descargas


def test_respuesta_de_otro_producto_no_se_usa(tmp_path):
    assert _fetch(SWAP, tmp_path, ficha=_lee(FISICA)) == {}


@pytest.mark.parametrize("status", [400, 500])
def test_error_http_es_ausencia(tmp_path, status):
    assert _fetch(FISICA, tmp_path, status=status) == {}


def test_lo_que_no_es_json_es_ausencia(tmp_path):
    assert _fetch(FISICA, tmp_path, ficha="<!doctype html><html></html>") == {}


@pytest.mark.parametrize("posiciones", ["", {"tables": []}, {"tables": [{"columns": [], "values": []}]}])
def test_sin_posiciones_no_rompe(tmp_path, posiciones):
    # La web responde 204 y sin cuerpo cuando no tiene posiciones.
    e = _fetch(FISICA, tmp_path, posiciones=posiciones)["emisor"]
    assert "posiciones" not in e.get("cartera", {}) and e["vl"]["observaciones"] == 25
    assert e["ter_pct"] == 0.25


def test_sin_excel_no_rompe_y_no_inventa_vl(tmp_path):
    out = _fetch(FISICA, tmp_path, excel=False)
    assert "series" not in out and "vl" not in out["emisor"] and "patrimonio" not in out["emisor"]
    assert out["emisor"]["ter_pct"] == 0.25 and out["emisor"]["cartera"]["num_posiciones"] == 12


def test_lo_descargado_que_no_es_un_excel_no_rompe(tmp_path):
    malo = tmp_path / "malo.xlsx"
    malo.write_text("<html>aviso</html>", encoding="utf-8")
    out = _fetch(FISICA, tmp_path / "c", excel=malo)
    assert "series" not in out and out["emisor"]["ter_pct"] == 0.25


def test_excel_de_otro_producto_no_se_usa(tmp_path):
    out = _fetch(FISICA, tmp_path, excel=FIXTURES / f"{SWAP}.xlsx")
    assert "series" not in out and "vl" not in out["emisor"]


def test_excel_vigente_se_reutiliza_y_caducado_se_renueva(tmp_path):
    http = HttpFalso(tmp_path, ttl=1.0)
    xtrackers.fetch(FISICA, http, SETTINGS)
    destino = tmp_path / "xtrackers_excel" / f"{FISICA}.xlsx"
    os.utime(destino, (time.time(), time.time()))
    xtrackers.fetch(FISICA, http, SETTINGS)
    assert http.descargas[-1][1] is False
    viejo = time.time() - 3 * 86400
    os.utime(destino, (viejo, viejo))
    xtrackers.fetch(FISICA, http, SETTINGS)
    assert http.descargas[-1][1] is True


def test_sin_red_no_fuerza_un_excel_vigente(tmp_path):
    http = HttpFalso(tmp_path)
    xtrackers.fetch(FISICA, http, SETTINGS)
    os.utime(tmp_path / "xtrackers_excel" / f"{FISICA}.xlsx", (time.time(), time.time()))
    http.sin_red = True
    xtrackers.fetch(FISICA, http, SETTINGS, force=True)
    assert http.descargas[-1][1] is False


def test_campo_ausente_queda_ausente(tmp_path):
    d = _lee(FISICA)
    d["pdpResult"]["pageSections"]["keyFacts"]["accordionItems"] = [
        a for a in d["pdpResult"]["pageSections"]["keyFacts"]["accordionItems"]
        if not a["id"].endswith("feesandexpenses")]
    d["pdpResult"]["pageSections"]["indexKeyFacts"]["accordionItems"] = []
    e = _fetch(FISICA, tmp_path, ficha=d)["emisor"]
    assert "ter_pct" not in e and "indice" not in e


def _hecho(d: dict, clave: str, valor) -> dict:
    for a in d["pdpResult"]["pageSections"]["keyFacts"]["accordionItems"]:
        for grupo in a.get("listBundle") or []:
            for item in grupo["items"]:
                if item["key"].startswith(clave):
                    item["value"] = valor
    return d


@pytest.mark.parametrize("texto,valor", [("Capitalizing", "acumulacion"), ("Distributing", "distribucion"),
                                         ("Otra cosa", None)])
def test_la_politica_solo_sale_de_lo_que_declara(tmp_path, texto, valor):
    p = _fetch(FISICA, tmp_path, ficha=_hecho(_lee(FISICA), "Income treatment", texto))["emisor"]["politica"]
    assert p.get("valor") == valor and p["texto"] == texto


def test_replica_desconocida_no_se_interpreta(tmp_path):
    d = _hecho(_lee(FISICA), "Investment methodology", "Algo nuevo")
    d = _hecho(d, "Portfolio structure", "Otra cosa")
    assert _fetch(FISICA, tmp_path, ficha=d)["emisor"]["replica"] == {"estructura": "Algo nuevo",
                                                                     "metodo": "Otra cosa"}


def test_muestreo_declarado(tmp_path):
    d = _hecho(_lee(FISICA), "Portfolio structure", "Optimised Sampling")
    assert _fetch(FISICA, tmp_path, ficha=d)["emisor"]["replica"]["muestreo"] is True


def _kid(politica):
    return {"vl_eodhd": {"documentos_oficiales": {"kid_politica": politica}}}


def test_politica_distinta_del_kid_avisa_y_no_lo_toca(tmp_path):
    previo = _kid("distribucion")
    copia = copy.deepcopy(previo)
    out = _fetch(FISICA, tmp_path, previo=previo)
    assert out["emisor"]["avisos"] == [{"codigo": "politica_distinta_del_kid", "emisor": "acumulacion",
                                        "kid": "distribucion"}]
    assert "documentos_oficiales" not in out and previo == copia


def test_politica_igual_a_la_del_kid_no_avisa(tmp_path):
    assert "avisos" not in _fetch(FISICA, tmp_path, previo=_kid("acumulacion"))["emisor"]


def test_sin_kid_no_avisa(tmp_path):
    assert "avisos" not in _fetch(FISICA, tmp_path, previo={"_anterior": {"identificacion": {}}})["emisor"]


def test_solo_escribe_el_bloque_emisor_y_su_serie(tmp_path):
    out = _fetch(REPARTE, tmp_path)
    assert set(out) == {"emisor", "series"} and set(out["series"]) == {"vl_emisor"}


def test_procedencia_por_etapa(tmp_path):
    with procedencia.activa("xtrackers") as reg:
        datos = xtrackers.fetch(REPARTE, HttpFalso(tmp_path), SETTINGS)
    etiquetas = {r: reg.resuelve(r) for r, _v in procedencia.hojas(datos)}
    assert etiquetas["series.vl_emisor"] == "xtrackers:excel_historico"
    assert etiquetas["emisor.patrimonio.fondo.valor"] == "xtrackers:excel_historico"
    assert etiquetas["emisor.ter_pct"] == "xtrackers:ficha_producto"
    assert etiquetas["emisor.distribuciones.historial"] == "xtrackers:ficha_producto"
    assert etiquetas["emisor.cartera.posiciones"] == "xtrackers:posiciones"
    assert reg.endpoints["xtrackers:posiciones"]["url"] == xtrackers.URL_POSICIONES.format(isin=REPARTE)


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
    ctx = Contexto(http=HttpFalso(tmp_path / "c"), settings=SETTINGS, base=tmp_path)
    r = nucleo.adquiere(FISICA, "etf", ctx, [otra, registro.XTRACKERS], fuentes_activas=["justetf", "xtrackers"])
    assert r.datos["costes"]["ter_pct"] == 0.19 and r.datos["cartera"]["fecha"] == "2026-10-01"
    assert r.datos["emisor"]["ter_pct"] == 0.25
    assert r.datos["meta"]["procedencia"]["series.vl_emisor"] == "xtrackers:excel_historico"


def test_fuera_de_las_fuentes_activas_no_se_pide():
    from core.adquisicion import registro
    from core.adquisicion.planificador import planifica
    plan = planifica(FISICA, "etf", registro.ADAPTADORES, fuentes_activas=["morningstar_lt"])
    assert "xtrackers" not in plan.ids()
    assert plan.omitidos["xtrackers"] == "fuera de las fuentes activas"


def test_esta_en_la_pasada_general():
    settings = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    assert "xtrackers" in settings["prioridad_fuentes"]
