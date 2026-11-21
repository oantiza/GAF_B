"""Fuente CNMV, ficha oficial del fondo y su KID (solo ISIN ES).

La CNMV publica por cada fondo español una ficha con los datos del registro
oficial (nº y fecha de registro, si es armonizado —UCITS—, gestora y
depositaria) y enlaza el documento de datos fundamentales (KID/PRIIPs) que la
gestora deposita. Es la fuente primaria del indicador resumido de riesgo (SRI)
y de la composición de costes; hasta el 04-09 ambos llegaban solo por
Morningstar.

Tres o cuatro peticiones por fondo, todas de la familia regulatorio (90 días):

1. `consultas/iic/fondo.aspx?isin=ES...`  ficha (HTML)
2. si el fondo tiene compartimentos o varias clases, la vista donde está la
   fila de nuestro ISIN (`vista=2` compartimentos, `vista=3&com=N` clases),
   que trae el KID de la clase y su fecha de alta
3. el PDF del KID enlazado (se guarda en cache/kid/)
4. `ancv/isin.aspx?isin=ES...`            fecha de emisión del ISIN (ANCV)

Todo lo que se escribe lleva su procedencia (`cnmv_ficha:ficha`,
`cnmv_ficha:kid`, `cnmv_ficha:ancv`). El KID se parsea con `core.kid`.
"""
from __future__ import annotations

import hashlib
import html as html_mod
import logging
import re
from pathlib import Path

from core import kid
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.cnmv_ficha")

FICHA = "https://www.cnmv.es/portal/consultas/iic/fondo.aspx"
BASE_IIC = "https://www.cnmv.es/portal/consultas/iic/"
ANCV = "https://www.cnmv.es/portal/ancv/isin.aspx"
CABECERAS = {"Referer": "https://www.cnmv.es/portal/home.aspx"}
FAMILIA = "regulatorio"


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None, previo: dict | None = None) -> dict:
    if not isin.upper().startswith("ES"):
        return {}
    previo = previo or {}
    base = Path(base) if base else Path(__file__).resolve().parent.parent
    out: dict = {}

    r = http.get(FICHA, params={"isin": isin}, headers=CABECERAS, force=force, familia=FAMILIA)
    if not r.ok:
        log.info("CNMV ficha %s: HTTP %s", isin, r.status)
        return {}
    ficha = parsea_ficha(r.text)
    if not ficha.get("registro"):
        log.info("CNMV ficha %s: sin datos de registro (¿no es un fondo?)", isin)
        return {}
    if not ficha.get("dfi_url"):
        # Fondo con compartimentos o varias clases: la fila del ISIN está en otra vista.
        clase = _busca_clase(isin, ficha, http, force, previo)
        if clase:
            ficha.update({k: v for k, v in clase.items() if v})
    with procedencia.etapa("ficha", r.fetched_at, url=f"{FICHA}?isin={isin}"):
        set_path(out, "identificacion.registro_cnmv", ficha.get("registro"))
        set_path(out, "identificacion.fecha_alta_clase_cnmv", ficha.get("fecha_alta_clase"))
        set_path(out, "identificacion.compartimento_cnmv", ficha.get("compartimento"))
        set_path(out, "identificacion.clase_cnmv", ficha.get("clase"))
        set_path(out, "identificacion.fecha_registro_cnmv", ficha.get("fecha_registro"))
        set_path(out, "identificacion.ucits", ficha.get("armonizado"))
        set_path(out, "identificacion.domicilio", "ESP")
        set_path(out, "identificacion.gestora_legal", ficha.get("gestora"))
        set_path(out, "identificacion.gestora_registro_cnmv", ficha.get("gestora_registro"))
        set_path(out, "identificacion.depositario", ficha.get("depositaria"))
        set_path(out, "identificacion.fecha_ultimo_folleto", ficha.get("fecha_folleto"))
        set_path(out, "documentos_oficiales.kid_url", ficha.get("dfi_url"))
        set_path(out, "documentos_oficiales.fecha_folleto", ficha.get("fecha_folleto"))

    if ficha.get("dfi_url"):
        _kid(isin, ficha["dfi_url"], http, base, force, out)

    _ancv(isin, http, force, out)
    return out


# ------------------------------------------------------------------- ficha
def _texto(fragmento: str) -> str:
    return html_mod.unescape(re.sub(r"<[^>]+>", " ", fragmento))


def _celda(fila: str, etiqueta: str) -> str | None:
    m = re.search(r'<td[^>]*data-th="' + re.escape(etiqueta) + r'"[^>]*>(.*?)</td>', fila, re.S)
    if not m:
        return None
    return re.sub(r"\s+", " ", _texto(m.group(1))).strip() or None


