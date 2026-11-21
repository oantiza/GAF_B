# -*- coding: utf-8 -*-
"""El lector del EMT (decisión 58), sobre los ficheros reales recortados el 09-11-2026.

Las fixtures son los EMT de BlackRock (V4, XLSX, generado el 30-10-2026), Vanguard (V4.2, XLSX, 01-10-2026)
e Invesco (V4.2, CSV con barras, 30-09-2026), reducidos a las filas de los ISIN que llevan bloque del emisor,
más dos filas reales de BlackRock con `05080` = `L` y `0.92`. Todas las columnas se conservan.
"""
import datetime as dt
import hashlib
import json
import shutil
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import nucleo, registro, retencion  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from fetchers import emt  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "emt"
FICHEROS = {"ishares": "ishares_emt_v4.xlsx", "vanguard": "vanguard_emt_v42.xlsx", "invesco": "invesco_emt_v42.csv"}
CONFIG = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))[emt.CLAVE_CONFIG]
SETTINGS = {emt.CLAVE_CONFIG: CONFIG}


class HttpFalso:
    """`download` copia la fixture del emisor; cuenta las descargas para comprobar que es una por pasada."""

    sin_red = False

    def __init__(self, cache_dir: Path, ttl: float = 90, falla: Exception | None = None):
        self.cache_dir, self.ttl, self.falla = cache_dir, ttl, falla
        self.descargas: list[tuple[str, str | None]] = []

    def ttl_para(self, familia):
        return self.ttl

    def download(self, url, destino, force=False, familia=None, headers=None, **_):
        self.descargas.append((url, familia))
        self.cabeceras = headers
        if self.falla:
            raise self.falla
        emisor = next(e for e, c in CONFIG.items() if c["url"] == url)
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(FIXTURES / FICHEROS[emisor], destino)
        return Path(destino)


@pytest.fixture(autouse=True)
def _limpia_memoria():
    emt._INDICES.clear()
    emt._PEDIDAS.clear()
    yield
    emt._INDICES.clear()
    emt._PEDIDAS.clear()


def _bloque(tmp_path, isin, emisores=None, http=None) -> dict:
    out = emt.fetch(isin, http or HttpFalso(tmp_path), SETTINGS, emisores=emisores)
    return out.get("mercado_objetivo") or {}


# ------------------------------------------------------------------ los tres formatos
def test_ishares_v4_xlsx(tmp_path):
    b = _bloque(tmp_path, "IE00B4L5Y983", ["ishares"])
    assert b == {
        "fuente": "emisor:ishares",
        "url_fichero": CONFIG["ishares"]["url"],
        "sha256_fichero": hashlib.sha256((FIXTURES / FICHEROS["ishares"]).read_bytes()).hexdigest(),
        "version_plantilla": "V4",
        "fichero_generado": "2026-10-30",
        "fecha_mercado_objetivo": "2026-09-30",
        "tipo_inversor": {"minorista": "SI", "profesional": "SI", "contraparte_elegible": "SI"},
        "conocimiento": {"basico": "SI", "informado": "SI", "avanzado": "SI"},
        "capacidad_perdidas": {"sin_perdidas": "NO", "sin_garantia": "SI"},
        "objetivos": {"crecimiento": "SI", "rentas": "SI"},
        "periodo_minimo": {"anos": 5.0},
        "preferencias_esg_consideradas": "NEUTRAL",
        "distribucion": {"solo_ejecucion": "B", "conveniencia": "B", "asesoramiento": "B", "gestion_cartera": "B"},
    }


def test_vanguard_v42_xlsx_con_fechas_de_excel(tmp_path):
    b = _bloque(tmp_path, "IE00B18GC888", ["vanguard"])
    assert b["version_plantilla"] == "V4.2"
    assert b["fichero_generado"] == "2026-10-01"          # celda de fecha y hora de Excel
    assert b["fecha_mercado_objetivo"] == "2026-01-31"
    assert b["periodo_minimo"] == {"anos": 3.0}           # el de renta fija
    assert b["objetivos"] == {"crecimiento": "SI", "rentas": "NEUTRAL"}   # «Neutral»
    assert b["preferencias_esg_consideradas"] == "NEUTRAL"


