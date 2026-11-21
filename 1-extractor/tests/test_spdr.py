# -*- coding: utf-8 -*-
"""El adaptador de SPDR, sobre respuestas reales recortadas el 08-11-2026.

IE00B3T9LM79 reparte; IE00BKWQ0M75 acumula y su serie arranca antes de que existiera el fondo irlandés;
IE00BFY0GT14 acumula y separa clase y fondo; US78462F1030 es SPY, el Excel sin ISIN y con cifras en texto.
Las series llevan las 24 filas más recientes y la primera.
"""
import json
import shutil
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Respuesta  # noqa: E402
from fetchers import spdr  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "spdr"
SETTINGS = {"max_posiciones_cartera": 10000}
DESCARGA = 1794145285.0
REPARTE, ACUMULA, DOS_NIVELES, SPY = "IE00B3T9LM79", "IE00BKWQ0M75", "IE00BFY0GT14", "US78462F1030"


class HttpFalso:
    """Sirve las fixtures por URL. `propio` sustituye el texto de una URL o el fichero de un sufijo."""

    sin_red = False

    def __init__(self, cache_dir: Path, propio: dict | None = None, ausentes: tuple[str, ...] = ()):
        self.cache_dir, self.propio, self.ausentes = cache_dir, propio or {}, ausentes
        self.gets: list[tuple[str, str | None]] = []
        self.descargas: list[tuple[str, str | None]] = []

    def ttl_para(self, familia):
        return 1

    def get(self, url, familia=None, **_):
        self.gets.append((url, familia))
        for sufijo, valor in self.propio.items():
            if sufijo in url:
                return valor if isinstance(valor, Respuesta) else Respuesta(200, valor, False, DESCARGA)
        if url == spdr.URL_CATALOGO:
            nombre = "catalogo.json"
        else:
            nombre = next(f"{i}_ficha.html" for i, marca in
                          ((REPARTE, "euro-corporate"), (ACUMULA, "small-cap"), (DOS_NIVELES, "msci-world"),
                           (SPY, "sp-500-etf-trust")) if marca in url)
        return Respuesta(200, (FIXTURES / nombre).read_text(encoding="utf-8"), False, DESCARGA)

    def download(self, url, destino, force=False, opcional=False, familia=None, **_):
        self.descargas.append((url, familia))
        if any(a in url for a in self.ausentes):
            return None
        origen = next((v for k, v in self.propio.items() if k in url and isinstance(v, Path)), None)
        if origen is None:
            isin = next((i for i, f in ((REPARTE, "sybc-gy"), (ACUMULA, "smc-fp"), (DOS_NIVELES, "sppw-gy"),
                                        (SPY, "en-spy")) if f in url), None)
            nombre = "distribuciones.xlsx" if url == spdr.URL_DIVIDENDOS else \
                f"{isin}_{'nav' if 'navhist' in url else 'pos'}.xlsx"
            origen = FIXTURES / nombre
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(origen, destino)
        return Path(destino)


@pytest.fixture
def http(tmp_path):
    return HttpFalso(tmp_path)


def _fetch(tmp_path, isin, previo=None, settings=SETTINGS, **kw) -> dict:
    return spdr.fetch(isin, HttpFalso(tmp_path, **kw), settings, previo=previo)


def _xlsx(tmp_path, nombre, filas) -> Path:
    from openpyxl import Workbook
    libro = Workbook(write_only=True)
    hoja = libro.create_sheet("h")
    for fila in filas:
        hoja.append(list(fila))
    ruta = tmp_path / nombre
    libro.save(ruta)
    return ruta


# ------------------------------------------------------------------ lo esperado
def test_etf_que_reparte(tmp_path):
    e = _fetch(tmp_path, REPARTE)["emisor"]
    assert e["fuente"] == "spdr" and e["id_emisor"] == "SYBC-GY"
    assert e["nombre"] == "State Street® SPDR® Bloomberg Euro Corporate Bond UCITS ETF (Dist)"
    assert e["clase_activo"] == "Fixed Income" and e["divisa_clase"] == "EUR" and e["ter_pct"] == 0.12
    assert e["fecha_lanzamiento"] == "2011-05-23"
    assert e["politica"] == {"valor": "distribucion", "texto": "Distribution", "frecuencia": "Semi-Annually"}
    assert e["replica"] == {"tipo": "fisica", "muestreo": True, "metodo": "Stratified Sampling"}
    assert e["indice"] == {"nombre": "Bloomberg Euro Corporate Bond Index"}


