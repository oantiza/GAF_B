# -*- coding: utf-8 -*-
"""Da ficha a las acciones en alcance que no la tienen, con su marca de disponibilidad.

Decision 14 de Oscar (02-11-2026): un instrumento que deja de cotizar se marca, no
desaparece. La cadena de la marca ya funciona para los 301 que tienen ficha, pero no para
los que NO la tienen: sin ficha no hay donde poner la marca, y sin ficha no hay canonico,
asi que no existen para la base. Son exactamente las cinco espanolas que dejaron de
cotizar, y ninguna aparece en ningun sitio diciendo por que falta.

Esto es un RELLENO DE DATOS, autorizado por Oscar, y por eso vive en `tools/` y no en el
pipeline: se ejecuta a mano, una vez, y lo que escribe queda bajo una procedencia que lo
nombra.

## De donde sale cada cosa, porque aqui no se inventa nada

La evidencia es la copia verificada de la maestra, que hay que pasar como argumento. Para
cada ISIN se lee su documento `assets/<ISIN>` -nombre, divisa, clase, ticker, codigo- y se
cuentan sus documentos `assets/<ISIN>/price_series/*`, de los que sale la ULTIMA fecha con
precio. Medido el 02-11-2026 contra la copia `2026-10-31T13-35-09-399Z`:

| ISIN         | nombre                  | series | ultima fecha |
|--------------|-------------------------|--------|--------------|
| ES0114400007 | CAM, CUOTAS PARTICIPAT. | 0      | ninguna      |
| ES0125140A14 | ERCROS                  | 37     | 2026-09-21   |
| ES0143416115 | Siemens Gamesa          | 24     | 2023-02-08   |
| ES0158300410 | CLEOP                   | 8      | 2017-05-15   |
| ES0161560018 | NH Hoteles              | 36     | 2026-09-04   |

Las cuatro fechas coinciden con las que la decision 14 afirmaba de memoria, y ahora estan
medidas. La CAM sale sin una sola serie, que es lo que la separa de las otras cuatro: no
es una defuncion, es un ISIN que nunca resolvio.

**Dos de esas fechas son falsas** (medido el 07-11-2026 sobre la misma copia). La "ultima
fecha" es la mayor que aparece en los puntos de serie, y un punto de serie no prueba una
negociacion:

- NH: BDB prolongo plano el ultimo precio (6,50) desde el 25-09-2025 hasta el 04-09-2026, y
  lo dejo escrito en `metadata` (`extended_flat`, "ultimo precio prolongado"). El 04-09-2026
  es el dia en que BDB hizo esa prolongacion, un ano despues de la exclusion.
- Ercros: EODHD siguio sirviendo 3,49 durante la suspension (11 a 21-09-2026); el 21-09 es el
  ultimo precio servido, no la ultima sesion.

Siemens Gamesa y CLEOP cuadran porque sus series no traen nada de eso. NH y Ercros se fijaron
por decision en `config/bajas_decididas.csv` (decision 9 del 07-11-2026). Esta herramienta no
se ha corregido: si se vuelve a usar, la fecha tiene que excluir los puntos prolongados y los
planos del final antes de tomarse como baja.

## Las dos premisas del estado, dichas en voz alta

`decide` necesita saber si el proveedor contesta hoy y si resolvia antes:

- **Resolvia antes**: tiene documentos de serie en la copia. Es la prueba, y es la que
  distingue `DEJO_DE_COTIZAR` de `NUNCA_RESUELTO`.
- **No resuelve ahora**: la pasada del 02-11-2026 pidio las 306 acciones en alcance con
  `--force` y escribio 301 fichas. Estas cinco fueron las que no. Que el proveedor
  CONTESTO se asume de esa misma pasada, en la que las otras 301 si resolvieron contra el
  mismo endpoint: si EODHD hubiera estado caido, no habria 301 fichas nuevas.

La segunda premisa es del dia que se ejecuta, no eterna. Si se vuelve a lanzar esto en una
tarde sin red, la asuncion deja de valer: ejecutalo despues de una pasada que haya escrito
fichas, no en vez de ella.

## Lo que escribe

Una ficha minima: identificacion y la marca, sin una sola cifra. No lleva precio, ni
metricas, ni serie, porque no las tenemos de hoy y las de la copia son de otra base. Lo que
el asesor vera es el nombre y que dejo de cotizar tal dia, que es exactamente lo que
decidio Oscar y nada mas.

Uso:
    python tools/rellena_difuntas.py <dir_copia_maestra> [--escribe]
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from core.adquisicion import alcance as alcance_mercados  # noqa: E402
from core.adquisicion import disponibilidad  # noqa: E402
from core.ops import carga_fondos  # noqa: E402
from core.store import Store  # noqa: E402

FECHA = re.compile(r"\b(19[89]\d|20[0-3]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b")


def acciones_sin_ficha(base: Path) -> list[dict]:
    """Las acciones EN ALCANCE del universo que no tienen ficha.

    En alcance a proposito: a las de fuera no se les ha preguntado nunca, asi que
    inventarles un registro contradiria la decision de no pedirlas.
    """
    alc = alcance_mercados.carga(base)
    out = []
    for fila in carga_fondos(base):
        isin = (fila.get("isin") or "").strip().upper()
        tipo = (fila.get("tipo") or "").strip()
        if tipo != "accion":
            continue
        if alc.estado(isin, tipo) != alcance_mercados.DENTRO:
            continue
        if (base / "data" / "funds" / f"{isin}.json").exists():
            continue
        out.append({"isin": isin, "nombre_universo": (fila.get("nombre") or "").strip()})
    return out


def evidencia(copia: Path, isins: set[str]) -> dict[str, dict]:
    """Lo que la copia de la maestra dice de esos ISIN: raiz y ultima fecha de serie."""
    fichero = copia / "assets.ndjson.gz"
    if not fichero.exists():
        raise SystemExit(f"no encuentro {fichero}")
    out = {i: {"series": 0, "ultima_fecha": None, "raiz": None} for i in isins}
    with gzip.open(fichero, "rt", encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea:
                continue
            if not any(i in linea for i in isins):
                continue
            d = json.loads(linea)
            ruta = str(d.get("path") or "")
            for i in isins:
                if not ruta.startswith(f"assets/{i}"):
                    continue
                datos = d.get("data") or {}
                resto = ruta[len(f"assets/{i}"):].lstrip("/")
                if resto == "":
                    ide = datos.get("identity") or {}
                    ident = datos.get("identifiers") or {}
                    out[i]["raiz"] = {
                        "nombre": ide.get("name") or datos.get("name"),
                        "divisa": ide.get("currency") or datos.get("currency"),
                        "ticker": ident.get("ticker"),
                        "codigo": ident.get("eodhd_code"),
                    }
                elif resto.startswith("price_series/"):
                    out[i]["series"] += 1
                    fechas = FECHA.findall(json.dumps(datos))
                    if fechas:
                        may = max("-".join(x) for x in fechas)
                        if out[i]["ultima_fecha"] is None or may > out[i]["ultima_fecha"]:
                            out[i]["ultima_fecha"] = may
    return out


def ficha_minima(isin: str, ev: dict, nombre_universo: str, copia: str,
                 hoy: dt.date) -> tuple[dict, str]:
    """La ficha de un instrumento del que solo sabemos quien era y que ya no cotiza."""
    raiz = ev.get("raiz") or {}
    nombre = raiz.get("nombre") or nombre_universo
    if not nombre:
        raise SystemExit(f"{isin}: sin nombre ni en la copia ni en el universo; no lo escribo")
    resolvia_antes = ev["series"] > 0
    estado = disponibilidad.decide(en_alcance=True, proveedor_contesto=True,
                                   resuelve_ahora=False, resolvia_antes=resolvia_antes)
    if resolvia_antes:
        detalle = (f"ultima cotizacion {ev['ultima_fecha']}, medida en {ev['series']} "
                   f"documentos de serie de la copia {copia}")
        desde = ev["ultima_fecha"] or hoy.isoformat()
    else:
        detalle = (f"la copia {copia} no tiene ni un documento de serie para este ISIN: "
                   f"0 price_series")
        desde = hoy.isoformat()
    # `anterior` con el mismo estado es lo que hace que `marca` conserve `desde`: de una
    # accion que dejo de cotizar interesa el dia que dejo de resolverse, no el de hoy.
    marca = disponibilidad.marca(estado, hoy=hoy, detalle=detalle,
                                 anterior={"estado": estado, "desde": desde})
    procedencia = {
        "identificacion.nombre": f"copia_maestra:{copia}",
        "identificacion.divisa_base": f"copia_maestra:{copia}",
        "identificacion.ticker": f"copia_maestra:{copia}",
        "identificacion.simbolo_eodhd": f"copia_maestra:{copia}",
        "identificacion.isin": "config_csv",
        "identificacion.tipo": "config_csv",
        "identificacion.tipo_producto": "config_csv",
        "meta.disponibilidad": "derivado:rellena_difuntas",
    }
    ficha = {
        "identificacion": {
            "nombre": nombre,
            "tipo": "accion",
            "tipo_producto": "accion",
            "isin": isin,
            "ticker": raiz.get("ticker"),
            "divisa_base": raiz.get("divisa") or "EUR",
            "simbolo_eodhd": raiz.get("codigo"),
        },
        "meta": {
            "isin": isin,
            "actualizado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "version_esquema": 2,
            "errores": [],
            "fuentes": {"identificacion": [f"copia_maestra:{copia}", "config_csv"]},
            "procedencia": procedencia,
            "disponibilidad": marca,
            "relleno": {
                "por": "tools/rellena_difuntas.py",
                "cuando": hoy.isoformat(),
                "copia": copia,
                "por_que": ("no tenia ficha, asi que no habia donde poner la marca ni como "
                            "generar canonico: desaparecia en silencio"),
            },
        },
    }
    ficha["identificacion"] = {k: v for k, v in ficha["identificacion"].items() if v is not None}
    return ficha, estado


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("copia", help="directorio de una copia verificada de la maestra")
    p.add_argument("--escribe", action="store_true", help="sin esto solo dice que haria")
    args = p.parse_args()

    copia = Path(args.copia)
    pendientes = acciones_sin_ficha(RAIZ)
    if not pendientes:
        print("no hay acciones en alcance sin ficha: nada que rellenar")
        return 0
    print(f"acciones en alcance sin ficha: {len(pendientes)}")
    ev = evidencia(copia, {x["isin"] for x in pendientes})
    hoy = dt.date.today()
    store = Store(RAIZ)
    for x in pendientes:
        isin = x["isin"]
        ficha, estado = ficha_minima(isin, ev[isin], x["nombre_universo"], copia.name, hoy)
        marca = ficha["meta"]["disponibilidad"]
        print(f"  {isin}  {ficha['identificacion']['nombre'][:30]:<30} -> {estado:<16} "
              f"desde {marca['desde']}  ({ev[isin]['series']} series)")
        if args.escribe:
            store.escribe_fondo(isin, ficha)
    if args.escribe:
        store.reconstruye_indice()
        print("escritas, e indice regenerado. Ahora: calidad, export, bdb y la base.")
    else:
        print("NADA escrito. Pasa --escribe para escribirlo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
