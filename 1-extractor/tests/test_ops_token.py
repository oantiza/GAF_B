# -*- coding: utf-8 -*-
"""El token del servicio `ops` es obligatorio (decisión de Óscar, 17-10, 6.7b).

Sin `ops_token` en settings.json, el servicio usa o crea `config/ops_token.txt`
(fuera de git) y toda petición, salvo el preflight OPTIONS, tiene que traerlo
en `X-Ops-Token`. `python main.py ops-token` lo imprime en una sola línea para
que la app lo pase como `VITE_BDB_OPS_TOKEN` a su servidor de desarrollo.
"""
import json
import re
import subprocess
import sys
import textwrap
import threading
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import ops_server  # noqa: E402
from core import ops  # noqa: E402
from tests.test_ops import _base, _pide  # noqa: E402


def _token_en_disco(base: Path) -> str:
    return (base / "config" / "ops_token.txt").read_text(encoding="utf-8").strip()


@pytest.fixture
def servidor(tmp_path):
    base = _base(tmp_path)                     # settings.json sin ops_token
    srv = ops_server.crea_servidor(base, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    srv.shutdown()
    srv.server_close()


def test_sin_ops_token_en_settings_se_crea_uno_y_se_exige(servidor):
    base = servidor.servicio.base
    token = _token_en_disco(base)
    assert servidor.servicio.token == token and re.fullmatch(r"[A-Za-z0-9_\-]{40,}", token)
    assert b"\r" not in (base / "config" / "ops_token.txt").read_bytes()
    peticiones = [("GET", "/api/ops/estado", None), ("GET", "/api/ops/universo", None),
                  ("GET", "/api/ops/tareas", None),
                  ("POST", "/api/ops/reclasificar", {"isin": "LU0000000001", "tipo": "etf"}),
                  ("DELETE", "/api/ops/correcciones/LU0000000001/riesgo.sri_kid_1a7", None)]
    for metodo, ruta, cuerpo in peticiones:
        estado, _c, datos = _pide(servidor, metodo, ruta, cuerpo, token=False)
        assert estado == 401 and "X-Ops-Token" in datos["error"], ruta
        assert token not in json.dumps(datos)                      # el error no lo revela
        estado, _c, _d = _pide(servidor, metodo, ruta, cuerpo, cabeceras={"X-Ops-Token": token[:-1] + "x"})
        assert estado == 401, ruta
    assert [f["tipo"] for f in ops.carga_fondos(base)] == ["fondo"]  # nada se ha tocado
    assert _pide(servidor, "GET", "/api/ops/estado")[0] == 200
    assert _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "LU0000000001", "tipo": "etf"})[0] == 200


def test_el_preflight_no_necesita_token(servidor):
    estado, cab, _ = _pide(servidor, "OPTIONS", "/api/ops/alta", token=False)
    assert estado == 204 and "X-Ops-Token" in cab["Access-Control-Allow-Headers"]


def test_el_token_se_genera_una_sola_vez(tmp_path):
    base = _base(tmp_path)
    primero = ops.token_ops(base)
    assert ops.token_ops(base) == primero == _token_en_disco(base)
    assert ops_server.Servicio(base).token == primero
    # un fichero vacío o estropeado se regenera; uno bueno nunca se pisa
    (base / "config" / "ops_token.txt").write_text("", encoding="utf-8")
    nuevo = ops.token_ops(base)
    assert nuevo != primero and ops.token_ops(base) == nuevo
    # con ops_token en settings.json manda ese y no se crea fichero
    otra = _base(tmp_path / "otra")
    explicito = "x" * 32
    assert ops.token_ops(otra, {"ops_token": explicito}) == explicito
    assert not (otra / "config" / "ops_token.txt").exists()


GENERA = """
    from pathlib import Path
    from core import ops
    print(ops.token_ops(Path(sys.argv[1])))
"""


