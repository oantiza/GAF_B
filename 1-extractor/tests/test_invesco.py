# -*- coding: utf-8 -*-
"""El adaptador de Invesco, sobre respuestas reales recortadas el 08-11-2026.

IE00B3YCGJ38 acumula y es sintético; IE00BJQRDN15 acumula, es activo y su VL es un día anterior al final de
la serie; IE00BWTN6Y99 reparte y es físico. Las series llevan la primera fila y las 24 más recientes.
"""
import json
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Contexto  # noqa: E402
from core.http import Respuesta, SinCache  # noqa: E402
from fetchers import invesco  # noqa: E402

FIXTURES = RAIZ / "tests" / "fixtures" / "invesco"
SETTINGS = {"max_posiciones_cartera": 10000}
DESCARGA = 1794145285.0
SINTETICO, ACTIVO, REPARTE = "IE00B3YCGJ38", "IE00BJQRDN15", "IE00BWTN6Y99"
RUTAS = {"keyStats": "/keyStats", "rolling": "/performance/rolling", "holdings": "/holdings/fund",
         "distribution": "/distribution"}


class HttpFalso:
    """Sirve las fixtures por ruta. `propio` sustituye la respuesta de una ruta (`keyStats`, `raiz`...)."""

    sin_red = False

    def __init__(self, cache_dir: Path, propio: dict | None = None, falla_descarga: Exception | None = None):
        self.cache_dir, self.propio, self.falla_descarga = cache_dir, propio or {}, falla_descarga
        self.gets: list[tuple[str, str | None, dict | None]] = []
        self.descargas: list[tuple[str, str | None]] = []

    def ttl_para(self, familia):
        return 90

    def get(self, url, params=None, familia=None, headers=None, **_):
        self.gets.append((url, familia, params))
        assert params and params["idType"] == "isin", "sin idType la API responde 400"
        assert headers["Accept"] == "*/*"
        isin, _sep, ruta = url.split("/shareclasses/")[1].partition("/")
        nombre = next((n for n, r in RUTAS.items() if f"/{ruta}" == r), "raiz")
        if nombre in self.propio:
            v = self.propio[nombre]
            return v if isinstance(v, Respuesta) else Respuesta(200, v, False, DESCARGA)
        fichero = FIXTURES / f"{isin}_{nombre}.json"
        texto = fichero.read_text(encoding="utf-8") if fichero.exists() else "{ }"
        return Respuesta(200, texto, False, DESCARGA)

    def download(self, url, destino, force=False, opcional=False, familia=None, **_):
        self.descargas.append((url, familia))
        if self.falla_descarga:
            raise self.falla_descarga
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        Path(destino).write_text("00001_Version|x\nV1|y\n", encoding="utf-8")
        return Path(destino)


def _fetch(tmp_path, isin, previo=None, settings=SETTINGS, **kw) -> dict:
    return invesco.fetch(isin, HttpFalso(tmp_path, **kw), settings, previo=previo)


def _editado(isin, nombre, cambia) -> str:
    datos = json.loads((FIXTURES / f"{isin}_{nombre}.json").read_text(encoding="utf-8"))
    cambia(datos)
    return json.dumps(datos, ensure_ascii=False)


def _sin_nav(d):
    d["keyStats"] = [k for k in d["keyStats"] if k["name"] != "nav"]


def _nav_del_dia_siguiente(d):
    next(k for k in d["keyStats"] if k["name"] == "nav")["asOfDate"] = "2026-11-06"


# ------------------------------------------------------------------ lo esperado
def test_etf_sintetico_que_acumula(tmp_path):
    e = _fetch(tmp_path, SINTETICO)["emisor"]
    assert e["fuente"] == "invesco" and e["id_emisor"] == "SPXS"
    assert e["nombre"] == "Invesco S&P 500 UCITS ETF Acc", "el &amp; se decodifica"
    assert e["clase_activo"] == "Equity" and e["estilo_gestion"] == "PASSIVE" and e["divisa_clase"] == "USD"
    assert e["fecha_lanzamiento"] == "2010-05-20" and e["ter_pct"] == 0.05
    assert e["politica"] == {"valor": "acumulacion", "texto": "Accumulating"}
    assert e["replica"] == {"tipo": "sintetica", "metodo": "Synthetic"}
    assert e["indice"]["ticker"] == "SPTR500N" and e["indice"]["nombre"].startswith("S&P 500")


