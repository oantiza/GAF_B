"""EMT (European MiFID Template, FinDatEx) del emisor: el mercado objetivo, en el bloque `mercado_objetivo`.

Decisión 58 (09-11-2026), tramo T1: el lector en el extractor. La medición está en
`INFORME_EMT_EET_2026-11-09.md` (raíz): iShares, Vanguard e Invesco publican el EMT de toda su gama en
**un fichero único**, sin navegador y sin aceptar nada. Amundi, Xtrackers y SPDR no tienen vía localizada,
y la puerta del portal de DWS no se acepta (decisión 61).

**Una descarga por emisor y pasada, nunca una petición por ISIN.** El fichero se pide con `core.http`
(familia `regulatorio`, su TTL decide si vale la copia de `cache/http/emt/`), se indexa por ISIN una vez
por proceso y cada ficha se lee de ese índice. Con `--force` se vuelve a pedir una sola vez por proceso,
no una por ficha. Los emisores, sus URL, su formato y las marcas con las que se reconoce su producto
viven en `config/settings.json` (`emt_emisores`); sin esa clave el adaptador no hace nada.

**La forma del bloque la fijó Dirección y la plataforma ya la espera así** (encargo del 09-11-2026):

    mercado_objetivo:
      fuente, url_fichero, sha256_fichero, version_plantilla ("V4" | "V4.2"),
      fichero_generado (00005, fecha), fecha_mercado_objetivo (01000, obligatoria),
      tipo_inversor {minorista, profesional, contraparte_elegible}    01010-01030
      conocimiento {basico, informado, avanzado}                      02010-02030
      capacidad_perdidas {sin_perdidas, sin_garantia}                 03010, 03040
      objetivos {crecimiento, rentas}                                 05020, 05030
      periodo_minimo {anos} | {codigo}                                05080
      preferencias_esg_consideradas                                   05105
      distribucion {solo_ejecucion, conveniencia, asesoramiento, gestion_cartera}   06010-06040

Las trampas medidas, y lo que se hace con cada una:

- **`03050` no se lee.** Dice «Y» en el 100 % de los tres ficheros, también en todos los UCITS: significa
  que el producto es *compatible* con un cliente que soporte perder más que el capital, no que pueda
  perderlo. Enseñarlo tal cual sería un error grave, así que no viaja.
- **Vacío es ausente, nunca «NEUTRAL».** Neutral quiere decir que el fabricante no se pronuncia; un hueco
  no dice ni eso. `Neutral`, `NEUTRAL` y `neutral` (según emisor) son lo mismo.
- **`05080` mezcla formatos** (`5`, `5.00000000000000`, `0.92`, `L`): un número son años (`{anos}`), una
  de las letras de FinDatEx es un código (`{codigo}`), y lo vacío o desconocido queda ausente.
- **Cada fila lleva su fecha de mercado objetivo** (de 31-12-2025 a 30-09-2026 en lo medido): sin ella
  no se escribe el bloque, porque un mercado objetivo sin fecha no se puede auditar.
- Un valor fuera del dominio de FinDatEx no se interpreta: se queda ausente y se avisa en el log.

Lo que el bloque **no** lleva, a propósito: SRI, SRRI, costes ni política de reparto, que la base ya tiene
con su fuente. El EET queda fuera (decisión 58). El `07130` (coste de operación ex ante) se usa solo como
**comprobación** del de Morningstar (decisión 60): `comprueba_coste_operacion` lo lee del índice ya cargado y
avisa en el log, sin escribirlo en la ficha.

Un ISIN que el fichero no conoce no escribe nada y no es un error: es lo normal (el fichero de BlackRock
no trae nada de Vanguard). **Uso interno para el desarrollo** (decisión 53): el fichero de Vanguard dice
«solo para inversores profesionales», y nada de esto entra en un informe de cliente.
"""
from __future__ import annotations

import csv
import dataclasses
import datetime as dt
import hashlib
import io
import logging
import math
import re
import time
from pathlib import Path
from typing import Any

from core.adquisicion import procedencia
from core.http import SinCache
from core.schema import set_path

log = logging.getLogger("fondosdb.emt")

