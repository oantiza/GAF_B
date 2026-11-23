"""
Mappers asset-for-bdb.v1: documento Firestore maestro -> contrato del consumidor (BDB-ACTIVOS).

Funciones PURAS, sin Firestore ni I/O: reciben dicts y devuelven dicts. Testables en local.
Reglas clave: INDEX = benchmark no invertible; STOCK/INDEX sin costes obligatorios;
holdings solo resumen; history excluida (solo años); nunca exponer claves internas.

Verificado contra formas reales de la maestra de BDB, de la que se sembro la base de
siempre (fondo enriquecido FondosDB,
activos de mercado finos con metrics/latest, indice proxy).
"""
import datetime
import re
from typing import Any, Optional

INVESTABLE_TYPES = {"FUND", "ETF", "STOCK"}


def json_safe(value: Any) -> Any:
    """Hace el valor serializable a JSON: Timestamps/fechas de Firestore -> ISO string."""
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _num(v: Any) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _pct_to_dec(v: Any) -> Optional[float]:
    n = _num(v)
    return None if n is None else round(n / 100.0, 6)


def map_instrument_type(root: dict) -> str:
    t = (root.get("asset_type") or "").strip().upper()
    if t in {"FUND", "ETF", "STOCK", "INDEX"}:
        return t
    product = root.get("product") or {}
    pt = (product.get("product_type") or "").lower()
    commercial_type = (product.get("commercial_type") or "").lower()
    vehicle = (product.get("vehicle_complexity") or "").lower()
    traded_product_text = " ".join([t.lower(), pt, commercial_type, vehicle])
    if any(token in traded_product_text for token in ("etf", "etc", "etn", "etp", "exchange traded")):
        return "ETF"
    if "fund" in pt or "fondo" in pt:
        return "FUND"
    return "FUND" if root.get("fund_profile") else "UNKNOWN"


def map_economic_asset_class(root: dict) -> str:
    clase = _clase_declarada(root)
    # La base vieja no distingue estas dos y su categoria si: tiene a un fondo de convertibles como
    # renta fija y a uno de materias primas como «otros». Asi las dos bases dicen lo mismo (decision 13).
    categoria = (map_category(root) or "").lower()
    if clase == "FIXED_INCOME" and "convertible" in categoria:
        return "MIXED"
    if clase == "OTHER" and ("commodit" in categoria or "materias primas" in categoria):
        return "COMMODITIES"
    return clase


def _clase_declarada(root: dict) -> str:
    cl = root.get("classification") or {}
    fdt = (cl.get("fondosdb_asset_type") or "").strip().lower()
    fdt_map = {
        "equity": "EQUITY", "fixed_income": "FIXED_INCOME", "bond": "FIXED_INCOME",
        "money_market": "MONEY_MARKET", "monetary": "MONEY_MARKET",
        "allocation": "MIXED", "mixed": "MIXED", "balanced": "MIXED",
        "alternative": "ALTERNATIVE", "alternatives": "ALTERNATIVE", "real_asset": "REAL_ASSET",
        "other": "OTHER", "otros": "OTHER",
    }
    if fdt in fdt_map:
        return fdt_map[fdt]
    raw = (cl.get("asset_class") or "").strip().upper()
    # La base nueva nombra las clases de otra forma: ALLOCATION, CAPITAL_PRESERVATION, HYBRID (los
    # convertibles) y REAL_ASSETS, que son oro y materias primas y nunca «Inmobiliario» (decision 13).
    raw_map = {
        "RV": "EQUITY", "EQUITY": "EQUITY",
        "RF": "FIXED_INCOME", "FIXED_INCOME": "FIXED_INCOME", "BOND": "FIXED_INCOME",
        "MONETARIO": "MONEY_MARKET", "MONEY_MARKET": "MONEY_MARKET", "CAPITAL_PRESERVATION": "MONEY_MARKET",
        "MIXTO": "MIXED", "MIXED": "MIXED", "ALLOCATION": "MIXED", "HYBRID": "MIXED",
        "ALTERNATIVOS": "ALTERNATIVE", "ALTERNATIVE": "ALTERNATIVE",
        "INMOBILIARIO": "REAL_ASSET", "REAL_ASSET": "REAL_ASSET",
        "REAL_ASSETS": "COMMODITIES",
        "OTROS": "OTHER", "OTHER": "OTHER",
    }
    if raw in raw_map:
        return raw_map[raw]
    if map_instrument_type(root) == "STOCK":
        return "EQUITY"
    return "UNKNOWN"


def get_currency(root: dict) -> str:
    ident = root.get("identity") or {}
    cur = ident.get("currency")
    if not cur:
        c = root.get("currency")
        if isinstance(c, dict):
            cur = c.get("base_currency")
        elif isinstance(c, str):
            cur = c
    return cur or "EUR"


def map_category(root: dict) -> Optional[str]:
    cl = root.get("classification") or {}
    product = root.get("product") or {}
    candidates = [cl.get("category"), cl.get("morningstar_category"),
                  cl.get("global_category"), root.get("category"),
                  product.get("commercial_type")]
    for v in candidates:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


_REGION_LABELS = {
    "united_states": "EE.UU.", "us": "EE.UU.", "usa": "EE.UU.", "north_america": "Norteamérica",
    "canada": "Canadá",
    "eurozone": "Eurozona", "europe": "Europa", "europe_developed": "Europa",
    "europe_ex_euro": "Europa ex-euro", "europe_emerging": "Europa emergente",
    "united_kingdom": "Reino Unido", "uk": "Reino Unido",
    "japan": "Japón", "asia": "Asia", "asia_developed": "Asia desarrollada",
    "asia_ex_japan": "Asia ex-Japón", "asia_emerging": "Asia emergente",
    "australasia": "Australasia", "latin_america": "Latinoamérica",
    "middle_east": "Oriente Medio", "africa": "África",
    "global": "Global", "world": "Global", "emerging_markets": "Emergentes", "other": "Otros",
}


def _region_label(value) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    key = value.strip()
    return _REGION_LABELS.get(key.lower(), key)


def _region_de_la_categoria(root: dict) -> Optional[str]:
    """«Global» cuando la categoria lo dice, y «Emergentes» si es de emergentes de todo el mundo."""
    categoria = (map_category(root) or "").lower()
    if not re.search(r"\b(global|world|mundial)\b", categoria):
        return None
    return "Emergentes" if re.search(r"emerging|emergente", categoria) else "Global"


# Las zonas de Asia con su nombre: las trae la forma nueva del extractor, sin el total «asia» de la antigua (decision 7).
_ZONAS_DE_ASIA = ("japan", "australasia", "asia_developed", "asia_emerging")


