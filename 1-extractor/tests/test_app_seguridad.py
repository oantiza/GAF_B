# -*- coding: utf-8 -*-
"""La interfaz web local (`app.py`) y el visor estático no se dejan usar desde
otra web (auditoría 16-10, CRIT-07).

- `app.py` solo escucha en 127.0.0.1, pero cualquier página abierta en el
  navegador podía mandarle un POST «simple» (`text/plain`, sin preflight) y
  quitar fondos o lanzar trabajos; con DNS rebinding, leer su API.
- Nombres, claves y valores raspados entraban sin escapar en `innerHTML`, y en
  el visor un `</script>` dentro de los datos cerraba el bloque de script.

Sin red: el servidor corre en un hilo sobre una base de prueba en `tmp_path`.
Las pruebas de escape ejecutan el JavaScript real de las plantillas con Node
(con un DOM mínimo de mentira); si no hay Node, se saltan.
"""
import http.client
import json
import re
import shutil
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import app  # noqa: E402
import main  # noqa: E402
from core import visor  # noqa: E402

MALICIOSO = '<img src=x onerror="alert(1)">'
FONDOS_CSV = "isin,nombre,tipo\nLU0000000001,Fondo Uno,fondo\n"


@pytest.fixture
def base_app(tmp_path, monkeypatch):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "fondos.csv").write_text(FONDOS_CSV, encoding="utf-8", newline="\n")
    (tmp_path / "config" / "settings.json").write_text(json.dumps({
        "prioridad_fuentes": ["cnmv"], "rate_limit_segundos": 0}), encoding="utf-8")
    (tmp_path / "data" / "funds").mkdir(parents=True)
    monkeypatch.setattr(app, "BASE", tmp_path)
    monkeypatch.setattr(main, "BASE", tmp_path)
    return tmp_path


@pytest.fixture
def servidor(base_app):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Manejador)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    srv.shutdown()
    srv.server_close()


def _propio(srv, host="127.0.0.1"):
    return f"http://{host}:{srv.server_address[1]}"


def _pide(srv, metodo, ruta, cuerpo=None, *, tipo="application/json", origen=None, host=None):
    con = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    cabeceras = {}
    if cuerpo is not None:
        cabeceras["Content-Type"] = tipo
    if origen:
        cabeceras["Origin"] = origen
    if host:
        cabeceras["Host"] = host
    con.request(metodo, ruta, body=json.dumps(cuerpo) if cuerpo is not None else None, headers=cabeceras)
    r = con.getresponse()
    datos = r.read()
    con.close()
    return r.status, (json.loads(datos) if datos and r.getheader("Content-Type", "").startswith("application/json") else datos)


def _fondos_csv(base):
    return (base / "config" / "fondos.csv").read_text(encoding="utf-8")


def test_un_post_de_otra_web_en_text_plain_se_rechaza_sin_tocar_nada(servidor, base_app):
    estado, datos = _pide(servidor, "POST", "/api/quitar", {"isin": "LU0000000001"},
                          tipo="text/plain", origen="http://evil.example")
    assert estado == 403 and datos["ok"] is False
    assert _fondos_csv(base_app) == FONDOS_CSV


def test_un_post_de_otro_origen_se_rechaza_aunque_sea_json(servidor, base_app):
    estado, datos = _pide(servidor, "POST", "/api/quitar", {"isin": "LU0000000001"},
                          origen="http://evil.example")
    assert estado == 403 and "origen" in datos["error"]
    estado, _ = _pide(servidor, "POST", "/api/quitar", {"isin": "LU0000000001"}, origen="null")
    assert estado == 403
    assert _fondos_csv(base_app) == FONDOS_CSV


def test_un_post_sin_json_se_rechaza_aunque_venga_del_propio_origen(servidor, base_app):
    estado, datos = _pide(servidor, "POST", "/api/quitar", {"isin": "LU0000000001"},
                          tipo="text/plain", origen=_propio(servidor))
    assert estado == 403 and "application/json" in datos["error"]
    assert _fondos_csv(base_app) == FONDOS_CSV


