# -*- coding: utf-8 -*-
"""ESMA FIRDS: el índice local, el tipo que dice el CFI y la lista de candidatos.

Sin red, como todas: los ficheros de ESMA se sustituyen por tres XML sintéticos en
`tests/fixtures/firds/` con la forma de `auth.017` (un completo de acciones, uno de
vehículos de inversión colectiva y un delta), y el índice Solr por respuestas fijas.
"""
import datetime as dt
import hashlib
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import procedencia, registro  # noqa: E402
from fetchers import esma_firds  # noqa: E402

FIXT = RAIZ / "tests" / "fixtures" / "firds"
HOY = dt.date(2026, 11, 6)


# ----------------------------------------------------------------- utilidades
def _zip(xml: Path, destino: Path) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(xml, arcname=xml.name)
    return destino


def _md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()  # noqa: S324


class _Resp:
    def __init__(self, datos, status=200):
        self._d, self.status = datos, status

    @property
    def ok(self):
        return self.status == 200

    def json(self):
        return self._d


class _HttpFalso:
    """Índice Solr con respuestas fijas y descargas que copian ZIP locales."""

    def __init__(self, origen: Path, docs: list[dict]):
        self.origen, self.docs, self.descargas = origen, docs, []

    def get(self, url, params=None, **_k):
        tipo = "FULINS" if "FULINS" in (params or {}).get("fq", "") else "DLTINS"
        return _Resp({"response": {"docs": [d for d in self.docs if d["file_type"] == tipo]}})

    def download(self, url, destino, force=False, **_k):
        self.descargas.append(url)
        destino = Path(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(self.origen / Path(url).name, destino)
        return destino


@pytest.fixture
def entorno(tmp_path):
    """Un proyecto falso con los tres ZIP «publicados» y su índice Solr."""
    origen = tmp_path / "esma"
    e = _zip(FIXT / "FULINS_E_sintetico.xml", origen / "FULINS_E_20261031_01of01.zip")
    c = _zip(FIXT / "FULINS_C_sintetico.xml", origen / "FULINS_C_20261031_01of01.zip")
    d = _zip(FIXT / "DLTINS_sintetico.xml", origen / "DLTINS_20261105_01of01.zip")
    docs = [
        {"file_name": e.name, "file_type": "FULINS", "checksum": _md5(e),
         "download_link": f"https://firds.esma.europa.eu/firds/{e.name}"},
        {"file_name": c.name, "file_type": "FULINS", "checksum": _md5(c),
         "download_link": f"https://firds.esma.europa.eu/firds/{c.name}"},
        {"file_name": d.name, "file_type": "DLTINS", "checksum": _md5(d),
         "download_link": f"https://firds.esma.europa.eu/firds/{d.name}"},
    ]
    base = tmp_path / "proyecto"
    base.mkdir()
    return base, _HttpFalso(origen, docs)


# ----------------------------------------------------------------- CFI
@pytest.mark.parametrize("cfi,tipo", [
    ("ESVUFR", "ACCION"), ("EPNXXR", "ACCION"), ("EDSXFR", "ACCION"), ("ECVXXX", "ACCION"),
    # Un ETC (iShares Physical Gold, IE00B4ND3602) y un certificado: estructurados, no acciones
    ("EYAYFT", "ESTRUCTURADO"), ("EYXXXX", "ESTRUCTURADO"), ("EMXXXX", "OTRO"),
    ("CEOGLS", "ETF"), ("CIOGLS", "FONDO"), ("CBOIXS", "FONDO"),
    ("DBFTFR", "DEUDA"), ("DTZXXB", "DEUDA"),
    ("RWSNCA", "OTRO"), ("OCASPS", "OTRO"),
])
def test_tipo_por_cfi(cfi, tipo):
    assert esma_firds.cfi_tipo(cfi) == tipo


@pytest.mark.parametrize("malo", ["", None, "XX", "ESVUF", "ESVUFR1", "ES-UFR", "123456"])
def test_un_cfi_malformado_no_tiene_tipo(malo):
    assert esma_firds.cfi_tipo(malo) is None


# ----------------------------------------------------------------- lectura
def test_recorre_en_streaming_un_registro_por_instrumento_y_centro():
    regs = list(esma_firds.recorre(str(FIXT / "FULINS_E_sintetico.xml")))
    assert [(r["isin"], r["mic"]) for r in regs] == [
        ("ES0000000001", "XMAD"), ("ES0000000001", "XETA"),
        ("DE0000000002", "XETA"), ("DE0000000002", "TGAT"),
        ("FR0000000005", "XPAR"), ("FR0000000005", "XETA"),
        ("XS0000000006", "XMAD"), ("NL0000000007", "XAMS"),
    ]
    santander = regs[0]
    assert santander["nombre"] == "Banco de Prueba S.A."
    assert santander["cfi"] == "ESVUFR" and santander["tipo"] == "ACCION"
    assert santander["lei"] == "959800R8UT9ZH0F7M311"
    assert santander["admision"] == "2000-01-02" and santander["primera_negociacion"] == "2000-01-03"
    assert santander["autoridad"] == "ES" and santander["baja"] is None
    assert regs[2]["nombre"] == "Prüfgesellschaft für Ölmühlen AG"   # acentos intactos
    assert regs[4]["baja"] == "2025-06-30"


def test_el_indice_guarda_solo_acciones_y_vehiculos_colectivos(entorno, tmp_path):
    con = esma_firds.abre(tmp_path / "i.sqlite")
    c = esma_firds.aplica(con, esma_firds.recorre(str(FIXT / "FULINS_E_sintetico.xml")), "2026-10-31")
    assert c == {"leidos": 8, "guardados": 6, "anulados": 0, "fuera_de_categoria": 2}
    isins = {r[0] for r in con.execute("SELECT isin FROM instrumentos")}
    assert isins == {"ES0000000001", "DE0000000002", "FR0000000005"}   # ni el bono ni el CFI roto
    assert con.execute("SELECT count(*) FROM mercados").fetchone()[0] == 6


# ----------------------------------------------------------------- construcción
def test_construye_desde_el_completo_y_aplica_el_delta(entorno):
    base, http = entorno
    r = esma_firds.construye(http, base, hasta=HOY)
    assert r["completo"] == "2026-10-31"
    assert [f["nombre"] for f in r["ficheros"]] == ["FULINS_E_20261031_01of01.zip",
                                                    "FULINS_C_20261031_01of01.zip"]
    assert [d["nombre"] for d in r["deltas"]] == ["DLTINS_20261105_01of01.zip"]
    con = esma_firds.abre(base / esma_firds.RUTA_INDICE)
    # NewRcrd: entra la italiana (MTAA: Borsa Italiana reporta por segmento, no XMIL)
    assert esma_firds.ficha(con, "IT0000000009")["mercados"][0]["mic"] == "MTAA"
    # ModfdRcrd: el ETF gana Milán sin perder Xetra ni Ámsterdam
    assert [m["mic"] for m in esma_firds.ficha(con, "IE0000000003")["mercados"]] == ["MTAA", "XAMS", "XETA"]
    # TermntdRcrd: la baja en Tradegate se guarda; no se borra nada
    de = esma_firds.ficha(con, "DE0000000002")
    assert {m["mic"]: m["baja"] for m in de["mercados"]} == {"TGAT": "2026-11-04", "XETA": None}
    # CancRcrd: el registro anulado de Xetra se retira; Madrid se queda
    assert [m["mic"] for m in esma_firds.ficha(con, "ES0000000001")["mercados"]] == ["XMAD"]
    assert esma_firds.meta(con, "ultimo_delta") == "2026-11-05"


def test_un_delta_ya_aplicado_no_se_vuelve_a_aplicar(entorno):
    base, http = entorno
    esma_firds.construye(http, base, hasta=HOY)
    n = len(http.descargas)
    r = esma_firds.construye(http, base, hasta=HOY)
    assert r["deltas"] == [] and r["ficheros"] == []
    assert len(http.descargas) == n          # ni el completo ni el delta se piden otra vez


def test_un_completo_nuevo_sustituye_al_indice_vigente(entorno):
    """Reconstruir sobre un índice que ya existe tiene que poder reemplazarlo.

    Defecto medido el 09-11-2026: la comprobación del completo vigente abría el índice y no
    cerraba la conexión, y en Windows `tmp.replace(indice)` fallaba con PermissionError.
    """
    base, http = entorno
    esma_firds.construye(http, base, hasta=HOY)
    for cat in ("E", "C"):
        z = _zip(FIXT / f"FULINS_{cat}_sintetico.xml",
                 http.origen / f"FULINS_{cat}_20261107_01of01.zip")
        http.docs.append({"file_name": z.name, "file_type": "FULINS", "checksum": _md5(z),
                          "download_link": f"https://firds.esma.europa.eu/firds/{z.name}"})
    r = esma_firds.construye(http, base, hasta=dt.date(2026, 11, 9), deltas=False)
    assert r["completo"] == "2026-11-07"
    assert [f["nombre"] for f in r["ficheros"]] == ["FULINS_E_20261107_01of01.zip",
                                                    "FULINS_C_20261107_01of01.zip"]
    indice = base / esma_firds.RUTA_INDICE
    assert not indice.with_suffix(".tmp").exists()
    con = esma_firds.abre(indice)
    try:
        assert esma_firds.meta(con, "completo") == "2026-11-07"
        assert esma_firds.meta(con, "deltas") == ""        # los del completo anterior no cuentan
    finally:
        con.close()


def test_una_suma_md5_distinta_rechaza_el_fichero(entorno):
    base, http = entorno
    http.docs[1]["checksum"] = "0" * 32
    with pytest.raises(RuntimeError, match="MD5"):
        esma_firds.construye(http, base, hasta=HOY)
    assert not (base / esma_firds.RUTA_INDICE).exists()   # ni índice a medias


def test_un_completo_al_que_le_falta_una_parte_no_vale():
    fich = [{"tipo": "FULINS", "fecha": "2026-10-31", "categoria": "E", "parte": 1, "partes": 2},
            {"tipo": "FULINS", "fecha": "2026-10-31", "categoria": "C", "parte": 1, "partes": 1},
            {"tipo": "FULINS", "fecha": "2026-10-24", "categoria": "E", "parte": 1, "partes": 1},
            {"tipo": "FULINS", "fecha": "2026-10-24", "categoria": "C", "parte": 1, "partes": 1}]
    elegidos = esma_firds.ultimo_completo(fich)
    assert {f["fecha"] for f in elegidos} == {"2026-10-24"}


# ----------------------------------------------------------------- adaptador
@pytest.fixture
def construido(entorno):
    base, http = entorno
    esma_firds.construye(http, base, hasta=HOY)
    return base


def test_el_adaptador_escribe_con_procedencia_firds_y_nada_mas(construido):
    with procedencia.activa("esma_firds") as reg:
        out = esma_firds.fetch("IE0000000003", base=construido, hoy=HOY)
    escritas = set(reg.rutas)
    declaradas = set(registro.ESMA_FIRDS.capacidades)
    assert escritas <= declaradas
    assert all(v == "esma_firds:fulins" for v in reg.rutas.values())
    ident = out["identificacion"]
    assert ident["cfi"] == "CEOGLS" and ident["cfi_tipo"] == "ETF"
    assert ident["divisa_nominal_firds"] == "USD"
    assert ident["lei_emisor"] == "549300PRUEBA0000IE03"
    assert [m["mic"] for m in ident["mercados_ue"]] == ["MTAA", "XAMS", "XETA"]
    # No pisa lo que el sistema ya tiene: ni nombre, ni divisa, ni tipo
    assert "nombre" not in ident and "divisa_base" not in ident and "tipo" not in ident
    assert "baja_en_todos_firds" not in ident


def test_dado_de_baja_en_todos_se_marca_y_no_se_borra(construido):
    out = esma_firds.fetch("FR0000000005", base=construido, hoy=HOY)
    assert out["identificacion"]["baja_en_todos_firds"] == "2025-07-15"
    assert "disponibilidad" not in out.get("meta", {})   # la marca la pone la fuente del precio
    con = esma_firds.abre(construido / esma_firds.RUTA_INDICE)
    assert esma_firds.ficha(con, "FR0000000005") is not None


def test_una_baja_en_un_solo_centro_no_es_una_baja(construido):
    out = esma_firds.fetch("DE0000000002", base=construido, hoy=HOY)
    assert "baja_en_todos_firds" not in out["identificacion"]


def test_una_baja_futura_no_cuenta():
    assert esma_firds.baja_en_todos([{"baja": "2026-12-31"}], HOY) is None
    assert esma_firds.baja_en_todos([{"baja": "2026-01-31"}, {"baja": None}], HOY) is None
    assert esma_firds.baja_en_todos([], HOY) is None


def test_lo_que_firds_no_tiene_no_devuelve_nada(construido):
    assert esma_firds.fetch("LU9999999999", base=construido, hoy=HOY) == {}


def test_sin_indice_no_sale_a_red_ni_falla(tmp_path):
    assert esma_firds.fetch("IE0000000003", base=tmp_path) == {}


def test_los_centros_por_defecto_son_de_segmento():
    # FIRDS no tiene filas en XETR ni en XMIL (medido el 06-11-2026): un MIC de operador en
    # la lista por defecto dejaría Alemania e Italia fuera sin aviso.
    assert "XETR" not in esma_firds.MIC_POR_DEFECTO and "XMIL" not in esma_firds.MIC_POR_DEFECTO
    assert {"XETA", "MTAA", "ETFP"} <= set(esma_firds.MIC_POR_DEFECTO)
    assert "XETB" not in esma_firds.MIC_POR_DEFECTO      # Xetra para valores extranjeros


def test_esta_registrado_como_oficial_y_para_todos_los_tipos():
    a = registro.por_id()["esma_firds"]
    assert a.oficial
    assert all(a.aplica(i, t) for i, t in [("ES0000000001", "accion"), ("IE0000000003", "etf"),
                                            ("LU0000000008", "fondo")])


# ----------------------------------------------------------------- universo
@pytest.fixture
def proyecto(construido):
    (construido / "config").mkdir()
    (construido / "config" / "fondos.csv").write_text(
        "isin,nombre,tipo\nES0000000001,Banco de Prueba,accion\nLU0000000008,Europa RV ETF,fondo\n",
        encoding="utf-8")
    return construido


def _universo(monkeypatch, base, *args):
    import main
    monkeypatch.setattr(main, "BASE", base)
    monkeypatch.setattr(sys, "argv", ["main.py", "universo", "--fecha", HOY.isoformat(), *args])
    assert main.main() == 0
    import csv
    with (base / "reports" / f"universo_firds_{HOY.isoformat()}.csv").open(encoding="utf-8") as f:
        return {r["isin"]: r for r in csv.DictReader(f)}


def test_universo_filtra_por_centro_y_tipo(monkeypatch, proyecto):
    filas = _universo(monkeypatch, proyecto)
    # Por defecto, acciones y ETF en los centros del alcance: la francesa está de baja en todos
    assert set(filas) == {"ES0000000001", "DE0000000002", "IE0000000003", "IT0000000009"}
    assert filas["DE0000000002"]["mics_en_alcance"] == "XETA"       # Tradegate no está en el alcance
    assert filas["IE0000000003"]["tipo_cfi"] == "ETF"
    assert filas["ES0000000001"]["en_universo"] == "si"
    assert filas["IT0000000009"]["en_universo"] == "no"


def test_universo_con_fondos_saca_la_discrepancia_de_tipo(monkeypatch, proyecto):
    filas = _universo(monkeypatch, proyecto, "--tipos", "FONDO", "--mercados", "XETA")
    lu = filas["LU0000000008"]
    assert lu["tipo_cfi"] == "FONDO" and lu["tipo_sistema"] == "fondo" and lu["en_universo"] == "si"


def test_universo_incluye_bajas_solo_si_se_pide(monkeypatch, proyecto):
    filas = _universo(monkeypatch, proyecto, "--tipos", "ACCION", "--mercados", "XPAR", "--incluir-bajas")
    assert filas["FR0000000005"]["baja_en_todos"] == "2025-07-15"


def test_universo_no_toca_el_universo_ni_el_canonico(monkeypatch, proyecto):
    csv_ = proyecto / "config" / "fondos.csv"
    antes = (csv_.read_bytes(), csv_.stat().st_mtime_ns)
    _universo(monkeypatch, proyecto)
    assert (csv_.read_bytes(), csv_.stat().st_mtime_ns) == antes
    assert not (proyecto / "data").exists() and not (proyecto / "export").exists()


def test_un_tipo_desconocido_se_rechaza(monkeypatch, proyecto):
    import main
    monkeypatch.setattr(main, "BASE", proyecto)
    monkeypatch.setattr(sys, "argv", ["main.py", "universo", "--tipos", "BONO"])
    assert main.main() == 1


# ----------------------------------------------------------------- nombre por regla
def _xml(destino: Path, registros: list[tuple], fecha: str = "2026-11-07") -> Path:
    """Un completo sintético con la forma de `auth.017`: tuplas (isin, mic, nombre, primera
    negociación o None, centro relevante, autoridad, cfi)."""
    cuerpo = []
    for isin, mic, nombre, primera, relevante, autoridad, cfi in registros:
        primera_xml = f"<FrstTradDt>{primera}T00:00:00Z</FrstTradDt>" if primera else ""
        cuerpo.append(
            f"<RefData><FinInstrmGnlAttrbts><Id>{isin}</Id><FullNm>{nombre}</FullNm>"
            f"<ShrtNm>CORTO</ShrtNm><ClssfctnTp>{cfi}</ClssfctnTp><NtnlCcy>EUR</NtnlCcy>"
            f"</FinInstrmGnlAttrbts><Issr>959800R8UT9ZH0F7M311</Issr>"
            f"<TradgVnRltdAttrbts><Id>{mic}</Id>{primera_xml}</TradgVnRltdAttrbts>"
            f"<TechAttrbts><RlvntCmptntAuthrty>{autoridad}</RlvntCmptntAuthrty>"
            f"<RlvntTradgVn>{relevante}</RlvntTradgVn></TechAttrbts></RefData>")
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<BizData xmlns="urn:iso:std:iso:20022:tech:xsd:head.003.001.01"><Pyld>'
        '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:auth.017.001.02"><FinInstrmRptgRefDataRpt>'
        f"<RptHdr><RptgPrd><Dt>{fecha}</Dt></RptgPrd></RptHdr>{''.join(cuerpo)}"
        "</FinInstrmRptgRefDataRpt></Document></Pyld></BizData>", encoding="utf-8")
    return destino