def map_region(root: dict) -> Optional[str]:
    """La region de un activo.

    La que declare, si declara una. Si no, y es la regla que propuso Claude y Oscar puede vetar (decision
    13): **Global si su categoria lo dice, salvo los emergentes globales, que son Emergentes; si no, la
    region dominante de su renta variable, sin contar «Otras»; sin reparto, sin region.** La medida contra
    la base vieja esta en DECISIONES_AUDITORIA_2026-11-04.md.

    Va por delante de la dominante porque iShares MSCI World tiene un 73 % en EE. UU. y no es un fondo
    de EE. UU. «Otras» no cuenta: es un cajon, no un sitio (decision 7). Un empate se resuelve por la
    clave y no por el orden en que llegue el documento: la misma raiz da siempre la misma region.

    Lee las dos formas del dato igual: sin el total de Asia, sus zonas se suman. Si no, un fondo con 35 %
    en EE. UU. y 50 % repartido entre tres zonas de Asia cambiaria de region solo por subir otra pasada.
    """
    cl = root.get("classification") or {}
    for v in (cl.get("region_primary"), cl.get("region"), root.get("region"),
              (root.get("identity") or {}).get("region"),
              (root.get("geography") or {}).get("region")):
        label = _region_label(v)
        if label:
            return label
    de_la_categoria = _region_de_la_categoria(root)
    if de_la_categoria:
        return de_la_categoria
    er = (root.get("portfolio_exposure") or {}).get("equity_regions")
    if isinstance(er, dict) and er:
        nums = {k: _num(v) for k, v in er.items() if k != "other"}
        nums = {k: v for k, v in nums.items() if v is not None and v > 0}
        if "asia" not in nums:
            de_asia = [nums.pop(k) for k in _ZONAS_DE_ASIA if k in nums]
            if de_asia:
                nums["asia"] = sum(de_asia)
        if nums:
            return _region_label(max(sorted(nums), key=nums.get))
    return None


def map_sector(root: dict) -> Optional[str]:
    """El sector de una accion, tal como lo trae la fuente. Un fondo no tiene uno: tiene un reparto.

    La base nueva lo deja en `classification.sector`, y la vieja en `fundamentals`. Si la vieja no lo
    tiene ahi pero su reparto es de un solo sector, ese es.
    """
    if map_instrument_type(root) != "STOCK":
        return None
    cl = root.get("classification") or {}
    fundamentales = root.get("fundamentals") if isinstance(root.get("fundamentals"), dict) else {}
    perfil = fundamentales.get("profile") if isinstance(fundamentales.get("profile"), dict) else {}
    for valor in (cl.get("sector"), perfil.get("sector"), fundamentales.get("sector")):
        if isinstance(valor, str) and valor.strip():
            return valor.strip()
    reparto = _frac_map((root.get("portfolio_exposure") or {}).get("sectors"))
    return next(iter(reparto)) if len(reparto) == 1 else None


FUENTE_KID = "KID"
FUENTE_PROVEEDOR = "PROVIDER"
# El mayor coste de operacion que da un KID leido bien es 2,23 %. Por encima, en la base vieja, solo
# hay lecturas malas guardadas: 9 %, 20 % y 82 %.
_OPERACION_CREIBLE_PCT = 5.0


def _manda_el_kid_en_la_base_vieja(c: dict) -> dict:
    """Decision 43 de Oscar: manda el KID, con su fecha, y donde no lo haya, el proveedor. Cifra a cifra.

    La base nueva ya lo trae decidido. La vieja guarda las dos cosas sueltas y es una copia que no se
    rehace, con lo que se leyo antes de arreglar `core/kid.py`: por eso aqui se desconfia de lo que se
    sabe que salio mal. Ningun fondo cuesta cero (Santalucia). Un coste de operacion disparatado no se
    cree. Y un 0 % de entrada no se distingue de la mala lectura de «492 EUR» (PIMCO), asi que no se
    afirma: esa cifra falta. Del proveedor esta base solo guarda el coste corriente.
    """
    salida = {"management_fee_pct": c.get("management_fee_pct")}
    kid = c.get("kid_evidence") if isinstance(c.get("kid_evidence"), dict) else {}
    hay_documento = bool(kid.get("url") and kid.get("sha256"))
    if hay_documento:
        salida["document_url"] = kid["url"]
        if kid.get("date"):
            salida["document_date"] = kid["date"]
    corriente = _num(c.get("ongoing_costs_kid_pct")) if hay_documento else None
    if corriente is not None and corriente > 0:
        salida.update(ter_pct=corriente, ongoing_charge_source=FUENTE_KID)
    else:
        proveedor = c.get("ter_pct") if c.get("ter_pct") is not None else c.get("mifid_ongoing_pct")
        if _num(proveedor) is not None:
            salida.update(ter_pct=proveedor, ongoing_charge_source=FUENTE_PROVEEDOR)
    operacion = _num(c.get("transaction_costs_pct")) if hay_documento else None
    if operacion is not None and 0 <= operacion <= _OPERACION_CREIBLE_PCT:
        salida.update(transaction_costs_pct=operacion, transaction_costs_source=FUENTE_KID)
    entrada = _num(c.get("entry_fee_max_pct")) if hay_documento else None
    if entrada is not None and entrada > 0:
        salida.update(entry_fee_max_pct=entrada, entry_charge_source=FUENTE_KID)
    return salida


def map_costs(root: dict) -> Optional[dict]:
    # Solo fondos/ETF enriquecidos traen costes; en % -> se normaliza a decimal (1.73% -> 0.0173)
    c = root.get("costs") or {}
    if "ongoing_charge_source" not in c:
        c = _manda_el_kid_en_la_base_vieja(c)
    ter = _pct_to_dec(c.get("ter_pct"))
    mgmt = _pct_to_dec(c.get("management_fee_pct"))
    if ter is None and mgmt is None:
        return None
    out = {}
    if ter is not None:
        out["ongoing_charge"] = ter
    if mgmt is not None:
        out["management_fee"] = mgmt
    # Operacion y entrada no se calculan aqui ni se suman a nada: pasan con su fuente, y la fecha del KID con ellas.
    # Sin el redondeo de `_pct_to_dec`, a seis decimales: la operación de un ETF es de milésimas de punto (iShares, 0,00263 %).
    for destino, origen in (("transaction_costs", "transaction_costs_pct"), ("entry_charge", "entry_fee_max_pct")):
        valor = _num(c.get(origen))
        if valor is not None:
            out[destino] = round(valor / 100.0, 10)
    for clave in ("document_url", "document_date", "ongoing_charge_source", "transaction_costs_source", "entry_charge_source"):
        if isinstance(c.get(clave), str):
            out[clave] = c[clave]
    return out


def _fund_period(node: Any, period: str) -> Optional[float]:
    if not isinstance(node, dict):
        return None
    p = node.get(period)
    if isinstance(p, dict):
        return _num(p.get("fondo"))
    return _num(p)


def _fund_period_any(node: Any, *periods: str) -> Optional[float]:
    for period in periods:
        value = _fund_period(node, period)
        if value is not None:
            return value
    return None