FUENTE = "emt"
FAMILIA = "regulatorio"
CLAVE_CONFIG = "emt_emisores"
CABECERAS = {"Accept": "*/*"}
# Invesco atiende con la identificación de herramienta del extractor, la misma con la que `fetchers/invesco.py`
# baja este mismo fichero desde el 08-11-2026 (`"ua_herramienta": true` en su configuración).
UA_HERRAMIENTA = "fondosdb-extractor/1.0 (descarga de documentos de datos fundamentales)"

# `00001_EMT_Version`: las dos que la plataforma admite. Otra versión no se lee a ciegas.
VERSIONES = {"V4": "V4", "V4.0": "V4", "V4.2": "V4.2"}
SI_NO = {"Y": "SI", "YES": "SI", "N": "NO", "NO": "NO", "NEUTRAL": "NEUTRAL"}
CANALES = ("R", "P", "B", "N")
CODIGOS_PERIODO = ("V", "S", "M", "L", "H")
TIPO_ISIN = "1"  # `00020`: 1 es ISIN

SUBBLOQUES: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = (
    ("tipo_inversor", (("minorista", "01010"), ("profesional", "01020"), ("contraparte_elegible", "01030"))),
    ("conocimiento", (("basico", "02010"), ("informado", "02020"), ("avanzado", "02030"))),
    # 03050 no está a propósito: ver la cabecera del módulo.
    ("capacidad_perdidas", (("sin_perdidas", "03010"), ("sin_garantia", "03040"))),
    ("objetivos", (("crecimiento", "05020"), ("rentas", "05030"))),
)
CANAL = (("solo_ejecucion", "06010"), ("conveniencia", "06020"), ("asesoramiento", "06030"),
         ("gestion_cartera", "06040"))

_CODIGO = re.compile(r"^\s*(\d{5})_")
_FECHA = re.compile(r"^\s*(\d{4}-\d{2}-\d{2})")


@dataclasses.dataclass(frozen=True)
class Fichero:
    emisor: str
    url: str
    sha256: str
    descargado: float          # época de la descarga (mtime de la copia)
    filas: dict[str, dict]     # ISIN -> {código de 5 cifras: valor}
    duplicados: frozenset[str]


# Índices ya leídos en este proceso, por copia en disco (ruta, mtime, tamaño): el de BlackRock son
# 6.545 filas y casi dos segundos de lectura, que no se repiten por ficha.
_INDICES: dict[tuple, Fichero] = {}
# URL ya pedidas a red en este proceso: con `--force` se pide una vez por pasada, no una por ISIN.
_PEDIDAS: set[str] = set()


def emisores_configurados(settings: dict | None) -> dict[str, dict]:
    config = (settings or {}).get(CLAVE_CONFIG) or {}
    return {k: v for k, v in config.items() if isinstance(v, dict) and v.get("url")}


def fetch(isin: str, http, settings: dict, force: bool = False, emisores: list[str] | None = None) -> dict:
    """El bloque `mercado_objetivo` del ISIN, del fichero del emisor que lo conozca; `{}` si ninguno.

    `emisores`: los de la configuración que se consultan (el registro pasa los de la marca del nombre).
    """
    isin = isin.strip().upper()
    config = emisores_configurados(settings)
    consultados = [e for e in (config if emisores is None else emisores) if e in config]
    encontrados: list[Fichero] = []
    for emisor in consultados:
        fichero = carga(http, emisor, config[emisor], force)
        if fichero and isin in fichero.filas:
            encontrados.append(fichero)
    if not encontrados:
        return {}
    if len(encontrados) > 1:
        log.warning("emt %s: lo traen %s; no se elige entre dos emisores", isin,
                    ", ".join(f.emisor for f in encontrados))
        return {}
    fichero = encontrados[0]
    if isin in fichero.duplicados:
        log.warning("emt %s: el fichero de %s lo trae en más de una fila; no se elige", isin, fichero.emisor)
        return {}
    bloque = mercado_objetivo(fichero.filas[isin], fichero)
    if not bloque:
        return {}
    out: dict = {}
    with procedencia.etapa(fichero.emisor, fichero.descargado, url=fichero.url):
        for clave, valor in bloque.items():
            set_path(out, f"mercado_objetivo.{clave}", valor)
    log.info("emt %s: %s, mercado objetivo del %s, periodo mínimo %s", isin, fichero.emisor,
             bloque["fecha_mercado_objetivo"], bloque.get("periodo_minimo") or "ausente")
    return out


