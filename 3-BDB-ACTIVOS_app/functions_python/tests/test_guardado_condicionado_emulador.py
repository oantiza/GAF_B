# -*- coding: utf-8 -*-
"""
DIS-03 contra un emulador de Firestore de verdad: la precondicion `last_update_time` rechaza la escritura
cuando otro cliente ha escrito entre la lectura y la escritura, en el almacen de la base nueva. La del almacen de la base
vieja (`FirestorePortfolioStore`) se fue con el el 21-11-2026 (decision 31 del censo CENSO_BASE_VIEJA_2026-11-21.md).

Se salta sola salvo que se cumpla todo esto:
  - FIRESTORE_EMULATOR_HOST esta puesta (el cliente habla con el emulador, nunca con la nube);
  - PRUEBA_DIS03_PROYECTO vale exactamente `gestor-activos-local`.

El cliente se crea con ese proyecto y con credenciales anonimas: sin una clave real no puede escribir en
ninguna base de la nube. Todo se escribe bajo identificadores unicos `prueba-dis03-<aleatorio>` y se borra
al acabar, tambien si la prueba falla.

El proyecto sigue siendo `gestor-activos-local` a proposito: no existe en la nube, y en un emulador es un espacio aparte
del de la base nueva, asi que la prueba no toca sus datos. Se lanza con un emulador de Firestore arrancado (el de la base
nueva, 8092, sirve), desde 3-BDB-ACTIVOS_app:
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8092 PRUEBA_DIS03_PROYECTO=gestor-activos-local \
    python -m pytest functions_python/tests/test_guardado_condicionado_emulador.py -q -p no:cacheprovider
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

PROYECTO_DE_PRUEBA = "gestor-activos-local"
HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "").strip()

pytestmark = pytest.mark.skipif(
    not HOST or os.environ.get("PRUEBA_DIS03_PROYECTO") != PROYECTO_DE_PRUEBA,
    reason="Solo contra el emulador: hacen falta FIRESTORE_EMULATOR_HOST y PRUEBA_DIS03_PROYECTO=gestor-activos-local.",
)

ISIN_A, ISIN_B = "BE0943877671", "LU0171289902"
ABIERTA_A_LAS = "2026-11-14T09:00:00+00:00"


def _cliente():
    """Otro cliente cada vez: dos clientes son dos equipos que guardan la misma cartera."""
    if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        pytest.skip("Sin FIRESTORE_EMULATOR_HOST no se crea ningun cliente.")
    from google.auth.credentials import AnonymousCredentials
    from google.cloud import firestore

    return firestore.Client(project=PROYECTO_DE_PRUEBA, credentials=AnonymousCredentials())


def _identificador():
    return f"prueba-dis03-{uuid.uuid4().hex[:12]}"


def _borrar(ref):
    for coleccion in ref.collections():
        for hijo in coleccion.stream():
            _borrar(hijo.reference)
    ref.delete()


@pytest.fixture
def escritos():
    """Las raices que la prueba ha escrito; se borran con todo lo que cuelga de ellas, pase lo que pase."""
    db = _cliente()
    raices = []
    try:
        yield db, raices
    finally:
        for ruta in raices:
            _borrar(db.document(ruta))


def _payload(pid, nombre, esperada=None, posiciones=None):
    datos = {
        "portfolio_id": pid,
        "name": nombre,
        "positions": posiciones or [{"asset_id": ISIN_A, "weight_percent": 100}],
    }
    if esperada is not None:
        datos["expected_updated_at"] = esperada
    return datos


def _otra_escritura_en_medio(monkeypatch, modulo, escribir):
    """Escribe con otro cliente justo despues de la lectura y antes de la escritura condicionada."""
    original = modulo.precondicion
    pendiente = [escribir]

    def con_otra_en_medio(db, snap):
        opcion = original(db, snap)
        # Una sola vez: desde el 20-11-2026 el guardado sin condicion de la base nueva tambien lleva precondicion, y la
        # escritura del otro equipo volveria a pasar por aqui.
        if pendiente:
            pendiente.pop()()
        return opcion

    monkeypatch.setattr(modulo, "precondicion", con_otra_en_medio)


def test_base_nueva_la_precondicion_real_rechaza_el_lote_entero_si_otro_ha_escrito(escritos, monkeypatch):
    from portfolios import almacen_base_nueva as modulo
    from portfolios import repository as repo
    from portfolios.almacen_base_nueva import AlmacenCarterasBaseNueva

    db, raices = escritos
    uid, pid = _identificador(), _identificador()
    raices.append(f"portfolios/{pid}")
    almacen = AlmacenCarterasBaseNueva(db)
    repo.save_portfolio(almacen, uid, _payload(pid, "Abierta", posiciones=[
        {"asset_id": ISIN_A, "weight_percent": 60}, {"asset_id": ISIN_B, "weight_percent": 40},
    ]), now=ABIERTA_A_LAS)

    # Con la fecha correcta: raiz y objetivos escritos, el que sobra borrado.
    repo.save_portfolio(almacen, uid, _payload(pid, "Revisada", ABIERTA_A_LAS), now="2026-11-14T10:00:00+00:00")
    guardada = almacen.get(uid, pid)
    assert guardada["name"] == "Revisada"
    assert [p["asset_id"] for p in guardada["positions"]] == [ISIN_A]

    # Sobre una que no existe: conflicto, y no se crea.
    with pytest.raises(repo.PortfolioConflict) as eliminada:
        repo.save_portfolio(almacen, uid, _payload(_identificador(), "Nueva", ABIERTA_A_LAS))
    assert eliminada.value.reason == "deleted"

    # Otro equipo guarda entre la lectura y el commit, con la misma fecha: el lote entero se rechaza.
    otro = AlmacenCarterasBaseNueva(_cliente())
    _otra_escritura_en_medio(monkeypatch, modulo, lambda: repo.save_portfolio(
        otro, uid, _payload(pid, "Del otro equipo", posiciones=[{"asset_id": ISIN_B, "weight_percent": 100}]),
        now="2026-11-14T10:00:00+00:00"))
    with pytest.raises(repo.PortfolioConflict) as carrera:
        repo.save_portfolio(almacen, uid, _payload(pid, "De este", "2026-11-14T10:00:00+00:00"))
    assert carrera.value.reason == "changed"
    guardada = almacen.get(uid, pid)
    assert guardada["name"] == "Del otro equipo"
    # Ni la raiz ni un objetivo de este: queda solo el del otro equipo.
    assert [p["asset_id"] for p in guardada["positions"]] == [ISIN_B]


def test_base_nueva_sin_condicion_otro_guardado_en_medio_no_deja_objetivos_mezclados(escritos, monkeypatch):
    """20-11-2026: el guardado sin condicion (nueva, o sobrescribir tras un conflicto) tambien va atado a lo leido. El otro
    equipo guarda {A, B} entre la lectura y la escritura de este, que guarda {A}: la precondicion real lo rechaza, se vuelve a
    leer, y queda lo de este entero, sin el objetivo B del otro."""
    from portfolios import almacen_base_nueva as modulo
    from portfolios import repository as repo
    from portfolios.almacen_base_nueva import AlmacenCarterasBaseNueva

    db, raices = escritos
    uid, pid = _identificador(), _identificador()
    raices.append(f"portfolios/{pid}")
    almacen = AlmacenCarterasBaseNueva(db)
    repo.save_portfolio(almacen, uid, _payload(pid, "Abierta"), now=ABIERTA_A_LAS)
    otro = AlmacenCarterasBaseNueva(_cliente())
    _otra_escritura_en_medio(monkeypatch, modulo, lambda: repo.save_portfolio(
        otro, uid, _payload(pid, "Del otro equipo", posiciones=[
            {"asset_id": ISIN_A, "weight_percent": 60}, {"asset_id": ISIN_B, "weight_percent": 40}]),
        now="2026-11-14T10:00:00+00:00"))
    repo.save_portfolio(almacen, uid, _payload(pid, "De este"), now="2026-11-14T11:00:00+00:00")
    guardada = almacen.get(uid, pid)
    assert guardada["name"] == "De este"
    assert [(p["asset_id"], p["weight_percent"]) for p in guardada["positions"]] == [(ISIN_A, 100.0)]
