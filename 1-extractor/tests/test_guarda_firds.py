# -*- coding: utf-8 -*-
"""La guarda del índice FIRDS en `update` (decisión 57, opción B, 09-11-2026).

Sin `cache/firds/firds.sqlite`, `esma_firds.fetch` devuelve {} y una ficha que ya tenía
identidad FIRDS se reescribiría sin ella en silencio. `update` se para antes de escribir
nada, salvo con `--sin-firds`; y si el índice está pero no trae un ISIN que la ficha sí
tenía, lo avisa por ficha. Todo sobre un proyecto falso en `tmp_path`, sin red y sin
pasar por el pipeline real.
"""
import json
import logging
import shutil
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import main  # noqa: E402
from fetchers import esma_firds  # noqa: E402

FIXT = RAIZ / "tests" / "fixtures" / "firds"
CON_FIRDS = "ES0000000001"     # está en el completo sintético
FUERA_DEL_INDICE = "LU0000000099"
ALTA = "LU0000000077"


def _ficha(base: Path, isin: str, visto: str | None) -> Path:
    ruta = base / "data" / "funds" / f"{isin}.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    datos = {"meta": {"isin": isin, **({"firds_visto": visto} if visto else {})},
             "identificacion": {"nombre": isin, "cfi": "ESVUFR" if visto else None}}
    ruta.write_text(json.dumps(datos), encoding="utf-8")
    return ruta


@pytest.fixture
def proyecto(tmp_path, monkeypatch):
    base = tmp_path / "proyecto"
    (base / "config").mkdir(parents=True)
    shutil.copy(RAIZ / "config" / "settings.json", base / "config" / "settings.json")
    (base / "config" / "fondos.csv").write_text(
        f"isin,nombre,tipo\n{CON_FIRDS},Banco,accion\n{FUERA_DEL_INDICE},Fondo,fondo\n"
        f"{ALTA},Alta,fondo\n", encoding="utf-8")
    monkeypatch.setattr(main, "BASE", base)
    llamadas: list[str] = []

    def pipeline_falso(isin, *a, **k):     # el pipeline real no se ejecuta aquí
        llamadas.append(isin)
        return {"campos": 0, "reason": "falso"}
    monkeypatch.setattr(main.update_pipeline, "ejecuta_pipeline", pipeline_falso)
    return base, llamadas


def _update(monkeypatch, *args) -> int:
    monkeypatch.setattr(sys, "argv", ["main.py", "update", *args])
    return main.main()


def _indice(base: Path) -> None:
    ruta = base / esma_firds.RUTA_INDICE
    ruta.parent.mkdir(parents=True)
    con = esma_firds.abre(ruta)
    esma_firds.aplica(con, esma_firds.recorre(str(FIXT / "FULINS_E_sintetico.xml")), "2026-10-31")
    esma_firds._pon_meta(con, "completo", "2026-10-31")
    con.commit()
    con.close()


def test_sin_indice_y_con_identidad_se_para_sin_escribir(proyecto, monkeypatch, caplog):
    base, llamadas = proyecto
    ruta = _ficha(base, CON_FIRDS, "2026-10-31")
    _ficha(base, ALTA, None)
    antes = ruta.read_bytes()
    with caplog.at_level(logging.ERROR, logger="fondosdb"):
        assert _update(monkeypatch, CON_FIRDS, ALTA) == 1
    assert llamadas == []                       # ni una ficha pasa por el pipeline
    assert ruta.read_bytes() == antes
    assert not (base / "data" / "index.json").exists()
    texto = caplog.text
    assert "1 de 2 fichas" in texto and "python main.py firds" in texto
    assert "--sin-firds" in texto


def test_sin_indice_con_la_bandera_sigue(proyecto, monkeypatch, caplog):
    base, llamadas = proyecto
    _ficha(base, CON_FIRDS, "2026-10-31")
    with caplog.at_level(logging.WARNING, logger="fondosdb"):
        assert _update(monkeypatch, CON_FIRDS, "--sin-firds") == 0
    assert llamadas == [CON_FIRDS]
    assert "perderían la identidad FIRDS" in caplog.text   # sigue, pero no se calla


def test_sin_indice_un_alta_nueva_no_se_para(proyecto, monkeypatch):
    base, llamadas = proyecto
    _ficha(base, ALTA, None)                    # ficha guardada sin identidad FIRDS
    assert _update(monkeypatch, ALTA, FUERA_DEL_INDICE) == 0   # el segundo ni tiene ficha
    assert llamadas == [ALTA, FUERA_DEL_INDICE]


def test_con_indice_avisa_de_la_ficha_que_el_indice_ya_no_trae(proyecto, monkeypatch, caplog):
    base, llamadas = proyecto
    _indice(base)
    _ficha(base, CON_FIRDS, "2026-10-31")
    _ficha(base, FUERA_DEL_INDICE, "2026-10-31")
    with caplog.at_level(logging.WARNING, logger="fondosdb"):
        assert _update(monkeypatch, CON_FIRDS, FUERA_DEL_INDICE) == 0
    assert llamadas == [CON_FIRDS, FUERA_DEL_INDICE]          # avisa, no retiene ni para
    avisos = [r.getMessage() for r in caplog.records if "el índice ya no lo trae" in r.getMessage()]
    assert len(avisos) == 1 and avisos[0].startswith(FUERA_DEL_INDICE)


@pytest.mark.parametrize("estado", ["vacio", "sin_completo"])
def test_un_indice_que_no_sirve_se_trata_como_ausente(proyecto, monkeypatch, caplog, estado):
    base, llamadas = proyecto
    ruta_i = base / esma_firds.RUTA_INDICE
    ruta_i.parent.mkdir(parents=True)
    if estado == "vacio":
        ruta_i.write_bytes(b"")
    else:                                       # tablas y datos, pero a medio construir
        con = esma_firds.abre(ruta_i)
        esma_firds.aplica(con, esma_firds.recorre(str(FIXT / "FULINS_E_sintetico.xml")),
                          "2026-10-31")
        con.commit()
        con.close()
    ruta = _ficha(base, CON_FIRDS, "2026-10-31")
    antes = ruta.read_bytes()
    with caplog.at_level(logging.WARNING, logger="fondosdb"):
        assert _update(monkeypatch, CON_FIRDS) == 1
        assert llamadas == [] and ruta.read_bytes() == antes
        assert "existe pero no sirve" in caplog.text
        assert "python main.py firds --force" in caplog.text
        assert _update(monkeypatch, CON_FIRDS, "--sin-firds") == 0
    assert llamadas == [CON_FIRDS]
