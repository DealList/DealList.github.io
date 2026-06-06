-- ════════════════════════════════════════════════════════════════════
-- 메자닌(CB/BW/EB) 발행결정 단일 테이블
-- ════════════════════════════════════════════════════════════════════
-- 데이터 출처: OpenDART 발행결정 API
--   CB: cvbdIsDecsn.json   (전환사채권 발행결정)
--   BW: bdwtIsDecsn.json   (신주인수권부사채권 발행결정)
--   EB: exbdIsDecsn.json   (교환사채권 발행결정)
--
-- 설계 원칙
--   - 단일 테이블 + type ('cb'|'bw'|'eb') 컬럼 (페이지 탭 전환을 한 데이터로)
--   - 셋이 의미가 같지만 이름이 다른 필드(CB의 cv_*, BW·EB의 ex_*)는
--     '변환_*' 통합 컬럼으로 매핑 (페이지 분기 최소화)
--   - 자금용도 fdpp_* 5개는 'fdpp' jsonb 한 칸으로 묶음
--   - 유형 고유 필드(BW 분리형/EB 교환대상 등) + 미사용 필드 전부 'raw'
--     jsonb 에 통째 보존 (미래 수요·재수집 방지)
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.mezz_issuances (
  -- ── PK / 분류 ──
  rcept_no            text primary key,                    -- DART 공시접수번호(14자리)
  type                text not null check (type in ('cb','bw','eb')),

  -- ── 발행사 ──
  corp_code           text not null,                       -- 회사 고유번호(8자리)
  corp_name           text not null,
  corp_cls            text,                                -- Y=코스피 / K=코스닥 / N=코넥스 / E=기타

  -- ── 일자 ──
  bddd                date,                                -- 이사회결의일
  sbd                 date,                                -- 청약일
  pymd                date,                                -- 납입일
  bd_mtd              date,                                -- 사채 만기일

  -- ── 사채 기본 ──
  bd_tm               int,                                 -- 회차
  bd_knd              text,                                -- 종류 (예: "무기명식 무보증 사모 전환사채")
  bd_fta              bigint,                              -- 권면(전자등록) 총액 (원)
  bdis_mthn           text,                                -- 발행방법: '공모' / '사모'
  bd_intr_ex          numeric(7,4),                        -- 표면이자율(%)
  bd_intr_sf          numeric(7,4),                        -- 만기이자율(%)
  rpmcmp              text,                                -- 대표주관회사 (사모면 보통 null)

  -- ── 자금 사용 목적 (5개 항목 통합) ──
  -- {"운영":50000000000, "시설":0, "채무상환":30000000000, "타법인취득":0, "기타":20000000000}
  fdpp                jsonb,

  -- ── 변환(전환·행사·교환) 통합 필드 ──
  -- CB: cv_prc/cv_rt/cvrqpd_*  /  BW: ex_prc/ex_rt/expd_*  /  EB: ex_prc/ex_rt/exrqpd_*
  변환가              numeric(20,4),                       -- 1주당 변환 가격 (원)
  변환비율            numeric(7,4),                        -- 변환비율(%)
  변환기간_시작       date,
  변환기간_종료       date,
  변환주식수          bigint,                              -- 변환 시 발행될/교환될 주식 수
  변환주식_총수_대비_비율  numeric(7,4),                   -- 발행주식총수 대비 %

  -- ── 원본 보존 ──
  -- 유형 고유 필드(BW bdwt_div_atn 분리형 여부 / EB extg 교환대상 / CB 리픽싱 하한 등)
  -- 와 위에서 안 뽑은 자잘한 필드 전부 — 미래에 페이지에 추가하고 싶으면 여기서 꺼냄.
  raw                 jsonb not null,

  -- ── 적재 메타 ──
  inserted_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── 인덱스 ──
create index if not exists mezz_type_bddd_idx        on public.mezz_issuances (type, bddd desc);
create index if not exists mezz_corp_code_idx        on public.mezz_issuances (corp_code);
create index if not exists mezz_bdis_mthn_idx        on public.mezz_issuances (bdis_mthn);
create index if not exists mezz_bddd_idx             on public.mezz_issuances (bddd desc);

-- ── RLS: 서비스 키만 쓰니 비활성 유지(현재 DCM/ECM 테이블과 동일 정책). ──
-- (필요 시 나중에 활성화)
