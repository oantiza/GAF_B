#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compara dos carpetas de canónicos (export_bdb) campo a campo.

Es el oráculo del rediseño de la adquisición (04-09): regenerar los 763
canónicos y compararlos con los vigentes. Cada hoja de cada canónico cae en
una de cuatro categorías:

- idéntico: mismo valor en los dos;
- cambia: valor distinto (se lista para justificarlo uno a uno);
- aparece: no había dato (ausente o null) y ahora lo hay -> mejora a justificar;
- desaparece: había dato y ya no -> REGRESIÓN salvo justificación explícita.

    python tools/diff_canonicos.py ANTES DESPUES [--salida reports/diff]
    python tools/diff_canonicos.py ANTES DESPUES --ignorar provenance,regulatory

Escribe `<salida>.md` (resumen legible) y `<salida>.json` (detalle por ruta e
ISIN). Se ignoran las marcas de tiempo de generación, que cambian siempre.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

IGNORAR_SIEMPRE = ("generated_at", "quality.parsed_at")
CATEGORIAS = ("identico", "cambia", "aparece", "desaparece")
MAX_ISINS_LISTADOS = 25


def aplana(d, prefijo: str = "", out: dict | None = None) -> dict:
    """{ruta: valor} con hojas escalares; las listas se indexan ([i])."""
    if out is None:
        out = {}
    if isinstance(d, dict):
        if not d and prefijo:
            out[prefijo] = {}
        for k, v in d.items():
            aplana(v, f"{prefijo}.{k}" if prefijo else str(k), out)
    elif isinstance(d, list):
        if not d and prefijo:
            out[prefijo] = []
        for i, v in enumerate(d):
            aplana(v, f"{prefijo}[{i}]", out)
    else:
        out[prefijo] = d
    return out


def _igual(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) \
            and not isinstance(a, bool) and not isinstance(b, bool):
        return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-9)
    return a == b


def _vacio(v) -> bool:
    return v is None or v == {} or v == []


def ruta_generica(ruta: str) -> str:
    """holdings_top10[3].name -> holdings_top10[].name (para agregar)."""
    out, i = [], 0
    while i < len(ruta):
        if ruta[i] == "[":
            j = ruta.index("]", i)
            out.append("[]")
            i = j + 1
        else:
            out.append(ruta[i])
            i += 1
    return "".join(out)


def carga(carpeta: Path) -> dict[str, dict]:
    docs = {}
    for p in sorted(carpeta.glob("*.json")):
        if p.name.startswith("_"):
            continue
        try:
            docs[p.stem] = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"no leo {p}: {e}", file=sys.stderr)
    return docs


def compara(antes: dict[str, dict], despues: dict[str, dict],
            ignorar: tuple[str, ...] = ()) -> dict:
    ignorar = tuple(ignorar) + IGNORAR_SIEMPRE
    comunes = sorted(set(antes) & set(despues))
    solo_antes = sorted(set(antes) - set(despues))
    solo_despues = sorted(set(despues) - set(antes))

    por_ruta: dict[str, dict] = defaultdict(lambda: {c: 0 for c in CATEGORIAS})
    isins_por_ruta: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    ejemplos: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    totales = {c: 0 for c in CATEGORIAS}
    por_isin: dict[str, dict] = {}

    for isin in comunes:
        a, b = aplana(antes[isin]), aplana(despues[isin])
        resumen = {c: 0 for c in CATEGORIAS}
        for ruta in sorted(set(a) | set(b)):
            if any(ruta == x or ruta.startswith(x + ".") or ruta.startswith(x + "[")
                   for x in ignorar):
                continue
            va, vb = a.get(ruta), b.get(ruta)
            if _vacio(va) and _vacio(vb):
                continue
            if _vacio(va):
                cat = "aparece"
            elif _vacio(vb):
                cat = "desaparece"
            elif _igual(va, vb):
                cat = "identico"
            else:
                cat = "cambia"
            g = ruta_generica(ruta)
            por_ruta[g][cat] += 1
            totales[cat] += 1
            resumen[cat] += 1
            if cat != "identico":
                lst = isins_por_ruta[g][cat]
                if isin not in lst:
                    lst.append(isin)
                if len(ejemplos[g][cat]) < 3:
                    ejemplos[g][cat].append({"isin": isin, "ruta": ruta,
                                             "antes": va, "despues": vb})
        por_isin[isin] = resumen

    return {
        "n_antes": len(antes), "n_despues": len(despues), "n_comunes": len(comunes),
        "solo_antes": solo_antes, "solo_despues": solo_despues,
        "totales": totales,
        "por_ruta": {r: dict(v) for r, v in por_ruta.items()},
        "isins_por_ruta": {r: {c: sorted(l) for c, l in v.items()}
                           for r, v in isins_por_ruta.items()},
        "ejemplos": {r: dict(v) for r, v in ejemplos.items()},
        "por_isin": por_isin,
    }


