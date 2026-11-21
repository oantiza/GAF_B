"""Sesión HTTP con rate-limit, caché en disco y reintentos.

Comportamiento "educado": nunca más de una petición cada N segundos por dominio,
con jitter aleatorio; las respuestas se cachean en disco y no se repiten
mientras la caché esté fresca.

Frescura (desde el 04-09): cada petición declara la familia de dato que sirve
(`familia="cartera"`) y la caché se lee con el TTL de esa familia
(`core.familias`), en vez del único `cache_dias`. El TTL se aplica al leer, así
que cambiarlo no invalida ni un byte de los 1,4 GB ya descargados. Dos modos
más, pensados para regenerar sin gastar red:

- `sin_caducidad`: cualquier entrada cacheada vale, tenga la edad que tenga.
- `sin_red`: además, un fallo de caché lanza `SinCache` en vez de salir a red.

Y un alias de lectura para el host que Morningstar retiró el 03-09
(`tools.morningstar.es` -> `lt.morningstar.com`): las respuestas viejas siguen
sirviendo bajo la URL nueva.
"""
from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit, urlencode

import requests

from core.familias import ttl_familias

log = logging.getLogger("fondosdb.http")

# Los parámetros de una URL que llevan una clave. Auditoría del 16-11-2026 (EXT-5): la clave de
# EODHD viaja en `api_token`, y cuando la conexión falla `requests` escribe la URL entera en su
# excepción. De ahí pasaba al registro (`logs/`), a `meta.errores` de la ficha y a la exportación.
_CLAVE_EN_URL = re.compile(r"(?i)\b(api_token|access_token|apikey|api_key|token|key)=([^&\s'\"<>)]+)")


def sin_claves(texto: object) -> str:
    """El texto de un error o de una URL, con el valor de sus claves tachado."""
    return _CLAVE_EN_URL.sub(r"\1=***", str(texto))

SIN_CADUCIDAD = float("inf")

# Hosts retirados por el proveedor: la caché escrita bajo el host viejo se sigue
# leyendo cuando se pide la misma ruta en el nuevo (solo lectura; se escribe
# siempre bajo la URL vigente).
HOSTS_ALIAS: dict[str, tuple[str, ...]] = {
    "lt.morningstar.com": ("tools.morningstar.es",),
}


class SinCache(ConnectionError):
    """Modo `sin_red`: la petición no está en caché y no se permite salir a red."""


def cache_key(url: str, params: dict | None) -> str:
    """Clave determinista de caché para una petición GET."""
    qs = urlencode(sorted((params or {}).items()))
    return hashlib.sha1(
        f"{url}?{qs}".encode("utf-8"), usedforsecurity=False
    ).hexdigest()


def es_csv_de_series_del_bce(texto: str) -> bool:
    """El CSV de series del BCE: su primera línea nombra la fecha y el valor."""
    cabecera = ((texto or "").lstrip().splitlines() or [""])[0]
    return "TIME_PERIOD" in cabecera and "OBS_VALUE" in cabecera


# Qué forma tiene una respuesta buena de cada sitio, por el principio de su dirección. Solo están los sitios donde
# una respuesta mala guardada hace daño a todo lo demás: el €STR y los cambios del BCE los lee cada cálculo de
# Sharpe y cada serie en otra divisa, con un día de plazo. Lo que no está aquí solo pasa la comprobación del vacío.
VALIDADORES: dict[str, Callable[[str], bool]] = {
    "https://data-api.ecb.europa.eu/service/data/": es_csv_de_series_del_bce,
}


def motivo_para_no_guardar(url: str, texto: str | None) -> str | None:
    """Por qué una respuesta sin error no debe ir a la caché, o `None` si puede ir.

    EXT-11 (auditoría del 16-11-2026): se guardaba cualquier respuesta por debajo de 400. Un cuerpo vacío —lo que
    devuelve un cortafuegos que pide un desafío con un 202— o una página de mantenimiento servida con un 200
    quedaban en la caché el plazo entero de su familia, y para las familias que una pasada no refresca, sin plazo.

    Solo decide si se GUARDA. La respuesta se devuelve igual a quien la pidió, que ya sabe leer un cuerpo que no
    le sirve; lo que cambia es que la siguiente petición vuelve a preguntar."""
    if not (texto or "").strip():
        return "respuesta vacía"
    for prefijo, valida in VALIDADORES.items():
        if url.startswith(prefijo) and not valida(texto):
            return "la respuesta no tiene la forma que da ese sitio"
    return None