#: Santander tal como lo reportan tres centros (nombres reales del completo del 07-11-2026):
#: Fráncfort es el más antiguo y Madrid el centro relevante que fija la autoridad.
SANTANDER = [
    ("ES0113900J37", "FRAA", "BCO SANTANDER N.EO0,5", "1999-01-04", "XMAD", "ES", "ESVUFR"),
    ("ES0113900J37", "XMAD", "BANCO SANTANDER S.A.", "2001-06-01", "XMAD", "ES", "ESVUFR"),
    ("ES0113900J37", "XETA", "BANCO SANTANDER S.A. ACCIONES NOM. EO 0,50", "2005-05-02",
     "XMAD", "ES", "ESVUFR"),
]


def _nombre_tras_leer(tmp_path, registros, nombre) -> str:
    con = esma_firds.abre(tmp_path / f"{nombre}.sqlite")
    try:
        esma_firds.aplica(con, esma_firds.recorre(str(_xml(tmp_path / f"{nombre}.xml", registros))),
                          "2026-11-07")
        return con.execute("SELECT nombre FROM instrumentos WHERE isin = 'ES0113900J37'").fetchone()[0]
    finally:
        con.close()


def test_el_nombre_no_depende_del_orden_de_lectura(tmp_path):
    """Con `INSERT OR REPLACE` ganaba el último registro leído: el orden decidía el nombre."""
    ordenes = [SANTANDER, list(reversed(SANTANDER)), [SANTANDER[1], SANTANDER[2], SANTANDER[0]]]
    nombres = {_nombre_tras_leer(tmp_path, o, f"o{i}") for i, o in enumerate(ordenes)}
    assert nombres == {"BANCO SANTANDER S.A."}


