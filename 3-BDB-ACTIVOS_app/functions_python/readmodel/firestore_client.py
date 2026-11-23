"""
Cliente de Firestore (SOLO LECTURA) de la base de datos maestra, y la puerta de los identificadores.

- En Cloud Functions: usa ADC del runtime (el service account del proyecto debe tener rol
  roles/datastore.viewer SOBRE el proyecto de la maestra, el que diga `master_project`).
- En local: el emulador, con FIRESTORE_EMULATOR_HOST.

El lector de la base vieja (`FirestoreReader`, sobre `assets/…`) se borro el 21-11-2026 con el resto del
codigo de esa base (decision 31 del censo `CENSO_BASE_VIEJA_2026-11-21.md`; etiqueta
`referencia-base-vieja-2026-11-21`). El lector de hoy es `readmodel/lector_base_nueva.py`, que usa este cliente.
"""
import re

from google.cloud import firestore as gcf

from master_project import exigir_base_nueva, master_project_id

_client = None


# Ola A2 (A2.1): mismo alfabeto que portfolios.repository.ASSET_ID_RE. Un id
# como «X/holdings/latest» construia rutas de subdocumentos arbitrarias; ahora
# cualquier id fuera del alfabeto se trata como inexistente en TODO el read model
# (una sola puerta para todas las callables de lectura).
_ASSET_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


def _valid_asset_id(asset_id) -> bool:
    return isinstance(asset_id, str) and bool(_ASSET_ID_RE.fullmatch(asset_id))


def get_master_db():
    """Cliente Firestore apuntando al proyecto MAESTRO (cross-project, solo lectura).

    Solo el de la base nueva: con `gestor-activos-local` declarado para aqui, nombrandolo
    (`master_project.exigir_base_nueva`), en vez de abrir una base que ya no se sabe leer."""
    global _client
    if _client is None:
        exigir_base_nueva()
        _client = gcf.Client(project=master_project_id())
    return _client
