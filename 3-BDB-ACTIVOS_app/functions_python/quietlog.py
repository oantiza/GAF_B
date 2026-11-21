# -*- coding: utf-8 -*-
"""
Registro de excepciones silenciadas (A3.5).

La auditoría del 25-08 contó ~40 `except Exception:` que degradaban a un valor
por defecto sin dejar rastro: el comportamiento (degradar y seguir) es correcto,
pero el silencio hacía indiagnosticable saber CUÁNDO se está degradando.

Uso, siempre DENTRO del bloque except:

    except Exception:
        swallowed("modulo.py:funcion")   # aviso con traza (WARNING)
        return valor_por_defecto

    except Exception:
        swallowed_quiet("modulo.py:bucle")  # DEBUG: bucles por elemento
        continue

`swallowed_quiet` existe para los bucles calientes (un fallo por punto de serie
o por activo): a nivel DEBUG no inunda Cloud Logging con el nivel por defecto
(INFO) y sigue disponible subiendo la verbosidad cuando se investiga.
"""
import logging

_logger = logging.getLogger("bdb.quiet")


def swallowed(context: str) -> None:
    """Anota con traza una excepción capturada a propósito (nivel WARNING)."""
    _logger.warning("Excepcion absorbida en %s", context, exc_info=True)


def swallowed_quiet(context: str) -> None:
    """Variante DEBUG para fallos por elemento dentro de bucles."""
    _logger.debug("Excepcion absorbida en %s", context, exc_info=True)
