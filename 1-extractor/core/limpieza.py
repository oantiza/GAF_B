"""Saneado del JSON final tras la fusión de fuentes (antes de derivados).

- Normaliza países a ISO3 (fusiona duplicados "United States"/"Estados
  Unidos"/USA) y elimina los de peso 0.
- Unifica sectores a la nomenclatura propia en español (fusiona claves
  inglesas de sal-service y justETF).
- Elimina la lista de campos acordada como ruido (11-06-2026): intradía,
  52 semanas, variación diaria, num_titulos/valor_mercado por posición,
  estructura legal, estado de comercialización, tenure, entidad legal de la
  gestora, ids/mercados de documentos, analista_pct, regiones residuales.
`meta.sec_id_morningstar` se conserva como trazabilidad técnica.
"""
from __future__ import annotations

# ------------------------------------------------------- campos a eliminar
RUTAS_FUERA = [
    ("identificacion", "estado_comercializacion"),
    ("identificacion", "estructura_legal"),
    ("identificacion", "nombre_legal_cnmv"),
    ("gestion", "tenure_medio_años"),
    ("gestion", "gestora", "entidad_legal"),
    ("rating", "medalist", "analista_pct"),
    ("rating", "medalist", "rating_escala_1a5"),
    ("valoracion", "variacion_dia_pct"),
    ("valoracion", "min_52sem"),
    ("valoracion", "max_52sem"),
    ("valoracion", "etf_intradia"),
    ("costes", "comision_distribucion_pct"),
    ("riesgo", "risk_score"),
    ("rentabilidad", "trailing_pct", "1d"),
    ("rentabilidad", "trailing_pct", "1sem"),
]
POSICION_FUERA = ("num_titulos", "valor_mercado", "primera_compra")
DOCUMENTO_FUERA = ("id", "mercados", "formato")
# Lo que el proveedor manda con las zonas y no es una zona: los totales de emergentes y de
# desarrollados, y lo no clasificado. `otros` y `otros_2` son como se llamaban en las fichas
# anteriores al 05-11-2026, que la retencion puede conservar (ver `REGION_CODES`).
REGIONES_FUERA = ("total_emergentes", "total_desarrollados", "no_clasificado",
                  "otros", "otros_2", "14", "15", "16")

# --------------------------------------------- países: nombre largo -> ISO3
PAISES_ISO3 = {
    # inglés (justETF y otros)
    "united states": "USA", "united kingdom": "GBR", "japan": "JPN",
    "canada": "CAN", "france": "FRA", "germany": "DEU", "switzerland": "CHE",
    "australia": "AUS", "netherlands": "NLD", "spain": "ESP", "italy": "ITA",
    "sweden": "SWE", "denmark": "DNK", "norway": "NOR", "finland": "FIN",
    "belgium": "BEL", "austria": "AUT", "ireland": "IRL", "portugal": "PRT",
    "greece": "GRC", "poland": "POL", "china": "CHN", "hong kong": "HKG",
    "taiwan": "TWN", "south korea": "KOR", "korea": "KOR", "india": "IND",
    "singapore": "SGP", "indonesia": "IDN", "malaysia": "MYS",
    "thailand": "THA", "philippines": "PHL", "vietnam": "VNM",
    "brazil": "BRA", "mexico": "MEX", "chile": "CHL", "colombia": "COL",
    "peru": "PER", "argentina": "ARG", "south africa": "ZAF",
    "israel": "ISR", "turkey": "TUR", "saudi arabia": "SAU",
    "united arab emirates": "ARE", "qatar": "QAT", "kuwait": "KWT",
    "new zealand": "NZL", "luxembourg": "LUX", "czech republic": "CZE",
    "czechia": "CZE", "hungary": "HUN", "romania": "ROU", "russia": "RUS",
    "egypt": "EGY", "morocco": "MAR", "iceland": "ISL", "estonia": "EST",
    "lithuania": "LTU", "latvia": "LVA", "slovenia": "SVN",
    "slovakia": "SVK", "croatia": "HRV", "cyprus": "CYP", "malta": "MLT",
    "liechtenstein": "LIE", "monaco": "MCO", "bermuda": "BMU",
    "cayman islands": "CYM", "jersey": "JEY", "guernsey": "GGY",
    "isle of man": "IMN", "macau": "MAC", "macao": "MAC",
    "other": "OTROS", "others": "OTROS",
    # español (iShares /es y otros)
    "estados unidos": "USA", "reino unido": "GBR", "japon": "JPN",
    "japón": "JPN", "canadá": "CAN", "francia": "FRA",
    "alemania": "DEU", "suiza": "CHE", "países bajos": "NLD",
    "paises bajos": "NLD", "holanda": "NLD", "españa": "ESP",
    "espana": "ESP", "italia": "ITA", "suecia": "SWE", "dinamarca": "DNK",
    "noruega": "NOR", "finlandia": "FIN", "bélgica": "BEL",
    "belgica": "BEL", "irlanda": "IRL", "grecia": "GRC", "polonia": "POL",
    "corea del sur": "KOR", "corea": "KOR", "hong-kong": "HKG",
    "taiwán": "TWN", "singapur": "SGP", "brasil": "BRA",
    "méxico": "MEX", "sudáfrica": "ZAF",
    "sudafrica": "ZAF", "turquía": "TUR", "turquia": "TUR",
    "arabia saudí": "SAU", "arabia saudi": "SAU", "nueva zelanda": "NZL",
    "luxemburgo": "LUX", "rusia": "RUS",
    "emiratos árabes unidos": "ARE", "emiratos arabes unidos": "ARE",
    "otros": "OTROS", "otro": "OTROS", "efectivo y/o derivados": "LIQUIDEZ",
    "cash and/or derivatives": "LIQUIDEZ",
}

