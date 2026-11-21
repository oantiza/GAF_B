import datetime as _dt
import os
import sys

from google.cloud import firestore as _gcf

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import metrics_refresh  # noqa: E402


class Snap:
    def __init__(self, id_, data=None, ref=None):
        self.id = id_
        self._data = data
        self.exists = data is not None
        self.reference = ref
        self.update_time = 1

    def to_dict(self):
        return self._data


class Parent:
    def __init__(self, parent=None, id_=None):
        self.parent = parent
        self.id = id_


class PriceDocRef:
    def __init__(self, asset_id):
        self.parent = Parent(parent=Parent(id_=asset_id))


class AssetRef:
    def __init__(self, db, asset_id):
        self.db = db
        self.asset_id = asset_id

    def collection(self, name):
        if name == "price_series":
            return PriceSeriesCollection(self.db, self.asset_id)
        if name == "metrics":
            return MetricsCollection(self.db, self.asset_id)
        raise AssertionError(name)

    def update(self, payload):
        self.db.updates[self.asset_id] = payload

    def get(self):
        return Snap(self.asset_id, {"asset_id": self.asset_id}, self)


class MetaDoc:
    def __init__(self, db):
        self.db = db

    def get(self):
        return Snap("metrics_refresh", self.db.meta, self)

    def set(self, payload, merge=False):
        self.db.meta_written = payload
        if merge:
            self.db.meta.update(payload)
        else:
            self.db.meta = dict(payload)


class MetricsDoc:
    def __init__(self, db, asset_id, doc_id="latest"):
        self.db = db
        self.asset_id = asset_id
        self.doc_id = doc_id

    def _store(self):
        return self.db.metrics if self.doc_id == "latest" else self.db.states

    def get(self):
        return Snap(self.doc_id, self._store().get(self.asset_id), self)

    def set(self, payload, merge=False):
        store = self._store()
        if merge:
            current = dict(store.get(self.asset_id) or {})
            current.update(payload)
            store[self.asset_id] = current
        else:
            store[self.asset_id] = payload
        if self.doc_id == "latest":
            self.db.metrics_updates[self.asset_id] = payload
        else:
            self.db.state_updates[self.asset_id] = payload


class MetricsCollection:
    def __init__(self, db, asset_id):
        self.db = db
        self.asset_id = asset_id

    def document(self, doc_id):
        assert doc_id in ("latest", "drawdown_state")
        return MetricsDoc(self.db, self.asset_id, doc_id)


class Collection:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self.after = None
        self.max_docs = None

    def document(self, doc_id):
        if self.name == "meta":
            return MetaDoc(self.db)
        if self.name == "assets":
            return AssetRef(self.db, doc_id)
        raise AssertionError(self.name)

    def stream(self):
        if self.name == "assets":
            asset_ids = sorted(self.db.assets.keys())
            if self.after:
                asset_ids = [asset_id for asset_id in asset_ids if asset_id > self.after]
            if self.max_docs is not None:
                asset_ids = asset_ids[:self.max_docs]
            self.db.asset_pages += 1
            return [Snap(asset_id, self.db.assets[asset_id], AssetRef(self.db, asset_id)) for asset_id in asset_ids]
        return []

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        self.max_docs = count
        return self

    def select(self, *_args, **_kwargs):
        return self

    def start_after(self, cursor):
        self.after = next(iter(cursor.values()))
        return self


class PriceSeriesCollection:
    def __init__(self, db, asset_id):
        self.db = db
        self.asset_id = asset_id
        self.max_docs = None
        self.year_after = None

    def where(self, filter):
        assert filter.field_path == "year" and filter.op_string == ">"
        self.year_after = filter.value
        return self

    def stream(self):
        docs = sorted(self.db.series[self.asset_id], key=lambda doc: doc.get("last_date", ""), reverse=True)
        if self.year_after is not None:
            docs = [doc for doc in docs if isinstance(doc.get("year"), int) and doc["year"] > self.year_after]
        if self.max_docs is not None:
            docs = docs[:self.max_docs]
        return [Snap(f"doc_{i}", doc, PriceDocRef(self.asset_id)) for i, doc in enumerate(docs)]

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, count, *_args, **_kwargs):
        self.max_docs = count
        return self


class CollectionGroup:
    def __init__(self, db):
        self.db = db
        self.after = None

    def where(self, filter):
        self.after = filter.value
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def stream(self):
        rows = []
        for asset_id, docs in self.db.series.items():
            for i, doc in enumerate(docs):
                if self.after and not (doc["last_date"] > self.after):
                    continue
                rows.append(Snap(f"doc_{i}", doc, PriceDocRef(asset_id)))
        return sorted(rows, key=lambda s: s.to_dict()["last_date"], reverse=True)


