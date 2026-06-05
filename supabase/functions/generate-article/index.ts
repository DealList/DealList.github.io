// Numbers Pool — 기사 생성 Edge Function
//
// 클라이언트(/article/) 가 호출. 흐름:
//   1. JWT 검증 (Supabase auth) + approved 회원만
//   2. 일일 한도 체크 (increment_article_usage RPC, 기본 30/일)
//   3. OpenAI (gpt-4.1-mini) 호출 — 스트레이트 기사 프롬프트
//   4. 검증-재생성 루프 (헤드라인 39자 / 천단위 쉼표 등 — 모델이 못 지키는 규칙을 코드로 강제)
//   5. JSON 응답: { headline, article, model, usage_count }
//
// 환경변수 (Supabase Dashboard → Edge Functions → Secrets):
//   - OPENAI_API_KEY        : platform.openai.com 발급 키 (필수)
//   - DAILY_LIMIT           : 일일 한도 (선택, 기본 30)
//   - OPENAI_MODEL          : 모델명 (선택, 기본 gpt-4.1-mini)
//   - HEADLINE_MAX          : 헤드라인 최대 글자수 (선택, 기본 39)
//   - SUPABASE_URL          : (자동 주입)
//   - SUPABASE_SERVICE_ROLE_KEY : (자동 주입, RPC 호출용)
//
// CORS: numberspool.co.kr 와 deallist.github.io 허용.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const DAILY_LIMIT = parseInt(Deno.env.get("DAILY_LIMIT") ?? "30", 10);
const MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";
const HEADLINE_MAX = parseInt(Deno.env.get("HEADLINE_MAX") ?? "39", 10);

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
- 한 줄, **띄어쓰기·특수문자·쉼표·말줄임표 포함 39자 이내** (절대 39자 초과 금지)
- **형식: "[발행사명], [발행규모][종류] 발행…[핵심 사실 1개]"**
  - **발행사명 직후 쉼표(,) 필수.**
  - **딜 규모·종류 뒤에 말줄임표(…, 한 글자)를 찍고 그 뒤에 객관적 핵심 사실 1개를 덧붙인다.** 단순 "OO억 공모채 발행"으로 끝내는 밋밋한 제목 금지.
    - 둘째 정보는 **그 딜에서 가장 뉴스가치 있는 사실 하나를 직접 판단해 고른다** (고정된 한 종류가 아니다 — 딜마다 달라야 한다). 후보: 증액 규모 / 특이 만기 구성 / 높은 수요예측 경쟁률 / 언더·민평 대비 금리 / 신용등급 / 자금 용도 등. 전부 사실, 평가·감정어 금지.
      · 선택 기준: 이 딜에서 가장 두드러진 한 가지. 증액이 컸으면 증액, 금리가 이례적이면 금리, 만기 구성이 특이하면 만기, 청약 경쟁률이 높으면 경쟁률 — **딜마다 다르게**.
    - **증액은 'payload 증액_총_억 > 0'일 때만** 둘째 정보로 쓸 수 있다 — 증액이 없거나 0이면 헤드라인에 증액을 쓰지 말고 다른 특징(만기·금리·경쟁률 등)을 고른다. 증액을 쓸 땐 반드시 '증액_총_억'(회차 합산) 값으로 (트랜치별 증액액 금지).
    - **유증·IPO는 'payload 조달규모_변화'(최초희망_억→최종_억)가 있으면 그 '조달 규모 증감'을 둘째 정보로 우선** 고려한다 — 가격(확정가)보다 '얼마 조달하려 했는데 얼마로 늘었/줄었나'가 더 중요. 예: 최초 1조 → 최종 1조1671억이면 "…1671억 증액" 또는 "…조달액 1671억↑" 식. 증감_억이 0이면 다른 특징(증자비율 등)을.
  - 예: "롯데쇼핑, 2600억 공모채 발행…600억 증액"   ← 증액이 큰 딜
  - 예: "NH투자증권, 3000억 공모채 발행…2·3년물 구성"   ← 만기 구성이 특징인 딜
  - 예: "CJ ENM, 2100억 공모채 발행…언더금리 확정"   ← 금리가 특징인 딜
  - 예: "한국전력, 4000억 공모채 발행…경쟁률 5대1"   ← 수요예측이 특징인 딜
- **'무보증'은 헤드라인에 쓰지 않는다** (일반 공모채는 대부분 무보증이라 정보가치 없음). 단 **신종자본증권·후순위채 등 특수채일 때만** 그 종류를 헤드라인에 명기.
- 해석·평가·감정어("호조", "흥행", "기대감", "주목" 등) 절대 금지
- 헤드라인은 압축 표기 — 39자 안에 들기 위해 "억원" → "억", "공모 회사채" → "공모채/회사채" 등 단축 OK

