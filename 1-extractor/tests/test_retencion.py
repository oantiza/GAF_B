# -*- coding: utf-8 -*-
"""Retención de lo que la fuente deja de traer (14-10-2026).

Casos sintéticos con la forma de los reales del refresco de carteras del 14-10:
cada test lleva el ISIN del fondo cuyo hueco reproduce. La fecha de referencia
es la de aquella pasada.
"""
import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import adaptador_bdb  # noqa: E402
from core.adquisicion import nucleo, procedencia, retencion  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint  # noqa: E402
from core.contratos import valida  # noqa: E402
from core.schema import set_path  # noqa: E402

HOY = dt.date(2026, 10, 14)
FIS = "morningstar_lt:sal_fixedIncomeStyle"
CQ = "morningstar_lt:sal_creditQuality"
SNAP = "morningstar_lt:ETFsnapshot"
AMAP = "morningstar_lt:sal_allocationMap"


def _asignacion(rf: float, liquidez: float = 0.0, rv: float = 0.0, otros: float = 0.0) -> dict:
    return {clase: {"neto": v, "largo": v, "corto": 0.0}
            for clase, v in (("rv", rv), ("rf", rf), ("liquidez", liquidez), ("otros", otros))}


def _ficha(fecha: str | None, rf: float | None = None, renta_fija: dict | None = None,
           proc: dict | None = None, **extra) -> dict:
    """Ficha v2 mínima: cartera con fecha, asignación y renta fija."""
    d: dict = {"identificacion": {"nombre": "Fondo", "tipo": "fondo"},
               "meta": {"isin": "LU0000000001", "actualizado": "2026-09-05T04:05:12+00:00",
                        "procedencia": dict(proc or {})}}
    cartera: dict = {}
    if fecha:
        cartera["fecha"] = fecha
    if rf is not None:
        cartera["asignacion_activos"] = _asignacion(rf, round(100 - rf, 5))
    if renta_fija is not None:
        cartera["renta_fija"] = renta_fija
    if cartera:
        d["cartera"] = cartera
    for ruta, valor in extra.items():
        set_path(d, ruta.replace("__", "."), valor)
    return d


def _rf_anterior(fecha: str) -> dict:
    return {"fecha": f"{fecha}T05:00:00.000", "calidad_media": "BBB", "duracion_efectiva": 8.4,
            "vencimiento_efectivo": 10.93241, "ytm_pct": 4.62198, "duracion_modificada": 8.11542}


def _proc_rf(*campos: str) -> dict:
    return {f"cartera.renta_fija.{c}": FIS for c in campos}


# ------------------------------------------------------------------ renta fija
def test_lu0077500055_conserva_vencimiento_tir_y_duracion_con_167_dias():
    anterior = _ficha("2026-04-30", 99.8, _rf_anterior("2026-04-30"),
                      _proc_rf("fecha", "calidad_media", "duracion_efectiva", "vencimiento_efectivo",
                               "ytm_pct", "duracion_modificada"))
    # sal_fixedIncomeStyle a null a 31-07: llegan la fecha, la calidad media y la duración efectiva.
    nuevo = _ficha("2026-07-31", 99.79537,
                   {"fecha": "2026-07-31T05:00:00.000", "calidad_media": "BBB", "duracion_efectiva": 8.45805},
                   _proc_rf("fecha", "calidad_media") | {"cartera.renta_fija.duracion_efectiva": "morningstar_lt:screener"})

    resumen = retencion.aplica(nuevo, anterior, HOY)

    rf = nuevo["cartera"]["renta_fija"]
    assert (rf["vencimiento_efectivo"], rf["ytm_pct"], rf["duracion_modificada"]) == (10.93241, 4.62198, 8.11542)
    assert rf["duracion_efectiva"] == 8.45805 and rf["fecha"].startswith("2026-07-31")   # lo nuevo manda
    proc = nuevo["meta"]["procedencia"]
    for campo in ("vencimiento_efectivo", "ytm_pct", "duracion_modificada"):
        assert proc[f"cartera.renta_fija.{campo}"] == f"retenido:{FIS}@2026-04-30"
    assert proc["cartera.renta_fija.duracion_efectiva"] == "morningstar_lt:screener"
    assert {r["ruta"] for r in resumen["retenidos"]} == {
        "cartera.renta_fija.vencimiento_efectivo", "cartera.renta_fija.ytm_pct",
        "cartera.renta_fija.duracion_modificada"}
    assert {r["dias"] for r in resumen["retenidos"]} == {167}
    assert nuevo["meta"]["retencion"] == resumen
    assert retencion.avisos(nuevo) == ["dato_retenido"]