class MetricsBatch:
    def __init__(self):
        self.ops = []

    def update(self, ref, value, option=None):
        assert option._last_update_time == 1
        self.ops.append((ref, value, True))

    def set(self, ref, value):
        self.ops.append((ref, value, False))

    def commit(self):
        for ref, value, merge in self.ops:
            ref.set(value, merge=merge)


class FakeDb:
    def __init__(self):
        self.meta = {"last_price_series_last_date": "2024-01-05"}
        self.valid_id = "US0378331005"
        self.series = {
            "old": [{"last_date": "2024-01-05", "points": [{"date": "2024-01-05", "value": 100}]}],
            self.valid_id: [{
                "asset_id": self.valid_id,
                "last_date": "2024-03-01",
                "points": [{"date": f"2024-02-{day:02d}", "value": 100 + day} for day in range(1, 25)],
            }],
            "EODHD_MSFT.US": [{
                "asset_id": "EODHD_MSFT.US",
                "last_date": "2024-04-01",
                "points": [{"date": f"2024-03-{day:02d}", "value": 100 + day} for day in range(1, 25)],
            }],
            "US5949181045": [{
                "asset_id": "US5949181045",
                "last_date": "2024-04-01",
                "points": [{"date": f"2024-03-{day:02d}", "value": 100 + day} for day in range(1, 25)],
            }],
        }
        self.assets = {
            "old": {"asset_id": "old"},
            self.valid_id: {"asset_id": self.valid_id},
            "EODHD_MSFT.US": {"asset_id": "EODHD_MSFT.US"},
            "US5949181045": {"asset_id": "US5949181045", "quality": {"status": "ARCHIVED_LEGACY"}},
        }
        self.metrics = {
            self.valid_id: {
                "asset_id": self.valid_id,
                "population": "stock",
                "source": "unit-test",
                "updated_at": "2024-01-01T00:00:00Z",
                "windows": {},
                "risk_score_source": "VOL_BUCKET",
                "last_date": "2024-02-01",
            }
        }
        self.updates = {}
        self.metrics_updates = {}
        self.states = {}
        self.state_updates = {}
        self.meta_written = None
        self.asset_pages = 0

    def collection(self, name):
        return Collection(self, name)

    def batch(self):
        return MetricsBatch()

    def collection_group(self, name):
        assert name == "price_series"
        return CollectionGroup(self)


def test_refresh_max_drawdown_uses_watermark_and_updates_metrics_latest(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=100)

    assert result["candidate_assets"] == 1
    assert result["last_watermark"] == "2024-01-05"
    assert result["new_watermark"] == "2024-03-01"
    assert fake.updates == {}
    assert set(fake.metrics_updates.keys()) == {fake.valid_id}
    assert "max_drawdown_hist" in fake.metrics_updates[fake.valid_id]
    assert "updated_at" in fake.metrics_updates[fake.valid_id]
    assert fake.meta_written["last_price_series_last_date"] == "2024-03-01"


def test_full_load_rebuilds_drawdown_state(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "_consolidation_safe_year", lambda today=None: 2025)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=100)

    assert result["full_loads"] == 1
    assert result["incremental_updates"] == 0
    assert result["states_rebuilt"] == 1
    state = fake.state_updates[fake.valid_id]
    assert state["schema_version"] == "metrics-drawdown-state.v1"
    assert state["base_year"] == 2025
    assert state["base_last_date"] == "2024-02-24"
    assert state["peak_value"] == 124.0


def test_incremental_path_continues_from_state_and_consolidates(monkeypatch):
    fake = FakeDb()
    aid = fake.valid_id
    fake.series = {
        aid: [
            {"asset_id": aid, "year": 2023, "last_date": "2023-12-29",
             "points": [{"date": "2023-12-29", "value": 180}]},
            {"asset_id": aid, "year": 2024, "last_date": "2024-01-06",
             "points": [{"date": "2024-01-05", "value": 100}, {"date": "2024-01-06", "value": 150}]},
        ]
    }
    fake.assets = {aid: {"asset_id": aid}}
    fake.metrics = {aid: {"asset_id": aid, "population": "stock", "source": "unit-test",
                          "updated_at": "2024-01-01T00:00:00Z", "risk_score_source": "VOL_BUCKET",
                          "last_date": "2023-12-29", "windows": {},
                          "max_drawdown_hist": {"value": -0.1, "date": "2023-06-01"}}}
    # Estado consolidado a cierre de 2023: pico 200, peor caída -10%.
    fake.states = {aid: {
        "schema_version": "metrics-drawdown-state.v1", "base_year": 2023,
        "peak_value": 200.0, "mdd_value": -0.1, "mdd_date": "2023-06-01",
        "base_last_date": "2023-12-29", "updated_at": "2024-01-01T00:00:00Z",
    }}
    fake.meta = {"last_price_series_last_date": "2023-12-29"}

    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "_consolidation_safe_year", lambda today=None: 2025)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=100)

    assert result["incremental_updates"] == 1
    assert result["full_loads"] == 0
    # Continuación online: 100/200-1 = -0.5 gana a la caída del estado (-0.1).
    written = fake.metrics_updates[aid]
    assert written["max_drawdown_hist"] == {"value": -0.5, "date": "2024-01-05"}
    assert written["last_date"] == "2024-01-06"
    # Consolidación: base_year sube a 2025 con los puntos de años cerrados.
    assert result["states_consolidated"] == 1
    state = fake.state_updates[aid]
    assert state["base_year"] == 2025
    assert state["base_last_date"] == "2024-01-06"
    assert state["peak_value"] == 200.0
    assert state["mdd_value"] == -0.5
    # Coste: watermark 1 + asset 1 + latest 1 + metrics 1 + estado 1 + 1 doc anual = 6.
    assert result["read_budget_used"] == 6


