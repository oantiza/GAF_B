# -*- coding: utf-8 -*-
"""El servicio de operaciones: una cola de trabajos, el alta al universo y las
consultas que la app necesita, sin red y sin tocar el extractor real."""
import http.client
import json
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import ops  # noqa: E402
import ops_server  # noqa: E402


def _base(tmp_path: Path) -> Path:
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "config" / "settings.json").write_text(json.dumps({
        "prioridad_fuentes": ["cnmv", "morningstar_lt"], "rate_limit_segundos": 0,
        "ops_origenes": ["http://localhost:5173"]}), encoding="utf-8")
    (tmp_path / "config" / "fondos.csv").write_text("isin,nombre,tipo\nLU0000000001,Fondo Uno,fondo\n", encoding="utf-8")
    (tmp_path / "data" / "funds").mkdir(parents=True)
    return tmp_path


def test_extrae_isins_de_texto_y_lista_sin_repetir():
    assert ops.extrae_isins("LU0000000001, lu0000000002 y basura LU0000000001", ["IE0000000003"]) == [
        "IE0000000003", "LU0000000001", "LU0000000002"]
    assert ops.extrae_isins("nada") == []


def test_la_cola_ejecuta_una_tarea_a_la_vez_y_guarda_registro_y_resultado():
    cola = ops.Cola()
    puerta = threading.Event()

    def lenta(t: ops.Tarea):
        t.linea("empiezo")
        t.avanza(actual=1, total=2, isin="LU0000000001")
        puerta.wait(5)
        return {"hecho": True}

    tarea = cola.lanza("prueba", lenta, {"isins": ["LU0000000001"]})
    assert tarea is not None and tarea.estado == "en_curso"
    assert cola.lanza("otra", lambda t: None) is None      # ocupada
    puerta.set()
    for _ in range(50):
        if tarea.estado != "en_curso":
            break
        time.sleep(0.05)
    foto = tarea.snapshot()
    assert foto["estado"] == "hecha" and foto["resultado"] == {"hecho": True}
    assert foto["log"] == ["empiezo"] and foto["progreso"] == {"actual": 1, "total": 2, "isin": "LU0000000001"}
    assert tarea.snapshot(desde=1)["log"] == []             # registro incremental
    assert cola.lanza("siguiente", lambda t: {"n": 2}) is not None


def test_una_tarea_que_falla_queda_en_error_sin_tumbar_la_cola():
    cola = ops.Cola()

    def rompe(t: ops.Tarea):
        raise RuntimeError("se cayó")

    tarea = cola.lanza("rota", rompe)
    for _ in range(50):
        if tarea.estado != "en_curso":
            break
        time.sleep(0.05)
    assert tarea.estado == "error" and tarea.error == "se cayó"
    assert "ERROR: se cayó" in tarea.log
    assert cola.lanza("siguiente", lambda t: None) is not None


def test_el_alta_resuelve_nombre_y_tipo_y_solo_anade_lo_nuevo(tmp_path, monkeypatch):
    base = _base(tmp_path)
    from fetchers import eodhd
    from fetchers import morningstar_lt as mlt
    monkeypatch.setattr(mlt, "resuelve", lambda isin, http, settings: {"nombre": f"Nombre {isin}", "tipo": "fondo"}
                        if isin != "LU0000000009" else None)
    monkeypatch.setattr(eodhd, "clasifica_isin", lambda isin, http, settings, base, nombre, tipo: "etf" if "ETF" in nombre else (tipo or "fondo"))
    registro: list[str] = []
    filas = ops.alta(base, ["LU0000000001", "LU0000000002", "LU0000000009", "MALO"], "", registro.append)
    assert [(f["isin"], f["situacion"]) for f in filas] == [
        ("LU0000000001", "ya_estaba"), ("LU0000000002", "nuevo"), ("LU0000000009", "nuevo"), ("MALO", "invalido")]
    assert filas[1]["nombre"] == "Nombre LU0000000002" and filas[1]["tipo"] == "fondo"
    assert filas[2]["identificado"] is False
    universo = ops.carga_fondos(base)
    assert [f["isin"] for f in universo] == ["LU0000000001", "LU0000000002", "LU0000000009"]
    assert registro[-1].startswith("Alta terminada: 2 nuevos de 4")