def test_la_comision_de_swap_va_aparte_y_en_porcentaje(tmp_path):
    assert _fetch(tmp_path, SINTETICO)["emisor"]["comision_swap_pct"] == 0.0718


def test_fisico_sin_swap(tmp_path):
    e = _fetch(tmp_path, REPARTE)["emisor"]
    assert e["replica"] == {"tipo": "fisica", "metodo": "Physical"} and "comision_swap_pct" not in e
    assert e["politica"] == {"valor": "distribucion", "texto": "Quarterly", "frecuencia": "Quarterly"}


def test_activo_sin_metodo_de_replica(tmp_path):
    e = _fetch(tmp_path, ACTIVO)["emisor"]
    assert "replica" not in e and e["estilo_gestion"] == "ACTIVE"


def test_patrimonio_es_del_subfondo(tmp_path):
    p = _fetch(tmp_path, SINTETICO)["emisor"]["patrimonio"]
    assert list(p) == ["fondo"]
    assert p["fondo"] == {"valor": 55740283413.196785, "fecha": "2026-11-05", "divisa": "USD"}


# ------------------------------------------------------------------ VL deducido
def test_vl_derivado_lo_declara_con_metodo_y_anclaje(tmp_path):
    out = _fetch(tmp_path, SINTETICO)
    vl = out["emisor"]["vl"]
    assert vl["clase_de_serie"] == "VL_EMISOR_DERIVADO" and vl["derivado"] is True and vl["base"] == 10000
    assert vl["anclaje"] == {"vl": 14.7862, "fecha": "2026-11-05", "crecimiento": 88346.5}
    assert vl["metodo"] == invesco.METODO_ANCLADO and vl["fuente"] == "invesco:vl_historico"
    assert vl["divisa"] == "USD" and vl["observaciones"] == 25
    assert vl["primera_fecha"] == "2010-05-20" and vl["ultima_fecha"] == "2026-11-05"


def test_serie_escalada_con_ejemplo_a_mano(tmp_path):
    serie = _fetch(tmp_path, SINTETICO)["series"]["vl_emisor"]
    assert [f["fecha"] for f in serie] == sorted(f["fecha"] for f in serie)
    assert serie[-1] == {"fecha": "2026-11-05", "vl": 14.7862}, "el ancla sale exacta"
    assert serie[-2] == {"fecha": "2026-11-04", "vl": 15.4598}, "14,7862 × 92371,21 / 88346,5"
    assert serie[0] == {"fecha": "2010-05-20", "vl": 1.6737}, "14,7862 × 10000 / 88346,5"


def test_cota_de_redondeo(tmp_path):
    cota = _fetch(tmp_path, SINTETICO)["emisor"]["vl"]["cota_relativa_redondeo"]
    assert cota == pytest.approx(0.005 / 10000 + 0.005 / 88346.5 + 0.00005 / 14.7862, rel=0.02)


def test_el_ancla_vale_aunque_la_serie_siga_despues(tmp_path):
    out = _fetch(tmp_path, ACTIVO)
    vl = out["emisor"]["vl"]
    assert vl["clase_de_serie"] == "VL_EMISOR_DERIVADO"
    assert vl["anclaje"]["fecha"] == "2026-11-05" and vl["ultima_fecha"] == "2026-11-06"
    assert out["series"]["vl_emisor"][-2] == {"fecha": "2026-11-05", "vl": 105.58503}
    assert out["series"]["vl_emisor"][-1]["vl"] == round(105.58503 * 26198.7 / 26396.26, 5), "con los decimales del ancla"


# ------------------------------------------------------------------ sin ancla
def _assert_sin_vl(out, motivo):
    vl, serie = out["emisor"]["vl"], out["series"]["vl_emisor"]
    assert vl["clase_de_serie"] == "RENTABILIDAD_ACUMULADA_EMISOR" and vl["derivado"] is True
    assert vl["motivo_sin_anclaje"] == motivo and "anclaje" not in vl
    assert all("vl" not in f and f["crecimiento"] > 0 for f in serie), "un índice base 10.000 no se escribe como VL"


def test_serie_sin_vl_declarado_queda_como_crecimiento(tmp_path):
    out = _fetch(tmp_path, SINTETICO, propio={"keyStats": _editado(SINTETICO, "keyStats", _sin_nav)})
    _assert_sin_vl(out, "sin_vl_declarado")
    assert "ultimo_declarado" not in out["emisor"]["vl"]