def test_continuation_matches_full_recompute():
    import datetime as dt
    dates = [dt.date(2023, 1, d) for d in (2, 3, 4, 5)] + [dt.date(2024, 1, d) for d in (2, 3, 4)]
    values = [100.0, 120.0, 90.0, 110.0, 130.0, 80.0, 140.0]
    full_worst, full_date = metrics_refresh._max_drawdown(values, dates)

    state_payload = metrics_refresh._state_from_full(values, dates, 2023)
    assert state_payload["base_year"] == 2023
    tail = [(v, d) for v, d in zip(values, dates) if d.year > 2023]
    worst, worst_date, _peak = metrics_refresh._run_drawdown(
        state_payload["peak_value"], state_payload["mdd_value"],
        dt.date.fromisoformat(state_payload["mdd_date"]),
        [v for v, _ in tail], [d for _, d in tail],
    )
    assert (worst, worst_date) == (full_worst, full_date)


def test_recompute_one_rebuilds_state(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "_consolidation_safe_year", lambda today=None: 2025)

    result = metrics_refresh.recompute_one(fake.valid_id, write=True)

    assert result["applied"] is True
    assert result["state_rebuilt"] is True
    assert fake.state_updates[fake.valid_id]["base_year"] == 2025


def test_refresh_max_drawdown_resumes_cursor_until_cycle_is_complete(monkeypatch):
    fake = FakeDb()
    asset_ids = ["DE0000000001", "FR0000000002"]
    fake.series = {
        asset_id: [{
            "asset_id": asset_id,
            "last_date": "2024-03-01",
            "points": [{"date": f"2024-02-{day:02d}", "value": 100 + day} for day in range(1, 25)],
        }]
        for asset_id in asset_ids
    }
    fake.assets = {asset_id: {"asset_id": asset_id} for asset_id in asset_ids}
    # Documentos completos: la maestra solo contiene metrics/latest validos contra
    # metrics.v1.2 (los escribe el cargador validando), y el refresco ahora valida
    # el resultado del merge, asi que el doble debe parecerse al real.
    fake.metrics = {
        asset_id: {
            "asset_id": asset_id,
            "population": "stock",
            "source": "unit-test",
            "updated_at": "2024-01-01T00:00:00Z",
            "windows": {},
            "risk_score_source": "VOL_BUCKET",
            "last_date": "2024-02-01",
        }
        for asset_id in asset_ids
    }
    fake.meta = {"last_price_series_last_date": "2024-01-05"}

    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)

    first = metrics_refresh.refresh_max_drawdown(limit=1, write=True, max_reads=100)
    assert first["cycle_completed"] is False
    assert first["next_scan_after_asset_id"] == asset_ids[0]
    assert set(fake.metrics_updates) == {asset_ids[0]}

    second = metrics_refresh.refresh_max_drawdown(limit=1, write=True, max_reads=100)
    assert second["previous_scan_after_asset_id"] == asset_ids[0]
    assert second["cycle_completed"] is True
    assert second["next_scan_after_asset_id"] is None
    assert set(fake.metrics_updates) == set(asset_ids)


def test_serie_siempre_al_alza_no_escribe_date_nula(monkeypatch):
    """metrics.v1.2 declara max_drawdown_hist.date como string, sin nulos.

    Cuando la serie nunca cae por debajo de su maximo corriente, _run_drawdown
    devuelve worst=0.0 y worst_date=None. Antes se escribia "date": None, que
    rompe el contrato; ahora la clave se omite.
    """
    fake = FakeDb()
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=100)

    escrito = fake.metrics_updates[fake.valid_id]["max_drawdown_hist"]
    assert escrito == {"value": 0.0}
    assert "date" not in escrito
    assert result["contract_rejected"] == 0

    # Y el documento resultante del merge pasa el contrato de verdad.
    metrics_refresh.validate_contract(fake.metrics[fake.valid_id], "metrics.v1.2.schema.json")