def test_la_baja_retira_del_universo_y_manda_los_ficheros_a_la_papelera(tmp_path):
    base = _base(tmp_path)
    (base / "config" / "fondos.csv").write_text("isin,nombre,tipo\nLU0000000001,Fondo Uno,fondo\nLU0000000002,Fondo Dos,etf\n", encoding="utf-8")
    (base / "data" / "funds" / "LU0000000001.json").write_text(json.dumps({"identificacion": {"nombre": "Fondo Uno"}}), encoding="utf-8")
    (base / "data" / "funds" / "LU0000000002.json").write_text(json.dumps({"identificacion": {"nombre": "Fondo Dos"}}), encoding="utf-8")
    (base / "data" / "history").mkdir()
    (base / "data" / "history" / "LU0000000001.jsonl").write_text("{}\n", encoding="utf-8")
    (base / "export_bdb").mkdir()
    (base / "export_bdb" / "LU0000000001.json").write_text("{}", encoding="utf-8")
    registro: list[str] = []
    filas = ops.baja(base, ["lu0000000001", "LU0000000009"], registro.append)
    assert filas[0]["isin"] == "LU0000000001" and filas[0]["estaba"] is True
    assert sorted(filas[0]["ficheros_movidos"]) == ["data/funds/LU0000000001.json", "data/history/LU0000000001.jsonl", "export_bdb/LU0000000001.json"]
    assert filas[1] == {"isin": "LU0000000009", "estaba": False, "ficheros_movidos": []}
    assert [f["isin"] for f in ops.carga_fondos(base)] == ["LU0000000002"]
    assert (base / "data" / "_papelera" / "funds" / "LU0000000001.json").exists()
    assert (base / "data" / "_papelera" / "history" / "LU0000000001.jsonl").exists()
    assert (base / "data" / "_papelera" / "export_bdb" / "LU0000000001.json").exists()
    assert not (base / "data" / "funds" / "LU0000000001.json").exists()
    assert [f["isin"] for f in ops.lista_universo(base)] == ["LU0000000002"]
    assert registro[-1].startswith("Baja terminada: 1 de 2")


def test_ficha_y_canonico_resumen_leen_lo_que_hay(tmp_path):
    base = _base(tmp_path)
    (base / "data" / "funds" / "LU0000000001.json").write_text(json.dumps({
        "identificacion": {"nombre": "Fondo Uno", "tipo": "fondo", "gestora": "Casa", "ucits": True},
        "riesgo": {"sri_kid_1a7": 4}, "documentos_oficiales": {"kid_fuente": "dws", "kid_fecha": "2026-02-16"},
        "calidad": {"score": 80, "bucket": "ALTO", "flags": ["info_x"]},
        "meta": {"actualizado": "2026-09-05T10:00:00", "procedencia": {"riesgo.sri_kid_1a7": "kid_gestora:dws"},
                 "adquisicion": {"plan": ["cssf", "morningstar_lt", "kid_gestora"], "fuentes": {"cssf": {}, "kid_gestora": {}}},
                 "errores": []}}), encoding="utf-8")
    ficha = ops.ficha_resumen(base, "LU0000000001")
    assert ficha["nombre"] == "Fondo Uno" and ficha["calidad"]["bucket"] == "ALTO"
    assert ficha["sri"] == {"valor": 4, "fuente": "kid_gestora:dws", "oficial": True}
    assert ficha["kid"] == {"fuente": "dws", "fecha": "2026-02-16"}
    assert ficha["fuentes"] == ["cssf", "kid_gestora"] and ficha["campos_con_dato"] > 0
    assert ops.ficha_resumen(base, "LU0000000002") is None
    assert ops.canonico_resumen(base, "LU0000000001") is None
    (base / "export_bdb").mkdir()
    (base / "export_bdb" / "LU0000000001.json").write_text(json.dumps({
        "schema": "fondosdb-fund.v1", "validation": {"ok": True, "errors": [], "warnings": ["w"]},
        "quality": {"bucket": "ALTO"}, "regulatory": {"sri": 4, "kid": {"source": "dws"}},
        "provenance": {"dependency": {"regulatory_from_official_sources": 9}}}), encoding="utf-8")
    c = ops.canonico_resumen(base, "LU0000000001")
    assert c["validation_ok"] is True and c["kid_source"] == "dws" and c["warnings"] == 1
    est = ops.estado(base)
    assert est["universo"] == {"total": 1, "por_tipo": {"fondo": 1}} and est["fichas"] == 1
    assert est["paquete_coherente"] is False


