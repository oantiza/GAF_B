# -*- coding: utf-8 -*-
"""El KID de la gestora se resuelve por ISIN, con espejo de último recurso y sin red.

Se prueba la orquestación (qué fuente se prueba, qué se recuerda, qué se
rechaza) con un HTTP de mentira; el parser del PDF tiene sus propias pruebas.
"""
import datetime
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import kid  # noqa: E402
from core.adquisicion import procedencia  # noqa: E402
from core.http import SinCache  # noqa: E402
from fetchers import kid_gestora  # noqa: E402

PDF = b"%PDF-1.4 falso"


def _kid(isin, sri=4):
    return {"idioma": "es", "isin": isin, "sri": sri, "periodo_mantenimiento_anos": 5,
            "costes": {"entrada_pct": 5.0, "salida_pct": 0.0, "gestion_y_otros_pct": 1.8,
                       "transaccion_pct": 0.2, "rendimiento_pct": 0.0},
            "fecha_documento": "2026-04-27", "productor": "Gestora S.A.",
            "fecha_lanzamiento": None, "sfdr_articulo": "8", "texto_sha256": "abc"}


class _Http:
    """Sirve PDF en las URL cuyo texto contiene alguna de las claves dadas."""

    def __init__(self, sirve=(), sin_red=False, ttl=90.0):
        self.sirve = tuple(sirve)
        self.sin_red = sin_red
        self.ttl = ttl
        self.descargas = []

    def ttl_para(self, familia):
        return self.ttl

    def _anota(self, *a, **k):
        pass

    def download(self, url, destino, force=False, *, headers=None, opcional=False, familia=None):
        self.descargas.append(url)
        if not any(k in url for k in self.sirve):
            return None
        destino = Path(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(PDF)
        return destino


def test_las_fuentes_se_eligen_por_marca_y_el_espejo_va_el_ultimo():
    ids = [f.id for f in kid_gestora.candidatas(kid_gestora.pistas_de(
        {"morningstar_lt": {"identificacion": {"gestora": "DWS", "nombre": "DWS Invest Top Dividend LC"}}}))]
    assert ids == ["dws", "deutsche_bank_es", "renta4_allfunds"]
    ids = [f.id for f in kid_gestora.candidatas(kid_gestora.pistas_de(
        {"_anterior": {"identificacion": {"nombre": "First Eagle Amundi International Fund"}}}))]
    assert ids == ["amundi", "deutsche_bank_es", "renta4_allfunds"]
    ids = [f.id for f in kid_gestora.candidatas(kid_gestora.pistas_de(
        {"cssf": {"identificacion": {"nombre_legal_registro": "JPMORGAN FUNDS-GLOBAL INCOME FUND"}}}))]
    assert ids == ["jpmorgan", "deutsche_bank_es", "renta4_allfunds"]
    # gestora sin patrón conocido: solo el espejo
    assert [f.id for f in kid_gestora.candidatas("fidelity funds - america fund")] == ["deutsche_bank_es", "renta4_allfunds"]


def test_las_url_de_schroders_y_mandg_se_construyen_desde_el_nombre_legal():
    # Con los nombres de la CSSF (compartimento y clase) y la divisa de la clase.
    urls = kid_gestora._schroders("LU0181496216", {
        "compartimento_legal": "EMERGING ASIA", "clase_legal": "A1 ACCUMULATION",
        "divisa_base": "USD", "divisa_compartimento": "USD"})
    assert urls == ["https://api.schroders.com/document-store/SISF_Emerging-Asia-USD_A1-Acc-PRIIPEU-ESES.pdf"]
    # Sin CSSF, desde el nombre de Morningstar; clase cubierta y de reparto.
    urls = kid_gestora._schroders("LU0000000000", {
        "nombre": "Schroder International Selection Fund Global Multi-Asset Income A Distribution EUR Hedged",
        "divisa_base": "EUR"})
    assert urls == ["https://api.schroders.com/document-store/SISF_Global-Multi-asset-Income-EUR-Hedged_A-Dis-PRIIPEU-ESES.pdf"]
    assert kid_gestora._schroders("LU0000000000", {"nombre": "Otra cosa"}) == []

    # La cobertura truncada de Morningstar ("EUR-HEDG", "EUR HEDG.") es la misma
    # clase cubierta que "EUR HEDGED" de la CSSF y tiene que dar la misma URL:
    # sin el "-Hedged" la gestora responde 403 (medido el 30-10-2026).
    cubierta = ("https://api.schroders.com/document-store/"
                "SISF_Global-High-Yield-EUR-Hedged_B-Acc-PRIIPEU-ESES.pdf")
    for clase in ("B ACC EUR HEDGED", "B ACC EUR-HEDG", "B ACC EUR HEDG", "B ACC EUR-HEDG."):
        urls = kid_gestora._schroders("LU0189895229", {
            "compartimento_legal": "GLOBAL HIGH YIELD", "clase_legal": clase,
            "divisa_base": "USD"})
        assert urls[0] == cubierta, clase
    # Y la clase sin cubrir sigue sin llevarlo.
    urls = kid_gestora._schroders("LU0189895229", {
        "compartimento_legal": "GLOBAL HIGH YIELD", "clase_legal": "B ACC EUR", "divisa_base": "USD"})
    assert urls[0] == ("https://api.schroders.com/document-store/"
                       "SISF_Global-High-Yield-EUR_B-Acc-PRIIPEU-ESES.pdf")


def test_la_marca_de_cobertura_se_reconoce_sin_perder_la_clase():
    # "PARTIALLY HEDGED" no es una clase cubierta y no debe construir su URL.
    assert kid_gestora._clase_tipo_divisa("E ACC (EUR-PARTIALLY HEDGED)".split())[3] is False
    # Una "H" suelta sigue pudiendo ser el nombre de la clase.
    assert kid_gestora._clase_tipo_divisa(["H", "ACC", "EUR"])[0] == "H"
    assert kid_gestora._clase_tipo_divisa(["A-H", "ACC", "EUR"]) == ("A", "Acc", "EUR", True)
    assert kid_gestora._clase_tipo_divisa(["A", "ACC", "EUR-HEDG"]) == ("A", "Acc", "EUR", True)
    assert kid_gestora._clase_tipo_divisa(["A", "ACC", "EUR"]) == ("A", "Acc", "EUR", False)

    urls = kid_gestora._mandg("LU1670720462", {
        "compartimento_legal": "M&G (LUX) GLOBAL MACRO BOND FUND", "clase_legal": "C ACC EUR", "divisa_base": "EUR"})
    assert urls == ["https://www.mandg.com/dam/investments/common/es/es/documents/funds-literature/prp/"
                    "(lux)-global-macro-bond-fund_eur_c_acc_es_kiid_spa_pe_lu1670720462.pdf"]
    urls = kid_gestora._mandg("LU1670722161", {"nombre": "M&G (Lux) Global Floating Rate High Yield Fund EUR A-H Acc",
                                              "divisa_base": "EUR"})
    assert urls == ["https://www.mandg.com/dam/investments/common/es/es/documents/funds-literature/prp/"
                    "(lux)-global-floating-rate-high-yield-fund_eur_ah_acc_es_kiid_spa_pe_lu1670722161.pdf"]
    ids = [f.id for f in kid_gestora.candidatas("schroders | schroder international selection fund euro corporate bond")]
    assert ids == ["schroders", "deutsche_bank_es", "renta4_allfunds"]
    ids = [f.id for f in kid_gestora.candidatas("m&g | m&g (lux) global macro bond fund eur c acc")]
    assert ids == ["mandg", "deutsche_bank_es", "renta4_allfunds"]


def test_prueba_la_gestora_y_cae_al_espejo_recordando_el_fallo(tmp_path, monkeypatch):
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: _kid(isin))
    http = _Http(sirve=("deutsche-bank.es",))
    previo = {"morningstar_lt": {"identificacion": {"gestora": "DWS", "nombre": "DWS Invest Gold LC"}}}
    with procedencia.activa("kid_gestora") as reg:
        out = kid_gestora.fetch("LU0273148055", http, {}, base=tmp_path, previo=previo)
    assert out["riesgo"]["sri_kid_1a7"] == 4
    assert out["costes"]["kid"]["gestion_y_otros_pct"] == 1.8
    assert out["documentos_oficiales"]["kid_fuente"] == "deutsche_bank_es"
    assert "codDoc=LU0273148055" in out["documentos_oficiales"]["kid_url"]
    assert out["esg"]["sfdr_articulo"] == "8"
    assert reg.resuelve("riesgo.sri_kid_1a7") == "kid_gestora:deutsche_bank_es"
    # primero se intentó DWS y el 404 quedó apuntado para no repetirlo
    assert http.descargas[0].startswith("https://download.dws.com/")
    misses = list((tmp_path / "cache" / "kid" / "gestoras" / "dws").glob("*.miss"))
    assert len(misses) == 1

    # segunda pasada: el PDF del espejo se relee y DWS no se vuelve a pedir
    http2 = _Http(sirve=("deutsche-bank.es",))
    out2 = kid_gestora.fetch("LU0273148055", http2, {}, base=tmp_path, previo=previo)
    assert out2["riesgo"]["sri_kid_1a7"] == 4
    assert http2.descargas == []


