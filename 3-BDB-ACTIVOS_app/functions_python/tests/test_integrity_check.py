import datetime
import os
import sys
from datetime import timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import integrity_check  # noqa: E402
import admin_panel  # noqa: E402


NOW = datetime.datetime(2026, 7, 11, 9, 0, tzinfo=timezone.utc)


class Snap:
    def __init__(self, id_, data=None):
        self.id = id_
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class FakeQuery:
    def __init__(self, ids):
        self._ids = ids

    def stream(self):
        return iter(Snap(i) for i in self._ids)


class FakeCollection:
    def __init__(self, db, name):
        self.db = db
        self.name = name

    def select(self, _fields):
        return FakeQuery(self.db.collections.get(self.name, []))

    def document(self, doc_id):
        return FakeDoc(self.db, f"{self.name}/{doc_id}")

    def list_documents(self):
        return [FakeParentRef(self.db, ref_id)
                for ref_id in self.db.parents.get(self.name, [])]


class FakeParentRef:
    def __init__(self, db, ref_id):
        self.db = db
        self.id = ref_id

    def collection(self, name):
        key = f"{self.id}/{name}"
        return FakeCollection(self.db, key)


class FakeDoc:
    def __init__(self, db, path):
        self.db = db
        self.path = path

    def get(self):
        return Snap(self.path, self.db.docs.get(self.path))

    def set(self, payload):
        self.db.written[self.path] = payload

    def collection(self, name):
        return FakeCollection(self.db, f"{self.path}/{name}")


class FakeDb:
    def __init__(self, collections=None, docs=None, parents=None):
        self.collections = collections or {}
        self.docs = docs or {}
        self.parents = parents or {}
        self.written = {}

    def collection(self, name):
        return FakeCollection(self, name)


def _healthy_db():
    return FakeDb(
        collections={
            "assets": ["ES0000000001", "LU0000000002"],
            "_archived_assets": ["EODHD_OLD"],
            "commercial_retro": ["ES0000000001"],
            "uid1/portfolios": ["p1", "p2"],
        },
        docs={
            "meta/search_index": {"entries": [
                {"id": "ES0000000001"}, {"id": "LU0000000002"}]},
            "meta/price_refresh": {"last_run": "2026-07-11T05:30:00Z"},
            "meta/metrics_refresh": {"last_run": "2026-07-11T06:00:00Z",
                                     "cycle_completed": True,
                                     "stopped_by_budget": False},
            "meta/backup_status": {"completed_at": "2026-07-11T07:00:00Z"},
        },
        parents={"bdb_activos": ["uid1"]},
    )


def test_todo_consistente_da_ok():
    result = integrity_check.run_integrity_check(db=_healthy_db(), now=NOW)
    assert result["status"] == "OK"
    assert result["problems"] == []
    assert result["counts"]["assets_total"] == 2
    assert result["counts"]["portfolios"] == 2
    assert result["freshness"] == {
        "price_refresh": "OK", "metrics_refresh": "OK", "backup": "OK"}


def test_detecta_indice_incompleto_solapamiento_y_retro_huerfana():
    db = _healthy_db()
    db.docs["meta/search_index"] = {"entries": [{"id": "ES0000000001"}]}
    db.collections["_archived_assets"] = ["LU0000000002"]  # tambien vivo
    db.collections["commercial_retro"] = ["FR0000000003"]  # sin activo
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    checks = {p["check"] for p in result["problems"]}
    assert {"search_index_missing", "archived_overlap",
            "commercial_retro_orphans"} <= checks
    assert result["status"] == "WARN"
    assert result["counts"]["search_index_missing"] == 1
    assert result["counts"]["archived_overlap"] == 1


def test_retrocesion_archivada_no_es_huerfana_en_ninguna_coleccion():
    db = _healthy_db()
    db.collections["_archived"] = ["FR0000000003", "EODHD_OLD"]
    db.collections["commercial_retro"] += ["FR0000000003", "EODHD_OLD"]
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    assert result["status"] == "OK"
    assert not any(p["check"] == "commercial_retro_orphans" for p in result["problems"])


def test_detecta_activo_vivo_en_archivo_alternativo():
    db = _healthy_db()
    db.collections["_archived"] = ["ES0000000001"]
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    assert result["counts"]["archived_overlap"] == 1
    assert result["status"] == "WARN"


def test_precios_viejos_dan_fail():
    db = _healthy_db()
    db.docs["meta/price_refresh"] = {"last_run": "2026-07-05T05:30:00Z"}  # 6 dias
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    assert result["status"] == "FAIL"
    assert result["freshness"]["price_refresh"] == "FAIL"