def test_metrics_latest_invalido_se_rechaza_y_no_se_escribe(monkeypatch):
    """Un metrics/latest ya incompleto no se completa a ciegas: se cuenta y se salta."""
    fake = FakeDb()
    # Doc sin los obligatorios population/source/risk_score_source: invalido.
    fake.metrics[fake.valid_id] = {
        "asset_id": fake.valid_id,
        "windows": {},
        "last_date": "2024-02-01",
    }
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=100)

    assert result["contract_rejected"] == 1
    assert result["written"] == 0
    assert fake.metrics_updates == {}
    assert result["error_sample"][0]["asset_id"] == fake.valid_id
    assert "metrics.v1.3" in result["error_sample"][0]["error"]


def test_drawdown_real_conserva_su_fecha(monkeypatch):
    """El caso normal no cambia: si hay caida, la fecha viaja como string."""
    fake = FakeDb()
    aid = fake.valid_id
    fake.series[aid] = [{
        "asset_id": aid,
        "last_date": "2024-02-24",
        "points": (
            [{"date": f"2024-02-{day:02d}", "value": 100 + day} for day in range(1, 13)]
            + [{"date": f"2024-02-{day:02d}", "value": 90} for day in range(13, 25)]
        ),
    }]
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=100)

    escrito = fake.metrics_updates[aid]["max_drawdown_hist"]
    assert escrito["date"] == "2024-02-13"
    assert escrito["value"] < 0
    assert result["contract_rejected"] == 0


# --- Ventanas al dia (13-10-2026) ------------------------------------------------
# El refresco solo fusionaba drawdown, last_date y updated_at: las ventanas de
# calculo propio se quedaban como las dejo la ingesta y el documento parecia
# fresco (VALENTUM ES0182769002: 1y guardado 28,45 %, serie 19,15 %).


FUND_ID = "ES0182769002"


def _serie_diaria(dias=800, inicio=_dt.date(2024, 1, 1)):
    puntos = []
    for i in range(dias):
        fecha = inicio + _dt.timedelta(days=i)
        if fecha.weekday() < 5:
            puntos.append({"date": fecha.isoformat(), "value": round(100 + i * 0.05 + (0.8 if i % 3 else -0.8), 4)})
    por_anio = {}
    for p in puntos:
        por_anio.setdefault(int(p["date"][:4]), []).append(p)
    return [{"asset_id": FUND_ID, "year": y, "last_date": pts[-1]["date"], "points": pts}
            for y, pts in sorted(por_anio.items())]


def _metricas_congeladas(source="FONDOSDB_EODHD_DAILY_HISTORY", last_date=None):
    return {
        "asset_id": FUND_ID, "population": "fund", "source": source,
        "updated_at": "2026-10-10T06:30:52.939Z",
        "windows": {
            "1y": {"annualized_return": 0.2845035, "annualized_volatility": 0.1, "risk_free_rate": 0.02,
                   "sharpe_ratio": 2.6, "method": "GEOMETRIC_CAGR", "frequency": "WEEKLY"},
            "3y": {"annualized_return": 0.05, "method": "TRAILING_PROVIDER", "frequency": "PROVIDER"},
        },
        "ytd_return": 0.3, "max_drawdown_5y": -0.5,
        "max_drawdown_hist": {"value": -0.38, "date": "2020-03-18"},
        "srri": 4, "risk_score_source": "SRRI", "observations_count": 10,
        "first_date": "2024-01-01", "last_date": last_date or "2024-06-03",
    }


def _fondo(monkeypatch, metricas, tasa=0.02):
    fake = FakeDb()
    fake.series = {FUND_ID: _serie_diaria()}
    fake.assets = {FUND_ID: {"asset_id": FUND_ID}}
    fake.metrics = {FUND_ID: metricas}
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "_risk_free_resolver",
                        lambda: (lambda _s, _e: {"rate": tasa}))
    return fake


def test_las_fuentes_propias_son_las_de_los_productores():
    import fund_ingest
    import ingest_asset
    from fund_history_quality import METRICS_SOURCE as REVIEW

    assert metrics_refresh.SELF_COMPUTED_SOURCES == {
        ingest_asset.METRICS_SOURCE, fund_ingest.METRICS_SOURCE, REVIEW}


def test_calculo_propio_recalcula_las_ventanas_con_la_serie_y_fecha_real(monkeypatch):
    fake = _fondo(monkeypatch, _metricas_congeladas())

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000, collect_detail=True)

    assert result["windows_recomputed"] == 1 and result["written"] == 1
    escrito = fake.metrics[FUND_ID]
    serie_fin = fake.series[FUND_ID][-1]["last_date"]
    # last_date vuelve a ser la fecha de las ventanas, no solo la del drawdown.
    assert escrito["last_date"] == serie_fin
    assert escrito["windows"]["1y"]["method"] == "GEOMETRIC_CAGR"
    assert escrito["windows"]["1y"]["annualized_return"] != 0.2845035
    assert escrito["windows"]["1y"]["risk_free_rate"] == 0.02
    # La ventana que la reconciliacion dejo con el proveedor no se toca.
    assert escrito["windows"]["3y"] == {"annualized_return": 0.05, "method": "TRAILING_PROVIDER",
                                        "frequency": "PROVIDER"}
    # SRRI del KID arrastrado; YTD y observaciones recalculados.
    assert escrito["srri"] == 4 and escrito["risk_score_source"] == "SRRI"
    assert escrito["observations_count"] > 10
    detalle = result["window_detail"][0]
    assert detalle["windows"]["1y"]["return"][0] == 0.2845035
    assert detalle["last_date"] == serie_fin


