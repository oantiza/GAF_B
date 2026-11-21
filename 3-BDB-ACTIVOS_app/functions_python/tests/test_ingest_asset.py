import datetime
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import ingest_asset  # noqa: E402
import fund_ingest  # noqa: E402
import main  # noqa: E402


@pytest.fixture(autouse=True)
def offline_fund_lookup(monkeypatch):
    # These are ingestion unit tests. Fund-specific cases replace this stub;
    # provider resolution has its own tests and an explicit live preview.
    monkeypatch.setattr(fund_ingest, "resolve_fund", lambda _: None)


def test_load_full_history_preloads_major_currency_for_gbx(monkeypatch):
    calls = []
    monkeypatch.setattr(ingest_asset, "fetch_eod", lambda *_args: [
        {"date": "2024-01-02", "adjusted_close": 172.0},
    ])

    def fake_fetch_fx(ccy, _from_date, _to_date):
        calls.append(ccy)
        return ["2024-01-01"], [0.86]

    monkeypatch.setattr(ingest_asset, "_fetch_fx", fake_fetch_fx)

    result = ingest_asset._load_full_history(
        None,
        "GB00BP6MXD84",
        {"symbol": "SHEL.LSE", "currency": "GBX", "type_class": "STOCK"},
        write=False,
    )

    assert calls == ["GBP"]
    assert result["loaded"] is True
    assert result["points"] == 1


def test_resolve_symbol_honors_explicit_preferred_listing(monkeypatch):
    monkeypatch.setattr(ingest_asset, "_eodhd_get", lambda _path: [
        {
            "ISIN": "IE00B6R52259",
            "Code": "SSAC",
            "Exchange": "LSE",
            "Currency": "GBX",
            "Type": "ETF",
            "isPrimary": True,
            "Name": "ACWI GBP",
        },
        {
            "ISIN": "IE00B6R52259",
            "Code": "IUSQ",
            "Exchange": "XETRA",
            "Currency": "EUR",
            "Type": "ETF",
            "isPrimary": False,
            "Name": "ACWI EUR",
        },
    ])

    result = ingest_asset.resolve_symbol("IE00B6R52259", "IUSQ.XETRA")

    assert result["symbol"] == "IUSQ.XETRA"
    assert result["currency"] == "EUR"


def test_resolve_symbol_rejects_unknown_explicit_listing(monkeypatch):
    monkeypatch.setattr(ingest_asset, "_eodhd_get", lambda _path: [{
        "ISIN": "IE00B6R52259",
        "Code": "SSAC",
        "Exchange": "LSE",
        "Currency": "GBX",
        "Type": "ETF",
    }])

    assert ingest_asset.resolve_symbol("IE00B6R52259", "IUSQ.XETRA") is None


def test_resolve_symbol_finds_explicit_delisted_listing(monkeypatch):
    calls = []

    def fake_eodhd(path, **params):
        calls.append((path, params))
        if path.startswith("search/"):
            return []
        assert path == "exchange-symbol-list/MC"
        assert params == {"delisted": 1}
        return [{
            "Code": "SGRE",
            "Exchange": "MC",
            "Currency": "EUR",
            "Type": "Common Stock",
            "Isin": "ES0143416115",
            "Name": "Siemens Gamesa Renewable Energy SA",
        }]

    monkeypatch.setattr(ingest_asset, "_eodhd_get", fake_eodhd)

    result = ingest_asset.resolve_symbol("ES0143416115", "SGRE.MC")

    assert result["symbol"] == "SGRE.MC"
    assert result["type_class"] == "STOCK"
    assert calls == [
        ("search/ES0143416115", {}),
        ("exchange-symbol-list/MC", {"delisted": 1}),
    ]


def test_resolve_symbol_rejects_delisted_listing_with_different_isin(monkeypatch):
    def fake_eodhd(path, **_params):
        if path.startswith("search/"):
            return []
        return [{
            "Code": "SGRE",
            "Exchange": "MC",
            "Currency": "EUR",
            "Type": "Common Stock",
            "Isin": "ES0000000000",
        }]

    monkeypatch.setattr(ingest_asset, "_eodhd_get", fake_eodhd)

    assert ingest_asset.resolve_symbol("ES0143416115", "SGRE.MC") is None


APPLE_ISIN = "US0378331005"
ETF_ISIN = "IE00B53L3W79"


class FakeSnap:
    def __init__(self, exists=False):
        self.exists = exists


class EmptyPriceCollection:
    def limit(self, n):
        return self

    def stream(self):
        return []


class FakeAssetRef:
    def __init__(self, exists=False):
        self._exists = exists
        self.created = []

    def get(self):
        return FakeSnap(self._exists)

    def create(self, doc):
        self.created.append(doc)

    def collection(self, name):
        assert name == "price_series"
        return EmptyPriceCollection()


class FakeAssetsCollection:
    def __init__(self, db):
        self._db = db

    def document(self, asset_id):
        return self._db.refs.setdefault(asset_id, FakeAssetRef())


class FakeDb:
    def __init__(self):
        self.refs = {}

    def collection(self, name):
        if name != "assets":
            raise AssertionError(f"collection inesperada: {name}")
        return FakeAssetsCollection(self)


class FakeWritableDocRef:
    def __init__(self, db, path):
        self.db = db
        self.path = path

    def set(self, doc):
        self.db.written[self.path] = doc


