"""Lo que comparten las tres entradas de una pasada del extractor.

Una pasada se lanza desde tres sitios —`main.py update`, el servicio de operaciones
(`ops.extrae`) y la aplicación local (`app.trabajo_update`)— y los tres llaman al mismo
`ejecuta_pipeline`. Dos protecciones vivían solo en la primera, o en ninguna (auditoría del
16-11-2026):

- **La guarda de FIRDS** (decisión 57, opción B; EXT-6). Sin índice, `esma_firds.fetch` devuelve
  {} y una ficha que ya tenía identidad FIRDS se reescribe sin sus diez campos sin que nadie lo
  diga. Solo `main.py` se paraba antes de escribir.
- **Una ficha que falla no tumba la pasada** (EXT-7). Cualquier excepción que no fuese de una
  fuente —la retención, la calidad, los derivados, escribir la ficha— cortaba una pasada de
  1.300 activos y dejaba el índice sin regenerar.

Aquí está la regla; cada entrada decide cómo la dice, porque una imprime, otra emite líneas a
una tarea y otra las guarda para el navegador.
"""
from __future__ import annotations

import dataclasses
import json
import traceback
from pathlib import Path

from core.http import sin_claves
from core.store import Store, _g


def firds_visto(ruta: Path) -> bool:
    """Si la ficha guardada lleva `meta.firds_visto`. Solo la lee; no la toca."""
    try:
        return bool(_g(json.loads(ruta.read_text(encoding="utf-8")), "meta", "firds_visto"))
    except (OSError, ValueError):
        return False


@dataclasses.dataclass(frozen=True)
class GuardaFirds:
    """Qué pasaría con la identidad FIRDS de las fichas pedidas si se escriben ahora."""
    # Las fichas pedidas que hoy tienen identidad FIRDS.
    con_firds: tuple[str, ...]
    # El índice falta o no sirve, y esas fichas la perderían: no se debe escribir ninguna.
    bloquea: bool
    # Con `bloquea`: qué le pasa al índice, y con qué orden se arregla.
    causa: str | None = None
    arreglo: str | None = None
    # Con índice: las que tenían identidad y el índice ya no trae. La conservan retenida hasta su
    # plazo (decisión A-170, `retencion.retiene_firds`); pasado el plazo se reescriben sin ella.
    desaparecidos: tuple[str, ...] = ()

    def aviso(self, pedidas: int) -> str:
        return (f"{self.causa}: {len(self.con_firds)} de {pedidas} fichas pedidas perderían la "
                "identidad FIRDS (CFI, LEI, mercados UE y demás) al reescribirse")

    @staticmethod
    def aviso_de_desaparecido(isin: str) -> str:
        """Lo que se dice de un ISIN que tenía identidad FIRDS y ya no está en el índice."""
        from core.adquisicion.retencion import MAX_DIAS_FIRDS
        return (f"{isin} tenía identidad FIRDS y el índice ya no lo trae: la ficha conserva la última "
                f"conocida, marcada como retenida, hasta {MAX_DIAS_FIRDS} días desde que se vio")


def guarda_firds(base: Path, isins: list[str]) -> GuardaFirds:
    """La guarda del índice FIRDS para esos ISIN. No escribe ni avisa: lo dice quien la llama."""
    from fetchers import esma_firds

    store = Store(base)
    con_firds = tuple(i for i in isins if firds_visto(store.funds_dir / f"{i}.json"))
    if not con_firds:
        return GuardaFirds(con_firds=(), bloquea=False)
    # Un índice presente pero ilegible o sin `completo` (a medio construir) vale lo mismo que
    # ninguno: `fetch` vaciaría igual las fichas.
    existe = (base / esma_firds.RUTA_INDICE).exists()
    conocidos = esma_firds.conoce(base, list(con_firds)) if existe else None
    if conocidos is None:
        ruta = esma_firds.RUTA_INDICE.as_posix()
        causa, arreglo = ((f"el índice FIRDS ({ruta}) existe pero no sirve (ilegible o sin "
                           "completo)", "python main.py firds --force") if existe else
                          (f"falta el índice FIRDS ({ruta})", "python main.py firds"))
        return GuardaFirds(con_firds=con_firds, bloquea=True, causa=causa, arreglo=arreglo)
    return GuardaFirds(con_firds=con_firds, bloquea=False,
                       desaparecidos=tuple(i for i in con_firds if not conocidos.get(i, True)))


def describe_fallo(error: BaseException) -> str:
    """El fallo de una ficha en una línea, sin claves: «KeyError: 'riesgo'»."""
    return f"{type(error).__name__}: {sin_claves(error)}"


def traza_del_fallo() -> str:
    """La traza de la excepción en curso, sin claves, para el registro."""
    return sin_claves(traceback.format_exc())


def resumen_de_fallos(fallos: list[tuple[str, str]], pedidas: int) -> list[str]:
    """Las líneas que dicen, al final de la pasada, qué fichas fallaron. Vacío si ninguna."""
    if not fallos:
        return []
    cuantas = "1 ficha ha fallado y no se ha reescrito" if len(fallos) == 1 \
        else f"{len(fallos)} fichas han fallado y no se han reescrito"
    return [f"{cuantas}, de {pedidas} pedidas. Las demás sí:"] + [f"   {isin}  {motivo}" for isin, motivo in fallos]