def _vol_bucket_score(vol_dec: Optional[float]) -> Optional[int]:
    if vol_dec is None:
        return None
    pct = vol_dec * 100.0
    bands = [(2, 1), (5, 2), (10, 3), (15, 4), (25, 5), (35, 6)]
    for hi, score in bands:
        if pct <= hi:
            return score
    return 7


def _project_window(m: dict, label: str, node: Any) -> None:
    if not isinstance(node, dict):
        return
    suffix = label.replace("y", "y")
    ret = _num(node.get("annualized_return"))
    vol = _num(node.get("annualized_volatility"))
    sharpe = _num(node.get("sharpe_ratio"))
    if ret is not None:
        m[f"annualized_return_{suffix}"] = round(ret, 6)
    if vol is not None:
        m[f"volatility_{suffix}"] = round(vol, 6)
    if sharpe is not None:
        m[f"sharpe_{suffix}"] = round(sharpe, 4)


def _uniform_window_label(windows: dict, key: str):
    """Etiqueta comun a todas las ventanas, o None si no la hay o discrepan.

    metrics.v1.2 declara `method` y `frequency` por ventana, pero en la practica
    un activo se mide entero de la misma forma. Se proyecta un solo valor por
    documento: es lo que necesita el comparador para avisar de que dos cifras de
    la misma columna no son comparables. Si discrepan, no se declara nada: mejor
    sin etiqueta que con una que no cubre todas las ventanas.
    """
    valores = {
        node.get(key)
        for node in windows.values()
        if isinstance(node, dict) and any(
            node.get(metric) is not None for metric in ("annualized_return", "annualized_volatility", "sharpe_ratio")
        )
    }
    return valores.pop() if len(valores) == 1 else None


# Un activo con cifras nuestras y, en las ventanas a las que nuestra serie no llega, las del proveedor (decision 110): no es ni un metodo ni el
# otro, y sin nombre el informe diria que no consta de donde salen.
METODO_PROPIO_Y_DEL_PROVEEDOR = "PROPIA_Y_PROVEEDOR"


def _metodo_de_las_ventanas(windows: dict):
    metodo = _uniform_window_label(windows, "method")
    if metodo:
        return metodo
    valores = {
        node.get("method")
        for node in windows.values()
        if isinstance(node, dict) and any(
            node.get(metric) is not None for metric in ("annualized_return", "annualized_volatility", "sharpe_ratio")
        )
    }
    return METODO_PROPIO_Y_DEL_PROVEEDOR if len(valores) == 2 and "TRAILING_PROVIDER" in valores and None not in valores else None


def _rotulos_por_ventana(windows: dict) -> dict:
    """El metodo y la frecuencia de cada ventana con cifras. Un activo mezclado no tiene uno solo, y lo que lee una ventana necesita el de esa."""
    return {
        ventana: {clave: nodo[campo] for clave, campo in (("method", "method"), ("frequency", "frequency")) if nodo.get(campo)}
        for ventana, nodo in windows.items()
        if isinstance(nodo, dict) and any(nodo.get(metrica) is not None for metrica in ("annualized_return", "annualized_volatility", "sharpe_ratio"))
    }


def _map_metrics_latest(metrics_latest: dict) -> dict:
    m = {
        "source": "METRICS_LATEST",
        "metrics_source": metrics_latest.get("source") or "METRICS_LATEST",
    }
    windows = metrics_latest.get("windows") or {}
    metodo = _metodo_de_las_ventanas(windows)
    frecuencia = _uniform_window_label(windows, "frequency")
    if metodo:
        m["metrics_method"] = metodo
    if frecuencia:
        m["metrics_frequency"] = frecuencia
    if metodo == METODO_PROPIO_Y_DEL_PROVEEDOR:
        m["metrics_by_window"] = _rotulos_por_ventana(windows)
    for label in ("1y", "3y", "5y", "10y"):
        _project_window(m, label, windows.get(label))
    ytd = _num(metrics_latest.get("ytd_return"))
    if ytd is not None:
        m["ytd_return"] = round(ytd, 6)
    mdd5 = _num(metrics_latest.get("max_drawdown_5y"))
    if mdd5 is not None:
        m["max_drawdown_5y"] = round(mdd5, 6)
    mddh = metrics_latest.get("max_drawdown_hist")
    if isinstance(mddh, dict):
        value = _num(mddh.get("value"))
        if value is not None:
            m["max_drawdown_hist"] = round(value, 6)
        if mddh.get("date"):
            m["max_drawdown_hist_date"] = str(mddh.get("date"))
    srri = _num(metrics_latest.get("srri"))
    risk_source = metrics_latest.get("risk_score_source")
    if srri is not None:
        m["risk_score"] = int(srri)
    elif risk_source == "VOL_BUCKET":
        m["risk_score"] = _vol_bucket_score(m.get("volatility_3y") or m.get("volatility_5y") or m.get("volatility_1y"))
    if risk_source:
        m["risk_score_source"] = str(risk_source)
    m = {k: v for k, v in m.items() if v is not None}
    # Hallazgo 16: de cuando son las cifras y que miden, con los nombres de la tarjeta. Solo si hay alguna cifra con periodo que lo
    # necesite: una fecha de corte o una base de rentabilidad sin cifras debajo no describen nada. El nivel de riesgo no cuenta,
    # porque sale de un documento y no de la serie.
    if any(clave not in _ROTULOS_DE_LAS_METRICAS and clave != "risk_score" for clave in m):
        for clave, valor in (metrics_latest.get("context") or {}).items():
            if clave in CONTEXTO_DE_LAS_METRICAS and valor is not None:
                m[clave] = valor
    return m


