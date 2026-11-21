# -*- coding: utf-8 -*-
"""
Carteras del asesor en la base nueva: `portfolios/{id}` y `portfolios/{id}/targets/{isin}`.

Misma interfaz que FirestorePortfolioStore, asi que `repository.py` y la pantalla no cambian.
Una cartera ajena se comporta como si no existiera al leerla, y no se puede sobrescribir ni
borrar: el aislamiento lo da `advisor_id`, no la ruta.
"""
import re

from readmodel.firestore_client import get_master_db

from .escritura_condicionada import (
    cambios_que_sustituyen,
    conflicto_si_falla_la_precondicion,
    datos_si_existe,
    exigir_la_fecha,
    precondicion,
)
from .repository import PROFILE_FIELDS, InvalidPortfolio

ESQUEMA = "base-nueva.portfolio.v2"
INSTRUMENTO = re.compile(r"^([A-Z]{2}[A-Z0-9]{9}[0-9]|[A-Z]{3})$")


def doc_de_la_app(cartera: dict, objetivos: list) -> dict:
    """La forma que usa la pantalla, desde los dos documentos de la base."""
    posiciones = []
    for objetivo in sorted(objetivos, key=lambda o: (-(o.get("weight") or 0), o.get("instrument_id") or "")):
        posicion = {"asset_id": objetivo.get("instrument_id"),
                    "weight_percent": round((objetivo.get("weight") or 0) * 100, 6)}
        for campo in ("keep_euros", "target_euros"):
            if objetivo.get(campo) is not None:
                posicion[campo] = objetivo[campo]
        posiciones.append(posicion)
    doc = {
        "portfolio_id": cartera.get("portfolio_id"),
        "owner_uid": cartera.get("advisor_id"),
        "name": cartera.get("name"),
        "base_currency": cartera.get("base_currency"),
        "source_kind": "BDB_APP_OWNED",
        "positions": posiciones,
        "updated_at": cartera.get("updated_at"),
    }
    if cartera.get("created_at"):
        doc["created_at"] = cartera["created_at"]
    if cartera.get("notional_capital") is not None:
        doc["total_capital"] = cartera["notional_capital"]
    # Decision 59: nivel de perfil y horizonte, en la raiz de portfolios/{id} y con el mismo nombre.
    for campo in PROFILE_FIELDS:
        if cartera.get(campo) is not None:
            doc[campo] = cartera[campo]
    return doc


def documentos_de_la_base(uid: str, doc: dict, estado: str = "DRAFT") -> tuple:
    """(cartera, {isin: objetivo}) desde lo que devuelve `sanitize_portfolio`."""
    cartera = {
        "portfolio_id": doc["portfolio_id"],
        "schema_version": ESQUEMA,
        "updated_at": doc["updated_at"],
        "created_at": doc.get("created_at"),
        "kind": "MODEL",
        "advisor_id": uid,
        "name": doc["name"],
        "status": estado,
        "base_currency": "EUR",
    }
    if doc.get("total_capital") is not None:
        cartera["notional_capital"] = doc["total_capital"]
    for campo in PROFILE_FIELDS:
        if doc.get(campo) is not None:
            cartera[campo] = doc[campo]
    objetivos = {}
    for posicion in doc["positions"]:
        instrumento = posicion["asset_id"]
        if not INSTRUMENTO.fullmatch(instrumento):
            raise InvalidPortfolio(f"{instrumento} no es un ISIN: esta cartera no se puede guardar.")
        objetivo = {
            "instrument_id": instrumento,
            "weight": posicion["weight_percent"] / 100,
            "advisor_id": uid,
            "set_by": uid,
            "set_at": doc["updated_at"],
        }
        for campo in ("keep_euros", "target_euros"):
            if posicion.get(campo) is not None:
                objetivo[campo] = posicion[campo]
        objetivos[instrumento] = objetivo
    return cartera, objetivos


