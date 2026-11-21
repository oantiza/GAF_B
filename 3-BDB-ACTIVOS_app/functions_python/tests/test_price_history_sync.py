import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import price_history_sync as sync
import price_refresh as refresh
import price_series_cache as cache
from optimization import repository

AID = "US0000000001"
SYMBOL = "CONTROL.US"
NOW = "2026-09-06T12:00:00Z"


def document(doc_id, points):
    return {"schema_version": refresh.PRICE_SERIES_SCHEMA, "asset_id": AID, "asset_type": "STOCK",
            "source": "EODHD", "source_listing_id": "EODHD:" + SYMBOL,
            "source_price_id": "EODHD:" + SYMBOL, "document_id": doc_id,
            "currency": "EUR", "source_currency": "EUR", "interval": "1d",
            "year": int(points[0]["date"][:4]), "series_type": "ADJUSTED_CLOSE",
            "points": points, "first_date": points[0]["date"], "last_date": points[-1]["date"],
            "observations_count": len(points), "history_quality_status": "COMPLETE", "updated_at": NOW}


def history():
    return {
        "EODHD_CONTROL_US_2002": document("EODHD_CONTROL_US_2002", [{"date": "2002-01-02", "value": 20.0}]),
        "EODHD_CONTROL.US_REFRESH_2026": document("EODHD_CONTROL.US_REFRESH_2026", [
            {"date": "2026-08-28", "value": 100.0}, {"date": "2026-09-02", "value": 102.0}]),
    }


def provider():
    return [{"date": day, "adjusted_close": value, "close": value * factor} for day, value, factor in [
        ("2002-01-02", 10.0, 16), ("2026-08-28", 50.0, 2),
        ("2026-09-02", 51.0, 2), ("2026-09-03", 52.0, 1),
    ]]


def plan_for(docs=None, rows=None):
    rows = rows if rows is not None else provider()
    points, meta = refresh._convert_eur(rows, "EUR", {}, "2002-01-02", "2026-09-06")
    return sync.build_repair_plan(AID, "STOCK", SYMBOL, "EUR", docs or history(), rows, points, meta, NOW)


def test_revision_is_detected_even_without_new_dates_and_fx_noise_is_ignored():
    old = document("test", [{"date": "2026-09-02", "value": 85, "source_value": 102}])
    old["source_currency"] = "USD"
    assert sync.revision_detected(old, [{"date": "2026-09-02", "adjusted_close": 51}], "USD")
    assert not sync.revision_detected(old, [{"date": "2026-09-02", "adjusted_close": 102}], "USD")


def test_full_repair_updates_old_years_and_duplicate_dates_and_preserves_all_dates():
    docs = history()
    docs["EODHD_CONTROL_US_2026"] = document("EODHD_CONTROL_US_2026", [{"date": "2026-08-28", "value": 100}])
    plan = plan_for(docs)
    assert plan["documents"]["EODHD_CONTROL_US_2002"]["points"][0]["value"] == 10
    for doc in plan["documents"].values():
        for p in doc["points"]:
            if p["date"] == "2026-08-28":
                assert p["value"] == 50
    assert {p["date"] for p in plan["points"]} == {p["date"] for p in provider()}
    assert plan["old_unique_points"] == 3 and plan["new_unique_points"] == 4
    ultimo = plan["documents"]["EODHD_CONTROL.US_REFRESH_2026"]["points"][-1]
    # El valor de origen viaja con un solo nombre, y la divisa vive en el documento.
    assert ultimo["source_value"] == 52
    assert "source_close" not in ultimo and "source_adjusted_close" not in ultimo
    assert "source_currency" not in ultimo


def test_same_complete_snapshot_is_idempotent():
    first = plan_for()
    second = plan_for(first["documents"])
    assert second["documents"] == {}