# --------------------------------- sectores: claves en inglés -> nombre es
SECTORES_ES = {
    "technology": "tecnologia", "information technology": "tecnologia",
    "healthcare": "salud", "health care": "salud",
    "financial services": "servicios_financieros",
    "financialservices": "servicios_financieros",
    "financials": "servicios_financieros",
    "consumer cyclical": "consumo_ciclico",
    "consumercyclical": "consumo_ciclico",
    "consumer discretionary": "consumo_ciclico",
    "consumer defensive": "consumo_defensivo",
    "consumerdefensive": "consumo_defensivo",
    "consumer staples": "consumo_defensivo",
    "industrials": "industria", "industrial": "industria",
    "basic materials": "materiales_basicos",
    "basicmaterials": "materiales_basicos", "materials": "materiales_basicos",
    "energy": "energia",
    "utilities": "utilities",
    "real estate": "inmobiliario", "realestate": "inmobiliario",
    "communication services": "comunicacion",
    "communicationservices": "comunicacion",
    "telecommunication": "comunicacion", "telecommunications": "comunicacion",
    "cash and/or derivatives": "liquidez", "cash": "liquidez",
    "other": "otros", "others": "otros",
    # variantes en español (CSV de iShares es, sal position es)
    "tecnologia de la informacion": "tecnologia",
    "sanidad": "salud", "atencion sanitaria": "salud",
    "finanzas": "servicios_financieros",
    "consumo discrecional": "consumo_ciclico",
    "productos de primera necesidad": "consumo_defensivo",
    "bienes de consumo basico": "consumo_defensivo",
    "industriales": "industria",
    "materiales": "materiales_basicos",
    "servicios publicos": "utilities",
    "servicios de comunicacion": "comunicacion",
    "bienes inmuebles": "inmobiliario",
    "efectivo y/o derivados": "liquidez",
}
SECTORES_VALIDOS = {"materiales_basicos", "consumo_ciclico",
                    "servicios_financieros", "inmobiliario",
                    "consumo_defensivo", "salud", "utilities", "comunicacion",
                    "energia", "industria", "tecnologia", "liquidez", "otros"}


def aplica(d: dict) -> None:
    _borra_rutas(d)
    cartera = d.get("cartera")
    if isinstance(cartera, dict):
        _normaliza_paises(cartera)
        _normaliza_sectores(cartera)
        _limpia_regiones(cartera)
        _limpia_posiciones(cartera)
    _limpia_documentos(d)


def _borra_rutas(d: dict) -> None:
    for ruta in RUTAS_FUERA:
        nodo = d
        for clave in ruta[:-1]:
            nodo = nodo.get(clave) if isinstance(nodo, dict) else None
            if nodo is None:
                break
        if isinstance(nodo, dict):
            nodo.pop(ruta[-1], None)


_CACHE_ISO3: dict[str, str | None] = {}


def _a_iso3(nombre: str) -> str | None:
    """Nombre de país (es/en) -> ISO3. Tabla propia + pycountry de respaldo
    (cubre los ~200 países estándar: Cameroon, Kazakhstan, Zimbabwe...)."""
    k = str(nombre).strip()
    if len(k) == 3 and k.isupper() and k.isalpha():
        return k
    if k in _CACHE_ISO3:
        return _CACHE_ISO3[k]
    iso = PAISES_ISO3.get(_norm_txt(k))
    if iso:
        _CACHE_ISO3[k] = iso
        return iso
    try:
        import pycountry
        pais = pycountry.countries.get(name=k) \
            or pycountry.countries.get(common_name=k) \
            or pycountry.countries.get(official_name=k)
        if pais is None:
            candidatos = pycountry.countries.search_fuzzy(k)
            pais = candidatos[0] if candidatos else None
        if pais is not None:
            _CACHE_ISO3[k] = pais.alpha_3
            return pais.alpha_3
    except Exception:
        pass
    _CACHE_ISO3[k] = None
    return None