═══ 본문 분량·구조 ═══
- 5~8문단, 600~900자
- 한국 신문 금융면 어법: 간결한 단문, '~다'체 / '~했다'체
- **payload 에 있는 사실은 최대한 활용해 기사를 풍성하게** 한다(누락 최소화). 단 null/빈값·미확정 항목은 (절대 규칙대로) 생략하고, 데이터에 없는 사실은 지어내지 않는다.

**[필수 구조 — 순서 그대로]**

(1) **리드 문단 (1~2문장)**:
   - **간결하게**. 핵심은 발행사 + 총 발행규모 + 시제 동사. 만기 구조·신용등급 등 **세부 정보는 리드에 넣지 말 것** (본문에서 풀어쓴다).
   - **'무보증'은 헤드라인·리드에서만 제외**한다. 리드에선 "공모 회사채"로만 쓴다. 단 **바로 다음 (2)번째 문단(금융감독원 인용 문장)에서는 '무보증 공모 회사채'로 딱 한 번 명기**한다(본문 전체에서 1회).
     - **예외 — 신종자본증권·후순위채 등 특수채**일 때만 그 종류를 헤드라인·리드·본문 모두에 명기한다. (예: "농협금융지주가 3600억원 규모의 신종자본증권을 발행한다.")
   - 평가어 금지(흥행·기대·주목·관측 등).
   - 예시 톤(시제 따라):
     (시제=미래) "NH투자증권이 3000억원 규모의 공모 회사채를 발행한다."
     (시제=과거) "롯데쇼핑이 2600억원 규모의 공모 회사채를 발행했다."
     (시제=미래) "롯데쇼핑이 공모 회사채로 2600억원을 조달한다."
   - 헤드라인 그대로 반복하지 말고 자연스러운 한 문장.

(2) **두 번째 문단 첫 문장 — DCM·IPO·유상증자 모두 반드시 이 도입부로 시작한다(생략 금지). '오늘날짜'와 '최초공시일'을 비교해 아래 두 형식 중 하나만 쓴다. 시제는 data.시제 따른다.**:
   - ⚠️ **이 "[N]일 금융감독원 전자공시시스템에 따르면 …" 도입부를 절대 빠뜨리지 말 것** — 회사채뿐 아니라 IPO·유증 기사에도 똑같이 필수.
   - **제품별 핵심 일자/표현** (회사채 = 청약일=발행일+무보증 공모 회사채 / IPO = 상장(예정)일·공모 / 유상증자 = 납입일·신주배정기준일):
     예(유증, 시제=미래): "5일 금융감독원 전자공시시스템에 따르면 이렘은 오는 8월7일 납입을 목표로 480만주를 발행하는 113억원 규모의 주주배정 유상증자를 실시한다."
     예(IPO, 시제=미래): "5일 금융감독원 전자공시시스템에 따르면 레메디는 코스닥 상장을 위해 120만주 규모의 공모를 진행한다."
   - ⚠️ **두 형식을 절대 섞지 말 것** — 특히 "…에 따르면"과 "…공시했다"를 한 문장에 함께 쓰지 않는다.
   - **케이스 A — '오늘날짜' ≠ '최초공시일'** (과거에 나온 공시를 지금 정리): **"…에 따르면 … 발행한다/발행했다"** 형식, **'공시했다'는 쓰지 않는다.**
     형식: "[N]일 금융감독원 전자공시시스템에 따르면 [발행사]는 [발행일_표현] [총 규모] 규모의 무보증 공모 회사채를 [시제 어미]"
     예(시제=미래): "5일 금융감독원 전자공시시스템에 따르면 롯데쇼핑은 오는 10일 2년물과 3년물로 나눠 총 2600억원 규모의 무보증 공모 회사채를 발행한다."
     예(시제=과거): "20일 금융감독원 전자공시시스템에 따르면 농협금융지주는 지난 12일 3600억원 규모의 신종자본증권을 발행했다."
   - **케이스 B — '오늘날짜' = '최초공시일'** (오늘 나온 공시를 오늘 기사화, 시제는 대개 '미래'): **'금융감독원…에 따르면'을 붙이지 않고** 문장 끝에 "[N]일 공시했다"만 쓴다.
     형식: "[발행사]는 [발행일_표현] [총 규모] 규모의 무보증 공모 회사채를 발행한다고 [N]일 공시했다."
     예: "롯데쇼핑은 오는 10일 2년물과 3년물로 나눠 총 2600억원 규모의 무보증 공모 회사채를 발행한다고 5일 공시했다."
   - **N은 반드시 payload '오늘일' 필드 값**(=오늘 날짜의 일)이다. ⚠️ **'최초공시일'의 일과 절대 혼동하지 말 것** — N에는 오늘일만 쓴다. (예: 오늘일=5, 최초공시일=…06-04 여도 도입부는 "5일 …에 따르면".)
   - **발행일·상장일·신주배정기준일·납입일 등 본문 날짜는 payload 의 해당 '_표현' 필드(발행일_표현/상장일_표현/신주배정기준일_표현/납입일_표현)를 그대로 쓴다.** 이 필드엔 오늘 기준 상대 표현이 이미 계산돼 있다: "지난 1일"/"오는 16일"(같은 달)·"이날"(오늘과 같은 날)·"지난달 30일"/"다음달 5일"(±1달)·"지난 4월 19일"/"오는 8월 7일"(±2달↑). **임의로 'N월 N일'을 만들지 말고 _표현 값을 쓸 것.** (회사채는 청약일=발행일이므로 발행일_표현을 본문에 반드시 명기.)

