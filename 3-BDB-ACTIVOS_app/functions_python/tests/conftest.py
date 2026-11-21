"""Generar un informe sigue los enlaces de sus fuentes: ninguna prueba sale a internet por eso."""
import os
import sys

import pytest

# Un fondo sintetico con el bloqueo SIN revision (sin `draw_after_review`): el caso que hasta el 11-11-2026 representaba
# IE00BF0GL212. Desde que se desbloqueo, todos los bloqueos reales del fichero estan revisados para dibujarse, asi que
# lo que se comprueba del bloqueo sin revision necesita una politica propia.
BLOQUEADO_SIN_REVISION = "XS0000000001"


@pytest.fixture
def bloqueo_sin_revision(monkeypatch):
    import fund_history_quality

    reales = fund_history_quality.policies()
    monkeypatch.setattr(fund_history_quality, "policies", lambda: {
        **reales,
        BLOQUEADO_SIN_REVISION: {"blocked": True, "flags": ["TOTAL_RETURN_UNVERIFIED"], "reason": "Politica sintetica de prueba."},
    })


@pytest.fixture(autouse=True)
def _las_fuentes_no_salen_a_internet(monkeypatch):
    """Por defecto, toda dirección es pública y contesta 200. Quien prueba otra cosa lo dice en su prueba."""
    functions_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if functions_dir not in sys.path:
        sys.path.insert(0, functions_dir)
    import source_links

    monkeypatch.setattr(source_links, "_addresses_of", lambda _host, _port: ["93.184.216.34"])
    monkeypatch.setattr(source_links, "_request", lambda _target, _timeout: source_links.HopResponse(200, ""))