# ------------------------------------------------------------------ descarga e índice
def carga(http, emisor: str, config: dict, force: bool = False) -> Fichero | None:
    """El fichero del emisor indexado por ISIN, descargándolo solo si su copia no vale. None si no hay copia."""
    url = config["url"]
    formato = str(config.get("formato") or "").lower()
    if formato not in ("xlsx", "csv"):
        log.error("emt %s: formato %r no soportado (xlsx o csv)", emisor, formato)
        return None
    destino = Path(http.cache_dir) / "emt" / f"{emisor}.{formato}"
    vigente = (destino.exists() and destino.stat().st_size > 0
               and (time.time() - destino.stat().st_mtime) / 86400 <= http.ttl_para(FAMILIA))
    pedir = not vigente or (force and url not in _PEDIDAS)
    if pedir and not getattr(http, "sin_red", False):
        try:
            cabeceras = {**CABECERAS, "User-Agent": UA_HERRAMIENTA} if config.get("ua_herramienta") else CABECERAS
            http.download(url, destino, force=True, familia=FAMILIA, headers=cabeceras)
            _PEDIDAS.add(url)
        except SinCache:
            pass
        except Exception as e:  # noqa: BLE001  (un emisor caído no tumba la ficha)
            log.warning("emt %s: no se pudo descargar %s (%s)%s", emisor, url, e,
                        "; sigo con la copia anterior" if destino.exists() else "")
    if not destino.exists() or destino.stat().st_size == 0:
        log.debug("emt %s: sin copia de %s", emisor, url)
        return None
    estado = destino.stat()
    clave = (str(destino), estado.st_mtime_ns, estado.st_size, url)
    if clave not in _INDICES:
        datos = destino.read_bytes()
        try:
            tabla = lee_xlsx(datos) if formato == "xlsx" else lee_csv(datos, str(config.get("separador") or "|"))
        except Exception as e:  # noqa: BLE001  (un fichero ilegible es un aviso, no una caída)
            log.warning("emt %s: no se pudo leer %s (%s)", emisor, destino.name, e)
            return None
        filas, duplicados = indexa(tabla)
        _INDICES[clave] = Fichero(emisor=emisor, url=url, sha256=hashlib.sha256(datos).hexdigest(),
                                  descargado=estado.st_mtime, filas=filas, duplicados=frozenset(duplicados))
        log.info("emt %s: %d ISIN en %s", emisor, len(filas), destino.name)
    return _INDICES[clave]


def lee_xlsx(datos: bytes) -> list[list[Any]]:
    """La primera hoja cuya cabecera trae `00010`: en BlackRock es «Data» y en Vanguard «Sheet1»."""
    import openpyxl

    libro = openpyxl.load_workbook(io.BytesIO(datos), read_only=True, data_only=True)
    try:
        for hoja in libro.worksheets:
            filas = [list(f) for f in hoja.iter_rows(values_only=True)]
            if filas and any(_codigo(c) == "00010" for c in filas[0]):
                return filas
    finally:
        libro.close()
    raise ValueError("ninguna hoja con la columna 00010")


def lee_csv(datos: bytes, separador: str = "|") -> list[list[Any]]:
    """El CSV de Invesco: UTF-8 con BOM, separado por barras y con fin de línea CRLF."""
    texto = datos.decode("utf-8-sig")
    return [fila for fila in csv.reader(io.StringIO(texto, newline=""), delimiter=separador)]


def indexa(tabla: list[list[Any]]) -> tuple[dict[str, dict], set[str]]:
    """`{ISIN: {código: valor}}` de las filas identificadas por ISIN (`00020` = 1), y los ISIN repetidos."""
    if not tabla:
        return {}, set()
    columnas = [_codigo(c) for c in tabla[0]]
    filas: dict[str, dict] = {}
    duplicados: set[str] = set()
    for cruda in tabla[1:]:
        fila: dict[str, Any] = {}
        for codigo, valor in zip(columnas, cruda):
            if codigo and codigo not in fila:
                fila[codigo] = valor
        isin = str(fila.get("00010") or "").strip().upper()
        if not isin or _texto(fila.get("00020")) not in (TIPO_ISIN, "1.0"):
            continue
        if isin in filas:
            duplicados.add(isin)
        filas[isin] = fila
    return filas, duplicados