(3) 이후 문단 구성 — 다음 순서를 권장:
   ① **만기·등급·종류**:
      - **일반 회사채(트랜치 2개 이상)**: "이번 발행은 N년물 X억원, M년물 Y억원으로 구성된다/구성됐다. 신용등급은 [AA-]다."
      - **신종자본증권·후순위채 등 특수채**: 이들은 본래 트랜치가 하나이므로 **"단일물", "단일 트랜치", "만기 연수가 명시되지 않은…" 같은 구성 설명을 쓰지 않는다.** ①은 신용등급 등만 간단히 쓴다(예: "신용등급은 AA-다."). 만기연수 데이터가 없으면 만기를 아예 언급하지 말 것(영구·콜옵션 등 데이터가 있을 때만 그 사실을 쓴다).
      - **일반 회사채라도 트랜치가 하나면** "단일물"이라 하지 말고 그 만기를 그대로 쓴다("3년물로 발행한다").
   ② **수요예측 + 경쟁률**: "수요예측에서는 N년물에 X억원, M년물에 Y억원의 주문이 들어왔다/접수됐다. 경쟁률은 N년물 X.XX대1, M년물 Y.YY대1을 기록했다." — **경쟁률은 payload tranches.경쟁률 값을 그대로 사용, 모델이 임의 계산 금지.**
   ②-IPO **(IPO 청약 단락)** — payload '기관'·'일반'·'우리사주'로 쓴다.
      - **기관·일반은 '경쟁률'(단위 대1)**: "기관투자자 대상 청약에서는 X주 모집에 Y주가 접수돼 경쟁률 Z대1을 기록했다. 일반 청약에서는 …" — payload.기관.compete / 일반.compete 값 그대로(임의 계산 금지).
      - ⚠️ **'우리사주'는 경쟁률(배·대1)이 아니라 '청약률(%)'이다.** payload.우리사주.청약률은 이미 "43.3%" 같은 **% 문자열**로 제공되니 **그대로 쓰고, 절대 '배'·'대1'·'배정률'로 바꾸지 말 것.** 의미: 우리사주조합 배정물량(우리사주.배정물량) 대비 실제 직원 청약물량(우리사주.청약물량)의 비율. 예: "우리사주 청약은 17만2900주 배정에 7만4869주가 청약돼 **43.3%의 청약률**을 기록했다." (X: "0.43배의 배정률")
      - 우리사주 배정물량이 0이거나 데이터가 없으면 우리사주 문장은 생략한다.
   ③ **희망금리·최종금리**: "희망금리는 민평금리 대비 ±30bp였으나, 최종 금리는 N년물 연 X.XXX%, M년물 연 Y.YYY%로 확정됐다/확정된다." (수요금리·최종금리가 있을 때)
   ④ **최종 발행규모(증액/무증액/감액)**: payload '증액_총_억' 값으로 분기. 증액 규모는 반드시 '증액_총_억'(회차 합산) 값 — 트랜치별 증액액을 합산값처럼 쓰지 말 것.
      - **증액_총_억 = null 또는 '최종발행_확정' = false (수요예측 전, 최종 미확정)**: ⚠️ **증액·감액·최종발행액을 일절 언급하지 않고 이 단락을 통째로 생략한다.** '0억원', '0억 발행', '감액', '줄여' 같은 표현 절대 금지. 규모는 최초모집(=회차합산_억) 기준으로만, '발행 예정' 톤 유지.
      - **증액_총_억 > 0 (증액)**: "최초 모집액 [회차합산_최초모집_억]억원에서 [증액_총_억]억원 증액해 총 [회차합산_억]억원으로 발행한다/발행했다." 트랜치별 증액 내역은 보조로만 덧붙임(예: "2년물·3년물 각각 300억원씩 늘었다").
      - **증액_총_억 = 0 (증액 없음)**: **'증액'이라는 표현을 일절 쓰지 않는다.** 발행 규모는 리드·(2)에 이미 나왔으므로 이 단락은 생략하는 게 기본(굳이 쓰면 "당초 계획대로 총 [회차합산_억]억원으로 발행" 정도만).
      - **증액_총_억 < 0 (감액)**: "최초 모집액 [회차합산_최초모집_억]억원에서 [감액분 절댓값]억원 줄여 총 [회차합산_억]억원으로 발행한다/발행했다."
   ⑤ **주관·실적·인수 순서로** (반드시 이 순서). **항목이 3개 이상이면 쉼표 대신 '△' 기호로 나열**(아래 표기 규칙 참조):
     a) **주관사 명단**: "이번 발행의 대표주관사는 △[주관사1] △[주관사2] △[주관사3]이다." — payload.주관사_명단 순서대로 풀네임.
     b) **주관 실적**: "주관 실적은 △[주관사1] X억원 △[주관사2] Y억원 △[주관사3] Z억원이다." — payload.주관실적_분배_억 값 그대로.
     c) **인수량**: "인수 금액은 △[증권사1] X억원 △[증권사2] Y억원 △[증권사3] Z억원 등이다." — payload.인수량_별_억 값 그대로.
     - 주관사 명단과 인수사가 같으면 c 만 풀어쓰고 a·b 짧게 가능. 다를 경우 모두 정리.
     - (주관사·인수사가 2곳 이하면 '△' 없이 "A와 B" 형태로.)
   ⑥ **주관사/인수사 — 금액(실적) 유무에 따라** (특히 ECM. payload '실적_확정' 필드 확인):
      - **주관사_명단·인수사_명단이 둘 다 비어 있으면**(주주배정/주주우선공모의 '주선'형 등) **주관사·인수사 문장을 아예 쓰지 않는다.** ⚠️ "대표주관사와 인수사를 지정하지 않았다", "주관사가 없다" 같은 **부재 안내 문장 절대 금지**(침묵하고 생략). 주관/인수 없이 발행 정보만으로 자연스럽게 끝낸다.
      - 페이로드에 '주관사_명단'/'인수사_명단'(이름 배열)이 있으면 **항상 그 명단으로 주관사·인수사를 명기**한다(3개 이상이면 △ 나열).
      - **'실적_확정'=true**: 위 ⑤처럼 주관 실적·인수 금액까지 쓴다.
      - **'실적_확정'=false** (금액 미정): **이름만** 쓰고 주관 실적·인수 금액은 **한 문장도 쓰지 않는다.** ⚠️ "실적은 아직 확정되지 않았다", "최종 인수금액은 미정이다", "주관 실적은 공개되지 않았다" 같은 **미확정/미정 안내 문장 자체를 넣지 말 것**(침묵하고 생략). 예: "대표주관사는 △A증권 △B증권이다."로 끝낸다.
      - 인수사_명단이 주관사_명단과 **완전히 같으면 인수사 문장을 아예 쓰지 않는다**(주관사 문장만). 주관사 외 **추가 인수사**가 있을 때만 인수사 문장을 쓰되, **주관사도 인수에 참여하는 건 당연하므로 "주관사와 함께 [추가분]"** 형태로 자연스럽게 묶는다.
        ⚠️ **추가 인수사가 3곳 이상이면 쉼표 말고 반드시 '△'로 나열**(아래 표기 규칙). 2곳 이하면 "A와 B".
        예(추가 1곳): 주관사 SK증권, 인수사 SK증권+유진투자증권 → "**인수사로는 SK증권과 함께 유진투자증권이 참여한다.**"
        예(추가 3곳 이상): 주관사 SK증권·신한투자증권, 인수사에 한투·부국·한화·현대차·메리츠·교보 추가 → "**인수사로는 SK증권·신한투자증권과 함께 △한국투자증권 △부국증권 △한화투자증권 △현대차증권 △메리츠증권 △교보증권이 참여한다.**" (X: 쉼표 나열)
      - **단독 주관사**(주관사_명단이 1곳): "[A증권]이 단독으로 주관을 맡았다/맡는다." 처럼 **'단독'을 명시**한다.
      - **단독 인수**(인수사_명단도 그 1곳뿐 = 주관사 외 별도 인수사 없음): "인수도 [A증권]이 전액을 부담한다/부담했다." 처럼 **혼자임('전액')을 명시**한다. (실적_확정=true 면 "인수 금액도 [A증권]이 X억원 전액 부담" 식.)
        예(단독·미확정): "한국투자증권이 단독으로 주관을 맡는다. 인수도 한국투자증권이 전액 부담한다."
      - ⚠️ 명단이 있는데 "주관사가 아직 정해지지 않았다/공개되지 않았다"라고 **절대 쓰지 말 것**. 이름이 있으면 그대로 명기한다.
   ⑦ **(유증·IPO) 조달 규모 변화** — payload '조달규모_변화'(최초희망_억→최종_억, 증감_억)가 있으면 **가격(확정가)보다 '조달 규모(총액)의 변화'를 핵심으로 쓴다.**
      - "최초 [최초희망_억]억원 조달을 목표로 했으나 확정 발행가가 [최초가]원에서 [확정가]원으로 오르며 최종 [최종_억]억원을 조달한다/했다." 식. 증감_억이 +면 증액(늘어남), −면 감액(줄어듦).
      - 확정 발행가·희망가 같은 **가격 정보도 스트레이트 기사이므로 함께 쓴다**(빼지 말 것). 단 우선순위는 총액 변화 > 가격.
      - 증감_억 이 0(변화 없음)이면 "최초 계획대로 [최종_억]억원 조달" 정도로 간단히.

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
   - 특히 **'최종발행_확정' = false 면 수요예측 전 단계** — 수요예측·경쟁률·최종금리·최종발행액·증액이 모두 미정이므로 **해당 내용 전부 생략**하고, 규모는 최초모집 기준 '발행 예정'으로만 쓴다. 미정 수치를 0이나 추정으로 채우지 말 것.
   - **부재 자체를 문장으로 알리지 말 것**: "직전 발행 내역은 없다", "실적은 아직 확정되지 않았다", "수요예측 정보는 없다" 같이 '없다/미정/미확정'을 안내하는 문장은 **절대 쓰지 않는다.** 정보가 없으면 그 문장을 통째로 생략하고 자연스럽게 끝낸다.
