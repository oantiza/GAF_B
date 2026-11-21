# -*- coding: utf-8 -*-
"""El adaptador de iShares, sobre respuestas reales recortadas el 08-11-2026.

Los tres ETF cubren los casos que cambian la lectura: IE00B4L5Y983 (`Net Assets of Share Class`,
muestreo), IE00B53L3W79 (`Net Assets` a secas, réplica completa, EUR) e IE00B0M62Q58 (reparte).
"""
import datetime
import re
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import calidad  # noqa: E402
from core.adquisicion import nucleo, procedencia, retencion  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Respuesta  # noqa: E402
from fetchers import ishares  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "ishares"
IDS = {"IE00B4L5Y983": "251882", "IE00B53L3W79": "253712", "IE00B0M62Q58": "251881"}
SETTINGS = {"max_posiciones_cartera": 10000}
DESCARGA = 1794145285.0


def _lee(nombre: str) -> str:
    return (FIXTURES / nombre).read_text(encoding="utf-8")


class HttpFalso:
    """Sirve las fixtures por URL; lo no previsto es un 404, como en la web."""

    def __init__(self, isin: str, excel: str | None = None, busqueda: str | None = None):
        self.isin, self.id = isin, IDS.get(isin, "0")
        self.excel = _lee(f"{isin}.xml") if excel is None and isin in IDS else excel
        self.busqueda = busqueda
        self.pedidas: list[tuple[str, str | None]] = []

    def get(self, url, params=None, familia=None, force=False, **_):
        self.pedidas.append((url, familia))
        if "core-search" in url:
            texto = self.busqueda
            if texto is None:
                ruta = FIXTURES / f"{params['query']}_busqueda.json"
                texto = ruta.read_text(encoding="utf-8") if ruta.exists() else '{"results":[]}'
            return Respuesta(200, texto, False, DESCARGA)
        if "get-fund-document" in url and self.excel is not None:
            return Respuesta(200, self.excel, False, DESCARGA)
        if "/products/" in url and (FIXTURES / f"{self.isin}_pagina.html").exists():
            return Respuesta(200, _lee(f"{self.isin}_pagina.html"), False, DESCARGA)
        return Respuesta(404, "not found", False, DESCARGA)


def _fetch(isin: str, **k) -> dict:
    previo = k.pop("previo", None)
    return ishares.fetch(isin, HttpFalso(isin, **k), SETTINGS, previo=previo)


def test_acumulacion_con_muestreo():
    e = _fetch("IE00B4L5Y983")["emisor"]
    assert e["fuente"] == "ishares" and e["id_emisor"] == "251882"
    assert e["nombre"] == "iShares Core MSCI World UCITS ETF"
    assert e["clase_activo"] == "Equity" and e["divisa_clase"] == "USD"
    assert e["ter_pct"] == 0.20
    assert e["politica"] == {"valor": "acumulacion", "texto": "Accumulating"}
    assert e["replica"] == {"tipo": "fisica", "estructura": "Physical", "muestreo": True, "metodo": "Optimised"}
    assert e["indice"] == {"nombre": "MSCI World Index (Net)", "ticker": "NDDUWI"}
    assert e["patrimonio"]["clase"] == {"valor": 143137728144.0, "divisa": "USD", "fecha": "2026-11-06"}
    assert e["patrimonio"]["fondo"] == {"valor": 147024631083.0, "divisa": "USD", "fecha": "2026-11-06"}
    assert "distribuciones" not in e, "una clase que acumula no pide la página"


def test_la_forma_del_bloque_de_vl():
    out = _fetch("IE00B4L5Y983")
    vl, serie = out["emisor"]["vl"], out["series"]["vl_emisor"]
    assert vl["clase_de_serie"] == "VL_EMISOR" and vl["divisa"] == "USD"
    assert vl["fuente"] == "ishares:excel_producto"
    assert vl["fecha_descarga"].startswith("2026-11-08")
    assert vl["ultima_fecha"] == "2026-11-06" and serie[-1] == {"fecha": "2026-11-06", "vl": 140.99}
    assert vl["observaciones"] == len(serie) > 20
    assert [f["fecha"] for f in serie] == sorted(f["fecha"] for f in serie)
    assert vl["primera_fecha"] == serie[0]["fecha"]


