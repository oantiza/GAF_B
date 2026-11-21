# -*- coding: utf-8 -*-
"""Informes de la fase 0 (contraste y cobertura) y aviso de VL antiguo, sin red."""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad, fase0  # noqa: E402


def _ms(valor, ruta):
    return {"fuente": "morningstar_lt:screener", "valor": valor, "desplazada_por": "vl_eodhd",
            "bloque": "vl" if ruta.startswith("valoracion") else "metricas"}


def _ficha(**over):
    d = {
        "meta": {"isin": "LU1", "actualizado": "2026-10-28T06:00:00+00:00",
                 "procedencia": {"valoracion.vl": "vl_eodhd:eod",
                                 "valoracion.vl_fecha": "vl_eodhd:eod",
                                 "rentabilidad.fecha_dato": "vl_eodhd:eod",
                                 "rentabilidad.trailing_pct.1a.fondo": "vl_eodhd:eod",
                                 "rating.estrellas": "morningstar_lt:screener",
                                 "identificacion.nombre": "cssf:registro",
                                 "costes.ter_pct": "retenido:morningstar_lt:screener@2026-09-30"}},
        "identificacion": {"tipo": "fondo", "nombre": "Fondo A", "gestora_legal": "Gestora SA"},
        "valoracion": {"vl": 10.5, "vl_fecha": "2026-10-27"},
        "rentabilidad": {"fecha_dato": "2026-09-30",
                         "trailing_pct": {"1a": {"fondo": 5.0}, "3a_anualizada": {"fondo": 6.0}},
                         "por_año_natural": {"2025": {"fondo": 8.364}}},
        "riesgo": {"fecha_dato": "2026-09-30", "volatilidad_pct": {"3a": {"fondo": 11.36}},
                   "sharpe": {"3a": {"fondo": 0.41}}},
    }
    con = {"valoracion.vl": _ms(10.0, "valoracion.vl"),
           "valoracion.vl_fecha": _ms("2026-07-31", "valoracion.vl_fecha"),
           "rentabilidad.fecha_dato": _ms("2026-09-30", "rentabilidad.fecha_dato"),
           "riesgo.fecha_dato": _ms("2026-09-30", "riesgo.fecha_dato"),
           "rentabilidad.trailing_pct.1a.fondo": _ms(5.2, "r"),
           "rentabilidad.trailing_pct.3a_anualizada.fondo": _ms(7.0, "r"),
           "rentabilidad.por_año_natural.2025.fondo": _ms(8.36, "r"),
           "riesgo.volatilidad_pct.3a.fondo": _ms(11.2, "r"),
           "riesgo.sharpe.3a.fondo": _ms(0.45, "r"),
           "rentabilidad.trailing_pct.10a_anualizada.fondo": _ms(7.5, "r")}
    d["meta"]["contraste"] = con
    d.update(over)
    return d


def _por_ruta(filas):
    return {f["ruta"]: f for f in filas}


def test_contraste_compara_solo_con_la_misma_fecha():
    f = _por_ruta(fase0.contraste_ficha(_ficha()))
    assert f["valoracion.vl"]["estado"] == "fecha_distinta"      # VL de Morningstar parado en julio
    assert f["rentabilidad.trailing_pct.1a.fondo"]["estado"] == "ok"
    assert f["rentabilidad.trailing_pct.1a.fondo"]["diferencia"] == -0.2
    assert f["rentabilidad.trailing_pct.3a_anualizada.fondo"]["estado"] == "fuera"
    assert f["rentabilidad.por_año_natural.2025.fondo"]["estado"] == "ok"
    assert f["riesgo.volatilidad_pct.3a.fondo"]["estado"] == "ok"
    assert f["riesgo.sharpe.3a.fondo"]["estado"] == "ok"
    assert f["rentabilidad.trailing_pct.10a_anualizada.fondo"]["estado"] == "sin_propio"
    assert "rentabilidad.fecha_dato" not in f                    # las fechas no se comparan


def test_contraste_del_vl_en_porcentaje_relativo():
    d = _ficha()
    d["meta"]["contraste"]["valoracion.vl_fecha"]["valor"] = "2026-10-27"
    d["meta"]["contraste"]["valoracion.vl"]["valor"] = 10.48
    f = _por_ruta(fase0.contraste_ficha(d))["valoracion.vl"]
    assert f["estado"] == "ok" and f["unidad"] == "%"
    assert abs(f["diferencia"] - (10.5 / 10.48 - 1) * 100) < 1e-3