def test_etf_que_acumula_no_lleva_dividendos_ni_frecuencia(tmp_path):
    e = _fetch(tmp_path, ACUMULA)["emisor"]
    assert e["politica"] == {"valor": "acumulacion", "texto": "Accumulation"}
    assert "distribuciones" not in e


def test_la_serie_llega_antes_del_fondo_y_se_guarda_tal_cual(tmp_path):
    e = _fetch(tmp_path, ACUMULA)["emisor"]
    assert e["vl"]["primera_fecha"] == "2005-03-31" and e["fecha_lanzamiento"] == "2014-12-05"


def test_serie_de_vl_ascendente_y_declarada(tmp_path):
    out = _fetch(tmp_path, REPARTE)
    serie, vl = out["series"]["vl_emisor"], out["emisor"]["vl"]
    assert [f["fecha"] for f in serie] == sorted(f["fecha"] for f in serie)
    assert vl["clase_de_serie"] == "VL_EMISOR" and vl["divisa"] == "EUR" and vl["fuente"] == "spdr:vl_historico"
    assert vl["observaciones"] == len(serie) == 25
    assert vl["primera_fecha"] == "2011-05-23" and serie[-1] == {"fecha": "2026-11-06", "vl": 52.0036}
    assert vl["ultima_fecha"] == "2026-11-06", "el pie del fichero no es una fila"


def test_patrimonio_de_clase_y_de_fondo(tmp_path):
    p = _fetch(tmp_path, DOS_NIVELES)["emisor"]["patrimonio"]
    assert p["clase"] == {"valor": 20378170302.51, "divisa": "USD", "fecha": "2026-11-06"}
    assert p["fondo"] == {"valor": 21987814997.85, "divisa": "USD", "fecha": "2026-11-06"}


def test_una_clase_cubierta_toma_la_divisa_del_titulo_de_la_columna(tmp_path):
    nav = _xlsx(tmp_path, "cub.xlsx", [
        ("Fund Name:", "X", None, None, None), ("ISIN:", REPARTE, None, None, None),
        ("NAV Currency:", "EUR", None, None, None), (None, None, None, None, None),
        ("Date", "NAV", "Shares Outstanding", "Share Class Assets", "Total Fund Assets (USD)"),
        ("06-Nov-2026", 12.5, 10.0, 125.0, 5000.0)])
    p = _fetch(tmp_path, REPARTE, propio={"navhist": nav})["emisor"]["patrimonio"]
    assert p["clase"]["divisa"] == "EUR" and p["fondo"] == {"valor": 5000.0, "divisa": "USD", "fecha": "2026-11-06"}


def test_el_fondo_de_una_clase_no_finge_patrimonio_de_clase(tmp_path):
    p = _fetch(tmp_path, REPARTE)["emisor"]["patrimonio"]
    assert list(p) == ["fondo"] and p["fondo"]["valor"] == 668724515.17 and p["fondo"]["divisa"] == "EUR"


def test_etf_estadounidense(tmp_path):
    out = _fetch(tmp_path, SPY)
    e = out["emisor"]
    assert "ter_pct" not in e, "`ger` es gasto bruto, no TER"
    assert e["politica"] == {"frecuencia": "Quarterly"}, "no declara tratamiento de rentas"
    assert "replica" not in e, "no la declara"
    assert e["indice"] == {"nombre": "S&P 500 Index"} and e["divisa_clase"] == "USD"
    assert e["patrimonio"]["fondo"]["divisa"] == "USD" and e["vl"]["divisa"] == "USD"
    assert out["series"]["vl_emisor"][-1] == {"fecha": "2026-11-05", "vl": 733.080722}, "con la cifra en texto"
    assert e["cartera"]["posiciones"][0]["ticker"] == "AAPL" and e["cartera"]["fecha"] == "2026-11-05"
    assert e["distribuciones"]["divisa"] == "USD" and len(e["distribuciones"]["historial"]) == 5