def test_el_orden_de_los_ficheros_tampoco_cambia_el_nombre(tmp_path):
    def con_ficheros(orden, nombre):
        con = esma_firds.abre(tmp_path / f"{nombre}.sqlite")
        try:
            for i in orden:
                xml = _xml(tmp_path / f"{nombre}_{i}.xml", [SANTANDER[i]])
                esma_firds.aplica(con, esma_firds.recorre(str(xml)), "2026-11-07")
            return con.execute("SELECT nombre FROM instrumentos").fetchone()[0]
        finally:
            con.close()
    assert con_ficheros([0, 1, 2], "a") == con_ficheros([2, 1, 0], "b") == "BANCO SANTANDER S.A."


def test_manda_el_centro_relevante_y_no_el_mas_antiguo(tmp_path):
    # Fráncfort negocia desde antes, pero el registro dice que el centro relevante es Madrid
    assert _nombre_tras_leer(tmp_path, SANTANDER, "r") == "BANCO SANTANDER S.A."


def test_la_autoridad_es_del_instrumento_y_no_separa_centros():
    """Medido el 09-11-2026: ningún ISIN del completo trae dos autoridades entre sus registros.
    Por eso la regla no la usa para elegir centro: todos coinciden o ninguno."""
    regs = list(esma_firds.recorre(str(FIXT / "FULINS_E_sintetico.xml")))
    por_isin: dict = {}
    for r in regs:
        por_isin.setdefault(r["isin"], set()).add(r["autoridad"])
    assert all(len(a) == 1 for a in por_isin.values())
    assert regs[0]["centro_relevante"] == "XMAD"     # el campo que sí señala un centro