@pytest.mark.parametrize("dias, retiene", [(180, True), (181, False)])
def test_limite_de_180_dias_desde_la_fecha_de_cartera(dias, retiene):
    fecha = (HOY - dt.timedelta(days=dias)).isoformat()
    anterior = _ficha(fecha, 99.8, _rf_anterior(fecha), _proc_rf("ytm_pct"))
    nuevo = _ficha("2026-09-30", 99.8, {"fecha": "2026-09-30T05:00:00.000"})

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert ("ytm_pct" in nuevo["cartera"]["renta_fija"]) is retiene
    if not retiene:
        motivos = {d["ruta"]: d["motivo"] for d in resumen["descartados"]}
        assert motivos["cartera.renta_fija.ytm_pct"] == "antiguedad_181d_supera_180d"
        assert retencion.avisos(nuevo) == []


def test_ie0032722484_tramos_de_vencimiento_con_256_dias_no_se_conservan():
    tramos = {"1_3": 15.40314, "3_5": 29.00882, "5_7": 13.01048, "7_10": 27.6899, "10_15": 7.18443}
    anterior = _ficha("2026-01-31", 117.9, {"fecha": "2026-01-31T06:00:00.000", "vencimientos_pct": tramos},
                      {f"cartera.renta_fija.vencimientos_pct.{k}": "morningstar_lt:sal_maturitySchedule"
                       for k in tramos})
    nuevo = _ficha("2026-08-31", 117.92727, {"fecha": "2026-08-31T05:00:00.000", "ytm_pct": 3.87})

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert "vencimientos_pct" not in nuevo["cartera"]["renta_fija"]
    assert resumen["descartados"] == [{"ruta": "cartera.renta_fija.vencimientos_pct",
                                       "motivo": "antiguedad_256d_supera_180d", "fecha": "2026-01-31"}]
    assert "retenidos" not in resumen


@pytest.mark.parametrize("peso, retiene", [(5.0, True), (4.99, False)])
def test_limite_del_5_pct_de_renta_fija_en_la_cartera_nueva(peso, retiene):
    anterior = _ficha("2026-06-30", 40.0, _rf_anterior("2026-06-30"), _proc_rf("ytm_pct"))
    nuevo = _ficha("2026-09-30", peso, {"fecha": "2026-09-30T05:00:00.000"})

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert ("ytm_pct" in nuevo["cartera"]["renta_fija"]) is retiene
    if not retiene:
        motivos = {d["ruta"]: d["motivo"] for d in resumen["descartados"]}
        assert motivos["cartera.renta_fija.ytm_pct"] == "renta_fija_4.99pct_bajo_umbral"