# ------------------------------------------------------------------ dividendos
def test_dividendos_de_la_clase_con_divisa_declarada(tmp_path):
    d = _fetch(tmp_path, REPARTE)["emisor"]["distribuciones"]
    assert d["historial_consultado"] is True and d["divisa"] == "EUR" and d["divisa_origen"] == "declarada"
    fechas = [h["fecha_ex"] for h in d["historial"]]
    assert fechas == sorted(fechas) and len(fechas) == 5
    assert d["historial"][-1] == {"fecha_ex": "2026-08-03", "fecha_pago": "2026-08-17",
                                  "fecha_registro": "2026-08-04", "importe": 0.8732}


def test_importe_cero_no_es_reparto(tmp_path):
    d = _fetch(tmp_path, REPARTE)["emisor"]["distribuciones"]
    assert "2011-05-15" not in [h["fecha_ex"] for h in d["historial"]]


def test_clase_que_reparte_sin_filas_queda_consultada_y_sin_historial(tmp_path):
    vacio = _xlsx(tmp_path, "d.xlsx", [("FUND UMBRELLA", "FUND NAME", "TICKER", "ISIN", "CURRENCY", "Announcement Date",
                                        "EX-DATE", "EX-DATE NAV", "RECORD DATE", "PAYMENT DATE", "DISTRIBUTION", "FREQUENCY")])
    e = _fetch(tmp_path, REPARTE, propio={"historical-distributions": vacio})["emisor"]
    assert e["distribuciones"]["historial_consultado"] is True and "historial" not in e["distribuciones"]
    assert e["ter_pct"] == 0.12


def test_sin_fichero_de_dividendos_no_se_declara_consultado(tmp_path):
    e = _fetch(tmp_path, REPARTE, ausentes=("historical-distributions",))["emisor"]
    assert "distribuciones" not in e and e["ter_pct"] == 0.12


def test_el_fichero_comun_no_se_mezcla_entre_etf(tmp_path):
    h = _fetch(tmp_path, SPY)["emisor"]["distribuciones"]["historial"]
    assert all(f["importe"] != 0.8732 for f in h)


# ------------------------------------------------------------------ posiciones
def test_posiciones_ordenadas_y_literales(tmp_path):
    c = _fetch(tmp_path, DOS_NIVELES)["emisor"]["cartera"]
    assert c["fecha"] == "2026-11-05"
    primera = c["posiciones"][0]
    assert primera == {"isin": "US0378331005", "sedol": "2046251", "nombre": "Apple Inc.", "divisa": "USD",
                       "pais": "United States", "sector": "Information Technology", "peso_pct": 5.757808}
    pesos = [p["peso_pct"] for p in c["posiciones"]]
    assert pesos == sorted(pesos, reverse=True) and c["num_posiciones"] == len(pesos)


def test_futuros_y_saldos_sin_peso_no_se_guardan(tmp_path):
    nombres = [p["nombre"] for p in _fetch(tmp_path, DOS_NIVELES)["emisor"]["cartera"]["posiciones"]]
    assert "Australian Dollar" not in nombres and "Marketing communication" not in nombres


def test_unassigned_no_se_escribe_como_isin(tmp_path):
    for p in _fetch(tmp_path, ACUMULA)["emisor"]["cartera"]["posiciones"]:
        assert p.get("isin") != "Unassigned" and p.get("sedol") != "Unassigned"


def test_el_top10_no_cuenta_la_caja(tmp_path):
    filas = [("Fund Name:", "X", None), ("ISIN:", REPARTE, None), ("Holdings As Of:", "05-Nov-2026", None), (None, None, None),
             ("ISIN", "Security Name", "Percent of Fund"), ("-", "Cash_EUR", 50.0)]
    filas += [(f"IE00BKWQ0M7{i}", f"Bono {i}", 1.0) for i in range(10)]
    c = _fetch(tmp_path, REPARTE, propio={"holdings-daily": _xlsx(tmp_path, "h.xlsx", filas)})["emisor"]["cartera"]
    assert c["peso_top10_pct"] == 10.0 and c["posiciones"][0]["nombre"] == "Cash_EUR"


def test_cartera_mayor_que_el_maximo_se_recorta_y_lo_dice(tmp_path):
    c = _fetch(tmp_path, DOS_NIVELES, settings={"max_posiciones_cartera": 5})["emisor"]["cartera"]
    assert c["posiciones_guardadas"] == 5 and len(c["posiciones"]) == 5 and c["num_posiciones"] > 5


