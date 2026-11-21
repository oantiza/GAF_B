"""Procedencia por campo: quién escribió cada ruta del esquema y cuándo.

Hasta el 04-09 `meta.fuentes` decía qué fuentes tocaron cada bloque de primer
nivel (`cartera: [cnmv, morningstar_lt]`) pero no quién puso cada hoja. Eso
impedía dos cosas: auditar un respaldo («¿el SRI viene del KID oficial o de
Morningstar?») y medir el rediseño («¿qué campos dejaron de depender de X?»).

Mecánica, sin tocar los fetchers línea a línea: `core.schema.set_path` es el
único punto por el que las fuentes escriben en el esquema, y consulta aquí si
hay un registro activo. Cada adaptador se ejecuta dentro de `activa()`, y las
fases internas (screener, snapshot, Mifid...) se envuelven en `etapa()`. Las
escrituras que ocurren fuera de una etapa se atribuyen al adaptador entero.

Las rutas se guardan tal cual las escribe `set_path` (p.ej. `documentos` o
`cartera.paises_pct`, que son dicts enteros): al resolver una hoja se sube por
sus ancestros hasta encontrar quién la escribió.
"""
from __future__ import annotations

import contextlib
import contextvars
import datetime as dt
from typing import Any, Iterator

_REGISTRO: contextvars.ContextVar["Registro | None"] = contextvars.ContextVar(
    "fondosdb_procedencia_registro", default=None)
_ETAPA: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "fondosdb_procedencia_etapa", default=None)

SEPARADOR = ":"  # fuente:endpoint
DERIVADO = "derivado"  # prefijo de lo calculado sin red (derivados, calidad, limpieza)
RETENIDO = "retenido"  # dato de la pasada anterior que la fuente dejó de traer (ver retencion)


def etiqueta(fuente: str, endpoint: str | None = None) -> str:
    return f"{fuente}{SEPARADOR}{endpoint}" if endpoint else fuente


def fuente_de(etiqueta_: str | None) -> str | None:
    """`morningstar_lt:screener` -> `morningstar_lt`."""
    if not etiqueta_:
        return None
    return etiqueta_.split(SEPARADOR, 1)[0]


class Registro:
    """Rutas escritas por un adaptador y las descargas que las respaldan."""

    def __init__(self, fuente: str):
        self.fuente = fuente
        self.rutas: dict[str, str] = {}
        # etiqueta -> {"fetched_at": iso, "url": ...}
        self.endpoints: dict[str, dict[str, Any]] = {}
        # endpoint -> fetched_at (época) de la copia caducada, o None: lo que el
        # adaptador no pudo servir en esta pasada sin red (ver `no_servido`).
        self.no_servidos: dict[str, float | None] = {}
        # ¿Contestó el proveedor cuando se le preguntó si conoce el instrumento?
        # None es «no se le preguntó», y no es lo mismo que False (ver `contesto`).
        self.contesto: bool | None = None
        # El ISIN que ha sustituido a este, si el proveedor del precio lo ha dejado ver (ver
        # `sustituido_por`). None es «no se sabe de ninguno», no «no lo hay».
        self.sucesor: str | None = None

    def anota(self, ruta: str) -> None:
        self.rutas[ruta] = _ETAPA.get() or self.fuente

    def olvida(self, ruta: str) -> None:
        self.rutas.pop(ruta, None)

    def resuelve(self, ruta: str) -> str:
        """Etiqueta de la ruta o de su ancestro más cercano; si nada, la fuente."""
        partes = ruta.split(".")
        for n in range(len(partes), 0, -1):
            candidata = ".".join(partes[:n])
            if candidata in self.rutas:
                return self.rutas[candidata]
        return self.fuente

    def endpoint(self, nombre: str | None, fetched_at: float | None = None,
                 **extra: Any) -> None:
        """Registra una descarga (o lectura de caché) que respalda una etapa."""
        clave = etiqueta(self.fuente, nombre)
        info = self.endpoints.setdefault(clave, {})
        if fetched_at:
            info["fetched_at"] = dt.datetime.fromtimestamp(
                fetched_at, dt.timezone.utc).isoformat(timespec="seconds")
        for k, v in extra.items():
            if v is not None:
                info[k] = v


def registro_activo() -> Registro | None:
    return _REGISTRO.get()


def epoca_valida(valor: Any, margen_s: float = 86400) -> float | None:
    """Un `fetched_at` (época en segundos) utilizable, o None.

    Solo números finitos, positivos y no futuros (con un día de margen). Una
    copia editada a mano o corrupta puede traer `NaN`, `Infinity` o `1e20`
    (literales JSON válidos para Python): `NaN` hacía fallar la retención y con
    ello todo `update --all`, y `1e20` dejaba la copia vigente para siempre y
    tumbaba el export con `OverflowError` (revisión, MEN-G)."""
    import math
    import time

    try:
        x = float(valor)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x) or x <= 0 or x > time.time() + margen_s:
        return None
    return x


