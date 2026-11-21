# -*- coding: utf-8 -*-
"""Fuente ESMA FIRDS: la referencia oficial de todo lo que se negocia en la UE.

FIRDS (Financial Instruments Reference Data System) es la base de datos de referencia de
MiFIR. Cada centro de negociación de la UE y del EEE está obligado a reportar todo
instrumento que admite, y ESMA publica el conjunto entero, gratis y sin registro: un
completo semanal (`FULINS`, el sábado, troceado por categoría CFI) y un delta diario
(`DLTINS`). Encargo `ENCARGO_FIRDS_UNIVERSO_2026-11-06.md`, paso 1 del documento «Datos
del programa y sus fuentes».

Lo que da por instrumento y nadie más da con esta autoridad: el **código CFI** (ISO
10962), el **LEI del emisor**, la **divisa nominal**, el nombre oficial y, por cada
centro (MIC), la primera negociación y la **fecha de baja**. Lo que no da: precios,
composición, fundamentales ni nada de lo que no cotiza.

## Por qué no pide nada por ISIN

A diferencia de GLEIF o de la CSSF, FIRDS no se consulta instrumento a instrumento: se
descarga entero y se indexa en local (`cache/firds/firds.sqlite`). `python main.py firds`
construye o actualiza ese índice; el adaptador solo lo **lee**, sin red, y por eso una
pasada `--sin-red` lo sirve igual. Sin índice el adaptador no devuelve nada y lo dice.

## Tres límites que hay que tener presentes al leerlo

1. **Solo la UE y el EEE.** Suiza, el Reino Unido (desde el Brexit lo publica la FCA en
   su propio FIRDS), EE. UU. y Canadá no reportan aquí. Una acción de EE. UU. aparece solo
   si un centro europeo la negocia, y entonces con sus MIC europeos.
2. **El CFI lo pone quien reporta, y no siempre bien.** Muchos ETF UCITS figuran como
   `CI…` (fondo estándar) y no como `CE…` (fondo cotizado). Por eso el tipo derivado del
   CFI va **al lado** del tipo del sistema y no lo sustituye: que discrepen es un dato.
3. **La baja en FIRDS es la baja en un centro, no la defunción.** Una acción que deja
   Tradegate sigue viva en Xetra. `baja_en_todos` solo es verdad si todos sus centros
   tienen fecha de baja pasada, y aun así **no** escribe `meta.disponibilidad`: la fuente
   que prueba la cotización es la del precio (`disponibilidad.FUENTE_QUE_PRUEBA_COTIZACION`),
   y la marca de FIRDS se queda como evidencia para quien decida.
"""
from __future__ import annotations

import contextlib
import csv
import datetime as dt
import hashlib
import logging
import re
import sqlite3
import zipfile
from pathlib import Path
from typing import Any, Iterator
from xml.etree import ElementTree as ET

from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.esma_firds")

URL_INDICE = "https://registers.esma.europa.eu/solr/esma_registers_firds_files/select"
FAMILIA = "identidad"
#: Categorías CFI del completo que hacen falta: E (acciones y asimilados) y C (vehículos
#: de inversión colectiva, donde están los ETF). D (deuda), R, O, F, H, S, J, I no.
CATEGORIAS = ("E", "C")
RUTA_INDICE = Path("cache") / "firds" / "firds.sqlite"

#: Centros por defecto del comando `universo`: el mercado principal de cada país del
#: alcance de acciones (`config/alcance_mercados.json`) que reporta a FIRDS, más Bruselas
#: y Lisboa, donde cotizan ETF del universo. GB, CH, US y CA no están: no reportan aquí.
#:
#: Son MIC de **segmento**, no de operador, y es lo primero que rompe una lista escrita a
#: mano (medido el 06-11-2026 sobre el completo del 31-10): FIRDS no tiene ni una fila en
#: `XETR` ni en `XMIL`. Xetra reporta `XETA` (mercado regulado) y `XETB` (Xetra para
#: valores extranjeros: ahí están Santander, Enel y TotalEnergies, y por eso no entra);
#: Borsa Italiana reporta `MTAA` (acciones) y `ETFP` (ETF).
MIC_POR_DEFECTO = ("XMAD", "XETA", "XPAR", "XAMS", "XMSM", "MTAA", "ETFP", "XHEL", "XBRU",
                   "XLIS", "XLUX")


def mic_por_defecto(base: Path | None = None) -> tuple[str, ...]:
    """Centros activos: `mic_firds` de `config/alcance_mercados.json` (decision 34) y,
    solo si falta, `MIC_POR_DEFECTO`. Una prueba exige que coincidan."""
    from core.adquisicion import alcance
    raiz = Path(base) if base else Path(__file__).resolve().parent.parent
    return alcance.mic_firds(raiz) or MIC_POR_DEFECTO

RE_FICHERO = re.compile(r"^(FULINS|DLTINS)_(?:([A-Z])_)?(\d{8})_(\d{2})of(\d{2})\.zip$")
REGISTROS = {"RefData", "NewRcrd", "ModfdRcrd", "TermntdRcrd", "CancRcrd"}

TIPOS_CFI = ("ACCION", "ETF", "FONDO", "ESTRUCTURADO", "DEUDA", "OTRO")

