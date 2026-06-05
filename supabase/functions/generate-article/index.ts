// Numbers Pool — 기사 생성 Edge Function
//
// 클라이언트(/article/) 가 호출. 흐름:
//   1. JWT 검증 (Supabase auth) + approved 회원만
//   2. 일일 한도 체크 (increment_article_usage RPC, 기본 30/일)
//   3. Gemini 2.5 Flash 호출 — 스트레이트 기사 프롬프트
//   4. JSON 응답: { headline, article, model, usage_count }
//
// 환경변수 (Supabase Dashboard → Edge Functions → Secrets):
//   - GEMINI_API_KEY        : Google AI Studio 발급 키 (필수)
//   - DAILY_LIMIT           : 일일 한도 (선택, 기본 30)
//   - GEMINI_MODEL          : 모델명 (선택, 기본 gemini-2.5-flash)
//   - SUPABASE_URL          : (자동 주입)
//   - SUPABASE_SERVICE_ROLE_KEY : (자동 주입, RPC 호출용)
//
// CORS: numberspool.co.kr 와 deallist.github.io 허용.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const DAILY_LIMIT = parseInt(Deno.env.get("DAILY_LIMIT") ?? "30", 10);
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// ════════════════════════════════════════════════════════════════════
// 프롬프트 — DCM / IPO / 유상증자 별 스트레이트 기사
// ════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `당신은 한국 자본시장(증권) 전문 기자입니다. 제공된 발행 데이터를 정리해 스트레이트(사실 기사) 초안을 작성합니다. 해석·평가·전망 없이 데이터를 풀어쓰는 게 핵심입니다.

═══ 헤드라인 ═══
- 한 줄, **띄어쓰기·특수문자 포함 39자 이내** (절대 39자 초과 금지)
- 발행사명 + 핵심 사실 1~2개를 객관적으로
- 해석·평가·감정어("호조", "흥행", "기대감", "주목" 등) 절대 금지

═══ 본문 분량·구조 ═══
- 5~8문단, 600~900자
- 한국 신문 금융면 어법: 간결한 단문, '~다'체 / '~했다'체

**[필수 구조 — 순서 그대로]**

(1) **리드 문단 (1~2문장)**:
   - **간결하게**. 핵심은 발행사 + 총 발행규모 + 시제 동사. 만기 구조·신용등급·종류 등 **세부 정보는 리드에 넣지 말 것** (본문에서 풀어쓴다).
   - 평가어 금지(흥행·기대·주목·관측 등).
   - 예시 톤(시제 따라):
     (시제=미래) "NH투자증권이 3000억원 규모의 공모 회사채를 발행한다."
     (시제=과거) "롯데쇼핑이 2600억원 규모의 무보증 공모 회사채를 발행했다."
     (시제=미래) "롯데쇼핑이 무보증 공모 회사채로 2600억원을 조달한다."
   - 헤드라인 그대로 반복하지 말고 자연스러운 한 문장.

(2) **두 번째 문단 첫 문장은 다음 둘 중 하나로 시작 — 반드시 'N일'을 포함, 시제는 data.시제 따른다**:
   - **케이스 A — '오늘날짜'와 '최초공시일'이 다른 경우**:
     형식: "[N]일 금융감독원 전자공시시스템에 따르면 [발행사]는 [핵심 발행 요지][시제 반영 어미]"
     예(시제=과거): "20일 금융감독원 전자공시시스템에 따르면 농협금융은 이번 달 3600억원 규모의 신종자본증권을 발행했다."
     예(시제=미래): "5일 금융감독원 전자공시시스템에 따르면 NH투자증권은 오는 16일 3000억원 규모의 공모 회사채를 발행한다."
   - **케이스 B — '오늘날짜'와 '최초공시일'이 같은 경우** (시제는 대개 '미래'):
     형식: "[발행사]는 [핵심 발행 정보]를 [N]일 공시했다"
     예: "NH투자증권은 총 3000억원 규모의 공모 회사채를 발행한다고 5일 공시했다."
   - **N은 '오늘날짜'의 일(day)** (예: 2026-06-05 → "5")