def test_replica_completa_y_patrimonio_con_otra_etiqueta():
    e = _fetch("IE00B53L3W79")["emisor"]
    assert e["replica"]["muestreo"] is False and e["replica"]["metodo"] == "Replicated"
    assert e["vl"]["divisa"] == "EUR"
    assert e["patrimonio"]["clase"] == {"valor": 7571998956.0, "divisa": "EUR", "fecha": "2026-11-06"}
    assert e["ter_pct"] == 0.10


def test_clase_que_reparte_trae_dividendos():
    http = HttpFalso("IE00B0M62Q58")
    e = ishares.fetch("IE00B0M62Q58", http, SETTINGS)["emisor"]
    assert e["politica"] == {"valor": "distribucion", "texto": "Distributing", "frecuencia": "Quarterly"}
    d = e["distribuciones"]
    assert d["historial_consultado"] is True and d["divisa"] == "USD"
    assert d["divisa_origen"] == "divisa_de_la_clase", "la tabla no la declara: se dice que es un supuesto"
    assert d["historial"][-1] == {"fecha_ex": "2026-09-17", "fecha_pago": "2026-09-30",
                                  "fecha_registro": "2026-09-18", "importe": 0.1543}
    assert [f["fecha_ex"] for f in d["historial"]] == sorted(f["fecha_ex"] for f in d["historial"])
    assert ("https://www.ishares.com/uk/individual/en/products/251881/fund", "analitica") in http.pedidas


def test_posiciones_con_pesos_y_fecha():
    c = _fetch("IE00B4L5Y983")["emisor"]["cartera"]
    assert c["fecha"] == "2026-11-05" and c["num_posiciones_declarado"] == 1247
    assert c["num_posiciones"] == len(c["posiciones"]) > 5
    p = c["posiciones"][0]
    assert p == {"ticker": "AAPL", "nombre": "APPLE", "sector": "Information Technology",
                 "clase_activo": "Equity", "peso_pct": 5.73, "divisa": "USD",
                 "valor_mercado": 8468750271.0, "divisa_valor_mercado": "USD"}
    pesos = [x["peso_pct"] for x in c["posiciones"]]
    assert pesos == sorted(pesos, reverse=True)
    assert c["peso_top10_pct"] == round(sum(pesos[:10]), 2)
    assert c["exposicion"]["Sector"]["fecha"] == "2026-11-05"
    assert c["exposicion"]["Sector"]["pesos_pct"]["Information Technology"] == 27.78


def test_recorta_al_maximo_de_posiciones_y_lo_dice():
    c = ishares.fetch("IE00B4L5Y983", HttpFalso("IE00B4L5Y983"),
                      {"max_posiciones_cartera": 3})["emisor"]["cartera"]
    assert len(c["posiciones"]) == 3 and c["posiciones_guardadas"] == 3
    assert c["num_posiciones"] > 3


def test_isin_sin_id_es_ausencia_y_no_error():
    http = HttpFalso("IE00B3XXRP09")
    assert ishares.fetch("IE00B3XXRP09", http, SETTINGS) == {}
    assert len(http.pedidas) == 1


def test_varios_ids_no_elige():
    assert _fetch("IE00B4L5Y983", busqueda='{"results":[{"portfolioId":"1","targetSite":"ishares-uk"},'
                                           '{"portfolioId":"2","targetSite":"ishares-uk"}]}') == {}


def test_excel_de_otro_isin_no_se_usa():
    excel = _lee("IE00B4L5Y983.xml").replace("IE00B4L5Y983", "IE00B5BMR087")
    assert _fetch("IE00B4L5Y983", excel=excel) == {}


def test_html_en_vez_de_excel_es_ausencia():
    assert _fetch("IE00B4L5Y983", excel="<!doctype html><html></html>") == {}