@pytest.mark.parametrize("missing", ["2002-01-02", "2026-08-28", "2026-09-02"])
def test_missing_provider_history_never_truncates_existing_dates(missing):
    with pytest.raises(sync.HistoryRepairRequired):
        plan_for(rows=[p for p in provider() if p["date"] != missing])


def test_missing_fx_never_creates_a_partially_repaired_history():
    rows = provider()
    points, meta = refresh._convert_eur(rows, "EUR", {}, "2002-01-02", "2026-09-06")
    with pytest.raises(sync.HistoryRepairRequired, match="INCOMPLETE"):
        sync.build_repair_plan(AID, "STOCK", SYMBOL, "EUR", history(), rows, points[1:], meta, NOW)


def test_ambiguous_listings_and_unrelated_quality_blocks_are_preserved():
    docs = history()
    docs["EODHD_CONTROL_US_2002"]["source_listing_id"] = "EODHD:OTHER.US"
    with pytest.raises(sync.HistoryRepairRequired, match="AMBIGUOUS"):
        plan_for(docs)
    docs = history()
    docs["EODHD_CONTROL_US_2002"]["history_quality_status"] = "BLOCKED"
    with pytest.raises(sync.HistoryRepairRequired, match="UNRELATED"):
        plan_for(docs)


class Snap:
    def __init__(self, db, path):
        self.id = path.split("/")[-1]
        self.reference = Ref(db, path)
        self.exists = path in db.data
        self.update_time = db.versions.get(path, 0)
        self.data = copy.deepcopy(db.data.get(path))

    def to_dict(self):
        return copy.deepcopy(self.data)


class Ref:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def get(self):
        return Snap(self.db, self.path)

    def collection(self, name):
        return Collection(self.db, self.path + "/" + name)

    def update(self, value, option=None):
        batch = self.db.batch()
        batch.update(self, value, option)
        batch.commit()

    def set(self, value, merge=False):
        if not merge:
            self.db.data[self.path] = {}
        self.update(value)


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path
        self.sort_key, self.take, self.cursor = None, None, None

    def document(self, name):
        return Ref(self.db, self.path + "/" + name)

    def select(self, *_):
        return self

    def order_by(self, key, **kwargs):
        self.sort_key = key
        return self

    def limit(self, n):
        self.take = n
        return self

    def start_after(self, cursor):
        self.cursor = next(iter(cursor.values()))
        return self

    def stream(self):
        snaps = [Snap(self.db, p) for p in self.db.data if p.startswith(self.path + "/")
                 and p.count("/") == self.path.count("/") + 1]
        if self.sort_key == "last_date":
            snaps.sort(key=lambda s: (s.data or {}).get("last_date", ""), reverse=True)
        else:
            snaps.sort(key=lambda s: s.id)
        if self.cursor:
            snaps = [s for s in snaps if s.id > self.cursor]
        return snaps[:self.take] if self.take is not None else snaps


class Batch:
    def __init__(self, db):
        self.db, self.ops = db, []

    def update(self, ref, value, option=None):
        self.ops.append(("update", ref.path, value, option))

    def create(self, ref, value):
        self.ops.append(("create", ref.path, value, None))

    def set(self, ref, value):
        self.ops.append(("set", ref.path, value, None))

    def delete(self, ref, option=None):
        self.ops.append(("delete", ref.path, None, option))

    def commit(self):
        if self.db.conflict:
            self.db.conflict(self.db)
            self.db.conflict = None
        for kind, path, _, option in self.ops:
            if option is not None and option._last_update_time != self.db.versions.get(path, 0):
                raise RuntimeError("CONCURRENT_UPDATE")
            if kind == "create" and path in self.db.data:
                raise RuntimeError("ALREADY_EXISTS")
        from google.cloud.firestore import DELETE_FIELD
        for kind, path, value, _ in self.ops:
            if kind == "delete":
                self.db.data.pop(path, None)
            else:
                if kind == "set":
                    self.db.data[path] = {}
                target = self.db.data.setdefault(path, {})
                for key, item in value.items():
                    if item is DELETE_FIELD:
                        target.pop(key, None)
                    else:
                        target[key] = copy.deepcopy(item)
            self.db.versions[path] = self.db.versions.get(path, 0) + 1
        self.db.commits.append(copy.deepcopy(self.ops))