def _map_root_fallback(root: dict) -> dict:
    risk = root.get("risk") or {}
    perf = (root.get("performance") or {}).get("returns") or {}
    # Cifras trailing de Morningstar leidas de la raiz: ni las calculamos
    # nosotros ni sabemos sobre que frecuencia las midio el proveedor.
    m = {"source": "FUND_ROOT_FALLBACK", "metrics_source": "FUND_ROOT_FALLBACK",
         "metrics_method": "TRAILING_PROVIDER", "metrics_frequency": "PROVIDER"}
    trailing = perf.get("trailing_pct")
    for label, period, ret_key in (
        ("1y", "1a", "1a"),
        ("3y", "3a", "3a_anualizada"),
        ("5y", "5a", "5a_anualizada"),
    ):
        ret = _pct_to_dec(_fund_period(trailing, ret_key))
        vol = _pct_to_dec(_fund_period(risk.get("volatilidad_pct"), period))
        sharpe = _fund_period(risk.get("sharpe"), period)
        if ret is not None:
            m[f"annualized_return_{label}"] = ret
        if vol is not None:
            m[f"volatility_{label}"] = vol
        if sharpe is not None:
            m[f"sharpe_{label}"] = round(sharpe, 4)
    ret10 = _pct_to_dec(_fund_period(trailing, "10a_anualizada"))
    if ret10 is not None:
        m["annualized_return_10y"] = ret10
    ytd = _pct_to_dec(_fund_period(trailing, "ytd"))
    if ytd is not None:
        m["ytd_return"] = ytd
    rs = risk.get("srri_1a7") or risk.get("sri_kid_1a7")
    if rs is not None:
        m["risk_score"] = int(rs)
        m["risk_score_source"] = "SRRI" if risk.get("srri_1a7") is not None else "SRI_KID"
    mdd = risk.get("max_drawdown")
    if isinstance(mdd, dict) and mdd.get("periodo") == "5a":
        pct = _num(mdd.get("pct"))
        if pct is not None:
            m["max_drawdown_5y"] = round(pct / 100.0, 6)
    mdd_h = risk.get("max_drawdown_hist")
    if isinstance(mdd_h, dict):
        hpct = _num(mdd_h.get("pct"))
        if hpct is not None:
            m["max_drawdown_hist"] = round(hpct / 100.0, 6)
        hfecha = mdd_h.get("fecha")
        if hfecha:
            m["max_drawdown_hist_date"] = str(hfecha)
    # Hallazgo 18: el metodo se declara solo si hay alguna cifra suya debajo. En la base nueva la raiz no trae ninguna, y un fondo
    # con politica de historial y sin cifras salia con «del proveedor, por su metodo» y con cobertura completa.
    if not any(clave.startswith(_CIFRAS_CON_METODO) for clave in m):
        m.pop("metrics_method", None)
        m.pop("metrics_frequency", None)
    return m


_ANIOS_DE_LA_VENTANA = {"1y": 1, "3y": 3, "5y": 5, "10y": 10}
# Lo que la tarjeta dice de sus metricas y viaja con ellas (hallazgo 16). Los mismos nombres que `read/card.metrics`; `provider`
# lleva solo las fechas del bloque del proveedor, para las ventanas que son suyas.
CONTEXTO_DE_LAS_METRICAS = ("as_of", "returns_as_of", "returns_as_of_by_window", "return_basis", "series_class",
                            "distribution_policy", "windows_out_of_range", "provider")
# Lo que dice una lectura de metricas sin ser una cifra. Se cuenta igual en todas partes: la cobertura, las marcas de calidad, el
# resumen y la vista previa (hallazgo 18).
_ROTULOS_DE_LAS_METRICAS = ("source", "metrics_source", "risk_score_source", "metrics_method", "metrics_frequency",
                            "metrics_by_window", *CONTEXTO_DE_LAS_METRICAS)
# Las cifras que salen de un metodo: rentabilidades, volatilidades, Sharpe y caidas. El nivel de riesgo no, que es de un documento.
_CIFRAS_CON_METODO = ("annualized_return_", "volatility_", "sharpe_", "ytd_return", "max_drawdown")
# Lo que dice la vista previa cuando no hay ni metricas ni origen: que no hay dato. Hasta el 15-11-2026 decia `MOCK_PROXY`, que es
# «dato de prueba», en los instrumentos sin metricas de la base nueva (hallazgo 18).
CALIDAD_NO_DISPONIBLE = "NOT_AVAILABLE"
# Las metricas de un instrumento que no tiene ninguna: el origen, vacio. El contrato lo pide presente, y vacio es lo cierto.
SIN_METRICAS = {"source": None, "metrics_source": None}
# Las politicas sin fecha cuya revision no recorta nada, y por eso la serie vale entera.
_REVISADA_SIN_CORTE = {"TOTAL_RETURN_RECONCILED", "PREDECESSOR_CONTINUITY_DOCUMENTED"}


def _anios_antes(fecha: datetime.date, anios: int) -> datetime.date:
    """La misma fecha, tantos anios antes: el 31-10-2026 a 10 anios es el 31-10-2016. Un 29 de febrero cae en el 28."""
    try:
        return fecha.replace(year=fecha.year - anios)
    except ValueError:
        return fecha.replace(year=fecha.year - anios, day=28)


def _cifras_que_cubre_la_politica(metrics_latest: dict, politica: dict) -> Optional[dict]:
    """Regla por periodo (decision 73): una cifra sale si su periodo empieza en o despues de la fecha desde la que la serie vale.

    Un 3 anios no depende de lo que paso antes de 2018; un 10 anios, si. Lee las cifras de `metrics_latest` y deja fuera las
    ventanas que tocan lo que la politica recorta, y con ellas lo que mide el mismo periodo. El nivel de riesgo no tiene
    periodo: sale del KID o de la ficha, y se queda.

    - Con `usable_from` y sin fecha de cierre no se sabe donde empieza ningun periodo, y no sale ninguno.
    - Sin `usable_from` solo entra quien tiene una revision que no recorta nada (`_REVISADA_SIN_CORTE`). Una politica de otra
      forma no entra sola: el precio congelado de NH dice hasta cuando vale su serie, no desde cuando, y por eso devuelve None.
    - Una caida a 5 anios sin cifra a 5 anios no sale: esa ventana no la cubre la serie (AB American Growth tiene un hueco
      de 1.512 dias, de 2018 a 2022, y su «5 anios» solo mide desde el final del hueco).
    """
    if politica.get("frozen_price") or politica.get("excluded_dates"):
        return None
    desde = politica.get("usable_from")
    if not desde and not (_REVISADA_SIN_CORTE & set(politica.get("flags") or [])):
        return None
    cierre = _iso_day(metrics_latest.get("last_date"))

    def vale_desde(inicio: Optional[datetime.date]) -> bool:
        return not desde or (inicio is not None and inicio.isoformat() >= desde)

    ventanas = {
        ventana: nodo
        for ventana, nodo in (metrics_latest.get("windows") or {}).items()
        if ventana in _ANIOS_DE_LA_VENTANA and vale_desde(cierre and _anios_antes(cierre, _ANIOS_DE_LA_VENTANA[ventana]))
    }
    cubiertas = {**metrics_latest, "windows": ventanas}
    if "5y" not in ventanas:
        cubiertas.pop("max_drawdown_5y", None)
    if desde:
        # La historica mide desde el primer punto de la serie, que es justo lo que se recorta.
        cubiertas.pop("max_drawdown_hist", None)
    if not vale_desde(cierre and datetime.date(cierre.year - 1, 12, 31)):
        cubiertas.pop("ytd_return", None)
    return cubiertas


