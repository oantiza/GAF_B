"""Fetcher Morningstar vía mstarpy (APIs internas sal-service + lt + screener).

Estrategia F1:
- Cada bloque es una llamada independiente envuelta en try/except: si un
  endpoint cambia o falla, el resto sigue.
- Las respuestas CRUDAS se guardan en cache/raw_morningstar/{ISIN}/{bloque}.json
  (si guardar_respuestas_crudas=true). Así no se pierde NINGÚN campo aunque el
  mapeo al esquema aún no lo cubra, y podremos ampliar el mapeo con muestras
  reales en la Fase 2.
- El mapeo usa búsqueda tolerante de claves (los payloads varían entre
  versiones de la API de Morningstar).

Nota: mstarpy >= 10 abre una ventana de Chrome al crear la sesión (necesaria
para el token). Es normal; ocurre una vez por ejecución.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import math
from pathlib import Path

from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.morningstar")

# bloques que se piden en F1: (nombre, metodo mstarpy, kwargs)
BLOQUES = [
    ("quote", "quote", {}),
    ("investmentFee", "investmentFee", {}),
    ("feeLevel", "feeLevel", {}),
    ("salesFees", "salesFees", {}),
    ("trailingReturn", "trailingReturn", {"duration": "monthly"}),
    ("riskVolatility", "riskVolatility", {}),
    ("maxDrawDown", "maxDrawDown", {}),
    ("allocationMap", "allocationMap", {}),
    ("sector", "sector", {}),
    ("regional", "regionalSectorIncludeCountries", {}),
    ("marketCap", "marketCapitalization", {}),
    ("equityStyle", "equityStyle", {}),
    ("fixedIncomeStyle", "fixedIncomeStyle", {}),
    ("creditQuality", "creditQuality", {}),
    ("maturitySchedule", "maturitySchedule", {}),
    ("multiLevelFixedIncome", "multiLevelFixedIncomeData",
     {"primary": "superYieldToWorst", "secondary": "superSector.weight"}),
    ("position", "position", {}),
    ("esgData", "esgData", {}),
    ("people", "people", {}),
    ("parentSummary", "parentSummary", {}),
    ("distribution", "distribution", {}),
    ("investmentStrategy", "investmentStrategy", {}),
]


def fetch(isin: str, http, settings: dict, force: bool = False,
          raw_dir: Path | None = None) -> dict:
    if getattr(http, "sin_red", False):
        # mstarpy sale a red por su cuenta, sin pasar por Http ni por su caché
        # (auditoría 16-10, ALTA-17b).
        log.info("Morningstar (mstarpy) omitido para %s: modo sin red", isin)
        return {}
    try:
        import mstarpy  # type: ignore
    except ImportError:
        log.warning("mstarpy no instalada: fuente Morningstar omitida "
                    "(pip install mstarpy)")
        return {}

    try:
        fondo = mstarpy.Funds(isin, language=_lang(settings))
    except Exception as e:
        log.warning("Morningstar: no encuentro %s (%s)", isin, e)
        return {}

    out: dict = {}
    set_path(out, "identificacion.nombre", getattr(fondo, "name", None))
    set_path(out, "meta.sec_id_morningstar", getattr(fondo, "code", None))
    tipo = getattr(fondo, "asset_type", None)
    set_path(out, "identificacion.tipo", "etf" if tipo == "etf" else
             ("fondo" if tipo else None))

    crudas: dict[str, dict] = {}
    ok, ko = [], []
    for nombre, metodo, kwargs in BLOQUES:
        try:
            payload = getattr(fondo, metodo)(**kwargs)
            crudas[nombre] = payload
            ok.append(nombre)
        except Exception as e:
            ko.append(nombre)
            log.debug("Morningstar %s.%s: %s", isin, nombre, e)

    if raw_dir and settings.get("guardar_respuestas_crudas", True):
        d = Path(raw_dir) / isin
        d.mkdir(parents=True, exist_ok=True)
        for nombre, payload in crudas.items():
            try:
                (d / f"{nombre}.json").write_text(
                    json.dumps(payload, ensure_ascii=False, indent=1),
                    encoding="utf-8")
            except Exception:
                pass

    _mapea(out, crudas)
    log.info("Morningstar %s: %s/%s bloques (fallaron: %s)",
             isin, len(ok), len(BLOQUES), ", ".join(ko) or "ninguno")
    return out


# ===================================================================== mapeo
def g(d, *candidatos, default=None):
    """Primer valor no nulo entre rutas candidatas 'a.b.c'."""
    if not isinstance(d, dict):
        return default
    for ruta in candidatos:
        v, okruta = d, True
        for k in ruta.split("."):
            if isinstance(v, dict) and k in v:
                v = v[k]
            else:
                okruta = False
                break
        if okruta and v is not None:
            return v
    return default


def _num(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _fecha_iso(v) -> str | None:
    """'2026-02-28T06:00:00.000' -> '2026-02-28'; None si no es una fecha válida."""
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        return None


#: Las ventanas de `rentabilidad.trailing_pct` que llevan fecha propia (decisión B-74, 09-11-2026).
VENTANAS_RENTABILIDAD = ("1d", "1sem", "1m", "3m", "6m", "ytd", "1a",
                         "3a_anualizada", "5a_anualizada", "10a_anualizada")


def pon_rentabilidad_fondo(out: dict, ventana: str, valor, fecha) -> None:
    """Escribe la rentabilidad del fondo en una ventana y, a la vez, su fecha.

    Decisión B-74 (Óscar, 09-11-2026): una fecha por cifra. El bloque mezclaba
    fechas —el 1 mes de `trailingReturn` a fin de octubre y el 3 años del
    snapshot a fin de septiembre— bajo una sola `rentabilidad.fecha_dato`, que
    se conserva como estaba. La fecha va en
    `rentabilidad.fecha_dato_por_ventana.<ventana>` y se escribe en el mismo
    sitio que la cifra, así que gana quien gana la cifra. Si la fuente que
    pisa la cifra no trae fecha, la fecha anterior se quita: era la de otra
    cifra. Sin valor no se escribe nada, y lo que hubiera se queda como estaba.
    """
    if valor is None:
        return
    set_path(out, f"rentabilidad.trailing_pct.{ventana}.fondo", valor)
    fecha = _fecha_iso(fecha) if ventana in VENTANAS_RENTABILIDAD else None
    if fecha:
        set_path(out, f"rentabilidad.fecha_dato_por_ventana.{ventana}", fecha)
        return
    rent = out.get("rentabilidad")
    fechas = rent.get("fecha_dato_por_ventana") if isinstance(rent, dict) else None
    if isinstance(fechas, dict) and ventana in fechas:
        del fechas[ventana]
        reg = procedencia.registro_activo()
        if reg is not None:
            reg.olvida(f"rentabilidad.fecha_dato_por_ventana.{ventana}")
        if not fechas:
            del rent["fecha_dato_por_ventana"]


def fecha_posiciones_sal(pos: dict) -> tuple[str | None, bool]:
    """(fecha de las filas de `portfolio/holding/v2`, ¿coincide con la del resumen?).

    El resumen (`holdingSummary.portfolioDate`) y el snapshot `lt` pueden
    describir una cartera más reciente que las filas que publica el detalle; la
    fecha de las filas es `portfolioLastestDateFooter` (sic). Con la caché del
    14-10, tomarla cambia la fecha publicada en 74 de 762 fondos con filas, 58
    de ellos a una anterior (ES0126542036: filas a 28-02, snapshot y resumen a
    31-05).
    Si el pie viene pero no es una fecha válida, no se hereda la del resumen.
    Es la regla de la app (`functions_python/fund_ingest.py::_holdings`)."""
    resumen = g(pos, "holdingSummary") or {}
    fecha_resumen = _fecha_iso(g(resumen, "portfolioDate"))
    if pos.get("portfolioLastestDateFooter") is not None:
        fecha = _fecha_iso(pos["portfolioLastestDateFooter"])
    else:
        # Sin pie: la del resumen; las respuestas antiguas la traían en la raíz.
        fecha = fecha_resumen or _fecha_iso(g(pos, "portfolioDate", "asOfDate"))
    return fecha, fecha is not None and fecha == fecha_resumen


def _peso_en_rango(v) -> bool:
    return v is not None and math.isfinite(v) and 0 <= v <= 100


def _fecha_y_top10_de_las_filas(out: dict, pos: dict, posiciones: list[dict]) -> None:
    """`cartera.fecha` y `cartera.peso_top10_pct` de las filas de sal_position.

    Las escribe la misma etapa que las posiciones, así que pisan la fecha del
    snapshot (que describe otra cartera cuando no coinciden). Si el detalle no
    trae fecha ni en el pie ni en el resumen, se conserva la del snapshot; si
    trae un pie no válido, no se publica ninguna.

    El peso del top 10 del resumen solo vale si el resumen es de la misma fecha
    que las filas; si no, se suma a partir de las filas. Un peso fuera de
    [0, 100] (fondos con cortos o derivados: 24 de 762 en la caché del 14-10,
    p. ej. LU1832969650 -76,4 % y ES0116848005 203,2 %) no se publica: se usa
    el otro si está en rango y se deja aviso en `cartera.peso_top10_fuera_de_rango`."""
    fecha, misma_fecha = fecha_posiciones_sal(pos)
    if fecha:
        set_path(out, "cartera.fecha", fecha)
    elif pos.get("portfolioLastestDateFooter") is not None and isinstance(out.get("cartera"), dict):
        # Pie presente pero no válido: las filas no tienen fecha fiable y la del
        # snapshot no es la suya.
        out["cartera"].pop("fecha", None)
    # Sin pie ni resumen: se queda la del snapshot (si la hay).

    resumen = _num(g(pos, "holdingSummary.topHoldingWeighting")) if misma_fecha else None
    pesos = sorted((p["peso_pct"] for p in posiciones if p.get("peso_pct") is not None),
                   reverse=True)
    filas = round(sum(pesos[:10]), 6) if pesos else None
    if _peso_en_rango(resumen):
        top10 = resumen
    elif _peso_en_rango(filas):
        top10 = filas
    else:
        top10 = None
    descartados = {k: v for k, v in (("resumen", resumen), ("filas", filas))
                   if v is not None and not _peso_en_rango(v)}
    if descartados and not _peso_en_rango(resumen):
        log.warning("peso del top 10 fuera de [0, 100] (%s): %s",
                    ", ".join(f"{k}={v}" for k, v in descartados.items()),
                    "uso la suma de filas" if top10 is not None else "no lo publico")
        set_path(out, "cartera.peso_top10_fuera_de_rango",
                 {**descartados, "publicado": top10})
    set_path(out, "cartera.peso_top10_pct", top10)


# Orden interno de `_mapea`: si dos bloques escriben la misma ruta gana el
# último. morningstar_lt mapea bloque a bloque en este orden para atribuir
# cada hoja a su endpoint sin alterar quién gana.
ORDEN_MAPEO = ("quote", "investmentFee", "feeLevel", "salesFees", "trailingReturn",
               "riskVolatility", "maxDrawDown", "position", "sector", "regional",
               "marketCap", "equityStyle", "allocationMap", "fixedIncomeStyle",
               "maturitySchedule", "multiLevelFixedIncome", "creditQuality",
               "esgData", "people", "parentSummary", "distribution",
               "investmentStrategy")


def _mapea(out: dict, c: dict) -> None:
    # ----------------------------------------------------------- quote v7
    q = c.get("quote") or {}
    set_path(out, "identificacion.categoria_morningstar",
             g(q, "categoryName", "morningstarCategory"))
    set_path(out, "identificacion.divisa_base", g(q, "currency", "currencyCode"))
    set_path(out, "valoracion.vl", _num(g(q, "latestPrice", "nav", "navPrice")))
    set_path(out, "valoracion.vl_fecha", g(q, "latestPriceDate", "navDate"))
    patrimonio = _num(g(q, "fundSize", "totalAssets"))
    if patrimonio is not None and patrimonio > 5e5:
        # >500.000 solo puede ser EUR absolutos (ningún fondo supera 500.000 M€)
        patrimonio = round(patrimonio / 1e6, 1)
    set_path(out, "valoracion.patrimonio_fondo_meur", patrimonio)
    set_path(out, "costes.ter_pct", _num(g(q, "ongoingCharge", "expenseRatio")))
    set_path(out, "rating.estrellas.overall",
             g(q, "starRating", "starRatingValue", "overallMorningstarRating"))
    set_path(out, "distribuciones.yield_12m_pct", _num(g(q, "ttmYield", "yield")))
    set_path(out, "identificacion.indice_benchmark_oficial",
             g(q, "benchmark", "primaryBenchmark", "indexName"))

    # ------------------------------------------------------------- costes
    fee = c.get("investmentFee") or {}
    set_path(out, "costes.comision_gestion_max_pct",
             _num(g(fee, "managementFee", "maximumManagementFee")))
    set_path(out, "costes.ter_pct", _num(g(fee, "ongoingCharge", "netExpenseRatio")))
    fl = c.get("feeLevel") or {}
    set_path(out, "costes.ter_vs_categoria.mediana_categoria_pct",
             _num(g(fl, "medianFeeLevel", "categoryMedian", "median")))
    set_path(out, "costes.ter_vs_categoria.nivel",
             g(fl, "morningstarFeeLevel", "feeLevel"))
    set_path(out, "costes.ter_vs_categoria.percentil",
             g(fl, "feeLevelPercentile", "percentile"))
    sf = c.get("salesFees") or {}
    set_path(out, "costes.comision_suscripcion_max_pct",
             _num(g(sf, "frontLoad", "maxFrontLoad", "salesFees.frontLoad")))
    set_path(out, "costes.comision_reembolso_max_pct",
             _num(g(sf, "deferLoad", "maxDeferredLoad", "redemptionFee")))

    # ------------------------------------------------------- trailingReturn
    # OJO (auditoría A1, 2026-07-10): los periodos >1 año de trailingReturn/v3
    # llegan ACUMULADOS y el payload no trae flag de anualización (verificado:
    # IE00B28YJQ65 '3Year'=22.35 acumulado vs 6.95 anualizado del snapshot).
    # NO se mapean aquí a *_anualizada: los valores anualizados los aportan el
    # screener (ReturnM36/60/120) y el snapshot (TrailingPerformance con
    # Annualized=True). SAL es ademas heterogeneo (a veces anualizado, a veces
    # acumulado), asi que no es fuente fiable para estos campos. Contaminacion
    # confirmada: 15 fondos / 41 valores (verificacion cruzada 2026-07-10).
    tr = c.get("trailingReturn") or {}
    fecha = g(tr, "returnDate", "asOfDate", "date")
    set_path(out, "rentabilidad.fecha_dato", fecha)
    # La fecha de la serie del fondo es `fundReturnDate`: las 765 respuestas guardadas el
    # 09-11-2026 la traen, y ninguna trae las tres claves de arriba, así que `fecha_dato` no sale
    # nunca de este bloque. Se deja como estaba (decisión B-74); la fecha por ventana usa la buena.
    fecha_fondo = g(tr, "fundReturnDate", "returnDate", "asOfDate", "date")
    etiquetas = {"1d": ("1Day",), "1sem": ("1Week",), "1m": ("1Month",),
                 "3m": ("3Month",), "6m": ("6Month",),
                 "ytd": ("yearToDate", "YTD"), "1a": ("1Year",)}
    series = {"fondo": ("totalReturnNAV", "trailingReturn", "fund"),
              "categoria": ("categoryReturn", "category"),
              "indice": ("indexReturn", "index", "benchmark"),
              "percentil_categoria": ("categoryRank", "percentileRank", "rank")}
    cols = tr.get("columnDefs") or tr.get("columnDef") or []
    for quien, claves_serie in series.items():
        valores = None
        for k in claves_serie:
            if isinstance(tr.get(k), list):
                valores = tr[k]
                break
        if valores is None or not cols:
            continue
        for esquema_k, nombres_col in etiquetas.items():
            for i, col in enumerate(cols):
                if any(n.lower() in str(col).lower().replace(" ", "")
                       for n in (x.lower() for x in nombres_col)):
                    if i < len(valores) and quien == "fondo":
                        pon_rentabilidad_fondo(out, esquema_k, _num(valores[i]), fecha_fondo)
                    elif i < len(valores):
                        set_path(out, f"rentabilidad.trailing_pct.{esquema_k}.{quien}",
                                 _num(valores[i]))
                    break

    # --------------------------------------------------------------- riesgo
    rv = c.get("riskVolatility") or {}
    mapa_quien = {"fondo": ("fundRiskVolatility",),
                  "categoria": ("categoryRiskVolatility",),
                  "indice": ("indexRiskVolatility",)}
    mapa_plazo = {"1a": "for1Year", "3a": "for3Year",
                  "5a": "for5Year", "10a": "for10Year"}
    mapa_metric = {"alpha": "alpha", "beta": "beta", "r2": "rSquared",
                   "volatilidad_pct": "standardDeviation", "sharpe": "sharpeRatio"}
    for quien, kqs in mapa_quien.items():
        base = None
        for kq in kqs:
            if isinstance(rv.get(kq), dict):
                base = rv[kq]
                break
        if not base:
            continue
        for plazo, kp in mapa_plazo.items():
            bloque = base.get(kp) or {}
            for metrica, km in mapa_metric.items():
                set_path(out, f"riesgo.{metrica}.{plazo}.{quien}",
                         _num(bloque.get(km)))

    dd = c.get("maxDrawDown") or {}
    set_path(out, "riesgo.max_drawdown.pct",
             _num(g(dd, "fundMaxDrawDown", "maxDrawDown", "fund.maxDrawDown")))
    set_path(out, "riesgo.max_drawdown.meses_caida",
             g(dd, "maxDrawDownDuration", "drawdownDuration"))

    # -------------------------------------------------------------- cartera
    pos = c.get("position") or {}
    set_path(out, "cartera.num_posiciones",
             g(pos, "numberOfHolding", "numberOfHoldings"))
    set_path(out, "cartera.rotacion_pct", _num(g(pos, "turnoverRatio")))
    posiciones = []
    for pagina, tipo in (("equityHoldingPage", "rv"), ("boldHoldingPage", "rf"),
                         ("otherHoldingPage", "otro")):
        for h in (g(pos, f"{pagina}.holdingList") or []):
            posiciones.append({
                "nombre": g(h, "securityName", "name"),
                "isin": g(h, "isin"),
                "ticker": g(h, "ticker", "symbol"),
                "tipo": tipo,
                # `tipo` es la pagina en la que viene la linea, y la pagina no separa: en la de
                # bolsa hay CFD y opciones, y en la de bonos swaps y futuros. El codigo fino del
                # proveedor si (decision 9 de Oscar, 04-11-2026). Lo que significa cada uno esta
                # en el contrato `instrument-holdings-chunk.v2`.
                "codigo_tipo": g(h, "holdingTypeId"),
                "peso_pct": _num(g(h, "weighting", "weight")),
                "divisa": g(h, "currency", "currencyCode"),
                "sector": g(h, "sector", "sectorName"),
                "pais": g(h, "country", "countryName"),
            })
    if posiciones:
        # Fecha y top 10 de estas filas, no del snapshot ni del resumen.
        _fecha_y_top10_de_las_filas(out, pos, posiciones)
        set_path(out, "cartera.posiciones", posiciones)

    sec = c.get("sector") or {}
    for quien, kq in (("fondo", "FUND"), ("categoria", "CATEGORY"),
                      ("indice", "BENCHMARK")):
        base = sec.get(kq) or sec.get(kq.lower()) or {}
        for nombre, valor in (base.items() if isinstance(base, dict) else []):
            v = _num(valor)
            if v is not None and not nombre.lower().endswith(("date", "id")):
                set_path(out, f"cartera.sectores_pct.{nombre}.{quien}", v)

    reg = c.get("regional") or {}
    base = g(reg, "fundPortfolio", "fund") or {}
    if isinstance(base, dict):
        for nombre, valor in base.items():
            v = _num(valor)
            if v is not None and not nombre.lower().endswith(("date", "id")):
                set_path(out, f"cartera.regiones_pct.{nombre}", v)
    paises = g(reg, "countries", "fundPortfolio.countries")
    if isinstance(paises, list):
        for p in paises:
            nombre = g(p, "name", "countryName", "country")
            v = _num(g(p, "percent", "weight", "exposure"))
            if nombre and v is not None:
                set_path(out, f"cartera.paises_pct.{nombre}", v)

    mc = c.get("marketCap") or {}
    base = g(mc, "fund") or mc
    if isinstance(base, dict):
        for k_es, k_en in (("gigante", "giant"), ("grande", "large"),
                           ("mediana", "mid"), ("pequeña", "small"),
                           ("micro", "micro")):
            set_path(out, f"cartera.capitalizacion_pct.{k_es}",
                     _num(g(base, k_en, f"{k_en}CapWeight", f"{k_en}Cap")))

    es = c.get("equityStyle") or {}
    base = g(es, "fund") or es
    if isinstance(base, dict):
        for k_es, candidatos in (
                ("per", ("prospectiveEarnings", "priceToEarnings")),
                ("pb", ("prospectiveBookValue", "priceToBook")),
                ("pcf", ("prospectiveCashFlow", "priceToCashFlow")),
                ("pventas", ("prospectiveRevenue", "priceToSales")),
                ("yield_dividendo_pct", ("dividendYield", "dividendYieldFactor")),
                ("crec_beneficios_pct", ("earningsGrowth", "projectedEarningsGrowth"))):
            set_path(out, f"cartera.valoracion_cartera.{k_es}",
                     _num(g(base, *candidatos)))

    am = c.get("allocationMap") or {}
    mapa = g(am, "allocationMap") or am
    if isinstance(mapa, dict):
        # Morningstar parte la bolsa en DOS claves —AssetAllocUSEquity y
        # AssetAllocNonUSEquity— y "notclassified" es masa que hay que contar.
        # `otros` recoge las dos cosas que son "el resto" porque el canonico
        # colapsa a cuatro clases de todas formas, y separarlas aqui crearia una
        # clase que nadie recibe. Ojo: hay un fondo con el 95,25 % sin clasificar.
        traduccion = {"cash": "liquidez", "bond": "rf", "equity": "rv",
                      "notclassified": "otros", "other": "otros",
                      "convertible": "convertibles", "preferred": "preferentes"}
        # Se SUMA por clase, no se sustituye. Hasta el 01-11-2026 esto era
        # `candidatos[clase] = datos`, un dict por clase, asi que de las dos
        # claves de bolsa la segunda pisaba a la primera y una mitad se perdia.
        # Medido ese dia sobre las 380 respuestas en cache: las 380 traen las dos
        # claves, en 219 las dos son distintas de cero, y lo que se tiraba tenia
        # una mediana de 39,3 puntos y un maximo de 312,76. DE0008490962 figuraba
        # con 0,03 % de bolsa teniendo 99,02 %.
        # El defecto estaba casi siempre tapado por la guarda de 80-120 de abajo:
        # al perder masa la suma se salia de la banda y no se pisaba el valor
        # bueno del snapshot lt. Solo mordia cuando el estropicio era lo bastante
        # pequeno para parecer plausible, y asi llegaron 72 fondos a la maestra.
        candidatos: dict[str, dict[str, float]] = {}
        for clave, datos in mapa.items():
            if not isinstance(datos, dict):
                continue
            bajo = clave.lower()
            clase = next((es_ for en, es_ in traduccion.items() if en in bajo), None)
            if not clase:
                continue
            acumulado = candidatos.setdefault(clase, {})
            for campo, nombres in (("neto", ("netAllocation", "net")),
                                   ("largo", ("longAllocation", "long")),
                                   ("corto", ("shortAllocation", "short"))):
                valor = _num(g(datos, *nombres))
                if valor is not None:
                    acumulado[campo] = acumulado.get(campo, 0.0) + valor
        suma = sum(v.get("neto", 0.0) for v in candidatos.values())
        # algunos fondos devuelven desgloses parciales (suman 30-70%):
        # en ese caso NO pisar la asignación buena del snapshot lt
        if candidatos and 80 <= suma <= 120:
            # Este desglose SUSTITUYE al del snapshot, no se mezcla con él. Con
            # `set_path` a secas solo se pisan las clases que este bloque trae, y
            # las que solo trae el snapshot se quedan: entonces la misma masa
            # cuenta dos veces bajo dos nombres y el reparto suma 195.
            # Medido el 01-11-2026 en IE00BMW2TK08 (Lazard Global Convertibles):
            # el snapshot la clasifica como `preferentes` 90,19 y este bloque la
            # llama NotClassified -> `otros` 95,25. Las dos sobrevivian.
            # Lo introduje ese mismo dia al empezar a mapear NotClassified, que
            # antes se perdia; 7 fondos cruzaron la banda de calidad y se vio.
            (out.get("cartera") or {}).pop("asignacion_activos", None)
            for clase, acumulado in candidatos.items():
                for campo, valor in acumulado.items():
                    set_path(out, f"cartera.asignacion_activos.{clase}.{campo}",
                             round(valor, 5))

    fi = c.get("fixedIncomeStyle") or {}
    base = g(fi, "fund") or fi
    if isinstance(base, dict):
        set_path(out, "cartera.renta_fija.duracion_efectiva",
                 _num(g(base, "avgEffectiveDuration", "effectiveDuration")))
        set_path(out, "cartera.renta_fija.duracion_modificada",
                 _num(g(base, "modifiedDuration", "avgModifiedDuration")))
        set_path(out, "cartera.renta_fija.vencimiento_efectivo",
                 _num(g(base, "avgEffectiveMaturity", "effectiveMaturity")))
        set_path(out, "cartera.renta_fija.ytm_pct",
                 _num(g(base, "yieldToMaturity")))
        set_path(out, "cartera.renta_fija.cupon_medio_pct",
                 _num(g(base, "avgCoupon")))
        set_path(out, "cartera.renta_fija.precio_medio",
                 _num(g(base, "avgPrice")))
        set_path(out, "cartera.renta_fija.fecha",
                 g(fi, "portfolioDate") or g(base, "portfolioDate"))
        set_path(out, "cartera.renta_fija.calidad_media",
                 g(base, "avgCreditQualityName", "avgCreditQuality",
                   "calculatedAverageCreditRating"))
    # tramos de vencimiento: claves variables -> detección por números
    ms = c.get("maturitySchedule") or {}
    base_ms = g(ms, "fund") or ms
    if isinstance(base_ms, dict):
        import re as _re
        etiquetas = ms.get("scheduleLabel") if isinstance(ms, dict) else None
        valores = base_ms.get("schedule")
        if isinstance(etiquetas, list) and isinstance(valores, list) \
                and len(etiquetas) == len(valores):
            pares = list(zip(etiquetas, valores))  # formato sal-service real
        else:
            pares = list(base_ms.items())  # formato plano (compatibilidad)
        for clave, valor in pares:
            v = _num(valor)
            if v is None:
                continue
            nums = _re.findall(r"\d+", str(clave))
            kl = str(clave).lower()
            if len(nums) >= 2:
                tramo = f"{nums[0]}_{nums[1]}"
            elif len(nums) == 1 and ("+" in kl or any(p in kl for p in
                                     ("over", "plus", "more", "above"))):
                tramo = f"mas_{nums[0]}"
            else:
                continue
            set_path(out, f"cartera.renta_fija.vencimientos_pct.{tramo}", v)

    # yield to worst: agregado si viene + distribución por tramos
    ml = c.get("multiLevelFixedIncome") or {}
    set_path(out, "cartera.renta_fija.ytw_pct",
             _num(g(ml, "avgYieldToWorst", "yieldToWorst",
                    "fund.avgYieldToWorst", "superYieldToWorst")))
    niveles = (g(ml, "fund") or g(ml, "rows") or g(ml, "primaryData")
               or g(ml, "data"))
    if isinstance(niveles, list):
        buckets_ytw: dict = {}
        for nivel in niveles:
            if not isinstance(nivel, dict):
                continue
            pdata = nivel.get("primaryData")
            if isinstance(pdata, dict):  # matriz sector x tramo YTW (real)
                for b, v in pdata.items():
                    v = _num(v)
                    if v is None or b == "weight":
                        continue
                    buckets_ytw[b] = buckets_ytw.get(b, 0.0) + v
                continue
            nombre = g(nivel, "name", "label", "bucket", "primary")
            v = _num(g(nivel, "weight", "value", "exposure", "percent"))
            if nombre and v is not None:
                limpio = str(nombre).strip().replace("%", "pct").replace(
                    " ", "_").replace("/", "_")[:30]
                set_path(out,
                         f"cartera.renta_fija.ytw_distribucion_pct.{limpio}", v)
        TRAMOS_YTW = {"Negative": "negativo", "0 to 1%": "0_1",
                      "1 to 3%": "1_3", "3 to 5%": "3_5", "5 to 7%": "5_7",
                      "7 to 10%": "7_10", "10 to 20%": "10_20",
                      "Greater than 20%": "mas_20", "Unknown": "desconocido"}
        for b, v in buckets_ytw.items():
            if b == "Not Applicable":
                continue
            limpio = TRAMOS_YTW.get(b) or str(b).strip().replace(
                "%", "pct").replace(" ", "_").replace("/", "_")[:30]
            set_path(out,
                     f"cartera.renta_fija.ytw_distribucion_pct.{limpio}",
                     round(v, 3))

    cq = c.get("creditQuality") or {}
    base = g(cq, "fund") or cq
    if isinstance(base, dict):
        for rating in ("AAA", "AA", "A", "BBB", "BB", "B"):
            set_path(out, f"cartera.renta_fija.calidad_crediticia_pct.{rating}",
                     _num(g(base, f"creditQuality{rating}", rating.lower())))
        set_path(out, "cartera.renta_fija.calidad_crediticia_pct.inferior_B",
                 _num(g(base, "creditQualityBelowB", "belowB")))
        set_path(out, "cartera.renta_fija.calidad_crediticia_pct.sin_rating",
                 _num(g(base, "creditQualityNotRated", "notRated")))

    # ------------------------------------------------------------------ esg
    esg = c.get("esgData") or {}
    set_path(out, "esg.globos_sostenibilidad",
             g(esg, "sustainabilityRating", "globeRating"))
    set_path(out, "esg.sustainability_score",
             _num(g(esg, "esgScore", "portfolioSustainabilityScore")))
    set_path(out, "esg.esg_risk_corporativo",
             _num(g(esg, "corporateSustainabilityScore", "corporateEsgRisk")))

    # -------------------------------------------------------------- gestión
    pe = c.get("people") or {}
    gestores = []
    for m in (g(pe, "currentManagers", "managerList", "managers") or []):
        gestores.append({
            "nombre": " ".join(x for x in (g(m, "givenName", "firstName"),
                                           g(m, "familyName", "lastName")) if x)
                      or g(m, "name", "displayName"),
            "desde": g(m, "startDate", "managerStartDate"),
            "titulacion": g(m, "designation"),
        })
    if gestores:
        set_path(out, "gestion.gestores", gestores)
    set_path(out, "gestion.tenure_medio_años",
             _num(g(pe, "averageManagerTenure", "avgManagerTenure")))
    ps = c.get("parentSummary") or {}
    set_path(out, "gestion.gestora.nombre", g(ps, "firmName", "companyName"))
    set_path(out, "gestion.gestora.aum_total_meur", _num(g(ps, "totalAssets", "aum")))
    set_path(out, "gestion.gestora.num_fondos", g(ps, "numberOfFunds", "fundCount"))

    # -------------------------------------------------------- distribuciones
    # OJO (01-11-2026): este bloque no escribia nada para NADIE, por tres
    # defectos a la vez, y el historial de repartos es la pieza que hace falta
    # para calcular metricas propias en una clase de reparto. La serie de VL de
    # una clase que reparte baja el dia del pago, y esa caida no es mercado: es
    # dinero que salio al participe. Con la fecha y el importe de cada reparto
    # se reconstruye la serie de retorno total y las metricas salen bien; sin
    # ellos hay que renunciar a calcularlas (`vl_fondos.politica`).
    #
    #  1. La lista viene en `distribution` y aqui se buscaba en
    #     `distributionList`, `distributions` y `annualDistribution`, que no
    #     existen. Forma real del payload:
    #     {"distribution": [...], "baseCurrencyId": "EUR", "template": "..."}.
    #  2. Como importe se tomaba `distributionNAV`. El campo real se llama
    #     `distributionNav` (otra caja) y, sobre todo, NO es el importe: es el
    #     valor liquidativo del dia del reparto. De haber coincidido habria
    #     escrito 244,93 como reparto por participacion donde el reparto fue
    #     4,64. El importe es `total` (= income + plusvalias + devolucion).
    #  3. La fecha se guardaba cruda ('2026-05-01T05:00:00.000'), no en ISO.
    di = c.get("distribution") or {}
    historial = []
    for item in (g(di, "distribution", "distributionList", "distributions",
                   "annualDistribution") or []):
        fecha = _fecha_iso(g(item, "distributionDate", "date", "year"))
        importe = _num(g(item, "total", "amount", "totalDistribution", "income"))
        if fecha is None or importe is None:
            continue
        registro = {"fecha": fecha, "importe_por_participacion": importe}
        # El VL de ese dia se guarda aparte porque con el se reconstruye la
        # serie de retorno total sin tener que volver a buscarlo en la serie.
        vl = _num(g(item, "distributionNav", "distributionNAV"))
        if vl is not None:
            registro["vl_en_la_fecha"] = vl
        renta = _num(g(item, "income"))
        if renta is not None:
            registro["renta"] = renta
        plusvalias = _num(g(item, "capitalGains"))
        if plusvalias is None:
            corto = _num(g(item, "capGainShortTerm")) or 0.0
            largo = _num(g(item, "capGainLongTerm")) or 0.0
            plusvalias = corto + largo if (corto or largo) else None
        if plusvalias is not None:
            registro["plusvalias"] = plusvalias
        historial.append(registro)
    if di:
        # El endpoint RESPONDIO. Una lista vacia significa "el proveedor no
        # tiene ningun reparto registrado para esta clase", que no es lo mismo
        # que no haber preguntado, y es la diferencia entre poder decir que
        # acumula y no saberlo. Sin esta marca las dos cosas se ven iguales.
        set_path(out, "distribuciones.historial_consultado", True)
    if historial:
        historial.sort(key=lambda r: r["fecha"])
        set_path(out, "distribuciones.historial", historial)
        set_path(out, "distribuciones.divisa", g(di, "baseCurrencyId", "currencyId"))

    # ------------------------------------------------------------ estrategia
    st = c.get("investmentStrategy") or {}
    set_path(out, "identificacion.estrategia_inversion_texto",
             g(st, "investmentStrategy", "strategy"))


def _lang(settings: dict) -> str:
    # códigos válidos en mstarpy v10: en-gb, es, fr, de, it, sv, nl, ja, en-eu…
    return {"es": "es"}.get(settings.get("idioma", "es"), "en-gb")
