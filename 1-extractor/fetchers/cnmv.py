"""Fuente CNMV: ficheros oficiales de información individual de IIC.

Funciona en dos pasos:

1. `python main.py cnmv` (comando aparte, no por-fondo):
   - lee la página de descargas del año, localiza los ZIP mensuales
     (enlaces tokenizados verdocumento/ver), baja el del periodo pedido
     (o el último disponible) a cache/cnmv/,
   - lo descomprime y recorre todos los XML buscando los ISIN de
     config/fondos.csv; el bloque XML completo de cada fondo se convierte a
     dict y se guarda en cache/cnmv/parsed/{ISIN}.json (¡crudo íntegro!).

2. La fuente "cnmv" del update normal lee ese parsed/{ISIN}.json y mapea al
   esquema lo que reconoce (VL, patrimonio, partícipes, comisiones, TER...).
   El mapeo es tolerante (busca claves por contenido, sin acentos) porque el
   esquema exacto de la Circular 4/2008 se afina con el primer ZIP real.

Mensual: datos básicos (VL, patrimonio, partícipes). Trimestral (los ZIP de
marzo, junio, septiembre y diciembre, publicados con retraso): además
comisiones devengadas, TER, vocación, rentabilidad y volatilidad por
trimestre (FONDTRIM), rotación y patrimonio (FONDPATRIMDISVAR) y la cartera
completa (FONDCART). FONDCART y FONDPATRIMDISVAR no llevan el ISIN de la
clase: se casan por (nº de registro, nº de compartimento) a partir de
FONDREGISTRO.

Desde el 04-09 el adaptador asegura por sí mismo que estén descargados el
último mensual y el último trimestral disponibles (`asegura_periodos`), y
mapea lo trimestral a `costes.cnmv.*`, `cartera.cnmv.*`, `rentabilidad.cnmv.*`
y `riesgo.cnmv.*` (dato oficial, con procedencia propia) sin pisar lo que
Morningstar ya da en las rutas comunes.

Desde el 13-10 la comprobación es por ISIN: un alta posterior al proceso del
periodo lo recibe releyendo el ZIP local solo para ella, sin tocar los parsed
de los demás. Los ISIN que no figuran en un ZIP se anotan en
cache/cnmv/{periodo}_ausentes.json para no releerlo en cada pasada.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
import unicodedata
import zipfile
from pathlib import Path

from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException

from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.cnmv")

FICHEROS_TRIMESTRALES = ("FONDTRIM", "FONDCART", "FONDPATRIMDISVAR", "FONDDERI")
# ISIN ya comprobados en este proceso: la comprobación cuesta una petición
# (la página de descargas, cacheada 30 días) y se hace una vez por pasada.
_ASEGURADOS: set[str] = set()

PAGINA_ACTUAL = ("https://www.cnmv.es/portal/publicaciones/"
                 "descarga-informacion-individual?lang=es")
PAGINA_EJERCICIO = ("https://www.cnmv.es/portal/publicaciones/"
                    "descarga-informacion-individual.aspx?ejercicio={ano}")
MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5,
         "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9,
         "octubre": 10, "noviembre": 11, "diciembre": 12}
RE_ISIN = re.compile(r"\bES[A-Z0-9]{9}[0-9]\b")


# ============================================================ paso 1: comando
def descarga_y_procesa(http, base: Path, isins: set[str],
                       ano: int | None = None, mes: int | None = None,
                       force: bool = False) -> dict:
    """Baja el ZIP del periodo y extrae los bloques de los ISIN pedidos."""
    cache = base / "cache" / "cnmv"
    cache.mkdir(parents=True, exist_ok=True)

    hoy = dt.date.today()
    url_pagina = (PAGINA_EJERCICIO.format(ano=ano)
                  if ano and ano != hoy.year else PAGINA_ACTUAL)
    r = http.get(url_pagina, ttl_dias=1, force=force, familia="regulatorio")
    enlaces = _extrae_enlaces(r.text)
    if not enlaces:
        raise RuntimeError("No encuentro enlaces de descarga en la página CNMV "
                           "(¿cambió el HTML? mira logs)")
    log.info("CNMV %s: meses disponibles %s",
             ano or hoy.year, sorted(enlaces))
    if mes is not None and mes not in enlaces:
        disponibles = ", ".join(f"{m:02d}" for m in sorted(enlaces))
        raise RuntimeError(
            f"CNMV: el mes pedido {mes:02d}/{ano or hoy.year} no existe. "
            f"Meses disponibles: {disponibles or 'ninguno'}."
        )
    n_mes = mes if mes is not None else max(enlaces)
    url_zip = enlaces[n_mes]
    periodo = f"{ano or hoy.year}-{n_mes:02d}"

    destino = cache / f"{periodo}.zip"
    http.download(url_zip, destino, force=force)
    return procesa_zip(base, destino, periodo, isins)


def procesa_zip(base: Path, destino: Path, periodo: str, isins: set[str]) -> dict:
    """Recorre un ZIP CNMV ya descargado y añade el periodo al parsed de los
    ISIN pedidos. Solo toca los parsed de esos ISIN: los demás no se reescriben."""
    cache = base / "cache" / "cnmv"
    parsed_dir = cache / "parsed"
    parsed_dir.mkdir(exist_ok=True)
    resultado: dict[str, dict] = {i: {} for i in isins}
    inventario = []
    with zipfile.ZipFile(destino) as z:
        nombres = z.namelist()
        # 1) ficheros con ISIN (registro, mensual, trimestral por clase)
        for nombre in nombres:
            inventario.append(nombre)
            if not nombre.lower().endswith(".xml"):
                continue
            if Path(nombre).name.upper().split("_")[0] in ("FONDCART", "FONDPATRIMDISVAR", "FONDDERI",
                                                            "SOCCART", "SOCPATRIMDISVAR", "SOCDERI"):
                continue
            try:
                with z.open(nombre) as fh:
                    encontrados = _busca_isins_en_xml(fh, isins)
                for isin, bloques in encontrados.items():
                    resultado[isin].setdefault(Path(nombre).name, []).extend(bloques)
            except Exception as e:
                log.warning("CNMV: error parseando %s: %s", nombre, e)
        # 2) ficheros sin ISIN, casados por (registro, compartimento) vía FONDREGISTRO
        claves = _claves_registro(resultado)
        if claves:
            for nombre in nombres:
                base_n = Path(nombre).name.upper()
                if not nombre.lower().endswith(".xml") or base_n.split("_")[0] not in (
                        "FONDCART", "FONDPATRIMDISVAR", "FONDDERI"):
                    continue
                try:
                    with z.open(nombre) as fh:
                        encontrados = _busca_claves_en_xml(fh, claves)
                    for isin, bloques in encontrados.items():
                        resultado[isin].setdefault(Path(nombre).name, []).extend(bloques)
                except Exception as e:
                    log.warning("CNMV: error parseando %s: %s", nombre, e)

    (cache / f"{periodo}_inventario.json").write_text(
        json.dumps(inventario, ensure_ascii=False, indent=1), encoding="utf-8")

    n_con_datos = 0
    for isin, por_fichero in resultado.items():
        if not por_fichero:
            continue
        n_con_datos += 1
        ruta = parsed_dir / f"{isin}.json"
        previo = {}
        if ruta.exists():
            try:
                previo = json.loads(ruta.read_text(encoding="utf-8"))
            except Exception:
                previo = {}
        previo[periodo] = por_fichero
        ruta.write_text(json.dumps(previo, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    _anota_ausentes(cache, periodo,
                    con_datos={i for i, f in resultado.items() if f},
                    sin_datos={i for i, f in resultado.items() if not f})
    log.info("CNMV %s: %s/%s ISINs con datos; crudos en cache/cnmv/parsed/",
             periodo, n_con_datos, len(isins))
    return {"periodo": periodo, "isins_con_datos": n_con_datos,
            "ficheros_zip": len(inventario)}


def _claves_registro(resultado: dict[str, dict]) -> dict[tuple[str, str], str]:
    """(NumeroRegistro, NumeroCompartimento) -> ISIN, leído de FONDREGISTRO."""
    claves: dict[tuple[str, str], str] = {}
    for isin, por_fichero in resultado.items():
        for fichero, bloques in por_fichero.items():
            if "REGISTRO" not in fichero.upper():
                continue
            for bloque in bloques:
                ent = bloque.get("Entidad") or bloque
                registro = str(ent.get("NumeroRegistro") or "")
                for comp in _lista_(ent.get("Compartimento")):
                    for clase in _lista_(comp.get("Clase")):
                        if str(clase.get("ISIN", "")).upper() == isin.upper():
                            claves[(registro, str(comp.get("NumeroCompartimento") or "0"))] = isin
    return claves


def _busca_claves_en_xml(fh, claves: dict[tuple[str, str], str]) -> dict[str, list]:
    """Bloques Entidad cuyo (registro, compartimento) esté entre las claves; el
    bloque se recorta al compartimento que corresponde a cada ISIN."""
    encontrados: dict[str, list] = {}
    registros = {r for r, _c in claves}
    try:
        contexto = ET.iterparse(fh, events=("start", "end"))
        _, root = next(contexto)
        for evento, elem in contexto:
            if evento == "end" and elem in list(root):
                reg = elem.find("NumeroRegistro")
                numero = (reg.text or "").strip() if reg is not None else ""
                if numero in registros:
                    bloque = _xml_a_dict(elem)
                    ent = bloque.get("Entidad") or bloque
                    for comp in _lista_(ent.get("Compartimento")):
                        isin = claves.get((numero, str(comp.get("NumeroCompartimento") or "0")))
                        if isin:
                            recorte = {k: v for k, v in ent.items() if k != "Compartimento"}
                            recorte["Compartimento"] = comp
                            encontrados.setdefault(isin, []).append({"Entidad": recorte})
                root.remove(elem)
    except (ET.ParseError, DefusedXmlException) as e:
        log.debug("XML no parseable: %s", e)
    return encontrados


def asegura_periodos(http, base: Path, isins: set[str], force: bool = False) -> dict:
    """Garantiza en cache/cnmv/parsed el último mensual y el último trimestral.

    Se decide por ISIN: un fondo dado de alta después de procesar un periodo
    para el resto del universo recibe ese periodo releyendo el ZIP local (sin
    volver a bajarlo) solo para él. Cada ISIN se comprueba una vez por proceso.
    Sin red, se queda con lo que haya.
    """
    isins = {i.strip().upper() for i in isins if i.strip().upper().startswith("ES")}
    pendientes = isins if force else isins - _ASEGURADOS
    if not pendientes:
        return {}
    _ASEGURADOS.update(pendientes)
    if getattr(http, "sin_red", False):
        return {}
    hecho = {}
    try:
        hoy = dt.date.today()
        enlaces_hoy = _extrae_enlaces(http.get(PAGINA_ACTUAL, ttl_dias=30, familia="regulatorio").text)
        candidatos = [(hoy.year, m) for m in sorted(enlaces_hoy, reverse=True)]
        if len(candidatos) < 12:
            r_prev = http.get(PAGINA_EJERCICIO.format(ano=hoy.year - 1), ttl_dias=90,
                              familia="regulatorio")
            candidatos += [(hoy.year - 1, m) for m in sorted(_extrae_enlaces(r_prev.text), reverse=True)]
        parsed_dir = base / "cache" / "cnmv" / "parsed"
        # último mensual
        if candidatos:
            ano, mes = candidatos[0]
            periodo = _asegura_periodo(http, base, pendientes, ano, mes)
            if periodo:
                hecho["mensual"] = periodo
        # último trimestral con ficheros de detalle
        for ano, mes in candidatos:
            if mes % 3:
                continue
            periodo = f"{ano}-{mes:02d}"
            inventario = base / "cache" / "cnmv" / f"{periodo}_inventario.json"
            if inventario.exists():
                nombres = json.loads(inventario.read_text(encoding="utf-8"))
            else:
                nombres = [n for n in _inventario_zip(http, base, ano, mes)]
            if any(n.upper().startswith("FONDTRIM") for n in nombres):
                if not _tiene_trimestral(parsed_dir, periodo):
                    # periodo sin procesar o crudos del parser antiguo: relectura completa
                    hecho["trimestral"] = descarga_y_procesa(http, base, isins, ano=ano, mes=mes)["periodo"]
                else:
                    periodo = _asegura_periodo(http, base, pendientes, ano, mes)
                    if periodo:
                        hecho["trimestral"] = periodo
                break
    except Exception as e:  # noqa: BLE001
        log.warning("CNMV asegura_periodos: %s", e)
    return hecho


def _asegura_periodo(http, base: Path, isins: set[str], ano: int, mes: int) -> str | None:
    """Procesa el periodo solo para los ISIN que aún no lo tienen; reutiliza el
    ZIP de cache/cnmv/ si ya está y solo lo descarga si falta."""
    periodo = f"{ano}-{mes:02d}"
    cache = base / "cache" / "cnmv"
    faltan = _sin_periodo(cache, isins, periodo)
    if not faltan:
        return None
    log.info("CNMV %s: %s ISIN sin el periodo (%s)", periodo, len(faltan),
             ", ".join(sorted(faltan)[:5]) + ("..." if len(faltan) > 5 else ""))
    destino = cache / f"{periodo}.zip"
    if destino.exists() and destino.stat().st_size > 0:
        return procesa_zip(base, destino, periodo, faltan)["periodo"]
    return descarga_y_procesa(http, base, faltan, ano=ano, mes=mes)["periodo"]


def _sin_periodo(cache: Path, isins: set[str], periodo: str) -> set[str]:
    """ISIN cuyo parsed no trae el periodo, salvo los que ya se buscaron en su
    ZIP sin encontrarse (no obligan a releerlo en cada pasada)."""
    ausentes = _lee_ausentes(cache, periodo)
    faltan = set()
    for isin in isins - ausentes:
        ruta = cache / "parsed" / f"{isin}.json"
        try:
            tiene = ruta.exists() and periodo in json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            tiene = False
        if not tiene:
            faltan.add(isin)
    return faltan


def _lee_ausentes(cache: Path, periodo: str) -> set[str]:
    ruta = cache / f"{periodo}_ausentes.json"
    try:
        return set(json.loads(ruta.read_text(encoding="utf-8")))
    except Exception:  # noqa: BLE001
        return set()


def _anota_ausentes(cache: Path, periodo: str, con_datos: set[str],
                    sin_datos: set[str]) -> None:
    """Registra los ISIN buscados en el ZIP del periodo que no figuran en él."""
    ausentes = (_lee_ausentes(cache, periodo) - con_datos) | sin_datos
    (cache / f"{periodo}_ausentes.json").write_text(
        json.dumps(sorted(ausentes), ensure_ascii=False, indent=1), encoding="utf-8")


def _inventario_zip(http, base: Path, ano: int, mes: int) -> list[str]:
    hoy = dt.date.today()
    url_pagina = PAGINA_EJERCICIO.format(ano=ano) if ano != hoy.year else PAGINA_ACTUAL
    enlaces = _extrae_enlaces(http.get(url_pagina, ttl_dias=30, familia="regulatorio").text)
    if mes not in enlaces:
        return []
    destino = base / "cache" / "cnmv" / f"{ano}-{mes:02d}.zip"
    http.download(enlaces[mes], destino)
    with zipfile.ZipFile(destino) as z:
        return z.namelist()


def _tiene_trimestral(parsed_dir: Path, periodo: str) -> bool:
    """True si los crudos del periodo traen el detalle trimestral completo.

    El parser anterior al 04-09 no casaba FONDCART (no lleva ISIN): si algún
    fondo tiene FONDTRIM sin FONDCART para el periodo, hay que releer el ZIP.
    """
    con_trim = con_cart = 0
    for ruta in parsed_dir.glob("*.json"):
        try:
            d = json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        ficheros = {f.upper().split("_")[0] for f in (d.get(periodo) or {})}
        con_trim += "FONDTRIM" in ficheros
        con_cart += "FONDCART" in ficheros
    return con_trim > 0 and con_cart >= con_trim * 0.9


def _extrae_enlaces(html: str) -> dict[int, str]:
    """{nº mes: url} de los anclajes verdocumento/ver de la página."""
    enlaces = {}
    for m in re.finditer(r"<a\b[^>]*>", html, re.I):
        tag = m.group(0)
        if "verdocumento/ver" not in tag:
            continue
        href = re.search(r'href="([^"]+)"', tag)
        titulo = re.search(r'title="([^"]+)"', tag)
        if not href:
            continue
        nombre_mes = (titulo.group(1).strip().lower() if titulo else "")
        n = MESES.get(_sin_acentos(nombre_mes))
        if n:
            enlaces[n] = href.group(1).replace("&amp;", "&")
    return enlaces


def _busca_isins_en_xml(fh, isins: set[str]) -> dict[str, list]:
    """Recorre el XML por bloques de primer nivel; si un bloque contiene
    alguno de los ISIN buscados, lo convierte entero a dict."""
    encontrados: dict[str, list] = {}
    try:
        contexto = ET.iterparse(fh, events=("start", "end"))
        _, root = next(contexto)  # raíz
        for evento, elem in contexto:
            if evento == "end" and elem in list(root):
                texto = " ".join(elem.itertext())
                presentes = {i for i in isins if i in texto}
                if presentes:
                    bloque = _xml_a_dict(elem)
                    for i in presentes:
                        encontrados.setdefault(i, []).append(bloque)
                root.remove(elem)  # libera memoria
    except (ET.ParseError, DefusedXmlException) as e:
        log.debug("XML no parseable: %s", e)
    return encontrados


def _xml_a_dict(elem) -> dict:
    nodo: dict = {}
    if elem.attrib:
        nodo["@atributos"] = dict(elem.attrib)
    hijos = list(elem)
    if not hijos:
        texto = (elem.text or "").strip()
        return {_tag(elem): texto} if not nodo else {_tag(elem): texto, **nodo}
    for h in hijos:
        sub = _xml_a_dict(h)
        for k, v in sub.items():
            if k in nodo:
                if not isinstance(nodo[k], list):
                    nodo[k] = [nodo[k]]
                nodo[k].append(v)
            else:
                nodo[k] = v
    return {_tag(elem): nodo} if _tag(elem) not in nodo else nodo


def _tag(elem) -> str:
    return elem.tag.split("}")[-1]


# ========================================================== paso 2: fetcher
def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None) -> dict:
    """Lee cache/cnmv/parsed/{ISIN}.json (si existe) y mapea lo reconocible."""
    if not isin.upper().startswith("ES"):
        return {}
    if base is None:
        base = Path(__file__).resolve().parent.parent
    ruta = base / "cache" / "cnmv" / "parsed" / f"{isin}.json"
    if not ruta.exists():
        log.info("CNMV: sin datos locales para %s (ejecuta antes "
                 "'python main.py cnmv')", isin)
        return {}
    try:
        periodos = json.loads(ruta.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("CNMV: no puedo leer %s: %s", ruta.name, e)
        return {}
    if not periodos:
        return {}
    ultimo = sorted(periodos)[-1]
    datos = periodos[ultimo]
    trimestral = max((p for p, fich in periodos.items()
                      if any(f.upper().startswith("FONDTRIM") for f in fich)), default=None)

    out: dict = {}
    with procedencia.etapa("zip_mensual", None, periodo=ultimo):
        set_path(out, "meta.cnmv_periodo", ultimo)
        for fichero, bloques in datos.items():
            nombre_f = fichero.upper()
            for bloque in bloques:
                try:
                    if "FONDMENS" in nombre_f:
                        _mapea_mensual(out, bloque, ultimo, isin)
                    elif "REGISTRO" in nombre_f:
                        _mapea_registro(out, bloque, isin)
                    elif nombre_f.split("_")[0] in FICHEROS_TRIMESTRALES:
                        continue  # se mapea abajo, desde el último trimestral
                    else:
                        _mapea_generico(out, bloque)
                        log.info("CNMV: fichero %s sin mapeo específico aún; "
                                 "aplicado mapeo genérico (crudo guardado)", fichero)
                except Exception as e:
                    log.warning("CNMV: mapeo de %s para %s: %s", fichero, isin, e)
    if trimestral:
        with procedencia.etapa("zip_trimestral", None, periodo=trimestral):
            set_path(out, "meta.cnmv_periodo_trimestral", trimestral)
            for fichero, bloques in periodos[trimestral].items():
                nombre_f = fichero.upper()
                for bloque in bloques:
                    try:
                        registro = str(((bloque.get("Entidad") or bloque).get("NumeroRegistro") or ""))
                        propio = str(out.get("identificacion", {}).get("registro_cnmv") or "")
                        if nombre_f.startswith("FONDTRIM"):
                            _mapea_trimestral(out, bloque, trimestral, isin)
                        elif propio and registro != propio:
                            # bloque de otra IIC (el parser antiguo casaba FONDCART por el
                            # texto del ISIN y guardaba la cartera del fondo que nos tiene)
                            continue
                        elif nombre_f.startswith("FONDPATRIMDISVAR"):
                            _mapea_patrimonio(out, bloque, trimestral)
                        elif nombre_f.startswith("FONDCART"):
                            _mapea_cartera(out, bloque, trimestral)
                    except Exception as e:
                        log.warning("CNMV: mapeo trimestral de %s para %s: %s", fichero, isin, e)
            _cierra_cartera(out, trimestral)
    _divisa_del_vl(out, ultimo, isin)
    from core.schema import cuenta_campos
    con, _tot = cuenta_campos(out)
    log.info("CNMV: %s campos mapeados para %s (crudo completo en "
             "cache/cnmv/parsed/)", con, isin)
    return out


def _divisa_del_vl(out: dict, periodo: str, isin: str) -> None:
    """El VL de FONDMENS viene siempre en euros.

    Lo dice el documento explicativo de la CNMV («los campos de valor liquidativo
    y patrimonio vienen en euros»; `VL_DiaN`: «Valor liquidativo del día N en
    euros»). La divisa de la clase (`CodigoDivisa`) solo está en el trimestral
    FONDTRIM, y su `ValorLiquidativo` sí va en ella. Caso real ES0164745004,
    clase en USD: FONDMENS da 91,6184 € y FONDTRIM 107,615 USD.

    - Clase en EUR, o sin trimestral que diga otra cosa: `vl_divisa` "EUR".
    - Clase en otra divisa: el VL en euros no compite por frescura con los de
      la divisa de la clase (los consumidores toman `vl_divisa` como divisa de
      la clase y de sus series). Se quitan `vl` y `vl_fecha` y el dato se queda
      en `valoracion.cnmv_fin_mes`.

    Revisión de la tercera pasada, IMP-B: hasta aquí se etiquetaba el VL en
    euros con la divisa de la clase."""
    valoracion = out.get("valoracion") or {}
    if valoracion.get("vl") is None:
        return
    divisa_clase = (valoracion.get("cnmv_trimestral") or {}).get("divisa")
    if divisa_clase and divisa_clase != "EUR":
        valoracion.pop("vl", None)
        valoracion.pop("vl_fecha", None)
        log.info("CNMV: %s es una clase en %s; su VL mensual (en euros) queda solo en "
                 "valoracion.cnmv_fin_mes", isin, divisa_clase)
        return
    with procedencia.etapa("zip_mensual", None, periodo=periodo):
        set_path(out, "valoracion.vl_divisa", "EUR")


def _clase_del_isin(bloque: dict, isin: str) -> dict:
    """Navega Entidad→Compartimento→Clase devolviendo la clase con ese ISIN
    (compartimentos/clases pueden ser dict o lista)."""
    ent = bloque.get("Entidad") or bloque
    for comp in _lista_(ent.get("Compartimento")):
        for clase in _lista_(comp.get("Clase")):
            if str(clase.get("ISIN", "")).upper() == isin.upper():
                return clase
    return {}


def _lista_(v):
    if isinstance(v, list):
        return [x for x in v if isinstance(x, dict)]
    return [v] if isinstance(v, dict) else []


def _serie_diaria(d: dict, prefijo: str) -> dict[int, float]:
    """{'VL_Dia7': '325.2'} -> {7: 325.2}"""
    out = {}
    for k, v in (d or {}).items():
        m = re.search(rf"{prefijo}_Dia(\d+)$", str(k), re.I)
        n = _a_numero(v) if m else None
        if m and isinstance(n, float):
            out[int(m.group(1))] = n
    return out


def _mapea_mensual(out: dict, bloque: dict, periodo: str, isin: str) -> None:
    ent = bloque.get("Entidad") or {}
    set_path(out, "identificacion.registro_cnmv", ent.get("NumeroRegistro"))
    clase = _clase_del_isin(bloque, isin)
    if not clase:
        return
    vl = _serie_diaria(clase.get("VLDiario"), "VL")
    pat = _serie_diaria(clase.get("PatrimonioDiario"), "Patrimonio")
    par = _serie_diaria(clase.get("ParticipesDiario"), "Participes")
    if vl:
        ultimo_dia = max(vl)
        fecha = f"{periodo}-{ultimo_dia:02d}"
        set_path(out, "valoracion.cnmv_fin_mes.vl", vl[ultimo_dia])
        set_path(out, "valoracion.cnmv_fin_mes.fecha", fecha)
        set_path(out, "valoracion.cnmv_fin_mes.divisa", "EUR")  # FONDMENS siempre en euros
        set_path(out, "valoracion.vl", vl[ultimo_dia])
        set_path(out, "valoracion.vl_fecha", fecha)
    if pat:
        set_path(out, "valoracion.cnmv_fin_mes.patrimonio_meur",
                 round(pat[max(pat)] / 1e6, 2))
        set_path(out, "valoracion.patrimonio_fondo_meur",
                 round(pat[max(pat)] / 1e6, 2))
    if par:
        set_path(out, "valoracion.cnmv_fin_mes.participes", int(par[max(par)]))
    # serie diaria oficial del mes -> bloque series
    dias = sorted(set(vl) | set(pat) | set(par))
    serie = [{"fecha": f"{periodo}-{d:02d}", "vl": vl.get(d),
              "patrimonio_eur": pat.get(d), "participes": par.get(d)}
             for d in dias]
    if serie:
        previo = out.get("series", {}).get("cnmv_diaria", [])
        fechas_previas = {p["fecha"] for p in previo}
        previo.extend(p for p in serie if p["fecha"] not in fechas_previas)
        set_path(out, "series.cnmv_diaria", sorted(previo, key=lambda x: x["fecha"]))


def _mapea_registro(out: dict, bloque: dict, isin: str | None = None) -> None:
    ent = bloque.get("Entidad") or {}
    set_path(out, "identificacion.registro_cnmv", ent.get("NumeroRegistro"))
    set_path(out, "identificacion.nombre", ent.get("Denominacion"))
    set_path(out, "identificacion.nombre_legal_cnmv", ent.get("Denominacion"))
    if str(ent.get("ETF", "")).upper() in ("SI", "SÍ", "NO"):
        set_path(out, "identificacion.es_etf_cnmv", str(ent.get("ETF")).upper() != "NO")
    if isin:
        for comp in _lista_(ent.get("Compartimento")):
            for clase in _lista_(comp.get("Clase")):
                if str(clase.get("ISIN", "")).upper() == isin.upper():
                    set_path(out, "identificacion.compartimento_cnmv",
                             comp.get("DenominacionCompartimento"))
                    set_path(out, "identificacion.numero_compartimento_cnmv",
                             str(comp.get("NumeroCompartimento") or "") or None)
                    set_path(out, "identificacion.clase_cnmv", clase.get("DenominacionClase"))
    ges = ent.get("Gestora") or {}
    set_path(out, "identificacion.gestora_legal", ges.get("DenominacionGestora"))
    set_path(out, "gestion.gestora.grupo",
             (ges.get("GrupoGestora") or {}).get("DenominacionGrupoGestora")
             if isinstance(ges.get("GrupoGestora"), dict) else None)
    dep = ent.get("Depositario") or {}
    set_path(out, "identificacion.depositario", dep.get("DenominacionDepositario"))


def _mapea_trimestral(out: dict, bloque: dict, periodo: str, isin: str) -> None:
    """FONDTRIM: comisiones devengadas en el periodo, TER trimestral, vocación,
    rentabilidad y volatilidad por trimestre. Los importes son del periodo de
    referencia (semestre en junio/diciembre, trimestre en marzo/septiembre)."""
    ent = bloque.get("Entidad") or bloque
    comp = next((c for c in _lista_(ent.get("Compartimento"))
                 if any(str(k.get("ISIN", "")).upper() == isin.upper() for k in _lista_(c.get("Clase")))),
                None)
    if not comp:
        return
    set_path(out, "identificacion.vocacion_cnmv", comp.get("VocacionInversora"))
    set_path(out, "identificacion.clase_fondo_cnmv", comp.get("ClaseFondo"))
    clase = next(k for k in _lista_(comp.get("Clase")) if str(k.get("ISIN", "")).upper() == isin.upper())
    semestral = int(periodo[-2:]) in (6, 12)
    set_path(out, "costes.cnmv.periodo", periodo)
    set_path(out, "costes.cnmv.periodo_meses", 6 if semestral else 3)
    set_path(out, "costes.cnmv.comision_gestion_periodo_pct", _num_o_none(clase.get("ComisionGestion")))
    set_path(out, "costes.cnmv.comision_deposito_periodo_pct", _num_o_none(clase.get("ComisionDepositario")))
    set_path(out, "costes.cnmv.base_comision_gestion", clase.get("BaseCalculo_ComisionGestion"))
    for destino, clave in (("comision_suscripcion_max_pct", "ComisionSuscripcionMaxima"),
                           ("comision_reembolso_max_pct", "ComisionReembolsoMaxima"),
                           ("descuento_favor_fondo_max_pct", "ComisionDescuentoFavorFondoMaxima")):
        set_path(out, f"costes.cnmv.{destino}", _num_o_none(clase.get(clave)))
    rtg = clase.get("RatioTotalGastos") or {}
    trimestres = [_num_o_none(rtg.get(k)) for k in ("RatioTotalGastos_TrimestreActual",
                                                    "RatioTotalGastos_T_1",
                                                    "RatioTotalGastos_T_2",
                                                    "RatioTotalGastos_T_3")]
    set_path(out, "costes.cnmv.ter_trimestre_pct", trimestres[0])
    if all(isinstance(v, float) for v in trimestres):
        set_path(out, "costes.cnmv.ter_12m_pct", round(sum(trimestres), 4))
    rent = clase.get("Rentabilidad") or {}
    for destino, clave in (("trimestre_actual", "Rentabilidad_TrimestreActual"),
                           ("t_1", "Rentabilidad_T_1"), ("t_2", "Rentabilidad_T_2"),
                           ("t_3", "Rentabilidad_T_3")):
        set_path(out, f"rentabilidad.cnmv.trimestral_pct.{destino}", _num_o_none(rent.get(clave)))
    vol = clase.get("Volatilidad_VL") or {}
    for destino, clave in (("trimestre_actual", "Volatilidad_TrimestreActual"),
                           ("t_1", "Volatilidad_T_1"), ("t_2", "Volatilidad_T_2"),
                           ("t_3", "Volatilidad_T_3")):
        set_path(out, f"riesgo.cnmv.volatilidad_trimestral_pct.{destino}", _num_o_none(vol.get(clave)))
    set_path(out, "rentabilidad.cnmv.periodo", periodo)
    set_path(out, "valoracion.cnmv_trimestral.participes", _entero(clase.get("NumeroParticipes")))
    pat = _num_o_none(clase.get("Patrimonio"))
    if isinstance(pat, float):
        set_path(out, "valoracion.cnmv_trimestral.patrimonio_clase_meur", round(pat / 1e6, 3))
    set_path(out, "valoracion.cnmv_trimestral.vl", _num_o_none(clase.get("ValorLiquidativo")))
    set_path(out, "valoracion.cnmv_trimestral.divisa", str(clase.get("CodigoDivisa") or "").strip().upper() or None)
    set_path(out, "valoracion.cnmv_trimestral.periodo", periodo)


def _mapea_patrimonio(out: dict, bloque: dict, periodo: str) -> None:
    """FONDPATRIMDISVAR: patrimonio total del compartimento y rotación."""
    ent = bloque.get("Entidad") or bloque
    comp = ent.get("Compartimento") if isinstance(ent.get("Compartimento"), dict) else \
        (_lista_(ent.get("Compartimento")) or [{}])[0]
    total = _num_o_none(comp.get("TotalPatrimonio"))
    if isinstance(total, float):
        set_path(out, "cartera.cnmv.patrimonio_total_eur", total)
    set_path(out, "cartera.rotacion_pct", _num_o_none(comp.get("IndiceRotacionCarteraActual")))
    set_path(out, "cartera.cnmv.rotacion_pct", _num_o_none(comp.get("IndiceRotacionCarteraActual")))
    for destino, clave in (("inversiones_financieras_eur", "DPInversionesFinancieras"),
                           ("cartera_interior_eur", "CarteraInterior"),
                           ("cartera_exterior_eur", "CarteraExterior"),
                           ("liquidez_eur", "Liquidez")):
        set_path(out, f"cartera.cnmv.{destino}", _num_o_none(comp.get(clave)))


def _mapea_cartera(out: dict, bloque: dict, periodo: str) -> None:
    """FONDCART: inversiones financieras del compartimento (cartera completa)."""
    ent = bloque.get("Entidad") or bloque
    comp = ent.get("Compartimento") if isinstance(ent.get("Compartimento"), dict) else \
        (_lista_(ent.get("Compartimento")) or [{}])[0]
    posiciones = []
    for inv in _lista_(comp.get("InversionesFinancieras")):
        valor = _num_o_none(inv.get("ValorMercado"))
        if not isinstance(valor, float):
            continue
        desc = str(inv.get("DescripcionValor") or "")
        partes = [x.strip() for x in desc.split("|")]
        posiciones.append({
            "nombre": partes[1] if len(partes) > 1 else (partes[0] if partes else None),
            "instrumento": partes[0] if partes else None,
            "isin": inv.get("CodigoISIN") or None,
            "divisa": inv.get("Divisa") or None,
            "valor_mercado_eur": valor,
            "tipo_cnmv": inv.get("DescripcionIF") or None,
            "ambito": inv.get("ClaseIF") or None,
        })
    if posiciones:
        previas = (out.get("cartera", {}).get("cnmv", {}) or {}).get("_posiciones") or []
        set_path(out, "cartera.cnmv._posiciones", previas + posiciones)


def _cierra_cartera(out: dict, periodo: str) -> None:
    """Convierte las posiciones de FONDCART en pesos sobre el patrimonio y deja
    el top-10 oficial del informe periódico."""
    cnmv = (out.get("cartera") or {}).get("cnmv") or {}
    posiciones = cnmv.pop("_posiciones", None)
    if not posiciones:
        return
    total = cnmv.get("patrimonio_total_eur") or sum(p["valor_mercado_eur"] for p in posiciones)
    if not total:
        return
    for p in posiciones:
        p["peso_pct"] = round(100 * p["valor_mercado_eur"] / total, 4)
    posiciones.sort(key=lambda p: -p["peso_pct"])
    ano, mes = int(periodo[:4]), int(periodo[5:7])
    ultimo_dia = {3: 31, 6: 30, 9: 30, 12: 31}.get(mes, 30)
    fecha = f"{ano}-{mes:02d}-{ultimo_dia:02d}"
    set_path(out, "cartera.cnmv.fecha", fecha)
    set_path(out, "cartera.cnmv.num_posiciones", len(posiciones))
    set_path(out, "cartera.cnmv.top10_posiciones", [
        {"nombre": p["nombre"], "isin": p["isin"], "peso_pct": p["peso_pct"],
         "divisa": p["divisa"], "tipo": p["tipo_cnmv"]} for p in posiciones[:10]])
    set_path(out, "cartera.cnmv.peso_top10_pct", round(sum(p["peso_pct"] for p in posiciones[:10]), 2))
    set_path(out, "cartera.cnmv.posiciones", posiciones)


def _num_o_none(v):
    n = _a_numero(v)
    return n if isinstance(n, float) else None


def _entero(v):
    n = _a_numero(v)
    return int(n) if isinstance(n, float) else None


def _mapea_generico(out: dict, bloque: dict) -> None:
    """Para ficheros aún no vistos (trimestrales): búsqueda tolerante."""
    mapeos = (
        ("costes.comision_gestion_aplicada_pct", ("comisiongestion", "comgestion")),
        ("costes.comision_deposito_pct", ("comisiondeposit", "comdeposit")),
        ("costes.ter_pct", ("ratiogastos", "gastosejercicio")),
        ("cartera.rotacion_pct", ("rotacion",)),
    )
    for destino_, patrones in mapeos:
        v = _busca_valor(bloque, patrones)
        if v is not None:
            set_path(out, destino_, v)


def _busca_valor(d, patrones, profundidad=0):
    """Primer valor cuyo nombre de clave contenga alguno de los patrones
    (comparación sin acentos ni mayúsculas). Recursivo."""
    if profundidad > 12:
        return None
    if isinstance(d, dict):
        for k, v in d.items():
            k_norm = _sin_acentos(str(k).lower()).replace("_", "")
            if any(p in k_norm for p in patrones) and not isinstance(v, (dict, list)):
                return _a_numero(v)
        for v in d.values():
            r = _busca_valor(v, patrones, profundidad + 1)
            if r is not None:
                return r
    elif isinstance(d, list):
        for v in d:
            r = _busca_valor(v, patrones, profundidad + 1)
            if r is not None:
                return r
    return None


def _a_numero(v):
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return str(v)


def _sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")
