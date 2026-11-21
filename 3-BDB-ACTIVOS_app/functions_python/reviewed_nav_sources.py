"""Public NAV source adapters: exact identity, native overlap, explicit daily FX."""
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from html import unescape
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlencode
import xml.etree.ElementTree as ET
from io import BytesIO

from capitalgroup_nav import fetch, point_map, tables

REGISTRY = json.loads(Path(__file__).with_name("reviewed_nav_sources.json").read_text(encoding="utf-8"))


def validate_native_append(asset_id, series, points, quote, as_of, config):
    currency = config["currency"]
    if (series.get("asset_id") != asset_id or series.get("series_type") != "NAV"
            or series.get("currency") != "EUR" or series.get("source_currency") != currency
            or series.get("source_listing_id") not in (config["source_listing_id"], config.get("accepted_previous_listing"))):
        raise ValueError("Stored NAV identity, currency or reviewed source mismatch")
    first_incoming = min(p["date"] for p in points)
    native = [{"date": p["date"], "value": p["value"] if currency == "EUR" else p["source_value"]}
              for p in series["points"] if p["date"] >= first_incoming]
    old, incoming = point_map(native, as_of), point_map(points, as_of)
    last = max(old)
    if last != series["last_date"]:
        raise ValueError("Stored last_date differs from observations")
    overlap = sorted(old.keys() & incoming.keys())
    if len(overlap) < 5 or last not in overlap:
        raise ValueError("At least five native overlaps including last_date are required")
    error = max(abs(incoming[d]/old[d]-1)*100 for d in overlap)
    absolute_error = max(abs(incoming[d]-old[d]) for d in overlap)
    rounding_bound = config.get("legacy_rounding_bound", 0)
    if error > .01 and absolute_error > rounding_bound + 1e-12:
        raise ValueError(f"Native NAV overlap differs by {error:.6f}%")
    point_map([quote], as_of)
    if max(incoming) != quote["date"] or abs(incoming[quote["date"]]/quote["value"]-1) > .0001:
        raise ValueError("Latest quote and historical NAV disagree")
    if (as_of-date.fromisoformat(quote["date"])).days > 7:
        raise ValueError("Provider NAV is stale")
    dates = sorted(d for d in incoming if d > last)
    previous = last
    for day in dates:
        gap = (date.fromisoformat(day)-date.fromisoformat(previous)).days
        if gap > 7:
            closed = set(config.get("verified_non_dealing_days", []))
            missing = [date.fromisoformat(previous)+timedelta(days=n) for n in range(1,gap)]
            if any(d.weekday()<5 and d.isoformat() not in closed for d in missing):
                raise ValueError("Gap exceeds seven days without a verified non-dealing calendar")
        if abs(incoming[day]/incoming[previous]-1) > .15:
            raise ValueError("Daily NAV movement requires manual review")
        previous = day
    return {"asset_id": asset_id, "status": "CANDIDATE_VALIDATED" if dates else "UP_TO_DATE",
            "currency": "EUR", "source_currency": currency, "existing_last_date": last,
            "proposed_last_date": max(incoming), "quote": quote, "overlap_checks": len(overlap),
            "max_overlap_error_pct": error, "source_listing_id": config["source_listing_id"],
            "provider": config["provider"], "existing_points_preserved": True, "read_only": True,
            "append_only_points": [{"date": d, "value": incoming[d]} for d in dates]}


def parse_ft(html, asset_id, currency, listing):
    configs = [json.loads(unescape(raw)) for raw in re.findall(r'data-mod-config="([^"]+)"', html)]
    identities = [c for c in configs if c.get("symbol") == f"{asset_id}:{currency}" and c.get("currency") == currency]
    if len(identities) != 1:
        raise ValueError("FT share class / currency not confirmed")
    expected = listing.split(":",1)[1]
    if expected != asset_id and str(identities[0].get("xid")) != expected:
        raise ValueError("FT instrument identifier changed")
    found = [t for t in tables(html) if t["rows"] and t["rows"][0][:5] == ["Date","Open","High","Low","Close"]]
    if len(found) != 1:
        raise ValueError("FT historical NAV table missing or changed")
    points = []
    for row in found[0]["rows"][1:]:
        day = re.match(r"^[A-Za-z]+, [A-Za-z]+ \d{1,2}, \d{4}",row[0])
        if day is None or len(row) != 6:
            raise ValueError("Malformed FT historical row")
        # NAV fund rows have identical OHLC: refuse accidental equity routing.
        if len(set(row[1:5])) != 1:
            raise ValueError("FT row is not a fund NAV")
        points.append({"date": datetime.strptime(day[0],"%A, %B %d, %Y").date().isoformat(),
                       "value": float(row[4].replace(",",""))})
    if not points:
        raise ValueError("FT has no NAVs")
    quote = max(points,key=lambda p:p["date"])
    # Independently check the quote header against the first historical date.
    m = re.search(r'Price \('+re.escape(currency)+r'\)</span><span class="mod-ui-data-list__value">([\d,.]+)</span>',html)
    if m is None or abs(float(m[1].replace(",",""))/quote["value"]-1) > .0001:
        raise ValueError("FT quote header differs from historical NAV")
    return points, quote


ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"


