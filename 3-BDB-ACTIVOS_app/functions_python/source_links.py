# -*- coding: utf-8 -*-
"""La dirección final de las fuentes de un informe de estrategia (decisión 69 de Óscar, 05-11-2026).

Gemini da cada fuente como una redirección de Google, y esas redirecciones caducan: un PDF archivado
dejaría de poder comprobar una cifra. Aquí se sigue cada una, una vez, al generar el informe, y se guarda
adónde lleva. Lo guardado antes no se toca. Papel y pantalla leen `url` sin saber de dónde sale.

Esto es una petición de servidor a una dirección que da un tercero, desde una Function con credenciales, y
los enlaces de Google redirigen a cualquier sitio. Por eso cada salto se comprueba antes de pedirlo: solo
http y https, puertos normales, sin usuario en la dirección, y todas las IP del nombre públicas. La conexión
se fija a las IP comprobadas, para que el DNS no pueda contestar otra cosa entre la comprobación y la
petición, y después se mira con quién se ha hablado. No se manda ninguna credencial ni se lee ningún cuerpo.

Un enlace que no se resuelve nunca tumba el informe. Lo que queda en cada fuente:

    sin `redirect_url` ni `link_issue`    contestó sin redirigir: esa ya era la dirección final
    `redirect_url`                        `url` es la final y contestó; `redirect_url`, la que dio Gemini
    `redirect_url` y `link_issue`         se sabe adónde lleva, pero el destino no lo confirmó: no contestó, dio
                                          un error, no acaba sin cookies o manda a un muro de consentimiento
    `link_issue` solo                     sigue la que dio Gemini, sin resolver

`resolve_sources` devuelve además el recuento, que va a `generation.source_resolution`: así se sabe cuáles
quedan sin mirar fuente por fuente.
"""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from urllib.parse import quote, quote_from_bytes, urlsplit, urlunsplit

from curl_cffi import Curl, CurlInfo, CurlOpt
from curl_cffi.curl import CURL_WRITEFUNC_ERROR, CurlError

# El tope de `sources[].url` en `weekly_report._validate_sources`.
MAX_SOURCE_URL_CHARS = 2000
# Lo normal son 2 saltos de menos de un segundo. El tope total no toca los 420 s de la cascada: se gasta en el
# margen hasta los 540 s de la Function, y con 6 a la vez doce enlaces lentos caben en él.
REQUEST_TIMEOUT_SEC = 5
LINK_TIMEOUT_SEC = 10
TOTAL_TIMEOUT_SEC = 25
MAX_HOPS = 8
MAX_PARALLEL = 6
# `getaddrinfo` no admite plazo: un DNS que no contesta no puede dejar esperando a una persona.
_TOTAL_GRACE_SEC = 1

USER_AGENT = "Mozilla/5.0 (compatible; GestorActivosFinancieros/1.0; comprobacion de fuentes)"

TIMEOUT = "TIMEOUT"
NETWORK_ERROR = "NETWORK_ERROR"
DNS_ERROR = "DNS_ERROR"
NO_LOCATION = "NO_LOCATION"
NO_REDIRECT = "NO_REDIRECT"
WALL = "WALL"
INVALID_URL = "INVALID_URL"
URL_TOO_LONG = "URL_TOO_LONG"
LOOP = "LOOP"
TOO_MANY_HOPS = "TOO_MANY_HOPS"
BLOCKED_SCHEME = "BLOCKED_SCHEME"
BLOCKED_PORT = "BLOCKED_PORT"
BLOCKED_CREDENTIALS = "BLOCKED_CREDENTIALS"
BLOCKED_HOST = "BLOCKED_HOST"
BLOCKED_ADDRESS = "BLOCKED_ADDRESS"
TOTAL_DEADLINE = "TOTAL_DEADLINE"
INTERNAL_ERROR = "INTERNAL_ERROR"

# Una cadena que intenta salir de internet no tiene un destino que guardar: se queda la de Gemini, que caducará.
# En los demás fallos, la última dirección comprobada vale más que una que caduca: lo que no contesta a un robot
# sin cookies puede contestar a una persona, y Google ya ha dicho adónde lleva.
_KEEP_THE_ORIGINAL = frozenset({
    BLOCKED_SCHEME, BLOCKED_PORT, BLOCKED_CREDENTIALS, BLOCKED_HOST, BLOCKED_ADDRESS,
})

