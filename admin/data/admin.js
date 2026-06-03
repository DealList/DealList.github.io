/* Deal List — Admin page
 *
 * Auth: Google OAuth via Supabase Auth
 * 권한: RLS 정책 is_admin() 가 auth.jwt() ->> 'email' 로 화이트리스트 검사
 * 업로드 지원: meta.json (권장) / xlsx (고정 컬럼 1~15 만)
 */

// =========================== CONFIG ===========================
// 인증·DB 는 사이트 공유 클라이언트(window.sb, supabase-client.js)를 사용 — 별도 로그인 불필요.

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

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  setupTheme();

  // 사이트 공유 클라이언트(window.sb) 준비 대기
  for (let i = 0; i < 120 && !window.sb; i++) await new Promise(r => setTimeout(r, 50));
  sb = window.sb;
  if (!sb) { showGuard("Supabase 클라이언트를 불러오지 못했습니다. 새로고침해 주세요."); return; }

  // 권한 가드 — 사이트 세션 + role (다른 admin 페이지와 동일)
  let profile = null;
  try { profile = await window.NP.getProfile(); } catch (e) {}
  if (!profile) {
    location.replace("/login/?next=" + encodeURIComponent("/admin/data/"));
    return;
  }
  if (profile.role !== "admin") {
    showGuard(`이 계정(${escapeHtml(profile.email || "")})은 관리자가 아닙니다.`);
    return;
  }
  try { currentSession = await window.NP.getSession(); } catch (e) {}

  // 헤더 + 본문 노출
  const meEl = document.getElementById("me-email");
  if (meEl) meEl.textContent = profile.email || "";
  const nav = document.getElementById("admin-nav"); if (nav) nav.hidden = false;
  const panel = document.getElementById("panel"); if (panel) panel.hidden = false;
  const lo = document.getElementById("btn-logout");
  if (lo) lo.onclick = async () => {
    if (!confirm("로그아웃하시겠습니까?")) return;
    await window.NP.signOut(); location.href = "/";
  };

  // 데이터 기능 초기화
  setupFileUpload();
  setupTriggerButton();
  setupEcmTriggerButton();
  setupDeleteUI();
  setupAuditButtons();
  loadAuditLog().catch(e => console.warn("audit_log 로드 실패:", e));
  fetchMappings();
}

