# Версия 26.48.3 от 24.11.2026
# Название файла при выдаче в чат bridge_gui.py

# -*- coding: utf-8 -*-
"""
R7 Bridge — простая морда:
  - кнопка "Закрыть"
  - поле статуса (запущен бридж или нет)
  - чёрное поле лога с вертикальной прокруткой
  - выпадающий список с логами из папки Logs
  - при ЛЮБОЙ ошибке: текст печатается в консоль, сохраняется в
    Logs/error_traceback.txt, а консоль НЕ закрывается сама
"""

from __future__ import annotations

import os
import subprocess
import sys
import traceback
from pathlib import Path

# Настройки путей и параметров опроса. BASE_DIR — папка, где лежит скрипт
# (или _MEIPASS при сборке в exe). LOGS_DIR — папка с логами рядом с ним.
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
LOGS_DIR = BASE_DIR / "Logs"

# Файл, в который пишется полный текст последней ошибки, чтобы её
# можно было открыть и скопировать даже если консоль закрыли.
ERROR_FILE = LOGS_DIR / "error_traceback.txt"

# Имя процесса бриджа. Менять под реальное имя запускаемого файла бриджа.
PROCESS_NAME = "r7bridge.exe"

REFRESH_MS = 3000  # период опроса статуса, мс

# Импорт tkinter на старте: если библиотеки нет — текст ошибки запоминается
# и показывается позже через report_error, а не роняет скрипт молча.
tkimport_error = None
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext
except Exception:
    tkimport_error = traceback.format_exc()

# Печатает блок с ошибкой в консоль и сохраняет его в ERROR_FILE,
# чтобы текст ошибки можно было скопировать и переслать.
def report_error(text: str) -> None:
    print("=" * 70)
    print("ОШИБКА. Текст ниже скопируйте целиком (Ctrl+A, затем Ctrl+C):")
    print("=" * 70)
    print(text)
    try:
        LOGS_DIR.mkdir(exist_ok=True)
        ERROR_FILE.write_text(text, encoding="utf-8", errors="replace")
        print(f"Текст ошибки также сохранён в файл: {ERROR_FILE}")
    except Exception as save_err:
        print(f"Не удалось сохранить текст ошибки в файл: {save_err}")
    print("=" * 70)

# Ждёт нажатия Enter в консоли — так окно консоли не закрывается само.
def pause_console() -> None:
    try:
        input("\nНажмите Enter, чтобы закрыть это окно...")
    except Exception:
        pass

# Обработчик ошибок вне окна: печатает и сохраняет ошибку, затем ждёт Enter.
# Ставится как sys.excepthook перед запуском основного кода.
def global_excepthook(exc_type, exc_value, exc_tb) -> None:
    report_error("".join(traceback.format_exception(exc_type, exc_value, exc_tb)))
    pause_console()

# Обработчик ошибок внутри работающего окна: tkinter вызывает её при
# исключении в обработчиках кнопок и таймеров. Печатает и сохраняет
# ошибку, показывает окно с текстом. Программа при этом НЕ закрывается.
def show_callback_error(exc, val, tb) -> None:
    text = "".join(traceback.format_exception(type(val), val, tb))
    report_error(text)
    try:
        from tkinter import messagebox
        messagebox.showerror("Ошибка в программе", text[-3000:])
    except Exception:
        pass

# Проверяет, запущен ли процесс бриджа. Ищет PROCESS_NAME среди процессов
# через psutil, при его отсутствии — через tasklist. Возвращает True/False.
def is_bridge_running() -> bool:
    try:
        import psutil  # если установлен — надёжный способ
        for proc in psutil.process_iter(["name"]):
            name = (proc.info.get("name") or "").lower()
            if PROCESS_NAME.lower() in name:
                return True
        return False
    except ImportError:
        pass  # fallback: парсим tasklist

    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {PROCESS_NAME}"],
            capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout.lower()
        return PROCESS_NAME.lower() in out
    except Exception:
        return False

# Читает лог-файл с диска. Пробует кодировки utf-8, затем cp1251,
# возвращает текст файла в виде строки.
def read_log_file(path: Path) -> str:
    for enc in ("utf-8", "cp1251"):
        try:
            return path.read_text(encoding=enc, errors="strict")
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")

# Точка входа: создаёт папку Logs (если её нет), строит главное окно
# tkinter, вешает обработчик ошибок окна и запускает цикл событий.
def main() -> None:
    LOGS_DIR.mkdir(exist_ok=True)
    if tkimport_error is not None:
        report_error(tkimport_error)
        pause_console()
        return
    root = tk.Tk()
    root.report_callback_exception = show_callback_error
    BridgeGui(root)
    root.mainloop()