#: Grupos de la categoría E que son participaciones en el capital de una empresa: acciones
#: ordinarias (S), preferentes (P), convertibles (C, F), certificados de depósito como los
#: ADR (D) y participaciones de sociedades comanditarias (L). **No** lo son `EY`
#: (instrumentos estructurados de participación: certificados y la mayoría de los ETC) ni
#: `EM` (otros). Medido el 06-11-2026: de 193.988 instrumentos «E» del completo, 172.651
#: son `EY`; con «toda E es acción», el universo de acciones sería en un 89 % certificados.
GRUPOS_ACCION = frozenset("SPCFDL")


# ----------------------------------------------------------------- CFI
def cfi_tipo(cfi: str | None) -> str | None:
    """El tipo que dice el código CFI, o None si el código no es un CFI.

    ISO 10962: primera letra la categoría y segunda el grupo. `E` instrumentos de capital,
    de los que solo los grupos de `GRUPOS_ACCION` son acciones y `EY` es un estructurado
    (ahí van los ETC, como el iShares Physical Gold); `C` vehículos de inversión colectiva,
    y dentro de ellos `CE` son los fondos cotizados (ETF); `D` deuda (los ETN). Lo demás
    no es de este programa.
    """
    c = (cfi or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{6}", c):
        return None
    if c[0] == "E":
        if c[1] in GRUPOS_ACCION:
            return "ACCION"
        return "ESTRUCTURADO" if c[1] == "Y" else "OTRO"
    if c[0] == "C":
        return "ETF" if c[1] == "E" else "FONDO"
    if c[0] == "D":
        return "DEUDA"
    return "OTRO"


# ----------------------------------------------------------------- XML
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _hijo(e: ET.Element | None, nombre: str) -> ET.Element | None:
    if e is None:
        return None
    for h in e:
        if _local(h.tag) == nombre:
            return h
    return None


def _texto(e: ET.Element | None, *camino: str) -> str | None:
    for nombre in camino:
        e = _hijo(e, nombre)
    if e is None or e.text is None:
        return None
    t = e.text.strip()
    return t or None


def _fecha(v: str | None) -> str | None:
    return v[:10] if v and re.match(r"\d{4}-\d{2}-\d{2}", v) else None


def registro(e: ET.Element) -> dict:
    """Un registro FIRDS (instrumento × centro) como dict plano."""
    gen = _hijo(e, "FinInstrmGnlAttrbts")
    ven = _hijo(e, "TradgVnRltdAttrbts")
    cfi = _texto(gen, "ClssfctnTp")
    return {
        "operacion": _local(e.tag),
        "isin": (_texto(gen, "Id") or "").upper() or None,
        "nombre": _texto(gen, "FullNm"),
        "nombre_corto": _texto(gen, "ShrtNm"),
        "cfi": cfi,
        "tipo": cfi_tipo(cfi),
        "divisa": _texto(gen, "NtnlCcy"),
        "lei": _texto(e, "Issr"),
        "mic": _texto(ven, "Id"),
        "admision": _fecha(_texto(ven, "AdmssnApprvlDtByIssr")),
        "solicitud": _fecha(_texto(ven, "ReqForAdmssnDt")),
        "primera_negociacion": _fecha(_texto(ven, "FrstTradDt")),
        "baja": _fecha(_texto(ven, "TermntnDt")),
        "autoridad": _texto(e, "TechAttrbts", "RlvntCmptntAuthrty"),
        "centro_relevante": _texto(e, "TechAttrbts", "RlvntTradgVn"),
    }


def recorre(fuente: Any) -> Iterator[dict]:
    """Los registros de un XML FIRDS (completo o delta), en streaming.

    Cada registro se suelta del árbol en cuanto se lee: un completo de acciones son
    millones de registros y no cabe en memoria entero.
    """
    pila: list[ET.Element] = []
    for evento, e in ET.iterparse(fuente, events=("start", "end")):
        if evento == "start":
            pila.append(e)
            continue
        pila.pop()
        if _local(e.tag) in REGISTROS:
            r = registro(e)
            if r["isin"]:
                yield r
            if pila:
                pila[-1].remove(e)
            e.clear()


# ----------------------------------------------------------------- índice
ESQUEMA = """
CREATE TABLE IF NOT EXISTS instrumentos (
  isin TEXT PRIMARY KEY, nombre TEXT, nombre_corto TEXT, cfi TEXT, tipo TEXT,
  divisa TEXT, lei TEXT, autoridad TEXT, visto TEXT);
CREATE TABLE IF NOT EXISTS mercados (
  isin TEXT, mic TEXT, admision TEXT, solicitud TEXT, primera_negociacion TEXT, baja TEXT,
  visto TEXT, PRIMARY KEY (isin, mic));
CREATE INDEX IF NOT EXISTS mercados_mic ON mercados (mic);
CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS nombres (
  isin TEXT, mic TEXT, nombre TEXT, centro_relevante TEXT, PRIMARY KEY (isin, mic));
"""
#: `nombres` guarda el nombre que da **cada** centro y el centro más relevante que trae su
#: registro, para que `elige_nombre` decida por regla y no por orden de lectura. Va en una
#: tabla aparte y no como columnas de `mercados` o `instrumentos` para no cambiar la forma de
#: las dos que ya leen otros: un índice construido antes la recibe vacía al abrirse, y la regla
#: se aplica entera desde la siguiente reconstrucción (`python main.py firds --force`).


def abre(ruta: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(ruta))
    con.executescript(ESQUEMA)
    return con


def meta(con: sqlite3.Connection, clave: str) -> str | None:
    fila = con.execute("SELECT valor FROM meta WHERE clave = ?", (clave,)).fetchone()
    return fila[0] if fila else None


def _pon_meta(con: sqlite3.Connection, clave: str, valor: str) -> None:
    con.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (clave, valor))