def test_rechaza_el_pdf_que_habla_de_otro_isin(tmp_path, monkeypatch):
    # Franklin Templeton sirve el mismo documento sea cual sea el ISIN del nombre.
    def parsea(ruta, isin):
        return _kid("LU1022656968" if "amundi" in str(ruta) else isin)
    monkeypatch.setattr(kid, "parsea_pdf", parsea)
    http = _Http(sirve=("amundi.es", "deutsche-bank.es"))
    previo = {"morningstar_lt": {"identificacion": {"gestora": "Amundi", "nombre": "Amundi Funds Global Equity"}}}
    out = kid_gestora.fetch("LU1883342377", http, {}, base=tmp_path, previo=previo)
    assert out["documentos_oficiales"]["kid_fuente"] == "deutsche_bank_es"
    assert len(http.descargas) == 2


def test_sin_red_solo_sirve_lo_que_ya_esta_en_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: _kid(isin))
    previo = {"morningstar_lt": {"identificacion": {"gestora": "Nordea", "nombre": "Nordea 1 - Stable Return"}}}
    http = _Http(sirve=(), sin_red=True, ttl=float("inf"))
    assert kid_gestora.fetch("LU0227385266", http, {}, base=tmp_path, previo=previo) == {}
    assert http.descargas == []
    # con el PDF ya descargado (aunque caducado) se relee sin salir a red
    http_on = _Http(sirve=("fundconnect.com",))
    kid_gestora.fetch("LU0227385266", http_on, {}, base=tmp_path, previo=previo)
    pdf = next((tmp_path / "cache" / "kid" / "gestoras" / "nordea").glob("*.pdf"))
    viejo = time.time() - 200 * 86400
    import os
    os.utime(pdf, (viejo, viejo))
    out = kid_gestora.fetch("LU0227385266", http, {}, base=tmp_path, previo=previo)
    assert out["riesgo"]["sri_kid_1a7"] == 4 and http.descargas == []


