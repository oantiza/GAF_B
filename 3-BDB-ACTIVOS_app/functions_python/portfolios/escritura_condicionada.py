# -*- coding: utf-8 -*-
"""
DIS-03: lo comun a los dos almacenes para escribir una cartera solo si sigue como el cliente la abrio.

La comprobacion de `updated_at` se hace sobre lo leido, y la escritura lleva la precondicion de
Firestore `last_update_time` igual al `update_time` de esa lectura: si alguien escribe entre las dos,
Firestore rechaza la escritura entera. En el cliente de Python la precondicion la admiten `update` y
`delete`, no `set`; por eso se sustituye el documento con un `update` de todos los campos nuevos y
`DELETE_FIELD` en los que tenia y el nuevo no trae, que deja lo mismo que dejaria `set`.
"""
from contextlib import contextmanager

from google.api_core.exceptions import FailedPrecondition, NotFound
from google.cloud.firestore_v1 import DELETE_FIELD
from google.cloud.firestore_v1.field_path import FieldPath

from .repository import PortfolioConflict


def datos_si_existe(snap) -> dict:
    """Lo leido, o PortfolioConflict("deleted") si ya no esta."""
    if not snap.exists:
        raise PortfolioConflict("deleted")
    return snap.to_dict() or {}


def exigir_la_fecha(datos: dict, expected_updated_at: str) -> None:
    """PortfolioConflict("changed") si la guardada ya no tiene la fecha con que se abrio."""
    actual = datos.get("updated_at")
    if actual != expected_updated_at:
        raise PortfolioConflict("changed", actual)


def cambios_que_sustituyen(anterior: dict, nuevo: dict) -> dict:
    """Los cambios de un `update` que dejan el documento igual que un `set(nuevo)`.

    Cada nombre va como ruta de campo entre comillas si hace falta: sin ellas, un punto en el nombre
    se leeria como un campo anidado.
    """
    cambios = {FieldPath(campo).to_api_repr(): valor for campo, valor in nuevo.items()}
    for campo in anterior:
        if campo not in nuevo:
            cambios[FieldPath(campo).to_api_repr()] = DELETE_FIELD
    return cambios


def precondicion(db, snap):
    """La escritura solo vale si el documento sigue en la version que se leyo."""
    return db.write_option(last_update_time=snap.update_time)


@contextmanager
def conflicto_si_falla_la_precondicion(ref):
    """Convierte el rechazo de Firestore en un PortfolioConflict, sin que se haya escrito nada.

    Tras un FailedPrecondition se vuelve a leer solo para decir que ha pasado (cambiada o eliminada):
    esa lectura no escribe ni decide nada.
    """
    try:
        yield
    except NotFound:
        raise PortfolioConflict("deleted") from None
    except FailedPrecondition:
        actual = ref.get()
        if not actual.exists:
            raise PortfolioConflict("deleted") from None
        raise PortfolioConflict("changed", (actual.to_dict() or {}).get("updated_at")) from None