def aplica(con: sqlite3.Connection, registros: Iterator[dict], visto: str,
           categorias: tuple[str, ...] = CATEGORIAS) -> dict[str, int]:
    """Vuelca registros al índice. Un completo y un delta usan la misma vía.

    `CancRcrd` es un registro anulado por quien lo reportó (un error), y se retira del
    índice ese centro; si el instrumento se queda sin centros, se retira también. Una
    baja (`TermntdRcrd`) **no** retira nada: se guarda la fecha.

    El nombre del instrumento no es el del último registro leído: al acabar, cada ISIN tocado
    recibe el que manda `elige_nombre` sobre todos sus centros (ver allí la regla).
    """
    cuenta = {"leidos": 0, "guardados": 0, "anulados": 0, "fuera_de_categoria": 0}
    tocados: set[str] = set()
    for r in registros:
        cuenta["leidos"] += 1
        if not r["cfi"] or r["cfi"][0] not in categorias:
            cuenta["fuera_de_categoria"] += 1
            continue
        if r["operacion"] == "CancRcrd":
            if r["mic"]:
                con.execute("DELETE FROM mercados WHERE isin = ? AND mic = ?", (r["isin"], r["mic"]))
                con.execute("DELETE FROM nombres WHERE isin = ? AND mic = ?", (r["isin"], r["mic"]))
            quedan = con.execute("SELECT 1 FROM mercados WHERE isin = ? LIMIT 1", (r["isin"],)).fetchone()
            if not quedan:
                con.execute("DELETE FROM instrumentos WHERE isin = ?", (r["isin"],))
                con.execute("DELETE FROM nombres WHERE isin = ?", (r["isin"],))
                tocados.discard(r["isin"])
            else:
                tocados.add(r["isin"])
            cuenta["anulados"] += 1
            continue
        con.execute(
            "INSERT OR REPLACE INTO instrumentos VALUES (?,?,?,?,?,?,?,?,?)",
            (r["isin"], r["nombre"], r["nombre_corto"], r["cfi"], r["tipo"], r["divisa"],
             r["lei"], r["autoridad"], visto))
        if r["mic"]:
            con.execute(
                "INSERT OR REPLACE INTO mercados VALUES (?,?,?,?,?,?,?)",
                (r["isin"], r["mic"], r["admision"], r["solicitud"], r["primera_negociacion"],
                 r["baja"], visto))
            con.execute("INSERT OR REPLACE INTO nombres VALUES (?,?,?,?)",
                        (r["isin"], r["mic"], r["nombre"], r.get("centro_relevante")))
        tocados.add(r["isin"])
        cuenta["guardados"] += 1
    fija_nombres(con, tocados)
    return cuenta


def elige_nombre(centros: list[tuple[str, str | None, str | None, str | None]]) -> str | None:
    """El nombre FIRDS de un ISIN, elegido por regla entre los que da cada centro.

    `centros` son tuplas `(mic, nombre, primera_negociacion, centro_relevante)`, una por centro.

    **Por qué hace falta una regla.** Cada centro reporta su propio `FullNm`, y no coinciden:
    medido el 09-11-2026 sobre el completo del 07-11, de 210.633 ISIN de acciones y vehículos
    colectivos, 153.178 (el 73 %) traen más de un nombre. Santander da ocho, de «BANCO
    SANTANDER» a «BCO SANTANDER N.EO0,5»; Standard Chartered, siete. Con `INSERT OR REPLACE`
    ganaba el último registro leído, así que el nombre dependía del orden de los ficheros y de
    los registros dentro de cada uno, y un nombre que cambia con el orden de lectura no se
    puede auditar: dos construcciones con los mismos datos podían dar nombres distintos.

    **La regla**, en este orden:

    1. El nombre del centro que el propio registro señala como **más relevante**
       (`TechAttrbts/RlvntTradgVn`): es el centro de referencia que fija la autoridad
       competente del instrumento, la que manda sobre él en MiFIR.
    2. Si ese centro no está entre los del ISIN (o no viene), el del centro con la
       `primera_negociacion` **más antigua**. Una fecha igual o anterior a `CENTINELA_FECHA`
       («desde siempre» de Fráncfort) o ausente no cuenta como antigua: va detrás.
    3. A igual fecha, el **MIC** en orden alfabético. El MIC es único por ISIN, así que no
       queda empate y el resultado es reproducible.

    **Por qué no es «la autoridad del país del ISIN»**, que fue la propuesta: se midió que
    `RlvntCmptntAuthrty` existe pero es un dato **del instrumento**, no del centro. En el
    completo del 07-11 ningún ISIN trae dos autoridades distintas entre sus registros, así que
    comparar la autoridad de cada registro con el país del ISIN no separa ningún registro de
    otro. El campo que sí distingue un centro es `RlvntTradgVn`, que viene en el mismo bloque.
    Tampoco hay en el repositorio una tabla ISO 10383 de MIC por país para la alternativa del
    país del centro.

    Solo cuentan los centros con nombre. `None` si ninguno lo tiene: quien llama conserva
    entonces el que había.
    """
    con_nombre = [c for c in centros if c[0] and c[1]]
    if not con_nombre:
        return None
    relevantes = {c[3] for c in con_nombre if c[3]}
    preferidos = [c for c in con_nombre if c[0] in relevantes] or con_nombre

    def clave(c):
        fecha = c[2] if c[2] and c[2] > CENTINELA_FECHA else None
        return (fecha is None, fecha or "", c[0])

    return min(preferidos, key=clave)[1]