class AlmacenCarterasBaseNueva:
    def __init__(self, db=None):
        self.db = db or get_master_db()

    def _ref(self, portfolio_id: str):
        return self.db.collection("portfolios").document(portfolio_id)

    def _de_otro(self, uid: str, datos: dict) -> bool:
        return datos.get("advisor_id") != uid

    def save(self, uid: str, portfolio_id: str, doc: dict):
        ref = self._ref(portfolio_id)
        previa = ref.get()
        anterior = previa.to_dict() or {} if previa.exists else None
        if anterior is not None and self._de_otro(uid, anterior):
            raise InvalidPortfolio("Ese identificador de cartera ya esta en uso.")
        estado = (anterior or {}).get("status") or "DRAFT"
        cartera, objetivos = documentos_de_la_base(uid, doc, estado)
        lote = self.db.batch()
        lote.set(ref, {k: v for k, v in cartera.items() if v is not None})
        self._objetivos_al_lote(lote, ref, objetivos)
        lote.commit()

    def _objetivos_al_lote(self, lote, ref, objetivos: dict):
        objetivos_ref = ref.collection("targets")
        for snap in objetivos_ref.stream():
            if snap.id not in objetivos:
                lote.delete(objetivos_ref.document(snap.id))
        for instrumento, objetivo in objetivos.items():
            lote.set(objetivos_ref.document(instrumento), objetivo)

    def save_if_unchanged(self, uid: str, portfolio_id: str, doc: dict, expected_updated_at: str):
        """DIS-03: como `save`, pero solo si la raiz sigue con `expected_updated_at`; si no, PortfolioConflict.

        Atomico: la raiz va en el mismo lote que los objetivos, con la precondicion `last_update_time` de
        lo leido. Cada guardado reescribe la raiz, asi que si alguien ha guardado entre la lectura y el
        `commit`, la precondicion falla y no se escribe nada: ni la raiz ni un objetivo.
        """
        ref = self._ref(portfolio_id)
        leida = ref.get()
        anterior = datos_si_existe(leida)
        if self._de_otro(uid, anterior):
            raise InvalidPortfolio("Ese identificador de cartera ya esta en uso.")
        exigir_la_fecha(anterior, expected_updated_at)
        cartera, objetivos = documentos_de_la_base(uid, doc, anterior.get("status") or "DRAFT")
        nueva = {k: v for k, v in cartera.items() if v is not None}
        lote = self.db.batch()
        lote.update(ref, cambios_que_sustituyen(anterior, nueva), option=precondicion(self.db, leida))
        self._objetivos_al_lote(lote, ref, objetivos)
        with conflicto_si_falla_la_precondicion(ref):
            lote.commit()

    def _carteras_de(self, uid: str):
        return self.db.collection("portfolios").where("advisor_id", "==", uid)

    def count(self, uid: str) -> int:
        return sum(1 for _ in self._carteras_de(uid).stream())

    def list(self, uid: str) -> list:
        carteras = {snap.id: snap.to_dict() or {} for snap in self._carteras_de(uid).stream()}
        objetivos = {identificador: [] for identificador in carteras}
        grupo = self.db.collection_group("targets").where("advisor_id", "==", uid)
        for snap in grupo.stream():
            padre = snap.reference.parent.parent.id
            if padre in objetivos:
                objetivos[padre].append(snap.to_dict() or {})
        return [doc_de_la_app(cartera, objetivos[identificador]) for identificador, cartera in carteras.items()]

    def get(self, uid: str, portfolio_id: str):
        ref = self._ref(portfolio_id)
        snap = ref.get()
        if not snap.exists or self._de_otro(uid, snap.to_dict() or {}):
            return None
        return doc_de_la_app(snap.to_dict() or {}, [o.to_dict() or {} for o in ref.collection("targets").stream()])

    def delete(self, uid: str, portfolio_id: str) -> bool:
        ref = self._ref(portfolio_id)
        snap = ref.get()
        if not snap.exists or self._de_otro(uid, snap.to_dict() or {}):
            return False
        lote = self.db.batch()
        for objetivo in ref.collection("targets").stream():
            lote.delete(objetivo.reference)
        lote.delete(ref)
        lote.commit()
        return True