// =========================== AUTH (가드) ===========================
function showGuard(msg) {
  const g = document.getElementById("guard-msg");
  if (!g) { showError(msg); return; }
  g.hidden = false;
  g.innerHTML = `<h2>접근 권한 없음</h2><p>${escapeHtml(msg)}</p>` +
    `<a href="/main/" class="admin-btn">← 메인으로</a>`;
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
  // sheetStubs:true — 산식만 있고 cached value 없는 stub 셀도 포함시킴.
  //   (openpyxl 이 산식을 cached value 없이 저장 → SheetJS 가 기본적으로 drop 함)
  // cellFormula:true — 산식 표현식 추출 보장.
  const wb = XLSX.read(buf, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    sheetStubs: true,
  });

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

        // Lead section (col P~AN) — 산식 셀. 산식 존재 = lead.
        // (openpyxl 이 cached value 없이 산식만 저장 → SheetJS 가
        //  sheetStubs:true 옵션 있어야 인식. cell.f 에 산식 텍스트, cell.v=0 또는 undefined)
        for (const { name, colIdx0 } of leadCols) {
          const cellAddr = XLSX.utils.encode_cell({ c: colIdx0, r: rowIdx1 - 1 });
          const cell = ws[cellAddr];
          if (!cell) continue;
          const v = cell.v;
          const f = cell.f;
          const isFormulaLike =
            !!f || (typeof v === "string" && v.startsWith("="));
          const isPositiveNum = typeof v === "number" && v > 0;
          if (isFormulaLike || isPositiveNum) {
            leadsSet.add(name);
          }
        }
        // Underwriter section (col AO~BT) — raw 값.
        for (const { name, colIdx0 } of uwCols) {
          let v = toNum(r[colIdx0]);
          if (v === null) {
            const cellAddr = XLSX.utils.encode_cell({ c: colIdx0, r: rowIdx1 - 1 });
            const cell = ws[cellAddr];
            if (cell) v = toNum(cell.v);
          }
          if (v && v > 0) {
            alloc[name] = (alloc[name] || 0) + v;
          }
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

  // 업로드 후 audit_log 자동 새로고침 (방금 한 변경 보이게)
  if (success > 0) {
    setTimeout(() => loadAuditLog().catch(() => {}), 800);
  }
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

// =========================== TRIGGER DART UPDATE ===========================
let triggerSetupDone = false;
const GITHUB_ACTIONS_URL = "https://github.com/DealList/DealList.github.io/actions/workflows/data-update.yml";

function setupTriggerButton() {
  if (triggerSetupDone) return;
  triggerSetupDone = true;
  document.getElementById("btn-trigger-dart").onclick = triggerDartUpdate;
}

async function triggerDartUpdate() {
  const btn = document.getElementById("btn-trigger-dart");
  const statusBox = document.getElementById("trigger-status");

  if (!confirm("지금 DCM 데이터 수집을 실행하시겠습니까?\n\n매일 06:17 자동 실행과 동일한 작업입니다.\n약 3~5분 후 사이트에 반영됩니다.")) {
    return;
  }

  btn.disabled = true;
  btn.textContent = "실행 요청 중...";
  statusBox.hidden = false;
  statusBox.className = "trigger-status";
  statusBox.innerHTML = `<div class="ts-title">GitHub Actions 에 요청 보내는 중...</div>`;

  try {
    const { data, error } = await sb.rpc("trigger_dart_update");
    if (error) throw error;

    const now = new Date();
    const finishApprox = new Date(now.getTime() + 5 * 60 * 1000);
    const fmt = d => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

    statusBox.className = "trigger-status status-success";
    statusBox.innerHTML = `
      <div class="ts-title">✅ 실행 요청 완료</div>
      <div>워크플로우가 GitHub Actions 에서 시작됐습니다.</div>
      <div class="ts-meta" style="margin-top: 6px;">
        • 요청 시각: ${fmt(now)}<br>
        • 예상 완료: ~${fmt(finishApprox)} (3~5분 후)<br>
        • <a href="${GITHUB_ACTIONS_URL}" target="_blank" rel="noopener">GitHub Actions 페이지에서 진행 상황 확인</a>
      </div>
    `;

    btn.textContent = "✓ 요청 완료 (5분 후 사이트 확인)";
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "지금 실행";
    }, 30 * 1000);
  } catch (e) {
    statusBox.className = "trigger-status status-error";
    const msg = e.message || String(e);
    let hint = "";
    if (msg.includes("Permission denied")) {
      hint = "<br><br>관리자 권한 필요. 로그아웃 후 다시 로그인해 보세요.";
    } else if (msg.includes("function") && msg.includes("does not exist")) {
      hint = "<br><br>RPC 함수 미생성. Supabase SQL Editor 에서 trigger_dart_update 함수 생성 SQL 실행 필요.";
    }
    statusBox.innerHTML = `
      <div class="ts-title">❌ 실행 요청 실패</div>
      <div>${escapeHtml(msg)}${hint}</div>
    `;
    btn.disabled = false;
    btn.textContent = "지금 실행";
  }
}

// =========================== TRIGGER ECM UPDATE ===========================
let ecmTriggerSetupDone = false;
const GITHUB_ECM_ACTIONS_URL = "https://github.com/DealList/DealList.github.io/actions/workflows/ecm-data-update.yml";

function setupEcmTriggerButton() {
  if (ecmTriggerSetupDone) return;
  ecmTriggerSetupDone = true;
  const b = document.getElementById("btn-trigger-ecm");
  if (b) b.onclick = triggerEcmUpdate;
}