def fija_nombres(con: sqlite3.Connection, isins: set[str]) -> None:
    """Pone a cada ISIN el nombre que manda `elige_nombre` sobre todos sus centros guardados.

    Un índice construido antes de la regla no tiene `nombres`; mientras no se reconstruya, sus
    centros sin fila no cuentan y, si no queda ninguno, el nombre se queda como estaba.
    """
    for isin in isins:
        centros = con.execute(
            "SELECT n.mic, n.nombre, m.primera_negociacion, n.centro_relevante FROM nombres n "
            "JOIN mercados m ON m.isin = n.isin AND m.mic = n.mic WHERE n.isin = ?",
            (isin,)).fetchall()
        nombre = elige_nombre(centros)
        if nombre:
            con.execute("UPDATE instrumentos SET nombre = ? WHERE isin = ?", (nombre, isin))


def ficha(con: sqlite3.Connection, isin: str) -> dict | None:
    """Lo que el índice sabe de un ISIN: el instrumento y sus centros."""
    con.row_factory = sqlite3.Row
    try:
        fila = con.execute("SELECT * FROM instrumentos WHERE isin = ?", (isin.upper(),)).fetchone()
        if not fila:
            return None
        mercados = [dict(m) for m in con.execute(
            "SELECT mic, admision, primera_negociacion, baja FROM mercados WHERE isin = ? "
            "ORDER BY mic", (isin.upper(),))]
    finally:
        con.row_factory = None
    out = dict(fila)
    # El tipo se deduce al leer, no se fía del guardado: así un cambio de la regla vale
    # para un índice ya construido sin reconstruirlo.
    out["tipo"] = cfi_tipo(out.get("cfi"))
    out["mercados"] = mercados
    return out


def conoce(base: Path | None, isins: list[str]) -> dict[str, bool] | None:
    """Qué ISIN de la lista tiene el índice local. `None` si no hay índice: sin él no se sabe.

    Es la pregunta que hace `eodhd.sucesor_de` para distinguir un ISIN sustituido de un
    listado con el ISIN mal puesto, y la responde **solo** un índice que exista: un fichero
    ausente no prueba que nadie conozca nada. No abre el índice con `abre`, que crearía uno
    vacío donde no lo hay.
    """
    indice = Path(base or ".") / RUTA_INDICE
    if not indice.exists():
        return None
    con = sqlite3.connect(f"file:{indice.as_posix()}?mode=ro", uri=True)
    try:
        if meta(con, "completo") is None:
            return None
        return {i.upper(): bool(con.execute("SELECT 1 FROM instrumentos WHERE isin = ?",
                                            (i.upper(),)).fetchone()) for i in isins}
    except sqlite3.Error:
        return None
    finally:
        con.close()


#: Lo que algunos centros escriben por «negocia desde antes de que haya registro». Medido el
#: 07-11-2026: Fráncfort (`FRAA`) da admisión 1899-12-31 y primera negociación 1900-01-01 a
#: Deutsche Bank, Siemens o Allianz, y 12 centros-ISIN del índice llevan ese 1900-01-01. No es
#: una fecha: una primera negociación igual o anterior no prueba nada y no se usa.
CENTINELA_FECHA = "1900-01-01"


def primera_negociacion(base: Path | None, isin: str) -> tuple[str, list[str]] | None:
    """El día en que el ISIN empezó a negociarse según FIRDS, y en qué centros: `(fecha, mics)`.

    Decisión 15 de `DECISIONES_DATOS_2026-11-07.md`: un ISIN sustituido deja de cotizar el día
    de la primera negociación de su sucesor, no el día en que lo vemos. Es lo que pregunta
    `nucleo._marca_por_evidencia` del sucesor.

    **Solo cuentan los centros con admisión solicitada por el emisor** (`admision` informada),
    no todos. Medido el 07-11-2026 en el sucesor de Aena, `ES0105046017`: de sus 46 centros, 45
    dicen 19-06-2025 o después y uno, `MTAH`, un MTF que lo negocia sin que Aena lo pidiera, dice
    15-11-2023, año y medio antes de que el ISIN existiera. Los dos con admisión, `XMAD` y `DMAD`,
    dicen 19-06-2025, que es el cambio de ISIN. La más antigua de todos los centros habría tomado
    el dato del que menos sabe del valor.

    `mics` son **todos** los centros con admisión que empezaron ese día, en orden: en Aena,
    `["DMAD", "XMAD"]`. Elegir uno sería afirmar cuál es el principal, y FIRDS no lo dice.

    Una fecha igual o anterior a `CENTINELA_FECHA` no cuenta: es la convención de un centro para
    «desde siempre», no un día.

    `None` si no hay índice completo, si FIRDS no conoce el ISIN o si ningún centro tiene
    admisión con primera negociación: quien pregunta conserva entonces la fecha que tenía y lo
    dice. No abre el índice con `abre`, que crearía uno vacío donde no lo hay.
    """
    indice = Path(base or ".") / RUTA_INDICE
    if not indice.exists():
        return None
    con = sqlite3.connect(f"file:{indice.as_posix()}?mode=ro", uri=True)
    try:
        if meta(con, "completo") is None:
            return None
        filas = con.execute(
            "SELECT primera_negociacion, mic FROM mercados WHERE isin = ? AND admision IS NOT NULL "
            "AND admision != '' AND primera_negociacion IS NOT NULL AND primera_negociacion > ? "
            "ORDER BY primera_negociacion, mic",
            (str(isin or "").strip().upper(), CENTINELA_FECHA)).fetchall()
    except sqlite3.Error:
        return None
    finally:
        con.close()
    if not filas:
        return None
    fecha = filas[0][0]
    return fecha, [mic for f, mic in filas if f == fecha]


