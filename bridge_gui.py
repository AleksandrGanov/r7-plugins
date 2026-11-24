# Версия 26.48.18 от 24.11.2026
# Название файла при выдаче в чат bridge_gui.py

# -*- coding: utf-8 -*-
r"""
R7 Bridge — простая морда:
  - кнопки запуска / остановки / перезапуска службы R7Bridge через nssm
  - поле статуса: опрос каждую секунду, зелёный "в работе", красный "остановлен"
  - чёрное поле лога с вертикальной прокруткой
  - выпадающий список с логами из C:\r7bridge\logs
"""

from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import traceback
from datetime import datetime
from pathlib import Path

# Защищённый импорт tkinter: если модуля нет, печатается понятное сообщение
# и консоль ждёт Enter — вместо невнятного падения.
try:
    import tkinter as tk
    from tkinter import ttk, scrolledtext, messagebox
except ImportError:
    tk = None
    print("Не найден модуль tkinter. Установите Python с компонентом 'tcl/tk and IDLE'.")
    input("Нажмите Enter для выхода...")
    sys.exit(1)

# Настройки путей и параметров опроса. BASE_DIR — папка, где лежит скрипт
# (или _MEIPASS при сборке в exe). LOGS_DIR — общая папка логов моста,
# ERROR_LOG — файл, куда дописываются все необработанные ошибки морды.
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
LOGS_DIR = Path(r"C:\r7bridge\logs")
ERROR_LOG = LOGS_DIR / "error_traceback.txt"

# Служба моста: полный путь к nssm.exe (работает из любой папки, PATH не нужен),
# имя службы и имя процесса бриджа для проверки статуса.
NSSM_PATH = r"C:\r7bridge\nssm.exe"
SERVICE_NAME = "R7Bridge"
PROCESS_NAME = "r7bridge.exe"

REFRESH_MS = 1000  # период опроса статуса, мс

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

# Прячет окно консоли: морда запускается без чёрного окна, остаётся только GUI.
# Если консоли нет (запуск через pythonw) — ничего не делает.
def hide_console() -> None:
    try:
        kernel32 = ctypes.windll.kernel32
        hwnd = kernel32.GetConsoleWindow()
        if hwnd:
            kernel32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:
        pass

# Проверяет, видимо ли окно консоли. Нужно, чтобы ожидание Enter в конце
# работало только при видимой консоли: спрятанную консоль ждать бессмысленно.
def console_visible() -> bool:
    try:
        kernel32 = ctypes.windll.kernel32
        hwnd = kernel32.GetConsoleWindow()
        if not hwnd:
            return False
        return bool(kernel32.IsWindowVisible(hwnd))
    except Exception:
        return True

# Дописывает traceback ошибки в ERROR_LOG с датой и временем.
# Папка логов создаётся при необходимости. Сбой записи не мешает работе.
def append_error_log(err: str) -> None:
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write(f"\n[{stamp}] Ошибка морды:\n{err}\n")
    except Exception:
        pass

# Показывает окно с ошибкой. Используется, когда исключение случилось
# до создания главного окна или вне его callback'ов.
def show_error_box(err: str) -> None:
    if tk is None:
        return
    try:
        r = tk.Tk()
        r.withdraw()
        messagebox.showerror("R7 Bridge — ошибка", err[:4000], parent=r)
        r.destroy()
    except Exception:
        pass

# Обработчик ошибок внутри работающего окна (callback'и tkinter):
# показывает окно с текстом ошибки и пишет её в лог. Программа НЕ закрывается
# и продолжает работать — закрыть окно может только пользователь.
def report_callback_exception(exc_type, exc_val, exc_tb) -> None:
    err = "".join(traceback.format_exception(exc_type, exc_val, exc_tb))
    append_error_log(err)
    try:
        messagebox.showerror("R7 Bridge — ошибка", err[:4000])
    except Exception:
        pass

