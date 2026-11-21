#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
C1 (auditoría 29-09): informe de observación de App Check.

Lee con `gcloud logging read` las líneas `app_check_observation` que emite
`_require_auth` (functions_python/main.py) y agrega: total, con/sin token,
desglose por operación, origen y cliente, y las combinaciones origen/operación
SIN token. Termina con un veredicto: «Activable» si en el periodo el 100 % de
las llamadas desde los orígenes de producción traen token.

Uso (PowerShell, con gcloud en el PATH):
    python scripts\\appcheck_report.py --days 7
    python scripts\\appcheck_report.py --days 7 --json
    python scripts\\appcheck_report.py --input entradas.json   (sin llamar a gcloud)

Solo stdlib. La agregación (`aggregate`) es una función pura para poder testearla.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from master_project import PROYECTO_BASE_NUEVA, exigir_proyecto_permitido, master_project_id  # noqa: E402
OBSERVATION_MESSAGE = "app_check_observation"
PRODUCTION_ORIGINS = (
    f"https://{PROYECTO_BASE_NUEVA}.web.app",
    f"https://{PROYECTO_BASE_NUEVA}.firebaseapp.com",
)
# Sin espacios ni comillas: así el argumento llega intacto a gcloud.cmd en Windows.
DEFAULT_FILTER = f"jsonPayload.message={OBSERVATION_MESSAGE}"


# --- lectura -----------------------------------------------------------------

def gcloud_command(project: str, days: int, limit: int, log_filter: str = DEFAULT_FILTER) -> list[str]:
    exe = shutil.which("gcloud")
    if not exe:
        raise SystemExit("No se encuentra `gcloud` en el PATH (en Windows: gcloud.cmd).")
    return [
        exe, "logging", "read", log_filter,
        "--project", project,
        "--format", "json",
        "--limit", str(limit),
        "--freshness", f"{days}d",
        "--order", "desc",
    ]


def fetch_entries(project: str, days: int, limit: int) -> list[dict]:
    cmd = gcloud_command(project, days, limit)
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise SystemExit(f"gcloud logging read falló ({proc.returncode}):\n{proc.stderr.strip()}")
    try:
        entries = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Salida de gcloud no es JSON: {exc}") from exc
    if not isinstance(entries, list):
        raise SystemExit("Salida de gcloud inesperada (se esperaba una lista).")
    if len(entries) >= limit:
        print(f"AVISO: se alcanzó --limit {limit}; el periodo puede estar truncado. "
              "Sube --limit o reduce --days.", file=sys.stderr)
    return entries


# --- agregación (pura) -------------------------------------------------------

def _payload(entry: dict) -> dict | None:
    """Acepta entradas de gcloud (jsonPayload) o ya aplanadas (para tests)."""
    if not isinstance(entry, dict):
        return None
    payload = entry.get("jsonPayload")
    if payload is None and "app_check" in entry:
        payload = entry
    if not isinstance(payload, dict) or payload.get("message", OBSERVATION_MESSAGE) != OBSERVATION_MESSAGE:
        return None
    if payload.get("app_check") not in ("present", "missing"):
        return None
    return payload