def test_excel_sin_posiciones_no_rompe(tmp_path):
    vacio = _xlsx(tmp_path, "h.xlsx", [("Fund Name:", "X", None), ("ISIN:", REPARTE, None), ("Holdings As Of:", "05-Nov-2026", None),
                                       (None, None, None), ("ISIN", "Security Name", "Percent of Fund"),
                                       ("Marketing communication", None, None)])
    e = _fetch(tmp_path, REPARTE, propio={"holdings-daily": vacio})["emisor"]
    assert "cartera" not in e and e["ter_pct"] == 0.12


def test_excel_de_posiciones_ausente_no_rompe(tmp_path):
    e = _fetch(tmp_path, REPARTE, ausentes=("holdings-daily",))["emisor"]
    assert "cartera" not in e and e["vl"]["observaciones"] == 25


def test_excel_de_posiciones_de_otro_etf_no_se_usa(tmp_path):
    otro = _xlsx(tmp_path, "h.xlsx", [("Fund Name:", "X", None), ("ISIN:", ACUMULA, None), (None, None, None),
                                      ("ISIN", "Security Name", "Percent of Fund"), ("XS1", "Bono", 1.0)])
    assert "cartera" not in _fetch(tmp_path, REPARTE, propio={"holdings-daily": otro})["emisor"]


# ------------------------------------------------------------------ ausencias
def test_isin_desconocido_no_aporta_nada_y_no_descarga(tmp_path):
    h = HttpFalso(tmp_path)
    assert spdr.fetch("IE00B4L5Y983", h, SETTINGS) == {} and h.descargas == []
    assert [u for u, _ in h.gets] == [spdr.URL_CATALOGO]


def test_catalogo_con_error(tmp_path):
    assert _fetch(tmp_path, REPARTE, propio={"fundfinder": Respuesta(500, "", False, DESCARGA)}) == {}


@pytest.mark.parametrize("texto", ["no es json", "{}", '{"data": {"funds": null}}', '{"data": {"funds": {"x": 1}}}'])
def test_catalogo_con_otra_forma(tmp_path, texto):
    assert _fetch(tmp_path, REPARTE, propio={"fundfinder": texto}) == {}


def test_excel_de_vl_de_otro_etf_no_se_usa(tmp_path):
    otro = _xlsx(tmp_path, "n.xlsx", [("Fund Name:", "X", None), ("ISIN:", ACUMULA, None), ("NAV Currency:", "EUR", None),
                                      (None, None, None), ("Date", "NAV", "Total Net Assets"), ("06-Nov-2026", 1.0, 10.0)])
    out = _fetch(tmp_path, REPARTE, propio={"navhist": otro})
    assert "series" not in out and "vl" not in out["emisor"] and "patrimonio" not in out["emisor"]


def test_excel_de_vl_corrupto_no_tumba_la_ficha(tmp_path):
    roto = tmp_path / "roto.xlsx"
    roto.write_bytes(b"no soy un excel")
    out = _fetch(tmp_path, REPARTE, propio={"navhist": roto})
    assert "series" not in out and out["emisor"]["ter_pct"] == 0.12
    assert out["emisor"]["divisa_clase"] == "EUR", "se queda con la de la ficha"


def test_excel_de_vl_ausente(tmp_path):
    out = _fetch(tmp_path, REPARTE, ausentes=("navhist",))
    assert "series" not in out and out["emisor"]["id_emisor"] == "SYBC-GY"


def test_ficha_de_otro_producto_deja_solo_lo_del_catalogo(tmp_path):
    e = _fetch(tmp_path, REPARTE, propio={"euro-corporate": "<html>IE00BKWQ0M75</html>"})["emisor"]
    assert "indice" not in e and "replica" not in e and "fecha_lanzamiento" not in e
    assert e["ter_pct"] == 0.12 and e["politica"] == {"valor": "distribucion", "texto": "Distribution"}


def test_vocabulario_desconocido_se_queda_literal(tmp_path):
    texto = (FIXTURES / f"{REPARTE}_ficha.html").read_text(encoding="utf-8").replace("Stratified Sampling", "Swap")
    e = _fetch(tmp_path, REPARTE, propio={"euro-corporate": texto})["emisor"]
    assert e["replica"] == {"metodo": "Swap"}