def test_un_doctype_no_se_procesa():
    assert _fetch("IE00B4L5Y983", excel='<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>') == {}


def test_excel_sin_posiciones_no_rompe():
    excel = re.sub(r'(<ss:Worksheet ss:Name="Holdings">.*?<ss:Table[^>]*>).*?(</ss:Table>)', r"\1\2",
                   _lee("IE00B4L5Y983.xml"), count=1, flags=re.S)
    e = _fetch("IE00B4L5Y983", excel=excel)["emisor"]
    assert "posiciones" not in e["cartera"] and e["vl"]["observaciones"] > 20
    assert e["cartera"]["num_posiciones_declarado"] == 1247


def test_ampersand_sin_escapar_se_lee():
    # Medido en IE00B5BMR087: «S&P» va tal cual en el fichero, que entonces no es XML válido.
    excel = _lee("IE00B4L5Y983.xml").replace("iShares Core MSCI World UCITS ETF", "iShares Core S&P 500 UCITS ETF")
    assert "S&P" in excel
    assert _fetch("IE00B4L5Y983", excel=excel)["emisor"]["nombre"] == "iShares Core S&P 500 UCITS ETF"


def test_campo_ausente_queda_ausente():
    excel = re.sub(r"<ss:Row\b(?:(?!</ss:Row>).)*?Total Expense Ratio.*?</ss:Row>", "",
                   _lee("IE00B4L5Y983.xml"), count=1, flags=re.S)
    assert "Total Expense Ratio" not in excel
    e = _fetch("IE00B4L5Y983", excel=excel)["emisor"]
    assert "ter_pct" not in e and e["vl"]["observaciones"] > 20


@pytest.mark.parametrize("texto,valor", [("No Income", None), ("Accumulating", "acumulacion")])
def test_la_politica_solo_sale_de_lo_que_declara(texto, valor):
    excel = _lee("IE00B4L5Y983.xml").replace(">Accumulating<", f">{texto}<")
    politica = _fetch("IE00B4L5Y983", excel=excel)["emisor"]["politica"]
    assert politica.get("valor") == valor and politica["texto"] == texto


def _kid(politica):
    return {"vl_eodhd": {"documentos_oficiales": {"kid_politica": politica}}}


def test_politica_distinta_del_kid_avisa_y_no_lo_toca():
    previo = _kid("distribucion")
    out = _fetch("IE00B4L5Y983", previo=previo)
    assert out["emisor"]["avisos"] == [{"codigo": "politica_distinta_del_kid", "emisor": "acumulacion",
                                        "kid": "distribucion"}]
    assert "documentos_oficiales" not in out
    assert previo == _kid("distribucion")


def test_politica_igual_a_la_del_kid_no_avisa():
    assert "avisos" not in _fetch("IE00B4L5Y983", previo=_kid("acumulacion"))["emisor"]


def test_sin_kid_no_avisa():
    assert "avisos" not in _fetch("IE00B4L5Y983", previo={"_anterior": {"identificacion": {}}})["emisor"]


def test_solo_escribe_el_bloque_emisor_y_su_serie():
    out = _fetch("IE00B0M62Q58")
    assert set(out) == {"emisor", "series"} and set(out["series"]) == {"vl_emisor"}


def test_procedencia_por_etapa():
    with procedencia.activa("ishares") as reg:
        datos = ishares.fetch("IE00B0M62Q58", HttpFalso("IE00B0M62Q58"), SETTINGS)
    etiquetas = {r: reg.resuelve(r) for r, _v in procedencia.hojas(datos)}
    assert etiquetas["series.vl_emisor"] == "ishares:excel_producto"
    assert etiquetas["emisor.distribuciones.historial"] == "ishares:pagina_producto"
    assert reg.endpoints["ishares:excel_producto"]["url"].endswith("portfolioId=251881&component=fundDownloadV2")


def _ficha_base():
    return {"identificacion": {"nombre": "x", "tipo": "etf", "categoria_morningstar": "RV Global"},
            "riesgo": {"historial_precios": {"last_date": "2026-11-03", "clase_de_serie": "PRECIO_DE_MERCADO"}},
            "meta": {"procedencia": {}}}