def test_backup_sin_marcador_da_warn_unknown():
    db = _healthy_db()
    del db.docs["meta/backup_status"]
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    assert result["freshness"]["backup"] == "UNKNOWN"
    assert result["status"] == "WARN"


def test_write_publica_semaforo_con_gates(monkeypatch):
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    monkeypatch.setattr(
        admin_panel,
        "build_admin_inventory",
        lambda db, today, source_versions=None: {
            "schema_version": "admin-asset-inventory.v1",
            "generated_at": "2026-07-11T09:00:00+00:00",
            "count": 2,
            "rows": [],
            "source_versions": source_versions or {},
        },
    )
    db = _healthy_db()
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)
    assert result["applied"] is True
    assert "meta/admin_asset_inventory" in db.written
    assert result["counts"]["admin_inventory_rows"] == 2
    assert result["counts"]["admin_inventory_rebuilt"] == 1
    # Contrato del cliente (systemStatusBackend.ts): todo counts.* debe ser un
    # entero no negativo — un booleano rompia la pagina /sistema en produccion.
    for key, value in result["counts"].items():
        assert isinstance(value, int) and not isinstance(value, bool), key
        assert value >= 0, key
    assert "meta/integrity_status" in db.written
    assert db.written["meta/integrity_status"]["status"] == "OK"


def test_write_reuses_inventory_when_source_versions_are_unchanged(monkeypatch):
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    db = _healthy_db()
    db.docs["meta/search_index"]["updated_at"] = "assets-v1"
    db.docs["meta/price_refresh"]["data_changed_at"] = "prices-v1"
    db.docs["meta/metrics_refresh"]["data_changed_at"] = "metrics-v1"
    versions = {"assets": "assets-v1", "prices": "prices-v1", "metrics": "metrics-v1"}
    db.docs["meta/admin_asset_inventory"] = {
        "schema_version": "admin-asset-inventory.v1",
        "builder_version": admin_panel.ADMIN_INVENTORY_BUILDER_VERSION,
        "count": 2, "rows": [], "source_versions": versions,
    }
    monkeypatch.setattr(
        admin_panel, "build_admin_inventory",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no debe reconstruirse")),
    )

    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)

    assert result["counts"]["admin_inventory_rebuilt"] == 0
    assert "meta/admin_asset_inventory" not in db.written


def _inventory_doc(count=2, generated_at=None, versions=None, builder=None):
    return {
        "schema_version": "admin-asset-inventory.v1", "count": count,
        "builder_version": builder or admin_panel.ADMIN_INVENTORY_BUILDER_VERSION,
        "generated_at": generated_at or "2026-07-11T08:00:00+00:00",
        "rows": [], "source_versions": versions or {},
    }


def _with_versions(db, suffix):
    db.docs["meta/search_index"]["updated_at"] = f"assets-{suffix}"
    db.docs["meta/price_refresh"]["data_changed_at"] = f"prices-{suffix}"
    db.docs["meta/metrics_refresh"]["data_changed_at"] = f"metrics-{suffix}"
    return {"assets": f"assets-{suffix}", "prices": f"prices-{suffix}",
            "metrics": f"metrics-{suffix}"}


def test_write_no_rebuild_si_censo_igual_e_inventario_fresco(monkeypatch):
    # S4: las fuentes cambian a DIARIO (precios/métricas); antes eso bastaba
    # para reconstruir (~12k lecturas/día). Ahora, con el censo igual y el
    # snapshot dentro de INVENTORY_MAX_AGE_DAYS, se reutiliza.
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    db = _healthy_db()
    _with_versions(db, "v2")  # fuentes nuevas...
    db.docs["meta/admin_asset_inventory"] = _inventory_doc(
        count=2, generated_at="2026-07-10T09:00:00+00:00",  # ...pero snapshot de ayer
        versions={"assets": "assets-v1", "prices": "prices-v1", "metrics": "metrics-v1"})
    monkeypatch.setattr(
        admin_panel, "build_admin_inventory",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no debe reconstruirse")),
    )

    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)

    assert result["counts"]["admin_inventory_rebuilt"] == 0
    assert "meta/admin_asset_inventory" not in db.written