def _fecha(v: str | None) -> str | None:
    if not v:
        return None
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def parsea_ficha(html: str) -> dict:
    """Datos del registro oficial de la ficha `fondo.aspx`."""
    out: dict = {}
    tabla = re.search(r'<table[^>]*id="ctl00_ContentPrincipal_gridDatos"[^>]*>(.*?)</table>', html, re.S)
    if tabla:
        cuerpo = tabla.group(1)
        caption = re.search(r"<caption>(.*?)</caption>", cuerpo, re.S)
        if caption:
            texto = _texto(caption.group(1)).lower()
            if "armonizado" in texto:
                out["armonizado"] = "no armonizado" not in texto
        fila = re.search(r"<tbody>(.*?)</tbody>", cuerpo, re.S)
        fila = fila.group(1) if fila else cuerpo
        out["registro"] = _celda(fila, "Nº Registro oficial") or _celda(fila, "Nº Registro oficial")
        out["fecha_registro"] = _fecha(_celda(fila, "Fecha registro oficial"))
        out["fecha_folleto"] = _fecha(_celda(fila, "Fecha último folleto"))
        m = re.search(r'data-th="DFI[^"]*"[^>]*>.*?href="([^"]+verdocumento[^"]+)"', fila, re.S)
        if m:
            out["dfi_url"] = html_mod.unescape(m.group(1))
        m = re.search(r'data-th="ISIN"[^>]*>.*?([A-Z]{2}[A-Z0-9]{9}\d)', fila, re.S)
        if m:
            out["isin"] = m.group(1)
    out["vistas"] = _vistas(html)
    for bloque, clave in (("Gestora", "gestora"), ("Depositaria", "depositaria")):
        m = re.search(r"<h[2-4][^>]*>\s*" + bloque + r"\s*</h[2-4]>(.*?)(?:<h[2-4]|</div>\s*</div>)",
                      html, re.S)
        seg = m.group(1) if m else None
        if not seg:
            # Sin cabecera: buscar la tabla cuyo caption o thead nombre el bloque
            m = re.search(r"<table[^>]*>(?:(?!</table>).)*?" + bloque + r"(?:(?!</table>).)*</table>",
                          html, re.S)
            seg = m.group(0) if m else ""
        fila = re.search(r"<tbody>(.*?)</tbody>", seg, re.S)
        if fila:
            out[clave] = _celda(fila.group(1), "Denominación")
            out[f"{clave}_registro"] = _celda(fila.group(1), "Nº Registro oficial")
    return out


# ------------------------------------------------------ compartimentos / clases
def _vistas(html: str) -> list[tuple[str, str]]:
    """[(url relativa, título)] de las pestañas de la ficha."""
    return [(html_mod.unescape(u).replace(" &", "&"), html_mod.unescape(t).strip())
            for u, t in re.findall(r'<a[^>]+href="(fondo\.aspx\?nif=[^"]+)"[^>]*>\s*([^<]+?)\s*</a>', html)]


def _fila_isin(html: str, isin: str) -> dict | None:
    """Datos de la fila (compartimento o clase) cuyo ISIN es el buscado."""
    for m in re.finditer(r"<tr\b[^>]*>.*?</tr>", html, re.S):
        fila = m.group(0)
        if isin.upper() not in fila.upper():
            continue
        dfi = re.search(r'data-th="DFI[^"]*"[^>]*>.*?href="([^"]+verdocumento[^"]+)"', fila, re.S)
        return {
            "dfi_url": html_mod.unescape(dfi.group(1)) if dfi else None,
            "fecha_alta_clase": _fecha(_celda(fila, "Fecha alta")),
            "denominacion_fila": _celda(fila, "Denominación"),
            "numero_fila": _celda(fila, "Nº"),
        }
    return None


def _busca_clase(isin: str, ficha: dict, http, force: bool, previo: dict) -> dict | None:
    vistas = ficha.get("vistas") or []
    comp_n = str(((previo.get("cnmv") or {}).get("identificacion") or {})
                 .get("numero_compartimento_cnmv") or "").strip()
    candidatas: list[tuple[str, str]] = []
    for url, titulo in vistas:
        t = titulo.lower()
        if "clases" in t:
            candidatas.append((url, "clase"))
        elif "compartimento" in t:
            candidatas.append((url, "compartimento"))
    if not candidatas:
        return None
    for url, tipo in candidatas:
        try:
            r = http.get(BASE_IIC + url, headers=CABECERAS, force=force, familia=FAMILIA)
        except Exception as e:  # noqa: BLE001
            log.debug("CNMV vista %s %s: %s", url, isin, e)
            continue
        if not r.ok:
            continue
        fila = _fila_isin(r.text, isin)
        if fila:
            if tipo == "compartimento":
                fila["compartimento"] = fila.pop("denominacion_fila", None)
            else:
                fila["clase"] = fila.pop("denominacion_fila", None)
            fila.pop("numero_fila", None)
            return fila
        if tipo == "compartimento":
            # compartimento con varias clases: su vista de clases (com=N)
            numeros = [comp_n] if comp_n else _compartimentos_sin_isin(r.text)
            for n in numeros:
                try:
                    r2 = http.get(BASE_IIC + re.sub(r"vista=\d+.*$", f"vista=3&com={n}", url),
                                  headers=CABECERAS, force=force, familia=FAMILIA)
                except Exception:  # noqa: BLE001
                    continue
                fila = _fila_isin(r2.text, isin) if r2.ok else None
                if fila:
                    fila["clase"] = fila.pop("denominacion_fila", None)
                    fila.pop("numero_fila", None)
                    comp = _fila_compartimento(r.text, n)
                    if comp:
                        fila["compartimento"] = comp
                    return fila
    return None