def test_invesco_v42_csv(tmp_path):
    b = _bloque(tmp_path, "IE00B3YCGJ38", ["invesco"])
    assert b["fuente"] == "emisor:invesco"
    assert b["version_plantilla"] == "V4.2"
    assert b["fichero_generado"] == "2026-09-30"
    assert b["fecha_mercado_objetivo"] == "2026-08-12"
    assert b["periodo_minimo"] == {"anos": 5.0}           # «5.00000000000000»
    assert b["sha256_fichero"] == hashlib.sha256((FIXTURES / FICHEROS["invesco"]).read_bytes()).hexdigest()


@pytest.mark.parametrize("emisor,isins", [
    ("ishares", ["DE000A0F5UJ7", "IE000DR59CI3", "IE000X59ZHE2", "IE00B0M62Q58", "IE00B27YCK28", "IE00B3VWMM18",
                 "IE00B4L5Y983", "IE00B4ND3602", "IE00B53L3W79", "IE00B53QG562", "IE00B5BMR087", "IE00B5L8K969",
                 "IE00B6R52259", "IE00BDBRDM35", "IE00BZCQB185"]),
    ("vanguard", ["IE0007987708", "IE0031786696", "IE0032126645", "IE00B03HCZ61", "IE00B03HD191", "IE00B18GC888",
                  "IE00B3XXRP09"]),
    ("invesco", ["IE00B3Q19T94", "IE00B3YCGJ38"]),
])
def test_los_24_con_bloque_del_emisor_lo_traen(tmp_path, emisor, isins):
    for isin in isins:
        b = _bloque(tmp_path, isin, [emisor])
        assert b["fuente"] == f"emisor:{emisor}" and b["fecha_mercado_objetivo"], isin
        assert b["periodo_minimo"]["anos"] in (3.0, 5.0), isin


# ------------------------------------------------------------------ trampas medidas
def test_03050_no_viaja_aunque_diga_si(tmp_path):
    http = HttpFalso(tmp_path)
    fichero = emt.carga(http, "ishares", CONFIG["ishares"])
    fila = fichero.filas["IE00B5BMR087"]
    assert fila["03050"] == "Y"                            # está en el fichero...
    b = emt.mercado_objetivo(fila, fichero)
    assert "03050" not in json.dumps(b)
    assert set(b["capacidad_perdidas"]) == {"sin_perdidas", "sin_garantia"}   # ...y no en el bloque
    assert emt.mercado_objetivo({**fila, "03050": "N"}, fichero) == b


@pytest.mark.parametrize("grafia", ["Neutral", "NEUTRAL", "neutral", " Neutral "])
def test_neutral_en_sus_grafias(grafia):
    assert emt.si_no(grafia) == "NEUTRAL"


@pytest.mark.parametrize("vacio", [None, "", "   "])
def test_vacio_es_ausente_nunca_neutral(tmp_path, vacio):
    http = HttpFalso(tmp_path)
    fichero = emt.carga(http, "vanguard", CONFIG["vanguard"])
    fila = {**fichero.filas["IE00B3XXRP09"], "01010": vacio, "02030": vacio, "05080": vacio, "05105": vacio,
            "06010": vacio, "05020": vacio, "05030": vacio}
    b = emt.mercado_objetivo(fila, fichero)
    assert "minorista" not in b["tipo_inversor"] and "avanzado" not in b["conocimiento"]
    assert "solo_ejecucion" not in b["distribucion"]
    assert "objetivos" not in b                            # un subbloque sin nada no se escribe
    assert "periodo_minimo" not in b and "preferencias_esg_consideradas" not in b
    assert "NEUTRAL" not in json.dumps(b)


def test_lo_que_no_esta_en_el_dominio_queda_ausente():
    assert emt.si_no("Maybe") is None
    assert emt.si_no("N", admite=("SI", "NEUTRAL")) is None     # 05105 solo admite Y o Neutral
    assert emt.canal("X") is None
    assert emt.canal("b") == "B"