def test_un_bloque_a_cero_cuenta_como_vacio_y_uno_con_dato_no_se_mezcla():
    calidad = {"AAA": 0.0, "BB": 55.24, "B": 28.34, "sin_rating": 10.66}
    anterior = _ficha("2026-06-30", 95.4, {"fecha": "2026-06-30", "calidad_crediticia_pct": calidad,
                                           "vencimientos_pct": {"1_3": 50.0, "3_5": 50.0}},
                      {f"cartera.renta_fija.calidad_crediticia_pct.{k}": CQ for k in calidad})
    # La estructura llega con todo a cero; los tramos llegan con dato (otra cartera): no se tocan.
    nuevo = _ficha("2026-09-30", 95.4, {"fecha": "2026-09-30",
                                        "calidad_crediticia_pct": {"AAA": 0.0, "BB": 0.0},
                                        "vencimientos_pct": {"1_3": 0.0, "3_5": 100.0}})

    retencion.aplica(nuevo, anterior, HOY)

    rf = nuevo["cartera"]["renta_fija"]
    assert rf["calidad_crediticia_pct"] == calidad
    assert rf["vencimientos_pct"] == {"1_3": 0.0, "3_5": 100.0}


def test_lo_que_trae_la_fuente_nunca_se_pisa():
    anterior = _ficha("2026-06-30", 99.0, _rf_anterior("2026-06-30"), _proc_rf("ytm_pct"))
    nuevo = _ficha("2026-09-30", 99.0, {"fecha": "2026-09-30", "ytm_pct": 3.0, "vencimiento_efectivo": 0.0,
                                        "duracion_modificada": 7.0, "calidad_media": "A"})

    retencion.aplica(nuevo, anterior, HOY)

    rf = nuevo["cartera"]["renta_fija"]
    assert (rf["ytm_pct"], rf["vencimiento_efectivo"], rf["duracion_modificada"]) == (3.0, 0.0, 7.0)


def test_lo_ya_retenido_conserva_su_fecha_original_y_caduca():
    anterior = _ficha("2026-07-31", 99.8, _rf_anterior("2026-07-31"),
                      {"cartera.renta_fija.ytm_pct": f"retenido:{FIS}@2026-04-30"})
    for hoy, retiene in ((HOY, True), (HOY + dt.timedelta(days=14), False)):
        nuevo = _ficha("2026-08-31", 99.8, {"fecha": "2026-08-31"})
        resumen = retencion.aplica(nuevo, anterior, hoy)
        assert ("ytm_pct" in nuevo["cartera"]["renta_fija"]) is retiene
        # Las demás métricas, servidas por la fuente el 31-07, siguen dentro de plazo.
        assert nuevo["cartera"]["renta_fija"]["vencimiento_efectivo"] == 10.93241
        if retiene:
            # La etiqueta no se anida ni se rejuvenece: la cuenta sigue desde el 30-04.
            assert nuevo["meta"]["procedencia"]["cartera.renta_fija.ytm_pct"] == f"retenido:{FIS}@2026-04-30"
            dias = {r["ruta"]: r["dias"] for r in resumen["retenidos"]}
            assert dias["cartera.renta_fija.ytm_pct"] == 167
            assert dias["cartera.renta_fija.vencimiento_efectivo"] == 75
        else:
            assert resumen["descartados"] == [{"ruta": "cartera.renta_fija.ytm_pct", "fecha": "2026-04-30",
                                               "motivo": "antiguedad_181d_supera_180d"}]


# ------------------------------------------------------------------ asignación
def test_lu1832969650_asignacion_todo_nula_se_conserva_si_hay_cartera_nueva():
    aloc = _asignacion(15.56592, 2.43435, 0.0, 81.99973)
    proc = {f"cartera.asignacion_activos.{c}.{k}": AMAP for c in aloc for k in ("neto", "largo")}
    proc |= {f"cartera.asignacion_activos.{c}.corto": SNAP for c in aloc}
    anterior = _ficha("2026-05-31", proc=proc, cartera__asignacion_activos=aloc)
    nuevo = _ficha("2026-08-31")

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert nuevo["cartera"]["asignacion_activos"] == aloc
    assert nuevo["meta"]["procedencia"]["cartera.asignacion_activos.otros.neto"] == f"retenido:{AMAP}@2026-05-31"
    assert nuevo["meta"]["procedencia"]["cartera.asignacion_activos.rf.corto"] == f"retenido:{SNAP}@2026-05-31"
    assert resumen["retenidos"] == [{"ruta": "cartera.asignacion_activos", "fecha": "2026-05-31", "dias": 136,
                                     "fuente": sorted([AMAP, SNAP])}]

    # Sin cartera nueva (la fuente no respondió) no se retiene nada de cartera.
    sin_cartera = _ficha(None)
    resumen = retencion.aplica(sin_cartera, anterior, HOY)
    assert "cartera" not in sin_cartera
    assert resumen["descartados"][0]["motivo"] == "sin_cartera_nueva"