def map_quant_metrics(root: dict, metrics_latest: Optional[dict]) -> dict:
    from fund_history_quality import policy_for, METRICS_SOURCE
    policy = policy_for(root.get("asset_id"))
    if policy and (policy.get("blocked") or not metrics_latest or metrics_latest.get("source") != METRICS_SOURCE):
        fallback = _map_root_fallback(root)
        for field in ("max_drawdown_5y", "max_drawdown_hist", "max_drawdown_hist_date"):
            fallback.pop(field, None)
        mapped = fallback
        # La base nueva no lleva cifras en la raiz, y su tarjeta firma COMPUTED o PROVIDER: sin esto, 74 fondos perdian todas las
        # suyas en esta lectura y las conservaban en la ficha. Donde la raiz si las trae, como en la base vieja, siguen mandando.
        if not policy.get("blocked") and metrics_latest and all(clave in _ROTULOS_DE_LAS_METRICAS for clave in fallback):
            cubiertas = _cifras_que_cubre_la_politica(metrics_latest, policy)
            if cubiertas is not None:
                mapped = _map_metrics_latest(cubiertas)
    elif metrics_latest:
        mapped = _map_metrics_latest(metrics_latest)
    else:
        risk = root.get("risk") or {}
        mapped = (_map_root_fallback(root) if isinstance(risk, dict) and any(
            key in risk for key in ("volatilidad_pct", "sharpe", "srri_1a7", "sri_kid_1a7")
        ) else dict(SIN_METRICAS))
    # Hallazgo 18 (15-11-2026): sin ninguna cifra no hay origen que declarar. Antes salia `MOCK` («dato de prueba») cuando no habia
    # metricas, y el nombre de la via de respaldo cuando la via no daba ninguna: las dos cosas dicen que hay algo, y no lo hay.
    if not any(clave not in _ROTULOS_DE_LAS_METRICAS for clave in mapped):
        mapped = dict(SIN_METRICAS)
    # A reviewed share-class PRIIPs indicator takes precedence over legacy
    # UCITS SRRI and a volatility proxy, independently of performance source.
    risk = root.get("risk") or {}
    evidence = risk.get("sri_kid_evidence") or {}
    value = risk.get("sri_kid_1a7")
    if (root.get("asset_type") == "FUND" and isinstance(evidence, dict)
            and type(value) is int and 1 <= value <= 7
            and evidence.get("sri") == value
            and evidence.get("verified_isin") == root.get("asset_id")
            and evidence.get("document_type") == "PRIIPS_KID"
            and evidence.get("date") and evidence.get("url")
            and evidence.get("sha256") and evidence.get("verified_at")):
        mapped.update(risk_score=value, risk_score_source="SRI_KID")
    return mapped


# A-203 (Oscar, 21-11-2026): un fondo que no declara su reparto de activos no tiene reparto. Hasta ese dia se le ponia el
# tipico de su clase (`CLASSIFICATION_FALLBACK`: un fondo de renta fija, 100 % renta fija; un mixto, 100 % «otros»), y la
# exposicion de la cartera lo sumaba como si fuera suyo. Ahora va la marca `NOT_AVAILABLE`: la aplicacion no lo reparte,
# dice cuanto peso se queda sin reparto y escribe «Falta el dato». Lo mismo una posicion sin clase conocida: «Sin
# clasificar» no es «Otros» (A-202). La inversion directa —una accion, un bono, el ETC de oro— si cuenta por su clase,
# porque su clase es lo que es.
#
# El contrato de lectura (`asset-for-bdb.v1`, de la plataforma) pide las seis clases como numero: van a cero, y lo que dice que no
# son un reparto es `source`. Quien lea el reparto mira `source` antes que las cifras; la aplicacion lo hace en `assetPmsShares`.
SIN_REPARTO = "NOT_AVAILABLE"
_SIN_REPARTO_EN_EL_CONTRATO = {"equity": 0.0, "fixed_income": 0.0, "cash": 0.0, "alternative": 0.0, "real_asset": 0.0, "other": 0.0,
                               "source": SIN_REPARTO}


def _es_un_fondo(root: dict) -> bool:
    """Fondo o ETF: un vehiculo con cartera dentro, cuyo reparto solo lo sabe quien lo declara. Un ETC o un ETN no lo son."""
    if map_instrument_type(root) not in ("FUND", "ETF"):
        return False
    producto = root.get("product") or {}
    texto = " ".join(str(producto.get(clave) or "") for clave in ("product_type", "commercial_type")).upper().split()
    return not any(palabra in ("ETC", "ETN") for palabra in texto)


def map_pms_exposure(root: dict, econ_class: str) -> dict:
    """El reparto por clase del activo, tal como lo guarda la base.

    Es el reparto NETO del proveedor y suma 1, con su signo (C-29, Oscar, 21-11-2026): una clase puede ser negativa (un corto,
    liquidez prestada) o pasar de 1 (apalancamiento), de -5 a 6 en la base nueva. Aqui pasa tal cual, sin recortar a 0-1: la
    suma ponderada de una cartera sigue siendo correcta con negativos, y recortar uno dejaria las demas sumando de mas.
    """
    pe = (root.get("portfolio_exposure") or {}).get("asset_mix")
    if isinstance(pe, dict):
        eq = _num(pe.get("equity")) or 0.0
        fi = _num(pe.get("bond")) or 0.0
        cash = _num(pe.get("cash")) or 0.0
        other = _num(pe.get("other")) or 0.0
        return {"equity": eq, "fixed_income": fi, "cash": cash,
                "alternative": 0.0, "real_asset": 0.0, "other": other,
                "source": "PORTFOLIO_EXPOSURE"}
    if _es_un_fondo(root) or econ_class in ("UNKNOWN", "", None):
        return dict(_SIN_REPARTO_EN_EL_CONTRATO)
    return {
        "equity": 1.0 if econ_class == "EQUITY" else 0.0,
        "fixed_income": 1.0 if econ_class == "FIXED_INCOME" else 0.0,
        "cash": 1.0 if econ_class == "MONEY_MARKET" else 0.0,
        "alternative": 1.0 if econ_class == "ALTERNATIVE" else 0.0,
        "real_asset": 1.0 if econ_class == "REAL_ASSET" else 0.0,
        "other": 1.0 if econ_class in ("OTHER", "MIXED", "COMMODITIES") else 0.0,
        "source": "CLASSIFICATION_FALLBACK",
    }


def _frac_map(node) -> dict:
    """{clave: numero} -> {clave: float} solo con valores numericos > 0; ignora null/0."""
    out = {}
    if isinstance(node, dict):
        for k, v in node.items():
            n = _num(v)
            if n is not None and n > 0:
                out[str(k)] = round(n, 6)
    return out


# Las nueve celdas de la caja de estilo y tamano, con el nombre del contrato.
CELDAS_DE_ESTILO = (
    "large_value", "large_blend", "large_growth",
    "mid_value", "mid_blend", "mid_growth",
    "small_value", "small_blend", "small_growth",
)


def _caja_de_estilo(node) -> Optional[dict]:
    """Las nueve celdas tal como llegan, o None si no son las nueve (decision 51).

    No pasa por `_frac_map`, que tira ceros y negativos: aqui un cero es una celda y un negativo es
    lo neto de cortos, y sin ellos las nueve dejarian de sumar 1. La base vieja no las trae, y sin
    ellas la aplicacion lee los dos repartos: las dos formas conviven instrumento a instrumento.
    """
    if not isinstance(node, dict):
        return None
    celdas = {celda: _num(node.get(celda)) for celda in CELDAS_DE_ESTILO}
    if any(valor is None for valor in celdas.values()):
        return None
    return {celda: round(valor, 6) for celda, valor in celdas.items()}


