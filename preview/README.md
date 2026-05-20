# DealList Preview — 배포 가이드

이 `preview/` 폴더는 **V1~V4 디자인 시안을 한 페이지에서 토글**하며 비교할 수 있는 미리보기입니다. 본 사이트 영향 없이 별도 경로(`/deals/preview/`)에 올려서 본인·동료·사용자에게 보여주고 피드백 받는 용도예요.

## 폴더 구조

```
preview/
├── index.html        ← 엔트리. 이 파일만 직접 호출됨.
├── shared.jsx        ← 데이터·헬퍼·summary.json fetch 로직
├── v1-terminal.jsx   ← V1 (다크 터미널)
├── v2-editorial.jsx  ← V2 (에디토리얼 모던)
├── v3-ft.jsx         ← V3 (FT 살몬)
├── v4-minimal.jsx    ← V4 (미니멀 프리미엄)
├── app.jsx           ← 스위처 + 부트로직
└── README.md         ← 이 파일
```

## 배포 (GitHub Pages)

기존 저장소 루트에 그대로 폴더째 복사하시면 됩니다.

```bash
# 본인 저장소 클론한 위치에서
cp -R preview/ ~/Desktop/your-repo/

cd ~/Desktop/your-repo
git add preview/
git commit -m "feat: add design preview (V1~V4 switcher)"
git push
```

배포 후 접속 URL:

```
https://deallist.github.io/deals/preview/
```

기본은 V2(에디토리얼)가 떠요. URL로 시안 고정도 가능:

- `…/preview/?v=v1` → V1 터미널
- `…/preview/?v=v3` → V3 FT 살몬
- 등

선택은 localStorage에도 저장되어 새로고침해도 마지막으로 본 시안이 그대로 떠요.

## 실데이터 연결

`shared.jsx`의 `loadSummary()`가 다음 순서로 `summary.json`을 찾습니다:

1. `../summary.json` (← `/deals/preview/index.html` 에서 `/deals/summary.json` 가져오기. 이게 정상 동작 경로)
2. `./summary.json`
3. `summary.json`

전부 실패하면 **mock 데이터로 폴백**하고 스위처에 "mock data" 표시. 로컬에서 보거나 다른 서버에 올려도 깨지지 않습니다.

KPI 4~5개 카드는 실제 `summary.json`에서 읽어오고, 그 외(딜 리스트·차트·리그테이블)는 mock입니다. 시안 결정 후 본 페이지로 옮기면서 실제 엔드포인트로 연결하는 게 다음 단계예요.

## 키보드 단축키

- `1` / `2` / `3` / `4` — 시안 즉시 전환
- `H` — 스위처 접기/펼치기 (방해 없이 시안만 보고 싶을 때)

## 운영 노트

- 검색엔진 인덱싱 차단: `<meta name="robots" content="noindex,nofollow">`
- React/Babel은 unpkg CDN으로 로드 — 인터넷 연결 필수
- 페이지 무게: ~70KB(HTML) + ~150KB(jsx) + CDN 캐시
- 빌드 스텝 없음 — 브라우저가 직접 Babel로 트랜스파일

> **주의: 프로덕션 최적화 안 된 상태입니다.** 첫 로드가 1~2초 걸려요. 시안 결정 후 정식 페이지로 옮길 때 Vite/Webpack로 번들링 + tree-shake하면 훨씬 빨라집니다.

## 시안 결정 후 다음 단계

1. **선택한 시안의 본 페이지 전환** — V?의 컴포넌트를 빼와서 `index.html` 로 옮기고 React 통합
2. **다른 페이지(딜 리스트·리그테이블·인포그래픽) 같은 톤으로 확장** — 새 시안으로 더 작업
3. **데이터 엔드포인트 확장** — 현재는 `summary.json` 1개. 딜 리스트 / 리그테이블도 JSON으로 노출 필요

---

질문/이슈는 Claude Design 채팅창에 다시 와서 말씀해 주세요!