class FakeWritableSubCollection(EmptyPriceCollection):
    def __init__(self, db, asset_id, name):
        self.db = db
        self.asset_id = asset_id
        self.name = name

    def document(self, doc_id):
        return FakeWritableDocRef(self.db, f"assets/{self.asset_id}/{self.name}/{doc_id}")


class FakeWritableAssetRef(FakeAssetRef):
    def __init__(self, db, asset_id, exists=False):
        super().__init__(exists)
        self.db = db
        self.asset_id = asset_id

    def create(self, doc):
        super().create(doc)
        self.db.written[f"assets/{self.asset_id}"] = doc

    def collection(self, name):
        if name not in {"price_series", "metrics", "holdings"}:
            raise AssertionError(f"subcoleccion inesperada: {name}")
        return FakeWritableSubCollection(self.db, self.asset_id, name)


class FakeWritableAssetsCollection:
    def __init__(self, db):
        self._db = db

    def document(self, asset_id):
        return self._db.refs.setdefault(asset_id, FakeWritableAssetRef(self._db, asset_id))


class FakeBatch:
    def __init__(self, db):
        self.db = db
        self.pending = []

    def set(self, ref, doc):
        self.pending.append((ref, doc))

    def create(self, ref, doc):
        self.pending.append((ref, doc))

    def commit(self):
        for ref, doc in self.pending:
            (ref.create if isinstance(ref, FakeAssetRef) else ref.set)(doc)
        self.db.batch_commits += 1
        self.pending = []


class FakeWritableDb(FakeDb):
    def __init__(self):
        super().__init__()
        self.written = {}
        self.batch_commits = 0

    def collection(self, name):
        if name != "assets":
            raise AssertionError(f"collection inesperada: {name}")
        return FakeWritableAssetsCollection(self)

    def batch(self):
        return FakeBatch(self)


class FakeAuth:
    uid = "user-1"
    token = {}


class FakeReq:
    auth = FakeAuth()
    data = {"isin": APPLE_ISIN}


def _stock_match():
    return {
        "symbol": "AAPL.US",
        "ticker": "AAPL",
        "exchange": "US",
        "currency": "EUR",
        "type": "Common Stock",
        "type_class": "STOCK",
        "name": "Apple Inc",
    }


def _etf_match():
    return {
        "symbol": "CS51.LSE",
        "ticker": "CS51",
        "exchange": "LSE",
        "currency": "GBP",
        "type": "ETF",
        "type_class": "ETF",
        "name": "iShares Core MSCI World UCITS ETF",
    }


def _fundamentals():
    return {
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "country": "USA",
        "market_cap": 123,
        "pe_ratio": 30.5,
        "dividend_yield": 0.005,
        "eps": 6.1,
        "beta": 1.2,
        "source": "finnhub",
    }


def _patch_stock_eodhd(monkeypatch):
    monkeypatch.setattr(ingest_asset, "resolve_symbol", lambda _isin: _stock_match())
    monkeypatch.setattr(ingest_asset, "fetch_fundamentals", lambda _isin, _match: _fundamentals())
    monkeypatch.setattr(
        ingest_asset,
        "fetch_eod",
        lambda _symbol, _from_date, _to_date: [
            {"date": "2024-01-02", "adjusted_close": 100},
            {"date": "2024-01-03", "adjusted_close": 101},
        ],
    )


def _patch_etf_eodhd(monkeypatch):
    monkeypatch.setattr(ingest_asset, "resolve_symbol", lambda _isin: _etf_match())
    monkeypatch.setattr(
        ingest_asset,
        "fetch_fundamentals",
        lambda *_args: pytest.fail("ETF no debe pedir fundamentals de accion"),
    )
    # A1 (auditoria 29-09): las ventanas se miden en semanal y exigen 20 retornos
    # semanales; un mes de sesiones ya no publica ventana. Un anio entero (2024).
    fechas = [(datetime.date(2024, 1, 1) + datetime.timedelta(days=i)).isoformat() for i in range(366)]
    monkeypatch.setattr(
        ingest_asset,
        "fetch_eod",
        lambda _symbol, _from_date, _to_date: [
            {"date": fecha, "adjusted_close": 100 + i * 0.1 + (0.5 if i % 2 else -0.5)}
            for i, fecha in enumerate(fechas)
        ],
    )
    monkeypatch.setattr(
        ingest_asset,
        "_fetch_fx",
        lambda _ccy, _from_date, _to_date: (list(fechas), [1.25 for _f in fechas]),
    )


def test_ingest_asset_preview_does_not_write(monkeypatch):
    db = FakeDb()
    _patch_stock_eodhd(monkeypatch)
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)

    result = ingest_asset.ingest_one(APPLE_ISIN, with_history=True, write=False)

    assert result["ok"] is True
    assert result["preview"] is True
    assert result["applied"] is False
    assert result["history"]["loaded"] is True
    assert result["history"]["applied"] is False
    assert db.refs[APPLE_ISIN].created == []


def test_ingest_asset_invalid_isin_returns_ok_false(monkeypatch):
    monkeypatch.setattr(
        ingest_asset,
        "resolve_symbol",
        lambda _isin: pytest.fail("ISIN invalido no debe llamar a EODHD"),
    )
    monkeypatch.setattr(
        ingest_asset,
        "_master_db",
        lambda: pytest.fail("ISIN invalido no debe abrir Firestore"),
    )

    result = ingest_asset.ingest_one("no-es-isin", write=False)

    assert result["ok"] is False
    assert result["asset_id"] == "NO-ES-ISIN"


