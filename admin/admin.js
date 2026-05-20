/* Deal List — Admin page
 *
 * Auth: Google OAuth via Supabase Auth
 * 권한: RLS 정책 is_admin() 가 auth.jwt() ->> 'email' 로 화이트리스트 검사
 * 업로드 지원: meta.json (권장) / xlsx (고정 컬럼 1~15 만)
 */

// =========================== CONFIG ===========================
const SUPABASE_URL = "https://noacmyjepbtdvycrzsmj.supabase.co";
// anon (public) key — 브라우저 공개용으로 발급된 키. service_role 절대 금지.
// 빈 값이면 페이지가 console 에 경고 띄우고 로그인 비활성화.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vYWNteWplcGJ0ZHZ5Y3J6c21qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzcyNzksImV4cCI6MjA5NDgxMzI3OX0.dRJHP3GoNFfTwurmdaniUxur5u3l0s8eLmws8lqAb2M";

// xlsx 컬럼 매핑 (1-indexed → 0-indexed 로 변환해서 사용)
const XLSX_COL = {
  subscription_date: 0,   // A 청약일
  issuer_alias:      1,   // B 발행사
  series:            2,   // C 회차
  bond_type:         3,   // D 종류
  credit_rating:     4,   // E 신용등급
  maturity:          5,   // F 만기일
  initial_amount:    6,   // G 최초모집
  issue_limit:       7,   // H 발행한도
  demand_amount:     8,   // I 수요예측
  final_amount:      9,   // J 최종발행
  series_total:     10,   // K 회차합산
  rate_target:      12,   // M 희망금리
  rate_demand:      13,   // N 수요금리
  rate_final:       14,   // O 최종금리
};

const SHEET_NAME = "발행조건확정";  // xlsx 의 데이터 시트 이름
const BROKER_COL_START = 16;  // 1-indexed (excel_writer.config.COL["주관_시작"])

// mappings.json (사이트 /auto/mappings.json) 에서 fetch — 브로커 컬럼 매핑용
let mappingsData = null;     // { lead_managers: [...], underwriters: [...] }

// =========================== INIT ===========================
// 변수명을 'sb' 로 — CDN 의 window.supabase (SDK namespace) 와 충돌 방지
let sb = null;
let currentSession = null;
let parsedRecords = null;
let parseSource = null;   // 'json' | 'xlsx'

document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();

  if (SUPABASE_ANON_KEY === "__PASTE_ANON_KEY_HERE__") {
    showError("SUPABASE_ANON_KEY 가 설정되지 않았습니다. admin.js 파일을 수정하세요.");
    return;
  }

  try {
    // Supabase client (auto-refresh + persist session in localStorage)
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    });

    // OAuth 콜백 후 URL 의 access_token hash 처리 → 세션 가져오기
    const { data: { session } } = await sb.auth.getSession();
    await renderForSession(session);

    // 이후 auth 상태 변화 listen
    sb.auth.onAuthStateChange(async (_event, sess) => {
      await renderForSession(sess);
    });

    setupAuthButtons();
    setupFileUpload();

    // mappings.json 비동기 로드 (xlsx 브로커 파싱용) — 실패해도 페이지 작동 OK
    fetchMappings();
  } catch (e) {
    console.error("admin.js init 실패:", e);
    // 초기화 실패 시에도 로그인 화면이라도 노출 (사용자가 새로고침 시도 가능)
    const loginSec = document.getElementById("login-section");
    if (loginSec) loginSec.hidden = false;
    showError(`초기화 실패: ${e.message || e}`);
  }
});

// =========================== AUTH ===========================
async function renderForSession(session) {
  currentSession = session;
  const loginSec = document.getElementById("login-section");
  const nonAdminSec = document.getElementById("non-admin-section");
  const adminSec = document.getElementById("admin-section");

  loginSec.hidden = true;
  nonAdminSec.hidden = true;
  adminSec.hidden = true;

  if (!session) {
    loginSec.hidden = false;
    return;
  }

  const email = session.user?.email || "";
  const isAdmin = await checkIsAdmin();
  if (isAdmin) {
    document.getElementById("admin-email").textContent = email;
    adminSec.hidden = false;
  } else {
    document.getElementById("non-admin-email").textContent = email;
    nonAdminSec.hidden = false;
  }
}