def test_sin_la_fecha_de_una_de_las_dos_no_se_compara_ni_se_da_por_buena():
    """EXT-13: con las dos fechas ausentes, la comparación salía «ok» porque «None» era igual a «None»."""
    def ficha(fecha_propia, fecha_ms):
        d = {"riesgo": {"volatilidad_pct": {"3a": {"fondo": 10.0}}},
             "meta": {"contraste": {"riesgo.volatilidad_pct.3a.fondo": {"valor": 10.2, "fuente": "morningstar_lt:MFsnapshot"}}}}
        if fecha_propia:
            d["riesgo"]["fecha_dato"] = fecha_propia
        if fecha_ms:
            d["meta"]["contraste"]["riesgo.fecha_dato"] = {"valor": fecha_ms, "fuente": "morningstar_lt:MFsnapshot"}
        return d

    def estado(fecha_propia, fecha_ms):
        return _por_ruta(fase0.contraste_ficha(ficha(fecha_propia, fecha_ms)))["riesgo.volatilidad_pct.3a.fondo"]

    # 10,0 propio frente a 10,2: a 0,2 puntos, dentro de la tolerancia de 0,5. Solo vale con las dos fechas, e iguales.
    assert estado("2026-10-31", "2026-10-31")["estado"] == "ok"
    assert estado("2026-10-31", "2026-09-30")["estado"] == "fecha_distinta"
    for propia, ms in ((None, None), ("2026-10-31", None), (None, "2026-10-31")):
        fila = estado(propia, ms)
        assert fila["estado"] == "sin_fecha", (propia, ms)
        assert fila["diferencia"] is None
    # Y el resumen la cuenta aparte: ni comparada ni dentro.
    r = fase0.resume_contraste(fase0.contraste_ficha(ficha(None, None)))["riesgo.volatilidad_pct"]
    assert (r["comparadas"], r["ok"], r["sin_fecha"], r["pct_ok"]) == (0, 0, 1, None)


def test_resumen_del_contraste():
    r = fase0.resume_contraste(fase0.contraste_ficha(_ficha()))
    assert r["rentabilidad.trailing_pct"]["comparadas"] == 2
    assert r["rentabilidad.trailing_pct"]["pct_ok"] == 50.0
    assert r["rentabilidad.trailing_pct"]["sin_propio"] == 1
    assert r["valoracion.vl"]["fecha_distinta"] == 1 and r["valoracion.vl"]["pct_ok"] is None


def test_cobertura_por_bloque_y_frescura():
    c = fase0.cobertura_ficha(_ficha())
    assert c["vl_fresco"] and c["dias_vl"] == 1 and c["vl_fuente"] == "vl_eodhd"
    assert c["metricas_propias"]
    assert c["bloques"]["rating"] == [1, 0]
    assert c["bloques"]["costes"] == [1, 0]          # lo retenido de Morningstar sigue siéndolo
    assert c["bloques"]["identificacion"] == [1, 1]
    r = fase0.resume_cobertura([c])
    assert r["vl_fresco"] == 1 and r["gestoras"]["Gestora SA"]["fondos"] == 1


def test_vl_del_viernes_es_fresco_un_lunes():
    assert fase0.dia_habil_anterior(date(2026, 11, 2)) == date(2026, 10, 30)
    d = _ficha()
    d["meta"]["actualizado"] = "2026-11-02"
    d["valoracion"]["vl_fecha"] = "2026-10-30"
    assert fase0.cobertura_ficha(d)["vl_fresco"]
    d["valoracion"]["vl_fecha"] = "2026-10-29"
    assert not fase0.cobertura_ficha(d)["vl_fresco"]


def test_calidad_avisa_del_vl_antiguo():
    d = _ficha()
    d["valoracion"]["vl_fecha"] = "2026-07-31"
    calidad.aplica(d)
    assert "vl_antiguo(89d)" in d["calidad"]["flags"]
    d["valoracion"]["vl_fecha"] = "2026-10-27"
    calidad.aplica(d)
    assert not any(f.startswith("vl_antiguo") for f in d["calidad"]["flags"])


def test_contraste_no_mezcla_divisas():
    # Clase en USD: lo propio va en USD; lo de sal-service de Morningstar también,
    # pero lo del screener y las vistas «snapshot» viene en EUR.
    d = _ficha()
    d["valoracion"]["vl_divisa"] = "USD"
    d["riesgo"]["historial_precios"] = {"divisa_metricas": "USD"}
    d["meta"]["contraste"]["rentabilidad.trailing_pct.1a.fondo"]["fuente"] = "morningstar_lt:sal_trailingReturn"
    f = _por_ruta(fase0.contraste_ficha(d))
    assert f["rentabilidad.trailing_pct.1a.fondo"]["estado"] == "ok"
    assert f["rentabilidad.por_año_natural.2025.fondo"]["estado"] == "divisa_distinta"
    assert fase0.divisa_morningstar("morningstar_lt:ETFsnapshot", "USD") == "EUR"
    assert fase0.divisa_morningstar("morningstar_lt:sal_riskVolatility", "USD") == "USD"


def test_retraso_en_dias_habiles():
    # Pasada del jueves 29-10: el día hábil anterior es el 28.
    assert fase0.retraso_habiles(date(2026, 10, 28), date(2026, 10, 29)) == 0
    assert fase0.retraso_habiles(date(2026, 10, 27), date(2026, 10, 29)) == 1
    # Pasada del lunes 02-11: el viernes 30 es el día hábil anterior.
    assert fase0.retraso_habiles(date(2026, 10, 29), date(2026, 11, 2)) == 1
    r = fase0.resume_cobertura([fase0.cobertura_ficha(_ficha())])
    assert r["vl_al_dia"] == 1 and r["retrasos"] == {"0": 1} and r["sin_actualizar"] == []