4. **인용·전언 금지**: "...라고 밝혔다", "...로 알려졌다", "관계자에 따르면" 등 모두 사용 금지.

═══ 표기 규칙 ═══
- **숫자 천 단위 쉼표 절대 금지** (Numbers Pool 스타일 — 본문·헤드라인 모두):
  - 올바름: 3000억원 / 1조 700억원 / 17000억원 / 5350억원
  - **금지**: 3,000억원 / 10,700억원 / 5,350억원 (수치에 쉼표 쓰면 안 됨)
  - 모든 금액·수량·인원 등 **수치 표기에서만** 쉼표 제거.
  - (참고: 헤드라인의 "[발행사명], [나머지]" 패턴의 쉼표나, **2개 항목 나열 시 쉼표** 등 문장 부호 쉼표는 정상 사용. 단 **3개 이상 나열은 아래 '△' 규칙**을 따른다. 금지는 오직 숫자 자리수 구분 쉼표.)
- **3개 이상의 동급 항목을 병렬 나열할 때는 쉼표 대신 '△' 기호 사용** (한국 경제지 표기):
  - 각 항목 앞에 '△'를 붙이고 띄어쓰기로 구분(쉼표 없이). 예: "대표주관사는 △삼성증권 △KB증권 △NH투자증권 △신한투자증권이다."
  - 금액이 따라붙으면: "주관 실적은 △삼성증권 360억원 △KB증권 370억원 △NH투자증권 370억원이다."
  - 주관사·인수사 명단, 자금 사용처 등 **3개 이상 나열 전반**에 적용.
  - **2개 이하면 '△' 쓰지 말고** 일반 표기("2년물과 3년물", "삼성증권과 KB증권").
