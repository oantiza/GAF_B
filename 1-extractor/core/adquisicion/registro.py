"""Los adaptadores disponibles y lo que cada uno declara saber dar.

Cada entrada envuelve un fetcher (`fetchers/*.py`) sin cambiar cómo pide:
las URL y parámetros de Morningstar siguen intactos para que la caché de
1,4 GB siga sirviendo. Lo que añade es la declaración: qué rutas del esquema
v2 sabe rellenar, a qué familia de dato pertenece cada una, qué descargas hace
y para qué activos aplica. Con eso `python main.py capacidades --sin X`
responde «si cae X, ¿qué me queda?» antes de que caiga.

Las capacidades se contrastan en pruebas con las rutas que de verdad escriben
los fetchers (tests/test_capacidades.py): una ruta escrita y no declarada
rompe la prueba, para que la declaración no envejezca.
"""
from __future__ import annotations

from core.adquisicion.adaptador import Adaptador, Contexto, Endpoint


def NO_ACCION(isin: str, tipo: str) -> bool:
    return tipo != "accion"


def ES(isin: str, tipo: str) -> bool:
    return isin.upper().startswith("ES") and tipo != "accion"


def ETF_O_ACCION(isin: str, tipo: str) -> bool:
    return tipo in ("etf", "accion")


def NO_FONDO_NI_ACCION(isin: str, tipo: str) -> bool:
    return tipo not in ("fondo", "accion")


# ----------------------------------------------------------------- Morningstar
_MS_IDENTIDAD = {
    "identificacion.nombre": "identidad", "identificacion.divisa_base": "identidad",
    "identificacion.fecha_lanzamiento_clase": "identidad",
    "identificacion.fecha_lanzamiento_fondo": "identidad",
    "identificacion.gestora": "identidad", "identificacion.ticker": "identidad",
    "identificacion.domicilio": "identidad", "identificacion.replicacion": "identidad",
    "identificacion.estrategia_inversion_texto": "identidad",
    "identificacion.ucits": "identidad", "identificacion.indice_benchmark_oficial": "identidad",
    "identificacion.inversion_minima_inicial": "identidad",
    "identificacion.tipo": "identidad", "identificacion.descripcion": "identidad",
    "identificacion.estructura_legal": "identidad",
    "identificacion.estado_comercializacion": "identidad",
    "identificacion.politica_distribucion": "identidad",
    "meta.sec_id_morningstar": "identidad",
    "gestion.*": "identidad", "documentos": "identidad", "documentos.*": "identidad",
}
_MS_ANALITICA = {
    "identificacion.categoria_morningstar": "analitica",
    "identificacion.clase_activo": "analitica",
    "rating.*": "analitica",
    "riesgo.*": "analitica",
    "riesgo.fecha_dato": "analitica", "riesgo.volatilidad_pct.*": "analitica",
    "riesgo.sharpe.*": "analitica", "riesgo.alpha.*": "analitica", "riesgo.beta.*": "analitica",
    "riesgo.r2.*": "analitica", "riesgo.tracking_error_pct.*": "analitica",
    "riesgo.information_ratio.*": "analitica", "riesgo.rf_pct.*": "analitica",
    "riesgo.max_drawdown.*": "analitica", "riesgo.risk_score": "analitica",
    "riesgo.sortino.*": "analitica", "riesgo.captura_alcista_pct.*": "analitica",
    "riesgo.captura_bajista_pct.*": "analitica",
    "costes.ter_vs_categoria.*": "analitica",
    "distribuciones.*": "analitica",
    "rentabilidad.trailing_pct.*.categoria": "analitica",
    "rentabilidad.trailing_pct.*.indice": "analitica",
    "rentabilidad.trailing_pct.*.percentil_categoria": "analitica",
}
_MS_RENDIMIENTO = {
    "rentabilidad.*": "rendimiento",
    "rentabilidad.fecha_dato": "rendimiento",
    "rentabilidad.trailing_pct.*.fondo": "rendimiento",
    "rentabilidad.por_año_natural.*": "rendimiento",
    "rentabilidad.por_año_natural.*.fondo": "rendimiento",
}
_MS_PRECIO = {
    "valoracion.vl": "precio", "valoracion.vl_fecha": "precio", "valoracion.vl_divisa": "precio",
    "valoracion.patrimonio_fondo_meur": "precio", "valoracion.patrimonio_fecha": "precio",
    "valoracion.patrimonio_divisa": "precio", "valoracion.patrimonio_clase_meur": "precio",
    "valoracion.variacion_dia_pct": "precio", "valoracion.min_52sem": "precio",
    "valoracion.max_52sem": "precio", "valoracion.etf_intradia.*": "precio",
}
_MS_COSTES = {
    "costes.ter_pct": "costes", "costes.comision_suscripcion_max_pct": "costes",
    "costes.comision_reembolso_max_pct": "costes",
    "costes.comision_gestion_aplicada_pct": "costes", "costes.comision_gestion_max_pct": "costes",
    "costes.comision_distribucion_pct": "costes", "costes.comision_exito_pct": "costes",
    "costes.mifid_emt_exante.*": "costes",
    # La cifra real (ex post) de Morningstar: se guarda en la ficha y no se publica (decisión 60).
    "costes.mifid_ex_post.*": "costes",
}
_MS_REGULATORIO = {
    "riesgo.sri_kid_1a7": "regulatorio", "riesgo.srri_1a7": "regulatorio",
    "esg.sfdr_articulo": "regulatorio",
}
_MS_ESG = {"esg.*": "esg"}
_MS_CARTERA = {"cartera.*": "cartera"}

MORNINGSTAR_CAPACIDADES = {**_MS_IDENTIDAD, **_MS_ANALITICA, **_MS_RENDIMIENTO,
                           **_MS_PRECIO, **_MS_COSTES, **_MS_REGULATORIO,
                           **_MS_ESG, **_MS_CARTERA}

