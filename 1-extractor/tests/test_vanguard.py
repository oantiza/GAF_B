# -*- coding: utf-8 -*-
"""El adaptador de Vanguard, sobre respuestas reales recortadas el 08-11-2026.

IE00B3XXRP09 (9503) reparte; IE00BK5BQT80 (9679) acumula y sus posiciones van en dos páginas;
IE0032126645 (9834) es un fondo índice. Las series llevan la primera fila y las 24 últimas.
"""
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Respuesta  # noqa: E402
from fetchers import vanguard  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "vanguard"
SETTINGS = {"max_posiciones_cartera": 10000}
DESCARGA = 1794145285.0
REPARTE, ACUMULA, FONDO = "IE00B3XXRP09", "IE00BK5BQT80", "IE0032126645"
IDS = {REPARTE: "9503", ACUMULA: "9679", FONDO: "9834"}


def _lee(nombre: str) -> dict:
    return json.loads((FIXTURES / nombre).read_text(encoding="utf-8"))


class HttpFalso:
    """Sirve las fixtures por el nombre de la consulta, o lo preparado en `propio`."""

    sin_red = False

    def __init__(self, propio: dict | None = None, sitemap: str | None = None):
        self.propio, self.sitemap = propio or {}, sitemap
        self.pedidas: list[tuple[str, list | None, str | None]] = []
        self.cabeceras: list[dict] = []

    def get(self, url, familia=None, **_):
        texto = self.sitemap if self.sitemap is not None else (FIXTURES / "sitemap.xml").read_text(encoding="utf-8")
        return Respuesta(200, texto, False, DESCARGA)

    def post_json(self, url, cuerpo=None, headers=None, familia=None, **_):
        consulta = re.search(r"query (\w+)", cuerpo["query"]).group(1)
        ids = cuerpo["variables"]["portIds"]
        self.pedidas.append((consulta, ids, familia))
        self.cabeceras.append(headers or {})
        if consulta in self.propio:
            valor = self.propio[consulta]
            return valor if isinstance(valor, Respuesta) else Respuesta(200, json.dumps(valor), False, DESCARGA)
        if consulta == "VanguardCatalogo":
            nombre = "catalogo.json"
        elif consulta == "VanguardFicha":
            nombre = f"{ids[0]}_ficha.json"
        elif consulta == "VanguardVl":
            nombre = f"{ids[0]}_vl.json"
        else:
            nombre = f"{ids[0]}_pos_{2 if cuerpo['variables']['lastItemKey'] else 1}.json"
        return Respuesta(200, (FIXTURES / nombre).read_text(encoding="utf-8"), False, DESCARGA)


def _fetch(isin, previo=None, settings=SETTINGS, **kw) -> dict:
    return vanguard.fetch(isin, HttpFalso(**kw), settings, previo=previo)


def _ficha_con(isin, cambio) -> dict:
    d = _lee(f"{IDS[isin]}_ficha.json")
    cambio(d)
    return {"VanguardFicha": d}


def _sin_pagos(items):
    def cambio(d):
        d["data"]["funds"][0]["distributionDetails"]["periodicDistributions"]["items"] = items
    return cambio


# ------------------------------------------------------------------ lo esperado
def test_etf_que_reparte():
    e = _fetch(REPARTE)["emisor"]
    assert e["fuente"] == "vanguard" and e["id_emisor"] == "9503"
    assert e["nombre"] == "Vanguard S&P 500 UCITS ETF (USD) Distributing"
    assert e["clase_activo"] == "Equity" and e["divisa_clase"] == "USD" and e["region"] == ["USA"]
    assert e["ter_pct"] == 0.07 and e["fecha_lanzamiento"] == "2012-05-22"
    assert e["politica"] == {"valor": "distribucion", "texto": "Distributing Income", "frecuencia": "Quarterly"}
    assert e["replica"] == {"tipo": "fisica", "estructura": "Physical"}, "la API no dice si hay muestreo"
    assert e["indice"] == {"nombre": "S&P 500 Net Total Return", "ticker": "SPTR500N"}, "sin entidades HTML"


