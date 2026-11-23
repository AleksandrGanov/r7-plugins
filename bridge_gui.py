# Версия 26.48.5 от 24.11.2026
# Название файла при выдаче в чат bridge_gui.py

# -*- coding: utf-8 -*-
"""
R7 Bridge — простая морда:
  - кнопка "Закрыть"
  - поле статуса (запущен бридж или нет)
  - чёрное поле лога с вертикальной прокруткой
  - выпадающий список с логами из папки Logs
"""

import datetime
import os
import subprocess
import sys
import traceback
from pathlib import Path

# tkinter импортируется в защищённом блоке: если его нет в системе,
# программа не упадёт молча, а покажет понятное сообщение и дождётся Enter.
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext
    TK_OK = True
except Exception as _tk_err:
    TK_OK = False
    _TK_ERR = _tk_err

# Настройки путей и параметров опроса. BASE_DIR — папка, где лежит скрипт
# (или _MEIPASS при сборке в exe). LOGS_DIR — папка с логами рядом с ним.
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
LOGS_DIR = BASE_DIR / "Logs"

# Имя процесса бриджа. Менять под реальное имя запускаемого файла бриджа.
PROCESS_NAME = "r7bridge.exe"

REFRESH_MS = 3000  # период опроса статуса, мс

FILE_VERSION = "26.48.5"  # версия файла, печатается в консоль при запуске

# Печатает в консоль шапку с именем и версией запущенного файла.
# Нужна, чтобы сразу видеть, какая именно версия файла реально запущена.
def print_banner():
    print("=" * 60)
    print(f"Запущен файл: bridge_gui.py, версия {FILE_VERSION}")
    print("=" * 60)

# Дописывает текст ошибки в Logs/error_traceback.txt с датой и временем.
# Обёрнута в try: если даже запись не удалась, это не мешает показать ошибку.
def save_error_log(text: str):
    try:
        LOGS_DIR.mkdir(exist_ok=True)
        stamp = datetime.datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        with open(LOGS_DIR / "error_traceback.txt", "a", encoding="utf-8") as f:
            f.write(f"\n===== {stamp} =====\n{text}\n")
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

# Точка входа: проверяет наличие tkinter, создаёт папку Logs (если её нет),
# главное окно tkinter и запускает цикл обработки событий.
def main():
    if not TK_OK:
        raise RuntimeError(
            "Модуль tkinter не найден — графическое окно невозможно.\n"
            f"Причина: {_TK_ERR}\n"
            "Переустановите Python и при установке включите компоненту tcl/tk."
        )
    LOGS_DIR.mkdir(exist_ok=True)
    root = tk.Tk()
    BridgeGui(root)
    root.mainloop()

# Класс главного окна: статус бриджа, выбор лога, чёрное поле лога,
# кнопка "Закрыть". Управляет опросом статуса по таймеру.
class BridgeGui:
    # Строит интерфейс: верхняя строка со статусом и кнопкой "Закрыть",
    # строка выбора лога с комбобоксом и кнопкой "Обновить",
    # чёрное поле лога с прокруткой. Запускает первое обновление данных.
    def __init__(self, root: "tk.Tk"):
        self.root = root
        root.title("R7 Bridge")
        root.geometry("860x560")
        root.minsize(640, 420)

        # Обработчик ошибок внутри окна: при любой ошибке в кнопках или
        # таймере окно с ошибкой показывается, программа не закрывается.
        root.report_callback_exception = self.report_callback_exception

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

    # Обработчик ошибок внутри работающего окна: собирает полный текст ошибки,
    # пишет его в Logs/error_traceback.txt и показывает окно с сообщением.
    # Программа при этом не закрывается.
    def report_callback_exception(self, exc, val, tb):
        err = "".join(traceback.format_exception(exc, val, tb))
        save_error_log(err)
        try:
            from tkinter import messagebox
            messagebox.showerror("Ошибка в программе", err[-3000:])
        except Exception:
            print(err)

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
    try:
        print_banner()
        main()
    except BaseException:
        err = traceback.format_exc()
        print(err)
        save_error_log(err)
        print("Программа остановлена из-за ошибки (полный текст выше).")
        print("Копия ошибки сохранена в:", LOGS_DIR / "error_traceback.txt")
    finally:
        try:
            input("\nНажмите Enter, чтобы закрыть это окно...")
        except Exception:
            pass

# Лог изменений:
# 26.48.5, 24.11.2026 — Защита от закрытия усилена и проверена заново: в консоль
#   при запуске печатается версия файла (видно, какая версия реально запущена);
#   import tkinter вынесен в защищённый блок — при его отсутствии программа
#   покажет сообщение и не закроется; ошибки внутри окна пишутся в
#   Logs/error_traceback.txt; wait-Enter в finally обёрнут в try (не падает,
#   если консоли нет). Логика интерфейса не менялась.
# 26.48.4, 24.11.2026 — Лог изменений в конце закомментирован (был причиной
#   SyntaxError при запуске). Весь запуск обёрнут в try/except BaseException,
#   в finally — input(): окно/консоль не закрываются до нажатия Enter.
#   Текст ошибки дополнительно сохраняется в Logs/error_traceback.txt.
#   Ошибки внутри окна перехватываются через report_callback_exception.
# 26.48.1, 24.11.2026 — Первое оформление файла по правилам: добавлена строка
#   версии в начале, описание к каждой функции и методу, лог изменений в конце,
#   убраны двойные пустые строки. Код не менялся.
