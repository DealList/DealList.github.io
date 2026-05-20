// V4 — Minimal Premium. Linear/Stripe-inspired:
// thoughtful whitespace, fine typography, premium feel, restrained data viz.

const v4 = {
  bg: '#f7f6f3',
  paper: '#ffffff',
  ink: '#0a0a0a',
  ink2: '#2b2b2b',
  muted: '#737373',
  muted2: '#a8a29e',
  rule: '#ebe9e4',
  rule2: '#d6d3cc',
  brand: '#1d4ed8',     // refined royal blue (matches existing --accent ish)
  brand2: '#1e3a8a',
  brandSoft: '#eef2ff',
  accent: '#d4a574',    // warm camel
  pos: '#0a7b4f',
  neg: '#b13838',
  font: '"Pretendard", -apple-system, sans-serif',
  display: '"Source Serif 4", "Noto Serif KR", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

function V4Minimal() {
  const s = useSummary();
  return (
    <div style={{ width: '100%', height: '100%', background: v4.bg, color: v4.ink, fontFamily: v4.font, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <V4Nav />
      <V4Hero s={s} />
      <V4Body s={s} />
      <V4Footer />
    </div>
  );
}

function V4Nav() {
  return (
    <div style={{ background: v4.bg, padding: '0 56px', height: 64, display: 'flex', alignItems: 'center', gap: 36, flexShrink: 0, borderBottom: `1px solid ${v4.rule}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="2" y="2" width="8" height="8" rx="1" fill={v4.brand}/>
          <rect x="12" y="2" width="8" height="8" rx="1" fill={v4.ink} opacity="0.85"/>
          <rect x="2" y="12" width="8" height="8" rx="1" fill={v4.ink} opacity="0.85"/>
          <rect x="12" y="12" width="8" height="8" rx="1" fill={v4.accent}/>
        </svg>
        <span style={{ fontFamily: v4.display, fontWeight: 600, fontSize: 17, letterSpacing: -0.3, color: v4.ink }}>DealList</span>
      </div>
      <div style={{ display: 'flex', gap: 26, fontSize: 13, color: v4.muted, fontWeight: 500 }}>
        {['Overview', 'DCM', 'ECM', 'League', 'Analytics'].map((t, i) => (
          <span key={t} style={{ color: i === 0 ? v4.ink : v4.muted, fontWeight: i === 0 ? 600 : 500, cursor: 'pointer' }}>{t}</span>
        ))}
      </div>
      <div style={{ flex: 1 }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 8, fontSize: 12.5, color: v4.muted2, minWidth: 260 }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4"/><path d="m14 14-3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        <span>발행사, 회차, 주관사 검색</span>
        <div style={{ flex: 1 }}/>
        <span style={{ fontFamily: v4.mono, fontSize: 10, padding: '1px 5px', background: v4.bg, borderRadius: 3, color: v4.muted }}>⌘K</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: v4.muted }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a3 3 0 0 0-3 3v3.5l-1.5 2v1h9v-1L11 8V4.5a3 3 0 0 0-3-3z M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3"/></svg>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: v4.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600 }}>JK</div>
      </div>
    </div>
  );
}

function V4Hero({ s }) {
  return (
    <div style={{ padding: '56px 56px 36px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'flex-end', flexShrink: 0 }}>
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 999, fontSize: 11.5, color: v4.muted, marginBottom: 24 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: v4.pos, boxShadow: `0 0 0 3px ${v4.pos}22` }}/>
          <span>{s._source === 'live' ? 'Live' : 'Preview'} · {s.as_of} KST</span>
          <span style={{ color: v4.muted2 }}>·</span>
          <span>{s.total_records.toLocaleString()}건 추적 중</span>
        </div>
        <div style={{ fontFamily: v4.display, fontSize: 52, fontWeight: 500, lineHeight: 1.05, letterSpacing: -1.6, color: v4.ink }}>
          한국 자본시장 딜<br/>
          <span style={{ color: v4.muted2 }}>한 페이지에서</span>
        </div>
        <div style={{ fontSize: 15, color: v4.muted, marginTop: 18, lineHeight: 1.55, maxWidth: 480 }}>
          DART 공시 기반 회차별 트랜치 데이터, 주관·인수 실적, 발행 인포그래픽을 매일 자동으로 갱신합니다.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 26 }}>
          <div style={{ padding: '10px 18px', background: v4.ink, color: v4.paper, borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            발행 정보 조회
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m-3-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ padding: '10px 18px', background: v4.paper, border: `1px solid ${v4.rule2}`, color: v4.ink, borderRadius: 8, fontSize: 13, fontWeight: 500 }}>Excel 다운로드</div>
          <div style={{ padding: '10px 18px', color: v4.muted, fontSize: 13, fontWeight: 500 }}>데이터 안내 →</div>
        </div>
      </div>
      <V4HeroChart s={s} />
    </div>
  );
}

function V4HeroChart({ s }) {
  const max = Math.max(...MONTHLY_VOLUME.map(m => m.v));
  const W = 560, H = 220, padL = 8, padR = 8, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const linePts = MONTHLY_VOLUME.map((m, i) => {
    const x = padL + (i + 0.5) * (innerW / MONTHLY_VOLUME.length);
    const y = padT + innerH - (m.v / max) * innerH;
    return [x, y];
  });
  const areaPath = `M ${linePts[0][0]},${padT + innerH} L ${linePts.map(p => p.join(',')).join(' L ')} L ${linePts[linePts.length-1][0]},${padT + innerH} Z`;
  const linePath = `M ${linePts.map(p => p.join(',')).join(' L ')}`;
  return (
    <div style={{ background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 12, padding: '20px 22px', boxShadow: '0 1px 2px rgba(15,15,15,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 11, color: v4.muted, fontWeight: 500, letterSpacing: 0.3 }}>최근 12개월 발행총액</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <span style={{ fontFamily: v4.display, fontSize: 30, fontWeight: 600, color: v4.ink, letterSpacing: -0.5 }}>{fmtAmt(s.range_amount)}</span>
            <span style={{ fontSize: 12, color: v4.pos, fontWeight: 600 }}>{s.range_count}건</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, padding: 2, background: v4.bg, borderRadius: 6, fontSize: 11 }}>
          {['3M', '6M', '1Y', 'All'].map((t, i) => (
            <span key={t} style={{
              padding: '4px 10px', borderRadius: 4,
              background: i === 2 ? v4.paper : 'transparent',
              boxShadow: i === 2 ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              color: i === 2 ? v4.ink : v4.muted, fontWeight: i === 2 ? 600 : 500,
            }}>{t}</span>
          ))}
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 8 }}>
        <defs>
          <linearGradient id="v4grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={v4.brand} stopOpacity="0.16"/>
            <stop offset="100%" stopColor={v4.brand} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(p => {
          const y = padT + innerH * (1 - p);
          return <line key={p} x1={padL} y1={y} x2={W - padR} y2={y} stroke={v4.rule} strokeWidth={0.5} strokeDasharray={p === 0 ? '' : '2 4'}/>;
        })}
        <path d={areaPath} fill="url(#v4grad)"/>
        <path d={linePath} fill="none" stroke={v4.brand} strokeWidth="2"/>
        {linePts.map(([x, y], i) => i === linePts.length - 1 ? (
          <g key={i}>
            <circle cx={x} cy={y} r="6" fill={v4.brand} opacity="0.18"/>
            <circle cx={x} cy={y} r="3.5" fill={v4.paper} stroke={v4.brand} strokeWidth="2"/>
          </g>
        ) : null)}
        {MONTHLY_VOLUME.map((m, i) => i % 2 === 0 && (
          <text key={i} x={padL + (i + 0.5) * (innerW / MONTHLY_VOLUME.length)} y={H - 8} fontSize="10" fontFamily={v4.mono} fill={v4.muted2} textAnchor="middle">{m.m}</text>
        ))}
      </svg>
    </div>
  );
}

function V4Body({ s }) {
  return (
    <div style={{ padding: '0 56px 36px', display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 36, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <V4MetricCards s={s} />
        <V4DealList />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <V4LeagueCard />
        <V4PipelineCard />
      </div>
    </div>
  );
}

function V4MetricCards({ s }) {
  const monthLabel = s.this_month_label ? s.this_month_label.replace('-', '.') : '이번 달';
  const chg = (v) => v == null ? '' : (v > 0 ? `+${v}%` : `${v}%`);
  const cards = [
    { l: `${monthLabel} 발행건수`, v: `${s.this_month_count}건`, sub: '전월 대비', d: chg(s.this_month_count_change), pos: s.this_month_count_change > 0 },
    { l: `${monthLabel} 발행총액`, v: fmtAmt(s.this_month_amount), sub: '전월 대비', d: chg(s.this_month_amount_change), pos: s.this_month_amount_change > 0 },
    { l: '주관 1위', v: brokerFull(s.this_year_top_broker), sub: `${s.this_year_top_share}% 점유`, d: fmtAmtShort(s.this_year_top_amount) + '억' },
    { l: '최대 발행', v: s.this_year_biggest_issuer, sub: `${s.this_year_biggest_series}회차 · ${s.this_year_biggest_date.slice(5)}`, d: fmtNum(s.this_year_biggest_amount) + '억' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 10, padding: '16px 16px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontSize: 11.5, color: v4.muted, fontWeight: 500 }}>{c.l}</div>
            {c.pos === true && <span style={{ fontSize: 10.5, color: v4.pos, fontWeight: 600, padding: '1px 6px', background: '#e8f5ed', borderRadius: 999 }}>{c.d}</span>}
            {c.pos === false && <span style={{ fontSize: 10.5, color: v4.neg, fontWeight: 600, padding: '1px 6px', background: '#fbe9e9', borderRadius: 999 }}>{c.d}</span>}
            {c.pos === undefined && <span style={{ fontFamily: v4.mono, fontSize: 10.5, color: v4.muted2 }}>{c.d}</span>}
          </div>
          <div style={{ fontFamily: v4.display, fontSize: 22, fontWeight: 600, color: v4.ink, marginTop: 8, letterSpacing: -0.4 }}>{c.v}</div>
          <div style={{ fontSize: 11, color: v4.muted, marginTop: 2 }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function V4DealList() {
  const ratingTint = (r) => r.startsWith('AAA') ? { bg: '#0a1f4a', fg: '#fff' } : r.startsWith('AA') ? { bg: v4.brand, fg: '#fff' } : r.startsWith('A') ? { bg: v4.brandSoft, fg: v4.brand2 } : { bg: '#fef3e2', fg: '#9a6010' };
  const statusBadge = { priced: { l: '확정', bg: '#e8f5ed', fg: v4.pos }, booking: { l: '수요예측', bg: '#fef3e2', fg: '#9a6010' }, pending: { l: '예정', bg: v4.bg, fg: v4.muted } };
  return (
    <div style={{ background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px', borderBottom: `1px solid ${v4.rule}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: v4.display, fontSize: 17, fontWeight: 600, color: v4.ink, letterSpacing: -0.2 }}>최근 공모채 발행</div>
          <div style={{ fontSize: 12, color: v4.muted, marginTop: 2 }}>회차별 · 청약일 내림차순 · 253개 회차</div>
        </div>
        <div style={{ display: 'flex', gap: 4, fontSize: 11.5, color: v4.muted }}>
          {['전체', 'AAA', 'AA', 'A', 'BBB↓'].map((f, i) => (
            <span key={f} style={{ padding: '5px 10px', borderRadius: 6, background: i === 0 ? v4.ink : 'transparent', color: i === 0 ? v4.paper : v4.muted, fontWeight: i === 0 ? 600 : 500 }}>{f}</span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12 }}>
        {DEALS.slice(0, 7).map((d, gi) => {
          const sb = statusBadge[d.status];
          return (
            <div key={gi} style={{ borderBottom: gi < 6 ? `1px solid ${v4.rule}` : 'none', padding: '14px 20px', display: 'grid', gridTemplateColumns: '1fr 220px 180px', gap: 16, alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: v4.display, fontSize: 15, fontWeight: 600, color: v4.ink }}>{d.issuer}</span>
                  <span style={{ fontSize: 10.5, color: sb.fg, fontWeight: 600, padding: '1px 7px', background: sb.bg, borderRadius: 999 }}>{sb.l}</span>
                  <span style={{ fontFamily: v4.mono, fontSize: 10.5, color: v4.muted2 }}>{d.tranches.length === 1 ? `${d.tranches[0].no}회` : `${d.tranches.length}개 트랜치`}</span>
                </div>
                <div style={{ fontSize: 11.5, color: v4.muted, marginTop: 5 }}>
                  <span style={{ fontFamily: v4.mono }}>{d.date}</span>
                  <span style={{ margin: '0 8px', color: v4.muted2 }}>·</span>
                  <span>{d.leads.join(', ')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {d.tranches.map((t, ti) => {
                  const rt = ratingTint(t.rating);
                  return (
                    <div key={ti} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 3px', background: v4.bg, borderRadius: 6, fontSize: 10.5 }}>
                      <span style={{ padding: '1px 5px', background: rt.bg, color: rt.fg, borderRadius: 4, fontFamily: v4.mono, fontWeight: 700, fontSize: 9.5 }}>{t.rating}</span>
                      <span style={{ color: v4.muted }}>{t.maturity.slice(0, 7).replace('-', '/')}</span>
                      <span style={{ fontFamily: v4.mono, color: v4.ink, fontWeight: 600 }}>{fmtNum(t.final || t.initial)}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: v4.display, fontSize: 18, fontWeight: 600, color: v4.ink, letterSpacing: -0.3 }}>
                  {fmtAmt(d.totalFinal || d.totalCap)}
                </div>
                <div style={{ fontSize: 10.5, color: v4.muted, marginTop: 1 }}>
                  {d.totalFinal ? '회차합산' : '발행한도'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '12px 20px', borderTop: `1px solid ${v4.rule}`, fontSize: 12.5, color: v4.muted, display: 'flex', justifyContent: 'space-between' }}>
        <span>7 / 253개 회차</span>
        <span style={{ color: v4.brand, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          전체 보기
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m-3-4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </div>
    </div>
  );
}

function V4LeagueCard() {
  const top = LEAGUE_TABLE.slice(0, 6);
  return (
    <div style={{ background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 12, padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: v4.display, fontSize: 17, fontWeight: 600, color: v4.ink, letterSpacing: -0.2 }}>주관 실적</div>
          <div style={{ fontSize: 11.5, color: v4.muted, marginTop: 2 }}>최근 1년 · 23개 증권사</div>
        </div>
        <span style={{ fontSize: 11, color: v4.brand, fontWeight: 600 }}>전체 →</span>
      </div>
      {top.map((l, i) => (
        <div key={l.rank} style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12, borderTop: i > 0 ? `1px solid ${v4.rule}` : 'none' }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: i < 3 ? v4.ink : v4.bg, color: i < 3 ? v4.paper : v4.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700, fontFamily: v4.mono }}>{l.rank}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: v4.ink }}>{l.house}</div>
            <div style={{ fontFamily: v4.mono, fontSize: 10.5, color: v4.muted, marginTop: 1 }}>{fmtAmtShort(l.amount)}억 · {l.deals}건</div>
          </div>
          <div style={{ width: 64, textAlign: 'right' }}>
            <div style={{ fontFamily: v4.display, fontSize: 14, fontWeight: 600, color: v4.ink }}>{l.share}<span style={{ fontSize: 10, color: v4.muted }}>%</span></div>
            <div style={{ marginTop: 3, height: 2, background: v4.rule, borderRadius: 1, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${l.share / 25 * 100}%`, background: i < 3 ? v4.brand : v4.muted2, borderRadius: 1 }}/>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function V4PipelineCard() {
  const items = [
    { d: '5/21', t: '두산로보틱스', x: 'IPO 수요예측', a: '4,200억', tag: 'IPO', tc: v4.brand },
    { d: '5/22', t: '하나금융지주', x: '19회 신종자본 청약', a: '4,000억', tag: 'DCM', tc: v4.accent },
    { d: '5/23', t: 'HD현대마린', x: '유상증자 청약', a: '6,800억', tag: 'ECM', tc: v4.pos },
    { d: '5/26', t: '신세계', x: '146회차 수요예측', a: '4,000억', tag: 'DCM', tc: v4.accent },
  ];
  return (
    <div style={{ background: v4.paper, border: `1px solid ${v4.rule}`, borderRadius: 12, padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: v4.display, fontSize: 17, fontWeight: 600, color: v4.ink, letterSpacing: -0.2 }}>이번 주 캘린더</div>
          <div style={{ fontSize: 11.5, color: v4.muted, marginTop: 2 }}>예정된 발행 · 청약 일정</div>
        </div>
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12, borderTop: i > 0 ? `1px solid ${v4.rule}` : 'none' }}>
          <div style={{ width: 36, fontFamily: v4.mono, fontSize: 11, color: v4.muted, fontWeight: 600 }}>{it.d}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: v4.ink }}>{it.t}</span>
              <span style={{ fontSize: 9.5, color: it.tc, fontWeight: 700, letterSpacing: 0.5, padding: '1px 5px', background: '#fafafa', border: `1px solid ${v4.rule}`, borderRadius: 3 }}>{it.tag}</span>
            </div>
            <div style={{ fontSize: 11, color: v4.muted, marginTop: 2 }}>{it.x}</div>
          </div>
          <div style={{ fontFamily: v4.mono, fontSize: 12, color: v4.ink, fontWeight: 600 }}>{it.a}</div>
        </div>
      ))}
    </div>
  );
}

function V4Footer() {
  return (
    <div style={{ borderTop: `1px solid ${v4.rule}`, padding: '20px 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: v4.muted, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 20 }}>
        <span style={{ fontFamily: v4.display, fontWeight: 600, color: v4.ink }}>DealList</span>
        <span>출처: 금융감독원 DART</span>
        <span>본 정보는 참고용이며 투자 판단의 근거가 될 수 없습니다.</span>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <span>데이터 안내</span><span>API</span><span>문의</span>
      </div>
    </div>
  );
}

window.V4Minimal = V4Minimal;