def test_etf_que_acumula_no_lleva_dividendos_ni_frecuencia():
    e = _fetch(ACUMULA)["emisor"]
    assert e["politica"] == {"valor": "acumulacion", "texto": "Accumulating Income"}
    assert "distribuciones" not in e


def test_fondo_indice_sin_replica_declarada():
    out = _fetch(FONDO)
    e = out["emisor"]
    assert e["nombre"] == "Vanguard U.S. 500 Stock Index Fund EUR Acc" and e["divisa_clase"] == "EUR"
    assert e["indice"]["nombre"] == "Standard and Poor’s 500 Index" and e["indice"]["ticker"] == "SPTRNE"
    assert "replica" not in e
    assert e["vl"]["divisa"] == "EUR" and out["series"]["vl_emisor"][-1] == {"fecha": "2026-11-06", "vl": 80.8964}
    assert set(out) == {"emisor", "series"}, "no toca el riesgo ni nada que no sea suyo"


def test_serie_de_vl_ascendente_y_declarada():
    out = _fetch(REPARTE)
    serie, vl = out["series"]["vl_emisor"], out["emisor"]["vl"]
    assert [f["fecha"] for f in serie] == sorted(f["fecha"] for f in serie)
    assert vl["clase_de_serie"] == "VL_EMISOR" and vl["divisa"] == "USD" and vl["fuente"] == "vanguard:vl_historico"
    assert vl["observaciones"] == len(serie) == 25
    assert vl["primera_fecha"] == "2014-11-18", "la serie disponible no llega al lanzamiento"
    assert vl["ultima_fecha"] == "2026-11-06" and serie[-1]["vl"] == 139.8145


def test_el_patrimonio_se_elige_por_clave_y_divisa():
    p = _fetch(REPARTE)["emisor"]["patrimonio"]
    assert p["clase"] == {"valor": 52405987253.24, "divisa": "USD", "fecha": "2026-10-31"}
    assert p["fondo"] == {"valor": 89401805985.19, "divisa": "USD", "fecha": "2026-10-31"}


def test_sin_la_divisa_de_la_clase_no_hay_patrimonio():
    def cambio(d):
        fila = d["data"]["polarisAnalyticsHistory"][0]["monthly"]["valuation"]["fund"]["items"][0]
        fila["TNA"] = [x for x in fila["TNA"] if x["currency"] != "USD"]
        fila["AUM"] = []
    e = _fetch(REPARTE, propio=_ficha_con(REPARTE, cambio))["emisor"]
    assert "patrimonio" not in e, "no se convierte ni se toma otra divisa"


# ------------------------------------------------------------------ dividendos
def test_dividendos_con_divisa_declarada():
    d = _fetch(REPARTE)["emisor"]["distribuciones"]
    assert d["historial_consultado"] is True and d["divisa"] == "USD" and d["divisa_origen"] == "declarada"
    fechas = [h["fecha_ex"] for h in d["historial"]]
    assert fechas == sorted(fechas) and len(fechas) == 5
    assert d["historial"][-1] == {"fecha_ex": "2026-09-17", "fecha_pago": "2026-09-30",
                                  "fecha_registro": "2026-09-18", "importe": 0.309606}


def test_clase_que_reparte_sin_dividendos_no_rompe():
    e = _fetch(REPARTE, propio=_ficha_con(REPARTE, _sin_pagos([])))["emisor"]
    assert e["distribuciones"]["historial_consultado"] is True and "historial" not in e["distribuciones"]
    assert e["ter_pct"] == 0.07 and e["vl"]["observaciones"] == 25


def test_ficha_sin_bloque_de_dividendos_no_rompe():
    def cambio(d):
        d["data"]["funds"][0]["distributionDetails"] = None
    e = _fetch(ACUMULA, propio=_ficha_con(ACUMULA, cambio))["emisor"]
    assert "distribuciones" not in e and e["ter_pct"] == 0.14


