// V1 — Terminal Pro (Dark). Bloomberg-inspired: dense, mono, signal colors.

const v1 = {
  bg: '#0a0e14',
  panel: '#10151d',
  panel2: '#161c26',
  border: '#1f2731',
  borderHi: '#2a3441',
  text: '#e6e9ef',
  dim: '#8a93a3',
  dim2: '#5a6373',
  amber: '#ffb547',
  green: '#39d98a',
  red: '#ff5a5a',
  cyan: '#5ec8ff',
  blue: '#5e88ff',
  font: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontUI: 'Pretendard, -apple-system, sans-serif',
};

function V1Terminal() {
  const s = useSummary();
  return (
    <div style={{
      width: '100%', height: '100%', background: v1.bg, color: v1.text,
      fontFamily: v1.fontUI, fontSize: 12, display: 'flex', flexDirection: 'column',
    }}>
      <V1TopBar />
      <V1TickerTape />
      <V1CommandBar />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 1, background: v1.border, minHeight: 0 }}>
        <V1LeftRail />
        <V1Main s={s} />
        <V1RightRail />
      </div>
      <V1StatusBar s={s} />
    </div>
  );
}

function V1TopBar() {
  return (
    <div style={{
      height: 44, background: '#06090d', borderBottom: `1px solid ${v1.border}`,
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 24, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 22, height: 22, background: v1.amber, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: v1.font, fontSize: 13, fontWeight: 700, color: '#06090d' }}>DL</div>
        <div style={{ fontFamily: v1.font, fontSize: 13, fontWeight: 600, letterSpacing: 1.2 }}>DEALLIST<span style={{ color: v1.amber }}>·</span><span style={{ color: v1.dim }}>TERMINAL</span></div>
      </div>
      <div style={{ display: 'flex', gap: 0, marginLeft: 8 }}>
        {['MARKET', 'DCM', 'ECM', 'LEAGUE', 'CALENDAR', 'ANALYTICS'].map((t, i) => (
          <div key={t} style={{
            padding: '6px 14px', fontFamily: v1.font, fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
            color: i === 1 ? v1.amber : v1.dim, borderBottom: i === 1 ? `2px solid ${v1.amber}` : '2px solid transparent', cursor: 'pointer',
          }}>{t}</div>
        ))}
      </div>
      <div style={{ flex: 1 }}></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: v1.font, fontSize: 11, color: v1.dim }}>
        <span style={{ color: v1.green }}>●</span> LIVE
        <span style={{ color: v1.dim2 }}>|</span>
        <span>2026-05-20 14:32:08 KST</span>
        <span style={{ color: v1.dim2 }}>|</span>
        <span>KRW/USD <span style={{ color: v1.text }}>1,371.20</span> <span style={{ color: v1.green }}>+0.12%</span></span>
      </div>
    </div>
  );
}

