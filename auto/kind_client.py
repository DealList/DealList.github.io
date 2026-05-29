"""한국거래소 KIND 공모기업현황 페이지에서 IPO 일정 + 상장예정일 수집.

DART 의 IPO 공시(증권신고서/[발행조건확정])는 '상장예정일' 을 명시하지 않는다.
이 정보는 청약 결과 발표 후 '증권발행실적보고서' 의 "Ⅳ. 증권교부일 등" 에서
확정 상장일로 비로소 나타난다. 그 이전까지의 잠정 상장예정일은 거래소(KRX) 의
KIND 사이트 '공모기업현황' 페이지가 유일한 공식 출처다.

엔드포인트:
  POST https://kind.krx.co.kr/listinvstg/pubofrprogcom.do
  body: method=searchPubofrProgComSub & forward=pubofrprogcom_sub
        & searchCorpName=<회사명> & ...

응답은 결과표 HTML 조각 (회사명/신고서제출일/수요예측일정/청약일정/납입일/
확정공모가/공모금액(백만원)/상장예정일/상장주선인 9개 컬럼).
"""
from __future__ import annotations
import re
import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional
import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

KIND_URL = "https://kind.krx.co.kr/listinvstg/pubofrprogcom.do"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 KINDScraper/1.0"
DEFAULT_HEADERS = {
    "User-Agent": UA,
    "Accept-Language": "ko,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://kind.krx.co.kr/listinvstg/pubofrprogcom.do?method=searchPubofrProgComMain",
}

# img alt → 시장명
_MARKET_BY_ALT = {
    "유가증권": "코스피",
    "코스피": "코스피",
    "코스닥": "코스닥",
    "코넥스": "코넥스",
}


@dataclass
class KindListingSchedule:
    """KIND 공모기업현황 한 행에서 추출한 IPO 일정."""
    corp_name: str
    market: str = ""                     # 코스피/코스닥/코넥스
    filing_date: Optional[date] = None   # 신고서제출일
    demand_from: Optional[date] = None   # 수요예측 시작일
    demand_to: Optional[date] = None     # 수요예측 종료일
    subscription_from: Optional[date] = None  # 청약 시작일
    subscription_to: Optional[date] = None    # 청약 종료일
    payment_date: Optional[date] = None       # 납입일
    final_price: Optional[int] = None         # 확정공모가 (원). 미확정이면 None
    offering_amount_mn: Optional[int] = None  # 공모금액 (백만원). 미확정이면 None
    listing_date_planned: Optional[date] = None  # 상장예정일 (이 모듈의 핵심)
    lead_brokers_raw: str = ""           # 상장주선인 원문 (콤마 구분)
    isurcd: str = ""                     # 거래소 종목코드 (fnDetailView 인자)


def _parse_date(s: str) -> Optional[date]:
    s = (s or "").strip().replace(" ", "")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _parse_int(s: str) -> Optional[int]:
    s = (s or "").strip().replace(",", "")
    if not s or s == "-":
        return None
    try:
        return int(s)
    except ValueError:
        try:
            return int(float(s))
        except ValueError:
            return None


def _parse_date_range(td_text: str) -> tuple[Optional[date], Optional[date]]:
    """'2026-05-18 ~ 2026-05-22' 같은 텍스트에서 두 날짜 추출."""
    if not td_text:
        return (None, None)
    parts = re.findall(r"\d{4}-\d{1,2}-\d{1,2}", td_text)
    d_from = _parse_date(parts[0]) if len(parts) >= 1 else None
    d_to   = _parse_date(parts[1]) if len(parts) >= 2 else None
    return (d_from, d_to)


def _parse_market(td) -> str:
    """td 안의 <img alt='코스닥'> 에서 시장명 추출."""
    img = td.find("img")
    if img is None:
        return ""
    alt = (img.get("alt") or "").strip()
    return _MARKET_BY_ALT.get(alt, alt)


def search(corp_name: str, *, timeout: int = 20) -> list[KindListingSchedule]:
    """KIND 공모기업현황에서 회사명으로 검색해 결과 행들을 반환.

    회사명은 LIKE 검색이라서 여러 건이 잡힐 수 있다. 호출자가 정확 매칭 골라야 함.
    """
    data = {
        "method": "searchPubofrProgComSub",
        "forward": "pubofrprogcom_sub",
        "searchCorpName": corp_name,
        "searchCodeType": "",
        "currentPageSize": "100",
        "pageIndex": "1",
        "orderMode": "1",
        "orderStat": "D",
        "marketType": "",
        "repMajAgntDesignAdvserComp": "",
        "fromDate": "",
        "toDate": "",
    }
    r = requests.post(KIND_URL, data=data, headers=DEFAULT_HEADERS, timeout=timeout)
    r.raise_for_status()
    html = r.content.decode("utf-8", errors="replace")
    return _parse_table(html)


def _parse_table(html: str) -> list[KindListingSchedule]:
    soup = BeautifulSoup(html, "lxml")
    out: list[KindListingSchedule] = []
    for tr in soup.select("table.list tbody tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 9:
            continue
        # 행 클릭 핸들러에서 isurcd 추출: onclick="fnDetailView('20250827000564')"
        onclick = tr.get("onclick") or ""
        m = re.search(r"fnDetailView\('?(\d+)'?\)", onclick)
        isurcd = m.group(1) if m else ""

        market = _parse_market(tds[0])
        corp_name = tds[0].get_text(" ", strip=True)
        # img alt 텍스트가 회사명 앞에 같이 묻어 나올 수 있어 정리
        corp_name = re.sub(r"^\s*(코스닥|코스피|유가증권|코넥스)\s*", "", corp_name).strip()

        filing_date = _parse_date(tds[1].get_text(" ", strip=True))
        d_from, d_to = _parse_date_range(tds[2].get_text(" ", strip=True))
        s_from, s_to = _parse_date_range(tds[3].get_text(" ", strip=True))
        payment_date = _parse_date(tds[4].get_text(" ", strip=True))
        final_price = _parse_int(tds[5].get_text(" ", strip=True))
        offering_amount_mn = _parse_int(tds[6].get_text(" ", strip=True))
        listing_planned = _parse_date(tds[7].get_text(" ", strip=True))
        lead_brokers = tds[8].get_text(" ", strip=True)

        out.append(KindListingSchedule(
            corp_name=corp_name,
            market=market,
            filing_date=filing_date,
            demand_from=d_from, demand_to=d_to,
            subscription_from=s_from, subscription_to=s_to,
            payment_date=payment_date,
            final_price=final_price,
            offering_amount_mn=offering_amount_mn,
            listing_date_planned=listing_planned,
            lead_brokers_raw=lead_brokers,
            isurcd=isurcd,
        ))
    return out


def fetch_listing_schedule(corp_name: str) -> Optional[KindListingSchedule]:
    """회사명으로 KIND 조회 후 가장 정확한 단건 반환.

    - 정확 일치 행이 있으면 그 행
    - 없으면 LIKE 검색 결과 첫 행
    - 결과 0건이면 None
    """
    rows = search(corp_name)
    if not rows:
        return None
    # 정확 일치 우선
    target = corp_name.replace(" ", "")
    for r in rows:
        if r.corp_name.replace(" ", "") == target:
            return r
    return rows[0]