async function triggerEcmUpdate() {
  const btn = document.getElementById("btn-trigger-ecm");
  const statusBox = document.getElementById("trigger-status-ecm");

  if (!confirm("지금 ECM 데이터 수집을 실행하시겠습니까?\n\n매일 06:27 자동 실행과 동일한 작업입니다.\n약 3~5분 후 사이트에 반영됩니다.")) {
    return;
  }

  btn.disabled = true;
  btn.textContent = "실행 요청 중...";
  statusBox.hidden = false;
  statusBox.className = "trigger-status";
  statusBox.innerHTML = `<div class="ts-title">GitHub Actions 에 요청 보내는 중...</div>`;

  try {
    const { data, error } = await sb.rpc("trigger_ecm_update");
    if (error) throw error;

    const now = new Date();
    const finishApprox = new Date(now.getTime() + 4 * 60 * 1000);
    const fmt = d => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

    statusBox.className = "trigger-status status-success";
    statusBox.innerHTML = `
      <div class="ts-title">✅ 실행 요청 완료</div>
      <div>ECM 워크플로우가 GitHub Actions 에서 시작됐습니다.</div>
      <div class="ts-meta" style="margin-top: 6px;">
        • 요청 시각: ${fmt(now)}<br>
        • 예상 완료: ~${fmt(finishApprox)} (3~5분 후)<br>
        • <a href="${GITHUB_ECM_ACTIONS_URL}" target="_blank" rel="noopener">GitHub Actions 페이지에서 진행 상황 확인</a>
      </div>
    `;

    btn.textContent = "✓ 요청 완료 (수 분 후 사이트 확인)";
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "지금 실행";
    }, 30 * 1000);
  } catch (e) {
    statusBox.className = "trigger-status status-error";
    const msg = e.message || String(e);
    let hint = "";
    if (msg.includes("Permission denied")) {
      hint = "<br><br>관리자 권한 필요. 로그아웃 후 다시 로그인해 보세요.";
    } else if (msg.includes("function") && msg.includes("does not exist")) {
      hint = "<br><br>RPC 함수 미생성. Supabase SQL Editor 에서 trigger_ecm_update 함수 생성 SQL 실행 필요.";
    }
    statusBox.innerHTML = `
      <div class="ts-title">❌ 실행 요청 실패</div>
      <div>${escapeHtml(msg)}${hint}</div>
    `;
    btn.disabled = false;
    btn.textContent = "지금 실행";
  }
}

// =========================== DELETE ===========================
let deleteSetupDone = false;

function setupDeleteUI() {
  if (deleteSetupDone) return;
  deleteSetupDone = true;
  const input = document.getElementById("delete-search-input");
  const btn = document.getElementById("btn-delete-search");
  btn.onclick = doDeleteSearch;
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") doDeleteSearch();
  });
}

async function doDeleteSearch() {
  const q = document.getElementById("delete-search-input").value.trim();
  const results = document.getElementById("delete-results");
  if (!q) {
    results.innerHTML = `<div class="delete-empty-msg">발행사명을 입력하세요.</div>`;
    return;
  }
  results.innerHTML = `<div class="delete-empty-msg">검색 중...</div>`;

  try {
    const { data, error } = await sb
      .from("records")
      .select("issuer_alias,series,subscription_date,bond_type,credit_rating,final_amount,rcept_no")
      .ilike("issuer_alias", `%${q}%`)
      .order("subscription_date", { ascending: false })
      .order("series", { ascending: true })
      .limit(50);
    if (error) throw error;
    renderDeleteResults(data || [], q);
  } catch (e) {
    results.innerHTML = `<div class="delete-empty-msg" style="color:var(--danger);">
      검색 실패: ${escapeHtml(e.message || String(e))}
    </div>`;
  }
}