def test_ingest_asset_non_stock_returns_unsupported_type(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)
    monkeypatch.setattr(
        ingest_asset,
        "resolve_symbol",
        lambda _isin: {
            "symbol": "SPY.US",
            "ticker": "SPY",
            "exchange": "US",
            "currency": "USD",
            "type": "ETF",
            "type_class": "OTHER",
            "name": "SPDR S&P 500 ETF Trust",
        },
    )
    monkeypatch.setattr(
        ingest_asset,
        "fetch_fundamentals",
        lambda *_args: pytest.fail("tipo no soportado no debe pedir fundamentals"),
    )

    result = ingest_asset.ingest_one(APPLE_ISIN, write=False)

    assert result["ok"] is False
    assert result["resolved"] is True
    assert result["unsupported_type"] == "ETF"


def test_ingest_asset_routes_eufund_to_morningstar_pipeline(monkeypatch):
    db = FakeDb()
    price_match = {
        "symbol": "LU1084165304.EUFUND",
        "ticker": "LU1084165304",
        "exchange": "EUFUND",
        "currency": "USD",
        "type": "FUND",
        "type_class": "OTHER",
        "name": "Fidelity World A-ACC-USD",
    }
    fund_match = {"sec_id": "F00000TVF3", "row": {}, "name": "Fidelity World"}
    captured = {}
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)
    monkeypatch.setattr(ingest_asset, "resolve_symbol", lambda _isin: price_match)
    monkeypatch.setattr(ingest_asset.fund_ingest, "resolve_fund", lambda _isin: fund_match)

    def fake_ingest(isin, match, actual_db, **kwargs):
        captured.update(isin=isin, match=match, db=actual_db, **kwargs)
        return {"asset_id": isin, "ok": True, "asset_type": "FUND"}

    monkeypatch.setattr(ingest_asset.fund_ingest, "ingest_fund", fake_ingest)

    result = ingest_asset.ingest_one("LU1084165304", with_history=True, write=False)

    assert result["ok"] is True
    assert result["asset_type"] == "FUND"
    assert captured["match"] == fund_match
    assert captured["price_match"] == price_match
    assert captured["with_history"] is True
    assert captured["write"] is False


def _fund_match_and_blocks():
    match = {
        "sec_id": "F00000TVF3",
        "row": {"CategoryName": "Global Large-Cap Blend Equity"},
        "name": "Fidelity Funds - World Fund A-Acc-USD",
    }
    blocks = {
        "quote": {
            "secId": "F00000TVF3",
            "investmentName": "Fidelity Funds - World Fund A-Acc-USD",
            "baseCurrencyId": "EUR",
            "categoryName": "Global Large-Cap Blend Equity",
            "assetType": "EQUITY",
            "morningstarRating": "4",
            "srri": "4",
            "inc_Acc": "Acc",
        },
        "screener": match["row"],
        "fees": {"actualInvestmentFees": {"ongoingCost": 1.88, "managementFee": 1.5}},
        "allocation": {
            "portfolioDate": "2026-06-30T00:00:00",
            "allocationMap": {
                "AssetAllocUSEquity": {"netAllocation": "60"},
                "AssetAllocNonUSEquity": {"netAllocation": "35"},
                "AssetAllocBond": {"netAllocation": "1"},
                "AssetAllocCash": {"netAllocation": "4"},
            },
        },
        "holdings": {
            "holdingSummary": {
                "portfolioDate": "2026-06-30T00:00:00",
                "numberOfHolding": 1,
                "topHoldingWeighting": 5.2,
            },
            "equityHoldingPage": {
                "holdingList": [{"securityName": "Alphabet", "weighting": 5.2, "isin": "US02079K3059"}]
            },
        },
    }
    return match, blocks


def test_fund_preview_builds_accepted_root_and_daily_nav(monkeypatch):
    match, blocks = _fund_match_and_blocks()
    monkeypatch.setattr(fund_ingest, "fetch_fund_payload", lambda _match: (blocks, []))
    monkeypatch.setattr(
        fund_ingest,
        "fetch_eod",
        lambda *_args: [
            {"date": f"2024-{month:02d}-{day:02d}", "adjusted_close": 100 + month + day / 100}
            for month in range(1, 13)
            for day in (1, 10, 20)
        ],
    )
    db = FakeDb()

    result = fund_ingest.ingest_fund(
        "LU1084165304",
        match,
        db,
        with_history=True,
        write=False,
        price_match={"symbol": "LU1084165304.EUFUND", "currency": "EUR"},
    )

    assert result["ok"] is True
    assert result["provider"] == "MORNINGSTAR + EODHD"
    assert result["root_preview"]["asset_type"] == "FUND"
    assert result["root_preview"]["quality"]["status"] == "ACCEPTED"
    assert result["history"]["loaded"] is True
    assert result["history"]["interval"] == "1d"
    assert result["history"]["points"] == 36
    assert db.refs["LU1084165304"].created == []


@pytest.mark.parametrize("detail_date,expected", [
    ("2026-05-31T00:00:00", "2026-05-31"),
    ("invalid", None), ("", None), (None, "2026-08-31"),
])
def test_holdings_use_detail_date_even_when_summary_is_newer(detail_date, expected):
    _, summary = fund_ingest._holdings({
        "portfolioLastestDateFooter": detail_date,
        "holdingSummary": {"portfolioDate": "2026-08-31"},
    })
    assert summary["as_of_date"] == expected


