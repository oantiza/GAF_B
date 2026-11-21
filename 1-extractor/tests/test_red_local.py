# -*- coding: utf-8 -*-
"""Host y Origin de las interfaces locales, también en el puerto 80.

Con `--puerto 80` el navegador manda `Host: 127.0.0.1` y `Origin:
http://127.0.0.1`, sin puerto, y `app.py` y `ops_server.py` lo rechazaban todo
con 403 (revisión de la rama, MEN-3). En los demás puertos el puerto sigue
siendo obligatorio.
"""
import email.message
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402
import ops_server  # noqa: E402
from core import red_local  # noqa: E402
from tests.test_ops import _base  # noqa: E402


@pytest.mark.parametrize("host,puerto,vale", [
    ("127.0.0.1:8765", 8765, True), ("LOCALHOST:8765", 8765, True),
    ("127.0.0.1", 8765, False), ("127.0.0.1:80", 8765, False),
    ("127.0.0.1", 80, True), ("localhost", 80, True), ("127.0.0.1:80", 80, True),
    ("evil.example", 80, False), ("evil.example:80", 80, False), ("", 80, False), (None, 80, False),
])
def test_host_local(host, puerto, vale):
    assert red_local.host_local(host, puerto) is vale


def test_origen_local():
    assert red_local.origen_local("http://127.0.0.1", 80)
    assert red_local.origen_local("http://localhost:8765", 8765)
    assert not red_local.origen_local("http://127.0.0.1", 8765)
    assert not red_local.origen_local("https://127.0.0.1", 80)
    assert not red_local.origen_local("null", 80)


class _Servidor:
    def __init__(self, puerto):
        self.server_address = ("127.0.0.1", puerto)


def _cabeceras(**valores) -> email.message.Message:
    m = email.message.Message()
    for nombre, valor in valores.items():
        m[nombre.replace("_", "-")] = valor
    return m


def _manejador(clase, puerto, **cabeceras):
    h = clase.__new__(clase)          # sin socket: solo se prueban las comprobaciones
    h.server = _Servidor(puerto)
    h.headers = _cabeceras(**cabeceras)
    return h


def test_app_en_el_puerto_80_acepta_el_host_sin_puerto():
    ok = _manejador(app.Manejador, 80, Host="127.0.0.1", Origin="http://127.0.0.1",
                    Content_Type="application/json")
    assert ok._rechazo(post=True) is None
    assert _manejador(app.Manejador, 80, Host="localhost")._rechazo(post=False) is None
    assert "Host" in _manejador(app.Manejador, 80, Host="evil.example")._rechazo(post=False)
    assert "origen" in _manejador(app.Manejador, 80, Host="127.0.0.1",
                                  Origin="http://evil.example")._rechazo(post=False)
    # en otro puerto, el Host sin puerto sigue sin valer
    assert "Host" in _manejador(app.Manejador, 8765, Host="127.0.0.1")._rechazo(post=False)


def test_ops_en_el_puerto_80_acepta_el_host_sin_puerto(tmp_path):
    servicio = ops_server.Servicio(_base(tmp_path))
    Manejador = ops_server.crea_manejador(servicio)
    _manejador(Manejador, 80, Host="127.0.0.1", X_Ops_Token=servicio.token)._autoriza()
    _manejador(Manejador, 80, Host="localhost", Origin="http://localhost:5173",
               X_Ops_Token=servicio.token)._autoriza()
    for puerto, host in ((80, "evil.example"), (8766, "127.0.0.1")):
        with pytest.raises(ops_server.ErrorPeticion) as exc:
            _manejador(Manejador, puerto, Host=host, X_Ops_Token=servicio.token)._autoriza()
        assert exc.value.codigo == 403
