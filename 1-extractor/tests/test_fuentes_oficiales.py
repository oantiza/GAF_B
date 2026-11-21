# -*- coding: utf-8 -*-
"""Las fuentes oficiales nuevas leen documentos reales sin red.

Los fixtures son capturas del 04-09: el texto de un KID alojado por la CNMV,
la ficha oficial de un fondo español, un recorte del fichero de identificadores
de la CSSF y respuestas del registro de ESMA y del GECO de la AMF. Lo que se
prueba es el mapeo, no la red.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import kid  # noqa: E402
from core.adquisicion import procedencia  # noqa: E402
from fetchers import cnmv, cnmv_ficha, cssf, esma  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"


# ---------------------------------------------------------------------- KID
def test_el_kid_en_espanol_da_sri_costes_fecha_y_productor():
    r = kid.parsea((FIX / "kid_es_caixabank_bolsa_espana_150.txt").read_text(encoding="utf-8"),
                   "ES0137878031")
    assert r["idioma"] == "es"
    assert r["isin"] == "ES0137878031"
    assert r["sri"] == 5
    assert r["periodo_mantenimiento_anos"] == 5
    assert r["costes"] == {"entrada_pct": 0.0, "salida_pct": 0.0, "gestion_y_otros_pct": 1.7,
                           "transaccion_pct": 0.133, "rendimiento_pct": 0.0}
    assert r["fecha_documento"] == "2025-12-31"
    assert r["productor"] == "CaixaBank Asset Management SGIIC, SAU"


def test_el_kid_en_ingles_y_frances_tambien():
    en = ("Key Information Document\nWe have classified this product as 4 out of 7, which is a "
          "medium risk class.\nRecommended holding period: 5 years\nEntry costs 5.00 % of the "
          "amount you pay in when entering this investment.\nExit costs We do not charge an exit fee.\n"
          "Management fees and other administrative or operating costs 1.83% of the value of your "
          "investment per year.\nTransaction costs 0.21% of the value of your investment per year.\n"
          "Performance fees and carried interest There is no performance fee for this product.\n"
          "Date of production of this key information document: 28/02/2026\n"
          "Name of PRIIP manufacturer: Example Asset Management S.A.\n")
    r = kid.parsea(en)
    assert r["idioma"] == "en" and r["sri"] == 4 and r["periodo_mantenimiento_anos"] == 5
    assert r["costes"] == {"entrada_pct": 5.0, "salida_pct": 0.0, "gestion_y_otros_pct": 1.83,
                           "transaccion_pct": 0.21, "rendimiento_pct": 0.0}
    assert r["fecha_documento"] == "2026-02-28"
    assert r["productor"] == "Example Asset Management S.A."

    fr = ("Document d'informations clés\nNous avons classé ce produit dans la classe de risque 3 "
          "sur 7.\nPériode de détention recommandée : 3 ans\nCoûts d'entrée 1,00 % du montant.\n"
          "Coûts de sortie Nous ne facturons pas de coût de sortie.\nFrais de gestion et autres frais "
          "administratifs et d'exploitation 0,95 % de la valeur.\nCoûts de transaction 0,10 % de la "
          "valeur.\nCommissions liées aux résultats 20,00 % de la surperformance.\n"
          "Date de production du document d'informations clés : 16/04/2026\n")
    r = kid.parsea(fr)
    assert r["idioma"] == "fr" and r["sri"] == 3 and r["periodo_mantenimiento_anos"] == 3
    assert r["costes"]["entrada_pct"] == 1.0 and r["costes"]["salida_pct"] == 0.0
    assert r["costes"]["gestion_y_otros_pct"] == 0.95 and r["costes"]["rendimiento_pct"] == 20.0
    assert r["fecha_documento"] == "2026-04-16"


def test_el_kid_de_andbank_con_corchetes_y_fecha_larga():
    # Maquetación distinta (dígito del SRI entre corchetes, "Fecha documento: 1 de
    # enero de 2026", productor en "Entidad:"): la misma información.
    r = kid.parsea((FIX / "kid_es_andbank_gestion_boutique_vi_argos.txt").read_text(encoding="utf-8"),
                   "ES0110407006")
    assert r["sri"] == 4
    assert r["periodo_mantenimiento_anos"] == 5
    assert r["fecha_documento"] == "2026-01-01"
    assert r["productor"] == "ANDBANK WEALTH MANAGEMENT, SGIIC, S. A. U."
    assert r["costes"]["entrada_pct"] == 0.0 and r["costes"]["salida_pct"] == 0.0
    assert r["costes"]["gestion_y_otros_pct"] == 1.47
    assert r["costes"]["transaccion_pct"] == 0.01
    assert r["costes"]["rendimiento_pct"] == 0.0


def test_la_fila_de_la_clase_en_la_vista_de_clases_da_su_kid_y_fecha_de_alta():
    html = ('<table><tr class="FilasAlternas"><td data-th="Nº">2</td>'
            '<td class="Izquierda" data-th="Denominación">CLASE D</td><td data-th="Fecha alta">12/02/2010</td>'
            '<td data-th="DFI (*)"> <a href="https://www.cnmv.es/webservices/verdocumento/ver?e=abc%3d%3d" '
            'title="pdf"><img src="x.gif"/></a> </td><td data-th="Folleto"><a href="https://www.cnmv.es/'
            'webservices/verdocumento/ver?e=folleto"></a></td>'
            '<td data-th="ISIN"><a href="../../ancv/isin.aspx?isin=ES0165142003">ES0165142003</a></td></tr>'
            '<tr><td data-th="Nº">3</td><td data-th="Denominación">CLASE L</td><td data-th="Fecha alta">08/03/2019</td>'
            '<td data-th="DFI (*)"><a href="https://www.cnmv.es/webservices/verdocumento/ver?e=otro"></a></td>'
            '<td data-th="ISIN">ES0165142011</td></tr></table>')
    fila = cnmv_ficha._fila_isin(html, "ES0165142003")
    # se conserva la codificación de la URL tal cual (es lo que la CNMV espera)
    assert fila["dfi_url"] == "https://www.cnmv.es/webservices/verdocumento/ver?e=abc%3d%3d"
    assert fila["fecha_alta_clase"] == "2010-02-12"
    assert fila["denominacion_fila"] == "CLASE D"


def test_el_kid_no_inventa_lo_que_no_encuentra():
    r = kid.parsea("Documento de Datos Fundamentales\nTexto sin cifras reconocibles.")
    assert r["sri"] is None
    assert all(v is None for v in r["costes"].values())
    assert r["fecha_documento"] is None


# ------------------------------------------------------------- ficha CNMV
def test_la_ficha_cnmv_da_registro_armonizado_gestora_y_kid():
    f = cnmv_ficha.parsea_ficha((FIX / "cnmv_ficha_ES0162956009.html").read_text(encoding="utf-8"))
    assert f["registro"] == "5532"
    assert f["fecha_registro"] == "2021-05-28"
    assert f["isin"] == "ES0162956009"
    assert f["armonizado"] is True
    assert f["fecha_folleto"] == "2026-06-08"
    assert "verdocumento/ver?e=" in f["dfi_url"]
    assert f["gestora"] == "ABANCA GESTION DE ACTIVOS, SGIIC, SA"
    assert f["gestora_registro"] == "128"
    assert f["depositaria"] == "CECABANK, S.A."


def test_la_ancv_da_la_fecha_de_emision_del_isin():
    html = ("<table><tr><th>ISIN</th><th>FISN</th><th>Fecha emisión</th><th>Nominal</th><th>Moneda</th>"
            "<th>CFI 2015</th></tr><tr><td>ES0162956009</td><td>ABANCA IND RV EMERG FI/PT</td>"
            "<td>28/05/2021</td><td>0,00</td><td>EUR</td><td>CEOGES</td></tr></table>")
    d = cnmv_ficha.parsea_ancv(html, "ES0162956009")
    assert d["fecha_emision"] == "2021-05-28"
    assert d["fisn"] == "ABANCA IND RV EMERG FI/PT"
    assert d["cfi"] == "CEOGES"


# ------------------------------------------------------------------- CSSF
def test_el_fichero_cssf_se_indexa_por_isin():
    idx = cssf.parsea_csv((FIX / "cssf_identificadores_muestra.csv").read_bytes())
    fila = idx["LU0119195963"]
    assert fila["opc"] == "GOLDMAN SACHS FUNDS V"
    assert fila["compartimento"] == "GOLDMAN SACHS PATRIMONIAL BALANCED"
    assert fila["autorizacion"] == "1994-05-06"
    assert fila["divisa"] == "EUR"
    assert cssf.nombre_legal(fila) == "GOLDMAN SACHS FUNDS V-GOLDMAN SACHS PATRIMONIAL BALANCED"
    virtual = {"opc": "DWS FLOATING RATE NOTES", "compartimento": "Compartiment virtuel pour OPC classique"}
    assert cssf.nombre_legal(virtual) == "DWS FLOATING RATE NOTES"


# ------------------------------------------------------------------- ESMA
class _HttpFalso:
    def __init__(self, respuestas):
        self.respuestas = respuestas
        self.consultas = []

    def get(self, url, params=None, **kw):
        self.consultas.append(params["q"])
        docs = self.respuestas.get(params["q"], [])

        class R:
            ok = True
            fetched_at = 1_700_000_000.0

            def json(self_inner):
                return {"response": {"numFound": len(docs), "docs": docs}}
        return R()


def _doc(nombre, gestora="BLACKROCK (LUXEMBOURG) S.A.", pais="LU", estado="Active"):
    return {"funds_national_name": nombre, "funds_legal_framework_name": "UCITS",
            "funds_manager_nat_name": gestora, "funds_domicile_cou_code": pais,
            "funds_status_code_name": estado, "funds_host_country_codes": ["ES", "DE"]}


def test_esma_casa_por_nombre_legal_exacto_de_la_cssf():
    http = _HttpFalso({'funds_national_name:"BLACKROCK GLOBAL FUNDS-WORLD MINING FUND"':
                       [_doc("BLACKROCK GLOBAL FUNDS-WORLD MINING FUND")]})
    doc, diag = esma.busca(http, "LU0172157363", "BLACKROCK GLOBAL FUNDS-WORLD MINING FUND",
                           "BGF World Mining A2")
    assert doc["funds_manager_nat_name"] == "BLACKROCK (LUXEMBOURG) S.A."
    assert diag["modo"] == "exacto" and diag["candidatos"] == 1


def test_esma_por_tokens_exige_ganador_claro():
    q = "funds_domicile_cou_code:IE AND funds_national_name:*comgest*growth*europe*"
    http = _HttpFalso({q: [_doc("Comgest Growth Europe", "N/A", "IE"),
                           _doc("Comgest Growth Europe ex UK", "N/A", "IE"),
                           _doc("Comgest Growth Europe Smaller Companies", "N/A", "IE")]})
    doc, diag = esma.busca(http, "IE0004766675", None, "Comgest Growth Europe EUR Acc")
    assert doc["funds_national_name"] == "Comgest Growth Europe"
    assert diag["modo"] == "tokens"

    # dos nombres igual de parecidos: no se adivina
    http2 = _HttpFalso({q: [_doc("Comgest Growth Europe Opportunities", "N/A", "IE"),
                            _doc("Comgest Growth Europe Plus", "N/A", "IE")]})
    doc2, _ = esma.busca(http2, "IE0004766675", None, "Comgest Growth Europe EUR Acc")
    assert doc2 is None

    # una letra de clase distingue compartimentos: «Europe S» no es «Europe»
    http3 = _HttpFalso({q: [_doc("Comgest Growth Europe S", "N/A", "IE"),
                            _doc("Comgest Growth Europe", "N/A", "IE"),
                            _doc("Comgest Growth Europe ESG Plus", "N/A", "IE")]})
    doc3, _ = esma.busca(http3, "IE0004766675", None, "Comgest Growth Europe EUR Acc")
    assert doc3["funds_national_name"] == "Comgest Growth Europe"


def test_esma_rechaza_domicilio_distinto_al_del_isin():
    http = _HttpFalso({'funds_national_name:"X-Y"': [_doc("X-Y", pais="IE")]})
    doc, _ = esma.busca(http, "LU0000000000", "X-Y", None)
    assert doc is None


def test_esma_fetch_usa_el_nombre_de_la_cssf_y_escribe_con_procedencia():
    http = _HttpFalso({'funds_national_name:"FIDELITY FUNDS-ITALY FUND"':
                       [_doc("FIDELITY FUNDS-ITALY FUND", "FIL INVESTMENT MANAGEMENT (LUXEMBOURG) S.A R.L.")]})
    previo = {"cssf": {"identificacion": {"nombre_legal_registro": "FIDELITY FUNDS-ITALY FUND"}}}
    with procedencia.activa("esma") as reg:
        out = esma.fetch("LU0922333322", http, {}, previo=previo)
    assert out["identificacion"]["ucits"] is True
    assert out["identificacion"]["gestora_legal"].startswith("FIL INVESTMENT MANAGEMENT")
    assert out["identificacion"]["domicilio"] == "LUX"
    assert out["identificacion"]["comercializado_en_espana"] is True
    assert reg.resuelve("identificacion.ucits") == "esma:cbdif"


# ------------------------------------------------------- CNMV trimestral
def test_el_trimestral_cnmv_mapea_costes_ter_vocacion_y_cartera():
    trim = {"Entidad": {"Tipo": "FI", "NumeroRegistro": "5206", "Compartimento": {
        "NumeroCompartimento": "1", "ClaseFondo": "Otros",
        "VocacionInversora": "Renta Variable Mixta Internacional",
        "Clase": {"NumeroClase": "0", "ISIN": "ES0110407006", "CodigoDivisa": "EUR",
                  "NumeroParticipes": "183", "Patrimonio": "9090407.00", "ValorLiquidativo": "140.7154",
                  "ComisionGestion": "0.68", "ComisionDepositario": "0.04",
                  "ComisionSuscripcionMaxima": "0.00", "ComisionReembolsoMaxima": "0.00",
                  "Rentabilidad": {"Rentabilidad_TrimestreActual": "2.42", "Rentabilidad_T_1": "6.49"},
                  "Volatilidad_VL": {"Volatilidad_TrimestreActual": "9.66"},
                  "RatioTotalGastos": {"RatioTotalGastos_TrimestreActual": "0.37",
                                       "RatioTotalGastos_T_1": "0.37", "RatioTotalGastos_T_2": "0.37",
                                       "RatioTotalGastos_T_3": "0.36"}}}}}
    pat = {"Entidad": {"NumeroRegistro": "5206", "Compartimento": {
        "NumeroCompartimento": "1", "IndiceRotacionCarteraActual": "0.12",
        "TotalPatrimonio": "9090407.00", "Liquidez": "1220000.00"}}}
    cart = {"Entidad": {"NumeroRegistro": "5206", "Compartimento": {
        "NumeroCompartimento": "1", "InversionesFinancieras": [
            {"ClaseIF": "INTERIOR", "DescripcionIF": "Renta Variable Cotizada", "CodigoISIN": "ES0148396007",
             "DescripcionValor": "ACCIONES|INDITEX", "Divisa": "EUR", "ValorMercado": "718335.00"},
            {"ClaseIF": "EXTERIOR", "DescripcionIF": "Renta Variable Cotizada", "CodigoISIN": "FR0000121014",
             "DescripcionValor": "ACCIONES|Louis Vuitton", "Divisa": "EUR", "ValorMercado": "468750.00"}]}}}
    out: dict = {}
    cnmv._mapea_trimestral(out, trim, "2025-12", "ES0110407006")
    cnmv._mapea_patrimonio(out, pat, "2025-12")
    cnmv._mapea_cartera(out, cart, "2025-12")
    cnmv._cierra_cartera(out, "2025-12")

    c = out["costes"]["cnmv"]
    assert c["comision_gestion_periodo_pct"] == 0.68 and c["periodo_meses"] == 6
    assert c["ter_trimestre_pct"] == 0.37 and c["ter_12m_pct"] == 1.47
    assert out["identificacion"]["vocacion_cnmv"] == "Renta Variable Mixta Internacional"
    assert out["rentabilidad"]["cnmv"]["trimestral_pct"]["trimestre_actual"] == 2.42
    assert out["riesgo"]["cnmv"]["volatilidad_trimestral_pct"]["trimestre_actual"] == 9.66
    assert out["cartera"]["rotacion_pct"] == 0.12
    top = out["cartera"]["cnmv"]["top10_posiciones"]
    assert top[0]["nombre"] == "INDITEX" and top[0]["isin"] == "ES0148396007"
    assert top[0]["peso_pct"] == round(100 * 718335.0 / 9090407.0, 4)
    assert out["cartera"]["cnmv"]["fecha"] == "2025-12-31"
    assert out["cartera"]["cnmv"]["num_posiciones"] == 2
    assert "_posiciones" not in out["cartera"]["cnmv"]


def test_la_cartera_cnmv_se_casa_por_registro_y_compartimento():
    from io import BytesIO
    xml = b"""<?xml version="1.0" encoding="utf-8"?>
