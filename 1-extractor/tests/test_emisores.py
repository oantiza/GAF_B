# -*- coding: utf-8 -*-
"""Emisores por LEI: «un LEI, un emisor» (decisión 8 de DECISIONES_DATOS_2026-11-07).

Los tres casos que pide el encargo: ASML y Alphabet comparten emisor entre sus dos ISIN, una
acción normal tiene el suyo, y una acción sin LEI queda sin emisor y se dice. Y lo que hace
que el id sea un id: no cambia de una pasada a otra.
"""
import datetime as dt
import json
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import emisores  # noqa: E402
from core.http import SinCache  # noqa: E402
from fetchers import gleif  # noqa: E402

LEI_ASML = "724500Y6DUVHQD6OXN27"
LEI_ALPHABET = "5493006MHB84DD0ZWV18"
LEI_AENA = "959800R7QMXKF0NFMT29"
LEI_FANTASMA = "00000000000000000099"


def _registro_gleif(lei, nombre, jurisdiccion, pais_dir, estado="ISSUED", entidad="ACTIVE"):
    return {"data": {"type": "lei-records", "id": lei, "attributes": {
        "lei": lei,
        "entity": {"legalName": {"name": nombre, "language": "en"},
                   "legalAddress": {"country": pais_dir}, "jurisdiction": jurisdiccion,
                   "status": entidad},
        "registration": {"status": estado, "lastUpdateDate": "2026-06-01T10:00:00Z"}}}}


GLEIF = {
    LEI_ASML: _registro_gleif(LEI_ASML, "ASML Holding N.V.", "NL", "NL"),
    LEI_ALPHABET: _registro_gleif(LEI_ALPHABET, "Alphabet Inc.", "US-DE", "US"),
    LEI_AENA: _registro_gleif(LEI_AENA, "AENA S.M.E., S.A.", "ES", "ES"),
}


class _Resp:
    def __init__(self, status, payload):
        self.status, self.text = status, json.dumps(payload)
        self.fetched_at = dt.datetime(2026, 11, 7, tzinfo=dt.timezone.utc).timestamp()

    @property
    def ok(self):
        return 200 <= self.status < 300

    def json(self):
        return json.loads(self.text)


class _Http:
    def __init__(self, respuestas=GLEIF, sin_red=False):
        self.respuestas, self.sin_red, self.pedidas = respuestas, sin_red, []

    def get(self, url, params=None, **_kw):
        self.pedidas.append(url)
        if self.sin_red:
            raise SinCache(f"sin caché y sin red: {url}")
        lei = url.rsplit("/", 1)[-1]
        if lei in self.respuestas:
            return _Resp(200, self.respuestas[lei])
        return _Resp(404, {"errors": [{"status": "404", "title": "Not Found"}]})


# ---------------------------------------------------------------- GLEIF por LEI
def test_gleif_da_nombre_legal_pais_y_estado():
    r = gleif.registro_por_lei(LEI_AENA, _Http())
    assert r["resuelto"] is True
    assert r["nombre_legal"] == "AENA S.M.E., S.A."
    assert r["pais"] == "ES" and r["pais_origen"] == "jurisdiccion"
    assert r["estado_registro"] == "ISSUED" and r["estado_entidad"] == "ACTIVE"
    assert r["gleif_actualizado"] == "2026-06-01" and r["consultado"] == "2026-11-07"


def test_una_jurisdiccion_subnacional_da_su_pais():
    """Alphabet está constituida en Delaware: US-DE es Estados Unidos, y se guarda entera."""
    r = gleif.registro_por_lei(LEI_ALPHABET, _Http())
    assert r["pais"] == "US" and r["jurisdiccion"] == "US-DE"


def test_sin_jurisdiccion_el_pais_es_el_de_la_direccion_legal():
    resp = {LEI_ASML: _registro_gleif(LEI_ASML, "ASML Holding N.V.", "", "NL")}
    r = gleif.registro_por_lei(LEI_ASML, _Http(resp))
    assert r["pais"] == "NL" and r["pais_origen"] == "direccion_legal"


def test_un_lei_que_gleif_no_conoce_no_se_inventa():
    assert gleif.registro_por_lei(LEI_FANTASMA, _Http()) == {
        "lei": LEI_FANTASMA, "resuelto": False, "motivo": "no_existe"}


def test_sin_red_no_es_lo_mismo_que_no_existir():
    r = gleif.registro_por_lei(LEI_AENA, _Http(sin_red=True))
    assert r["resuelto"] is False and r["motivo"].startswith("sin_respuesta")


def test_lo_que_no_es_un_lei_no_se_pregunta():
    http = _Http()
    assert gleif.registro_por_lei("ES0105046017", http)["motivo"] == "no_es_un_lei"
    assert http.pedidas == []


def test_una_respuesta_de_otro_lei_se_rechaza():
    resp = {LEI_AENA: _registro_gleif(LEI_ASML, "ASML Holding N.V.", "NL", "NL")}
    assert gleif.registro_por_lei(LEI_AENA, _Http(resp))["motivo"] == "respuesta_de_otro_lei"