def convert_ecb(points, currency, raw):
    rates = {}
    for node in ET.fromstring(raw).iter():
        day = node.attrib.get("time")
        if day:
            for item in node:
                if item.attrib.get("currency") == currency:
                    rates[day] = float(item.attrib["rate"])
    return convert_rates(points, currency, rates, "EXR.D."+currency+".EUR.SP00.A")


def convert_rates(points, currency, rates, pair):
    point_map([{"date": d,"value":v} for d,v in rates.items()],date.today())
    dates = sorted(rates)
    converted = []
    for point in points:
        index = bisect_right(dates,point["date"])-1
        if index < 0 or (date.fromisoformat(point["date"])-date.fromisoformat(dates[index])).days > 7:
            raise ValueError("ECB FX missing or older than seven days")
        rate = rates[dates[index]]
        # source_currency y fx_pair viven en el documento de serie, que es donde los
        # comprueban _eligible y la guarda del BCE; no se repiten por punto.
        converted.append({"date":point["date"], "value":round(point["value"]/rate,8),
                          "source_value":point["value"], "fx_rate":rate})
    return converted


def parse_blackrock(html, asset_id, currency):
    rows = [r for t in tables(html) for r in t["rows"] if len(r)==9 and r[-1]==asset_id]
    if len(rows)!=1 or rows[0][1]!=currency:
        raise ValueError("BlackRock share class / currency not confirmed")
    row = rows[0]
    quote = {"date":datetime.strptime(row[5],"%d-%b-%Y").date().isoformat(),
             "value":float(row[2].replace(",",""))}
    match = re.search(r'var navData = \[(.*?)\];',html,re.S)
    if not match:
        raise ValueError("BlackRock native NAV array is missing")
    values = re.findall(r'x:Date.UTC\((\d{4}),(\d{1,2}),(\d{1,2})\),y:Number\(\(([\d.]+)\).toFixed\(2\)\)',match[1])
    if len(values) != match[1].count('Date.UTC('):
        raise ValueError("BlackRock NAV format changed")
    return [{"date":date(int(y),int(m)+1,int(d)).isoformat(),"value":float(v)} for y,m,d,v in values],quote


def parse_buyhold(raw, name):
    from pypdf import PdfReader
    reader = PdfReader(BytesIO(raw))
    text = "\n".join(p.extract_text() or "" for p in reader.pages[:3])
    if name not in text or "Fecha Clase 1 Clase 2 Clase 3" not in text:
        raise ValueError("Buy & Hold fund or share-class columns changed")
    rows = re.findall(r'^(\d{2}/\d{2}/\d{4})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$',text,re.M)
    points = []
    for day, _, class2, _ in rows:
        parsed = datetime.strptime(day,"%d/%m/%Y").date()
        if parsed.weekday()<5:
            points.append({"date":parsed.isoformat(),"value":float(class2.replace(',','.'))})
    if not points:
        raise ValueError("No dealing NAVs in manager PDF")
    return points,max(points,key=lambda p:p["date"])


def parse_schroders(raw):
    points = []
    def visit(nodes):
        for node in nodes:
            if "children" in node:
                visit(node["children"])
            elif "date" in node and "value" in node:
                if '>PLN<' not in node.get("valueFormatted",""):
                    raise ValueError("Schroders native currency changed")
                day = datetime.fromtimestamp(node["date"]/1000,timezone.utc).date()
                if day != datetime.strptime(node["title"], '%d.%m.%Y').date():
                    raise ValueError("Schroders date mismatch")
                points.append({"date":day.isoformat(),"value":float(node["value"])})
    visit(json.loads(raw))
    if not points:
        raise ValueError("Schroders NAV history is empty")
    return points,max(points,key=lambda p:p["date"])