def _norm_txt(s: str) -> str:
    import re
    import unicodedata
    s = str(s).strip()
    # des-cameliza: "unitedStates" -> "united States"
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = "".join(c for c in unicodedata.normalize("NFD", s.lower())
                if unicodedata.category(c) != "Mn")
    return s


def _normaliza_paises(cartera: dict) -> None:
    paises = cartera.get("paises_pct")
    if not isinstance(paises, dict):
        return
    limpio: dict[str, float] = {}
    for clave, v in paises.items():
        if not isinstance(v, (int, float)) or v <= 0:
            continue
        k = str(clave).strip()
        iso = _a_iso3(k) or k
        # si conviven nombre e ISO3 (fuentes distintas), gana el mayor detalle
        if iso in limpio:
            limpio[iso] = max(limpio[iso], round(float(v), 4))
        else:
            limpio[iso] = round(float(v), 4)
    cartera["paises_pct"] = dict(
        sorted(limpio.items(), key=lambda x: -x[1])) or None
    if cartera["paises_pct"] is None:
        cartera.pop("paises_pct")


def _sector(clave: str) -> str | None:
    """Clave de sector de una fuente -> nombre propio, o None si no se reconoce.

    También se compara la clave normalizada con `SECTORES_VALIDOS`: «Tecnología»
    o «Energía» con tilde quedan en «tecnologia»/«energia», que no están en
    `SECTORES_ES` (allí van las variantes en inglés y las españolas de otra
    forma) y se descartaban (auditoría 16-10, NUEVO-2)."""
    if clave in SECTORES_VALIDOS:
        return clave
    norm = _norm_txt(clave)
    if norm in SECTORES_ES:
        return SECTORES_ES[norm]
    norm = norm.replace(" ", "_")
    return norm if norm in SECTORES_VALIDOS else None


def _normaliza_sectores(cartera: dict) -> None:
    sectores = cartera.get("sectores_pct")
    if not isinstance(sectores, dict):
        return
    limpio: dict[str, dict] = {}
    for clave, v in sectores.items():
        nombre = _sector(clave)
        if nombre is None:
            continue  # clave desconocida duplicada: fuera
        contenido = v if isinstance(v, dict) else {"fondo": v}
        destino = limpio.setdefault(nombre, {})
        for quien, valor in contenido.items():
            if isinstance(valor, (int, float)) and quien not in destino:
                destino[quien] = valor
    if limpio:
        cartera["sectores_pct"] = limpio


def _limpia_regiones(cartera: dict) -> None:
    regiones = cartera.get("regiones_pct")
    if not isinstance(regiones, dict):
        return
    limpio = {k: v for k, v in regiones.items()
              if isinstance(v, (int, float)) and v > 0
              and k not in REGIONES_FUERA}
    if limpio:
        cartera["regiones_pct"] = limpio
    else:
        cartera.pop("regiones_pct", None)


def _limpia_posiciones(cartera: dict) -> None:
    """Poda campos descartados y unifica nomenclatura por posición:
    pais -> ISO3, sector -> canónico en español (igual que los agregados)."""
    posiciones = cartera.get("posiciones")
    if not isinstance(posiciones, list):
        return
    for p in posiciones:
        if not isinstance(p, dict):
            continue
        for campo in POSICION_FUERA:
            p.pop(campo, None)
        pais = p.get("pais")
        if pais:
            iso = _a_iso3(pais)
            if iso:
                p["pais"] = iso
            else:
                p["pais_original"] = str(pais)
                p["pais"] = None
        sector = p.get("sector")
        if sector and sector not in SECTORES_VALIDOS:
            canonico = SECTORES_ES.get(_norm_txt(sector))
            if canonico:
                p["sector"] = canonico


def _limpia_documentos(d: dict) -> None:
    """Colapsa la lista de documentos a un resumen (nº y última fecha)."""
    docs = d.get("documentos")
    if not isinstance(docs, list):
        return
    fechas = [doc.get("fecha") for doc in docs
              if isinstance(doc, dict) and doc.get("fecha")]
    d["documentos"] = {"n": len(docs),
                       "ultima_fecha": max(fechas) if fechas else None}
