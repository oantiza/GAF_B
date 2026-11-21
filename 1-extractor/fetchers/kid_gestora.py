"""Fuente KID de la gestora: el documento de datos fundamentales de fondos no
españoles, descargado de donde lo publica el productor.

El Reglamento PRIIPs (UE 1286/2014, art. 5) obliga al productor a publicar el
KID en su web, pero no hay un repositorio oficial para LU/IE como el que la
CNMV ofrece para los fondos españoles (descubrimiento 04-09, informe §7.2):
555 fondos LU/IE repartidos entre unas 90 gestoras. Este adaptador resuelve
el KID de la clase por ISIN en dos pasos:

1. **Patrón de la gestora** (`FUENTES` con marcas): las gestoras que exponen
   un enlace estable por ISIN o construible desde el nombre legal de la clase,
   verificado el 05-09 desde esta máquina: DWS, Amundi (también First Eagle
   Amundi), JPMorgan (servicio de documentos Fundsquare), Invesco, Nordea
   (FundConnect), Candriam (su ficha por ISIN), Goldman Sachs, Schroders y M&G
   (nombre del compartimento y de la clase, de la CSSF o de Morningstar). La
   gestora se elige por las pistas disponibles: marca y nombre de Morningstar,
   nombre legal de la CSSF, productor del KID anterior.
2. **Espejo de último recurso**: el repositorio de documentación de fondos de
   Deutsche Bank España (`getDocumento?codDoc=ISIN&codSus=KIID`), que sirve
   el PDF del productor tal cual (mismos bytes que el original en todas las
   comparaciones hechas: Schroders, M&G, JPMorgan, Invesco). Un distribuidor
   está obligado a entregar el KID vigente antes de la venta; el ISIN dentro
   del PDF es la garantía de que el documento es el de esta clase.

Cada PDF se guarda en `cache/kid/gestoras/<fuente>/` y se relee mientras no
caduque la familia `regulatorio` (90 días). Un patrón que no existe para un
ISIN se recuerda 30 días (`.miss`) para no volver a pedirlo en cada pasada.
El PDF se rechaza si habla de otro ISIN (Franklin Templeton, por ejemplo,
sirve el mismo documento sea cual sea el ISIN del nombre del fichero).

Todo lo escrito lleva procedencia `kid_gestora:<fuente>`; el canónico expone
en `regulatory.kid.source` de dónde salió el documento.
"""
from __future__ import annotations

import dataclasses
import hashlib
import logging
import re
import time
import unicodedata
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode

from core import kid
from core.adquisicion import procedencia
from core.http import SinCache
from core.schema import set_path

log = logging.getLogger("fondosdb.kid_gestora")

FAMILIA = "regulatorio"
NEGATIVO_DIAS = 30
# El KID se revisa al menos una vez al año (Reglamento PRIIPs, art. 10): un
# documento de más de 15 meses no es el vigente (el espejo conserva alguno de
# 2023) y no debe pisar la copia de Morningstar.
KID_MAX_DIAS = 456
# Invesco (Akamai) responde 406 a un User-Agent de navegador sin el resto de
# cabeceras de navegador; con un agente de herramienta, identificable, sirve.
UA_HERRAMIENTA = "fondosdb-extractor/1.0 (descarga de documentos de datos fundamentales)"

Urls = Callable[[str, dict], list[str]]


@dataclasses.dataclass(frozen=True)
class Fuente:
    id: str
    descripcion: str
    marcas: tuple[str, ...]                    # () = vale para cualquier gestora (espejo)
    urls: Urls | None = None                   # candidatos por (ISIN, identificación)
    pagina: Callable[[str], str] | None = None           # ficha HTML de la que sacar el enlace
    enlace: Callable[[str], re.Pattern] | None = None    # regex del enlace en la ficha
    base_enlace: str = ""
    cabeceras: dict | None = None

    def casa(self, pistas: str) -> bool:
        return any(re.search(m, pistas) for m in self.marcas)


# ----------------------------------------------------------------- patrones
def _fundconnect(isin: str, _i: dict) -> list[str]:
    return ["https://docs.fundconnect.com/GetDocument.aspx?" + urlencode({
        "clientid": "i1g0xyvk-ztaq-jdr2-cm3y-0sshe4ukztmc", "Isin": isin,
        "lang": "es-ES", "type": "PRIIPS KID", "save": "False"})]


