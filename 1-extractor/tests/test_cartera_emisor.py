# -*- coding: utf-8 -*-
"""La cartera completa del emisor de un ETF, aparte de todo lo demás (decisión B-79, 11-11-2026).

Cuatro casos, los que pidió el encargo: un ETF físico que se mide, uno sintético que no, uno troceado y uno que no se puede
leer. Y que viaja solo en su fichero: ni en el documento ligero ni en `posiciones.ndjson`.
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import cartera_emisor, exporta  # noqa: E402
from tests.test_ishares import HttpFalso  # noqa: E402
from fetchers import ishares  # noqa: E402

URL = "https://www.blackrock.com/x/get-fund-document?portfolioId=251882"


def _ficha_ishares() -> dict:
    """La ficha de un ETF físico de iShares, con el bloque que deja el adaptador sobre la respuesta real recortada."""
    out = ishares.fetch("IE00B4L5Y983", HttpFalso("IE00B4L5Y983"), {"max_posiciones_cartera": 10000})
    return {
        "meta": {"isin": "IE00B4L5Y983",
                 "procedencia": {"emisor.cartera.posiciones": "ishares:excel_producto"},
                 "adquisicion": {"fuentes": {"ishares": {"endpoints": {"ishares:excel_producto": {
                     "fetched_at": "2026-11-08T10:01:25+00:00", "url": URL}}}}}},
        "identificacion": {"isin": "IE00B4L5Y983", "tipo": "etf", "nombre": "iShares Core MSCI World"},
        "emisor": out["emisor"],
    }


def _ficha_sintetica() -> dict:
    return {
        "meta": {"isin": "LU0274211480"},
        "identificacion": {"isin": "LU0274211480", "tipo": "etf"},
        "emisor": {"fuente": "xtrackers", "fecha_descarga": "2026-11-08T10:00:00+00:00",
                   "replica": {"tipo": "sintetica"},
                   "cartera": {"fecha": "2026-11-06", "naturaleza": "cesta_de_sustitucion", "num_posiciones": 2,
                               "posiciones": [{"nombre": "APPLE INC", "isin": "US0378331005", "peso_pct": 9.1,
                                               "clase_activo": "Equities"},
                                              {"nombre": "MICROSOFT", "isin": "US5949181045", "peso_pct": 7.2,
                                               "clase_activo": "Equities"}]}},
    }


def test_un_etf_fisico_se_mide_y_cada_linea_lleva_su_tipo():
    d = _ficha_ishares()
    lineas = cartera_emisor.lineas("IE00B4L5Y983", d, 2000)
    assert len(lineas) == 1
    linea = lineas[0]
    assert linea["uso"] == "medir" and "motivo_no_medir" not in linea
    assert linea["fuente"] == "ishares" and linea["replica"] == "fisica"
    assert linea["fecha"] == "2026-11-05", "la fecha de la cartera, no la de descarga"
    assert linea["url"] == URL and linea["obtenido"] == "2026-11-08T10:01:25+00:00"
    assert linea["parte"] == 1 and linea["total_partes"] == 1
    p = linea["posiciones"][0]
    assert p["nombre"] == "APPLE" and p["ticker"] == "AAPL" and p["tipo"] == "accion"
    assert p["clase_activo"] == "Equity", "el literal del emisor viaja al lado del tipo"
    assert p["valor_mercado"] == 8468750271.0 and p["divisa_valor_mercado"] == "USD"
    pesos = [x["peso_pct"] for x in linea["posiciones"]]
    assert pesos == sorted(pesos, reverse=True)
    assert linea["lineas_sin_tipo"] == sum(1 for x in linea["posiciones"] if "tipo" not in x)


def test_un_etf_sintetico_viaja_marcado_y_no_se_mide():
    linea = cartera_emisor.lineas("LU0274211480", _ficha_sintetica(), 2000)[0]
    assert linea["uso"] == "no_medir" and linea["motivo_no_medir"] == "cesta_de_sustitucion"
    assert linea["naturaleza"] == "cesta_de_sustitucion"
    # Basta con la réplica: un sintético sin la naturaleza declarada tampoco se mide.
    d = _ficha_sintetica()
    del d["emisor"]["cartera"]["naturaleza"]
    assert cartera_emisor.lineas("LU0274211480", d, 2000)[0]["motivo_no_medir"] == "cesta_de_sustitucion"


def test_una_cartera_grande_se_trocea_y_una_recortada_no_se_mide():
    d = _ficha_sintetica()
    d["emisor"]["replica"] = {"tipo": "fisica"}
    del d["emisor"]["cartera"]["naturaleza"]
    d["emisor"]["cartera"]["posiciones"] = [{"nombre": f"BONO {i}", "peso_pct": 0.02, "clase_activo": "Equities"}
                                           for i in range(4500)]
    lineas = cartera_emisor.lineas("IE00BDBRDM35", d, 2000)
    assert [len(x["posiciones"]) for x in lineas] == [2000, 2000, 500]
    assert [x["parte"] for x in lineas] == [1, 2, 3] and {x["total_partes"] for x in lineas} == {3}
    assert {x["uso"] for x in lineas} == {"medir"}
    d["emisor"]["cartera"]["posiciones_guardadas"] = 4500
    assert cartera_emisor.lineas("IE00BDBRDM35", d, 2000)[0]["motivo_no_medir"] == "recortada"


def test_uno_que_no_se_puede_leer_no_exporta_nada_y_dice_por_que():
    d = {"meta": {"isin": "DE0005933956"}, "identificacion": {"tipo": "etf"}}
    assert cartera_emisor.lineas("DE0005933956", d, 2000) == []
    assert cartera_emisor.motivo_sin_cartera(d) == "sin_bloque_del_emisor"
    d["emisor"] = {"fuente": "ishares", "cartera": {}}
    assert cartera_emisor.motivo_sin_cartera(d) == "el_emisor_no_da_posiciones"


def test_un_literal_que_no_esta_en_la_tabla_no_se_traduce():
    assert cartera_emisor.tipo_de("ishares", "Fixed Income") == "renta_fija"
    assert cartera_emisor.tipo_de("vanguard", "CT.PORTSWAP") == "derivado"
    assert cartera_emisor.tipo_de("ishares", "Warrant") is None
    assert cartera_emisor.tipo_de("spdr", None) is None, "SPDR no publica clase por línea"


def test_el_tope_del_emisor_va_aparte_del_del_proveedor():
    assert cartera_emisor.tope({"max_posiciones_cartera": 10000, "max_posiciones_cartera_emisor": 30000}) == 30000
    assert cartera_emisor.tope({"max_posiciones_cartera": 3}) == 3
    assert cartera_emisor.tope({}) == 10000
    ajustes = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    assert ajustes["max_posiciones_cartera"] == 10000, "el de las carteras del proveedor no se mueve"
    assert cartera_emisor.tope(ajustes) >= 20000, "el Global Aggregate de iShares da 20.000 líneas"


def test_la_lista_son_los_diecinueve_de_la_decision():
    lista = cartera_emisor.carga_lista(RAIZ)
    assert len(lista) == 19 and "IE00BDBRDM35" in lista and "DE0005933956" in lista


def test_viaja_solo_en_su_fichero_y_solo_para_los_de_la_lista(tmp_path):
    fondos = tmp_path / "data" / "funds"
    fondos.mkdir(parents=True)
    fisico = _ficha_ishares()
    otro = json.loads(json.dumps(fisico))
    otro["meta"]["isin"] = otro["identificacion"]["isin"] = "IE00B5BMR087"
    for d in (fisico, otro):
        d["meta"]["actualizado"] = "2026-11-11T00:00:00+00:00"
        d["identificacion"].update({"divisa_base": "USD", "nombre": "ETF"})
        (fondos / f"{d['meta']['isin']}.json").write_text(json.dumps(d), encoding="utf-8")
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "cartera_emisor.json").write_text(json.dumps(
        {"etf": {"IE00B4L5Y983": {"nombre": "x"}, "DE0005933956": {"nombre": "y"}}}), encoding="utf-8")

    res = exporta.export_all(tmp_path, tmp_path / "export")

    assert res["cartera_emisor"] == {"exportados": ["IE00B4L5Y983"], "sin_cartera": {}}
    lineas = [json.loads(x) for x in (tmp_path / "export" / "posiciones_emisor.ndjson").read_text(
        encoding="utf-8").splitlines()]
    assert {x["isin"] for x in lineas} == {"IE00B4L5Y983"}, "el que no está en la lista no exporta su cartera"
    for x in (tmp_path / "export" / "fondos.ndjson").read_text(encoding="utf-8").splitlines():
        assert "posiciones" not in json.loads(x)["emisor"]["cartera"], "el documento ligero no la lleva"
    assert "IE00B4L5Y983" not in (tmp_path / "export" / "posiciones.ndjson").read_text(encoding="utf-8")
    manifest = json.loads((tmp_path / "export" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["files"]["posiciones_emisor.ndjson"]["line_count"] == 1
    assert manifest["n_lineas_posiciones_emisor"] == 1