@pytest.mark.parametrize("valor,esperado", [
    (5, {"anos": 5.0}), (3, {"anos": 3.0}), (0.92, {"anos": 0.92}), (0.0039, {"anos": 0.0039}),
    ("5", {"anos": 5.0}), ("5.000", {"anos": 5.0}), ("5.00000000000000", {"anos": 5.0}),
    ("0.27378500000000", {"anos": 0.273785}), ("0.92", {"anos": 0.92}), ("0.00", {"anos": 0.0}),
    ("L", {"codigo": "L"}), ("V", {"codigo": "V"}), ("s", {"codigo": "S"}), ("M", {"codigo": "M"}),
    ("H", {"codigo": "H"}),
    ("", None), ("  ", None), (None, None), ("X", None), ("cinco", None), ("-1", None), (True, None),
])
def test_periodo_minimo_en_sus_formatos(valor, esperado):
    assert emt.periodo_minimo(valor) == esperado


def test_periodo_minimo_letra_y_decimal_de_filas_reales(tmp_path):
    fichero = emt.carga(HttpFalso(tmp_path), "ishares", CONFIG["ishares"])
    medidos = {json.dumps(emt.periodo_minimo(f["05080"]), sort_keys=True) for f in fichero.filas.values()}
    assert {'{"codigo": "L"}', '{"anos": 0.92}', '{"anos": 5.0}', '{"anos": 3.0}'} <= medidos


def test_sin_fecha_de_mercado_objetivo_no_hay_bloque(tmp_path):
    fichero = emt.carga(HttpFalso(tmp_path), "invesco", CONFIG["invesco"])
    fila = fichero.filas["IE00B3Q19T94"]
    assert emt.mercado_objetivo({**fila, "01000": ""}, fichero) == {}
    assert emt.mercado_objetivo({**fila, "01000": "31/12/2025"}, fichero) == {}
    assert emt.mercado_objetivo({**fila, "00005": ""}, fichero)["fecha_mercado_objetivo"] == "2025-12-31"
    assert "fichero_generado" not in emt.mercado_objetivo({**fila, "00005": ""}, fichero)


def test_una_version_que_no_es_v4_ni_v42_no_se_lee(tmp_path):
    fichero = emt.carga(HttpFalso(tmp_path), "invesco", CONFIG["invesco"])
    fila = fichero.filas["IE00B3Q19T94"]
    assert emt.mercado_objetivo({**fila, "00001": "V4.3"}, fichero) == {}
    assert emt.mercado_objetivo({**fila, "00001": "V4.0"}, fichero)["version_plantilla"] == "V4"


# ------------------------------------------------------------------ ISIN desconocidos y emisores
def test_un_isin_que_el_fichero_no_conoce_no_escribe_nada(tmp_path, caplog):
    with caplog.at_level("WARNING"):
        assert emt.fetch("ES0148396007", HttpFalso(tmp_path), SETTINGS) == {}
    assert not caplog.records


def test_el_isin_de_otro_emisor_no_se_encuentra_en_el_suyo(tmp_path):
    assert _bloque(tmp_path, "IE00B3XXRP09", ["ishares"]) == {}
    assert _bloque(tmp_path, "IE00B3XXRP09", ["ishares", "vanguard", "invesco"])["fuente"] == "emisor:vanguard"


def test_sin_configuracion_no_hace_nada(tmp_path):
    http = HttpFalso(tmp_path)
    assert emt.fetch("IE00B4L5Y983", http, {}) == {}
    assert not http.descargas


# ------------------------------------------------------------------ una descarga por emisor y pasada
def test_una_descarga_por_emisor_aunque_se_pidan_muchos(tmp_path):
    http = HttpFalso(tmp_path)
    for isin in ("IE00B4L5Y983", "IE00B5BMR087", "IE00BDBRDM35", "ES0148396007"):
        emt.fetch(isin, http, SETTINGS, emisores=["ishares"])
    assert http.descargas == [(CONFIG["ishares"]["url"], "regulatorio")]


def test_invesco_con_la_identificacion_de_herramienta_y_los_demas_con_la_de_siempre(tmp_path):
    http = HttpFalso(tmp_path)
    emt.carga(http, "invesco", CONFIG["invesco"])
    assert http.cabeceras["User-Agent"] == emt.UA_HERRAMIENTA
    emt.carga(http, "ishares", CONFIG["ishares"])
    assert "User-Agent" not in http.cabeceras        # la de la sesión de `core.http`