# Класс главного окна: статус бриджа, кнопки службы, выбор лога,
# чёрное поле лога, кнопка "Закрыть". Управляет опросом статуса по таймеру.
class BridgeGui:
    # Строит интерфейс: верхняя строка со статусом и кнопкой "Закрыть",
    # строка кнопок службы, строка выбора лога с комбобоксом и кнопкой "Обновить",
    # чёрное поле лога с прокруткой. Запускает первое обновление данных.
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("R7 Bridge")
        root.geometry("860x560")
        root.minsize(640, 420)
        root.report_callback_exception = report_callback_exception

        # Верхняя строка: статус + кнопка "Закрыть"
        top = ttk.Frame(root, padding=(10, 10, 10, 5))
        top.pack(fill="x")

        self.status_label = tk.Label(
            top, text="Статус: ...", font=("Segoe UI", 11, "bold"), anchor="w"
        )
        self.status_label.pack(side="left")

        close_btn = ttk.Button(top, text="Закрыть", command=root.destroy)
        close_btn.pack(side="right")

        # Строка кнопок службы: команды выполняются через nssm с полным путём
        svc = ttk.Frame(root, padding=(10, 0, 10, 0))
        svc.pack(fill="x")

        ttk.Button(svc, text="Запустить", width=14,
                   command=lambda: self.run_service_command("start", "Запуск")).pack(side="left")
        ttk.Button(svc, text="Остановить", width=14,
                   command=lambda: self.run_service_command("stop", "Остановка")).pack(side="left", padx=(8, 0))
        ttk.Button(svc, text="Перезапустить", width=14,
                   command=lambda: self.run_service_command("restart", "Перезапуск")).pack(side="left", padx=(8, 0))

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
            state="disabled",
            wrap="none",
        )
        self.log_view.pack(fill="both", expand=True, padx=10, pady=(5, 10))

        self.refresh_log_list()
        self.update_status()
        self._schedule_status()

    # Выполняет команду службы через nssm с полным путём: start, stop или restart.
    # Окно консоли не открывается (CREATE_NO_WINDOW), результат показывается
    # окном-сообщением, статус обновляется сразу, не дожидаясь следующего тика.
    # nssm.exe не найден — сообщение об ошибке вместо падения.
    def run_service_command(self, action: str, title: str) -> None:
        if not os.path.isfile(NSSM_PATH):
            messagebox.showerror("Ошибка", f"nssm.exe не найден: {NSSM_PATH}")
            return
        try:
            proc = subprocess.run(
                [NSSM_PATH, action, SERVICE_NAME],
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            out = (proc.stdout or "").strip()
            err = (proc.stderr or "").strip()
            text = out or err or "команда выполнена без вывода"
            messagebox.showinfo(title, text)
        except Exception as e:
            messagebox.showerror("Ошибка", f"Не удалось выполнить команду:\n{e}")
        self.update_status()

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

    # Сканирует папку логов, заполняет комбобокс именами файлов
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

# Точка входа: создаёт папку логов (если её нет), прячет консоль,
# создаёт главное окно tkinter и запускает цикл обработки событий.
def main():
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    hide_console()
    root = tk.Tk()
    BridgeGui(root)
    root.mainloop()

if __name__ == "__main__":
    # Запуск под полной защитой: любое исключение печатается в консоль,
    # дописывается в C:\r7bridge\logs\error_traceback.txt и показывается окном.
    # Окно само не закрывается никогда — закрыть его может только пользователь.
    try:
        main()
    except BaseException:
        err = traceback.format_exc()
        print(err)
        append_error_log(err)
        show_error_box(err)
    finally:
        # Ждём Enter только при видимой консоли: после скрытия консоли
        # невидимое ожидание оставило бы висящий процесс.
        if console_visible():
            try:
                input("Нажмите Enter для выхода...")
            except Exception:
                pass

# Лог изменений:
#   26.48.1 (24.11.2026): Первое оформление файла по правилам: добавлена строка версии
#     в начале, описание к каждой функции и методу, лог изменений в конце, убраны
#     двойные пустые строки. Код не менялся.
#   26.48.14 (24.11.2026): Морда защищена от закрытия: весь запуск в try/except
#     BaseException, при ошибке traceback печатается, пишется в error_traceback.txt
#     и показывается окном; окно не закрывается само. Ошибки внутри окна перехватываются
#     через report_callback_exception. Импорт tkinter защищён. Незакомментированный лог
#     в конце файла (причина падения с SyntaxError) закомментирован.
#   26.48.15 (24.11.2026): Папка логов исправлена: LOGS_DIR = C:\r7bridge\logs (была
#     Logs рядом со скриптом). Папка создаётся автоматически при запуске и перед
#     записью ошибки. Путь файла ошибок — C:\r7bridge\logs\error_traceback.txt.
#   26.48.16 (24.11.2026): Добавлены три кнопки службы: "Запустить", "Остановить",
#     "Перезапустить" (nssm start / stop / restart R7Bridge). Опрос статуса ускорен
#     до 1 секунды (REFRESH_MS = 1000). Состояние службы контролируется постоянным
#     опросом статуса, отдельной кнопки нет.
#   26.48.17 (24.11.2026): Команды службы переведены на полный путь C:\r7bridge\nssm.exe
#     (работают из любой папки, PATH не нужен). Консоль прячется при запуске морды
#     (hide_console), ожидание Enter работает только при видимой консоли, при закрытии
#     окна программа завершается сразу.
#   26.48.18 (24.11.2026): Ещё раз выверены команды службы: в коде не осталось ни одного
#     вызова nssm без полного пути — все обращения идут через NSSM_PATH =
#     C:\r7bridge\nssm.exe (start / stop / restart R7Bridge). Других изменений нет.