def test_vl_de_una_fecha_fuera_de_la_serie_no_ancla(tmp_path):
    out = _fetch(tmp_path, SINTETICO, propio={"keyStats": _editado(SINTETICO, "keyStats", _nav_del_dia_siguiente)})
    _assert_sin_vl(out, "fecha_del_vl_fuera_de_la_serie")
    assert out["emisor"]["vl"]["ultimo_declarado"] == {"vl": 14.7862, "fecha": "2026-11-06"}


def test_divisa_distinta_no_ancla(tmp_path):
    def en_euros(d):
        d["currency"] = "EUR"
    _assert_sin_vl(_fetch(tmp_path, SINTETICO, propio={"rolling": _editado(SINTETICO, "rolling", en_euros)}),
                   "divisa_distinta")


def test_clase_que_reparte_no_finge_vl_aunque_haya_ancla(tmp_path):
    out = _fetch(tmp_path, REPARTE)
    _assert_sin_vl(out, "clase_que_reparte")
    assert out["series"]["vl_emisor"][-1] == {"fecha": "2026-11-06", "crecimiento": 23838.12}
    assert out["emisor"]["vl"]["ultimo_declarado"] == {"vl": 39.25714, "fecha": "2026-11-06"}


def test_politica_desconocida_no_se_supone_acumulacion(tmp_path):
    def rara(d):
        d["distributionFrequency"] = "Sometimes"
    out = _fetch(tmp_path, SINTETICO, propio={"raiz": _editado(SINTETICO, "raiz", rara)})
    assert out["emisor"]["politica"] == {"texto": "Sometimes"}
    _assert_sin_vl(out, "politica_no_declarada")


# ------------------------------------------------------------------ posiciones
def test_sintetico_declara_cesta_y_no_el_numero_del_indice(tmp_path):
    c = _fetch(tmp_path, SINTETICO)["emisor"]["cartera"]
    assert c["naturaleza"] == "cesta_de_sustitucion" and c["fecha"] == "2026-11-04"
    assert "num_posiciones_declarado" not in c and c["num_posiciones"] == 15
    assert c["posiciones"][0] == {"nombre": "AMAZON.COM INC", "isin": "US0231351067", "divisa": "USD", "peso_pct": 8.42}


def test_fisico_lleva_el_numero_declarado(tmp_path):
    c = _fetch(tmp_path, REPARTE)["emisor"]["cartera"]
    assert c["num_posiciones_declarado"] == 49 and "naturaleza" not in c


def test_posiciones_ordenadas_y_peso_cero_se_conserva(tmp_path):
    c = _fetch(tmp_path, SINTETICO)["emisor"]["cartera"]
    pesos = [p["peso_pct"] for p in c["posiciones"]]
    assert pesos == sorted(pesos, reverse=True) and pesos[-1] == 0


def test_el_top10_no_cuenta_la_caja(tmp_path):
    h = {"effectiveDate": "2026-11-05", "numberOfHoldings": 11, "holdings":
         [{"name": "Cash and/or Derivatives", "weight": 50, "currency": "USD"}]
         + [{"name": f"V{i}", "isin": f"US000000000{i}", "weight": 1, "currency": "USD"} for i in range(10)]}
    c = _fetch(tmp_path, REPARTE, propio={"holdings": json.dumps(h)})["emisor"]["cartera"]
    assert c["peso_top10_pct"] == 10 and c["posiciones"][0]["nombre"].startswith("Cash")


def test_cartera_mayor_que_el_maximo(tmp_path):
    c = _fetch(tmp_path, SINTETICO, settings={"max_posiciones_cartera": 5})["emisor"]["cartera"]
    assert c["posiciones_guardadas"] == 5 and len(c["posiciones"]) == 5 and c["num_posiciones"] == 15


# ------------------------------------------------------------------ reparto
def test_ultimo_reparto_literal(tmp_path):
    d = _fetch(tmp_path, REPARTE)["emisor"]["distribuciones"]
    assert d["divisa"] == "USD" and d["divisa_origen"] == "declarada" and "historial" not in d
    assert d["ultima"] == {"fecha_ex": "2026-09-10", "fecha_pago": "2026-09-17", "fecha_registro": "2026-09-11",
                           "fecha_anuncio": "2026-09-04", "valor_declarado": 0.3291, "campo_origen": "distributionYield"}


