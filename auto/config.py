"""환경 설정 및 상수.

LEAD_MANAGERS / UNDERWRITERS 는 mappings.json 의 lead_managers / underwriters
배열을 단일 출처(single source of truth)로 사용한다. 자동 추가 시 mutable
list 에 append 하여 모듈 변수도 즉시 갱신된다.
"""
from pathlib import Path
import json
import os
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
# 템플릿은 auto/ 폴더 안에 자체 보관 — 원본 DCM sheet.xlsx 의존 제거.
# _build_template 가 매번 이 파일을 복사한 뒤 데이터 행을 삭제해 헤더만 남기므로,
# 이 파일의 데이터는 영향 없음 (헤더 + 컬럼 너비 + 폰트 등 서식만 사용).
TEMPLATE_XLSX = ROOT / "template_dcm_sheet.xlsx"
MAPPINGS_JSON = ROOT / "mappings.json"
CACHE_DIR = ROOT / "cache"
OUTPUT_DIR = ROOT / "output"

load_dotenv(ROOT / ".env")
DART_API_KEY = os.getenv("DART_API_KEY", "").strip()

# DART
OPENDART_LIST_URL = "https://opendart.fss.or.kr/api/list.json"
DART_VIEWER_MAIN = "https://dart.fss.or.kr/dsaf001/main.do"
DART_VIEWER_DOC = "https://dart.fss.or.kr/report/viewer.do"

REQUEST_SLEEP = 0.5

# DCM sheet 고정 컬럼 위치 (1-indexed). 주관 시작은 P=16 으로 고정,
# 인수 시작은 LEAD_MANAGERS 길이에 따라 동적으로 계산 (underwriter_col_start).
COL = {
    "청약일": 1, "발행사": 2, "회차": 3, "종류": 4, "신용등급": 5, "만기일": 6,
    "최초모집": 7, "발행한도": 8, "수요예측": 9, "최종발행": 10, "회차합산": 11,
    "경쟁률": 12,
    "희망금리": 13, "수요금리": 14, "최종금리": 15,
    "주관_시작": 16,   # P
}


def _load_broker_lists() -> tuple[list[str], list[str]]:
    if not MAPPINGS_JSON.exists():
        return [], []
    try:
        data = json.loads(MAPPINGS_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return [], []
    return list(data.get("lead_managers", [])), list(data.get("underwriters", []))


LEAD_MANAGERS, UNDERWRITERS = _load_broker_lists()


def underwriter_col_start() -> int:
    """인수 컬럼 시작 위치 = 주관 시작 + 주관 개수."""
    return COL["주관_시작"] + len(LEAD_MANAGERS)
