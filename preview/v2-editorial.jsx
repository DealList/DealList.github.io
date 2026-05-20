// V2 — Editorial Modern. Pitchbook/Dealogic-inspired:
// light, generous, serif headlines, blue accent, real data front and center.

const v2 = {
  bg: '#fafaf7',
  ink: '#0d1b2a',
  ink2: '#1f2d3d',
  paper: '#ffffff',
  rule: '#e3e1da',
  rule2: '#c7c3b8',
  muted: '#6b7280',
  muted2: '#9aa0a6',
  brand: '#0a2540',     // deep navy headline
  brandA: '#1e4caf',    // active blue
  accent: '#c1995a',    // muted gold
  pos: '#0a7b4f',
  neg: '#b13838',
  tag: '#eef2f7',
  font: '"Pretendard", -apple-system, sans-serif',
  serif: '"Source Serif 4", "Noto Serif KR", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

function V2Editorial() {
  const s = useSummary();
  return (
    <div style={{ width: '100%', height: '100%', background: v2.bg, color: v2.ink, fontFamily: v2.font, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <V2Header />
      <V2Masthead s={s} />
      <V2KPIRow s={s} />
      <V2FilterBar />
      <V2Main />
      <V2Footer />
    </div>
  );
}

function V2Header() {
  return (
    <div style={{ background: v2.paper, borderBottom: `1px solid ${v2.rule}`, padding: '0 40px', height: 56, display: 'flex', alignItems: 'center', gap: 32, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ width: 26, height: 26, background: v2.brand, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: v2.serif, fontWeight: 700, fontSize: 15, fontStyle: 'italic' }}>D</div>
        <div style={{ fontFamily: v2.serif, fontWeight: 600, fontSize: 18, color: v2.brand, letterSpacing: -0.3 }}>DealList</div>
        <div style={{ marginLeft: 4, fontSize: 11, color: v2.muted2, letterSpacing: 1, textTransform: 'uppercase' }}>Korea Capital Market</div>
      </div>
      <div style={{ display: 'flex', gap: 22, fontSize: 13, color: v2.ink2, fontWeight: 500 }}>
        {[
          ['Markets', false], ['DCM', true], ['ECM', false], ['League', false], ['Analytics', false], ['Calendar', false],
        ].map(([t, a]) => (
          <div key={t} style={{ position: 'relative', padding: '20px 0', color: a ? v2.brandA : v2.ink2, cursor: 'pointer' }}>
            {t}
            {a && <div style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: v2.brandA }}/>}
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }}></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: v2.muted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: v2.tag, borderRadius: 999 }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke={v2.ink} strokeWidth="1.5"/><path d="m14 14-3-3" stroke={v2.ink} strokeWidth="1.5" strokeLinecap="round"/></svg>
          <span style={{ color: v2.muted2 }}>발행사, 주관사 검색…</span>
          <span style={{ marginLeft: 12, padding: '1px 5px', background: v2.paper, border: `1px solid ${v2.rule}`, borderRadius: 3, fontFamily: v2.mono, fontSize: 10 }}>⌘K</span>
        </div>
        <div style={{ padding: '6px 12px', border: `1px solid ${v2.rule2}`, borderRadius: 4, fontSize: 12, color: v2.ink, fontWeight: 500 }}>Excel</div>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: v2.brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>JK</div>
      </div>
    </div>
  );
}

function V2Masthead({ s }) {
  return (
    <div style={{ background: v2.paper, padding: '32px 40px 24px', borderBottom: `1px solid ${v2.rule}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
        <div>
          <div style={{ fontSize: 11, color: v2.accent, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Debt Capital Markets · 공모채</div>
          <div style={{ fontFamily: v2.serif, fontSize: 44, fontWeight: 600, color: v2.brand, letterSpacing: -1, lineHeight: 1, marginBottom: 8 }}>
            발행 정보·실적·인포그래픽 <span style={{ fontStyle: 'italic', color: v2.accent, fontWeight: 500 }}>한 곳에서</span>
          </div>
          <div style={{ fontFamily: v2.serif, fontSize: 15, color: v2.muted, fontStyle: 'italic', fontWeight: 400 }}>
            금융감독원 DART 공시 기반 · 회차별 트랜치 단위 데이터 · 매일 21:00 KST 갱신
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: v2.muted, lineHeight: 1.6, fontFamily: v2.mono }}>
          <div>{s.as_of} 업데이트 {s._source === 'live' && <span style={{ color: v2.pos }}>● LIVE</span>}</div>
          <div>전체 <span style={{ color: v2.ink, fontWeight: 600 }}>{s.total_records.toLocaleString()}</span> 건</div>
          <div>조회 기간 {s.range_label}</div>
        </div>
      </div>
    </div>
  );
}

function V2KPIRow({ s }) {
  const kpis = [
    { l: '조회 기간 발행건수', v: s.range_count.toLocaleString(), unit: '건', sub: '회차 기준', extra: `회차 합산 ${s.range_tranche_count}건` },
    { l: '조회 기간 발행총액', v: fmtAmt(s.range_amount).replace(/억$/, ''), unit: '억', sub: '트랜치 합산', extra: `회차당 평균 ${s.range_avg_size.toLocaleString()}억` },
    { l: '주관 1위', v: brokerFull(s.this_year_top_broker), unit: '', sub: `${fmtAmt(s.this_year_top_amount)}`, extra: `점유율 ${s.this_year_top_share}%`, highlight: true },
    { l: '인수 1위', v: brokerFull(s.this_year_underwriter_broker), unit: '', sub: `${fmtAmt(s.this_year_underwriter_amount)}`, extra: `점유율 ${s.this_year_underwriter_share}%` },
    { l: '최대 단일 발행', v: fmtNum(s.this_year_biggest_amount), unit: '억', sub: `${s.this_year_biggest_issuer} ${s.this_year_biggest_series}회차`, extra: s.this_year_biggest_date },
  ];
  return (
    <div style={{ background: v2.paper, padding: '0 40px', borderBottom: `1px solid ${v2.rule}`, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', flexShrink: 0 }}>
      {kpis.map((k, i) => (
        <div key={i} style={{ padding: '20px 24px 22px', borderRight: i < 4 ? `1px solid ${v2.rule}` : 'none', position: 'relative' }}>
          <div style={{ fontSize: 11, color: v2.muted, fontWeight: 500, marginBottom: 8 }}>{k.l}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: v2.serif, fontSize: 26, fontWeight: 600, color: k.highlight ? v2.brandA : v2.ink, letterSpacing: -0.5 }}>{k.v}</span>
            {k.unit && <span style={{ fontFamily: v2.serif, fontSize: 13, color: v2.muted }}>{k.unit}</span>}
          </div>
          <div style={{ fontSize: 11, color: v2.ink2, marginTop: 6, fontWeight: 500 }}>{k.sub}</div>
          <div style={{ fontSize: 10.5, color: v2.muted2, marginTop: 2 }}>{k.extra}</div>
        </div>
      ))}
    </div>
  );
}

function V2FilterBar() {
  const Pill = ({ label, value, active }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
      background: active ? v2.brand : v2.paper, color: active ? '#fff' : v2.ink2,
      border: `1px solid ${active ? v2.brand : v2.rule2}`, borderRadius: 3, fontSize: 12, fontWeight: 500,
    }}>
      <span style={{ opacity: active ? 0.7 : 0.6, fontSize: 11 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
      <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
    </div>
  );
  return (
    <div style={{ background: v2.bg, padding: '14px 40px', borderBottom: `1px solid ${v2.rule}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 11, color: v2.muted, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginRight: 4 }}>Filter</span>
      <Pill label="기간" value="최근 1년" active />
      <Pill label="발행사" value="전체" />
      <Pill label="종류" value="무보증" />
      <Pill label="신용등급" value="AA− ~ AAA" />
      <Pill label="주관사" value="전체" />
      <div style={{ flex: 1 }}></div>
      <div style={{ fontSize: 11, color: v2.muted }}>표시 중 <span style={{ color: v2.ink, fontWeight: 600 }}>490건 / 253개 회차</span></div>
      <div style={{ padding: '6px 12px', border: `1px solid ${v2.rule2}`, borderRadius: 3, fontSize: 11, color: v2.ink2 }}>초기화</div>
      <div style={{ padding: '6px 14px', background: v2.brandA, color: '#fff', borderRadius: 3, fontSize: 12, fontWeight: 600 }}>조회</div>
    </div>
  );
}

function V2Main() {
  return (
    <div style={{ padding: '24px 40px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 28, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <V2VolumeChart />
        <V2DealList />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <V2LeagueTable />
        <V2TypeMix />
      </div>
    </div>
  );
}

function V2VolumeChart() {
  const max = Math.max(...MONTHLY_VOLUME.map(m => m.v));
  const W = 740, H = 180, padL = 44, padR = 12, padT = 16, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = innerW / MONTHLY_VOLUME.length * 0.66;
  const linePts = MONTHLY_VOLUME.map((m, i) => {
    const x = padL + (i + 0.5) * (innerW / MONTHLY_VOLUME.length);
    const y = padT + innerH - (m.v / max) * innerH;
    return [x, y];
  });
  return (
    <div style={{ background: v2.paper, border: `1px solid ${v2.rule}`, borderRadius: 4, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: v2.accent, letterSpacing: 1.5, fontWeight: 600, textTransform: 'uppercase' }}>① 월별 발행 추이</div>
          <div style={{ fontFamily: v2.serif, fontSize: 22, fontWeight: 600, color: v2.brand, marginTop: 4 }}>지난 12개월 발행 동향</div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: v2.muted, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 12, height: 8, background: v2.brandA, opacity: 0.5 }}/>건수</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 12, height: 2, background: v2.brand }}/>발행총액(억원)</div>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const y = padT + innerH * (1 - p);
          return <g key={p}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v2.rule} strokeWidth={p === 0 ? 1 : 0.5} strokeDasharray={p === 0 ? '' : '2 4'}/>
            <text x={padL - 8} y={y + 3} fontSize="10" fontFamily={v2.mono} fill={v2.muted2} textAnchor="end">{Math.round(max * p / 1000)}k</text>
          </g>;
        })}
        {MONTHLY_VOLUME.map((m, i) => {
          const x = padL + (i + 0.17) * (innerW / MONTHLY_VOLUME.length);
          const h = (m.v / max) * innerH;
          const y = padT + innerH - h;
          return <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={v2.brandA} opacity={0.18} rx={1}/>
            <text x={x + bw/2} y={H - 10} fontSize="9.5" fontFamily={v2.mono} fill={v2.muted2} textAnchor="middle">{m.m}</text>
          </g>;
        })}
        <polyline points={linePts.map(p => p.join(',')).join(' ')} fill="none" stroke={v2.brand} strokeWidth="1.8"/>
        {linePts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.5" fill={v2.paper} stroke={v2.brand} strokeWidth="1.5"/>)}
      </svg>
    </div>
  );
}