function renderDeleteResults(rows, q) {
  const results = document.getElementById("delete-results");
  if (rows.length === 0) {
    results.innerHTML = `<div class="delete-empty-msg">
      "${escapeHtml(q)}" 검색 결과 없음.
    </div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "delete-results-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>청약일</th>
        <th>발행사</th>
        <th>회차</th>
        <th>종류</th>
        <th>등급</th>
        <th style="text-align:right;">발행금액</th>
        <th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.subscription_date || "")}</td>
      <td>${escapeHtml(r.issuer_alias || "")}</td>
      <td>${escapeHtml(r.series || "")}</td>
      <td>${escapeHtml(r.bond_type || "")}</td>
      <td>${escapeHtml(r.credit_rating || "")}</td>
      <td style="text-align:right;">${fmtAmt(r.final_amount)}</td>
      <td style="text-align:right;"><button class="btn-danger">🗑️ 삭제</button></td>
    `;
    tr.querySelector("button").onclick = () => deleteRecord(r, tr);
    tbody.appendChild(tr);
  });

  results.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "muted small";
  summary.style.cssText = "margin-bottom: 8px;";
  summary.textContent = `검색 결과: ${rows.length}건${rows.length === 50 ? " (최대 50건 표시)" : ""}`;
  results.appendChild(summary);
  results.appendChild(table);
}

async function deleteRecord(r, trElement) {
  const label = `${r.issuer_alias} ${r.series} (${r.subscription_date})`;
  if (!confirm(`정말 삭제하시겠습니까?\n\n${label}\n\n이 작업은 되돌릴 수 없습니다 (audit_log 에 기록은 남음).`)) {
    return;
  }

  const btn = trElement.querySelector("button");
  btn.disabled = true;
  btn.textContent = "삭제 중...";

  try {
    const { error } = await sb
      .from("records")
      .delete()
      .eq("issuer_alias", r.issuer_alias)
      .eq("series", r.series)
      .eq("subscription_date", r.subscription_date);
    if (error) throw error;

    // 행 fade out + 제거
    trElement.style.transition = "opacity 0.3s, background 0.3s";
    trElement.style.opacity = "0.4";
    trElement.style.background = "rgba(220, 38, 38, 0.08)";
    setTimeout(() => trElement.remove(), 400);

    // audit log 새로고침 (DELETE entry 확인)
    setTimeout(() => loadAuditLog().catch(() => {}), 600);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "🗑️ 삭제";
    showError(`삭제 실패: ${e.message || e}`);
  }
}

// =========================== AUDIT LOG ===========================
let auditSetupDone = false;

function setupAuditButtons() {
  if (auditSetupDone) return;
  auditSetupDone = true;
  document.getElementById("btn-audit-refresh").onclick = () => loadAuditLog();
  document.getElementById("audit-filter-table").onchange = () => loadAuditLog();
}

async function loadAuditLog() {
  const list = document.getElementById("audit-list");
  list.innerHTML = `<div class="muted small" style="padding:20px; text-align:center;">불러오는 중...</div>`;

  try {
    let query = sb.from("audit_log")
      .select("id,table_name,operation,row_pk,old_data,new_data,changed_by_email,changed_at")
      .order("changed_at", { ascending: false })
      .limit(100);

    const tbl = document.getElementById("audit-filter-table").value;
    if (tbl) query = query.eq("table_name", tbl);

    const { data, error } = await query;
    if (error) throw error;

    renderAuditList(data || []);
  } catch (e) {
    list.innerHTML = `<div class="muted small" style="padding:20px; text-align:center; color:var(--danger);">
      audit_log 로드 실패: ${escapeHtml(e.message || String(e))}
    </div>`;
  }
}