function V1TickerTape() {
  const ticks = [
    { l: '국고 3Y', v: '3.241', d: '-0.012', up: false },
    { l: '국고 10Y', v: '3.518', d: '+0.008', up: true },
    { l: '회사채 AA-(3Y)', v: '4.142', d: '-0.018', up: false },
    { l: 'KOSPI', v: '2,748.32', d: '+18.40', up: true },
    { l: 'KOSDAQ', v: '781.05', d: '-2.18', up: false },
    { l: 'CDS 5Y', v: '34.5bp', d: '-0.8', up: false },
    { l: 'WTI', v: '78.42', d: '+1.12', up: true },
  ];
  return (
    <div style={{ height: 28, background: '#06090d', borderBottom: `1px solid ${v1.border}`, display: 'flex', alignItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ padding: '0 12px', fontFamily: v1.font, fontSize: 10, fontWeight: 700, color: v1.amber, letterSpacing: 1, borderRight: `1px solid ${v1.border}`, height: '100%', display: 'flex', alignItems: 'center' }}>LIVE ▸</div>
      <div style={{ display: 'flex', gap: 28, padding: '0 20px', fontFamily: v1.font, fontSize: 11 }}>
        {ticks.map(t => (
          <div key={t.l} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ color: v1.dim, fontWeight: 500 }}>{t.l}</span>
            <span style={{ color: v1.text, fontWeight: 600 }}>{t.v}</span>
            <span style={{ color: t.up ? v1.green : v1.red, fontSize: 10 }}>{t.up ? '▲' : '▼'}{t.d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function V1CommandBar() {
  return (
    <div style={{ height: 36, background: v1.panel, borderBottom: `1px solid ${v1.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, flexShrink: 0 }}>
      <div style={{ fontFamily: v1.font, fontSize: 10, color: v1.amber, fontWeight: 700, letterSpacing: 1 }}>CMD ›</div>
      <div style={{ flex: 1, height: 22, background: v1.bg, border: `1px solid ${v1.borderHi}`, borderRadius: 2, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8, fontFamily: v1.font, fontSize: 11 }}>
        <span style={{ color: v1.amber }}>DCM</span>
        <span style={{ color: v1.dim2 }}>›</span>
        <span style={{ color: v1.text }}>RATING:AA+ AMOUNT&gt;2000 LEAD:KB</span>
        <span style={{ width: 1, height: 12, background: v1.amber, animation: 'blink 1s infinite' }}></span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {['F1 HELP', 'F2 EXPORT', 'F3 ALERT', 'F4 WATCH'].map(b => (
          <div key={b} style={{ padding: '4px 8px', fontFamily: v1.font, fontSize: 10, color: v1.dim, border: `1px solid ${v1.border}`, borderRadius: 2 }}>{b}</div>
        ))}
      </div>
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}

function V1LeftRail() {
  const sections = [
    { t: 'WATCHLIST', items: [
      ['LG에너지솔루션 5-1', '8,000억', 'priced', v1.green],
      ['신한금융 78-1', '2,000억', 'priced', v1.green],
      ['두산로보틱스 IPO', '4,200억', 'book', v1.amber],
      ['HD현대마린', '6,800억', 'sub', v1.cyan],
    ]},
    { t: 'NAVIGATION', items: [
      ['› 회사채 발행', '', '', ''], ['› 주관·인수 실적', '', '', ''],
      ['› IPO·유상증자', '', '', ''], ['› 인포그래픽', '', '', ''],
      ['› 캘린더', '', '', ''], ['› 알림 설정', '', '', ''],
    ]},
  ];
  return (
    <div style={{ background: v1.panel, padding: 0, overflow: 'auto' }}>
      {sections.map(sec => (
        <div key={sec.t}>
          <div style={{ padding: '8px 12px 6px', fontFamily: v1.font, fontSize: 10, color: v1.amber, fontWeight: 700, letterSpacing: 1.2, borderBottom: `1px solid ${v1.border}` }}>{sec.t}</div>
          {sec.items.map((it, i) => (
            <div key={i} style={{ padding: '7px 12px', fontFamily: v1.fontUI, fontSize: 11, color: v1.text, borderBottom: `1px solid ${v1.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{it[0]}</span>
              {it[1] && (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: v1.font, fontSize: 10 }}>
                  <span style={{ color: v1.dim }}>{it[1]}</span>
                  <span style={{ color: it[3], fontSize: 8 }}>●</span>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function V1Main({ s }) {
  return (
    <div style={{ background: v1.bg, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: v1.border }}>
        {[
          { l: '1Y VOLUME', v: fmtAmt(s.range_amount), d: `${s.range_tranche_count}회차`, dn: null, sub: `${s.range_label} · ${s.range_count} deals` },
          { l: 'AVG SIZE', v: `${s.range_avg_size.toLocaleString()}억`, d: '회차 평균', dn: null, sub: 'tranche basis' },
          { l: 'LEAGUE #1', v: brokerFull(s.this_year_top_broker), d: `${s.this_year_top_share}%`, dn: null, sub: `${fmtAmt(s.this_year_top_amount)}` },
          { l: 'LARGEST', v: s.this_year_biggest_issuer, d: `${fmtNum(s.this_year_biggest_amount)}억`, dn: null, sub: `${s.this_year_biggest_series}회차 · ${s.this_year_biggest_date}` },
        ].map(k => (
          <div key={k.l} style={{ background: v1.panel, padding: '12px 14px' }}>
            <div style={{ fontFamily: v1.font, fontSize: 9, color: v1.dim2, fontWeight: 700, letterSpacing: 1.2, marginBottom: 6 }}>{k.l}</div>
            <div style={{ fontFamily: v1.font, fontSize: 19, fontWeight: 700, color: v1.text, letterSpacing: -0.2 }}>{k.v}</div>
            <div style={{ marginTop: 6, fontFamily: v1.font, fontSize: 10, color: k.dn === null ? v1.amber : (k.dn ? v1.red : v1.green) }}>
              {k.d} <span style={{ color: v1.dim2 }}>· {k.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <V1VolumeChart />

      {/* DCM table */}
      <div style={{ flex: 1, background: v1.panel, borderTop: `1px solid ${v1.border}`, overflow: 'auto', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${v1.border}`, gap: 16 }}>
          <div style={{ fontFamily: v1.font, fontSize: 11, color: v1.amber, fontWeight: 700, letterSpacing: 1 }}>DCM ▸ PRICED DEALS</div>
          <div style={{ fontFamily: v1.font, fontSize: 10, color: v1.dim }}>LAST 30 DAYS · 47 records · sort: DATE ▼</div>
          <div style={{ flex: 1 }}></div>
          <div style={{ display: 'flex', gap: 8, fontFamily: v1.font, fontSize: 10 }}>
            {['ALL', 'AAA', 'AA', 'A'].map((f, i) => (
              <div key={f} style={{ padding: '3px 8px', border: `1px solid ${i === 0 ? v1.amber : v1.border}`, borderRadius: 2, color: i === 0 ? v1.amber : v1.dim }}>{f}</div>
            ))}
          </div>
        </div>
        <V1DealTable />
      </div>
    </div>
  );
}

function V1VolumeChart() {
  const max = Math.max(...MONTHLY_VOLUME.map(m => m.v));
  const W = 880, H = 110, padL = 50, padR = 16, padT = 12, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = innerW / MONTHLY_VOLUME.length * 0.7;
  return (
    <div style={{ background: v1.panel, padding: '10px 14px', borderTop: `1px solid ${v1.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <div style={{ fontFamily: v1.font, fontSize: 10, color: v1.amber, fontWeight: 700, letterSpacing: 1 }}>VOLUME · 12M</div>
        <div style={{ fontFamily: v1.font, fontSize: 10, color: v1.dim }}>억원 · monthly issuance</div>
        <div style={{ flex: 1 }}></div>
        <div style={{ fontFamily: v1.font, fontSize: 10, color: v1.dim }}>avg <span style={{ color: v1.text }}>37,939</span> · σ <span style={{ color: v1.text }}>10,452</span></div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[0, 0.5, 1].map(p => {
          const y = padT + innerH * (1 - p);
          return <g key={p}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v1.border} strokeDasharray={p === 0 ? '' : '2 3'} strokeWidth={p === 0 ? 1 : 0.5}/>
            <text x={padL - 6} y={y + 3} fontSize="9" fontFamily={v1.font} fill={v1.dim2} textAnchor="end">{Math.round(max * p / 1000)}k</text>
          </g>;
        })}
        {MONTHLY_VOLUME.map((m, i) => {
          const x = padL + (i + 0.15) * (innerW / MONTHLY_VOLUME.length);
          const h = (m.v / max) * innerH;
          const y = padT + innerH - h;
          const isLast = i === MONTHLY_VOLUME.length - 1;
          return <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={isLast ? v1.amber : v1.cyan} opacity={isLast ? 1 : 0.7}/>
            <text x={x + bw/2} y={H - 8} fontSize="9" fontFamily={v1.font} fill={v1.dim2} textAnchor="middle">{m.m}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

function V1DealTable() {
  const ratingColor = (r) => r.startsWith('AAA') ? v1.cyan : r.startsWith('AA') ? v1.green : r.startsWith('A') ? v1.amber : v1.red;
  const statusColor = (s) => s === 'priced' ? v1.green : s === 'booking' ? v1.amber : v1.cyan;
  // Column widths
  const cw = { date: 84, issuer: 110, tr: 50, type: 56, rtg: 44, mat: 86, init: 60, cap: 60, book: 60, fin: 60, yld: 62, leads: 0 };
  const HeadCell = ({ w, children, num, sub }) => (
    <div style={{ width: w || undefined, flex: w ? undefined : 1, textAlign: num ? 'right' : 'left', padding: '0 6px' }}>
      <div>{children}</div>
      {sub && <div style={{ color: v1.dim2, fontSize: 8, fontWeight: 500, marginTop: 1 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ fontFamily: v1.font, fontSize: 10.5 }}>
      <div style={{ display: 'flex', padding: '6px 12px', borderBottom: `1px solid ${v1.borderHi}`, background: '#0c1118', color: v1.dim, fontSize: 9, letterSpacing: 0.8, fontWeight: 700 }}>
        <HeadCell w={cw.date}>청약일</HeadCell>
        <HeadCell w={cw.issuer}>발행사</HeadCell>
        <HeadCell w={cw.tr}>회차</HeadCell>
        <HeadCell w={cw.type}>종류</HeadCell>
        <HeadCell w={cw.rtg}>등급</HeadCell>
        <HeadCell w={cw.mat}>만기</HeadCell>
        <HeadCell w={cw.init} num sub="억">최초모집</HeadCell>
        <HeadCell w={cw.cap} num sub="억">발행한도</HeadCell>
        <HeadCell w={cw.book} num sub="억">수요예측</HeadCell>
        <HeadCell w={cw.fin} num sub="억">최종발행</HeadCell>
        <HeadCell w={cw.yld} num>최종금리</HeadCell>
        <HeadCell w={cw.leads}>주관사</HeadCell>
      </div>
      {DEALS.map((d, gi) => {
        const groupBg = gi % 2 === 0 ? v1.panel : v1.panel2;
        return (
          <div key={gi} style={{ borderBottom: `1px solid ${v1.borderHi}`, background: groupBg }}>
            {d.tranches.map((t, ti) => (
              <div key={ti} style={{ display: 'flex', padding: '6px 12px', alignItems: 'center', borderTop: ti === 0 ? 'none' : `1px dashed ${v1.border}` }}>
                <div style={{ width: cw.date, padding: '0 6px', color: ti === 0 ? v1.text : 'transparent' }}>{d.date}</div>
                <div style={{ width: cw.issuer, padding: '0 6px', fontFamily: v1.fontUI, fontSize: 11.5, fontWeight: ti === 0 ? 600 : 400, color: ti === 0 ? v1.text : 'transparent' }}>{d.issuer}</div>
                <div style={{ width: cw.tr, padding: '0 6px', color: v1.dim }}>{t.no}</div>
                <div style={{ width: cw.type, padding: '0 6px', color: v1.dim, fontFamily: v1.fontUI, fontSize: 11 }}>{t.type}</div>
                <div style={{ width: cw.rtg, padding: '0 6px', color: ratingColor(t.rating), fontWeight: 700 }}>{t.rating}</div>
                <div style={{ width: cw.mat, padding: '0 6px', color: v1.dim }}>{t.maturity}</div>
                <div style={{ width: cw.init, padding: '0 6px', textAlign: 'right', color: v1.text }}>{fmtNum(t.initial)}</div>
                <div style={{ width: cw.cap, padding: '0 6px', textAlign: 'right', color: v1.dim }}>{ti === 0 ? fmtNum(d.totalCap) : ''}</div>
                <div style={{ width: cw.book, padding: '0 6px', textAlign: 'right', color: t.book ? v1.cyan : v1.dim2 }}>{fmtNum(t.book)}</div>
                <div style={{ width: cw.fin, padding: '0 6px', textAlign: 'right', color: t.final ? v1.text : v1.dim2, fontWeight: 600 }}>{fmtNum(t.final)}</div>
                <div style={{ width: cw.yld, padding: '0 6px', textAlign: 'right', color: t.finalYield ? v1.amber : v1.dim2 }}>{t.finalYield || t.guidance}</div>
                <div style={{ flex: 1, padding: '0 6px', color: v1.dim, fontFamily: v1.fontUI, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {ti === 0 && <>
                    <span style={{ color: statusColor(d.status), fontSize: 8 }}>●</span>
                    <span style={{ color: v1.text }}>{d.leads.join(' · ')}</span>
                  </>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function V1RightRail() {
  return (
    <div style={{ background: v1.panel, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* League table */}
      <div>
        <div style={{ padding: '8px 12px', fontFamily: v1.font, fontSize: 10, color: v1.amber, fontWeight: 700, letterSpacing: 1.2, borderBottom: `1px solid ${v1.border}` }}>LEAGUE TABLE · YTD 2026</div>
        {LEAGUE_TABLE.map((l, i) => (
          <div key={l.rank} style={{ padding: '8px 12px', borderBottom: `1px solid ${v1.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 18, fontFamily: v1.font, fontSize: 11, color: i < 3 ? v1.amber : v1.dim, fontWeight: 700 }}>{l.rank}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: v1.fontUI, fontSize: 12, fontWeight: 500, color: v1.text }}>{l.house}</div>
              <div style={{ marginTop: 3, height: 3, background: v1.bg, borderRadius: 0 }}>
                <div style={{ height: '100%', width: `${l.share / 25 * 100}%`, background: i < 3 ? v1.amber : v1.cyan }}></div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: v1.font, fontSize: 11, color: v1.text }}>{l.share}%</div>
              <div style={{ fontFamily: v1.font, fontSize: 9, color: v1.dim2 }}>{l.delta !== '0' ? l.delta : '—'}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ECM pipeline */}
      <div>
        <div style={{ padding: '8px 12px', fontFamily: v1.font, fontSize: 10, color: v1.amber, fontWeight: 700, letterSpacing: 1.2, borderBottom: `1px solid ${v1.border}`, borderTop: `1px solid ${v1.borderHi}` }}>ECM PIPELINE</div>
        {ECM_DEALS.slice(0, 4).map((d, i) => (
          <div key={i} style={{ padding: '8px 12px', borderBottom: `1px solid ${v1.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: v1.fontUI, fontSize: 12, fontWeight: 500, color: v1.text }}>{d.issuer}</div>
              <div style={{ fontFamily: v1.font, fontSize: 10, color: v1.green }}>{d.type}</div>
            </div>
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontFamily: v1.font, fontSize: 10, color: v1.dim }}>
              <span>{d.date} · {d.status}</span>
              <span style={{ color: v1.amber }}>{d.amount.toLocaleString()}억</span>
            </div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      <div>
        <div style={{ padding: '8px 12px', fontFamily: v1.font, fontSize: 10, color: v1.amber, fontWeight: 700, letterSpacing: 1.2, borderBottom: `1px solid ${v1.border}`, borderTop: `1px solid ${v1.borderHi}` }}>ALERTS</div>
        {[
          ['14:28', '두산로보틱스 수요예측 시작', v1.cyan],
          ['11:02', 'LG에너지솔루션 8,000억 priced', v1.green],
          ['09:45', 'KB증권 league #1 maintained', v1.amber],
        ].map((a, i) => (
          <div key={i} style={{ padding: '6px 12px', borderBottom: `1px solid ${v1.border}`, fontFamily: v1.font, fontSize: 10, color: v1.text, display: 'flex', gap: 8 }}>
            <span style={{ color: v1.dim2 }}>{a[0]}</span>
            <span style={{ color: a[2] }}>●</span>
            <span style={{ fontFamily: v1.fontUI, color: v1.dim }}>{a[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function V1StatusBar({ s }) {
  return (
    <div style={{ height: 22, background: '#06090d', borderTop: `1px solid ${v1.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 14, fontFamily: v1.font, fontSize: 10, color: v1.dim, flexShrink: 0 }}>
      <span style={{ color: v1.green }}>● {s._source === 'live' ? 'LIVE' : 'MOCK'}</span>
      <span>data: KRX · KOFIA · 38커뮤니케이션</span>
      <span style={{ color: v1.dim2 }}>|</span>
      <span>updated {s.as_of}</span>
      <span style={{ color: v1.dim2 }}>|</span>
      <span>전체 {s.total_records.toLocaleString()}건</span>
      <div style={{ flex: 1 }}></div>
      <span>©2026 DealList Terminal</span>
    </div>
  );
}

window.V1Terminal = V1Terminal;