class Db:
    def __init__(self):
        self.data = {"assets/" + AID: {"asset_id": AID, "asset_type": "STOCK"}}
        for key, doc in history().items():
            self.data[f"assets/{AID}/price_series/{key}"] = doc
        self.data[f"assets/{AID}/metrics/latest"] = {"legacy": "must not survive"}
        self.data[f"assets/{AID}/metrics/drawdown_state"] = {"peak_value": 100, "mdd_value": -0.5}
        self.versions = {key: 1 for key in self.data}
        self.commits = []
        self.conflict = None

    def collection(self, name):
        return Collection(self, name)

    def batch(self):
        return Batch(self)


@pytest.fixture
def producer(monkeypatch):
    import ingest_asset
    db = Db()
    monkeypatch.setattr(refresh, "_master_db", lambda: db)
    monkeypatch.setattr(refresh, "_today", lambda: "2026-09-03")
    monkeypatch.setattr(refresh, "listing_currency", lambda symbol: "EUR")
    monkeypatch.setattr(refresh, "fetch_eod", lambda *args: provider())
    monkeypatch.setattr(refresh, "require_master_writes_enabled", lambda *args, **kwargs: None)
    monkeypatch.setattr(ingest_asset, "_estr_window_resolver", lambda *args: {"rate": 0.01})
    return db