@pytest.mark.parametrize("centros,esperado", [
    # sin centro relevante entre los suyos: el de primera negociación más antigua
    ([("XETA", "B", "2005-01-01", "XPAR"), ("XMAD", "A", "2001-01-01", "XPAR")], "A"),
    # la fecha centinela de Fráncfort («desde siempre») no cuenta como antigua; tampoco su falta
    ([("FRAA", "F", "1900-01-01", None), ("XMAD", "M", "2001-01-01", None),
      ("TGAT", "T", None, None)], "M"),
    # a igual fecha, el MIC en orden alfabético
    ([("XPAR", "P", "2001-01-01", None), ("XAMS", "A", "2001-01-01", None)], "A"),
    # sin fecha en ninguno, también por MIC
    ([("XPAR", "P", None, None), ("XAMS", "A", None, None)], "A"),
    # un centro sin nombre no cuenta, aunque sea el relevante
    ([("XMAD", None, "1990-01-01", "XMAD"), ("XETA", "E", "2005-01-01", "XMAD")], "E"),
    ([("XMAD", None, "1990-01-01", None)], None),
])
def test_la_regla_del_nombre_paso_a_paso(centros, esperado):
    assert esma_firds.elige_nombre(centros) == esperado
    assert esma_firds.elige_nombre(list(reversed(centros))) == esperado


