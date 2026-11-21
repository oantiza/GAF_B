# -*- coding: utf-8 -*-
"""Con la guarda de regresión saltando, el VL y las métricas de la serie se
actualizan igual (decisión de Óscar, 29-10-2026).

Caso real de la pasada del 29-10: 24 fichas llevaban desde septiembre u octubre
sin reescribirse porque Morningstar dejó de dar su cartera, y con ellas el VL
de julio. La guarda sigue protegiendo la cartera; lo de la serie no depende de
ella y entra.
"""
import json
from datetime import date
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import update as update_pipeline  # noqa: E402
from core.adquisicion import procedencia  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Endpoint  # noqa: E402
from core.schema import set_path  # noqa: E402

ISIN = "LU0000000001"


def _adaptador(id_, datos, endpoint, orden):
    def fetch(isin, ctx):
        out = {}
        with procedencia.etapa(endpoint):
            for ruta, valor in datos.items():
                set_path(out, ruta, valor)
        return out
    return Adaptador(id=id_, descripcion="", oficial=False,
                     capacidades={r: "rendimiento" for r in datos},
                     endpoints=(Endpoint(endpoint, "rendimiento"),), fetch=fetch, orden=orden)


def _previo():
    posiciones = [{"nombre": f"Pos {i}", "isin": f"XX{i:010d}", "peso_pct": 1.0} for i in range(60)]
    return {
        "meta": {"isin": ISIN, "actualizado": "2026-09-05T06:00:00+00:00",
                 "procedencia": {"valoracion.vl": "morningstar_lt:sal_quote",
                                 "rentabilidad.trailing_pct.10a_anualizada.fondo": "morningstar_lt:x",
                                 "cartera.fecha": "morningstar_lt:sal_position"}},
        "identificacion": {"nombre": "Fondo A EUR Acc", "tipo": "fondo"},
        "valoracion": {"vl": 9.0, "vl_fecha": "2026-07-09"},
        "rentabilidad": {"fecha_dato": "2026-06-30",
                         "trailing_pct": {"1a": {"fondo": 3.0, "categoria": 2.0},
                                          "10a_anualizada": {"fondo": 7.0}}},
        "riesgo": {"sri_kid_1a7": 4},
        "cartera": {"fecha": "2026-06-30", "posiciones": posiciones},
    }


def _ejecuta(tmp_path, previo, adaptadores):
    (tmp_path / "data" / "funds").mkdir(parents=True)
    (tmp_path / "data" / "funds" / f"{ISIN}.json").write_text(json.dumps(previo), encoding="utf-8")
    with patch.dict(update_pipeline.FUENTES, {a.id: a for a in adaptadores}, clear=True):
        res = update_pipeline.ejecuta_pipeline(ISIN, "fondo", [a.id for a in adaptadores], None,
                                               {"prioridad_fuentes": []}, False, tmp_path, True,
                                               print_cb=lambda _m: None)
    return res, json.loads((tmp_path / "data" / "funds" / f"{ISIN}.json").read_text(encoding="utf-8"))


# Del dia: la prueba mira que no salte `vl_antiguo`, que se mide contra el reloj.
HOY = date.today().isoformat()
VL = {"valoracion.vl": 10.5, "valoracion.vl_fecha": HOY, "valoracion.vl_divisa": "EUR",
      "rentabilidad.fecha_dato": "2026-09-30", "rentabilidad.trailing_pct.1a.fondo": 5.0,
      "riesgo.historial_precios.source_history": "eodhd",
      "riesgo.historial_precios.last_date": HOY}
MS_POBRE = {"identificacion.nombre": "Fondo A EUR Acc", "valoracion.vl": 9.0,
            "valoracion.vl_fecha": "2026-07-09", "rentabilidad.trailing_pct.1a.categoria": 2.5}