class Respuesta:
    def __init__(self, status: int, text: str, desde_cache: bool,
                 fetched_at: float | None = None):
        self.status = status
        self.text = text
        self.desde_cache = desde_cache
        # Momento en que se descargó de verdad (aunque venga de caché): es lo
        # que la procedencia por campo necesita para decir cuán viejo es un dato.
        self.fetched_at = fetched_at

    def json(self):
        return json.loads(self.text)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


class Http:
    def __init__(self, settings: dict, cache_dir: Path, *,
                 sin_caducidad: bool = False, sin_red: bool = False,
                 refrescar: set[str] | None = None):
        self.s = settings
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": settings.get("user_agent", "Mozilla/5.0"),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        })
        self._ultimo_por_dominio: dict[str, float] = {}
        self.sin_caducidad = bool(sin_caducidad)
        self.sin_red = bool(sin_red)
        # Familias a refrescar en esta pasada; None = todas según su TTL. Las
        # que no estén se sirven de caché aunque hayan caducado.
        self.refrescar = set(refrescar) if refrescar is not None else None
        self.ttl_familias = ttl_familias(settings)
        self.estadisticas = {"red": 0, "cache": 0, "sin_cache": 0,
                             "por_dominio": {}, "por_familia": {}}

    # --------------------------------------------------------------- familias
    def ttl_para(self, familia: str | None) -> float:
        """TTL en días con el que se lee la caché para una familia de dato."""
        if self.sin_caducidad:
            return SIN_CADUCIDAD
        if familia is None:
            return float(self.s.get("cache_dias", 7))
        if self.refrescar is not None and familia not in self.refrescar:
            return SIN_CADUCIDAD
        return float(self.ttl_familias.get(familia, self.s.get("cache_dias", 7)))

    def _anota(self, origen: str, url: str, familia: str | None) -> None:
        e = self.estadisticas
        e[origen] += 1
        dominio = urlsplit(url).netloc
        d = e["por_dominio"].setdefault(dominio, {"red": 0, "cache": 0, "sin_cache": 0})
        d[origen] += 1
        f = e["por_familia"].setdefault(familia or "(sin familia)",
                                        {"red": 0, "cache": 0, "sin_cache": 0})
        f[origen] += 1

    # ------------------------------------------------------------------ utils
    def _espera_educada(self, url: str) -> None:
        dominio = urlsplit(url).netloc
        minimo = float(self.s.get("rate_limit_segundos", 1.0))
        jitter = random.uniform(0, float(self.s.get("jitter_segundos", 0.5)))
        ultimo = self._ultimo_por_dominio.get(dominio, 0.0)
        restante = (ultimo + minimo + jitter) - time.monotonic()
        if restante > 0:
            time.sleep(restante)
        self._ultimo_por_dominio[dominio] = time.monotonic()

    def _ruta_cache(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def _lee_cache(self, key: str, ttl_dias: float) -> Respuesta | None:
        ruta = self._ruta_cache(key)
        if not ruta.exists():
            return None
        try:
            payload = json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:
            return None
        fetched_at = payload.get("fetched_at", 0)
        edad_dias = (time.time() - fetched_at) / 86400
        if edad_dias > ttl_dias:
            return None
        return Respuesta(payload["status"], payload["text"], desde_cache=True,
                         fetched_at=fetched_at)

    def _claves_alias(self, url: str, params: dict | None) -> list[str]:
        """Claves de caché equivalentes bajo hosts retirados (solo lectura)."""
        partes = urlsplit(url)
        claves = []
        for viejo in HOSTS_ALIAS.get(partes.netloc, ()):
            claves.append(cache_key(partes._replace(netloc=viejo).geturl(), params))
        return claves

    def _lee_cache_con_alias(self, url: str, params: dict | None, key: str,
                             ttl: float) -> Respuesta | None:
        cacheada = self._lee_cache(key, ttl)
        if cacheada is not None:
            return cacheada
        for alias in self._claves_alias(url, params):
            cacheada = self._lee_cache(alias, ttl)
            if cacheada is not None:
                log.debug("cache hit (host retirado) %s", url)
                return cacheada
        return None

    def _escribe_cache(self, key: str, url: str, r: requests.Response) -> None:
        payload = {"url": url, "status": r.status_code,
                   "fetched_at": time.time(), "text": r.text}
        self._ruta_cache(key).write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------------------------- get
    def get(self, url: str, params: dict | None = None,
            headers: dict | None = None, ttl_dias: float | None = None,
            force: bool = False, familia: str | None = None) -> Respuesta:
        """GET con caché y reintentos. Lanza excepción solo si agota reintentos.

        `familia` decide el TTL de lectura (ver `core.familias`); `ttl_dias`
        explícito lo sobreescribe, salvo en los modos `sin_caducidad` o con
        familias excluidas del refresco, que siempre sirven la caché.
        """
        return self._pide("GET", url, params, headers, ttl_dias, force, familia, None)

    def post_json(self, url: str, params: dict | None = None, cuerpo: dict | None = None,
                  headers: dict | None = None, ttl_dias: float | None = None,
                  force: bool = False, familia: str | None = None) -> Respuesta:
        """POST con cuerpo JSON, cacheado como un GET (la clave incluye el cuerpo).

        Para APIs de consulta que solo aceptan POST (el GECO de la AMF): es una
        lectura y merece el mismo ritmo, caché y reintentos.
        """
        return self._pide("POST", url, params, headers, ttl_dias, force, familia, cuerpo or {})

    def _pide(self, metodo: str, url: str, params: dict | None, headers: dict | None,
              ttl_dias: float | None, force: bool, familia: str | None,
              cuerpo: dict | None) -> Respuesta:
        if ttl_dias is None:
            ttl = self.ttl_para(familia)
        else:
            ttl = float(ttl_dias)
            if self.sin_caducidad or (self.refrescar is not None and familia is not None
                                      and familia not in self.refrescar):
                ttl = SIN_CADUCIDAD
        if cuerpo is not None:
            firma = hashlib.sha1(json.dumps(cuerpo, sort_keys=True).encode("utf-8"),
                                 usedforsecurity=False).hexdigest()[:16]
            key = cache_key(f"{url}#post:{firma}", params)
        else:
            key = cache_key(url, params)
        if not force or self.sin_red:
            cacheada = self._lee_cache_con_alias(url, params, key, ttl)
            if cacheada is not None:
                log.debug("cache hit %s", url)
                self._anota("cache", url, familia)
                return cacheada
        if self.sin_red:
            self._anota("sin_cache", url, familia)
            raise SinCache(f"sin caché y sin red: {url}")
        self._anota("red", url, familia)

        reintentos = int(self.s.get("reintentos", 3))
        backoff = float(self.s.get("backoff_segundos", 4))
        timeout = float(self.s.get("timeout_segundos", 25))
        ultimo_error: Exception | None = None
        r = None
        for intento in range(1, reintentos + 1):
            try:
                self._espera_educada(url)
                if cuerpo is not None:
                    r = self.session.post(url, params=params, headers=headers,
                                          json=cuerpo, timeout=timeout)
                else:
                    r = self.session.get(url, params=params, headers=headers,
                                         timeout=timeout)
                if r.status_code == 429:
                    # throttling del servidor: espera lo que pida (o 45s/intento)
                    self._rachas_throttle = getattr(self, "_rachas_throttle", 0) + 1
                    try:
                        espera = float(r.headers.get("Retry-After") or 0)
                    except (TypeError, ValueError):
                        espera = 0
                    espera = max(espera, min(45 * intento, 90))
                    if self._rachas_throttle >= 4:
                        espera = 150
                        self._rachas_throttle = 0
                        log.warning("THROTTLING sostenido: enfriamiento de "
                                    "150s antes de seguir...")
                    else:
                        log.warning("HTTP 429 (intento %s/%s); espero %.0fs",
                                    intento, reintentos, espera)
                    time.sleep(espera)
                    continue
                if r.status_code in (500, 502, 503, 504):
                    if intento < reintentos:
                        log.warning("HTTP %s (intento %s/%s); espero %.0fs",
                                    r.status_code, intento, reintentos, backoff)
                        time.sleep(backoff)
                        continue
                    # persistente: lo devolvemos como no-ok en vez de excepción
                    self._rachas_throttle = 0
                    return Respuesta(r.status_code, r.text, desde_cache=False)
                self._rachas_throttle = 0
                if r.status_code < 400:
                    motivo = motivo_para_no_guardar(url, r.text)
                    if motivo:
                        log.warning("%s: %s; no se guarda en caché", urlsplit(url).netloc, motivo)
                    else:
                        self._escribe_cache(key, url, r)
                return Respuesta(r.status_code, r.text, desde_cache=False,
                                 fetched_at=time.time())
            except requests.RequestException as e:  # errores de red
                ultimo_error = e
                espera = backoff * (2 ** (intento - 1))
                log.warning("red: intento %s/%s fallo (%s); espero %.0fs",
                            intento, reintentos, sin_claves(e), espera)
                if intento < reintentos:
                    time.sleep(espera)
        if r is not None:  # agotado por 429: no-ok, sin matar el lote
            return Respuesta(r.status_code, r.text, desde_cache=False)
        raise ConnectionError(f"Agotados reintentos para {url}: {sin_claves(ultimo_error)}")

    # -------------------------------------------------------------- download
    def download(self, url: str, destino: Path, force: bool = False, *,
                 headers: dict | None = None, opcional: bool = False,
                 familia: str | None = None, params: dict | None = None) -> Path | None:
        """Descarga binaria en streaming (ZIP, PDF...). No usa la caché JSON:
        si el fichero destino existe y no se fuerza, se reutiliza.

        `opcional=True` es para documentos que pueden no existir (el KID de una
        gestora bajo un patrón de URL): un 4xx devuelve None a la primera, sin
        reintentos ni excepción, y el llamador prueba la siguiente fuente.
        `familia` solo anota la petición en las estadísticas de la pasada.
        """
        destino = Path(destino)
        if destino.exists() and destino.stat().st_size > 0 and not force:
            log.debug("download: reutilizo %s", destino.name)
            self._anota("cache", url, familia)
            return destino
        if self.sin_red:
            self._anota("sin_cache", url, familia)
            raise SinCache(f"sin caché y sin red: {url}")
        self._anota("red", url, familia)
        destino.parent.mkdir(parents=True, exist_ok=True)
        reintentos = int(self.s.get("reintentos", 3))
        backoff = float(self.s.get("backoff_segundos", 4))
        timeout = float(self.s.get("timeout_segundos", 25))
        tmp = destino.with_suffix(destino.suffix + ".part")
        ultimo_error: Exception | None = None
        for intento in range(1, reintentos + 1):
            try:
                self._espera_educada(url)
                with self.session.get(url, params=params, headers=headers,
                                      timeout=max(timeout, 120), stream=True) as r:
                    if r.status_code == 429:
                        try:
                            espera = float(r.headers.get("Retry-After") or 0)
                        except (TypeError, ValueError):
                            espera = 0
                        espera = max(espera, min(45 * intento, 90))
                        log.warning("download HTTP 429 (intento %s/%s); "
                                    "espero %.0fs", intento, reintentos, espera)
                        time.sleep(espera)
                        continue
                    if r.status_code in (500, 502, 503, 504) and intento < reintentos:
                        espera = backoff * (2 ** (intento - 1))
                        log.warning("download HTTP %s (intento %s/%s); "
                                    "espero %.0fs", r.status_code, intento,
                                    reintentos, espera)
                        time.sleep(espera)
                        continue
                    if opcional and 400 <= r.status_code < 500:
                        log.debug("download opcional: HTTP %s en %s", r.status_code, url)
                        return None
                    r.raise_for_status()
                    with tmp.open("wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            if chunk:
                                f.write(chunk)
                    tmp.replace(destino)
                    log.info("descargado %s (%.1f MB)", destino.name,
                             destino.stat().st_size / 1e6)
                    return destino
            except requests.RequestException as e:
                ultimo_error = e
                espera = backoff * (2 ** (intento - 1))
                log.warning("download red: intento %s/%s fallo (%s); "
                            "espero %.0fs", intento, reintentos, sin_claves(e), espera)
                if intento < reintentos:
                    time.sleep(espera)
            finally:
                if tmp.exists() and (not destino.exists() or tmp.stat().st_size == 0):
                    try:
                        tmp.unlink()
                    except OSError:
                        pass
        raise ConnectionError(f"Agotados reintentos de descarga para {sin_claves(url)}: "
                              f"{sin_claves(ultimo_error)}")