@pytest.fixture
def servidor(tmp_path):
    base = _base(tmp_path)
    srv = ops_server.crea_servidor(base, 0)
    hilo = threading.Thread(target=srv.serve_forever, daemon=True)
    hilo.start()
    yield srv
    srv.shutdown()
    srv.server_close()


def _pide(srv, metodo, ruta, cuerpo=None, origen="http://localhost:5173", cabeceras=None, token=True):
    """Como la app: con el token del servicio, salvo `token=False` (o uno explícito)."""
    con = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    h = {"Content-Type": "application/json"}
    if origen:
        h["Origin"] = origen
    if token:
        h["X-Ops-Token"] = srv.servicio.token
    h.update(cabeceras or {})
    con.request(metodo, ruta, body=json.dumps(cuerpo) if cuerpo is not None else None, headers=h)
    r = con.getresponse()
    datos = r.read()
    con.close()
    return r.status, dict(r.getheaders()), (json.loads(datos) if datos else None)


def test_el_servicio_responde_estado_universo_y_ficha_con_cors_solo_para_la_app(servidor):
    estado, cab, datos = _pide(servidor, "GET", "/api/ops/estado")
    assert estado == 200 and datos["servicio"] == "fondosdb-ops" and datos["universo"]["total"] == 1
    assert cab["Access-Control-Allow-Origin"] == "http://localhost:5173"

    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/universo?q=uno")
    assert estado == 200 and [f["isin"] for f in datos] == ["LU0000000001"] and datos[0]["pendiente"] is True

    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/ficha/LU0000000001")
    assert estado == 200 and datos["en_universo"] is True and datos["ficha"] is None

    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/ficha/MALO")
    assert estado == 400

    # un origen que no es la app no recibe CORS ni respuesta útil
    estado, cab, datos = _pide(servidor, "GET", "/api/ops/estado", origen="https://otro.example")
    assert estado == 403 and "Access-Control-Allow-Origin" not in cab

    # preflight
    estado, cab, _ = _pide(servidor, "OPTIONS", "/api/ops/alta", token=False)   # el preflight no lleva token
    assert estado == 204 and "X-Ops-Token" in cab["Access-Control-Allow-Headers"]

    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/no-existe")
    assert estado == 404


def test_los_trabajos_se_lanzan_en_segundo_plano_y_se_consultan(servidor, monkeypatch):
    llamadas = []

    def falso_alta(base, isins, tipo, log_cb, avanza):
        llamadas.append((isins, tipo))
        log_cb("alta de mentira")
        return [{"isin": i, "situacion": "nuevo"} for i in isins]

    monkeypatch.setattr(ops, "alta", falso_alta)
    estado, _cab, datos = _pide(servidor, "POST", "/api/ops/alta", {"texto": "LU0000000002 LU0000000003", "tipo": "fondo"})
    assert estado == 200 and datos["ok"] is True
    id_ = datos["tarea"]["id"]
    for _ in range(50):
        _e, _c, t = _pide(servidor, "GET", f"/api/ops/tareas/{id_}")
        if t["estado"] != "en_curso":
            break
        time.sleep(0.05)
    assert t["estado"] == "hecha" and t["log"] == ["alta de mentira"]
    assert t["resultado"] == [{"isin": "LU0000000002", "situacion": "nuevo"}, {"isin": "LU0000000003", "situacion": "nuevo"}]
    assert llamadas == [(["LU0000000002", "LU0000000003"], "fondo")]

    estado, _cab, datos = _pide(servidor, "POST", "/api/ops/alta", {"texto": "sin isin"})
    assert estado == 400
    estado, _cab, datos = _pide(servidor, "POST", "/api/ops/alta", {"isins": ["LU0000000002"], "tipo": "raro"})
    assert estado == 400
    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/tareas")
    assert estado == 200 and datos["tareas"][0]["id"] == id_
    estado, _cab, _ = _pide(servidor, "GET", "/api/ops/tareas/no-existe")
    assert estado == 404