<FondCart><FechaDatos>202512</FechaDatos>
<Entidad><Tipo>FI</Tipo><NumeroRegistro>5206</NumeroRegistro>
 <Compartimento><NumeroCompartimento>1</NumeroCompartimento>
  <InversionesFinancieras><ClaseIF>INTERIOR</ClaseIF><DescripcionIF>Renta Variable Cotizada</DescripcionIF>
   <CodigoISIN>ES0148396007</CodigoISIN><DescripcionValor>ACCIONES|INDITEX</DescripcionValor>
   <Divisa>EUR</Divisa><ValorMercado>718335.00</ValorMercado></InversionesFinancieras>
 </Compartimento>
 <Compartimento><NumeroCompartimento>3</NumeroCompartimento>
  <InversionesFinancieras><ClaseIF>INTERIOR</ClaseIF><DescripcionIF>Deuda</DescripcionIF>
   <CodigoISIN>ES0000012F76</CodigoISIN><DescripcionValor>BONO|ESTADO</DescripcionValor>
   <Divisa>EUR</Divisa><ValorMercado>100.00</ValorMercado></InversionesFinancieras>
 </Compartimento>
</Entidad>
<Entidad><Tipo>FI</Tipo><NumeroRegistro>9</NumeroRegistro><Compartimento><NumeroCompartimento>0</NumeroCompartimento></Compartimento></Entidad>
</FondCart>"""
    claves = {("5206", "1"): "ES0110407006"}
    encontrados = cnmv._busca_claves_en_xml(BytesIO(xml), claves)
    assert list(encontrados) == ["ES0110407006"]
    comp = encontrados["ES0110407006"][0]["Entidad"]["Compartimento"]
    assert comp["NumeroCompartimento"] == "1"          # solo el compartimento del ISIN
    assert json.dumps(comp).count("CodigoISIN") == 1
