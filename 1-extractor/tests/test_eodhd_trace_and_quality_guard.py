import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from core import update as update_pipeline # noqa: E402
from core import adaptador_bdb  # noqa: E402
from fetchers import eodhd  # noqa: E402
from fetchers import morningstar_lt  # noqa: E402


class FakeResponse:
    ok = True
    text = "TIME_PERIOD,OBS_VALUE\n2020-01-01,2.0\n2026-01-01,2.0\n"


class FakeHttp:
    def get(self, *_args, **_kwargs):
        return FakeResponse()


class FakeSearchResponse:
    ok = True
    status = 200
    text = "[]"

    def __init__(self, payload):
        self.payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self.payload


class FakeSearchHttp:
    def get(self, *_args, **_kwargs):
        return FakeSearchResponse([
            {
                "Code": "IWDA",
                "Exchange": "XETRA",
                "ISIN": "IE00B4L5Y983",
                "Type": "ETF",
                "Currency": "EUR",
                "Name": "iShares Core MSCI World UCITS ETF",
            }
        ])


def make_series(days=2200):
    start = dt.date(2020, 1, 1)
    return [
        {"date": start + dt.timedelta(days=i), "price": 100 + i * 0.05, "raw": {}}
        for i in range(days)
    ]


class EodhdTraceAndQualityGuardTest(unittest.TestCase):
    def test_yahoo_history_keeps_trace_and_coverage(self):
        out = {}
        eodhd._aplica_metricas_historicas(
            out,
            make_series(),
            FakeHttp(),
            "yahoo",
            "YAHOO:AENA.MC",
            divisa="EUR",
        )

        trace = out["riesgo"]["historial_precios"]
        self.assertEqual(trace["source_history"], "yahoo")
        self.assertEqual(trace["source_listing_id"], "YAHOO:AENA.MC")
        self.assertEqual(trace["observations_count"], 2200)
        self.assertEqual(trace["observaciones"], 2200)
        self.assertEqual(trace["first_date"], "2020-01-01")
        self.assertEqual(trace["fecha_inicio"], "2020-01-01")
        self.assertIn(trace["history_quality_status"], {"COMPLETE", "PARTIAL"})
        self.assertIn("3a", out["riesgo"]["sharpe"])

    def test_quality_regression_blocks_losing_complete_metrics(self):
        previous = {
            "identificacion": {"tipo": "accion", "nombre": "OK", "ticker": "OK", "mercado": "MC", "isin": "ES0000000000"},
            "valoracion": {"vl": 10},
            "rentabilidad": {"trailing_pct": {"1a": {"fondo": 1}, "3a_anualizada": {"fondo": 2}, "5a_anualizada": {"fondo": 3}}},
            "riesgo": {"volatilidad_pct": {"3a": {"fondo": 4}}, "sharpe": {"3a": {"fondo": 0.5}}},
            "calidad": {"bucket": "MEDIO"},
        }
        candidate = {
            "identificacion": {"tipo": "accion", "nombre": "OK", "ticker": "OK", "mercado": "MC", "isin": "ES0000000000"},
            "valoracion": {"vl": 10},
            "rentabilidad": {"trailing_pct": {}},
            "riesgo": {},
            "calidad": {"bucket": "BLOQUEADO"},
        }

        reason = update_pipeline.quality_regression_reason(previous, candidate)
        self.assertIsNotNone(reason)
        self.assertTrue(reason.startswith("QUALITY_REGRESSION_BLOCKED"))

    def test_region_primary_falls_back_to_category_with_inferred_marker(self):
        canonical = adaptador_bdb.convierte({
            "meta": {"isin": "ES0116419005", "fuentes": {}},
            "identificacion": {
                "nombre": "Cartera Renta Fija Horizonte 2026 FI",
                "categoria_morningstar": "EAA Fund EUR Diversified Bond - Short Term",
                "clase_activo": "Fixed Income",
            },
            "cartera": {},
        })

        self.assertEqual(canonical["classification_v2"]["region_primary"], "Europe")
        self.assertEqual(canonical["classification_v2"]["region_primary_confidence"], "INFERRED")
        self.assertIn(
            "region_primary_inferred_from_category",
            canonical["classification_v2"]["warnings"],
        )

    def test_coupon_allocation_is_null_when_source_does_not_provide_it(self):
        canonical = adaptador_bdb.convierte({
            "meta": {"isin": "ES0116419005", "fuentes": {}},
            "identificacion": {
                "nombre": "Cartera Renta Fija Horizonte 2026 FI",
                "categoria_morningstar": "EAA Fund Fixed Term Bond",
                "clase_activo": "Fixed Income",
            },
            "cartera": {"renta_fija": {"duracion_efectiva": 0.0, "ytm_pct": 0.0}},
        })

        self.assertIsNone(canonical["ms"]["fixed_income"]["coupon_allocation"])
        self.assertIn("coupon_allocation_unavailable", canonical["quality"]["warnings"])

    def test_morningstar_snapshot_ter_prefers_ongoing_charge_over_scaled_total(self):
        self.assertEqual(
            morningstar_lt._elige_ter_snapshot({
                "TotalExpenseRatio": 5.0,
                "OngoingCharge": "0.5",
                "NetExpenseRatio": None,
            }),
            0.5,
        )

    def test_morningstar_screener_negative_cache_has_seven_day_ttl(self):
        with tempfile.TemporaryDirectory() as tmp:
            http = type("HttpLike", (), {"cache_dir": Path(tmp) / "http"})()
            morningstar_lt._guarda_negativo_screener("IE00NORESULT", http)
            self.assertTrue(morningstar_lt._negativo_screener_vigente("IE00NORESULT", http))

    def test_morningstar_lt_does_not_publish_degraded_snapshot_top10_as_positions(self):
        out = {}
        snapshot = {
            "Portfolios": [{
                "Date": "2026-04-30T00:00:00",
                "HoldingAggregates": [
                    {"SalePosition": "N", "NumberOfHolding": 192},
                    {"SalePosition": "L", "NumberOfHolding": 147},
                    {"SalePosition": "S", "NumberOfHolding": 45},
                ],
                "PortfolioHoldings": [
                    {
                        "SecurityName": f"Holding {i}",
                        "ISIN": f"US00000000{i:02d}",
                        "Weighting": 10 - i,
                    }
                    for i in range(10)
                ],
            }],
        }

        morningstar_lt._mapea_snapshot(out, snapshot)
        morningstar_lt._limpia_degradacion_si_sal_completo(out, {
            "equityHoldingPage": {"holdingList": []},
            "boldHoldingPage": {"holdingList": []},
            "otherHoldingPage": {"holdingList": []},
        })

        self.assertEqual(out["cartera"]["num_posiciones"], 192)
        self.assertEqual(len(out["cartera"]["top10_posiciones"]), 10)
        self.assertNotIn("posiciones", out["cartera"])
        self.assertEqual(
            out["cartera"]["holdings_degradados"]["status"],
            "DEGRADED_TOP_HOLDINGS_ONLY",
        )
        self.assertIn(
            "HOLDINGS_DEGRADED_TOP_ONLY: snapshot=10, reported=192",
            out["meta"]["errores"],
        )

    def test_eodhd_etf_fetch_emits_ticker_and_market_only_from_search(self):
        with patch.object(eodhd, "_token", return_value="demo"):
            out = eodhd.fetch(
                "IE00B4L5Y983",
                FakeSearchHttp(),
                {"divisa": "EUR"},
                tipo="etf",
            )

        self.assertEqual(out["identificacion"]["ticker"], "IWDA")
        self.assertEqual(out["identificacion"]["mercado"], "XETRA")
        self.assertEqual(out["identificacion"]["source_listing_id"], "EODHD:IWDA.XETRA")

    def test_pipeline_persists_csv_tipo_as_lowest_priority_partial(self):
        source_data = {
            "identificacion": {"nombre": "Fondo de prueba"},
            "valoracion": {"vl": 10.0},
            "rentabilidad": {"fecha_dato": "2026-07-11"},
            "riesgo": {"sri_kid_1a7": 3},
            "cartera": {"num_posiciones": 1},
        }
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(update_pipeline.FUENTES, {
                    "source": lambda *_args, **_kwargs: source_data,
                }, clear=True), \
                patch.object(update_pipeline.limpieza, "aplica"), \
                patch.object(update_pipeline.derivados, "aplica"), \
                patch.object(update_pipeline.figi, "aplica"), \
                patch.object(update_pipeline.calidad, "aplica"):
            base = Path(tmp)
            result = update_pipeline.ejecuta_pipeline(
                "ES0116419005", "fondo", ["source"], None,
                {"prioridad_fuentes": ["source"]}, True, base, True,
                print_cb=lambda _message: None,
            )
            stored = json.loads((base / "data" / "funds" / "ES0116419005.json").read_text(encoding="utf-8"))

        self.assertTrue(result["ok"])
        self.assertEqual(stored["identificacion"]["tipo"], "fondo")

    def test_pipeline_source_tipo_has_priority_over_csv_tipo(self):
        source_data = {
            "identificacion": {"nombre": "ETF declarado", "tipo": "etf"},
            "valoracion": {"vl": 10.0},
            "rentabilidad": {"fecha_dato": "2026-07-11"},
            "riesgo": {"sri_kid_1a7": 3},
            "cartera": {"num_posiciones": 1},
        }
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(update_pipeline.FUENTES, {
                    "source": lambda *_args, **_kwargs: source_data,
                }, clear=True), \
                patch.object(update_pipeline.limpieza, "aplica"), \
                patch.object(update_pipeline.derivados, "aplica"), \
                patch.object(update_pipeline.figi, "aplica"), \
                patch.object(update_pipeline.calidad, "aplica"):
            base = Path(tmp)
            update_pipeline.ejecuta_pipeline(
                "ES0116419005", "fondo", ["source"], None,
                {"prioridad_fuentes": ["source"]}, True, base, True,
                print_cb=lambda _message: None,
            )
            stored = json.loads((base / "data" / "funds" / "ES0116419005.json").read_text(encoding="utf-8"))

        self.assertEqual(stored["identificacion"]["tipo"], "etf")


if __name__ == "__main__":
    unittest.main()