def fetch_morningstar(asset_id, series, as_of, config):
    """The same public endpoint used by the platform, with exact ISIN verification."""
    sec_id = config["source_listing_id"].split(":",1)[1]
    query = urlencode(dict(page=1,pageSize=5,sortOrder="LegalName asc",outputType="json",version=1,
                           languageId="es-ES",currencyId=config["currency"],term=asset_id,
                           securityDataPoints="SecId|ISIN|PriceCurrency|ClosePrice|ClosePriceDate",
                           universeIds="FOESP$$ALL"))
    identity_raw = fetch("https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener?"+query)
    identities = [r for r in json.loads(identity_raw).get("rows",[]) if r.get("ISIN")==asset_id
                  and r.get("SecId")==sec_id and r.get("PriceCurrency")==config["currency"]]
    if len(identities)!=1:
        raise ValueError("Morningstar share class / currency not confirmed")
    identity = identities[0]
    cutoff = (date.fromisoformat(series["last_date"])-timedelta(days=45)).isoformat()
    url = (f"https://lt.morningstar.com/api/rest.svc/timeseries_price/klr5zyak8x?id={sec_id}]2]1]"
           f"&frequency=daily&startDate={cutoff}&endDate={as_of.isoformat()}"
           f"&outputType=COMPACTJSON&currencyId={config['currency']}")
    raw = fetch(url)
    rows = json.loads(raw)
    if not isinstance(rows,list) or any(not isinstance(r,list) or len(r)!=2 for r in rows):
        raise ValueError("Morningstar historical format changed")
    points = [{"date":datetime.fromtimestamp(ms/1000,timezone.utc).date().isoformat(),"value":v} for ms,v in rows]
    quote = {"date":identity["ClosePriceDate"],"value":identity["ClosePrice"]}
    plan = validate_native_append(asset_id,series,points,quote,as_of,config)
    return {**plan,"source_url":url,"provider_sha256":hashlib.sha256(raw).hexdigest(),
            "identity_sha256":hashlib.sha256(identity_raw).hexdigest()}


def fetch_reviewed_source(asset_id, series, as_of):
    config = REGISTRY[asset_id]
    if config["provider"] == "morningstar":
        return fetch_morningstar(asset_id,series,as_of,config)
    url = config.get("url") or f"https://markets.ft.markitdigital.com/data/funds/tearsheet/historical?s={asset_id}%3A{config['currency']}"
    raw = fetch(url)
    if config["provider"] == "blackrock":
        points, quote = parse_blackrock(raw.decode("utf-8"),asset_id,config["currency"])
    elif config["provider"] == "buyhold":
        points, quote = parse_buyhold(raw,config["fund_name"])
    elif config["provider"] == "schroders":
        points, quote = parse_schroders(raw)
    else:
        points, quote = parse_ft(raw.decode("utf-8"),asset_id,config["currency"],config["source_listing_id"])
    cutoff = (date.fromisoformat(series["last_date"])-timedelta(days=45)).isoformat()
    points = [p for p in points if p["date"] >= cutoff]
    fx = None
    if config.get("reconstruct_native_with_ecb"):
        # This reviewed PLN series explicitly documents ECB EUR/PLN conversion,
        # but its older points did not retain native values. Verify in EUR using
        # the same dated ECB rates; never assume this for unlabelled series.
        if "ECB" not in series.get("fx_policy","") or series.get("fx_pair") != "EXR.D.PLN.EUR.SP00.A":
            raise ValueError("Existing ECB conversion policy is not confirmed")
        fx = fetch(ECB_URL)
        converted = convert_ecb(points,config["currency"],fx)
        rates = {p["date"]:p["fx_rate"] for p in converted}
        relevant = [p for p in series["points"] if p["date"]>=cutoff]
        if any(p["date"] not in rates for p in relevant):
            raise ValueError("Cannot verify historical ECB conversion")
        series = {**series,"points":[{**p,"source_value":p["value"]*rates[p["date"]]} for p in relevant]}
    plan = validate_native_append(asset_id,series,points,quote,as_of,config)
    plan.update(source_url=url,provider_sha256=hashlib.sha256(raw).hexdigest())
    if config["currency"] != "EUR" and plan["append_only_points"]:
        if config.get("fx_source") == "EODHD":
            from price_refresh import _fetch_fx
            days, values = _fetch_fx(config["currency"],cutoff,quote["date"])
            rates = dict(zip(days,values))
            plan["append_only_points"] = convert_rates(plan["append_only_points"],config["currency"],rates,
                                                       "EUR"+config["currency"]+".FOREX")
            plan["fx_sha256"] = hashlib.sha256(json.dumps(rates,sort_keys=True).encode()).hexdigest()
            plan["fx_source"] = "EODHD:EUR"+config["currency"]+".FOREX"
        else:
            fx = fx or fetch(ECB_URL)
            plan["append_only_points"] = convert_ecb(plan["append_only_points"],config["currency"],fx)
            plan["fx_sha256"] = hashlib.sha256(fx).hexdigest()
            plan["fx_source"] = ECB_URL
    return plan
