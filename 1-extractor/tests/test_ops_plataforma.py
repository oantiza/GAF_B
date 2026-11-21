# -*- coding: utf-8 -*-
"""La plataforma desde el servicio de operaciones: entorno, artefactos y la
disciplina copia → pasada en seco → escritura, con un `npm` de mentira."""
import datetime as dt
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import ops_plataforma as opl  # noqa: E402
import ops_server  # noqa: E402
from tests.test_ops import _base, _pide  # noqa: E402


def _paquete(base: Path, coherente: bool = True) -> None:
    (base / "export_bdb").mkdir(exist_ok=True)
    (base / "export").mkdir(exist_ok=True)
    (base / "export_bdb" / "_resumen.json").write_text(json.dumps({"package_id": "abc"}), encoding="utf-8")
    (base / "export" / "manifest.json").write_text(json.dumps({"package_id": "abc" if coherente else "otro"}), encoding="utf-8")


def _plataforma(tmp_path: Path, backup_horas: float | None = 2.0) -> Path:
    p = tmp_path / "2-plataforma-datos"
    (p / "node_modules").mkdir(parents=True)
    (p / "package.json").write_text(json.dumps({"scripts": {
        "load:fondosdb": "x", "republish:fondosdb": "x", "audit:consistency": "x", "backup:export": "x",
        "archive:assets": "x", "reclassify:stock": "x"}}), encoding="utf-8")
    (p / ".env.local").write_text("FIREBASE_PROJECT_ID=gestor-activos-local\nFIREBASE_SERVICE_ACCOUNT_PATH=\"secrets/sa.json\"\n# comentario\n", encoding="utf-8")
    if backup_horas is not None:
        import datetime as dt
        carpeta = p / "data" / "backups" / "2026-09-05T00-00-00-000Z"
        carpeta.mkdir(parents=True)
        exportado = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=backup_horas)).isoformat().replace("+00:00", "Z")
        (carpeta / "manifest.json").write_text(json.dumps({"exported_at": exportado, "firestore_records": 10, "project_id": "gestor-activos-local"}), encoding="utf-8")
        (carpeta / "summary.json").write_text(json.dumps({"verification": "PASS"}), encoding="utf-8")
    return p


def test_el_entorno_carga_env_local_resuelve_credenciales_y_solo_lleva_el_gate_al_escribir(tmp_path, monkeypatch):
    plataforma = _plataforma(tmp_path)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.setenv(opl.GATE, "no deberia pasar")
    env = opl.entorno(plataforma)
    assert env["FIREBASE_PROJECT_ID"] == "gestor-activos-local"
    assert env["GOOGLE_APPLICATION_CREDENTIALS"] == str(plataforma / "secrets" / "sa.json")
    assert opl.GATE not in env
    assert opl.entorno(plataforma, escribir=True)[opl.GATE] == opl.GATE_VALOR
    d = opl.disponible(plataforma)
    assert d["existe"] and d["scripts_ok"] and d["node_modules"] and d["env_local"] and d["credenciales"]
    assert opl.disponible(tmp_path / "no-existe")["existe"] is False


def test_la_ultima_copia_dice_si_esta_vigente(tmp_path):
    assert opl.ultimo_backup(_plataforma(tmp_path, backup_horas=None)) is None
    copia = opl.ultimo_backup(_plataforma(tmp_path / "b", backup_horas=2))
    assert copia["vigente"] is True and copia["verificacion"] == "PASS" and 1.5 < copia["edad_horas"] < 2.5
    assert opl.ultimo_backup(_plataforma(tmp_path / "c", backup_horas=30))["vigente"] is False


def _copia_de(tmp_path, nombre, manifiesto, resumen):
    """Una plataforma con una sola copia, escrita tal cual: para lo que la copia no puede ser."""
    plataforma = _plataforma(tmp_path / nombre, backup_horas=None)
    carpeta = plataforma / "data" / "backups" / "2026-11-16T10-00-00-000Z"
    carpeta.mkdir(parents=True)
    (carpeta / "manifest.json").write_text(json.dumps(manifiesto), encoding="utf-8")
    if resumen is not None:
        (carpeta / "summary.json").write_text(json.dumps(resumen), encoding="utf-8")
    return opl.ultimo_backup(plataforma)


def test_una_copia_sin_verificar_de_otro_proyecto_o_con_fecha_futura_no_da_permiso(tmp_path):
    """Auditoría del 16-11-2026 (EXT-2): la copia valía solo por su edad."""
    hace = lambda horas: (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=horas)).isoformat().replace("+00:00", "Z")
    buena = {"exported_at": hace(2), "firestore_records": 10, "project_id": "gestor-activos-local"}
    assert _copia_de(tmp_path, "ok", buena, {"verification": "PASS"})["vigente"] is True
    # El manifiesto se escribe antes de verificar: una copia a medias no tiene resumen.
    sin_resumen = _copia_de(tmp_path, "a", buena, None)
    assert sin_resumen["vigente"] is False and "no está verificada" in sin_resumen["motivo"]
    fallida = _copia_de(tmp_path, "b", buena, {"verification": "FAIL"})
    assert fallida["vigente"] is False and "no está verificada" in fallida["motivo"]
    # Una copia de otro proyecto no respalda lo que se va a escribir en este.
    ajena = _copia_de(tmp_path, "c", {**buena, "project_id": "otro-proyecto"}, {"verification": "PASS"})
    assert ajena["vigente"] is False and "otro-proyecto" in ajena["motivo"] and "gestor-activos-local" in ajena["motivo"]
    sin_proyecto = _copia_de(tmp_path, "d", {"exported_at": hace(2)}, {"verification": "PASS"})
    assert sin_proyecto["vigente"] is False and "sin declarar" in sin_proyecto["motivo"]
    # Una fecha futura daba una edad negativa, que es «menos de 24 horas».
    futura = _copia_de(tmp_path, "e", {**buena, "exported_at": hace(-48)}, {"verification": "PASS"})
    assert futura["vigente"] is False and "posterior a hoy" in futura["motivo"]
    # Sin zona horaria lanzaba TypeError; ahora se lee como UTC.
    sin_zona = _copia_de(tmp_path, "f", {**buena, "exported_at": hace(2).replace("Z", "")}, {"verification": "PASS"})
    assert sin_zona["vigente"] is True and 1.5 < sin_zona["edad_horas"] < 2.5
    ilegible = _copia_de(tmp_path, "g", {**buena, "exported_at": "ayer"}, {"verification": "PASS"})
    assert ilegible["vigente"] is False and ilegible["edad_horas"] is None


