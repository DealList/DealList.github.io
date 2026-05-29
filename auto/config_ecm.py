"""ECM (지분증권) 데이터 수집용 상수 / 매핑.

DCM (config.py) 와 병렬 — 독립 모듈로 분리 유지. DCM 코드 손대지 않음.

두 시트 schema:
  - IPO: 75 cols + 헤더 2줄 (A-BW)
  - 유상증자: 70 cols + 헤더 2줄 (A-BR)

broker list 는 시트별로 다름 (IPO 와 유상증자의 주관·인수 list 차이 있음).
"""
from __future__ import annotations

# ============== DART pblntf_detail_ty 코드 ==============
# 실측 결과:
#   C001 = 지분증권 발행공시 (IPO, 유상증자)         ← ECM 사용
#   C002 = 채무증권 발행공시 (DCM)
#   C003 = 파생결합증권 발행공시 (ELS/DLS/ELW)
#   C004 = 합병/분할/주식의포괄적교환·이전 등
#   C005 = 투자계약증권
PBLNTF_DETAIL_TY_ECM = "C001"

# ============== 공시 종류 필터 ==============
# ECM 에서 사용하는 공시 종류 (정정신고서 제외):
# 1) 증권신고서(지분증권)         — 최초 등록
# 2) [발행조건확정] 증권신고서(지분증권) — 발행조건 확정 정정
#    IPO: 1번만 / 유상증자: 1차, 2차 두 번
REPORT_NAMES = {
    "stage1": "증권신고서(지분증권)",           # 최초
    "final":  "[발행조건확정]증권신고서(지분증권)",  # 발행조건확정
}


# ============== IPO 시트 컬럼 매핑 (1-based, openpyxl 컬럼 인덱스) ==============
# Row 1 (그룹 헤더 — 병합): 상장일|회사명|시장|최초 희망(D-F)|최종(G-I)|모집방식(J-K)|
#                          기관(L-O)|일반(P-S)|우리사주(T-V)|주관(W-AU)|인수(AV-BW)
# Row 2 (sub 헤더): 단독 컬럼들은 row1 vertical merge / 그룹은 sub-name
COL_IPO = {
    "상장일": 1,         # A
    "회사명": 2,         # B
    "시장": 3,            # C
    # 최초 희망
    "최초_수량": 4,       # D
    "최초_가액": 5,       # E
    "최초_총액": 6,       # F = D*E/1e8
    # 최종 (확정)
    "최종_수량": 7,       # G (default = D)
    "최종_가액": 8,       # H
    "최종_총액": 9,       # I = G*H/1e8
    # 모집 방식
    "신주_비율": 10,      # J (1.0 = 100% 신주)
    "구주_비율": 11,      # K = 1-J
    # 기관 투자자
    "기관_최초배정": 12,  # L
    "기관_청약": 13,      # M
    "기관_경쟁률": 14,    # N = M/L
    "기관_최종배정": 15,  # O
    # 일반 투자자
    "일반_최초배정": 16,  # P
    "일반_청약": 17,      # Q
    "일반_경쟁률": 18,    # R = Q/P
    "일반_최종배정": 19,  # S
    # 우리사주
    "우리사주_최초배정": 20,  # T
    "우리사주_최종배정": 21,  # U
    "우리사주_청약률": 22,    # V = U/T
    # 주관 시작 = W (23) — broker 별 배정량
    "주관_시작": 23,
    # 인수 시작은 주관 끝 다음. LEAD 25개 → 인수 시작 = 23 + 25 = 48 (AV)
}

