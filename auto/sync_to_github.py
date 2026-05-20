"""DCM Table.xlsx 데이터를 DealList.github.io 클론 폴더로 sync.

흐름:
1. export_web.py 실행 → Dropbox/web/ 하위 data.json + meta.json 갱신
2. Dropbox/web/* → Documents/GitHub/DealList.github.io/ 복사
3. 사용자에게 GitHub Desktop 으로 commit + push 안내

다른 PC (회사 노트북) 에서는 GitHub 클론 경로가 다르므로 자동 탐색 (HOME 기준
~/Documents/GitHub/DealList.github.io). 못 찾으면 사용자가 --target 지정.
"""
from __future__ import annotations
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
WEB_DIR = PROJECT_ROOT / "web"

# 클론 폴더 자동 탐색 후보 (PC 마다 다를 수 있음)
DEFAULT_TARGETS = [
    Path.home() / "Documents" / "GitHub" / "DealList.github.io",
    Path.home() / "Documents" / "GitHub" / "DealList.github.io".lower(),
]


def find_target(custom: str | None) -> Path | None:
    if custom:
        p = Path(custom)
        return p if p.exists() else None
    for cand in DEFAULT_TARGETS:
        if cand.exists():
            return cand
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", help="GitHub 클론 폴더 경로 (자동 탐색 실패 시)")
    ap.add_argument("--skip-export", action="store_true",
                    help="export_web.py 재실행 건너뛰기 (이미 최신일 때)")
    args = ap.parse_args()

    target = find_target(args.target)
    if not target:
        print("[error] GitHub 클론 폴더를 찾을 수 없습니다.")
        print(f"  시도한 경로: {DEFAULT_TARGETS}")
        print(f"  --target <경로> 옵션으로 지정하세요.")
        sys.exit(1)
    print(f"target: {target}")

    if not args.skip_export:
        print("\n[1/2] export_web.py 실행 (xlsx → web/data.json)")
        result = subprocess.run(
            [sys.executable, str(ROOT / "export_web.py")],
            capture_output=True, text=True, encoding="utf-8")
        print(result.stdout, end="")
        if result.returncode != 0:
            print(f"[error] export_web.py 실패")
            print(result.stderr)
            sys.exit(1)

    print(f"\n[2/2] web/ + auto/ + .github/ → {target.name}/ 복사 (재귀)")
    # 사이트 파일 (web/) 뿐 아니라 자동 수집 코드 (auto/) 와 GitHub Actions
    # workflow (.github/) 도 함께 push 해야 Actions 가 작동.

    copied = 0

    def copy_tree(src_root: Path, dst_relative: str, ignore_names: set):
        nonlocal copied
        for src_path in src_root.rglob("*"):
            rel = src_path.relative_to(src_root)
            # ignore 처리
            if any(p in ignore_names for p in rel.parts):
                continue
            if any(p.startswith(".") and p != ".github" for p in rel.parts):
                continue
            # .env 절대 복사 금지
            if src_path.name == ".env":
                continue
            if src_path.is_dir():
                (target / dst_relative / rel).mkdir(parents=True, exist_ok=True)
                continue
            dst_path = target / dst_relative / rel
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_path, dst_path)
            copied += 1
            print(f"  copied: {dst_relative}/{rel}  ({src_path.stat().st_size:,} bytes)")

    # web/ 복사 (사이트 root 로)
    web_ignore = {"preview", "__pycache__"}
    for src_path in WEB_DIR.rglob("*"):
        rel = src_path.relative_to(WEB_DIR)
        if any(p in web_ignore for p in rel.parts):
            continue
        if any(p.startswith(".") for p in rel.parts):
            continue
        if src_path.is_dir():
            (target / rel).mkdir(parents=True, exist_ok=True)
            continue
        dst_path = target / rel
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dst_path)
        copied += 1
        print(f"  copied: {rel}  ({src_path.stat().st_size:,} bytes)")

    # auto/ 복사 (Python 수집/검증 코드)
    AUTO_DIR = PROJECT_ROOT / "auto"
    if AUTO_DIR.exists():
        copy_tree(AUTO_DIR, "auto", {"__pycache__", "cache", "output", ".bak"})

    # .github/ 복사 (Actions workflow)
    GH_DIR = PROJECT_ROOT / ".github"
    if GH_DIR.exists():
        copy_tree(GH_DIR, ".github", {"__pycache__"})

    print(f"  총 {copied}개 파일 복사")

    print(f"\n[ok] sync 완료.")
    print(f"\n다음 단계 (GitHub Desktop):")
    print(f"  1. 변경 사항 자동 감지됨")
    print(f"  2. Summary 칸에 메모 입력 (예: '데이터 갱신 YYYY-MM-DD')")
    print(f"  3. 'Commit to main' 클릭")
    print(f"  4. 'Push origin' 클릭")
    print(f"  5. 1~3분 후 https://deallist.github.io/ 자동 반영")


if __name__ == "__main__":
    main()
