"""Official Capital Group NAV parser and admission checks shared by CLI and scheduler."""
import math
from datetime import date, datetime
from html.parser import HTMLParser
from urllib.parse import urlencode
from curl_cffi import requests as curl_requests

ASSETS = ("LU1295551144", "LU1378997107", "LU1481179858", "LU2050929277")
BASE_URL = "https://capgroup-website.publifund.com"


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.table = None
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.table = {"id": dict(attrs).get("id"), "rows": []}
            self.tables.append(self.table)
        elif tag == "tr" and self.table is not None:
            self.row = []
            self.table["rows"].append(self.row)
        elif tag in ("th", "td") and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("th", "td") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr":
            self.row = None
        elif tag == "table":
            self.table = None


def tables(html):
    parser = Tables()
    parser.feed(html)
    return parser.tables


def official_quote(html, asset_id, currency):
    matches = [row for table in tables(html) for row in table["rows"]
               if len(row) == 4 and row[1] == asset_id]
    if len(matches) != 1 or not matches[0][0].endswith(" " + currency):
        raise ValueError("Official share class / currency not confirmed")
    name, _, nav, quote_date = matches[0]
    return {"name": name, "value": float(nav.replace(",", "")),
            "date": datetime.strptime(quote_date, "%d %b %Y").date().isoformat()}


def parse_navs(html):
    found = [table for table in tables(html) if table["id"] == "historyTable"]
    if len(found) != 1 or not found[0]["rows"]:
        raise ValueError("Official history table missing")
    header, *rows = found[0]["rows"]
    if header[:2] != ["Date", "NAV per share"]:
        raise ValueError("NAV column changed; refusing month-end indicative NAV")
    points = []
    for row in rows:
        if len(row) != len(header):
            raise ValueError("Malformed NAV row")
        # Month-end NAV is informational and must never replace dealing NAV.
        if row[1] in ("", "-", "–", "—", "\ufffd"):
            continue
        points.append({"date": datetime.strptime(row[0], "%d/%m/%Y").date().isoformat(),
                       "value": float(row[1].replace(",", ""))})
    return points


def point_map(points, as_of):
    result = {}
    for point in points:
        day = date.fromisoformat(point["date"]).isoformat()
        value = float(point["value"])
        if day > as_of.isoformat() or not math.isfinite(value) or value <= 0:
            raise ValueError("Invalid or future NAV")
        if day in result:
            raise ValueError("Duplicate NAV date")
        result[day] = value
    if not result:
        raise ValueError("Empty NAV history")
    return result


def prepare_plan(asset_id, series, official_points, quote, as_of):
    if series.get("asset_id") != asset_id or series.get("series_type") != "NAV":
        raise ValueError("Stored asset / series type mismatch")
    if series.get("currency") != "EUR" or series.get("source_currency") != "EUR":
        raise ValueError("Only already verified EUR series are admitted")
    if series.get("source_listing_id") != "CAPITALGROUP:" + asset_id:
        raise ValueError("Stored series does not use this reviewed source")
    existing = point_map(series.get("points") or [], as_of)
    incoming = point_map(official_points, as_of)
    last = max(existing)
    if series.get("last_date") != last:
        raise ValueError("Stored last_date disagrees with points")
    overlap = sorted(existing.keys() & incoming.keys())
    if len(overlap) < 5 or last not in overlap:
        raise ValueError("Insufficient overlap with the end of the stored series")
    error_pct = max(abs(incoming[day] / existing[day] - 1) * 100 for day in overlap)
    if error_pct > .01:
        raise ValueError(f"Overlap differs by {error_pct:.6f}%")
    quote_values = point_map([quote], as_of)
    quote_date = quote["date"]
    if max(incoming) != quote_date or abs(incoming[quote_date] / quote_values[quote_date] - 1) > .0001:
        raise ValueError("History does not agree with the latest official quote")
    if (as_of - date.fromisoformat(quote_date)).days > 7:
        raise ValueError("Official history is still stale")
    new_dates = sorted(day for day in incoming if day > last)
    previous = last
    for day in new_dates:
        if (date.fromisoformat(day) - date.fromisoformat(previous)).days > 7:
            raise ValueError("Gap in new NAV dates exceeds seven calendar days")
        if abs(incoming[day] / incoming[previous] - 1) > .15:
            raise ValueError("Large daily move requires manual review")
        previous = day
    return {"asset_id": asset_id, "status": "CANDIDATE_VALIDATED" if new_dates else "UP_TO_DATE",
            "currency": "EUR", "existing_last_date": last, "proposed_last_date": max(incoming),
            "overlap_checks": len(overlap), "max_overlap_error_pct": error_pct,
            "quote": quote, "append_only_points": [{"date": day, "value": incoming[day]} for day in new_dates],
            "existing_points_preserved": True, "read_only": True}


def fetch(url, data=None):
    # curl timeout covers the entire transfer, including a slowly streamed body.
    response = curl_requests.request("POST" if data else "GET", url,
        data=urlencode(data).encode() if data else None,
        headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded"}, timeout=30)
    response.raise_for_status()
    body = response.content
    if len(body) > 2_000_000:
        raise ValueError("Unexpected response size")
    return body