# Endpoints de lt/sal y familia que sirve cada uno (la lee el fetcher para
# pedir la caché con el TTL adecuado).
MORNINGSTAR_ENDPOINTS = (
    Endpoint("screener", "precio", "ISIN -> SecId + 33 datapoints diarios (1 petición)"),
    Endpoint("MFsnapshot", "cartera", "ficha completa (52 bloques) de fondos"),
    Endpoint("ETFsnapshot", "cartera", "ficha completa de ETF"),
    Endpoint("Mifid", "costes", "costes EMT ex-ante"),
    Endpoint("sustainability", "esg", "ESG y carbono"),
    Endpoint("sal_quote", "analitica", "sal-service quote"),
    Endpoint("sal_investmentFee", "costes", ""), Endpoint("sal_feeLevel", "costes", ""),
    Endpoint("sal_salesFees", "costes", ""),
    Endpoint("sal_trailingReturn", "analitica", "rentabilidades mensuales"),
    Endpoint("sal_riskVolatility", "analitica", ""), Endpoint("sal_maxDrawDown", "analitica", ""),
    Endpoint("sal_allocationMap", "cartera", ""), Endpoint("sal_sector", "cartera", ""),
    Endpoint("sal_regional", "cartera", ""), Endpoint("sal_marketCap", "cartera", ""),
    Endpoint("sal_equityStyle", "cartera", ""), Endpoint("sal_fixedIncomeStyle", "cartera", ""),
    Endpoint("sal_creditQuality", "cartera", ""), Endpoint("sal_maturitySchedule", "cartera", ""),
    Endpoint("sal_multiLevelFixedIncome", "cartera", ""), Endpoint("sal_position", "cartera", ""),
    Endpoint("sal_esgData", "esg", ""), Endpoint("sal_people", "identidad", ""),
    Endpoint("sal_parentSummary", "identidad", ""), Endpoint("sal_distribution", "analitica", ""),
    Endpoint("sal_investmentStrategy", "identidad", ""),
)
SAL_FAMILIA = {e.nombre[4:]: e.familia for e in MORNINGSTAR_ENDPOINTS if e.nombre.startswith("sal_")}
VISTA_FAMILIA = {"MFsnapshot": "cartera", "ETFsnapshot": "cartera", "Mifid": "costes",
                 "sustainability": "esg"}


def _fetch_morningstar_lt(isin: str, ctx: Contexto) -> dict:
    from fetchers import morningstar_lt
    return morningstar_lt.fetch(isin, ctx.http, ctx.settings, force=ctx.force,
                                raw_dir=ctx.base / "cache" / "raw_morningstar_lt")


def _fetch_morningstar(isin: str, ctx: Contexto) -> dict:
    from fetchers import morningstar
    return morningstar.fetch(isin, ctx.http, ctx.settings, force=ctx.force,
                             raw_dir=ctx.base / "cache" / "raw_morningstar")


def _fetch_justetf(isin: str, ctx: Contexto) -> dict:
    from fetchers import justetf
    return justetf.fetch(isin, ctx.http, ctx.settings, force=ctx.force, tipo=ctx.tipo)


def _isins_es(base) -> set[str]:
    """ISIN españoles de fondos.csv: el ZIP de la CNMV se recorre una vez para todos."""
    from core.package_integrity import lee_csv  # de una vez, sin dejarlo abierto (IMP-1)
    ruta = base / "config" / "fondos.csv"
    if not ruta.exists():
        return set()
    return {(r.get("isin") or "").strip().upper() for r in lee_csv(ruta)
            if (r.get("isin") or "").strip().upper().startswith("ES")
            and (r.get("tipo") or "").strip().lower() != "accion"}


def _fetch_cnmv(isin: str, ctx: Contexto) -> dict:
    from fetchers import cnmv
    isins = _isins_es(ctx.base) | {isin.upper()}
    cnmv.asegura_periodos(ctx.http, ctx.base, isins, force=False)
    return cnmv.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base)


def _es_de_la_familia(ctx: Contexto, *marcas: str) -> bool:
    """¿Lleva el instrumento la marca de esta gestora en su nombre? Decisión 53: en la pasada general cada
    instrumento se lee en su emisor y solo en él, sin preguntar a las otras cinco webs por un ISIN que no es
    suyo. Sin ficha anterior no hay nombre, y entonces se pregunta: un alta nueva no se queda sin bloque."""
    anterior = ctx.previo.get("_anterior") or {}
    nombre = str((anterior.get("identificacion") or {}).get("nombre") or "").lower()
    return not nombre or any(m in nombre for m in marcas)


def _fetch_ishares(isin: str, ctx: Contexto) -> dict:
    if not _es_de_la_familia(ctx, "ishares"):
        return {}
    from fetchers import ishares
    return ishares.fetch(isin, ctx.http, ctx.settings, force=ctx.force, previo=ctx.previo)


def _fetch_amundi(isin: str, ctx: Contexto) -> dict:
    if not _es_de_la_familia(ctx, "amundi", "lyxor"):
        return {}
    from fetchers import amundi
    return amundi.fetch(isin, ctx.http, ctx.settings, force=ctx.force, previo=ctx.previo)


def _fetch_xtrackers(isin: str, ctx: Contexto) -> dict:
    if not _es_de_la_familia(ctx, "xtrackers", "x-trackers"):
        return {}
    from fetchers import xtrackers
    return xtrackers.fetch(isin, ctx.http, ctx.settings, force=ctx.force, previo=ctx.previo)


def _fetch_vanguard(isin: str, ctx: Contexto) -> dict:
    if not _es_de_la_familia(ctx, "vanguard"):
        return {}
    from fetchers import vanguard
    return vanguard.fetch(isin, ctx.http, ctx.settings, force=ctx.force, previo=ctx.previo)


def _fetch_spdr(isin: str, ctx: Contexto) -> dict:
    if not _es_de_la_familia(ctx, "spdr", "state street"):
        return {}
    from fetchers import spdr
    return spdr.fetch(isin, ctx.http, ctx.settings, force=ctx.force, previo=ctx.previo)


def _fetch_invesco(isin: str, ctx: Contexto) -> dict:
    if not _es_de_la_familia(ctx, "invesco", "powershares"):
        return {}
    from fetchers import invesco
    return invesco.fetch(isin, ctx.http, ctx.settings, force=ctx.force, previo=ctx.previo)


def _fetch_emt(isin: str, ctx: Contexto) -> dict:
    """Solo los ficheros de los emisores cuya marca lleva el nombre (la regla de la decisión 53): un fondo
    de la CNMV no hace descargar el EMT de BlackRock. Sin ficha anterior se consultan todos."""
    from fetchers import emt
    config = emt.emisores_configurados(ctx.settings)
    suyos = [e for e, c in config.items() if _es_de_la_familia(ctx, *(m.lower() for m in c.get("marcas") or ()))]
    if not suyos:
        return {}
    return emt.fetch(isin, ctx.http, ctx.settings, force=ctx.force, emisores=suyos)


