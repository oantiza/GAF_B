# -*- coding: utf-8 -*-
"""El productor conoce el contrato que promete.

El SSOT de esquemas vive en `2-plataforma-datos/contracts/` e incluye
`canonical/fondosdb-fund.v1`, que describe exactamente lo que este proyecto
escribe en `export_bdb/`. Hasta el 04-09 el extractor no lo referenciaba: un
cambio de forma se detectaba tres saltos aguas abajo, en el cargador, con el
paquete ya generado (auditoría 03-09, hallazgo 07).
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core import calidad, contratos  # noqa: E402
from core.adaptador_bdb import convierte  # noqa: E402
from tests.test_adaptador_validacion import _fondo_sano  # noqa: E402


def test_la_copia_local_cuadra_con_su_manifiesto():
    # Sin esto, la copia podría haber divergido del SSOT sin que nadie lo note.
    assert contratos.verifica_cache() == 3


def test_el_manifiesto_declara_los_hashes_reales():
    manifiesto = json.loads(contratos.MANIFEST.read_text(encoding="utf-8"))
    assert manifiesto["schema_version"] == contratos.MANIFEST_VERSION
    for nombre, esperado in manifiesto["files"].items():
        real = contratos.sha256((contratos.CACHE_DIR / nombre).read_bytes())
        assert real == esperado, nombre


def test_un_fondo_generado_cumple_su_contrato():
    d = _fondo_sano()
    calidad.aplica(d)
    contratos.valida(convierte(d))


def test_una_accion_generada_cumple_su_contrato():
    d = {
        "meta": {"isin": "US0378331005", "actualizado": "2026-09-01"},
        "identificacion": {"nombre": "Apple Inc", "tipo": "accion",
                           "divisa_base": "USD", "ticker": "AAPL", "mercado": "US"},
        "valoracion": {"vl": 200.0},
    }
    calidad.aplica(d)
    contratos.valida(convierte(d))


def test_una_forma_rota_se_detecta_aqui():
    # Es el caso que motivó la tarea: si el adaptador cambia un tipo, tiene que
    # saltar en el productor, no en el cargador de la plataforma.
    d = _fondo_sano()
    calidad.aplica(d)
    canonico = convierte(d)
    canonico["isin"] = 12345  # el contrato lo declara string

    with pytest.raises(contratos.ContratoInvalido) as exc:
        contratos.valida(canonico)
    assert "isin" in str(exc.value)


def test_el_esquema_se_elige_por_poblacion():
    fondo = _fondo_sano()
    calidad.aplica(fondo)
    assert contratos.esquema_para(convierte(fondo)) == contratos.ESQUEMA_FONDO

    accion = {
        "meta": {"isin": "US0378331005", "actualizado": "2026-09-01"},
        "identificacion": {"nombre": "Apple Inc", "tipo": "accion"},
    }
    calidad.aplica(accion)
    assert contratos.esquema_para(convierte(accion)) == contratos.ESQUEMA_ACCION


def test_una_accion_se_reconoce_por_su_clasificacion_aunque_falte_ms_stock():
    # Auditoría 16-10, BAJA-06: la primera condición (asset_class "Accion")
    # nunca se cumplía y todo dependía de ms.stock.
    accion = {"meta": {"isin": "US0378331005", "actualizado": "2026-09-01"},
              "identificacion": {"nombre": "Apple Inc", "tipo": "accion"}}
    calidad.aplica(accion)
    canonico = convierte(accion)
    assert canonico["classification_v2"]["asset_type"] == "stock"
    canonico["ms"].pop("stock")
    assert contratos.esquema_para(canonico) == contratos.ESQUEMA_ACCION
    assert contratos.esquema_para({"classification_v2": {"asset_type": "equity"}}) == contratos.ESQUEMA_FONDO


def test_un_contrato_que_no_esta_se_dice_claro():
    with pytest.raises(contratos.ContratoNoDisponible):
        contratos.valida({}, nombre="no-existe.v9.schema.json")


# --- Fin de línea (auditoría 16-10, CRIT-08) -------------------------------
# Con `core.autocrlf=true` (el valor de sistema en Windows) un clon nuevo saca
# los esquemas en CRLF. Con el hash de bytes crudos la caché «no cuadraba» y
# `exporta_bdb` se saltaba la validación sin ruido.

def _lf(datos: bytes) -> bytes:
    # A propósito no se usa contratos.normaliza: así, sobre master (sin ella),
    # estos tests fallan por el hash y no por un AttributeError.
    return datos.replace(b"\r\n", b"\n")


def _copia_cache(destino: Path, *, crlf: bool) -> Path:
    destino.mkdir(parents=True)
    for origen in contratos.CACHE_DIR.glob("*.json"):
        datos = _lf(origen.read_bytes())
        if crlf:
            datos = datos.replace(b"\n", b"\r\n")
        (destino / origen.name).write_bytes(datos)
    return destino


@pytest.fixture
def cache_crlf(tmp_path, monkeypatch):
    cache = _copia_cache(tmp_path / "cache", crlf=True)
    monkeypatch.setattr(contratos, "CACHE_DIR", cache)
    monkeypatch.setattr(contratos, "MANIFEST", cache / "manifest.json")
    return cache


def test_un_esquema_en_crlf_verifica_igual_que_en_lf(cache_crlf):
    esquema = cache_crlf / contratos.ESQUEMA_FONDO
    assert b"\r\n" in esquema.read_bytes()
    assert contratos.verifica_cache() == 3
    lf = _lf(esquema.read_bytes())
    assert contratos.sha256(esquema.read_bytes()) == contratos.sha256(lf)


def test_un_cambio_real_de_contenido_sigue_fallando(cache_crlf):
    esquema = cache_crlf / contratos.ESQUEMA_FONDO
    datos = esquema.read_bytes()
    assert b'"title"' in datos
    esquema.write_bytes(datos.replace(b'"title"', b'"description"', 1))
    with pytest.raises(contratos.ContratoNoDisponible, match="Hash de contrato no coincide"):
        contratos.verifica_cache()


def _carga_sync_contratos():
    spec = importlib.util.spec_from_file_location(
        "sync_contratos_prueba", RAIZ / "tools" / "sync_contratos.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


@pytest.fixture
def sync_con_ssot(tmp_path, monkeypatch, cache_crlf):
    """`sync_contratos` con la cache en CRLF y un SSOT en LF de prueba."""
    ssot = tmp_path / "ssot"
    ssot.mkdir()
    for nombre in contratos.nombres_esquema(cache_crlf):
        (ssot / nombre).write_bytes(_lf((cache_crlf / nombre).read_bytes()))
    sync = _carga_sync_contratos()
    monkeypatch.setattr(sync, "CACHE_DIR", cache_crlf)
    monkeypatch.setattr(sync, "MANIFEST", cache_crlf / "manifest.json")
    monkeypatch.setenv("BDB_CONTRACTS_CANONICAL", str(ssot))
    monkeypatch.setattr(sys, "argv", ["sync_contratos.py", "--check"])
    return sync, ssot


def test_check_contra_el_ssot_ignora_el_fin_de_linea(sync_con_ssot):
    sync, _ = sync_con_ssot
    assert sync.main() == 0


def test_check_contra_el_ssot_detecta_un_cambio_real(sync_con_ssot):
    sync, ssot = sync_con_ssot
    esquema = ssot / contratos.ESQUEMA_FONDO
    esquema.write_bytes(esquema.read_bytes().replace(b'"title"', b'"description"', 1))
    with pytest.raises(SystemExit, match="desactualizada"):
        sync.main()


def test_sincronizar_desde_un_ssot_en_crlf_escribe_lf_y_conserva_los_hashes(sync_con_ssot, monkeypatch):
    sync, ssot = sync_con_ssot
    hashes_antes = json.loads(contratos.MANIFEST.read_text(encoding="utf-8"))["files"]
    for esquema in ssot.glob("*.schema.json"):
        esquema.write_bytes(esquema.read_bytes().replace(b"\n", b"\r\n"))
    monkeypatch.setattr(sys, "argv", ["sync_contratos.py"])
    assert sync.main() == 0
    for nombre in hashes_antes:
        assert b"\r\n" not in (contratos.CACHE_DIR / nombre).read_bytes(), nombre
    assert b"\r\n" not in contratos.MANIFEST.read_bytes()
    assert json.loads(contratos.MANIFEST.read_text(encoding="utf-8"))["files"] == hashes_antes


# --- exporta_bdb falla cerrado (decisión de Óscar, 17-10, 6.7a) ----------------
# Hasta aquí, si la caché no cuadraba, se avisaba y se exportaba sin validar
# (`contrato_verificado: false`, que nadie leía).

def _base_con_un_fondo(base: Path) -> Path:
    d = _fondo_sano()
    calidad.aplica(d)
    (base / "data" / "funds").mkdir(parents=True)
    (base / "data" / "funds" / f"{d['meta']['isin']}.json").write_text(json.dumps(d), encoding="utf-8")
    return base


def _altera(cache: Path) -> None:
    esquema = cache / contratos.ESQUEMA_FONDO
    esquema.write_bytes(esquema.read_bytes().replace(b'"title"', b'"description"', 1))


def test_exporta_bdb_aborta_sin_escribir_si_la_cache_no_cuadra(tmp_path, cache_crlf):
    from core import adaptador_bdb

    base = _base_con_un_fondo(tmp_path / "base")
    _altera(cache_crlf)
    with pytest.raises(adaptador_bdb.ExportacionAbortada) as exc:
        adaptador_bdb.genera(base)
    mensaje = str(exc.value)
    assert "Exportación a BDB abortada" in mensaje and "Hash de contrato no coincide" in mensaje
    assert "No se ha escrito nada en export_bdb/" in mensaje
    assert not (base / "export_bdb").exists()


def test_un_paquete_anterior_se_queda_intacto_si_se_aborta(tmp_path, cache_crlf):
    from core import adaptador_bdb

    base = _base_con_un_fondo(tmp_path / "base")
    res = adaptador_bdb.genera(base)              # caché en CRLF: cuadra
    resumen = json.loads((base / "export_bdb" / "_resumen.json").read_text(encoding="utf-8"))
    assert res["ok"] == 1 and resumen["contrato_verificado"] is True
    antes = {p.name: p.read_bytes() for p in (base / "export_bdb").iterdir()}

    (cache_crlf / "manifest.json").unlink()        # caché incompleta
    with pytest.raises(adaptador_bdb.ExportacionAbortada, match="Falta el manifiesto"):
        adaptador_bdb.genera(base)
    assert {p.name: p.read_bytes() for p in (base / "export_bdb").iterdir()} == antes


def test_la_tarea_de_operaciones_muestra_el_motivo(tmp_path, cache_crlf):
    import time

    from core import ops

    base = _base_con_un_fondo(tmp_path / "base")
    _altera(cache_crlf)
    tarea = ops.Cola().lanza("canonico", lambda t: ops.canonico(base, [], t.linea))
    for _ in range(100):
        if tarea.estado != "en_curso":
            break
        time.sleep(0.05)
    assert tarea.estado == "error"
    assert tarea.error.startswith("Exportación a BDB abortada")
    assert any(linea.startswith("ERROR: Exportación a BDB abortada") for linea in tarea.log)
    assert not (base / "export_bdb").exists() and not (base / "export").exists()


@pytest.mark.parametrize("averia", ["manifiesto_con_merge", "esquema_con_merge", "esquema_no_utf8"])
def test_una_cache_danada_aborta_con_un_mensaje_legible(tmp_path, cache_crlf, averia):
    # Revisión de la quinta pasada, MEN-1: con JSON roto o un fichero que no está
    # en UTF-8 salía «Expecting value: line 1 column 1» o «'utf-8' codec can't decode».
    from core import adaptador_bdb

    base = _base_con_un_fondo(tmp_path / "base")
    if averia == "manifiesto_con_merge":
        ruta = cache_crlf / "manifest.json"
        ruta.write_bytes(b"<<<<<<< HEAD\n" + ruta.read_bytes() + b"=======\n>>>>>>> otra\n")
    elif averia == "esquema_con_merge":
        ruta = cache_crlf / contratos.ESQUEMA_FONDO
        ruta.write_bytes(b"<<<<<<< HEAD\n" + ruta.read_bytes())
    else:
        ruta = cache_crlf / contratos.ESQUEMA_ACCION
        ruta.write_bytes(ruta.read_bytes().replace(b'"title"', b'"t\xedtle"', 1))   # latin-1
    with pytest.raises(adaptador_bdb.ExportacionAbortada) as exc:
        adaptador_bdb.genera(base)
    mensaje = str(exc.value)
    assert "la caché de contratos está dañada" in mensaje and ruta.name in mensaje
    assert "No se ha escrito nada en export_bdb/" in mensaje
    assert not (base / "export_bdb").exists()