def _fundsquare_jpm(isin: str, _i: dict) -> list[str]:
    return ["https://wl.fundsquare.net/serv/down-doc/request?" + urlencode({
        "cdClient": "jpmorgan", "isin": isin, "docTypeCode": "KIDD",
        "docLang": "ES", "docCountry": "ES"})]


def _espejo_db(isin: str, _i: dict) -> list[str]:
    return ["https://www.servicios.deutsche-bank.es/documentacionfondos/getDocumento?" + urlencode({
        "codDoc": isin, "idioma": "ES", "codSus": "KIID", "codCont": "NA"})]


RE_CLASE = re.compile(r"^[A-Z]{1,2}\d?$")
TIPOS = {"ACCUMULATION": "Acc", "ACC": "Acc", "ACUMULACION": "Acc", "CAP": "Acc",
         "DISTRIBUTION": "Dis", "DIS": "Dis", "DIST": "Dis", "INC": "Inc", "INCOME": "Inc"}


def _mayus(s: str | None) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.upper()).strip()


# La cobertura de divisa viene escrita de formas distintas segun de donde salga
# el nombre legal de la clase: "EUR HEDGED" en la CSSF, y "EUR-HEDG", "EUR
# HEDG." o "EUR HEDG" en Morningstar, que lo trunca. Reconocerlas todas importa
# porque la URL de Schroders lleva "-Hedged" dentro del compartimento, y sin esa
# parte la gestora responde 403: medido el 30-10-2026 sobre cuatro clases
# cubiertas (LU0189895229, LU0236738190, LU0795636256, LU0943301571), que la
# forma truncada dejaba fuera. No entran aqui las formas entre parentesis ni
# "PARTIALLY HEDGED", que es otra cosa y no debe construir la misma URL.
RE_COBERTURA = re.compile(r"^(?:HEDGED|HEDG)\.?$")
RE_SUFIJO_COBERTURA = re.compile(r"-(?:HEDGED|HEDG|H)\.?$")


def _sin_cobertura(token: str) -> tuple[str, bool]:
    """El token sin su marca de cobertura: 'EUR-HEDG' -> ('EUR', True)."""
    if RE_COBERTURA.match(token):
        return "", True
    m = RE_SUFIJO_COBERTURA.search(token)
    if m:
        return token[:m.start()], True
    # Una "H" suelta puede ser la cobertura o el nombre de la clase. Se marca
    # cobertura y se deja pasar como posible clase, como antes de este cambio.
    return token, token in ("H", "H.")


def _clase_tipo_divisa(tokens: list[str]) -> tuple[str | None, str | None, str | None, bool]:
    """(clase, Acc|Dis|Inc, divisa, cubierta) a partir de los tokens de la clase."""
    clase = tipo = divisa = None
    cubierta = False
    for t in tokens:
        base, cubre = _sin_cobertura(t)
        cubierta = cubierta or cubre
        if not base:
            continue
        if clase is None and RE_CLASE.match(base) and base not in ("EUR", "USD", "GBP", "CHF", "JPY"):
            clase = base
        elif base in TIPOS and tipo is None:
            tipo = TIPOS[base]
        elif re.fullmatch(r"[A-Z]{3}", base) and base in ("EUR", "USD", "GBP", "CHF", "JPY", "SEK", "NOK", "DKK", "AUD", "CAD", "SGD", "HKD") and divisa is None:
            divisa = base
    return clase, tipo, divisa, cubierta


def _tras(nombre: str, prefijo: str) -> str | None:
    n = _mayus(nombre)
    p = _mayus(prefijo)
    if n.startswith(p):
        return n[len(p):].strip(" -")
    return None


