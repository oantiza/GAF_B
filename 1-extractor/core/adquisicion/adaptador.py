"""Adaptador: un proveedor que declara qué campos sabe dar y a qué familia.

La pregunta que motiva la declaración de capacidades (descubrimiento 04-09,
§7.1): «si cae X, ¿qué me queda?». Con las capacidades declaradas se responde
antes de que caiga, no después (`python main.py capacidades --sin morningstar_lt`).

Un adaptador envuelve un fetcher existente o nuevo. No cambia cómo pide (las
URL y parámetros de Morningstar siguen intactos para que la caché de 1,4 GB
siga sirviendo); solo declara:

- `capacidades`: ruta del esquema v2 -> familia de dato (`core.familias`).
- `endpoints`: descargas que hace y a qué familia sirve cada una (para el
  planificador y para explicar el coste de una pasada).
- `aplica(isin, tipo)`: si tiene sentido para ese activo (la CNMV solo para
  ISIN ES..., la CSSF solo para LU..., justETF solo para ETF).
- `oficial`: si la fuente es un regulador/registro público (dato regulatorio)
  o un proveedor comercial (analítica propietaria).
"""
from __future__ import annotations

import dataclasses
from typing import Any, Callable

from core.familias import FAMILIAS


@dataclasses.dataclass(frozen=True)
class Endpoint:
    nombre: str
    familia: str
    descripcion: str = ""


@dataclasses.dataclass
class Contexto:
    """Lo que un adaptador necesita para trabajar en una pasada."""
    http: Any
    settings: dict
    base: Any            # Path del proyecto
    force: bool = False
    tipo: str = ""       # fondo | etf | accion (de fondos.csv)
    # Lo que otros adaptadores ya aportaron en esta pasada (p.ej. el nombre
    # legal de la CSSF que ESMA usa para buscar). Solo lectura.
    previo: dict = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class Adaptador:
    id: str
    descripcion: str
    oficial: bool
    capacidades: dict[str, str]          # ruta v2 -> familia
    endpoints: tuple[Endpoint, ...]
    fetch: Callable[[str, Contexto], dict]
    aplica: Callable[[str, str], bool] = lambda isin, tipo: True
    # Orden de ejecución dentro de una pasada (los que dependen de otros van después).
    orden: int = 50
    # Dependencia declarada: ids de adaptadores cuyo resultado usa como pista.
    usa: tuple[str, ...] = ()
    # Entra siempre que aplique, esté o no en `prioridad_fuentes` (como los
    # oficiales): EODHD para acciones y ETF, que nunca estuvo en esa lista.
    implicito: bool = False

    def __post_init__(self) -> None:
        desconocidas = {f for f in self.capacidades.values() if f not in FAMILIAS}
        desconocidas |= {e.familia for e in self.endpoints if e.familia not in FAMILIAS}
        if desconocidas:
            raise ValueError(f"{self.id}: familias desconocidas {sorted(desconocidas)}")

    def familias(self) -> set[str]:
        return {e.familia for e in self.endpoints} | set(self.capacidades.values())

    def sirve(self, familias: set[str] | None) -> bool:
        """True si alguna de sus familias está entre las pedidas (None = todas)."""
        return familias is None or bool(self.familias() & familias)


def rutas_por_fuente(adaptadores: list[Adaptador]) -> dict[str, set[str]]:
    """ruta v2 -> ids de adaptadores que saben darla."""
    out: dict[str, set[str]] = {}
    for a in adaptadores:
        for ruta in a.capacidades:
            out.setdefault(ruta, set()).add(a.id)
    return out


def sin(adaptadores: list[Adaptador], caidos: set[str]) -> dict[str, list[str]]:
    """Qué rutas se quedan sin ninguna fuente si caen los adaptadores dados,
    y cuáles conservan respaldo (con quién)."""
    mapa = rutas_por_fuente(adaptadores)
    # `morningstar` tumba también a `morningstar_lt`: es el mismo proveedor.
    caidos = {a.id for a in adaptadores
              if a.id in caidos or a.id.split("_")[0] in caidos}
    huerfanas, respaldadas = [], {}
    for ruta, fuentes in sorted(mapa.items()):
        quedan = sorted(fuentes - caidos)
        if fuentes & caidos:
            if quedan:
                respaldadas[ruta] = quedan
            else:
                huerfanas.append(ruta)
    return {"huerfanas": huerfanas, "respaldadas": respaldadas}