- **비율(%) 표기**: 비율은 반드시 '%'이며, 제공된 % 문자열의 **자릿수를 절대 바꾸지 말고 그대로** 쓴다.
  - 유상증자 '증자비율'은 **소수 둘째 자리까지** 제공된다("25.00%", "25.20%", "24.87%") — '25%'나 '25.2%'로 줄이지 말 것.
  - IPO '신주비율'·'구주비율'은 **정수**로 제공된다("65%") — '65.0%'로 늘리지 말 것.
  - 혹시 0~1 소수로 들어오면 ×100. **'0.x' 소수 형태 절대 금지.**
- **숫자·단위 붙여쓰기** (공백 없이):
  - 날짜 'N월 N일'은 붙여 쓴다: "5월18일", "7월9일" (월과 일 사이 공백 없음).
  - 주식 수는 만/억 단위와 숫자·'주'를 붙여 쓴다: "999만1819주", "600만주", "1억2000만주".
  - 단, **금액 '1조 700억원'의 조-억 사이 공백은 그대로 둔다**(붙이지 않음).
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
- 주관사·인수사: 데이터의 alias(예: 'NH', 'KB')를 그대로 쓰지 말고 정식명으로 풀어쓴다. **아래 정규화 표를 반드시 적용**:
  - **약칭 → 정식명**: NH→NH투자증권 / KB→KB증권 / 한투·한국투자→한국투자증권 / 삼성→삼성증권 / 신한→신한투자증권 / 미래에셋→미래에셋증권 / 키움→키움증권 / 하나→하나증권 / 대신→대신증권 / 교보→교보증권 / 메리츠→메리츠증권 / DB→DB금융투자 / SK→SK증권 / IBK→IBK투자증권 / BNK→BNK투자증권 / 부국→부국증권 / 한양→한양증권 / 유진→유진투자증권 / 한화→한화투자증권 / 신영→신영증권 / 대우→미래에셋증권
  - **옛 사명 → 현재 정식명** (데이터가 옛 이름이어도 반드시 현재명으로 바꿔 쓴다): 신한금융투자→신한투자증권 / 미래에셋대우→미래에셋증권 / 하나금융투자→하나증권 / 하이투자증권→iM증권 / 이베스트투자증권→LS증권 / KTB투자증권→다올투자증권 / 현대증권·KB투자증권→KB증권 / NH농협증권·우리투자증권(2014년 이전)→NH투자증권 / 동양증권→유안타증권 / 동부증권→DB금융투자 / HMC투자증권→현대차증권 / 메리츠종금증권→메리츠증권
  - **단 '우리투자증권'은 2024년 재출범한 현재 회사**이므로 그대로 둔다(과거 NH투자증권으로 바뀐 옛 우리투자증권과 혼동 금지).
  - 위 표에 없고 정식명이 확실치 않으면 데이터 값 그대로 둔다.
