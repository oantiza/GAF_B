# -*- coding: utf-8 -*-
"""Sin red, los fundamentales de una acción se arrastran con su procedencia, no se retienen.

Medido el 09-11-2026 en el re-mapeo sin red: 494 acciones salieron con sus fundamentales marcados
`retenido:eodhd@2026-11-09`, cero días de antigüedad y sin `meta.fuentes.fundamentales`, porque
yfinance no se llama sin red y la retención lo leía como que Yahoo había dejado de darlos. No
pedir un dato no es que la fuente haya dejado de darlo.
"""
import copy
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import nucleo, procedencia, retencion, retencion_acciones  # noqa: E402
from core.adquisicion.adaptador import Adaptador, Contexto  # noqa: E402
from fetchers import eodhd  # noqa: E402

ISIN = "IT0003153415"
HOY = dt.date(2026, 11, 9)
SIN_SERVIR = {"eodhd": {retencion_acciones.ENDPOINT_SIN_RED: None}}

FUND = {"market_cap": 1.79e10, "per": 10.305857, "roe_pct": 12.38, "fuente": "yahoo", "source": "yahoo",
        "fetched_at": "2026-11-09T08:05:28+00:00",
        "quality": {"coverage_ratio": 0.7143, "coverage_status": "PARTIAL",
                    "warnings": ["unofficial_source:yahoo"]}}


def _anterior() -> dict:
    """La ficha de la pasada con red: Yahoo dio el bloque, salvo el margen, que ya venía retenido
    de julio (es lo que les pasa a 81 de las 522 acciones)."""
    fund = {**copy.deepcopy(FUND), "profit_margin_pct": 28.6}
    proc = {f"fundamentales.{r}": "eodhd" for r, _v in procedencia.hojas(FUND)}
    proc["fundamentales.profit_margin_pct"] = "retenido:eodhd@2026-07-18"
    proc.update({"identificacion.sector": "eodhd", "identificacion.simbolo_yahoo": "eodhd",
                 "identificacion.nombre": "eodhd"})
    return {"identificacion": {"tipo": "accion", "nombre": "SNAM", "sector": "Utilities",
                               "simbolo_yahoo": "SRG.MI"},
            "fundamentales": fund,
            "meta": {"actualizado": "2026-11-09T08:05:30+00:00", "procedencia": proc,
                     "fuentes": {"identificacion": ["eodhd", "esma_firds"], "fundamentales": ["eodhd"]},
                     "retencion": {"fecha_referencia": "2026-11-09", "retenidos": [
                         {"ruta": "fundamentales.profit_margin_pct", "fecha": "2026-07-18", "dias": 114,
                          "fuente": ["eodhd"]}]}}}


def _final() -> dict:
    """Lo que deja la fusión de un re-mapeo sin red: identidad y precio, ni un fundamental."""
    return {"identificacion": {"tipo": "accion", "nombre": "SNAM"},
            "meta": {"procedencia": {"identificacion.nombre": "eodhd"},
                     "fuentes": {"identificacion": ["eodhd", "esma_firds"]}}}


def test_sin_red_el_bloque_anterior_pasa_tal_cual_con_su_procedencia():
    anterior, final = _anterior(), _final()
    resumen = retencion.aplica(final, anterior, HOY, sin_servir=SIN_SERVIR)

    assert final["fundamentales"] == anterior["fundamentales"]
    assert final["fundamentales"]["fetched_at"] == "2026-11-09T08:05:28+00:00"   # su antigüedad, no hoy
    assert final["identificacion"]["sector"] == "Utilities"
    assert final["identificacion"]["simbolo_yahoo"] == "SRG.MI"
    proc = final["meta"]["procedencia"]
    assert proc["fundamentales.per"] == proc["fundamentales.fetched_at"] == "eodhd"
    assert proc["identificacion.sector"] == "eodhd"
    assert final["meta"]["fuentes"]["fundamentales"] == ["eodhd"]
    assert final["meta"]["fuentes"]["identificacion"] == ["eodhd", "esma_firds"]
    # Lo único retenido es lo que ya lo estaba, con su etiqueta y su fecha de julio.
    nuevas = [r for r, e in proc.items() if e.startswith("retenido:") and r != "fundamentales.profit_margin_pct"]
    assert nuevas == []
    assert proc["fundamentales.profit_margin_pct"] == "retenido:eodhd@2026-07-18"
    assert resumen["retenidos"] == [{"ruta": "fundamentales.profit_margin_pct", "fecha": "2026-07-18",
                                     "dias": 114, "fuente": ["eodhd"]}]


