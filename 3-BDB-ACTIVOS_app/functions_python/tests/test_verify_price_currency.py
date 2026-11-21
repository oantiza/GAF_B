"""Pruebas del verificador de divisas (`scripts/verify_price_currency.py`).

Segunda revisión de Astra: el verificador no tenía pruebas propias, y por eso pasó
inadvertido que el veredicto salía de la MEDIANA de los factores — un documento con dos
puntos correctos y uno con factor 100 se daba por bueno.
"""
import importlib.util
import os
import sys
import pytest

RUTA = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "verify_price_currency.py")
_spec = importlib.util.spec_from_file_location("verify_price_currency", os.path.abspath(RUTA))
verificador = importlib.util.module_from_spec(_spec)
sys.modules["verify_price_currency"] = verificador
_spec.loader.exec_module(verificador)


def test_contraste_fx_amplia_el_rango_para_fechas_anteriores(monkeypatch):
    monkeypatch.setattr(verificador, "_FX_CACHE", {})
    monkeypatch.setattr(verificador, "_FX_CACHE_FROM", {})
    calls = []
    def prices(path, params):
        calls.append(params["from"])
        return [{"date": params["from"], "close": 0.85}]
    monkeypatch.setattr(verificador, "_get_json", prices)
    assert verificador.fx_del_dia("GBP", "2026-09-04") == 0.85
    assert verificador.fx_del_dia("GBP", "1992-01-02") == 0.85
    assert calls == ["1999-01-01", "1992-01-02"]


def test_contraste_completo_detecta_un_fallo_fuera_de_los_tres_puntos_antiguos(monkeypatch):
    doc = {"points": [{"date": "2026-01-%02d" % day, "value": 20 if day == 4 else 10}
                      for day in range(1, 11)]}
    monkeypatch.setattr(verificador, "_get_json", lambda *args: [
        {"date": p["date"], "adjusted_close": 10, "close": 10} for p in doc["points"]])
    assert len(verificador.contrasta_precios("X.Y", doc, 7)) == 7
    assert len(verificador.contrasta_precios("X.Y", doc, -1)) == 10
    assert verificador.veredicto_por_precio("X.Y", doc, "EUR", -1)[0] == "ERROR_DISCREPANCIA"


def test_una_cotizacion_ausente_no_desaparece_del_contraste(monkeypatch):
    doc = {"points": [{"date": "2026-01-%02d" % d, "value": 10} for d in range(1, 4)]}
    monkeypatch.setattr(verificador, "_get_json", lambda *args: [
        {"date": p["date"], "adjusted_close": 10} for p in doc["points"] if p["date"] != "2026-01-02"])
    estado, motivo, _, causa = verificador.veredicto_por_precio("X.Y", doc, "EUR", -1)
    assert estado == "NO_VERIFICADO" and causa == "SIN_COTIZACION"
    assert "1 de 3" in motivo


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -10, 0])
def test_valores_invalidos_no_certifican_la_serie(monkeypatch, value):
    doc = _con_precios(monkeypatch, [10, value, 10], 10)
    assert verificador.veredicto_por_precio("X.Y", doc, "EUR")[0] == "NO_VERIFICADO"


def test_la_tolerancia_no_oculta_un_error_del_uno_por_ciento(monkeypatch):
    doc = _con_precios(monkeypatch, [10, 10.1, 10], 10)
    assert verificador.veredicto_por_precio("X.Y", doc, "EUR")[0] == "ERROR_DISCREPANCIA"


def test_un_fx_ausente_impide_certificar_el_documento(monkeypatch):
    doc = _con_precios(monkeypatch, [10, 10, 10], 11, "USD", 1.1)
    monkeypatch.setattr(verificador, "fx_del_dia", lambda ccy, day: None if day == "2026-02-01" else 1.1)
    estado, _, _, causa = verificador.veredicto_por_precio("X.US", doc, "USD")
    assert estado == "NO_VERIFICADO" and causa == "SIN_FX"


def _con_precios(monkeypatch, guardados, esperado_proveedor, divisa="EUR", fx=1.0, cierre=None):
    """Documento con N puntos y un proveedor que devuelve siempre el mismo cierre."""
    fechas = ["2026-0%d-01" % (indice + 1) for indice in range(len(guardados))]
    doc = {"points": [{"date": fecha, "value": valor} for fecha, valor in zip(fechas, guardados)]}
    monkeypatch.setattr(verificador, "contrasta_precios", lambda symbol, documento, cuantos=3: [
        {"date": fecha, "guardado": valor, "proveedor": esperado_proveedor,
         "proveedor_cierre": esperado_proveedor if cierre is None else cierre}
        for fecha, valor in zip(fechas, guardados)
    ])
    monkeypatch.setattr(verificador, "fx_del_dia", lambda mayor, dia: fx)
    return doc


