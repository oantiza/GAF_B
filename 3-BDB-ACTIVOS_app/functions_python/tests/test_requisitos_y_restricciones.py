"""`requirements.txt` y `constraints.txt` no pueden fijar dos versiones distintas del mismo paquete.

El 21-11-2026 el despliegue de las Functions falló en la nube con «ResolutionImpossible»: `requirements.txt` pedía
`pypdf==6.21.4` y `constraints.txt`, que el primero carga con `-c`, seguía en `pypdf==6.21.1`. Las pruebas locales no lo
vieron, porque corren con lo que ya está instalado y no resuelven las dos listas juntas, como hace Cloud Build.
"""
from pathlib import Path
import re

AQUI = Path(__file__).resolve().parent.parent
FIJADO = re.compile(r"^\s*([A-Za-z0-9_.\-\[\]]+)\s*==\s*([^\s;#]+)")


def _fijados(fichero: str) -> dict[str, str]:
    versiones: dict[str, str] = {}
    for linea in (AQUI / fichero).read_text(encoding="utf-8").splitlines():
        m = FIJADO.match(linea)
        if m:
            nombre = re.sub(r"\[.*\]", "", m.group(1)).lower().replace("_", "-")
            versiones[nombre] = m.group(2)
    return versiones


def test_requirements_carga_las_restricciones():
    assert "-c constraints.txt" in (AQUI / "requirements.txt").read_text(encoding="utf-8")


def test_ningun_paquete_fijado_dos_veces_con_versiones_distintas():
    pedidos = _fijados("requirements.txt")
    restringidos = _fijados("constraints.txt")
    distintos = {p: (v, restringidos[p]) for p, v in pedidos.items() if p in restringidos and restringidos[p] != v}
    assert distintos == {}, f"requirements.txt y constraints.txt no coinciden: {distintos}"