def _schroders(isin: str, i: dict) -> list[str]:
    """SISF_{Compartimento}-{Divisa}[-Hedged]_{Clase}-{Acc|Dis}-PRIIPEU-ESES.pdf
    (api.schroders.com/document-store, insensible a mayúsculas)."""
    comp = _mayus(i.get("compartimento_legal"))
    clase_legal = _mayus(i.get("clase_legal"))
    if not comp or not clase_legal:
        resto = _tras(i.get("nombre") or "", "Schroder International Selection Fund") or \
            _tras(i.get("nombre") or "", "Schroder ISF")
        if not resto:
            return []
        toks = resto.split()
        idx = next((k for k, t in enumerate(toks) if RE_CLASE.match(t) and k > 0
                    and k + 1 < len(toks) and toks[k + 1] in TIPOS), None)
        if idx is None:
            return []
        comp, clase_legal = " ".join(toks[:idx]), " ".join(toks[idx:])
    clase, tipo, divisa_clase, cubierta = _clase_tipo_divisa(clase_legal.split())
    if not clase or not tipo:
        return []
    divisas = [d for d in (divisa_clase, _mayus(i.get("divisa_base")) or None,
                           _mayus(i.get("divisa_compartimento")) or None) if d]
    fondo = "-".join(w.capitalize() for w in comp.split())
    out = []
    for d in dict.fromkeys(divisas):
        cobertura = "-Hedged" if cubierta else ""
        out.append(f"https://api.schroders.com/document-store/SISF_{fondo}-{d}{cobertura}_{clase}-{tipo}-PRIIPEU-ESES.pdf")
    return out


def _mandg(isin: str, i: dict) -> list[str]:
    """(lux)-{fondo}_{divisa}_{clase}_{acc|inc}_es_kiid_spa_pe_{isin}.pdf en mandg.com."""
    comp = _tras(i.get("compartimento_legal") or "", "M&G (LUX)")
    clase_legal = _mayus(i.get("clase_legal"))
    if not comp or not clase_legal:
        resto = _tras(i.get("nombre") or "", "M&G (Lux)")
        if not resto:
            return []
        toks = resto.split()
        idx = next((k for k, t in enumerate(toks) if re.fullmatch(r"[A-Z]{3}", t) and k > 0), None)
        if idx is None:
            return []
        comp, clase_legal = " ".join(toks[:idx]), " ".join(toks[idx:])
    clase, tipo, divisa, _cub = _clase_tipo_divisa(clase_legal.split())
    divisa = divisa or _mayus(i.get("divisa_base")) or None
    if not clase or not tipo or not divisa:
        return []
    tipo_mg = "inc" if tipo in ("Dis", "Inc") else "acc"
    clase_mg = clase.lower().replace("-", "")
    if _clase_tipo_divisa(clase_legal.split())[3]:
        clase_mg += "h"
    fondo = "-".join(comp.lower().split())
    return [f"https://www.mandg.com/dam/investments/common/es/es/documents/funds-literature/prp/"
            f"(lux)-{fondo}_{divisa.lower()}_{clase_mg}_{tipo_mg}_es_kiid_spa_pe_{isin.lower()}.pdf"]