def test_todos_los_puntos_correctos_es_ok(monkeypatch):
    doc = _con_precios(monkeypatch, [10.0, 10.0, 10.0], 10.0)
    estado, _motivo, _factor, _causa = verificador.veredicto_por_precio("X.Y", doc, "EUR")
    assert estado == "OK"


def test_un_solo_punto_malo_ya_no_pasa_por_la_mediana(monkeypatch):
    """El caso exacto de la revisión: 10, 1.000, 10 con esperado 10."""
    doc = _con_precios(monkeypatch, [10.0, 1000.0, 10.0], 10.0)
    estado, motivo, _factor, _causa = verificador.veredicto_por_precio("X.Y", doc, "EUR")
    assert estado != "OK"
    assert "1 de 3 puntos comprobados fallan" in motivo


def test_error_de_escala_uniforme(monkeypatch):
    doc = _con_precios(monkeypatch, [1000.0, 1000.0, 1000.0], 10.0)
    estado, _motivo, factor, _causa = verificador.veredicto_por_precio("X.Y", doc, "EUR")
    assert estado == "ERROR_ESCALA"
    assert abs(factor - 100.0) < 1e-6


def test_peniques_bien_convertidos_son_correctos(monkeypatch):
    """1.580 peniques con EUR/GBP 0,8568 son 18,44 €: correcto."""
    esperado = 1580.0 * 0.01 / 0.8568
    doc = _con_precios(monkeypatch, [esperado, esperado], 1580.0, divisa="GBX", fx=0.8568)
    estado, _motivo, _factor, _causa = verificador.veredicto_por_precio("HSBA.LSE", doc, "GBX")
    assert estado == "OK"


def test_peniques_tratados_como_libras_son_error_de_escala(monkeypatch):
    """El fallo real de HSBC: 100 veces el valor correcto."""
    malo = 1580.0 / 0.8568
    doc = _con_precios(monkeypatch, [malo, malo], 1580.0, divisa="GBX", fx=0.8568)
    estado, _motivo, factor, _causa = verificador.veredicto_por_precio("HSBA.LSE", doc, "GBX")
    assert estado == "ERROR_ESCALA"
    assert abs(factor - 100.0) < 0.01


def test_sin_convertir_y_convertido_de_mas_se_distinguen(monkeypatch):
    """Un precio en dólares guardado tal cual, y un precio en euros convertido otra vez."""
    fx = 1.1613
    sin_convertir = 47.05          # el valor del proveedor, sin dividir
    doc = _con_precios(monkeypatch, [sin_convertir, sin_convertir], 47.05, divisa="USD", fx=fx)
    estado, _motivo, _factor, _causa = verificador.veredicto_por_precio("X.US", doc, "USD")
    assert estado == "ERROR_SIN_CONVERTIR"

    convertido_de_mas = 47.05 / fx
    doc = _con_precios(monkeypatch, [convertido_de_mas, convertido_de_mas], 47.05, divisa="EUR", fx=1.0)
    monkeypatch.setattr(verificador, "fx_del_dia", lambda mayor, dia: fx if mayor == "USD" else 1.0)
    estado, _motivo, _factor, _causa = verificador.veredicto_por_precio("NUKL.XETRA", doc, "EUR")
    assert estado != "OK", "un precio en euros dividido por EUR/USD no puede darse por bueno"


def test_sin_precios_del_proveedor_no_se_declara_correcto(monkeypatch):
    monkeypatch.setattr(verificador, "contrasta_precios", lambda symbol, doc, cuantos=3: [])
    estado, motivo, factor, causa = verificador.veredicto_por_precio(
        "X.Y", {"points": [{"date": "2026-01-01", "value": 1}]}, "EUR")
    assert estado == "NO_VERIFICADO"
    assert factor is None
    # Tercera revisión: «no verificado» tiene que decir POR QUÉ. Sin cotización del
    # proveedor no es lo mismo que sin divisa ni que sin tipo de cambio.
    assert causa == "SIN_COTIZACION"
    assert "cotizacion" in motivo


def test_sin_tipo_de_cambio_no_se_confunde_con_falta_de_cotizacion(monkeypatch):
    """Hay cotización del proveedor, pero no hay EUR/USD para esa fecha."""
    monkeypatch.setattr(verificador, "contrasta_precios", lambda symbol, doc, cuantos=3: [
        {"date": "2026-01-01", "guardado": 10.0, "proveedor": 11.0}
    ])
    monkeypatch.setattr(verificador, "fx_del_dia", lambda mayor, dia: None)
    estado, motivo, factor, causa = verificador.veredicto_por_precio(
        "X.US", {"points": [{"date": "2026-01-01", "value": 10.0}]}, "USD")
    assert estado == "NO_VERIFICADO"
    assert factor is None
    assert causa == "SIN_FX"
    assert "FOREX" in motivo


def test_la_escala_de_las_subunidades_esta_declarada():
    assert verificador.divisa_mayor("GBX") == ("GBP", 0.01)
    assert verificador.divisa_mayor("USD") == ("USD", 1.0)
    assert verificador.divisa_mayor("ZAC") == ("ZAR", 0.01)