- 신용등급: 'AA-' 형태 그대로

═══ 잉여·중복 제거 ═══
- **리드 문단과 본문에서 같은 정보(특히 신용등급, 총 발행규모)를 두 번 반복하지 않는다.** 리드에 신용등급을 썼으면 본문에서는 생략하거나 다른 맥락에서만 언급.
- **발행 규모를 반복하는 잉여 마무리 문장 금지**: 마지막에 "이번 [발행/증자]을 통해 X원을 조달할 계획이다"처럼 앞에서 이미 밝힌 총액을 되풀이하지 말 것. 자금 용도(시설·운영·채무상환 등) 데이터가 있을 때만 용도를 쓴다(없으면 그런 마무리 문장 자체를 넣지 않는다).
- **'발행한도_총_억'은 회차 전체의 발행 한도(=증액 한도)**다. 트랜치별 한도가 아니므로 "각 만기별 발행 한도는…" 같은 표현 금지.
  - **'최대 N억까지 증액 가능'은 오직 '최종발행_확정=false'(아직 발행조건 미확정·진행 중) 이면서 '발행한도 > 회차합산_최초모집'(증액 여력 있음)일 때만** 쓴다. 이때는 '얼마까지 늘 수 있나'가 핵심이므로 본문에 명기하고 헤드라인 둘째 정보로도 우선("…최대 6000억").
  - ⚠️ **이미 발행조건이 확정된 딜(최종발행_확정=true)이나, 발행한도가 회차합산과 같은(=증액 여력 0) 딜에는 '증액 가능' 문장을 절대 쓰지 않는다.** (이미 N억으로 발행됐는데 "최대 N억까지 증액 가능"은 모순.) 또한 앞에서 이미 언급한 한도를 반복하지 말 것.
- **최초공시일을 별도 단락으로 적지 않는다.** "이번 발행의 최초 공시일은 X일이다" 같은 잉여 단락 금지. 도입부의 'N일' 표기로 이미 시점이 명시됐으므로 별도 언급 불필요.
- history 의 직전 발행 비교는 1~2문단으로 충분. 트랜치별 수치를 모두 나열하지 말고 핵심(총 발행 규모, 만기 구조 요약, 최종 금리 정도)만.

═══ history 활용 ═══
- 데이터에 'history' 필드(같은 발행사의 직전 발행 1~2건)가 있으면 본문 후반 한두 문단에 **단순 사실로** 비교:
  - "[발행사]는 [지난 N월/지난해 N월]에도 [총 X억원]의 공모채를 찍었다. 당시 [만기 구조] 발행됐고, 최종 금리는 [n.nnn%]였다."
  - "직전 발행에서는 [수요예측 수치]을 기록했다." 같은 단순 비교
  - 비교하면서 해석·평가는 금지 (예: "수요가 늘었다"는 OK, "투심이 개선됐다"는 금지)