def test_con_force_tambien_una_sola(tmp_path):
    http = HttpFalso(tmp_path)
    for isin in ("IE00B4L5Y983", "IE00B5BMR087"):
        emt.fetch(isin, http, SETTINGS, force=True, emisores=["ishares"])
    assert len(http.descargas) == 1


def test_copia_vigente_no_sale_a_red_y_caducada_si(tmp_path):
    HttpFalso(tmp_path).download(CONFIG["invesco"]["url"], tmp_path / "emt" / "invesco.csv")
    vigente = HttpFalso(tmp_path, ttl=90)
    assert _bloque(tmp_path, "IE00B3YCGJ38", ["invesco"], http=vigente)
    assert not vigente.descargas
    emt._INDICES.clear()
    caducada = HttpFalso(tmp_path, ttl=-1)
    assert _bloque(tmp_path, "IE00B3YCGJ38", ["invesco"], http=caducada)
    assert len(caducada.descargas) == 1


def test_sin_red_usa_la_copia_que_haya_y_sin_copia_nada(tmp_path):
    http = HttpFalso(tmp_path, ttl=-1)
    http.sin_red = True
    assert _bloque(tmp_path, "IE00B3YCGJ38", ["invesco"], http=http) == {}
    assert not http.descargas
    HttpFalso(tmp_path).download(CONFIG["invesco"]["url"], tmp_path / "emt" / "invesco.csv")
    assert _bloque(tmp_path, "IE00B3YCGJ38", ["invesco"], http=http)["fuente"] == "emisor:invesco"


def test_un_emisor_caido_no_tumba_la_ficha(tmp_path):
    http = HttpFalso(tmp_path, falla=ConnectionError("503"))
    assert emt.fetch("IE00B4L5Y983", http, SETTINGS) == {}


def test_isin_repetido_en_el_fichero_no_se_elige(tmp_path):
    destino = tmp_path / "emt" / "invesco.csv"
    HttpFalso(tmp_path).download(CONFIG["invesco"]["url"], destino)
    lineas = destino.read_bytes().split(b"\n")
    destino.write_bytes(b"\n".join(lineas[:2] + [lineas[1]] + lineas[2:]))
    assert _bloque(tmp_path, "IE00B3Q19T94", ["invesco"]) == {}
    assert _bloque(tmp_path, "IE00B3YCGJ38", ["invesco"])["fuente"] == "emisor:invesco"


# ------------------------------------------------------------------ en el registro y en la pasada
class HttpQueNoDebeUsarse:
    cache_dir = "no-existe"

    def __getattr__(self, nombre):
        raise AssertionError(f"el adaptador salió a red ({nombre})")


def _ctx(http, nombre, tipo="etf") -> Contexto:
    previo = {"_anterior": {"identificacion": {"nombre": nombre}}} if nombre else {}
    return Contexto(http=http, settings=SETTINGS, base=RAIZ, tipo=tipo, previo=previo)


def test_un_fondo_de_otra_gestora_no_descarga_ningun_emt():
    assert registro._fetch_emt("ES0112611001", _ctx(HttpQueNoDebeUsarse(), "Bestinver Internacional FI")) == {}


def test_cada_marca_abre_solo_su_fichero(tmp_path):
    http = HttpFalso(tmp_path)
    out = registro._fetch_emt("IE0032126645", _ctx(http, "Vanguard U.S. 500 Stock Index Fund EUR Acc", "fondo"))
    assert out["mercado_objetivo"]["fuente"] == "emisor:vanguard"
    assert [u for u, _f in http.descargas] == [CONFIG["vanguard"]["url"]]


def test_procedencia_por_fichero(tmp_path):
    adaptador = registro.por_id()["emt"]
    ctx = Contexto(http=HttpFalso(tmp_path), settings=SETTINGS, base=tmp_path, tipo="etf")
    res = nucleo.adquiere("IE00B3YCGJ38", "etf", ctx, [adaptador], fuentes_activas=["emt"])
    assert res.datos["mercado_objetivo"]["fuente"] == "emisor:invesco"
    hojas = {k: v for k, v in res.datos["meta"]["procedencia"].items() if k.startswith("mercado_objetivo.")}
    assert hojas and set(hojas.values()) == {"emt:invesco"}