def no_servido(endpoint: str, fetched_at: float | None = None) -> None:
    """El adaptador activo no pudo servir `endpoint` en esta pasada.

    Lo usa una fuente que no pasa por `core.http` cuando, en modo sin red, no
    tiene copia vigente (la ficha completa de justETF). La retención solo
    conserva lo de esa fuente si se marcó así: si la copia se sirvió y ya no
    trae un campo, no se resucita (revisión de la tercera pasada, MEN-A).
    `fetched_at`: cuándo se descargó la copia caducada, si la hay; es la fecha
    real del dato para el tope de la retención (MEN-B)."""
    reg = _REGISTRO.get()
    if reg is not None:
        reg.no_servidos[endpoint] = fetched_at


def contesto(respondio: bool) -> None:
    """El proveedor activo contestó (o no) a la pregunta de si conoce el instrumento.

    Mismo canal que `no_servido`: una señal del adaptador al núcleo que no es un dato de
    la ficha. La necesita `disponibilidad` para no confundir «el proveedor dice que no lo
    tiene» con «no hubo manera de preguntárselo», que es la distinción de la que depende
    no marcar como difunto medio catálogo una tarde sin red.

    Si varias peticiones de la misma pasada se contradicen manda el **sí**: que una
    contestara prueba que el proveedor estaba comunicando.
    """
    reg = _REGISTRO.get()
    if reg is None:
        return
    reg.contesto = bool(respondio) if reg.contesto is None else (reg.contesto or bool(respondio))


def sustituido_por(isin_nuevo: str) -> None:
    """El listado que se le conocía al instrumento es hoy de otro ISIN, que lo ha sustituido.

    Mismo canal que `contesto`: una señal al núcleo, no un dato de la ficha. Decisión 1 de
    `DECISIONES_DATOS_2026-11-07.md`: Aena cambió de ISIN (`ES0105046009` → `ES0105046017`),
    el universo tenía los dos, y el viejo salía «cotiza» porque una corrección le fijaba el
    símbolo `AENA.MC`, que es el del nuevo. El precio era bueno y del mismo valor, pero el
    instrumento que cotiza es el otro. Quien comprueba que es una sustitución y no un listado
    con el ISIN mal puesto es `eodhd.sucesor_de`.
    """
    reg = _REGISTRO.get()
    if reg is not None:
        reg.sucesor = str(isin_nuevo).strip().upper() or None


def respuesta_sin_cerrar() -> None:
    """El proveedor activo ha contestado, pero su respuesta no basta y esta pasada no puede completarla.

    Lo que hace falta para una acción que el buscador de EODHD no tiene y Yahoo sí, en modo sin
    red: EODHD contesta que no la tiene, Yahoo no se puede preguntar, y «no la tiene» no es «dejó
    de cotizar». Aquí no manda el sí, a diferencia de `contesto`: la respuesta que había deja de
    valer y queda como si no se hubiera preguntado, que es lo que ha pasado. Así la pasada no
    escribe marca, y la que había se queda con su fecha: no ha aprendido nada de ese instrumento.
    """
    reg = _REGISTRO.get()
    if reg is not None:
        reg.contesto = None


def anota(ruta: str) -> None:
    """Llamado por `core.schema.set_path`: sin registro activo no hace nada."""
    reg = _REGISTRO.get()
    if reg is not None:
        reg.anota(ruta)


@contextlib.contextmanager
def activa(fuente: str) -> Iterator[Registro]:
    """Abre un registro para un adaptador; todo `set_path` dentro queda atribuido."""
    reg = Registro(fuente)
    token = _REGISTRO.set(reg)
    try:
        yield reg
    finally:
        _REGISTRO.reset(token)


@contextlib.contextmanager
def etapa(endpoint: str | None, fetched_at: float | None = None,
          **extra: Any) -> Iterator[None]:
    """Atribuye las escrituras del bloque a `fuente:endpoint`.

    `fetched_at` (época) es el momento de descarga real de la respuesta que
    alimenta la etapa, aunque se haya servido de caché.
    """
    reg = _REGISTRO.get()
    if reg is None:
        yield
        return
    etiqueta_ = etiqueta(reg.fuente, endpoint)
    reg.endpoint(endpoint, fetched_at, **extra)
    token = _ETAPA.set(etiqueta_)
    try:
        yield
    finally:
        _ETAPA.reset(token)


# ------------------------------------------------------------------ hojas
def hojas(d: Any, prefijo: str = "") -> Iterator[tuple[str, Any]]:
    """(ruta, valor) de cada hoja escalar o lista; los dicts vacíos no cuentan."""
    if isinstance(d, dict):
        for k, v in d.items():
            ruta = f"{prefijo}.{k}" if prefijo else str(k)
            if isinstance(v, dict):
                if v:
                    yield from hojas(v, ruta)
            else:
                yield ruta, v
    else:
        yield prefijo, d


def por_fuente(procedencia: dict[str, str]) -> dict[str, int]:
    """Cuántas rutas escribió cada fuente (sin el endpoint)."""
    cuenta: dict[str, int] = {}
    for etiqueta_ in procedencia.values():
        f = fuente_de(etiqueta_) or "?"
        cuenta[f] = cuenta.get(f, 0) + 1
    return dict(sorted(cuenta.items(), key=lambda x: -x[1]))
