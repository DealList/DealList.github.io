// Shared deal-list mock data — Korean capital markets
// Schema follows the real DealList "공모채 발행 정보" view: multi-tranche grouped deals.

// Each issuer has 1+ tranches. Fields:
//   date         청약일 (subscription date, YYYY-MM-DD)
//   issuer       발행사
//   tranches[]   array of { no, type, rating, maturity, initial, cap, book, final, guidance, bookYield, finalYield }
//   totalCap     발행한도 (issuer-level cap; may be set even when per-tranche cap is)
//   totalFinal   회차합산 (sum of finals; null if not yet priced)
//   leads        주관사
//   underwriters 인수사
//   status       'priced' | 'booking' | 'pending'
const DEALS = [
  {
    date: '2026-06-01', issuer: '신세계',
    tranches: [
      { no: '146-1', type: '무보증', rating: 'AA', maturity: '2028-06-01', initial: 1000, cap: null, book: null, final: null, guidance: '민평±30bp', bookYield: null, finalYield: null },
      { no: '146-2', type: '무보증', rating: 'AA', maturity: '2029-06-01', initial: 1500, cap: null, book: null, final: null, guidance: '민평±30bp', bookYield: null, finalYield: null },
    ],
    totalCap: 4000, totalFinal: null, leads: ['KB증권', 'NH투자증권'], underwriters: ['미래에셋', '한국투자'], status: 'booking',
  },
  {
    date: '2026-06-01', issuer: '동화기업',
    tranches: [
      { no: '25', type: '무보증', rating: 'BBB+', maturity: '2027-12-01', initial: 400, cap: null, book: null, final: null, guidance: '5.50~6.50%', bookYield: null, finalYield: null },
    ],
    totalCap: 400, totalFinal: null, leads: ['신한투자증권'], underwriters: ['교보증권'], status: 'booking',
  },
  {
    date: '2026-06-01', issuer: '한국투자증권',
    tranches: [
      { no: '32-1', type: '무보증', rating: 'AA', maturity: '2028-06-01', initial: 1000, cap: null, book: null, final: null, guidance: '민평±30bp', bookYield: null, finalYield: null },
      { no: '32-2', type: '무보증', rating: 'AA', maturity: '2029-06-01', initial: 1500, cap: null, book: null, final: null, guidance: '민평±30bp', bookYield: null, finalYield: null },
    ],
    totalCap: 5000, totalFinal: null, leads: ['KB증권', 'NH투자증권'], underwriters: ['대신증권'], status: 'booking',
  },
  {
    date: '2026-05-29', issuer: '하나금융지주',
    tranches: [
      { no: '19', type: '신종자본', rating: 'AA-', maturity: '영구', initial: 2700, cap: 4000, book: 5800, final: 4000, guidance: '4.20~4.80%', bookYield: '4.42%', finalYield: '4.42%' },
    ],
    totalCap: 4000, totalFinal: 4000, leads: ['KB증권', 'NH투자증권', '한국투자증권'], underwriters: ['미래에셋', '삼성증권'], status: 'priced',
  },
  {
    date: '2026-05-28', issuer: '삼천리',
    tranches: [
      { no: '26-1', type: '무보증', rating: 'AA+', maturity: '2028-05-26', initial: 300, cap: null, book: 720, final: 500, guidance: '민평±30bp', bookYield: '3.92%', finalYield: '3.92%' },
      { no: '26-2', type: '무보증', rating: 'AA+', maturity: '2029-05-28', initial: 300, cap: null, book: 580, final: 500, guidance: '민평±30bp', bookYield: '4.08%', finalYield: '4.08%' },
    ],
    totalCap: 1000, totalFinal: 1000, leads: ['KB증권'], underwriters: ['신한투자증권'], status: 'priced',
  },
  {
    date: '2026-05-28', issuer: 'LG전자',
    tranches: [
      { no: '107-1', type: '무보증', rating: 'AA', maturity: '2028-05-28', initial: 1500, cap: null, book: 4200, final: 2500, guidance: '민평±30bp', bookYield: '3.78%', finalYield: '3.78%' },
      { no: '107-2', type: '무보증', rating: 'AA', maturity: '2031-05-28', initial: 500, cap: null, book: 1100, final: 1000, guidance: '민평±30bp', bookYield: '4.02%', finalYield: '4.02%' },
      { no: '107-3', type: '무보증', rating: 'AA', maturity: '2036-05-28', initial: 500, cap: null, book: 800, final: 1500, guidance: '민평±30bp', bookYield: '4.32%', finalYield: '4.32%' },
    ],
    totalCap: 5000, totalFinal: 5000, leads: ['NH투자증권', 'KB증권'], underwriters: ['한국투자', '미래에셋'], status: 'priced',
  },
  {
    date: '2026-05-22', issuer: '현대캐피탈',
    tranches: [
      { no: '1832-1', type: '무보증', rating: 'AA+', maturity: '2028-05-22', initial: 1000, cap: null, book: 2400, final: 1500, guidance: '민평±20bp', bookYield: '3.84%', finalYield: '3.84%' },
      { no: '1832-2', type: '무보증', rating: 'AA+', maturity: '2029-05-22', initial: 1000, cap: null, book: 1900, final: 1000, guidance: '민평±20bp', bookYield: '4.01%', finalYield: '4.01%' },
    ],
    totalCap: 2500, totalFinal: 2500, leads: ['미래에셋', '신한투자증권'], underwriters: ['하나증권'], status: 'priced',
  },
  {
    date: '2026-05-15', issuer: '한국전력공사',
    tranches: [
      { no: '124-1', type: '무보증', rating: 'AAA', maturity: '2029-05-15', initial: 2000, cap: null, book: 6800, final: 4000, guidance: '민평±10bp', bookYield: '3.42%', finalYield: '3.42%' },
    ],
    totalCap: 4000, totalFinal: 4000, leads: ['KB증권', 'NH투자증권', '한국투자증권'], underwriters: ['삼성증권', '미래에셋'], status: 'priced',
  },
  {
    date: '2026-03-05', issuer: 'LG에너지솔루션',
    tranches: [
      { no: '5-1', type: '무보증', rating: 'AA0', maturity: '2029-03-05', initial: 3000, cap: null, book: 12400, final: 5000, guidance: '민평±20bp', bookYield: '3.98%', finalYield: '3.98%' },
      { no: '5-2', type: '무보증', rating: 'AA0', maturity: '2031-03-05', initial: 2000, cap: null, book: 5800, final: 3000, guidance: '민평±20bp', bookYield: '4.21%', finalYield: '4.21%' },
    ],
    totalCap: 8000, totalFinal: 8000, leads: ['KB증권', '한국투자증권', '미래에셋'], underwriters: ['NH투자증권', '삼성증권'], status: 'priced',
  },
];

