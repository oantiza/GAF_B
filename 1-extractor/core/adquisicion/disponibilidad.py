# -*- coding: utf-8 -*-
"""Por qué un instrumento no trae datos: cinco estados, ninguno un booleano.

Decisión de Óscar del 02-11-2026 (decisión 14 de `DECISIONES_BASE_NUEVA`), unificada con
el alcance de mercados del mismo día porque son el mismo acto: **dejar de producir el dato
de un instrumento, por la razón que sea, hoy lo hace desaparecer en silencio**.

Medido el 02-11-2026, que es lo que obliga a esto:

- Cinco acciones españolas del alcance no tienen ficha. No era un fallo de fuente: han
  dejado de cotizar —CLEOP en 2017, Siemens Gamesa en 2023, NH Hoteles el 04-09, Ercros el
  21-09— y CAM nunca tuvo serie. **Ninguna está en la base**, y en ningún sitio pone por
  qué. NH figuraba en la base vieja con 8.673 observaciones y en la nueva no está.
- Dos acciones fuera de alcance —`LU1598757687` y `FI4000297767`— **sí están** en la base,
  porque tenían ficha de julio, anterior a que el alcance existiera. Dejar de emitir su
  canónico no las quitaría: el escritor de la base no borra nada a propósito, y un
  instrumento que desaparece del canónico no sale ni como sobrante, porque los sobrantes se
  cuentan sobre instrumentos que se vuelven a escribir. Pasarían de «fuera de alcance» a
  congeladas y mudas, que es peor.

## Por qué cinco valores y no una bandera

Un `disponible: false` fundiría cosas que son opuestas para quien lee una ficha. Que un
instrumento esté fuera de alcance es **una decisión nuestra y reversible mañana**; que haya
dejado de cotizar **no se deshace**; y que no lo sepamos porque la petición falló no es
ninguna de las dos. La misma lección que la etiqueta del índice: un campo vacío no afirma
nada, y dos ausencias de distinto motivo tienen que poder distinguirse seis meses después.

- `COTIZA`            — el proveedor lo resuelve hoy.
- `FUERA_DE_ALCANCE`  — decidido por nosotros; no se le piden datos. Reversible.
- `DEJO_DE_COTIZAR`   — el proveedor **contestó** y ya no resuelve un símbolo que antes sí.
- `NUNCA_RESUELTO`    — el proveedor contestó y nunca lo resolvió. No es una defunción:
                        puede ser un ISIN que ningún proveedor de precio cubre, como la
                        CAM. Ojo con leerlo como «nadie lo conoce»: FIRDS sí la tiene,
                        admitida en XMAD el 23-07-2008, sin baja y con un CFI que no es de
                        acción (`EMXXXR`), y por eso no es candidata en `main.py universo`
                        (07-11-2026, `tests/test_cam_fuera_de_candidatos.py`). Desde el
                        mismo día la CAM es `DEJO_DE_COTIZAR` por **decisión**, no por
                        evidencia: `config/bajas_decididas.csv` y `core/bajas_decididas.py`.
- `SIN_DETERMINAR`    — el intento falló: red caída, proveedor con error, modo sin red.
                        **Nunca** es una defunción, y es el estado que más fácil se
                        confunde con ella.

## La condición que lo hace correcto, y la que lo haría falso

Para decir `DEJO_DE_COTIZAR` hacen falta **dos** cosas, no una: que el proveedor haya
contestado, y que antes resolviera. Sin la primera, una tarde sin red mataría la mitad del
catálogo. Sin la segunda, cualquier ISIN que nadie cubre pasaría por difunto.

Y lo que **no** vale como prueba, aunque sea tentador: la frescura del precio. El 02-11 la
base tenía 297 acciones al día y 2 rezagadas, y las dos lo estaban por **alcance**, no por
defunción. Deducir la marca de la fecha del último precio confundiría esos dos casos
exactamente, que es el defecto que esta pieza viene a cerrar.
"""
from __future__ import annotations

import datetime as dt

COTIZA = "cotiza"
FUERA_DE_ALCANCE = "fuera_de_alcance"
DEJO_DE_COTIZAR = "dejo_de_cotizar"
NUNCA_RESUELTO = "nunca_resuelto"
SIN_DETERMINAR = "sin_determinar"

ESTADOS = (COTIZA, FUERA_DE_ALCANCE, DEJO_DE_COTIZAR, NUNCA_RESUELTO, SIN_DETERMINAR)

#: Los estados en que el instrumento sigue vivo para el escaparate.
VIVOS = (COTIZA,)

