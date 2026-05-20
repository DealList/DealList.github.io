"""DCM 검증 + auto-fix 오케스트레이터 (Layer 1).

기본 동작: 검증 → 자동 patch → 재검증 → 리포트 (before/after/잔여).

사용법:
  py auto/validator.py                       # 전체 records, auto-fix on
  py auto/validator.py --year 2023           # 특정 연도만
  py auto/validator.py --rcept 20230115...   # 특정 rcept_no 만
  py auto/validator.py --no-auto-fix         # 검증만 (수정 X)
  py auto/validator.py --report-md path      # 리포트 위치 지정

기본 입력: 프로젝트 루트의 'DCM Table.xlsx' (+ 사이드카 meta).
기본 출력: 'validator_report.md' + 'validator_report.json'.
"""
from __future__ import annotations
import argparse
import json
import sys
from dataclasses import asdict
from datetime import date
from pathlib import Path
from collections import defaultdict, Counter

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import excel_writer  # type: ignore
import validator_rules  # type: ignore
import validator_fixes  # type: ignore


def _filter_records(records, year: str | None, rcept: str | None,
                     new_only: bool = False):
    out = records
    if year:
        y = int(year)
        out = [r for r in out
               if isinstance(r.subscription_date, date)
                  and r.subscription_date.year == y]
    if rcept:
        out = [r for r in out if r.rcept_no == rcept]
    if new_only:
        log_path = ROOT / ".last_update.json"
        if log_path.exists():
            try:
                data = json.loads(log_path.read_text(encoding="utf-8"))
                new_set = set(data.get("rcept_nos", []))
                out = [r for r in out if r.rcept_no in new_set]
            except Exception:
                pass
    return out


def _sev_label(s: str) -> str:
    return {"hard": "🔴 HARD", "soft": "🟡 SOFT"}.get(s, s)


def _summary_by_rule(findings):
    by_rule = Counter()
    for f in findings:
        by_rule[(f.rule_id, f.severity)] += 1
    return by_rule


def _format_finding_list(findings) -> list[str]:
    """severity → rule_id 별 그룹화하여 markdown 라인 생성."""
    if not findings:
        return ["✅ 없음"]
    lines = []
    by_sev = defaultdict(list)
    for f in findings:
        by_sev[f.severity].append(f)
    for sev in ("hard", "soft"):
        sev_fs = by_sev.get(sev, [])
        if not sev_fs:
            continue
        lines.append(f"#### {_sev_label(sev)} ({len(sev_fs)}건)")
        by_r = defaultdict(list)
        for f in sev_fs:
            by_r[f.rule_id].append(f)
        for rule_id in sorted(by_r.keys()):
            items = by_r[rule_id]
            lines.append(f"\n**`{rule_id}`** ({len(items)}건)")
            for f in items:
                lines.append(f"- {f.record_key} (rcept={f.rcept_no}): {f.description}")
        lines.append("")
    return lines


def _format_report(scope: str, total: int,
                   findings_before, patched, fetch_patched,
                   manual, findings_after) -> str:
    lines = [f"# DCM Table 검증 리포트 (Layer 1 + auto-fix)\n"]
    lines.append(f"- **검증 범위**: {scope}")
    lines.append(f"- **총 records**: {total}")
    lines.append("")

    lines.append("## 처리 요약")
    lines.append(f"- 초기 검출 findings: **{len(findings_before)}**")
    lines.append(f"- 메모리 patch (산술/필드): **{len(patched)}건**")
    lines.append(f"- DART target fetch + patch: **{len(fetch_patched)}건**")
    lines.append(f"- 사용자 판단 필요 (manual review): **{len(manual)}건**")
    lines.append(f"- **재검증 후 잔여 findings: {len(findings_after)}**")
    if not findings_after:
        lines.append("- ✅ **최종 상태: 모든 issue 해결됨**")
    lines.append("")

    # 처리 전 detail
    lines.append("## 1. 초기 검출 상세")
    lines.extend(_format_finding_list(findings_before))

    # 메모리 patch 결과
    lines.append("## 2. 메모리 patch 결과 (산술/필드 조작)")
    if patched:
        by_r = defaultdict(list)
        for f in patched:
            by_r[f.rule_id].append(f)
        for rule_id in sorted(by_r.keys()):
            items = by_r[rule_id]
            lines.append(f"\n**`{rule_id}`** ({len(items)}건)")
            for f in items:
                lines.append(f"- {f.record_key} (rcept={f.rcept_no})")
    else:
        lines.append("- 없음")
    lines.append("")

    # DART target fetch 결과
    lines.append("## 3. DART target fetch + patch 결과")
    if fetch_patched:
        by_r = defaultdict(list)
        for f in fetch_patched:
            by_r[f.rule_id].append(f)
        for rule_id in sorted(by_r.keys()):
            items = by_r[rule_id]
            lines.append(f"\n**`{rule_id}`** ({len(items)}건)")
            for f in items:
                lines.append(f"- {f.record_key} (rcept={f.rcept_no})")
    else:
        lines.append("- 없음")
    lines.append("")

    # 사용자 판단 필요
    lines.append("## 4. 사용자 판단 필요 (manual review)")
    lines.extend(_format_finding_list(manual))

    # 재검증 결과
    lines.append("## 5. 재검증 결과 (auto-fix 적용 후)")
    if findings_after:
        lines.append(f"잔여 findings: {len(findings_after)}건")
        lines.extend(_format_finding_list(findings_after))
    else:
        lines.append("✅ **모든 자동 처리 가능 issue 해결됨**.")

    return "\n".join(lines)


