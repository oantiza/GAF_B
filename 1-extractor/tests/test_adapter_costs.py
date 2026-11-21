from core.adaptador_bdb import management_fee


def test_management_fee_prefers_applied_and_preserves_zero():
    warnings = []
    data = {"costes": {
        "comision_gestion_aplicada_pct": 0,
        "comision_gestion_max_pct": 1.5,
        "ter_pct": 1.8,
    }}
    assert management_fee(data, warnings) == 0
    assert warnings == []


def test_management_fee_uses_declared_maximum_with_trace():
    warnings = []
    assert management_fee({"costes": {"comision_gestion_max_pct": 1.5}}, warnings) == 1.5
    assert warnings == ["management_fee_uses_declared_maximum"]


def test_management_fee_never_imputes_ter():
    warnings = []
    assert management_fee({"costes": {"ter_pct": 1.8}}, warnings) is None
    assert warnings == ["management_fee_unavailable_not_imputed_from_ter"]