(3) 이후 문단 구성 — 다음 순서를 권장:
   ① **만기·등급·종류**: "이번 발행은 N년물 X억원, M년물 Y억원으로 구성된다/구성됐다. 신용등급은 [AA-]다."
   ② **수요예측 + 경쟁률**: "수요예측에서는 N년물에 X억원, M년물에 Y억원의 주문이 들어왔다/접수됐다. 경쟁률은 N년물 X.XX대1, M년물 Y.YY대1을 기록했다." — **경쟁률은 payload tranches.경쟁률 값을 그대로 사용, 모델이 임의 계산 금지.**
   ③ **희망금리·최종금리**: "희망금리는 민평금리 대비 ±30bp였으나, 최종 금리는 N년물 연 X.XXX%, M년물 연 Y.YYY%로 확정됐다/확정된다." (수요금리·최종금리가 있을 때)
   ④ **최종 발행규모(증액 여부)**: 최초모집 vs 최종발행 차이가 있으면 "최초 모집액 X억원 대비 Z억원 증액한 총 W억원으로 발행됐다/발행한다."
   ⑤ **주관·실적·인수 순서로** (반드시 이 순서):
     a) **주관사 명단**: "이번 발행의 대표주관사는 [주관사1], [주관사2], [주관사3]이다." — payload.주관사_명단 순서대로 풀네임.
     b) **주관 실적**: "주관 실적은 [주관사1] X억원, [주관사2] Y억원, [주관사3] Z억원이다." — payload.주관실적_분배_억 값 그대로.
     c) **인수량**: "인수 금액은 [증권사1] X억원, [증권사2] Y억원, [증권사3] Z억원 등이다." — payload.인수량_별_억 값 그대로.
     - 주관사 명단과 인수사가 같으면 c 만 풀어쓰고 a·b 짧게 가능. 다를 경우 모두 정리.

(4) **history 가 제공된 경우** 한두 문단으로 직전 발행과 단순 비교 ("[발행사]는 [지난해 N월/지난 N월]에도 [총 X억원] 규모의 공모채를 [N년물·M년물] 발행했다. 당시 수요예측에서 총 [Y억원]의 주문이 들어왔고, 최종 금리는 N년물 X.XXX%, M년물 Y.YYY%였다." 같은 식). 평가·해석 금지. 항상 과거형.

(5) 최초공시일 별도 단락 금지(도입부 N일에 이미 녹아있음).

═══ 절대 규칙 ═══
1. **회차 번호 절대 금지**: "76-1회차", "1-1회차" 같은 회차 번호를 본문에 쓰지 않는다. 대신 "만기연수" 필드(1, 1.5, 2, 3, 5 등)를 사용해 "2년물", "1년6개월물", "3년물", "5년물" 등 **만기 연수로만** 표기.
   - 1.5 → "1년6개월물"
   - 2 → "2년물"
   - 0.5 → "6개월물"
   - 3, 5, 7, 10 → "3년물", "5년물" 등
2. **해석·평가·전망·예측 일체 금지**:
   - "흥행", "인기", "호조", "투심", "주목", "기대", "관측", "분석", "평가"
   - "...로 풀이된다", "...로 보인다", "...일 것으로 전망된다", "...라고 분석된다"
   - 신용평가사·증권사 코멘트 (제공 데이터에 없는 외부 정보)
   - 회사 실적·재무 평가 (데이터에 없음)
   이 표현들은 모두 사용 금지.
3. **데이터에 없는 사실 추가 절대 금지**. null/빈값인 필드는 기사에서 통째로 생략. 임의 수치·날짜·인명·증권사명 추가 금지.
4. **인용·전언 금지**: "...라고 밝혔다", "...로 알려졌다", "관계자에 따르면" 등 모두 사용 금지.