# ------------------------------------------------------------------ el bloque
def mercado_objetivo(fila: dict, fichero: Fichero) -> dict:
    """El bloque con la forma fijada. Vacío si la fila no trae fecha de mercado objetivo o la versión no es V4/V4.2."""
    isin = str(fila.get("00010") or "").strip().upper()
    version = VERSIONES.get((_texto(fila.get("00001")) or "").upper())
    if not version:
        log.warning("emt %s: versión de plantilla %r no admitida (V4 o V4.2); no se lee", isin, fila.get("00001"))
        return {}
    fecha = fecha_iso(fila.get("01000"))
    if not fecha:
        log.info("emt %s: sin fecha de mercado objetivo (01000); no se escribe el bloque", isin)
        return {}
    bloque: dict[str, Any] = {
        "fuente": f"emisor:{fichero.emisor}",
        "url_fichero": fichero.url,
        "sha256_fichero": fichero.sha256,
        "version_plantilla": version,
        "fichero_generado": fecha_iso(fila.get("00005")),
        "fecha_mercado_objetivo": fecha,
    }
    for nombre, campos in SUBBLOQUES:
        bloque[nombre] = _sin_vacios({clave: si_no(fila.get(codigo), isin, codigo) for clave, codigo in campos})
    bloque["periodo_minimo"] = periodo_minimo(fila.get("05080"), isin)
    bloque["preferencias_esg_consideradas"] = si_no(fila.get("05105"), isin, "05105", admite=("SI", "NEUTRAL"))
    bloque["distribucion"] = _sin_vacios({clave: canal(fila.get(codigo), isin, codigo) for clave, codigo in CANAL})
    return {k: v for k, v in bloque.items() if v is not None and v != {}}


def si_no(valor: Any, isin: str = "", codigo: str = "", admite: tuple[str, ...] = ("SI", "NO", "NEUTRAL")) -> str | None:
    """`Y` -> SI, `N` -> NO, `Neutral` en cualquier grafía -> NEUTRAL; vacío -> None (ausente, nunca NEUTRAL)."""
    texto = _texto(valor)
    if texto is None:
        return None
    normal = SI_NO.get(texto.upper())
    if normal not in admite:
        log.warning("emt %s: %s = %r fuera del dominio (%s); queda ausente", isin, codigo, valor, "/".join(admite))
        return None
    return normal


def canal(valor: Any, isin: str = "", codigo: str = "") -> str | None:
    """`06010`-`06040`: R (minorista), P (profesional), B (ambos), N (ninguno)."""
    texto = _texto(valor)
    if texto is None:
        return None
    if texto.upper() not in CANALES:
        log.warning("emt %s: %s = %r fuera del dominio (R/P/B/N); queda ausente", isin, codigo, valor)
        return None
    return texto.upper()