async function checkIsAdmin() {
  // RLS 정책의 is_admin() 함수를 RPC 로 호출.
  // 함수가 SECURITY DEFINER 라 authenticated role 로 호출 가능.
  try {
    const { data, error } = await sb.rpc("is_admin");
    if (error) {
      console.warn("is_admin RPC 실패:", error);
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn("is_admin 호출 예외:", e);
    return false;
  }
}

function setupAuthButtons() {
  document.getElementById("btn-google-login").onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
    if (error) showError(`Google 로그인 실패: ${error.message}`);
  };

  const logout = async () => {
    await sb.auth.signOut();
  };
  document.getElementById("btn-logout").onclick = logout;
  document.getElementById("btn-logout-non-admin").onclick = logout;
}

// =========================== FILE UPLOAD ===========================
function setupFileUpload() {
  const area = document.getElementById("upload-area");
  const input = document.getElementById("file-input");

  // 드래그 앤 드롭
  ["dragenter", "dragover"].forEach(ev => area.addEventListener(ev, e => {
    e.preventDefault();
    area.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(ev => area.addEventListener(ev, e => {
    e.preventDefault();
    area.classList.remove("dragover");
  }));
  area.addEventListener("drop", e => {
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  });

  input.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  });

  document.getElementById("btn-clear").onclick = () => {
    parsedRecords = null;
    parseSource = null;
    input.value = "";
    document.getElementById("file-info").hidden = true;
    document.getElementById("preview-card").hidden = true;
    document.getElementById("result-card").hidden = true;
  };

  document.getElementById("btn-parse").onclick = parseFile;
  document.getElementById("btn-upload").onclick = uploadToSupabase;
}

let pendingFile = null;
function handleFile(file) {
  pendingFile = file;
  document.getElementById("file-name").textContent = file.name;
  document.getElementById("file-size").textContent =
    `${(file.size / 1024).toFixed(1)} KB · ${file.type || "unknown"}`;
  document.getElementById("file-info").hidden = false;
  document.getElementById("preview-card").hidden = true;
  document.getElementById("result-card").hidden = true;
}

async function parseFile() {
  if (!pendingFile) return;
  showLoading("파일 분석 중...");
  try {
    const ext = pendingFile.name.toLowerCase().split(".").pop();
    if (ext === "json") {
      await parseJsonFile(pendingFile);
      parseSource = "json";
    } else if (ext === "xlsx" || ext === "xlsm") {
      await parseXlsxFile(pendingFile);
      parseSource = "xlsx";
    } else {
      throw new Error(`지원하지 않는 형식: .${ext} (json 또는 xlsx 만)`);
    }
    renderPreview();
  } catch (e) {
    showError(`파싱 실패: ${e.message}`);
  } finally {
    hideLoading();
  }
}

async function parseJsonFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  // meta.json 형태 또는 records 배열 둘 다 지원
  const records = Array.isArray(data) ? data : (data.records || []);
  if (records.length === 0) {
    throw new Error("records 가 비어 있음");
  }
  parsedRecords = records.map(normalizeRecord);
}

async function fetchMappings() {
  try {
    const r = await fetch("/auto/mappings.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    mappingsData = {
      lead_managers: Array.isArray(data.lead_managers) ? data.lead_managers : [],
      underwriters:  Array.isArray(data.underwriters)  ? data.underwriters  : [],
    };
    console.log(
      `[mappings] lead=${mappingsData.lead_managers.length}, ` +
      `uw=${mappingsData.underwriters.length}`
    );
  } catch (e) {
    console.warn("mappings.json fetch 실패 — xlsx 의 브로커 컬럼은 파싱 불가:", e);
    mappingsData = null;
  }
}

