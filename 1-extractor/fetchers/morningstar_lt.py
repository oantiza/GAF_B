"""Fetcher Morningstar SIN sesión: screener europeo + API lt (+ sal-service).

APIs verificadas desde el PC de Oscar (10-06-2026), sin Selenium ni login:
  1. lt.morningstar.com .../security/screener  (03-09-2026: tools.morningstar.es dejo de resolver — Morningstar retiro los hosts tools.*; misma ruta y misma apikey en lt)  -> ISIN a SecId + ~33 datapoints
  2. lt.morningstar.com .../security_details/{SecId} con viewId:
     - MFsnapshot / ETFsnapshot: ficha gigante (52 bloques: rentabilidades
       fondo/índice, riesgo completo, cartera con breakdowns, estrellas por
       periodo, Medalist, KID-SRI, gestores, documentos...)
     - Mifid: costes EMT reales (actual y estimado)
     - sustainability: ESG completo (E/S/G, carbono)
  3. api-global sal-service con apikey pública (si responde; diagnóstico en log)

El mapeo está ajustado a las estructuras REALES capturadas en
cache/raw_morningstar_lt/IE00B4L5Y983/ el 10-06-2026.

16-11-2026: el buscador (1) empezó a contestar 401 a todo; la ficha (2) y sal-service (3) seguían respondiendo. Si el
buscador no contesta, se usa el identificador que dejó guardado la última vez que sí lo hizo: ver «el identificador
conocido», más abajo. Un ISIN que nunca pasó por el buscador sigue sin Morningstar hasta que vuelva.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from core.adquisicion import procedencia
from core.adquisicion.registro import SAL_FAMILIA, VISTA_FAMILIA
from core.schema import set_path
from fetchers.morningstar import pon_rentabilidad_fondo

log = logging.getLogger("fondosdb.morningstar_lt")

# Las respuestas negativas (404/sin id válido) no se cachean en core.http, así
# que cada pasada volvía a probar las combinaciones (id, asset) que fallan en
# sal-service. Memoria negativa con su propio plazo, como la del screener.
NEGATIVO_SAL_DIAS = 30

SCREENER = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener"
LT = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security_details/{sec_id}"

UNIVERSOS = ["FOESP$$ALL", "ETEXG$XMAD", "FOEUR$$ALL", ""]  # "" = sin filtro

DATAPOINTS_FULL = ("SecId|Name|LegalName|ISIN|Currency|CategoryName|"
                   "StarRatingM255|AnalystRatingScale|OngoingCharge|"
                   "MaxFrontEndLoad|MaxDeferredLoad|ActualManagementFee|"
                   "InceptionDate|ClosePrice|ClosePriceDate|PriceCurrency|"
                   "ReturnD1|ReturnW1|ReturnM1|ReturnM3|ReturnM6|ReturnM0|"
                   "ReturnM12|ReturnM36|ReturnM60|ReturnM120|"
                   "StandardDeviationM12|StandardDeviationM36|StandardDeviationM60|"
                   "SharpeM36|AverageCreditQualityCode|EffectiveDuration|"
                   "LargestSector|LargestRegion|SustainabilityRank|Yield_M12|"
                   "EquityStyleBox|BondStyleBox|ManagerTenure|FundId|Universe|"
                   "EUSFDRType|SFDRType|SFDRFundType")
DATAPOINTS_MIN = ("SecId|Name|ISIN|Currency|CategoryName|StarRatingM255|"
                  "OngoingCharge|ReturnM0|ReturnM12|ReturnM36|ReturnM60|"
                  "StandardDeviationM36|SharpeM36|Yield_M12|ClosePrice|"
                  "ClosePriceDate")

# ----------------------------------------------------- códigos Morningstar
SECTORES_MS = {"SB_BasicMaterials": "materiales_basicos",
               "SB_ConsumerCyclical": "consumo_ciclico",
               "SB_FinancialServices": "servicios_financieros",
               "SB_RealEstate": "inmobiliario",
               "SB_ConsumerDefensive": "consumo_defensivo",
               "SB_Healthcare": "salud", "SB_Utilities": "utilities",
               "SB_CommunicationServices": "comunicacion",
               "SB_Energy": "energia", "SB_Industrials": "industria",
               "SB_Technology": "tecnologia"}
SECTOR_CODES = {"101": "materiales_basicos", "102": "consumo_ciclico",
                "103": "servicios_financieros", "104": "inmobiliario",
                "205": "consumo_defensivo", "206": "salud", "207": "utilities",
                "308": "comunicacion", "309": "energia", "310": "industria",
                "311": "tecnologia"}
# Las zonas son del 1 al 13, y suman el 100 %. Del 14 al 16 no son zonas: son el mismo
# reparto contado de otra manera, y por eso se llaman como lo que son y `core.limpieza`
# los quita de la ficha. El 14 es el total de emergentes y el 15 el de desarrollados: en
# IE00B4L5Y983 el 14 da 0,254, que es Latinoamerica 0,134 mas Asia emergente 0,120, y con
# el 15 suman 100. Sobre las 440 fichas que lo traian, el 14 repite la suma de las zonas
# emergentes a menos de un punto en 402 (mediana 0,0). Se llamaba `otros`, el adaptador lo
# mandaba a `other`, y Robeco Indian sumaba 300 %: Asia, Asia emergente y este total
# (decision 7 de Oscar, 04-11-2026).
REGION_CODES = {"1": "estados_unidos", "2": "canada", "3": "latinoamerica",
                "4": "reino_unido", "5": "eurozona", "6": "europa_ex_euro",
                "7": "europa_emergente", "8": "africa", "9": "oriente_medio",
                "10": "japon", "11": "australasia", "12": "asia_desarrollada",
                "13": "asia_emergente", "14": "total_emergentes",
                "15": "total_desarrollados", "16": "no_clasificado"}
ASSET_CODES = {"1": "rv", "2": "rf", "3": "rf", "5": "convertibles",
               "6": "preferentes", "7": "liquidez", "8": "otros"}
CAP_CODES = {"1": "gigante", "2": "grande", "3": "mediana",
             "4": "pequeña", "5": "micro"}
STYLEBOX_CODES = {"1": "LV", "2": "LB", "3": "LG", "4": "MV", "5": "MB",
                  "6": "MG", "7": "SV", "8": "SB", "9": "SG"}
# supersectores de renta fija (GlobalBondSectorBreakdownLevel1)
BOND_SECTOR_CODES = {"10": "gobierno", "20": "municipal", "30": "corporativa",
                     "40": "titulizada", "50": "liquidez", "60": "derivados"}
PLAZOS = {"M12": "1a", "M36": "3a", "M60": "5a", "M120": "10a"}
SNAPSHOT_TOP_HOLDINGS_MAX = 10
SNAPSHOT_DEGRADED_MIN_EXTRA = 10


def fetch(isin: str, http, settings: dict, force: bool = False,
          raw_dir: Path | None = None) -> dict:
    out: dict = {}
    raw_base = Path(raw_dir) / isin if raw_dir else None
    if raw_base:
        raw_base.mkdir(parents=True, exist_ok=True)

    fila, fetched_screener = _screener(isin, http, settings, force, raw_base)
    sec_id = (fila or {}).get("SecId")
    if fila:
        with procedencia.etapa("screener", fetched_screener):
            try:
                _mapea_screener(out, fila)
            except Exception as e:
                log.warning("mapeo screener %s: %s", isin, e)

    if sec_id:
        with procedencia.etapa("screener", fetched_screener):
            set_path(out, "meta.sec_id_morningstar", sec_id)
        for view in ("MFsnapshot", "ETFsnapshot", "Mifid", "sustainability"):
            payload, fetched_at = _lt(sec_id, view, http, settings, force, raw_base)
            if not payload:
                continue
            with procedencia.etapa(view, fetched_at):
                try:
                    if view.endswith("snapshot"):
                        _mapea_snapshot(out, payload)
                    elif view == "Mifid":
                        _mapea_mifid(out, payload, isin)
                    else:
                        _mapea_sustainability(out, payload)
                except Exception as e:
                    log.warning("mapeo %s %s: %s", view, isin, e)
        try:
            _sal(sec_id, http, settings, force, raw_base, out,
                 alt_id=(fila or {}).get("FundId"),
                 universo=(fila or {}).get("Universe"))
        except Exception as e:
            log.warning("sal-service %s: %s", isin, e)
    if not out:
        log.info("morningstar_lt: nada para %s", isin)
    return out


# --------------------------------------------------- sal-service (directo)
APIKEY = "lstzFDEOhfFNMLikKa0am9mgEKLBl49T"
SAL = "https://api-global.morningstar.com/sal-service/v1/{asset}/{endpoint}/{sec_id}/data"
SAL_BLOQUES = [
    ("quote", "quote/v7", None),
    ("investmentFee", "price/investmentFee", None),
    ("feeLevel", "price/feeLevel/v1", None),
    ("salesFees", "price/salesFees", None),
    ("trailingReturn", "trailingReturn/v3", {"duration": "monthly"}),
    ("riskVolatility", "performance/riskVolatility", None),
    ("maxDrawDown", "performance/marketVolatilityMeasure", {"year": 3}),
    ("allocationMap", "process/asset/v3", None),
    ("sector", "portfolio/v2/sector", None),
    ("regional", "portfolio/regionalSectorIncludeCountries", None),
    ("marketCap", "process/marketCap", None),
    ("equityStyle", "process/stockStyle/v2", None),
    ("fixedIncomeStyle", "process/fixedIncomeStyle", None),
    ("creditQuality", "portfolio/creditQuality", None),
    ("maturitySchedule", "process/maturitySchedule", None),
    ("multiLevelFixedIncome", "multiLevelFixedIncomeData",
     {"primary": "superYieldToWorst", "secondary": "superSector.weight"}),
    ("position", "portfolio/holding/v2", {"premiumNum": 10000, "freeNum": 10000}),
    ("esgData", "esg/v1", None),
    ("people", "people", None),
    ("parentSummary", "parent/parentSummary", None),
    ("distribution", "distribution/annual", None),
    ("investmentStrategy", "morningstarTake/investmentStrategy", None),
]


# Los estados con los que el servicio dice que ese identificador no existe para ese tipo de producto.
ESTADOS_DE_NO_EXISTE = (400, 404)


def _sal(sec_id, http, settings, force, raw_base, out,
         alt_id=None, universo=None):
    """Prueba combinaciones (id, asset) en el bloque quote; con la primera que
    responda descarga el resto. Para ETFs el SecId 0P... suele fallar y el
    FundId FS... es la alternativa."""
    crudas = {}
    fechas: dict[str, float | None] = {}
    cab = {"apikey": APIKEY,
           "Referer": "https://global.morningstar.com/",
           "Origin": "https://global.morningstar.com"}
    p_base = {"clientId": "MDC", "version": "4.71.0"}
    ids = [i for i in (sec_id, alt_id) if i]
    assets = ["etf", "fund"] if str(universo or "").startswith("ET") \
        else ["fund", "etf"]

    elegido = None  # (asset, id) que respondió al quote
    for sid in ids:
        for a in assets:
            if not force and _negativo_vigente(http, "morningstar_sal_negative",
                                               f"{sid}_{a}", NEGATIVO_SAL_DIAS):
                log.debug("sal %s/quote (%s): negativo en memoria", a, sid)
                continue
            try:
                r = http.get(SAL.format(asset=a, endpoint="quote/v7", sec_id=sid),
                             params=p_base, headers=cab, force=force,
                             familia=SAL_FAMILIA["quote"])
                if r.ok and r.text.strip().startswith(("{", "[")):
                    crudas["quote"] = r.json()
                    fechas["quote"] = r.fetched_at
                    elegido = (a, sid)
                    _borra_negativo(http, "morningstar_sal_negative", f"{sid}_{a}")
                    break
                log.debug("sal %s/quote (%s) -> HTTP %s: %s",
                          a, sid, r.status, r.text[:120].replace("\n", " "))
                # EXT-1 (auditoria del 16-11-2026): solo un «no existe» del servicio es un negativo. Un 401 o un 403
                # son de la clave o de un bloqueo, no del producto, y guardados dejaban al ETF sin dato durante
                # NEGATIVO_SAL_DIAS aunque la clave se arreglara al dia siguiente.
                if r.status in ESTADOS_DE_NO_EXISTE:
                    _guarda_negativo(http, "morningstar_sal_negative", f"{sid}_{a}")
            except Exception as e:
                log.debug("sal quote %s/%s: %s", a, sid, e)
        if elegido:
            break
    if not elegido:
        log.info("sal-service sin id válido para %s (normal en ETFs); "
                 "lt+justETF ya lo cubren", sec_id)
        return
    asset, sid = elegido

    for nombre, endpoint, params in SAL_BLOQUES:
        if nombre == "quote":
            continue
        try:
            p = dict(p_base)
            if params:
                p.update(params)
            r = http.get(SAL.format(asset=asset, endpoint=endpoint, sec_id=sid),
                         params=p, headers=cab, force=force,
                         familia=SAL_FAMILIA.get(nombre))
            if r.ok and r.text.strip().startswith(("{", "[")):
                crudas[nombre] = r.json()
                fechas[nombre] = r.fetched_at
        except Exception as e:
            log.debug("sal %s %s/%s: %s", sid, asset, endpoint, e)
    if not crudas:
        return
    if raw_base:
        for nombre, payload in crudas.items():
            try:
                (raw_base / f"sal_{nombre}.json").write_text(
                    json.dumps(payload, ensure_ascii=False, indent=1),
                    encoding="utf-8")
            except Exception:
                pass
    from fetchers import morningstar as _ms
    try:
        # Bloque a bloque, en el orden interno de `_mapea`, para que cada hoja
        # quede atribuida a su endpoint sin cambiar quién gana en las rutas
        # que escriben varios bloques.
        for nombre in _ms.ORDEN_MAPEO:
            if nombre not in crudas:
                continue
            with procedencia.etapa(f"sal_{nombre}", fechas.get(nombre)):
                _ms._mapea(out, {nombre: crudas[nombre]})
        _limpia_degradacion_si_sal_completo(out, crudas.get("position"))
        log.info("sal-service: %s bloques mapeados (%s)", len(crudas), asset)
    except Exception as e:
        log.warning("mapeo sal-service %s: %s", sec_id, e)


def resuelve(isin: str, http, settings: dict) -> dict | None:
    """Identifica un ISIN: {'nombre':…, 'tipo': 'etf'|'fondo'} o None.
    Usa el screener (sin sesión); para altas masivas."""
    fila, _fecha = _screener(isin, http, settings, force=False, raw_base=None)
    if not fila:
        return None
    universo = str(fila.get("Universe") or "")
    return {"nombre": fila.get("LegalName") or fila.get("Name") or "",
            "tipo": "etf" if universo.startswith("ET") else "fondo"}


# ------------------------------------------------ el identificador conocido
# El 16-11-2026 el buscador empezó a contestar 401 a todo, y con él se caía Morningstar entero: el buscador es quien
# traduce el ISIN al identificador (SecId) con el que se piden la ficha y la cartera, que seguían respondiendo. Ese
# identificador ya está guardado de la última vez que el buscador contestó, en `screener.json` de la copia de cada ISIN.
# Si el buscador no responde, se usa el conocido. Medido ese día en cinco fondos de tipos distintos: con él llegan entre
# 192 y 334 hojas por fondo, las mismas que con el buscador salvo 3 o 4 que solo él daba, todas de las que no cambian de
# un día para otro. Esas se toman de la fila guardada, con la fecha en que se guardó como procedencia, y con plazo.
IDENTIFICADORES_DE_LA_FILA = ("SecId", "FundId", "Universe")
# Lo que la fila dice y no se mueve: nombre, divisa, categoría, fecha de lanzamiento, comisiones máximas, y dos lecturas
# de cartera (sector principal y calidad media) que cambian despacio. NO entran el precio, las rentabilidades, la
# volatilidad, el Sharpe, el coste corriente ni las estrellas: de una fila vieja serían cifras viejas con cara de nuevas.
CAMPOS_ESTABLES_DE_LA_FILA = ("Name", "LegalName", "Currency", "PriceCurrency", "CategoryName", "InceptionDate",
                              "MaxFrontEndLoad", "MaxDeferredLoad", "LargestSector", "AverageCreditQualityCode")
# Hasta cuándo valen esos campos de una fila guardada. Es el plazo de la cartera retenida (`retencion.MAX_DIAS_CARTERA`).
# El identificador no caduca: si el producto ya no existe, la ficha deja de responder y lo dice ella.
MAX_DIAS_FILA_GUARDADA = 180
# Con el buscador caído, cada ISIN cuesta ocho consultas que no van a contestar. Tras estos seguidos sin una sola
# respuesta válida, en esta pasada no se le pregunta más. La cuenta vive en el cliente HTTP, que es uno por pasada: así
# no pasa de una pasada a otra ni de una prueba a otra.
ISIN_SEGUIDOS_SIN_BUSCADOR = 5
_CUENTA = "_morningstar_seguidos_sin_buscador"


def _seguidos_sin_buscador(http) -> int:
    return getattr(http, _CUENTA, 0)


def _anota_buscador(http, respondio: bool) -> None:
    setattr(http, _CUENTA, 0 if respondio else _seguidos_sin_buscador(http) + 1)


def _fila_conocida(isin: str, raw_base: Path | None, ahora: float | None = None) -> tuple[dict, float] | None:
    """(fila reducida, cuándo se guardó) de la última vez que el buscador contestó por este ISIN, o None."""
    if raw_base is None:
        return None
    ruta = Path(raw_base) / "screener.json"
    try:
        fila = json.loads(ruta.read_text(encoding="utf-8"))
        guardada = ruta.stat().st_mtime
    except (OSError, ValueError):
        return None
    if not isinstance(fila, dict) or not fila.get("SecId") or str(fila.get("ISIN", "")).upper() != isin.upper():
        return None
    campos = IDENTIFICADORES_DE_LA_FILA
    dias = ((time.time() if ahora is None else ahora) - guardada) / 86400
    if dias <= MAX_DIAS_FILA_GUARDADA:
        campos = campos + CAMPOS_ESTABLES_DE_LA_FILA
    return {k: fila[k] for k in campos if fila.get(k) not in (None, "")}, guardada


def _sin_buscador(isin: str, raw_base: Path | None, motivo: str):
    """Lo que devuelve `_screener` cuando el buscador no ha contestado: la fila conocida, o nada."""
    conocida = _fila_conocida(isin, raw_base)
    if conocida is None:
        log.warning("screener: %s %s: no se recuerda como no encontrado", isin, motivo)
        return None, None
    fila, guardada = conocida
    log.warning("screener: %s %s: uso su identificador conocido %s, guardado el %s",
                isin, motivo, fila["SecId"], time.strftime("%Y-%m-%d", time.localtime(guardada)))
    return fila, guardada


# ------------------------------------------------------------------ fuentes
def _screener(isin, http, settings, force, raw_base):
    """(fila, fetched_at) o (None, None).

    Si el buscador no contesta y hay una fila guardada de este ISIN, devuelve la conocida, reducida a sus
    identificadores y a lo que no cambia, con la fecha en que se guardó (ver «el identificador conocido»)."""
    if not force and _negativo_screener_vigente(isin, http):
        log.info("screener: %s no encontrado (cache negativo)", isin)
        return None, None
    if _seguidos_sin_buscador(http) >= ISIN_SEGUIDOS_SIN_BUSCADOR:
        return _sin_buscador(isin, raw_base, f"sin preguntar al buscador, que no ha contestado a {_seguidos_sin_buscador(http)} ISIN seguidos")
    # EXT-1 (auditoria del 16-11-2026): «no encontrado» solo se recuerda si cada universo dio una respuesta valida y
    # vacia. Antes una caida de red o un 5xx tambien acababan en el negativo, y el ISIN quedaba 7 dias sin buscarse.
    sin_respuesta = []
    for universo in UNIVERSOS:
        respondio = False
        for datapoints in (DATAPOINTS_FULL, DATAPOINTS_MIN):
            params = {"page": 1, "pageSize": 5, "sortOrder": "LegalName asc",
                      "outputType": "json", "version": 1,
                      "languageId": "es-ES", "currencyId": settings.get("divisa", "EUR"),
                      "securityDataPoints": datapoints, "term": isin}
            if universo:
                params["universeIds"] = universo
            try:
                r = http.get(SCREENER, params=params,
                             headers={"Referer": "https://www.morningstar.es/"},
                             force=force, familia="precio")
                valida = bool(r.ok and r.text.strip())
                rows = (r.json().get("rows") or []) if valida else []
            except Exception as e:
                log.debug("screener %s (%s): %s", isin, universo, e)
                continue
            respondio = respondio or valida
            for row in rows:
                if str(row.get("ISIN", "")).upper() == isin.upper():
                    if raw_base:
                        (raw_base / "screener.json").write_text(
                            json.dumps(row, ensure_ascii=False, indent=1),
                            encoding="utf-8")
                    log.info("screener: %s -> %s (universo %s)",
                             isin, row.get("SecId"), universo or "global")
                    _borra_negativo_screener(isin, http)
                    _anota_buscador(http, True)
                    return row, r.fetched_at
        if not respondio:
            sin_respuesta.append(universo or "global")
    if sin_respuesta:
        # Solo cuenta para dejar de preguntar si no ha contestado NINGÚN universo: uno caído no es el buscador caído.
        _anota_buscador(http, len(sin_respuesta) < len(UNIVERSOS))
        return _sin_buscador(isin, raw_base, f"sin respuesta valida en {len(sin_respuesta)} universo(s) ({', '.join(sin_respuesta)})")
    _anota_buscador(http, True)
    _guarda_negativo_screener(isin, http)
    log.info("screener: %s no encontrado", isin)
    return None, None


def _ruta_negativo(http, carpeta: str, clave: str) -> Path | None:
    cache_dir = getattr(http, "cache_dir", None)
    if not cache_dir:
        return None
    return Path(cache_dir).parent / carpeta / f"{clave}.json"


def _negativo_vigente(http, carpeta: str, clave: str, ttl_dias: float) -> bool:
    if getattr(http, "sin_caducidad", False):
        return False  # regenerando de caché: un negativo viejo no debe tapar datos
    ruta = _ruta_negativo(http, carpeta, clave)
    if not ruta or not ruta.exists():
        return False
    try:
        payload = json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return False
    edad_dias = (time.time() - payload.get("fetched_at", 0)) / 86400
    return edad_dias <= ttl_dias


def _guarda_negativo(http, carpeta: str, clave: str) -> None:
    ruta = _ruta_negativo(http, carpeta, clave)
    if not ruta:
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({"clave": clave, "fetched_at": time.time()},
                               ensure_ascii=False), encoding="utf-8")


def _borra_negativo(http, carpeta: str, clave: str) -> None:
    ruta = _ruta_negativo(http, carpeta, clave)
    if ruta and ruta.exists():
        try:
            ruta.unlink()
        except OSError:
            pass


def _negativo_screener_vigente(isin: str, http, ttl_dias: float = 7) -> bool:
    return _negativo_vigente(http, "morningstar_screener_negative", isin.upper(), ttl_dias)


def _guarda_negativo_screener(isin: str, http) -> None:
    _guarda_negativo(http, "morningstar_screener_negative", isin.upper())


def _borra_negativo_screener(isin: str, http) -> None:
    _borra_negativo(http, "morningstar_screener_negative", isin.upper())


def _lt(sec_id, view, http, settings, force, raw_base):
    """(payload, fetched_at) o (None, None)."""
    try:
        r = http.get(LT.format(sec_id=sec_id),
                     params={"viewId": view, "currencyId": settings.get("divisa", "EUR"),
                             "itype": "msid", "languageId": "es-ES",
                             "responseViewFormat": "json"},
                     force=force, familia=VISTA_FAMILIA.get(view))
        if not r.ok or not r.text.strip().startswith(("[", "{")):
            return None, None
        data = r.json()
        payload = data[0] if isinstance(data, list) and data else data
        if not isinstance(payload, dict):
            return None, None
        if raw_base:
            (raw_base / f"{view}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=1),
                encoding="utf-8")
        return payload, r.fetched_at
    except Exception as e:
        log.debug("lt %s %s: %s", sec_id, view, e)
        return None, None


# ------------------------------------------------------------------ helpers
def _num(v):
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def _d(v):
    return v if isinstance(v, dict) else {}


def _lista(v):
    if isinstance(v, list):
        return v
    return [v] if isinstance(v, dict) else []


def _fecha(v):
    if not v:
        return None
    return str(v)[:10]


def _neto(items):
    """Primer elemento de la lista con SalePosition 'N' (posición neta)."""
    for it in _lista(items):
        it = _d(it)
        if it.get("SalePosition") in (None, "N"):
            return it
    return {}


def _por_posicion(items, sale):
    for it in _lista(items):
        it = _d(it)
        if it.get("SalePosition") == sale:
            return it
    return {}


def _conteo_posiciones_declarado(aggregates) -> int | None:
    """Conteo total declarado por Morningstar en los agregados de cartera."""
    for ag in _lista(aggregates):
        ag = _d(ag)
        if ag.get("SalePosition") != "N" or ag.get("HoldingsType") is not None:
            continue
        try:
            return int(float(ag.get("NumberOfHolding")))
        except (TypeError, ValueError):
            return None
    return None


def _snapshot_top10_degradado(top_count: int, declared_count: int | None) -> bool:
    if declared_count is None or top_count <= 0:
        return False
    if top_count > SNAPSHOT_TOP_HOLDINGS_MAX:
        return False
    return declared_count - top_count >= SNAPSHOT_DEGRADED_MIN_EXTRA


def _marca_snapshot_degradado(out: dict, top_count: int, declared_count: int) -> None:
    set_path(out, "cartera.holdings_degradados", {
        "status": "DEGRADED_TOP_HOLDINGS_ONLY",
        "motivo": "snapshot_top_holdings_only_but_aggregates_report_more",
        "snapshot_positions": top_count,
        "reported_positions": declared_count,
    })
    errores = out.setdefault("meta", {}).setdefault("errores", [])
    msg = (f"HOLDINGS_DEGRADED_TOP_ONLY: snapshot={top_count}, "
           f"reported={declared_count}")
    if msg not in errores:
        errores.append(msg)


def _limpia_degradacion_si_sal_completo(out: dict, position_payload) -> None:
    pos = _d(position_payload)
    listas = []
    for pagina in ("equityHoldingPage", "boldHoldingPage", "otherHoldingPage"):
        listas.extend(_lista(_d(pos.get(pagina)).get("holdingList")))
    if not listas:
        return
    cartera = out.get("cartera")
    if isinstance(cartera, dict):
        cartera.pop("holdings_degradados", None)
    errores = out.get("meta", {}).get("errores")
    if isinstance(errores, list):
        out["meta"]["errores"] = [
            e for e in errores
            if not str(e).startswith("HOLDINGS_DEGRADED_TOP_ONLY:")
        ]


# ----------------------------------------------------------- mapeo screener
def _mapea_screener(out, f):
    set_path(out, "identificacion.nombre", f.get("LegalName") or f.get("Name"))
    set_path(out, "identificacion.divisa_base", f.get("Currency") or f.get("PriceCurrency"))
    set_path(out, "identificacion.categoria_morningstar", f.get("CategoryName"))
    set_path(out, "identificacion.fecha_lanzamiento_clase", _fecha(f.get("InceptionDate")))
    set_path(out, "costes.ter_pct", _num(f.get("OngoingCharge")))
    set_path(out, "costes.comision_suscripcion_max_pct", _num(f.get("MaxFrontEndLoad")))
    set_path(out, "costes.comision_reembolso_max_pct", _num(f.get("MaxDeferredLoad")))
    set_path(out, "costes.comision_gestion_aplicada_pct", _num(f.get("ActualManagementFee")))
    set_path(out, "rating.estrellas.overall", f.get("StarRatingM255"))
    set_path(out, "valoracion.vl", _num(f.get("ClosePrice")))
    set_path(out, "valoracion.vl_fecha", _fecha(f.get("ClosePriceDate")))
    par = {"1m": "ReturnM1",
           "3m": "ReturnM3", "6m": "ReturnM6", "ytd": "ReturnM0",
           "1a": "ReturnM12", "3a_anualizada": "ReturnM36",
           "5a_anualizada": "ReturnM60", "10a_anualizada": "ReturnM120"}
    # El screener no trae la fecha de sus rentabilidades: `ClosePriceDate` es la del precio, y no
    # está comprobado que sus `Return*` acaben ese día. Sin fecha, la ventana no entra en
    # `rentabilidad.fecha_dato_por_ventana` (decisión B-74).
    for k, dp in par.items():
        pon_rentabilidad_fondo(out, k, _num(f.get(dp)), None)
    for k, dp in (("1a", "StandardDeviationM12"), ("3a", "StandardDeviationM36"),
                  ("5a", "StandardDeviationM60")):
        set_path(out, f"riesgo.volatilidad_pct.{k}.fondo", _num(f.get(dp)))
    set_path(out, "riesgo.sharpe.3a.fondo", _num(f.get("SharpeM36")))
    set_path(out, "cartera.renta_fija.calidad_media", f.get("AverageCreditQualityCode"))
    set_path(out, "cartera.renta_fija.duracion_efectiva", _num(f.get("EffectiveDuration")))
    set_path(out, "esg.globos_sostenibilidad", f.get("SustainabilityRank"))
    sfdr = f.get("EUSFDRType") or f.get("SFDRType") or f.get("SFDRFundType")
    if sfdr is not None:
        # Morningstar codifica 6/8/9 (a veces como "Article 8")
        import re as _re
        m = _re.search(r"[689]", str(sfdr))
        set_path(out, "esg.sfdr_articulo", m.group(0) if m else str(sfdr))
    set_path(out, "distribuciones.yield_12m_pct", _num(f.get("Yield_M12")))
    sector = f.get("LargestSector")
    if sector:
        set_path(out, "cartera.sector_principal", SECTORES_MS.get(sector, sector))
    # ManagerTenure descartado como ruido (11-06-2026)


# ---------------------------------------------- mapeo MFsnapshot/ETFsnapshot
def _mapea_snapshot(out, s):
    # identificación
    set_path(out, "identificacion.nombre", s.get("LegalName") or s.get("Name"))
    set_path(out, "identificacion.gestora", s.get("BrandingCompanyName"))
    set_path(out, "identificacion.ticker", s.get("Symbol"))
    set_path(out, "identificacion.fecha_lanzamiento_fondo", _fecha(s.get("InceptionDate")))
    set_path(out, "identificacion.domicilio", s.get("Domicile"))
    set_path(out, "identificacion.divisa_base", _d(s.get("Currency")).get("Id"))
    set_path(out, "identificacion.replicacion", s.get("IndexingApproach"))
    set_path(out, "identificacion.estrategia_inversion_texto", s.get("InvestmentStrategy"))
    set_path(out, "identificacion.clase_activo",
             _d(s.get("CategoryBroadAssetClass")).get("Name"))
    ucits = _d(s.get("FundAttributes")).get("UCITS")
    if ucits is not None:
        set_path(out, "identificacion.ucits", str(ucits).lower() == "true")
    fb = _lista(s.get("FundBenchmark"))
    if fb:
        set_path(out, "identificacion.indice_benchmark_oficial", _d(fb[0]).get("Name"))
    pd_ = _lista(s.get("PurchaseDetails"))
    if pd_:
        set_path(out, "identificacion.inversion_minima_inicial",
                 _num(_d(_d(pd_[0]).get("InitialInvestment")).get("Value")))

    # valoración / patrimonio
    lp = _d(s.get("LastPrice"))
    set_path(out, "valoracion.vl", _num(lp.get("Value")))
    set_path(out, "valoracion.vl_fecha", _fecha(lp.get("Date")))
    set_path(out, "valoracion.vl_divisa", _d(lp.get("Currency")).get("Id"))
    nav = _lista(s.get("NetAssetValues"))
    if nav:
        n0 = _d(nav[0])
        v = _num(n0.get("DayEndValue")) or _num(n0.get("MonthEndValue"))
        if v:
            set_path(out, "valoracion.patrimonio_fondo_meur", round(v / 1e6, 1))
            set_path(out, "valoracion.patrimonio_fecha",
                     _fecha(n0.get("DayEndDate") or n0.get("MonthEndDate")))
            set_path(out, "valoracion.patrimonio_divisa", n0.get("CurrencyId"))

    # costes
    set_path(out, "costes.ter_pct", _elige_ter_snapshot(s))
    set_path(out, "costes.comision_gestion_max_pct", _num(s.get("ManagementFee")))
    set_path(out, "costes.comision_gestion_aplicada_pct",
             _num(s.get("ActualManagementFee")))

    # rentabilidades trailing (serie MonthEnd preferida; anualizada en >1a)
    series = _lista(s.get("TrailingPerformance"))
    serie = next((x for x in series if _d(x).get("Type") == "MonthEnd"), None) \
        or (series[0] if series else None)
    if serie:
        serie = _d(serie)
        set_path(out, "rentabilidad.fecha_dato", _fecha(serie.get("Date")))
        mapa = {"M0": ("ytd", False),
                "M1": ("1m", False), "M3": ("3m", False), "M6": ("6m", False),
                "M12": ("1a", False), "M36": ("3a_anualizada", True),
                "M60": ("5a_anualizada", True), "M120": ("10a_anualizada", True),
                "M255": ("desde_lanzamiento_anualizada", True)}
        for ret in _lista(serie.get("Return")):
            ret = _d(ret)
            destino = mapa.get(ret.get("TimePeriod"))
            if not destino:
                continue
            clave, exige_anualizada = destino
            if exige_anualizada and not ret.get("Annualized"):
                continue
            # Cada `Return` trae su `Date`; la de la serie queda de respaldo (decisión B-74).
            pon_rentabilidad_fondo(out, clave, _num(ret.get("Value")),
                                   ret.get("Date") or serie.get("Date"))

    # rentabilidad del índice/categoría (lista Benchmark)
    for b in _lista(s.get("Benchmark")):
        b = _d(b)
        tipo_b = str(b.get("Type", "")).lower()
        quien = "categoria" if "categor" in tipo_b else "indice"
        bseries = _lista(b.get("TrailingPerformance"))
        bserie = next((x for x in bseries if _d(x).get("Type") == "MonthEnd"), None) \
            or (bseries[0] if bseries else None)
        if not bserie:
            continue
        mapa = {"M0": "ytd", "M1": "1m", "M3": "3m", "M6": "6m", "M12": "1a",
                "M36": "3a_anualizada", "M60": "5a_anualizada",
                "M120": "10a_anualizada"}
        for ret in _lista(_d(bserie).get("Return")):
            ret = _d(ret)
            clave = mapa.get(ret.get("TimePeriod"))
            if not clave:
                continue
            if clave.endswith("anualizada") and not ret.get("Annualized"):
                continue
            set_path(out, f"rentabilidad.trailing_pct.{clave}.{quien}",
                     _num(ret.get("Value")))

    # rentabilidad por año natural (serie anual)
    for hs in _lista(s.get("HistoricalPerformanceSeries")):
        hs = _d(hs)
        if hs.get("Frequency") == "Y" and hs.get("TimePeriod") == "M12":
            for ret in _lista(hs.get("Return")):
                ret = _d(ret)
                año = _fecha(ret.get("Date"))
                if año:
                    set_path(out, f"rentabilidad.por_año_natural.{año[:4]}.fondo",
                             _num(ret.get("Value")))
            break

    # riesgo: matriz completa (vs índice de la categoría)
    rss = _lista(s.get("RiskStatistics"))
    rs = next((x for x in rss if _d(x).get("Type") == "MonthEnd"), None) \
        or (rss[0] if rss else None)
    if rs:
        rs = _d(rs)
        set_path(out, "riesgo.fecha_dato", _fecha(rs.get("Date")))
        metricas = {"Alphas": "alpha", "Betas": "beta", "RSquareds": "r2",
                    "StandardDeviations": "volatilidad_pct",
                    "SharpeRatios": "sharpe",
                    "TrackingErrors": "tracking_error_pct",
                    "InformationRatios": "information_ratio"}
        for clave_api, metrica in metricas.items():
            for item in _lista(rs.get(clave_api)):
                item = _d(item)
                plazo = PLAZOS.get(item.get("TimePeriod"))
                if plazo:
                    set_path(out, f"riesgo.{metrica}.{plazo}.fondo",
                             _num(item.get("Value")))

    # estrellas por periodo + percentil + risk score
    for rr in _lista(s.get("RiskAndRating")):
        rr = _d(rr)
        tp = rr.get("TimePeriod")
        plazo = {"M36": "3a", "M60": "5a", "M120": "10a", "M255": "overall"}.get(tp)
        if not plazo:
            continue
        set_path(out, f"rating.estrellas.{plazo}", rr.get("RatingValue"))
        set_path(out, f"rating.percentil_categoria.{plazo}",
                 _num(rr.get("CategoryRank")))
        if plazo == "overall":
            set_path(out, "riesgo.risk_score", _num(rr.get("RiskScore")))

    # SRI (KID) y SRRI
    sri = _d(s.get("KID")).get("SRI")
    set_path(out, "riesgo.sri_kid_1a7", sri)
    set_path(out, "riesgo.srri_1a7", _d(s.get("CollectedSRRI")).get("Rank"))

    # Medalist
    mr = _d(_d(_d(s.get("Research")).get("MedalistRating")).get("OverallRating"))
    set_path(out, "rating.medalist.rating", mr.get("RatingText"))
    set_path(out, "rating.medalist.fecha", _fecha(mr.get("Date")))

    # yield
    set_path(out, "distribuciones.yield_12m_pct",
             _num(_d(s.get("YieldHistory")).get("Value")))

    # ----------------------------------------------------------- cartera
    ps = _lista(s.get("Portfolios"))
    if ps:
        p = _d(ps[0])
        set_path(out, "cartera.fecha", _fecha(p.get("Date")))
        declared_holdings_count = _conteo_posiciones_declarado(p.get("HoldingAggregates"))
        for ag in _lista(p.get("HoldingAggregates")):
            ag = _d(ag)
            if ag.get("SalePosition") != "N":
                continue
            n = ag.get("NumberOfHolding")
            ht = ag.get("HoldingsType")
            if ht is None and n is not None:
                set_path(out, "cartera.num_posiciones", n)
            elif ht == "Stock":
                set_path(out, "cartera.num_posiciones_rv", n)
            elif ht == "Bond":
                set_path(out, "cartera.num_posiciones_rf", n)

        # asignación de activos N/L/S
        # Se ACUMULA por clase, no se sustituye. `ASSET_CODES` manda los códigos
        # "2" y "3" los dos a `rf`, así que con `set_path` directo el segundo
        # pisaba al primero y una parte de la renta fija se perdía. Es el mismo
        # defecto que el 01-11-2026 encontré en el mapeo de `sal_allocationMap`,
        # donde Morningstar parte la bolsa en dos claves y se tiraba una mitad
        # —medido: 219 fondos, mediana 39,3 puntos—. Aquí no he podido medir la
        # colisión, porque en las respuestas en caché el código "2" no aparece;
        # se arregla igual porque la tabla la admite por construcción y el coste
        # de esperar a verla es un dato de cartera equivocado sin aviso.
        aa_n = _neto(p.get("AssetAllocations"))
        aa_l = _por_posicion(p.get("AssetAllocations"), "L")
        aa_s = _por_posicion(p.get("AssetAllocations"), "S")
        for fuente_aa, sufijo in ((aa_n, "neto"), (aa_l, "largo"), (aa_s, "corto")):
            acumulado: dict[str, float] = {}
            for b in _lista(fuente_aa.get("BreakdownValues")):
                b = _d(b)
                clase = ASSET_CODES.get(str(b.get("Type")))
                v = _num(b.get("Value"))
                if clase and v is not None:
                    acumulado[clase] = acumulado.get(clase, 0.0) + v
            for clase, v in acumulado.items():
                set_path(out, f"cartera.asignacion_activos.{clase}.{sufijo}",
                         round(v, 5))

        # sectores RV / regiones / países / capitalización / style box
        for b in _lista(_neto(p.get("GlobalStockSectorBreakdown")).get("BreakdownValues")):
            b = _d(b)
            nombre = SECTOR_CODES.get(str(b.get("Type")))
            if nombre:
                set_path(out, f"cartera.sectores_pct.{nombre}.fondo",
                         _num(b.get("Value")))
        for b in _lista(_neto(p.get("RegionalExposure")).get("BreakdownValues")):
            b = _d(b)
            region = REGION_CODES.get(str(b.get("Type")), str(b.get("Type")))
            v = _num(b.get("Value"))
            if v:
                set_path(out, f"cartera.regiones_pct.{region}", v)
        for b in _lista(_neto(p.get("CountryExposure")).get("BreakdownValues")):
            b = _d(b)
            v = _num(b.get("Value"))
            if v and v >= 0.01:
                set_path(out, f"cartera.paises_pct.{b.get('Type')}", v)
        for b in _lista(_neto(p.get("MarketCapitalBreakdown")).get("BreakdownValues")):
            b = _d(b)
            tramo = CAP_CODES.get(str(b.get("Type")))
            if tramo:
                set_path(out, f"cartera.capitalizacion_pct.{tramo}",
                         _num(b.get("Value")))
        for b in _lista(_neto(p.get("StyleBoxBreakdown")).get("BreakdownValues")):
            b = _d(b)
            celda = STYLEBOX_CODES.get(str(b.get("Type")))
            if celda:
                set_path(out, f"cartera.style_box_rv.celdas_pct.{celda}",
                         _num(b.get("Value")))
        # supersectores de renta fija: gobierno/corporativa/titulizada/liquidez
        for b in _lista(_neto(p.get("GlobalBondSectorBreakdownLevel1")).get("BreakdownValues")):
            b = _d(b)
            nombre = BOND_SECTOR_CODES.get(str(b.get("Type")))
            v = _num(b.get("Value"))
            if nombre and v is not None:
                set_path(out, f"cartera.renta_fija.sectores_pct.{nombre}", v)

        # estadísticas de valoración y calidad de la cartera RV
        eq = _d(p.get("EquityStatistics"))
        for destino, clave in (("per", "ProspectiveEarningsYield"),
                               ("pb", "ProspectiveBookValueYield"),
                               ("pventas", "ProspectiveRevenueYield"),
                               ("pcf", "ProspectiveCashFlowYield"),
                               ("yield_dividendo_pct", "ProspectiveDividendYield"),
                               ("crec_beneficios_pct", "ForecastedEarningsGrowth"),
                               ("crec_beneficios_5a_pct", "Forecasted5YearEarningsGrowth"),
                               ("crec_valor_contable_pct", "ForecastedBookValueGrowth"),
                               ("crec_ventas_pct", "ForecastedRevenueGrowth"),
                               ("crec_cashflow_pct", "ForecastedCashFlowGrowth")):
            set_path(out, f"cartera.valoracion_cartera.{destino}", _num(eq.get(clave)))
        set_path(out, "cartera.capitalizacion_pct.media_musd",
                 _num(eq.get("MarketCapital")))
        for destino, clave in (("roa_pct", "ROA"), ("roe_pct", "ROE"),
                               ("roic_pct", "ROIC"), ("margen_neto_pct", "NetMargin"),
                               ("deuda_capital_pct", "DTC")):
            set_path(out, f"cartera.calidad_cartera.{destino}", _num(eq.get(clave)))

        # top holdings
        top = []
        for h in _lista(p.get("PortfolioHoldings")):
            h = _d(h)
            if not h.get("SecurityName") and not h.get("ExternalName"):
                continue
            top.append({
                "nombre": h.get("SecurityName") or h.get("ExternalName"),
                "isin": h.get("ISIN"),
                "peso_pct": _num(h.get("Weighting")),
                "sector": SECTOR_CODES.get(str(h.get("GlobalSectorId")),
                                           h.get("GlobalSectorId")),
                "pais": h.get("CountryId"),
                "divisa": h.get("CurrencyId"),
                # El codigo fino de la linea, el mismo vocabulario que `holdingTypeId`
                # (`fetchers.morningstar._mapea`); significado, en el contrato de la base nueva.
                "codigo_tipo": h.get("DetailHoldingTypeId"),
            })
        if top:
            set_path(out, "cartera.top10_posiciones", top[:SNAPSHOT_TOP_HOLDINGS_MAX])
            if _snapshot_top10_degradado(len(top), declared_holdings_count):
                _marca_snapshot_degradado(out, len(top), declared_holdings_count)
            else:
                set_path(out, "cartera.posiciones", top)

    # gestión / gestora
    gestores = []
    for m in _lista(s.get("ManagerList")):
        m = _d(m)
        nombre = " ".join(x for x in (m.get("GivenName"), m.get("FamilyName")) if x)
        if nombre:
            gestores.append({"nombre": nombre,
                             "desde": _fecha(m.get("StartDate"))})
    if gestores:
        set_path(out, "gestion.gestores", gestores)
    set_path(out, "gestion.gestora.nombre", s.get("BrandingCompanyName"))

    # documentos: solo resumen (nº y última fecha)
    docs = _lista(s.get("Documents"))
    if docs:
        fechas = [f for f in (_fecha(_d(x).get("EffectiveDate")) for x in docs) if f]
        set_path(out, "documentos",
                 {"n": len(docs), "ultima_fecha": max(fechas) if fechas else None})


# ----------------------------------------------------------------- Mifid
# Las cinco parejas de costes MiFID de Morningstar: (destino, ex post, ex ante). Morningstar da las
# dos cifras de cada coste: `…Estimated` es la ex ante (la del EMT `07130` y la del KID) y `…Actual`
# la real del último periodo (la del EMT `08070`). Hasta el 09-11-2026 se tomaba primero la real y
# se guardaba con el nombre ex ante; la medición de la decisión 60
# (`INFORME_COSTE_OPERACION_2026-11-09.md`, raíz) probó que la estimada coincide con el `07130` del
# emisor en 23 de 23 a 0,05 pb y con el KID redondeado en 8 de 8, y la real con el `08070` en 21 de 21.
# Desde entonces manda la estimada, sin caer a la real si falta: una cifra ex post con nombre ex
# ante es el error que se corrige. `EntryCost…` y `ExitCost…` no aparecen en ningún `Mifid.json` de
# la caché del 08-11 (797 respuestas); se dejan por si Morningstar las sirve.
PARES_MIFID = (("corrientes_pct", "OngoingCostActual", "OngoingCostEstimated"),
               ("transaccion_pct", "TransactionFeeActual", "TransactionFeeEstimated"),
               ("incidentales_pct", "PerformanceFeeActual", "PerformanceFeeEstimated"),
               ("entrada_pct", "EntryCostActual", "EntryCostEstimated"),
               ("salida_pct", "ExitCostActual", "ExitCostEstimated"))
# La fecha de cada bloque, de la primera pareja que la traiga. La estimada de los costes corrientes y
# la de operación coinciden en la caché del 08-11 (777 de 777); la de rendimiento es otra en 86 de 743.
FECHAS_EX_ANTE = ("OngoingCostEstimatedDate", "TransactionFeeEstimatedDate", "PerformanceFeeEstimatedDate")
FECHAS_EX_POST = ("OngoingCostActualDate", "TransactionFeeActualDate", "PerformanceFeeActualDate")


def _coste_ex_ante(m: dict, clave: str, isin: str) -> float | None:
    """La cifra ex ante, o None. Una negativa no se recorta a cero (sería inventar un coste): queda
    ausente y se avisa. Un coste ex ante de PRIIPs no debería ser negativo; uno ex post sí puede
    serlo (deslizamiento favorable con el método del precio de llegada), y por eso ahí no se filtra."""
    v = _num(m.get(clave))
    if v is not None and v < 0:
        log.warning("Mifid %s: %s = %s es negativo; un coste ex ante no puede serlo, queda ausente",
                    isin or "?", clave, v)
        return None
    return v


def _mapea_mifid(out, payload, isin: str = ""):
    m = _d(payload.get("Mifid"))
    set_path(out, "riesgo.sri_kid_1a7", m.get("SummaryRiskIndicator"))
    hay_ex_ante = hay_ex_post = False
    for destino, k_actual, k_estimado in PARES_MIFID:
        ex_ante = _coste_ex_ante(m, k_estimado, isin)
        ex_post = _num(m.get(k_actual))
        set_path(out, f"costes.mifid_emt_exante.{destino}", ex_ante)
        # La real se guarda en la ficha y no se publica (decisión 60): `core.exporta` la quita del canónico.
        set_path(out, f"costes.mifid_ex_post.{destino}", ex_post)
        hay_ex_ante |= ex_ante is not None
        hay_ex_post |= ex_post is not None
    # Sin cambio el 09-11-2026: también es la cifra real (`…Actual`; la estimada difiere en 63 de 595),
    # pero `core.limpieza` la quita de la ficha (retrocesiones, 11-06-2026) y no llega a ninguna salida.
    set_path(out, "costes.comision_distribucion_pct",
             _num(m.get("DistributionFeePercOfNAVActual")))
    # Una fecha sin ninguna cifra en su bloque sería un campo presente donde no aplica.
    if hay_ex_ante:
        set_path(out, "costes.mifid_emt_exante.fecha",
                 _fecha(next((m[k] for k in FECHAS_EX_ANTE if m.get(k)), None)))
    if hay_ex_post:
        set_path(out, "costes.mifid_ex_post.fecha",
                 _fecha(next((m[k] for k in FECHAS_EX_POST if m.get(k)), None)))
    set_path(out, "riesgo.srri_1a7", _d(payload.get("CollectedSRRI")).get("Rank"))


def _elige_ter_snapshot(s: dict) -> float | None:
    """TER publicable: Morningstar a veces devuelve TotalExpenseRatio escalado
    10x; OngoingCharge/NetExpenseRatio coincide con MiFID/KIID."""
    ongoing = _num(s.get("OngoingCharge"))
    net = _num(s.get("NetExpenseRatio"))
    total = _num(s.get("TotalExpenseRatio"))
    for preferido in (ongoing, net):
        if preferido is not None:
            return preferido
    return total


# --------------------------------------------------------- sustainability
def _mapea_sustainability(out, payload):
    e = _d(payload.get("ESG"))
    set_path(out, "esg.globos_sostenibilidad", e.get("SustainabilityRank"))
    set_path(out, "esg.fecha", _fecha(e.get("SustainabilityDate")))
    set_path(out, "esg.sustainability_score", _num(e.get("RawSustainabilityScore")))
    set_path(out, "esg.score_ambiental", _num(e.get("EnvironmentalScore")))
    set_path(out, "esg.score_social", _num(e.get("SocialScore")))
    set_path(out, "esg.score_gobernanza", _num(e.get("GovernanceScore")))
    set_path(out, "esg.cobertura_cartera_pct", _num(e.get("AUMCoverage")))
    c = _d(e.get("CarbonScore"))
    set_path(out, "esg.carbono.carbon_risk_score", _num(c.get("CarbonRiskScore")))
    set_path(out, "esg.carbono.clasificacion", c.get("CarbonRiskClassification"))
    set_path(out, "esg.carbono.low_carbon",
             str(c.get("LowCarbonDesignation", "")).lower() == "yes" or None)
    set_path(out, "esg.carbono.score_exposicion", _num(c.get("CarbonExposureScore")))
    set_path(out, "esg.carbono.score_gestion", _num(c.get("CarbonManagementScore")))
    set_path(out, "esg.carbono.riesgo_activos_varados",
             _num(c.get("StrandedAssetsRisk")))