def periodo_minimo(valor: Any, isin: str = "") -> dict | None:
    """`05080`: `5`, `5.00000000000000` o `0.92` -> `{anos}`; V/S/M/L/H -> `{codigo}`; vacío -> None."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        anos = float(valor)
    else:
        texto = str(valor).strip()
        if not texto:
            return None
        if texto.upper() in CODIGOS_PERIODO:
            return {"codigo": texto.upper()}
        try:
            anos = float(texto)
        except ValueError:
            log.warning("emt %s: 05080 = %r no es ni años ni un código de FinDatEx; queda ausente", isin, valor)
            return None
    if not math.isfinite(anos) or anos < 0:
        log.warning("emt %s: 05080 = %r no es un periodo; queda ausente", isin, valor)
        return None
    return {"anos": anos}


def fecha_iso(valor: Any) -> str | None:
    """`AAAA-MM-DD` de una fecha de Excel o de un texto `AAAA-MM-DD[ hh:mm:ss]`; lo demás, None."""
    if isinstance(valor, dt.datetime):
        return valor.date().isoformat()
    if isinstance(valor, dt.date):
        return valor.isoformat()
    m = _FECHA.match(valor) if isinstance(valor, str) else None
    if not m:
        return None
    try:
        return dt.date.fromisoformat(m.group(1)).isoformat()
    except ValueError:
        return None


# ------------------------------------------------------------------ comprobación del coste de operación
#: Decisión 60 (09-11-2026): el coste de operación ex ante del proveedor se comprueba contra el `07130`
#: del emisor y se avisa si se separan más de esto. Morningstar redondea la cifra del emisor a entre tres y
#: cinco decimales del por ciento, medido en 0,05 pb como mucho (`INFORME_COSTE_OPERACION_2026-11-09.md`).
UMBRAL_COSTE_OPERACION_PB = 0.5


def coste_operacion_ex_ante(isin: str, bloque: dict | None) -> tuple[float, str | None] | None:
    """El `07130` del emisor en por ciento y su fecha `07160`, del mismo fichero del que salió `bloque`.

    Solo lee del índice ya cargado en este proceso, sin pedir ni leer nada de disco, y solo si el fichero
    es el que el bloque cita (emisor y `sha256_fichero`): un bloque retenido de un fichero anterior no se
    compara con otro. El `07130` no entra en el bloque `mercado_objetivo` (ver la cabecera del módulo).
    En el EMT la cifra va en tanto por uno (0,00078287), y aquí sale en por ciento, como la de Morningstar."""
    if not isinstance(bloque, dict):
        return None
    fuente = str(bloque.get("fuente") or "")
    emisor = fuente.split(":", 1)[1] if fuente.startswith("emisor:") else None
    for fichero in _INDICES.values():
        if (fichero.emisor != emisor or fichero.sha256 != bloque.get("sha256_fichero")
                or isin not in fichero.filas or isin in fichero.duplicados):
            continue
        fila = fichero.filas[isin]
        valor = fila.get("07130")
        if valor is None or isinstance(valor, bool):
            return None
        try:
            tanto_por_uno = float(valor if isinstance(valor, (int, float)) else str(valor).strip().replace(",", "."))
        except ValueError:
            return None
        if not math.isfinite(tanto_por_uno):
            return None
        return tanto_por_uno * 100, fecha_iso(fila.get("07160"))
    return None


def comprueba_coste_operacion(ficha: dict, isin: str) -> float | None:
    """Avisa en el log si el coste de operación ex ante de la ficha se separa del `07130` del emisor más de
    `UMBRAL_COSTE_OPERACION_PB`. Es una comprobación: no cambia la ficha. Devuelve la diferencia en pb, o
    None si no hay las dos cifras (sin EMT cargado en esta pasada, sin `07130` o sin cifra del proveedor)."""
    emisor = coste_operacion_ex_ante(isin, (ficha or {}).get("mercado_objetivo"))
    proveedor = ((ficha.get("costes") or {}).get("mifid_emt_exante") or {}) if emisor else {}
    cifra = proveedor.get("transaccion_pct")
    if emisor is None or not isinstance(cifra, (int, float)) or isinstance(cifra, bool):
        return None
    del_emisor, fecha_emisor = emisor
    diferencia_pb = (cifra - del_emisor) * 100
    if abs(diferencia_pb) > UMBRAL_COSTE_OPERACION_PB + 1e-9:
        log.warning("emt %s: coste de operación ex ante del proveedor %.5f %% (%s) frente al 07130 del emisor "
                    "%.5f %% (%s): %+.2f pb, más de %.1f pb", isin, cifra, proveedor.get("fecha") or "sin fecha",
                    del_emisor, fecha_emisor or "sin fecha", diferencia_pb, UMBRAL_COSTE_OPERACION_PB)
    return diferencia_pb


# ------------------------------------------------------------------ utilidades
def _codigo(cabecera: Any) -> str | None:
    m = _CODIGO.match(cabecera) if isinstance(cabecera, str) else None
    return m.group(1) if m else None


def _texto(valor: Any) -> str | None:
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, float) and valor.is_integer():
        valor = int(valor)
    return str(valor).strip() or None


def _sin_vacios(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}