def test_la_clase_que_acumula_no_pide_reparto(tmp_path):
    h = HttpFalso(tmp_path)
    assert "distribuciones" not in invesco.fetch(SINTETICO, h, SETTINGS)["emisor"]
    assert not any(u.endswith("/distribution") for u, _, _ in h.gets)


def test_reparto_vacio_no_escribe(tmp_path):
    assert "distribuciones" not in _fetch(tmp_path, REPARTE, propio={"distribution": "{ }"})["emisor"]


# ------------------------------------------------------------------ ausencias
def test_isin_desconocido_no_aporta_nada_ni_pide_mas(tmp_path):
    h = HttpFalso(tmp_path)
    assert invesco.fetch("IE00B4L5Y983", h, SETTINGS) == {}
    assert len(h.gets) == 1 and h.descargas == []


@pytest.mark.parametrize("respuesta", [Respuesta(500, "", False, DESCARGA), "no es json", "{ }", "[]",
                                       '{"aliases": {"isin": "IE00B4L5Y983"}}'])
def test_ficha_inservible(tmp_path, respuesta):
    assert _fetch(tmp_path, SINTETICO, propio={"raiz": respuesta}) == {}


def test_sin_serie_queda_la_ficha_y_el_patrimonio(tmp_path):
    out = _fetch(tmp_path, SINTETICO, propio={"rolling": Respuesta(404, "", False, DESCARGA)})
    assert "series" not in out and "vl" not in out["emisor"]
    assert out["emisor"]["ter_pct"] == 0.05 and out["emisor"]["patrimonio"]["fondo"]["divisa"] == "USD"


def test_keystats_caido_deja_crecimiento_sin_patrimonio(tmp_path):
    out = _fetch(tmp_path, SINTETICO, propio={"keyStats": Respuesta(500, "", False, DESCARGA)})
    assert "patrimonio" not in out["emisor"]
    _assert_sin_vl(out, "sin_vl_declarado")


def test_serie_de_otro_isin_no_se_usa(tmp_path):
    def otro(d):
        d["isin"] = ACTIVO
    assert "series" not in _fetch(tmp_path, SINTETICO, propio={"rolling": _editado(SINTETICO, "rolling", otro)})


def test_serie_con_otra_base_no_se_interpreta(tmp_path):
    def base(d):
        d["baseline"] = 100
    assert "series" not in _fetch(tmp_path, SINTETICO, propio={"rolling": _editado(SINTETICO, "rolling", base)})


def test_holdings_vacio(tmp_path):
    assert "cartera" not in _fetch(tmp_path, SINTETICO, propio={"holdings": '{"holdings": []}'})["emisor"]


# ------------------------------------------------------------------ EMT y EET
def test_emt_y_eet_van_a_la_cache_y_no_a_la_ficha(tmp_path):
    h = HttpFalso(tmp_path)
    out = invesco.fetch(SINTETICO, h, SETTINGS)
    assert {u for u, _ in h.descargas} == set(invesco.URLS_REGULATORIOS.values())
    assert all(f == "costes" for _, f in h.descargas)
    assert (tmp_path / "invesco_regulatorio" / "emt.csv").exists()
    assert (tmp_path / "invesco_regulatorio" / "eet.csv").exists()
    assert "00001_Version" not in json.dumps(out) and "emt" not in out["emisor"] and "eet" not in out["emisor"]


@pytest.mark.parametrize("error", [ConnectionError("caída"), SinCache("sin red")])
def test_fallo_del_emt_no_tumba_la_ficha(tmp_path, error):
    assert _fetch(tmp_path, SINTETICO, falla_descarga=error)["emisor"]["ter_pct"] == 0.05


# ------------------------------------------------------------------ contra el KID
def test_politica_distinta_del_kid_avisa(tmp_path):
    e = _fetch(tmp_path, REPARTE, previo={"a": {"documentos_oficiales": {"kid_politica": "acumulacion"}}})["emisor"]
    assert e["avisos"] == [{"codigo": "politica_distinta_del_kid", "emisor": "distribucion", "kid": "acumulacion"}]


def test_politica_igual_al_kid_no_avisa(tmp_path):
    previo = {"a": {"documentos_oficiales": {"kid_politica": "acumulacion"}}}
    assert "avisos" not in _fetch(tmp_path, SINTETICO, previo=previo)["emisor"]