_PORTS = {"http": 80, "https": 443}
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_CURLE_WRITE_ERROR = 23  # El corte de `_request` al primer byte del cuerpo: es lo esperado.
_CURLE_OPERATION_TIMEDOUT = 28
# Todo lo demás se escapa: letras fuera de ASCII, espacios, comillas, la barra invertida, controles.
_URL_SAFE = "!#$%&'()*+,-./:;=?@[]_~"

_HOSTNAME = re.compile(r"[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+")
# «127.1», «0x7f.1» o «0177.0.0.1» no son nombres: son IP escritas para que no lo parezcan.
_NUMERIC_LABEL = re.compile(r"\d+|0x[0-9a-f]*")
_INTERNAL_HOSTS = frozenset({"metadata.goog"})
_INTERNAL_SUFFIXES = (".localhost", ".localdomain", ".local", ".internal", ".intranet", ".lan", ".home.arpa")
_NAT64 = ipaddress.ip_network("64:ff9b::/96")
# La dirección de Google no es una dirección final aunque conteste 200.
_REDIRECTOR_HOSTS = frozenset({"vertexaisearch.cloud.google.com"})

# Lo que un servidor enseña a un robot sin sesión desde un centro de datos europeo: la sesión de
# consentimiento o de acceso no es la página, y una portada tampoco si venía de un artículo.
_WALL_HOST_LABELS = frozenset({"consent", "guce", "login", "signin", "accounts", "auth"})
_WALL_PATH_SEGMENTS = frozenset({
    "consent", "collectconsent", "login", "log-in", "signin", "sign-in", "auth", "sorry", "captcha",
    "challenge", "paywall", "subscribe", "register", "gdpr", "gdpr-block",
})
_TRACKING_PARAMS = ("utm_", "gclid=", "fbclid=")

_logger = logging.getLogger("bdb.source_links")
# Indirección para poder fijar el reloj en las pruebas.
_monotonic = time.monotonic


class _LinkFailure(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class HopResponse:
    status: int
    location: str


@dataclass(frozen=True)
class Target:
    url: str
    addresses: tuple[str, ...]
    pin: str | None


def _is_public(address: str) -> bool:
    """Solo lo que se alcanza desde internet. Una IPv6 que envuelve una IPv4 se mira por dentro o no se admite."""
    ip = ipaddress.ip_address(address)
    if ip.version == 6:
        if ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        elif ip.sixtofour or ip.teredo or ip in _NAT64 or ip.is_site_local:
            return False
    return ip.is_global and not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


def _addresses_of(host: str, port: int) -> list[str]:
    try:
        return sorted({info[4][0].split("%", 1)[0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})
    except OSError as exc:
        raise _LinkFailure(DNS_ERROR) from exc


def _check_url(url: str) -> tuple:
    """Lo que se decide leyendo la dirección. Se escapa antes de leerla, para que nadie la lea de otra manera."""
    url = quote(url, safe=_URL_SAFE)
    if len(url) > MAX_SOURCE_URL_CHARS:
        raise _LinkFailure(URL_TOO_LONG)
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").rstrip(".").lower()
        port = parts.port
        has_credentials = parts.username is not None or parts.password is not None
    except ValueError as exc:
        raise _LinkFailure(INVALID_URL) from exc
    if parts.scheme not in _PORTS:
        raise _LinkFailure(BLOCKED_SCHEME)
    if has_credentials:
        raise _LinkFailure(BLOCKED_CREDENTIALS)
    if port is not None and port != _PORTS[parts.scheme]:
        raise _LinkFailure(BLOCKED_PORT)
    if not host:
        raise _LinkFailure(INVALID_URL)
    # Un % en el nombre es una zona IPv6, y entonces es de enlace local, o una forma de que libcurl lea otro nombre.
    if "%" in host:
        raise _LinkFailure(BLOCKED_ADDRESS if ":" in host else INVALID_URL)
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(str(literal)):
            raise _LinkFailure(BLOCKED_ADDRESS)
        return parts, host, literal
    if "." not in host or _NUMERIC_LABEL.fullmatch(host.rsplit(".", 1)[-1]):
        raise _LinkFailure(BLOCKED_HOST)
    if not _HOSTNAME.fullmatch(host):
        raise _LinkFailure(INVALID_URL)
    if host in _INTERNAL_HOSTS or host.endswith(_INTERNAL_SUFFIXES):
        raise _LinkFailure(BLOCKED_HOST)
    return parts, host, None


def _check_addresses(parts, host: str, literal) -> Target:
    """Las IP del nombre, todas públicas, y la petición se fija a ellas. Se pide lo que se ha comprobado."""
    port = parts.port or _PORTS[parts.scheme]
    if literal is not None:
        addresses = [str(literal)]
        pin = None
    else:
        addresses = _addresses_of(host, port)
        if not addresses:
            raise _LinkFailure(DNS_ERROR)
        try:
            if not all(_is_public(item) for item in addresses):
                raise _LinkFailure(BLOCKED_ADDRESS)
        except ValueError as exc:
            raise _LinkFailure(BLOCKED_ADDRESS) from exc
        pin = f"{host}:{port}:" + ",".join(f"[{item}]" if ":" in item else item for item in addresses)
    netloc = f"[{literal}]" if literal is not None and literal.version == 6 else host
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    return Target(
        url=urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, "")),
        addresses=tuple(str(ipaddress.ip_address(item)) for item in addresses),
        pin=pin,
    )