def test_plusvalia_repartida_suma_al_importe():
    pago = {"exDividendDate": "2026-01-02", "taxDetails": [
        {"distributionLevelCode": "ACTL", "distributionAmount": 0.5, "distributionType": {"distCode": "INC"},
         "currencyCode": "USD"},
        {"distributionLevelCode": "ACTL", "distributionAmount": 0.25, "distributionType": {"distCode": "CGCA"},
         "currencyCode": "USD"},
        {"distributionLevelCode": "ESTM", "distributionAmount": 9.0, "distributionType": {"distCode": "INC"},
         "currencyCode": "USD"}]}
    d = _fetch(REPARTE, propio=_ficha_con(REPARTE, _sin_pagos([pago])))["emisor"]["distribuciones"]
    assert d["historial"] == [{"fecha_ex": "2026-01-02", "importe": 0.75}]


def test_dos_divisas_en_los_pagos_no_declaran_ninguna():
    base = {"distributionLevelCode": "ACTL", "distributionAmount": 0.5, "distributionType": {"distCode": "INC"}}
    pagos = [{"exDividendDate": "2026-01-02", "taxDetails": [{**base, "currencyCode": "USD"}]},
             {"exDividendDate": "2026-04-02", "taxDetails": [{**base, "currencyCode": "EUR"}]}]
    d = _fetch(REPARTE, propio=_ficha_con(REPARTE, _sin_pagos(pagos)))["emisor"]["distribuciones"]
    assert len(d["historial"]) == 2 and "divisa" not in d and "divisa_origen" not in d


# ------------------------------------------------------------------ posiciones
def test_posiciones_de_una_pagina():
    c = _fetch(REPARTE)["emisor"]["cartera"]
    assert c["fecha"] == "2026-09-30" and c["num_posiciones_declarado"] == 513
    assert c["num_posiciones"] == len(c["posiciones"]) and "posiciones_guardadas" not in c
    primera = c["posiciones"][0]
    assert primera == {"ticker": "NVDA", "nombre": "NVIDIA Corp", "sector": "Information Technology",
                       "clase_activo": "EQ.STOCK", "pais": "US", "sedol": "2379504", "peso_pct": 8.36593}
    pesos = [p["peso_pct"] for p in c["posiciones"]]
    assert pesos == sorted(pesos, reverse=True)


def test_las_paginas_se_recorren_hasta_el_final():
    http = HttpFalso()
    c = vanguard.fetch(ACUMULA, http, SETTINGS)["emisor"]["cartera"]
    assert sum(1 for q, *_ in http.pedidas if q == "VanguardPosiciones") == 2
    assert len(c["posiciones"]) == len(_lee("9679_pos_1.json")["data"]["borHoldings"][0]["holdings"]["items"]) + len(
        _lee("9679_pos_2.json")["data"]["borHoldings"][0]["holdings"]["items"])


def test_el_top10_no_cuenta_derivados_de_divisa_ni_liquidez():
    filas = [{"issuerName": f"Bono {i}", "marketValuePercentage": 1.0, "securityType": "FI.CORP",
              "effectiveDate": "2026-09-30"} for i in range(10)]
    filas.insert(0, {"securityLongDescription": "USD/EUR FWD", "marketValuePercentage": 18.0,
                     "securityType": "CT.FOREX", "effectiveDate": "2026-09-30"})
    filas.insert(0, {"securityLongDescription": "Caja", "marketValuePercentage": 5.0,
                     "securityType": "CRNY", "effectiveDate": "2026-09-30"})
    pos = {"data": {"borHoldings": [{"holdings": {"items": filas, "totalHoldings": 12, "lastItemKey": None}}]}}
    c = _fetch(REPARTE, propio={"VanguardPosiciones": pos})["emisor"]["cartera"]
    assert c["peso_top10_pct"] == 10.0 and c["posiciones"][0]["nombre"] == "USD/EUR FWD"


