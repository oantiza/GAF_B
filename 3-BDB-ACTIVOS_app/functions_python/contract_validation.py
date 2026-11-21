# -*- coding: utf-8 -*-
"""Validacion local contra la cache de contratos SSOT de BBDD-ACTIVOS."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

CONTRACTS_CACHE_DIR = Path(__file__).resolve().parent / "contracts_cache"


class ContractValidationError(ValueError):
    pass


@lru_cache(maxsize=32)
def _validator(schema_name: str) -> Draft202012Validator:
    schema_path = CONTRACTS_CACHE_DIR / schema_name
    if not schema_path.exists():
        raise ContractValidationError(
            f"Contrato no encontrado en cache: {schema_path}. "
            "Ejecuta `npm run sync:contracts` antes del deploy."
        )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def validate_contract(payload: dict, schema_name: str) -> None:
    errors = sorted(_validator(schema_name).iter_errors(payload), key=lambda err: list(err.path))
    if not errors:
        return
    sample = []
    for error in errors[:5]:
        path = ".".join(str(part) for part in error.path) or "<root>"
        sample.append(f"{path}: {error.message}")
    raise ContractValidationError(f"{schema_name} invalido: {'; '.join(sample)}")
