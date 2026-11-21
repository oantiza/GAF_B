"""Cuántas acciones del alcance cambian de respuesta si la puerta mide cobertura.

La pregunta de Óscar del 02-11-2026, después de ver el caso CEVASA: la misma métrica
tiene dos puertas de entrada según el activo, y la de las acciones está expresada en
**número** de observaciones —``máx(60, años * 180)``— así que no puede distinguir una
serie corta de una serie poco líquida. La de los fondos pide **cobertura**: cierres de
mes consecutivos. ¿A cuántas de las acciones del alcance les cambiaría la respuesta?

Esto **solo mide**. No escribe fichas, no toca el canónico, no abre Firestore y no
cambia ningún umbral. Lee la serie diaria de cada acción y pregunta a las dos puertas,
llamando al código que las aplica de verdad:

- la puerta de hoy es ``core.metricas.metricas_diarias``, que devuelve ``None`` cuando la
  ventana no reúne las observaciones;
- la de cobertura es la condición de ``core.metricas.riesgo``: que la ventana tenga sus
  13, 37 o 61 cierres de mes **consecutivos**. Si ``riesgo`` publica ese plazo, la
  cobertura está; si no, no.

Por qué se pregunta a `riesgo` en vez de reimplementar la condición: una condición
copiada a mano mide el código que yo escriba hoy, no el que corre en producción. Lo que
interesa saber es si cambiaría la respuesta **del sistema**, así que se le pregunta al
sistema.

Lo que este medidor NO afirma: que la puerta de cobertura sea la correcta. Esa decisión
es de Óscar y necesita este número para tomarse, que es justo lo que falta.

    python tools/mide_dos_puertas.py              # las acciones del alcance
    python tools/mide_dos_puertas.py --limite 20  # una cata, para probar
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

from core.adquisicion import alcance as A          # noqa: E402
from core.http import Http                         # noqa: E402
from core.metricas import metricas_diarias, minimo_observaciones, riesgo  # noqa: E402
from core.ops import carga_fondos                  # noqa: E402
from fetchers import eodhd                         # noqa: E402

BASE = Path(__file__).resolve().parents[1]
VENTANAS = ((1, "1a"), (3, "3a"), (5, "5a"))


def objetivos(base: Path) -> list[dict]:
    """Las acciones que el alcance deja dentro, con su símbolo si la ficha lo trae."""
    al = A.carga(base)
    funds = base / "data" / "funds"
    out = []
    for fila in carga_fondos(base):
        isin = str(fila.get("isin") or "").strip().upper()
        tipo = str(fila.get("tipo") or "").strip().lower()
        if tipo != "accion" or al.estado(isin, tipo) != A.DENTRO:
            continue
        simbolo = ""
        ruta = funds / f"{isin}.json"
        if ruta.exists():
            try:
                ficha = json.loads(ruta.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                ficha = {}
            bruto = ((ficha.get("riesgo") or {}).get("historial_precios") or {}).get(
                "source_listing_id") or ""
            # Viaja como "EODHD:AAPL.US"; al endpoint va solo el simbolo.
            simbolo = str(bruto).split(":", 1)[-1].strip() if bruto else ""
        out.append({"isin": isin, "nombre": fila.get("nombre") or "", "simbolo": simbolo})
    return out


def juzga(serie: list[tuple]) -> dict:
    """Las dos puertas sobre la misma serie, ventana a ventana."""
    cobertura = riesgo(serie)          # las ventanas que superan la puerta mensual
    filas = {}
    for anos, clave in VENTANAS:
        m = metricas_diarias(serie, anos, None)
        obs = m["observaciones"] if m else None
        if obs is None and serie:
            # Cuantas hay de verdad en la ventana, aunque la puerta la rechace.
            from core.metricas import resta_anos
            desde = resta_anos(serie[-1][0], anos)
            obs = sum(1 for f, _p in serie if f >= desde)
        filas[clave] = {
            "hoy": m is not None,
            "cobertura": clave in cobertura,
            "observaciones": obs,
            "exige_hoy": minimo_observaciones(anos),
        }
    return filas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limite", type=int, default=0, help="mide solo las N primeras")
    ap.add_argument("--salida", default="", help="fichero JSON con el detalle")
    args = ap.parse_args()

    token = eodhd._token(BASE)
    if not token:
        print("sin token de EODHD: nada que medir")
        return 2

    settings = json.loads((BASE / "config" / "settings.json").read_text(encoding="utf-8"))
    http = Http(settings, BASE / "cache" / "http")

    objs = objetivos(BASE)
    if args.limite:
        objs = objs[: args.limite]
    print(f"acciones del alcance a medir: {len(objs)}", flush=True)

    detalle, sin_simbolo, sin_serie, fallos = [], [], [], []
    for n, o in enumerate(objs, 1):
        if not o["simbolo"]:
            sin_simbolo.append(o["isin"])
            continue
        try:
            cruda = eodhd._serie_eod_ajustada(o["simbolo"], http, token, False)
        except Exception as e:                       # noqa: BLE001 - se anota y se sigue
            fallos.append({"isin": o["isin"], "error": f"{type(e).__name__}: {e}"})
            continue
        serie = [(p["date"], p["price"]) for p in cruda]
        if len(serie) < 2:
            sin_serie.append(o["isin"])
            continue
        detalle.append({**o, "puntos": len(serie),
                        "desde": serie[0][0].isoformat(),
                        "hasta": serie[-1][0].isoformat(),
                        "ventanas": juzga(serie)})
        if n % 25 == 0:
            print(f"  {n}/{len(objs)}  ({len(detalle)} con serie)", flush=True)

    # ---------------------------------------------------------------- el recuento
    print()
    print(f"medidas con serie : {len(detalle)}")
    print(f"sin simbolo       : {len(sin_simbolo)}  {', '.join(sin_simbolo) or '-'}")
    print(f"sin serie         : {len(sin_serie)}  {', '.join(sin_serie) or '-'}")
    print(f"fallos de red     : {len(fallos)}")
    print()

    resumen = {}
    for _anos, clave in VENTANAS:
        celdas = {"las_dos": 0, "solo_hoy": 0, "solo_cobertura": 0, "ninguna": 0}
        ganan = []
        for d in detalle:
            v = d["ventanas"][clave]
            if v["hoy"] and v["cobertura"]:
                celdas["las_dos"] += 1
            elif v["hoy"]:
                celdas["solo_hoy"] += 1
            elif v["cobertura"]:
                celdas["solo_cobertura"] += 1
                ganan.append({"isin": d["isin"], "nombre": d["nombre"],
                              "observaciones": v["observaciones"],
                              "exige_hoy": v["exige_hoy"]})
            else:
                celdas["ninguna"] += 1
        resumen[clave] = {"celdas": celdas, "ganarian": ganan}
        print(f"--- ventana {clave} " + "-" * 46)
        print(f"  publican con las dos puertas      : {celdas['las_dos']}")
        print(f"  SOLO con la de hoy (perderian)    : {celdas['solo_hoy']}")
        print(f"  SOLO con cobertura (ganarian)     : {celdas['solo_cobertura']}")
        print(f"  con ninguna                       : {celdas['ninguna']}")
        if ganan:
            obs = sorted(g["observaciones"] or 0 for g in ganan)
            print(f"    observaciones de las que ganarian: minimo {obs[0]}, "
                  f"mediana {obs[len(obs) // 2]}, maximo {obs[-1]}")
            for g in ganan[:12]:
                print(f"      {g['isin']}  {g['observaciones']:>4} de "
                      f"{g['exige_hoy']:>3}  {g['nombre'][:42]}")
            if len(ganan) > 12:
                print(f"      ... y {len(ganan) - 12} mas")

    # Cuantas acciones cambian en AL MENOS una ventana: la cifra que decide.
    cambian = [d["isin"] for d in detalle
               if any(d["ventanas"][c]["hoy"] != d["ventanas"][c]["cobertura"]
                      for _a, c in VENTANAS)]
    mudas_hoy = [d["isin"] for d in detalle
                 if not any(d["ventanas"][c]["hoy"] for _a, c in VENTANAS)]
    mudas_con_cobertura = [d["isin"] for d in detalle
                           if not any(d["ventanas"][c]["cobertura"] for _a, c in VENTANAS)]
    print()
    print("=" * 64)
    print(f"acciones que cambian en alguna ventana : {len(cambian)} de {len(detalle)}")
    print(f"hoy no publican NADA                   : {len(mudas_hoy)}")
    print(f"con cobertura no publicarian nada      : {len(mudas_con_cobertura)}")

    if args.salida:
        Path(args.salida).write_text(json.dumps(
            {"medidas": len(detalle), "sin_simbolo": sin_simbolo, "sin_serie": sin_serie,
             "fallos": fallos, "resumen": resumen, "cambian": cambian,
             "mudas_hoy": mudas_hoy, "mudas_con_cobertura": mudas_con_cobertura,
             "detalle": detalle}, ensure_ascii=False, indent=1, default=str),
            encoding="utf-8")
        print(f"detalle en {args.salida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