def test_la_renta_fija_se_mide_con_la_asignacion_retenida():
    aloc = _asignacion(80.0, 20.0)
    anterior = _ficha("2026-06-30", renta_fija=_rf_anterior("2026-06-30"), proc=_proc_rf("ytm_pct"),
                      cartera__asignacion_activos=aloc)
    nuevo = _ficha("2026-09-30", renta_fija={"fecha": "2026-09-30"})

    retencion.aplica(nuevo, anterior, HOY)

    assert nuevo["cartera"]["asignacion_activos"] == aloc
    assert nuevo["cartera"]["renta_fija"]["ytm_pct"] == 4.62198


# ------------------------------------------------------------------ gestora, ratings, registros
@pytest.mark.parametrize("actualizado, retiene", [("2025-10-14T08:00:00+00:00", True),
                                                   ("2025-10-13T08:00:00+00:00", False)])
def test_lu0995386439_gestora_hasta_365_dias_y_el_medalist_nunca(actualizado, retiene):
    anterior = _ficha("2026-06-30", 0.0, proc={"identificacion.gestora": SNAP, "rating.medalist.rating": SNAP},
                      identificacion__gestora="EDM", rating__medalist__rating="Negative",
                      rating__medalist__fecha="2026-05-31")
    anterior["meta"]["actualizado"] = actualizado
    nuevo = _ficha("2026-09-30", 0.0)

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert "rating" not in nuevo
    assert (nuevo["identificacion"].get("gestora") == "EDM") is retiene
    if retiene:
        assert nuevo["meta"]["procedencia"]["identificacion.gestora"] == f"retenido:{SNAP}@2025-10-14"
        assert resumen["retenidos"][0]["dias"] == 365
    else:
        assert resumen["descartados"][0]["motivo"] == "antiguedad_366d_supera_365d"


def test_es0138922036_un_medalist_retirado_desaparece():
    anterior = _ficha("2026-06-30", 40.0, rating__medalist__rating="Neutral", rating__estrellas__overall=3)
    nuevo = _ficha("2026-09-30", 40.02088, rating__estrellas__overall=3)

    assert retencion.aplica(nuevo, anterior, HOY) == {}
    assert nuevo["rating"] == {"estrellas": {"overall": 3}}
    assert "retencion" not in nuevo["meta"]


def test_lu1066281574_registros_cssf_y_esma_no_se_retienen_y_avisan():
    cssf = {"paraguas_legal": "SIGMA INVESTMENT HOUSE FCP", "compartimento_legal": "EQUITY SPAIN",
            "clase_legal": "A", "fecha_autorizacion_cssf": "2014-04-16"}
    esma = {"nombre_legal_esma": "SIGMA INVESTMENT HOUSE FCP-EQUITY SPAIN", "estado_registro_esma": "Active",
            "marco_legal": "UCITS"}
    anterior = _ficha("2026-06-30", 0.0)
    anterior["identificacion"].update(cssf | esma)
    nuevo = _ficha("2026-09-30", 0.0)

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert not set(cssf | esma) & set(nuevo["identificacion"])
    assert resumen["registros_no_encontrados"] == ["cssf", "esma"]
    assert retencion.avisos(nuevo) == ["registro_no_encontrado"]