#: El mercado regulado de cada autoridad competente: el centro donde una admisión del emisor
#: significa «esta es su bolsa», no un segmento o un MTF. Frankfurt son dos MIC del mismo mercado.
MERCADO_REGULADO_DE_LA_AUTORIDAD = {
    "ES": ("XMAD",), "FR": ("XPAR",), "NL": ("XAMS",), "BE": ("XBRU",), "IT": ("MTAA",),
    "DE": ("XETA", "FRAA"), "FI": ("XHEL",), "SE": ("XSTO",), "DK": ("XCSE",), "AT": ("XWBO",),
    "PT": ("XLIS",), "IE": ("XMSM",), "NO": ("XOSL",),
}


def mercado_de_origen(base: Path | None, isin: str, hoy: dt.date | None = None) -> str | None:
    """El MIC del mercado regulado de origen según FIRDS, o None si FIRDS no lo establece.

    Es el mercado regulado del país de la **autoridad competente** del instrumento
    (`RlvntCmptntAuthrty`), si el emisor pidió la admisión ahí y no tiene baja pasada.

    No se usa «la admisión más antigua» porque se midió el 08-11-2026 sobre las 522 acciones y falla
    donde más se nota: Airbus da Xetra (02-07-2000, antes que París, 25-09-2000), y TotalEnergies,
    Engie, Saint-Gobain, WDP y Nordea empatan el mismo día con otra bolsa que no es la suya. La
    autoridad las resuelve todas: FR para Airbus, Total, Engie y Saint-Gobain; BE para WDP; FI para Nordea.

    Una admisión fuera de ese país no dice nada: Nokia tiene FI de autoridad y su admisión es la de
    Estocolmo, así que FIRDS calla y decide el prefijo. No abre el índice con `abre`, que crearía
    uno vacío donde no lo hay. `None` también si no hay índice completo.
    """
    indice = Path(base or ".") / RUTA_INDICE
    if not indice.exists():
        return None
    hoy_iso = (hoy or dt.date.today()).isoformat()
    con = sqlite3.connect(f"file:{indice.as_posix()}?mode=ro", uri=True)
    try:
        if meta(con, "completo") is None:
            return None
        isin = str(isin or "").strip().upper()
        fila = con.execute("SELECT autoridad FROM instrumentos WHERE isin = ?", (isin,)).fetchone()
        mics = MERCADO_REGULADO_DE_LA_AUTORIDAD.get(str(fila[0] or "").upper()) if fila else None
        if not mics:
            return None
        marcas = ",".join("?" * len(mics))
        hallada = con.execute(
            f"SELECT mic FROM mercados WHERE isin = ? AND mic IN ({marcas}) AND admision IS NOT NULL "
            "AND admision != '' AND (baja IS NULL OR baja > ?) ORDER BY mic",
            (isin, *mics, hoy_iso)).fetchone()
    except sqlite3.Error:
        return None
    finally:
        con.close()
    return hallada[0] if hallada else None


def baja_en_todos(mercados: list[dict], hoy: dt.date | None = None) -> str | None:
    """La fecha de la última baja si **todos** los centros tienen baja ya pasada; si no, None."""
    hoy = hoy or dt.date.today()
    if not mercados:
        return None
    bajas = [m.get("baja") for m in mercados]
    if any(not b for b in bajas):
        return None
    if any(dt.date.fromisoformat(b) > hoy for b in bajas):
        return None
    return max(bajas)


# ----------------------------------------------------------------- red
def lista_ficheros(http, tipo: str, desde: dt.date, hasta: dt.date) -> list[dict]:
    """Los ficheros FIRDS publicados entre dos fechas, del índice Solr de ESMA."""
    q = (f"publication_date:[{desde.isoformat()}T00:00:00Z TO {hasta.isoformat()}T23:59:59Z]"
         f" AND file_type:{tipo}")
    r = http.get(URL_INDICE, params={"q": "*", "fq": q, "wt": "json", "rows": 500, "start": 0},
                 force=True, familia="precio")
    if not r.ok:
        raise RuntimeError(f"índice FIRDS: HTTP {r.status}")
    docs = ((r.json() or {}).get("response") or {}).get("docs") or []
    out = []
    for d in docs:
        m = RE_FICHERO.match(str(d.get("file_name") or ""))
        if not m:
            continue
        out.append({"nombre": d["file_name"], "url": d.get("download_link"),
                    "md5": d.get("checksum"), "tipo": m.group(1), "categoria": m.group(2),
                    "fecha": f"{m.group(3)[:4]}-{m.group(3)[4:6]}-{m.group(3)[6:]}",
                    "parte": int(m.group(4)), "partes": int(m.group(5))})
    return sorted(out, key=lambda f: (f["fecha"], f["categoria"] or "", f["parte"]))