def test_quien_exige_la_copia_dice_por_que_no_vale(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path, backup_horas=30)
    monkeypatch.setattr(opl, "ejecuta", NpmFalso())
    with pytest.raises(opl.ErrorPlataforma, match=r"la copia tiene 30\.0 h, más de 24"):
        opl.escribir(base, plataforma, ["LU0000000002"], "alta", esperado=1)


def test_el_plazo_se_cumple_aunque_el_proceso_no_escriba_nada(tmp_path, monkeypatch):
    """EXT-3: un proceso que duerme cinco segundos en silencio volvía como éxito a los cinco segundos."""
    guion = tmp_path / "duerme.py"
    guion.write_text("import time\ntime.sleep(20)\n", encoding="utf-8")
    lanzados = []
    real = opl.subprocess.Popen

    def popen(cmd, *a, **kw):
        # Solo `npm` se cambia por el guion: `taskkill`, que es quien lo para, se lanza de verdad.
        if cmd[0] != opl._npm():
            return real(cmd, *a, **kw)
        proc = real([sys.executable, str(guion)], **kw)
        lanzados.append(proc)
        return proc

    monkeypatch.setattr(opl.subprocess, "Popen", popen)
    inicio = time.monotonic()
    with pytest.raises(opl.ErrorPlataforma, match="tardó más de 1 s"):
        opl.ejecuta(["audit:consistency"], tmp_path, dict(os.environ), timeout=1.0)
    assert time.monotonic() - inicio < 10
    assert lanzados[0].wait(timeout=10) is not None    # y el proceso ya no está vivo


def test_la_salida_de_un_proceso_que_acaba_se_recoge_entera(tmp_path, monkeypatch):
    guion = tmp_path / "habla.py"
    guion.write_text("print('uno')\nprint('dos')\nraise SystemExit(3)\n", encoding="utf-8")
    real = opl.subprocess.Popen
    monkeypatch.setattr(opl.subprocess, "Popen", lambda cmd, *a, **kw: real([sys.executable, str(guion)] if cmd[0] == opl._npm() else cmd, *a, **kw))
    vistas = []
    assert opl.ejecuta(["audit:consistency"], tmp_path, dict(os.environ), log_cb=vistas.append) == (3, ["uno", "dos"])
    assert vistas[1:] == ["uno", "dos"]


def test_un_motivo_con_caracteres_de_cmd_no_llega_al_comando(tmp_path, monkeypatch):
    """EXT-4: `npm.cmd` lo ejecuta `cmd.exe`, y el motivo `x" & echo INYECTADO & "y` lanzaba el `echo`."""
    base = _base(tmp_path / "extractor")
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    for motivo in ['x" & echo INYECTADO & "y', "100 %PATH%", "a | b", "a > b", "a ^ b", "dos\nlineas"]:
        with pytest.raises(opl.ErrorPlataforma, match="el motivo no puede llevar"):
            opl.archivar(base, plataforma, ["LU0000000001"], motivo=motivo)
    assert npm.llamadas == []
    # Un motivo corriente sigue pasando, con sus tildes, comas y paréntesis.
    opl.archivar(base, plataforma, ["LU0000000001"], motivo="Fondo liquidado (fusión), baja del 12/11")
    assert len(npm.llamadas) == 1


def test_ningun_argumento_peligroso_llega_a_npm(tmp_path, monkeypatch):
    lanzados = []
    monkeypatch.setattr(opl.subprocess, "Popen", lambda *a, **k: lanzados.append(a) or (_ for _ in ()).throw(AssertionError("no debía lanzarse")))
    with pytest.raises(opl.ErrorPlataforma, match="argumento no admitido"):
        opl.ejecuta(["archive:assets", "--", "--reason", 'x" & calc & "y'], tmp_path, {})
    assert lanzados == []
    assert opl.argumento_seguro("C:\\Users\\o antiza\\reports\\ops_runs") and opl.argumento_seguro("LU0000000001,ES0105046017")


