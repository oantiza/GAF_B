"""Fetcher justETF (ETFs UCITS).

Dos niveles:
1. API JSON interna /api/etfs/{isin}/quote — verificada en vivo el 10-06-2026.
   Siempre disponible, solo necesita requests. Desde el 09-11-2026 solo da precio
   si `quoteTradingVenue` es una plaza: con `NAV` la cifra es el valor
   liquidativo convertido a la divisa pedida, y se publicaba como precio de
   mercado (22 de los 32 ETF del canónico de ese día, SPY en EUR entre ellos).
2. Librería justetf-scraping (opcional, pip install git+...): ficha completa
   (TER, tamaño, países, sectores, top 10 posiciones con ISIN, descripción...).

Para ISIN que no sean ETF (fondos tradicionales) la API devuelve 404 y este
fetcher retorna {} sin error.

La ficha completa no pasa por `core.http`: justetf_scraping hace sus propias
peticiones. Desde el 17-10 su resultado se guarda en
`cache/justetf_overview/<ISIN>.json` y se lee con el TTL de la familia
`cartera` (y con `--sin-caducidad`, de cualquier edad), como el resto de la
caché. En modo sin red solo se sirve esa copia; si no la hay vigente, el
fetcher lo avisa (`procedencia.no_servido`) y la retención conserva lo que la
ficha anterior tenía de justETF (`core.adquisicion.retencion`, revisión de
la rama, IMP-1, y de la tercera pasada, MEN-A).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from core.adquisicion import procedencia
from core.package_integrity import atomic_write_text
from core.schema import set_path

log = logging.getLogger("fondosdb.justetf")

QUOTE_URL = "https://www.justetf.com/api/etfs/{isin}/quote"
# Solo para anotar la ficha en las estadísticas de la pasada (red / caché).
FICHA_URL = "https://www.justetf.com/en/etf-profile.html?isin={isin}"
FAMILIA_FICHA = "cartera"
CARPETA_FICHA = "justetf_overview"
# Lo que se usa de `get_etf_overview`: lo que se guarda en la copia local.
CAMPOS_FICHA = ("name", "description", "index", "replication", "fund_currency",
                "distribution_policy", "inception_date", "fund_domicile", "ter",
                "fund_size_eur", "countries", "sectors", "top_holdings")


def fetch(isin: str, http, settings: dict, force: bool = False,
          tipo: str = "") -> dict:
    if tipo == "fondo":
        log.info("justETF omitido para %s (tipo=fondo)", isin)
        return {}
    out: dict = {}
    divisa = settings.get("divisa", "EUR")

    # ---------------------------------------------------------- 1) quote API
    try:
        r = http.get(QUOTE_URL.format(isin=isin),
                     params={"locale": "en", "currency": divisa},
                     headers={"Referer": "https://www.justetf.com/"},
                     ttl_dias=0.5, force=force)
        if r.ok:
            q = r.json()
            plaza = _plaza(q)
            _anota_plaza(r, q.get("quoteTradingVenue"), usado=plaza is not None)
            if plaza is not None:
                # La divisa es la PEDIDA porque la respuesta no declara ninguna (ni
                # `quoteCurrency` ni otra: sus claves son latestQuote, latestQuoteDate,
                # previousQuote, previousQuoteDate, dtdPrc, dtdAmt, quoteTradingVenue y
                # quoteLowHigh) y justETF convierte a la que se le pide: la cifra está en esa
                # divisa. Una plaza que no cotiza en ella (Londres) da un precio convertido;
                # la plaza viaja en la anotación para que se vea, y a igual fecha manda la
                # plaza de la serie (`core.adquisicion.registro.DESEMPATE_FRESCURA`).
                set_path(out, "valoracion.vl", _raw(q.get("latestQuote")))
                set_path(out, "valoracion.vl_fecha", q.get("latestQuoteDate"))
                set_path(out, "valoracion.vl_divisa", divisa)
            else:
                log.info("justETF %s: la cotización es de %r, no de una plaza: no se usa como precio",
                         isin, q.get("quoteTradingVenue"))
            set_path(out, "identificacion.tipo", "etf")
        elif r.status == 404:
            log.info("%s no está en justETF (¿fondo tradicional?)", isin)
            return {}
    except Exception as e:
        log.warning("justETF quote %s: %s", isin, e)

    # ----------------------------------------- 2) ficha completa (opcional)
    # solo si la quote confirmó que es un ETF (o el csv lo declara)
    if not out and tipo != "etf":
        return out
    try:
        ficha = _ficha_completa(isin, http, force)
    except ImportError:
        log.info("justetf-scraping no instalada: ficha completa omitida "
                 "(pip install git+https://github.com/druzsan/justetf-scraping.git)")
        return out
    except Exception as e:
        log.warning("justETF ficha %s: %s", isin, e)
        return out
    if ficha:
        # Un fallo al mapear (la biblioteca cambia un campo, una copia editada a
        # mano) no tumba el adaptador ni se lleva la cotización: se apunta y se
        # conserva lo demás, como antes de la copia (revisión, MEN-C).
        try:
            _mapea_ficha(out, ficha)
        except Exception as e:  # noqa: BLE001
            log.warning("justETF ficha %s: no se pudo mapear (%s); se conserva lo demás", isin, e)
    return out


#: Lo que justETF pone en `quoteTradingVenue` cuando la cifra NO es de una plaza de negociación.
#: Medido el 09-11-2026 en las 33 respuestas de la caché: 24 `NAV`, 8 `XETRA`, 1 `LSE`. Con `NAV`
#: la cifra es el valor liquidativo del emisor pasado a la divisa pedida (IE00B4L5Y983: 140,99 USD
#: / 1,1165 del BCE = 126,28 EUR, cuando EUNL.XETRA cerró a 127,315), no un precio de mercado. Un
#: VL no es un precio, y el del emisor ya viaja en su bloque (decisión 52). `INAV` no se ha visto;
#: va por si acaso, porque un valor liquidativo indicativo tampoco es una plaza.
NO_ES_PLAZA = frozenset({"NAV", "INAV"})


def _plaza(q: dict) -> str | None:
    """La plaza de la cotización, o None si no es una plaza (VL, o la respuesta no la dice).

    Sin `quoteTradingVenue` no se sabe de dónde sale la cifra, y no se usa: las 33 respuestas
    medidas lo traen siempre, así que faltar es un cambio de la API, no un caso normal."""
    plaza = str(q.get("quoteTradingVenue") or "").strip()
    if not plaza or plaza.upper() in NO_ES_PLAZA:
        return None
    return plaza


def _anota_plaza(r, plaza, usado: bool) -> None:
    """Deja la plaza en `meta.adquisicion.fuentes.justetf.endpoints["justetf:quote"]`.

    La etiqueta de las hojas no cambia (sigue siendo `justetf`): se anota la descarga que las
    respalda, como hace `procedencia.etapa`, con la plaza al lado. Con `NAV` también se anota,
    para que se vea por qué justETF contestó y no puso precio."""
    reg = procedencia.registro_activo()
    if reg is None:
        return
    reg.endpoint("quote", getattr(r, "fetched_at", None),
                 plaza=str(plaza).strip() if plaza else "sin_plaza", usado_como_precio=usado)


def _raw(v):
    if isinstance(v, dict):
        return v.get("raw")
    return v


def _trad_distribucion(v):
    if not v:
        return None
    v = str(v).lower()
    if "accumulat" in v:
        return "acumulacion"
    if "distribut" in v:
        return "distribucion"
    return v


def _ruta_ficha(http, isin: str) -> Path | None:
    """`cache/justetf_overview/<ISIN>.json`, junto a la caché HTTP de la pasada."""
    cache_http = getattr(http, "cache_dir", None)
    if cache_http is None:
        return None
    return Path(cache_http).parent / CARPETA_FICHA / f"{isin}.json"


def _anota(http, origen: str, isin: str) -> None:
    anota = getattr(http, "_anota", None)
    if callable(anota):
        anota(origen, FICHA_URL.format(isin=isin), FAMILIA_FICHA)


def _ficha_completa(isin: str, http, force: bool = False) -> dict | None:
    """`get_etf_overview` con copia en disco.

    Se lee la copia si está dentro del TTL de la familia `cartera`
    (`http.ttl_para`, que ya tiene en cuenta `--sin-caducidad` y `--familias`)
    y no se fuerza; en modo sin red se lee aunque se fuerce, como `Http`. Sin
    copia vigente y sin red, None: no se llama a la biblioteca y se avisa a la
    retención (`procedencia.no_servido`) con la fecha de la copia caducada, si
    la hay (revisión de la tercera pasada, MEN-A y MEN-B)."""
    ruta = _ruta_ficha(http, isin)
    sin_red = bool(getattr(http, "sin_red", False))
    ttl_para = getattr(http, "ttl_para", None)
    ttl = ttl_para(FAMILIA_FICHA) if callable(ttl_para) else 30.0
    fetched_at = None
    if ruta is not None and ruta.exists() and (not force or sin_red):
        try:
            copia = json.loads(ruta.read_text(encoding="utf-8"))
            # NaN, Infinity, 1e20 o una fecha futura: la copia no vale (MEN-G).
            fetched_at = procedencia.epoca_valida(copia.get("fetched_at"))
        except (OSError, ValueError, TypeError, AttributeError):
            copia = None
        if fetched_at is None:
            copia = None
        if copia is not None and (time.time() - fetched_at) / 86400 <= ttl:
            _anota(http, "cache", isin)
            return copia.get("ficha") or None
    if sin_red:
        _anota(http, "sin_cache", isin)
        procedencia.no_servido("overview", fetched_at)
        log.info("justETF ficha completa omitida para %s: modo sin red y sin copia vigente en "
                 "cache/%s/", isin, CARPETA_FICHA)
        return None

    import justetf_scraping  # type: ignore

    _anota(http, "red", isin)
    ov = justetf_scraping.get_etf_overview(isin)
    if not ov:
        return None
    # Se guarda y se devuelve lo mismo (pasado por JSON): una pasada desde la
    # copia da exactamente la misma ficha que la que la descargó.
    ficha = json.loads(json.dumps({k: ov.get(k) for k in CAMPOS_FICHA}, ensure_ascii=False, default=str))
    if ruta is not None:
        # Si no se puede guardar (disco, permisos, el destino abierto por otro
        # proceso en Windows), la ficha recién descargada se usa igual
        # (revisión, MEN-D).
        try:
            atomic_write_text(ruta, json.dumps({"isin": isin, "fetched_at": time.time(), "ficha": ficha},
                                               ensure_ascii=False) + "\n")
        except Exception as e:  # noqa: BLE001
            log.warning("justETF ficha %s: no se pudo guardar la copia en %s (%s); se usa la descargada",
                        isin, ruta, e)
            _descarta_copia(ruta, isin)
    return ficha


def _descarta_copia(ruta: Path, isin: str) -> None:
    """Quita la copia anterior cuando no se ha podido guardar la nueva.

    Si se quedara, iría por detrás de la ficha: una pasada `--sin-caducidad`
    posterior serviría el dato viejo con la etiqueta `justetf`, sin `retenido:`
    ni aviso (revisión, MEN-F). Sin copia, esa pasada retiene lo de la ficha,
    que es lo nuevo. Si tampoco se puede borrar, se apunta y se sigue."""
    try:
        ruta.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        log.warning("justETF ficha %s: tampoco se pudo quitar la copia anterior %s (%s)", isin, ruta, e)


def _mapea_ficha(out: dict, ov: dict) -> None:
    set_path(out, "identificacion.nombre", ov.get("name"))
    set_path(out, "identificacion.descripcion", ov.get("description"))
    set_path(out, "identificacion.indice_benchmark_oficial", ov.get("index"))
    set_path(out, "identificacion.replicacion", ov.get("replication"))
    set_path(out, "identificacion.divisa_base", ov.get("fund_currency"))
    set_path(out, "identificacion.politica_distribucion",
             _trad_distribucion(ov.get("distribution_policy")))
    set_path(out, "identificacion.fecha_lanzamiento_fondo", ov.get("inception_date"))
    set_path(out, "identificacion.domicilio", ov.get("fund_domicile"))
    set_path(out, "costes.ter_pct", ov.get("ter"))
    set_path(out, "valoracion.patrimonio_fondo_meur", ov.get("fund_size_eur"))

    paises = {p["name"]: p["percentage"] for p in ov.get("countries") or []
              if p.get("name") is not None}
    if paises:
        set_path(out, "cartera.paises_pct", paises)
    sectores = {s["name"]: s["percentage"] for s in ov.get("sectors") or []
                if s.get("name") is not None}
    if sectores:
        set_path(out, "cartera.sectores_pct", sectores)
    top = [{"nombre": h.get("name"), "isin": h.get("isin"),
            "peso_pct": h.get("percentage")}
           for h in ov.get("top_holdings") or []]
    if top:
        set_path(out, "cartera.posiciones", top)
        set_path(out, "cartera.peso_top10_pct",
                 round(sum(h["peso_pct"] or 0 for h in top), 2))
    # cotización intradía (bid/ask/spread): descartada como ruido