def test_solo_fondos_y_etf():
    adaptador = registro.por_id()["emt"]
    assert adaptador.aplica("IE00B4L5Y983", "etf") and adaptador.aplica("IE0032126645", "fondo")
    assert not adaptador.aplica("ES0148396007", "accion")
    assert set(adaptador.capacidades) == {"mercado_objetivo.*"}


# ------------------------------------------------------------------ el 07130 como comprobación (decisión 60)
def _ficha_con_coste(tmp_path, isin, emisor, transaccion_pct):
    b = _bloque(tmp_path, isin, [emisor])
    return {"mercado_objetivo": b,
            "costes": {"mifid_emt_exante": {"transaccion_pct": transaccion_pct, "fecha": "2026-06-30"}}}


def test_el_07130_cuadra_con_la_estimada_de_morningstar(tmp_path, caplog):
    """IE000DR59CI3: 07130 = 0,00078287 (tanto por uno); Morningstar «Estimated» = 0,07829 %."""
    ficha = _ficha_con_coste(tmp_path, "IE000DR59CI3", "ishares", 0.07829)
    cifra, fecha = emt.coste_operacion_ex_ante("IE000DR59CI3", ficha["mercado_objetivo"])
    assert cifra == pytest.approx(0.078287) and fecha == "2026-06-30"
    with caplog.at_level("WARNING", logger="fondosdb.emt"):
        diferencia = emt.comprueba_coste_operacion(ficha, "IE000DR59CI3")
    assert abs(diferencia) < 0.05 and not caplog.records


def test_la_real_de_morningstar_dispara_la_alerta(tmp_path, caplog):
    """La cifra que se leía hasta el 09-11 (la ex post, 0,22607 %) se separa 14,8 pb del 07130."""
    ficha = _ficha_con_coste(tmp_path, "IE000DR59CI3", "ishares", 0.22607)
    with caplog.at_level("WARNING", logger="fondosdb.emt"):
        diferencia = emt.comprueba_coste_operacion(ficha, "IE000DR59CI3")
    assert diferencia == pytest.approx(14.78, abs=0.01)
    assert any("IE000DR59CI3" in r.getMessage() and "07130" in r.getMessage() for r in caplog.records)
    assert "07130" not in json.dumps(ficha["mercado_objetivo"])      # el bloque no lo lleva


def test_el_umbral_es_medio_punto_basico(tmp_path, caplog):
    with caplog.at_level("WARNING", logger="fondosdb.emt"):
        emt.comprueba_coste_operacion(_ficha_con_coste(tmp_path, "IE000DR59CI3", "ishares", 0.078287 + 0.0049),
                                      "IE000DR59CI3")
        assert not caplog.records
        emt.comprueba_coste_operacion(_ficha_con_coste(tmp_path, "IE000DR59CI3", "ishares", 0.078287 + 0.0051),
                                      "IE000DR59CI3")
        assert len(caplog.records) == 1


def test_el_07130_de_texto_del_csv_de_invesco(tmp_path):
    ficha = _ficha_con_coste(tmp_path, "IE00B3YCGJ38", "invesco", 0.0)
    assert emt.comprueba_coste_operacion(ficha, "IE00B3YCGJ38") == 0.0


def test_sin_fichero_cargado_o_de_otro_fichero_no_compara(tmp_path):
    ficha = _ficha_con_coste(tmp_path, "IE000DR59CI3", "ishares", 0.22607)
    otro = {**ficha, "mercado_objetivo": {**ficha["mercado_objetivo"], "sha256_fichero": "0" * 64}}
    assert emt.comprueba_coste_operacion(otro, "IE000DR59CI3") is None      # un bloque de otro fichero
    assert emt.comprueba_coste_operacion({"costes": ficha["costes"]}, "IE000DR59CI3") is None
    emt._INDICES.clear()
    assert emt.comprueba_coste_operacion(ficha, "IE000DR59CI3") is None     # nada leído en este proceso


# ------------------------------------------------------------------ retención del bloque (decisión 58)
def _pasada_con_emt(tmp_path, isin="IE00B4L5Y983"):
    ctx = Contexto(http=HttpFalso(tmp_path), settings=SETTINGS, base=tmp_path, tipo="etf")
    return nucleo.adquiere(isin, "etf", ctx, [registro.por_id()["emt"]], fuentes_activas=["emt"]).datos