def test_cartera_mayor_que_el_maximo_se_recorta_y_lo_dice():
    filas = [{"issuerName": f"P{i}", "marketValuePercentage": 3.0 - i * .1, "securityType": "EQ.STOCK",
              "effectiveDate": "2026-09-30"} for i in range(20)]
    pos = {"data": {"borHoldings": [{"holdings": {"items": filas, "totalHoldings": 17331, "lastItemKey": "sigue"}}]}}
    http = HttpFalso(propio={"VanguardPosiciones": pos})
    c = vanguard.fetch(REPARTE, http, {"max_posiciones_cartera": 10})["emisor"]["cartera"]
    assert c["posiciones_guardadas"] == 10 and len(c["posiciones"]) == 10
    assert c["num_posiciones"] == c["num_posiciones_declarado"] == 17331
    assert sum(1 for q, *_ in http.pedidas if q == "VanguardPosiciones") == 1, "para al tener bastantes"


def test_fila_sin_peso_o_sin_nombre_no_es_posicion():
    filas = [{"issuerName": "Buena", "marketValuePercentage": 2.0, "securityType": "EQ.STOCK"},
             {"issuerName": "Sin peso", "marketValuePercentage": None, "securityType": "EQ.STOCK"},
             {"marketValuePercentage": 1.0, "securityType": "EQ.STOCK"}]
    pos = {"data": {"borHoldings": [{"holdings": {"items": filas, "totalHoldings": 3, "lastItemKey": None}}]}}
    c = _fetch(REPARTE, propio={"VanguardPosiciones": pos})["emisor"]["cartera"]
    assert [p["nombre"] for p in c["posiciones"]] == ["Buena"] and "fecha" not in c


def test_sin_posiciones_no_hay_bloque():
    pos = {"data": {"borHoldings": [{"holdings": {"items": [], "totalHoldings": 0, "lastItemKey": None}}]}}
    assert "cartera" not in _fetch(REPARTE, propio={"VanguardPosiciones": pos})["emisor"]


# ------------------------------------------------------------------ ausencias
def test_isin_desconocido_no_aporta_nada_y_no_pide_la_ficha():
    http = HttpFalso()
    assert vanguard.fetch("IE00B4L5Y983", http, SETTINGS) == {}
    assert [q for q, *_ in http.pedidas] == ["VanguardCatalogo"]


def test_sitemap_sin_ids():
    http = HttpFalso(sitemap="<urlset></urlset>")
    assert vanguard.fetch(REPARTE, http, SETTINGS) == {} and http.pedidas == []


def test_catalogo_con_error():
    fallo = Respuesta(500, "", False, DESCARGA)
    assert _fetch(REPARTE, propio={"VanguardCatalogo": fallo}) == {}


def test_error_de_graphql_con_200_no_se_toma_por_dato():
    assert _fetch(REPARTE, propio={"VanguardFicha": {"errors": [{"message": "x"}]}}) == {}


def test_ficha_de_otro_producto_no_se_usa():
    def cambio(d):
        d["data"]["funds"][0]["profile"]["identifiers"][0]["altIdValue"] = "IE00BK5BQT80"
    assert _fetch(REPARTE, propio=_ficha_con(REPARTE, cambio)) == {}


def test_fondo_retirado_devuelve_lista_vacia():
    assert _fetch(REPARTE, propio={"VanguardFicha": {"data": {"funds": []}}}) == {}


def test_sin_vl_la_ficha_sigue():
    out = _fetch(REPARTE, propio={"VanguardVl": Respuesta(500, "", False, DESCARGA)})
    assert "series" not in out and "vl" not in out["emisor"] and out["emisor"]["ter_pct"] == 0.07


def test_vl_con_dos_divisas_no_se_guarda():
    d = _lee("9503_vl.json")
    d["data"]["funds"][0]["pricingDetails"]["navPrices"]["items"][0]["currencyCode"] = "EUR"
    out = _fetch(REPARTE, propio={"VanguardVl": d})
    assert "series" not in out and "vl" not in out["emisor"]