def test_sin_kid_no_avisa(tmp_path):
    assert "avisos" not in _fetch(tmp_path, SINTETICO, previo={"a": {"identificacion": {}}})["emisor"]


# ------------------------------------------------------------------ utilidades
@pytest.mark.parametrize("entrada,esperada", [("0.05%", 0.05), (" 0.3% ", 0.3), ("0.0005", None), ("Actual", None), (None, None)])
def test_porcentajes(entrada, esperada):
    assert invesco._porcentaje(entrada) == esperada


@pytest.mark.parametrize("entrada,esperada", [("2026-11-05", "2026-11-05"), ("2026-02-31", None), ("--11-30", None), (None, None)])
def test_fechas(entrada, esperada):
    assert invesco._fecha(entrada) == esperada


# ------------------------------------------------------------------ integración
def test_cada_dato_con_su_familia(tmp_path):
    h = HttpFalso(tmp_path)
    invesco.fetch(REPARTE, h, SETTINGS)
    familias = {u.split(REPARTE)[1]: f for u, f, _ in h.gets}
    assert familias == {"": "analitica", "/keyStats": "precio", "/performance/rolling": "precio",
                        "/holdings/fund": "cartera", "/distribution": "precio"}


def test_solo_escribe_el_bloque_emisor_y_su_serie(tmp_path):
    out = _fetch(tmp_path, SINTETICO)
    assert set(out) == {"emisor", "series"} and set(out["series"]) == {"vl_emisor"}


def test_procedencia_por_etapa(tmp_path):
    with procedencia.activa("invesco") as reg:
        datos = invesco.fetch(REPARTE, HttpFalso(tmp_path), SETTINGS)
    etiquetas = {r: reg.resuelve(r) for r, _v in procedencia.hojas(datos)}
    assert etiquetas["series.vl_emisor"] == "invesco:vl_historico"
    assert etiquetas["emisor.ter_pct"] == "invesco:ficha_producto"
    assert etiquetas["emisor.patrimonio.fondo.valor"] == "invesco:vl_historico"
    assert etiquetas["emisor.distribuciones.ultima.fecha_ex"] == "invesco:dividendos"
    assert etiquetas["emisor.cartera.posiciones"] == "invesco:posiciones"


def test_el_nucleo_lo_funde_sin_mezclarlo_con_lo_demas(tmp_path):
    from core.adquisicion import registro
    from core.adquisicion.adaptador import Adaptador, Endpoint

    otra = Adaptador(id="justetf", descripcion="", oficial=False,
                     capacidades={"costes.ter_pct": "costes"}, endpoints=(Endpoint("x", "costes"),),
                     fetch=lambda i, c: {"costes": {"ter_pct": 0.19}, "identificacion": {"nombre": "Otra"},
                                         "valoracion": {"vl": 100.0, "vl_fecha": "2026-11-03"}},
                     aplica=lambda i, t: True, orden=30)
    (tmp_path / "config").mkdir()
    ctx = Contexto(http=HttpFalso(tmp_path), settings=SETTINGS, base=tmp_path)
    r = nucleo.adquiere(SINTETICO, "etf", ctx, [otra, registro.INVESCO], fuentes_activas=["justetf", "invesco"])
    assert r.datos["costes"]["ter_pct"] == 0.19 and r.datos["emisor"]["ter_pct"] == 0.05
    assert r.datos["meta"]["procedencia"]["series.vl_emisor"] == "invesco:vl_historico"


def test_aplica_solo_a_etf():
    from core.adquisicion import registro
    assert registro.INVESCO.aplica(SINTETICO, "etf")
    assert not registro.INVESCO.aplica(SINTETICO, "fondo") and not registro.INVESCO.aplica("ES0113900J37", "accion")


def test_fuera_de_las_fuentes_activas_no_se_pide():
    from core.adquisicion import registro
    from core.adquisicion.planificador import planifica
    plan = planifica(SINTETICO, "etf", registro.ADAPTADORES, fuentes_activas=["morningstar_lt"])
    assert "invesco" not in plan.ids() and plan.omitidos["invesco"] == "fuera de las fuentes activas"


def test_esta_en_la_pasada_general():
    settings = json.loads((RAIZ / "config" / "settings.json").read_text(encoding="utf-8"))
    assert "invesco" in settings["prioridad_fuentes"]
