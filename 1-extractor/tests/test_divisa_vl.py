# -*- coding: utf-8 -*-
"""La divisa del VL que da la CNMV, y que nadie la sustituye por la de la clase.

Desde ALTA-16a la tupla (vl, vl_fecha, vl_divisa) sale entera de una fuente. La
CNMV emitía vl y fecha sin divisa (revisión, MEN-1), y el primer arreglo la
etiquetó con la divisa de la clase (`CodigoDivisa` de FONDTRIM). Pero el VL del
mensual FONDMENS viene **siempre en euros**: lo dice el documento explicativo
de la CNMV y lo confirma ES0164745004, una clase en USD (FONDMENS 91,6184 €,
FONDTRIM 107,615 USD). Revisión de la tercera pasada, IMP-B:
- clase en EUR (o sin trimestral): la CNMV emite vl, vl_fecha y vl_divisa "EUR";
- clase en otra divisa: su VL en euros no compite y se queda en cnmv_fin_mes;
- el informe y el visor no pintan el VL con la divisa de la clase.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import informe, visor  # noqa: E402
from core.schema import merge  # noqa: E402
from fetchers import cnmv  # noqa: E402
from tests.test_app_seguridad import _ejecuta, requiere_node  # noqa: E402

EUR = "ES0110407006"
USD = "ES0164745004"      # la única clase en USD de FONDTRIM 2025-12 (3.068 clases)


def _mensual(isin: str, vl: str) -> dict:
    return {"Entidad": {"NumeroRegistro": "5206", "Compartimento": {
        "NumeroCompartimento": "1", "Clase": {"ISIN": isin, "VLDiario": {"VL_Dia30": "1.0", "VL_Dia31": vl}}}}}


def _trimestral(isin: str, divisa: str, vl: str) -> dict:
    return {"Entidad": {"NumeroRegistro": "5206", "Compartimento": {
        "NumeroCompartimento": "1", "VocacionInversora": "Renta Variable",
        "Clase": {"ISIN": isin, "CodigoDivisa": divisa, "ValorLiquidativo": vl}}}}


def _fetch(base: Path, isin: str, periodos: dict) -> dict:
    ruta = base / "cache" / "cnmv" / "parsed" / f"{isin}.json"
    ruta.parent.mkdir(parents=True)
    ruta.write_text(json.dumps(periodos), encoding="utf-8")
    return cnmv.fetch(isin, None, {}, base=base)


def test_una_clase_en_eur_lleva_su_vl_en_euros(tmp_path):
    out = _fetch(tmp_path, EUR, {"2025-12": {"FONDMENS_202512.xml": [_mensual(EUR, "141.9")],
                                             "FONDTRIM_202512.xml": [_trimestral(EUR, "EUR", "140.7154")]}})
    v = out["valoracion"]
    assert (v["vl"], v["vl_fecha"], v["vl_divisa"]) == (141.9, "2025-12-31", "EUR")
    assert v["cnmv_fin_mes"]["divisa"] == "EUR" and v["cnmv_trimestral"]["divisa"] == "EUR"

    # si su fin de mes gana por frescura, la tupla lleva divisa
    ms = {"valoracion": {"vl": 140.0, "vl_fecha": "2025-11-28", "vl_divisa": "EUR"}}
    r = merge([("cnmv", out), ("morningstar_lt", ms)], ["cnmv", "morningstar_lt"], EUR)
    assert {k: r["valoracion"][k] for k in ("vl", "vl_fecha", "vl_divisa")} == {
        "vl": 141.9, "vl_fecha": "2025-12-31", "vl_divisa": "EUR"}


def test_una_clase_en_usd_no_compite_con_su_vl_en_euros(tmp_path):
    out = _fetch(tmp_path, USD, {"2025-12": {"FONDMENS_202512.xml": [_mensual(USD, "91.6184")],
                                             "FONDTRIM_202512.xml": [_trimestral(USD, "USD", "107.6150")]}})
    v = out["valoracion"]
    assert "vl" not in v and "vl_fecha" not in v and "vl_divisa" not in v
    assert v["cnmv_fin_mes"] == {"vl": 91.6184, "fecha": "2025-12-31", "divisa": "EUR"}
    assert (v["cnmv_trimestral"]["vl"], v["cnmv_trimestral"]["divisa"]) == (107.615, "USD")

    # aunque su fecha sea más reciente, el VL que queda es el de la clase, en USD
    ms = {"valoracion": {"vl": 106.9, "vl_fecha": "2025-12-15", "vl_divisa": "USD"}}
    r = merge([("cnmv", out), ("morningstar_lt", ms)], ["cnmv", "morningstar_lt"], USD)
    assert {k: r["valoracion"][k] for k in ("vl", "vl_fecha", "vl_divisa")} == {
        "vl": 106.9, "vl_fecha": "2025-12-15", "vl_divisa": "USD"}


def test_sin_trimestral_el_vl_mensual_va_en_euros_y_sin_vl_no_hay_divisa(tmp_path):
    solo_mensual = _fetch(tmp_path / "a", EUR, {"2026-09": {"FONDMENS_202609.xml": [_mensual(EUR, "141.9")]}})
    assert solo_mensual["valoracion"]["vl_divisa"] == "EUR"     # FONDMENS siempre en euros
    solo_trimestral = _fetch(tmp_path / "b", EUR, {"2025-12": {
        "FONDTRIM_202512.xml": [_trimestral(EUR, "EUR", "140.7154")]}})
    assert "vl" not in solo_trimestral["valoracion"] and "vl_divisa" not in solo_trimestral["valoracion"]


def _ficha(vl_divisa: str | None = None) -> dict:
    valoracion = {"vl": 91.6184, "vl_fecha": "2025-12-31"}
    if vl_divisa:
        valoracion["vl_divisa"] = vl_divisa
    return {"meta": {"isin": USD}, "identificacion": {"nombre": "Fondo", "divisa_base": "USD"},
            "valoracion": valoracion}


def _tarjeta_vl(html: str) -> str:
    return re.search(r"c-lab'>VL</div><div class='c-val'>(.*?)</div>", html).group(1)


def test_el_informe_no_pinta_el_vl_con_la_divisa_de_la_clase(tmp_path):
    assert _tarjeta_vl(informe.genera_html(_ficha(), USD, base=tmp_path)).endswith("·")
    assert _tarjeta_vl(informe.genera_html(_ficha("EUR"), USD, base=tmp_path)).endswith("EUR")


@requiere_node
def test_el_visor_muestra_solo_la_divisa_del_propio_vl(tmp_path):
    (tmp_path / "data" / "funds").mkdir(parents=True)
    (tmp_path / "data" / "funds" / f"{USD}.json").write_text(json.dumps(_ficha()), encoding="utf-8")
    (tmp_path / "data" / "funds" / f"{EUR}.json").write_text(
        json.dumps({**_ficha("EUR"), "meta": {"isin": EUR}}), encoding="utf-8")
    html = _ejecuta(tmp_path, visor.genera(tmp_path).read_text(encoding="utf-8"), {}, [])
    assert ">Divisa" in html["cabecera"]
    assert "USD" not in html["cuerpo"]
    assert 'title="EUR">EUR</td>' in html["cuerpo"]


# --- Cuarta pasada, MEN-E: la divisa de la clase, solo si sale del mismo sitio que el VL

SICAV = "ES0132526031"
SEMESTRAL = "cnmv_sicav_almer:informe-semestral-2026-06"


def _ficha_etiquetada(isin: str, etiqueta_vl: str, etiqueta_divisa: str, divisa_base: str = "EUR") -> dict:
    # Como ES0132526031: VL del informe semestral, sin vl_divisa.
    return {"meta": {"isin": isin, "procedencia": {
                "valoracion.vl": etiqueta_vl, "valoracion.vl_fecha": etiqueta_vl,
                "identificacion.divisa_base": etiqueta_divisa}},
            "identificacion": {"nombre": "SICAV", "divisa_base": divisa_base},
            "valoracion": {"vl": 41.8699, "vl_fecha": "2026-06-30"}}


def test_divisa_del_vl_solo_cae_a_la_de_la_clase_con_la_misma_procedencia():
    assert informe.divisa_del_vl(_ficha_etiquetada(SICAV, SEMESTRAL, SEMESTRAL)) == "EUR"
    # fuentes distintas: no
    assert informe.divisa_del_vl(_ficha_etiquetada(SICAV, "cnmv:zip_mensual", "morningstar_lt:screener")) is None
    # la misma fuente con otro documento: tampoco
    assert informe.divisa_del_vl(_ficha_etiquetada(
        SICAV, SEMESTRAL, "cnmv_sicav_almer:informe-semestral-2025-12")) is None
    # el screener de Morningstar da el VL en EUR (currencyId=EUR) aunque la clase sea USD
    assert informe.divisa_del_vl(_ficha_etiquetada(
        SICAV, "morningstar_lt:screener", "morningstar_lt:screener", "USD")) is None
    # la del propio VL siempre manda
    d = _ficha_etiquetada(SICAV, "cnmv:zip_mensual", "morningstar_lt:screener", "USD")
    d["valoracion"]["vl_divisa"] = "EUR"
    assert informe.divisa_del_vl(d) == "EUR"


def test_el_informe_de_la_sicav_vuelve_a_pintar_su_divisa(tmp_path):
    html = informe.genera_html(_ficha_etiquetada(SICAV, SEMESTRAL, SEMESTRAL), SICAV, base=tmp_path)
    assert _tarjeta_vl(html) == "41,8699 EUR"
    html = informe.genera_html(_ficha_etiquetada(SICAV, "cnmv:zip_mensual", "morningstar_lt:screener"),
                               SICAV, base=tmp_path)
    assert _tarjeta_vl(html) == "41,8699 ·"


@requiere_node
def test_el_visor_aplica_la_misma_regla(tmp_path):
    funds = tmp_path / "data" / "funds"
    funds.mkdir(parents=True)
    (funds / f"{SICAV}.json").write_text(json.dumps(_ficha_etiquetada(SICAV, SEMESTRAL, SEMESTRAL)),
                                         encoding="utf-8")
    (funds / f"{USD}.json").write_text(json.dumps(_ficha_etiquetada(
        USD, "morningstar_lt:screener", "morningstar_lt:screener", "USD")), encoding="utf-8")
    html = _ejecuta(tmp_path, visor.genera(tmp_path).read_text(encoding="utf-8"), {}, [])
    filas = dict(re.findall(r'<tr data-isin="([A-Z0-9]+)">(.*?)</tr>', html["cuerpo"]))
    assert 'title="EUR">EUR</td>' in filas[SICAV]
    assert "USD" not in filas[USD] and "EUR" not in filas[USD]