def test_la_guarda_conserva_la_cartera_y_deja_pasar_la_serie(tmp_path):
    res, d = _ejecuta(tmp_path, _previo(), [_adaptador("vl_eodhd", VL, "eod", 16),
                                            _adaptador("morningstar_lt", MS_POBRE, "sal_quote", 20)])
    assert res["ok"] and res["reason"].startswith("parcial: QUALITY_REGRESSION_BLOCKED")
    # lo de la serie, nuevo y con su procedencia
    assert d["valoracion"]["vl"] == 10.5 and d["valoracion"]["vl_fecha"] == HOY
    assert d["rentabilidad"]["fecha_dato"] == "2026-09-30"
    assert d["rentabilidad"]["trailing_pct"]["1a"]["fondo"] == 5.0
    assert d["meta"]["procedencia"]["valoracion.vl"] == "vl_eodhd:eod"
    # el bloque de métricas se sustituye entero: el 10 años viejo sale
    assert "10a_anualizada" not in d["rentabilidad"]["trailing_pct"]
    assert "rentabilidad.trailing_pct.10a_anualizada.fondo" not in d["meta"]["procedencia"]
    # lo demás, el de la ficha anterior
    assert len(d["cartera"]["posiciones"]) == 60 and d["riesgo"]["sri_kid_1a7"] == 4
    assert d["rentabilidad"]["trailing_pct"]["1a"]["categoria"] == 2.0
    assert d["meta"]["actualizado"].startswith("2026-09-05")
    parcial = d["meta"]["actualizacion_parcial"]
    assert parcial["motivo"].startswith("QUALITY_REGRESSION_BLOCKED") and parcial["hojas"] >= 5
    assert d["meta"]["contraste"]["valoracion.vl"]["valor"] == 9.0
    assert not any(f.startswith("vl_antiguo") for f in d["calidad"]["flags"])


def test_sin_serie_la_guarda_sigue_sin_escribir(tmp_path):
    res, d = _ejecuta(tmp_path, _previo(), [_adaptador("morningstar_lt", MS_POBRE, "sal_quote", 20)])
    assert not res["ok"] and d == _previo()


def test_solo_vl_sin_metricas_no_toca_las_metricas_anteriores(tmp_path):
    solo_vl = {k: v for k, v in VL.items() if not k.startswith("rentabilidad")}
    res, d = _ejecuta(tmp_path, _previo(), [_adaptador("vl_eodhd", solo_vl, "eod", 16),
                                            _adaptador("morningstar_lt", MS_POBRE, "sal_quote", 20)])
    assert res["ok"] and d["valoracion"]["vl"] == 10.5
    assert d["rentabilidad"]["trailing_pct"]["10a_anualizada"]["fondo"] == 7.0
    assert d["rentabilidad"]["fecha_dato"] == "2026-06-30"



def test_la_evidencia_de_la_politica_viaja_con_las_metricas(tmp_path):
    con_evidencia = {**VL, "distribuciones.historial_consultado": True,
                     "documentos_oficiales.kid_politica": "acumulacion",
                     "documentos_oficiales.kid_politica_cita": "Los ingresos se reinvierten."}
    res, d = _ejecuta(tmp_path, _previo(), [_adaptador("vl_eodhd", con_evidencia, "eod", 16),
                                            _adaptador("morningstar_lt", MS_POBRE, "sal_quote", 20)])
    assert res["reason"].startswith("parcial:")
    assert d["distribuciones"]["historial_consultado"] is True
    assert d["documentos_oficiales"]["kid_politica"] == "acumulacion"


def test_la_marca_de_consultado_no_pasa_sin_los_pagos_que_trajo(tmp_path):
    """Sin la lista, la marca diria que el proveedor no tiene ningun reparto."""
    ms = {**MS_POBRE, "distribuciones.historial_consultado": True,
          "distribuciones.historial": [{"fecha": "2026-03-01", "importe_por_participacion": 1.0}]}
    res, d = _ejecuta(tmp_path, _previo(), [_adaptador("vl_eodhd", VL, "eod", 16),
                                            _adaptador("morningstar_lt", ms, "sal_quote", 20)])
    assert res["reason"].startswith("parcial:")
    assert "historial_consultado" not in (d.get("distribuciones") or {})


def test_lo_medido_contra_su_indice_viaja_con_las_metricas(tmp_path):
    con_relativas = {**VL, "riesgo.relativas.indice_nombre": "MSCI World",
                     "riesgo.relativas.beta.3a": 0.98}
    res, d = _ejecuta(tmp_path, _previo(), [_adaptador("vl_eodhd", con_relativas, "eod", 16),
                                            _adaptador("morningstar_lt", MS_POBRE, "sal_quote", 20)])
    assert res["reason"].startswith("parcial:")
    assert d["riesgo"]["relativas"]["indice_nombre"] == "MSCI World"
    assert d["riesgo"]["relativas"]["beta"]["3a"] == 0.98