# --- La regla de divisa es UNA, compartida con el productor --------------------------
# Tercera revisión de Astra: la corrección se aplicó al productor y el verificador se
# quedó con la consulta antigua —aceptaba «NA» y la cacheaba—, así que dos fondos con
# precio EOD disponible salían como «sin precios con los que contrastar».

def test_el_verificador_usa_la_misma_resolucion_que_el_productor():
    import fx_currency  # el modulo compartido, ya en sys.path por el verificador

    assert verificador.divisa_mayor is not None
    assert verificador._SUBUNIDADES is fx_currency.SUBUNIDADES
    assert verificador.divisa_mayor("GBX") == fx_currency.divisa_mayor("GBX")


def test_na_no_se_acepta_como_divisa_y_se_resuelve_por_busqueda(tmp_path):
    """El caso de BE0943877671.EUFUND: fundamentales «NA», búsqueda exacta EUR."""
    llamadas = []

    def get_json(path, params=None):
        llamadas.append(path)
        if path.startswith("fundamentals/"):
            return {"General": {"CurrencyCode": "NA"}}
        return [{"Code": "BE0943877671", "Exchange": "EUFUND", "Currency": "EUR"}]

    resolver = verificador.DivisaDeListado(path=str(tmp_path / "cache.json"), get_json=get_json)
    divisa, causa = resolver.resuelve("BE0943877671.EUFUND")

    assert divisa == "EUR"
    assert causa is None
    assert any(ruta.startswith("search/") for ruta in llamadas), "debe consultar la búsqueda exacta"


def test_la_cache_antigua_con_na_se_revalida(tmp_path):
    """Una caché escrita por la resolución antigua no puede perpetuar el fallo."""
    import json as _json

    ruta = tmp_path / "cache.json"
    ruta.write_text(_json.dumps({"BE0943877671.EUFUND": "NA", "IE0031333341.EUFUND": None,
                                 "AAPL.US": "USD"}), encoding="utf-8")

    def get_json(path, params=None):
        if path.startswith("fundamentals/"):
            return {"General": {"CurrencyCode": "NA"}}
        return [{"Code": "IE0031333341", "Exchange": "EUFUND", "Currency": "USD"}]

    resolver = verificador.DivisaDeListado(path=str(ruta), get_json=get_json)

    # Las entradas no válidas se descartan y se cuentan; la buena se conserva.
    assert resolver.revalidadas == 2
    assert resolver.get("AAPL.US") == "USD"
    assert resolver.resuelve("IE0031333341.EUFUND")[0] == "USD"


def test_sin_divisa_del_proveedor_se_registra_como_tal(tmp_path):
    def get_json(path, params=None):
        if path.startswith("fundamentals/"):
            return {"General": {"CurrencyCode": "NA"}}
        return []

    resolver = verificador.DivisaDeListado(path=str(tmp_path / "cache.json"), get_json=get_json)
    divisa, causa = resolver.resuelve("X.DESCONOCIDA")

    assert divisa is None
    # El proveedor SÍ contestó, con un código que no es una divisa: eso no es «sin datos».
    assert causa == "DIVISA_NO_VALIDA"


def test_un_mapa_precargado_con_na_no_exime_de_resolver(tmp_path):
    import json as _json

    mapa = tmp_path / "mapa.json"
    mapa.write_text(_json.dumps({"X.Y": "NA"}), encoding="utf-8")

    def get_json(path, params=None):
        if path.startswith("fundamentals/"):
            return {"General": {"CurrencyCode": "USD"}}
        return []

    resolver = verificador.DivisaDeListado(path=str(tmp_path / "cache.json"), get_json=get_json)
    resolver.precarga(str(mapa))

    assert resolver.resuelve("X.Y")[0] == "USD"


def test_una_serie_sobre_el_cierre_sin_ajustar_no_es_un_error_de_divisa(monkeypatch):
    """Los 55 casos del barrido: EUR, factor pequeño y constante durante 20 años.

    El precio guardado cuadra con el cierre SIN ajustar del proveedor. Llamarlo
    «discrepancia» junto a los errores de divisa mezclaba dos problemas distintos.
    """
    doc = _con_precios(monkeypatch, [41.29, 41.29], 40.3176, cierre=41.29)
    estado, motivo, _factor, _causa = verificador.veredicto_por_precio("EXV1.XETRA", doc, "EUR")

    assert estado == "REVISAR_BASE_PRECIO"
    assert "no es un error de divisa" in motivo


def test_lo_que_no_cuadra_con_ninguna_de_las_dos_bases_sigue_siendo_discrepancia(monkeypatch):
    doc = _con_precios(monkeypatch, [55.0, 55.0], 40.3176, cierre=41.29)
    estado, _motivo, _factor, _causa = verificador.veredicto_por_precio("EXV1.XETRA", doc, "EUR")

    assert estado == "ERROR_DISCREPANCIA"