def test_calidad_no_cambia_con_el_vl_declarado():
    sin, con = _ficha_base(), {**_ficha_base(), **_fetch("IE00B4L5Y983")}
    calidad.aplica(sin)
    calidad.aplica(con)
    assert con["calidad"] == sin["calidad"]


def test_la_retencion_conserva_el_bloque_si_el_emisor_no_contesta():
    hoy = datetime.date(2026, 11, 20)
    anterior = {**_ficha_base(), **_fetch("IE00B4L5Y983")}
    anterior["meta"]["procedencia"] = {"emisor.vl.divisa": "ishares:excel_producto",
                                       "series.vl_emisor": "ishares:excel_producto"}
    final = _ficha_base()
    resumen = retencion.aplica(final, anterior, hoy=hoy)
    assert final["series"]["vl_emisor"] == anterior["series"]["vl_emisor"]
    assert final["emisor"]["vl"]["divisa"] == "USD"
    assert final["meta"]["procedencia"]["series.vl_emisor"].startswith("retenido:ishares:excel_producto@2026-11-08")
    assert {r["ruta"] for r in resumen["retenidos"]} == {"emisor", "series.vl_emisor"}


def test_la_retencion_caduca():
    hoy = datetime.date(2027, 6, 1)
    anterior = {**_ficha_base(), **_fetch("IE00B4L5Y983")}
    anterior["meta"]["procedencia"] = {"emisor.vl.divisa": "ishares:excel_producto",
                                       "series.vl_emisor": "ishares:excel_producto"}
    final = _ficha_base()
    resumen = retencion.aplica(final, anterior, hoy=hoy)
    assert "emisor" not in final and "series" not in final
    assert {r["ruta"] for r in resumen["descartados"]} == {"emisor", "series.vl_emisor"}


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
    ctx = Contexto(http=HttpFalso("IE00B4L5Y983"), settings=SETTINGS, base=tmp_path)
    r = nucleo.adquiere("IE00B4L5Y983", "etf", ctx, [otra, registro.ISHARES],
                        fuentes_activas=["justetf", "ishares"])
    assert r.datos["costes"]["ter_pct"] == 0.19 and r.datos["cartera"]["fecha"] == "2026-10-01"
    assert r.datos["emisor"]["ter_pct"] == 0.20
    assert r.datos["meta"]["procedencia"]["series.vl_emisor"] == "ishares:excel_producto"
    assert "ishares" in r.datos["meta"]["adquisicion"]["plan"]


def test_el_export_saca_la_serie_y_las_posiciones_del_documento_ligero(tmp_path):
    import json

    from core import exporta

    (tmp_path / "data" / "funds").mkdir(parents=True)
    (tmp_path / "config").mkdir()
    ficha = {**_ficha_base(), **_fetch("IE00B4L5Y983")}
    ficha["meta"]["isin"] = "IE00B4L5Y983"
    (tmp_path / "data" / "funds" / "IE00B4L5Y983.json").write_text(json.dumps(ficha), encoding="utf-8")
    destino = tmp_path / "export"
    exporta.export_all(tmp_path, destino)
    doc = json.loads((destino / "fondos.ndjson").read_text(encoding="utf-8").splitlines()[0])
    assert "series" not in doc and "posiciones" not in doc["emisor"]["cartera"]
    assert doc["emisor"]["vl"]["observaciones"] > 20
    serie = json.loads((destino / "series.ndjson").read_text(encoding="utf-8").splitlines()[0])
    assert serie["serie"] == "vl_emisor" and serie["puntos"][-1]["vl"] == 140.99


def test_fuera_de_las_fuentes_activas_no_se_pide():
    from core.adquisicion import registro
    from core.adquisicion.planificador import planifica
    plan = planifica("IE00B4L5Y983", "etf", registro.ADAPTADORES, fuentes_activas=["morningstar_lt"])
    assert "ishares" not in plan.ids()
    assert plan.omitidos["ishares"] == "fuera de las fuentes activas"