def test_un_pdf_caducado_se_renueva_y_si_la_red_falla_sigue_valiendo(tmp_path, monkeypatch):
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: _kid(isin))
    previo = {"morningstar_lt": {"identificacion": {"gestora": "JPMorgan", "nombre": "JPM Global Income"}}}
    http = _Http(sirve=("fundsquare.net",))
    kid_gestora.fetch("LU0395794307", http, {}, base=tmp_path, previo=previo)
    pdf = next((tmp_path / "cache" / "kid" / "gestoras" / "jpmorgan").glob("*.pdf"))
    import os
    viejo = time.time() - 200 * 86400
    os.utime(pdf, (viejo, viejo))
    http_roto = _Http(sirve=())          # la red no sirve nada
    out = kid_gestora.fetch("LU0395794307", http_roto, {}, base=tmp_path, previo=previo)
    assert http_roto.descargas and out["riesgo"]["sri_kid_1a7"] == 4


def test_no_pide_nada_si_otra_fuente_oficial_ya_dio_el_kid(tmp_path):
    http = _Http(sirve=("deutsche-bank.es",))
    previo = {"amf_geco": {"riesgo": {"sri_kid_1a7": 3}}}
    assert kid_gestora.fetch("FR0010149120", http, {}, base=tmp_path, previo=previo) == {}
    assert http.descargas == []
    assert kid_gestora.fetch("ES0138371004", http, {}, base=tmp_path, previo={}) == {}


def test_un_kid_caducado_o_un_kiid_ucits_no_pisan_nada(tmp_path, monkeypatch):
    viejo = _kid("LU0000000003")
    viejo["fecha_documento"] = "2023-05-15"
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: viejo)
    http = _Http(sirve=("deutsche-bank.es",))
    assert kid_gestora.fetch("LU0000000003", http, {}, base=tmp_path, previo={}) == {}
    kiid = _kid("LU0000000004")
    kiid["priips"] = False
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: kiid)
    assert kid_gestora.fetch("LU0000000004", http, {}, base=tmp_path, previo={}) == {}
    reciente = _kid("LU0000000005")
    reciente["priips"] = True
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: reciente)
    assert kid_gestora.fetch("LU0000000005", http, {}, base=tmp_path, previo={})["riesgo"]["sri_kid_1a7"] == 4