def _fetch_eodhd(isin: str, ctx: Contexto) -> dict:
    from fetchers import eodhd
    # El símbolo ya conocido (corrección o ficha anterior, que llega como pista
    # `_anterior`): sin él, AENA y TSK no se encuentran por ISIN (decisión 6.4).
    # Un ETF solo atiende a la corrección: la ficha anterior congelaría una
    # cotización que el buscador elige por divisa y mercado (`eodhd.listado_de_etf`).
    anterior = ctx.previo.get("_anterior") if ctx.tipo == "accion" else None
    simbolo = eodhd.simbolo_conocido(isin, anterior, ctx.base)
    return eodhd.fetch(isin, ctx.http, ctx.settings, force=ctx.force,
                       tipo=ctx.tipo, base=ctx.base, simbolo_eodhd=simbolo)


MORNINGSTAR_LT = Adaptador(
    id="morningstar_lt",
    descripcion="Morningstar (API interna del sitio, apikey pública): analítica propietaria "
                "y ficha completa. No licenciada; puede cortarse sin aviso (ocurrió el 03-09).",
    oficial=False,
    capacidades=MORNINGSTAR_CAPACIDADES,
    endpoints=MORNINGSTAR_ENDPOINTS,
    fetch=_fetch_morningstar_lt,
    aplica=NO_ACCION,
    orden=20,
)

MORNINGSTAR_MSTARPY = Adaptador(
    id="morningstar",
    descripcion="Morningstar vía mstarpy (sesión de navegador); manual, de contraste.",
    oficial=False,
    capacidades=MORNINGSTAR_CAPACIDADES,
    endpoints=tuple(e for e in MORNINGSTAR_ENDPOINTS if e.nombre.startswith("sal_")),
    fetch=_fetch_morningstar,
    aplica=NO_ACCION,
    orden=21,
)

JUSTETF = Adaptador(
    id="justetf",
    descripcion="justETF: cotización (API interna) y ficha de ETF (scraping de terceros).",
    oficial=False,
    capacidades={
        "valoracion.vl": "precio", "valoracion.vl_fecha": "precio", "valoracion.vl_divisa": "precio",
        "identificacion.tipo": "identidad", "identificacion.nombre": "identidad",
        "identificacion.descripcion": "identidad", "identificacion.indice_benchmark_oficial": "identidad",
        "identificacion.replicacion": "identidad", "identificacion.divisa_base": "identidad",
        "identificacion.politica_distribucion": "identidad",
        "identificacion.fecha_lanzamiento_fondo": "identidad", "identificacion.domicilio": "identidad",
        "costes.ter_pct": "costes", "valoracion.patrimonio_fondo_meur": "precio",
        "cartera.paises_pct": "cartera", "cartera.sectores_pct": "cartera",
        "cartera.posiciones": "cartera", "cartera.peso_top10_pct": "cartera",
    },
    endpoints=(Endpoint("quote", "precio", "cotización"), Endpoint("overview", "cartera", "ficha")),
    fetch=_fetch_justetf,
    aplica=NO_FONDO_NI_ACCION,
    orden=30,
)

CNMV = Adaptador(
    id="cnmv",
    descripcion="CNMV, ficheros oficiales de información individual de IIC (XML mensual y "
                "trimestral): registro, VL fin de mes, patrimonio, partícipes, comisiones "
                "devengadas, TER, vocación y cartera completa. Solo ISIN ES.",
    oficial=True,
    capacidades={
        "meta.cnmv_periodo": "regulatorio", "meta.cnmv_periodo_trimestral": "regulatorio",
        "identificacion.registro_cnmv": "regulatorio", "identificacion.nombre": "identidad",
        "identificacion.nombre_legal_cnmv": "identidad", "identificacion.gestora_legal": "identidad",
        "identificacion.depositario": "identidad", "identificacion.vocacion_cnmv": "regulatorio",
        "identificacion.clase_fondo_cnmv": "regulatorio", "identificacion.es_etf_cnmv": "identidad",
        "identificacion.compartimento_cnmv": "identidad", "identificacion.clase_cnmv": "identidad",
        "identificacion.numero_compartimento_cnmv": "identidad",
        "gestion.gestora.grupo": "identidad",
        "valoracion.cnmv_fin_mes.*": "precio", "valoracion.cnmv_trimestral.*": "regulatorio",
        "valoracion.vl": "precio",
        "valoracion.vl_fecha": "precio", "valoracion.vl_divisa": "precio",
        "valoracion.patrimonio_fondo_meur": "precio",
        "valoracion.participes": "precio",
        "series.cnmv_diaria": "precio",
        "costes.comision_gestion_aplicada_pct": "costes", "costes.comision_deposito_pct": "costes",
        "costes.ter_pct": "costes", "costes.cnmv.*": "regulatorio",
        "cartera.rotacion_pct": "cartera", "cartera.cnmv.*": "regulatorio",
        "cartera.top10_posiciones": "cartera", "cartera.posiciones": "cartera",
        "cartera.peso_top10_pct": "cartera", "cartera.num_posiciones": "cartera",
        "cartera.fecha": "cartera",
        "rentabilidad.cnmv.*": "regulatorio", "riesgo.cnmv.*": "regulatorio",
    },
    endpoints=(Endpoint("zip_mensual", "regulatorio", "ZIP mensual (VL, patrimonio, partícipes)"),
               Endpoint("zip_trimestral", "regulatorio", "ZIP trimestral (comisiones, TER, cartera)")),
    fetch=_fetch_cnmv,
    aplica=ES,
    orden=10,
)

ISHARES = Adaptador(
    id="ishares",
    descripcion="iShares (BlackRock), su fichero de producto sin navegador: VL histórico declarado, "
                "TER, réplica, índice, patrimonio, posiciones y dividendos, todo en el bloque propio "
                "`emisor` y `series.vl_emisor`. Decisión 51. API interna sin documentar. En la pasada general desde la decisión 53.",
    oficial=False,
    capacidades={"emisor.*": "precio", "series.vl_emisor": "precio"},
    endpoints=(Endpoint("busqueda_id", "identidad", "ISIN -> portfolioId"),
               Endpoint("excel_producto", "precio", "XML SpreadsheetML con VL, datos clave y posiciones"),
               Endpoint("pagina_producto", "analitica", "HTML con los dividendos, solo si no acumula")),
    fetch=_fetch_ishares,
    aplica=lambda isin, tipo: tipo == "etf",
    # Detrás de `vl_eodhd` (27): compara su política con la del KID que ese adaptador acaba de escribir.
    orden=40,
    usa=("vl_eodhd",),
)