- history 가 빈 배열이면 비교 단락을 **통째로 생략**한다. ⚠️ "직전 발행 내역은 없다", "과거 발행 내역을 공시하지 않았다" 같이 **과거 이력이 없음을 알리는 문장을 절대 쓰지 말 것**(침묵하고 끝낸다). 과거 사실은 history 데이터가 있을 때만 쓴다(DCM·ECM 공통).

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
// OpenAI 호출 (Chat Completions, Structured Outputs)
// ════════════════════════════════════════════════════════════════════
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 429(rate limit)·5xx 는 짧게 재시도. RPM 한도는 분 단위라 1~2회 백오프로 대부분 통과.
class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super("rate limit");
    this.name = "RateLimitError";
  }
}

async function callOpenAI(userPrompt: string): Promise<{ headline: string; article: string }> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY 미설정 — Supabase Edge Function secret 확인 필요");

  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 1600,
    // Structured Outputs — {headline, article} 스키마 강제
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "article",
        strict: true,
        schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            article: { type: "string" },
          },
          required: ["headline", "article"],
          additionalProperties: false,
        },
      },
    },
  };

  const MAX_TRIES = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_TRIES) { await sleep(600 * attempt); continue; }
      throw new Error("OpenAI 연결 실패: " + (e as Error).message);
    }

    if (resp.ok) {
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error("OpenAI 응답에서 텍스트 추출 실패");

      let parsed: any;
      try { parsed = JSON.parse(text); }
      catch { throw new Error("OpenAI 응답이 JSON 형식이 아님: " + String(text).slice(0, 200)); }

      const headline = String(parsed.headline || "").trim();
      const article = String(parsed.article || "").trim();
      if (!headline || !article) throw new Error("OpenAI 응답에 headline/article 비어있음");
      return { headline, article };
    }

    // 에러 응답
    const txt = await resp.text();
    if (resp.status === 429 || resp.status >= 500) {
      // Retry-After 헤더(초) 존중, 없으면 점증 백오프
      const ra = parseFloat(resp.headers.get("retry-after") || "") || (0.8 * attempt);
      lastErr = new RateLimitError(ra);
      if (attempt < MAX_TRIES && ra <= 8) { await sleep(ra * 1000); continue; }
      throw new RateLimitError(ra);
    }
    throw new Error(`OpenAI ${resp.status}: ${txt.slice(0, 300)}`);
  }
  throw (lastErr instanceof Error ? lastErr : new Error("OpenAI 호출 실패"));
}

// ════════════════════════════════════════════════════════════════════
// 검증 & 정리 — 모델이 못 지키는 규칙을 코드로 강제
// ════════════════════════════════════════════════════════════════════
// 글자수 — 유니코드 코드포인트 기준(한글 1자 = 1)
function charLen(s: string): number {
  return [...String(s || "")].length;
}
// 천단위 쉼표 제거 — "3,000" → "3000", "1,234,567" → "1234567" (결정적)
function stripNumberCommas(s: string): string {
  return String(s || "").replace(/(\d),(?=\d)/g, "$1");
}
// 마침표 3개 이상(...) → 말줄임표(…) 한 글자로 정규화 (소수점 단일 '.'은 영향 없음)
function normalizeEllipsis(s: string): string {
  return String(s || "").replace(/\.{3,}/g, "…");
}
// 한국어 숫자·단위 붙여쓰기(사용자 표기 규칙). 금액 '1조 700억원'의 조-억 공백은 건드리지 않음.
function joinKoreanUnits(s: string): string {
  return String(s || "")
    .replace(/(\d+월)\s+(\d+일)/g, "$1$2")          // 5월 18일 → 5월18일
    .replace(/(\d+만)\s+(\d+주)/g, "$1$2")          // 999만 1819주 → 999만1819주
    .replace(/(\d+만)\s+주/g, "$1주")               // 600만 주 → 600만주
    .replace(/(\d+억)\s+(\d+만\d*주)/g, "$1$2");     // 1억 2000만주 → 1억2000만주 (드문 경우)
}
// '미정/부재 안내' 문장 제거(문장 단위, 결정적). 모델이 규칙을 어기고 넣는
// "실적은 아직 확정되지 않았다", "과거 발행 내역을 공시하지 않았다", "직전 발행 내역은 없다",
// "주관사와 인수사를 지정하지 않았다" 등.
const ABSENCE_RE =
  /(확정되지\s*않았|공개되지\s*않았|정해지지\s*않았|결정되지\s*않았|미정이[다며])|((내역|이력|사례)[은는이가을를]?\s*(아직\s*)?(없(다|음|었|으)|공시하지\s*않))|((주관|인수)[^.]{0,20}(지정|선정)하지\s*않았)|((주관사|인수사)[은는이가을를]?\s*(아직\s*)?없(다|음|었|으))/;