def test_un_pdf_sin_sri_ni_costes_no_cuenta(tmp_path, monkeypatch):
    datos = _kid("LU0000000001", sri=None)
    datos["costes"] = {k: None for k in datos["costes"]}
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: datos)
    http = _Http(sirve=("deutsche-bank.es",))
    assert kid_gestora.fetch("LU0000000001", http, {}, base=tmp_path, previo={}) == {}


def test_sin_cache_en_modo_sin_red_se_propaga(tmp_path):
    class HttpSinRed(_Http):
        def download(self, *a, **k):
            raise SinCache("sin red")
    http = HttpSinRed()
    # sin_red=False pero download lanza SinCache: el núcleo lo trata como «sin datos»
    try:
        kid_gestora.fetch("LU0000000002", http, {}, base=tmp_path, previo={})
    except SinCache:
        pass
    else:  # pragma: no cover
        raise AssertionError("SinCache debe propagarse al núcleo")


def test_sin_red_la_ficha_sin_cache_de_la_gestora_no_tapa_el_espejo_en_disco(tmp_path, monkeypatch):
    # 14-10-2026: la ficha de Candriam respondió 4xx en la pasada con red (no se
    # cachea) y el KID salió del espejo. La regeneración sin red cortaba en la
    # ficha y perdía el KID aunque el PDF del espejo estaba en disco.
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: _kid(isin))
    isin = "LU0133359157"
    previo = {"morningstar_lt": {"identificacion": {"gestora": "Candriam",
                                                    "nombre": "Candriam Equities L Biotechnology N USD"}}}
    assert [f.id for f in kid_gestora.candidatas(kid_gestora.pistas_de(previo))] == ["candriam", "deutsche_bank_es", "renta4_allfunds"]
    espejo = next(f for f in kid_gestora.FUENTES if f.id == "deutsche_bank_es")
    url = espejo.urls(isin, {})[0]
    pdf = kid_gestora._destino(tmp_path / "cache" / "kid" / "gestoras", espejo, isin, url)
    pdf.parent.mkdir(parents=True, exist_ok=True)
    pdf.write_bytes(PDF)

    class HttpSinRed(_Http):
        def get(self, url, **k):
            raise SinCache(f"sin caché y sin red: {url}")
    http = HttpSinRed(sin_red=True, ttl=float("inf"))
    with procedencia.activa("kid_gestora") as reg:
        out = kid_gestora.fetch(isin, http, {}, base=tmp_path, previo=previo)
    assert out["documentos_oficiales"]["kid_fuente"] == "deutsche_bank_es"
    assert out["riesgo"]["sri_kid_1a7"] == 4
    assert reg.resuelve("riesgo.sri_kid_1a7") == "kid_gestora:deutsche_bank_es"
    assert http.descargas == []
    # Sin el PDF del espejo en disco, la falta de caché sigue llegando al núcleo.
    pdf.unlink()
    try:
        kid_gestora.fetch(isin, http, {}, base=tmp_path, previo=previo)
    except SinCache:
        pass
    else:  # pragma: no cover
        raise AssertionError("SinCache debe propagarse si ninguna candidata sirve")