const ECM_DEALS = [
  { date: '2026-05-22', issuer: '두산로보틱스', type: 'IPO', amount: 4200, shares: '12,500,000', range: '32,000~38,000', leads: ['미래에셋', '한국투자'], status: '수요예측' },
  { date: '2026-05-20', issuer: 'HD현대마린솔루션', type: '유상증자', amount: 6800, shares: '8,200,000', range: '82,000', leads: ['KB증권', 'NH투자'], status: '청약' },
  { date: '2026-05-18', issuer: '에코프로비엠', type: '유상증자', amount: 5400, shares: '4,100,000', range: '132,000', leads: ['NH투자', '삼성증권'], status: '확정' },
  { date: '2026-05-15', issuer: '쏘카', type: 'Block deal', amount: 1200, shares: '5,800,000', range: '20,700', leads: ['Citi'], status: '완료' },
  { date: '2026-05-12', issuer: '컬리', type: 'IPO', amount: 3800, shares: '14,200,000', range: '23,000~27,500', leads: ['NH투자', 'JP모건'], status: '확정' },
];

const LEAGUE_TABLE = [
  { rank: 1, house: 'KB증권', amount: 61584, share: 22.3, deals: 47, delta: '+2' },
  { rank: 2, house: 'NH투자증권', amount: 54210, share: 19.6, deals: 41, delta: '0' },
  { rank: 3, house: '한국투자증권', amount: 48330, share: 17.5, deals: 38, delta: '+1' },
  { rank: 4, house: '미래에셋증권', amount: 39820, share: 14.4, deals: 32, delta: '-1' },
  { rank: 5, house: '신한투자증권', amount: 28140, share: 10.2, deals: 24, delta: '0' },
  { rank: 6, house: '삼성증권', amount: 21670, share: 7.8, deals: 19, delta: '-2' },
];

const MONTHLY_VOLUME = [
  { m: '25.06', v: 32400 }, { m: '07', v: 28100 }, { m: '08', v: 41200 },
  { m: '09', v: 36800 }, { m: '10', v: 44500 }, { m: '11', v: 38900 },
  { m: '12', v: 22300 }, { m: '26.01', v: 51200 }, { m: '02', v: 47800 },
  { m: '03', v: 53400 }, { m: '04', v: 39100 }, { m: '05', v: 19530 },
];

// Range-aggregate KPIs matching the real page
const RANGE_KPI = {
  count: 253,         // 회차 기준 발행건수
  totalAmount: 564687, // 56조 4,687억 in 억 units
  avgSize: 2232,      // 회차당 평균
  largest: { issuer: 'LG에너지솔루션', tranche: '5회차', amount: 8000, date: '2026-03-05' },
  range: '최근 1년',
  asOf: '2026-05-20 21:01',
  total: 3176,        // 전체 건수
};