# ---------------------------------------------------------------- el registro de ids
def test_los_ids_nuevos_van_en_orden_de_lei_y_los_viejos_no_se_tocan():
    reg = {LEI_AENA: {"issuer_id": "ISS_000007", "lei": LEI_AENA, "alta": "2026-11-07", "regla": "x"}}
    salida, nuevos = emisores.asigna(reg, [LEI_ASML, LEI_ALPHABET, LEI_AENA], "2026-11-08")
    assert salida[LEI_AENA]["issuer_id"] == "ISS_000007"
    assert nuevos == sorted([LEI_ASML, LEI_ALPHABET])
    assert salida[min(LEI_ASML, LEI_ALPHABET)]["issuer_id"] == "ISS_000008"
    assert salida[max(LEI_ASML, LEI_ALPHABET)]["issuer_id"] == "ISS_000009"


def test_un_numero_no_se_reutiliza_aunque_su_lei_ya_no_este():
    reg = {LEI_AENA: {"issuer_id": "ISS_000003", "lei": LEI_AENA, "alta": "", "regla": ""}}
    salida, _ = emisores.asigna(reg, [LEI_ASML], "2026-11-08")
    assert salida[LEI_ASML]["issuer_id"] == "ISS_000004"
    assert LEI_AENA in salida


def test_un_registro_con_un_id_repetido_para_la_pasada(tmp_path):
    ruta = tmp_path / emisores.RUTA_REGISTRO
    ruta.parent.mkdir(parents=True)
    ruta.write_text("issuer_id,lei,alta,regla\n"
                    f"ISS_000001,{LEI_AENA},2026-11-07,x\nISS_000001,{LEI_ASML},2026-11-07,x\n",
                    encoding="utf-8")
    with pytest.raises(emisores.ErrorRegistro, match="ya es de otro LEI"):
        emisores.lee_registro(tmp_path)


# ---------------------------------------------------------------- valid_from
def test_valid_from_es_la_primera_negociacion_con_admision():
    """El caso de Aena 017: MTAH dice 2023 sin admisión y no cuenta."""
    fecha, base = emisores._valid_from([
        {"mic": "MTAH", "primera_negociacion": "2023-11-15"},
        {"mic": "XMAD", "admision": "2025-06-19", "primera_negociacion": "2025-06-19"}])
    assert fecha == "2025-06-19" and "admision solicitada" in base


def test_sin_centro_con_admision_vale_la_mas_antigua_y_se_dice():
    fecha, base = emisores._valid_from([
        {"mic": "XETB", "primera_negociacion": "2019-03-01"},
        {"mic": "TQEX", "primera_negociacion": "2018-07-02"}])
    assert fecha == "2018-07-02" and "ninguno tiene admision" in base


def test_el_1900_de_francfort_es_un_centinela_y_no_una_fecha():
    """Deutsche Bank: FRAA dice 1900-01-01 con admisión 1899-12-31; XETA, 1999-08-30."""
    fecha, base = emisores._valid_from([
        {"mic": "FRAA", "admision": "1899-12-31", "primera_negociacion": "1900-01-01"},
        {"mic": "XETA", "admision": "1899-12-31", "primera_negociacion": "1999-08-30"},
        {"mic": "HAMA", "admision": "1999-11-02", "primera_negociacion": "1999-11-05"}])
    assert fecha == "1999-08-30" and "admision solicitada" in base


def test_solo_con_centinelas_no_hay_fecha():
    assert emisores._valid_from([{"mic": "FRAA", "admision": "1899-12-31",
                                  "primera_negociacion": "1900-01-01"}])[0] is None


# ---------------------------------------------------------------- la pasada entera
def _canonico(base: Path, isin, nombre, lei, ticker="X", bolsa="US", divisa="USD", tipo="stock"):
    carpeta = base / "export_bdb"
    carpeta.mkdir(parents=True, exist_ok=True)
    firds = {"lei_emisor": lei, "visto": "2026-10-31",
             "mercados": [{"mic": "XAMS", "admision": "2012-11-26", "primera_negociacion": "2012-11-26"}]}
    (carpeta / f"{isin}.json").write_text(json.dumps({
        "isin": isin, "name": nombre, "currency": divisa,
        "classification_v2": {"asset_type": tipo},
        "ms": {"stock": {"ticker": ticker, "exchange": bolsa}},
        **({"identidad_firds": firds} if lei else {})}), encoding="utf-8")


