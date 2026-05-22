"""캐시 버스트 — HTML 의 로컬 <script src>/<link href> 에 ?v=<timestamp>
쿼리스트링 자동 부착.

매 commit 직전에 git pre-commit hook 이 자동 호출.
브라우저가 versioned URL 을 새 리소스로 인식해 자동 fresh fetch
→ 사용자는 F5 만 해도 항상 최신 코드 받음.

대상: 메인 5개 페이지 (index, about, brokers, charts, deals)
제외: CDN (https://) URL, admin (별도 라이프사이클), preview (시안 검토용)
"""
from __future__ import annotations
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# 메인 5개 페이지만 — admin / preview 는 라이프사이클 다름
TARGETS = [
    "index.html",
    "about/index.html",
    "brokers/index.html",
    "charts/index.html",
    "deals/index.html",
]

# <script src="..."> 또는 <link rel="..." href="..."> 의 로컬 .js / .css 참조에
# ?v=<version> 부착. https:// (CDN) 은 제외.
#
# 그룹:
#   1) <script ... src="<localpath>" 또는 <link ... href="<localpath>"
#   2) (기존 ?v=...) 옵션
#   3) 닫는 "
LOCAL_REF_RE = re.compile(
    r'((?:<script[^>]*?\ssrc|<link[^>]*?\shref)="(?!https?://)[^"]+?\.(?:js|jsx|css))'
    r'(\?[^"]*)?'
    r'(")',
    re.IGNORECASE,
)


def bump_file(path: Path, version: str) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, FileNotFoundError):
        return False
    new_text = LOCAL_REF_RE.sub(
        lambda m: f"{m.group(1)}?v={version}{m.group(3)}", text)
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
        return True
    return False


def main() -> int:
    version = time.strftime("%Y%m%d%H%M%S")
    changed: list[str] = []
    for rel in TARGETS:
        p = ROOT / rel
        if not p.exists():
            print(f"[bump_version] WARN: {rel} 없음", file=sys.stderr)
            continue
        if bump_file(p, version):
            changed.append(rel)
    print(f"[bump_version] v={version} → modified {len(changed)} file(s)")
    for f in changed:
        print(f"  {f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