def ultimo_completo(ficheros: list[dict], categorias: tuple[str, ...] = CATEGORIAS) -> list[dict]:
    """Las partes del último `FULINS` que esté **entero** para todas las categorías pedidas."""
    fechas = sorted({f["fecha"] for f in ficheros if f["tipo"] == "FULINS"}, reverse=True)
    for fecha in fechas:
        elegidos, completo = [], True
        for cat in categorias:
            partes = [f for f in ficheros if f["tipo"] == "FULINS" and f["fecha"] == fecha
                      and f["categoria"] == cat]
            if not partes or len(partes) != partes[0]["partes"]:
                completo = False
                break
            elegidos += partes
        if completo:
            return elegidos
    return []


def _md5(ruta: Path) -> str:
    h = hashlib.md5()  # noqa: S324 (es la suma que publica ESMA, no seguridad)
    with ruta.open("rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def descarga(http, fichero: dict, carpeta: Path, force: bool = False) -> Path:
    """Descarga un ZIP de FIRDS a la caché y comprueba la suma MD5 que publica ESMA."""
    destino = carpeta / fichero["nombre"]
    http.download(fichero["url"], destino, force=force, familia="identidad")
    if fichero.get("md5") and _md5(destino) != fichero["md5"]:
        destino.unlink(missing_ok=True)
        raise RuntimeError(f"{fichero['nombre']}: la suma MD5 no coincide con la de ESMA")
    return destino


def _xml_del_zip(ruta: Path):
    z = zipfile.ZipFile(ruta)
    nombres = [n for n in z.namelist() if n.lower().endswith(".xml")]
    if len(nombres) != 1:
        raise RuntimeError(f"{ruta.name}: se esperaba un XML y hay {len(nombres)}")
    return z, z.open(nombres[0])


#: Dónde queda la constancia de los centros que se pierden o se ganan al reconstruir. Va con
#: el histórico (`data/history/`) y no con `reports/` ni con `cache/`: no se puede regenerar,
#: porque el índice con el que se compara desaparece al sustituirlo.
RUTA_PLAZAS = Path("data") / "history" / "firds_plazas"
COLUMNAS_PLAZAS = ("isin", "estado", "mic_perdidos", "mic_ganados", "completo_anterior",
                   "ultimo_delta_anterior", "completo_nuevo")


def plazas_cambiadas(vigente: Path, nuevo: Path) -> list[dict]:
    """Por ISIN, los MIC que el índice `vigente` tiene y el `nuevo` no, y al revés.

    `estado` es `sale` si el ISIN no está en el nuevo, `entra` si no estaba en el vigente y
    `cambia` si está en los dos. Abre los dos en solo lectura y los cierra al acabar: en
    Windows el vigente no se podría sustituir con una conexión abierta.
    """
    def uri(p: Path) -> str:
        return f"file:{p.resolve().as_posix()}?mode=ro"

    con = sqlite3.connect(uri(nuevo), uri=True)
    try:
        con.execute("ATTACH DATABASE ? AS vigente", (uri(vigente),))
        perdidos = con.execute("SELECT isin, mic FROM vigente.mercados EXCEPT "
                               "SELECT isin, mic FROM main.mercados").fetchall()
        ganados = con.execute("SELECT isin, mic FROM main.mercados EXCEPT "
                              "SELECT isin, mic FROM vigente.mercados").fetchall()
        salen = {i for (i,) in con.execute("SELECT isin FROM vigente.mercados EXCEPT "
                                           "SELECT isin FROM main.mercados")}
        entran = {i for (i,) in con.execute("SELECT isin FROM main.mercados EXCEPT "
                                            "SELECT isin FROM vigente.mercados")}
        con.execute("DETACH DATABASE vigente")
    finally:
        con.close()
    por_isin: dict[str, dict] = {}
    for clave, filas in (("mic_perdidos", perdidos), ("mic_ganados", ganados)):
        for isin, mic in filas:
            d = por_isin.setdefault(isin, {"isin": isin, "mic_perdidos": [], "mic_ganados": []})
            d[clave].append(mic)
    out = []
    for isin in sorted(por_isin):
        d = por_isin[isin]
        d["mic_perdidos"].sort()
        d["mic_ganados"].sort()
        d["estado"] = "sale" if isin in salen else "entra" if isin in entran else "cambia"
        out.append(d)
    return out


def registra_plazas(base: Path, vigente: Path, nuevo: Path, completo_nuevo: str) -> dict:
    """Deja constancia de los centros que cambian al sustituir el índice por un completo nuevo.

    Defecto medido el 09-11-2026: el completo `FULINS` solo lista los centros que lo reportan
    esa semana, y los deltas habían añadido otros. Standard Chartered (`GB0004082847`) pasó de
    60 centros a 22 al reconstruir, y cinco acciones británicas perdieron centros británicos del
    recuento `mercados_ue` sin que nada lo dijera. Esto **no cambia lo que se publica**: si esos
    centros deben conservarse es una decisión abierta de Óscar; aquí solo se registra.

    Escribe un CSV en `RUTA_PLAZAS`, `plazas_<completo nuevo>_sobre_<completo vigente>.csv`,
    una fila por ISIN con algún cambio, los MIC separados por espacios. Se escribe aunque no haya
    diferencias (solo la cabecera), para que conste que se comparó. Si el nombre ya existe (una
    reconstrucción `--force` sobre el mismo completo), no lo pisa: añade `-2`, `-3`…

    El nuevo es el completo **sin** deltas: alguno de los posteriores puede devolver un centro
    que aquí figura como perdido.
    """
    with contextlib.closing(sqlite3.connect(f"file:{vigente.resolve().as_posix()}?mode=ro",
                                            uri=True)) as con:
        anterior = meta(con, "completo") or ""
        ultimo_delta = meta(con, "ultimo_delta") or ""
    cambios = plazas_cambiadas(vigente, nuevo)
    carpeta = base / RUTA_PLAZAS
    carpeta.mkdir(parents=True, exist_ok=True)
    raiz = f"plazas_{completo_nuevo}_sobre_{anterior or 'sin_fecha'}"
    ruta, n = carpeta / f"{raiz}.csv", 1
    while ruta.exists():
        n += 1
        ruta = carpeta / f"{raiz}-{n}.csv"
    with ruta.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS_PLAZAS)
        w.writeheader()
        for c in cambios:
            w.writerow({**c, "mic_perdidos": " ".join(c["mic_perdidos"]),
                        "mic_ganados": " ".join(c["mic_ganados"]), "completo_anterior": anterior,
                        "ultimo_delta_anterior": ultimo_delta, "completo_nuevo": completo_nuevo})
    con_perdidas = [c for c in cambios if c["mic_perdidos"]]
    resumen = {
        "registro": str(ruta),
        "isin_con_perdidas": len(con_perdidas),
        "mic_perdidos": sum(len(c["mic_perdidos"]) for c in cambios),
        "isin_que_salen": sum(1 for c in cambios if c["estado"] == "sale"),
        "isin_con_ganancias": sum(1 for c in cambios if c["mic_ganados"]),
        "mic_ganados": sum(len(c["mic_ganados"]) for c in cambios),
        "isin_que_entran": sum(1 for c in cambios if c["estado"] == "entra"),
    }
    nivel = logging.WARNING if con_perdidas else logging.INFO
    log.log(nivel, "FIRDS: el completo del %s sobre el índice del %s (último delta %s): %d ISIN "
            "pierden %d centros (%d salen enteros) y %d ganan %d (%d entran); registro en %s",
            completo_nuevo, anterior or "?", ultimo_delta or "ninguno",
            resumen["isin_con_perdidas"], resumen["mic_perdidos"], resumen["isin_que_salen"],
            resumen["isin_con_ganancias"], resumen["mic_ganados"], resumen["isin_que_entran"], ruta)
    return resumen