def _pasada_sin_emt(tmp_path, anterior, isin="IE00B4L5Y983"):
    """Una pasada con `--fuentes` que no incluye `emt`: solo otra fuente, que no trae el bloque."""
    from core.adquisicion.adaptador import Adaptador, Endpoint
    otra = Adaptador(id="justetf", descripcion="", oficial=False, capacidades={"costes.ter_pct": "costes"},
                     endpoints=(Endpoint("x", "costes"),), fetch=lambda i, c: {"costes": {"ter_pct": 0.2}})
    ctx = Contexto(http=HttpFalso(tmp_path), settings=SETTINGS, base=tmp_path, tipo="etf")
    return nucleo.adquiere(isin, "etf", ctx, [otra], fuentes_activas=["justetf"], anterior=anterior).datos


def _envejece(ficha, dias):
    fecha = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=dias)).isoformat(timespec="seconds")
    for e in ficha["meta"]["adquisicion"]["fuentes"]["emt"]["endpoints"].values():
        e["fetched_at"] = fecha
    return fecha[:10]


def test_una_pasada_sin_emt_conserva_el_bloque_de_menos_de_180_dias(tmp_path):
    anterior = _pasada_con_emt(tmp_path)
    fecha = _envejece(anterior, 179)
    final = _pasada_sin_emt(tmp_path, anterior)
    assert final["mercado_objetivo"] == anterior["mercado_objetivo"]
    assert final["costes"]["ter_pct"] == 0.2
    proc = {k: v for k, v in final["meta"]["procedencia"].items() if k.startswith("mercado_objetivo.")}
    assert proc and set(proc.values()) == {f"retenido:emt:ishares@{fecha}"}
    assert [r["ruta"] for r in final["meta"]["retencion"]["retenidos"]] == ["mercado_objetivo"]


def test_una_pasada_sin_emt_deja_caer_el_bloque_de_mas_de_180_dias(tmp_path):
    anterior = _pasada_con_emt(tmp_path)
    _envejece(anterior, 181)
    final = _pasada_sin_emt(tmp_path, anterior)
    assert "mercado_objetivo" not in final
    assert not any(k.startswith("mercado_objetivo") for k in final["meta"]["procedencia"])
    descartado = final["meta"]["retencion"]["descartados"][0]
    assert descartado["ruta"] == "mercado_objetivo" and descartado["motivo"] == "antiguedad_181d_supera_180d"


def test_la_retencion_cuenta_desde_la_descarga_y_no_desde_la_ultima_pasada(tmp_path):
    """Una segunda pasada sin `emt` no alarga el plazo: la fecha viaja en la etiqueta `retenido:`."""
    anterior = _pasada_con_emt(tmp_path)
    _envejece(anterior, 100)
    segunda = _pasada_sin_emt(tmp_path, anterior)
    assert "emt" not in segunda["meta"]["adquisicion"]["fuentes"]
    hoy = dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=81)
    final = {"identificacion": {"tipo": "etf"}, "meta": {"procedencia": {}}}
    resumen = retencion.aplica(final, segunda, hoy=hoy)
    assert "mercado_objetivo" not in final
    assert resumen["descartados"][0]["motivo"] == "antiguedad_181d_supera_180d"


def test_un_bloque_sin_numeros_tambien_se_retiene(tmp_path):
    """Con 05080 = «L» el bloque es todo texto: la regla de los bloques de números lo daría por vacío."""
    fichero = emt.carga(HttpFalso(tmp_path), "ishares", CONFIG["ishares"])
    isin = next(i for i, f in fichero.filas.items()
                if emt.periodo_minimo(f["05080"]) == {"codigo": "L"} and emt.fecha_iso(f.get("01000")))
    anterior = _pasada_con_emt(tmp_path, isin)
    assert anterior["mercado_objetivo"]["periodo_minimo"] == {"codigo": "L"}
    final = {"identificacion": {"tipo": "etf"}, "meta": {"procedencia": {}}}
    retencion.aplica(final, anterior, hoy=dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=30))
    assert final["mercado_objetivo"] == anterior["mercado_objetivo"]