def test_un_campo_que_el_recalculo_ya_no_publica_se_borra():
    class Batch(MetricsBatch):
        def update(self, ref, value, option=None):
            self.ops.append((ref, value, option))

        def commit(self):
            pass

    class Db:
        def __init__(self):
            self.made = Batch()

        def batch(self):
            return self.made

    db = Db()
    vivo = _metricas_congeladas()
    nuevo = {k: v for k, v in vivo.items() if k != "max_drawdown_5y"}

    metrics_refresh._write_full_metrics(db, AssetRef(None, FUND_ID), Snap("latest", vivo), nuevo, vivo)

    _ref, enviado, option = db.made.ops[0]
    # Un max_drawdown_5y viejo junto a ventanas nuevas es justo la mezcla que se corrige.
    assert enviado["max_drawdown_5y"] is _gcf.DELETE_FIELD
    assert enviado["windows"] == vivo["windows"]
    assert option._last_update_time == 1


def test_metricas_del_proveedor_siguen_recibiendo_solo_el_drawdown(monkeypatch):
    congeladas = _metricas_congeladas(source="FONDOSDB_ROOT_ES")
    fake = _fondo(monkeypatch, congeladas)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    assert result["windows_recomputed"] == 0 and result["written"] == 1
    assert set(fake.metrics_updates[FUND_ID]) == {"max_drawdown_hist", "last_date", "updated_at"}
    assert fake.metrics[FUND_ID]["windows"] == congeladas["windows"]


def test_sin_tasa_del_bce_no_se_escribe_un_sharpe_sin_descontar(monkeypatch):
    fake = _fondo(monkeypatch, _metricas_congeladas(), tasa=0.0)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    assert result["written"] == 0
    assert result["windows_skipped"] == [{"asset_id": FUND_ID, "reason": "NO_RATE"}]
    assert fake.metrics_updates == {}


def test_la_estr_parcial_se_escribe_como_la_simulacion_y_se_cuenta_en_el_resumen(monkeypatch):
    """Quinta pasada, I-2: con la €STR cubriendo menos del 95 % de la ventana, la maestra
    conserva la media parcial (como la simulacion) y el refresco la cuenta en su resumen;
    metrics.v1.3 no admite el aviso dentro del documento."""
    fake = _fondo(monkeypatch, _metricas_congeladas())
    monkeypatch.setattr(metrics_refresh, "_risk_free_resolver",
                        lambda: (lambda _s, _e: {"rate": 0.015, "coverage_ratio": 0.62}))

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    assert result["written"] == 1 and result["windows_skipped"] == []
    assert fake.metrics[FUND_ID]["windows"]["1y"]["risk_free_rate"] == 0.015
    parcial = result["risk_free_partial_coverage"]
    assert parcial["assets"] == 1 and parcial["windows"] >= 1
    assert parcial["by_window"].get("1y") == 1
    assert parcial["sample"][0]["asset_id"] == FUND_ID
    assert parcial["sample"][0]["windows"]["1y"] == 0.62


def test_con_la_estr_completa_el_resumen_no_cuenta_nada(monkeypatch):
    _fondo(monkeypatch, _metricas_congeladas())
    monkeypatch.setattr(metrics_refresh, "_risk_free_resolver",
                        lambda: (lambda _s, _e: {"rate": 0.02, "coverage_ratio": 1.0}))

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    assert result["written"] == 1
    assert result["risk_free_partial_coverage"] == {"windows": 0, "assets": 0, "by_window": {}, "sample": []}


def test_force_windows_pone_al_dia_lo_que_el_refresco_viejo_dejo_con_fecha_movida(monkeypatch):
    serie_fin = _serie_diaria()[-1]["last_date"]
    fake = _fondo(monkeypatch, _metricas_congeladas(last_date=serie_fin))

    sin_forzar = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000)
    forzado = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000, force_windows=True)

    assert sin_forzar["skipped_not_newer"] == 1 and sin_forzar["would_write"] == 0
    assert forzado["windows_recomputed"] == 1 and forzado["would_write"] == 1
    assert fake.metrics_updates == {}


