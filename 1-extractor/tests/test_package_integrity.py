import hashlib
import json
from pathlib import Path

from core import adaptador_bdb, exporta
from core.package_integrity import atomic_write_text
from core.store import Store


def _seed_asset(base: Path) -> str:
    isin = "ES0000000000"
    funds = base / "data" / "funds"
    funds.mkdir(parents=True)
    (funds / f"{isin}.json").write_text(json.dumps({
        "meta": {"isin": isin, "actualizado": "2026-07-12T10:00:00+00:00"},
        "identificacion": {
            "isin": isin,
            "tipo": "accion",
            "nombre": "Activo de prueba",
            "ticker": "TEST",
            "mercado": "MC",
            "divisa_base": "EUR",
        },
        "calidad": {"bucket": "COMPLETO", "flags": []},
    }), encoding="utf-8")
    return isin


def test_export_and_canonical_share_snapshot_id_and_hashes(tmp_path):
    isin = _seed_asset(tmp_path)

    export_result = exporta.export_all(tmp_path, tmp_path / "export")
    canonical_result = adaptador_bdb.genera(tmp_path)

    assert export_result["package_id"] == canonical_result["package_id"]
    manifest = json.loads((tmp_path / "export" / "manifest.json").read_text(encoding="utf-8"))
    summary = json.loads((tmp_path / "export_bdb" / "_resumen.json").read_text(encoding="utf-8"))
    assert manifest["esquema_version"] == 3
    assert manifest["package_id"] == summary["package_id"]
    assert summary["errores"] == 0

    canonical_path = tmp_path / "export_bdb" / f"{isin}.json"
    assert summary["files"][canonical_path.name]["sha256"] == hashlib.sha256(canonical_path.read_bytes()).hexdigest()
    for name, metadata in manifest["files"].items():
        file_path = tmp_path / "export" / name
        assert metadata["bytes"] == file_path.stat().st_size
        assert metadata["sha256"] == hashlib.sha256(file_path.read_bytes()).hexdigest()


def test_atomic_writes_leave_complete_json_documents(tmp_path):
    target = tmp_path / "state.json"
    atomic_write_text(target, '{"version": 1}')
    atomic_write_text(target, '{"version": 2}')
    assert json.loads(target.read_text(encoding="utf-8")) == {"version": 2}
    assert list(tmp_path.glob("*.tmp")) == []

    store = Store(tmp_path)
    store.escribe_fondo("ES0000000000", {"meta": {"isin": "ES0000000000"}})
    assert json.loads((tmp_path / "data" / "funds" / "ES0000000000.json").read_text(encoding="utf-8"))["meta"]["isin"] == "ES0000000000"
