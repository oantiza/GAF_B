# -*- coding: utf-8 -*-
"""Las dependencias que el código importa están declaradas.

PyMuPDF (`fitz`) se usaba en `core/kid.py` desde el 05-09 sin estar en
`requirements.txt`: en una instalación nueva todo KID fallaba en silencio,
porque los fetchers capturan la excepción y siguen sin el dato (auditoría
16-10, §1.1). Este test convierte esa ausencia en un fallo con nombre.
"""
import importlib
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]

# módulo importado -> nombre del paquete en requirements.txt
DECLARADAS = {
    "fitz": "PyMuPDF",
    "defusedxml": "defusedxml",
    "jsonschema": "jsonschema",
}


def _paquetes_declarados() -> set[str]:
    nombres = set()
    for linea in (RAIZ / "requirements.txt").read_text(encoding="utf-8").splitlines():
        linea = linea.split("#", 1)[0].strip()
        m = re.match(r"([A-Za-z0-9_.\-]+)", linea)
        if m:
            nombres.add(m.group(1).lower())
    return nombres


@pytest.mark.parametrize("modulo,paquete", sorted(DECLARADAS.items()))
def test_la_dependencia_esta_declarada(modulo, paquete):
    assert paquete.lower() in _paquetes_declarados(), f"{paquete} no está en requirements.txt"


@pytest.mark.parametrize("modulo", sorted(DECLARADAS))
def test_la_dependencia_esta_instalada(modulo):
    importlib.import_module(modulo)