FUENTES: tuple[Fuente, ...] = (
    Fuente("dws", "DWS: download.dws.com/product-documents/{ISIN}/PRIIPS KID/ES/ES",
           (r"\bdws\b", r"\bxtrackers\b"),
           urls=lambda i, _d: [f"https://download.dws.com/product-documents/{i}/PRIIPS%20KID/ES/ES"]),
    Fuente("amundi", "Amundi (también First Eagle Amundi, CPR, Lyxor): amundi.es/retail/dl/doc/kid-priips/{ISIN}/SPA/ESP",
           (r"\bamundi\b", r"\bfirst eagle\b", r"\bcpr\b", r"\blyxor\b"),
           urls=lambda i, _d: [f"https://www.amundi.es/retail/dl/doc/kid-priips/{i}/SPA/ESP"]),
    Fuente("jpmorgan", "JPMorgan AM: servicio de documentos Fundsquare (cdClient=jpmorgan) por ISIN",
           (r"\bjp ?morgan\b", r"\bjpm\b"),
           urls=_fundsquare_jpm),
    Fuente("invesco", "Invesco: content/dam/.../product-documents/{gpr|etf}/share-class/kid/{ISIN}_kid_ES-ES.pdf",
           (r"\binvesco\b",),
           urls=lambda i, _d: [
               f"https://www.invesco.com/content/dam/invesco/es/es/product-documents/gpr/share-class/kid/{i}_kid_ES-ES.pdf",
               f"https://www.invesco.com/content/dam/invesco/es/es/product-documents/etf/share-class/kid/{i}_kid_es-es.pdf"],
           cabeceras={"User-Agent": UA_HERRAMIENTA}),
    Fuente("nordea", "Nordea: servicio de documentos FundConnect por ISIN (es-ES)",
           (r"\bnordea\b",),
           urls=_fundconnect),
    Fuente("candriam", "Candriam: ficha funds-lister/fund-detail/{ISIN} y su enlace KID_{ISIN}_{fecha}_es_ES.pdf",
           (r"\bcandriam\b",),
           pagina=lambda i: f"https://www.candriam.com/es-es/professional/funds-lister/fund-detail/{i}",
           enlace=lambda i: re.compile(r'href="(/FundDocumentDownload/GetApiDocument/[^"?]+/KID_' + i + r'_\d{8}_es_ES\.pdf)'),
           base_enlace="https://www.candriam.com"),
    Fuente("goldman_sachs", "Goldman Sachs AM: gsam.com/.../kiids/{ISIN}_ES_PRIIPSVEU.pdf (HTML si no existe)",
           (r"\bgoldman\b",),
           urls=lambda i, _d: [f"https://www.gsam.com/content/dam/gsam/pdfs/international/es/prospectus-and-regulatory/kiids/{i}_ES_PRIIPSVEU.pdf?sa=n&rd=n"]),
    Fuente("schroders", "Schroders: api.schroders.com/document-store/SISF_{compartimento}-{divisa}_{clase}-{Acc|Dis}-PRIIPEU-ESES.pdf",
           (r"\bschroder",),
           urls=_schroders),
    Fuente("mandg", "M&G: mandg.com/.../funds-literature/prp/(lux)-{fondo}_{divisa}_{clase}_{acc|inc}_es_kiid_spa_pe_{isin}.pdf",
           (r"\bm&g\b", r"\bm&g \(lux\)"),
           urls=_mandg),
    Fuente("deutsche_bank_es", "Espejo: documentación de fondos de Deutsche Bank España, getDocumento?codDoc={ISIN}&codSus=KIID",
           (),
           urls=_espejo_db),
    # Segundo espejo, medido el 30-10-2026 sobre los 201 fondos sin KID: 144
    # pasan las guardas de `_lee` y 135 traen SRI legible, con documentos
    # vigentes (107 de 2026, 15 de 2025). Sube la cobertura de KID en fondos
    # del 73,3 % al 91,2 % con un solo patrón, donde cubrir lo mismo con
    # patrones de gestora habría exigido unos cuarenta: entran Fidelity 12,
    # BlackRock 10, Andbank 10, Carmignac 9, BNP 6, PIMCO 6, Nordea 5 y una
    # treintena de gestoras con uno a cuatro fondos.
    #
    # El documento lo pone Allfunds -el `afb` del parámetro es Allfunds Bank-,
    # que no tiene ruta pública propia, y sale por la puerta de Renta 4. El
    # lote (`20261023_084108`) va por fondo y no se puede construir: adivinarlo
    # responde 400. Por eso son dos pasos, como Candriam.
    #
    # Lleva el agente de herramienta porque es con el que se midió, y una
    # medición que no reproduce lo que pide producción no vale: esa lección
    # costó tres pasadas esta misma mañana.
    Fuente("renta4_allfunds", "Espejo: ficha de Renta 4 por ISIN y, dentro, el KID de Allfunds (afb_kiid)",
           (),
           pagina=lambda i: f"https://www.r4.com/productos-inversion/fondos/fichas/{i}",
           enlace=lambda i: re.compile(
               r"(https://www\.r4\.com/R4DocFondos/0001\.mar\?d=afb_kiid/"
               r"\d{8}_\d{6}/1_" + re.escape(i) + r"\.pdf)", re.I),
           cabeceras={"User-Agent": UA_HERRAMIENTA}),
)
# Fuentes que valen para cualquier gestora. Se prueban después de la suya, y
# entre ellas en el orden de FUENTES: Deutsche Bank primero, que ya sostiene
# 255 KID, para no cambiar de dónde viene lo que hoy funciona.
ESPEJOS = {"deutsche_bank_es", "renta4_allfunds"}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower())


def identificacion_de(previo: dict) -> dict:
    """Lo que se sabe de la clase antes de descargar nada (Morningstar, CSSF, ficha anterior)."""
    out: dict = {}
    for fuente in ("morningstar_lt", "cssf", "amf_geco", "_anterior"):
        for k, v in ((previo.get(fuente) or {}).get("identificacion") or {}).items():
            if v not in (None, "") and k not in out:
                out[k] = v
    return out