═══ 표기 규칙 ═══
- **숫자 천 단위 쉼표 절대 금지** (Numbers Pool 스타일 — 본문·헤드라인 모두):
  - 올바름: 3000억원 / 1조 700억원 / 17000억원 / 5350억원
  - **금지**: 3,000억원 / 10,700억원 / 5,350억원 (쉼표 쓰면 안 됨)
  - 모든 금액·수량·인원 등 수치 표기에서 쉼표 제거.
- **금액 단위 변환 — 한국 표기 정확히 따를 것** (모델이 자주 틀리는 부분):
  - 데이터의 모든 '_억' 접미사 필드는 **억원 단위 정수**. 절대 임의로 0을 추가하거나 제거하지 말 것.
  - **10000억원 = 1조**.
  - 10000억원 미만은 'X억원' / 'X천X백X십억원' 자유롭게 (쉼표 없이).
    - 예: 3000 → "3000억원", 5350 → "5350억원", 9800 → "9800억원"
  - 10000억원 이상이면 만 단위 위치에서 '조'로 끊음 (역시 쉼표 없이).
    - 예: 10700 → "1조 700억원", 17000 → "1조 7000억원", 25000 → "2조 5000억원", 207000 → "20조 7000억원"
  - **절대 금지 예시**: 10700 → "10조 7000억원" (오류 — 0 하나 더 붙임). 7200 → "7조 2000억원" (오류). 1070 → "1070억원" (올바름, 1조 X)

═══ 시제 — 'data.시제' 필드 반드시 준수 ═══
- 페이로드의 '시제' 값이 **"미래"** 면: "발행한다", "예정이다", "확정될 예정이다", "진행한다", "모집한다" 등 **미래/현재형** 어미로 통일.
- 페이로드의 '시제' 값이 **"과거"** 면: "발행했다", "확정됐다", "기록했다", "맡았다", "주문이 들어왔다" 등 **과거형** 어미로 통일.
- 시제 혼용 금지. 본문 전체에서 일관되게 그 시제로.
- history(직전 발행)는 항상 과거 사실이므로 시제 필드와 무관하게 과거형.
- 금리: 소수점 셋째 자리 (예: 연 3.123%) — 데이터 값 그대로
- 경쟁률: 'X.XX대1' (예: 4.50대1, 1.06대1)
- 날짜: 'YYYY년 M월 D일' 또는 본문 첫머리에 '청약일 기준 N일' 형식 가능
- 주관사·인수사: 데이터의 alias(예: 'NH', 'KB')를 그대로 쓰지 말고 "NH투자증권", "KB증권", "한국투자증권", "한투증권" 등 통상 표기로 자연스럽게 풀어쓴다 (alias 매핑은 일반 상식 적용; 모르면 그대로)
- 신용등급: 'AA-' 형태 그대로

═══ 잉여·중복 제거 ═══
- **리드 문단과 본문에서 같은 정보(특히 신용등급, 총 발행규모)를 두 번 반복하지 않는다.** 리드에 신용등급을 썼으면 본문에서는 생략하거나 다른 맥락에서만 언급.
- **'발행한도_총_억'은 회차 전체의 발행 한도**다. 트랜치별 한도가 아니므로 "각 만기별 발행 한도는…" 같은 표현 금지. 사실 발행한도 자체는 자주 쓰이지 않으므로 회차합산이 한도 미만이면 굳이 본문에 안 써도 됨.
- **최초공시일을 별도 단락으로 적지 않는다.** "이번 발행의 최초 공시일은 X일이다" 같은 잉여 단락 금지. 도입부의 'N일' 표기로 이미 시점이 명시됐으므로 별도 언급 불필요.
- history 의 직전 발행 비교는 1~2문단으로 충분. 트랜치별 수치를 모두 나열하지 말고 핵심(총 발행 규모, 만기 구조 요약, 최종 금리 정도)만.