def test_una_anulacion_recalcula_el_nombre(tmp_path):
    con = esma_firds.abre(tmp_path / "i.sqlite")
    try:
        xml = _xml(tmp_path / "c.xml", SANTANDER)
        esma_firds.aplica(con, esma_firds.recorre(str(xml)), "2026-11-07")
        anulado = {"operacion": "CancRcrd", "isin": "ES0113900J37", "mic": "XMAD", "cfi": "ESVUFR"}
        esma_firds.aplica(con, iter([anulado]), "2026-11-08")
        # sin Madrid, el relevante no está: manda el más antiguo, Fráncfort
        assert con.execute("SELECT nombre FROM instrumentos").fetchone()[0] == "BCO SANTANDER N.EO0,5"
        assert con.execute("SELECT count(*) FROM nombres WHERE mic = 'XMAD'").fetchone()[0] == 0
    finally:
        con.close()


# ----------------------------------------------------------------- plazas al reconstruir
def _publica_completo(http, tmp_path, registros_e: list[tuple], fecha: str = "20261107"):
    """Publica en el índice Solr falso un completo nuevo: E a medida y C como el anterior."""
    xml_e = _xml(tmp_path / "nuevo" / f"FULINS_E_{fecha}.xml", registros_e)
    for cat, xml in (("E", xml_e), ("C", FIXT / "FULINS_C_sintetico.xml")):
        z = _zip(xml, http.origen / f"FULINS_{cat}_{fecha}_01of01.zip")
        http.docs.append({"file_name": z.name, "file_type": "FULINS", "checksum": _md5(z),
                          "download_link": f"https://firds.esma.europa.eu/firds/{z.name}"})


