"""Diagnostica por qué a un fondo le falta el KID oficial.

    python tools/test_kid.py                 # análisis sin red, sobre las fichas
    python tools/test_kid.py --red           # además prueba las URLs — EJECUTAR EN TU PC
    python tools/test_kid.py --isin LU0114723033 --red

Sin `--red` no sale a internet: solo lee `data/funds/*.json` y usa el código de
producción (`fetchers.kid_gestora`) para responder una pregunta que no necesita
red y que separa dos problemas muy distintos:

- **Ninguna fuente casa con la gestora.** Falta un patrón. Es trabajo de
  investigación: encontrar la URL del KID de esa gestora.
- **Hay fuentes candidatas y aun así no hay KID.** El patrón existe pero no
  cubre esa clase, o la descarga falla. Es trabajo de depuración, y mucho más
  barato que lo anterior.

Con `--red` prueba cada URL candidata **con las cabeceras de producción** —el
agente de `config/settings.json` y las dos de `core.http`, más las que declare
la fuente— y dice qué devuelve. Pedir de otra forma no mide el sistema: el
30-10-2026 esta herramienta pedía con `requests` a secas, sin cabecera ninguna,
y cuatro fuentes contestaron 403 o agotaron el tiempo de espera; lo tomé por una
caída y no lo era. Antes de eso prueba un
**control** por fuente: un ISIN que ya tiene su KID de esa misma fuente. Sin el
control, un fallo no se puede interpretar; con él se distingue "el patrón no
cubre esta clase" de "la gestora ha dejado de servirnos". El 30-10-2026 las seis
URL de Goldman Sachs agotaron el tiempo de espera y, con nueve fondos ya
resueltos por ese mismo patrón, no había forma de saber cuál de las dos cosas
estaba pasando.

Las fuentes de dos pasos (Candriam: ficha HTML y, dentro, el enlace al PDF) se
prueban enteras, buscando el enlace con la misma expresión que usa producción.

Esto hay que ejecutarlo en tu PC: desde el entorno del agente las webs de las
gestoras responden 403, y falsear el agente para sortearlo no es algo que se
deba hacer.

No escribe nada: ni en las fichas, ni en la caché, ni en la maestra.
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from fetchers import kid_gestora  # noqa: E402

# Fuentes que, cuando llenan el SRI, significan que el KID oficial está leído.
PREFIJOS_OFICIALES = ("kid_gestora:", "cnmv_ficha:", "amf_geco:", "manual:")


def fichas(patron: str | None) -> list[tuple[str, dict]]:
    out = []
    for ruta in sorted(glob.glob(str(BASE / "data" / "funds" / "*.json"))):
        isin = Path(ruta).stem
        if patron and patron.upper() not in isin.upper():
            continue
        with open(ruta, encoding="utf-8") as fh:
            d = json.load(fh)
        if (d.get("identificacion") or {}).get("tipo_producto") == "accion":
            continue
        out.append((isin, d))
    return out


def procedencia_kid(ficha: dict) -> str:
    proc = (ficha.get("meta") or {}).get("procedencia") or {}
    return str(proc.get("riesgo.sri_kid_1a7") or "")


def previo_sintetico(ficha: dict) -> dict:
    """`previo` con la forma que esperan `pistas_de` e `identificacion_de`.

    La ficha canónica ya trae la identificación fusionada, así que se ofrece
    como si viniera de la pasada anterior.
    """
    return {"_anterior": {"identificacion": ficha.get("identificacion") or {}}}


def cabeceras_de_produccion() -> dict:
    """Las mismas cabeceras que pone `core.http` en su sesión.

    Sin esto el diagnóstico miente. El 30-10-2026 esta herramienta pedía con
    `requests` a secas, sin cabecera ninguna, y cuatro fuentes respondieron 403
    o agotaron el tiempo de espera. Lo interpreté como que habían dejado de
    servirnos, y era falso: producción nunca hace esa petición. Manda el agente
    de `config/settings.json` y dos cabeceras más, y lo que esas fuentes
    contestan a *eso* es lo único que dice algo del sistema.
    """
    ajustes = {}
    ruta = BASE / "config" / "settings.json"
    if ruta.exists():
        with open(ruta, encoding="utf-8") as fh:
            ajustes = json.load(fh)
    return {
        "User-Agent": ajustes.get("user_agent", "Mozilla/5.0"),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    }


def prueba(url: str, cabeceras: dict) -> tuple[str, str]:
    """(resumen, cuerpo) de una petición. No guarda nada en disco."""
    import requests

    try:
        r = requests.get(url, headers=cabeceras, timeout=30)
    except Exception as e:  # noqa: BLE001 - el informe no debe romperse
        return f"ERROR {type(e).__name__}: {e}", ""
    tipo = r.headers.get("Content-Type", "?")
    pdf = r.content[:5] == b"%PDF-"
    marca = "  <-- PDF" if pdf else ""
    return f"{r.status_code} {tipo} {len(r.content)}B{marca}", ("" if pdf else r.text)


def urls_de(fuente, isin: str, ident: dict) -> list[str]:
    """Todas las URL que esa fuente construye para ese ISIN, o su ficha HTML.

    Son todas y no la primera porque producción las prueba todas en orden:
    Invesco, por ejemplo, tiene una ruta para fondos y otra para ETF, y que la
    primera dé 404 no significa nada por sí solo.
    """
    if fuente.urls is None:
        return [fuente.pagina(isin)]
    return list(fuente.urls(isin, ident))


def controles_por_fuente(todas: list[tuple[str, dict]]) -> dict[str, str]:
    """Por cada fuente, un ISIN cuyo KID vino de ella. Es la referencia."""
    out: dict[str, str] = {}
    for isin, ficha in todas:
        proc = procedencia_kid(ficha)
        if proc.startswith("kid_gestora:"):
            out.setdefault(proc.split(":", 1)[1], isin)
    return out


def repaso_de_fuentes(todas: list[tuple[str, dict]], espera: float) -> int:
    """¿Siguen sirviéndonos las fuentes que sostienen el KID que ya tenemos?

    Se prueban las diez fuentes, **el espejo de Deutsche Bank incluido**, que es
    el que más KID aporta y el que más caro sale perder. De cada una se pide un
    ISIN cuyo KID vino de ella: un fallo ahí no es un hueco, es un documento que
    ya tenemos y que se irá al caducar la caché de 90 días.

    La petición se hace **con las cabeceras de producción**, que es el único
    experimento que dice algo del sistema: el agente de `settings.json` más las
    dos cabeceras de `core.http`, y encima las que declare la fuente, igual que
    hace `requests` al mezclar sesión y petición. Si eso falla, se repite
    identificándonos con el agente de herramienta del repositorio —lo que ya se
    hace con Invesco, cuyo Akamai rechaza a quien no se identifica— para
    distinguir «la fuente nos ha cerrado» de «esta forma de pedir no le gusta».
    """
    por_isin = dict(todas)
    controles = controles_por_fuente(todas)
    produccion = cabeceras_de_produccion()
    print("--- Repaso: ¿sigue sirviéndonos cada fuente? ---")
    print("Se pide un ISIN cuyo KID vino de esa misma fuente, con las cabeceras de")
    print("producción. Un fallo aquí no es un hueco: es un KID que ya tenemos y que")
    print("perderemos al caducar la caché.")
    print(f"Agente de producción: {produccion['User-Agent'][:70]}")
    print()
    for fuente in kid_gestora.FUENTES:
        isin_ok = controles.get(fuente.id)
        aporta = sum(1 for _i, f in todas if procedencia_kid(f) == f"kid_gestora:{fuente.id}")
        if not isin_ok:
            print(f"[{fuente.id}] hoy no aporta ningún KID: sin control posible")
            continue
        ident = kid_gestora.identificacion_de(previo_sintetico(por_isin[isin_ok]))
        urls = urls_de(fuente, isin_ok, ident)
        if not urls:
            print(f"[{fuente.id}] {isin_ok}: no construye URL (identificación incompleta)")
            continue
        print(f"[{fuente.id}] sostiene {aporta} KID · control {isin_ok}")
        como_produccion = dict(produccion, **(fuente.cabeceras or {}))
        servido = False
        for url in urls:
            resumen, _c = prueba(url, como_produccion)
            print(f"    como producción: {resumen}")
            print(f"        {url}")
            time.sleep(espera)
            if "<-- PDF" in resumen or (fuente.urls is None and resumen.startswith("200")):
                servido = True
                break
        if not servido and not (fuente.cabeceras or {}).get("User-Agent"):
            con_agente = dict(produccion, **{"User-Agent": kid_gestora.UA_HERRAMIENTA})
            resumen2, _c2 = prueba(urls[0], con_agente)
            print(f"    identificándonos como herramienta: {resumen2}")
            time.sleep(espera)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--isin", help="limita el análisis a los ISIN que contengan este texto")
    ap.add_argument("--red", action="store_true",
                    help="prueba las URLs candidatas (ejecutar en tu PC)")
    ap.add_argument("--controles", action="store_true",
                    help="solo el repaso de TODAS las fuentes, el espejo incluido (ejecutar en tu PC)")
    ap.add_argument("--espera", type=float, default=1.5,
                    help="segundos entre peticiones con --red (por defecto 1,5)")
    args = ap.parse_args()

    todas = fichas(args.isin)
    if not todas:
        print("No hay fichas que casen.")
        return 1
    por_isin = dict(todas)

    sin_kid: list[tuple[str, dict]] = []
    por_fuente: Counter = Counter()
    for isin, ficha in todas:
        proc = procedencia_kid(ficha)
        if proc.startswith(PREFIJOS_OFICIALES):
            por_fuente[proc] += 1
        else:
            sin_kid.append((isin, ficha))
            por_fuente[proc or "SIN DATO"] += 1

    print(f"Fichas de fondo y ETF: {len(todas)}")
    print(f"Con KID oficial leído: {len(todas) - len(sin_kid)}")
    print(f"Sin KID oficial:       {len(sin_kid)}")
    print()

    # El reparto por fuente dice dónde está la cobertura de verdad. El espejo
    # universal suele aportar más que todos los patrones de gestora juntos.
    print("Procedencia del SRI (quién aporta el KID hoy):")
    for fuente, n in por_fuente.most_common():
        print(f"  {fuente[:58]:60}{n:>5}")

    if args.controles:
        print()
        return repaso_de_fuentes(todas, args.espera)

    # --- La pregunta que no necesita red -------------------------------------
    sin_candidata: dict[str, list[str]] = defaultdict(list)
    con_candidata: dict[str, list[str]] = defaultdict(list)
    detalle: dict[str, list[tuple[str, str, bool]]] = {}   # isin -> (fuente, url, es_ficha_html)

    for isin, ficha in sin_kid:
        gestora = (ficha.get("identificacion") or {}).get("gestora") or "?"
        if isin.startswith("ES"):
            # El adaptador no los busca: su KID viene por la ficha de la CNMV.
            continue
        previo = previo_sintetico(ficha)
        pistas = kid_gestora.pistas_de(previo)
        ident = kid_gestora.identificacion_de(previo)
        urls: list[tuple[str, str, bool]] = []
        propias = [f for f in kid_gestora.candidatas(pistas) if f.id not in kid_gestora.ESPEJOS]
        for fuente in propias:
            if fuente.urls is None:
                urls.append((fuente.id, fuente.pagina(isin), True))
                continue
            try:
                urls.extend((fuente.id, u, False) for u in fuente.urls(isin, ident))
            except Exception as e:  # noqa: BLE001 - diagnosticar, no romper
                urls.append((fuente.id, f"ERROR {type(e).__name__}: {e}", False))
        detalle[isin] = urls
        (con_candidata if urls else sin_candidata)[gestora].append(isin)

    print()
    print("--- Gestoras SIN ninguna fuente propia que case (falta patrón) ---")
    for gestora, isines in sorted(sin_candidata.items(), key=lambda kv: -len(kv[1])):
        print(f"  {gestora[:44]:46}{len(isines):>4}  {', '.join(isines[:4])}")
    print(f"  TOTAL: {sum(len(v) for v in sin_candidata.values())} fondos")

    print()
    print("--- Gestoras CON fuente propia que aun así no tienen KID (patrón a depurar) ---")
    for gestora, isines in sorted(con_candidata.items(), key=lambda kv: -len(kv[1])):
        print(f"  {gestora[:44]:46}{len(isines):>4}  {', '.join(isines[:4])}")
    print(f"  TOTAL: {sum(len(v) for v in con_candidata.values())} fondos")

    if not args.red:
        print()
        print("Sin --red no se prueba ninguna URL. Para ver qué devuelven, ejecuta en tu PC:")
        print("  python tools/test_kid.py --red")
        return 0

    # --- Con red: probar las candidatas tal como lo hace producción ----------
    controles = controles_por_fuente(todas)
    produccion = cabeceras_de_produccion()
    en_juego = sorted({fid for urls in detalle.values() for fid, _u, _h in urls})
    print()
    print("--- Control: un ISIN cuyo KID ya vino de esa misma fuente ---")
    for fid in en_juego:
        isin_ok = controles.get(fid)
        fuente = next((f for f in kid_gestora.FUENTES if f.id == fid), None)
        if fuente is None or not isin_ok:
            print(f"  [{fid}] sin control: hoy ninguna ficha tiene su KID de esta fuente")
            continue
        ident = kid_gestora.identificacion_de(previo_sintetico(por_isin[isin_ok]))
        urls_ctrl = urls_de(fuente, isin_ok, ident)
        if not urls_ctrl:
            print(f"  [{fid}] {isin_ok}: no construye URL (identificación incompleta)")
            continue
        for url in urls_ctrl:
            resumen, _cuerpo = prueba(url, dict(produccion, **(fuente.cabeceras or {})))
            print(f"  [{fid}] {isin_ok} {resumen}")
            print(f"        {url}")
            time.sleep(args.espera)
            if "<-- PDF" in resumen or resumen.startswith("200"):
                break

    print()
    print("--- Prueba de las URL candidatas ---")
    for isin, urls in detalle.items():
        if not urls:
            continue
        print()
        print(f"{isin}:")
        for fid, url, es_ficha in urls:
            if url.startswith("ERROR "):
                print(f"  [{fid}] {url}")
                continue
            fuente = next((f for f in kid_gestora.FUENTES if f.id == fid), None)
            cabeceras = dict(produccion, **(fuente.cabeceras or {})) if fuente else dict(produccion)
            resumen, cuerpo = prueba(url, cabeceras)
            print(f"  [{fid}] {resumen}")
            print(f"        {url}")
            if es_ficha and cuerpo and fuente is not None and fuente.enlace is not None:
                m = fuente.enlace(isin).search(cuerpo)
                if m:
                    enlace = fuente.base_enlace + m.group(1)
                    resumen2, _c = prueba(enlace, cabeceras)
                    print(f"        enlace del KID dentro de la ficha: {resumen2}")
                    print(f"        {enlace}")
                else:
                    print("        la ficha no contiene el enlace que busca el patrón")
            time.sleep(args.espera)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