AMUNDI = Adaptador(
    id="amundi",
    descripcion="Amundi (incluye lo que fue Lyxor), su API de producto sin navegador: VL histórico "
                "declarado, TER, réplica, índice, patrimonio, composición y dividendos, todo en el bloque "
                "propio `emisor` y `series.vl_emisor`. Decisión 51. API interna sin documentar. En la pasada general desde la decisión 53.",
    oficial=False,
    capacidades={"emisor.*": "precio", "series.vl_emisor": "precio"},
    endpoints=(Endpoint("api_producto", "precio", "POST JSON por ISIN con VL, patrimonio, dividendos, "
                                                  "ficha y composición"),),
    fetch=_fetch_amundi,
    aplica=lambda isin, tipo: tipo == "etf",
    orden=41,
    usa=("vl_eodhd",),
)

XTRACKERS = Adaptador(
    id="xtrackers",
    descripcion="Xtrackers (DWS), su web de producto sin navegador: VL histórico declarado y patrimonio "
                "del Excel; TER, réplica, índice, política, dividendos, posiciones y contrapartes de "
                "swap de sus JSON por ISIN, todo en el bloque propio `emisor` y `series.vl_emisor`. "
                "Decisión 51. API interna sin documentar. En la pasada general desde la decisión 53.",
    oficial=False,
    capacidades={"emisor.*": "precio", "series.vl_emisor": "precio"},
    endpoints=(Endpoint("ficha_producto", "precio", "JSON por ISIN con ficha y dividendos"),
               Endpoint("excel_historico", "precio", "XLSX por ISIN con VL y patrimonio diarios"),
               Endpoint("posiciones", "cartera", "JSON por ISIN con posiciones o cesta de sustitución")),
    fetch=_fetch_xtrackers,
    aplica=lambda isin, tipo: tipo == "etf",
    orden=42,
    usa=("vl_eodhd",),
)

VANGUARD = Adaptador(
    id="vanguard",
    descripcion="Vanguard, la API GraphQL de su web sin navegador: VL histórico declarado (desde "
                "noviembre de 2014 como mucho), TER, réplica, índice, política, dividendos, patrimonio "
                "de clase y de fondo y posiciones, todo en el bloque propio `emisor` y "
                "`series.vl_emisor`. Sirve también para sus fondos índice, sin tocar su `riesgo.*`. "
                "Decisión 51. API interna sin documentar. En la pasada general desde la decisión 53.",
    oficial=False,
    capacidades={"emisor.*": "precio", "series.vl_emisor": "precio"},
    endpoints=(Endpoint("ficha_producto", "precio", "GraphQL por id con ficha, patrimonio y dividendos"),
               Endpoint("vl_historico", "precio", "GraphQL por id con el VL diario"),
               Endpoint("posiciones", "cartera", "GraphQL por id con las posiciones, paginado")),
    fetch=_fetch_vanguard,
    aplica=lambda isin, tipo: tipo in ("etf", "fondo"),
    orden=43,
    usa=("vl_eodhd",),
)

SPDR = Adaptador(
    id="spdr",
    descripcion="SPDR (State Street), su catálogo JSON y sus Excel sin navegador: VL histórico declarado, "
                "TER, réplica, índice, política, dividendos, patrimonio y posiciones, todo en el bloque "
                "propio `emisor` y `series.vl_emisor`. Decisión 51. En la pasada general desde la decisión 53.",
    oficial=False,
    capacidades={"emisor.*": "precio", "series.vl_emisor": "precio"},
    endpoints=(Endpoint("ficha_producto", "precio", "Catálogo fundfinder y ficha HTML del ETF"),
               Endpoint("vl_historico", "precio", "XLSX de VL histórico del ETF"),
               Endpoint("posiciones", "cartera", "XLSX de posiciones diarias del ETF"),
               Endpoint("dividendos", "precio", "XLSX común de distribuciones históricas")),
    fetch=_fetch_spdr,
    aplica=lambda isin, tipo: tipo == "etf",
    orden=44,
    usa=("vl_eodhd",),
)

INVESCO = Adaptador(
    id="invesco",
    descripcion="Invesco, su API JSON por ISIN sin navegador: TER, comisión de swap, réplica, índice, política, "
                "patrimonio del subfondo y posiciones, y una serie derivada de su «crecimiento de 10.000», "
                "todo en el bloque propio `emisor` y `series.vl_emisor`. Decisión 51. En la pasada general desde la decisión 53.",
    oficial=False,
    capacidades={"emisor.*": "precio", "series.vl_emisor": "precio"},
    endpoints=(Endpoint("ficha_producto", "analitica", "Ficha JSON de la clase"),
               Endpoint("vl_historico", "precio", "keyStats y crecimiento de 10.000 diario de la clase"),
               Endpoint("posiciones", "cartera", "Posiciones del fondo (holdings/fund)"),
               Endpoint("dividendos", "precio", "Último reparto declarado")),
    fetch=_fetch_invesco,
    aplica=lambda isin, tipo: tipo == "etf",
    orden=45,
    usa=("vl_eodhd",),
)

EMT = Adaptador(
    id="emt",
    descripcion="EMT (European MiFID Template, FinDatEx) de iShares/BlackRock, Vanguard e Invesco: el mercado "
                "objetivo que declara el fabricante (tipo de cliente, conocimiento, capacidad de pérdidas, "
                "objetivos, periodo mínimo recomendado, preferencias ESG y canal), con su fecha y el fichero "
                "del que sale, en el bloque propio `mercado_objetivo`. Un fichero por emisor y pasada, indexado "
                "por ISIN; emisores y URL en `emt_emisores` de settings. Sin costes ni EET. Decisión 58.",
    oficial=False,
    capacidades={"mercado_objetivo.*": "regulatorio"},
    endpoints=(Endpoint("ishares", "regulatorio", "EMT V4 de BlackRock, XLSX de toda la gama"),
               Endpoint("vanguard", "regulatorio", "EMT V4.2 de Vanguard, XLSX de toda la gama"),
               Endpoint("invesco", "regulatorio", "EMT V4.2 de Invesco, CSV de toda la gama")),
    fetch=_fetch_emt,
    aplica=lambda isin, tipo: tipo in ("fondo", "etf"),
    orden=46,
)

