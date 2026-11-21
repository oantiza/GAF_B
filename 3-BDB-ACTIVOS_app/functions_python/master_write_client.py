# -*- coding: utf-8 -*-
"""Cliente Firestore de la maestra para los modulos ESCRITORES, uno por proceso.

MEDIA-7 (auditoria 14-10-2026): price_refresh, search_index e integrity_check creaban
un `gcf.Client` en cada llamada (canal gRPC y token nuevos cada vez). Google recomienda
reutilizar el cliente entre invocaciones; aqui se crea una vez por proceso.

Separado a proposito de `readmodel.firestore_client.get_master_db()`, que es el cliente
del camino de LECTURA (read model, panel de administracion, estado del sistema). Las
credenciales no cambian: un cliente Firestore usa las del service account del runtime,
y cada Cloud Function corre en su propio servicio, con `bdb-functions-writer` o
`bdb-functions-reader` segun declara main.py. Mantener dos accesos evita que un camino
de lectura reciba el cliente de un escritor o al reves.
"""
import threading

from google.cloud import firestore as gcf

from master_project import master_project_id

_client = None
_lock = threading.Lock()


def get_master_write_db():
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = gcf.Client(project=master_project_id())
    return _client