def _request(target: Target, timeout: float) -> HopResponse:
    """Una petición, sin seguir nada y sin cuerpo, con plazo para toda la transferencia.

    Va sin cookies, sin credenciales y sin más cabecera que el agente. `stream=True` de `curl_requests` no
    aplica un plazo total, y aquí un servidor podría gotear las cabeceras: por eso se monta a mano.
    """
    curl = Curl()
    try:
        curl.setopt(CurlOpt.URL, target.url.encode("ascii"))
        curl.setopt(CurlOpt.TIMEOUT_MS, max(1, int(timeout * 1000)))
        curl.setopt(CurlOpt.NOSIGNAL, 1)
        curl.setopt(CurlOpt.FOLLOWLOCATION, 0)
        curl.setopt(CurlOpt.PROXY, b"")
        curl.setopt(CurlOpt.PROTOCOLS_STR, b"http,https")
        curl.setopt(CurlOpt.USERAGENT, USER_AGENT.encode("ascii"))
        if target.pin:
            curl.setopt(CurlOpt.RESOLVE, [target.pin])
        curl.setopt(CurlOpt.WRITEFUNCTION, lambda _chunk: CURL_WRITEFUNC_ERROR)
        try:
            curl.perform()
        except CurlError as exc:
            code = int(exc.code) if exc.code is not None else None
            if code == _CURLE_OPERATION_TIMEDOUT:
                raise _LinkFailure(TIMEOUT) from exc
            if code != _CURLE_WRITE_ERROR:
                raise _LinkFailure(NETWORK_ERROR) from exc
        peer = curl.getinfo(CurlInfo.PRIMARY_IP)
        peer = peer.decode("ascii", "replace") if isinstance(peer, bytes) else str(peer or "")
        if peer:
            try:
                if str(ipaddress.ip_address(peer)) not in target.addresses:
                    raise _LinkFailure(BLOCKED_ADDRESS)
            except ValueError as exc:
                raise _LinkFailure(BLOCKED_ADDRESS) from exc
        location = curl.getinfo(CurlInfo.REDIRECT_URL) or b""
        location = location if isinstance(location, bytes) else str(location).encode("utf-8")
        return HopResponse(status=int(curl.getinfo(CurlInfo.RESPONSE_CODE)), location=quote_from_bytes(location, safe=_URL_SAFE))
    finally:
        curl.close()


def _is_wall(current: str, following: str) -> bool:
    """La página vale más que la sesión de consentimiento, el acceso o la portada a la que manda a un robot."""
    try:
        before, after = urlsplit(current), urlsplit(following)
        host = (after.hostname or "").lower()
        came_from_google = (before.hostname or "").lower() in _REDIRECTOR_HOSTS
    except ValueError:
        return False
    if host.split(".", 1)[0] in _WALL_HOST_LABELS:
        return True
    if any(segment.lower() in _WALL_PATH_SEGMENTS for segment in after.path.split("/")):
        return True
    # De Google a una portada es una fuente que es una portada. De un artículo a la portada, no.
    return not came_from_google and before.path.strip("/") != "" and after.path.strip("/") == "" and not after.query


def _issue_on_arrival(url: str, status: int) -> str | None:
    if 200 <= status < 300:
        return NO_REDIRECT if (urlsplit(url).hostname or "").lower() in _REDIRECTOR_HOSTS else None
    return f"HTTP_{status}"