# Класс главного окна: статус бриджа, выбор лога, чёрное поле лога,
# кнопка "Закрыть". Управляет опросом статуса по таймеру.
class BridgeGui:
    # Строит интерфейс: верхняя строка со статусом и кнопкой "Закрыть",
    # строка выбора лога с комбобоксом и кнопкой "Обновить",
    # чёрное поле лога с прокруткой. Запускает первое обновление данных.
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("R7 Bridge")
        root.geometry("860x560")
        root.minsize(640, 420)

        # Верхняя строка: статус + кнопка "Закрыть"
        top = ttk.Frame(root, padding=(10, 10, 10, 5))
        top.pack(fill="x")

        self.status_label = tk.Label(
            top, text="Статус: …", font=("Segoe UI", 11, "bold"), anchor="w"
        )
        self.status_label.pack(side="left")

        close_btn = ttk.Button(top, text="Закрыть", command=root.destroy)
        close_btn.pack(side="right")

        # Средняя строка: выбор лога
        picker = ttk.Frame(root, padding=(10, 5))
        picker.pack(fill="x")

        ttk.Label(picker, text="Лог:").pack(side="left", padx=(0, 6))

        self.log_combo = ttk.Combobox(picker, state="readonly", width=50)
        self.log_combo.pack(side="left", fill="x", expand=True)
        self.log_combo.bind("<<ComboboxSelected>>", self.on_log_selected)

        refresh_btn = ttk.Button(picker, text="Обновить", command=self.refresh_log_list)
        refresh_btn.pack(side="left", padx=(6, 0))

        # Чёрное поле лога с вертикальной прокруткой
        self.log_view = scrolledtext.ScrolledText(
            root,
            bg="#1e1e1e", fg="#d4d4d4",
            insertbackground="#d4d4d4",
            font=("Consolas", 10),
            state="disabled",       # только чтение
            wrap="none",
        )
        self.log_view.pack(fill="both", expand=True, padx=10, pady=(5, 10))

        self.refresh_log_list()
        self.update_status()
        self._schedule_status()

    # Обновляет метку статуса: читает результат is_bridge_running()
    # и красит надпись в зелёный (в работе) или красный (остановлен).
    def update_status(self):
        running = is_bridge_running()
        if running:
            self.status_label.config(text="Статус: БРИДЖ В РАБОТЕ ✔", fg="#2e7d32")
        else:
            self.status_label.config(text="Статус: БРИДЖ ОСТАНОВЛЕН ✘", fg="#c62828")

    # Планирует следующий тик таймера опроса статуса через REFRESH_MS мс.
    def _schedule_status(self):
        self.root.after(REFRESH_MS, self._tick)

    # Обработчик таймера: обновляет статус и снова ставит следующий тик.
    def _tick(self):
        self.update_status()
        self._schedule_status()

    # Сканирует папку Logs, заполняет комбобокс именами файлов
    # (свежие сверху по дате изменения) и открывает самый свежий лог.
    def refresh_log_list(self):
        files = []
        if LOGS_DIR.is_dir():
            files = sorted(
                (p for p in LOGS_DIR.iterdir() if p.is_file()),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        self._log_files = files
        self.log_combo["values"] = [p.name for p in files]
        if files:
            self.log_combo.current(0)
            self.on_log_selected()
        else:
            self.log_combo.set("")
            self.show_text(f"Папка {LOGS_DIR} пуста или не найдена.")

    # Обработчик выбора файла в комбобоксе: читает выбранный лог
    # с диска и выводит его в поле лога.
    def on_log_selected(self, event=None):
        idx = self.log_combo.current()
        if idx < 0 or idx >= len(self._log_files):
            return
        path = self._log_files[idx]
        try:
            text = read_log_file(path)
        except OSError as e:
            text = f"Не удалось прочитать файл:\n{e}"
        self.show_text(text)

    # Выводит текст в поле лога: очищает его, вставляет текст
    # и прокручивает к началу. Поле остаётся только для чтения.
    def show_text(self, text: str):
        self.log_view.config(state="normal")
        self.log_view.delete("1.0", "end")
        self.log_view.insert("1.0", text)
        self.log_view.see("1.0")
        self.log_view.config(state="disabled")

if __name__ == "__main__":
    sys.excepthook = global_excepthook
    try:
        main()
    except KeyboardInterrupt:
        pass
    except BaseException:
        report_error(traceback.format_exc())
        pause_console()

# Лог изменений:
# 26.48.1, 24.11.2026 — Первое оформление файла по правилам: добавлена строка версии в начале, описание к каждой функции и методу, лог изменений в конце, убраны двойные пустые строки. Код не менялся.
# 26.48.3, 24.11.2026 — Защита от закрытия при ошибке: main() обёрнут в try/except, при любой ошибке печатается полный текст (Ctrl+A, Ctrl+C), текст дублируется в Logs/error_traceback.txt, консоль ждёт Enter и не закрывается. Добавлены sys.excepthook (ошибки до старта окна) и report_callback_exception (ошибки в кнопках и таймерах — окно с текстом, программа не закрывается). Важно: в прошлой версии строки лога изменений стояли обычным текстом без "#", из-за этого Python падал с SyntaxError сразу при запуске — теперь строки лога закомментированы. Остальной код не менялся.