// Format helpers
const fmtAmt = (억) => {
  if (억 == null) return '—';
  if (억 >= 10000) {
    const 조 = Math.floor(억 / 10000);
    const 억r = 억 % 10000;
    return 억r > 0 ? `${조}조 ${억r.toLocaleString()}억` : `${조}조`;
  }
  return `${억.toLocaleString()}억`;
};
const fmtAmtShort = (억) => {
  if (억 == null) return '—';
  if (억 >= 10000) return `${(억/10000).toFixed(1)}조`;
  return `${억.toLocaleString()}`;
};
const fmtNum = (n) => n == null ? '—' : n.toLocaleString();

// Broker code → full name (mirrors index.html mapping)
const BROKER_FULL = {
  "BNK":"BNK투자증권","DB":"DB금융투자","IBK":"IBK투자증권","KB":"KB증권",
  "KR":"KR투자증권","LS":"LS증권","NH":"NH투자증권","SK":"SK증권","iM":"iM증권",
  "교보":"교보증권","다올":"다올투자증권","대신":"대신증권","디에스":"DS투자증권",
  "리딩":"리딩투자증권","메리츠":"메리츠증권","미래":"미래에셋증권","부국":"부국증권",
  "산은":"한국산업은행","삼성":"삼성증권","상상인":"상상인증권","신영":"신영증권",
  "신한":"신한투자증권","우리":"우리투자증권","유안타":"유안타증권","유진":"유진투자증권",
  "케이프":"케이프투자증권","코리아에셋":"코리아에셋투자증권","키움":"키움증권",
  "하나":"하나증권","한양":"한양증권","한투":"한국투자증권","한화":"한화투자증권",
  "현차":"현대차증권","흥국":"흥국증권"
};

// Live summary — starts as fallback; replaced if summary.json fetch succeeds.
// Shape MUST match the real summary.json so we can swap in the live data.
const SUMMARY_FALLBACK = {
  this_month_label: '2026-05',
  this_month_count: 7,
  this_month_count_change: -68.2,
  this_month_amount: 19530,           // 억
  this_month_amount_change: -50.1,
  this_year_top_broker: 'KB',
  this_year_top_amount: 117465,
  this_year_top_share: 20.8,
  this_year_biggest_issuer: 'LG에너지솔루션',
  this_year_biggest_series: 5,
  this_year_biggest_amount: 8000,
  this_year_biggest_date: '2026-03-05',
  // Extras for variations:
  range_label: '최근 1년',
  range_count: 246,
  range_tranche_count: 253,
  range_amount: 564687,
  range_avg_size: 2232,
  this_year_underwriter_broker: 'KB',
  this_year_underwriter_amount: 94022,
  this_year_underwriter_share: 16.7,
  total_records: 3176,
  as_of: '2026-05-20 21:01',
  _source: 'fallback', // 'live' when fetched
};

let SUMMARY = { ...SUMMARY_FALLBACK };

// Public: fetch summary.json (relative to deployment). Resolve when done.
// On success, SUMMARY is updated in place AND a 'summary-loaded' event fires.
async function loadSummary() {
  // Try ../summary.json first (when deployed at /deals/preview/index.html → /deals/summary.json),
  // then ./summary.json (when colocated).
  const candidates = ['../summary.json', './summary.json', 'summary.json'];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const data = await r.json();
      // Merge — only overwrite known keys so we keep the extras above.
      Object.keys(SUMMARY_FALLBACK).forEach(k => {
        if (data[k] != null) SUMMARY[k] = data[k];
      });
      SUMMARY._source = 'live';
      SUMMARY._url = url;
      window.dispatchEvent(new CustomEvent('summary-loaded', { detail: SUMMARY }));
      return SUMMARY;
    } catch (e) { /* try next */ }
  }
  // All failed — keep fallback. Still emit event so UI marks "mock data".
  window.dispatchEvent(new CustomEvent('summary-loaded', { detail: SUMMARY }));
  return SUMMARY;
}

// React hook — components that want to react to summary updates use this.
function useSummary() {
  const [s, setS] = React.useState(SUMMARY);
  React.useEffect(() => {
    const h = (e) => setS({ ...e.detail });
    window.addEventListener('summary-loaded', h);
    return () => window.removeEventListener('summary-loaded', h);
  }, []);
  return s;
}

// Convenience: broker code → full name (fallback to original if not mapped)
const brokerFull = (code) => BROKER_FULL[code] || code;

Object.assign(window, {
  DEALS, ECM_DEALS, LEAGUE_TABLE, MONTHLY_VOLUME, RANGE_KPI,
  fmtAmt, fmtAmtShort, fmtNum,
  SUMMARY, BROKER_FULL, brokerFull, loadSummary, useSummary,
});

