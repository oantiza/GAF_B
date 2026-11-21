"""
Store LIVE de carteras app-owned en el Firestore del proyecto.

La app comparte proyecto con la BD maestra, pero los datos de ESTA app van namespaced
bajo `bdb_activos/` para NO contaminar el proyecto compartido: la coleccion maestra
`assets` queda intacta y reutilizable por otros consumidores/proyectos independientes.

Ruta: bdb_activos/{uid}/portfolios/{portfolio_id}  -> aislamiento natural por UID.
"""
from firebase_admin import firestore
from app_owned_store import APP_NAMESPACE, save_owned_document
from portfolios.escritura_condicionada import (
    cambios_que_sustituyen,
    conflicto_si_falla_la_precondicion,
    datos_si_existe,
    exigir_la_fecha,
    precondicion,
)


class FirestorePortfolioStore:
    def __init__(self, db=None):
        self.db = db or firestore.client()

    def _col(self, uid: str):
        return self.db.collection(APP_NAMESPACE).document(uid).collection("portfolios")

    def save(self, uid: str, portfolio_id: str, doc: dict):
        # Materializar el doc padre bdb_activos/{uid}: sin esto queda "fantasma"
        # y los exportadores que recorren con collection.get() no lo ven, dejando
        # las carteras fuera del backup local (auditoría A2, 2026-07-10).
        save_owned_document(self.db, uid, "portfolios", portfolio_id, doc)

    def save_if_unchanged(self, uid: str, portfolio_id: str, doc: dict, expected_updated_at: str):
        """DIS-03: sustituye la cartera solo si sigue con `expected_updated_at`; si no, PortfolioConflict.

        Atomico: la escritura lleva la precondicion `last_update_time` de lo leido. No crea: si no
        existe es un conflicto, asi que el padre `bdb_activos/{uid}` ya lo materializo el `save` que la creo.
        """
        ref = self._col(uid).document(portfolio_id)
        leido = ref.get()
        anterior = datos_si_existe(leido)
        exigir_la_fecha(anterior, expected_updated_at)
        with conflicto_si_falla_la_precondicion(ref):
            ref.update(cambios_que_sustituyen(anterior, doc), option=precondicion(self.db, leido))

    def count(self, uid: str) -> int:
        results = self._col(uid).count().get()
        item = results[0] if results else None
        while isinstance(item, (list, tuple)) and item:
            item = item[0]
        return int(getattr(item, "value", 0) or 0)

    def list(self, uid: str) -> list:
        return [d.to_dict() for d in self._col(uid).stream()]

    def get(self, uid: str, portfolio_id: str):
        snap = self._col(uid).document(portfolio_id).get()
        return snap.to_dict() if snap.exists else None

    def delete(self, uid: str, portfolio_id: str) -> bool:
        ref = self._col(uid).document(portfolio_id)
        if ref.get().exists:
            ref.delete()
            return True
        return False


def almacen_de_carteras():
    """El almacen que corresponde al proyecto declarado en MASTER_PROJECT_ID."""
    from master_project import master_project_id
    from readmodel.lector_base_nueva import PROYECTO_BASE_NUEVA
    if master_project_id() == PROYECTO_BASE_NUEVA:
        from portfolios.almacen_base_nueva import AlmacenCarterasBaseNueva
        return AlmacenCarterasBaseNueva()
    return FirestorePortfolioStore()
