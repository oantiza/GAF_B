"""P2-02 de la auditoría del 20-11-2026: la ficha que la guarda de calidad conserva recibe la caída por ventana nueva.

Como el Sortino en EXT-14 (`test_parche_con_sortino.py`): cuando la guarda salta, la ficha anterior se conserva y se le
ponen el valor liquidativo y las métricas de la serie (`update.parche_serie`). El bloque de métricas sustituía
`riesgo.max_drawdown.*` —la caída a 3 años con su periodo— y no `riesgo.max_drawdown_pct.<ventana>.fondo`, que sale de la
misma función en la misma pasada. Medido sobre la exportación del 17-11-2026: las 9 fichas parcheadas con métricas
propias tienen la caída a 3 años y ninguna caída por ventana, y su serie da 32.

Las fichas de aquí son de mentira y mínimas: lo justo para que la regla sepa que la serie propia sirvió las métricas.
"""
import copy

from core import update
from core.adquisicion import registro

EOD = "vl_eodhd:eod"
MS = "morningstar_lt:MFsnapshot"


def ficha(caida_3a, caidas, vl, *, con_cartera=True):
    """Una ficha con serie propia (VL, fecha de las métricas, caída a 3 años y por ventana) y lo de Morningstar."""
    d = {
        "identificacion": {"isin": "LU0000000001", "nombre": "Fondo de prueba", "tipo": "fondo"},
        "valoracion": {"vl": vl, "vl_fecha": "2026-11-13"},
        "rentabilidad": {"fecha_dato": "2026-10-31"},
        "riesgo": {
            "max_drawdown": {"pct": caida_3a, "periodo": "3a"},
            "max_drawdown_pct": {v: {"fondo": c, "categoria": -15.0} for v, c in caidas.items()},
        },
        "meta": {"actualizado": "2026-11-16", "procedencia": {
            "valoracion.vl": EOD, "valoracion.vl_fecha": EOD, "rentabilidad.fecha_dato": EOD,
            "riesgo.max_drawdown.pct": EOD, "riesgo.max_drawdown.periodo": EOD,
            **{f"riesgo.max_drawdown_pct.{v}.fondo": EOD for v in caidas},
            **{f"riesgo.max_drawdown_pct.{v}.categoria": MS for v in caidas},
        }},
    }
    if con_cartera:
        d["cartera"] = {"fecha_cartera": "2026-09-30", "num_posiciones": 120}
        d["meta"]["procedencia"]["cartera.fecha_cartera"] = MS
        d["meta"]["procedencia"]["cartera.num_posiciones"] = MS
    return d


def test_la_caida_por_ventana_esta_en_el_bloque_de_las_metricas():
    regla = next(r for r in registro.CONTRASTE if r["bloque"] == "metricas")
    assert "riesgo.max_drawdown_pct.*.fondo" in regla["rutas"]
    assert "riesgo.max_drawdown_pct.*.fondo" in update._rutas_serie(ficha(-10.0, {"3a": -10.0}, 100.0))


def test_la_ficha_conservada_recibe_las_caidas_nuevas_y_no_se_queda_con_las_viejas():
    previo = ficha(-12.0, {"1a": -5.0, "3a": -12.0, "5a": -20.0}, vl=101.10)
    final = ficha(-11.5, {"1a": -4.8, "3a": -11.5, "5a": -19.7}, vl=101.23, con_cartera=False)
    intacto = copy.deepcopy(previo)
    parcheada = update.parche_serie(previo, final, "QUALITY_REGRESSION_BLOCKED: esenciales cayeron 0/2")
    riesgo = parcheada["riesgo"]
    assert riesgo["max_drawdown"]["pct"] == -11.5
    assert {v: c["fondo"] for v, c in riesgo["max_drawdown_pct"].items()} == {"1a": -4.8, "3a": -11.5, "5a": -19.7}
    # La caída a 3 años de las dos rutas vuelve a ser la misma, como cuando las escribe una sola pasada.
    assert riesgo["max_drawdown_pct"]["3a"]["fondo"] == riesgo["max_drawdown"]["pct"]
    # Lo que no es de la serie sigue siendo de la ficha anterior: la de la categoría y la cartera.
    assert riesgo["max_drawdown_pct"]["1a"]["categoria"] == -15.0
    assert parcheada["cartera"] == {"fecha_cartera": "2026-09-30", "num_posiciones": 120}
    assert parcheada["meta"]["procedencia"]["riesgo.max_drawdown_pct.1a.fondo"] == EOD
    # Hojas de la serie: VL y su fecha, la fecha de las métricas, la caída a 3 años y su periodo, y las tres por ventana.
    assert parcheada["meta"]["actualizacion_parcial"]["hojas"] == 8
    assert previo == intacto


def test_una_ventana_que_la_serie_ya_no_da_sale_de_la_ficha():
    """Se sustituye el bloque entero: la caída a 10 años que la serie ya no mide no se queda al lado de las nuevas."""
    previo = ficha(-12.0, {"3a": -12.0, "10a": -35.0}, vl=100.0)
    final = ficha(-11.5, {"3a": -11.5}, vl=100.5, con_cartera=False)
    parcheada = update.parche_serie(previo, final, "QUALITY_REGRESSION_BLOCKED: esenciales cayeron 0/2")
    assert parcheada["riesgo"]["max_drawdown_pct"]["3a"]["fondo"] == -11.5
    assert "fondo" not in parcheada["riesgo"]["max_drawdown_pct"]["10a"]
    assert "riesgo.max_drawdown_pct.10a.fondo" not in parcheada["meta"]["procedencia"]