def test_reclasificar_cambia_el_tipo_en_fondos_csv_sin_tocar_el_orden(servidor):
    _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "LU0000000001", "tipo": "etf"})
    estado, _c, datos = _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "lu0000000001", "tipo": "accion"})
    siguiente = datos.pop("siguiente")
    assert estado == 200 and datos == {"ok": True, "isin": "LU0000000001", "tipo_anterior": "etf", "tipo": "accion", "nombre": "Fondo Uno"}
    assert "reclasificar en la maestra" in siguiente      # fondos.csv no basta: la maestra sigue con el tipo viejo
    assert _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "LU0000000001", "tipo": "raro"})[0] == 400
    assert _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "LU0000000002", "tipo": "etf"})[0] == 400
    estado, _c, filas = _pide(servidor, "GET", "/api/ops/universo")
    assert [(f["isin"], f["tipo"]) for f in filas] == [("LU0000000001", "accion")]


def test_un_host_ajeno_se_rechaza(servidor):
    # DNS rebinding: la página ajena llega con su nombre y, en un GET del mismo
    # origen, sin Origin (auditoría 16-10, ALTA-15).
    puerto = servidor.server_address[1]
    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/estado", origen=None,
                                cabeceras={"Host": f"evil.example:{puerto}"})
    assert estado == 403 and "Host" in datos["error"]
    estado, _cab, _ = _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "LU0000000001", "tipo": "etf"},
                            cabeceras={"Host": f"evil.example:{puerto}"})
    assert estado == 403
    assert [f["tipo"] for f in ops.carga_fondos(servidor.servicio.base)] == ["fondo"]
    assert _pide(servidor, "GET", "/api/ops/estado", cabeceras={"Host": "127.0.0.1:1"})[0] == 403
    assert _pide(servidor, "GET", "/api/ops/estado", cabeceras={"Host": f"localhost:{puerto}"})[0] == 200
    assert _pide(servidor, "GET", "/api/ops/estado", origen=None)[0] == 200


def test_desde_no_numerico_da_400_y_no_corta_la_conexion(servidor):
    tarea = servidor.servicio.cola.lanza("prueba", lambda t: {"hecho": True})
    estado, _cab, datos = _pide(servidor, "GET", f"/api/ops/tareas/{tarea.id}?desde=abc")
    assert estado == 400 and datos["ok"] is False and "desde" in datos["error"]
    estado, _cab, datos = _pide(servidor, "GET", "/api/ops/tareas/no-existe?desde=abc")
    assert estado == 400
    estado, _cab, datos = _pide(servidor, "GET", f"/api/ops/tareas/{tarea.id}?desde=")
    assert estado == 200 and datos["id"] == tarea.id


def test_desde_se_lee_despues_de_autorizar(tmp_path):
    base = _base(tmp_path)
    cfg = json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))
    cfg["ops_token"] = "secreto-de-prueba-con-mas-de-32-caracteres"
    (base / "config" / "settings.json").write_text(json.dumps(cfg), encoding="utf-8")
    srv = ops_server.crea_servidor(base, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        assert _pide(srv, "GET", "/api/ops/tareas/x?desde=abc", token=False)[0] == 401
        assert _pide(srv, "GET", "/api/ops/tareas/x?desde=abc", cabeceras={"X-Ops-Token": "secreto-de-prueba-con-mas-de-32-caracteres"})[0] == 400
    finally:
        srv.shutdown()
        srv.server_close()


def test_con_token_configurado_hay_que_traerlo(tmp_path):
    base = _base(tmp_path)
    cfg = json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))
    cfg["ops_token"] = "secreto-de-prueba-con-mas-de-32-caracteres"
    (base / "config" / "settings.json").write_text(json.dumps(cfg), encoding="utf-8")
    srv = ops_server.crea_servidor(base, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        assert _pide(srv, "GET", "/api/ops/estado", token=False)[0] == 401
        assert not (base / "config" / "ops_token.txt").exists()      # con ops_token en settings no se crea
        assert _pide(srv, "GET", "/api/ops/estado", cabeceras={"X-Ops-Token": "secreto-de-prueba-con-mas-de-32-caracteres"})[0] == 200
    finally:
        srv.shutdown()
        srv.server_close()