@pytest.fixture
def universo(tmp_path):
    _canonico(tmp_path, "NL0010273215", "ASML Holding NV", LEI_ASML, "ASML", "AS", "EUR")
    _canonico(tmp_path, "USN070592100", "ASML Holding NV ADR", LEI_ASML, "ASML", "US")
    _canonico(tmp_path, "US02079K3059", "Alphabet Inc Class A", LEI_ALPHABET, "GOOGL")
    _canonico(tmp_path, "US02079K1079", "Alphabet Inc Class C", LEI_ALPHABET, "GOOG")
    _canonico(tmp_path, "ES0105046017", "Aena SA", LEI_AENA, "AENA", "MC", "EUR")
    _canonico(tmp_path, "ES0161560018", "NH Hoteles", None, "NHH", "MC", "EUR")
    _canonico(tmp_path, "IE00BZCQB185", "iShares MSCI India", "549300X3E2OHXXVCRP94", tipo="equity")
    (tmp_path / "export_bdb" / "_resumen.json").write_text("{}", encoding="utf-8")
    return tmp_path


def test_asml_y_alphabet_comparten_emisor_entre_sus_dos_isin(universo):
    r = emisores.pasada(universo, _Http(), hoy="2026-11-07")
    por_isin = {e["isin"]: e["issuer_id"] for e in r["enlaces"]}
    assert por_isin["NL0010273215"] == por_isin["USN070592100"]
    assert por_isin["US02079K3059"] == por_isin["US02079K1079"]
    assert por_isin["NL0010273215"] != por_isin["US02079K3059"]
    asml = next(e for e in r["emisores"] if e["lei"] == LEI_ASML)
    assert asml["isins"] == ["NL0010273215", "USN070592100"] and asml["pais"] == "NL"


def test_una_accion_normal_tiene_su_emisor_y_su_vinculo(universo):
    r = emisores.pasada(universo, _Http(), hoy="2026-11-07")
    aena = next(e for e in r["enlaces"] if e["isin"] == "ES0105046017")
    assert aena["role"] == "EQUITY_ISSUER"
    assert aena["reference_listing"] == "AENA.MC" and aena["reference_currency"] == "EUR"
    assert aena["valid_from"] == "2012-11-26"
    assert aena["decided_at"] == "2026-11-07" and "decision 8" in aena["decided_by"]
    assert LEI_AENA in aena["reason"]
    emisor = next(e for e in r["emisores"] if e["issuer_id"] == aena["issuer_id"])
    assert emisor["nombre_legal"] == "AENA S.M.E., S.A." and emisor["isins"] == ["ES0105046017"]


def test_una_accion_sin_lei_queda_sin_emisor_y_se_dice(universo):
    r = emisores.pasada(universo, _Http(), hoy="2026-11-07")
    assert "ES0161560018" not in {e["isin"] for e in r["enlaces"]}
    assert r["sin_lei"] == [{"isin": "ES0161560018", "nombre": "NH Hoteles",
                             "motivo": "FIRDS no trae LEI en su ficha"}]


def test_solo_entran_acciones(universo):
    r = emisores.pasada(universo, _Http(), hoy="2026-11-07")
    assert r["cuentas"] == {"acciones": 6, "con_lei": 5, "leis_distintos": 3, "emisores": 3,
                            "enlaces": 5, "sin_lei": 1, "lei_sin_gleif": 0, "sin_fecha": 0,
                            "ids_nuevos": 3}


def test_el_id_no_cambia_de_una_pasada_a_otra(universo):
    primera = emisores.pasada(universo, _Http(), hoy="2026-11-07")
    _canonico(universo, "AA0000000005", "Nueva SA", "AAAAAAAAAAAAAAAAAA05")
    nuevo = {**GLEIF, "AAAAAAAAAAAAAAAAAA05": _registro_gleif("AAAAAAAAAAAAAAAAAA05", "Nueva S.A.", "ES", "ES")}
    segunda = emisores.pasada(universo, _Http(nuevo), hoy="2026-11-08")
    antes = {e["lei"]: e["issuer_id"] for e in primera["emisores"]}
    despues = {e["lei"]: e["issuer_id"] for e in segunda["emisores"]}
    assert all(despues[lei] == iid for lei, iid in antes.items())
    assert despues["AAAAAAAAAAAAAAAAAA05"] == "ISS_000004"
    assert segunda["cuentas"]["ids_nuevos"] == 1
    assert (universo / emisores.RUTA_REGISTRO).read_text(encoding="utf-8").count("ISS_") == 4


def test_un_lei_que_gleif_no_resuelve_no_tiene_id_ni_emisor(universo):
    sin_aena = {k: v for k, v in GLEIF.items() if k != LEI_AENA}
    r = emisores.pasada(universo, _Http(sin_aena), hoy="2026-11-07")
    assert [x["isin"] for x in r["lei_sin_gleif"]] == ["ES0105046017"]
    assert r["lei_sin_gleif"][0]["motivo"] == "no_existe"
    assert LEI_AENA not in emisores.lee_registro(universo)


def test_sin_red_y_sin_cache_no_se_escribe_ningun_id(universo):
    r = emisores.pasada(universo, _Http(sin_red=True), hoy="2026-11-07")
    assert r["emisores"] == [] and r["cuentas"]["lei_sin_gleif"] == 5
    assert not (universo / emisores.RUTA_REGISTRO).exists()
