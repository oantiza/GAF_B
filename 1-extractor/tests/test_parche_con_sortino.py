"""EXT-14 (16-11-2026): la ficha que la guarda de calidad conserva recibe el Sortino nuevo junto al Sharpe.

Cuando la guarda salta —Morningstar deja de dar la cartera, por ejemplo—, la ficha anterior se conserva y se le ponen el
valor liquidativo y las métricas de la serie (`update.parche_serie`). Las rutas que se sustituían incluían el Sharpe y
el tipo, y no el Sortino, que sale de la misma cuenta. Al recalcular la base con la versión 3 del método, 482 fichas
quedaron con el Sharpe de la 3 y el Sortino de la 2 hasta que una pasada posterior las reescribió enteras.

Las fichas de aquí son de mentira y mínimas: lo justo para que la regla sepa que la serie propia sirvió el Sharpe.
"""
import copy

from core import update
from core.adquisicion import registro

ESTR = "vl_eodhd:estr"
EOD = "vl_eodhd:eod"
MS = "morningstar_lt:MFsnapshot"


def ficha(sharpe_3a, sortino_3a, rf_3a, vl, *, con_cartera=True):
    """Una ficha con serie propia (VL, Sharpe, Sortino y tipo) y, si se pide, lo que da Morningstar."""
    d = {
        "identificacion": {"isin": "LU0000000001", "nombre": "Fondo de prueba", "tipo": "fondo"},
        "valoracion": {"vl": vl, "vl_fecha": "2026-11-13"},
        "riesgo": {
            "historial_precios": {"rf_referencia": "ESTR_EUR"},
            "sharpe": {"3a": {"fondo": sharpe_3a, "categoria": 0.44}},
            "sortino": {"3a": {"fondo": sortino_3a}},
            "rf_pct": {"3a": {"fondo": rf_3a}},
        },
        "meta": {"actualizado": "2026-11-16", "procedencia": {
            "valoracion.vl": EOD, "valoracion.vl_fecha": EOD,
            "riesgo.historial_precios.rf_referencia": ESTR,
            "riesgo.sharpe.3a.fondo": ESTR, "riesgo.sortino.3a.fondo": ESTR, "riesgo.rf_pct.3a.fondo": ESTR,
            "riesgo.sharpe.3a.categoria": MS,
        }},
    }
    if con_cartera:
        d["cartera"] = {"fecha_cartera": "2026-09-30", "num_posiciones": 120}
        d["meta"]["procedencia"]["cartera.fecha_cartera"] = MS
        d["meta"]["procedencia"]["cartera.num_posiciones"] = MS
    return d


def test_el_sortino_esta_en_el_bloque_del_sharpe():
    regla = next(r for r in registro.CONTRASTE if r["bloque"] == "sharpe")
    assert regla["rutas"] == ("riesgo.sharpe.*.fondo", "riesgo.sortino.*.fondo", "riesgo.rf_pct.*.fondo")
    # Y por eso el parche lo cuenta entre lo que la serie sirvió.
    assert "riesgo.sortino.*.fondo" in update._rutas_serie(ficha(0.5, 0.7, 2.0, 100.0))


def test_la_ficha_conservada_recibe_el_sortino_nuevo_y_no_se_queda_con_el_viejo():
    # La anterior, con las cifras de la versión 2; la nueva, sin cartera (lo que hace saltar la guarda) y con las de la 3.
    previo = ficha(sharpe_3a=-0.0935, sortino_3a=-0.1336, rf_3a=2.00, vl=101.10)
    final = ficha(sharpe_3a=-0.1017, sortino_3a=-0.1449, rf_3a=2.03, vl=101.23, con_cartera=False)
    intacto = copy.deepcopy(previo)
    parcheada = update.parche_serie(previo, final, "QUALITY_REGRESSION_BLOCKED: esenciales cayeron 0/2")
    riesgo = parcheada["riesgo"]
    assert riesgo["sharpe"]["3a"]["fondo"] == -0.1017
    assert riesgo["sortino"]["3a"]["fondo"] == -0.1449     # antes se quedaba en -0.1336
    assert riesgo["rf_pct"]["3a"]["fondo"] == 2.03
    assert parcheada["valoracion"]["vl"] == 101.23
    # Lo que la guarda protege sigue siendo lo de la ficha anterior: la cartera y lo que no es de la serie.
    assert parcheada["cartera"] == {"fecha_cartera": "2026-09-30", "num_posiciones": 120}
    assert riesgo["sharpe"]["3a"]["categoria"] == 0.44
    assert parcheada["meta"]["procedencia"]["riesgo.sortino.3a.fondo"] == ESTR
    # Seis hojas de la serie: VL y su fecha, la referencia del tipo, el Sharpe, el Sortino y el tipo.
    assert parcheada["meta"]["actualizacion_parcial"]["hojas"] == 6
    # Y no toca la ficha que recibe.
    assert previo == intacto


def test_un_sortino_que_la_serie_ya_no_da_sale_de_la_ficha_con_su_sharpe():
    """Se sustituye el bloque entero: si la ventana pierde el Sortino, el viejo no se queda al lado del Sharpe nuevo."""
    previo = ficha(sharpe_3a=1.20, sortino_3a=1.80, rf_3a=2.00, vl=100.0)
    final = ficha(sharpe_3a=1.18, sortino_3a=None, rf_3a=2.03, vl=100.5, con_cartera=False)
    del final["riesgo"]["sortino"]
    del final["meta"]["procedencia"]["riesgo.sortino.3a.fondo"]
    parcheada = update.parche_serie(previo, final, "QUALITY_REGRESSION_BLOCKED: esenciales cayeron 0/2")
    assert parcheada["riesgo"]["sharpe"]["3a"]["fondo"] == 1.18
    assert "sortino" not in parcheada["riesgo"]
    assert "riesgo.sortino.3a.fondo" not in parcheada["meta"]["procedencia"]
