from core.canonico_regulatorio import bloque_regulatorio


def _ficha(fecha_costes, fecha_doc):
    return {
        "costes": {"kid": {"fecha": fecha_costes, "entrada_pct": 0.0}},
        "documentos_oficiales": {"kid_url": "https://ejemplo/kid.pdf", "kid_sha256": "abc",
                                 "kid_fecha": fecha_doc, "kid_fuente": "gestora"},
    }


def _fecha(bloque):
    return (bloque.get("kid") or {}).get("date")


def test_fecha_del_documento_publicado_si_difiere_de_la_de_costes():
    assert _fecha(bloque_regulatorio(_ficha("2025-06-02", "2026-03-06"))) == "2026-03-06"


def test_sin_fecha_de_documento_se_usa_la_de_costes():
    assert _fecha(bloque_regulatorio(_ficha("2025-06-02", None))) == "2025-06-02"


def test_iguales_no_cambia():
    assert _fecha(bloque_regulatorio(_ficha("2026-01-01", "2026-01-01"))) == "2026-01-01"