EODHD = Adaptador(
    id="eodhd",
    descripcion="EODHD (de pago, licencia personal): identidad de cotización, precio EOD "
                "y métricas de la serie de acciones; listing de ETF. Los fundamentales "
                "de las acciones vienen de Yahoo (gratis, no oficial): los de EODHD se "
                "dieron de baja el 17-10.",
    oficial=False,
    capacidades={
        "identificacion.nombre": "identidad", "identificacion.tipo": "identidad",
        "identificacion.isin": "identidad", "identificacion.ticker": "identidad",
        "identificacion.mercado": "identidad", "identificacion.pais": "identidad",
        "identificacion.divisa_base": "identidad", "identificacion.simbolo_eodhd": "identidad",
        "identificacion.simbolo_yahoo": "identidad", "identificacion.source_listing_id": "identidad", "identificacion.cotizacion_aviso": "identidad",
        "identificacion.sector": "identidad", "identificacion.industria": "identidad",
        "identificacion.descripcion": "identidad",
        "valoracion.*": "precio",
        "rentabilidad.*": "rendimiento", "riesgo.*": "rendimiento",
        "fundamentales.*": "analitica", "cartera.*": "cartera",
    },
    endpoints=(Endpoint("search", "identidad", "ISIN -> símbolo"),
               Endpoint("eod", "precio", "serie EOD ajustada"),
               Endpoint("yahoo", "analitica", "fundamentales de acciones (yfinance)")),
    fetch=_fetch_eodhd,
    aplica=ETF_O_ACCION,
    orden=15,
    implicito=True,
)

def _fetch_vl_fondos(isin: str, ctx: Contexto) -> dict:
    from fetchers import vl_fondos
    return vl_fondos.fetch(isin, ctx.http, ctx.settings, force=ctx.force,
                           base=ctx.base, tipo=ctx.tipo, previo=ctx.previo)


VL_FONDOS = Adaptador(
    id="vl_eodhd",
    descripcion="EODHD (de pago), solo precios: serie diaria del VL de los fondos europeos "
                "por ISIN ({ISIN}.EUFUND) y, calculadas desde ella, rentabilidad, volatilidad, "
                "Sharpe (clases en EUR, contra el €STR) y caída máxima, a cierre de mes y en la "
                "divisa de la clase, solo en clases de acumulación. Fase 0 del plan sin Morningstar "
                "(28-10-2026): desplaza a Morningstar en esas rutas (CONTRASTE). Con la serie de EODHD "
                "parada, la serie sigue con la de valor liquidativo de Morningstar (timeseries_price): "
                "en los fondos de config/serie_de_respaldo.json por su regla (decisión D-9), y en los "
                "demás por empalme si cumplen todas las salvaguardas de la decisión D-10.",
    oficial=False,
    capacidades={
        "valoracion.vl": "precio", "valoracion.vl_fecha": "precio", "valoracion.vl_divisa": "precio",
        "rentabilidad.fecha_dato": "rendimiento",
        "rentabilidad.trailing_pct.*.fondo": "rendimiento",
        "rentabilidad.por_año_natural.*.fondo": "rendimiento",
        "riesgo.fecha_dato": "rendimiento",
        "riesgo.volatilidad_pct.*.fondo": "rendimiento", "riesgo.sharpe.*.fondo": "rendimiento",
        # El Sortino y la caída máxima por ventana entran el 02-11-2026. El contrato de
        # `computed/metrics` declaraba sus ventanas desde el primer día y aquí no las
        # calculaba nadie: figuraban ausentes en los 1.077 instrumentos.
        "riesgo.sortino.*.fondo": "rendimiento",
        "riesgo.max_drawdown_pct.*.fondo": "rendimiento",
        "riesgo.rf_pct.*.fondo": "rendimiento",
        "riesgo.max_drawdown.pct": "rendimiento", "riesgo.max_drawdown.periodo": "rendimiento",
        "riesgo.historial_precios.*": "precio",
        # Contra su indice, cuando el benchmark declarado tiene proxy aprobado en
        # `config/indices.csv`. Van en su PROPIO bloque y no en `riesgo.beta`,
        # donde vive la de Morningstar: dos cifras de la misma magnitud en el
        # mismo campo es como se acaba sin saber cual calculo quien, que es el
        # defecto que toda la base nueva persigue.
        "riesgo.relativas.*": "rendimiento",
        # La evidencia con la que se decidio calcular: sin ella la plataforma no puede publicar.
        "documentos_oficiales.kid_politica": "analitica",
        "documentos_oficiales.kid_politica_cita": "analitica",
        "distribuciones.historial_consultado": "analitica",
    },
    endpoints=(Endpoint("eod", "precio", "serie diaria {ISIN}.EUFUND"),
               Endpoint("morningstar_timeseries", "precio",
                        "serie diaria de VL de Morningstar, solo con la de EODHD parada (D-9)"),
               Endpoint("politica_kid", "analitica", "config/politica_kid.json, con la huella del KID"),
               Endpoint("sal_distribution", "analitica", "respuesta guardada de Morningstar sin repartos"),
               Endpoint("search", "identidad", "divisa de la clase"),
               Endpoint("estr", "rendimiento", "€STR del BCE para el Sharpe")),
    fetch=_fetch_vl_fondos,
    aplica=lambda isin, tipo: tipo in ("fondo", "etf"),
    # DETRAS de Morningstar (20 y 21) a proposito, cambiado el 01-11-2026. Este
    # adaptador decide si la clase acumula o reparte antes de calcular metricas
    # de la serie de VL, y la evidencia mas fuerte de que reparte es el historial
    # de pagos que trae `morningstar_lt`. En el 16 esa evidencia no habia llegado
    # todavia: `previo` solo tenia la ficha anterior, asi que la politica se
    # decidia a una pasada de retraso. Medido ese dia con cinco fondos,
    # DE0008490962 trajo cinco repartos en la misma pasada y aun asi se decidio
    # por el nombre, y se le calcularon metricas recortadas por el reparto.
    # `orden` solo ordena la ejecucion (`planificador.py`); la precedencia de
    # este adaptador sobre Morningstar la declara CONTRASTE por nombre, asi que
    # moverlo no cambia quien manda en el VL ni en las metricas.
    #
    # Y DETRAS de `indice_kid` (26) desde el 07-11-2026, cuando estaba en el 22: la regla de la
    # decision 20 decide si se calculan relativas con lo que el KID dice del indice, y en el 22
    # solo habria visto el bloque de la pasada ANTERIOR. Lo unico que escriben a la vez este
    # adaptador y `kid_gestora` (25), que ahora le precede, es `documentos_oficiales.*` por
    # capacidad, y `kid_politica` solo la escribe este: la prioridad no cambia. Lo que si cambia,
    # y es a mejor, es que la huella del KID con la que se valida `politica_kid.json` es tambien
    # la de esta pasada si la trajo `kid_gestora`.
    orden=27,
    implicito=True,
)