def pistas_de(previo: dict) -> str:
    """Texto con todo lo que se sabe de la gestora antes de descargar nada."""
    ms = (previo.get("morningstar_lt") or {}).get("identificacion") or {}
    cssf = (previo.get("cssf") or {}).get("identificacion") or {}
    anterior = (previo.get("_anterior") or {}).get("identificacion") or {}
    trozos = [ms.get("gestora"), ms.get("nombre"), cssf.get("nombre_legal_registro"),
              cssf.get("paraguas_legal"), anterior.get("gestora"), anterior.get("gestora_legal"),
              anterior.get("nombre"), anterior.get("productor_kid")]
    return _norm(" | ".join(t for t in trozos if t))


def candidatas(pistas: str) -> list[Fuente]:
    """Fuentes a probar, en orden: las de la gestora que casa y después el espejo."""
    propias = [f for f in FUENTES if f.marcas and f.casa(pistas)]
    return propias + [f for f in FUENTES if not f.marcas]


def _kid_ya_oficial(previo: dict) -> str | None:
    for fuente in ("cnmv_ficha", "amf_geco"):
        if ((previo.get(fuente) or {}).get("riesgo") or {}).get("sri_kid_1a7") is not None:
            return fuente
    return None


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None, previo: dict | None = None) -> dict:
    previo = previo or {}
    isin = isin.upper()
    if isin.startswith("ES"):
        return {}
    otra = _kid_ya_oficial(previo)
    if otra:
        log.debug("KID %s: ya lo aporta %s", isin, otra)
        return {}
    base = Path(base) if base else Path(".")
    carpeta = base / "cache" / "kid" / "gestoras"
    pistas = pistas_de(previo)
    ident = identificacion_de(previo)
    # Sin red, una candidata sin caché no corta la búsqueda: la ficha de la
    # gestora que respondió 4xx no se cachea, pero el PDF del espejo que sí
    # sirvió está en disco (14-10-2026: la regeneración sin red perdió el KID
    # de 5 fondos Candriam que venía de deutsche_bank_es). Solo si ninguna
    # candidata da el KID se propaga la falta de caché al núcleo.
    sin_cache: SinCache | None = None
    for fuente in candidatas(pistas):
        try:
            urls = _urls(fuente, isin, ident, http, force)
        except SinCache as e:
            sin_cache = sin_cache or e
            continue
        except Exception as e:  # noqa: BLE001 - la siguiente fuente puede servir
            log.info("KID %s %s: %s", isin, fuente.id, e)
            continue
        for url in urls:
            try:
                pdf = _pdf(fuente, isin, url, http, carpeta, force)
            except SinCache as e:
                sin_cache = sin_cache or e
                continue
            if pdf is None:
                continue
            out = _lee(fuente, isin, url, pdf)
            if out:
                return out
    if sin_cache is not None:
        raise sin_cache
    log.info("KID %s: ninguna fuente lo sirve (pistas: %s)", isin, pistas[:80])
    return {}


def _urls(fuente: Fuente, isin: str, ident: dict, http, force: bool) -> list[str]:
    if fuente.urls:
        return fuente.urls(isin, ident)
    r = http.get(fuente.pagina(isin), headers=fuente.cabeceras, force=force, familia=FAMILIA)
    if not r.ok:
        return []
    m = fuente.enlace(isin).search(r.text)
    return [fuente.base_enlace + m.group(1)] if m else []


def _destino(carpeta: Path, fuente: Fuente, isin: str, url: str) -> Path:
    sufijo = hashlib.sha1(url.encode("utf-8"), usedforsecurity=False).hexdigest()[:8]
    return carpeta / fuente.id / f"{isin}_{sufijo}.pdf"