# ------------------------------------------------------------------ contra el KID
def test_politica_distinta_del_kid_avisa(tmp_path):
    e = _fetch(tmp_path, REPARTE, previo={"a": {"documentos_oficiales": {"kid_politica": "acumulacion"}}})["emisor"]
    assert e["avisos"] == [{"codigo": "politica_distinta_del_kid", "emisor": "distribucion", "kid": "acumulacion"}]


def test_politica_igual_al_kid_no_avisa(tmp_path):
    previo = {"a": {"documentos_oficiales": {"kid_politica": "distribucion"}}}
    assert "avisos" not in _fetch(tmp_path, REPARTE, previo=previo)["emisor"]


def test_sin_kid_no_avisa(tmp_path):
    assert "avisos" not in _fetch(tmp_path, REPARTE, previo={"a": {"identificacion": {}}})["emisor"]


def test_sin_politica_declarada_no_se_compara_con_el_kid(tmp_path):
    previo = {"a": {"documentos_oficiales": {"kid_politica": "distribucion"}}}
    assert "avisos" not in _fetch(tmp_path, SPY, previo=previo)["emisor"]


# ------------------------------------------------------------------ fechas
@pytest.mark.parametrize("entrada,esperada", [
    ("06-Nov-2026", "2026-11-06"), ("As of 05-Nov-2026", "2026-11-05"), ("23 May 2011", "2011-05-23"),
    ("03/08/2026", "2026-08-03"), ("-", None), ("31/02/2026", None), ("Tracking Code", None), (None, None)])
def test_fechas(entrada, esperada):
    assert spdr._fecha(entrada) == esperada


# ------------------------------------------------------------------ integración
def test_cada_dato_con_su_familia(tmp_path, http):
    spdr.fetch(REPARTE, http, SETTINGS)
    assert dict(http.gets)[spdr.URL_CATALOGO] == "precio"
    familias = {("nav" if "navhist" in u else "pos" if "holdings" in u else "div"): f for u, f in http.descargas}
    assert familias == {"nav": "precio", "pos": "cartera", "div": "precio"}


def test_solo_escribe_el_bloque_emisor_y_su_serie(tmp_path):
    out = _fetch(tmp_path, REPARTE)
    assert set(out) == {"emisor", "series"} and set(out["series"]) == {"vl_emisor"}


def test_procedencia_por_etapa(tmp_path, http):
    with procedencia.activa("spdr") as reg:
        datos = spdr.fetch(REPARTE, http, SETTINGS)
    etiquetas = {r: reg.resuelve(r) for r, _v in procedencia.hojas(datos)}
    assert etiquetas["series.vl_emisor"] == "spdr:vl_historico"
    assert etiquetas["emisor.ter_pct"] == "spdr:ficha_producto"
    assert etiquetas["emisor.patrimonio.fondo.valor"] == "spdr:vl_historico"
    assert etiquetas["emisor.distribuciones.historial"] == "spdr:dividendos"
    assert etiquetas["emisor.cartera.posiciones"] == "spdr:posiciones"


def test_el_nucleo_lo_funde_sin_mezclarlo_con_lo_demas(tmp_path, http):
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
    ctx = Contexto(http=http, settings=SETTINGS, base=tmp_path)
    r = nucleo.adquiere(REPARTE, "etf", ctx, [otra, registro.SPDR], fuentes_activas=["justetf", "spdr"])
    assert r.datos["costes"]["ter_pct"] == 0.19 and r.datos["cartera"]["fecha"] == "2026-10-01"
    assert r.datos["emisor"]["ter_pct"] == 0.12
    assert r.datos["meta"]["procedencia"]["series.vl_emisor"] == "spdr:vl_historico"


def test_aplica_solo_a_etf():
    from core.adquisicion import registro
    assert registro.SPDR.aplica(REPARTE, "etf")
    assert not registro.SPDR.aplica(REPARTE, "fondo") and not registro.SPDR.aplica("ES0113900J37", "accion")


def test_fuera_de_las_fuentes_activas_no_se_pide():
    from core.adquisicion import registro
    from core.adquisicion.planificador import planifica
    plan = planifica(REPARTE, "etf", registro.ADAPTADORES, fuentes_activas=["morningstar_lt"])
    assert "spdr" not in plan.ids() and plan.omitidos["spdr"] == "fuera de las fuentes activas"


def test_esta_en_la_pasada_general():
    settings = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    assert "spdr" in settings["prioridad_fuentes"]