function V2DealList() {
  const ratingTint = (r) => r.startsWith('AAA') ? { bg: '#0a2540', fg: '#fff' } : r.startsWith('AA') ? { bg: '#1e4caf', fg: '#fff' } : r.startsWith('A') ? { bg: '#eef2f7', fg: '#0a2540' } : { bg: '#fef3e2', fg: '#9a6010' };
  const statusLabel = { priced: '확정', booking: '수요예측', pending: '예정' };
  const statusColor = { priced: v2.pos, booking: v2.accent, pending: v2.muted2 };
  return (
    <div style={{ background: v2.paper, border: `1px solid ${v2.rule}`, borderRadius: 4 }}>
      <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${v2.rule}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: v2.accent, letterSpacing: 1.5, fontWeight: 600, textTransform: 'uppercase' }}>② 발행 정보</div>
          <div style={{ fontFamily: v2.serif, fontSize: 22, fontWeight: 600, color: v2.brand, marginTop: 4 }}>최근 공모채 발행 내역</div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: v2.muted }}>
          <span>회차 기준</span>
          <span style={{ color: v2.brandA, fontWeight: 600 }}>청약일 ▼</span>
          <span>발행사</span>
          <span>금액</span>
        </div>
      </div>
      <div style={{ fontSize: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 80px 140px 90px 100px 100px', padding: '10px 24px', background: '#fbfaf6', borderBottom: `1px solid ${v2.rule}`, fontSize: 10.5, color: v2.muted, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          <div>청약일</div><div>발행사 · 회차</div><div>등급</div><div>만기 · 종류</div><div style={{ textAlign: 'right' }}>최초모집</div><div style={{ textAlign: 'right' }}>최종발행</div><div style={{ textAlign: 'right' }}>최종금리</div>
        </div>
        {DEALS.slice(0, 7).map((d, gi) => (
          <div key={gi} style={{ borderBottom: gi < 6 ? `1px solid ${v2.rule}` : 'none' }}>
            {d.tranches.map((t, ti) => {
              const rt = ratingTint(t.rating);
              return (
                <div key={ti} style={{
                  display: 'grid', gridTemplateColumns: '92px 1fr 80px 140px 90px 100px 100px',
                  padding: '12px 24px', alignItems: 'center',
                  borderTop: ti === 0 ? 'none' : `1px dashed ${v2.rule}`,
                }}>
                  <div style={{ fontFamily: v2.mono, fontSize: 11.5, color: ti === 0 ? v2.ink2 : 'transparent' }}>{d.date}</div>
                  <div>
                    {ti === 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: statusColor[d.status] }}/>
                        <span style={{ fontFamily: v2.serif, fontSize: 14, fontWeight: 600, color: v2.ink }}>{d.issuer}</span>
                        <span style={{ fontSize: 10, color: statusColor[d.status], fontWeight: 600, padding: '1px 6px', background: '#f5f3eb', borderRadius: 2 }}>{statusLabel[d.status]}</span>
                      </div>
                    )}
                    <div style={{ fontFamily: v2.mono, fontSize: 11, color: v2.muted, marginTop: ti === 0 ? 2 : 0 }}>{t.no}회차 · {d.leads.slice(0, 2).join(', ')}{d.leads.length > 2 ? ` 외 ${d.leads.length-2}` : ''}</div>
                  </div>
                  <div>
                    <span style={{ display: 'inline-block', padding: '2px 7px', background: rt.bg, color: rt.fg, borderRadius: 2, fontFamily: v2.mono, fontSize: 11, fontWeight: 700 }}>{t.rating}</span>
                  </div>
                  <div style={{ fontFamily: v2.mono, fontSize: 11, color: v2.ink2 }}>
                    <div>{t.maturity}</div>
                    <div style={{ fontSize: 10, color: v2.muted, marginTop: 1 }}>{t.type}</div>
                  </div>
                  <div style={{ fontFamily: v2.mono, fontSize: 12.5, color: v2.ink, textAlign: 'right' }}>{fmtNum(t.initial)}<span style={{ fontSize: 10, color: v2.muted2 }}> 억</span></div>
                  <div style={{ fontFamily: v2.mono, fontSize: 12.5, color: t.final ? v2.ink : v2.muted2, textAlign: 'right', fontWeight: t.final ? 600 : 400 }}>{fmtNum(t.final)}{t.final && <span style={{ fontSize: 10, color: v2.muted2, fontWeight: 400 }}> 억</span>}</div>
                  <div style={{ fontFamily: v2.mono, fontSize: 12, color: t.finalYield ? v2.brandA : v2.muted2, textAlign: 'right', fontWeight: 600 }}>{t.finalYield || t.guidance}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ padding: '12px 24px', borderTop: `1px solid ${v2.rule}`, fontSize: 12, color: v2.muted, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>1–7 / 253개 회차</span>
        <span style={{ color: v2.brandA, fontWeight: 600 }}>전체 보기 →</span>
      </div>
    </div>
  );
}

function V2LeagueTable() {
  const top = LEAGUE_TABLE.slice(0, 6);
  return (
    <div style={{ background: v2.paper, border: `1px solid ${v2.rule}`, borderRadius: 4, padding: '20px 24px' }}>
      <div style={{ fontSize: 11, color: v2.accent, letterSpacing: 1.5, fontWeight: 600, textTransform: 'uppercase' }}>③ 주관 실적</div>
      <div style={{ fontFamily: v2.serif, fontSize: 18, fontWeight: 600, color: v2.brand, marginTop: 4, marginBottom: 4 }}>League Table</div>
      <div style={{ fontFamily: v2.serif, fontSize: 12, color: v2.muted, fontStyle: 'italic', marginBottom: 14 }}>최근 1년 · 23개 증권사</div>
      {top.map((l, i) => (
        <div key={l.rank} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i === 0 ? `1px solid ${v2.rule}` : `1px solid ${v2.rule}` }}>
          <div style={{ width: 18, fontFamily: v2.serif, fontSize: 17, fontWeight: 600, color: i < 3 ? v2.brand : v2.muted2, textAlign: 'right' }}>{l.rank}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, color: v2.ink, fontWeight: 600 }}>{l.house}</span>
              <span style={{ fontFamily: v2.mono, fontSize: 11, color: v2.ink2 }}>{l.share}<span style={{ color: v2.muted2 }}>%</span></span>
            </div>
            <div style={{ marginTop: 4, height: 3, background: '#f0eee5', borderRadius: 0, position: 'relative' }}>
              <div style={{ height: '100%', width: `${l.share / 25 * 100}%`, background: i < 3 ? v2.brand : v2.brandA }}/>
            </div>
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontFamily: v2.mono, fontSize: 10, color: v2.muted }}>
              <span>{l.deals}건</span>
              <span>{fmtAmtShort(l.amount)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function V2TypeMix() {
  const types = [
    { l: '무보증', c: 198, color: v2.brand },
    { l: '신종자본', c: 28, color: v2.brandA },
    { l: '후순위', c: 14, color: v2.accent },
    { l: '보증', c: 6, color: v2.muted2 },
  ];
  const total = types.reduce((a, b) => a + b.c, 0);
  let offset = 0;
  const R = 56, cx = 70, cy = 70, sw = 16;
  return (
    <div style={{ background: v2.paper, border: `1px solid ${v2.rule}`, borderRadius: 4, padding: '20px 24px' }}>
      <div style={{ fontSize: 11, color: v2.accent, letterSpacing: 1.5, fontWeight: 600, textTransform: 'uppercase' }}>④ 종류별 분포</div>
      <div style={{ fontFamily: v2.serif, fontSize: 18, fontWeight: 600, color: v2.brand, marginTop: 4, marginBottom: 14 }}>발행 종류 (건수)</div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          {types.map((t, i) => {
            const frac = t.c / total;
            const dash = frac * 2 * Math.PI * R;
            const gap = 2 * Math.PI * R - dash;
            const rot = (offset / total) * 360 - 90;
            offset += t.c;
            return (
              <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={t.color} strokeWidth={sw}
                strokeDasharray={`${dash} ${gap}`} transform={`rotate(${rot} ${cx} ${cy})`}/>
            );
          })}
          <text x={cx} y={cy - 4} textAnchor="middle" fontFamily={v2.serif} fontSize="22" fontWeight="600" fill={v2.brand}>{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill={v2.muted}>건</text>
        </svg>
        <div style={{ flex: 1 }}>
          {types.map(t => (
            <div key={t.l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 }}>
              <div style={{ width: 8, height: 8, background: t.color, borderRadius: 1 }}/>
              <span style={{ color: v2.ink2, flex: 1 }}>{t.l}</span>
              <span style={{ fontFamily: v2.mono, color: v2.ink, fontWeight: 600 }}>{t.c}</span>
              <span style={{ fontFamily: v2.mono, color: v2.muted2, fontSize: 10, width: 36, textAlign: 'right' }}>{(t.c/total*100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function V2Footer() {
  return (
    <div style={{ background: v2.paper, borderTop: `1px solid ${v2.rule}`, padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: v2.muted }}>
      <div style={{ display: 'flex', gap: 20 }}>
        <span style={{ fontFamily: v2.serif, fontStyle: 'italic', color: v2.brand, fontWeight: 600 }}>DealList</span>
        <span>출처: 금융감독원 DART</span>
        <span>본 정보는 참고용이며 투자 판단의 근거가 될 수 없습니다.</span>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <span>데이터 안내</span><span>API</span><span>문의</span>
      </div>
    </div>
  );
}

window.V2Editorial = V2Editorial;