def _pdf(fuente: Fuente, isin: str, url: str, http, carpeta: Path, force: bool) -> Path | None:
    """PDF del KID en caché o descargado; None si la fuente no lo tiene."""
    destino = _destino(carpeta, fuente, isin, url)
    miss = destino.with_suffix(".miss")
    ttl = http.ttl_para(FAMILIA)
    ahora = time.time()
    if destino.exists() and destino.stat().st_size > 0:
        edad = (ahora - destino.stat().st_mtime) / 86400
        if not force and edad <= ttl:
            http._anota("cache", url, FAMILIA)
            return destino
        if getattr(http, "sin_red", False):
            return destino          # caducado pero vale más que nada
        nuevo = _descarga(fuente, url, destino, http, force=True)
        return nuevo or destino     # si la red falla, el PDF viejo sigue siendo el KID
    if miss.exists() and not force:
        try:
            edad_miss = (ahora - float(miss.read_text().strip() or 0)) / 86400
        except ValueError:
            edad_miss = 0.0
        if edad_miss <= NEGATIVO_DIAS or ttl == float("inf"):
            return None
    if getattr(http, "sin_red", False):
        return None
    pdf = _descarga(fuente, url, destino, http, force=force)
    if pdf is None:
        miss.parent.mkdir(parents=True, exist_ok=True)
        miss.write_text(str(ahora))
    elif miss.exists():
        miss.unlink()
    return pdf


def _descarga(fuente: Fuente, url: str, destino: Path, http, force: bool) -> Path | None:
    try:
        ruta = http.download(url, destino, force=force, headers=fuente.cabeceras,
                             opcional=True, familia=FAMILIA)
    except SinCache:
        raise
    except Exception as e:  # noqa: BLE001
        log.info("KID %s: no descargado (%s)", url[:90], e)
        return None
    if ruta is None:
        return None
    ruta = Path(ruta)
    with ruta.open("rb") as f:
        cabecera = f.read(5)
    if not cabecera.startswith(b"%PDF"):
        # Goldman Sachs devuelve HTML 200 cuando el documento no existe.
        ruta.unlink(missing_ok=True)
        return None
    return ruta


def _edad_dias(fecha_iso: str) -> float:
    import datetime as _dt
    try:
        f = _dt.date.fromisoformat(fecha_iso)
    except ValueError:
        return 0.0
    return (_dt.date.today() - f).days


def _lee(fuente: Fuente, isin: str, url: str, pdf: Path) -> dict:
    try:
        datos = kid.parsea_pdf(pdf, isin)
    except Exception as e:  # noqa: BLE001
        log.warning("KID %s (%s): no parseable (%s)", isin, fuente.id, e)
        return {}
    if datos.get("isin") and datos["isin"] != isin:
        log.warning("KID %s (%s): el PDF habla de %s; no lo uso", isin, fuente.id, datos["isin"])
        return {}
    if datos.get("priips") is False:
        log.warning("KID %s (%s): no es un KID PRIIPs (¿KIID UCITS antiguo?); no lo uso", isin, fuente.id)
        return {}
    fecha = datos.get("fecha_documento")
    if fecha and _edad_dias(fecha) > KID_MAX_DIAS:
        log.warning("KID %s (%s): documento de %s, caducado; no lo uso", isin, fuente.id, fecha)
        return {}
    if datos.get("sri") is None and not any(v is not None for v in (datos.get("costes") or {}).values()):
        log.warning("KID %s (%s): sin SRI ni costes legibles", isin, fuente.id)
        return {}
    out: dict = {}
    fetched = pdf.stat().st_mtime
    with procedencia.etapa(fuente.id, fetched, url=url, documento=datos.get("fecha_documento")):
        set_path(out, "riesgo.sri_kid_1a7", datos.get("sri"))
        set_path(out, "riesgo.kid_periodo_mantenimiento_anos", datos.get("periodo_mantenimiento_anos"))
        for k, v in (datos.get("costes") or {}).items():
            set_path(out, f"costes.kid.{k}", v)
        set_path(out, "costes.kid.fecha", datos.get("fecha_documento"))
        set_path(out, "costes.kid.idioma", datos.get("idioma"))
        set_path(out, "documentos_oficiales.kid_url", url)
        set_path(out, "documentos_oficiales.kid_fuente", fuente.id)
        set_path(out, "documentos_oficiales.kid_fecha", datos.get("fecha_documento"))
        set_path(out, "documentos_oficiales.kid_sha256", datos.get("texto_sha256"))
        set_path(out, "identificacion.productor_kid", datos.get("productor"))
        set_path(out, "identificacion.fecha_lanzamiento_kid", datos.get("fecha_lanzamiento"))
        set_path(out, "esg.sfdr_articulo", datos.get("sfdr_articulo"))
    return out