class NpmFalso:
    """Simula `npm run <script>`: deja los artefactos que dejaría la plataforma."""

    def __init__(self, existentes=(), fallo=None, acciones=(), fondos_en_maestra=(), a_reparar=(),
                 retenidas=(), en_revision=()):
        self.existentes = set(existentes)
        # republish: filas que la plataforma deja en el plan sin escribirlas
        # (hold:stock_not_ready, review:canonical_invalid); no cuentan en to_republish.
        self.retenidas = set(retenidas)
        self.en_revision = set(en_revision)
        self.llamadas: list[dict] = []
        self.fallo = fallo
        # reclassify:stock: ISIN cuyo canónico ya es de acción, y los que la maestra tiene como fondo.
        self.acciones = set(acciones)
        self.fondos_en_maestra = set(fondos_en_maestra)
        # ya son acción en la maestra con el buscador a medias (lote confirmado, índice fallido)
        self.a_reparar = set(a_reparar)

    def __call__(self, args, cwd, env, log_cb=None, timeout=0):
        emite = log_cb or (lambda _t: None)
        script = args[0]
        flags = {args[i]: args[i + 1] for i in range(len(args) - 1) if args[i].startswith("--") and not args[i + 1].startswith("--")}
        escribe = "--write" in args
        self.llamadas.append({"script": script, "write": escribe, "gate": env.get(opl.GATE), "ids": flags.get("--ids"),
                              "targets": flags.get("--targets")})
        out = Path(flags.get("--out", cwd))
        if self.fallo == script:
            # Como la plataforma real: crea la carpeta de la corrida y se cae antes del resumen.
            (out / f"{'loader' if script == 'load:fondosdb' else 'republish'}_caida").mkdir(parents=True, exist_ok=True)
            emite("[loader] ERROR: se cayó")
            return 1, ["[loader] ERROR: se cayó"]
        ids = (flags.get("--ids") or "").split(",")
        stamp = f"{time.time():.6f}".replace(".", "-")
        if script == "load:fondosdb":
            carpeta = out / f"loader_{stamp}"
            carpeta.mkdir(parents=True)
            targets = (flags.get("--targets") or "root").split(",")
            items = [{"asset_id": i, "action": "SKIP_EXISTS" if i in self.existentes else ("BLOCKED_REJECTED" if i.endswith("9") else "CREATE"),
                      "review_reasons": [], "reject_reasons": ["sin canónico"] if i.endswith("9") else [], "contract_errors": []} for i in ids]
            for x in items:
                if x["action"] in ("CREATE", "SKIP_EXISTS"):
                    x["documents"] = [f"assets/{x['asset_id']}"] + ([f"assets/{x['asset_id']}/holdings/latest"] if "holdings" in targets else []) \
                        + ([f"assets/{x['asset_id']}/metrics/latest"] if "metrics" in targets else [])
            counts = {"CREATE": sum(1 for x in items if x["action"] == "CREATE"), "SKIP_EXISTS": sum(1 for x in items if x["action"] == "SKIP_EXISTS"),
                      "BLOCKED_REJECTED": sum(1 for x in items if x["action"] == "BLOCKED_REJECTED")}
            (carpeta / "plan.json").write_text(json.dumps({"run_id": stamp, "counts": counts, "items": items,
                                                            "package_validation": {"status": "OK", "issues": []}}), encoding="utf-8")
            if escribe:
                (carpeta / "write_summary.json").write_text(json.dumps({"writes_executed": counts["CREATE"], "skipped_existing": counts["SKIP_EXISTS"],
                                                                        "postverify_ok": counts["CREATE"], "postverify_failed": 0, "errors": []}), encoding="utf-8")
                self.existentes |= {x["asset_id"] for x in items if x["action"] == "CREATE"}
            emite(f"[loader] artefactos en {carpeta}")
            return 0, [f"[loader] artefactos en {carpeta}"]
        if script == "republish:fondosdb":
            carpeta = out / f"republish_{stamp}"
            carpeta.mkdir(parents=True)
            plan = [{"asset_id": i, "population": "fund", "operations": ["root:set"], "drift_fields": ["costs"], "drift_paths": ["costs.ter"]}
                    for i in ids if i in self.existentes and i not in self.retenidas | self.en_revision]
            n = len(plan)
            plan += [{"asset_id": i, "population": "stock", "operations": ["hold:stock_not_ready"],
                      "drift_fields": ["identifiers"], "drift_paths": ["identifiers.eodhd_code"]}
                     for i in ids if i in self.retenidas]
            plan += [{"asset_id": i, "population": "review", "operations": ["review:canonical_invalid"],
                      "drift_fields": ["canonical_validation"], "drift_paths": ["isin: no es string"]}
                     for i in ids if i in self.en_revision]
            plan.append({"asset_id": "meta/search_index", "operations": ["search_index:set"], "drift_fields": ["search_index"], "drift_paths": ["entries"]})
            resumen = {"run_id": stamp, "write": escribe, "checked": len(ids), "matched": len(ids), "to_republish": n,
                       "canonical_invalid": len(self.en_revision & set(ids)),
                       "republished": n if escribe else 0, "postverify_ok": n if escribe else 0, "postverify_failed": 0, "errors": []}
            (carpeta / "republish_plan.json").write_text(json.dumps(plan), encoding="utf-8")
            (carpeta / "republish_summary.json").write_text(json.dumps(resumen), encoding="utf-8")
            return 0, [f"[republish] artefactos en {carpeta}"]
        if script == "audit:consistency":
            carpeta = out / f"audit_{stamp}"
            carpeta.mkdir(parents=True)
            (carpeta / "audit_summary.json").write_text(json.dumps({"run_id": stamp, "checked": len(ids), "drifted": 0}), encoding="utf-8")
            (carpeta / "drifts.json").write_text("[]", encoding="utf-8")
            (carpeta / "holdings_drifts.json").write_text("[]", encoding="utf-8")
            return 0, [f"[audit] artefactos en {carpeta}"]
        if script == "archive:assets":
            carpeta = out / f"archive_{stamp}"
            carpeta.mkdir(parents=True)
            plan = []
            for i in ids:
                existe = i in self.existentes
                fila = {"asset_id": i, "action": "ARCHIVE" if existe else "MISSING", "exists": existe,
                        "name": f"Nombre {i}" if existe else None, "type": "FUND" if existe else None,
                        "subdocs": 3 if existe else 0, "in_search_index": existe, "archived_copy_exists": False}
                if escribe and existe:
                    (carpeta / f"backup_{i}.json").write_text("{}", encoding="utf-8")
                    fila["backup_file"] = str(carpeta / f"backup_{i}.json")
                    fila["postverify"] = {"archived_root": True, "archived_subdocs": 3, "original_gone": True,
                                          "index_entry_gone": True, "ok": True}
                plan.append(fila)
            encontrados = [p for p in plan if p["exists"]]
            resumen = {"run_id": stamp, "write": escribe, "reason": flags.get("--reason", ""), "requested": len(ids),
                       "found": len(encontrados), "missing": [p["asset_id"] for p in plan if not p["exists"]],
                       "to_archive": len(encontrados), "subdocs_total": 3 * len(encontrados), "in_search_index": len(encontrados),
                       "archived": len(encontrados) if escribe else 0, "subdocs_copied": 3 * len(encontrados) if escribe else 0,
                       "docs_deleted": 4 * len(encontrados) if escribe else 0, "search_index_removed": len(encontrados) if escribe else 0,
                       "postverify_ok": len(encontrados) if escribe else 0, "postverify_failed": 0,
                       "backups": [p["backup_file"] for p in plan if p.get("backup_file")], "errors": []}
            if escribe:
                self.existentes -= {p["asset_id"] for p in encontrados}
            (carpeta / "archive_summary.json").write_text(json.dumps(resumen), encoding="utf-8")
            (carpeta / "archive_plan.json").write_text(json.dumps(plan), encoding="utf-8")
            return 0, [f"[archive] artefactos en {carpeta}"]
        if script == "reclassify:stock":
            carpeta = out / f"reclassify_{stamp}"
            carpeta.mkdir(parents=True)
            plan = []
            for i in ids:
                if i in self.a_reparar:
                    fila = {"asset_id": i, "action": "REPAIR", "reason": "ALREADY_STOCK", "repairs": ["search_index"],
                            "search_index": "UPDATE", "warnings": ["HOLDINGS_LEFT"], "holdings_left": [f"assets/{i}/holdings/latest"]}
                    if escribe:
                        fila["written"] = True
                        fila["postverify"] = {"root": True, "metrics": True, "search_index": True, "ok": True}
                    plan.append(fila)
                elif i not in self.acciones:
                    plan.append({"asset_id": i, "action": "SKIP", "reason": "NO_STOCK_CANONICAL"})
                elif i not in self.fondos_en_maestra:
                    plan.append({"asset_id": i, "action": "SKIP", "reason": "NOT_IN_MASTER"})
                else:
                    fila = {"asset_id": i, "action": "RECLASSIFY", "from": "FUND", "to": "STOCK", "dropped": ["costs"],
                            "metrics_latest": "MARK", "search_index": "UPDATE"}
                    if escribe:
                        fila["written"] = True
                        fila["postverify"] = {"root": True, "metrics": True, "search_index": True, "ok": True}
                    plan.append(fila)
            hechos = [r for r in plan if r["action"] == "RECLASSIFY"]
            reparados = [r for r in plan if r["action"] == "REPAIR"]
            if escribe:
                self.fondos_en_maestra -= {r["asset_id"] for r in hechos}
                self.a_reparar -= {r["asset_id"] for r in reparados}
            resumen = {"run_id": stamp, "write": escribe, "requested": len(ids), "to_reclassify": len(hechos),
                       "reclassified": [{"asset_id": r["asset_id"], "from": "FUND", "to": "STOCK", "dropped": ["costs"]} for r in hechos],
                       "skipped": len(plan) - len(hechos), "written": len(hechos) if escribe else 0,
                       "metrics_marked": len(hechos) if escribe else 0, "search_index_written": bool(hechos) and escribe,
                       "repaired": len(reparados) if escribe else 0,
                       "holdings_left": [{"asset_id": r["asset_id"], "paths": r["holdings_left"]} for r in plan if r.get("holdings_left")],
                       "errors": [], "postverify_ok": len(hechos) if escribe else 0, "postverify_failed": 0}
            (carpeta / "reclassify_plan.json").write_text(json.dumps(plan), encoding="utf-8")
            (carpeta / "reclassify_summary.json").write_text(json.dumps(resumen), encoding="utf-8")
            return 0, [f"[reclassify] artefactos en {carpeta}"]
        if script == "backup:export":
            import datetime as dt
            carpeta = Path(cwd) / "data" / "backups" / f"2026-09-05T{stamp[-6:]}Z"
            carpeta.mkdir(parents=True)
            (carpeta / "manifest.json").write_text(json.dumps({"exported_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"), "firestore_records": 3, "project_id": "gestor-activos-local"}), encoding="utf-8")
            (carpeta / "summary.json").write_text(json.dumps({"verification": "PASS"}), encoding="utf-8")
            return 0, ["[backup] verificacion=PASS"]
        return 1, ["script desconocido"]