def test_lu2240056445_solo_falta_el_cssf():
    anterior = _ficha("2026-06-30", 0.0, identificacion__paraguas_legal="LONVIA",
                      identificacion__estado_registro_esma="Active")
    nuevo = _ficha("2026-08-31", 0.0, identificacion__estado_registro_esma="Active")

    resumen = retencion.aplica(nuevo, anterior, HOY)

    assert resumen["registros_no_encontrados"] == ["cssf"]
    assert "paraguas_legal" not in nuevo["identificacion"]


def test_las_acciones_no_se_tocan():
    anterior = _ficha("2026-06-30", identificacion__gestora="X")
    anterior["identificacion"]["tipo"] = "accion"
    nuevo = {"identificacion": {"tipo": "accion"}, "meta": {}}
    assert retencion.aplica(nuevo, anterior, HOY) == {}
    assert "gestora" not in nuevo["identificacion"]


# ------------------------------------------------------------------ núcleo y canónico
def _adaptador(datos: dict) -> Adaptador:
    def fetch(isin, ctx):
        out: dict = {}
        for ruta, (etapa, valor) in datos.items():
            with procedencia.etapa(etapa):
                set_path(out, ruta, valor)
        return out
    return Adaptador(id="morningstar_lt", descripcion="", oficial=False, capacidades={"x": "cartera"},
                     endpoints=(Endpoint("e", "cartera"),), fetch=fetch, orden=20)


def test_lu1670722161_por_el_nucleo_la_calidad_retenida_recalcula_ig_y_hy(tmp_path, monkeypatch):
    monkeypatch.setattr(retencion, "_hoy", lambda: HOY)
    calidad = {"AAA": 0.0, "AA": 0.0, "A": 0.0, "BBB": 5.76, "BB": 55.24, "B": 28.34,
               "inferior_B": 0.0, "sin_rating": 10.66}
    anterior = _ficha("2026-06-30", 95.0, {"fecha": "2026-06-30T05:00:00.000", "calidad_crediticia_pct": calidad,
                                           "pct_investment_grade": 5.76, "pct_high_yield": 83.58},
                      {f"cartera.renta_fija.calidad_crediticia_pct.{k}": CQ for k in calidad})
    # sal_creditQuality.fund todo null: set_path no escribe nada de calidad.
    ms = _adaptador({"identificacion.nombre": ("ETFsnapshot", "Fondo HY"),
                     "cartera.fecha": ("sal_position", "2026-09-30"),
                     "cartera.renta_fija.fecha": ("sal_fixedIncomeStyle", "2026-09-30T05:00:00.000"),
                     "cartera.asignacion_activos.rf.neto": ("sal_allocationMap", 95.40646),
                     "cartera.asignacion_activos.liquidez.neto": ("sal_allocationMap", 4.59313)})
    ctx = Contexto(http=None, settings={"prioridad_fuentes": ["morningstar_lt"]}, base=tmp_path)

    d = nucleo.adquiere("LU1670722161", "fondo", ctx, [ms], anterior=anterior).datos

    rf, proc = d["cartera"]["renta_fija"], d["meta"]["procedencia"]
    assert rf["calidad_crediticia_pct"] == calidad
    assert (rf["pct_investment_grade"], rf["pct_high_yield"]) == (5.76, 83.58)
    assert proc["cartera.renta_fija.calidad_crediticia_pct.BB"] == f"retenido:{CQ}@2026-06-30"
    assert proc["cartera.renta_fija.pct_high_yield"] == "derivado:derivados"
    assert proc["cartera.asignacion_activos.rf.neto"] == "morningstar_lt:sal_allocationMap"
    assert d["meta"]["retencion"]["retenidos"][0]["dias"] == 106


