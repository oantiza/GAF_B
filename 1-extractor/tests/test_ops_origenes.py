# -*- coding: utf-8 -*-
"""Los origenes que el servicio local admite por defecto son los de Vite (pendiente del 20-11-2026).

La aplicacion principal arranca en el 5174 (`arrancar-entorno`) y las copias de trabajo en el siguiente libre entre 5173 y
5179; el 5174 no estaba entre los admitidos, asi que la unica app que importa era la que el servicio rechazaba.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ops_server  # noqa: E402


def test_la_aplicacion_principal_y_las_copias_estan_admitidas():
    for puerto in range(5173, 5180):
        for host in ("localhost", "127.0.0.1"):
            assert f"http://{host}:{puerto}" in ops_server.ORIGENES_POR_DEFECTO


def test_vite_preview_sigue_y_no_entra_nada_que_no_sea_local():
    assert "http://localhost:4173" in ops_server.ORIGENES_POR_DEFECTO
    assert all(o.startswith(("http://localhost:", "http://127.0.0.1:")) for o in ops_server.ORIGENES_POR_DEFECTO)
    assert len(set(ops_server.ORIGENES_POR_DEFECTO)) == len(ops_server.ORIGENES_POR_DEFECTO)