def test_un_host_ajeno_se_rechaza(servidor, base_app):
    puerto = servidor.server_address[1]
    estado, datos = _pide(servidor, "GET", "/api/fondos", host=f"rebind.evil.example:{puerto}")
    assert estado == 403 and "Host" in datos["error"]
    assert _pide(servidor, "GET", "/", host=f"rebind.evil.example:{puerto}")[0] == 403
    assert _pide(servidor, "GET", "/api/fondos", host="127.0.0.1:1")[0] == 403
    estado, _ = _pide(servidor, "POST", "/api/quitar", {"isin": "LU0000000001"},
                      host=f"rebind.evil.example:{puerto}", origen=f"http://rebind.evil.example:{puerto}")
    assert estado == 403
    assert _fondos_csv(base_app) == FONDOS_CSV


def test_el_propio_equipo_se_atiende(servidor):
    estado, datos = _pide(servidor, "GET", "/api/fondos")
    assert estado == 200 and [f["isin"] for f in datos] == ["LU0000000001"]
    puerto = servidor.server_address[1]
    estado, _ = _pide(servidor, "GET", "/api/fondos", host=f"localhost:{puerto}")
    assert estado == 200
    # un ISIN no válido no sale a la red: basta para ver que el POST se atiende
    estado, datos = _pide(servidor, "POST", "/api/add", {"isin": "MALO"},
                          tipo="application/json; charset=utf-8", origen=_propio(servidor, "localhost"))
    assert estado == 200 and datos["ok"] is False and "ISIN no valido" in datos["error"]
    estado, datos = _pide(servidor, "GET", "/")
    assert estado == 200 and b"FondosDB" in datos


def test_un_cuerpo_que_no_es_un_objeto_no_tumba_la_peticion(servidor):
    estado, datos = _pide(servidor, "POST", "/api/add", ["LU0000000001"], origen=_propio(servidor))
    assert estado == 200 and datos["ok"] is False


# --------------------------------------------------- escape en el navegador
NODE = shutil.which("node")
requiere_node = pytest.mark.skipif(NODE is None, reason="sin Node no se puede ejecutar la plantilla")

# Ejecuta el <script> de una plantilla con un DOM mínimo de mentira, llama a
# las funciones pedidas y devuelve el innerHTML de cada elemento tocado.
ARNES = r"""
const vm = require('vm');
const fs = require('fs');
const [codigo, respuestas, acciones] = process.argv.slice(2).map(f => fs.readFileSync(f, 'utf8'));
const datos = JSON.parse(respuestas);
const elementos = {};
const elemento = id => ({id, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
  checked: false, scrollTop: 0, clientHeight: 0, scrollHeight: 0,
  classList: {contains: () => false, add() {}, remove() {}},
  addEventListener() {}, querySelectorAll: () => []});
const contexto = vm.createContext({
  console,
  document: {getElementById: id => (elementos[id] ??= elemento(id)),
             querySelectorAll: () => [], querySelector: () => null},
  fetch: async ruta => ({json: async () => datos[decodeURIComponent(ruta)] ?? {}}),
  setInterval: () => 0, setTimeout: () => 0, alert() {}, confirm: () => false,
  window: {open() {}},
});
(async () => {
  vm.runInContext(codigo, contexto);
  for (const [fn, ...args] of JSON.parse(acciones)) await contexto[fn](...args);
  const html = {};
  for (const [id, el] of Object.entries(elementos)) html[id] = el.innerHTML;
  console.log(JSON.stringify(html));
})().catch(e => { console.error(e); process.exit(1); });
"""