# ============== 유상증자 시트 컬럼 매핑 ==============
COL_RIGHTS = {
    "신주배정기준일": 1,  # A
    "회사명": 2,           # B
    "구분": 3,             # C — "주주배정 후 실권주 일반공모" 등
    "납입일": 4,           # D
    # 증자 비율
    "모집수량": 5,         # E
    "기존주식": 6,         # F
    "증자비율": 7,         # G = E/F
    # 최초 희망
    "최초_수량": 8,        # H = E (default)
    "최초_가액": 9,        # I
    "최초_총액": 10,       # J = H*I/1e8
    # 1차 [발행조건확정]
    "1차_가액": 11,        # K
    "1차_총액": 12,        # L = E*K/1e8
    # 2차 [발행조건확정] (앞부분)
    "2차_가액": 13,        # M
    "2차_총액": 14,        # N = E*M/1e8
    # 2차 [발행조건확정] (최종)
    "최종_가액": 15,       # O
    "최종_총액": 16,       # P = E*O/1e8
    # 주관 시작 = Q (17), 끝 = AO (41) (LEAD_ECM 25개)
    "주관_시작": 17,
    # 인수 시작 = AP (42), 끝 = BX (76) (UW_ECM 35개)
}


# ============== 통합 ECM broker list ==============
# IPO 시트 + 유상증자 시트의 주관·인수 영역은 동일 broker 순서·길이로 통일됨.
# (템플릿 ECM_TEMPLATE 의 row 2 와 직접 일치 — 변경 시 함께 갱신.)
#
# **자동 등록 룰** (DCM 동일):
#   본문에서 미매핑 broker 발견 → parser_ecm.auto_register_broker_ecm 가 자동으로
#   - mappings.json 의 brokers_formal_to_alias 에 alias 등록
#   - LEAD_ECM (대표 역할이면) / UW_ECM 에 alias append
#   - mappings.json 의 _auto_added_brokers 에 기록
#   - excel_writer 의 _expand_broker_columns 가 시트 헤더에 컬럼 자동 추가

# 주관 (35개): 시트 헤더 (ECM Table.xlsx row 2) 와 1:1 일치 — 변경 시 함께 갱신.
LEAD_ECM = [
    "KB", "NH", "한투", "신한", "SK", "삼성", "키움", "미래", "하나", "iM",
    "대신", "교보", "한양", "DB", "현차", "IBK", "부국", "신영", "유진", "유안타",
    "LS", "상상인", "BNK", "메리츠", "JP모간", "UBS", "한화", "흥국", "우리", "코리아에셋",
    "산은", "KR", "메릴린치", "모간스탠리", "크레디트스위스",
]
# 인수 (39개): 시트 헤더 (ECM Table.xlsx row 2) 와 1:1 일치
UW_ECM = [
    "KB", "NH", "한투", "신한", "SK", "삼성", "키움", "미래", "하나", "한화",
    "iM", "대신", "교보", "한양", "DB", "현차", "IBK", "부국", "신영", "유진",
    "흥국", "유안타", "LS", "BNK", "메리츠", "상상인", "리딩", "우리", "케이프", "산은",
    "KR", "JP모간", "UBS", "메릴린치", "모간스탠리", "코리아에셋", "다올", "디에스", "크레디트스위스",
]


# ============== 하위호환 alias (다른 파일에서 import 한 경우) ==============
# 모든 ECM broker list 는 단일화 — IPO/유상증자 구분 없이 LEAD_ECM/UW_ECM 사용.
LEAD_IPO = LEAD_RIGHTS = LEAD_ECM
UW_IPO = UW_RIGHTS = UW_ECM
LEAD_ECM_ALL = LEAD_ECM
UW_ECM_ALL = UW_ECM


# ============== 파일 경로 ==============
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # auto/ → .../Deal List/
ECM_XLSX     = ROOT / "ECM Table.xlsx"             # 본 데이터 파일
ECM_TEMPLATE = ROOT / "auto" / "template_ecm_sheet.xlsx"
ECM_META     = ROOT / "ECM Table.meta.json"        # 사이드카 메타 (processed_rcepts 등)

# 하위호환 (기존 코드에서 ECM_XLSX_TEST / ECM_META_TEST 참조하는 경우)
ECM_XLSX_TEST = ECM_XLSX
ECM_META_TEST = ECM_META
