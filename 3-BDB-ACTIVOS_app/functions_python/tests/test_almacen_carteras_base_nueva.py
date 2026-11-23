# -*- coding: utf-8 -*-
"""Las carteras del asesor en la base nueva, con su aislamiento por `advisor_id`."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402
from google.api_core.exceptions import Conflict, FailedPrecondition, NotFound  # noqa: E402
from google.cloud.firestore_v1 import DELETE_FIELD  # noqa: E402

from portfolios import repository as repo  # noqa: E402
from portfolios.almacen_base_nueva import AlmacenCarterasBaseNueva  # noqa: E402

ASESOR, OTRO = "asesor-1", "asesor-2"
A, B = "BE0943877671", "LU0171289902"


class _Snap:
    def __init__(self, ref):
        self.reference, self.id = ref, ref.id
        self._datos = ref.db.datos.get(ref.ruta)
        self.exists = self._datos is not None
        self.update_time = ref.db.tiempos.get(ref.ruta)

    def to_dict(self):
        return dict(self._datos) if self._datos is not None else None


class _Ref:
    def __init__(self, db, ruta):
        self.db, self.ruta, self.id = db, ruta, ruta.split("/")[-1]

    @property
    def parent(self):
        return _Col(self.db, self.ruta.rsplit("/", 1)[0])

    def collection(self, nombre):
        return _Col(self.db, f"{self.ruta}/{nombre}")

    def get(self):
        return _Snap(self)


class _Col:
    def __init__(self, db, ruta, filtro=None):
        self.db, self.ruta, self.filtro = db, ruta, filtro

    @property
    def parent(self):
        return _Ref(self.db, self.ruta.rsplit("/", 1)[0])

    def document(self, ident):
        return _Ref(self.db, f"{self.ruta}/{ident}")

    def where(self, campo, _op, valor):
        return _Col(self.db, self.ruta, (campo, valor))

    def _cumple(self, ruta):
        return self.filtro is None or self.db.datos[ruta].get(self.filtro[0]) == self.filtro[1]

    def count(self):
        total = len(self.stream())
        self.db.agregaciones += 1

        class _Agregado:
            def get(_self):
                return [[type("Valor", (), {"value": total})()]]

        return _Agregado()

    def stream(self):
        if self.ruta.startswith("*/"):
            grupo = self.ruta[2:]
            rutas = [r for r in self.db.datos if r.split("/")[-2] == grupo]
        else:
            prefijo = self.ruta + "/"
            rutas = [r for r in self.db.datos if r.startswith(prefijo) and "/" not in r[len(prefijo):]]
        return [_Snap(_Ref(self.db, r)) for r in rutas if self._cumple(r)]


class _Opcion:
    def __init__(self, last_update_time):
        self.last_update_time = last_update_time


class _Lote:
    """Como el de Firestore: o se escribe todo o nada, y una precondicion que falla tumba el lote entero."""

    def __init__(self, db):
        self.db, self.ops = db, []

    def set(self, ref, datos):
        self.ops.append(("set", ref.ruta, datos, None))

    def create(self, ref, datos):
        self.ops.append(("create", ref.ruta, datos, None))

    def update(self, ref, cambios, option=None):
        self.ops.append(("update", ref.ruta, cambios, option))

    def delete(self, ref, option=None):
        self.ops.append(("del", ref.ruta, None, option))

    def commit(self):
        if self.db.antes_del_commit:
            otra, self.db.antes_del_commit = self.db.antes_del_commit, None
            otra()
        for op, ruta, _datos, opcion in self.ops:
            if op == "create" and ruta in self.db.datos:
                raise Conflict("ya existe")
            if op == "del" and opcion is not None:
                if ruta not in self.db.datos or opcion.last_update_time != self.db.tiempos.get(ruta):
                    raise FailedPrecondition("la precondicion no se cumple")
            if op != "update":
                continue
            if ruta not in self.db.datos:
                raise NotFound("no existe")
            if opcion is not None and opcion.last_update_time != self.db.tiempos.get(ruta):
                raise FailedPrecondition("la precondicion no se cumple")
        self.db.reloj += 1
        for op, ruta, datos, _opcion in self.ops:
            if op in ("set", "create"):
                self.db.datos[ruta] = dict(datos)
            elif op == "update":
                nuevo = dict(self.db.datos[ruta])
                for campo, valor in datos.items():
                    campo = campo.strip("`")
                    if valor is DELETE_FIELD:
                        nuevo.pop(campo, None)
                    else:
                        nuevo[campo] = valor
                self.db.datos[ruta] = nuevo
            else:
                self.db.datos.pop(ruta, None)
                self.db.tiempos.pop(ruta, None)
                continue
            self.db.tiempos[ruta] = self.db.reloj


class _Db:
    def __init__(self):
        self.datos, self.tiempos, self.reloj = {}, {}, 0
        self.antes_del_commit = None
        self.agregaciones = 0

    def collection(self, nombre):
        return _Col(self, nombre)

    def collection_group(self, nombre):
        return _Col(self, f"*/{nombre}")

    def batch(self):
        return _Lote(self)

    def write_option(self, **kwargs):
        assert set(kwargs) == {"last_update_time"}
        return _Opcion(kwargs["last_update_time"])


def _guardar(almacen, uid=ASESOR, posiciones=None, pid="c1", **extra):
    return repo.save_portfolio(almacen, uid, {
        "portfolio_id": pid, "name": "Prudente", "total_capital": 100000,
        "positions": posiciones if posiciones is not None else [
            {"asset_id": A, "weight_percent": 60, "keep_euros": False, "target_euros": 60000},
            {"asset_id": B, "weight_percent": 40},
        ], **extra,
    }, now="2026-11-03T10:00:00+00:00")


def test_guarda_con_la_forma_del_contrato_y_devuelve_la_de_la_app():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    raiz = db.datos["portfolios/c1"]
    assert (raiz["kind"], raiz["status"], raiz["advisor_id"]) == ("MODEL", "DRAFT", ASESOR)
    assert raiz["notional_capital"] == 100000
    objetivo = db.datos[f"portfolios/c1/targets/{A}"]
    assert objetivo["weight"] == 0.6
    assert objetivo["advisor_id"] == objetivo["set_by"] == ASESOR
    doc = repo.get_portfolio(almacen, ASESOR, "c1")
    assert doc["owner_uid"] == ASESOR
    assert doc["total_capital"] == 100000
    assert doc["positions"][0] == {"asset_id": A, "weight_percent": 60.0, "keep_euros": False, "target_euros": 60000.0}


def test_quitar_una_posicion_borra_su_objetivo():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 100}])
    assert f"portfolios/c1/targets/{B}" not in db.datos
    assert [p["asset_id"] for p in almacen.get(ASESOR, "c1")["positions"]] == [A]


def test_una_cartera_ajena_no_se_ve_ni_se_pisa_ni_se_borra():
    almacen = AlmacenCarterasBaseNueva(_Db())
    _guardar(almacen)
    assert almacen.get(OTRO, "c1") is None
    assert repo.list_portfolios(almacen, OTRO) == []
    assert almacen.count(OTRO) == 0
    assert almacen.delete(OTRO, "c1") is False
    with pytest.raises(repo.InvalidPortfolio):
        _guardar(almacen, uid=OTRO)
    assert almacen.get(ASESOR, "c1")["owner_uid"] == ASESOR


def test_la_lista_reparte_cada_objetivo_a_su_cartera():
    almacen = AlmacenCarterasBaseNueva(_Db())
    _guardar(almacen, pid="c1")
    _guardar(almacen, pid="c2", posiciones=[{"asset_id": B, "weight_percent": 100}])
    carteras = {doc["portfolio_id"]: doc for doc in repo.list_portfolios(almacen, ASESOR)}
    assert [p["asset_id"] for p in carteras["c1"]["positions"]] == [A, B]
    assert [p["asset_id"] for p in carteras["c2"]["positions"]] == [B]
    assert almacen.count(ASESOR) == 2


def test_borrar_se_lleva_los_objetivos():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    assert repo.delete_portfolio(almacen, ASESOR, "c1")["ok"] is True
    assert db.datos == {}


def test_una_cartera_a_medias_conserva_sus_pesos_y_avisa():
    almacen = AlmacenCarterasBaseNueva(_Db())
    respuesta = _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 30}])
    assert respuesta["warnings"][0]["code"] == "WEIGHTS_NOT_100"
    assert almacen.get(ASESOR, "c1")["positions"][0]["weight_percent"] == 30.0


def test_un_identificador_que_no_es_isin_se_rechaza_entero():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    with pytest.raises(repo.InvalidPortfolio):
        _guardar(almacen, posiciones=[{"asset_id": "eodhd_vwo_us", "weight_percent": 100}])
    assert db.datos == {}


def test_guardar_de_nuevo_conserva_el_estado():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    db.datos["portfolios/c1"]["status"] = "ACTIVE"
    _guardar(almacen)
    assert db.datos["portfolios/c1"]["status"] == "ACTIVE"


# ---------- DIS-03: guardado condicionado a la fecha de modificacion con que se abrio ----------

ABIERTA_A_LAS = "2026-11-03T10:00:00+00:00"  # la `now` de `_guardar`


def _guardar_si_sigue_igual(almacen, esperada=ABIERTA_A_LAS, posiciones=None, uid=ASESOR, **extra):
    return repo.save_portfolio(almacen, uid, {
        "portfolio_id": "c1", "name": "Prudente, revisada",
        "positions": posiciones if posiciones is not None else [{"asset_id": A, "weight_percent": 100}],
        "expected_updated_at": esperada, **extra,
    }, now="2026-11-14T10:00:00+00:00")


def test_condicionado_correcto_escribe_la_raiz_y_los_objetivos_y_borra_lo_que_sobra():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    db.datos["portfolios/c1"]["status"] = "ACTIVE"
    # Sin capital: el campo opcional que la nueva no trae desaparece de la raiz.
    respuesta = _guardar_si_sigue_igual(almacen)
    raiz = db.datos["portfolios/c1"]
    assert raiz["name"] == "Prudente, revisada"
    assert raiz["updated_at"] == "2026-11-14T10:00:00+00:00"
    assert raiz["status"] == "ACTIVE"
    assert "notional_capital" not in raiz
    assert "expected_updated_at" not in raiz
    assert db.datos[f"portfolios/c1/targets/{A}"]["weight"] == 1.0
    assert f"portfolios/c1/targets/{B}" not in db.datos
    assert respuesta["portfolio"]["updated_at"] == "2026-11-14T10:00:00+00:00"


def test_condicionado_con_otra_fecha_es_un_conflicto_y_no_escribe_nada():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    antes = {ruta: dict(datos) for ruta, datos in db.datos.items()}
    with pytest.raises(repo.PortfolioConflict) as conflicto:
        _guardar_si_sigue_igual(almacen, esperada="2026-11-01T08:00:00+00:00")
    assert (conflicto.value.reason, conflicto.value.current_updated_at) == ("changed", ABIERTA_A_LAS)
    assert db.datos == antes


def test_condicionado_sobre_una_borrada_es_un_conflicto_y_no_la_crea():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    with pytest.raises(repo.PortfolioConflict) as conflicto:
        _guardar_si_sigue_igual(almacen)
    assert conflicto.value.reason == "deleted"
    assert db.datos == {}


def test_condicionado_sobre_una_ajena_sigue_siendo_un_dato_no_valido():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    with pytest.raises(repo.InvalidPortfolio):
        _guardar_si_sigue_igual(almacen, uid=OTRO)
    assert db.datos["portfolios/c1"]["advisor_id"] == ASESOR


def test_la_carrera_otro_guardado_entre_la_lectura_y_el_commit_hace_fallar_la_precondicion():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)

    def otra_pestana():
        # Guarda sin condicion y con la misma fecha: solo la precondicion de Firestore la distingue.
        _guardar(AlmacenCarterasBaseNueva(db), posiciones=[{"asset_id": B, "weight_percent": 100}])

    db.antes_del_commit = otra_pestana
    with pytest.raises(repo.PortfolioConflict) as conflicto:
        _guardar_si_sigue_igual(almacen)
    assert conflicto.value.reason == "changed"
    # Queda lo de la otra pestana, entero: ni la raiz ni un objetivo de esta.
    assert db.datos["portfolios/c1"]["name"] == "Prudente"
    assert f"portfolios/c1/targets/{A}" not in db.datos
    assert db.datos[f"portfolios/c1/targets/{B}"]["weight"] == 1.0


def test_la_carrera_si_la_borran_entre_la_lectura_y_el_commit_no_se_escribe_nada():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    db.antes_del_commit = lambda: almacen.delete(ASESOR, "c1")
    with pytest.raises(repo.PortfolioConflict) as conflicto:
        _guardar_si_sigue_igual(almacen)
    assert conflicto.value.reason == "deleted"
    assert db.datos == {}


# --- Guardar sin condicion (nueva, o sobrescribir tras un conflicto), atado a lo leido: pendiente del 19-11-2026 ---------

def test_sin_condicion_otro_guardado_entre_medias_no_deja_objetivos_mezclados():
    """Antes: esta pestana leia los objetivos {A}, la otra guardaba {A, B}, y esta escribia su raiz y A sin ver B: quedaban
    A al 100 % y B al 40 %, un reparto del 140 % que no habia compuesto nadie. Ahora la precondicion falla, se vuelve a leer y
    queda lo de esta pestana, entero."""
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 100}])
    db.antes_del_commit = lambda: _guardar(AlmacenCarterasBaseNueva(db), posiciones=[
        {"asset_id": A, "weight_percent": 60}, {"asset_id": B, "weight_percent": 40}])
    _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 100}])
    objetivos = {r: d for r, d in db.datos.items() if r.startswith("portfolios/c1/targets/")}
    assert objetivos == {f"portfolios/c1/targets/{A}": {**objetivos[f"portfolios/c1/targets/{A}"], "weight": 1.0}}
    assert sum(d["weight"] for d in objetivos.values()) == 1.0


def test_sin_condicion_dos_altas_con_el_mismo_identificador_no_se_pisan():
    """Otro asesor crea `c1` entre la lectura y la escritura de este: el `create` falla, se vuelve a leer y se ve que es de
    otro. Antes, el `set` la pisaba sin mirar."""
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    db.antes_del_commit = lambda: _guardar(AlmacenCarterasBaseNueva(db), uid=OTRO)
    with pytest.raises(repo.InvalidPortfolio):
        _guardar(almacen)
    assert db.datos["portfolios/c1"]["advisor_id"] == OTRO


def test_sin_condicion_si_siempre_se_cuela_otro_es_un_conflicto_y_no_escribe_lo_suyo(monkeypatch):
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    lote_de_verdad = db.batch

    def lote_que_siempre_pierde():
        lote = lote_de_verdad()
        original = lote.commit

        def commit():
            _guardar(AlmacenCarterasBaseNueva(_DbSinTrampa(db)), posiciones=[{"asset_id": B, "weight_percent": 100}])
            original()
        lote.commit = commit
        return lote

    monkeypatch.setattr(db, "batch", lote_que_siempre_pierde)
    with pytest.raises(repo.PortfolioConflict) as conflicto:
        _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 100}])
    assert conflicto.value.reason == "changed"
    assert f"portfolios/c1/targets/{A}" not in db.datos


class _DbSinTrampa:
    """La misma base, con su lote normal: la otra pestana que se cuela en cada intento."""

    def __init__(self, db):
        self._db = db

    def __getattr__(self, nombre):
        return getattr(self._db, nombre)

    def batch(self):
        return _Lote(self._db)



# --- Auditoria 20-11-2026 (P2-04): borrar y guardar a la vez, conteo por agregacion, cabecera y booleanos ----------------

def test_borrar_mientras_se_guarda_no_deja_objetivos_huerfanos():
    """Antes: el borrado leia los objetivos {A}, otro guardado anadia B, y el lote borraba A y la raiz: B quedaba sin
    cartera y `list` lo leia para siempre. Ahora el borrado va atado a la raiz leida, falla, relee {A, B} y los borra."""
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 100}])
    db.antes_del_commit = lambda: _guardar(AlmacenCarterasBaseNueva(db), posiciones=[
        {"asset_id": A, "weight_percent": 60}, {"asset_id": B, "weight_percent": 40}])
    assert repo.delete_portfolio(almacen, ASESOR, "c1")["ok"] is True
    assert db.datos == {}


def test_borrar_si_siempre_se_cuela_un_guardado_es_un_conflicto_y_no_borra_nada(monkeypatch):
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    lote_de_verdad = db.batch

    def lote_que_siempre_pierde():
        lote = lote_de_verdad()
        original = lote.commit

        def commit():
            _guardar(AlmacenCarterasBaseNueva(_DbSinTrampa(db)))
            original()
        lote.commit = commit
        return lote

    monkeypatch.setattr(db, "batch", lote_que_siempre_pierde)
    with pytest.raises(repo.PortfolioConflict):
        almacen.delete(ASESOR, "c1")
    assert "portfolios/c1" in db.datos and f"portfolios/c1/targets/{A}" in db.datos


def test_borrar_una_inexistente_o_ajena_dice_que_no_existia():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    assert almacen.delete(OTRO, "c1") is False
    assert almacen.delete(ASESOR, "no-existe") is False
    assert "portfolios/c1" in db.datos


def test_contar_usa_la_agregacion_y_solo_cuenta_las_del_asesor():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen, pid="c1")
    _guardar(almacen, pid="c2")
    _guardar(almacen, uid=OTRO, pid="c3")
    db.agregaciones = 0
    assert almacen.count(ASESOR) == 2
    assert almacen.count(OTRO) == 1
    assert db.agregaciones == 2


def test_la_cabecera_es_la_raiz_sola_y_respeta_el_aislamiento():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    _guardar(almacen)
    cabecera = almacen.get_cabecera(ASESOR, "c1")
    assert cabecera["positions"] == [] and cabecera["name"] == "Prudente"
    assert almacen.get_cabecera(OTRO, "c1") is None
    assert almacen.get_cabecera(ASESOR, "otra") is None


@pytest.mark.parametrize("valor", [True, False])
def test_un_booleano_no_es_un_capital(valor):
    almacen = AlmacenCarterasBaseNueva(_Db())
    with pytest.raises(repo.InvalidPortfolio):
        _guardar(almacen, total_capital=valor)


def test_un_booleano_no_es_un_peso_ni_un_objetivo_en_euros():
    almacen = AlmacenCarterasBaseNueva(_Db())
    with pytest.raises(repo.InvalidPortfolio):
        _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": True}])
    with pytest.raises(repo.InvalidPortfolio):
        _guardar(almacen, posiciones=[{"asset_id": A, "weight_percent": 100, "target_euros": True}])