def map_exposure_detail(root: dict) -> dict:
    """Desglose RV look-through desde portfolio_exposure (fracciones 0..1)."""
    pe = root.get("portfolio_exposure") or {}
    detalle = {
        "sectors": _frac_map(pe.get("sectors")),
        "equity_styles": _frac_map(pe.get("equity_styles")),
        "equity_regions": _frac_map(pe.get("equity_regions")),
        "market_caps": _frac_map(pe.get("market_caps")),
        "confidence": _num(pe.get("exposure_confidence")),
    }
    caja = _caja_de_estilo(pe.get("equity_style_box"))
    if caja is not None:
        detalle["equity_style_box"] = caja
    return detalle


def map_fixed_income_profile(root: dict) -> Optional[dict]:
    """Perfil de renta fija para la ficha (plan Mejorar cartera, fase 1).

    Raíz `fixed_income_profile`: duraciones y vencimiento en años (se copian);
    `investment_grade_pct`, `high_yield_pct` y `yield_to_maturity` vienen en %
    y se exponen en fracción 0..1. `bond_types` sale de `portfolio_exposure`
    y ya está en fracción; se omite si todos sus valores son cero. Devuelve None
    cuando no hay ningún dato.

    Desde el 21-11-2026 (decisión C-31) la base nueva guarda `bond_types` neto, como
    lo da el proveedor: una parte puede ser negativa (la liquidez de un fondo con
    derivados) y otra pasar de 1. `_frac_map` sirve solo las partes mayores que cero,
    como antes, y no rompe con eso: la equivalencia de fondos, que es quien lo lee,
    compara el tipo de emisor sin las negativas, como compara la mezcla de clases
    (C-29). Una parte por encima de 1 pasa tal cual.
    """
    fip = root.get("fixed_income_profile")
    fip = fip if isinstance(fip, dict) else {}
    pe = root.get("portfolio_exposure") or {}
    out: dict = {}
    for key in ("effective_duration", "modified_duration", "effective_maturity"):
        n = _num(fip.get(key))
        if n is not None:
            out[key] = round(n, 6)
    for key in ("yield_to_maturity", "investment_grade_pct", "high_yield_pct"):
        n = _pct_to_dec(fip.get(key))
        if n is not None and (key == "yield_to_maturity" or 0.0 <= n <= 1.0):
            out[key] = n
    quality = fip.get("avg_credit_quality")
    if isinstance(quality, str) and quality.strip():
        out["avg_credit_quality"] = quality.strip()
    bond_types = _frac_map(pe.get("bond_types"))
    if bond_types:
        out["bond_types"] = bond_types
    return out or None


def _clean_optional(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {k: _clean_optional(v) for k, v in value.items()}
        return {k: v for k, v in cleaned.items()
                if v is not None and v != {} and v != []}
    if isinstance(value, list):
        cleaned = [_clean_optional(v) for v in value]
        return [v for v in cleaned if v is not None and v != {} and v != []]
    return value


def _legacy_pct_to_ratio(value: Any) -> Optional[float]:
    number = _num(value)
    return round(number / 100.0, 8) if number is not None else None


def map_fundamentals_summary(root: dict) -> Optional[dict]:
    """Proyecta el resumen canónico y admite las dos formas antiguas."""
    raw = root.get("fundamentals")
    if not isinstance(raw, dict) or not raw:
        return None
    if (map_instrument_type(root) == "FUND"
            and str(raw.get("source") or raw.get("fuente") or "").lower() == "eodhd"):
        # Defensa adicional: EODHD solo puede aportar VL a los fondos.
        return None
    profile = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}
    valuation = raw.get("valuation") if isinstance(raw.get("valuation"), dict) else {}
    profitability = raw.get("profitability") if isinstance(raw.get("profitability"), dict) else {}
    growth = raw.get("growth") if isinstance(raw.get("growth"), dict) else {}
    per_share = raw.get("per_share") if isinstance(raw.get("per_share"), dict) else {}
    dividends = raw.get("dividends") if isinstance(raw.get("dividends"), dict) else {}
    fund_metrics = raw.get("fund_metrics") if isinstance(raw.get("fund_metrics"), dict) else {}
    holdings = raw.get("holdings_summary") if isinstance(raw.get("holdings_summary"), dict) else {}
    quality = raw.get("quality") if isinstance(raw.get("quality"), dict) else {}

    trailing_pe = (_num(valuation.get("pe_trailing"))
                   if valuation.get("pe_trailing") is not None
                   else _num(raw.get("per") if raw.get("per") is not None
                             else raw.get("pe_ratio")))
    forward_pe = (_num(valuation.get("pe_forward"))
                  if valuation.get("pe_forward") is not None
                  else _num(raw.get("per_adelantado")))
    dividend_yield = (_num(dividends.get("yield_ratio"))
                      if dividends.get("yield_ratio") is not None
                      else _legacy_pct_to_ratio(
                          raw.get("dividend_yield_pct")
                          if raw.get("dividend_yield_pct") is not None
                          else raw.get("dividend_yield")))
    roe = (_num(profitability.get("return_on_equity_ttm"))
           if profitability.get("return_on_equity_ttm") is not None
           else _legacy_pct_to_ratio(raw.get("roe_pct")))
    profit_margin = (_num(profitability.get("profit_margin"))
                     if profitability.get("profit_margin") is not None
                     else _legacy_pct_to_ratio(raw.get("profit_margin_pct")))

    result = _clean_optional({
        "schema_version": raw.get("schema_version") or "legacy.fundamentals",
        "source": raw.get("source") or raw.get("fuente") or "unknown",
        "as_of_date": raw.get("as_of_date") or raw.get("source_updated_at"),
        "fetched_at": raw.get("fetched_at"),
        "currency": raw.get("currency") or get_currency(root),
        "coverage_status": quality.get("coverage_status") or "PARTIAL",
        "profile": {
            "sector": profile.get("sector") or raw.get("sector"),
            "industry": profile.get("industry") or raw.get("industry"),
            "country": profile.get("country") or raw.get("country"),
            "gics_sector": profile.get("gics_sector"),
        },
        "valuation": {
            "market_cap": _num(valuation.get("market_cap")
                               if valuation.get("market_cap") is not None
                               else raw.get("market_cap")),
            "enterprise_value": _num(valuation.get("enterprise_value")),
            "pe_trailing": trailing_pe,
            "pe_forward": forward_pe,
            "peg": _num(valuation.get("peg")),
            "price_sales_ttm": _num(valuation.get("price_sales_ttm")),
            "price_book_mrq": _num(valuation.get("price_book_mrq")
                                   if valuation.get("price_book_mrq") is not None
                                   else raw.get("precio_valor_contable")),
            "ev_ebitda": _num(valuation.get("ev_ebitda")),
        },
        "profitability": {
            "profit_margin": profit_margin,
            "operating_margin_ttm": _num(profitability.get("operating_margin_ttm")),
            "return_on_assets_ttm": _num(profitability.get("return_on_assets_ttm")),
            "return_on_equity_ttm": roe,
        },
        "growth": {
            "quarterly_revenue_yoy": _num(growth.get("quarterly_revenue_yoy")),
            "quarterly_earnings_yoy": _num(growth.get("quarterly_earnings_yoy")),
        },
        "per_share": {
            "eps": _num(per_share.get("eps") if per_share.get("eps") is not None
                        else raw.get("eps")),
            "book_value": _num(per_share.get("book_value")),
            "revenue_ttm": _num(per_share.get("revenue_ttm")),
            "dividend": _num(per_share.get("dividend")),
        },
        "dividends": {
            "yield_ratio": dividend_yield,
            "payout_ratio": _num(dividends.get("payout_ratio")),
            "ex_dividend_date": dividends.get("ex_dividend_date"),
        },
        "fund_metrics": {
            "total_assets": _num(fund_metrics.get("total_assets")),
            "yield_pct": _num(fund_metrics.get("yield_pct")),
            "ongoing_charge_pct": _num(fund_metrics.get("ongoing_charge_pct")),
            "net_expense_ratio_pct": _num(
                fund_metrics.get("net_expense_ratio_pct")),
            "turnover_pct": _num(fund_metrics.get("turnover_pct")),
            "average_market_cap_mln": _num(fund_metrics.get("average_market_cap_mln")),
        },
        "holdings_summary": {
            "positions_count": int(_num(holdings.get("positions_count")))
            if _num(holdings.get("positions_count")) is not None else None,
            "top10_weight_pct": _num(holdings.get("top10_weight_pct")),
            "full_holdings_loaded": holdings.get("full_holdings_loaded"),
            "coverage_status": holdings.get("coverage_status"),
        },
    })
    return result if any(result.get(k) for k in (
        "valuation", "profitability", "growth", "per_share", "dividends",
        "fund_metrics", "profile")) else None