def _compartimentos_sin_isin(html: str) -> list[str]:
    """Números de compartimento cuyas filas no llevan ISIN (tienen clases)."""
    out = []
    for m in re.finditer(r"<tr\b[^>]*>.*?</tr>", html, re.S):
        fila = m.group(0)
        if 'data-th="Nº"' in fila and not RE_ISIN_ES.search(fila):
            n = _celda(fila, "Nº")
            if n and n.isdigit():
                out.append(n)
    return out


def _fila_compartimento(html: str, numero: str) -> str | None:
    for m in re.finditer(r"<tr\b[^>]*>.*?</tr>", html, re.S):
        fila = m.group(0)
        if _celda(fila, "Nº") == numero:
            return _celda(fila, "Denominación")
    return None


RE_ISIN_ES = re.compile(r"ES[A-Z0-9]{9}\d")


# --------------------------------------------------------------------- KID
def _kid(isin: str, url: str, http, base: Path, force: bool, out: dict) -> None:
    carpeta = base / "cache" / "kid" / "cnmv"
    nombre = hashlib.sha1(url.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]
    destino = carpeta / f"{isin}_{nombre}.pdf"
    try:
        if getattr(http, "sin_red", False) and not destino.exists():
            log.info("KID %s: no está en caché y no hay red", isin)
            return
        http.download(url, destino, force=force)
    except Exception as e:  # noqa: BLE001
        log.warning("KID %s: no descargado (%s)", isin, e)
        return
    try:
        datos = kid.parsea_pdf(destino, isin)
    except Exception as e:  # noqa: BLE001
        log.warning("KID %s: no parseable (%s)", isin, e)
        return
    if datos.get("isin") and datos["isin"] != isin.upper():
        log.warning("KID %s: el PDF habla de %s; no lo uso", isin, datos["isin"])
        set_path(out, "documentos_oficiales.kid_isin_discrepante", datos["isin"])
        return
    fetched = destino.stat().st_mtime
    with procedencia.etapa("kid", fetched, url=url, documento=datos.get("fecha_documento")):
        set_path(out, "riesgo.sri_kid_1a7", datos.get("sri"))
        set_path(out, "riesgo.kid_periodo_mantenimiento_anos", datos.get("periodo_mantenimiento_anos"))
        costes = datos.get("costes") or {}
        for k, v in costes.items():
            set_path(out, f"costes.kid.{k}", v)
        set_path(out, "costes.kid.fecha", datos.get("fecha_documento"))
        set_path(out, "costes.kid.idioma", datos.get("idioma"))
        set_path(out, "documentos_oficiales.kid_fecha", datos.get("fecha_documento"))
        set_path(out, "documentos_oficiales.kid_sha256", datos.get("texto_sha256"))
        set_path(out, "identificacion.productor_kid", datos.get("productor"))
        set_path(out, "identificacion.fecha_lanzamiento_kid", datos.get("fecha_lanzamiento"))
        set_path(out, "esg.sfdr_articulo", datos.get("sfdr_articulo"))


# -------------------------------------------------------------------- ANCV
def _ancv(isin: str, http, force: bool, out: dict) -> None:
    try:
        r = http.get(ANCV, params={"isin": isin}, headers=CABECERAS, force=force, familia="identidad")
    except Exception as e:  # noqa: BLE001
        log.debug("ANCV %s: %s", isin, e)
        return
    if not r.ok:
        return
    datos = parsea_ancv(r.text, isin)
    if not datos:
        return
    with procedencia.etapa("ancv", r.fetched_at, url=f"{ANCV}?isin={isin}"):
        set_path(out, "identificacion.fecha_emision_isin", datos.get("fecha_emision"))
        set_path(out, "identificacion.fisn", datos.get("fisn"))
        set_path(out, "identificacion.cfi", datos.get("cfi"))


def parsea_ancv(html: str, isin: str) -> dict:
    """Fila de la tabla de códigos ISIN de la ANCV: ISIN | FISN | Fecha emisión | Nominal | Moneda | CFI."""
    texto = re.sub(r"\s+", " ", _texto(html))
    m = re.search(re.escape(isin.upper()) + r"\s+(.*?)\s+(\d{1,2}/\d{1,2}/\d{4})\s+([\d.,]+)\s+([A-Z]{3})(?:\s+([A-Z]{6}))?", texto)
    if not m:
        return {}
    return {"fisn": m.group(1).strip() or None, "fecha_emision": _fecha(m.group(2)),
            "moneda": m.group(4), "cfi": m.group(5)}