def test_sin_paquete_coherente_no_se_pide_nada_a_la_plataforma(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso()
    monkeypatch.setattr(opl, "ejecuta", npm)
    with pytest.raises(opl.ErrorPlataforma, match="regenera el canónico"):
        opl.pasada_en_seco(base, plataforma, ["LU0000000002"], "alta")
    _paquete(base, coherente=False)
    with pytest.raises(opl.ErrorPlataforma, match="mismo snapshot"):
        opl.pasada_en_seco(base, plataforma, ["LU0000000002"], "alta")
    assert npm.llamadas == []
    assert opl.paquete_coherente(base) == {"coherente": False, "export_bdb": "abc", "export": "otro"}


def test_la_pasada_en_seco_de_alta_resume_el_plan_por_isin(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    registro: list[str] = []
    res = opl.pasada_en_seco(base, plataforma, ["LU0000000001", "LU0000000002", "LU0000000009"], "alta", registro.append)
    assert res["escrituras"] == 1 and res["escribir"] is False
    assert [(f["isin"], f["accion"]) for f in res["filas"]] == [
        ("LU0000000001", "SKIP_EXISTS"), ("LU0000000002", "CREATE"), ("LU0000000009", "BLOCKED_REJECTED")]
    assert res["filas"][2]["motivos"] == ["sin canónico"]
    assert res["recuento"] == {"CREATE": 1, "SKIP_EXISTS": 1, "BLOCKED_REJECTED": 1}
    assert npm.llamadas[0]["write"] is False and npm.llamadas[0]["gate"] is None
    assert npm.llamadas[0]["ids"] == "LU0000000001,LU0000000002,LU0000000009"
    assert Path(res["carpeta"]).is_relative_to(base / "reports" / "ops_runs")


def test_la_pasada_en_seco_de_republish_marca_sin_cambios_lo_que_no_deriva(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    monkeypatch.setattr(opl, "ejecuta", NpmFalso(existentes={"LU0000000001"}))
    res = opl.pasada_en_seco(base, plataforma, ["LU0000000001", "LU0000000002"], "republish")
    assert res["escrituras"] == 1
    assert [(f["isin"], f["accion"]) for f in res["filas"]] == [("LU0000000001", "REPUBLICAR"), ("LU0000000002", "SIN_CAMBIOS")]
    assert res["filas"][0]["campos"] == ["costs"] and res["otros_en_plan"] == ["meta/search_index"]


def test_las_filas_retenidas_o_en_revision_no_se_presentan_como_republicar(tmp_path, monkeypatch):
    # Revisión de la plataforma, H2: la plataforma deja en republish_plan.json
    # las acciones que retiene (hold:stock_not_ready) y los canónicos en
    # revisión (review:canonical_invalid). Salían como «REPUBLICAR».
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    ids = ["LU0000000001", "LU0000000002", "LU0000000003"]
    monkeypatch.setattr(opl, "ejecuta", NpmFalso(existentes=set(ids), retenidas={"LU0000000002"},
                                                  en_revision={"LU0000000003"}))
    res = opl.pasada_en_seco(base, plataforma, ids, "republish")
    assert [(f["isin"], f["accion"]) for f in res["filas"]] == [
        ("LU0000000001", "REPUBLICAR"), ("LU0000000002", "RETENIDA"), ("LU0000000003", "REVISION")]
    assert res["filas"][1]["operaciones"] == ["hold:stock_not_ready"]
    assert res["escrituras"] == 1                    # solo la que se republica
    assert res["retenidas"] == ["LU0000000002"] and res["en_revision"] == ["LU0000000003"]


@pytest.mark.parametrize("operaciones,accion", [
    (["root:set", "metrics:set"], "REPUBLICAR"), (["hold:stock_not_ready"], "RETENIDA"),
    (["review:canonical_invalid"], "REVISION"), (["hold:x", "review:y"], "REVISION"),
    (["hold:stock_not_ready", "root:set"], "REPUBLICAR"), ([], "REPUBLICAR"), (None, "REPUBLICAR"),
])
def test_accion_de_cada_fila_del_republish(operaciones, accion):
    assert opl._accion_republish(operaciones) == accion


def test_escribir_exige_copia_vigente_y_recuento_igual_y_solo_entonces_lleva_el_gate(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)

    sin_copia = _plataforma(tmp_path / "sin", backup_horas=None)
    with pytest.raises(opl.ErrorPlataforma, match="copia"):
        opl.escribir(base, sin_copia, ["LU0000000002"], "alta", 1)
    assert npm.llamadas == []

    plataforma = _plataforma(tmp_path)
    with pytest.raises(opl.ErrorPlataforma, match="prevé 1 escrituras y se aprobaron 2"):
        opl.escribir(base, plataforma, ["LU0000000002"], "alta", 2)
    assert [c["write"] for c in npm.llamadas] == [False]      # solo la pasada en seco de comprobación

    npm.llamadas.clear()
    res = opl.escribir(base, plataforma, ["LU0000000002"], "alta", 1)
    assert [(c["script"], c["write"], c["gate"]) for c in npm.llamadas] == [
        ("load:fondosdb", False, None),
        ("load:fondosdb", True, opl.GATE_VALOR),
        ("audit:consistency", False, None)]
    assert res["escritura"]["escritura"] == {"escritos": 1, "ya_existian": 0, "postverify_ok": 1, "postverify_fallidos": 0, "errores": []}
    assert res["auditoria"]["en_cero"] is True and res["auditoria"]["desvios"] == 0

    # Ya existe: la pasada en seco de ahora da 0 y, con 0 aprobado, no se escribe nada.
    npm.llamadas.clear()
    res = opl.escribir(base, plataforma, ["LU0000000002"], "alta", 0)
    assert res["escritura"] is None and res["mensaje"] == "nada que escribir"
    assert [c["write"] for c in npm.llamadas] == [False]


def test_un_fallo_de_la_plataforma_sin_resumen_es_un_error_claro_y_no_sin_cambios(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    monkeypatch.setattr(opl, "ejecuta", NpmFalso(fallo="load:fondosdb"))
    with pytest.raises(opl.ErrorPlataforma, match="código 1 sin dejar plan.json.*se cayó"):
        opl.pasada_en_seco(base, plataforma, ["LU0000000002"], "alta")


def test_archivar_pasada_en_seco_y_archivo_con_recuento_copia_y_gate(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(existentes={"LU0000000001", "LU0000000002"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    seco = opl.archivar(base, plataforma, ["LU0000000001", "LU0000000009"], escribir=False, motivo="alta  errónea")
    assert seco["archivables"] == 1 and seco["no_existen"] == ["LU0000000009"] and seco["motivo"] == "alta errónea"
    assert [(f["isin"], f["accion"], f["subdocs"], f["en_indice"]) for f in seco["filas"]] == [
        ("LU0000000001", "ARCHIVE", 3, True), ("LU0000000009", "MISSING", 0, False)]
    assert npm.llamadas[-1]["write"] is False and npm.llamadas[-1]["gate"] is None
    # recuento distinto del aprobado -> no se archiva
    with pytest.raises(opl.ErrorPlataforma, match="se aprobaron 2"):
        opl.archivar(base, plataforma, ["LU0000000001", "LU0000000009"], escribir=True, esperado=2)
    assert all(not ll["write"] for ll in npm.llamadas)
    # copia caducada -> no se archiva
    with pytest.raises(opl.ErrorPlataforma, match="copia de la maestra"):
        opl.archivar(base, _plataforma(tmp_path / "vieja", backup_horas=30), ["LU0000000001"], escribir=True, esperado=1)
    res = opl.archivar(base, plataforma, ["LU0000000001", "LU0000000009"], escribir=True, esperado=1, motivo="alta errónea")
    assert npm.llamadas[-1]["write"] is True and npm.llamadas[-1]["gate"] == opl.GATE_VALOR
    assert res["escritura"]["archivados"] == 1 and res["escritura"]["postverify_ok"] == 1 and len(res["escritura"]["copias"]) == 1
    assert res["filas"][0]["postverify"]["ok"] is True
    assert "LU0000000001" not in npm.existentes
    assert opl.corridas(base)[0]["resumen"]["_fichero"] == "archive_summary.json"


def test_el_servicio_archiva_solo_tras_la_pasada_en_seco_y_retira_del_universo(servidor, monkeypatch):
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    monkeypatch.setattr(ops_server.ops, "canonico", lambda base, isins, log_cb=None: {"ok": 0, "errores": 0, "paquete_coherente": True, "fondos": []})
    base = Path(servidor.servicio.base)
    (base / "data" / "funds" / "LU0000000001.json").write_text("{}", encoding="utf-8")

    estado, _c, datos = _pide(servidor, "POST", "/api/ops/plataforma/archivar", {"isins": ["LU0000000001"], "aprobacion": 1})
    assert estado == 409 and "pasada en seco" in datos["error"]

    estado, _c, datos = _pide(servidor, "POST", "/api/ops/plataforma/archivar-seco", {"isins": ["LU0000000001"], "motivo": "duplicado"})
    assert estado == 200
    t = _espera(servidor, datos["tarea"]["id"])
    assert t["estado"] == "hecha" and t["resultado"]["archivables"] == 1

    estado, _c, datos = _pide(servidor, "POST", "/api/ops/plataforma/archivar", {"isins": ["LU0000000001"], "aprobacion": 2})
    assert estado == 409 and "se han aprobado 2" in datos["error"]

    estado, _c, datos = _pide(servidor, "POST", "/api/ops/plataforma/archivar", {"isins": ["LU0000000001"], "aprobacion": 1, "motivo": "duplicado"})
    assert estado == 200
    t = _espera(servidor, datos["tarea"]["id"])
    assert t["estado"] == "hecha", t["error"]
    r = t["resultado"]
    assert r["archivo"]["escritura"]["archivados"] == 1
    assert r["baja"] == [{"isin": "LU0000000001", "estaba": True, "ficheros_movidos": ["data/funds/LU0000000001.json"]}]
    assert r["canonico"]["paquete_coherente"] is True
    assert [f["isin"] for f in ops_server.ops.carga_fondos(base)] == []
    assert (base / "data" / "_papelera" / "funds" / "LU0000000001.json").exists()
    # la aprobación se consume: repetir exige otra pasada en seco
    assert _pide(servidor, "POST", "/api/ops/plataforma/archivar", {"isins": ["LU0000000001"], "aprobacion": 1})[0] == 409


def test_backup_y_corridas(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path, backup_horas=None)
    npm = NpmFalso()
    monkeypatch.setattr(opl, "ejecuta", npm)
    res = opl.backup(plataforma)
    assert res["copia"]["vigente"] is True and npm.llamadas[0]["script"] == "backup:export"
    opl.pasada_en_seco(base, plataforma, ["LU0000000002"], "alta")
    corridas = opl.corridas(base)
    assert len(corridas) == 1 and corridas[0]["tipo"] == "loader" and corridas[0]["resumen"]["_fichero"] == "plan.json"


@pytest.fixture
def servidor(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    cfg = json.loads((base / "config" / "settings.json").read_text(encoding="utf-8"))
    cfg["plataforma_dir"] = str(plataforma)
    (base / "config" / "settings.json").write_text(json.dumps(cfg), encoding="utf-8")
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    srv = ops_server.crea_servidor(base, 0)
    srv.npm = npm  # type: ignore[attr-defined]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    srv.shutdown()
    srv.server_close()


def _espera(srv, id_):
    for _ in range(100):
        _e, _c, t = _pide(srv, "GET", f"/api/ops/tareas/{id_}")
        if t["estado"] != "en_curso":
            return t
        time.sleep(0.05)
    raise AssertionError("la tarea no terminó")


def test_el_servicio_encadena_seco_y_escritura_con_aprobacion(servidor):
    estado, _c, d = _pide(servidor, "GET", "/api/ops/plataforma/estado")
    assert estado == 200 and d["scripts_ok"] and d["ultimo_backup"]["vigente"] is True

    # escribir sin pasada en seco previa
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/escribir", {"isins": ["LU0000000002"], "modo": "alta", "aprobacion": 1})
    assert estado == 409 and "primero la pasada en seco" in d["error"]

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/seco", {"isins": ["LU0000000002"], "modo": "alta"})
    assert estado == 200
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha" and t["resultado"]["escrituras"] == 1

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/escribir", {"isins": ["LU0000000002"], "modo": "alta", "aprobacion": 2})
    assert estado == 409 and "previó 1" in d["error"]
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/escribir", {"isins": ["LU0000000002"], "modo": "alta", "aprobacion": 1})
    assert estado == 200
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha" and t["resultado"]["escritura"]["escritura"]["escritos"] == 1
    assert t["resultado"]["auditoria"]["en_cero"] is True
    assert [c["gate"] for c in servidor.npm.llamadas if c["write"]] == [opl.GATE_VALOR]

    # la aprobación se consume: hay que repetir la pasada en seco
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/escribir", {"isins": ["LU0000000002"], "modo": "alta", "aprobacion": 1})
    assert estado == 409

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/auditar", {"isins": ["LU0000000002"]})
    assert estado == 200 and _espera(servidor, d["tarea"]["id"])["resultado"]["en_cero"] is True
    estado, _c, d = _pide(servidor, "GET", "/api/ops/plataforma/corridas")
    assert estado == 200 and len(d["corridas"]) >= 3


# --------------------------------------------------------------- ALTA-12
def test_la_alta_pide_metrics_y_la_pasada_en_seco_lista_los_documentos(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    res = opl.pasada_en_seco(base, plataforma, ["LU0000000001", "LU0000000002"], "alta")
    assert npm.llamadas[0]["targets"] == "root,holdings,metrics"
    assert res["escrituras"] == 1 and res["crear"] == ["LU0000000002"]
    fila = next(f for f in res["filas"] if f["isin"] == "LU0000000002")
    assert fila["documentos"] == ["assets/LU0000000002", "assets/LU0000000002/holdings/latest",
                                  "assets/LU0000000002/metrics/latest"]
    assert res["documentos"] == 3
    # los que ya existen no cuentan documentos: la alta no los toca
    assert next(f for f in res["filas"] if f["isin"] == "LU0000000001")["documentos"] == []


def test_sin_documents_en_el_plan_se_deducen_raiz_cartera_y_metricas():
    item = {"asset_id": "LU0000000002", "action": "CREATE", "root_path": "assets/LU0000000002",
            "holdings_path": None}
    assert opl._documentos(item) == ["assets/LU0000000002", "assets/LU0000000002/metrics/latest"]
    assert opl._documentos({"asset_id": "X", "action": "SKIP_EXISTS"}) is None


def test_la_escritura_de_la_alta_solo_manda_los_create_aprobados(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    res = opl.escribir(base, plataforma, ["LU0000000001", "LU0000000002"], "alta", 1, esperados=["LU0000000002"])
    escritura = [c for c in npm.llamadas if c["write"]]
    assert [(c["script"], c["ids"], c["targets"], c["gate"]) for c in escritura] == [
        ("load:fondosdb", "LU0000000002", "root,holdings,metrics", opl.GATE_VALOR)]
    assert res["escritura"]["escritura"]["escritos"] == 1


def test_la_escritura_de_la_alta_no_sigue_si_cambian_los_create_aunque_no_el_recuento(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(existentes={"LU0000000001"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    with pytest.raises(opl.ErrorPlataforma, match="se aprobó LU0000000003"):
        opl.escribir(base, plataforma, ["LU0000000001", "LU0000000002"], "alta", 1, esperados=["LU0000000003"])
    assert not any(c["write"] for c in npm.llamadas)


# --------------------------------------------------------------- ALTA-13
def test_reclasificar_en_seco_resume_por_isin_y_no_lleva_gate(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(acciones={"ES0105046009", "US0378331005"}, fondos_en_maestra={"ES0105046009"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    res = opl.reclasificar(base, plataforma, ["ES0105046009", "US0378331005", "LU0000000001"])
    assert res["reclasificables"] == 1 and res["escribir"] is False
    assert [(f["isin"], f["accion"]) for f in res["filas"]] == [
        ("ES0105046009", "RECLASSIFY"), ("US0378331005", "SKIP"), ("LU0000000001", "SKIP")]
    assert "no está en la maestra" in res["filas"][1]["motivo"]
    assert "extrae y regenera el canónico" in res["filas"][2]["motivo"]
    assert res["filas"][0]["metricas"] == "MARK" and res["filas"][0]["quita"] == ["costs"]
    assert npm.llamadas == [{"script": "reclassify:stock", "write": False, "gate": None,
                             "ids": "ES0105046009,US0378331005,LU0000000001", "targets": None}]


def test_reclasificar_sin_paquete_coherente_no_llama_a_la_plataforma(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base, coherente=False)
    npm = NpmFalso()
    monkeypatch.setattr(opl, "ejecuta", npm)
    with pytest.raises(opl.ErrorPlataforma, match="mismo snapshot"):
        opl.reclasificar(base, _plataforma(tmp_path), ["ES0105046009"])
    assert npm.llamadas == []


def test_reclasificar_en_la_maestra_exige_copia_recuento_e_isin_y_solo_entonces_el_gate(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    npm = NpmFalso(acciones={"ES0105046009"}, fondos_en_maestra={"ES0105046009"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    with pytest.raises(opl.ErrorPlataforma, match="copia"):
        opl.reclasificar(base, _plataforma(tmp_path / "vieja", backup_horas=30), ["ES0105046009"], escribir=True, esperado=1)
    plataforma = _plataforma(tmp_path)
    with pytest.raises(opl.ErrorPlataforma, match="se aprobaron 2"):
        opl.reclasificar(base, plataforma, ["ES0105046009"], escribir=True, esperado=2)
    with pytest.raises(opl.ErrorPlataforma, match="se aprobó US0378331005"):
        opl.reclasificar(base, plataforma, ["ES0105046009"], escribir=True, esperado=1, esperados=["US0378331005"])
    assert not any(c["write"] for c in npm.llamadas)

    npm.llamadas.clear()
    res = opl.reclasificar(base, plataforma, ["ES0105046009"], escribir=True, esperado=1, esperados=["ES0105046009"])
    assert [(c["script"], c["write"], c["gate"]) for c in npm.llamadas] == [
        ("reclassify:stock", False, None), ("reclassify:stock", True, opl.GATE_VALOR), ("audit:consistency", False, None)]
    assert res["escritura"]["escritos"] == 1 and res["escritura"]["postverify_ok"] == 1
    assert res["filas"][0]["postverify"]["ok"] is True and res["auditoria"]["en_cero"] is True
    # ya es acción: la pasada de ahora da 0 y con 0 aprobado no se escribe
    npm.llamadas.clear()
    res = opl.reclasificar(base, plataforma, ["ES0105046009"], escribir=True, esperado=0)
    assert res["mensaje"] == "nada que reclasificar" and [c["write"] for c in npm.llamadas] == [False]


def test_reclasificar_lee_el_resumen_de_una_plataforma_sin_plan_por_isin():
    resumen = {"reclassified": [{"asset_id": "ES0105046009", "from": "FUND", "to": "STOCK", "dropped": ["costs"]}],
               "errors": [{"asset_id": "IE0000000002", "error": "expected no valida"}]}
    filas = opl._filas_reclasificacion(["ES0105046009", "IE0000000002", "LU0000000001"], resumen, None)
    assert [(f["isin"], f["accion"]) for f in filas] == [
        ("ES0105046009", "RECLASSIFY"), ("IE0000000002", "ERROR"), ("LU0000000001", "SKIP")]
    # el motivo va en español; el texto de la plataforma, aparte
    assert filas[1]["motivo"] == "la plataforma no pudo reclasificarlo" and filas[1]["error"] == "expected no valida"


def test_los_errores_y_bloqueos_de_la_reclasificacion_se_explican_en_espanol():
    plan = [
        {"asset_id": "A", "action": "ERROR", "error": "RECLASSIFY_CONCURRENT_MODIFICATION: assets/A cambió"},
        {"asset_id": "B", "action": "ERROR", "error": "el documento nuevo no valida master.asset-stock.v1.1: /identity name"},
        {"asset_id": "C", "action": "SKIP", "reason": "NOT_READY", "blockers": ["MISSING_TICKER", "FONDOSDB_BLOCKED"]},
        {"asset_id": "D", "action": "REPAIR", "reason": "ALREADY_STOCK", "repairs": ["search_index", "metrics_latest"]},
    ]
    filas = opl._filas_reclasificacion(["A", "B", "C", "D"], {}, plan)
    assert filas[0]["motivo"].startswith("la ficha o sus métricas cambiaron") and filas[0]["error"].startswith("RECLASSIFY_CONCURRENT")
    assert filas[1]["motivo"] == "la ficha de acción no cumple el contrato de la maestra"
    assert filas[2]["motivo"] == "la alta lo bloquearía: MISSING_TICKER, FONDOSDB_BLOCKED" and filas[2]["error"] is None
    assert filas[3]["motivo"] == "ya es acción, pero el buscador aún lo da por fondo y conserva métricas de fondo"


def test_las_reparaciones_cuentan_en_el_recuento_aprobado_y_se_listan_las_carteras(tmp_path, monkeypatch):
    base = _base(tmp_path / "extractor")
    _paquete(base)
    plataforma = _plataforma(tmp_path)
    npm = NpmFalso(acciones={"ES0105046009", "US0378331005"}, fondos_en_maestra={"ES0105046009"}, a_reparar={"US0378331005"})
    monkeypatch.setattr(opl, "ejecuta", npm)
    seco = opl.reclasificar(base, plataforma, ["ES0105046009", "US0378331005"])
    assert seco["reclasificables"] == 2 and seco["recuento"]["a_reclasificar"] == 1 and seco["recuento"]["a_reparar"] == 1
    assert seco["carteras_colgando"] == [{"isin": "US0378331005", "rutas": ["assets/US0378331005/holdings/latest"]}]
    res = opl.reclasificar(base, plataforma, ["ES0105046009", "US0378331005"], escribir=True, esperado=2,
                           esperados=["ES0105046009", "US0378331005"])
    assert [c["ids"] for c in npm.llamadas if c["write"]] == ["ES0105046009,US0378331005"]
    assert res["escritura"]["reparados"] == 1


def test_el_servicio_reclasifica_en_la_maestra_tras_la_pasada_en_seco(servidor, monkeypatch):
    base = Path(servidor.servicio.base)
    servidor.npm.acciones = {"LU0000000001"}
    servidor.npm.fondos_en_maestra = {"LU0000000001"}
    preparado: list = []
    monkeypatch.setattr(ops_server.ops, "extrae", lambda b, isins, force, sin_hist, log_cb=None, avanza=None: preparado.append(("extrae", isins)) or [])
    monkeypatch.setattr(ops_server.ops, "canonico", lambda b, isins, log_cb=None: preparado.append(("canonico", isins)) or {})

    # en fondos.csv sigue como fondo: no se puede reclasificar a acción en la maestra
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar-seco", {"isins": ["LU0000000001"]})
    assert estado == 400 and "cambia antes el tipo a acción" in d["error"]
    estado, _c, d = _pide(servidor, "POST", "/api/ops/reclasificar", {"isin": "LU0000000001", "tipo": "accion"})
    assert estado == 200 and d["tipo_anterior"] == "fondo" and "reclasificar en la maestra" in d["siguiente"]
    assert ops_server.ops.carga_fondos(base)[0]["tipo"] == "accion"

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar", {"isins": ["LU0000000001"], "aprobacion": 1})
    assert estado == 409 and "pasada en seco" in d["error"]

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar-seco", {"isins": ["LU0000000001"]})
    assert estado == 200
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha", t["error"]
    assert t["resultado"]["reclasificables"] == 1
    # su canónico ya es de acción: no se vuelve a extraer (ni a salir a red)
    assert preparado == []

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar", {"isins": ["LU0000000001"], "aprobacion": 2})
    assert estado == 409 and "se han aprobado 2" in d["error"]
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar", {"isins": ["LU0000000001"], "aprobacion": 1})
    assert estado == 200
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha", t["error"]
    assert t["resultado"]["escritura"]["escritos"] == 1
    assert [c["gate"] for c in servidor.npm.llamadas if c["write"]] == [opl.GATE_VALOR]
    # la aprobación se consume
    assert _pide(servidor, "POST", "/api/ops/plataforma/reclasificar", {"isins": ["LU0000000001"], "aprobacion": 1})[0] == 409


def test_el_servicio_aprueba_la_alta_por_los_create_de_la_pasada_en_seco(servidor):
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/seco", {"isins": ["LU0000000001", "LU0000000002"], "modo": "alta"})
    t = _espera(servidor, d["tarea"]["id"])
    assert t["resultado"]["crear"] == ["LU0000000002"]
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/escribir",
                          {"isins": ["LU0000000001", "LU0000000002"], "modo": "alta", "aprobacion": 1})
    assert estado == 200
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha", t["error"]
    assert [c["ids"] for c in servidor.npm.llamadas if c["write"]] == ["LU0000000002"]


def test_preparar_solo_extrae_lo_que_aun_no_tiene_canonico_de_accion(servidor, monkeypatch):
    base = Path(servidor.servicio.base)
    for isin in ("LU0000000002", "LU0000000003"):
        ops_server.ops._anade_a_universo(base, isin, isin, "accion")
    ops_server.ops.reclasifica(base, "LU0000000001", "accion")
    npm = servidor.npm
    npm.acciones = {"LU0000000003"}              # LU..3 ya tiene canónico de acción
    npm.fondos_en_maestra = {"LU0000000002", "LU0000000003"}
    npm.a_reparar = {"LU0000000001"}             # LU..1 ya es acción en la maestra
    preparado: list = []

    def extrae(b, isins, force, sin_hist, log_cb=None, avanza=None):
        preparado.append(("extrae", isins))
        npm.acciones |= set(isins)                # al extraer como acción, el canónico pasa a acción
        return []
    monkeypatch.setattr(ops_server.ops, "extrae", extrae)
    monkeypatch.setattr(ops_server.ops, "canonico", lambda b, isins, log_cb=None: preparado.append(("canonico", isins)) or {})

    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar-seco",
                          {"isins": ["LU0000000001", "LU0000000002", "LU0000000003"]})
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha", t["error"]
    assert preparado == [("extrae", ["LU0000000002"]), ("canonico", ["LU0000000002"])]
    assert t["resultado"]["reclasificables"] == 3      # 2 reclasificaciones y 1 reparación del buscador

    # sin preparar: solo la pasada en seco
    preparado.clear()
    npm.acciones.discard("LU0000000002")
    estado, _c, d = _pide(servidor, "POST", "/api/ops/plataforma/reclasificar-seco",
                          {"isins": ["LU0000000002"], "preparar": False})
    t = _espera(servidor, d["tarea"]["id"])
    assert t["estado"] == "hecha", t["error"]
    assert preparado == [] and t["resultado"]["filas"][0]["razon"] == "NO_STOCK_CANONICAL"