def test_lo_ya_retenido_sigue_caducando_a_su_plazo_aunque_sea_sin_red():
    final = _final()
    resumen = retencion.aplica(final, _anterior(), dt.date(2026, 11, 20), sin_servir=SIN_SERVIR)
    assert "profit_margin_pct" not in final["fundamentales"]          # 125 días > 120
    assert resumen["descartados"] == [{"ruta": "fundamentales.profit_margin_pct", "fecha": "2026-07-18",
                                       "motivo": "antiguedad_125d_supera_120d"}]
    assert final["fundamentales"]["per"] == 10.305857                 # lo arrastrado no caduca aquí


def test_con_red_y_sin_fundamentales_sigue_siendo_retencion():
    """Con red, que Yahoo no traiga nada sí es que la fuente no lo dio: la regla de siempre."""
    final = _final()
    resumen = retencion.aplica(final, _anterior(), HOY)
    assert final["meta"]["procedencia"]["fundamentales.per"] == "retenido:eodhd@2026-11-09"
    assert "fundamentales" not in final["meta"]["fuentes"]
    assert len(resumen["retenidos"]) > 1


def test_eodhd_avisa_de_que_sin_red_no_pidio_los_fundamentales():
    class _SinRed:
        sin_red = True
    with procedencia.activa("eodhd") as reg:
        assert eodhd._fundamentals_yahoo({}, "SRG", "MI", _SinRed()) is False
    assert reg.no_servidos == {retencion_acciones.ENDPOINT_SIN_RED: None}


def test_una_pasada_sin_red_por_el_nucleo_no_marca_retenido(tmp_path, monkeypatch):
    # El reloj, fijo en el dia de la medicion: la ficha anterior lleva un dato del 18-07 y la retencion dura 120 dias. Con el
    # reloj real, la prueba paso hasta el 15-11-2026 y fallo desde el 16 sin que nadie tocara nada (auditoria 16-11-2026, EXT-8).
    monkeypatch.setattr(retencion, "_hoy", lambda: HOY)

    class _SinRed:
        sin_red = True

    def fetch(isin, ctx):
        out = {"identificacion": {"isin": isin, "nombre": "SNAM", "ticker": "SRG", "mercado": "MI"}}
        eodhd._fundamentals_yahoo(out, "SRG", "MI", ctx.http)
        return out
    falso = Adaptador(id="eodhd", descripcion="falso", oficial=False,
                      capacidades={"identificacion.*": "identidad", "fundamentales.*": "analitica"},
                      endpoints=(), fetch=fetch, implicito=True)
    ctx = Contexto(http=_SinRed(), settings={"prioridad_fuentes": ["eodhd"]}, base=tmp_path)
    ficha = nucleo.adquiere(ISIN, "accion", ctx, [falso], ["eodhd"], anterior=_anterior()).datos

    assert ficha["meta"]["adquisicion"]["sin_servir"] == {"eodhd": [retencion_acciones.ENDPOINT_SIN_RED]}
    assert ficha["fundamentales"]["per"] == 10.305857
    assert ficha["meta"]["procedencia"]["fundamentales.per"] == "eodhd"
    assert ficha["meta"]["fuentes"]["fundamentales"] == ["eodhd"]
    assert [x["ruta"] for x in ficha["meta"]["retencion"]["retenidos"]] == ["fundamentales.profit_margin_pct"]
