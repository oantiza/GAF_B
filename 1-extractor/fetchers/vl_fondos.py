"""Valor liquidativo diario de los fondos desde EODHD, y las métricas de su serie.

Fase 0 del plan «fondos sin Morningstar» (decisión de Óscar, 28-10-2026): el
VL de los fondos lo da EODHD, que publica la serie diaria de los fondos
europeos por ISIN en su «bolsa» `EUFUND` (`LU0119620416.EUFUND`), y la
rentabilidad, la volatilidad, el Sharpe y la caída máxima se calculan aquí
desde esa serie (`core.metricas`). De EODHD solo se piden precios: nada de
fundamentales.

Dos peticiones por fondo:
- `/api/eod/{ISIN}.EUFUND`: la serie diaria completa (familia `precio`, 1 día).
- `/api/search/{ISIN}`: la divisa de la clase, que la serie no trae (familia
  `identidad`). Sin ella no se escribe divisa: nunca se supone EUR.

Más el €STR del BCE para el Sharpe (familia `rendimiento`). Todo va en la
DIVISA DE LA CLASE, como el VL, el KID y la ficha de la gestora, y como da
Morningstar la rentabilidad a plazo, la volatilidad y el Sharpe (sal-service).
Contrastado el 28-10 con 20 fondos: en clases en USD, las rentabilidades y
volatilidades propias en USD cuadran con las de Morningstar al decimal; pasadas
a EUR, no. (El año natural que Morningstar da en sus «snapshot» sí va en EUR:
`currencyId=EUR`. Con las métricas propias toda la ficha queda en una divisa.)

El Sharpe solo se calcula en clases en EUR: el €STR es un tipo en euros. En las
demás no se escribe y queda el de Morningstar (regla `sharpe` de
`registro.CONTRASTE`), calculado con su propio tipo libre de riesgo.

Las métricas solo se escriben en clases de ACUMULACIÓN: la serie de un fondo es
su valor liquidativo (`close`), que no lleva los repartos, así que en una clase
de reparto la rentabilidad saldría recortada por cada pago. La política sale de
lo que diga una fuente (AMF GECO, la ficha anterior) o del nombre de la clase
(`politica`); si no se sabe, solo VL y aviso, y las métricas de Morningstar
siguen de respaldo.

EODHD no suele ajustar los fondos, pero no siempre: de 758 con serie, 757 traen
`adjusted_close == close` en todos sus puntos, y en Fidelity LU0857700040 el
ajustado llevaba dentro los pagos hasta el 27-02-2026 (3.424 de 3.601 puntos,
medido el 05-11-2026). `close` es el que iguala el valor liquidativo del
proveedor en las fechas de pago: por eso un fondo no lee nunca el ajustado.

Lo que este adaptador escribe desplaza a Morningstar en esas rutas
(`registro.CONTRASTE`, tres reglas: VL, métricas y Sharpe): el valor de Morningstar
queda en `meta.contraste` para comparar, y en la ficha manda la serie.

Cuando la serie de EODHD se para, el fondo se queda con su traza y su aviso, sin VL ni métricas.
La excepción es D-9 (11-11-2026): si el fondo está en `config/serie_de_respaldo.json` y Morningstar
sirve su serie viva, la serie sigue con la de Morningstar (`core/serie_de_respaldo.py`), y todo lo
de abajo se calcula sobre ella igual que sobre una de EODHD. Lo que sale de ella lleva la etapa
`morningstar_timeseries` o `eod+morningstar_timeseries`, y la traza sus `tramos`. Desde D-10
(11-11-2026) también un fondo que no está en la lista, por empalme y solo si cumple todas las
salvaguardas de `core/serie_de_respaldo.py`; su traza lo dice (`respaldo.decision = "D-10"`), y
`main.py update` cuenta al final cuántos fondos parados entraron por cada vía y cuántos no, y por qué.

Token: el de EODHD de siempre (`config/secrets.json` o EODHD_API_TOKEN).
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
from datetime import date, datetime
from pathlib import Path

from fetchers import cambios_bce, estr_bce, morningstar_series
from core import indices, metricas, serie_de_respaldo
from core.adquisicion import procedencia
from core.schema import set_path

log = logging.getLogger("fondosdb.vl_fondos")

BASE_URL = "https://eodhd.com/api"
BOLSA = "EUFUND"
ESTR_URL = estr_bce.URL
ESTR_DESDE = estr_bce.DESDE
# La etapa de lo que sale de la serie de Morningstar cuando la de EODHD se para (D-9). La etiqueta de
# procedencia queda `vl_eodhd:morningstar_timeseries`: el adaptador es nuestro calculador del VL y la
# etapa dice de qué proveedor es el dato. Una cifra calculada sobre la serie empalmada lleva las dos,
# `vl_eodhd:eod+morningstar_timeseries`, en el orden de sus tramos.
ETAPA_MORNINGSTAR = "morningstar_timeseries"

# Nombre de la clase -> política de distribución. Solo marcas inequívocas:
# una «D» suelta no se usa (la clase D de Robeco es de acumulación).
RE_REPARTO = re.compile(
    r"\b(dist|dis|distribution|distributing|distribuci[oó]n|reparto|inc|income|qdis|mdis"
    r"|qd|md|ld|dy|div)\b|\(inc\)|-dist\b|-inc\b", re.IGNORECASE)
RE_ACUMULA = re.compile(
    r"\b(acc|accumulating|accumulation|cap|capitalisation|capitalization|capitalizaci[oó]n"
    r"|acumulaci[oó]n|thesaurierend|lc|fc|ic|tfc|rc|nc|cc)\b|\(acc\)|-acc\b", re.IGNORECASE)
POLITICAS = {"acumulacion": True, "distribucion": False, "mixta": False}


def simbolo(isin: str) -> str:
    return f"{isin.strip().upper()}.{BOLSA}"


def _fecha(v) -> date | None:
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _num(v) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def serie(isin: str, http, token: str, force: bool = False) -> tuple[metricas.Serie, float | None]:
    """(serie diaria ascendente, fetched_at) de `{ISIN}.EUFUND`; ([], None) si no hay."""
    return serie_de_simbolo(simbolo(isin), http, token, force)


def serie_de_simbolo(sim: str, http, token: str,
                     force: bool = False) -> tuple[metricas.Serie, float | None]:
    """Lo mismo para un símbolo cualquiera, no solo `{ISIN}.EUFUND`.

    Hace falta para la serie de un ETF usado como proxy de índice: un ETF no se
    pide por ISIN —comprobado el 01-11-2026, `IE00B4L5Y983.EUFUND` da 404— sino
    por su símbolo de mercado, `EUNL.XETRA`.

    Un fondo (`.EUFUND`) es su valor liquidativo: `close`, y sin él no hay punto (decisión 72).
    Lo que cotiza es el cierre ajustado, que lleva sus dividendos: `adjusted_close` y, si
    falta, `close`. Un NIVEL DE ÍNDICE (`.INDX`) es `close`, como un fondo: un índice no tiene
    nada que ajustar y el ajustado de EODHD no es una serie de retorno total oficial. Medido el
    07-11-2026 en 7 índices: los dos campos son idénticos en las 76.000 filas, y se lee `close`
    para que una diferencia futura no entre sin que nadie lo decida (decisión 23).
    El token va en los parámetros: la caché HTTP guarda la URL sin ellos."""
    r = http.get(f"{BASE_URL}/eod/{sim}",
                 params={"api_token": token, "fmt": "json", "period": "d", "order": "a"},
                 force=force, familia="precio")
    if not getattr(r, "ok", False):
        log.info("EODHD %s sin serie (status=%s)", sim, getattr(r, "status", "?"))
        return [], None
    try:
        crudo = r.json() or []
    except ValueError:
        return [], None
    puntos = []
    es_cierre = sim.endswith(f".{BOLSA}") or sim.endswith(f".{indices.BOLSA_INDICES}")
    for item in crudo if isinstance(crudo, list) else []:
        if not isinstance(item, dict):
            continue
        precio = _num(item.get("close"))
        if not es_cierre:
            ajustado = _num(item.get("adjusted_close"))
            precio = precio if ajustado is None else ajustado
        f = _fecha(item.get("date"))
        if f and precio:
            puntos.append((f, precio))
    return metricas.normaliza(puntos), getattr(r, "fetched_at", None)


def divisa(isin: str, http, token: str, force: bool = False) -> str | None:
    """Divisa de la clase según el buscador de EODHD (la del listado EUFUND)."""
    try:
        r = http.get(f"{BASE_URL}/search/{isin}", params={"api_token": token, "fmt": "json"},
                     force=force, familia="identidad")
        items = r.json() if getattr(r, "ok", False) else []
    except (ConnectionError, ValueError) as e:
        log.info("EODHD search %s: %s", isin, e)
        return None
    for it in items if isinstance(items, list) else []:
        if (isinstance(it, dict) and str(it.get("Exchange") or "").upper() == BOLSA
                and str(it.get("Code") or "").upper() == isin.upper()):
            cur = str(it.get("Currency") or "").strip().upper()
            return cur if len(cur) == 3 and cur.isalpha() else None
    return None


def divisa_de_indice(sim: str, http, token: str, force: bool = False) -> str | None:
    """Divisa de un nivel de índice, leída del catálogo de la bolsa `INDX`.

    `/search` no devuelve índices en nuestro plan (medido el 07-11-2026: «IBEX» da acciones y
    ETF, nunca `IBEX.INDX`), así que la divisa sale del catálogo de la bolsa, que trae código,
    nombre y divisa de sus 1.681 índices. Es una petición por pasada, de la familia `identidad`.
    Un símbolo que no esté en el catálogo no tiene divisa, y sin divisa no hay serie: así la
    propia existencia del índice en el plan queda comprobada antes de pedirlo."""
    codigo, _, bolsa = sim.rpartition(".")
    if bolsa != indices.BOLSA_INDICES or not codigo:
        return None
    try:
        r = http.get(f"{BASE_URL}/exchange-symbol-list/{bolsa}",
                     params={"api_token": token, "fmt": "json"}, force=force, familia="identidad")
        items = r.json() if getattr(r, "ok", False) else []
    except (ConnectionError, ValueError) as e:
        log.info("EODHD catalogo %s: %s", bolsa, e)
        return None
    for it in items if isinstance(items, list) else []:
        if isinstance(it, dict) and str(it.get("Code") or "").upper() == codigo.upper():
            cur = str(it.get("Currency") or "").strip().upper()
            return cur if len(cur) == 3 and cur.isalpha() else None
    return None


def estr(http) -> list[tuple[date, float]]:
    """Serie diaria del €STR (porcentaje anual). Se guarda en la propia sesión
    HTTP de la pasada, no en el módulo: un fallo no deja el Sharpe vacío para
    siempre en un servicio de larga vida (auditoría 28-10, H13)."""
    guardada = getattr(http, "_estr_vl_fondos", None)
    if guardada is not None:
        return guardada
    puntos: list[tuple[date, float]] = []
    try:
        r = estr_bce.pide(http)        # la misma petición y el mismo TTL que acciones y export
        if getattr(r, "ok", False):
            for fila in csv.DictReader(io.StringIO(r.text)):
                f, v = _fecha(fila.get("TIME_PERIOD")), _num(fila.get("OBS_VALUE"))
                if f and v is not None:
                    puntos.append((f, v))
    except ConnectionError as e:
        log.warning("€STR del BCE: %s", e)
        return []                       # sin guardar: la próxima petición lo reintenta
    puntos.sort()
    try:
        http._estr_vl_fondos = puntos
    except AttributeError:
        pass
    return puntos


_NOMBRES_CSV: dict[str, tuple[float, dict[str, str]]] = {}


def _nombre_csv(isin: str, base: Path | None) -> str | None:
    """Nombre de la clase en `config/fondos.csv` (se relee si cambia el fichero)."""
    if base is None:
        return None
    ruta = Path(base) / "config" / "fondos.csv"
    try:
        mtime = ruta.stat().st_mtime
    except OSError:
        return None
    guardado = _NOMBRES_CSV.get(str(ruta))
    if not guardado or guardado[0] != mtime:
        with ruta.open(encoding="utf-8-sig", newline="") as fh:
            nombres = {str(f.get("isin") or "").strip().upper(): str(f.get("nombre") or "").strip()
                       for f in csv.DictReader(fh)}
        guardado = _NOMBRES_CSV[str(ruta)] = (mtime, nombres)
    return guardado[1].get(isin.strip().upper()) or None


def _repartos_en_cache(isin: str, base: Path | None) -> str | None:
    """`'con_repartos'`, `'sin_repartos'` o `None` si el proveedor no contestó.

    Lee la respuesta guardada de `sal_distribution`. La distinción entre no haber
    preguntado y que el proveedor diga que no hay ningún reparto registrado es
    justo lo que separa «no se sabe» de «acumula», así que el fichero ausente y
    la lista vacía NO devuelven lo mismo.
    """
    if base is None:
        return None
    try:
        ruta = base / "cache" / "raw_morningstar_lt" / isin.strip().upper() / "sal_distribution.json"
        if not ruta.is_file():
            return None
        payload = json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    lista = payload.get("distribution")
    if not isinstance(lista, list):
        return None
    return "con_repartos" if lista else "sin_repartos"


def _clase_en_el_kid(isin: str, previo: dict | None, base: Path | None) -> dict | None:
    """Lo que `config/politica_kid.json` dice de la clase, si sigue siendo el mismo documento.

    La huella manda: si el KID de la ficha ya no es el que se leyó, la evidencia se
    apaga y se avisa, porque un documento nuevo puede decir otra cosa. La huella de
    esta pasada va delante de la de la ficha anterior."""
    if base is None:
        return None
    try:
        tabla = json.loads((base / "config" / "politica_kid.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    entrada = (tabla.get("clases") or {}).get(isin.strip().upper())
    if not entrada:
        return None
    previo = previo or {}
    fichas = [d for k, d in previo.items() if isinstance(d, dict) and k != "_anterior"]
    if isinstance(previo.get("_anterior"), dict):
        fichas.append(previo["_anterior"])
    huella = next((h for h in ((d.get("documentos_oficiales") or {}).get("kid_sha256") for d in fichas) if h), None)
    if huella != entrada.get("kid_sha256"):
        log.warning("%s: el KID ya no es el leido en politica_kid.json; se ignora esa evidencia", isin)
        return None
    return entrada


def _escribe_politica_del_kid(out: dict, isin: str, previo: dict | None, base: Path | None) -> None:
    """Lo que el KID dice de la clase y su frase, si sigue siendo el mismo documento."""
    del_kid = _clase_en_el_kid(isin, previo, base)
    if del_kid and del_kid.get("politica") in POLITICAS:
        with procedencia.etapa("politica_kid"):
            set_path(out, "documentos_oficiales.kid_politica", del_kid["politica"])
            set_path(out, "documentos_oficiales.kid_politica_cita", del_kid.get("cita"))


def politica(isin: str, previo: dict | None = None,
             base: Path | None = None) -> tuple[bool | None, str]:
    """(¿acumula?, motivo). True = acumulación; False = reparto; None = no se sabe.

    Por orden de fuerza de la evidencia:

    0. El KID de la clase, leído y anotado con su huella (03-11-2026): «Income» era
       el nombre del fondo en 26 clases que capitalizan, y dos clases sin pagos
       registrados declaran que reparten.
    1. La política que declare una fuente en esta pasada (AMF GECO, justETF) o
       la ficha anterior.
    2. **El historial de repartos del proveedor**: si hay pagos registrados, la
       clase reparte. Es un hecho con fecha e importe, no una pista. Se mira en
       las fichas Y en la respuesta guardada del proveedor, porque en una misma
       pasada esta función corre antes que el fetcher que la trae.
    3. El nombre, cuando dice reparto: nadie llama «Dist» a una clase que acumula.
    4. **El historial consultado y VACÍO**: el proveedor afirma que no tiene
       ningún reparto registrado. Es más débil que lo anterior —es una ausencia
       afirmada por un tercero— pero más fuerte que leer el nombre.
    5. El nombre, cuando dice acumulación.
    6. Los fondos españoles, que por norma acumulan salvo que el nombre diga lo
       contrario.

    Los dos escalones nuevos son del 01-11-2026, y entran porque el 2 y el 4
    sustituyen con evidencia a lo que antes decidían el 5 y el 6.

    **El 2 no es un hecho sobre la clase, es lo que el proveedor registra** (05-11-2026,
    decisión 78). Se puso de ejemplo a IE00BD5CTX77, llamada de acumulación y con un 4,97 %
    registrado en doce meses, como prueba de que el nombre falla, y era al revés: su KID dice
    que reinvierte, y su serie sola iguala la rentabilidad total del proveedor. De las 34 clases
    que se daban por reparto solo por este escalón, sin rendimiento o con esa, el KID de 32 dice
    que acumulan: por eso el escalón 0 va delante, clase a clase y leído a mano."""
    del_kid = _clase_en_el_kid(isin, previo, base)
    if del_kid and del_kid.get("politica") in POLITICAS:
        return POLITICAS[del_kid["politica"]], f"kid_{del_kid['politica']}"

    previo = previo or {}
    fuentes = [d for k, d in previo.items() if isinstance(d, dict) and k != "_anterior"]
    todas = [*fuentes, *([previo["_anterior"]] if isinstance(previo.get("_anterior"), dict) else [])]
    for d in todas:
        v = str(((d.get("identificacion") or {}).get("politica_distribucion")) or "").lower()
        if v in POLITICAS:
            return POLITICAS[v], f"politica_{v}"

    repartos = [d.get("distribuciones") or {} for d in todas]
    # Y, de respaldo, la respuesta guardada del proveedor. Lo normal es que el
    # historial llegue por `previo`, porque desde el 01-11-2026 este adaptador
    # corre detrás de `morningstar_lt` justamente para eso. La caché cubre el
    # caso en que Morningstar no corre en esta pasada —`--fuentes vl_eodhd`, o
    # una fuente caída— y su respuesta sí está de una pasada anterior: ahí sigue
    # siendo mejor evidencia que el nombre de la clase. Es el mismo patrón que
    # ya usa `core/exporta.py` para `sal_position.json`.
    en_cache = _repartos_en_cache(isin, base)
    if any(dd.get("historial") for dd in repartos) or en_cache == "con_repartos":
        return False, "historial_repartos"

    nombres = [str((d.get("identificacion") or {}).get(k) or "")
               for d in todas
               for k in ("nombre", "nombre_clase")]
    nombres.append(_nombre_csv(isin, base) or "")
    nombres = [n for n in nombres if n]
    if any(RE_REPARTO.search(n) for n in nombres):
        return False, "nombre_reparto"

    if any(dd.get("historial_consultado") for dd in repartos) or en_cache == "sin_repartos":
        return True, "sin_repartos_del_proveedor"

    if any(RE_ACUMULA.search(n) for n in nombres):
        return True, "nombre_acumulacion"
    if isin.strip().upper().startswith("ES"):
        return True, "es_sin_reparto"
    return None, "politica_desconocida"


def fetch(isin: str, http, settings: dict, force: bool = False,
          base: Path | None = None, tipo: str = "", previo: dict | None = None) -> dict:
    if tipo not in ("fondo", "etf"):
        return {}
    from fetchers.eodhd import _token
    token = _token(base)
    if not token:
        log.warning("vl_fondos omitido para %s: falta eodhd_api_token "
                    "(config/secrets.json o EODHD_API_TOKEN)", isin)
        return {}
    if tipo == "etf":
        return _fetch_etf(isin, http, token, force, previo, base)
    s, fetched_at = serie(isin, http, token, force)
    if not s:
        return {}
    out: dict = {}
    sim = simbolo(isin)
    parada = dias_parada(s, fetched_at)
    compuesta = None
    pendiente = None
    div = None
    etapa_divisa = "search"
    if parada is not None:
        # D-9: si el fondo está en `config/serie_de_respaldo.json`, la serie sigue con Morningstar por
        # su regla. D-10: si no está, también, por empalme y solo si cumple todas las salvaguardas.
        # Si no, se queda como estaba. Cada fondo parado queda anotado para el resumen de la pasada.
        via, regla = serie_de_respaldo.via_de(isin, base)
        if via == serie_de_respaldo.VIA_EXCLUIDO:
            serie_de_respaldo.anota(http, isin, via, serie_de_respaldo.EN_EXCLUIDOS)
        elif regla is None:
            serie_de_respaldo.anota(http, isin, via, serie_de_respaldo.REGLA_DESCONOCIDA)
        elif not serie_de_respaldo.sec_id_de(previo):
            # Sin SecId no hay a quién pedir: ni siquiera se pregunta la divisa a EODHD.
            serie_de_respaldo.anota(http, isin, via, serie_de_respaldo.SIN_SECID)
        else:
            div = divisa(isin, http, token, force)
            if not div:
                # El buscador de EODHD ya no lista la clase: la divisa es la del VL que publica
                # Morningstar, y se pide la serie en ella. La prueba de nivel la contrasta.
                div = serie_de_respaldo.divisa_declarada(previo)
                etapa_divisa = ETAPA_MORNINGSTAR
            compuesta, motivo, detalle = _respaldo_vivo(
                isin, regla, s, sim, div, previo, http, force,
                automatico=via == serie_de_respaldo.VIA_AUTOMATICO)
            if motivo == serie_de_respaldo.RUPTURA:
                pendiente = detalle
                detalle = pendiente["ruptura"]
            serie_de_respaldo.anota(http, isin, via, motivo, detalle)
    if parada is not None and compuesta is None:
        # Serie que EODHD dejó de actualizar (clase cerrada, fusionada o que
        # ya no sigue): su VL y sus métricas serían más viejos que los de
        # Morningstar. Solo la traza y el aviso; Morningstar sigue de respaldo.
        # (Pasada del 29-10: 17 fondos con la serie parada entre 21 y 1.218
        # días hábiles desplazaban un VL de Morningstar más reciente.)
        with procedencia.etapa("eod", fetched_at, url=f"{BASE_URL}/eod/{sim}"):
            _escribe_traza(out, s, sim)
            set_path(out, "riesgo.historial_precios.aviso_vl", f"serie_parada({parada}d)")
        if pendiente is not None:
            # D-10 con ruptura: el fondo se queda como estaba, y la traza dice por qué no se aplicó.
            with procedencia.etapa(ETAPA_MORNINGSTAR, url=morningstar_series.URL):
                set_path(out, "riesgo.historial_precios.respaldo_pendiente", pendiente)
        # Lo que dice su KID no depende de que la serie siga viva: sin esto, Polar Global Insurance,
        # parada desde mayo de 2026, seguía diciendo que reparte (decisión 78).
        _escribe_politica_del_kid(out, isin, previo, base)
        return out
    if compuesta is None:
        # Lo de siempre: la serie de EODHD, viva. Todo lo que sale de ella va con la etapa `eod`.
        etapa, cuando = "eod", fetched_at
        with procedencia.etapa("eod", fetched_at, url=f"{BASE_URL}/eod/{sim}"):
            _escribe_vl(out, s, sim)
        div = divisa(isin, http, token, force)
    else:
        # La serie compuesta: el VL es su último punto, que es de Morningstar, y lo que se calcula
        # sobre la serie lleva el nombre de las fuentes que la forman (`eod+morningstar_timeseries`).
        s = compuesta.serie
        etapa = ETAPA_MORNINGSTAR if compuesta.solo_morningstar else f"eod+{ETAPA_MORNINGSTAR}"
        cuando = compuesta.fetched_at
        with procedencia.etapa(ETAPA_MORNINGSTAR, compuesta.fetched_at, url=morningstar_series.URL):
            fin, vl = s[-1]
            set_path(out, "valoracion.vl", round(vl, 6))
            set_path(out, "valoracion.vl_fecha", fin.isoformat())
        with procedencia.etapa(etapa, cuando):
            _escribe_traza_compuesta(out, compuesta, parada)
            set_path(out, "riesgo.historial_precios.respaldo.divisa_de",
                     "eodhd_search" if etapa_divisa == "search" else "morningstar_vl_divisa")
    with procedencia.etapa(etapa_divisa):
        set_path(out, "valoracion.vl_divisa", div)
        set_path(out, "riesgo.historial_precios.divisa", div)

    acumula, motivo = politica(isin, previo, base)
    with procedencia.etapa(etapa, cuando):
        set_path(out, "riesgo.historial_precios.politica", motivo)
    # La evidencia viaja con la cifra: la plataforma no lee la caché, y sin esto
    # calculábamos con una razón que luego no podía comprobar (doce fondos, 03-11-2026).
    if motivo.startswith("kid_"):
        _escribe_politica_del_kid(out, isin, previo, base)
    elif motivo == "sin_repartos_del_proveedor":
        with procedencia.etapa("sal_distribution"):
            set_path(out, "distribuciones.historial_consultado", True)
    if acumula is not True:
        # Reparto o sin saber: la serie sin ajustar por repartos daría una
        # rentabilidad recortada. Solo VL; las métricas de Morningstar siguen.
        with procedencia.etapa(etapa, cuando):
            set_path(out, "riesgo.historial_precios.aviso_metricas", f"sin_metricas_{motivo}")
        return out
    s, picos = _sin_picos(s, isin)
    s, ruptura = metricas.tramo_sin_rupturas(s)
    # Metodo V2 (decision 10): todo se calcula en euros, convirtiendo la serie antes de
    # calcular. Sin cambio no hay cifra: una en otra divisa no se puede combinar en cartera.
    divisa_origen = div
    s = cambios_bce.serie_en_euros(s, divisa_origen, http)
    if not s:
        with procedencia.etapa(etapa, cuando):
            set_path(out, "riesgo.historial_precios.aviso_metricas", "sin_metricas_sin_cambio")
        return out
    div = "EUR"
    with procedencia.etapa(etapa, cuando):
        if ruptura:
            set_path(out, "riesgo.historial_precios.aviso_serie", f"ruptura_serie({ruptura.isoformat()})")
        if picos:
            set_path(out, "riesgo.historial_precios.picos_descartados", picos)
        _escribe_metricas(out, s, div)
    if divisa_origen != "EUR":
        with procedencia.etapa(etapa, cuando):
            set_path(out, "riesgo.historial_precios.divisa_origen", divisa_origen)
            set_path(out, "riesgo.historial_precios.fx_source", cambios_bce.FUENTE)
    with procedencia.etapa("estr"):
        _escribe_riesgo(out, s, estr(http))

    # Y contra su índice, si tiene uno con proxy aprobado.
    _escribe_relativas(out, s, isin, previo, http, token, force, base, div, etapa)
    return out


def _sin_picos(s: metricas.Serie, isin: str) -> tuple[metricas.Serie, list[dict]]:
    """La serie sin los datos sueltos que saltan y vuelven, y esos datos, para decirlos en la ficha.

    Decisión A-166: el pico no corta la serie ni entra en ninguna cifra, y la ficha lo lleva en
    `riesgo.historial_precios.picos_descartados` con su fecha, su valor y los dos que lo rodean."""
    limpia, picos = metricas.sin_picos(s)
    for pico in picos:
        log.warning("%s: dato suelto descartado el %s (%s entre %s y %s): salta y vuelve",
                    isin, pico["fecha"], pico["valor"], pico["anterior"], pico["siguiente"])
    return limpia, picos


def _es_etc(previo: dict | None) -> bool:
    fichas = [d for d in (previo or {}).values() if isinstance(d, dict)]
    return any(str((d.get("identificacion") or {}).get("tipo_producto") or "").lower() == "etc"
               for d in fichas)


def _fetch_etf(isin: str, http, token: str, force: bool, previo: dict | None,
               base: Path | None = None) -> dict:
    """Las métricas de un ETF: el mismo cálculo mensual de los fondos, sobre su precio de mercado.

    Opción A de Óscar, 04-11-2026: un asesor compara ETF con fondos a diario, así que la
    frecuencia y la fórmula son las suyas. Lo que cambia es la serie, y eso viaja en
    `clase_de_serie`: el cierre de mercado no es el valor liquidativo y mide algo más de
    volatilidad (decisión 11).

    La serie es el cierre AJUSTADO: en los ETF que reparten lleva los dividendos dentro
    (medido el 04-11: lo pagado en doce meses cuadra con el rendimiento declarado), así que
    no hay política que resolver. Se excluye el ETC, que no tiene método decidido.

    La divisa es la de la COTIZACIÓN, y por eso no se lee de la ficha: `valoracion.vl_divisa`
    y `identificacion.divisa_base` dicen USD en clases que en XETRA cotizan en euros."""
    if _es_etc(previo):
        return {}
    from fetchers.eodhd import listado_de_etf, simbolo_conocido
    match = listado_de_etf(isin, http, token, force, simbolo_conocido(isin, None, base)) or {}
    code, bolsa = str(match.get("Code") or "").strip(), str(match.get("Exchange") or "").strip()
    moneda = str(match.get("Currency") or "").strip().upper()
    if not code or not bolsa or not moneda:
        return {}
    sim = f"{code}.{bolsa}"
    s, fetched_at = serie_de_simbolo(sim, http, token, force)
    if not s:
        return {}
    out: dict = {}
    parada = dias_parada(s, fetched_at)
    with procedencia.etapa("eod", fetched_at, url=f"{BASE_URL}/eod/{sim}"):
        _escribe_traza(out, s, sim)
        set_path(out, "riesgo.historial_precios.clase_de_serie", "PRECIO_DE_MERCADO")
        if parada is not None:
            set_path(out, "riesgo.historial_precios.aviso_vl", f"serie_parada({parada}d)")
            return out
    s, picos = _sin_picos(s, isin)
    s, ruptura = metricas.tramo_sin_rupturas(s)
    s = cambios_bce.serie_en_euros(s, moneda, http)
    if not s:
        with procedencia.etapa("eod", fetched_at):
            set_path(out, "riesgo.historial_precios.aviso_metricas", "sin_metricas_sin_cambio")
        return out
    with procedencia.etapa("eod", fetched_at):
        if ruptura:
            set_path(out, "riesgo.historial_precios.aviso_serie", f"ruptura_serie({ruptura.isoformat()})")
        if picos:
            set_path(out, "riesgo.historial_precios.picos_descartados", picos)
        _escribe_metricas(out, s, "EUR")
        set_path(out, "riesgo.historial_precios.metodo",
                 metricas.sello_del_metodo("cierre de mes, en euros, sobre precio de mercado ajustado"))
        if moneda != "EUR":
            set_path(out, "riesgo.historial_precios.divisa_origen", moneda)
            set_path(out, "riesgo.historial_precios.fx_source", cambios_bce.FUENTE)
    with procedencia.etapa("estr"):
        _escribe_riesgo(out, s, estr(http))
    return out


def _serie_del_proxy(fila: dict, http, token: str, force: bool,
                     base: Path | None) -> metricas.Serie:
    """Serie del proxy, por la vía que corresponda a su clase de serie.

    Hay dos vías porque hay dos tipos de instrumento, y confundirlas da un 404:
    un fondo índice se pide por `{ISIN}.EUFUND` como los 752 del universo, y un
    ETF **no** —comprobado el 01-11-2026: `IE00B4L5Y983.EUFUND` devuelve 404—,
    así que va por su símbolo de mercado, que su propia ficha ya trae resuelto en
    `identificacion.simbolo_eodhd`.

    La serie sale en EUROS, como la del fondo con el que se compara: si no, la beta mezcla
    mercado con tipo de cambio. Un ETF puede resolverse a una cotización en francos o dólares.

    La tercera vía es el NIVEL DEL PROPIO ÍNDICE (camino C, decisión 23): la fila trae el
    símbolo de la bolsa `INDX` entero, la serie es su `close` y la divisa la dice el catálogo de
    esa bolsa. Las del S&P llegan en dólares y se convierten con el BCE como un ETF en francos.
    """
    proxy = fila["proxy"]
    if fila["clase_de_serie"] == "NIVEL_DE_INDICE":
        moneda = divisa_de_indice(proxy, http, token, force)
        if not moneda:
            log.info("indice %s sin divisa en el catalogo INDX: sin relativas", proxy)
            return []
        s, _ = serie_de_simbolo(proxy, http, token, force)
        return cambios_bce.serie_en_euros(s, moneda, http) if s else s
    if fila["clase_de_serie"] == "VALOR_LIQUIDATIVO":
        s, _ = serie(proxy, http, token, force)
        return cambios_bce.serie_en_euros(s, divisa(proxy, http, token, force), http) if s else s
    if fila["clase_de_serie"] == "PRECIO_DE_MERCADO":
        if base is None:
            return []
        try:
            ficha = json.loads((Path(base) / "data" / "funds" / f"{proxy}.json")
                               .read_text(encoding="utf-8"))
        except Exception:
            return []
        sim = ((ficha.get("identificacion") or {}).get("simbolo_eodhd") or "").strip()
        historial = (ficha.get("riesgo") or {}).get("historial_precios") or {}
        # La divisa de la cotización solo la sabe el cálculo de sus métricas: `vl_divisa` y
        # `divisa_base` dicen la de la clase (ver `_fetch_etf`). Sin ellas no se adivina.
        if not sim or historial.get("divisa_metricas") != "EUR":
            return []
        s, _ = serie_de_simbolo(sim, http, token, force)
        return cambios_bce.serie_en_euros(s, historial.get("divisa_origen") or "EUR", http) if s else s
    return []


# Decisión 20 del 07-11-2026 (DECISIONES_DATOS_2026-11-07.md): el KID declara un índice compuesto o
# ninguno, así que no se calculan relativas contra el que atribuye Morningstar.
AVISO_DEL_KID = {
    "COMPUESTO": "sin_relativas_kid_compuesto",
    "KID_SIN_INDICE": "sin_relativas_kid_sin_indice",
}
# Decisión 21: se calculan, y se marca que el KID no confirma ESE índice. `NO_CONFIRMADO`: el KID no
# nombra el índice; `CONFIRMADO_MARCA`: solo coincide la familia (MSCI…), no el índice. Con las dos
# caen exactamente los tres que nombra la decisión (DWS Latin America ×2 y Echiquier Space).
KID_NO_CONFIRMA = ("NO_CONFIRMADO", "CONFIRMADO_MARCA")
DECISION_RETIRADA_KID = "DECISIONES_DATOS_2026-11-07.md, punto 20"
# Las cifras del bloque: si la ficha anterior tenía alguna, lo que hace esta pasada es RETIRARLAS.
_CIFRAS_RELATIVAS = ("beta", "r2", "jensen_alpha", "rentabilidad_activa", "tracking_error",
                     "information_ratio")


def _hoy() -> date:
    return date.today()


def _bloque_kid(previo: dict | None) -> dict:
    """`identificacion.indice_benchmark_kid`, el de esta pasada antes que el de la ficha anterior.

    Lo escribe `indice_kid` (orden 26), que corre DELANTE de este adaptador desde el 07-11-2026:
    así la regla lee el KID que se comprobó en esta misma pasada y la ficha lleva juntos el bloque
    y la decisión que se tomó con él."""
    previo = previo or {}
    fuentes = [d for k, d in previo.items() if isinstance(d, dict) and k != "_anterior"]
    anterior = previo.get("_anterior")
    for d in [*fuentes, *([anterior] if isinstance(anterior, dict) else [])]:
        bloque = (d.get("identificacion") or {}).get("indice_benchmark_kid")
        if isinstance(bloque, dict) and bloque.get("estado"):
            return bloque
    return {}


def _escribe_retirada_por_kid(out: dict, kid: dict, previo: dict | None) -> None:
    """El motivo, la frase del KID que lo justifica y, si había cifras, la retirada con su fecha.

    La retirada es la §10 del método: retirar no es faltar, y consta desde cuándo ya no se publica.
    La fecha es la de la pasada que las quitó y **no se mueve** en las siguientes: se arrastra de
    la ficha anterior mientras siga el mismo motivo. Un fondo que nunca las tuvo no lleva
    `retirada`, porque no se le retiró nada (decisión 17)."""
    estado = kid["estado"]
    aviso = AVISO_DEL_KID[estado]
    set_path(out, "riesgo.relativas.aviso", aviso)
    set_path(out, "riesgo.relativas.kid_estado", estado)
    for origen, destino in (("texto_del_kid", "kid_texto"), ("kid_sha256", "kid_sha256"),
                            ("fecha_comprobacion", "kid_fecha_comprobacion")):
        if kid.get(origen):
            set_path(out, f"riesgo.relativas.{destino}", kid[origen])
    anterior = ((((previo or {}).get("_anterior") or {}).get("riesgo") or {}).get("relativas") or {})
    if not isinstance(anterior, dict):
        return
    retirada = anterior.get("retirada")
    if anterior.get("aviso") == aviso and isinstance(retirada, dict) and retirada.get("fecha"):
        for clave, valor in retirada.items():
            set_path(out, f"riesgo.relativas.retirada.{clave}", valor)
        return
    if not any(anterior.get(c) for c in _CIFRAS_RELATIVAS):
        return
    set_path(out, "riesgo.relativas.retirada.fecha", _hoy().isoformat())
    set_path(out, "riesgo.relativas.retirada.decision", DECISION_RETIRADA_KID)
    # La clase de serie viaja con la retirada: la plataforma la necesita para saber si lo que se
    # retiró se medía contra un instrumento (ISIN) o contra el nivel del índice (decisión 23).
    for origen, destino in (("indice_nombre", "indice_nombre"), ("indice_proxy", "indice_proxy"),
                            ("indice_clase_de_serie", "indice_clase_de_serie"),
                            ("fecha_dato", "ultima_fecha_dato")):
        if anterior.get(origen):
            set_path(out, f"riesgo.relativas.retirada.{destino}", anterior[origen])


def _clase_cubierta(previo: dict | None) -> bool:
    """Si la clase está cubierta, según lo que diga una fuente o la ficha anterior, O su nombre.

    `derivados` deriva `clase_cubierta` del nombre DESPUÉS de los adaptadores, así que aquí solo
    llegaba el valor de la ficha anterior. Medido el 07-11-2026 al arreglar el patrón «AH (EUR)»:
    en la primera pasada tras el arreglo, la ficha anterior aún decía «sin cubrir» y la clase AH
    de Morgan Stanley recibía relativas contra el S&P 500 en euros (R² 46 %). El nombre de esta
    pasada se mira aquí para que la regla no llegue una pasada tarde."""
    from core import derivados
    nombre = None
    for d in (previo or {}).values():
        if not isinstance(d, dict):
            continue
        ident = d.get("identificacion") or {}
        if ident.get("clase_cubierta"):
            return True
        nombre = nombre or (ident.get("nombre") or "").strip()
    if not nombre:
        return False
    copia = {"identificacion": {"nombre": nombre}}
    derivados._cobertura_divisa(copia)
    return bool(copia["identificacion"].get("clase_cubierta"))


def _escribe_relativas(out: dict, s: metricas.Serie, isin: str, previo: dict | None,
                       http, token: str, force: bool, base: Path | None, div: str | None,
                       etapa: str = "eod") -> None:
    """Beta, R², alpha, rentabilidad activa y tracking error contra su índice.

    Solo se calculan si hay **proxy aprobado** para el benchmark que declara el
    fondo. Sin proxy no se calcula nada, y eso es deliberado: un alpha contra un
    índice que nadie ha verificado es peor que no tener alpha. De los 750 fondos
    con benchmark, 197 tienen proxy el 01-11-2026.

    El nombre del benchmark llega por `previo`, de `morningstar_lt`, y está
    disponible porque ese adaptador corre ANTES que este desde el arreglo de
    orden de hoy. Antes de él, este bloque habría visto el benchmark de la pasada
    anterior.
    """
    if not s or base is None:
        return
    nombre = None
    for d in (previo or {}).values():
        if isinstance(d, dict):
            n = ((d.get("identificacion") or {}).get("indice_benchmark_oficial") or "").strip()
            if n:
                nombre = n
                break
    if not nombre:
        return
    # Lo que dice su KID del índice, ANTES de buscar proxy: si declara un compuesto o ninguno, el que
    # le atribuye Morningstar no es el suyo, y medirlo contra él publica un alfa que no mide gestión
    # (decisión 20 del 07-11-2026). Va antes que el proxy porque es la razón de fondo: aunque mañana
    # hubiera proxy para el índice de Morningstar, no se mediría contra él.
    kid = _bloque_kid(previo)
    estado_kid = kid.get("estado")
    if estado_kid in AVISO_DEL_KID:
        _escribe_retirada_por_kid(out, kid, previo)
        return
    fila = indices.proxy_de(nombre, base)
    if fila is None:
        return
    # El proxy de su propio índice no se mide contra sí mismo: saldría beta 1, R² 1 y alfa 0, una
    # cifra que no dice nada y se lee como si dijera algo. Medido el 06-11-2026: cinco proxies la
    # publicaban (los cuatro fondos índice de Vanguard y el de Euro Aggregate de iShares).
    if (fila.get("proxy") or "").upper() == (isin or "").upper():
        return
    # Una clase cubierta contra un proxy sin cubrir no mide gestion: la diferencia es la cobertura.
    # Medido el 04-11-2026: la clase cubierta de un fondo que replica MSCI World salia con beta
    # 0,86 y R2 del 79 % contra ese mismo indice.
    if _clase_cubierta(previo):
        set_path(out, "riesgo.relativas.aviso", "sin_relativas_clase_cubierta")
        return
    if indices.es_tasa(fila):
        # El benchmark es una tasa: la serie es el €STR, que no es una serie de
        # precios y no se le puede sacar una beta de la misma forma. Queda para
        # cuando se decida cómo se mide un fondo contra el efectivo.
        return
    indice = _serie_del_proxy(fila, http, token, force, base)
    if not indice:
        return
    # El índice y el fondo tienen que estar en la misma divisa o la beta mezcla
    # mercado con tipo de cambio.
    if div and div != "EUR":
        set_path(out, "riesgo.relativas.aviso",
                 f"sin_relativas_divisa_{div}")
        return
    # La base la DECLARA el registro, no se deduce de la clase de serie: el precio
    # de un ETF de acumulacion incluye los dividendos reinvertidos, asi que es
    # retorno total aunque sea precio de mercado. Deducirla dejaba sin alpha a los
    # 69 fondos de MSCI ACWI por una razon falsa.
    # Versión 4 (MET-6): al cierre del riesgo del fondo, y si el índice no llega a él, no se dan.
    # Hasta la 3 se llamaba sin `fin`, y las relativas podían cerrar un mes antes que el riesgo.
    rel = metricas.relativas(s, indice, fila["base"],
                             estr(http) if div == "EUR" else None,
                             fin=metricas.cierre_mensual(s))
    if not rel:
        return
    if "sin_cierre_comun" in rel:
        with procedencia.etapa(etapa):
            set_path(out, "riesgo.relativas.aviso", f"sin_relativas_indice_sin_cierre({rel['sin_cierre_comun']})")
        return
    with procedencia.etapa(etapa):
        set_path(out, "riesgo.relativas.indice_nombre", fila["benchmark"])
        set_path(out, "riesgo.relativas.indice_variante", fila["variante"])
        set_path(out, "riesgo.relativas.indice_proxy", fila["proxy"])
        set_path(out, "riesgo.relativas.indice_clase_de_serie", fila["clase_de_serie"])
        # Medido contra un índice EQUIVALENTE al declarado (`equivalente_de` en indices.csv):
        # `indice_nombre` es el que se midió, y esto el que declara el fondo. Va aparte para
        # que nadie lea el uno por el otro.
        if fila.get("declarado"):
            set_path(out, "riesgo.relativas.equivalente_de", fila["declarado"])
        # El KID nombra un índice que no es este, o solo su familia: se publica igual y se marca
        # (decisión 21). El estado viaja para que quien lo lea sepa cuál de las dos cosas pasa.
        if estado_kid in KID_NO_CONFIRMA:
            set_path(out, "riesgo.relativas.kid_no_confirma", True)
            set_path(out, "riesgo.relativas.kid_estado", estado_kid)
        set_path(out, "riesgo.relativas.base_indice", rel.get("base_indice"))
        set_path(out, "riesgo.relativas.fecha_dato", rel.get("fecha"))
        for ventana in ("1a", "3a", "5a"):
            datos = rel.get(ventana)
            if not datos:
                continue
            for clave, valor in datos.items():
                set_path(out, f"riesgo.relativas.{clave}.{ventana}", valor)


MAX_DIAS_SERIE = 10   # días naturales entre el último VL y la descarga: cubre puentes y festivos


def _respaldo_vivo(isin: str, regla: str, s: metricas.Serie, sim: str, div: str | None,
                   previo: dict | None, http, force: bool, automatico: bool = False):
    """(compuesta, motivo, detalle): la serie de D-9 o D-10 si Morningstar la sirve VIVA; si no, sin
    compuesta, el fondo como estaba y la salvaguarda que lo paró.

    Una serie de Morningstar parada también no revive nada: sería sustituir una serie vieja por
    otra, con la misma regla de `dias_parada` que se aplica a la de EODHD. En el automático, además,
    la serie compuesta no puede tener una ruptura del método: si la tiene, el detalle es lo que se
    escribe en la traza para que alguien lo decida (`serie_de_respaldo.pendiente_de_decision`)."""
    compuesta, motivo, detalle = serie_de_respaldo.respaldo(isin, regla, s, sim, div, previo, http, force)
    if compuesta is None:
        return None, motivo, detalle
    parada_ms = dias_parada(compuesta.serie, compuesta.fetched_at)
    if parada_ms is not None:
        log.info("%s: la serie de Morningstar tambien esta parada (%sd); se queda como estaba", isin, parada_ms)
        return None, serie_de_respaldo.MS_PARADA, f"Morningstar acaba el {compuesta.serie[-1][0].isoformat()}"
    if automatico:
        ruptura = serie_de_respaldo.ruptura_en(compuesta)
        if ruptura is not None:
            log.warning("%s: la serie compuesta tiene una ruptura el %s; D-10 no la aplica y queda para "
                        "decidir", isin, ruptura)
            return None, serie_de_respaldo.RUPTURA, serie_de_respaldo.pendiente_de_decision(compuesta, ruptura)
        compuesta.automatico = True
    return compuesta, serie_de_respaldo.APLICADO, detalle


def _escribe_traza_compuesta(out: dict, c: serie_de_respaldo.Compuesta, parada_eodhd: int) -> None:
    """La traza de una serie compuesta: la misma que la de una de EODHD, más de dónde sale cada tramo.

    `source_listing_id` es la identidad de la serie, la que viaja a `computed/metrics.inputs.series_id`
    y a `price_series`: `EODHD:<símbolo>+MORNINGSTAR:<SecId>` en un empalme, `MORNINGSTAR:<SecId>` si
    no queda ningún punto de EODHD. `tramos` dice, en orden, qué fechas son de cada fuente, y con eso
    cada punto sabe de dónde sale. `respaldo` deja escrito por qué no es la serie de siempre: la regla,
    la decisión, la divisa en que se pidió y hasta cuándo dio EODHD. El corte en el evento no va aquí:
    lo escribe la regla de ruptura, en `aviso_serie`, como en cualquier fondo."""
    set_path(out, "riesgo.historial_precios.source_history", c.source_history)
    set_path(out, "riesgo.historial_precios.source_listing_id", c.listing_id)
    set_path(out, "riesgo.historial_precios.first_date", c.serie[0][0].isoformat())
    set_path(out, "riesgo.historial_precios.last_date", c.serie[-1][0].isoformat())
    set_path(out, "riesgo.historial_precios.observations_count", len(c.serie))
    set_path(out, "riesgo.historial_precios.tramos", [t.como_dict() for t in c.tramos])
    respaldo = {"regla": c.regla, "decision": serie_de_respaldo.DECISION, "divisa": c.divisa,
                "eodhd_hasta": c.eodhd_hasta.isoformat(), "eodhd_dias_parada": parada_eodhd}
    if c.automatico:
        # D-10: el fondo no está en la lista. Lo dice la decisión, la etiqueta que se lee en la traza
        # y la prueba de nivel que lo dejó pasar. Un fondo de la lista no lleva nada de esto.
        respaldo.update({"decision": serie_de_respaldo.DECISION_AUTOMATICO,
                         "aplicacion": serie_de_respaldo.ETIQUETA_AUTOMATICO, "nivel": c.nivel})
    set_path(out, "riesgo.historial_precios.respaldo", respaldo)


def dias_parada(s: metricas.Serie, fetched_at: float | None) -> int | None:
    """Días que lleva parada la serie al descargarla, si pasan de `MAX_DIAS_SERIE`.

    Se mide contra el momento de la descarga, no contra hoy: regenerar sin red
    desde una caché de hace semanas no debe dar por parada una serie viva."""
    if not s:
        return None
    try:
        ref = datetime.fromtimestamp(fetched_at).date() if fetched_at else date.today()
    except (OverflowError, OSError, ValueError):
        ref = date.today()
    dias = (ref - s[-1][0]).days
    return dias if dias > MAX_DIAS_SERIE else None


def _escribe_vl(out: dict, s: metricas.Serie, sim: str) -> None:
    fin, vl = s[-1]
    set_path(out, "valoracion.vl", round(vl, 6))
    set_path(out, "valoracion.vl_fecha", fin.isoformat())
    _escribe_traza(out, s, sim)


def _escribe_traza(out: dict, s: metricas.Serie, sim: str) -> None:
    fin = s[-1][0]
    set_path(out, "riesgo.historial_precios.source_history", "eodhd")
    set_path(out, "riesgo.historial_precios.source_listing_id", f"EODHD:{sim}")
    set_path(out, "riesgo.historial_precios.first_date", s[0][0].isoformat())
    set_path(out, "riesgo.historial_precios.last_date", fin.isoformat())
    set_path(out, "riesgo.historial_precios.observations_count", len(s))


def _escribe_metricas(out: dict, s: metricas.Serie, div: str | None) -> None:
    """Rentabilidades y caída máxima a cierre de mes, en la divisa de la serie que recibe."""
    fin = metricas.cierre_mensual(s)
    if fin is None:
        return
    set_path(out, "rentabilidad.fecha_dato", fin.isoformat())
    for plazo, valor in metricas.rentabilidades(s, fin).items():
        set_path(out, f"rentabilidad.trailing_pct.{plazo}.fondo", valor)
    for ano, valor in metricas.por_ano_natural(s, fin).items():
        set_path(out, f"rentabilidad.por_año_natural.{ano}.fondo", valor)
    caida = metricas.caida_maxima(s, fin=fin)
    if caida is not None:
        set_path(out, "riesgo.max_drawdown.pct", caida)
        set_path(out, "riesgo.max_drawdown.periodo", f"{metricas.VENTANA_DRAWDOWN_ANOS}a")
    # Y la misma caída en cada ventana, que es lo que el contrato declara. La escalar de
    # arriba se queda: es la que se compara con la del proveedor, que viene con un periodo
    # suelto. Las dos salen de la misma función, así que no pueden discrepar.
    for plazo, valor in metricas.caidas_maximas(s, fin=fin).items():
        set_path(out, f"riesgo.max_drawdown_pct.{plazo}.fondo", valor)
    set_path(out, "riesgo.historial_precios.divisa_metricas", div)
    set_path(out, "riesgo.historial_precios.metodo",
             metricas.sello_del_metodo("cierre de mes, en euros, riesgo con rentabilidades mensuales"))
    huecos = metricas.huecos_por_ventana(s, fin)
    if huecos:
        set_path(out, "riesgo.historial_precios.huecos", huecos)
    # Versión 4 (MET-7): los meses cuyo último valor no es de su final, y las ventanas que pierden.
    sin_cierre = metricas.meses_sin_cierre(s, fin)
    if sin_cierre:
        set_path(out, "riesgo.historial_precios.meses_sin_cierre", sin_cierre)


def _escribe_riesgo(out: dict, s: metricas.Serie, tipos: list[tuple[date, float]]) -> None:
    r = metricas.riesgo(s, tipos, fin=metricas.cierre_mensual(s))
    if not r:
        return
    set_path(out, "riesgo.fecha_dato", r["fecha"])
    for plazo, _meses in metricas.VENTANAS_RIESGO:
        datos = r.get(plazo) or {}
        set_path(out, f"riesgo.volatilidad_pct.{plazo}.fondo", datos.get("volatilidad"))
        set_path(out, f"riesgo.sharpe.{plazo}.fondo", datos.get("sharpe"))
        set_path(out, f"riesgo.sortino.{plazo}.fondo", datos.get("sortino"))
        set_path(out, f"riesgo.rf_pct.{plazo}.fondo", datos.get("rf"))
    if any((r.get(p) or {}).get("sharpe") is not None for p, _m in metricas.VENTANAS_RIESGO):
        set_path(out, "riesgo.historial_precios.rf_referencia", "ESTR_EUR")