def aggregate(entries: list[dict], production_origins=PRODUCTION_ORIGINS) -> dict:
    total = present = 0
    by_operation: dict[str, Counter] = defaultdict(Counter)
    by_origin: dict[str, Counter] = defaultdict(Counter)
    by_client: dict[str, Counter] = defaultdict(Counter)
    missing_combos: Counter = Counter()
    timestamps: list[str] = []

    for entry in entries:
        p = _payload(entry)
        if p is None:
            continue
        has_token = p["app_check"] == "present"
        op = str(p.get("operation") or "-")
        origin = str(p.get("origin") or "-")
        client = str(p.get("client") or "unknown")
        total += 1
        present += int(has_token)
        for bucket, key in ((by_operation, op), (by_origin, origin), (by_client, client)):
            bucket[key]["total"] += 1
            bucket[key]["missing"] += int(not has_token)
        if not has_token:
            missing_combos[(origin, op, client)] += 1
        ts = entry.get("timestamp") if isinstance(entry, dict) else None
        if isinstance(ts, str):
            timestamps.append(ts)

    missing = total - present

    def _table(bucket: dict[str, Counter]) -> list[dict]:
        rows = []
        for key, c in bucket.items():
            rows.append({
                "key": key,
                "total": c["total"],
                "present": c["total"] - c["missing"],
                "missing": c["missing"],
                "missing_pct": _pct(c["missing"], c["total"]),
            })
        rows.sort(key=lambda r: (-r["total"], r["key"]))
        return rows

    prod_total = sum(by_origin[o]["total"] for o in production_origins if o in by_origin)
    prod_missing = sum(by_origin[o]["missing"] for o in production_origins if o in by_origin)
    if prod_total == 0:
        verdict = "Sin datos de producción"
        verdict_reason = "Ninguna llamada registrada desde los orígenes de producción en el periodo."
    elif prod_missing == 0:
        verdict = "Activable"
        verdict_reason = (f"Las {prod_total} llamadas desde producción traen token "
                          f"(100 %).")
    else:
        verdict = "No activable"
        verdict_reason = (f"{prod_missing} de {prod_total} llamadas desde producción "
                          f"({_pct(prod_missing, prod_total)} %) llegan sin token.")

    would_break = sorted(
        {(origin, client) for (origin, _op, client) in missing_combos},
        key=lambda k: (k[0], k[1]),
    )

    return {
        "entries_total": len(entries),
        "total": total,
        "present": present,
        "missing": missing,
        "missing_pct": _pct(missing, total),
        "first_timestamp": min(timestamps) if timestamps else None,
        "last_timestamp": max(timestamps) if timestamps else None,
        "by_operation": _table(by_operation),
        "by_origin": _table(by_origin),
        "by_client": _table(by_client),
        "missing_combos": [
            {"origin": o, "operation": op, "client": c, "count": n}
            for (o, op, c), n in sorted(missing_combos.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "production": {
            "origins": list(production_origins),
            "total": prod_total,
            "missing": prod_missing,
        },
        "verdict": verdict,
        "verdict_reason": verdict_reason,
        "would_break": [{"origin": o, "client": c} for o, c in would_break],
    }


def _pct(num: int, den: int) -> float:
    return round(100.0 * num / den, 1) if den else 0.0


# --- salida ------------------------------------------------------------------

def _fmt_table(headers: list[str], rows: list[list[str]]) -> str:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    line = "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
    sep = "  ".join("-" * w for w in widths)
    body = ["  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) for row in rows]
    return "\n".join([line, sep] + body) if rows else "\n".join([line, sep, "(sin datos)"])


def render_text(summary: dict, days: int | None = None) -> str:
    out = []
    title = "Observación de App Check"
    if days:
        title += f" — últimos {days} días"
    out.append(title)
    out.append("=" * len(title))
    if summary["first_timestamp"]:
        out.append(f"Periodo con datos: {summary['first_timestamp']} -> {summary['last_timestamp']}")
    out.append(f"Llamadas: {summary['total']}   con token: {summary['present']}   "
               f"sin token: {summary['missing']}   ({summary['missing_pct']} % sin token)")
    out.append("")

    def block(name: str, rows: list[dict], key_header: str) -> None:
        out.append(name)
        out.append(_fmt_table(
            [key_header, "Total", "Con token", "Sin token", "% sin"],
            [[r["key"], str(r["total"]), str(r["present"]), str(r["missing"]), str(r["missing_pct"])]
             for r in rows],
        ))
        out.append("")

    block("Por operación", summary["by_operation"], "Operación")
    block("Por origen", summary["by_origin"], "Origen")
    block("Por cliente", summary["by_client"], "Cliente")

    out.append("Combinaciones origen / operación SIN token")
    out.append(_fmt_table(
        ["Origen", "Operación", "Cliente", "Llamadas"],
        [[c["origin"], c["operation"], c["client"], str(c["count"])] for c in summary["missing_combos"]],
    ))
    out.append("")

    out.append(f"Veredicto: {summary['verdict']}")
    out.append(f"  {summary['verdict_reason']}")
    if summary["would_break"]:
        out.append("  Si se activa el enforce dejarían de funcionar:")
        for w in summary["would_break"]:
            out.append(f"    - origen {w['origin']} (cliente: {w['client']})")
    else:
        out.append("  Nada se rompería con los datos observados.")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Informe de observación de App Check (C1, auditoría 29-09).")
    parser.add_argument("--days", type=int, default=7, help="Ventana en días (por defecto 7).")
    parser.add_argument("--project", default=None, help="Proyecto destino; por defecto, MASTER_PROJECT_ID.")
    parser.add_argument("--limit", type=int, default=20000, help="Máximo de entradas a leer.")
    parser.add_argument("--json", action="store_true", help="Salida JSON en lugar de tabla.")
    parser.add_argument("--input", help="Fichero JSON con la salida de `gcloud logging read` (no llama a gcloud).")
    args = parser.parse_args(argv)
    try:  # consolas Windows sin UTF-8: no abortar por un acento.
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

    if args.input:
        with open(args.input, encoding="utf-8") as fh:
            entries = json.load(fh)
    else:
        proyecto = exigir_proyecto_permitido(args.project, "--project") if args.project else master_project_id()
        entries = fetch_entries(proyecto, max(1, args.days), max(1, args.limit))

    summary = aggregate(entries)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(render_text(summary, days=None if args.input else args.days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