# Rutas en las que un adaptador manda y otro queda solo de contraste: si el
# que manda sirvió dato para el activo (`si_trae`), lo que el desplazado traiga
# en esas rutas sale de la fusión y se guarda en `meta.contraste` para comparar
# (`main.py contraste`). Si no lo sirvió, el desplazado sigue de respaldo y su
# procedencia lo dice. Cada regla se aplica a su bloque entero, no ruta a ruta:
# la rentabilidad a 10 años de Morningstar no se mezcla con la de 1 año propia.
#
# Tres reglas para el VL de EODHD porque no siempre llegan juntas: el VL sale
# en todos los fondos con serie; las métricas, solo en clases de acumulación
# (`fetchers.vl_fondos`); el Sharpe, además, solo en clases en EUR (el €STR).
# En una clase de reparto manda el VL de EODHD y las métricas siguen siendo las
# de Morningstar; en una de acumulación en USD, todo es propio salvo el Sharpe.
CONTRASTE: tuple[dict, ...] = (
    {"manda": "vl_eodhd", "bloque": "vl",
     "si_trae": "valoracion.vl",
     "desplaza": ("morningstar_lt", "morningstar"),
     "rutas": ("valoracion.vl", "valoracion.vl_fecha", "valoracion.vl_divisa")},
    {"manda": "vl_eodhd", "bloque": "metricas",
     "si_trae": "rentabilidad.fecha_dato",
     "desplaza": ("morningstar_lt", "morningstar"),
     # La fecha por ventana (decisión B-74) acompaña a su cifra: si la cifra sale desplazada, su
     # fecha va con ella a `meta.contraste`, y la serie no la escribe (`vl_fondos` aún no la da).
     #
     # La caída por ventana va con la de 3 años, que sale de la misma función en la misma pasada
     # (`_escribe_metricas`). Faltaba, como el Sortino en EXT-14: `riesgo.max_drawdown.*` no casa con
     # `riesgo.max_drawdown_pct.1a.fondo`, y una ficha que la guarda conservaba (`update.parche_serie`)
     # se quedaba con las caídas por ventana de la pasada anterior junto a todo lo demás nuevo (P2-02
     # de la auditoría del 20-11-2026). Ningún adaptador desplazado escribe esa ruta: en la fusión no
     # cambia nada.
     "rutas": ("rentabilidad.fecha_dato", "rentabilidad.trailing_pct.*.fondo",
               "rentabilidad.fecha_dato_por_ventana.*",
               "rentabilidad.por_año_natural.*.fondo", "riesgo.fecha_dato",
               "riesgo.volatilidad_pct.*.fondo", "riesgo.max_drawdown.*",
               "riesgo.max_drawdown_pct.*.fondo")},
    {"manda": "vl_eodhd", "bloque": "sharpe",
     "si_trae": "riesgo.historial_precios.rf_referencia",
     "desplaza": ("morningstar_lt", "morningstar"),
     # El Sortino sale de la misma cuenta que el Sharpe —el mismo exceso sobre el mismo €STR— y va en su
     # bloque (EXT-14, 16-11-2026). Faltaba: cuando la guarda de calidad conservaba una ficha y le ponía
     # las métricas de la serie (`update.parche_serie`), entraba el Sharpe nuevo y se quedaba el Sortino
     # viejo. Se vio al recalcular con la versión 3: 482 fichas con Sharpe de la 3 y Sortino de la 2.
     # Ningún adaptador desplazado escribe esa ruta, así que en la fusión no cambia nada.
     "rutas": ("riesgo.sharpe.*.fondo", "riesgo.sortino.*.fondo", "riesgo.rf_pct.*.fondo")},
)

# ------------------------------------------------------- fuentes oficiales
def _fetch_cnmv_ficha(isin: str, ctx: Contexto) -> dict:
    from fetchers import cnmv_ficha
    return cnmv_ficha.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base,
                            previo=ctx.previo)


def _fetch_cssf(isin: str, ctx: Contexto) -> dict:
    from fetchers import cssf
    return cssf.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base)


def _fetch_esma(isin: str, ctx: Contexto) -> dict:
    from fetchers import esma
    return esma.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base,
                      previo=ctx.previo)


def _fetch_gleif(isin: str, ctx: Contexto) -> dict:
    from fetchers import gleif
    return gleif.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base)


def _fetch_amf_geco(isin: str, ctx: Contexto) -> dict:
    from fetchers import amf_geco
    return amf_geco.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base)


def _pais(isin: str, *paises: str):
    return isin.upper()[:2] in paises


KID_CAPACIDADES = {
    "riesgo.sri_kid_1a7": "regulatorio", "riesgo.kid_periodo_mantenimiento_anos": "regulatorio",
    "costes.kid.*": "regulatorio", "documentos_oficiales.*": "regulatorio",
    "identificacion.productor_kid": "identidad", "identificacion.fecha_lanzamiento_kid": "identidad",
    "esg.sfdr_articulo": "regulatorio",
}

CNMV_FICHA = Adaptador(
    id="cnmv_ficha",
    descripcion="CNMV, ficha oficial del fondo (registro, armonizado/UCITS, gestora, "
                "depositaria) y su KID/PRIIPs en PDF: SRI y composición de costes. "
                "Fecha de emisión del ISIN por la ANCV. Solo ISIN ES.",
    oficial=True,
    capacidades={
        **KID_CAPACIDADES,
        "identificacion.registro_cnmv": "regulatorio", "identificacion.fecha_registro_cnmv": "identidad",
        "identificacion.ucits": "identidad", "identificacion.domicilio": "identidad",
        "identificacion.gestora_legal": "identidad", "identificacion.gestora_registro_cnmv": "identidad",
        "identificacion.depositario": "identidad", "identificacion.fecha_ultimo_folleto": "regulatorio",
        "identificacion.fecha_emision_isin": "identidad", "identificacion.fisn": "identidad",
        "identificacion.cfi": "identidad", "identificacion.fecha_alta_clase_cnmv": "identidad",
        "identificacion.compartimento_cnmv": "identidad", "identificacion.clase_cnmv": "identidad",
    },
    endpoints=(Endpoint("ficha", "regulatorio", "fondo.aspx?isin= (+ vista de compartimentos/clases)"),
               Endpoint("kid", "regulatorio", "PDF del documento de datos fundamentales"),
               Endpoint("ancv", "identidad", "código ISIN (ANCV)")),
    fetch=_fetch_cnmv_ficha,
    aplica=ES,
    orden=11,
    usa=("cnmv",),
)