async function parseXlsxFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, cellFormula: true });

  // mappings.json 이 없으면 브로커 컬럼 파싱 불가 — 한 번 더 시도
  if (!mappingsData) await fetchMappings();

  // 브로커 컬럼 인덱스 매핑 구축
  let leadCols = [];   // [{ name, colIdx0 }] — col P~AN, 산식 셀
  let uwCols = [];     // [{ name, colIdx0 }] — col AO~BT, raw 값
  if (mappingsData) {
    const leadStart0 = BROKER_COL_START - 1;  // 1-idx 16 → 0-idx 15
    const uwStart0 = leadStart0 + mappingsData.lead_managers.length;
    leadCols = mappingsData.lead_managers.map((name, i) => ({
      name, colIdx0: leadStart0 + i,
    }));
    uwCols = mappingsData.underwriters.map((name, i) => ({
      name, colIdx0: uwStart0 + i,
    }));
  }
  const hasBrokerCols = leadCols.length > 0;

  // 모든 시트 순회 — DCM Table.xlsx 는 연도별 시트 ("2026년", "2025년", ...) 로 분리됨.
  // 데이터 시트 판별: 헤더 row 의 청약일 위치에 "청약" 또는 "청약일" 텍스트
  const allParsed = [];
  let sheetsRead = 0;
  let totalRows = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: null,
    });
    if (rows.length < 2) continue;

    // 헤더 검증 — 1번째 컬럼이 "청약일" 비슷한 텍스트인 경우만 데이터 시트로 인정
    const headerRow = rows[0] || [];
    const h0 = (headerRow[XLSX_COL.subscription_date] || "").toString();
    if (!h0.includes("청약")) {
      console.log(`[xlsx] 시트 "${sheetName}" 건너뜀 (헤더 ≠ 청약일)`);
      continue;
    }
    sheetsRead++;

    // 첫 시트에서만: 산식 셀 전체 스캔 (디버그)
    if (sheetsRead === 1) {
      const formulaCells = [];
      const stringEqCells = [];
      for (const addr in ws) {
        if (addr.startsWith("!")) continue;
        const c = ws[addr];
        if (c.f) formulaCells.push({ addr, f: String(c.f).slice(0, 40) });
        else if (typeof c.v === "string" && c.v.startsWith("=")) {
          stringEqCells.push({ addr, v: c.v.slice(0, 40) });
        }
      }
      console.log(`[scan] 시트 "${sheetName}": cell.f 있는 셀 ${formulaCells.length}건, "="로 시작하는 string 셀 ${stringEqCells.length}건`);
      if (formulaCells.length > 0) console.log("  formula 샘플:", formulaCells.slice(0, 5));
      if (stringEqCells.length > 0) console.log("  string-eq 샘플:", stringEqCells.slice(0, 5));
      // AA3 직접 확인
      console.log(`  ws["AA3"] =`, ws["AA3"]);
      console.log(`  ws["P4"] =`, ws["P4"]);
    }

    // 데이터 행 추출
    const dataRows = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      if (!r[XLSX_COL.issuer_alias] && !r[XLSX_COL.subscription_date]) continue;
      dataRows.push({ rowIdx1: i + 1, values: r });  // 1-indexed xlsx row 번호
    }
    totalRows += dataRows.length;

    for (const { rowIdx1, values: r } of dataRows) {
      const rec = {
        subscription_date: r[XLSX_COL.subscription_date],
        issuer_alias:      r[XLSX_COL.issuer_alias],
        series:            r[XLSX_COL.series],
        bond_type:         r[XLSX_COL.bond_type],
        credit_rating:     r[XLSX_COL.credit_rating],
        maturity:          r[XLSX_COL.maturity],
        initial_amount:    r[XLSX_COL.initial_amount],
        issue_limit:       r[XLSX_COL.issue_limit],
        demand_amount:     r[XLSX_COL.demand_amount],
        final_amount:      r[XLSX_COL.final_amount],
        series_total:      r[XLSX_COL.series_total],
        rate_target:       r[XLSX_COL.rate_target],
        rate_demand:       r[XLSX_COL.rate_demand],
        rate_final:        r[XLSX_COL.rate_final],
        lead_managers:     [],
        underwriter_alloc: {},
      };

      if (hasBrokerCols) {
        const alloc = {};
        const leadsSet = new Set();
        let debugThisRow = (allParsed.length < 3);  // 첫 3행 디버그 출력

        // Lead section (col P~AN) — 산식 셀.
        // openpyxl 은 formula 를 cell.value="=..." (string) 으로 저장하기도 함.
        // SheetJS 도 케이스별로 cell.f 또는 cell.v 에 담음.
        for (const { name, colIdx0 } of leadCols) {
          const cellAddr = XLSX.utils.encode_cell({ c: colIdx0, r: rowIdx1 - 1 });
          const cell = ws[cellAddr];
          if (!cell) continue;
          const v = cell.v;
          const f = cell.f;
          const isFormulaLike =
            !!f ||
            (typeof v === "string" && v.startsWith("="));
          const isPositiveNum = typeof v === "number" && v > 0;
          if (isFormulaLike || isPositiveNum) {
            leadsSet.add(name);
            if (debugThisRow) {
              console.log(`  [lead] ${cellAddr} ${name}: f=${f}, v=${typeof v === "string" ? v.slice(0, 40) : v}`);
            }
          }
        }
        // Underwriter section (col AO~BT) — raw 값.
        for (const { name, colIdx0 } of uwCols) {
          // sheet_to_json 결과의 r[colIdx0] 도 시도, 안 되면 셀 직접 접근
          let v = toNum(r[colIdx0]);
          if (v === null) {
            const cellAddr = XLSX.utils.encode_cell({ c: colIdx0, r: rowIdx1 - 1 });
            const cell = ws[cellAddr];
            if (cell) v = toNum(cell.v);
          }
          if (v && v > 0) {
            alloc[name] = (alloc[name] || 0) + v;
            if (debugThisRow) {
              console.log(`  [uw] col ${colIdx0 + 1} ${name}: ${v}`);
            }
          }
        }
        if (debugThisRow) {
          console.log(
            `[debug row${rowIdx1}] leads=[${Array.from(leadsSet).join(",")}], ` +
            `alloc keys=[${Object.keys(alloc).join(",")}]`
          );
        }
        rec.lead_managers = Array.from(leadsSet);
        rec.underwriter_alloc = alloc;
      }

      allParsed.push(normalizeRecord(rec));
    }
  }

  console.log(
    `[xlsx] ${sheetsRead}개 시트, ${totalRows}행 파싱 ` +
    `(브로커 ${hasBrokerCols ? "포함" : "제외"})`
  );

  if (allParsed.length === 0) {
    throw new Error("데이터 행을 찾지 못했습니다. xlsx 의 헤더가 '청약일' 으로 시작하는지 확인하세요.");
  }
  parsedRecords = allParsed;
}