def test_el_recorrido_de_raices_va_por_paginas_y_no_pierde_ninguna(monkeypatch):
    """Un solo cursor sobre todas las raices moria con 504 Deadline Exceeded en
    cuanto cada activo cargaba su serie entera (pasada en seco del 13-10)."""
    fake = FakeDb()
    fake.assets = {f"ES000000000{i}": {"asset_id": f"ES000000000{i}"} for i in range(5)}
    vistos = [s.id for s in metrics_refresh._asset_stream(fake, None, page_size=2)]
    assert vistos == sorted(fake.assets)
    assert fake.asset_pages == 3
    tras = [s.id for s in metrics_refresh._asset_stream(fake, "ES0000000001", page_size=2)]
    assert tras == ["ES0000000002", "ES0000000003", "ES0000000004"]


def test_el_recalculo_conserva_la_firma_del_nav_de_gestora(monkeypatch):
    """ES0137397008 (NAV de la web de Fineco, FONDOSDB_FUND_NAV_EUR) salia
    firmado como FONDOSDB_EODHD_DAILY_HISTORY en la pasada en seco del 13-10."""
    fake = _fondo(monkeypatch, _metricas_congeladas(source="FONDOSDB_FUND_NAV_EUR"))

    metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    assert fake.metrics[FUND_ID]["source"] == "FONDOSDB_FUND_NAV_EUR"


def test_la_politica_de_historico_si_cambia_la_firma(monkeypatch):
    fake = _fondo(monkeypatch, _metricas_congeladas(source="FONDOSDB_FUND_NAV_EUR"))
    import fund_history_quality
    monkeypatch.setattr(fund_history_quality, "policy_for",
                        lambda aid: {"usable_from": "2024-03-01"} if aid == FUND_ID else {})
    monkeypatch.setattr(metrics_refresh, "policy_for", fund_history_quality.policy_for)

    metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    escrito = fake.metrics[FUND_ID]
    assert escrito["source"] == "FUND_QUALITY_REVIEW_V1"
    assert escrito["first_date"] >= "2024-03-01"


# --- Tope por ejecucion (14-10-2026) ------------------------------------------
# El recalculo completo pide ~22.000 lecturas y el tope desplegado es 6.000 por
# ejecucion: el ciclo se reparte en varias con el cursor de raices. En seco ese
# cursor no se escribe, asi que quien encadena ciclos tiene que pasarlo.

FONDOS = [f"LU000000000{i}" for i in range(1, 5)]


def _fondos(monkeypatch, scan_after=None):
    fake = FakeDb()
    fake.series = {aid: [dict(doc, asset_id=aid) for doc in _serie_diaria()] for aid in FONDOS}
    fake.assets = {aid: {"asset_id": aid} for aid in FONDOS}
    fake.metrics = {aid: dict(_metricas_congeladas(), asset_id=aid) for aid in FONDOS}
    fake.meta = {"last_price_series_last_date": "2024-01-05", "scan_after_asset_id": scan_after}
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: fake)
    monkeypatch.setattr(metrics_refresh, "master_writes_enabled", lambda: True)
    monkeypatch.setattr(metrics_refresh, "_risk_free_resolver",
                        lambda: (lambda _s, _e: {"rate": 0.02}))
    # 3 lecturas de cabecera por activo (raiz, ultimo doc de serie, metrics) + 3
    # documentos anuales: con un suelo de 3 y un tope de 15 caben dos por ciclo.
    monkeypatch.setattr(metrics_refresh, "FULL_LOAD_READ_FLOOR", 3)
    return fake


def test_start_after_manda_sobre_el_cursor_guardado(monkeypatch):
    _fondos(monkeypatch, scan_after=FONDOS[1])

    guardado = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000, force_windows=True,
                                                    collect_detail=True)
    desde_cero = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000, force_windows=True,
                                                      collect_detail=True, start_after=None)
    tras_el_primero = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000, force_windows=True,
                                                           collect_detail=True, start_after=FONDOS[0])

    assert [d["asset_id"] for d in guardado["window_detail"]] == FONDOS[2:]
    assert [d["asset_id"] for d in desde_cero["window_detail"]] == FONDOS
    assert [d["asset_id"] for d in tras_el_primero["window_detail"]] == FONDOS[1:]


def test_ciclos_en_seco_se_encadenan_sin_repetir_ni_pasar_del_tope(monkeypatch, capsys):
    import json

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import run_metrics_refresh

    fake = _fondos(monkeypatch, scan_after=FONDOS[2])
    monkeypatch.setattr(sys, "argv", ["run_metrics_refresh.py", "--force-windows", "--max-reads", "15",
                                      "--max-cycles", "5", "--detail-out", os.devnull])

    assert run_metrics_refresh.main() == 0

    lineas = [json.loads(linea) for linea in capsys.readouterr().out.splitlines() if linea.startswith("{")]
    resumen = lineas[-1]["summary"]
    ciclos = [linea for linea in lineas if "cycle" in linea]  # fuera, los avisos de gobierno
    # --force-windows empieza en la primera raiz aunque haya un cursor guardado.
    assert ciclos[0]["previous_scan_after_asset_id"] is None
    assert [c["previous_scan_after_asset_id"] for c in ciclos[1:]] == [FONDOS[1]]
    assert resumen["runs"] == 2 and resumen["cycle_completed"] is True
    assert resumen["windows_recomputed"] == len(FONDOS) == resumen["would_write"]
    assert all(lecturas <= 15 for lecturas in resumen["reads_per_cycle"])
    assert resumen["excluded_assets"] == []
    assert resumen["written"] == 0 and fake.metrics_updates == {} and fake.meta_written is None