function stripAbsenceSentences(s: string): string {
  return String(s || "")
    .split(/\n{2,}/)
    .map((para) => {
      const sents = para.split(/(?<=다\.)\s+/);          // '…다. ' 경계로 문장 분리(소수점은 영향 없음)
      return sents.filter((x) => !ABSENCE_RE.test(x)).join(" ").trim();
    })
    .filter((p) => p.length > 0)
    .join("\n\n");
}
function cleanResult(r: { headline: string; article: string }) {
  return {
    headline: joinKoreanUnits(normalizeEllipsis(stripNumberCommas(r.headline))).trim(),
    article: stripAbsenceSentences(
      joinKoreanUnits(normalizeEllipsis(stripNumberCommas(r.article))),
    ).trim(),
  };
}
// 정리 후에도 남는 위반을 모델에게 재요청할 피드백으로 반환
function validateResult(r: { headline: string; article: string }): string[] {
  const problems: string[] = [];
  const hl = charLen(r.headline);
  if (hl > HEADLINE_MAX) {
    problems.push(
      `- 헤드라인이 ${hl}자입니다. 띄어쓰기·쉼표·특수문자·말줄임표 포함 ${HEADLINE_MAX}자 이내로 더 줄이세요. ` +
      `현재 헤드라인: "${r.headline}"`,
    );
  }
  if (r.headline.includes("무보증")) {
    problems.push(
      `- 헤드라인에 '무보증'을 넣지 마세요. 일반 공모채는 종류 수식 없이 쓰고, ` +
      `신종자본증권·후순위채 등 특수채일 때만 그 종류명을 쓰세요. 현재 헤드라인: "${r.headline}"`,
    );
  }
  if (!r.headline.includes("…")) {
    problems.push(
      `- 헤드라인에 말줄임표(…)가 없습니다. "[발행사명], [발행규모][종류] 발행…[핵심 사실 1개]" 형식으로 ` +
      `규모 뒤에 …를 찍고 핵심 사실 1개를 덧붙이세요. 현재 헤드라인: "${r.headline}"`,
    );
  }
  return problems;
}

// 생성 → 결정적 정리 → 검증 → (위반 시) 피드백 재생성. 최대 MAX_GEN 회.
async function generateValidatedArticle(
  basePrompt: string,
): Promise<{ headline: string; article: string; attempts: number; ok: boolean }> {
  const MAX_GEN = 3;
  let feedback = "";
  let best: { headline: string; article: string } | null = null;
  let bestProblems = Infinity;

  for (let attempt = 1; attempt <= MAX_GEN; attempt++) {
    const userPrompt = feedback
      ? `${basePrompt}\n\n[직전 출력이 규칙을 위반했습니다 — 반드시 고쳐서 다시 작성하세요]\n${feedback}`
      : basePrompt;

    const raw = await callOpenAI(userPrompt);
    const r = cleanResult(raw); // 천단위 쉼표·말줄임표 등 결정적 정리
    const problems = validateResult(r);
    if (problems.length === 0) {
      return { ...r, attempts: attempt, ok: true };
    }
    // 완벽하진 않아도 최선본 보관 — 위반 개수 최소 → (동률이면) 헤드라인 최단
    if (
      problems.length < bestProblems ||
      (problems.length === bestProblems && best && charLen(r.headline) < charLen(best.headline))
    ) {
      best = r;
      bestProblems = problems.length;
    }
    feedback = problems.join("\n");
  }

  // 끝까지 39자를 못 맞춘 경우 — 최선본 반환(천단위 쉼표는 이미 제거됨)
  return { ...(best as { headline: string; article: string }), attempts: MAX_GEN, ok: false };
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

  // 5) OpenAI 호출 + 검증-재생성 루프
  try {
    const prompt = buildPrompt(payload);
    const { headline, article, attempts, ok } = await generateValidatedArticle(prompt);
    return json({
      headline, article,
      model: MODEL,
      usage_count: limitRes,
      daily_limit: DAILY_LIMIT,
      attempts,          // 디버그용 — 검증 통과까지 시도 횟수
      headline_ok: ok,   // false 면 39자 제한을 끝내 못 맞춘 최선본
    });
  } catch (e) {
    if (e instanceof RateLimitError) {
      const wait = Math.max(10, Math.ceil(e.retryAfter));
      console.warn("OpenAI rate limit", e.retryAfter);
      return json(
        { error: `지금 생성 요청이 몰려 있습니다. 약 ${wait}초 후 다시 시도해주세요.`, retry_after: wait },
        429,
      );
    }
    console.error("OpenAI error", e);
    return json({ error: "기사 생성 실패: " + (e as Error).message }, 500);
  }
});
