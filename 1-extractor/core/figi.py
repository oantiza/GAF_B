"""OpenFIGI: identificador global (FIGI) y mercado para posiciones sin ISIN.

Dos piezas:

1. `python main.py figi` — recorre las posiciones de data/funds que tienen
   ticker pero no ISIN, consulta OpenFIGI por lotes (máx 25 por petición) y
   guarda el resultado en cache/figi/mapa.json (permanente: cada ticker se
   consulta una sola vez en la vida). Después re-aplica el mapa a los JSON.

2. `aplica(d)` — se ejecuta en cada update dentro del pipeline: enriquece las
   posiciones desde el mapa local (sin red), para que el refresco de fuentes
   no pierda el enriquecimiento.

La API key vive en config/secrets.json (o variable de entorno
OPENFIGI_API_KEY) y nunca en el código.

Nota: OpenFIGI no devuelve ISIN; devuelve figi, shareClassFIGI (identificador
global de la clase, equivalente funcional al ISIN para cruzar bases),
exchCode (mercado) y nombre normalizado.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import requests

log = logging.getLogger("fondosdb.figi")

URL = "https://api.openfigi.com/v3/mapping"
LOTE = 25          # jobs por petición (límite con API key)
PAUSA = 0.35       # entre peticiones; con key el límite es holgado

# país ISO3 de la posición -> exchCode compuesto de OpenFIGI/Bloomberg
PAIS_A_EXCH = {
    "USA": "US", "GBR": "LN", "JPN": "JP", "DEU": "GR", "FRA": "FP",
    "ESP": "SM", "ITA": "IM", "CHE": "SW", "NLD": "NA", "SWE": "SS",
    "DNK": "DC", "FIN": "FH", "NOR": "NO", "BEL": "BB", "AUT": "AV",
    "PRT": "PL", "IRL": "ID", "CAN": "CN", "AUS": "AU", "HKG": "HK",
    "SGP": "SP", "KOR": "KS", "TWN": "TT", "BRA": "BZ", "MEX": "MM",
    "ZAF": "SJ", "IND": "IN", "CHN": "CH",
}


def _clave(ticker: str, pais: str | None) -> str:
    return f"{ticker.upper()}|{(pais or '').upper()}"


def _iso3(pais: str | None) -> str | None:
    """Acepta ISO3 o nombre largo ('United States' -> 'USA')."""
    if not pais:
        return None
    p = str(pais).strip()
    if len(p) == 3 and p.isupper():
        return p
    try:
        from core.limpieza import PAISES_ISO3, _norm_txt
        return PAISES_ISO3.get(_norm_txt(p))
    except Exception:
        return None


def carga_key(base: Path) -> str | None:
    key = os.environ.get("OPENFIGI_API_KEY")
    if key:
        return key.strip()
    ruta = base / "config" / "secrets.json"
    if ruta.exists():
        try:
            return (json.loads(ruta.read_text(encoding="utf-8-sig"))
                    .get("openfigi_api_key") or "").strip() or None
        except Exception:
            pass
    return None


def carga_mapa(base: Path) -> dict:
    ruta = base / "cache" / "figi" / "mapa.json"
    if ruta.exists():
        try:
            return json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def guarda_mapa(base: Path, mapa: dict) -> None:
    ruta = base / "cache" / "figi" / "mapa.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(mapa, ensure_ascii=False, indent=1),
                    encoding="utf-8")


# ------------------------------------------------------------- resolución
def resuelve(base: Path, pendientes: list[tuple[str, str | None]]) -> dict:
    """pendientes: [(ticker, pais_iso3)] -> actualiza y devuelve el mapa.
    Las entradas sin resultado se guardan como None (no se reintentan)."""
    key = carga_key(base)
    if not key:
        raise RuntimeError("Falta la API key: config/secrets.json "
                           '{"openfigi_api_key": "..."} o variable '
                           "OPENFIGI_API_KEY")
    mapa = carga_mapa(base)
    nuevos = [(t, p) for t, p in dict.fromkeys(pendientes)
              if _clave(t, p) not in mapa]
    if not nuevos:
        log.info("figi: nada nuevo que resolver (%d ya en mapa)", len(mapa))
        return mapa

    sesion = requests.Session()
    sesion.headers.update({"Content-Type": "application/json",
                           "X-OPENFIGI-APIKEY": key})
    log.info("figi: resolviendo %d tickers nuevos en lotes de %d...",
             len(nuevos), LOTE)
    resueltos = fallidos = 0
    for i in range(0, len(nuevos), LOTE):
        lote = nuevos[i:i + LOTE]
        jobs = []
        for ticker, pais in lote:
            job = {"idType": "TICKER", "idValue": ticker,
                   "marketSecDes": "Equity"}
            exch = PAIS_A_EXCH.get(_iso3(pais) or "")
            if exch:
                job["exchCode"] = exch
            jobs.append(job)
        try:
            r = sesion.post(URL, json=jobs, timeout=30)
            if r.status_code == 429:
                log.warning("figi: límite de peticiones; espero 60s...")
                time.sleep(60)
                r = sesion.post(URL, json=jobs, timeout=30)
            r.raise_for_status()
            respuestas = r.json()
        except Exception as e:
            log.warning("figi: lote %d falla (%s); continúo", i // LOTE, e)
            time.sleep(2)
            continue
        for (ticker, pais), resp in zip(lote, respuestas):
            datos = (resp or {}).get("data") or []
            if datos:
                d0 = datos[0]
                mapa[_clave(ticker, pais)] = {
                    "figi": d0.get("figi"),
                    "share_class_figi": d0.get("shareClassFIGI"),
                    "mercado": d0.get("exchCode"),
                    "nombre_figi": d0.get("name"),
                }
                resueltos += 1
            else:
                mapa[_clave(ticker, pais)] = None  # sin match: no reintentar
                fallidos += 1
        if (i // LOTE) % 20 == 19:
            guarda_mapa(base, mapa)  # checkpoint
        time.sleep(PAUSA)
    guarda_mapa(base, mapa)
    log.info("figi: %d resueltos, %d sin match (mapa total: %d)",
             resueltos, fallidos, len(mapa))
    return mapa


# ------------------------------------------------------------- aplicación
def aplica(d: dict, mapa: dict | None = None, base: Path | None = None) -> int:
    """Enriquece posiciones sin ISIN desde el mapa local. Devuelve nº tocadas."""
    if mapa is None:
        if base is None:
            return 0
        mapa = carga_mapa(base)
    if not mapa:
        return 0
    posiciones = ((d.get("cartera") or {}).get("posiciones")) or []
    tocadas = 0
    for p in posiciones:
        if not isinstance(p, dict) or p.get("isin") or not p.get("ticker"):
            continue
        info = mapa.get(_clave(p["ticker"], p.get("pais")))
        if not info:
            continue
        p["figi"] = info.get("figi")
        if info.get("share_class_figi"):
            p["share_class_figi"] = info["share_class_figi"]
        if info.get("mercado"):
            p["mercado"] = info["mercado"]
        tocadas += 1
    return tocadas


def pendientes_de(d: dict) -> list[tuple[str, str | None]]:
    """Tickers sin ISIN ni FIGI de un fondo."""
    out = []
    for p in ((d.get("cartera") or {}).get("posiciones")) or []:
        if (isinstance(p, dict) and not p.get("isin") and not p.get("figi")
                and p.get("ticker")):
            out.append((str(p["ticker"]).strip(), p.get("pais")))
    return out