function normalizeRecord(r) {
  // Supabase records 테이블 스키마에 맞춰 정규화.
  return {
    subscription_date: toDateStr(r.subscription_date),
    issuer_alias:      (r.issuer_alias || "").toString().trim(),
    issuer_full:       (r.issuer_full || "").toString().trim(),
    corp_code:         (r.corp_code || "").toString().trim(),
    series:            (r.series || "").toString().trim(),
    bond_type:         (r.bond_type || "").toString().trim(),
    credit_rating:     (r.credit_rating || "").toString().trim(),
    maturity:          typeof r.maturity === "string" ? r.maturity : toDateStr(r.maturity),
    initial_amount:    toNum(r.initial_amount),
    issue_limit:       toNum(r.issue_limit),
    demand_amount:     toNum(r.demand_amount),
    final_amount:      toNum(r.final_amount),
    series_total:      toNum(r.series_total),
    rate_target:       (r.rate_target || "").toString(),
    rate_demand:       (r.rate_demand || "").toString(),
    rate_final:        toNum(r.rate_final),
    lead_managers:     Array.isArray(r.lead_managers) ? r.lead_managers : [],
    underwriter_alloc: (r.underwriter_alloc && typeof r.underwriter_alloc === "object")
                       ? r.underwriter_alloc : {},
    rcept_no:          (r.rcept_no || "").toString(),
    is_amendment:      !!r.is_amendment,
    is_foreign:        !!r.is_foreign,
    raw_tables_count:  toNum(r.raw_tables_count) || 0,
    notes:             Array.isArray(r.notes) ? r.notes : [],
  };
}

