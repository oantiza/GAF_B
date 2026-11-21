import json

from tools.backfill_asset_types import backfill_types, load_types


def test_backfill_types_is_dry_run_by_default_and_writes_when_requested(tmp_path):
    funds = tmp_path / "funds"
    funds.mkdir()
    path = funds / "ES0000000000.json"
    path.write_text(json.dumps({
        "meta": {"isin": "ES0000000000"},
        "identificacion": {"nombre": "Activo"},
    }), encoding="utf-8")

    dry = backfill_types(funds, {"ES0000000000": "fondo"})
    assert dry["changed"] == ["ES0000000000"]
    assert "tipo" not in json.loads(path.read_text(encoding="utf-8"))["identificacion"]

    written = backfill_types(funds, {"ES0000000000": "fondo"}, write=True)
    assert written["mode"] == "WRITE"
    assert json.loads(path.read_text(encoding="utf-8"))["identificacion"]["tipo"] == "fondo"


def test_load_types_normalizes_catalog(tmp_path):
    path = tmp_path / "fondos.csv"
    path.write_text("isin,nombre,tipo\nes0000000000,Uno,ETF\n", encoding="utf-8")
    assert load_types(path) == {"ES0000000000": "etf"}