function renderAuditList(rows) {
  const list = document.getElementById("audit-list");
  if (rows.length === 0) {
    list.innerHTML = `<div class="muted small" style="padding:24px; text-align:center;">
      변경 내역이 없습니다.
    </div>`;
    return;
  }

  list.innerHTML = "";
  rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "audit-row";
    row.dataset.idx = idx;
    const pk = r.row_pk || {};
    const target = formatTarget(r.table_name, pk);
    row.innerHTML = `
      <div class="a-time" title="${escapeHtml(r.changed_at)}">${formatKstTime(r.changed_at)}</div>
      <div class="a-op op-${escapeHtml(r.operation)}">${escapeHtml(r.operation)}</div>
      <div class="a-table">${escapeHtml(r.table_name)}</div>
      <div class="a-target" title="${escapeHtml(JSON.stringify(pk))}">${escapeHtml(target)}</div>
      <div class="a-toggle">상세 ▼</div>
    `;
    list.appendChild(row);

    const detail = document.createElement("div");
    detail.className = "audit-detail";
    detail.hidden = true;
    detail.innerHTML = renderAuditDetail(r);
    list.appendChild(detail);

    row.onclick = () => {
      detail.hidden = !detail.hidden;
      row.querySelector(".a-toggle").textContent = detail.hidden ? "상세 ▼" : "닫기 ▲";
    };
  });
}

function renderAuditDetail(r) {
  const email = r.changed_by_email || "(system)";
  let html = `<div class="ad-section">
    <span class="ad-label">사용자</span>
    <div class="ad-email">${escapeHtml(email)}</div>
  </div>`;

  if (r.operation === "INSERT" && r.new_data) {
    html += `<div class="ad-section">
      <span class="ad-label">신규 데이터</span>
      <div>${escapeHtml(prettyJson(r.new_data))}</div>
    </div>`;
  } else if (r.operation === "DELETE" && r.old_data) {
    html += `<div class="ad-section">
      <span class="ad-label">삭제 전 데이터</span>
      <div>${escapeHtml(prettyJson(r.old_data))}</div>
    </div>`;
  } else if (r.operation === "UPDATE") {
    const diff = computeDiff(r.old_data || {}, r.new_data || {});
    if (diff.length === 0) {
      html += `<div class="ad-section muted">(변경된 필드 없음)</div>`;
    } else {
      html += `<div class="ad-section">
        <span class="ad-label">변경된 필드 (${diff.length}개)</span>
        ${diff.map(d => `
          <div class="ad-diff-line diff-del">- ${escapeHtml(d.key)}: ${escapeHtml(prettyValue(d.old))}</div>
          <div class="ad-diff-line diff-add">+ ${escapeHtml(d.key)}: ${escapeHtml(prettyValue(d.new))}</div>
        `).join("")}
      </div>`;
    }
  }
  return html;
}

function formatTarget(table, pk) {
  if (table === "records") {
    const issuer = pk.issuer_alias || "?";
    const series = pk.series || "?";
    const date = pk.subscription_date || "?";
    return `${issuer} ${series} (${date})`;
  } else if (table === "processed_rcepts") {
    return `rcept_no: ${pk.rcept_no || "?"}`;
  }
  return JSON.stringify(pk);
}

function formatKstTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  // KST 로 포맷팅
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const da = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da} ${hh}:${mm}`;
}

// 표시에서 제외할 auto-managed 필드들 (trigger 의 no-op 비교에서도 제외됨)
const AUTO_FIELDS_TO_HIDE = new Set(["id", "updated_at", "created_at"]);

function computeDiff(oldObj, newObj) {
  const diffs = [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const k of allKeys) {
    if (AUTO_FIELDS_TO_HIDE.has(k)) continue;
    const o = oldObj[k];
    const n = newObj[k];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      diffs.push({ key: k, old: o, new: n });
    }
  }
  return diffs;
}

function prettyJson(obj) {
  try { return JSON.stringify(obj, null, 2); }
  catch { return String(obj); }
}
function prettyValue(v) {
  if (v === null || v === undefined) return "(없음)";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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

// =========================== Theme ===========================
function setupTheme() {
  const root = document.documentElement;
  const KEY = "deallist-theme";
  if (localStorage.getItem(KEY) !== "light") root.setAttribute("data-theme", "dark");
  const btn = document.getElementById("btn-theme");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (root.getAttribute("data-theme") === "dark") {
      root.removeAttribute("data-theme"); localStorage.setItem(KEY, "light");
    } else {
      root.setAttribute("data-theme", "dark"); localStorage.setItem(KEY, "dark");
    }
  });
}
