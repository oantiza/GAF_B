# -*- coding: utf-8 -*-
"""El €STR de las acciones y el del export son la misma serie, y la ficha dice hasta dónde llega.

Medido el 09-11-2026: la pasada con red de las 08:05 UTC leyó el €STR con 7 días de TTL y le llegó
una copia que acababa el 05-11; el export de las 08:08 lo leyó con 1 y lo refrescó al 06-11. Las 504
acciones con precio del 06-11 publicaron un `rf_pct` a un año de 2,0696 en vez de 2,0711, y nada en
la ficha permitía saber con qué copia se había calculado.
"""
import csv
import io
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import export_series, metricas  # noqa: E402
from fetchers import eodhd, estr_bce, vl_fondos  # noqa: E402

FIN = date(2026, 11, 6)          # viernes, el último precio de la pasada del 09-11


class _Resp:
    ok = True
    status = 200

    def __init__(self, text):
        self.text = text


class _Http:
    """Contesta el €STR hasta `hasta` y apunta cómo se le pidió."""

    def __init__(self, hasta: date, valor_ultimo: float | None = None):
        self.hasta, self.valor_ultimo = hasta, valor_ultimo
        self.pedidas = []

    def get(self, url, params=None, ttl_dias=None, force=False, familia=None, **_k):
        self.pedidas.append((url, dict(params or {}), ttl_dias, familia))
        assert "/EST/" in url, url
        filas, d = ["TIME_PERIOD,OBS_VALUE"], date(2019, 10, 1)
        while d <= self.hasta:
            if d.weekday() < 5:
                v = self.valor_ultimo if (d == self.hasta and self.valor_ultimo is not None) else 2.0
                filas.append(f"{d.isoformat()},{v}")
            d += timedelta(days=1)
        return _Resp("\n".join(filas))


def _serie_acciones(hasta: date = FIN) -> list[dict]:
    out, d = [], hasta - timedelta(days=6 * 365)
    i = 0
    while d <= hasta:
        if d.weekday() < 5:
            out.append({"date": d, "price": 100 * (1 + 0.0003 * i), "raw": {}})
            i += 1
        d += timedelta(days=1)
    return out


def _metricas(monkeypatch, http) -> dict:
    monkeypatch.setattr(eodhd, "_ESTR_CACHE", None)
    out: dict = {}
    eodhd._aplica_metricas_historicas(out, _serie_acciones(), http, "eodhd", "EODHD:SRG.MI", divisa="EUR")
    return out


# --------------------------------------------------------------- una sola petición
def test_las_tres_lecturas_del_estr_piden_la_misma_clave_con_el_mismo_ttl(tmp_path, monkeypatch):
    acciones, export, fondos = _Http(FIN), _Http(FIN), _Http(FIN)
    monkeypatch.setattr(eodhd, "_ESTR_CACHE", None)
    eodhd._serie_estr(acciones)
    export_series.genera_estr(tmp_path, export)
    vl_fondos.estr(fondos)
    assert acciones.pedidas == export.pedidas == fondos.pedidas == [
        (estr_bce.URL, {"startPeriod": "2019-10-01", "format": "csvdata"}, 1, None)]
    assert estr_bce.TTL_DIAS == 1


# --------------------------------------------------------------- días hábiles
def test_los_dias_habiles_no_cuentan_el_fin_de_semana():
    assert metricas.dias_habiles_entre(date(2026, 10, 30), date(2026, 11, 2)) == 1   # vie -> lun
    assert metricas.dias_habiles_entre(date(2026, 11, 5), FIN) == 1
    assert metricas.dias_habiles_entre(FIN, FIN) == 0
    assert metricas.dias_habiles_entre(FIN, date(2026, 11, 1)) == 0


def test_la_tolerancia_es_de_tres_dias_habiles():
    assert metricas.RF_TOLERANCIA_DIAS_HABILES == 3
    estr = lambda hasta: [(hasta - timedelta(days=n), 2.0) for n in range(30)]  # noqa: E731
    # Martes 03-11: faltan miércoles, jueves y viernes, tres. Aún no se marca.
    assert metricas.cobertura_rf(estr(date(2026, 11, 3)), FIN) == {
        "rf_hasta": "2026-11-03", "fin_ventana": "2026-11-06",
        "dias_habiles_sin_estr": 3, "incompleto": False}
    # Lunes 02-11: faltan cuatro. Se marca.
    assert metricas.cobertura_rf(estr(date(2026, 11, 2)), FIN)["incompleto"] is True
    # Un €STR posterior al fin de la ventana no cuenta: no entra en su media.
    assert metricas.cobertura_rf(estr(date(2026, 11, 9)), FIN)["rf_hasta"] == "2026-11-06"
    assert metricas.cobertura_rf([], FIN) is None


# --------------------------------------------------------------- en la ficha
def test_con_la_serie_completa_rf_hasta_es_el_fin_de_la_ventana(monkeypatch):
    hp = _metricas(monkeypatch, _Http(FIN))["riesgo"]["historial_precios"]
    assert hp["rf_hasta"] == "2026-11-06" == hp["last_date"]
    assert "rf_incompleto" not in hp


def test_un_dia_de_retraso_se_apunta_y_no_se_marca(monkeypatch):
    """El caso del 09-11, con cifras conocidas: €STR a 2,0 todos los días y 4,0 el último. Con la
    serie entera el último día entra en la media de la ventana a un año; cortada un día antes, no."""
    completa = _metricas(monkeypatch, _Http(FIN, valor_ultimo=4.0))["riesgo"]
    cortada = _metricas(monkeypatch, _Http(date(2026, 11, 5)))["riesgo"]

    inicio = metricas.resta_anos(FIN, 1)                     # 06-11-2025, jueves: primer precio
    n = sum(1 for k in range((FIN - inicio).days + 1) if (inicio + timedelta(days=k)).weekday() < 5)
    assert completa["rf_pct"]["1a"]["fondo"] == round((2.0 * (n - 1) + 4.0) / n, 4)
    assert cortada["rf_pct"]["1a"]["fondo"] == 2.0
    assert cortada["historial_precios"]["rf_hasta"] == "2026-11-05"
    assert "rf_incompleto" not in cortada["historial_precios"]


def test_un_estr_parado_deja_marca_y_no_suprime_el_sharpe(monkeypatch):
    riesgo = _metricas(monkeypatch, _Http(date(2026, 10, 29)))["riesgo"]
    hp = riesgo["historial_precios"]
    assert hp["rf_hasta"] == "2026-10-29"
    # Viernes 30-10 y la semana del 2 al 6 de noviembre: seis días hábiles sin €STR.
    assert hp["rf_incompleto"] == {"rf_hasta": "2026-10-29", "fin_ventana": "2026-11-06",
                                   "dias_habiles_sin_estr": 6, "tolerancia_dias_habiles": 3}
    # §3 del método: el Sharpe solo falta si falta el tipo. Aquí el tipo está, aunque corto.
    assert riesgo["sharpe"]["1a"]["fondo"] is not None


def test_el_csv_del_estr_es_el_que_espera_el_lector():
    # Guarda de la prueba: el falso escribe la forma de columnas que leen los tres.
    filas = list(csv.DictReader(io.StringIO(_Http(FIN).get(estr_bce.URL).text)))
    assert filas[-1] == {"TIME_PERIOD": "2026-11-06", "OBS_VALUE": "2.0"}