# --------------------------------------------------------------- parser KID
def test_el_parser_lee_las_maquetas_de_las_gestoras_lu_ie():
    es = ("Documento de datos fundamentales\nRiesgos Hemos clasificado este producto en la categoría 2 de 7, "
          "que representa un grado de riesgo bajo.\nPeríodo de mantenimiento recomendado: 3 años\n"
          "El presente documento se elaboró el 28/07/2026.\n"
          "Sociedad gestora (y fabricante): Franklin Templeton International Services S.à r.l. («FTIS»), "
          "parte del grupo de empresas de Franklin Templeton.\n")
    r = kid.parsea(es)
    assert r["sri"] == 2 and r["fecha_documento"] == "2026-07-28"
    assert r["productor"] == "Franklin Templeton International Services S.à r.l."

    r = kid.parsea("Documento de datos fundamentales\nLa fecha de este documento es 29 abril 2026.\n"
                   "La sociedad gestora es DWS Investment S.A. (productor), un miembro del grupo DWS.\n"
                   "indicador resumido de riesgo\n")
    assert r["fecha_documento"] == "2026-04-29" and r["productor"] == "DWS Investment S.A."

    r = kid.parsea("Documento de datos fundamentales\nEl presente Documento de Datos Fundamentales es exacto a "
                   "21 de agosto de 2026.\nProductor del PRIIP: La gestión del Fondo corresponde a Invesco "
                   "Investment Management Limited\n")
    assert r["fecha_documento"] == "2026-08-21"
    assert r["productor"] == "Invesco Investment Management Limited"

    r = kid.parsea("Documento de datos fundamentales\nFecha de publicación: 30-04-2026\n"
                   "Nombre del Productor del PRIIP: MFS Investment Management Company (Lux) S.à r.l. "
                   "(parte del grupo MFS)\n")
    assert r["fecha_documento"] == "2026-04-30"
    assert r["productor"] == "MFS Investment Management Company (Lux) S.à r.l."

    r = kid.parsea("Documento de datos fundamentales\nEstedocumentosepublicóel22/05/2026.\n"
                   "Sociedad Gestora: Amundi Luxembourg S.A. (en lo sucesivo, «Sociedad Gestora»), miembro\n")
    assert r["fecha_documento"] == "2026-05-22" and r["productor"] == "Amundi Luxembourg S.A."

    r = kid.parsea("Key Information Document\nThe summary risk indicator is a guide to the level of risk.\n"
                   "We have classified this Fund as 4 out of 7, which is a medium risk class.\n"
                   "This KID is accurate as at 19 May 2026.\n")
    assert r["sri"] == 4 and r["fecha_documento"] == "2026-05-19" and r["priips"] is True

    r = kid.parsea("Documento de Datos Fundamentales\nHemos clasificado esta Cartera en la clase de riesgo 4 en una "
                   "escala de 7.\nFecha de elaboración: 2026-06-08\n")
    assert r["sri"] == 4 and r["fecha_documento"] == "2026-06-08"
    r = kid.parsea("Documento de Datos Fundamentales\nEl producto tiene un riesgo de 5 sobre 7, que es una clase de "
                   "riesgo medio alto.\n")
    assert r["sri"] == 5

    # El dígito de la escala gráfica puede quedar pegado a la frase: manda la repetición.
    r = kid.parsea("Documento de datos fundamentales\n1 2 3 4 5 6 7 podamos pagarle. Hemos clasificado este "
                   "producto en la clase de riesgo 1 en una escala de 7, en la que 3 significa un riesgo medio bajo.\n")
    assert r["sri"] == 3

    # Un KID PRIIPs que no dice «resumido» (BNP Paribas, Franklin Templeton) sigue siendo un KID.
    r = kid.parsea("Documento de Datos Fundamentales\nFinalidad\nIndicador de riesgo\nHemos clasificado este "
                   "producto en la clase de riesgo 4 en una escala de 7.\n")
    assert r["priips"] is True and r["sri"] == 4
    # AMF: «classé ce Produit dans l'indicateur de risque 2 sur 7»
    r = kid.parsea("Document d'informations clés\nNous avons classé ce Produit dans l'indicateur de risque 2 sur 7, "
                   "qui est une classe de risque basse.\n")
    assert r["sri"] == 2

    # Un KIID UCITS (SRRI, «Datos fundamentales para el inversor») no es un KID PRIIPs.
    r = kid.parsea("Datos fundamentales para el inversor\nEl presente documento le proporciona los datos "
                   "fundamentales sobre este Fondo.\nPerfil de riesgo y remuneración 1 2 3 4 5 6 7\n"
                   "Este documento es exacto a 7 de febrero de 2018.\n")
    assert r["priips"] is False