def _format_json(findings_before, patched, fetch_patched, manual, findings_after):
    return json.dumps({
        "before": [asdict(f) for f in findings_before],
        "patched": [asdict(f) for f in patched],
        "fetch_patched": [asdict(f) for f in fetch_patched],
        "manual_review": [asdict(f) for f in manual],
        "after": [asdict(f) for f in findings_after],
    }, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser(description="DCM Table Layer 1 검증 + auto-fix")
    ap.add_argument("--xlsx", default=str(ROOT.parent / "DCM Table.xlsx"),
                    help="입력 xlsx 경로 (사이드카 meta 가 같은 위치에 있어야 함)")
    ap.add_argument("--year", help="특정 연도만 검증 (예: 2024)")
    ap.add_argument("--rcept", help="특정 rcept_no 만 검증")
    ap.add_argument("--report-md", default=str(ROOT.parent / "validator_report.md"))
    ap.add_argument("--report-json", default=str(ROOT.parent / "validator_report.json"))
    ap.add_argument("--no-auto-fix", action="store_true",
                    help="검증만 수행 (수정 안 함)")
    ap.add_argument("--no-fetch", action="store_true",
                    help="시나리오 A (메모리 patch 만, DART 본문 fetch 안 함). "
                         "기본은 시나리오 A+ (refetch 액션 시 target fetch).")
    ap.add_argument("--new-only", action="store_true",
                    help="auto/.last_update.json 의 rcept_no 들만 검증 대상으로. "
                         "cmd_update 직후 호출 시 새로 처리된 records 만 검증.")
    ap.add_argument("--quiet", action="store_true", help="콘솔 요약 출력 안 함")
    args = ap.parse_args()

    xlsx = Path(args.xlsx)
    if not xlsx.exists():
        print(f"[ERR] xlsx 없음: {xlsx}", file=sys.stderr)
        return 1

    records, processed = excel_writer.load_meta(xlsx)
    filtered = _filter_records(records, args.year, args.rcept, args.new_only)

    if args.new_only:
        scope = f"신규 수집분만 ({len(filtered)} records)"
    elif args.year:
        scope = f"{args.year}년 ({len(filtered)} records)"
    elif args.rcept:
        scope = f"rcept_no={args.rcept} ({len(filtered)} records)"
    else:
        scope = f"전체 ({len(filtered)} records)"

    # Pass 1: 검출
    findings_before = validator_rules.run_all(filtered)

    if args.no_auto_fix:
        patched, fetch_patched, manual = [], [], list(findings_before)
        findings_after = findings_before
    else:
        # Pass 2: auto-fix 적용 (records in-place 수정).
        # fetch_enabled=True (default 시나리오 A+) → refetch 액션 시 target DART fetch.
        patched, fetch_patched, manual, failed = validator_fixes.apply_auto_fixes(
            records, findings_before, fetch_enabled=not args.no_fetch)

        if patched or fetch_patched:
            # 저장 (전체 records 가 수정됐을 수 있음)
            excel_writer.write(records, xlsx, processed_rcept_nos=sorted(processed))

        # Pass 3: 재검증
        records2, _ = excel_writer.load_meta(xlsx)
        filtered2 = _filter_records(records2, args.year, args.rcept, args.new_only)
        findings_after = validator_rules.run_all(filtered2)

    # 리포트 작성
    md = _format_report(scope, len(filtered),
                        findings_before, patched, fetch_patched,
                        manual, findings_after)
    Path(args.report_md).write_text(md, encoding="utf-8")
    Path(args.report_json).write_text(
        _format_json(findings_before, patched, fetch_patched, manual, findings_after),
        encoding="utf-8")

    if not args.quiet:
        print(f"[검증 + auto-fix 완료] scope={scope}")
        print(f"  초기 검출: {len(findings_before)}건")
        print(f"  메모리 patch: {len(patched)}건")
        print(f"  DART fetch patch: {len(fetch_patched)}건")
        print(f"  manual review: {len(manual)}건")
        print(f"  잔여 findings: {len(findings_after)}건")
        print(f"  리포트: {args.report_md}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
