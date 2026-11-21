# -*- coding: utf-8 -*-
"""Decision 69 de Oscar: se guarda la direccion final de cada fuente, sin abrir una SSRF por el camino.

La primera parte simula el internet entero. La ultima habla de verdad con libcurl contra un servidor local, porque
lo que protege -- fijar las IP, no seguir nada, no leer el cuerpo, el plazo total -- es justo lo que un simulacro
no puede comprobar. Nada de esto sale a internet.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import ssl
import threading
import time

import pytest

import source_links
import weekly_report
from atomic_firestore_fake import Database
from source_links import HopResponse, Target, resolve_sources
from test_weekly_report import valid_daily_report, valid_report

# Antes de que la fixture de conftest los sustituya.
REAL_REQUEST = source_links._request
REAL_ADDRESSES = source_links._addresses_of

NOW = datetime(2026, 11, 5, 7, tzinfo=timezone.utc)
G = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/"
PAGE = "https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029.en.html"


class Web:
    """Un internet simulado: cada direccion contesta lo que se le diga, y queda escrito lo que se ha pedido."""

    def __init__(self):
        self.pages = {}
        self.dns = {}
        self.asked = []
        self.timeouts = []

    def addresses(self, host, _port):
        answer = self.dns.get(host, ["93.184.216.34"])
        if isinstance(answer, Exception):
            raise answer
        return answer

    def request(self, target, timeout):
        self.asked.append(target.url)
        self.timeouts.append(timeout)
        answer = self.pages[target.url]
        if isinstance(answer, Exception):
            raise answer
        return HopResponse(*answer) if isinstance(answer, tuple) else HopResponse(answer, "")


@pytest.fixture
def web(monkeypatch):
    fake = Web()
    monkeypatch.setattr(source_links, "_addresses_of", fake.addresses)
    monkeypatch.setattr(source_links, "_request", fake.request)
    return fake


def one(url, title="ecb.europa.eu"):
    sources, summary = resolve_sources([{"title": title, "url": url}])
    assert len(sources) == 1
    return sources[0], summary


def two_for_the_validator(source):
    """Lo que sale tiene que pasar el contrato tal cual, con el minimo de dos fuentes."""
    other = {"title": "bls.gov", "url": "https://www.bls.gov/news.release/cpi.nr0.htm"}
    assert weekly_report._validate_sources([source, other], required=True)


# --------------------------------------------------------------------------- #
# Los casos del encargo.                                                        #
# --------------------------------------------------------------------------- #

def test_redireccion_normal(web):
    web.pages = {G + "a": (302, PAGE), PAGE: 200}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": PAGE, "redirect_url": G + "a"}
    assert summary["total"] == summary["final"] == 1
    assert summary["unconfirmed"] == summary["unresolved"] == summary["duplicates_removed"] == 0
    assert "reasons" not in summary
    assert web.asked == [G + "a", PAGE]
    two_for_the_validator(source)


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_todos_los_codigos_de_redireccion_se_siguen(web, status):
    web.pages = {G + "a": (status, PAGE), PAGE: 200}
    assert one(G + "a")[0]["url"] == PAGE


def test_cadena_de_varias(web):
    middle = ["http://ecb.europa.eu/a", "https://ecb.europa.eu/a", "https://www.ecb.europa.eu/a"]
    web.pages = {
        G + "a": (302, middle[0]), middle[0]: (301, middle[1]), middle[1]: (301, middle[2]),
        middle[2]: (302, PAGE), PAGE: 200,
    }
    source, summary = one(G + "a")
    assert source["url"] == PAGE and source["redirect_url"] == G + "a"
    assert "link_issue" not in source and summary["final"] == 1
    assert web.asked == [G + "a", *middle, PAGE]


@pytest.mark.parametrize("private", [
    "http://10.0.0.1/admin",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://127.0.0.1:80/",
    "http://127.0.0.1/",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:10.0.0.1]/",
    "https://192.168.1.1:443/",
])
def test_a_ip_privada(web, private):
    web.pages = {G + "a": (302, private)}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": source_links.BLOCKED_ADDRESS}
    assert summary["unresolved"] == 1 and summary["reasons"] == {source_links.BLOCKED_ADDRESS: 1}
    assert web.asked == [G + "a"]  # A la direccion privada no se le ha pedido nada.
    two_for_the_validator(source)


@pytest.mark.parametrize("metadata,reason", [
    ("http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token", source_links.BLOCKED_ADDRESS),
    ("http://169.254.169.254/latest/meta-data/", source_links.BLOCKED_ADDRESS),
    ("http://metadata.google.internal/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://METADATA.GOOGLE.INTERNAL./computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://metadata.goog/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://metadata/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://[fd20:ce::254]/computeMetadata/v1/", source_links.BLOCKED_ADDRESS),
    ("http://[::ffff:169.254.169.254]/", source_links.BLOCKED_ADDRESS),
    ("http://[::ffff:a9fe:a9fe]/", source_links.BLOCKED_ADDRESS),
    ("http://[64:ff9b::a9fe:a9fe]/", source_links.BLOCKED_ADDRESS),
    ("http://[2002:a9fe:a9fe::]/", source_links.BLOCKED_ADDRESS),
    # La misma IP escrita para que no se le reconozca: decimal, hexadecimal, octal, abreviada.
    ("http://2852039166/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://0xA9FEA9FE/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://0251.0376.0251.0376/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://169.254.43518/computeMetadata/v1/", source_links.BLOCKED_HOST),
    ("http://0xa9.0xfe.0xa9.0xfe/", source_links.BLOCKED_HOST),
])
def test_a_metadatos(web, metadata, reason):
    web.pages = {G + "a": (302, metadata)}
    source, summary = one(G + "a")
    assert source["url"] == G + "a" and source["link_issue"] == reason
    assert "redirect_url" not in source and summary["unresolved"] == 1
    assert web.asked == [G + "a"]


def test_un_nombre_publico_que_resuelve_a_metadatos_no_se_pide(web):
    web.pages = {G + "a": (302, "http://169.254.169.254.nip.io/computeMetadata/v1/")}
    web.dns = {"169.254.169.254.nip.io": ["169.254.169.254"]}
    source, _ = one(G + "a")
    assert source["url"] == G + "a" and source["link_issue"] == source_links.BLOCKED_ADDRESS
    assert web.asked == [G + "a"]


def test_un_nombre_con_una_sola_ip_privada_entre_las_publicas_no_se_pide(web):
    web.pages = {G + "a": (302, "https://rebind.example/x")}
    web.dns = {"rebind.example": ["93.184.216.34", "10.0.0.1"]}
    source, _ = one(G + "a")
    assert source["link_issue"] == source_links.BLOCKED_ADDRESS and source["url"] == G + "a"
    assert web.asked == [G + "a"]


def test_a_mitad_de_cadena_tambien_se_comprueba_cada_salto(web):
    first = "https://www.example.com/a"
    web.pages = {G + "a": (302, first), first: (302, "http://169.254.169.254/latest/")}
    source, _ = one(G + "a")
    assert source["url"] == G + "a" and source["link_issue"] == source_links.BLOCKED_ADDRESS
    assert web.asked == [G + "a", first]


def test_una_ip_privada_sin_ruta_no_pasa_por_una_portada(web):
    """De un articulo a la raiz parece un muro, pero aqui lo que manda es a donde intenta ir."""
    first = "https://www.example.com/a"
    web.pages = {G + "a": (302, first), first: (302, "http://10.0.0.1/")}
    source, _ = one(G + "a")
    assert source["url"] == G + "a" and source["link_issue"] == source_links.BLOCKED_ADDRESS


def test_timeout_en_google(web):
    web.pages = {G + "a": source_links._LinkFailure(source_links.TIMEOUT)}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": source_links.TIMEOUT}
    assert summary["unresolved"] == 1 and summary["reasons"] == {source_links.TIMEOUT: 1}
    two_for_the_validator(source)


def test_timeout_en_el_destino_guarda_el_destino_marcado(web):
    """Google ya ha dicho adonde va y esa direccion esta comprobada: vale mas que una que caduca."""
    web.pages = {G + "a": (302, PAGE), PAGE: source_links._LinkFailure(source_links.TIMEOUT)}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": PAGE, "redirect_url": G + "a", "link_issue": source_links.TIMEOUT}
    assert summary["unconfirmed"] == 1 and summary["final"] == 0
    two_for_the_validator(source)


def test_404_final(web):
    web.pages = {G + "a": (302, PAGE), PAGE: 404}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": PAGE, "redirect_url": G + "a", "link_issue": "HTTP_404"}
    assert summary["unconfirmed"] == 1 and summary["reasons"] == {"HTTP_404": 1}


def test_404_de_google_es_un_enlace_caducado(web):
    web.pages = {G + "a": 404}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": "HTTP_404"}
    assert summary["unresolved"] == 1


@pytest.mark.parametrize("status", [401, 403, 429, 451, 500, 503])
def test_un_destino_que_rechaza_a_un_robot_sigue_siendo_la_direccion(web, status):
    web.pages = {G + "a": (302, PAGE), PAGE: status}
    source, _ = one(G + "a")
    assert source["url"] == PAGE and source["link_issue"] == f"HTTP_{status}"


def test_sin_location_en_google(web):
    web.pages = {G + "a": (302, "")}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": source_links.NO_LOCATION}
    assert summary["unresolved"] == 1


def test_sin_location_en_el_destino(web):
    web.pages = {G + "a": (302, PAGE), PAGE: (301, "")}
    source, summary = one(G + "a")
    assert source["url"] == PAGE and source["link_issue"] == source_links.NO_LOCATION
    assert summary["unconfirmed"] == 1


def test_bucle(web):
    """Lo tipico de un sitio que comprueba cookies: a un robot no le acaba, y a una persona si."""
    a, b = "https://www.example.com/a", "https://www.example.com/a?cookies=1"
    web.pages = {G + "a": (302, a), a: (302, b), b: (302, a)}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": a, "redirect_url": G + "a", "link_issue": source_links.LOOP}
    assert summary["unconfirmed"] == 1
    assert web.asked == [G + "a", a, b]
    two_for_the_validator(source)


def test_bucle_sobre_si_misma(web):
    web.pages = {G + "a": (302, G + "a")}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": source_links.LOOP}
    assert summary["unresolved"] == 1


def test_demasiados_saltos(web):
    chain = [f"https://www.example.com/{index}" for index in range(source_links.MAX_HOPS + 3)]
    web.pages = {url: (302, chain[index + 1]) for index, url in enumerate(chain[:-1])}
    source, summary = one(chain[0])
    assert source["url"] == chain[source_links.MAX_HOPS] and source["link_issue"] == source_links.TOO_MANY_HOPS
    assert summary["unconfirmed"] == 1
    assert len(web.asked) == source_links.MAX_HOPS + 1


# --------------------------------------------------------------------------- #
# La superficie de la SSRF, caso por caso.                                      #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("url,reason", [
    ("file:///etc/passwd", source_links.BLOCKED_SCHEME),
    ("ftp://www.example.com/a", source_links.BLOCKED_SCHEME),
    ("gopher://www.example.com/a", source_links.BLOCKED_SCHEME),
    ("dict://www.example.com/a", source_links.BLOCKED_SCHEME),
    ("javascript:alert(1)", source_links.BLOCKED_SCHEME),
    ("data:text/plain,hola", source_links.BLOCKED_SCHEME),
    ("//www.example.com/a", source_links.BLOCKED_SCHEME),
    ("https://www.example.com:8443/a", source_links.BLOCKED_PORT),
    ("http://www.example.com:22/a", source_links.BLOCKED_PORT),
    ("http://www.example.com:443/a", source_links.BLOCKED_PORT),
    ("https://www.example.com:80/a", source_links.BLOCKED_PORT),
    ("https://user:clave@www.example.com/a", source_links.BLOCKED_CREDENTIALS),
    ("https://user@www.example.com/a", source_links.BLOCKED_CREDENTIALS),
    ("https://www.example.com@169.254.169.254/latest", source_links.BLOCKED_CREDENTIALS),
    # Lo que dos lectores leerian de dos maneras: nunca llega a pedirse.
    ("https://www.example.com\\@127.0.0.1/", source_links.BLOCKED_CREDENTIALS),
    ("http://127.0.0.1\\@www.example.com/", source_links.BLOCKED_CREDENTIALS),
    ("http://127.0.0.1#@www.example.com/", source_links.BLOCKED_ADDRESS),
    ("http://localhost/a", source_links.BLOCKED_HOST),
    ("http://intranet/a", source_links.BLOCKED_HOST),
    ("http://app.localhost/a", source_links.BLOCKED_HOST),
    ("http://servidor.local/a", source_links.BLOCKED_HOST),
    ("http://servidor.internal/a", source_links.BLOCKED_HOST),
    ("http://127.1/a", source_links.BLOCKED_HOST),
    ("http://2130706433/a", source_links.BLOCKED_HOST),
    ("http://[::1", source_links.INVALID_URL),
    ("http:///a", source_links.INVALID_URL),
    ("http://exa mple.com/a", source_links.INVALID_URL),
    ("http://españa.example/a", source_links.INVALID_URL),
    ("http://example.com%2f.evil.example/a", source_links.INVALID_URL),
    # Parece una IP publica para quien corte en el %, y libcurl leeria otro nombre, sin fijar: el agujero de verdad.
    ("http://8.8.8.8%2eevil.example/a", source_links.INVALID_URL),
    ("http://8.8.8.8%00.evil.example/a", source_links.INVALID_URL),
    ("http://[fe80::1%25eth0]/a", source_links.BLOCKED_ADDRESS),
    ("http://[2606:4700:4700::1111%25x]/a", source_links.BLOCKED_ADDRESS),
    # Un salto de linea o un tabulador dentro del nombre no se limpia: quien lo escribe esta buscando otra lectura.
    ("http://127.0.0.1\n.example.com/a", source_links.INVALID_URL),
    ("http://www.exam\tple.com/a", source_links.INVALID_URL),
])
def test_lo_que_no_se_pide_nunca(web, url, reason):
    source, _ = one(url)
    assert source["url"] == url and source["link_issue"] == reason
    assert web.asked == []


@pytest.mark.parametrize("address,public", [
    ("8.8.8.8", True),
    ("93.184.216.34", True),
    ("2606:4700:4700::1111", True),
    ("::ffff:8.8.8.8", True),
    ("10.0.0.1", False),
    ("10.255.255.255", False),
    ("172.16.0.1", False),
    ("172.31.255.255", False),
    ("192.168.0.1", False),
    ("127.0.0.1", False),
    ("169.254.169.254", False),
    ("100.64.0.1", False),
    ("0.0.0.0", False),
    ("192.0.2.1", False),
    ("198.18.0.1", False),
    ("224.0.0.1", False),
    ("240.0.0.1", False),
    ("255.255.255.255", False),
    ("::1", False),
    ("::", False),
    ("fe80::1", False),
    ("fec0::1", False),
    ("fc00::1", False),
    ("fd20:ce::254", False),
    ("ff02::1", False),
    ("2001:db8::1", False),
    ("::ffff:127.0.0.1", False),
    ("::ffff:169.254.169.254", False),
    ("64:ff9b::a9fe:a9fe", False),
    ("2002:a9fe:a9fe::", False),
    ("2001:0:4136:e378:8000:63bf:3fff:fdd2", False),
])
def test_que_es_una_direccion_publica(address, public):
    assert source_links._is_public(address) is public


def test_una_direccion_con_acentos_y_espacios_se_pide_escapada(web):
    url = "https://www.example.com/año nuevo?q=ñ"
    requested = "https://www.example.com/a%C3%B1o%20nuevo?q=%C3%B1"
    web.pages = {requested: 200}
    source, _ = one(url)
    assert web.asked == [requested]
    assert source == {"title": "ecb.europa.eu", "url": url}


def test_la_peticion_se_fija_a_las_ip_comprobadas(web):
    web.dns = {"www.example.com": ["93.184.216.34", "2606:4700:4700::1111"]}
    parts, host, literal = source_links._check_url("https://WWW.Example.com:443/a?b=1#frag")
    target = source_links._check_addresses(parts, host, literal)
    assert target == Target(
        url="https://www.example.com:443/a?b=1",
        addresses=("93.184.216.34", "2606:4700:4700::1111"),
        pin="www.example.com:443:93.184.216.34,[2606:4700:4700::1111]",
    )


def test_un_dns_que_no_contesta_no_tumba_nada(web):
    web.pages = {G + "a": (302, PAGE)}
    web.dns = {"www.ecb.europa.eu": source_links._LinkFailure(source_links.DNS_ERROR)}
    source, summary = one(G + "a")
    assert source["url"] == PAGE and source["link_issue"] == source_links.DNS_ERROR
    assert summary["unconfirmed"] == 1


def test_un_dns_sin_respuestas_tampoco(web):
    web.dns = {"www.example.com": []}
    source, _ = one("https://www.example.com/a")
    assert source["link_issue"] == source_links.DNS_ERROR


# --------------------------------------------------------------------------- #
# La direccion final de verdad, no la sesion de un robot.                       #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("wall", [
    "https://consent.youtube.com/m?continue=https%3A%2F%2Fwww.youtube.com%2Fwatch",
    "https://consent.yahoo.com/v2/collectConsent?sessionId=3_cc-session",
    "https://guce.yahoo.com/consent?gcrumb=abc",
    "https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fx",
    "https://www.ft.com/login?location=x",
    "https://www.google.com/sorry/index?continue=x",
    "https://www.example.com/subscribe",
    "https://www.example.com/gdpr",
])
def test_un_muro_no_es_la_direccion_final(web, wall):
    article = "https://www.example.com/news/article-1"
    web.pages = {G + "a": (302, article), article: (302, wall)}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": article, "redirect_url": G + "a", "link_issue": source_links.WALL}
    assert summary["unconfirmed"] == 1
    assert wall not in web.asked


def test_si_google_manda_directo_a_un_muro_se_queda_la_suya(web):
    web.pages = {G + "a": (302, "https://consent.youtube.com/m?continue=x")}
    source, summary = one(G + "a")
    assert source["url"] == G + "a" and source["link_issue"] == source_links.WALL
    assert summary["unresolved"] == 1


def test_de_un_articulo_a_la_portada_vale_mas_el_articulo(web):
    article = "https://www.example.com/news/article-1"
    web.pages = {G + "a": (302, article), article: (301, "https://www.example.com/")}
    source, _ = one(G + "a")
    assert source["url"] == article and source["link_issue"] == source_links.WALL


def test_de_google_a_una_portada_es_una_fuente_que_es_una_portada(web):
    home = "https://www.federalreserve.gov/"
    web.pages = {G + "a": (302, home), home: 200}
    source, _ = one(G + "a")
    assert source["url"] == home and "link_issue" not in source


def test_una_palabra_parecida_en_un_articulo_no_es_un_muro(web):
    article = "https://www.example.com/news/how-to-login-to-consent-subscribe"
    web.pages = {G + "a": (302, article), article: 200}
    source, _ = one(G + "a")
    assert source["url"] == article and "link_issue" not in source


def test_google_que_contesta_200_no_es_una_direccion_final(web):
    web.pages = {G + "a": 200}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": source_links.NO_REDIRECT}
    assert summary["unresolved"] == 1


def test_una_direccion_que_contesta_sin_redirigir_se_queda_tal_cual(web):
    web.pages = {PAGE: 200}
    source, summary = one(PAGE)
    assert source == {"title": "ecb.europa.eu", "url": PAGE}
    assert summary["final"] == 1


# --------------------------------------------------------------------------- #
# El contrato: sin duplicadas, con su minimo y su tamano.                       #
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("second", [
    PAGE,
    PAGE + "#seccion",
    PAGE + "?utm_source=google&utm_medium=x",
    PAGE.replace("https://www.", "https://"),
    PAGE.replace("https://", "http://"),
    PAGE.replace("www.ecb.europa.eu", "WWW.ECB.EUROPA.EU"),
    PAGE + "/",
])
def test_dos_redirecciones_a_la_misma_pagina_se_quedan_en_una(monkeypatch, web, second):
    answers = {G + "a": HopResponse(302, PAGE), G + "b": HopResponse(302, second)}
    monkeypatch.setattr(source_links, "_request", lambda target, _timeout: answers.get(target.url, HopResponse(200, "")))
    sources, summary = resolve_sources([
        {"title": "ecb.europa.eu", "url": G + "a"},
        {"title": "otro-titulo.eu", "url": G + "b"},
        {"title": "bls.gov", "url": "https://www.bls.gov/x"},
    ])
    assert sources[0] == {"title": "ecb.europa.eu", "url": PAGE, "redirect_url": G + "a"}
    assert sources[1] == {"title": "bls.gov", "url": "https://www.bls.gov/x"}
    assert summary["duplicates_removed"] == 1 and summary["total"] == 3 and summary["final"] == 2
    assert weekly_report._validate_sources(sources, required=True)


def test_dos_paginas_distintas_del_mismo_dominio_siguen_siendo_dos(web):
    a, b = "https://www.morningstar.com/a", "https://www.morningstar.com/b"
    web.pages = {G + "a": (302, a), G + "b": (302, b), a: 200, b: 200}
    sources, summary = resolve_sources([{"title": "morningstar.com", "url": G + "a"}, {"title": "morningstar.com", "url": G + "b"}])
    assert [source["url"] for source in sources] == [a, b]
    assert summary["duplicates_removed"] == 0


def test_una_consulta_distinta_es_otra_pagina(web):
    a, b = "https://www.example.com/a?id=1", "https://www.example.com/a?id=2"
    web.pages = {G + "a": (302, a), G + "b": (302, b), a: 200, b: 200}
    sources, _ = resolve_sources([{"title": "x.com", "url": G + "a"}, {"title": "x.com", "url": G + "b"}])
    assert len(sources) == 2


def test_una_direccion_final_demasiado_larga_no_rompe_el_tamano(web):
    long_url = "https://www.example.com/" + "a" * source_links.MAX_SOURCE_URL_CHARS
    web.pages = {G + "a": (302, long_url)}
    source, summary = one(G + "a")
    assert source == {"title": "ecb.europa.eu", "url": G + "a", "link_issue": source_links.URL_TOO_LONG}
    assert summary["unresolved"] == 1
    assert long_url not in web.asked
    two_for_the_validator(source)


def test_una_direccion_final_justo_en_el_tope_cabe(web):
    url = "https://www.example.com/" + "a" * (source_links.MAX_SOURCE_URL_CHARS - len("https://www.example.com/"))
    assert len(url) == source_links.MAX_SOURCE_URL_CHARS
    web.pages = {G + "a": (302, url), url: 200}
    source, _ = one(G + "a")
    assert source["url"] == url
    two_for_the_validator(source)


# --------------------------------------------------------------------------- #
# El titulo: lo que imprime el papel y lee la pantalla no cambia para peor.     #
# --------------------------------------------------------------------------- #

def test_el_titulo_no_cambia(web):
    web.pages = {G + "a": (302, PAGE), PAGE: 200}
    assert one(G + "a", title="europa.eu")[0]["title"] == "europa.eu"
    assert one(G + "a", title="ecb.europa.eu")[0]["title"] == "ecb.europa.eu"


def test_el_titulo_que_era_el_nombre_de_la_redireccion_pasa_a_ser_el_del_destino(web):
    web.pages = {G + "a": (302, PAGE), PAGE: 200}
    source, _ = one(G + "a", title="vertexaisearch.cloud.google.com")
    assert source["title"] == "ecb.europa.eu"


def test_si_no_se_resuelve_el_titulo_se_queda(web):
    web.pages = {G + "a": source_links._LinkFailure(source_links.TIMEOUT)}
    assert one(G + "a", title="vertexaisearch.cloud.google.com")[0]["title"] == "vertexaisearch.cloud.google.com"


# --------------------------------------------------------------------------- #
# Un enlace no tumba el informe, con tiempo limite por enlace y total.          #
# --------------------------------------------------------------------------- #

def test_un_fallo_imprevisto_tampoco_tumba_nada(web):
    web.pages = {G + "a": RuntimeError("inesperado"), G + "b": (302, PAGE), PAGE: 200}
    sources, summary = resolve_sources([{"title": "a.com", "url": G + "a"}, {"title": "b.com", "url": G + "b"}])
    assert sources[0] == {"title": "a.com", "url": G + "a", "link_issue": source_links.INTERNAL_ERROR}
    assert sources[1]["url"] == PAGE
    assert summary["unresolved"] == 1 and summary["final"] == 1


def test_sin_hilos_se_queda_todo_como_estaba_y_marcado(monkeypatch, web):
    def broken(*_a, **_k):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(source_links, "ThreadPoolExecutor", broken)
    sources, summary = resolve_sources([{"title": "a.com", "url": G + "a"}, {"title": "b.com", "url": G + "b"}])
    assert [source["url"] for source in sources] == [G + "a", G + "b"]
    assert all(source["link_issue"] == source_links.INTERNAL_ERROR for source in sources)
    assert summary["unresolved"] == 2


def test_sin_fuentes_no_hace_nada(web):
    assert resolve_sources([])[0] == []
    assert web.asked == []


def test_el_plazo_por_enlace_recorta_cada_peticion(monkeypatch, web):
    clock = [100.0]
    monkeypatch.setattr(source_links, "_monotonic", lambda: clock[0])
    a, b = "https://www.example.com/a", "https://www.example.com/b"

    def slow(target, timeout):
        web.timeouts.append(timeout)
        web.asked.append(target.url)
        clock[0] += 4
        return HopResponse(302, {G + "a": a, a: b}.get(target.url, b + "c"))

    monkeypatch.setattr(source_links, "_request", slow)
    source, _ = one(G + "a")
    # 5, 5 y lo que quedaba de los 10 s del enlace: 2. A los 12 s ya no se lanza otra.
    assert web.timeouts == [source_links.REQUEST_TIMEOUT_SEC, source_links.REQUEST_TIMEOUT_SEC, 2]
    assert source["link_issue"] == source_links.TIMEOUT
    assert source["url"] == b + "c"


def test_el_plazo_total_recorta_el_de_cada_enlace(monkeypatch, web):
    clock = [100.0]
    monkeypatch.setattr(source_links, "_monotonic", lambda: clock[0])
    web.pages = {G + "a": 200}
    source_links._follow(G + "a", clock[0] + 3)
    assert web.timeouts == [3]


def test_el_plazo_total_no_espera_a_un_dns_que_no_contesta(monkeypatch, web):
    release = threading.Event()
    monkeypatch.setattr(source_links, "TOTAL_TIMEOUT_SEC", 0.2)
    monkeypatch.setattr(source_links, "_TOTAL_GRACE_SEC", 0.1)

    def stuck(host, _port):
        if host == "lento.example":
            release.wait(30)
        return ["93.184.216.34"]

    monkeypatch.setattr(source_links, "_addresses_of", stuck)
    web.pages = {PAGE: 200}
    started = time.monotonic()
    try:
        sources, summary = resolve_sources([
            {"title": "lento.example", "url": "https://lento.example/a"},
            {"title": "ecb.europa.eu", "url": PAGE},
        ])
    finally:
        release.set()
    assert time.monotonic() - started < 2
    assert sources[0] == {"title": "lento.example", "url": "https://lento.example/a", "link_issue": source_links.TOTAL_DEADLINE}
    assert sources[1] == {"title": "ecb.europa.eu", "url": PAGE}
    assert summary["reasons"] == {source_links.TOTAL_DEADLINE: 1}


def test_van_a_la_vez(monkeypatch, web):
    """Una barrera de 6: si fueran de uno en uno se romperia, y el motivo saldria en las fuentes."""
    barrier = threading.Barrier(source_links.MAX_PARALLEL, timeout=10)

    def together(_target, _timeout):
        barrier.wait()
        return HopResponse(200, "")

    monkeypatch.setattr(source_links, "_request", together)
    sources, summary = resolve_sources([{"title": f"f{index}.com", "url": f"https://f{index}.example.com/a"} for index in range(12)])
    assert summary["final"] == 12 and len(sources) == 12
    assert all("link_issue" not in source for source in sources)


def test_el_tiempo_que_se_ha_tardado_queda_en_el_recuento(web):
    web.pages = {PAGE: 200}
    assert isinstance(one(PAGE)[1]["seconds"], float)


# --------------------------------------------------------------------------- #
# Dentro de la generacion: todo lo que se publica, y solo eso.                  #
# --------------------------------------------------------------------------- #

def _generation(monkeypatch, chunks, *, draft=None, report_type="DAILY_REPORT", events=None):
    payload = {"candidates": [{"groundingMetadata": {"groundingChunks": [
        {"web": {"title": title, "uri": uri}} for title, uri in chunks]}}]}
    drafts = draft if isinstance(draft, list) else [draft or (valid_daily_report() if report_type == "DAILY_REPORT" else valid_report())]

    def generate(_key, _prompt, *, grounded, json_output, deadline=None, accept_until=None):
        if events is not None:
            events.append("investigacion" if grounded else "redaccion")
        if grounded:
            return "Base factual comprobada", payload, "research"
        return json.dumps(drafts.pop(0)), {}, "writer"

    monkeypatch.setattr(weekly_report, "_generate_with_fallback", generate)


def test_lo_publicado_guarda_la_direccion_final_y_el_recuento(monkeypatch, web):
    a, b = "https://www.ecb.europa.eu/a", "https://www.bls.gov/b"
    web.pages = {G + "a": (302, a), G + "b": (302, b), a: 200, b: source_links._LinkFailure(source_links.TIMEOUT), G + "c": 404}
    _generation(monkeypatch, [("europa.eu", G + "a"), ("bls.gov", G + "b"), ("expirado.com", G + "c")])
    db = Database()

    result = weekly_report.publish_strategy_report("DAILY_REPORT", db=db, api_key="k", now=NOW)

    assert result["status"] == "PUBLISHED" and result["source_count"] == 3
    published = db.values[weekly_report.REPORTS_COLLECTION + "/daily-2026-11-05"]
    assert published["sources"] == [
        {"title": "europa.eu", "url": a, "redirect_url": G + "a"},
        {"title": "bls.gov", "url": b, "redirect_url": G + "b", "link_issue": source_links.TIMEOUT},
        {"title": "expirado.com", "url": G + "c", "link_issue": "HTTP_404"},
    ]
    generation = published["generation"]
    assert generation["source_count"] == 3
    resolution = generation["source_resolution"]
    assert (resolution["total"], resolution["final"], resolution["unconfirmed"], resolution["unresolved"]) == (3, 1, 1, 1)
    assert resolution["duplicates_removed"] == 0
    assert resolution["reasons"] == {source_links.TIMEOUT: 1, "HTTP_404": 1}
    assert generation["grounded"] is True and generation["research_model"] == "research"


def test_si_no_se_resuelve_ninguna_el_informe_se_publica_igual(monkeypatch, web):
    web.pages = {G + "a": source_links._LinkFailure(source_links.TIMEOUT), G + "b": source_links._LinkFailure(source_links.NETWORK_ERROR)}
    _generation(monkeypatch, [("a.com", G + "a"), ("b.com", G + "b")])
    db = Database()

    assert weekly_report.publish_strategy_report("DAILY_REPORT", db=db, api_key="k", now=NOW)["status"] == "PUBLISHED"

    published = db.values[weekly_report.REPORTS_COLLECTION + "/daily-2026-11-05"]
    assert [source["url"] for source in published["sources"]] == [G + "a", G + "b"]
    assert published["generation"]["source_resolution"]["unresolved"] == 2


def test_una_a_una_y_a_ip_privada_tampoco_tumba_el_informe(monkeypatch, web):
    a = "https://www.ecb.europa.eu/a"
    web.pages = {G + "a": (302, a), a: 200, G + "b": (302, "http://169.254.169.254/latest/")}
    _generation(monkeypatch, [("europa.eu", G + "a"), ("trampa.com", G + "b")])
    db = Database()
    assert weekly_report.publish_strategy_report("DAILY_REPORT", db=db, api_key="k", now=NOW)["status"] == "PUBLISHED"
    assert "http://169.254.169.254/latest/" not in web.asked


def test_de_tres_enlaces_a_dos_paginas_el_contrato_sigue_pasando(monkeypatch, web):
    a, b = "https://www.ecb.europa.eu/a", "https://www.bls.gov/b"
    web.pages = {G + "a": (302, a), G + "b": (302, a), G + "c": (302, b), a: 200, b: 200}
    _generation(monkeypatch, [("europa.eu", G + "a"), ("otro.eu", G + "b"), ("bls.gov", G + "c")])
    report = weekly_report.generate_strategy_report("DAILY_REPORT", api_key="k", now=NOW)
    assert [source["url"] for source in report["sources"]] == [a, b]
    assert report["generation"]["source_count"] == 2
    assert report["generation"]["source_resolution"]["duplicates_removed"] == 1


def test_si_todo_lleva_a_una_sola_pagina_no_es_un_informe_fundamentado(monkeypatch, web):
    """El minimo de siempre. No es una redireccion sin resolver: es que hay una fuente, no dos."""
    a = "https://www.ecb.europa.eu/a"
    web.pages = {G + "a": (302, a), G + "b": (302, a), a: 200}
    _generation(monkeypatch, [("europa.eu", G + "a"), ("otro.eu", G + "b")])
    db = Database()
    with pytest.raises(weekly_report.WeeklyReportError, match="2 enlaces llevan a 1"):
        weekly_report.publish_strategy_report("DAILY_REPORT", db=db, api_key="k", now=NOW)
    assert weekly_report.REPORTS_COLLECTION + "/daily-2026-11-05" not in db.values
    assert db.values["_report_publication/daily-2026-11-05"]["status"] == "FAILED"


def test_solo_se_sale_a_la_red_por_lo_que_va_a_publicarse(monkeypatch, web):
    bad = valid_daily_report()
    bad["fullReport"]["narrative"] = " ".join(["dato"] * 478)
    _generation(monkeypatch, [("a.com", G + "a"), ("b.com", G + "b")], draft=[deepcopy(bad), deepcopy(bad)])
    with pytest.raises(weekly_report.WeeklyReportValidationError):
        weekly_report.generate_strategy_report("DAILY_REPORT", api_key="k", now=NOW)
    assert web.asked == []


def test_se_resuelve_despues_de_redactar(monkeypatch, web):
    """Asi no gasta plazo de la cascada ni se pide nada por un borrador que no vale."""
    events = []
    a = "https://www.ecb.europa.eu/a"

    def request(target, _timeout):
        events.append("red")
        return HopResponse(302, a) if target.url == G + "a" else HopResponse(200, "")

    monkeypatch.setattr(source_links, "_request", request)
    _generation(monkeypatch, [("a.com", G + "a"), ("b.com", "https://www.bls.gov/x")], events=events)
    weekly_report.generate_strategy_report("DAILY_REPORT", api_key="k", now=NOW)
    assert events[:2] == ["investigacion", "redaccion"]
    assert set(events[2:]) == {"red"} and len(events) == 5


def test_el_semanal_tambien(monkeypatch, web):
    a, b = "https://www.ecb.europa.eu/a", "https://www.bls.gov/b"
    web.pages = {G + "a": (302, a), G + "b": (302, b), a: 200, b: 200}
    _generation(monkeypatch, [("europa.eu", G + "a"), ("bls.gov", G + "b")], report_type="WEEKLY_REPORT")
    db = Database()
    now = datetime(2026, 11, 2, 7, tzinfo=timezone.utc)
    assert weekly_report.publish_strategy_report("WEEKLY_REPORT", db=db, api_key="k", now=now)["status"] == "PUBLISHED"
    assert [s["url"] for s in db.values[weekly_report.REPORTS_COLLECTION + "/weekly-2026-11-02"]["sources"]] == [a, b]


# --------------------------------------------------------------------------- #
# Lo guardado se queda como esta.                                               #
# --------------------------------------------------------------------------- #

class _Snapshot:
    def __init__(self, value):
        self.value = value

    def to_dict(self):
        return self.value


class _Reader:
    def __init__(self, values):
        self.values = values

    def collection(self, _name):
        return self

    def where(self, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, _value):
        return self

    def stream(self):
        return [_Snapshot(value) for value in self.values]


def _saved():
    report = valid_daily_report(date="2026-11-05T07:00:00Z")
    report["id"] = "daily-2026-11-05"
    report["sources"] = [{"title": "europa.eu", "url": G + "a"}, {"title": "bls.gov", "url": G + "b"}]
    return report


def test_leer_lo_guardado_no_sale_a_la_red_ni_lo_cambia(web):
    saved = _saved()
    before = deepcopy(saved)
    result = weekly_report.get_weekly_report({"type": "DAILY_REPORT"}, db=_Reader([saved]), now=NOW)
    assert result["report"]["sources"] == before["sources"]
    assert web.asked == [] and saved == before


def test_publicar_otra_vez_no_sale_a_la_red_ni_lo_cambia(web):
    db = Database()
    saved = _saved()
    db.collection(weekly_report.REPORTS_COLLECTION).document("daily-2026-11-05").create(deepcopy(saved))
    assert weekly_report.publish_strategy_report("DAILY_REPORT", db=db, api_key="k", now=NOW)["status"] == "ALREADY_PUBLISHED"
    assert web.asked == []
    assert db.values[weekly_report.REPORTS_COLLECTION + "/daily-2026-11-05"] == saved


def test_lo_guardado_con_y_sin_marca_pasa_el_contrato():
    assert weekly_report._validate_sources([{"title": "a", "url": G + "a"}, {"title": "b", "url": G + "b"}], required=True)
    marked = [
        {"title": "a", "url": "https://www.example.com/a", "redirect_url": G + "a"},
        {"title": "b", "url": G + "b", "link_issue": "TIMEOUT"},
    ]
    assert weekly_report._validate_sources(marked, required=True) == marked


# --------------------------------------------------------------------------- #
# Libcurl de verdad, contra un servidor local. Nada de esto sale a internet.    #
# --------------------------------------------------------------------------- #

@pytest.fixture
def local(monkeypatch):
    state = {"requests": [], "sent": 0, "model_keys": []}
    stop = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def _answer(self, status, headers=(), body=b""):
            self.send_response(status)
            for name, value in headers:
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _raw(self, data):
            self.wfile.write(data)
            self.wfile.flush()

        def do_POST(self):
            """El modelo: investiga si le dan el buscador, y si no, redacta."""
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["model_keys"].append(self.headers.get("x-goog-api-key"))
            if body.get("tools"):
                port = self.server.server_port
                payload = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "Base factual comprobada"}]},
                                           "groundingMetadata": {"groundingChunks": [
                                               {"web": {"title": "europa.eu", "uri": f"http://pagina.invalid:{port}/relativa"}},
                                               {"web": {"title": "otro.eu", "uri": f"http://pagina.invalid:{port}/segunda"}},
                                               {"web": {"title": "bls.gov", "uri": f"http://pagina.invalid:{port}/no-esta"}},
                                           ]}}]}
            else:
                payload = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(valid_daily_report())}]}}]}
            self._answer(200, [("Content-Type", "application/json")], json.dumps(payload).encode("utf-8"))

        def do_GET(self):
            state["requests"].append({"path": self.path, "method": self.command, "headers": dict(self.headers.items())})
            path = self.path.split("?")[0]
            try:
                if path == "/relativa":
                    self._answer(302, [("Location", "/segunda?x=1")])
                elif path == "/segunda":
                    self._answer(301, [("Location", f"http://otra.invalid:{self.server.server_port}/final")])
                elif path == "/final":
                    self._answer(200, body=b"<html>pagina</html>")
                elif path == "/acentos":
                    self._raw(b"HTTP/1.1 302 Found\r\nLocation: /a\xc3\xb1o nuevo\r\nContent-Length: 0\r\n\r\n")
                elif path == "/ano%20nuevo" or path == "/a%C3%B1o%20nuevo":
                    self._answer(200)
                elif path == "/fichero":
                    self._answer(302, [("Location", "file:///etc/passwd")])
                elif path == "/sinlocation":
                    self._answer(302)
                elif path == "/rota":
                    self._answer(302, [("Location", "http://[::1")])
                elif path == "/no-esta":
                    self._answer(404, body=b"no esta")
                elif path == "/cuerpo":
                    self.send_response(200)
                    self.send_header("Content-Length", str(50_000_000))
                    self.end_headers()
                    for _ in range(50_000):
                        if stop.is_set():
                            return
                        self.wfile.write(b"x" * 1000)
                        self.wfile.flush()
                        state["sent"] += 1000
                        time.sleep(0.001)
                elif path == "/lenta":
                    stop.wait(3)
                    if not stop.is_set():
                        self._answer(200)
                elif path == "/goteo":
                    self._raw(b"HTTP/1.1 200 OK\r\n")
                    for _ in range(100):
                        if stop.wait(0.05):
                            return
                        self._raw(b"X-Goteo: si\r\n")
                else:
                    self._answer(200)
            except OSError:
                self.close_connection = True

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.handle_error = lambda *_args: None  # Que el cliente corte es justo lo que se quiere.
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    port = server.server_port
    # Los nombres `.invalid` no existen en ningun DNS: si la peticion llega, es porque va fijada a la IP comprobada.
    monkeypatch.setattr(source_links, "_request", REAL_REQUEST)
    monkeypatch.setattr(source_links, "_addresses_of", lambda _host, _port: ["127.0.0.1"])
    monkeypatch.setattr(source_links, "_is_public", lambda _address: True)
    monkeypatch.setattr(source_links, "_PORTS", {"http": port, "https": 443})
    monkeypatch.setattr(source_links, "REQUEST_TIMEOUT_SEC", 2)
    thread.start()
    try:
        yield state, f"http://pagina.invalid:{port}", port
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_de_verdad_sigue_la_cadena_con_las_ip_fijadas_y_cada_salto_lo_da_ella(local):
    state, base, port = local
    source, summary = one(base + "/relativa")
    assert source["url"] == f"http://otra.invalid:{port}/final"
    assert source["redirect_url"] == base + "/relativa"
    assert "link_issue" not in source and summary["final"] == 1
    assert [request["path"] for request in state["requests"]] == ["/relativa", "/segunda?x=1", "/final"]
    assert [request["headers"]["Host"] for request in state["requests"]] == [
        f"pagina.invalid:{port}", f"pagina.invalid:{port}", f"otra.invalid:{port}",
    ]


def test_de_verdad_no_manda_nada_mas_que_el_agente(local):
    state, base, _ = local
    one(base + "/final")
    headers = {name.casefold() for name in state["requests"][0]["headers"]}
    assert "user-agent" in headers and "host" in headers
    assert not headers & {"cookie", "authorization", "x-goog-api-key", "metadata-flavor", "referer"}
    assert state["requests"][0]["method"] == "GET"


def test_de_verdad_no_descarga_el_cuerpo(local):
    state, base, _ = local
    started = time.monotonic()
    source, _ = one(base + "/cuerpo")
    elapsed = time.monotonic() - started
    assert source == {"title": "ecb.europa.eu", "url": base + "/cuerpo"}
    assert elapsed < 1.5
    time.sleep(0.1)  # El servidor nota el corte al escribir: para entonces habra dejado de mandar.
    assert state["sent"] < 2_000_000  # De 50 MB.


def test_de_verdad_cabeceras_que_no_llegan(local, monkeypatch):
    monkeypatch.setattr(source_links, "REQUEST_TIMEOUT_SEC", 0.3)
    _, base, _ = local
    started = time.monotonic()
    source, _ = one(base + "/lenta")
    assert source["link_issue"] == source_links.TIMEOUT
    assert time.monotonic() - started < 1.5


def test_de_verdad_cabeceras_a_goteo_no_pasan_del_plazo_total(local, monkeypatch):
    """Cada fragmento llega antes del plazo de un socket, pero el conjunto no cabe en el de la transferencia."""
    monkeypatch.setattr(source_links, "REQUEST_TIMEOUT_SEC", 0.3)
    _, base, _ = local
    started = time.monotonic()
    source, _ = one(base + "/goteo")
    assert source["link_issue"] == source_links.TIMEOUT
    assert time.monotonic() - started < 1.5


def test_de_verdad_404(local):
    _, base, _ = local
    source, _ = one(base + "/no-esta")
    assert source == {"title": "ecb.europa.eu", "url": base + "/no-esta", "link_issue": "HTTP_404"}


def test_de_verdad_sin_location(local):
    _, base, _ = local
    assert one(base + "/sinlocation")[0]["link_issue"] == source_links.NO_LOCATION


def test_de_verdad_location_rota(local):
    state, base, _ = local
    source, _ = one(base + "/rota")
    assert source["url"] == base + "/rota" and source["link_issue"] == source_links.INVALID_URL
    assert len(state["requests"]) == 1


def test_de_verdad_location_a_un_fichero(local):
    state, base, _ = local
    source, _ = one(base + "/fichero")
    assert source["url"] == base + "/fichero" and source["link_issue"] == source_links.BLOCKED_SCHEME
    assert len(state["requests"]) == 1


def test_de_verdad_una_location_con_acentos_y_espacios_queda_escapada(local):
    state, base, _ = local
    source, _ = one(base + "/acentos")
    assert source["url"] == base + "/a%C3%B1o%20nuevo"
    assert source["url"].isascii()
    assert "link_issue" not in source
    assert state["requests"][1]["path"] == "/a%C3%B1o%20nuevo"


def test_de_verdad_si_la_peticion_acaba_en_otra_ip_no_vale(local):
    """La segunda barrera: aunque algo se saltara la fijacion, la respuesta de otra IP no se cree."""
    _, base, port = local
    target = Target(url=f"http://127.0.0.1:{port}/final", addresses=("93.184.216.34",), pin=None)
    with pytest.raises(source_links._LinkFailure) as failure:
        REAL_REQUEST(target, 1)
    assert failure.value.reason == source_links.BLOCKED_ADDRESS


def test_de_verdad_no_hace_caso_a_un_proxy_del_entorno(local, monkeypatch):
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.setenv("all_proxy", "http://127.0.0.1:9")
    state, base, _ = local
    source, _ = one(base + "/final")
    assert source == {"title": "ecb.europa.eu", "url": base + "/final"}
    assert len(state["requests"]) == 1


def test_de_verdad_un_puerto_que_nadie_escucha_no_tumba_nada(local, monkeypatch):
    monkeypatch.setattr(source_links, "_PORTS", {"http": 9, "https": 443})
    source, _ = one("http://pagina.invalid:9/a")
    assert source["url"] == "http://pagina.invalid:9/a"
    assert source["link_issue"] in (source_links.NETWORK_ERROR, source_links.TIMEOUT)


def test_de_verdad_de_principio_a_fin(local, monkeypatch):
    """Modelo, buscador y enlaces por HTTP de verdad, en local: lo unico simulado es la base."""
    state, base, port = local
    monkeypatch.setattr(weekly_report, "GEMINI_BASE", f"http://127.0.0.1:{port}")
    db = Database()

    result = weekly_report.publish_strategy_report("DAILY_REPORT", db=db, api_key="clave-de-prueba", now=NOW)

    assert result["status"] == "PUBLISHED" and result["source_count"] == 2
    published = db.values[weekly_report.REPORTS_COLLECTION + "/daily-2026-11-05"]
    final = f"http://otra.invalid:{port}/final"
    # Dos enlaces llegan a la misma pagina y se quedan en uno. El tercero da 404 y queda marcado.
    assert published["sources"] == [
        {"title": "europa.eu", "url": final, "redirect_url": base + "/relativa"},
        {"title": "bls.gov", "url": base + "/no-esta", "link_issue": "HTTP_404"},
    ]
    resolution = published["generation"]["source_resolution"]
    assert (resolution["total"], resolution["final"], resolution["unresolved"], resolution["duplicates_removed"]) == (3, 1, 1, 1)
    assert published["generation"]["source_count"] == 2
    assert published["author"] == "Redacción automática (IA)"
    # La clave del modelo va al modelo, y a nadie mas.
    assert state["model_keys"] == ["clave-de-prueba", "clave-de-prueba"]
    assert all("x-goog-api-key" not in {name.casefold() for name in request["headers"]} for request in state["requests"])


def test_de_verdad_un_certificado_que_no_es_de_nadie_no_vale(tmp_path):
    """El camino https de verdad: el servidor local no recibe ninguna peticion, porque el TLS no pasa."""
    x509 = pytest.importorskip("cryptography.x509")
    hashes = pytest.importorskip("cryptography.hazmat.primitives.hashes")
    serialization = pytest.importorskip("cryptography.hazmat.primitives.serialization")
    ec = pytest.importorskip("cryptography.hazmat.primitives.asymmetric.ec")
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(x509.oid.NameOID.COMMON_NAME, "pagina.invalid")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("pagina.invalid")]), critical=False)
            .sign(key, hashes.SHA256()))
    cert_file, key_file = tmp_path / "c.pem", tmp_path / "k.pem"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.handle_error = lambda *_args: None
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_file, key_file)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        port = server.server_port
        target = Target(url=f"https://pagina.invalid:{port}/a", addresses=("127.0.0.1",), pin=f"pagina.invalid:{port}:127.0.0.1")
        with pytest.raises(source_links._LinkFailure) as failure:
            REAL_REQUEST(target, 3)
        assert failure.value.reason == source_links.NETWORK_ERROR
        assert requests == []
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_el_dns_de_verdad_dice_lo_que_hay(monkeypatch):
    """Sin red: `getaddrinfo` simulado. Lo que se comprueba es que se le pide bien y se limpia la zona IPv6."""
    calls = []

    def fake_getaddrinfo(host, port, type=0):
        calls.append((host, port, type))
        return [(2, 1, 6, "", ("93.184.216.34", port)), (23, 1, 6, "", ("fe80::1%eth0", port, 0, 3))]

    monkeypatch.setattr(source_links.socket, "getaddrinfo", fake_getaddrinfo)
    assert REAL_ADDRESSES("www.example.com", 443) == ["93.184.216.34", "fe80::1"]
    assert calls == [("www.example.com", 443, source_links.socket.SOCK_STREAM)]

    def failing(*_a, **_k):
        raise source_links.socket.gaierror("no existe")

    monkeypatch.setattr(source_links.socket, "getaddrinfo", failing)
    with pytest.raises(source_links._LinkFailure) as failure:
        REAL_ADDRESSES("no-existe.example", 443)
    assert failure.value.reason == source_links.DNS_ERROR
