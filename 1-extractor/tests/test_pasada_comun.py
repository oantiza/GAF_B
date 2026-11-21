# -*- coding: utf-8 -*-
"""Lo que comparten las tres entradas de una pasada (auditoría del 16-11-2026, EXT-6 y EXT-7).

`main.py update`, el servicio de operaciones (`ops.extrae`) y la aplicación local
(`app.trabajo_update`) llaman al mismo pipeline. La guarda del índice FIRDS solo vivía en la
primera, y en ninguna de las tres una ficha que fallaba dejaba seguir a las demás. Todo sobre un
proyecto falso en `tmp_path`, sin red y sin pasar por el pipeline real.
"""
import json
import logging
import shutil
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import app  # noqa: E402
import main  # noqa: E402
from core import ops, pasada  # noqa: E402

CON_FIRDS = "ES0000000001"
OTRA = "LU0000000077"
ROTA = "LU0000000088"


def _ficha(base: Path, isin: str, visto: str | None) -> Path:
    ruta = base / "data" / "funds" / f"{isin}.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({"meta": {"isin": isin, **({"firds_visto": visto} if visto else {})},
                                "identificacion": {"nombre": isin}}), encoding="utf-8")
    return ruta


@pytest.fixture
def proyecto(tmp_path, monkeypatch):
    base = tmp_path / "proyecto"
    (base / "config").mkdir(parents=True)
    shutil.copy(RAIZ / "config" / "settings.json", base / "config" / "settings.json")
    (base / "config" / "fondos.csv").write_text(
        f"isin,nombre,tipo\n{CON_FIRDS},Banco,accion\n{OTRA},Fondo,fondo\n{ROTA},Roto,fondo\n", encoding="utf-8")
    monkeypatch.setattr(main, "BASE", base)
    monkeypatch.setattr(app, "BASE", base)
    llamadas: list[str] = []

    def pipeline_falso(isin, *a, **k):
        llamadas.append(isin)
        if isin == ROTA:
            raise KeyError("riesgo")              # un fallo que no es de una fuente
        return {"campos": 0, "reason": "falso"}
    monkeypatch.setattr(main.update_pipeline, "ejecuta_pipeline", pipeline_falso)
    return base, llamadas


def _update(monkeypatch, *args) -> int:
    monkeypatch.setattr(sys, "argv", ["main.py", "update", *args])
    return main.main()


# ------------------------------------------------------------------ EXT-7
def test_en_la_consola_una_ficha_que_falla_no_corta_la_pasada_y_la_salida_lo_dice(proyecto, monkeypatch, capsys, caplog):
    base, llamadas = proyecto
    with caplog.at_level(logging.ERROR, logger="fondosdb"):
        assert _update(monkeypatch, OTRA, ROTA, CON_FIRDS) == 1      # distinto de cero: algo falló
    assert llamadas == [OTRA, ROTA, CON_FIRDS]                       # la que va detrás de la rota se hace
    assert (base / "data" / "index.json").exists()                   # y el índice se regenera
    salida = capsys.readouterr().out
    assert "1 ficha ha fallado y no se ha reescrito, de 3 pedidas. Las demás sí:" in salida
    assert f"   {ROTA}  KeyError: 'riesgo'" in salida
    assert "Traceback" in caplog.text and ROTA in caplog.text


def test_sin_fallos_la_salida_es_cero_y_no_se_dice_nada(proyecto, monkeypatch, capsys):
    _base, llamadas = proyecto
    assert _update(monkeypatch, OTRA, CON_FIRDS) == 0
    assert llamadas == [OTRA, CON_FIRDS] and "fallado" not in capsys.readouterr().out


def test_en_el_servicio_de_operaciones_tambien_sigue(proyecto):
    base, llamadas = proyecto
    lineas: list[str] = []
    ops.extrae(base, [OTRA, ROTA, CON_FIRDS], log_cb=lineas.append)
    assert llamadas == [OTRA, ROTA, CON_FIRDS]
    assert "   ERROR: la ficha ha fallado y no se reescribe: KeyError: 'riesgo'" in lineas
    assert "1 ficha ha fallado y no se ha reescrito, de 3 pedidas. Las demás sí:" in lineas
    assert lineas.index("Índice regenerado.") < lineas.index(f"   {ROTA}  KeyError: 'riesgo'")


def test_en_la_aplicacion_local_tambien_sigue(proyecto):
    _base, llamadas = proyecto
    app.LOG.clear()
    app.trabajo_update([OTRA, ROTA, CON_FIRDS], False)
    assert llamadas == [OTRA, ROTA, CON_FIRDS]
    assert any("la ficha ha fallado y no se reescribe: KeyError: 'riesgo'" in linea for linea in app.LOG)
    assert any("1 ficha ha fallado" in linea for linea in app.LOG)


def test_el_fallo_se_escribe_sin_claves():
    error = ConnectionError("Max retries exceeded with url: /api/eod/X?api_token=clave-inventada-123&fmt=json")
    assert pasada.describe_fallo(error) == "ConnectionError: Max retries exceeded with url: /api/eod/X?api_token=***&fmt=json"
    assert pasada.resumen_de_fallos([], 5) == []
    assert pasada.resumen_de_fallos([("A", "x"), ("B", "y")], 9)[0] == "2 fichas han fallado y no se han reescrito, de 9 pedidas. Las demás sí:"


# ------------------------------------------------------------------ EXT-6
def test_sin_indice_firds_el_servicio_de_operaciones_no_escribe_ninguna(proyecto):
    base, llamadas = proyecto
    ruta = _ficha(base, CON_FIRDS, "2026-10-31")
    antes = ruta.read_bytes()
    with pytest.raises(ValueError, match=r"falta el índice FIRDS .*: 1 de 2 fichas pedidas perderían la identidad FIRDS") as error:
        ops.extrae(base, [CON_FIRDS, OTRA])
    assert "python main.py firds" in str(error.value) and "--sin-firds" in str(error.value)
    assert llamadas == [] and ruta.read_bytes() == antes


def test_sin_indice_firds_la_aplicacion_local_no_escribe_ninguna(proyecto):
    base, llamadas = proyecto
    _ficha(base, CON_FIRDS, "2026-10-31")
    app.LOG.clear()
    app.trabajo_update([CON_FIRDS, OTRA], False)
    assert llamadas == []
    assert any(linea.startswith("PARADO: falta el índice FIRDS") and "No se escribe ninguna." in linea for linea in app.LOG)
    assert not (base / "data" / "index.json").exists()


def test_sin_fichas_con_identidad_la_falta_del_indice_no_para_a_nadie(proyecto):
    base, llamadas = proyecto
    _ficha(base, OTRA, None)                      # una ficha sin identidad FIRDS no pierde nada
    ops.extrae(base, [OTRA])
    app.trabajo_update([OTRA], False)
    assert llamadas == [OTRA, OTRA]
    guarda = pasada.guarda_firds(base, [OTRA, CON_FIRDS])
    assert guarda.bloquea is False and guarda.con_firds == () and guarda.desaparecidos == ()