def construye(http, base: Path, *, hasta: dt.date | None = None, force: bool = False,
              categorias: tuple[str, ...] = CATEGORIAS, deltas: bool = True) -> dict:
    """Construye el índice desde el último completo y le aplica los deltas posteriores.

    El completo se escribe en un fichero aparte y sustituye al índice solo al acabar: una
    construcción a medias no deja un índice a medias. Antes de sustituirlo, `registra_plazas`
    deja constancia de los centros que el índice vigente tenía y el nuevo no (y al revés).
    """
    hasta = hasta or dt.date.today()
    carpeta = base / RUTA_INDICE.parent
    carpeta.mkdir(parents=True, exist_ok=True)
    ficheros = lista_ficheros(http, "FULINS", hasta - dt.timedelta(days=14), hasta)
    completo = ultimo_completo(ficheros, categorias)
    if not completo:
        raise RuntimeError("no hay un FULINS completo en las dos últimas semanas")
    fecha_completo = completo[0]["fecha"]
    indice = base / RUTA_INDICE
    resumen: dict = {"completo": fecha_completo, "ficheros": [], "deltas": []}
    completo_actual = None
    if indice.exists():
        # La conexión se cierra antes de reemplazar el índice: en Windows un fichero abierto
        # no se puede sustituir, y `tmp.replace(indice)` fallaría con PermissionError.
        with contextlib.closing(abre(indice)) as con:
            completo_actual = meta(con, "completo")
    if force or completo_actual != fecha_completo:
        tmp = indice.with_suffix(".tmp")
        tmp.unlink(missing_ok=True)
        con = abre(tmp)
        try:
            for f in completo:
                ruta = descarga(http, f, carpeta, force=force)
                z, xml = _xml_del_zip(ruta)
                with contextlib.closing(z), xml:
                    c = aplica(con, recorre(xml), fecha_completo, categorias)
                con.commit()
                resumen["ficheros"].append({"nombre": f["nombre"], **c})
                log.info("FIRDS %s: %s", f["nombre"], c)
            _pon_meta(con, "completo", fecha_completo)
            _pon_meta(con, "deltas", "")
            con.commit()
        finally:
            con.close()
        if indice.exists():
            resumen["plazas"] = registra_plazas(base, indice, tmp, fecha_completo)
        tmp.replace(indice)
    if deltas:
        resumen["deltas"] = aplica_deltas(http, base, desde=dt.date.fromisoformat(fecha_completo),
                                          hasta=hasta, force=force, categorias=categorias)
    con = abre(indice)
    try:
        resumen["instrumentos"] = con.execute("SELECT count(*) FROM instrumentos").fetchone()[0]
        resumen["mercados"] = con.execute("SELECT count(*) FROM mercados").fetchone()[0]
    finally:
        con.close()
    return resumen


