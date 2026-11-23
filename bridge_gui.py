# Версия 26.48.4 от 24.11.2026
# Название файла при выдаче в чат bridge_gui.py

# -*- coding: utf-8 -*-
"""
R7 Bridge — простая морда:
  - кнопка "Закрыть"
  - поле статуса (запущен бридж или нет)
  - чёрное поле лога с вертикальной прокруткой
  - выпадающий список с логами из папки Logs
Программа при ошибке НЕ закрывается: ошибка показывается в окне,
печатается в консоль и сохраняется в Logs/error_traceback.txt.
"""

import os
import subprocess
import sys
import traceback
from pathlib import Path

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox

# Настройки путей и параметров опроса. BASE_DIR — папка, где лежит скрипт
# (или _MEIPASS при сборке в exe). LOGS_DIR — папка с логами рядом с ним.
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
LOGS_DIR = BASE_DIR / "Logs"
ERROR_LOG = LOGS_DIR / "error_traceback.txt"

# Имя процесса бриджа. Менять под реальное имя запускаемого файла бриджа.
PROCESS_NAME = "r7bridge.exe"

REFRESH_MS = 3000  # период опроса статуса, мс

# Сохраняет текст ошибки: дописывает его в файл ERROR_LOG, печатает в
# консоль и дублирует последнюю часть в текстовом виде. Не падает, даже
# если файл записать не удалось — тогда остаётся только вывод в консоль.
def save_error(text: str) -> None:
    try:
        LOGS_DIR.mkdir(exist_ok=True)
        with ERROR_LOG.open("a", encoding="utf-8", errors="replace") as f:
            f.write("\n" + "=" * 60 + "\n")
            f.write(text)
            if not text.endswith("\n"):
                f.write("\n")
    except Exception:
        pass  # если файл недоступен — ошибка всё равно уйдёт в консоль
    try:
        print(text)
        sys.stdout.flush()
    except Exception:
        pass

# Обработчик ошибок внутри уже запущенного окна (кнопки, таймер и т.д.).
# Показывает окно с текстом ошибки и НЕ даёт программе закрыться.
def report_exception(exc_type, exc_value, exc_tb):
    text = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    save_error(text)
    try:
        messagebox.showerror("Ошибка в программе", text[-3000:])
    except Exception:
        pass  # если окно уже недоступно — текст останется в консоли и файле

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

# Точка входа: создаёт папку Logs (если её нет), главное окно tkinter,
# подключает обработчик ошибок окна и запускает цикл обработки событий.
def main():
    LOGS_DIR.mkdir(exist_ok=True)
    root = tk.Tk()
    root.report_callback_exception = report_exception
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
    try:
        main()
        print("Программа завершена без ошибок.")
    except BaseException:
        # Любая ошибка запуска: печатаем, сохраняем и НЕ даём окну закрыться.
        save_error(traceback.format_exc())
    finally:
        # Консоль всегда ждёт Enter — успеешь скопировать текст ошибки
        # (Ctrl+A, затем Ctrl+C) или просто посмотреть его.
        try:
            input("Нажмите Enter, чтобы закрыть окно консоли...")
        except (EOFError, OSError):
            pass

# Лог изменений:
# 26.48.1, 24.11.2026 — Первое оформление файла по правилам: добавлена строка версии в начале, описание к каждой функции и методу, лог изменений в конце, убраны двойные пустые строки. Код не менялся.
# 26.48.2, 24.11.2026 — Добавлена защита от закрытия при ошибке: try/except вокруг запуска, обработчик report_callback_exception, сохранение ошибок в Logs/error_traceback.txt.
# 26.48.3, 24.11.2026 — Лог изменений в конце файла переведён в комментарии (#), чтобы убрать SyntaxError при запуске: раньше строки лога читались как код и падали до старта защиты.
# 26.48.4, 24.11.2026 — Усиленная защита: except BaseException ловит любые ошибки запуска, input() в finally держит консоль открытой всегда (и после ошибки, и после нормального закрытия), ошибки внутри окна показываются через messagebox. Логика интерфейса не менялась.