# NUEVO-B1 (16-10-2026): dias que el «Ultimo dato» de la raiz puede ir por detras del
# ultimo punto de la serie (metrics/latest.last_date) antes de dejar de ensenarlo.
STALE_LATEST_VALUE_DAYS = 7


def _iso_day(value) -> Optional[datetime.date]:
    try:
        return datetime.date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def map_performance_preview(metrics: dict, root: dict, metrics_latest: Optional[dict] = None) -> dict:
    valuation = (root.get("performance") or {}).get("valuation") or {}
    latest = root.get("latest") or root.get("latest_value") or valuation or {}
    latest_value = (latest.get("value") if isinstance(latest, dict) else None)
    if latest_value is None and isinstance(latest, dict):
        latest_value = latest.get("vl")
    latest_date = latest.get("date") if isinstance(latest, dict) else None
    if latest_date is None and isinstance(latest, dict):
        latest_date = latest.get("vl_fecha")
    source = ((latest.get("source") or latest.get("vl_fuente"))
              if isinstance(latest, dict) else None)
    # Hallazgo 17: la divisa de este valor, que la base nueva da con el precio y no es por fuerza la de la clase. La base vieja no la
    # guarda, y ahi va vacia: quien pinta el valor no puede suponerla.
    latest_currency = latest.get("currency") if isinstance(latest, dict) and isinstance(latest.get("currency"), str) else None
    # NUEVO-B1 (16-10-2026): price_refresh solo escribe performance.valuation de FUND; en
    # acciones de la plataforma (AENA, Deutsche Bank, Ferrovial) el VL se quedo en junio
    # mientras la serie llega a ayer, y la ficha lo ensenaba como «Ultimo dato». Si va mas
    # de STALE_LATEST_VALUE_DAYS por detras de la serie, no se ensena: la ficha cae a la
    # rentabilidad en el anio, como en las acciones EODHD sin VL, fechada con la serie.
    # metrics/latest no guarda el ultimo precio y aqui no se lee la serie (sin lecturas extra).
    series_last = _iso_day((metrics_latest or {}).get("last_date"))
    shown = _iso_day(latest_date)
    if (latest_value is not None and series_last is not None and shown is not None
            and (series_last - shown).days > STALE_LATEST_VALUE_DAYS):
        latest_value = None
        latest_date = series_last.isoformat()
        source = None
        latest_currency = None
    if latest_value is None:
        latest_currency = None
    # Sin origen, vacio, y la calidad lo dice con su propio valor (hallazgo 18): no es un dato de prueba, es que no hay dato.
    source = source or metrics.get("metrics_source") or metrics.get("source") or None
    metric_value_keys = [k for k in metrics if k not in _ROTULOS_DE_LAS_METRICAS]
    return {
        "available": len(metric_value_keys) > 0 or latest_value is not None,
        "ytd_return": metrics.get("ytd_return"),
        "annualized_return_3y": metrics.get("annualized_return_3y"),
        "annualized_return_1y": metrics.get("annualized_return_1y"),
        "annualized_return_5y": metrics.get("annualized_return_5y"),
        "annualized_return_10y": metrics.get("annualized_return_10y"),
        "volatility_3y": metrics.get("volatility_3y"),
        "volatility_5y": metrics.get("volatility_5y"),
        "volatility_1y": metrics.get("volatility_1y"),
        "sharpe_3y": metrics.get("sharpe_3y"),
        "sharpe_5y": metrics.get("sharpe_5y"),
        "max_drawdown_5y": metrics.get("max_drawdown_5y"),
        "max_drawdown_hist": metrics.get("max_drawdown_hist"),
        "max_drawdown_hist_date": metrics.get("max_drawdown_hist_date"),
        "risk_score": metrics.get("risk_score"),
        "risk_score_source": metrics.get("risk_score_source"),
        # metrics.v1.2: con que se midio. El comparador lo necesita para avisar
        # de que dos cifras de la misma columna no salen del mismo calculo.
        "metrics_method": metrics.get("metrics_method"),
        "metrics_frequency": metrics.get("metrics_frequency"),
        "latest_value": latest_value,
        "latest_value_date": latest_date,
        "latest_value_currency": latest_currency,
        "source": source,
        "data_quality": source or CALIDAD_NO_DISPONIBLE,
    }


def available_sections(itype: str, costs: Optional[dict], holdings: dict,
                       fundamentals: Optional[dict]) -> list:
    sections = ["summary", "performance_preview", "risk_snapshot"]
    if itype in ("FUND", "ETF"):
        sections.append("portfolio_summary")
        if costs:
            sections.append("cost_snapshot")
    if itype in ("STOCK", "ETF", "INDEX"):
        sections.extend(["identity", "listing", "metrics"])
    if holdings.get("has_holdings"):
        sections.append("holdings_summary")
    if fundamentals:
        sections.append("fundamentals")
    if itype == "INDEX":
        sections.append("proxy_note")
    return list(dict.fromkeys(sections))