def aplica_deltas(http, base: Path, *, desde: dt.date, hasta: dt.date, force: bool = False,
                  categorias: tuple[str, ...] = CATEGORIAS) -> list[dict]:
    """Aplica en orden los `DLTINS` posteriores al completo que aún no estén aplicados."""
    indice = base / RUTA_INDICE
    con = abre(indice)
    hechos: list[dict] = []
    try:
        aplicados = set(filter(None, (meta(con, "deltas") or "").split(",")))
        ficheros = [f for f in lista_ficheros(http, "DLTINS", desde + dt.timedelta(days=1), hasta)
                    if f["nombre"] not in aplicados]
        for f in ficheros:
            ruta = descarga(http, f, base / RUTA_INDICE.parent, force=force)
            z, xml = _xml_del_zip(ruta)
            with contextlib.closing(z), xml:
                c = aplica(con, recorre(xml), f["fecha"], categorias)
            aplicados.add(f["nombre"])
            _pon_meta(con, "deltas", ",".join(sorted(aplicados)))
            _pon_meta(con, "ultimo_delta", f["fecha"])
            con.commit()
            hechos.append({"nombre": f["nombre"], **c})
            log.info("FIRDS delta %s: %s", f["nombre"], c)
    finally:
        con.close()
    return hechos


# ----------------------------------------------------------------- adaptador
def _epoca(fecha: str | None) -> float | None:
    if not fecha:
        return None
    return dt.datetime.fromisoformat(fecha).replace(tzinfo=dt.timezone.utc).timestamp()


def fetch(isin: str, http=None, settings: dict | None = None, force: bool = False,
          base: Path | None = None, hoy: dt.date | None = None) -> dict:
    """Lo que FIRDS dice de un ISIN, leído del índice local. No sale a red.

    No escribe `identificacion.nombre`, `divisa_base` ni el tipo del sistema: los añade
    al lado (`nombre_oficial_firds`, `divisa_nominal_firds`, `cfi_tipo`), para que una
    discrepancia se vea en vez de resolverse en silencio.
    """
    indice = Path(base or ".") / RUTA_INDICE
    if not indice.exists():
        log.info("FIRDS: sin índice local (python main.py firds); %s sin datos", isin)
        return {}
    con = abre(indice)
    try:
        f = ficha(con, isin)
        visto = meta(con, "ultimo_delta") or meta(con, "completo")
    finally:
        con.close()
    if not f:
        return {}
    out: dict = {}
    with procedencia.etapa("fulins", _epoca(f.get("visto") or visto)):
        set_path(out, "identificacion.nombre_oficial_firds", f.get("nombre"))
        set_path(out, "identificacion.nombre_corto_firds", f.get("nombre_corto"))
        set_path(out, "identificacion.cfi", f.get("cfi"))
        set_path(out, "identificacion.cfi_tipo", f.get("tipo"))
        set_path(out, "identificacion.divisa_nominal_firds", f.get("divisa"))
        set_path(out, "identificacion.lei_emisor", f.get("lei"))
        set_path(out, "identificacion.autoridad_competente_firds", f.get("autoridad"))
        mercados = [{k: v for k, v in m.items() if v} for m in f["mercados"] if m.get("mic")]
        set_path(out, "identificacion.mercados_ue", mercados or None)
        set_path(out, "identificacion.baja_en_todos_firds", baja_en_todos(f["mercados"], hoy))
        set_path(out, "meta.firds_visto", f.get("visto") or visto)
    return out


# ----------------------------------------------------------------- universo
def candidatos(con: sqlite3.Connection, mics: tuple[str, ...], tipos: tuple[str, ...],
               hoy: dt.date | None = None, incluye_bajas: bool = False) -> list[dict]:
    """Los ISIN que cotizan en alguno de esos centros y son de esos tipos.

    Un centro cuenta si no tiene baja o la tiene en el futuro (salvo `incluye_bajas`).
    """
    hoy = (hoy or dt.date.today()).isoformat()
    marcas_mic = ",".join("?" * len(mics))
    sql = f"SELECT DISTINCT isin FROM mercados WHERE mic IN ({marcas_mic})"
    args: list = [*mics]
    if not incluye_bajas:
        sql += " AND (baja IS NULL OR baja > ?)"
        args.append(hoy)
    out = []
    for (isin,) in con.execute(sql, args).fetchall():
        f = ficha(con, isin)
        if f and f["tipo"] in tipos:
            out.append(f)
    return sorted(out, key=lambda f: (f.get("tipo") or "", f["isin"]))