def test_write_rebuild_si_inventario_viejo_o_censo_cambia(monkeypatch):
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    built = []
    monkeypatch.setattr(
        admin_panel, "build_admin_inventory",
        lambda db, today, source_versions=None: built.append(1) or {
            "schema_version": "admin-asset-inventory.v1",
            "generated_at": "2026-07-11T09:00:00+00:00", "count": 2,
            "rows": [], "source_versions": source_versions or {}},
    )

    # Caso A: fuentes nuevas + snapshot de hace 8 días (> tope 7) → rebuild.
    db = _healthy_db()
    _with_versions(db, "v2")
    db.docs["meta/admin_asset_inventory"] = _inventory_doc(
        count=2, generated_at="2026-07-03T09:00:00+00:00",
        versions={"assets": "assets-v1", "prices": "prices-v1", "metrics": "metrics-v1"})
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)
    assert result["counts"]["admin_inventory_rebuilt"] == 1

    # Caso B: censo distinto (count 3 vs 2 activos) → rebuild aunque sea fresco.
    db = _healthy_db()
    versions = _with_versions(db, "v1")
    db.docs["meta/admin_asset_inventory"] = _inventory_doc(
        count=3, generated_at="2026-07-11T08:30:00+00:00", versions=versions)
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)
    assert result["counts"]["admin_inventory_rebuilt"] == 1

    # Caso C: inventario de un builder ANTERIOR (p.ej. generado antes de un
    # deploy que cambió las filas) → rebuild inmediato aunque sea fresco.
    db = _healthy_db()
    versions = _with_versions(db, "v1")
    db.docs["meta/admin_asset_inventory"] = _inventory_doc(
        count=2, generated_at="2026-07-11T08:30:00+00:00", versions=versions,
        builder=1)
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)
    assert result["counts"]["admin_inventory_rebuilt"] == 1
    assert len(built) == 3


def test_write_inventario_truncado_da_warn(monkeypatch):
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    monkeypatch.setattr(
        admin_panel, "build_admin_inventory",
        lambda db, today, source_versions=None: {
            "schema_version": "admin-asset-inventory.v1",
            "generated_at": "2026-07-11T09:00:00+00:00", "count": 2,
            "rows": [], "source_versions": source_versions or {}, "truncated": True},
    )
    db = _healthy_db()
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)

    assert result["status"] == "WARN"
    checks = {p["check"] for p in result["problems"]}
    assert "admin_inventory_truncated" in checks
    assert db.written["meta/integrity_status"]["status"] == "WARN"


def test_write_sin_gate_de_integridad_falla(monkeypatch):
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.delenv("INTEGRITY_WRITE_ENABLED", raising=False)
    with pytest.raises(RuntimeError, match="INTEGRITY_WRITES_DISABLED"):
        integrity_check.run_integrity_check(write=True, db=FakeDb(), now=NOW)


# B-07 (auditoria 29-09): un fallo o timeout en el inventario de calidad de
# fondos dejaba meta/integrity_status sin publicar. Ahora es un WARN y el
# semaforo se publica igual.
def test_write_publica_semaforo_aunque_falle_el_inventario_de_calidad(monkeypatch):
    import fund_data_quality
    monkeypatch.setenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES",
                       "YES_I_UNDERSTAND_MASTER_DB_WRITES")
    monkeypatch.setenv("INTEGRITY_WRITE_ENABLED", "true")
    monkeypatch.setattr(
        admin_panel, "build_admin_inventory",
        lambda db, today, source_versions=None: {
            "schema_version": "admin-asset-inventory.v1",
            "generated_at": "2026-07-11T09:00:00+00:00",
            "count": 2, "rows": [], "source_versions": source_versions or {}},
    )

    def explota(db, now):
        raise TimeoutError("Deadline Exceeded leyendo price_series")

    monkeypatch.setattr(fund_data_quality, "refresh_inventory_if_due", explota)
    db = _healthy_db()
    result = integrity_check.run_integrity_check(write=True, db=db, now=NOW)
    assert "meta/integrity_status" in db.written
    assert result["status"] == "WARN"
    assert db.written["meta/integrity_status"]["status"] == "WARN"
    problema = [p for p in result["problems"] if p["check"] == "fund_quality_inventory"]
    assert len(problema) == 1 and problema[0]["severity"] == "WARN"
    assert "inventario de calidad no actualizado" in problema[0]["detail"]
    assert "Deadline Exceeded" in problema[0]["detail"]
    assert result["counts"]["fund_quality_rebuilt"] == 0
    for key, value in result["counts"].items():
        assert isinstance(value, int) and not isinstance(value, bool), key


def test_ciclo_de_metricas_intermedio_no_pone_el_semaforo_en_rojo():
    """Cuatro ejecuciones al dia (14-10-2026): una vuelta a medias es INFO."""
    db = _healthy_db()
    db.docs["meta/metrics_refresh"] = {"last_run": "2026-07-11T07:00:00Z", "cycle_completed": False,
                                       "stopped_by_budget": True, "scan_after_asset_id": "LU0000000002"}
    result = integrity_check.run_integrity_check(db=db, now=NOW)
    assert result["status"] == "OK"
    assert [p["severity"] for p in result["problems"]] == ["INFO"]
    assert result["freshness"]["metrics_refresh"] == "OK"
