"""Planificador: qué adaptadores tocan a un activo y qué familias se refrescan.

El plan es deliberadamente simple porque la frescura la decide la caché por
petición (`core.http` lee con el TTL de cada familia): el planificador elige
qué adaptadores ejecutar (aplican al activo y están en la lista de fuentes
activas, o son oficiales/implícitos) y en qué orden (los que usan pistas de
otros van después). Las familias pedidas se anotan en el plan pero no recortan
la lista: pedir solo lo caducado ocurre endpoint a endpoint dentro de cada
adaptador, y lo no pedido se sirve de caché.
"""
from __future__ import annotations

import dataclasses

from core.adquisicion.adaptador import Adaptador


@dataclasses.dataclass
class Plan:
    isin: str
    tipo: str
    adaptadores: list[Adaptador]
    familias: set[str] | None          # None = todas
    omitidos: dict[str, str]           # id -> motivo

    def ids(self) -> list[str]:
        return [a.id for a in self.adaptadores]


def planifica(isin: str, tipo: str, disponibles: list[Adaptador],
              fuentes_activas: list[str] | None = None,
              familias: set[str] | None = None) -> Plan:
    """Selecciona y ordena los adaptadores para un activo.

    `fuentes_activas` es la lista de ids permitidos (settings.prioridad_fuentes
    o `--fuentes`); los adaptadores oficiales entran siempre que apliquen,
    porque no cuestan licencia ni dependen de un proveedor comercial. Qué
    activos toca cada uno lo dice su `aplica` (las acciones solo pasan por
    EODHD, como hasta ahora).
    """
    elegidos, omitidos = [], {}
    activos = set(fuentes_activas) if fuentes_activas is not None else None
    for a in disponibles:
        if not a.aplica(isin, tipo):
            omitidos[a.id] = "no aplica al activo"
            continue
        if activos is not None and a.id not in activos and not (a.oficial or a.implicito):
            omitidos[a.id] = "fuera de las fuentes activas"
            continue
        # Las familias pedidas NO recortan la lista de adaptadores: un refresco
        # de «precio» tiene que conservar el SRI del KID, la gestora legal y
        # todo lo demás. Quien decide qué sale a red es la caché, endpoint a
        # endpoint (`Http.ttl_para`): lo no pedido se sirve de caché aunque
        # haya caducado. Excluir adaptadores aquí borraba sus datos de la ficha
        # (detectado el 05-09 en 25 fondos refrescados con --familias precio).
        elegidos.append(a)
    elegidos.sort(key=lambda a: a.orden)
    return Plan(isin=isin, tipo=tipo, adaptadores=elegidos, familias=familias,
                omitidos=omitidos)