def _lee_plazas(base: Path) -> tuple[str, list[dict]]:
    import csv
    ficheros = sorted((base / esma_firds.RUTA_PLAZAS).glob("*.csv"))
    assert len(ficheros) == 1
    with ficheros[0].open(encoding="utf-8") as f:
        return ficheros[0].name, list(csv.DictReader(f))


def test_un_completo_con_menos_centros_deja_registro_de_las_plazas_perdidas(entorno, tmp_path):
    """El caso de Standard Chartered: los deltas habían añadido centros que el completo no trae.

    Índice vigente (completo del 31-10 y delta del 05-11): ES XMAD; DE XETA y TGAT; FR XPAR y
    XETA; IE MTAA, XAMS y XETA; IT MTAA; LU XETA. El completo nuevo trae menos.
    """
    base, http = entorno
    esma_firds.construye(http, base, hasta=HOY)
    _publica_completo(http, tmp_path, [
        ("ES0000000001", "XMAD", "Banco de Prueba S.A.", "2000-01-03", "XMAD", "ES", "ESVUFR"),
        ("ES0000000001", "XETA", "Banco de Prueba S.A.", "2005-05-02", "XMAD", "ES", "ESVUFR"),
        ("DE0000000002", "XETA", "Prüfgesellschaft für Ölmühlen AG", "2010-03-15", "XETA", "DE",
         "ESVUFR"),
        ("NL0000000010", "XAMS", "Nueva Prueba NV", "2026-11-03", "XAMS", "NL", "ESVUFR"),
    ])
    r = esma_firds.construye(http, base, hasta=dt.date(2026, 11, 9), deltas=False)
    nombre, filas = _lee_plazas(base)
    assert nombre == "plazas_2026-11-07_sobre_2026-10-31.csv"
    assert [(f["isin"], f["estado"], f["mic_perdidos"], f["mic_ganados"]) for f in filas] == [
        ("DE0000000002", "cambia", "TGAT", ""),
        ("ES0000000001", "cambia", "", "XETA"),
        ("FR0000000005", "sale", "XETA XPAR", ""),
        ("IE0000000003", "cambia", "MTAA", ""),        # la que añadió el delta
        ("IT0000000009", "sale", "MTAA", ""),
        ("NL0000000010", "entra", "", "XAMS"),
    ]
    fechas = {(f["completo_anterior"], f["ultimo_delta_anterior"], f["completo_nuevo"]) for f in filas}
    assert fechas == {("2026-10-31", "2026-11-05", "2026-11-07")}
    p = r["plazas"]
    assert (p["isin_con_perdidas"], p["mic_perdidos"], p["isin_que_salen"]) == (4, 5, 2)
    assert (p["isin_con_ganancias"], p["mic_ganados"], p["isin_que_entran"]) == (2, 2, 1)
    # Solo se deja constancia: el índice es el del completo nuevo, como antes
    con = esma_firds.abre(base / esma_firds.RUTA_INDICE)
    try:
        assert [m["mic"] for m in esma_firds.ficha(con, "DE0000000002")["mercados"]] == ["XETA"]
        assert esma_firds.ficha(con, "FR0000000005") is None
    finally:
        con.close()


