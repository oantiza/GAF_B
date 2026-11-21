# -*- coding: utf-8 -*-
"""A1 (auditoria 29-09): la maestra mide la volatilidad y el Sharpe en SEMANAL.

Las metricas por activo (metrics/latest) salian de rendimientos diarios
(x sqrt(252)) mientras el optimizador, la cartera real y el horizonte miden en
semanal (ultima observacion de cada semana ISO, x sqrt(52)). Un mismo fondo de
RV daba 12,74 % en diario y 14,36 % en semanal. Ahora las dos rutas de ingesta
pasan por weekly_sampling, el mismo modulo que usa el optimizador, y el
reproceso (scripts/migrate_metrics_latest.py, criterio 4) reescribe lo que
quedo en DAILY.
"""
import datetime
import math
import os
import random
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import fund_ingest  # noqa: E402
import ingest_asset  # noqa: E402
import weekly_sampling  # noqa: E402
from optimization import repository  # noqa: E402
import migrate_metrics_latest as migrate  # noqa: E402


def _serie_diaria(dias: int, vol_diaria: float, semilla: int = 7, inicio=datetime.date(2021, 1, 4)):
    """Serie de sesiones (lunes a viernes) con rendimientos gaussianos de
    volatilidad diaria conocida. Devuelve [(fecha, valor)]."""
    rng = random.Random(semilla)
    puntos = []
    valor = 100.0
    dia = inicio
    while len(puntos) < dias:
        if dia.weekday() < 5:
            valor *= math.exp(rng.gauss(0.0002, vol_diaria))
            puntos.append((dia, valor))
        dia += datetime.timedelta(days=1)
    return puntos