def test_el_sri_se_lee_del_grafico_cuando_la_prosa_no_lo_dice(tmp_path):
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((40, 60), "Documento de datos fundamentales indicador resumido de riesgo", fontsize=9)
    x = 60
    for d in range(1, 8):
        if d == 4:
            page.draw_rect(fitz.Rect(x - 8, 130, x + 16, 155), color=None, fill=(0.0, 0.3, 0.6))
            page.insert_text((x, 150), str(d), fontsize=14, color=(1, 1, 1))
        else:
            page.insert_text((x, 150), str(d), fontsize=14, color=(0.2, 0.2, 0.2))
        x += 40
    ruta = tmp_path / "escala.pdf"
    doc.save(str(ruta))
    doc.close()
    assert kid.sri_por_celdas(ruta) == 4
    r = kid.parsea_pdf(ruta)
    assert r["sri"] == 4

    # con el dígito resaltado tapado (no está en el texto) también se deduce
    doc = fitz.open()
    page = doc.new_page()
    x = 60
    for d in range(1, 8):
        if d != 2:
            page.insert_text((x, 150), str(d), fontsize=14)
        x += 40
    ruta2 = tmp_path / "escala2.pdf"
    doc.save(str(ruta2))
    doc.close()
    assert kid.sri_por_celdas(ruta2) == 2


def test_el_espejo_de_renta4_lee_el_enlace_de_su_ficha_por_isin():
    """Dos pasos: la ficha es por ISIN y dentro esta el KID de Allfunds.

    El lote de la URL va por fondo y no se puede construir, asi que lo que hay
    que probar es que la expresion encuentra el enlace de ESE ISIN y no el de
    otro fondo de la misma pagina.
    """
    r4 = next(f for f in kid_gestora.FUENTES if f.id == "renta4_allfunds")
    assert r4.pagina("LU0114723033") ==         "https://www.r4.com/productos-inversion/fondos/fichas/LU0114723033"
    # Identificarse como herramienta es lo que se midio el 30-10-2026.
    assert r4.cabeceras == {"User-Agent": kid_gestora.UA_HERRAMIENTA}

    ficha = (
        '<a href="https://www.r4.com/R4DocFondos/0001.mar?d=afb_kiid/afb_memo/124_0_20140530.pdf">memoria</a>'
        '<a href="https://www.r4.com/R4DocFondos/0001.mar?d=afb_kiid/20260511_084108/1_IE00B11XYW43.pdf">otro fondo</a>'
        '<a href="https://www.r4.com/R4DocFondos/0001.mar?d=afb_kiid/20261023_084058/1_LU0114723033.pdf">DFI</a>'
    )
    m = r4.enlace("LU0114723033").search(ficha)
    assert m and m.group(1) == ("https://www.r4.com/R4DocFondos/0001.mar?"
                               "d=afb_kiid/20261023_084058/1_LU0114723033.pdf")
    # El enlace del vecino no vale, y la memoria de la gestora tampoco.
    assert r4.enlace("LU0000000000").search(ficha) is None
    assert r4.base_enlace == ""   # el href ya es absoluto

    # Es espejo: vale para cualquier gestora y va despues de la suya.
    assert r4.marcas == ()
    assert "renta4_allfunds" in kid_gestora.ESPEJOS


def test_un_pdf_sin_isin_legible_no_es_el_kid_de_nadie(tmp_path, monkeypatch):
    """P3-01 de la auditoría del 20-11-2026: el ISIN dentro del PDF es la garantía de que el documento es de esta clase.
    Antes bastaba con que no hablara de otro, y uno sin ISIN legible pasaba por el KID de quien lo pidiera."""
    sin_isin = _kid(None)
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: sin_isin)
    http = _Http(sirve=("deutsche-bank.es",))
    assert kid_gestora.fetch("LU0000000006", http, {}, base=tmp_path, previo={}) == {}


def test_un_kid_con_una_fecha_imposible_no_pasa_por_vigente(tmp_path, monkeypatch):
    """P3-01: el lector arma la fecha con un día y un mes sueltos, y puede dar el 31 de febrero. Esa fecha no prueba
    que el documento tenga menos de quince meses: antes contaba como de hoy, y se escribía tal cual en la ficha."""
    assert kid_gestora._edad_dias("2026-02-31") == math.inf
    assert kid_gestora._edad_dias("no es una fecha") == math.inf
    # Una fecha buena da su edad en días: del 01-01-2026 a hoy.
    assert kid_gestora._edad_dias("2026-01-01") == (datetime.date.today() - datetime.date(2026, 1, 1)).days
    imposible = _kid("LU0000000007")
    imposible["fecha_documento"] = "2026-02-31"
    monkeypatch.setattr(kid, "parsea_pdf", lambda ruta, isin: imposible)
    http = _Http(sirve=("deutsche-bank.es",))
    assert kid_gestora.fetch("LU0000000007", http, {}, base=tmp_path, previo={}) == {}
