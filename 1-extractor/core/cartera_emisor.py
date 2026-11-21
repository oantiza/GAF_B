"""La cartera completa que publica el emisor de un ETF, para lo que ve el asesor (decisión B-79, 11-11-2026).

**Para quién es.** Los datos del emisor son de uso interno (B-53), y Óscar decidió que la cartera completa se use solo en
las vistas del asesor: en Análisis fuera del Modo cliente y en el informe interno. Ningún papel para el cliente la lee.
Por eso viaja **aparte**: `export/posiciones_emisor.ndjson`, un fichero propio, y en la base nueva un documento propio
(`declared/issuer_holdings` y sus trozos), nunca dentro de `cartera.posiciones` ni de `declared/holdings`.

**Para quién no.** Solo los ETF de `config/cartera_emisor.json`: los diecinueve que hoy solo traen del proveedor sus diez
mayores posiciones. Los demás con bloque del emisor ya tienen su cartera completa del proveedor, y los fondos quedan fuera
de la decisión.

**De dónde sale.** Del mismo bloque `emisor.cartera` que ya leen los adaptadores (`fetchers/ishares.py`, `spdr.py`,
`vanguard.py`, `xtrackers.py`, `amundi.py`): este módulo no pide nada a la red. Lo que añade es el **tipo** de cada línea
traducido a seis clases (acción, renta fija, derivado, liquidez, fondo, otro) desde el literal de cada emisor, con el
literal al lado. Un literal que no está en la tabla no se traduce: se queda sin tipo y se cuenta.

**Un ETF sintético no se mide.** Si el emisor declara la cesta de sustitución (`emisor.cartera.naturaleza`) o la réplica
es sintética, lo que publica es la garantía, no lo que replica: la línea viaja con `uso: "no_medir"` y el motivo, y la
plataforma no escribe sus posiciones. Una cartera recortada por el tope (`posiciones_guardadas`) tampoco: no es completa.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core.adquisicion.retencion import lee_etiqueta

CONFIG = Path("config") / "cartera_emisor.json"
FICHERO = "posiciones_emisor.ndjson"

#: El tope de líneas de la cartera del emisor en la ficha, aparte del de las carteras del proveedor
#: (`max_posiciones_cartera`, 10.000). El Global Aggregate de iShares (IE00BDBRDM35) da 20.000 líneas que cubren el 100,4 %
#: del patrimonio por valor de mercado, y con el tope de siempre se quedaba en la mitad. Si falta, manda el de siempre.
TOPE_POR_DEFECTO = 10000

#: El tipo de cada literal de clase de activo, por emisor. Medido el 11-11-2026 en las carteras de los diecinueve; lo que
#: no esté aquí no se traduce. SPDR no publica clase por línea, y sus líneas quedan sin tipo.
#: - iShares agrupa en «Cash and/or Derivatives» los futuros, el contado de divisa (`FX`), el efectivo, el colateral y las
#:   participaciones de sus fondos monetarios (`Money Market`): estas se cuentan como liquidez, que es como las presenta.
#: - Vanguard: `EQ.RIGHT` son derechos y `CT.PORTSWAP` permutas con un banco; los dos, derivados. `CRNY`, saldo en divisa.
#: - Amundi: `PREFERENCE_SHARES` son acciones preferentes cotizadas (las Vorzugsaktien alemanas de un índice europeo).
TIPOS: dict[str, dict[str, str]] = {
    "ishares": {"Equity": "accion", "Fixed Income": "renta_fija", "Futures": "derivado", "FX": "derivado",
                "Cash": "liquidez", "Cash Collateral and Margins": "liquidez", "Money Market": "liquidez"},
    "vanguard": {"EQ.STOCK": "accion", "EQ.REIT": "accion", "EQ.RIGHT": "derivado", "CT.PORTSWAP": "derivado",
                 "DE.IND": "derivado", "CRNY": "liquidez"},
    "xtrackers": {"Equities": "accion", "Cash": "liquidez", "Future": "derivado"},
    "amundi": {"EQUITY_ORDINARY": "accion", "PREFERENCE_SHARES": "accion", "FUTURE": "derivado"},
}

#: Lo que se copia de cada línea de la ficha, y nada más.
CAMPOS_LINEA = ("nombre", "isin", "ticker", "sedol", "peso_pct", "clase_activo", "sector", "pais", "divisa",
                "valor_mercado", "divisa_valor_mercado")

CESTA = "cesta_de_sustitucion"


def tope(settings: dict) -> int:
    """El tope de líneas de la cartera del emisor (ver `TOPE_POR_DEFECTO`)."""
    return int(settings.get("max_posiciones_cartera_emisor", settings.get("max_posiciones_cartera", TOPE_POR_DEFECTO)))


def carga_lista(base: Path) -> dict[str, str]:
    """ISIN -> nombre, de `config/cartera_emisor.json`. Sin fichero, ninguno: no se exporta nada."""
    ruta = base / CONFIG
    if not ruta.exists():
        return {}
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    return {str(k).strip().upper(): str(v.get("nombre", "")) for k, v in (datos.get("etf") or {}).items()}


def tipo_de(fuente: str, literal: Any) -> str | None:
    if not isinstance(literal, str):
        return None
    return TIPOS.get(fuente, {}).get(literal.strip())


def _get(d: Any, *ruta: str) -> Any:
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _procedencia(d: dict, fuente: str) -> tuple[str | None, str | None]:
    """(url, obtenido) del fichero del que salen las posiciones, de `meta.procedencia` y `meta.adquisicion`."""
    etiqueta = _get(d, "meta", "procedencia", "emisor.cartera.posiciones")
    if not isinstance(etiqueta, str):
        return None, None
    retenida = lee_etiqueta(etiqueta)
    original = retenida[0] if retenida else etiqueta
    endpoint = _get(d, "meta", "adquisicion", "fuentes", fuente, "endpoints", original) or {}
    obtenido = endpoint.get("fetched_at") if not retenida else f"{retenida[1]}T00:00:00+00:00"
    return endpoint.get("url"), obtenido


def motivo_sin_cartera(d: dict) -> str | None:
    """Por qué un ETF de la lista no lleva cartera del emisor, o None si la lleva."""
    emisor = d.get("emisor")
    if not isinstance(emisor, dict) or not emisor:
        return "sin_bloque_del_emisor"
    posiciones = _get(emisor, "cartera", "posiciones")
    if not isinstance(posiciones, list) or not posiciones:
        return "el_emisor_no_da_posiciones"
    return None


def lineas(isin: str, d: dict, por_linea: int) -> list[dict]:
    """Las líneas de `posiciones_emisor.ndjson` de un ETF, troceadas como `posiciones.ndjson`. Vacía si no tiene cartera."""
    if motivo_sin_cartera(d) is not None:
        return []
    emisor = d["emisor"]
    fuente = str(emisor.get("fuente") or "")
    cartera = emisor["cartera"]
    replica = _get(emisor, "replica", "tipo")
    naturaleza = cartera.get("naturaleza")
    recortada = cartera.get("posiciones_guardadas") is not None
    if naturaleza == CESTA or replica == "sintetica":
        uso, motivo = "no_medir", "cesta_de_sustitucion"
    elif recortada:
        uso, motivo = "no_medir", "recortada"
    elif replica != "fisica":
        uso, motivo = "no_medir", "replica_no_declarada"
    else:
        uso, motivo = "medir", None

    posiciones = []
    sin_tipo = 0
    for cruda in cartera["posiciones"]:
        if not isinstance(cruda, dict):
            continue
        linea = {k: cruda[k] for k in CAMPOS_LINEA if cruda.get(k) is not None}
        tipo = tipo_de(fuente, cruda.get("clase_activo"))
        if tipo is not None:
            linea["tipo"] = tipo
        else:
            sin_tipo += 1
        posiciones.append(linea)
    posiciones.sort(key=lambda p: -(p.get("peso_pct") or 0))

    url, obtenido = _procedencia(d, fuente)
    cabecera = {k: v for k, v in {
        "isin": isin,
        "fuente": fuente,
        "fecha": cartera.get("fecha"),
        "fecha_descarga": emisor.get("fecha_descarga"),
        "url": url,
        "obtenido": obtenido,
        "replica": replica,
        "naturaleza": naturaleza,
        "uso": uso,
        "motivo_no_medir": motivo,
        "num_posiciones": cartera.get("num_posiciones"),
        "num_posiciones_declarado": cartera.get("num_posiciones_declarado"),
        "posiciones_guardadas": cartera.get("posiciones_guardadas"),
        "lineas_sin_tipo": sin_tipo,
    }.items() if v is not None}
    partes = [posiciones[i:i + por_linea] for i in range(0, len(posiciones), por_linea)] or [[]]
    return [{**cabecera, "parte": n, "total_partes": len(partes), "posiciones": parte}
            for n, parte in enumerate(partes, 1)]