def _vol_diaria_anualizada(puntos):
    rets = [b / a - 1.0 for (_d0, a), (_d1, b) in zip(puntos, puntos[1:])]
    media = sum(rets) / len(rets)
    var = sum((r - media) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


# ---------------------------------------------------------------------------
# Volatilidad semanal
# ---------------------------------------------------------------------------


def test_la_volatilidad_semanal_difiere_de_la_diaria_y_se_etiqueta_weekly():
    puntos = _serie_diaria(3 * 252, vol_diaria=0.01)
    ventana = ingest_asset._window_metrics([{"date": d, "value": v} for d, v in puntos], 0.0,
                                           nominal_days=365 * 3)

    assert ventana["frequency"] == "WEEKLY"
    assert ventana["method"] == "GEOMETRIC_CAGR"
    diaria = _vol_diaria_anualizada(puntos)
    # Con rendimientos independientes las dos estiman la misma sigma anual
    # (~15,9 %), pero son estimadores distintos: nunca coinciden al decimal.
    assert ventana["annualized_volatility"] == pytest.approx(0.01 * math.sqrt(252), rel=0.15)
    assert ventana["annualized_volatility"] != pytest.approx(diaria, rel=1e-4)


def test_la_maestra_publica_la_misma_volatilidad_que_la_serie_semanal():
    puntos = _serie_diaria(3 * 252, vol_diaria=0.012, semilla=3)
    ventana = ingest_asset._window_metrics([{"date": d, "value": v} for d, v in puntos], 0.0)

    # Retornos semanales de la ultima observacion de cada semana ISO, y varianza
    # muestral x52: la cuenta con la que se mide una cartera.
    semanal = repository._weekly_last_observations(puntos)
    retornos, _fechas, _puenteadas = repository._weekly_returns(semanal)
    valores = list(retornos.values())
    media = sum(valores) / len(valores)
    varianza = sum((r - media) ** 2 for r in valores) / (len(valores) - 1) * repository.ANNUALIZATION_FACTOR

    # metrics/latest redondea a 8 decimales.
    assert ventana["annualized_volatility"] == pytest.approx(math.sqrt(varianza), abs=1e-8)
    assert repository.ANNUALIZATION_FACTOR == weekly_sampling.WEEKS_PER_YEAR == 52


def test_las_dos_rutas_de_ingesta_publican_la_misma_cifra():
    puntos = _serie_diaria(2 * 252, vol_diaria=0.009, semilla=11)
    accion = ingest_asset._window_metrics([{"date": d, "value": v} for d, v in puntos], 0.01,
                                          nominal_days=365)
    fondo = fund_ingest._window_metrics([{"date": d.isoformat(), "value": v} for d, v in puntos], 0.01,
                                        nominal_days=365)

    assert accion["frequency"] == fondo["frequency"] == "WEEKLY"
    assert accion["annualized_volatility"] == pytest.approx(fondo["annualized_volatility"], rel=1e-9)
    assert accion["annualized_return"] == pytest.approx(fondo["annualized_return"], rel=1e-9)
    assert accion["sharpe_ratio"] == pytest.approx(fondo["sharpe_ratio"], rel=1e-9)


def test_el_ultimo_valor_de_cada_semana_iso_es_el_que_cuenta():
    # Dos observaciones por semana; solo el viernes (ultima) entra en la
    # medida: la del lunes no puede mover la volatilidad.
    lunes = datetime.date(2024, 1, 1)
    puntos, otros = [], []
    for semana in range(30):
        dia = lunes + datetime.timedelta(weeks=semana)
        viernes = dia + datetime.timedelta(days=4)
        valor = 100 + semana + (1.5 if semana % 2 else -1.5)
        puntos.append((viernes, valor))
        otros.append((dia, valor * (1.3 if semana % 3 else 0.8)))  # ruido enorme entre semana
    solo_viernes = weekly_sampling.window_volatility(sorted(puntos))
    con_lunes = weekly_sampling.window_volatility(sorted(puntos + otros))

    assert solo_viernes["annualized_volatility"] == pytest.approx(con_lunes["annualized_volatility"])
    assert solo_viernes["returns_count"] == con_lunes["returns_count"] == 29


def test_un_vl_mensual_sigue_en_monthly_con_factor_12():
    puntos = [(datetime.date(2020 + i // 12, i % 12 + 1, 1), 100 * (1.004 ** i) * (1 + (0.02 if i % 2 else -0.02)))
              for i in range(40)]
    vol = weekly_sampling.window_volatility(puntos)
    rets = [b / a - 1 for (_d0, a), (_d1, b) in zip(puntos, puntos[1:])]
    media = sum(rets) / len(rets)
    esperada = math.sqrt(sum((r - media) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(12)

    assert vol["frequency"] == "MONTHLY"
    assert vol["annualized_volatility"] == pytest.approx(esperada, abs=1e-8)
    mensual = fund_ingest._window_metrics([{"date": d.isoformat(), "value": v} for d, v in puntos])
    assert mensual["frequency"] == "MONTHLY"


def test_un_vl_semanal_se_mide_igual_que_uno_diario_de_la_misma_semana():
    # Un VL que solo publica los viernes y la misma serie con sesiones diarias
    # que terminan en esos viernes miden lo mismo: la regla es la semana ISO.
    diaria = _serie_diaria(100 * 5, vol_diaria=0.01, semilla=5)  # semanas completas
    viernes = [(d, v) for d, v in diaria if d.weekday() == 4]
    assert weekly_sampling.window_volatility(diaria)["annualized_volatility"] == pytest.approx(
        weekly_sampling.window_volatility(viernes)["annualized_volatility"], rel=1e-9)


# ---------------------------------------------------------------------------
# Umbrales en semanas
# ---------------------------------------------------------------------------


def test_los_minimos_por_ventana_van_en_semanas():
    # 44 = 0,85 x 52: la misma cobertura que window_span_ok en dias, algo mas
    # laxa que el optimizador (48/anio, 40/144/240/480) porque aqui cada activo
    # se mide solo.
    assert weekly_sampling.MIN_WEEKS_PER_WINDOW_YEAR == round(fund_ingest.MIN_WINDOW_COVERAGE * 52)
    assert weekly_sampling.min_weekly_returns(365) == 44
    assert weekly_sampling.min_weekly_returns(365 * 3) == 132
    assert weekly_sampling.min_weekly_returns(365 * 5) == 220
    assert weekly_sampling.min_weekly_returns(365 * 10) == 440
    for ventana, minimo in repository.MIN_COMMON_OBSERVATIONS.items():
        anios = repository.SUPPORTED_WINDOWS[ventana]
        assert weekly_sampling.min_weekly_returns(365 * anios) <= max(minimo, 44)


def test_menos_de_veinte_semanas_no_publica_ventana():
    assert weekly_sampling.window_volatility(_serie_diaria(19 * 5, 0.01)) is None
    assert weekly_sampling.window_volatility(_serie_diaria(22 * 5, 0.01)) is not None
    assert weekly_sampling.MIN_WEEKLY_RETURNS == 20


def test_una_serie_con_meses_sin_dato_no_anualiza_aunque_el_recorrido_cubra_la_ventana():
    # Tres anios de recorrido pero solo el primer y el ultimo semestre con VL:
    # window_span_ok pasa (en dias) y window_complete no (en semanas).
    completa = _serie_diaria(3 * 252, 0.01, semilla=2)
    con_hueco = [p for p in completa if p[0] < datetime.date(2021, 7, 1) or p[0] > datetime.date(2023, 7, 1)]
    ventana = ingest_asset._window_metrics([{"date": d, "value": v} for d, v in con_hueco], 0.0,
                                           nominal_days=365 * 3)
    assert ventana["annualized_volatility"] > 0
    assert "annualized_return" not in ventana
    assert "sharpe_ratio" not in ventana


def test_el_documento_completo_declara_weekly_y_cumple_contrato():
    puntos = [{"date": d.isoformat(), "value": v} for d, v in _serie_diaria(11 * 252, 0.01, inicio=datetime.date(2015, 1, 5))]
    doc = ingest_asset.build_metrics_latest("US0378331005", "STOCK", puntos, "2026-09-30T00:00:00Z", srri=None)
    assert set(doc["windows"]) == {"1y", "3y", "5y", "10y"}
    assert {node["frequency"] for node in doc["windows"].values()} == {"WEEKLY"}
    assert {node["method"] for node in doc["windows"].values()} == {"GEOMETRIC_CAGR"}
    ingest_asset.validate_contract(doc, "metrics.v1.2.schema.json")

    from readmodel.mappers import map_quant_metrics
    mapped = map_quant_metrics({"asset_id": "US0378331005", "asset_type": "STOCK"}, doc)
    assert mapped["metrics_frequency"] == "WEEKLY"
    assert mapped["metrics_method"] == "GEOMETRIC_CAGR"


# ---------------------------------------------------------------------------
# Reproceso en seco (criterio 4) sobre una maestra simulada
# ---------------------------------------------------------------------------


class _Snap:
    def __init__(self, ref, data):
        self.reference = ref
        self.id = ref.id
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class _Doc:
    def __init__(self, store, path):
        self.store = store
        self.path = path
        self.id = path.split("/")[-1]

    def get(self):
        return _Snap(self, self.store.docs.get(self.path))

    def set(self, payload):
        self.store.docs[self.path] = dict(payload)
        self.store.written.append(self.path)

    def collection(self, name):
        return _Coll(self.store, self.path + "/" + name)


class _Coll:
    def __init__(self, store, path):
        self.store = store
        self.path = path
        self._limit = None
        self._after = None

    def document(self, doc_id):
        return _Doc(self.store, self.path + "/" + doc_id)

    def order_by(self, _field):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def start_after(self, cursor):
        self._after = list(cursor.values())[0]
        return self

    def stream(self):
        prefix = self.path + "/"
        ids = sorted(p[len(prefix):] for p in self.store.docs if p.startswith(prefix) and "/" not in p[len(prefix):])
        if self._after is not None:
            ids = [i for i in ids if i > self._after]
        if self._limit:
            ids = ids[:self._limit]
        return [_Snap(_Doc(self.store, prefix + i), self.store.docs[prefix + i]) for i in ids]


class _Db:
    def __init__(self):
        self.docs = {}
        self.written = []

    def collection(self, name):
        return _Coll(self, name)


def _ventana_diaria(**extra):
    base = {"annualized_return": 0.08, "annualized_volatility": 0.13, "sharpe_ratio": 0.4,
            "risk_free_rate": 0.02, "method": "GEOMETRIC_CAGR", "frequency": "DAILY"}
    base.update(extra)
    return base


def _maestra(monkeypatch):
    db = _Db()
    serie = [{"date": d.isoformat(), "value": round(v, 6)} for d, v in _serie_diaria(4 * 252, 0.01, semilla=9)]
    for isin, metrics in (
        ("LU0000000001", {"asset_id": "LU0000000001", "population": "fund", "source": "FONDOSDB_FUND_NAV_EUR",
                          "updated_at": "t", "risk_score_source": "SRRI", "srri": 5,
                          "windows": {"1y": _ventana_diaria(), "3y": _ventana_diaria()}}),
        ("LU0000000002", {"asset_id": "LU0000000002", "population": "fund", "source": "FONDOSDB_FUND_NAV_EUR",
                          "updated_at": "t", "risk_score_source": "VOL_BUCKET", "srri": 4,
                          "windows": {"1y": _ventana_diaria(frequency="WEEKLY"), "3y": _ventana_diaria(frequency="WEEKLY")}}),
        ("US0000000003", {"asset_id": "US0000000003", "population": "stock", "source": "FONDOSDB_EODHD_DAILY_HISTORY",
                          "updated_at": "t", "risk_score_source": "VOL_BUCKET", "srri": 4,
                          "windows": {"1y": _ventana_diaria()}}),
    ):
        db.docs["assets/" + isin] = {"asset_id": isin, "asset_type": "FUND" if isin.startswith("LU") else "STOCK",
                                     "quality": {"status": "ACTIVE"}}
        db.docs[f"assets/{isin}/metrics/latest"] = metrics
        db.docs[f"assets/{isin}/price_series/S_2021"] = {"points": serie}
    # Archivada: no se toca aunque este en diario.
    db.docs["assets/FR0000000004"] = {"asset_id": "FR0000000004", "asset_type": "FUND",
                                      "quality": {"status": "ARCHIVED_LEGACY"}}
    db.docs["assets/FR0000000004/metrics/latest"] = {"source": "FONDOSDB_FUND_NAV_EUR",
                                                     "windows": {"1y": _ventana_diaria()}}
    monkeypatch.setattr(migrate, "_estr_window_resolver", lambda _a, _b: {"rate": 0.02})
    return db


def test_el_dry_run_recalcula_lo_que_esta_en_diario_y_no_escribe(monkeypatch):
    db = _maestra(monkeypatch)
    resumen = migrate.run(db, write=False, now_iso=lambda: "2026-09-30T00:00:00Z")

    assert resumen["mode"] == "DRY_RUN"
    assert db.written == []
    assert resumen["active_roots"] == 3
    assert resumen["valid"] == 1  # el que ya esta en semanal
    assert resumen["to_recompute"] == 2
    assert resumen["reasons"] == {"FREQUENCY": 2}
    assert sorted(resumen["candidate_ids"]) == ["LU0000000001", "US0000000003"]
    assert resumen["recomputed"] == 2 and resumen["errors"] == 0 and resumen["skipped"] == 0
    # Diferencias de volatilidad por ventana: media y maximo, no una lista.
    assert set(resumen["vol_diff_pp"]) == {"1y", "3y"}
    assert resumen["vol_diff_pp"]["1y"]["count"] == 2
    assert "mean_pp" in resumen["vol_diff_pp"]["3y"]


def test_la_escritura_exige_el_gate_de_write_governance(monkeypatch):
    db = _maestra(monkeypatch)
    monkeypatch.delenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES", raising=False)
    from write_governance import MasterWritesDisabledError
    with pytest.raises(MasterWritesDisabledError):
        migrate.run(db, write=True, now_iso=lambda: "2026-09-30T00:00:00Z")
    assert db.written == []


def test_la_escritura_arrastra_el_srri_y_deja_las_ventanas_en_semanal(monkeypatch):
    db = _maestra(monkeypatch)
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES", "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    resumen = migrate.run(db, write=True, now_iso=lambda: "2026-09-30T00:00:00Z")

    assert resumen["written"] == 2
    fondo = db.docs["assets/LU0000000001/metrics/latest"]
    assert fondo["srri"] == 5 and fondo["risk_score_source"] == "SRRI"
    assert {n["frequency"] for n in fondo["windows"].values()} == {"WEEKLY"}
    accion = db.docs["assets/US0000000003/metrics/latest"]
    assert accion["risk_score_source"] == "VOL_BUCKET"
    # Autolimitante: una segunda pasada no toca nada.
    segunda = migrate.run(db, write=False, now_iso=lambda: "2026-09-30T00:00:00Z")
    assert segunda["to_recompute"] == 0 and segunda["valid"] == 3


def test_limit_y_asset_acotan_la_pasada(monkeypatch):
    db = _maestra(monkeypatch)
    acotada = migrate.run(db, write=False, limit=1, now_iso=lambda: "2026-09-30T00:00:00Z")
    assert acotada["active_roots"] == 1 and acotada["stopped_by_limit"] is True

    una = migrate.run(db, write=False, assets=["US0000000003", "XX0000000000"],
                      now_iso=lambda: "2026-09-30T00:00:00Z")
    assert una["active_roots"] == 1
    assert una["candidate_ids"] == ["US0000000003"]
    assert una["requested_assets"] == ["US0000000003", "XX0000000000"]


def test_un_documento_que_quedaria_incompleto_no_se_escribe(monkeypatch):
    db = _maestra(monkeypatch)
    # Serie demasiado corta para publicar ninguna ventana: el documento actual
    # tiene ventanas y el nuevo no tendria; se salta y se informa.
    corta = [{"date": d.isoformat(), "value": v} for d, v in _serie_diaria(30, 0.01)]
    db.docs["assets/LU0000000001/price_series/S_2021"] = {"points": corta}
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES", "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    resumen = migrate.run(db, write=True, assets=["LU0000000001"], now_iso=lambda: "2026-09-30T00:00:00Z")
    assert resumen["written"] == 0
    assert resumen["skipped_incomplete"] == [{"asset_id": "LU0000000001", "reason": "NO_WINDOWS"}]
    assert db.docs["assets/LU0000000001/metrics/latest"]["windows"]["1y"]["frequency"] == "DAILY"


def test_un_error_en_un_activo_no_para_la_pasada(monkeypatch):
    db = _maestra(monkeypatch)
    db.docs["assets/LU0000000001/price_series/S_2021"] = {"points": [{"date": "2021-01-04", "value": "x"}]}
    monkeypatch.setattr(migrate, "build_metrics_latest", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    resumen = migrate.run(db, write=False, now_iso=lambda: "2026-09-30T00:00:00Z")
    assert resumen["errors"] == 2
    assert {e["asset_id"] for e in resumen["error_detail"]} == {"LU0000000001", "US0000000003"}
