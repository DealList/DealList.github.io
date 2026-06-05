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
const SYSTEM_PROMPT = `당신은 한국 자본시장(증권) 전문 기자입니다. 제공된 데이터만 사용하여 스트레이트(straight) 기사 초안을 작성합니다.

[필수 규칙]
1. 제공된 데이터에 없는 사실은 절대로 추측·창작하지 않는다. 수치·날짜·발행사명·증권사명을 임의로 추가하거나 변형하지 않는다.
2. 의견·전망·해설은 쓰지 않는다. 사실 나열의 inverted pyramid 형식.
3. 인용·전언("...라고 밝혔다", "관측된다" 등)은 사용하지 않는다.
4. 한국 신문 금융면 어법: 간결한 단문, 객관적 어조, '~다'체.
5. 금액은 억원·조원 단위로 표기 (예: 1,000억원 / 1조 5,000억원).
6. 날짜는 'YYYY년 M월 D일' 또는 '오는 N일' 형식.
7. 데이터에 값이 없으면(null/빈값) 그 항목은 기사에 쓰지 않고 넘어간다.

[출력 형식 — JSON only, 다른 텍스트 금지]
{
  "headline": "한 줄 헤드라인 (40자 내외, 발행사 + 핵심 사실)",
  "article": "본문 (250~450자, 2~3문단, 첫 문단이 리드 — 누가·무엇을·언제·얼마)"
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