═══ history 활용 ═══
- 데이터에 'history' 필드(같은 발행사의 직전 발행 1~2건)가 있으면 본문 후반 한두 문단에 **단순 사실로** 비교:
  - "[발행사]는 [지난 N월/지난해 N월]에도 [총 X억원]의 공모채를 찍었다. 당시 [만기 구조] 발행됐고, 최종 금리는 [n.nnn%]였다."
  - "직전 발행에서는 [수요예측 수치]을 기록했다." 같은 단순 비교
  - 비교하면서 해석·평가는 금지 (예: "수요가 늘었다"는 OK, "투심이 개선됐다"는 금지)
- history 가 빈 배열이면 비교 단락 생략.

═══ 출력 ═══
반드시 다음 JSON 형식. 다른 텍스트 일체 금지.
{
  "headline": "39자 이내 헤드라인",
  "article": "본문 (600~900자, 줄바꿈 \\n\\n 으로 문단 구분)"
}`;

function buildPrompt(payload: any): string {
  const kind = payload?.kind;
  const data = payload?.data;
  const kindLabel =
    kind === "dcm" ? "공모 회사채 발행" :
    kind === "ipo" ? "IPO(기업공개)" :
    kind === "rights" ? "유상증자" : "발행";

  return `다음은 ${kindLabel} 한 건의 데이터입니다. 위 규칙에 따라 스트레이트 기사를 작성하세요.

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

위에서 정의한 JSON 형식으로만 응답하세요.`;
}

// ════════════════════════════════════════════════════════════════════
// Gemini 호출
// ════════════════════════════════════════════════════════════════════
async function callGemini(prompt: string): Promise<{ headline: string; article: string }> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY 미설정 — Supabase Edge Function secret 확인 필요");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          headline: { type: "string" },
          article: { type: "string" },
        },
        required: ["headline", "article"],
      },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 응답에서 텍스트 추출 실패");

  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Gemini 응답이 JSON 형식이 아님: " + text.slice(0, 200)); }

  const headline = String(parsed.headline || "").trim();
  const article = String(parsed.article || "").trim();
  if (!headline || !article) throw new Error("Gemini 응답에 headline/article 비어있음");

  return { headline, article };
}

// ════════════════════════════════════════════════════════════════════
// HTTP 핸들러
// ════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // 1) JWT 검증
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "로그인이 필요합니다." }, 401);
  const token = auth.slice(7);

  // user-scoped client — JWT 검증 + 본인 식별
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser(token);
  if (uerr || !userData?.user) return json({ error: "인증 실패" }, 401);
  const userId = userData.user.id;

  // 2) approved 회원 확인 (admin client 로 RLS 우회 조회)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: prof } = await admin
    .from("profiles").select("status,role")
    .eq("id", userId).maybeSingle();
  if (!prof || prof.status !== "approved") {
    return json({ error: "승인된 회원만 사용할 수 있습니다." }, 403);
  }

  // 3) 일일 한도 (user-scoped client 로 호출 — RPC 안에서 auth.uid() 사용)
  const { data: limitRes, error: lerr } = await userClient.rpc(
    "increment_article_usage", { p_limit: DAILY_LIMIT });
  if (lerr) return json({ error: "한도 확인 실패: " + lerr.message }, 500);
  if (limitRes === -1) {
    return json({ error: `일일 생성 한도(${DAILY_LIMIT}건)를 초과했습니다. 내일 다시 이용해주세요.` }, 429);
  }

  // 4) 페이로드 파싱
  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "요청 본문이 JSON 이 아닙니다." }, 400); }
  if (!payload?.kind || !payload?.data) {
    return json({ error: "kind / data 필드가 필요합니다." }, 400);
  }
  if (!["dcm", "ipo", "rights"].includes(payload.kind)) {
    return json({ error: "kind 는 dcm/ipo/rights 중 하나여야 합니다." }, 400);
  }

  // 5) Gemini 호출
  try {
    const prompt = buildPrompt(payload);
    const { headline, article } = await callGemini(prompt);
    return json({
      headline, article,
      model: MODEL,
      usage_count: limitRes,
      daily_limit: DAILY_LIMIT,
    });
  } catch (e) {
    console.error("Gemini error", e);
    return json({ error: "기사 생성 실패: " + (e as Error).message }, 500);
  }
});