def test_es0162916037_lo_corregido_a_mano_no_se_retiene_se_reaplica(tmp_path, monkeypatch):
    """Una corrección retenida pasaría por «redundante» y perdería su etiqueta `manual:`."""
    import json
    monkeypatch.setattr(retencion, "_hoy", lambda: HOY)
    correccion = {"motivo": "ficha de la gestora", "autor": "oscar", "fecha": "2026-10-13T13:30:18Z"}
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "correcciones.json").write_text(json.dumps({"version": 1, "correcciones": {
        "ES0162916037": {"cartera.renta_fija.ytm_pct": {"valor": 4.1, **correccion},
                         "cartera.renta_fija.calidad_crediticia_pct.A": {"valor": 50.55, **correccion}}}}),
        encoding="utf-8")
    anterior = _ficha("2026-08-31", 111.9, {"fecha": "2026-08-31", "ytm_pct": 4.1, "duracion_modificada": 3.2,
                                            "calidad_crediticia_pct": {"A": 50.55, "BBB": 40.0}},
                      {"cartera.renta_fija.ytm_pct": "manual:oscar",
                       "cartera.renta_fija.calidad_crediticia_pct.A": "manual:oscar",
                       "cartera.renta_fija.calidad_crediticia_pct.BBB": CQ,
                       "cartera.renta_fija.duracion_modificada": FIS})
    ms = _adaptador({"identificacion.nombre": ("ETFsnapshot", "Fondo RF"),
                     "cartera.fecha": ("sal_position", "2026-09-30"),
                     "cartera.asignacion_activos.rf.neto": ("sal_allocationMap", 111.88681)})
    ctx = Contexto(http=None, settings={"prioridad_fuentes": ["morningstar_lt"]}, base=tmp_path)

    d = nucleo.adquiere("ES0162916037", "fondo", ctx, [ms], anterior=anterior).datos

    rf, proc = d["cartera"]["renta_fija"], d["meta"]["procedencia"]
    assert rf["ytm_pct"] == 4.1 and proc["cartera.renta_fija.ytm_pct"] == "manual:oscar"
    assert rf["calidad_crediticia_pct"] == {"A": 50.55, "BBB": 40.0}
    assert proc["cartera.renta_fija.calidad_crediticia_pct.A"] == "manual:oscar"
    assert proc["cartera.renta_fija.calidad_crediticia_pct.BBB"] == f"retenido:{CQ}@2026-08-31"
    assert proc["cartera.renta_fija.duracion_modificada"] == f"retenido:{FIS}@2026-08-31"
    assert not any(c["redundante"] for c in d["meta"]["correcciones"].values())
    assert {r["ruta"] for r in d["meta"]["retencion"]["retenidos"]} == {
        "cartera.renta_fija.duracion_modificada", "cartera.renta_fija.calidad_crediticia_pct"}


def test_el_canonico_lleva_aviso_y_procedencia_y_cumple_el_contrato():
    anterior = _ficha("2026-04-30", 99.8, _rf_anterior("2026-04-30"),
                      _proc_rf("vencimiento_efectivo", "ytm_pct", "duracion_modificada"),
                      identificacion__paraguas_legal="CANDRIAM BONDS")
    nuevo = _ficha("2026-07-31", 99.79537, {"fecha": "2026-07-31T05:00:00.000", "calidad_media": "BBB"},
                   _proc_rf("fecha", "calidad_media"))
    nuevo["identificacion"]["clase_activo"] = "Fixed Income"
    retencion.aplica(nuevo, anterior, HOY)

    canonico = adaptador_bdb.convierte(nuevo)
    valida(canonico)

    fi = canonico["ms"]["fixed_income"]
    assert (fi["effective_maturity"], fi["yield_to_maturity"], fi["modified_duration"]) == (10.93241, 4.62198, 8.11542)
    assert f"retenido:{FIS}@2026-04-30" in canonico["provenance"]["fields"]["ms.fixed_income"].split("+")
    for bloque in (canonico["validation"]["warnings"], canonico["quality"]["warnings"],
                   canonico["classification_v2"]["warnings"]):
        assert "dato_retenido" in bloque and "registro_no_encontrado" in bloque
    assert canonico["validation"]["ok"] is True