def _fmt(v) -> str:
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= 60 else s[:57] + "..."


def markdown(res: dict, etiqueta_a: str, etiqueta_b: str) -> str:
    t = res["totales"]
    total = sum(t.values()) or 1
    lineas = [
        "# Diff campo a campo de canónicos",
        "",
        f"Antes: `{etiqueta_a}` ({res['n_antes']} canónicos) · "
        f"Después: `{etiqueta_b}` ({res['n_despues']} canónicos) · "
        f"comunes: {res['n_comunes']}",
        "",
        "| Categoría | Hojas | % |",
        "|---|---:|---:|",
    ]
    for c in CATEGORIAS:
        lineas.append(f"| {c} | {t[c]} | {100 * t[c] / total:.2f} % |")
    if res["solo_antes"]:
        lineas += ["", f"**Canónicos que desaparecen ({len(res['solo_antes'])}):** "
                   + ", ".join(res["solo_antes"][:40])]
    if res["solo_despues"]:
        lineas += ["", f"**Canónicos nuevos ({len(res['solo_despues'])}):** "
                   + ", ".join(res["solo_despues"][:40])]

    for cat, titulo in (("desaparece", "Campos que desaparecen (regresión salvo justificación)"),
                        ("cambia", "Campos que cambian de valor"),
                        ("aparece", "Campos que aparecen (mejora a justificar)")):
        filas = [(r, v) for r, v in res["por_ruta"].items() if v[cat]]
        filas.sort(key=lambda x: -x[1][cat])
        lineas += ["", f"## {titulo}: {t[cat]} hojas en {len(filas)} rutas", ""]
        if not filas:
            lineas.append("_ninguno_")
            continue
        lineas += ["| Ruta | Hojas | ISINs | Ejemplo (antes → después) |", "|---|---:|---|---|"]
        for r, v in filas:
            isins = res["isins_por_ruta"].get(r, {}).get(cat, [])
            ej = (res["ejemplos"].get(r, {}).get(cat) or [{}])[0]
            ejemplo = (f"{ej.get('isin', '')}: {_fmt(ej.get('antes'))} → {_fmt(ej.get('despues'))}"
                       if ej else "")
            muestra = ", ".join(isins[:6]) + (f" (+{len(isins) - 6})" if len(isins) > 6 else "")
            lineas.append(f"| `{r}` | {v[cat]} | {muestra} | {ejemplo} |")

    # ISINs con más movimiento
    movidos = sorted(res["por_isin"].items(),
                     key=lambda x: -(x[1]["desaparece"] * 10 + x[1]["cambia"]))[:15]
    lineas += ["", "## ISINs con más desapariciones/cambios", "",
               "| ISIN | idéntico | cambia | aparece | desaparece |", "|---|---:|---:|---:|---:|"]
    for isin, r in movidos:
        if r["desaparece"] or r["cambia"]:
            lineas.append(f"| {isin} | {r['identico']} | {r['cambia']} | {r['aparece']} | {r['desaparece']} |")
    return "\n".join(lineas) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("antes")
    ap.add_argument("despues")
    ap.add_argument("--salida", default="reports/diff_canonicos")
    ap.add_argument("--ignorar", default="", help="prefijos de ruta a ignorar, separados por coma")
    args = ap.parse_args()

    antes, despues = carga(Path(args.antes)), carga(Path(args.despues))
    ignorar = tuple(x.strip() for x in args.ignorar.split(",") if x.strip())
    res = compara(antes, despues, ignorar)
    salida = Path(args.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.with_suffix(".json").write_text(json.dumps(res, ensure_ascii=False, indent=1),
                                           encoding="utf-8")
    md = markdown(res, args.antes, args.despues)
    salida.with_suffix(".md").write_text(md, encoding="utf-8")
    t = res["totales"]
    print(f"idéntico {t['identico']} · cambia {t['cambia']} · aparece {t['aparece']} · "
          f"desaparece {t['desaparece']}  -> {salida.with_suffix('.md')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
