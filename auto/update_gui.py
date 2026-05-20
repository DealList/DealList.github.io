"""DCM Table 업데이트 GUI — 더블클릭 실행용.

흐름:
  1단계 - 사용자에게 조회 기간 선택지 제시 (최근 3/5/10/15일, 1개월, 3개월).
  2단계 - 선택 후 cmd_update 서브프로세스 실행 + 진행률·로그·경과시간 표시.

기존 DCM Table.xlsx 옆 사이드카 DCM Table.meta.json 의 처리된 rcept_no 는 skip 하고
새 [발행조건확정] 공시만 fetch → 같은 파일에 덮어쓰기.
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import threading
import time
import tkinter as tk
from datetime import date, datetime, timedelta
from pathlib import Path
from tkinter import messagebox, ttk

AUTO_DIR = Path(__file__).resolve().parent
ROOT_DIR = AUTO_DIR.parent

# Embedded Python 격리 환경 대비 — 본 모듈 dir 명시 등록
if str(AUTO_DIR) not in sys.path:
    sys.path.insert(0, str(AUTO_DIR))
EXCEL_PATH = ROOT_DIR / "DCM Table.xlsx"
META_PATH = ROOT_DIR / "DCM Table.meta.json"

# 사용자에게 보여줄 기간 옵션 (라벨, 일수). -1 = 직접 입력 모드
PERIOD_OPTIONS = [
    ("최근 3일", 3),
    ("최근 5일", 5),
    ("최근 10일", 10),
    ("최근 15일", 15),
    ("최근 1개월", 30),
    ("최근 3개월", 90),
    ("직접 입력 (시작일 ~ 종료일)", -1),
]
DEFAULT_DAYS = 10


class UpdateApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("DCM Table 업데이트")
        root.geometry("720x520")
        root.resizable(True, True)

        # ttk 스타일
        try:
            style = ttk.Style()
            style.configure(".", font=("맑은 고딕", 10))
            style.configure("TButton", padding=6)
            style.configure("TRadiobutton", padding=2)
        except tk.TclError:
            pass

        self.main = ttk.Frame(root, padding=14)
        self.main.pack(fill="both", expand=True)

        # 상태 변수
        self.total_finals: int | None = None
        self.new_finals: int | None = None  # 새 [발행조건확정] 건수
        self.new_initial: int | None = None  # 새 초기 증권신고서 건수
        self.processed_count = 0
        # 발행사(corp) 단위 변화 추적
        self.missing_corps: int | None = None  # 추가 조회 필요 발행사 (사용자 직접 보이지 않음)
        self.updated_corps: int | None = None  # 이번 업데이트로 변화 있는 발행사 수
        self.corps_after: int | None = None    # 갱신 후 총 발행사 수
        self.proc: subprocess.Popen | None = None
        self.finished = False
        self._tick_start: float | None = None
        self._last_log_time: float | None = None
        self._base_status = ""
        self._period_days = tk.IntVar(value=DEFAULT_DAYS)
        # 직접 입력 모드의 시작/종료 일자 (StringVar — Entry 와 연결)
        _today = date.today()
        self._custom_start_var = tk.StringVar(
            value=(_today - timedelta(days=90)).strftime("%Y-%m-%d"))
        self._custom_end_var = tk.StringVar(value=_today.strftime("%Y-%m-%d"))

        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self._show_chooser()

    # ============== 1단계: 기간 선택 화면 ==============

    def _show_chooser(self):
        for w in self.main.winfo_children():
            w.destroy()

        ttk.Label(self.main, text="DCM Table 업데이트",
                  font=("맑은 고딕", 14, "bold")).pack(anchor="w", pady=(0, 4))
        ttk.Label(self.main,
                  text=f"기존 파일: {EXCEL_PATH.name}\n"
                       "새로 등록된 공시를 자동으로 fetch 해서 같은 파일에 갱신합니다.",
                  foreground="#555").pack(anchor="w", pady=(0, 18))

        box = ttk.LabelFrame(self.main, text="조회 기간 선택", padding=14)
        box.pack(fill="x", pady=(0, 16))

        for label, days in PERIOD_OPTIONS:
            ttk.Radiobutton(box, text=label, variable=self._period_days,
                            value=days).pack(anchor="w", pady=2)

        # 직접 입력 모드의 시작/종료 일자 입력칸
        custom_frame = ttk.Frame(box)
        custom_frame.pack(fill="x", pady=(6, 0), padx=(20, 0))
        ttk.Label(custom_frame, text="시작일:").grid(row=0, column=0, sticky="w")
        self._start_entry = ttk.Entry(custom_frame, textvariable=self._custom_start_var,
                                       width=14)
        self._start_entry.grid(row=0, column=1, padx=(6, 16))
        ttk.Label(custom_frame, text="종료일:").grid(row=0, column=2, sticky="w")
        self._end_entry = ttk.Entry(custom_frame, textvariable=self._custom_end_var,
                                     width=14)
        self._end_entry.grid(row=0, column=3, padx=(6, 0))

        # 미리보기 라벨 — 선택값에 따라 실제 조회 범위 미리 표시
        self._preview_var = tk.StringVar()
        ttk.Label(box, textvariable=self._preview_var,
                  foreground="#0066cc", padding=(0, 12, 0, 0)).pack(anchor="w")
        self._period_days.trace_add("write", self._update_preview)
        self._custom_start_var.trace_add("write", self._update_preview)
        self._custom_end_var.trace_add("write", self._update_preview)
        self._update_preview()

        btn_row = ttk.Frame(self.main)
        btn_row.pack(fill="x", pady=(8, 0))
        ttk.Button(btn_row, text="취소",
                   command=self.root.destroy).pack(side="right", padx=(8, 0))
        ttk.Button(btn_row, text="업데이트 시작",
                   command=self._on_start_click).pack(side="right")

    def _get_date_range(self) -> tuple[date, date] | None:
        """현재 선택된 옵션에서 (start, end) 반환. 직접 입력 모드 파싱 실패 시 None."""
        days = self._period_days.get()
        if days >= 0:
            end = date.today()
            return end - timedelta(days=days), end
        # 직접 입력 모드 — YYYY-MM-DD 파싱
        try:
            start = datetime.strptime(
                self._custom_start_var.get().strip(), "%Y-%m-%d"
            ).date()
            end = datetime.strptime(
                self._custom_end_var.get().strip(), "%Y-%m-%d"
            ).date()
        except ValueError:
            return None
        if start > end:
            return None
        return start, end

    def _update_preview(self, *_):
        rng = self._get_date_range()
        if rng is None:
            self._preview_var.set("→ 직접 입력 날짜 형식 오류 (YYYY-MM-DD)")
            return
        start, end = rng
        delta_days = (end - start).days
        if self._period_days.get() == -1:
            self._preview_var.set(f"→ 조회 범위: {start} ~ {end}  ({delta_days}일)")
        else:
            self._preview_var.set(
                f"→ 조회 범위: {start} ~ {end}  ({self._period_days.get()}일)"
            )

    def _on_start_click(self):
        if not EXCEL_PATH.exists():
            messagebox.showerror(
                "오류",
                f"엑셀 파일 없음:\n{EXCEL_PATH}\n\n"
                "DCM Table.xlsx 파일이 같은 폴더에 있어야 합니다."
            )
            return
        if not META_PATH.exists():
            messagebox.showerror(
                "오류",
                f"메타 파일 없음:\n{META_PATH}\n\n"
                "DCM Table.meta.json 사이드카 파일이 함께 있어야 합니다."
            )
            return
        # 직접 입력 모드 날짜 유효성 검증
        rng = self._get_date_range()
        if rng is None:
            messagebox.showerror(
                "오류",
                "직접 입력 날짜를 확인해 주세요.\n"
                "형식: YYYY-MM-DD (예: 2025-01-01)\n"
                "시작일이 종료일보다 이전이어야 합니다."
            )
            return
        self._show_progress()

    # ============== 2단계: 진행 화면 ==============

    def _show_progress(self):
        for w in self.main.winfo_children():
            w.destroy()

        self.status_var = tk.StringVar(value="")
        ttk.Label(self.main, textvariable=self.status_var,
                  font=("맑은 고딕", 11, "bold")).pack(anchor="w")

        self.progress = ttk.Progressbar(self.main, mode="determinate", maximum=100)
        self.progress.pack(fill="x", pady=(8, 4))

        bar_row = ttk.Frame(self.main)
        bar_row.pack(fill="x")
        self.pct_var = tk.StringVar(value="0%")
        ttk.Label(bar_row, textvariable=self.pct_var).pack(side="right")
        self.elapsed_var = tk.StringVar(value="경과 0초")
        ttk.Label(bar_row, textvariable=self.elapsed_var,
                  foreground="#555").pack(side="left")

        log_frame = ttk.Frame(self.main)
        log_frame.pack(fill="both", expand=True, pady=(10, 0))
        self.log = tk.Text(log_frame, height=16, wrap="word",
                           font=("Consolas", 9))
        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        self.log.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        self.close_btn = ttk.Button(self.main, text="닫기",
                                    command=self.on_close, state="disabled")
        self.close_btn.pack(pady=(8, 0), anchor="e")

        rng = self._get_date_range()
        if rng is None:
            messagebox.showerror("오류", "날짜 설정 오류 — 이전 화면으로 돌아가세요.")
            return
        start, end = rng
        delta_days = (end - start).days
        self.append_log(f"대상 파일: {EXCEL_PATH.name}")
        self.append_log(f"조회 기간: {start} ~ {end}  ({delta_days}일)")
        self.append_log("-" * 60)
        self.set_progress(3, "DART 공시 목록 조회 준비...")

        # 시간 ticker 시작 — 매초 elapsed_var 갱신
        self._tick_start = time.time()
        self._last_log_time = time.time()
        self._tick_elapsed()

        threading.Thread(target=self.run_subprocess,
                         args=(start, end), daemon=True).start()

    def append_log(self, text: str):
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self._last_log_time = time.time()

    def set_progress(self, pct: float, status: str | None = None):
        pct = max(0, min(100, pct))
        self.progress["value"] = pct
        self.pct_var.set(f"{pct:.0f}%")
        if status is not None:
            self._base_status = status
            self.status_var.set(self._base_status)

    def _tick_elapsed(self):
        """매 1초마다 경과시간 갱신. 작업 중에도 GUI 가 살아있다는 시각적 신호."""
        if self.finished or self._tick_start is None:
            return
        elapsed = int(time.time() - self._tick_start)
        suffix = ""
        if (self._last_log_time is not None
                and time.time() - self._last_log_time > 4):
            quiet = int(time.time() - self._last_log_time)
            suffix = f"   (마지막 로그 {quiet}초 전 · 계속 처리 중)"
        self.elapsed_var.set(f"경과 {elapsed}초{suffix}")
        self.root.after(1000, self._tick_elapsed)

    def _find_python_exe(self) -> str:
        exe = Path(sys.executable)
        candidate = exe.parent / exe.name.replace("pythonw", "python")
        if candidate.exists():
            return str(candidate)
        return sys.executable

    def run_subprocess(self, start: date, end: date):
        main_py = AUTO_DIR / "main.py"
        cmd = [
            self._find_python_exe(),
            "-u",
            str(main_py),
            "--update", str(EXCEL_PATH),
            start.strftime("%Y-%m-%d"),
            end.strftime("%Y-%m-%d"),
            "-o", str(EXCEL_PATH),
        ]

        creationflags = 0
        if sys.platform == "win32":
            creationflags = 0x08000000  # CREATE_NO_WINDOW

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"

        try:
            self.proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=str(AUTO_DIR),
                creationflags=creationflags,
                env=env,
            )
            for line in self.proc.stdout:
                line = line.rstrip()
                self.root.after(0, self.handle_line, line)
            self.proc.wait()
            if self.proc.returncode == 0:
                self.root.after(0, self.on_complete)
            else:
                self.root.after(0, self.on_error,
                                f"종료 코드 {self.proc.returncode}")
        except FileNotFoundError as e:
            self.root.after(0, self.on_error, f"Python 실행 실패: {e}")
        except Exception as e:
            self.root.after(0, self.on_error, str(e))

    def handle_line(self, line: str):
        self.append_log(line)

        if "기존 records=" in line:
            self.set_progress(8, "기존 데이터 로드 완료")
            return
        if "OpenDART list 조회" in line:
            self.set_progress(10, "DART 공시 목록 조회 중...")
            return
        if "(채무증권) 총" in line:
            self.set_progress(12, "공시 목록 조회 완료")
            return
        if "[발행조건확정]" in line and "건" in line and "skip" not in line:
            m = re.search(r"\[발행조건확정\] (\d+)건", line)
            if m and self.total_finals is None:
                self.total_finals = int(m.group(1))
                self.set_progress(14,
                                  f"[발행조건확정] {self.total_finals}건 발견")
            return
        if "미처리 신규" in line:
            # 형식: "미처리 신규 N건 (초기 K + [발행조건확정] M, 이미 처리된 X건 skip)"
            m_total = re.search(r"미처리 신규 (\d+)건", line)
            m_split = re.search(r"초기 (\d+)\s*\+\s*\[발행조건확정\]\s*(\d+)", line)
            total = int(m_total.group(1)) if m_total else 0
            if m_split:
                self.new_initial = int(m_split.group(1))
                self.new_finals = int(m_split.group(2))
            else:
                self.new_initial = 0
                self.new_finals = total
            if total == 0:
                self.set_progress(95, "새 공시 없음 - 갱신할 내용 없음")
            else:
                parts = []
                if self.new_initial:
                    parts.append(f"초기 {self.new_initial}")
                if self.new_finals:
                    parts.append(f"[발행조건확정] {self.new_finals}")
                self.set_progress(18, "신규 " + " + ".join(parts) + " 처리 시작")
            return
        if "추가 조회 필요 발행사" in line:
            m = re.search(r"추가 조회 필요 발행사 (\d+)곳", line)
            if m:
                self.missing_corps = int(m.group(1))
            return
        if "업데이트 결과:" in line:
            # "새로 발견된 공시로 발행사 N곳 업데이트 (전체 M곳)"
            m = re.search(
                r"발행사 (\d+)곳 업데이트\s*\(전체\s*(\d+)곳\)",
                line,
            )
            if m:
                self.updated_corps = int(m.group(1))
                self.corps_after = int(m.group(2))
            return
        if re.search(r"\] \[\d{8}\]", line):
            self.processed_count += 1
            total_new = (self.new_initial or 0) + (self.new_finals or 0)
            if total_new > 0:
                pct = 18 + 72 * min(1.0, self.processed_count / total_new)
                m = re.search(r"\[\d{8}\] ([^|]+?) \|", line)
                corp = m.group(1).strip() if m else ""
                label = (f"공시 처리 중 ({self.processed_count}/"
                         f"{total_new}) {corp}")
                self.set_progress(pct, label)
            return
        if "병합:" in line:
            self.set_progress(92, "데이터 병합 중...")
            return
        if "엑셀 생성" in line:
            self.set_progress(96, "엑셀 파일 저장 중...")
            return

    def on_complete(self):
        """cmd_update 완료 → Layer 1 검증 + auto-fix 자동 진행."""
        self.set_progress(96, "수집 완료 — 검증 + 수정 진행")
        self.append_log("=" * 60)
        self.append_log("[수집 완료] 이어서 Layer 1 검증 + auto-fix 실행")
        # 검증 phase 시작
        threading.Thread(target=self._run_validator,
                         daemon=True).start()

    def _run_validator(self):
        """validator.py 서브프로세스 — 검증 + auto-fix 자동 실행."""
        validator_py = AUTO_DIR / "validator.py"
        cmd = [
            self._find_python_exe(),
            "-u",
            str(validator_py),
            "--xlsx", str(EXCEL_PATH),
            "--report-md", str(ROOT_DIR / "validator_report.md"),
            "--report-json", str(ROOT_DIR / "validator_report.json"),
            "--new-only",   # 이번 수집 사이클의 신규 records 만 검증 대상
            "--quiet",
        ]
        creationflags = 0
        if sys.platform == "win32":
            creationflags = 0x08000000  # CREATE_NO_WINDOW
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True,
                encoding="utf-8", errors="replace",
                cwd=str(AUTO_DIR), creationflags=creationflags, env=env,
                timeout=300,
            )
            if proc.returncode != 0:
                self.root.after(0, self._validator_done, False,
                                f"validator 종료 코드 {proc.returncode}")
            else:
                self.root.after(0, self._validator_done, True, None)
        except Exception as e:
            self.root.after(0, self._validator_done, False, str(e))

    def _validator_done(self, ok: bool, err: str | None):
        """validator 완료 후 최종 요약 + Excel 실행."""
        self.finished = True
        self.set_progress(100, "검증 + 수정 완료" if ok else "검증 실패")
        elapsed = int(time.time() - (self._tick_start or time.time()))
        self.elapsed_var.set(f"경과 {elapsed}초")

        lines = ["업데이트 + 검증 완료."]
        updated = self.updated_corps or 0
        missing = self.missing_corps or 0

        lines.append("")
        if updated == 0:
            lines.append("새로 발견된 공시는 없습니다.")
        else:
            lines.append(f"새로 발견된 공시로 발행사 {updated}곳 업데이트됨.")

        if missing and missing > updated:
            gap = missing - updated
            lines.append(
                f"※ 그 중 {gap}곳은 조회 기간 밖이라 이번에 업데이트되지 못함"
                f" (조회 기간을 더 넓혀 재실행하면 처리됨)"
            )

        if not ok:
            lines.append("")
            lines.append(f"⚠ 검증 단계 오류: {err}")
            lines.append("수집은 완료됐지만 검증/수정은 미적용. 수동 실행 권장:")
            lines.append("  py auto/validator.py")
        else:
            # validator_report.json 에서 자동 수정 건수 합산
            # (메모리 patch + DART target fetch patch 모두 포함)
            try:
                report_json = ROOT_DIR / "validator_report.json"
                if report_json.exists():
                    data = json.loads(report_json.read_text(encoding="utf-8"))
                    n_patched = len(data.get("patched", []))
                    n_fetch_patched = len(data.get("fetch_patched", []))
                    total_fixed = n_patched + n_fetch_patched
                    lines.append("")
                    lines.append(f"검증 완료 → 자동 수정 {total_fixed}건")
            except Exception:
                pass

        msg = "\n".join(lines)
        self.append_log("=" * 60)
        for l in lines:
            self.append_log(l)
        self.close_btn["state"] = "normal"
        messagebox.showinfo("완료", msg + f"\n\n파일: {EXCEL_PATH}")
        self._launch_excel_and_close()

    def _launch_excel_and_close(self):
        """엑셀 파일을 기본 프로그램(Excel)으로 실행 후 GUI 창 종료."""
        try:
            if sys.platform == "win32":
                os.startfile(str(EXCEL_PATH))
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(EXCEL_PATH)])
            else:
                subprocess.Popen(["xdg-open", str(EXCEL_PATH)])
        except Exception as e:
            # 엑셀 실행 실패해도 창은 닫는다 (파일은 이미 저장됨)
            messagebox.showwarning(
                "엑셀 실행 실패",
                f"엑셀 파일을 자동으로 열지 못했습니다:\n{e}\n\n"
                f"수동으로 열어주세요:\n{EXCEL_PATH}"
            )
        finally:
            self.root.destroy()

    def on_error(self, err: str):
        self.finished = True
        self.append_log("")
        self.append_log("[오류] " + err)
        if hasattr(self, "status_var"):
            self.status_var.set("오류 발생")
        if hasattr(self, "close_btn"):
            self.close_btn["state"] = "normal"
        messagebox.showerror("업데이트 실패", err)

    def on_close(self):
        if self.proc and self.proc.poll() is None and not self.finished:
            if not messagebox.askyesno(
                "확인", "업데이트가 진행 중입니다. 정말 종료하시겠습니까?"
            ):
                return
            try:
                self.proc.terminate()
            except Exception:
                pass
        self.root.destroy()


def main():
    root = tk.Tk()
    UpdateApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