CSSF = Adaptador(
    id="cssf",
    descripcion="CSSF (Luxemburgo), fichero oficial de identificadores de UCITS: paraguas, "
                "compartimento, clase, divisa y fecha de autorización. Solo ISIN LU.",
    oficial=True,
    capacidades={
        "identificacion.ucits": "identidad", "identificacion.domicilio": "identidad",
        "identificacion.paraguas_legal": "identidad", "identificacion.compartimento_legal": "identidad",
        "identificacion.clase_legal": "identidad", "identificacion.nombre_legal_registro": "identidad",
        "identificacion.nombre": "identidad", "identificacion.divisa_compartimento": "identidad",
        "identificacion.fecha_autorizacion_cssf": "identidad", "meta.cssf_fichero": "identidad",
    },
    endpoints=(Endpoint("identificadores", "regulatorio", "ZIP mensual de la CSSF"),),
    fetch=_fetch_cssf,
    aplica=lambda isin, tipo: _pais(isin, "LU") and tipo != "accion",
    orden=12,
)

ESMA = Adaptador(
    id="esma",
    descripcion="ESMA, registro de comercialización transfronteriza (UCITS/FIA): marco legal, "
                "sociedad gestora, domicilio, estado y países de comercialización. Búsqueda "
                "por nombre legal (CSSF) o por tokens del nombre (Morningstar).",
    oficial=True,
    capacidades={
        "identificacion.ucits": "identidad", "identificacion.marco_legal": "identidad",
        "identificacion.gestora_legal": "identidad", "identificacion.domicilio": "identidad",
        "identificacion.nombre_legal_esma": "identidad", "identificacion.nombre": "identidad",
        "identificacion.estado_registro_esma": "regulatorio",
        "identificacion.comercializado_en_espana": "regulatorio",
        "identificacion.paises_comercializacion": "regulatorio", "meta.esma_coincidencia": "regulatorio",
    },
    endpoints=(Endpoint("cbdif", "regulatorio", "índice Solr esma_registers_funds_cbdif"),),
    fetch=_fetch_esma,
    aplica=NO_ACCION,
    orden=60,
    usa=("cssf", "morningstar_lt"),
)

GLEIF = Adaptador(
    id="gleif",
    descripcion="GLEIF, registro global de LEI (sin clave): LEI, nombre legal, jurisdicción y "
                "sociedad gestora por la relación fund-manager. Cubre ES y FR.",
    oficial=True,
    capacidades={
        "identificacion.lei": "identidad", "identificacion.nombre_legal_lei": "identidad",
        "identificacion.domicilio": "identidad", "identificacion.fecha_constitucion": "identidad",
        "identificacion.estado_lei": "identidad", "identificacion.gestora_legal": "identidad",
        "identificacion.gestora_lei": "identidad",
    },
    endpoints=(Endpoint("lei-record", "identidad", "lei-records?filter[isin]="),
               Endpoint("fund-manager", "identidad", "relación fund-manager")),
    fetch=_fetch_gleif,
    aplica=lambda isin, tipo: _pais(isin, "ES", "FR") and tipo != "accion",
    orden=13,
)

AMF_GECO = Adaptador(
    id="amf_geco",
    descripcion="AMF GECO (Francia), base oficial de OPC: gestora y su LEI, OPCVM/FIA, "
                "depositario, fechas de creación y agrément, clasificación AMF, clase y su "
                "DIC/KID en PDF (SRI y costes). Solo ISIN FR.",
    oficial=True,
    capacidades={
        **KID_CAPACIDADES,
        "identificacion.ucits": "identidad", "identificacion.marco_legal": "identidad",
        "identificacion.domicilio": "identidad", "identificacion.gestora_legal": "identidad",
        "identificacion.gestora_lei": "identidad", "identificacion.lei": "identidad",
        "identificacion.nombre_legal_registro": "identidad", "identificacion.depositario": "identidad",
        "identificacion.fecha_creacion_compartimento": "identidad",
        "identificacion.fecha_autorizacion_amf": "identidad",
        "identificacion.numero_autorizacion_amf": "identidad",
        "identificacion.clasificacion_amf": "regulatorio", "identificacion.forma_juridica": "identidad",
        "identificacion.fecha_lanzamiento_clase": "identidad", "identificacion.clase_legal": "identidad",
        "identificacion.nombre": "identidad",
        "identificacion.divisa_base": "identidad", "identificacion.politica_distribucion": "identidad",
        "meta.geco_id": "identidad", "meta.geco_clase_id": "identidad",
    },
    endpoints=(Endpoint("compartimento", "regulatorio", "getCompartmentsBycriteria por ISIN"),
               Endpoint("clase", "regulatorio", "shareByCmpCodeParPrincp"),
               Endpoint("documentos", "regulatorio", "clases y documentos del compartimento"),
               Endpoint("kid", "regulatorio", "PDF del DIC")),
    fetch=_fetch_amf_geco,
    aplica=lambda isin, tipo: _pais(isin, "FR") and tipo != "accion",
    orden=14,
)

def _fetch_esma_firds(isin: str, ctx: Contexto) -> dict:
    from fetchers import esma_firds
    return esma_firds.fetch(isin, base=ctx.base)


ESMA_FIRDS = Adaptador(
    id="esma_firds",
    descripcion="ESMA FIRDS, referencia oficial MiFIR de todo lo que se negocia en la UE/EEE: "
                "código CFI y el tipo que de él se deduce, LEI del emisor, divisa nominal, "
                "nombre oficial y, por centro (MIC), admisión, primera negociación y baja. Se "
                "lee de un índice local que construye `python main.py firds`: no pide nada por "
                "ISIN y sirve sin red. No escribe el nombre, la divisa ni el tipo del sistema, "
                "sino los suyos al lado.",
    oficial=True,
    capacidades={
        "identificacion.nombre_oficial_firds": "identidad",
        "identificacion.nombre_corto_firds": "identidad",
        "identificacion.cfi": "identidad", "identificacion.cfi_tipo": "identidad",
        "identificacion.divisa_nominal_firds": "identidad",
        "identificacion.lei_emisor": "identidad",
        "identificacion.autoridad_competente_firds": "identidad",
        "identificacion.mercados_ue": "identidad",
        "identificacion.baja_en_todos_firds": "identidad",
        "meta.firds_visto": "identidad",
    },
    endpoints=(Endpoint("fulins", "identidad", "índice local de FULINS + DLTINS (cache/firds)"),),
    fetch=_fetch_esma_firds,
    # A todos los tipos: es una lectura local, y que un «fondo» del sistema figure en FIRDS
    # como fondo cotizado es justo la discrepancia que interesa ver. Detrás de EODHD (15).
    orden=16,
)