def test_la_pasada_en_seco_sobre_el_backup_no_escribe_y_cuenta_lo_que_cambiaria(tmp_path, monkeypatch, capsys):
    """scripts/dryrun_metrics_refresh_backup.py: la herramienta con la que se
    ensenan los numeros antes de aprobar la escritura (14-10-2026)."""
    import gzip
    import json

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import dryrun_metrics_refresh_backup as dryrun

    def ndjson(nombre, registros):
        with gzip.open(tmp_path / nombre, "wt", encoding="utf-8") as fh:
            for path, data in registros:
                fh.write(json.dumps({"path": path, "data": data}) + "\n")

    registros = []
    for aid in FONDOS[:2]:
        registros.append((f"assets/{aid}", {"asset_id": aid, "asset_type": "FUND"}))
        registros.append((f"assets/{aid}/metrics/latest", dict(_metricas_congeladas(), asset_id=aid)))
        for doc in _serie_diaria():
            registros.append((f"assets/{aid}/price_series/Y{doc['year']}", dict(doc, asset_id=aid)))
    ndjson("assets.ndjson.gz", registros)
    ndjson("meta.ndjson.gz", [("meta/metrics_refresh", {"scan_after_asset_id": FONDOS[0]})])
    salida = tmp_path / "detalle.json"
    monkeypatch.setattr(sys, "argv", ["dryrun", "--backup", str(tmp_path), "--json", str(salida),
                                      "--env-file", str(tmp_path / "no-existe"), "--sample", FONDOS[0]])

    assert dryrun.main() == 0

    resultado = json.loads(salida.read_text(encoding="utf-8"))
    assert resultado["summary"]["would_write"] == 2 and resultado["summary"]["written"] == 0
    assert {r["asset_id"] for r in resultado["rows"]} == set(FONDOS[:2])
    assert all("ventanas" in r["tags"] for r in resultado["rows"])
    assert "1y   28,45 % -> " in capsys.readouterr().out
    # El modulo queda como estaba: el resto de la suite no hereda el cliente del backup.
    assert metrics_refresh._master_db is not None and metrics_refresh._master_db.__name__ == "_master_db"
    assert metrics_refresh.validate_contract.__name__ == "validate_contract"


# --- NH Hoteles excluida (decision de Oscar, 14-10-2026) -------------------------

NH = "ES0161560018"


def test_nh_hoteles_no_se_toca_ni_en_la_puesta_al_dia_ni_en_el_refresco(monkeypatch):
    fake = _fondos(monkeypatch)
    fake.series[NH] = [dict(doc, asset_id=NH) for doc in _serie_diaria()]
    fake.assets[NH] = {"asset_id": NH}
    vivo = dict(_metricas_congeladas(), asset_id=NH, population="stock")
    fake.metrics[NH] = dict(vivo)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "FULL_LOAD_READ_FLOOR", 40)

    forzado = metrics_refresh.refresh_max_drawdown(write=True, max_reads=10000, force_windows=True,
                                                   start_after=None)
    diario = metrics_refresh.refresh_max_drawdown(write=True, max_reads=10000, start_after=None)
    uno = metrics_refresh.recompute_one(NH, write=True)

    assert forzado["excluded_assets"] == [NH] and diario["excluded_assets"] == [NH]
    assert forzado["windows_recomputed"] == len(FONDOS)  # el resto si se recalcula
    assert uno["excluded"] is True and uno["applied"] is False
    assert NH not in fake.metrics_updates and NH not in fake.state_updates
    assert fake.metrics[NH] == vivo


def test_la_exclusion_es_por_isin_y_no_por_precio_congelado(monkeypatch):
    import fund_history_quality

    assert metrics_refresh.METRICS_REFRESH_EXCLUDED == {NH}
    fake = _fondo(monkeypatch, _metricas_congeladas())
    congelado = {"flags": ["PRICE_FROZEN_DELISTED"], "frozen_price": {"value": 6.5}}
    monkeypatch.setattr(fund_history_quality, "policy_for", lambda aid: congelado if aid == FUND_ID else {})
    monkeypatch.setattr(metrics_refresh, "policy_for", fund_history_quality.policy_for)

    result = metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000)

    assert result["excluded_assets"] == [] and result["written"] == 1
    assert FUND_ID in fake.metrics_updates


# --- Cuatro ejecuciones al dia (decision de Oscar, 14-10-2026) --------------------

