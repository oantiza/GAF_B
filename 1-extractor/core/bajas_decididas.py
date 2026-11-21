# -*- coding: utf-8 -*-
"""Bajas decididas: «dejó de cotizar» por decisión de una persona, no por evidencia de fuente.

Decisión 7 de `DECISIONES_DATOS_2026-11-07.md`. Hasta hoy `meta.disponibilidad` solo podía
salir de lo que contesta el proveedor del precio (decisión 14, `core/adquisicion/disponibilidad`),
y eso deja sin camino a un instrumento que sabemos muerto pero del que ninguna fuente de
precio dice nada. El caso que lo obliga es la CAM (`ES0114400007`): sus cuotas no se negocian
desde 2011, nunca tuvieron serie aquí, y la ficha decía `nunca_resuelto` —«ninguna fuente lo
ha cubierto»—, que es falso en lo que importa a un asesor: FIRDS la tiene, y está muerta.

## Por qué un fichero propio y no `config/correcciones.json`

Una corrección sustituye **un campo de datos** que una fuente trae mal, y se aplica antes del
saneado para que lo derivado salga ya corregido. Rechaza a propósito las rutas `meta.*`: «lo
calcula el extractor». La disponibilidad no es un campo de datos sino el juicio sobre todos
ellos, y se decide al final de la pasada, cuando la ficha ya está terminada. Meterla en las
correcciones obligaba a romper su regla y a enseñarla en el editor de campos de la app como
si fuera un dato más. Aquí cada fila es un ISIN y dice cinco cosas, todas obligatorias:

- `isin`
- `desde`          — la fecha del HECHO, no la de la decisión, y con una regla única
                     (decisión 11 del 07-11-2026): **el primer día sin negociación, es decir, el
                     día de la suspensión**. La exclusión formal, si es posterior, va en el
                     `motivo`, no aquí. Es lo que el contrato llama `since`: «de una acción que
                     dejó de cotizar lo que interesa es el día que dejó de resolverse», y el
                     valor deja de poder negociarse al suspenderse, no al excluirse. Una sola
                     regla para todas hace comparables las fechas: NH (suspendida el 15-09-2025,
                     excluida con efectos del 25-09-2025) lleva el 15 y Ercros el 11-09-2026, su
                     suspensión, aunque la exclusión fuese el 22.
- `motivo`         — qué pasó y con qué fuente se comprobó.
- `autor`          — quién lo decide, en texto: «Óscar, decisión 7 del 07-11-2026».
- `fecha_decision` — cuándo se decidió.

## Lo que hace con la ficha (en `nucleo._marca_disponibilidad`)

La decisión **gana** a cualquier evidencia de fuente, porque es la que sabe más: un proveedor
que sigue sirviendo el último precio de un valor excluido no prueba que cotice. Pero no la
calla: si la evidencia de la pasada dice `cotiza`, la marca lleva `conflicto` con lo que dijo
la fuente y cuándo, y queda un aviso en el log. Una pasada que no sabe nada (`sin_determinar`,
sin red) no es un conflicto: no afirma nada.

Y la marca lleva `origen: "decision"` con la fila entera en `decision`, para que nadie la lea
como una medición. Las marcas medidas no llevan `origen`, así que su canónico no cambia.
Desde el 07-11-2026 (decisión 10) ese `origen` llega a la base nueva: `instrument.v2` lleva
`availability.basis` (`DECISION` o `SOURCE_EVIDENCE`, que es lo que vale sin `origen`) y
`availability.decision` con `decided_by`, `decided_at` y `reason`, que son `autor`,
`fecha_decision` y `motivo` de la fila. El mapper es `src/ingestion/baseNueva/mapper.ts` de la
plataforma; un `origen` que no sepa traducir para la marca en vez de leerla como evidencia.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import re
from pathlib import Path

from core.package_integrity import lee_bytes

FICHERO = Path("config") / "bajas_decididas.csv"
COLUMNAS = ("isin", "desde", "motivo", "autor", "fecha_decision")
ORIGEN = "decision"
RE_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


class ErrorBaja(ValueError):
    pass


def _fecha(texto: str, campo: str, isin: str) -> dt.date:
    try:
        return dt.date.fromisoformat(str(texto or "").strip())
    except ValueError as e:
        raise ErrorBaja(f"{FICHERO} {isin}: «{campo}» no es una fecha AAAA-MM-DD: {texto!r}") from e


def lee(texto: str, hoy: dt.date | None = None) -> dict[str, dict]:
    """ISIN -> fila validada. Un fichero mal escrito es un error, no un fichero vacío: una baja
    decidida que no se aplica en silencio devolvería la CAM a «nunca resuelto»."""
    hoy = hoy or dt.date.today()
    lector = csv.DictReader(io.StringIO(texto.lstrip("﻿")))
    if tuple(lector.fieldnames or ()) != COLUMNAS:
        raise ErrorBaja(f"{FICHERO}: la cabecera tiene que ser {','.join(COLUMNAS)}; "
                        f"es {','.join(lector.fieldnames or ())}")
    out: dict[str, dict] = {}
    for fila in lector:
        if not any((v or "").strip() for v in fila.values()):
            continue
        if None in fila:
            raise ErrorBaja(f"{FICHERO}: una fila tiene columnas de más (¿una coma sin comillas "
                            f"en el motivo?): {fila}")
        isin = str(fila["isin"] or "").strip().upper()
        if not RE_ISIN.match(isin):
            raise ErrorBaja(f"{FICHERO}: ISIN no válido: «{isin}»")
        if isin in out:
            raise ErrorBaja(f"{FICHERO}: {isin} está dos veces")
        desde = _fecha(fila["desde"], "desde", isin)
        decidida = _fecha(fila["fecha_decision"], "fecha_decision", isin)
        if desde > hoy or decidida > hoy:
            raise ErrorBaja(f"{FICHERO} {isin}: una fecha futura no es una baja, es una previsión")
        motivo = " ".join(str(fila["motivo"] or "").split())
        autor = " ".join(str(fila["autor"] or "").split())
        if len(motivo) < 10:
            raise ErrorBaja(f"{FICHERO} {isin}: hace falta un motivo (qué pasó y con qué fuente)")
        if len(autor) < 2:
            raise ErrorBaja(f"{FICHERO} {isin}: hace falta quién lo decide")
        out[isin] = {"desde": desde.isoformat(), "motivo": motivo, "autor": autor,
                     "fecha_decision": decidida.isoformat()}
    return out


def carga(base: Path, hoy: dt.date | None = None) -> dict[str, dict]:
    """Las bajas decididas del proyecto. Fichero ausente = ninguna."""
    ruta = Path(base) / FICHERO
    if not ruta.exists():
        return {}
    return lee(lee_bytes(ruta).decode("utf-8"), hoy=hoy)


def de(isin: str, base: Path) -> dict | None:
    return carga(base).get(str(isin or "").strip().upper())


def marca(fila: dict, *, hoy: dt.date | None = None, evidencia: dict | None = None,
          fuente: str = "") -> dict:
    """La marca de `meta.disponibilidad` para una baja decidida.

    `evidencia` es la marca que habría salido de la pasada sin la decisión (o `None`). Solo
    `cotiza` la contradice; lo demás o coincide o no afirma nada.
    """
    from core.adquisicion import disponibilidad

    hoy = hoy or dt.date.today()
    out = {
        "estado": disponibilidad.DEJO_DE_COTIZAR,
        "desde": fila["desde"],
        "visto": hoy.isoformat(),
        "detalle": f"{fila['motivo'].rstrip('.')}. Baja decidida, no medida: {fila['autor']}.",
        "origen": ORIGEN,
        "decision": dict(fila),
    }
    if (evidencia or {}).get("estado") == disponibilidad.COTIZA:
        out["conflicto"] = {"estado_fuente": disponibilidad.COTIZA, "fuente": fuente,
                            "visto": hoy.isoformat()}
    return out


def es_decidida(marca_disp: dict | None) -> bool:
    return (marca_disp or {}).get("origen") == ORIGEN