def test_different_summary_date_cannot_supply_row_count_or_top10_weight():
    _, summary = fund_ingest._holdings({
        "portfolioLastestDateFooter": "2026-05-31",
        "holdingSummary": {"portfolioDate": "2026-08-31", "numberOfHolding": 99, "topHoldingWeighting": 80},
        "equityHoldingPage": {"holdingList": [{"securityName": "A", "weighting": 5}]},
    })
    assert summary == {"as_of_date": "2026-05-31", "positions_count": 1, "top10_weight": 5}


def test_bond_holdings_accept_current_provider_spelling_and_preserve_terms():
    page = {"holdingList": [{"securityName": "Treasury", "weighting": 7.2,
        "isin": "IE00BKFVC568", "maturityDate": "2027-05-15T05:00:00",
        "coupon": 0.2, "holdingTypeId": "BT", "currency": "EUR"}]}
    holdings, _ = fund_ingest._holdings({"boldHoldingPage": page})
    assert len(holdings) == 1
    assert holdings[0]["holding_type"] == "Bond"
    assert holdings[0]["maturity"] == "2027-05-15"
    assert holdings[0]["coupon"] == 0.2
    assert holdings[0]["weight_pct"] == 7.2
    both, _ = fund_ingest._holdings({"boldHoldingPage": page, "bondHoldingPage": page})
    assert both == holdings


def test_empty_bond_alias_does_not_hide_current_page_or_short_positions():
    holdings, _ = fund_ingest._holdings({"bondHoldingPage": {"holdingList": []},
        "boldHoldingPage": {"holdingList": [{"securityName": "Short bond", "weighting": -3.2}]}})
    assert len(holdings) == 1
    assert holdings[0]["weight_pct"] == -3.2


def test_ingest_asset_etf_preview_builds_root_history_and_metrics(monkeypatch):
    db = FakeDb()
    _patch_etf_eodhd(monkeypatch)
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)

    result = ingest_asset.ingest_one(ETF_ISIN, with_history=True, write=False)

    assert result["ok"] is True
    assert result["asset_type"] == "ETF"
    assert result["symbol"] == "CS51.LSE"
    root = result["root_preview"]
    assert root["asset_type"] == "ETF"
    assert root["identifiers"]["isin"] == ETF_ISIN
    assert root["identifiers"]["eodhd_code"] == "CS51.LSE"
    assert root["holdings_summary"]["has_holdings"] is False
    assert root["source_metadata"]["source"] == "EODHD"
    assert result["history"]["loaded"] is True
    assert result["history"]["metrics"]["available"] is True
    assert "3y" in result["history"]["metrics"]["windows"]


def test_ingest_asset_etf_write_creates_root_price_series_and_metrics(monkeypatch):
    db = FakeWritableDb()
    _patch_etf_eodhd(monkeypatch)
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)
    monkeypatch.setattr(ingest_asset, "require_master_writes_enabled", lambda _operation: None)

    result = ingest_asset.ingest_one(ETF_ISIN, with_history=True, write=True)

    assert result["ok"] is True
    assert result["applied"] is True
    assert result["root_written"] is True
    assert db.written[f"assets/{ETF_ISIN}"]["asset_type"] == "ETF"
    price_paths = [path for path in db.written if "/price_series/" in path]
    assert price_paths == [f"assets/{ETF_ISIN}/price_series/EODHD_CS51_LSE_2024"]
    metrics = db.written[f"assets/{ETF_ISIN}/metrics/latest"]
    assert metrics["asset_id"] == ETF_ISIN
    assert metrics["population"] == "stock"
    assert "3y" in metrics["windows"]
    assert result["metrics"]["applied"] is True


def test_ingest_asset_root_preview_uses_stock_contract_and_eodhd_source(monkeypatch):
    db = FakeDb()
    _patch_stock_eodhd(monkeypatch)
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)

    result = ingest_asset.ingest_one(APPLE_ISIN, write=False)

    root = result["root_preview"]
    assert root["asset_type"] == "STOCK"
    assert root["source_metadata"]["source"] == "EODHD"
    assert root["identifiers"]["eodhd_code"] == "AAPL.US"
    assert root["listings"][0]["source_listing_id"] == "EODHD:AAPL.US"
    assert root["quality"]["status"] == "PROVISIONAL_ADMIN"


def test_ingest_asset_omits_null_keys_from_payloads():
    cleaned = ingest_asset._omit_nulls({
        "keep": "x",
        "drop": None,
        "nested": {"drop": None, "keep": 1},
        "items": [{"drop": None, "keep": True}],
    })

    assert cleaned == {
        "keep": "x",
        "nested": {"keep": 1},
        "items": [{"keep": True}],
    }