def _follow(original: str, total_deadline: float) -> tuple[str, str | None]:
    """La dirección que se guarda y el motivo, si lo hay. No lanza: un enlace no tumba un informe."""
    deadline = min(_monotonic() + LINK_TIMEOUT_SEC, total_deadline)
    url = original
    last_good = original
    seen: set[str] = set()
    previous = None
    hops = 0
    try:
        while True:
            parts, host, literal = _check_url(url)
            if previous is not None and _is_wall(previous, url):
                raise _LinkFailure(WALL)
            last_good = url
            target = _check_addresses(parts, host, literal)
            if target.url in seen:
                raise _LinkFailure(LOOP)
            seen.add(target.url)
            remaining = deadline - _monotonic()
            if remaining <= 0:
                raise _LinkFailure(TIMEOUT)
            response = _request(target, min(REQUEST_TIMEOUT_SEC, remaining))
            if response.status not in _REDIRECT_STATUSES:
                return url, _issue_on_arrival(url, response.status)
            if not response.location:
                raise _LinkFailure(NO_LOCATION)
            hops += 1
            if hops > MAX_HOPS:
                raise _LinkFailure(TOO_MANY_HOPS)
            previous, url = url, response.location
    except _LinkFailure as failure:
        return (original if failure.reason in _KEEP_THE_ORIGINAL else last_good), failure.reason
    except Exception as exc:  # noqa: BLE001 - un enlace no tumba un informe, y el motivo queda marcado.
        _logger.warning("strategy_report_source_error type=%s", type(exc).__name__)
        return last_good, INTERNAL_ERROR


def _page_key(url: str) -> tuple:
    """Lo que hace que dos direcciones sean la misma página para quien las abre."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        return (url,)
    query = sorted(item for item in parts.query.split("&") if item and not item.lower().startswith(_TRACKING_PARAMS))
    return (host[4:] if host.startswith("www.") else host, parts.path.rstrip("/"), tuple(query))


def _final_title(title: str, original: str, final: str) -> str:
    """El título no cambia, salvo que sea el nombre de la propia redirección: entonces dice el del destino."""
    if title != urlsplit(original).netloc:
        return title
    host = (urlsplit(final).hostname or "").lower()
    return (host[4:] if host.startswith("www.") else host)[:180] or title


def _follow_all(sources: list[dict], total_deadline: float) -> tuple[list[tuple[str, str | None] | None], str]:
    """Los enlaces, a la vez. Lo que no ha acabado a tiempo se queda en None, con el motivo por el que falta."""
    results: list[tuple[str, str | None] | None] = [None] * len(sources)
    if not sources:
        return results, TOTAL_DEADLINE
    missing_reason = TOTAL_DEADLINE
    executor = None
    try:
        executor = ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(sources)), thread_name_prefix="source-links")
        futures = {executor.submit(_follow, source["url"], total_deadline): index for index, source in enumerate(sources)}
        done, _ = wait(futures, timeout=TOTAL_TIMEOUT_SEC + _TOTAL_GRACE_SEC)
        for future in done:
            results[futures[future]] = future.result()
    except Exception as exc:  # noqa: BLE001 - sin hilos o con un fallo propio, tampoco se tumba el informe.
        _logger.warning("strategy_report_sources_error type=%s", type(exc).__name__)
        missing_reason = INTERNAL_ERROR
    finally:
        # Sin esperar: lo único que puede seguir vivo es un DNS sin plazo, y al volver no pedirá nada a tiempo.
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)
    return results, missing_reason


def resolve_sources(sources: list[dict]) -> tuple[list[dict], dict]:
    """Las fuentes con su dirección final, sin duplicadas, y el recuento. Un enlace nunca hace que lance."""
    started = _monotonic()
    results, missing_reason = _follow_all(sources, started + TOTAL_TIMEOUT_SEC)
    final_sources: list[dict] = []
    pages: set[tuple] = set()
    duplicates = 0
    reasons: Counter = Counter()
    counts = {"final": 0, "unconfirmed": 0, "unresolved": 0}
    for source, result in zip(sources, results):
        original = source["url"]
        url, reason = result if result is not None else (original, missing_reason)
        page = _page_key(url)
        if page in pages:
            duplicates += 1
            continue
        pages.add(page)
        kept = dict(source)
        if url != original:
            kept.update(title=_final_title(source["title"], original, url), url=url, redirect_url=original)
        if reason:
            kept["link_issue"] = reason
            reasons[reason] += 1
            counts["unconfirmed" if url != original else "unresolved"] += 1
        else:
            counts["final"] += 1
        final_sources.append(kept)
    summary = {"total": len(sources), **counts, "duplicates_removed": duplicates,
               "seconds": round(_monotonic() - started, 1)}
    if reasons:
        summary["reasons"] = dict(sorted(reasons.items()))
        _logger.warning("strategy_report_sources %s", summary)
    else:
        _logger.info("strategy_report_sources %s", summary)
    return final_sources, summary