def _fetch_kid_gestora(isin: str, ctx: Contexto) -> dict:
    from fetchers import kid_gestora
    return kid_gestora.fetch(isin, ctx.http, ctx.settings, force=ctx.force, base=ctx.base,
                             previo=ctx.previo)


# Ids de las fuentes de `fetchers.kid_gestora.FUENTES` (una prueba los contrasta).
KID_GESTORA_FUENTES = ("dws", "amundi", "jpmorgan", "invesco", "nordea", "candriam",
                       "goldman_sachs", "schroders", "mandg", "deutsche_bank_es",
                       "renta4_allfunds")

KID_GESTORA = Adaptador(
    id="kid_gestora",
    descripcion="KID/PRIIPs de la gestora para fondos no españoles: patrón de URL por ISIN o "
                "por nombre legal de la clase (DWS, Amundi, JPMorgan, Invesco, Nordea, Candriam, "
                "Goldman Sachs, Schroders, M&G) y, de último recurso, dos espejos de "
                "documentación que valen para cualquier gestora: Deutsche Bank España y la ficha "
                "de Renta 4, que sirve el KID de Allfunds. SRI, composición de costes, fecha y "
                "productor del KID.",
    oficial=True,
    capacidades={**KID_CAPACIDADES},
    endpoints=tuple(Endpoint(f, "regulatorio", "PDF del KID") for f in KID_GESTORA_FUENTES),
    fetch=_fetch_kid_gestora,
    aplica=lambda isin, tipo: not isin.upper().startswith("ES") and tipo != "accion",
    orden=25,
    usa=("morningstar_lt", "cssf", "amf_geco"),
)

def _fetch_indice_kid(isin: str, ctx: Contexto) -> dict:
    from fetchers import indice_kid
    return indice_kid.fetch(isin, base=ctx.base, previo=ctx.previo)


INDICE_KID = Adaptador(
    id="indice_kid",
    descripcion="Contraste, sin red, del índice que Morningstar atribuye al fondo con el que "
                "nombra su KID (el de la huella de la ficha, leído de cache/kid/): confirmado "
                "completo, por la marca, compuesto, no confirmado, el KID dice que no tiene "
                "índice, o sin KID; con la frase literal. Solo evidencia: no cambia ni el "
                "índice, ni el proxy, ni ninguna cifra (camino B del paso 2, 07-11-2026).",
    oficial=False,
    capacidades={"identificacion.indice_benchmark_kid.*": "regulatorio"},
    endpoints=(Endpoint("kid_en_cache", "regulatorio",
                        "PDF del KID de la ficha en cache/kid/, comprobado por su huella"),),
    fetch=_fetch_indice_kid,
    aplica=lambda isin, tipo: tipo in ("fondo", "etf"),
    # DETRÁS de los tres que leen el KID (cnmv_ficha 11, amf_geco 14, kid_gestora 25) y de
    # morningstar_lt (20), que trae el índice: así compara el KID y el índice de ESTA pasada.
    # Y DELANTE de las relativas (vl_eodhd, 27), que desde el 07-11-2026 leen este bloque para no
    # calcularlas cuando el KID declara un compuesto o ningún índice (decisión 20). Este adaptador
    # sigue sin tocar ninguna cifra: la decisión la toma `vl_fondos._escribe_relativas`.
    orden=26,
    implicito=True,
    usa=("morningstar_lt", "cnmv_ficha", "amf_geco", "kid_gestora"),
)

# Orden de la lista = orden de ejecución por defecto (se reordena por `orden`).
ADAPTADORES: list[Adaptador] = [CNMV, CNMV_FICHA, CSSF, GLEIF, AMF_GECO, ESMA_FIRDS, EODHD,
                                VL_FONDOS,
                                MORNINGSTAR_LT, MORNINGSTAR_MSTARPY, KID_GESTORA, INDICE_KID, JUSTETF,
                                ISHARES, AMUNDI, XTRACKERS, VANGUARD, SPDR, INVESCO, EMT, ESMA]

# Rutas en las que el dato oficial gana a la analítica comercial aunque la
# prioridad general diga otra cosa: es lo que hace «regulatorio fuera de
# Morningstar» de verdad y no solo de respaldo.
RUTAS_OFICIAL_PRIMERO = ("riesgo.sri_kid_1a7", "identificacion.ucits", "identificacion.domicilio")

# A igual fecha del VL, quién gana la tupla (vl, fecha, divisa) antes que `prioridad_fuentes`, por
# tipo (`core.schema._aplica_frescura`). En un ETF, la plaza de su serie: EODHD escribe el cierre
# del símbolo de `negociacion` en la divisa de esa plaza, que es el precio que se negocia y el de la
# serie con la que se calculan sus métricas. Sin esto ganaba justETF por estar antes en la lista, y
# el 09-11-2026 lo que traía justETF era el VL convertido a EUR (SPY 658,70 EUR frente a 735,29 USD
# de SPY.US del mismo día). Morningstar también queda detrás a igual fecha: en IE00B3VWMM18 ponía 355,75
# EUR el 06-11, y SXRJ.XETRA cerró a 357,00.
# Solo desempata: si otra fuente trae una fecha más reciente, sigue ganando ella. Los fondos no
# tienen entrada: EODHD no les aplica (`ETF_O_ACCION`), y su VL lo resuelven CONTRASTE y la fecha.
DESEMPATE_FRESCURA: dict[str, tuple[str, ...]] = {"etf": ("eodhd",)}


def por_id() -> dict[str, Adaptador]:
    return {a.id: a for a in ADAPTADORES}


def registra(adaptador: Adaptador) -> None:
    """Añade (o sustituye) un adaptador; las fuentes nuevas se registran así."""
    existentes = por_id()
    if adaptador.id in existentes:
        ADAPTADORES[ADAPTADORES.index(existentes[adaptador.id])] = adaptador
    else:
        ADAPTADORES.append(adaptador)