def test_sin_diferencias_el_registro_queda_con_la_cabecera_y_no_pisa_otro(entorno):
    base, http = entorno
    esma_firds.construye(http, base, hasta=HOY, deltas=False)
    assert not (base / esma_firds.RUTA_PLAZAS).exists()      # la primera vez no hay con qué comparar
    r = esma_firds.construye(http, base, hasta=HOY, deltas=False, force=True)
    assert r["plazas"]["isin_con_perdidas"] == 0 and r["plazas"]["isin_con_ganancias"] == 0
    nombre, filas = _lee_plazas(base)
    assert nombre == "plazas_2026-10-31_sobre_2026-10-31.csv" and filas == []
    esma_firds.construye(http, base, hasta=HOY, deltas=False, force=True)
    assert sorted(p.name for p in (base / esma_firds.RUTA_PLAZAS).glob("*.csv")) == [
        "plazas_2026-10-31_sobre_2026-10-31-2.csv", "plazas_2026-10-31_sobre_2026-10-31.csv"]


def test_sin_completo_nuevo_no_se_compara_nada(entorno):
    base, http = entorno
    esma_firds.construye(http, base, hasta=HOY)
    r = esma_firds.construye(http, base, hasta=HOY)
    assert "plazas" not in r and not (base / esma_firds.RUTA_PLAZAS).exists()
