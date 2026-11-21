"""
Test de la capa de lectura (repository) con un Firestore falso.
Ejecuta: `python functions_python/tests/test_repository.py`
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from readmodel import repository as R
from tests.test_mappers import FUND, FUND_HOLDINGS, ETF, ETF_METRICS, STOCK, STOCK_METRICS, INDEX


class FakeReader:
    def __init__(self, with_search_index=False):
        self.roots = {FUND["asset_id"]: FUND, ETF["asset_id"]: ETF,
                      STOCK["asset_id"]: STOCK, INDEX["asset_id"]: INDEX}
        self.metrics = {ETF["asset_id"]: ETF_METRICS, STOCK["asset_id"]: STOCK_METRICS}
        self.holdings = {FUND["asset_id"]: FUND_HOLDINGS}
        self.with_search_index = with_search_index
        self.list_calls = 0
        self.asset_calls = 0

    def get_asset(self, aid):
        self.asset_calls += 1
        return self.roots.get(aid)

    def get_metrics_latest(self, aid):
        return self.metrics.get(aid)

    def get_holdings(self, aid):
        return self.holdings.get(aid)

    def list_assets(self, types, limit):
        self.list_calls += 1
        return [r for r in self.roots.values() if r["asset_type"] in types][:limit]

    def get_search_index(self):
        if not self.with_search_index:
            return None
        return {
            "schema_version": "master.search-index.v1",
            "count": len(self.roots),
            "entries": [
                {
                    "id": root["asset_id"],
                    "name": root.get("identity", {}).get("name", root["asset_id"]),
                    "name_folded": R._norm(root.get("identity", {}).get("name", root["asset_id"])),
                    "ticker": root.get("identifiers", {}).get("ticker", ""),
                    "type": root["asset_type"],
                    "currency": root.get("identity", {}).get("currency", ""),
                }
                # Ordenadas por id, como hace build_search_index_document en produccion
                # (la paginacion por cursor depende de ese orden).
                for root in sorted(self.roots.values(), key=lambda r: r["asset_id"])
            ],
        }


ok = 0


def check(c, m):
    global ok
    assert c, "FALLO: " + m
    ok += 1
    print("  ok:", m)


def run():
    global ok
    ok = 0
    r = FakeReader()
    print("== search ==")
    allres = R.search_assets(r, "", None, 20)
    check(len(allres) == 4, "search vacio -> 4 activos")
    check(R.search_assets(r, "dpam")[0]["asset_id"] == "BE0946564383", "search 'dpam' -> el fondo")
    check(len(R.search_assets(r, "", ["FUND"])) == 1, "filtro FUND -> 1")
    idx = [x for x in allres if x["instrument_type"] == "INDEX"][0]
    check(not idx["is_investable"] and idx["role"] == "BENCHMARK", "INDEX en search = benchmark no invertible")
    ri = FakeReader(with_search_index=True)
    check(R.search_assets(ri, "dpam")[0]["asset_id"] == "BE0946564383", "search usa meta/search_index si existe")
    check(ri.list_calls == 0 and ri.asset_calls == 1, "search_index evita scan de roots")

    print("== detail ==")
    fd = R.get_asset_detail(r, "BE0946564383")
    check(fd["holdings_summary"]["has_holdings"] and fd["metrics"]["risk_score"] == 6, "detalle fondo: holdings + metrics root")
    ed = R.get_asset_detail(r, "EODHD_EEM.US")
    check(abs(ed["metrics"]["volatility_3y"] - 0.282942) < 1e-5, "detalle ETF: metrics desde metrics/latest")
    check(R.get_asset_detail(r, "NO_EXISTE") is None, "detalle inexistente -> None")

    print("== compare ==")
    check(len(R.compare_assets(r, ["BE0946564383", "EODHD_EEM.US"])) == 2, "compare 2")

    print("== resolve_portfolio ==")
    res = R.resolve_portfolio(r, [{"asset_id": "BE0946564383", "weight": 0.5}, {"asset_id": "NO", "weight": 0.5}])
    check(len(res["rows"]) == 1 and len(res["warnings"]) == 1, "resolve: 1 fila + 1 warning (missing)")

    print(f"\nREPO OK: {ok} comprobaciones pasaron.")


def test_readmodel_repository_contract_checks():
    run()


# --- Paginacion del buscador sobre el indice (auditoria 27-07, D1+DV5) ---

def test_search_assets_page_pagina_con_indice_y_total_real():
    ri = FakeReader(with_search_index=True)
    ids = sorted(ri.roots)

    page1 = R.search_assets_page(ri, "", None, 2)
    assert ri.list_calls == 0, "la query vacia debe usar el indice, no el scan"
    assert page1["total_matches"] == len(ids)
    assert [x["asset_id"] for x in page1["results"]] == ids[:2]
    assert page1["next_cursor"] == ids[1]

    page2 = R.search_assets_page(ri, "", None, 2, cursor=page1["next_cursor"])
    assert [x["asset_id"] for x in page2["results"]] == ids[2:]
    assert page2["next_cursor"] is None

    # Cursor desconocido (el indice se regenero entre paginas): se recoloca
    # por orden lexicografico en vez de fallar o repetir resultados.
    again = R.search_assets_page(ri, "", None, 10, cursor="AAA")
    assert [x["asset_id"] for x in again["results"]] == ids


def test_search_assets_page_fallback_sin_indice_sin_total():
    r = FakeReader()
    page = R.search_assets_page(r, "", None, 20)
    assert r.list_calls == 1, "sin indice se mantiene el barrido de siempre"
    assert page["total_matches"] is None
    assert page["next_cursor"] is None
    assert len(page["results"]) == 4


def test_search_assets_page_excluye_benchmarks_sinteticos_del_total():
    ri = FakeReader(with_search_index=True)
    excluded_id = sorted(R.EXCLUDED_BENCHMARK_ISINS)[0]
    ri.roots[excluded_id] = {**FUND, "asset_id": excluded_id}

    page = R.search_assets_page(ri, "", None, 50)

    assert page["total_matches"] == 4, "los benchmarks sinteticos no cuentan en el total"
    assert excluded_id not in [x["asset_id"] for x in page["results"]]


def test_compare_assets_uses_batch_reader_and_preserves_requested_order():
    class BatchReader(FakeReader):
        def __init__(self):
            super().__init__()
            self.batch_asset_calls = 0
            self.batch_metrics_calls = 0
            self.batch_holdings_calls = 0

        def get_assets_many(self, asset_ids):
            self.batch_asset_calls += 1
            return {asset_id: self.roots[asset_id] for asset_id in asset_ids if asset_id in self.roots}

        def get_metrics_latest_many(self, asset_ids):
            self.batch_metrics_calls += 1
            return {asset_id: self.metrics[asset_id] for asset_id in asset_ids if asset_id in self.metrics}

        def get_holdings_summaries_many(self, asset_ids):
            self.batch_holdings_calls += 1
            return {asset_id: self.holdings[asset_id] for asset_id in asset_ids if asset_id in self.holdings}

    reader = BatchReader()
    requested = [ETF["asset_id"], FUND["asset_id"], "MISSING", ETF["asset_id"]]

    result = R.compare_assets(reader, requested)

    assert [item["asset_id"] for item in result] == [ETF["asset_id"], FUND["asset_id"]]
    assert reader.batch_asset_calls == 1
    assert reader.batch_metrics_calls == 1
    assert reader.batch_holdings_calls == 1
    assert reader.asset_calls == 0


def test_get_asset_holdings_many_uses_batch_reader_and_covers_all_ids():
    """Ola 3b: la callable batch resuelve n activos con lectores batch (1 llamada)
    y devuelve None para ids inexistentes o sin holdings, sin lecturas sueltas."""
    class BatchReader(FakeReader):
        def __init__(self):
            super().__init__()
            self.batch_asset_calls = 0
            self.batch_holdings_calls = 0
            self.holdings_calls = 0

        def get_assets_many(self, asset_ids):
            self.batch_asset_calls += 1
            return {asset_id: self.roots[asset_id] for asset_id in asset_ids if asset_id in self.roots}

        def get_holdings_many(self, asset_ids):
            self.batch_holdings_calls += 1
            return {asset_id: self.holdings[asset_id] for asset_id in asset_ids if asset_id in self.holdings}

        def get_holdings(self, aid):
            self.holdings_calls += 1
            return super().get_holdings(aid)

    reader = BatchReader()
    requested = [FUND["asset_id"], ETF["asset_id"], "MISSING", FUND["asset_id"]]

    result = R.get_asset_holdings_many(reader, requested)

    assert set(result.keys()) == {FUND["asset_id"], ETF["asset_id"], "MISSING"}
    assert result[FUND["asset_id"]]["asset_id"] == FUND["asset_id"]
    assert result[FUND["asset_id"]]["holdings_count"] == 10, "el doc de holdings llega desenvuelto"
    assert result[ETF["asset_id"]] is None, "activo sin holdings publicados -> None"
    assert result["MISSING"] is None, "activo inexistente -> None"
    assert reader.batch_asset_calls == 1
    assert reader.batch_holdings_calls == 1
    assert reader.asset_calls == 0, "la existencia se resuelve en batch"
    assert reader.holdings_calls == 0, "los holdings se resuelven en batch"


def test_get_asset_holdings_many_degrades_to_single_reads():
    """Sin lector batch de holdings, el resultado es el mismo via lecturas sueltas."""
    reader = FakeReader()
    result = R.get_asset_holdings_many(reader, [FUND["asset_id"], ETF["asset_id"]])
    assert result[FUND["asset_id"]]["asset_id"] == FUND["asset_id"]
    assert result[ETF["asset_id"]] is None


if __name__ == "__main__":
    run()