#: Los estados que NO autorizan a borrar nada. Son todos: un instrumento marcado deja de
#: estar en el escaparate, no de existir. Si un cliente lo tuvo, su historia hace falta
#: para sus informes.
NUNCA_BORRAR = ESTADOS


def decide(*, en_alcance: bool, proveedor_contesto: bool, resuelve_ahora: bool,
           resolvia_antes: bool) -> str:
    """El estado de un instrumento, a partir de lo que de verdad se sabe de él.

    El orden de las ramas es la decisión de diseño: el alcance va primero porque a un
    instrumento fuera de alcance **no se le pregunta**, así que no se puede afirmar nada
    de su cotización; y la falta de respuesta va antes que la defunción porque el silencio
    no es una respuesta.
    """
    if not en_alcance:
        return FUERA_DE_ALCANCE
    if resuelve_ahora:
        return COTIZA
    if not proveedor_contesto:
        return SIN_DETERMINAR
    return DEJO_DE_COTIZAR if resolvia_antes else NUNCA_RESUELTO


#: La fuente cuya respuesta prueba que un instrumento cotiza. No es una preferencia: es
#: la única del plan a la que se le pregunta por un símbolo, y la única, por tanto, que
#: puede contestar que no lo tiene. Un fondo no pasa por aquí, y de ahí que `desde_la_pasada`
#: devuelva `None` para él en vez de inventarle un estado (02-11-2026).
FUENTE_QUE_PRUEBA_COTIZACION = "eodhd"


def desde_la_pasada(*, en_alcance: bool, contesto: bool | None, resuelve_ahora: bool,
                    resolvia_antes: bool | None) -> str | None:
    """El estado a partir de lo que deja ver una pasada del extractor.

    Devuelve `None` —ninguna marca, campo ausente— en los dos casos en que los cinco
    estados afirmarían más de lo que se sabe. Un campo vacío no afirma nada; cualquiera de
    los cinco sí.

    **Uno: no se le preguntó.** `contesto is None`. Le pasa a los fondos, que no pasan por
    el buscador de símbolos, y a una pasada `--sin-red` que no llegó a intentarlo.

    **Dos: no se sabe nada del antes.** `resolvia_antes is None` y el proveedor contestó
    que no lo tiene. `DEJO_DE_COTIZAR` afirmaría una cotización anterior y `NUNCA_RESUELTO`
    afirmaría que no la hubo, y ninguna de las dos está probada. Es el caso real de cuatro
    de las cinco españolas que dejaron de cotizar: aquí no tienen ficha ni histórico, así
    que localmente no hay con qué distinguir a NH Hoteles —que cotizó hasta el 04-09— de
    la CAM, que nunca tuvo serie. Marcarlas `NUNCA_RESUELTO` seria mentir sobre tres
    empresas que cotizaron años.

    El alcance va antes que todo lo demás, igual que en `decide`: a un instrumento fuera
    de alcance no se le pregunta, así que su marca no depende de ninguna respuesta.
    """
    if not en_alcance:
        return FUERA_DE_ALCANCE
    if contesto is None:
        return None
    if contesto and not resuelve_ahora and resolvia_antes is None:
        return None
    return decide(en_alcance=True, proveedor_contesto=contesto,
                  resuelve_ahora=resuelve_ahora, resolvia_antes=bool(resolvia_antes))


def marca(estado: str, *, hoy: dt.date | None = None, detalle: str = "",
          anterior: dict | None = None, desde: str | None = None) -> dict:
    """La marca que va a `meta.disponibilidad`, conservando desde cuándo es así.

    `desde` no se pisa mientras el estado no cambie: lo que interesa de una acción que
    dejó de cotizar es el día que dejó de resolverse, no el de la última pasada. Un
    `SIN_DETERMINAR` tampoco borra el `desde` de un estado anterior distinto, porque no
    afirma nada sobre él.

    `desde`, si se da, es **la fecha del hecho** y gana a las dos: a la de la marca anterior y a
    la de hoy. Lo usa el ISIN sustituido (decisión 15 de `DECISIONES_DATOS_2026-11-07.md`), cuya
    baja tiene fecha conocida —la primera negociación del sucesor según FIRDS— y no depende de
    cuándo la vimos.
    """
    if estado not in ESTADOS:
        raise ValueError(f"estado desconocido: {estado!r} (son {', '.join(ESTADOS)})")
    hoy = hoy or dt.date.today()
    previo = anterior or {}
    igual = str(previo.get("estado") or "") == estado
    desde = desde or (str(previo.get("desde") or "") if igual else "")
    out = {
        "estado": estado,
        "desde": desde or hoy.isoformat(),
        "visto": hoy.isoformat(),
    }
    if detalle:
        out["detalle"] = detalle
    return out
