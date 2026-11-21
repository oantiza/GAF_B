# -*- coding: utf-8 -*-
"""El núcleo ejecuta el plan, atribuye cada hoja y sanea sin perder la pista.

Adaptadores de mentira, sin red: lo que se prueba es la orquestación.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import nucleo, procedencia  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint  # noqa: E402
from core.http import SinCache  # noqa: E402
from core.schema import set_path  # noqa: E402


def _adaptador(id_, datos, oficial=False, orden=50, aplica=None, falla=None):
    def fetch(isin, ctx):
        if falla:
            raise falla
        out = {}
        for ruta, valor in datos.items():
            with procedencia.etapa(ruta.split(".")[0]):
                set_path(out, ruta, valor)
        return out
    return Adaptador(id=id_, descripcion="", oficial=oficial,
                     capacidades={r: "identidad" for r in datos} or {"x": "identidad"},
                     endpoints=(Endpoint("e", "identidad"),), fetch=fetch,
                     aplica=aplica or (lambda i, t: True), orden=orden)


def _ctx(tmp_path):
    return Contexto(http=None, settings={"prioridad_fuentes": ["oficial", "ms"]}, base=tmp_path)


def test_fusiona_por_prioridad_y_atribuye(tmp_path):
    ms = _adaptador("ms", {"identificacion.nombre": "MS", "riesgo.sri_kid_1a7": 4,
                           "identificacion.gestora": "Brand"}, orden=20)
    oficial = _adaptador("oficial", {"riesgo.sri_kid_1a7": 5, "identificacion.ucits": True},
                         oficial=True, orden=10)
    res = nucleo.adquiere("LU1", "fondo", _ctx(tmp_path), [ms, oficial])
    d = res.datos

    assert d["riesgo"]["sri_kid_1a7"] == 5                 # oficial va primero en prioridad
    assert d["identificacion"]["nombre"] == "MS"
    assert d["identificacion"]["tipo"] == "fondo"         # config_csv
    proc = d["meta"]["procedencia"]
    assert proc["riesgo.sri_kid_1a7"] == "oficial:riesgo"
    assert proc["identificacion.nombre"] == "ms:identificacion"
    assert proc["identificacion.tipo"] == "config_csv"
    assert d["meta"]["adquisicion"]["plan"] == ["oficial", "ms"]
    assert set(d["meta"]["adquisicion"]["fuentes"]) == {"oficial", "ms"}


def test_una_fuente_caida_no_tumba_la_ficha(tmp_path):
    ms = _adaptador("ms", {"identificacion.nombre": "MS"}, orden=20)
    roto = _adaptador("roto", {"identificacion.x": 1}, orden=10, falla=RuntimeError("boom"))
    sin_cache = _adaptador("frio", {"identificacion.y": 1}, orden=30, falla=SinCache("no"))
    lineas = []
    res = nucleo.adquiere("LU1", "fondo", _ctx(tmp_path), [ms, roto, sin_cache],
                          print_cb=lineas.append)

    assert res.datos["identificacion"]["nombre"] == "MS"
    assert res.errores == ["roto: boom"]
    assert res.datos["meta"]["errores"] == ["roto: boom"]
    assert any("ERROR" in ln and "roto" in ln for ln in lineas)


def test_lo_derivado_se_atribuye_a_su_paso(tmp_path):
    ms = _adaptador("ms", {"identificacion.nombre": "Fondo EUR Hedged",
                           "cartera.paises_pct.United States": 60.0,
                           "cartera.paises_pct.Japan": 40.0}, orden=20)
    res = nucleo.adquiere("LU1", "fondo", _ctx(tmp_path), [ms])
    d, proc = res.datos, res.datos["meta"]["procedencia"]

    assert d["cartera"]["paises_pct"] == {"USA": 60.0, "JPN": 40.0}      # limpieza renombra
    assert proc["cartera.paises_pct.USA"] == "ms:cartera"                # ...y hereda la fuente
    assert "cartera.paises_pct.United States" not in proc
    assert proc["identificacion.clase_cubierta"] == "derivado:derivados"
    assert proc["calidad.bucket"] == "derivado:calidad"


def test_la_ficha_anterior_viaja_como_pista_pero_no_se_fusiona(tmp_path):
    visto = {}

    def fetch_b(isin, ctx):
        visto.update(ctx.previo)
        return {"identificacion": {"x": 1}}
    b = Adaptador(id="b", descripcion="", oficial=False, capacidades={"identificacion.x": "identidad"},
                  endpoints=(Endpoint("e", "identidad"),), fetch=fetch_b)
    anterior = {"identificacion": {"nombre": "Nombre guardado"}}
    res = nucleo.adquiere("LU1", "fondo", _ctx(tmp_path), [b], anterior=anterior)

    assert visto["_anterior"]["identificacion"]["nombre"] == "Nombre guardado"
    assert "nombre" not in res.datos["identificacion"]          # la pista no entra en la ficha
    assert "_anterior" not in res.datos["meta"]["adquisicion"]["fuentes"]


def test_el_previo_llega_a_los_adaptadores_siguientes(tmp_path):
    visto = {}

    def fetch_b(isin, ctx):
        visto.update(ctx.previo)
        return {"identificacion": {"x": 1}}
    a = _adaptador("a", {"identificacion.nombre": "A"}, orden=10)
    b = Adaptador(id="b", descripcion="", oficial=False, capacidades={"identificacion.x": "identidad"},
                  endpoints=(Endpoint("e", "identidad"),), fetch=fetch_b, orden=20, usa=("a",))
    nucleo.adquiere("LU1", "fondo", _ctx(tmp_path), [a, b])

    assert visto["a"]["identificacion"]["nombre"] == "A"
