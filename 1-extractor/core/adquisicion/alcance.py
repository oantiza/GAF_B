# -*- coding: utf-8 -*-
"""A quién se le piden datos: el alcance de mercados, leído por el código.

Hasta el 02-11-2026 `config/alcance_mercados.json` no lo leía **nada**. Se midió al
ampliarlo: las únicas menciones a «alcance» en `.py` eran prosa de docstring y el
parámetro `en_alcance` de `disponibilidad.decide`, que no tenía llamante. Así que el
alcance era el *registro* de una decisión y no un filtro: nunca excluyó a nadie de una
petición, y de ahí que dos acciones de fuera de alcance tuvieran ficha de julio y
`update --all` saliera por las 312. Óscar, al verlo: que mande.

## La trampa que este módulo existe para no pisar

El alcance es **de acciones**. Lo dice la primera línea del fichero y es fácil de olvidar
porque el criterio es un país, y el país parece aplicable a todo. **546 de los 760 fondos
del universo son luxemburgueses.** Un filtro por país que no mire el tipo se llevaría por
delante casi toda la base en la pasada siguiente, y lo haría en silencio y en verde,
porque no faltaría ningún documento: simplemente nadie habría pedido los datos.

Por eso `estado` exige el tipo, y por eso solo gobierna a `accion`. Un tipo que no sea
`accion` —y un tipo que no conozcamos— queda `DENTRO`: no se puede afirmar que una fila es
una acción porque su ISIN empiece por LU.

## Tres valores, no un booleano

Hoy los doce países de dentro y los dos de fuera cubren las 312 acciones del universo, así
que `SIN_DECIDIR` no le toca a ninguna. Existe para la primera alta de un país que nadie
ha decidido todavía, que es cuando un booleano haría daño: `False` la excluiría afirmando
una decisión que Óscar no ha tomado, y `True` gastaría red contra «solo Europa y EEUU».
Ninguna de las dos es verdad, así que se nombra y se deja fuera de la pasada automática,
que es lo único que no afirma nada.

Es la misma lección que la etiqueta del índice y que los cinco estados de
`disponibilidad`: dos ausencias de distinto motivo tienen que poder distinguirse seis
meses después.

Y una consecuencia que conviene saber antes de usarlo junto a `disponibilidad.decide`:
sus cinco estados **no tienen valor para «no decidido todavía»**. `SIN_DECIDIR` no es
`FUERA_DE_ALCANCE`, que es una decisión nuestra, ni `SIN_DETERMINAR`, que es un intento
fallido. Hoy no afecta a ningún instrumento; el día que una alta caiga ahí habrá que
decidir el sexto estado o el país, y es mejor decidir el país.
"""
from __future__ import annotations

import json
from pathlib import Path

#: Se le piden datos.
DENTRO = "dentro"
#: Decidido por nosotros que no. Reversible: se añade el país y se relanza la pasada.
FUERA = "fuera"
#: Su país no está ni en una lista ni en la otra. **No es una decisión**, es su ausencia.
SIN_DECIDIR = "sin_decidir"

ESTADOS = (DENTRO, FUERA, SIN_DECIDIR)

#: El único tipo del universo que el alcance gobierna. Ver la trampa, arriba.
TIPO_GOBERNADO = "accion"

NOMBRE_FICHERO = "alcance_mercados.json"


class Alcance:
    """Los dos conjuntos de países del fichero, ya leídos."""

    def __init__(self, dentro: dict[str, str], fuera: dict[str, str],
                 isines_fuera: dict[str, str] | None = None):
        comunes = set(dentro) & set(fuera)
        if comunes:
            raise ValueError(
                "paises en las dos listas del alcance, que es una contradiccion: "
                + ", ".join(sorted(comunes)))
        self.dentro = dentro
        self.fuera = fuera
        self.isines_fuera = {str(k).strip().upper(): v
                             for k, v in (isines_fuera or {}).items()}

    def estado(self, isin: str, tipo: str) -> str:
        """`DENTRO`, `FUERA` o `SIN_DECIDIR` para una fila del universo.

        El `tipo` no es decorativo: sin él, un fondo luxemburgués saldría `FUERA`.
        Salvo para `isines_fuera`, que **no** mira el tipo: ver abajo.
        """
        # Un ISIN nombrado a mano gana al pais, y en los dos sentidos: excluye a uno de
        # un pais que entra, y lo haria aunque su pais estuviese fuera. Y no mira el
        # tipo, a diferencia del criterio de pais: la trampa del tipo existe porque un
        # pais parece aplicable a todo y se lleva 546 fondos por delante sin que nadie
        # lo note. Nombrar un ISIN es un acto explicito sobre UN instrumento, asi que
        # limitarlo a las acciones solo conseguiria que una exclusion escrita a mano no
        # hiciera nada en silencio, que es peor que el riesgo que evita.
        clave = (isin or "").strip().upper()
        if clave in self.isines_fuera:
            return FUERA
        if not self.dentro and not self.fuera:
            # Sin fichero, o con las dos listas vacias, el alcance no dice nada. Un
            # `SIN_DECIDIR` aqui pararia el catalogo entero por una ruta mal puesta.
            return DENTRO
        if (tipo or "").strip().lower() != TIPO_GOBERNADO:
            return DENTRO
        pais = clave[:2]
        if pais in self.dentro:
            return DENTRO
        if pais in self.fuera:
            return FUERA
        return SIN_DECIDIR

    def motivo(self, isin: str, tipo: str) -> str:
        """Lo que el fichero dice de su país, para poder imprimirlo. Vacío si está dentro."""
        est = self.estado(isin, tipo)
        if est == DENTRO:
            return ""
        clave = (isin or "").strip().upper()
        if clave in self.isines_fuera:
            return self.isines_fuera[clave]
        pais = clave[:2]
        if est == FUERA:
            return self.fuera.get(pais, pais)
        return (f"{pais} no esta ni en 'paises_dentro' ni en 'paises_fuera': nadie ha "
                f"decidido todavia si entra")

    def reparte(self, objetivos):
        """Separa `[(isin, tipo), ...]` en los tres grupos, conservando el orden."""
        grupos: dict[str, list] = {e: [] for e in ESTADOS}
        for isin, tipo in objetivos:
            grupos[self.estado(isin, tipo)].append((isin, tipo))
        return grupos


def carga(base: Path) -> Alcance:
    """Lee `config/alcance_mercados.json`.

    Si el fichero no está, **no se inventa un alcance**: se deja todo dentro, que es lo
    que el sistema hacía hasta el 02-11-2026, en vez de excluir al catálogo entero por
    una ruta mal puesta.
    """
    ruta = Path(base) / "config" / NOMBRE_FICHERO
    if not ruta.exists():
        return Alcance({}, {})
    with open(ruta, encoding="utf-8") as f:
        cfg = json.load(f)
    return Alcance(dict(cfg.get("paises_dentro") or {}),
                   dict(cfg.get("paises_fuera") or {}),
                   dict(cfg.get("isines_fuera") or {}))


def mic_firds(base: Path) -> tuple[str, ...] | None:
    """Los centros FIRDS activos (`mic_firds`, decision 34), o None si el fichero o la
    clave faltan; quien llama cae entonces a su constante. Los candidatos futuros no se
    leen aqui: estan nombrados y no activos."""
    ruta = Path(base) / "config" / NOMBRE_FICHERO
    if not ruta.exists():
        return None
    with open(ruta, encoding="utf-8") as f:
        lista = json.load(f).get("mic_firds")
    if not lista:
        return None
    return tuple(str(m).strip().upper() for m in lista)