def test_manual_refresh_repairs_prices_and_metrics_atomically(producer):
    result = refresh.refresh_one(AID, write=True)
    assert result["history_rebuilt"] and result["applied"]
    assert len(producer.commits) == 1
    points = producer.data[f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"]["points"]
    assert [p["value"] for p in points] == [50, 51, 52]
    metrics = producer.data[f"assets/{AID}/metrics/latest"]
    assert metrics["max_drawdown_hist"]["value"] == 0
    assert "legacy" not in metrics
    assert f"assets/{AID}/metrics/drawdown_state" not in producer.data


def test_daily_refresh_uses_the_same_history_repair(producer):
    result = refresh.refresh_stale_prices(write=True, limit=1, max_reads=100)
    assert result["errors"] == 0, result
    assert result["histories_rebuilt"] == 1
    # Segunda pasada (17-10-2026): la fila de la muestra dice que es una reconstruccion; su
    # new_points es el historico entero y el panel lo etiqueta asi (refreshSampleRebuildLabel).
    row = next(item for item in result["sample"] if item["asset_id"] == AID)
    assert row["history_rebuilt"] is True and row["new_points"] == row["points"]
    assert producer.data[f"assets/{AID}/price_series/EODHD_CONTROL_US_2002"]["points"][0]["value"] == 10


def test_reingestion_also_repairs_refresh_documents_and_cached_drawdown(producer, monkeypatch):
    import ingest_asset
    monkeypatch.setattr(ingest_asset, "listing_currency", lambda *args: "EUR")
    monkeypatch.setattr(ingest_asset, "_today", lambda: "2026-09-03")
    result = ingest_asset._load_full_history(producer, AID,
        {"symbol": SYMBOL, "currency": "EUR", "type_class": "STOCK"}, write=True)
    assert result["history_rebuilt"] and result["applied"]
    assert len(producer.commits) == 1
    assert producer.data[f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"]["points"][0]["value"] == 50
    assert f"assets/{AID}/metrics/drawdown_state" not in producer.data


def test_full_history_preview_has_zero_writes(producer):
    before = copy.deepcopy(producer.data)
    result = refresh.refresh_one(AID, write=False)
    assert result["history_rebuilt"] and not result["applied"]
    assert producer.data == before and producer.commits == []


@pytest.mark.parametrize("write", [False, True])
def test_history_rebuild_answers_with_the_keys_the_admin_panel_reads(producer, write):
    # CRIT-03 (auditoria 16-10-2026): parseAdminRefreshAssetPrices exige new_points,
    # new_first y new_last en un refresco aplicado; la reconstruccion los devuelve con el
    # historico entero, coherentes con points/first_date/last_date.
    result = refresh.refresh_one(AID, write=write)
    assert result["found"] is True and result["history_rebuilt"] is True
    assert result["applied"] is write
    assert result["new_points"] == result["points"] > 0
    assert result["new_first"] == result["first_date"]
    assert result["new_last"] == result["last_date"]
    assert result["new_first"] <= result["new_last"]
    assert isinstance(result["revision"], str) and result["history_documents"] >= 0


def test_atomic_conflict_does_not_publish_half_a_repair(producer):
    before = copy.deepcopy(producer.data)
    path = f"assets/{AID}/price_series/EODHD_CONTROL_US_2002"
    producer.conflict = lambda db: db.versions.update({path: 2})
    with pytest.raises(RuntimeError, match="CONCURRENT_UPDATE"):
        refresh.refresh_one(AID, write=True)
    assert producer.data == before and producer.commits == []


def test_old_metrics_job_cannot_overwrite_repaired_metrics_or_recreate_old_state(producer):
    import metrics_refresh
    ref = producer.collection("assets").document(AID)
    stale_snapshot = ref.collection("metrics").document("latest").get()
    refresh.refresh_one(AID, write=True)
    before = copy.deepcopy(producer.data)
    with pytest.raises(RuntimeError, match="CONCURRENT_UPDATE"):
        metrics_refresh._write_metrics_and_state(producer, ref, stale_snapshot,
            {"max_drawdown_hist": {"value": -0.5}}, {"peak_value": 102, "mdd_value": -0.5})
    assert producer.data == before


def test_metrics_do_not_publish_a_known_or_dynamically_blocked_series(producer, monkeypatch):
    import metrics_refresh
    monkeypatch.setattr(metrics_refresh, "_master_db", lambda: producer)
    latest = producer.data[f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"]
    latest["history_quality_status"] = "BLOCKED"
    with pytest.raises(sync.HistoryRepairRequired, match="BLOCKED_PRICE_HISTORY"):
        metrics_refresh.recompute_one(AID, write=False)
    assert producer.commits == []
    for aid in sync.ADJUSTMENT_QUARANTINE_ASSETS:
        with pytest.raises(sync.HistoryRepairRequired, match="QUARANTINED"):
            metrics_refresh._guard_price_history(aid)


def test_master_write_gate_is_required_before_price_or_metric_mutations(monkeypatch):
    monkeypatch.delenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES", raising=False)
    with pytest.raises(RuntimeError, match="MASTER_WRITES_DISABLED"):
        refresh.refresh_one(AID, write=True)


def test_incomplete_repair_blocks_history_without_changing_prices(producer, monkeypatch):
    monkeypatch.setattr(refresh, "fetch_eod", lambda *args: provider()[1:])
    with pytest.raises(sync.HistoryRepairRequired, match="INCOMPLETE"):
        refresh.refresh_one(AID, write=True)
    latest = producer.data[f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"]
    assert latest["history_quality_status"] == "BLOCKED"
    assert [p["value"] for p in latest["points"]] == [100, 102]
    assert sync.adjustment_problem(AID, [latest]) == "PRICE_ADJUSTMENT_QUARANTINE"


def test_retry_never_relabels_and_clears_an_unrelated_quality_hold(producer):
    path = f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"
    producer.data[path]["history_quality_status"] = "BLOCKED"
    before = copy.deepcopy(producer.data)
    for _ in range(2):
        with pytest.raises(sync.HistoryRepairRequired, match="UNRELATED"):
            refresh.refresh_one(AID, write=True)
    assert producer.data == before and producer.commits == []


def test_known_adjustment_errors_are_blocked_for_the_optimizer():
    for aid in sync.ADJUSTMENT_QUARANTINE_ASSETS:
        assert repository._root_exclusion_reason({"asset_type": "STOCK"}, "EUR", aid) == "QUALITY_BLOCKED"


def test_verified_release_is_explicit_and_does_not_override_new_quality_holds(monkeypatch):
    fx_id, adjustment_id = "IE000M7V94E1", "US0320951017"
    monkeypatch.delenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", raising=False)
    assert repository.asset_id_in_quarantine(fx_id)
    assert sync.adjustment_problem(adjustment_id)
    monkeypatch.setenv("BDB_VERIFIED_PRICE_REPAIR_RELEASES", fx_id + "," + adjustment_id)
    assert not repository.asset_id_in_quarantine(fx_id)
    assert sync.adjustment_problem(adjustment_id) is None
    assert repository.asset_id_in_quarantine("GB0005405286")
    assert sync.adjustment_problem(adjustment_id, [{"metadata": {
        "price_history_sync": {"status": "REPAIR_REQUIRED"}}}]) == "PRICE_ADJUSTMENT_QUARANTINE"
    assert repository._root_exclusion_reason({"asset_type": "ETF", "quality": {"status": "BLOCKED"}},
                                              "EUR", fx_id) == "QUALITY_BLOCKED"


def test_hot_price_cache_still_expires_after_a_remote_repair(monkeypatch):
    cache.clear_price_series_cache()
    clock = [0.0]
    monkeypatch.setattr(cache.time, "monotonic", lambda: clock[0])
    reader = type("Reader", (), {"value": 1, "get_price_series": lambda self, aid: [{"value": self.value}]})()
    assert cache.cached_price_series(reader, AID)[0]["value"] == 1
    clock[0] = 899
    assert cache.cached_price_series(reader, AID)[0]["value"] == 1
    reader.value = 2
    clock[0] = 901
    assert cache.cached_price_series(reader, AID)[0]["value"] == 2
    cache.clear_price_series_cache()


# ---------------------------------------------------------------------------
# B-05 (auditoria 29-09): un fallo transitorio de EODHD durante la reparacion
# no puede BLOQUEAR el historico. Solo una inconsistencia de datos verificada
# (HistoryRepairRequired) marca BLOCKED; la red/cuota/timeout se aplaza.
# ---------------------------------------------------------------------------

def _eodhd_5xx(*args):
    raise refresh.TransientProviderError("EODHD HTTP 503 for eod/CONTROL.US: upstream unavailable")


def test_transient_provider_failure_defers_repair_without_blocking_history(producer, monkeypatch):
    path = f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"
    # La revision se detecta con el primer fetch (provider()); la reparacion
    # completa vuelve a pedir el historico y ahi EODHD falla con 5xx.
    calls = {"n": 0}

    def flaky(*args):
        calls["n"] += 1
        if calls["n"] == 1:
            return provider()
        _eodhd_5xx()

    monkeypatch.setattr(refresh, "fetch_eod", flaky)
    with pytest.raises(refresh.TransientProviderError):
        refresh.refresh_one(AID, write=True)
    latest = producer.data[path]
    assert latest["history_quality_status"] == "COMPLETE"  # estado previo intacto
    assert [p["value"] for p in latest["points"]] == [100, 102]
    sync_meta = latest["metadata"]["price_history_sync"]
    assert sync_meta["status"] == "REPAIR_DEFERRED"
    assert "503" in sync_meta["reason"]
    # El aplazamiento no es una cuarentena: frontera/backtest y metricas siguen.
    assert sync.adjustment_problem("", [latest]) is None


def test_deferred_repair_is_retried_and_completed_on_the_next_cycle(producer, monkeypatch):
    path = f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"
    calls = {"n": 0}

    def flaky(*args):
        calls["n"] += 1
        if calls["n"] == 2:
            _eodhd_5xx()
        return provider()

    monkeypatch.setattr(refresh, "fetch_eod", flaky)
    with pytest.raises(refresh.TransientProviderError):
        refresh.refresh_one(AID, write=True)
    assert producer.data[path]["metadata"]["price_history_sync"]["status"] == "REPAIR_DEFERRED"
    result = refresh.refresh_one(AID, write=True)
    assert result["history_rebuilt"] and result["applied"]
    assert producer.data[path]["metadata"]["price_history_sync"]["status"] == "VERIFIED"
    assert [p["value"] for p in producer.data[path]["points"]] == [50, 51, 52]


def test_eodhd_5xx_after_retries_and_network_errors_are_classified_transient(monkeypatch):
    import io
    import urllib.error
    monkeypatch.setenv("EODHD_API_KEY", "x")
    monkeypatch.setattr(refresh.time, "sleep", lambda *_: None)

    def http_503(*args, **kwargs):
        raise urllib.error.HTTPError("u", 503, "unavailable", {}, io.BytesIO(b"down"))

    monkeypatch.setattr(refresh.urllib.request, "urlopen", http_503)
    with pytest.raises(refresh.TransientProviderError, match="503"):
        refresh._eodhd_get("eod/X")

    def timeout(*args, **kwargs):
        raise TimeoutError("timed out")

    monkeypatch.setattr(refresh.urllib.request, "urlopen", timeout)
    with pytest.raises(refresh.TransientProviderError, match="network"):
        refresh._eodhd_get("eod/X")

    def http_429(*args, **kwargs):
        raise urllib.error.HTTPError("u", 429, "too many", {}, io.BytesIO(b"quota"))

    monkeypatch.setattr(refresh.urllib.request, "urlopen", http_429)
    with pytest.raises(refresh.TransientProviderError, match="429"):
        refresh._eodhd_get("eod/X")

    # Un 4xx ordinario (simbolo inexistente, token invalido) NO es transitorio.
    def http_404(*args, **kwargs):
        raise urllib.error.HTTPError("u", 404, "nope", {}, io.BytesIO(b"missing"))

    monkeypatch.setattr(refresh.urllib.request, "urlopen", http_404)
    with pytest.raises(RuntimeError) as info:
        refresh._eodhd_get("eod/X")
    assert not isinstance(info.value, refresh.TransientProviderError)


@pytest.mark.parametrize("entry", ["manual", "daily"])
def test_refresh_documents_always_carry_their_source_currency(producer, monkeypatch, entry):
    """Ronda 2 (14-10-2026): los documentos REFRESH nuevos o actualizados llevan
    `source_currency`, como los anuales, tambien si el documento previo no la tenia.
    (En la copia del 14-10 los 1.064 REFRESH ya la llevan; los 793 sin ella son anuales
    legados `_YEAR_` del 23-06 y CNMV, que no se migran.)"""
    path = f"assets/{AID}/price_series/EODHD_CONTROL.US_REFRESH_2026"
    producer.data[path].pop("source_currency")
    rows = [{"date": day, "adjusted_close": value, "close": value} for day, value in [
        ("2026-08-28", 100.0), ("2026-09-02", 102.0), ("2026-09-03", 103.0)]]
    monkeypatch.setattr(refresh, "fetch_eod", lambda *args: rows)
    if entry == "manual":
        result = refresh.refresh_one(AID, write=True)
        assert result.get("new_points") == 1, result
    else:
        result = refresh.refresh_stale_prices(write=True, limit=1, max_reads=100)
        assert result["errors"] == 0 and result["updated"] == 1, result
    doc = producer.data[path]
    assert doc["source_currency"] == "EUR"
    assert doc["last_date"] == "2026-09-03"