def test_dos_procesos_a_la_vez_obtienen_el_mismo_token(tmp_path):
    base = _base(tmp_path)
    preambulo = f"import sys; sys.path.insert(0, {str(RAIZ)!r})\n"
    procesos = [subprocess.Popen([sys.executable, "-c", preambulo + textwrap.dedent(GENERA), str(base)],
                                 cwd=str(RAIZ), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                for _ in range(4)]
    salidas = [p.communicate(timeout=60) for p in procesos]
    assert all(p.returncode == 0 for p in procesos), [e for _o, e in salidas]
    assert {o.strip() for o, _e in salidas} == {_token_en_disco(base)}


def test_main_ops_token_imprime_solo_el_token(tmp_path):
    # La orden real (argparse y registro incluidos) sobre una base de prueba.
    base = _base(tmp_path)
    codigo = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(RAIZ)!r})
        from pathlib import Path
        import main
        main.BASE = Path({str(base)!r})
        sys.argv = ["main.py", "ops-token"]
        raise SystemExit(main.main())
    """)
    for _ in range(2):                                         # la segunda vez, el mismo
        r = subprocess.run([sys.executable, "-c", codigo], cwd=str(RAIZ), capture_output=True, text=True,
                           timeout=60)
        assert r.returncode == 0, r.stderr
        assert r.stdout.splitlines() == [_token_en_disco(base)]


# --- Sexta pasada: MEN-2, MEN-3 y MEN-4 -------------------------------------------

def _con_ops_token(base: Path, token: str) -> Path:
    cfg = json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))
    cfg["ops_token"] = token
    (base / "config" / "settings.json").write_text(json.dumps(cfg), encoding="utf-8")
    return base


def test_un_ops_token_corto_en_settings_no_deja_arrancar_y_lo_dice(tmp_path, monkeypatch, capsys):
    # MEN-2: se aceptaba cualquier longitud (la sonda probó con 14 caracteres).
    base = _con_ops_token(_base(tmp_path), "x" * 31)
    with pytest.raises(ops.TokenOpsInvalido, match="al menos 32"):
        ops.token_ops(base, ops.carga_settings(base))
    monkeypatch.setattr(ops_server, "BASE", base)
    assert ops_server.main(["--puerto", "0"]) == 1
    err = capsys.readouterr().err
    assert err.startswith("No se puede arrancar el servicio de operaciones:") and "al menos 32" in err
    assert "Traceback" not in err


def test_un_ops_token_en_settings_se_avisa_porque_acaba_en_git(tmp_path):
    base = _con_ops_token(_base(tmp_path), "x" * 40)
    lineas = ops_server.Servicio(base).mensajes_arranque(8766)
    assert "Token: el ops_token de config/settings.json" in lineas
    assert any(linea.startswith("AVISO:") and "está en git" in linea for linea in lineas)
    otra = _base(tmp_path / "otra")
    lineas = ops_server.Servicio(otra).mensajes_arranque(8766)
    assert any(linea.startswith("Token: config/ops_token.txt") for linea in lineas)
    assert not any(linea.startswith("AVISO:") for linea in lineas)


def test_ops_token_con_el_token_en_settings_avisa_por_stderr(tmp_path):
    base = _con_ops_token(_base(tmp_path), "y" * 40)
    codigo = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(RAIZ)!r})
        from pathlib import Path
        import main
        main.BASE = Path({str(base)!r})
        sys.argv = ["main.py", "ops-token"]
        raise SystemExit(main.main())
    """)
    r = subprocess.run([sys.executable, "-c", codigo], cwd=str(RAIZ), capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and r.stdout.splitlines() == ["y" * 40]
    assert "está en git" in r.stderr


def test_el_servicio_usa_el_token_vigente_sin_reiniciarlo(servidor):
    # MEN-4: se leía una sola vez al arrancar.
    base = servidor.servicio.base
    viejo = servidor.servicio.token
    nuevo = "n" * 43
    (base / "config" / "ops_token.txt").write_text(nuevo + "\n", encoding="utf-8")
    estado, _c, datos = _pide(servidor, "GET", "/api/ops/estado", cabeceras={"X-Ops-Token": viejo})
    assert estado == 401 and "iniciar-dev.bat" in datos["error"]
    assert _pide(servidor, "GET", "/api/ops/estado", cabeceras={"X-Ops-Token": nuevo})[0] == 200
    # si se borra, se regenera y el anterior deja de valer
    (base / "config" / "ops_token.txt").unlink()
    assert _pide(servidor, "GET", "/api/ops/estado", cabeceras={"X-Ops-Token": nuevo})[0] == 401
    assert _pide(servidor, "GET", "/api/ops/estado")[0] == 200 and servidor.servicio.token != nuevo


def test_si_config_no_se_puede_escribir_el_servicio_no_arranca_con_un_mensaje(tmp_path, monkeypatch, capsys):
    base = tmp_path / "base"
    base.mkdir()
    (base / "config").write_text("no es una carpeta", encoding="utf-8")
    monkeypatch.setattr(ops_server, "BASE", base)
    assert ops_server.main(["--puerto", "0"]) == 1
    err = capsys.readouterr().err
    assert err.startswith("No se puede arrancar el servicio de operaciones:") and "Traceback" not in err


def test_el_temporal_del_token_no_entra_en_git():
    # MEN-3: atomic_write_text crea config/.ops_token.txt.<hex>.tmp.
    r = subprocess.run(["git", "check-ignore", "-q", "config/.ops_token.txt.0123abcd.tmp"], cwd=str(RAIZ),
                       capture_output=True, text=True)
    if r.returncode == 128:
        pytest.skip("no es un repositorio de git (exportación)")
    assert r.returncode == 0