def data_quality_summary(root: dict, metrics: dict, holdings: dict,
                         fundamentals: Optional[dict], flags: list,
                         warnings: list, coverage: str, pms_exposure: Optional[dict] = None) -> dict:
    ident = root.get("identity") or {}
    metric_value_keys = [k for k in metrics if k not in _ROTULOS_DE_LAS_METRICAS]
    return {
        "coverage_status": coverage,
        "has_identity": bool(ident.get("name") or root.get("asset_id")),
        "has_metrics": len(metric_value_keys) > 0,
        "has_pms_exposure": (pms_exposure or {}).get("source") != SIN_REPARTO,
        "has_costs": map_costs(root) is not None,
        "has_holdings_summary": bool(holdings),
        "has_fundamentals": fundamentals is not None,
        "has_history_years": False,
        "quality_flags": list(flags),
        "warnings_count": len(warnings),
    }


def map_holdings_summary(holdings_doc: Optional[dict]) -> dict:
    if not holdings_doc:
        return {"has_holdings": False, "full_holdings_loaded": False}
    data = holdings_doc.get("data") if "data" in holdings_doc else holdings_doc
    resumen = {
        "has_holdings": True,
        "positions_count": data.get("holdings_count"),
        "top10_weight": _num(data.get("top10_weight")),
        "as_of_date": data.get("as_of_date"),
        "full_holdings_loaded": False,
    }
    # Hallazgo 20: el total de titulos, la parte del patrimonio que cubren (en tanto por uno) y si la lista es entera o solo las
    # principales. Solo si los trae lo leido: el resumen de la tarjeta no los lleva, y no se deducen.
    for clave in ("securities_count", "coverage", "list_scope"):
        if data.get(clave) is not None:
            resumen[clave] = data[clave]
    return resumen


def get_role(root: dict) -> str:
    return "BENCHMARK" if map_instrument_type(root) == "INDEX" else "INVESTABLE"


def is_investable(root: dict) -> bool:
    from asset_eligibility import corporate_action_blocks_selection, operator_blocks_selection
    return get_role(root) == "INVESTABLE" and not operator_blocks_selection(root) and not corporate_action_blocks_selection(root)


def quality_flags(root: dict, metrics: dict, holdings: dict, coverage: str) -> list:
    from fund_history_quality import public_flags
    flags = public_flags(root.get("asset_id"))
    if get_role(root) == "BENCHMARK":
        flags.append("NON_INVESTABLE_BENCHMARK")
    from asset_eligibility import corporate_action_blocks_selection, selection_restriction_flag
    if corporate_action_blocks_selection(root):
        flags.append("NON_INVESTABLE_CORPORATE_ACTION")
    restriction = selection_restriction_flag(root)
    if restriction:
        flags.append(restriction)
    if not holdings.get("has_holdings"):
        flags.append("MISSING_HOLDINGS")
    # Los rotulos del metodo y el contexto no son metricas (hallazgo 18): se cuenta como en `data_quality_summary`.
    if len([k for k in metrics if k not in _ROTULOS_DE_LAS_METRICAS]) == 0:
        flags.append("MISSING_QUANT_METRICS")
    if coverage != "COMPLETE":
        flags.append("PARTIAL_COVERAGE")
    return flags


def derive_coverage(root: dict, metrics: dict, holdings: dict) -> str:
    has_metrics = len([k for k in metrics if k not in _ROTULOS_DE_LAS_METRICAS]) > 0
    itype = map_instrument_type(root)
    if itype == "FUND":
        return "COMPLETE" if (has_metrics and holdings.get("has_holdings")) else "PARTIAL"
    if itype == "INDEX":
        return "PARTIAL"
    return "COMPLETE" if has_metrics else "ROOT_ONLY"


def map_asset_detail(root: dict, metrics_latest: Optional[dict] = None,
                     holdings_doc: Optional[dict] = None) -> dict:
    itype = map_instrument_type(root)
    econ = map_economic_asset_class(root)
    ident = root.get("identity") or {}
    idents = root.get("identifiers") or {}
    classification = root.get("classification") or {}
    metrics = map_quant_metrics(root, metrics_latest)
    holdings = map_holdings_summary(holdings_doc)
    fundamentals = map_fundamentals_summary(root)
    coverage = derive_coverage(root, metrics, holdings)
    flags = quality_flags(root, metrics, holdings, coverage)
    costs = map_costs(root) if itype in ("FUND", "ETF") else None
    fixed_income = map_fixed_income_profile(root) if itype in ("FUND", "ETF") else None
    pms_exposure = map_pms_exposure(root, econ)
    warnings = [{"code": f, "severity": "MEDIUM" if f == "PARTIAL_COVERAGE" else "LOW",
                 "message": f"Data quality: {f.lower()}.", "asset_id": root.get("asset_id")}
                for f in flags]
    return json_safe({
        "asset_id": root.get("asset_id"),
        "updated_at": root.get("updated_at"),
        "instrument_type": itype,
        "economic_asset_class": econ,
        "identity": {"display_name": ident.get("name"), "isin": idents.get("isin"),
                     "ticker": idents.get("ticker") or idents.get("openfigi_ticker"),
                     "currency": get_currency(root), "region": map_region(root)},
        "classification": {
            "morningstar_rating": classification.get("morningstar_rating"),
            "official_benchmark": classification.get("official_benchmark"),
            "sector": map_sector(root),
        },
        "costs": costs,
        "metrics": metrics,
        "performance_preview": map_performance_preview(metrics, root, metrics_latest),
        "category": map_category(root),
        "pms_exposure": pms_exposure,
        "exposure_detail": map_exposure_detail(root),
        "fixed_income_profile": fixed_income,
        "holdings_summary": holdings,
        "history_available_years": [],
        "available_sections": available_sections(itype, costs, holdings, fundamentals),
        "fundamentals_summary": fundamentals,
        "data_quality_summary": data_quality_summary(root, metrics, holdings, fundamentals, flags, warnings, coverage, pms_exposure),
        "coverage_status": coverage,
        "is_investable": is_investable(root),
        "role": get_role(root),
        "quality_flags": flags,
        "warnings": warnings,
        **_producto_del_detalle(root),
    })


def _producto_del_detalle(root: dict) -> dict:
    """La réplica del proveedor (Morningstar, `product.replication`), lo único del bloque de producto que viaja con el activo. La pide
    el solapamiento para decir que un ETF sintético replica con una permuta y no que «no publica» (Óscar, 12-11-2026); en la base nueva
    un ETF por swap no tiene cartera guardada. Es dato del proveedor, no del emisor (B-53). Sin ella, el activo va como antes, sin bloque."""
    replica = (root.get("product") or {}).get("replication")
    return {"product": {"replication": replica.strip()}} if isinstance(replica, str) and replica.strip() else {}