def test_vocabulario_desconocido_se_queda_literal():
    def cambio(d):
        p = d["data"]["funds"][0]["profile"]
        p["etfReplicationMethodology"], p["distributionStrategy"] = "Synthetic", "Mixed"
    e = _fetch(REPARTE, propio=_ficha_con(REPARTE, cambio))["emisor"]
    assert e["replica"] == {"estructura": "Synthetic"} and "valor" not in e["politica"]


# ------------------------------------------------------------------ contra el KID
def test_politica_distinta_del_kid_avisa():
    e = _fetch(REPARTE, previo={"a": {"documentos_oficiales": {"kid_politica": "acumulacion"}}})["emisor"]
    assert e["avisos"] == [{"codigo": "politica_distinta_del_kid", "emisor": "distribucion", "kid": "acumulacion"}]


def test_politica_igual_al_kid_no_avisa():
    previo = {"a": {"documentos_oficiales": {"kid_politica": "distribucion"}}}
    assert "avisos" not in _fetch(REPARTE, previo=previo)["emisor"]


def test_sin_kid_no_avisa():
    assert "avisos" not in _fetch(REPARTE, previo={"a": {"identificacion": {}}})["emisor"]


# ------------------------------------------------------------------ integración
def test_peticion_con_la_cabecera_y_una_familia_por_dato():
    http = HttpFalso()
    vanguard.fetch(ACUMULA, http, SETTINGS)
    assert all(c == {"x-consumer-id": "uk0"} for c in http.cabeceras)
    familias = {q: f for q, _, f in http.pedidas}
    assert familias == {"VanguardCatalogo": "identidad", "VanguardFicha": "precio", "VanguardVl": "precio",
                        "VanguardPosiciones": "cartera"}


def test_solo_escribe_el_bloque_emisor_y_su_serie():
    out = _fetch(REPARTE)
    assert set(out) == {"emisor", "series"} and set(out["series"]) == {"vl_emisor"}


def test_procedencia_por_etapa():
    with procedencia.activa("vanguard") as reg:
        datos = vanguard.fetch(REPARTE, HttpFalso(), SETTINGS)
    etiquetas = {r: reg.resuelve(r) for r, _v in procedencia.hojas(datos)}
    assert etiquetas["series.vl_emisor"] == "vanguard:vl_historico"
    assert etiquetas["emisor.ter_pct"] == "vanguard:ficha_producto"
    assert etiquetas["emisor.patrimonio.clase.valor"] == "vanguard:ficha_producto"
    assert etiquetas["emisor.distribuciones.historial"] == "vanguard:ficha_producto"
    assert etiquetas["emisor.cartera.posiciones"] == "vanguard:posiciones"


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
    r = nucleo.adquiere(REPARTE, "etf", ctx, [otra, registro.VANGUARD], fuentes_activas=["justetf", "vanguard"])
    assert r.datos["costes"]["ter_pct"] == 0.19 and r.datos["cartera"]["fecha"] == "2026-10-01"
    assert r.datos["emisor"]["ter_pct"] == 0.07
    assert r.datos["meta"]["procedencia"]["series.vl_emisor"] == "vanguard:vl_historico"


def test_aplica_a_etf_y_fondos_y_no_a_acciones():
    from core.adquisicion import registro
    assert registro.VANGUARD.aplica(REPARTE, "etf") and registro.VANGUARD.aplica(FONDO, "fondo")
    assert not registro.VANGUARD.aplica("ES0113900J37", "accion")


def test_fuera_de_las_fuentes_activas_no_se_pide():
    from core.adquisicion import registro
    from core.adquisicion.planificador import planifica
    plan = planifica(REPARTE, "etf", registro.ADAPTADORES, fuentes_activas=["morningstar_lt"])
    assert "vanguard" not in plan.ids()
    assert plan.omitidos["vanguard"] == "fuera de las fuentes activas"


def test_esta_en_la_pasada_general():
    settings = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    assert "vanguard" in settings["prioridad_fuentes"]