def test_admin_ingest_asset_requires_admin(monkeypatch):
    called = False

    def fail_ingest(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("sin admin no debe invocar ingest_one")

    monkeypatch.setattr(main.ingest_asset, "ingest_one", fail_ingest)

    with pytest.raises(main.https_fn.HttpsError) as exc:
        main.admin_ingest_asset.__wrapped__.__wrapped__(FakeReq())

    assert exc.value.code == "permission-denied"
    assert called is False


# ---------------------------------------------------------------------------
# Ola 1 (1.2): la rentabilidad de las ventanas se anualiza en geometrico y el
# Sharpe descuenta la tasa libre de riesgo. Antes: `avg * 252` y `ret / vol`
# con "risk_free_rate": 0 escrito en el documento (auditoria 03-09).
# ---------------------------------------------------------------------------

def _serie(dias: int, factor_diario: float, inicio: float = 100.0, ruido: float = 0.0):
    """Serie diaria creciendo a factor constante, con vaiven opcional.

    El ruido no toca ni el primer ni el ultimo punto, asi que el recorrido
    total -y por tanto el CAGR- no depende de el: solo la varianza.
    """
    base = datetime.date(2022, 1, 3)
    puntos = []
    for i in range(dias):
        valor = inicio * (factor_diario ** i)
        if ruido and 0 < i < dias - 1:
            valor *= 1.0 + (ruido if i % 2 else -ruido)
        puntos.append({"date": base + datetime.timedelta(days=i), "value": valor})
    return puntos


def test_la_rentabilidad_de_ventana_se_anualiza_en_geometrico():
    # Se duplica en dos anios naturales: el CAGR es sqrt(2)-1, no la media
    # aritmetica de los rendimientos diarios por 252.
    dias = 731  # 2022-01-03 .. 2024-01-02, dos anios
    factor = 2.0 ** (1.0 / (dias - 1))
    puntos = _serie(dias, factor)

    metrics = ingest_asset._window_metrics(puntos)

    span_anios = (puntos[-1]["date"] - puntos[0]["date"]).days / 365.2425  # decision 6.3
    esperado = 2.0 ** (1.0 / span_anios) - 1.0
    assert metrics["annualized_return"] == pytest.approx(esperado, rel=1e-6)
    assert metrics["annualized_return"] == pytest.approx(0.4142, abs=0.002)


def test_el_sharpe_descuenta_la_tasa_libre_de_riesgo():
    puntos = _serie(731, 2.0 ** (1.0 / 730), ruido=0.004)

    sin_tasa = ingest_asset._window_metrics(puntos, 0.0)
    con_tasa = ingest_asset._window_metrics(puntos, 0.02)

    assert con_tasa["risk_free_rate"] == 0.02
    assert con_tasa["sharpe_ratio"] < sin_tasa["sharpe_ratio"]
    esperado = (con_tasa["annualized_return"] - 0.02) / con_tasa["annualized_volatility"]
    assert con_tasa["sharpe_ratio"] == pytest.approx(esperado, rel=1e-6)


def test_una_ventana_corta_no_anualiza_pero_si_publica_volatilidad():
    # A1 (auditoria 29-09): el minimo son 20 retornos SEMANALES (unos cinco
    # meses); elevar ese tramo a un anio daria una cifra absurda. Se publica la
    # volatilidad y nada mas.
    puntos = _serie(160, 1.004)

    metrics = ingest_asset._window_metrics(puntos)

    assert metrics["annualized_volatility"] is not None
    assert "annualized_return" not in metrics
    assert "sharpe_ratio" not in metrics
    assert "risk_free_rate" not in metrics


def test_un_mes_de_sesiones_ya_no_publica_ventana():
    # Antes bastaban 20 sesiones diarias (cuatro semanas). En semanal son
    # cuatro retornos: nada que publicar.
    assert ingest_asset._window_metrics(_serie(25, 1.004)) is None


def test_la_tasa_de_la_ventana_sale_del_estr_y_cae_a_cero_si_no_es_creible():
    puntos = _serie(400, 1.0005)

    assert ingest_asset._window_risk_free(puntos, None) == 0.0
    assert ingest_asset._window_risk_free(puntos, lambda _a, _b: {"rate": 0.0231}) == 0.0231
    # Fuera de rango o resolutor roto: 0, nunca una tasa inventada.
    assert ingest_asset._window_risk_free(puntos, lambda _a, _b: {"rate": 9.9}) == 0.0
    assert ingest_asset._window_risk_free(puntos, lambda _a, _b: (_ for _ in ()).throw(RuntimeError())) == 0.0


def test_build_metrics_latest_pasa_la_tasa_por_ventana_y_cumple_contrato():
    puntos = [{"date": p["date"].isoformat(), "value": p["value"]} for p in _serie(800, 1.0004)]
    ventanas_pedidas = []

    def resolutor(desde, hasta):
        ventanas_pedidas.append((desde, hasta))
        return {"rate": 0.025}

    doc = ingest_asset.build_metrics_latest(
        "US0378331005", "STOCK", puntos, "2024-01-01T00:00:00Z", risk_free_resolver=resolutor
    )

    assert doc["windows"]["1y"]["risk_free_rate"] == 0.025
    # Una consulta por ventana, con las fechas reales de esa ventana.
    assert len(ventanas_pedidas) == len(ingest_asset.METRIC_WINDOWS)
    ingest_asset.validate_contract(doc, "metrics.v1.2.schema.json")


# ---------------------------------------------------------------------------
# Ola 1 (1.2): la ruta de fondos tenia el mismo Sharpe sin descontar que la de
# acciones, y ademas un suelo de 1/12 de anio que permitia anualizar quincenas.
# ---------------------------------------------------------------------------

def _nav_mensual(meses: int, factor_mensual: float, inicio: float = 100.0, ruido: float = 0.0):
    puntos = []
    for i in range(meses):
        anio = 2020 + (i // 12)
        mes = (i % 12) + 1
        valor = inicio * (factor_mensual ** i)
        if ruido and 0 < i < meses - 1:
            valor *= 1.0 + (ruido if i % 2 else -ruido)
        puntos.append({"date": f"{anio}-{mes:02d}-01", "value": valor})
    return puntos


def test_el_sharpe_de_fondos_descuenta_la_tasa():
    puntos = _nav_mensual(37, 1.006, ruido=0.02)  # tres anios de NAV mensual

    sin_tasa = fund_ingest._window_metrics(puntos, 0.0)
    con_tasa = fund_ingest._window_metrics(puntos, 0.02)

    assert con_tasa["risk_free_rate"] == 0.02
    esperado = (con_tasa["annualized_return"] - 0.02) / con_tasa["annualized_volatility"]
    assert con_tasa["sharpe_ratio"] == pytest.approx(esperado, rel=1e-6)
    assert con_tasa["sharpe_ratio"] < sin_tasa["sharpe_ratio"]


def test_una_ventana_de_fondo_de_medio_anio_no_se_anualiza():
    # Siete NAV mensuales: pasa el minimo de 6 rendimientos pero cubre medio
    # anio. El suelo anterior de 1/12 lo elevaba como si fuera un mes.
    puntos = _nav_mensual(7, 1.03, ruido=0.01)

    metrics = fund_ingest._window_metrics(puntos)

    assert metrics["annualized_volatility"] is not None
    assert "annualized_return" not in metrics
    assert "sharpe_ratio" not in metrics


def test_la_rentabilidad_de_fondo_sigue_siendo_geometrica():
    puntos = _nav_mensual(25, 1.01)  # dos anios al 1% mensual
    metrics = fund_ingest._window_metrics(puntos)

    dias = (datetime.date(2022, 1, 1) - datetime.date(2020, 1, 1)).days
    esperado = (1.01 ** 24) ** (365.2425 / dias) - 1  # decision 6.3: base 365,2425
    assert metrics["annualized_return"] == pytest.approx(esperado, rel=1e-6)


# ---------------------------------------------------------------------------
# Ola 1 (1.3): metrics.v1.2 declara method y frequency por ventana.
# ---------------------------------------------------------------------------

def test_las_ventanas_de_accion_declaran_metodo_y_frecuencia():
    # A1 (auditoria 29-09): la maestra mide en semanal, como el optimizador.
    puntos = _serie(800, 1.0004, ruido=0.006)
    metrics = ingest_asset._window_metrics(puntos, 0.02)

    assert metrics["method"] == "GEOMETRIC_CAGR"
    assert metrics["frequency"] == "WEEKLY"


def test_una_ventana_corta_declara_frecuencia_pero_no_metodo():
    # Sin rentabilidad anualizada no hay metodo que declarar; la volatilidad
    # si se publica, y su frecuencia tambien.
    metrics = ingest_asset._window_metrics(_serie(160, 1.004, ruido=0.003))

    assert metrics["frequency"] == "WEEKLY"
    assert "method" not in metrics


def test_las_ventanas_de_fondo_declaran_la_frecuencia_del_nav():
    mensual = fund_ingest._window_metrics(_nav_mensual(37, 1.006, ruido=0.02))
    assert mensual["frequency"] == "MONTHLY"
    assert mensual["method"] == "GEOMETRIC_CAGR"

    # A1: un VL diario se mide en semanal, no DAILY/252.
    diario = fund_ingest._window_metrics([
        {"date": (datetime.date(2022, 1, 3) + datetime.timedelta(days=i)).isoformat(),
         "value": 100 * (1.0004 ** i) * (1 + (0.005 if i % 2 else -0.005))}
        for i in range(500)
    ])
    assert diario["frequency"] == "WEEKLY"


# ---------------------------------------------------------------------------
# R-04 (auditoria 29-09): el alta de un fondo con politica de historico
# (fund_history_policies.json) calculaba metrics/latest sobre TODOS los puntos
# y lo etiquetaba FONDOSDB_FUND_NAV_EUR; el mapper lo rechazaba y el fondo
# perdia sus metricas. Ahora aplica la politica y firma como revision.
# ---------------------------------------------------------------------------

def _nav_diario(inicio: datetime.date, dias: int, valor_inicial: float, factor: float, ruido: float = 0.004):
    puntos = []
    for i in range(dias):
        d = inicio + datetime.timedelta(days=i)
        if d.weekday() >= 5:
            continue
        valor = valor_inicial * (factor ** i) * (1 + (ruido if i % 2 else -ruido))
        puntos.append({"date": d.isoformat(), "value": round(valor, 6)})
    return puntos


def test_el_alta_de_un_fondo_con_politica_aplica_la_politica_y_el_mapper_acepta_las_metricas():
    from fund_history_quality import policy_for, METRICS_SOURCE as REVIEW_SOURCE
    from readmodel.mappers import map_quant_metrics
    isin = "ES0114904008"  # usable_from 2019-12-20
    usable_from = policy_for(isin)["usable_from"]
    # Tramo pre-clase absurdo (VL 10x) seguido del tramo utilizable.
    antes = _nav_diario(datetime.date(2016, 1, 4), 700, 1000.0, 1.0002)
    despues = _nav_diario(datetime.date.fromisoformat(usable_from), 2400, 100.0, 1.0002)
    puntos = antes + despues

    doc = fund_ingest._metrics_doc(isin, puntos, {}, "2026-09-29T00:00:00Z")

    assert doc["source"] == REVIEW_SOURCE
    assert doc["first_date"] >= usable_from
    assert doc["observations_count"] == len(despues)
    # Sin el tramo pre-clase el drawdown historico no puede ser el -90% del salto.
    assert doc["max_drawdown_hist"]["value"] > -0.5
    mapped = map_quant_metrics({"asset_id": isin, "asset_type": "FUND"}, doc)
    assert mapped["metrics_source"] == REVIEW_SOURCE
    assert "annualized_return_3y" in mapped


def test_el_alta_de_un_fondo_sin_politica_no_cambia_de_firma():
    puntos = _nav_diario(datetime.date(2020, 1, 6), 900, 100.0, 1.0003)
    doc = fund_ingest._metrics_doc("LU9999999999", puntos, {}, "2026-09-29T00:00:00Z")
    assert doc["source"] == fund_ingest.METRICS_SOURCE
    assert doc["observations_count"] == len(puntos)


def test_el_alta_de_un_fondo_bloqueado_publica_metricas_vacias_y_no_falla():
    from fund_history_quality import policy_for
    isin = "IE00BYYPF581"
    assert policy_for(isin)["blocked"]
    puntos = _nav_diario(datetime.date(2020, 1, 6), 900, 100.0, 1.0003)
    doc = fund_ingest._metrics_doc(isin, puntos, {}, "2026-09-29T00:00:00Z")
    assert doc["windows"] == {}
    assert doc["observations_count"] == 0
    assert "max_drawdown_hist" not in doc
    fund_ingest.validate_contract(doc, "metrics.v1.2.schema.json")


# ---------------------------------------------------------------------------
# B-06 (auditoria 29-09): un VL semanal (hueco mediano 7) se anualizaba con
# 252 y se etiquetaba DAILY: volatilidad x2,2. A1: <=10 dias de hueco se mide
# en SEMANAL (52, remuestreando a la ultima observacion de cada semana ISO),
# 11-45 mensual (12), mayor: no se anualiza la volatilidad.
# ---------------------------------------------------------------------------

def _nav_cada(dias_entre: int, n: int, ruido: float = 0.01):
    base = datetime.date(2022, 1, 7)
    return [{"date": (base + datetime.timedelta(days=i * dias_entre)).isoformat(),
             "value": 100 * (1.001 ** i) * (1 + (ruido if i % 2 else -ruido))}
            for i in range(n)]


def test_un_vl_semanal_se_anualiza_con_52_y_se_etiqueta_weekly():
    semanal = fund_ingest._window_metrics(_nav_cada(7, 160))
    assert semanal["frequency"] == "WEEKLY"
    rendimientos = fund_ingest._returns(_nav_cada(7, 160))
    media = sum(rendimientos) / len(rendimientos)
    desv = (sum((r - media) ** 2 for r in rendimientos) / (len(rendimientos) - 1)) ** 0.5
    assert semanal["annualized_volatility"] == pytest.approx(desv * 52 ** 0.5, rel=1e-6)


@pytest.mark.parametrize("dias_entre,esperada", [(1, "WEEKLY"), (3, "WEEKLY"), (5, "WEEKLY"),
                                                 (10, "WEEKLY"), (14, "MONTHLY"), (30, "MONTHLY"), (45, "MONTHLY")])
def test_la_frecuencia_declarada_sigue_el_hueco_mediano(dias_entre, esperada):
    metrics = fund_ingest._window_metrics(_nav_cada(dias_entre, 400))
    assert metrics["frequency"] == esperada
    fund_ingest.validate_contract({"asset_id": "X", "population": "fund", "source": "T", "updated_at": "t",
                                   "windows": {"1y": metrics}, "risk_score_source": "VOL_BUCKET"},
                                  "metrics.v1.2.schema.json")


def test_un_vl_trimestral_no_anualiza_la_volatilidad_pero_conserva_la_rentabilidad():
    trimestral = fund_ingest._window_metrics(_nav_cada(91, 16))
    assert "annualized_volatility" not in trimestral
    assert "frequency" not in trimestral
    assert "sharpe_ratio" not in trimestral
    assert trimestral["method"] == "GEOMETRIC_CAGR"
    assert "annualized_return" in trimestral


# --- Activos ya existentes (13-10-2026) -------------------------------------------

def test_un_fondo_existente_no_se_reingesta_ni_toca_cartera_serie_metricas_ni_indice(monkeypatch):
    """Con el fondo ya en la maestra, ingest_fund hacia `set` sobre holdings/latest
    (la cartera Morningstar encima de la del extractor), price_series y
    metrics/latest, y reescribia su entrada del indice. Ahora se niega antes de
    pedir nada al proveedor, en preview y en escritura."""
    db = FakeWritableDb()
    db.refs["ES0182769002"] = FakeWritableAssetRef(db, "ES0182769002", exists=True)
    monkeypatch.setattr(fund_ingest, "fetch_fund_payload",
                        lambda _match: pytest.fail("no debe pedir la ficha de un fondo existente"))
    monkeypatch.setattr(fund_ingest, "upsert_search_index_entry",
                        lambda *_a: pytest.fail("no debe tocar el indice de un fondo existente"))
    match = {"sec_id": "F00000XXXX", "row": {}, "name": "VALENTUM, FI"}

    for write in (False, True):
        result = fund_ingest.ingest_fund("ES0182769002", match, db, with_history=True, write=write,
                                         price_match={"symbol": "ES0182769002.EUFUND"})
        assert result["ok"] is False
        assert result["error_code"] == "FUND_EXISTS"
        assert result["applied"] is False and result["preview"] is (not write)
        assert result["root_action"] == "SKIP_EXISTS"
    assert db.written == {} and db.batch_commits == 0


def test_un_activo_existente_no_reescribe_su_entrada_del_indice(monkeypatch):
    db = FakeWritableDb()
    db.refs[APPLE_ISIN] = FakeWritableAssetRef(db, APPLE_ISIN, exists=True)
    _patch_stock_eodhd(monkeypatch)
    monkeypatch.setattr(ingest_asset, "_master_db", lambda: db)
    monkeypatch.setattr(ingest_asset, "require_master_writes_enabled", lambda _operation: None)
    monkeypatch.setattr(ingest_asset, "upsert_search_index_entry",
                        lambda *_a: pytest.fail("la raiz no se escribe: el indice tampoco"))

    result = ingest_asset.ingest_one(APPLE_ISIN, with_history=False, write=True)

    assert result["root_written"] is False
    assert result["search_index_updated"] is False
    assert "search_index_warning" not in result
    assert db.written == {}


def test_un_fondo_nuevo_se_da_de_alta_con_cartera_serie_metricas_e_indice(monkeypatch):
    match, blocks = _fund_match_and_blocks()
    monkeypatch.setattr(fund_ingest, "fetch_fund_payload", lambda _match: (blocks, []))
    fechas = [datetime.date(2024, 1, 1) + datetime.timedelta(days=i) for i in range(400)]
    monkeypatch.setattr(fund_ingest, "fetch_eod", lambda *_a: [
        {"date": f.isoformat(), "adjusted_close": 100 + i * 0.05 + (0.4 if i % 2 else -0.4)}
        for i, f in enumerate(fechas) if f.weekday() < 5])
    monkeypatch.setattr(fund_ingest, "_estr_window_resolver", lambda *_a: {"rate": 0.02})
    indexed = []
    monkeypatch.setattr(fund_ingest, "upsert_search_index_entry",
                        lambda _db, isin, root: indexed.append(isin) or True)
    db = FakeWritableDb()

    result = fund_ingest.ingest_fund("LU1084165304", match, db, with_history=True, write=True,
                                     price_match={"symbol": "LU1084165304.EUFUND", "currency": "EUR"})

    assert result["ok"] is True and result["root_written"] is True
    assert db.written["assets/LU1084165304"]["asset_type"] == "FUND"
    assert db.written["assets/LU1084165304/holdings/latest"]["holdings_count"] == 1
    assert any("/price_series/" in path for path in db.written)
    assert db.written["assets/LU1084165304/metrics/latest"]["population"] == "fund"
    assert indexed == ["LU1084165304"]


def test_la_estr_parcial_de_la_maestra_se_anota_fuera_del_documento():
    """Quinta pasada, I-2: build_metrics_latest y fund_ingest._metrics_doc conservan la
    media parcial (como la simulacion) y la anotan en la lista del llamador; el documento
    sigue validando metrics.v1.3."""
    import fund_ingest
    from datetime import date, timedelta

    start = date(2014, 1, 1)
    puntos = []
    for i in range(0, 365 * 12):
        dia = start + timedelta(days=i)
        if dia.weekday() < 5:
            puntos.append({"date": dia.isoformat(), "value": round(100 + i * 0.01 + (0.5 if i % 3 else -0.5), 4)})

    def resolver(first, last):
        # La €STR empieza el 01-10-2019: la ventana de 10 años solo la cubre en parte.
        cobertura = 1.0 if first >= "2019-10-01" else 0.66
        return {"rate": 0.012 if cobertura < 1 else 0.02, "coverage_ratio": cobertura}

    avisos = []
    doc = ingest_asset.build_metrics_latest("ES0000000099", "FUND", puntos, "2026-10-17T00:00:00Z",
                                            risk_free_resolver=resolver, risk_free_warnings=avisos)
    assert [aviso["window"] for aviso in avisos] == ["10y"]
    assert avisos[0]["warning"] == "RISK_FREE_RATE_PARTIAL_COVERAGE" and avisos[0]["coverage_ratio"] == 0.66
    assert doc["windows"]["10y"]["risk_free_rate"] == 0.012
    assert doc["windows"]["1y"]["risk_free_rate"] == 0.02
    assert "warnings" not in doc and "risk_free_warnings" not in doc["windows"]["10y"]

    avisos_fondo = []
    fondo = fund_ingest._metrics_doc("ES0000000099", puntos, {}, "2026-10-17T00:00:00Z",
                                     risk_free_resolver=resolver, risk_free_warnings=avisos_fondo)
    assert [aviso["window"] for aviso in avisos_fondo] == ["10y"]
    assert fondo["windows"]["10y"]["risk_free_rate"] == 0.012
    # Sin lista, nada cambia para los llamadores de siempre.
    assert ingest_asset.build_metrics_latest("ES0000000099", "FUND", puntos, "2026-10-17T00:00:00Z",
                                             risk_free_resolver=resolver)["windows"] == doc["windows"]

