// V3 — FT Salmon Editorial. Financial Times-inspired:
// salmon/cream background, serif headlines, market-briefing journalism feel.

const v3 = {
  salmon: '#fff1e5',
  salmonDeep: '#f3d8c4',
  cream: '#fbf3e9',
  paper: '#ffffff',
  ink: '#26241e',
  ink2: '#403c33',
  muted: '#6e6b62',
  muted2: '#a09c92',
  rule: '#e0d8c8',
  rule2: '#c8bca5',
  brand: '#0a2340',     // FT-style navy
  brandRed: '#990f3d',  // FT pink-red
  brandClaret: '#7c1438',
  accent: '#cc8b3a',
  teal: '#00574b',
  pos: '#0d7c3a',
  neg: '#990f3d',
  font: '"Pretendard", -apple-system, sans-serif',
  serif: '"Source Serif 4", "Noto Serif KR", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

function V3FT() {
  const s = useSummary();
  return (
    <div style={{ width: '100%', height: '100%', background: v3.salmon, color: v3.ink, fontFamily: v3.font, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <V3TopStrip />
      <V3Nav s={s} />
      <V3Masthead />
      <V3Briefing s={s} />
      <V3LeadStory s={s} />
      <V3LowerGrid />
      <V3Footer />
    </div>
  );
}

function V3TopStrip() {
  return (
    <div style={{ background: v3.brand, color: v3.salmonDeep, padding: '0 40px', height: 28, display: 'flex', alignItems: 'center', gap: 22, fontSize: 11, flexShrink: 0 }}>
      <span style={{ fontWeight: 600, color: '#fff' }}>금요일 2026년 5월 22일</span>
      <span style={{ opacity: 0.5 }}>|</span>
      <span>KOSPI <span style={{ color: '#fff' }}>2,748.32</span> <span style={{ color: '#fca5a5' }}>+0.67%</span></span>
      <span style={{ opacity: 0.5 }}>|</span>
      <span>국고 3Y <span style={{ color: '#fff' }}>3.241</span></span>
      <span style={{ opacity: 0.5 }}>|</span>
      <span>회사채 AA-(3Y) <span style={{ color: '#fff' }}>4.142</span></span>
      <span style={{ opacity: 0.5 }}>|</span>
      <span>KRW/USD <span style={{ color: '#fff' }}>1,371.20</span></span>
      <div style={{ flex: 1 }}/>
      <span style={{ color: v3.accent, fontWeight: 600, letterSpacing: 1 }}>로그인</span>
      <span>구독</span>
    </div>
  );
}

function V3Nav({ s }) {
  return (
    <div style={{ background: v3.salmon, padding: '0 40px', borderBottom: `1px solid ${v3.rule2}`, display: 'flex', alignItems: 'center', gap: 24, height: 42, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 20, fontSize: 12.5, color: v3.ink2, fontWeight: 600 }}>
        {['홈', 'DCM', 'ECM', '리그테이블', '캘린더', '분석', '데이터'].map((t, i) => (
          <div key={t} style={{ padding: '12px 0', position: 'relative', color: i === 1 ? v3.brand : v3.ink2, cursor: 'pointer' }}>
            {t}
            {i === 1 && <div style={{ position: 'absolute', bottom: -1, left: -4, right: -4, height: 3, background: v3.brand }}/>}
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }}/>
      <div style={{ fontFamily: v3.mono, fontSize: 11, color: v3.muted }}>
        전체 {s.total_records.toLocaleString()}건 · 최종 갱신 {s.as_of.split(' ')[1] || s.as_of}
        {s._source === 'live' && <span style={{ color: v3.pos, marginLeft: 6 }}>● LIVE</span>}
      </div>
    </div>
  );
}

function V3Masthead() {
  return (
    <div style={{ padding: '32px 40px 24px', textAlign: 'center', borderBottom: `2px solid ${v3.ink}`, flexShrink: 0 }}>
      <div style={{ fontFamily: v3.serif, fontSize: 11, color: v3.brandRed, letterSpacing: 6, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Korea Capital Market</div>
      <div style={{ fontFamily: v3.serif, fontWeight: 700, fontSize: 64, color: v3.ink, letterSpacing: -1.5, lineHeight: 0.95 }}>
        Deal<span style={{ fontStyle: 'italic', color: v3.brandRed }}>List</span>
      </div>
      <div style={{ fontFamily: v3.serif, fontSize: 14, color: v3.muted, fontStyle: 'italic', marginTop: 10, letterSpacing: 0.3 }}>
        매일 발간되는 한국 자본시장 딜 브리핑 · 금융감독원 DART 공시 기반
      </div>
    </div>
  );
}

function V3Briefing({ s }) {
  const items = [
    { l: '발행건수 1Y', v: s.range_count.toString(), u: '건', delta: `회차 ${s.range_tranche_count}` },
    { l: '발행총액 1Y', v: fmtAmt(s.range_amount).replace(/억$/, ''), u: '억', delta: `평균 ${s.range_avg_size.toLocaleString()}억` },
    { l: '주관 1위', v: brokerFull(s.this_year_top_broker), u: '', delta: `${s.this_year_top_share}%`, highlight: true },
    { l: '인수 1위', v: brokerFull(s.this_year_underwriter_broker), u: '', delta: `${s.this_year_underwriter_share}%` },
    { l: '최대 단일', v: s.this_year_biggest_issuer, u: `${fmtNum(s.this_year_biggest_amount)}억`, delta: `${s.this_year_biggest_series}회차 · ${s.this_year_biggest_date.slice(5)}` },
  ];
  return (
    <div style={{ background: v3.salmonDeep, borderBottom: `1px solid ${v3.rule2}`, padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 28, flexShrink: 0 }}>
      <div style={{ fontFamily: v3.serif, fontSize: 11, color: v3.brandRed, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>오늘의<br/>브리핑</div>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <div style={{ width: 1, height: 36, background: v3.rule2 }}/>
          <div>
            <div style={{ fontSize: 10, color: v3.muted, letterSpacing: 0.5, marginBottom: 2 }}>{it.l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontFamily: v3.serif, fontSize: 18, fontWeight: 600, color: it.highlight ? v3.brandRed : v3.ink, letterSpacing: -0.3 }}>{it.v}</span>
              {it.u && <span style={{ fontFamily: v3.serif, fontSize: 11, color: v3.muted }}>{it.u}</span>}
            </div>
            <div style={{ fontFamily: v3.mono, fontSize: 9.5, color: v3.muted, marginTop: 1 }}>{it.delta}</div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function V3LeadStory({ s }) {
  // Featured deal — pulls from summary for the headline issuer
  return (
    <div style={{ padding: '28px 40px 8px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 36, flexShrink: 0 }}>
      <div>
        <div style={{ fontFamily: v3.serif, fontSize: 10.5, color: v3.brandRed, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>오늘의 헤드라인 · DCM</div>
        <div style={{ fontFamily: v3.serif, fontSize: 34, fontWeight: 700, color: v3.ink, letterSpacing: -0.8, lineHeight: 1.1 }}>
          {s.this_year_biggest_issuer}, 회사채 {s.this_year_biggest_series}회차 <span style={{ fontStyle: 'italic' }}>{fmtNum(s.this_year_biggest_amount)}억 발행</span> — 올해 최대 규모
        </div>
        <div style={{ fontFamily: v3.serif, fontSize: 15, color: v3.ink2, fontStyle: 'italic', marginTop: 10, lineHeight: 1.5 }}>
          AA0 등급 · 3년물 3.98%, 5년물 4.21% 확정. KB증권·한국투자증권·미래에셋이 공동 주관.
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 18, fontFamily: v3.mono, fontSize: 11, color: v3.muted }}>
          <span><span style={{ color: v3.ink, fontWeight: 600 }}>청약일</span> {s.this_year_biggest_date}</span>
          <span><span style={{ color: v3.ink, fontWeight: 600 }}>회차합산</span> {fmtNum(s.this_year_biggest_amount)}억</span>
          <span><span style={{ color: v3.ink, fontWeight: 600 }}>등급</span> AA0</span>
          <span><span style={{ color: v3.ink, fontWeight: 600 }}>수요예측</span> 1조 8,200억 (배수 2.28)</span>
        </div>
      </div>
      <div style={{ paddingLeft: 32, borderLeft: `1px solid ${v3.rule2}` }}>
        <div style={{ fontFamily: v3.serif, fontSize: 10.5, color: v3.brandRed, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>이번 주 캘린더</div>
        {[
          ['월 5/19', '신세계 146회차 수요예측'],
          ['수 5/21', '두산로보틱스 IPO 수요예측 시작'],
          ['목 5/22', '하나금융지주 19회 신종자본 청약'],
          ['금 5/23', 'HD현대마린솔루션 유상증자 청약'],
        ].map(([d, t]) => (
          <div key={d} style={{ padding: '8px 0', borderTop: `1px solid ${v3.rule2}`, display: 'flex', gap: 12 }}>
            <span style={{ fontFamily: v3.mono, fontSize: 10.5, color: v3.brandRed, fontWeight: 600, width: 50, flexShrink: 0 }}>{d}</span>
            <span style={{ fontSize: 12, color: v3.ink2 }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function V3LowerGrid() {
  return (
    <div style={{ padding: '20px 40px 28px', display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 36, flex: 1, minHeight: 0 }}>
      <V3DealList />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <V3LeagueColumn />
        <V3YieldStrip />
      </div>
    </div>
  );
}

function V3DealList() {
  const statusLabel = { priced: '확정', booking: '수요예측', pending: '예정' };
  const statusColor = { priced: v3.pos, booking: v3.accent, pending: v3.muted };
  return (
    <div>
      <div style={{ borderTop: `2px solid ${v3.ink}`, borderBottom: `1px solid ${v3.rule2}`, padding: '12px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: v3.serif, fontSize: 20, fontWeight: 700, color: v3.ink, letterSpacing: -0.3 }}>공모채 발행 정보</div>
        <div style={{ fontFamily: v3.mono, fontSize: 11, color: v3.muted }}>253 회차 · 청약일 ▼</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr 56px 84px 76px 80px 80px', padding: '10px 0', borderBottom: `1px solid ${v3.rule2}`, fontFamily: v3.serif, fontSize: 10.5, color: v3.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
        <div>청약일</div><div>발행사 · 회차</div><div>등급</div><div>만기</div><div style={{ textAlign: 'right' }}>최초모집</div><div style={{ textAlign: 'right' }}>최종발행</div><div style={{ textAlign: 'right' }}>최종금리</div>
      </div>
      {DEALS.slice(0, 7).map((d, gi) => (
        <div key={gi} style={{ borderBottom: `1px solid ${v3.rule}` }}>
          {d.tranches.map((t, ti) => (
            <div key={ti} style={{ display: 'grid', gridTemplateColumns: '88px 1fr 56px 84px 76px 80px 80px', padding: '11px 0', alignItems: 'center', borderTop: ti === 0 ? 'none' : `1px dotted ${v3.rule2}` }}>
              <div style={{ fontFamily: v3.mono, fontSize: 11, color: ti === 0 ? v3.ink2 : 'transparent' }}>{d.date}</div>
              <div>
                {ti === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: v3.serif, fontSize: 14.5, fontWeight: 700, color: v3.ink }}>{d.issuer}</span>
                    <span style={{ fontSize: 10, color: statusColor[d.status], letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>· {statusLabel[d.status]}</span>
                  </div>
                )}
                <div style={{ fontFamily: v3.mono, fontSize: 10.5, color: v3.muted, marginTop: ti === 0 ? 2 : 0 }}>{t.no}회 {t.type} · {ti === 0 ? d.leads.join(', ') : ''}</div>
              </div>
              <div style={{ fontFamily: v3.serif, fontSize: 12, fontWeight: 700, color: t.rating.startsWith('AAA') ? v3.brand : t.rating.startsWith('AA') ? v3.brandRed : v3.accent }}>{t.rating}</div>
              <div style={{ fontFamily: v3.mono, fontSize: 11, color: v3.ink2 }}>{t.maturity}</div>
              <div style={{ fontFamily: v3.mono, fontSize: 12, color: v3.ink, textAlign: 'right' }}>{fmtNum(t.initial)}</div>
              <div style={{ fontFamily: v3.mono, fontSize: 12, color: t.final ? v3.ink : v3.muted2, textAlign: 'right', fontWeight: t.final ? 700 : 400 }}>{fmtNum(t.final)}</div>
              <div style={{ fontFamily: v3.mono, fontSize: 11.5, color: t.finalYield ? v3.brandRed : v3.muted2, textAlign: 'right', fontWeight: 600 }}>{t.finalYield || t.guidance}</div>
            </div>
          ))}
        </div>
      ))}
      <div style={{ padding: '14px 0', textAlign: 'center', fontFamily: v3.serif, fontSize: 13, fontStyle: 'italic', color: v3.brandRed, fontWeight: 600 }}>전체 253개 회차 보기 →</div>
    </div>
  );
}

function V3LeagueColumn() {
  return (
    <div>
      <div style={{ borderTop: `2px solid ${v3.ink}`, borderBottom: `1px solid ${v3.rule2}`, padding: '12px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: v3.serif, fontSize: 20, fontWeight: 700, color: v3.ink, letterSpacing: -0.3 }}>League Table</div>
        <div style={{ fontFamily: v3.mono, fontSize: 11, color: v3.muted }}>최근 1년</div>
      </div>
      {LEAGUE_TABLE.map((l, i) => (
        <div key={l.rank} style={{ padding: '12px 0', borderBottom: `1px solid ${v3.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: v3.serif, fontSize: 22, fontWeight: 700, color: i === 0 ? v3.brandRed : i < 3 ? v3.ink : v3.muted2, width: 24, fontStyle: i < 3 ? 'normal' : 'italic' }}>{l.rank}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: v3.serif, fontSize: 14, fontWeight: 700, color: v3.ink }}>{l.house}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, height: 2, background: v3.rule2, position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${l.share / 25 * 100}%`, background: i < 3 ? v3.brandRed : v3.brand }}/>
              </div>
              <span style={{ fontFamily: v3.mono, fontSize: 10.5, color: v3.muted, width: 80, textAlign: 'right' }}>{fmtAmtShort(l.amount)}억 · {l.deals}건</span>
            </div>
          </div>
          <div style={{ fontFamily: v3.serif, fontSize: 16, fontWeight: 600, color: v3.ink, width: 50, textAlign: 'right' }}>
            {l.share}<span style={{ fontSize: 10, color: v3.muted }}>%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function V3YieldStrip() {
  const yields = [
    { l: '국고 3Y', v: 3.241, prev: 3.253 },
    { l: '국고 5Y', v: 3.412, prev: 3.401 },
    { l: '국고 10Y', v: 3.518, prev: 3.510 },
    { l: '회사채 AAA(3Y)', v: 3.823, prev: 3.841 },
    { l: '회사채 AA-(3Y)', v: 4.142, prev: 4.160 },
    { l: '회사채 A+(3Y)', v: 4.881, prev: 4.870 },
  ];
  return (
    <div>
      <div style={{ borderTop: `2px solid ${v3.ink}`, borderBottom: `1px solid ${v3.rule2}`, padding: '12px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: v3.serif, fontSize: 20, fontWeight: 700, color: v3.ink, letterSpacing: -0.3 }}>금리 동향</div>
        <div style={{ fontFamily: v3.mono, fontSize: 10.5, color: v3.muted }}>전일 종가 기준</div>
      </div>
      {yields.map((y, i) => {
        const ch = y.v - y.prev;
        return (
          <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${v3.rule}`, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ flex: 1, fontFamily: v3.serif, fontSize: 12.5, color: v3.ink2 }}>{y.l}</span>
            <span style={{ fontFamily: v3.mono, fontSize: 13, color: v3.ink, fontWeight: 600 }}>{y.v.toFixed(3)}</span>
            <span style={{ fontFamily: v3.mono, fontSize: 10.5, color: ch >= 0 ? v3.brandRed : v3.pos, width: 56, textAlign: 'right' }}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(3)}</span>
          </div>
        );
      })}
    </div>
  );
}

function V3Footer() {
  return (
    <div style={{ borderTop: `1px solid ${v3.rule2}`, padding: '18px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: v3.muted, background: v3.salmonDeep, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 22 }}>
        <span style={{ fontFamily: v3.serif, fontWeight: 700, color: v3.ink }}>DealList</span>
        <span>출처: 금융감독원 DART</span>
        <span>본 정보는 참고용이며 투자 판단의 근거가 될 수 없습니다.</span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontFamily: v3.serif, fontStyle: 'italic' }}>
        <span>구독</span><span>광고</span><span>API</span><span>문의</span>
      </div>
    </div>
  );
}

window.V3FT = V3FT;