def _ejecuta(tmp_path, html: str, respuestas: dict, acciones: list) -> dict:
    scripts = re.findall(r"<script>(.*?)</script>", html, flags=re.S)
    assert len(scripts) == 1, "se esperaba un solo bloque <script>"
    rutas = []
    for nombre, contenido in (("arnes.js", ARNES), ("plantilla.js", scripts[0]),
                              ("respuestas.json", json.dumps(respuestas)),
                              ("acciones.json", json.dumps(acciones))):
        ruta = tmp_path / nombre
        ruta.write_text(contenido, encoding="utf-8", newline="\n")
        rutas.append(str(ruta))
    r = subprocess.run([NODE, *rutas], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _sin_etiquetas_inyectadas(html: str) -> None:
    assert "<img" not in html and "<script" not in html, html
    assert "&lt;img" in html


def _ficha_maliciosa(isin: str) -> dict:
    return {
        "meta": {"isin": isin, "fuentes": {"x": [MALICIOSO]}},
        "identificacion": {"nombre": MALICIOSO, "tipo": "fondo", "gestora": MALICIOSO,
                           "categoria_morningstar": MALICIOSO, MALICIOSO: MALICIOSO},
        "costes": {"ter_pct": 1.2, "nota": MALICIOSO},
        "cartera": {"posiciones": [{MALICIOSO: MALICIOSO, "peso": 3.5}], "etiquetas": [MALICIOSO],
                    "detalle": {MALICIOSO: {"x": MALICIOSO}}},
    }


@requiere_node
def test_la_tabla_y_la_ficha_de_la_app_escapan_lo_raspado(tmp_path):
    isin = "LU0000000001"
    respuestas = {
        "/api/fondos": [{"isin": isin + "'><img src=x>", "nombre": MALICIOSO, "tipo": MALICIOSO,
                         "categoria": MALICIOSO, "ter_pct": MALICIOSO, "vl": 1.5,
                         "estrellas": MALICIOSO, "campos": MALICIOSO, "actualizado": MALICIOSO}],
        f"/api/fondo/{isin}": _ficha_maliciosa(isin),
    }
    html = _ejecuta(tmp_path, app.PLANTILLA, respuestas, [["cargarFondos"], ["ficha", isin]])
    _sin_etiquetas_inyectadas(html["cuerpo"])
    assert 'data-isin="LU0000000001&#39;&gt;&lt;img src=x&gt;"' in html["cuerpo"]
    assert "onclick=" not in html["cuerpo"]
    _sin_etiquetas_inyectadas(html["ficha"])
    assert "<details" in html["ficha"]  # la ficha se sigue pintando


def test_un_cierre_de_script_en_los_datos_no_sale_del_bloque_del_visor(tmp_path):
    nombre = "</script><script>alert(1)</script><!--"
    (tmp_path / "data" / "funds").mkdir(parents=True)
    (tmp_path / "data" / "funds" / "LU0000000001.json").write_text(json.dumps({
        "meta": {"isin": "LU0000000001"}, "identificacion": {"nombre": nombre}}), encoding="utf-8")
    html = visor.genera(tmp_path).read_text(encoding="utf-8")
    assert html.count("</script>") == 1 and "<!--" not in html
    # y los datos llegan intactos al script
    datos = re.search(r"const DATOS = (.*);\n", html).group(1)
    assert json.loads(datos)["LU0000000001"]["identificacion"]["nombre"] == nombre


@requiere_node
def test_la_tabla_y_la_ficha_del_visor_escapan_lo_raspado(tmp_path):
    isin = "LU0000000001"
    (tmp_path / "data" / "funds").mkdir(parents=True)
    (tmp_path / "data" / "funds" / f"{isin}.json").write_text(
        json.dumps(_ficha_maliciosa(isin)), encoding="utf-8")
    html = _ejecuta(tmp_path, visor.genera(tmp_path).read_text(encoding="utf-8"), {}, [["ficha", isin]])
    _sin_etiquetas_inyectadas(html["cuerpo"])
    _sin_etiquetas_inyectadas(html["ficha"])
    assert "<details" in html["ficha"]


# ------------------------------------------- «Quitar» (auditoría 16-10, NUEVO-1)
def _ficheros_de(base, isin):
    for rel in (f"data/funds/{isin}.json", f"data/history/{isin}.jsonl",
                f"data/history_vl/{isin}.jsonl", f"export_bdb/{isin}.json"):
        ruta = base / rel
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(f'"{rel}"\n', encoding="utf-8")


def test_quitar_conserva_los_dos_historicos_en_la_papelera(base_app):
    # history/ y history_vl/ tienen ficheros con el mismo nombre: en la
    # papelera plana de antes uno de los dos se borraba para siempre.
    _ficheros_de(base_app, "LU0000000001")
    assert app.quita_fondo("lu0000000001") is None

    assert _fondos_csv(base_app) == "isin,nombre,tipo\n"
    papelera = base_app / "data" / "_papelera"
    for rel in ("funds/LU0000000001.json", "history/LU0000000001.jsonl",
                "history_vl/LU0000000001.jsonl", "export_bdb/LU0000000001.json"):
        assert (papelera / rel).exists(), rel
    assert (papelera / "history" / "LU0000000001.jsonl").read_text(encoding="utf-8") == \
        '"data/history/LU0000000001.jsonl"\n'
    assert not (base_app / "data" / "history" / "LU0000000001.jsonl").exists()


def test_quitar_un_isin_no_valido_no_toca_nada(base_app):
    (base_app / "data" / "index.json").write_text("{}", encoding="utf-8")
    assert app.quita_fondo("index") == "ISIN no valido: INDEX"
    assert app.quita_fondo("") == "ISIN no valido: "
    assert (base_app / "data" / "index.json").exists()
    assert not (base_app / "data" / "_papelera").exists()
    assert _fondos_csv(base_app) == FONDOS_CSV


def test_quitar_por_la_api_valida_el_isin(servidor, base_app):
    (base_app / "data" / "index.json").write_text("{}", encoding="utf-8")
    estado, datos = _pide(servidor, "POST", "/api/quitar", {"isin": "index"}, origen=_propio(servidor))
    assert estado == 200 and datos == {"ok": False, "error": "ISIN no valido: INDEX"}
    assert (base_app / "data" / "index.json").exists()
    estado, datos = _pide(servidor, "POST", "/api/quitar", {"isin": "LU0000000001"}, origen=_propio(servidor))
    assert estado == 200 and datos == {"ok": True, "error": None}
    assert _fondos_csv(base_app) == "isin,nombre,tipo\n"


# --------------------------- config/ bloqueada por otro proceso (revisión, MEN-5)
def test_anadir_con_config_bloqueada_responde_503_con_el_motivo(servidor, base_app, monkeypatch, tmp_path):
    from core import package_integrity
    from fetchers import eodhd
    from tests.test_bloqueo_procesos import RETIENE, _espera_fichero, _proceso

    monkeypatch.setattr(eodhd, "clasifica_isin", lambda *a, **k: "fondo")   # sin red
    monkeypatch.setattr(package_integrity, "ESPERA_BLOQUEO_S", 0.3)
    otro = _proceso(RETIENE, str(base_app), str(tmp_path / "listo"), "3")
    try:
        _espera_fichero(tmp_path / "listo", otro)
        estado, datos = _pide(servidor, "POST", "/api/add", {"isin": "LU0000000002", "nombre": "Dos"},
                              origen=_propio(servidor))
    finally:
        otro.wait(10)
    assert estado == 503 and datos["ok"] is False
    assert datos["error"].startswith("No se ha dado de alta:") and "bloqueada por otro proceso" in datos["error"]
    assert _fondos_csv(base_app) == FONDOS_CSV


def test_corrige_con_config_bloqueada_da_un_mensaje_sin_traceback(base_app, monkeypatch, tmp_path, capsys):
    import argparse

    from core import package_integrity
    from tests.test_bloqueo_procesos import RETIENE, _espera_fichero, _proceso

    monkeypatch.setattr(package_integrity, "ESPERA_BLOQUEO_S", 0.3)
    args = argparse.Namespace(listar=False, isin="LU0000000001", ruta="identificacion.nombre", valor="Uno",
                              motivo="prueba de bloqueo", autor="prueba", nueva=False, quitar=False)
    otro = _proceso(RETIENE, str(base_app), str(tmp_path / "listo"), "3")
    try:
        _espera_fichero(tmp_path / "listo", otro)
        assert main.cmd_corrige(args) == 2
        args.quitar = True
        assert main.cmd_corrige(args) == 2
    finally:
        otro.wait(10)
    salida = capsys.readouterr().out
    assert salida.count("ERROR: config/ está bloqueada por otro proceso") == 2
    assert not (base_app / "config" / "correcciones.json").exists()