def _programada(monkeypatch, hoy="2026-10-14"):
    fake = _fondos(monkeypatch)
    monkeypatch.setattr(metrics_refresh, "require_master_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "require_metrics_writes_enabled", lambda _op: None)
    monkeypatch.setattr(metrics_refresh, "_madrid_today", lambda: hoy)
    return fake


def test_las_ejecuciones_del_dia_siguen_el_cursor_y_paran_cuando_la_vuelta_esta_completa(monkeypatch):
    fake = _programada(monkeypatch)  # tope 15 = dos activos por ejecucion

    primera = metrics_refresh.refresh_max_drawdown(write=True, max_reads=15, once_per_day=True)
    segunda = metrics_refresh.refresh_max_drawdown(write=True, max_reads=15, once_per_day=True)
    paginas = fake.asset_pages
    tercera = metrics_refresh.refresh_max_drawdown(write=True, max_reads=15, once_per_day=True)

    assert primera["cycle_completed"] is False and primera["next_scan_after_asset_id"] == FONDOS[1]
    assert segunda["previous_scan_after_asset_id"] == FONDOS[1] and segunda["cycle_completed"] is True
    assert set(fake.metrics_updates) == set(FONDOS)
    assert fake.meta["cycle_completed_on"] == "2026-10-14"
    # Vuelta del dia completa: la siguiente solo lee meta/metrics_refresh.
    assert tercera["skipped_reason"] == "CYCLE_ALREADY_COMPLETED_TODAY"
    assert tercera["read_budget_used"] == 1 and fake.asset_pages == paginas


def test_al_dia_siguiente_empieza_otra_vuelta_y_las_manuales_no_usan_la_compuerta(monkeypatch):
    fake = _programada(monkeypatch, hoy="2026-10-15")
    fake.meta.update({"cycle_completed": True, "cycle_completed_on": "2026-10-14", "scan_after_asset_id": None})

    manana = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000, once_per_day=True)
    fake.meta["cycle_completed_on"] = "2026-10-15"
    manual = metrics_refresh.refresh_max_drawdown(write=False, max_reads=1000, force_windows=True)

    assert "skipped_reason" not in manana and manana["windows_recomputed"] == len(FONDOS)
    assert "skipped_reason" not in manual and manual["windows_recomputed"] == len(FONDOS)


def test_una_vuelta_manual_completa_no_marca_el_dia(monkeypatch):
    fake = _programada(monkeypatch)

    metrics_refresh.refresh_max_drawdown(write=True, max_reads=1000, force_windows=True)

    assert fake.meta["cycle_completed"] is True
    assert "cycle_completed_on" not in fake.meta


def _registro(monkeypatch, capsys, resultado, ultima):
    import main

    monkeypatch.setattr(metrics_refresh, "refresh_max_drawdown", lambda **kw: dict(resultado, kw=kw))
    main._run_scheduled_metrics(last_of_day=ultima)
    return capsys.readouterr().out


def test_solo_la_ultima_ejecucion_del_dia_avisa_de_vuelta_parcial(monkeypatch, capsys):
    parcial = {"cycle_completed": False, "stopped_by_budget": True}

    intermedia = _registro(monkeypatch, capsys, parcial, ultima=False)
    ultima = _registro(monkeypatch, capsys, parcial, ultima=True)
    completa = _registro(monkeypatch, capsys, {"cycle_completed": True, "stopped_by_budget": False}, ultima=True)
    saltada = _registro(monkeypatch, capsys, {"skipped_reason": "CYCLE_ALREADY_COMPLETED_TODAY",
                                              "cycle_completed": True}, ultima=True)

    assert intermedia.startswith("INFO scheduled_refresh_metrics_in_progress:")
    assert "WARNING" not in intermedia and "scheduled_refresh_metrics_partial" not in intermedia
    assert ultima.startswith("WARNING scheduled_refresh_metrics_partial:")
    assert completa.startswith("scheduled_refresh_metrics_ok:")
    assert saltada.startswith("INFO scheduled_refresh_metrics_skipped:")
    assert "'once_per_day': True" in intermedia


def test_horarios_de_metricas_e_integridad():
    import main

    def cron(fn):
        trigger = fn.__firebase_endpoint__.scheduleTrigger
        return trigger["schedule"], trigger["timeZone"]

    assert [cron(f) for f in (main.scheduled_refresh_metrics, main.scheduled_refresh_metrics_0900,
                              main.scheduled_refresh_metrics_0930, main.scheduled_refresh_metrics_1000)] == [
        ("30 8 * * *", "Europe/Madrid"), ("0 9 * * *", "Europe/Madrid"),
        ("30 9 * * *", "Europe/Madrid"), ("0 10 * * *", "Europe/Madrid")]
    # Integridad despues de la ultima (10:00 + timeout de 25 min).
    assert cron(main.scheduled_integrity_check) == ("30 10 * * *", "Europe/Madrid")
    assert main.METRICS_SCHEDULE_OPTIONS["timeout_sec"] <= 30 * 60 - 5 * 60