function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD 형태 정규화
  const m = s.match(/(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})/);
  if (m) {
    const yy = m[1];
    const mm = m[2].padStart(2, "0");
    const dd = m[3].padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

// =========================== PREVIEW ===========================
function renderPreview() {
  const card = document.getElementById("preview-card");
  card.hidden = false;

  // 검증
  const validation = validateRecords(parsedRecords);
  const stats = computeStats(parsedRecords, validation);

  // stats 카드들
  const grid = document.getElementById("parse-stats");
  grid.innerHTML = "";
  grid.appendChild(statCell("총 행", stats.total, ""));
  grid.appendChild(statCell("필수 키 OK", stats.validKeys, "ok"));
  grid.appendChild(statCell("에러", stats.errors, stats.errors > 0 ? "error" : ""));
  grid.appendChild(statCell("경고", stats.warnings, stats.warnings > 0 ? "warn" : ""));
  if (parseSource === "xlsx") {
    if (mappingsData) {
      const withBrokers = parsedRecords.filter(r =>
        (r.lead_managers || []).length > 0).length;
      grid.appendChild(statCell("브로커 정보 포함", `${withBrokers}건`, "ok"));
    } else {
      grid.appendChild(statCell("주의", "브로커 제외 (mappings 없음)", "warn"));
    }
  }

  // validation panel
  const panel = document.getElementById("validation-panel");
  const summary = document.getElementById("validation-summary");
  const list = document.getElementById("validation-list");
  if (validation.length > 0) {
    panel.hidden = false;
    summary.innerHTML =
      `<span class="log-error">에러 ${stats.errors}건</span> · ` +
      `<span class="log-warn">경고 ${stats.warnings}건</span>`;
    list.innerHTML = validation.slice(0, 200).map(v =>
      `<div class="v-item v-${v.level}">[${v.level}] 행 ${v.row + 1}: ${escapeHtml(v.msg)}</div>`
    ).join("");
    if (validation.length > 200) {
      list.innerHTML += `<div class="v-item v-info">... 외 ${validation.length - 200}건 더</div>`;
    }
  } else {
    panel.hidden = true;
  }

  // preview 테이블 (상위 10)
  const tbody = document.querySelector("#preview-table tbody");
  tbody.innerHTML = "";
  parsedRecords.slice(0, 10).forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.subscription_date || "")}</td>
      <td>${escapeHtml(r.issuer_alias || "")}</td>
      <td>${escapeHtml(r.series || "")}</td>
      <td>${escapeHtml(r.bond_type || "")}</td>
      <td>${escapeHtml(r.credit_rating || "")}</td>
      <td style="text-align:right">${fmtAmt(r.final_amount)}</td>
      <td>${escapeHtml((r.lead_managers || []).join(", "))}</td>
    `;
    tbody.appendChild(tr);
  });

  // 업로드 버튼 활성화
  document.getElementById("btn-upload").disabled = stats.errors > 0;
}

function validateRecords(records) {
  const issues = [];
  records.forEach((r, i) => {
    if (!r.subscription_date) {
      issues.push({ row: i, level: "error", msg: "subscription_date 비어있음" });
    }
    if (!r.issuer_alias) {
      issues.push({ row: i, level: "error", msg: "issuer_alias 비어있음" });
    }
    if (!r.series) {
      issues.push({ row: i, level: "error", msg: "series 비어있음" });
    }
    if (r.final_amount === null) {
      issues.push({ row: i, level: "warn", msg: "final_amount 비어있음" });
    }
  });
  return issues;
}

function computeStats(records, validation) {
  const errors = validation.filter(v => v.level === "error").length;
  const warnings = validation.filter(v => v.level === "warn").length;
  const errorRows = new Set(validation.filter(v => v.level === "error").map(v => v.row));
  return {
    total: records.length,
    validKeys: records.length - errorRows.size,
    errors,
    warnings,
  };
}

function statCell(label, value, variant) {
  const div = document.createElement("div");
  div.className = "stat-cell" + (variant ? " stat-" + variant : "");
  div.innerHTML = `<div class="stat-label">${escapeHtml(label)}</div>
                   <div class="stat-value">${escapeHtml(String(value))}</div>`;
  return div;
}

function fmtAmt(n) {
  if (n === null || n === undefined) return "";
  return Number(n).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// =========================== UPLOAD ===========================
async function uploadToSupabase() {
  if (!parsedRecords || parsedRecords.length === 0) {
    showError("업로드할 데이터가 없습니다.");
    return;
  }
  if (!currentSession) {
    showError("로그인이 필요합니다.");
    return;
  }

  const useUpsert = document.getElementById("chk-upsert").checked;
  const resultCard = document.getElementById("result-card");
  const resultLog = document.getElementById("result-log");
  resultCard.hidden = false;
  resultLog.innerHTML = "";
  log("info", `업로드 시작 — ${parsedRecords.length}건, mode=${useUpsert ? "upsert" : "insert"}`);

  // 에러 있는 행 필터링
  const valid = parsedRecords.filter(r =>
    r.subscription_date && r.issuer_alias && r.series);
  if (valid.length < parsedRecords.length) {
    log("warn", `필수 키 누락 ${parsedRecords.length - valid.length}건 제외`);
  }

  showLoading(`업로드 중... 0 / ${valid.length}`);
  const BATCH = 200;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    try {
      let query = sb.from("records");
      if (useUpsert) {
        const { error } = await query.upsert(batch, {
          onConflict: "issuer_alias,series,subscription_date",
        });
        if (error) throw error;
      } else {
        const { error } = await query.insert(batch);
        if (error) throw error;
      }
      success += batch.length;
      log("success", `  [${Math.floor(i/BATCH) + 1}] ${batch.length}건 OK (누적 ${success})`);
    } catch (e) {
      failed += batch.length;
      log("error", `  [${Math.floor(i/BATCH) + 1}] 실패: ${e.message || e}`);
    }
    document.getElementById("loading-msg").textContent =
      `업로드 중... ${success + failed} / ${valid.length}`;
  }

  hideLoading();
  log("info", "");
  log("info", `=== 완료 ===`);
  log("success", `  성공: ${success}건`);
  if (failed > 0) log("error", `  실패: ${failed}건`);
  if (parseSource === "xlsx" && !mappingsData) {
    log("warn", `  ⚠ xlsx 업로드 — 브로커 정보(주관/인수)는 업로드되지 않았습니다.`);
    log("warn", `     mappings.json fetch 실패 → 완전한 업로드는 meta.json 사용 권장.`);
  } else if (parseSource === "xlsx" && mappingsData) {
    log("info", `  xlsx 브로커 컬럼 파싱: lead ${mappingsData.lead_managers.length}개 + uw ${mappingsData.underwriters.length}개 자리 매핑 사용`);
  }
}

function log(level, msg) {
  const log = document.getElementById("result-log");
  const div = document.createElement("div");
  div.className = "log-line log-" + level;
  div.textContent = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// =========================== UI helpers ===========================
function showLoading(msg) {
  document.getElementById("loading-msg").textContent = msg || "로딩 중...";
  document.getElementById("loading").hidden = false;
}
function hideLoading() {
  document.getElementById("loading").hidden = true;
}
function showError(msg) {
  alert(msg);
  console.error(msg);
}

// =========================== Theme (다른 페이지와 동일 패턴) ===========================
function setupTheme() {
  const root = document.documentElement;
  const KEY = "deallist-theme";
  if (localStorage.getItem(KEY) === "dark") {
    root.setAttribute("data-theme", "dark");
  }
  const btn = document.getElementById("btn-theme");
  const updateBtn = () => {
    btn.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";
  };
  updateBtn();
  btn.addEventListener("click", () => {
    const cur = root.getAttribute("data-theme");
    if (cur === "dark") {
      root.removeAttribute("data-theme");
      localStorage.setItem(KEY, "light");
    } else {
      root.setAttribute("data-theme", "dark");
      localStorage.setItem(KEY, "dark");
    }
    updateBtn();
  });
}
