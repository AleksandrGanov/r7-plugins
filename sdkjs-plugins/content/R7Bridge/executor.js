// Версия 1.1.2

/**
 * Исполнитель кода команд Р7-Офис.
 * Вызывается плагином внутри callCommand и работает в контексте документа:
 * объект Api (Builder API) доступен напрямую.
 * Задача — исполнить переданный код команды и вернуть статус.
 * Данные берёт из параметра code: строка с кодом Builder API ЛИБО имя
 * встроенной команды (см. раздел встроенных команд ниже).
 * Отдаёт объект результата:
 *   {ok: true,  info: "...", value: <результат>} при успехе;
 *   {ok: false, error: "..."}                    при сбое — с максимально
 *   подробным описанием (имя ошибки, сообщение, стек).
 * Код исполняется в обёртке (function(){ ... })() — поэтому в команде можно
 * использовать return (на верхнем уровне eval оператор return запрещён).
 */

// Функция R7Executor: исполняет код команды (или встроенную команду по имени)
// в контексте документа. Данные берёт из параметра code, отдаёт объект
// результата {ok, info, value} при успехе или {ok, error} при сбое.
// При сбое собирает максимум данных: имя ошибки, сообщение и первые строки
// стека — чтобы по одной строке в логе было видно, что именно случилось.
function R7Executor(code) {
    // describeError: превращает любую ошибку в подробную строку.
    // Берёт имя ошибки (e.name), сообщение (e.message) и первые 5 строк
    // стека (e.stack) — стека достаточно, чтобы увидеть место падения.
    // Отдаёт строку вида "Name: сообщение; stack: строка1 | строка2 | ...".
    function describeError(e) {
        if (!e) return "неизвестная ошибка (объект ошибки пустой)";
        var name = e.name || "";
        var msg = (e.message !== undefined) ? String(e.message) : String(e);
        var out = (name ? name + ": " : "") + msg;
        try {
            if (e.stack) {
                var st = String(e.stack).split("\n").slice(0, 5).join(" | ");
                out += "; stack: " + st;
            }
        } catch (e2) { /* стек недоступен — не критично */ }
        return out;
    }

    // ---------- раздел встроенных команд ----------
    // BUILTINS: словарь именованных команд-читалок. Запись — функция, которая
    // из аргументов команды (строка после имени) собирает ГОТОВЫЙ код Builder
    // API и отдаёт его строкой для исполнения. Если обязательный аргумент не
    // задан — отдаёт null (исполнитель ответит ошибкой использования).
    // Произвольный код, не совпавший со встроенными именами, исполняется
    // как есть — тонкий исполнитель сохраняется.
    // Внутренние try/catch в читалках нужны, чтобы команда вернула все
    // доступные поля, а не упала целиком на первом несовпадении API.
    // Список встроенных команд:
    //   get_version            — версия Builder API (Api.GetVersion);
    //   get_lock               — проба блокировок/защиты документа: возвращает
    //                            всё, что документ готов сообщить (проба —
    //                            перечень уточняется по результату прогона);
    //   get_object_status ЯЧ   — статус ячейки ЯЧ: адрес, текст, значение,
    //                            цвет заливки (RGB и hex). Пример:
    //                            get_object_status D3
    // Имя распознаётся без учёта регистра. Аргумент ячейки — латиницей
    // (кириллические двойники Алиса нормализует на своей стороне).
    // ВАЖНО: словарь объявлен ВНУТРИ R7Executor — плагин передаёт исполнителя
    // в контекст документа как Function.toString (сериализуется только тело
    // этой функции), наружные переменные там недоступны.
    var BUILTINS = {
        // get_version: возвращает версию Builder API (Api.GetVersion).
        // Аргументов нет. Отдаёт строку кода с return — значение попадёт
        // в info/value результата.
        "get_version": function () {
            return "return Api.GetVersion();";
        },
        // get_lock: проба блокировок документа. Ни один из запрашиваемых
        // методов не гарантирован — поэтому каждое поле собирается в своём
        // try/catch и помечается: значение / "нет метода" / текст ошибки.
        // Отдаёт строку кода, возвращающую объект-сводку.
        "get_lock": function () {
            return "return (function () {" +
                " var out = { probe: 'get_lock' };" +
                " try { out.fullName = Api.GetFullName(); } catch (e) { out.fullName = 'ошибка: ' + e.message; }" +
                " try { out.activeSheet = Api.GetActiveSheet().GetName(); } catch (e) { out.activeSheet = 'ошибка: ' + e.message; }" +
                " try { out.sheetProtected = Api.GetActiveSheet().GetProtected(); } catch (e) { out.sheetProtected = 'нет метода'; }" +
                " try { var d = Api.GetDocument(); out.doc = d ? (d.GetClassType ? d.GetClassType() : 'объект без класса') : 'Api.GetDocument недоступен'; } catch (e) { out.doc = 'ошибка: ' + e.message; }" +
                " return out;" +
                "})()";
        },
        // get_object_status: статус ячейки. Аргумент — ссылка на ячейку
        // (например, "D3"). Собирает: адрес (GetAddress), текст (GetText),
        // значение (GetValue), цвет заливки (GetFillColor -> GetRGB, плюс
        // hex-строка). Отдаёт строку кода, возвращающую объект-сводку;
        // без аргумента — null (ошибка использования).
        "get_object_status": function (args) {
            var cell = String(args || '').trim().toUpperCase();
            if (!cell) return null; // без ячейки команда не имеет смысла
            var lit = JSON.stringify(cell);
            return "return (function () {" +
                " var out = { cell: " + lit + " };" +
                " try {" +
                "  var r = Api.GetActiveSheet().GetRange(" + lit + ");" +
                "  try { out.address = r.GetAddress ? r.GetAddress() : " + lit + "; } catch (e) { out.address = " + lit + "; }" +
                "  try { out.text = r.GetText(); } catch (e) { out.text = 'ошибка: ' + e.message; }" +
                "  try { out.value = (typeof r.GetValue === 'function') ? r.GetValue() : 'нет метода'; } catch (e) { out.value = 'ошибка: ' + e.message; }" +
                "  try {" +
                "   var f = r.GetFillColor();" +
                "   if (f && typeof f.GetRGB === 'function') {" +
                "    out.fillRGB = f.GetRGB();" +
                "    out.fillHex = '#' + ('000000' + ((out.fillRGB & 0xFFFFFF) >>> 0).toString(16).toUpperCase()).slice(-6);" +
                "   } else { out.fillRGB = (f === null ? 'нет заливки' : String(f)); }" +
                "  } catch (e) { out.fillRGB = 'ошибка: ' + e.message; }" +
                "  return out;" +
                " } catch (e) { out.error = e.message; return out; }" +
                "})()";
        }
    };

    // expandBuiltin: распознаёт во входной строке имя встроенной команды.
    // Данные берёт из src (исходный код команды), отдаёт:
    //   null                       — это не встроенная команда, исполнять как есть;
    //   {code: "..."}              — встроенная, код развёрнут;
    //   {error: "..."}             — встроенная требует аргумент, аргумента нет.
    function expandBuiltin(src) {
        var trimmed = String(src).trim();
        var firstToken = trimmed.split(/\s+/)[0] || '';
        var name = firstToken.toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(BUILTINS, name)) return null;
        var args = trimmed.slice(firstToken.length).trim();
        var built = BUILTINS[name](args);
        if (built === null) {
            return { error: "команда '" + name + "' требует аргумент — например: get_object_status D3" };
        }
        return { code: built };
    }

    // Проверка типа входа: не строка — фиксируем фактический тип,
    // пустая строка — тоже ошибка, исполнять нечего.
    if (typeof code !== "string") {
        return { ok: false, error: "код команды не строка, получено: " + typeof code };
    }
    if (!code.trim()) {
        return { ok: false, error: "пустой код команды" };
    }

    // Распознавание встроенной команды: имя совпало — код подменяется
    // развёрнутым; не совпало — остаётся как есть.
    var expanded = expandBuiltin(code);
    if (expanded && expanded.error) {
        return { ok: false, error: expanded.error };
    }
    if (expanded && expanded.code) {
        code = expanded.code;
    }

    try {
        // Код оборачивается в немедленно вызываемую функцию: на верхнем уровне
        // eval оператор return запрещён (SyntaxError), внутри обёртки — легален.
        // Обычные команды-выражения работают в обёртке так же.
        var wrapped = "(function () { " + code + " })()";
        var result = eval(wrapped);

        // info — человекочитаемая сводка для лога: объекты сериализуются
        // в json (иначе String(result) дал бы "[object Object]").
        var info;
        if (result === undefined) {
            info = "команда исполнена (без возвращаемого значения)";
        } else {
            try {
                info = (result !== null && typeof result === "object")
                    ? "команда исполнена: " + JSON.stringify(result)
                    : "команда исполнена: " + String(result);
            } catch (e2) {
                info = "команда исполнена (результат не сериализуется)";
            }
        }

        // value — «сырой» результат для обратного канала: попадает в сообщение
        // type:"result" и хранилище моста, Алиса читает его через GET /result.
        // Включается только если значение сериализуемо (без циклических ссылок):
        // иначе JSON.stringify всего ответа внутри плагина сломался бы.
        var response = { ok: true, info: info };
        try {
            JSON.stringify(result);
            response.value = (result === undefined) ? null : result;
        } catch (e3) { /* несериализуемо — value не включаем */ }
        return response;
    } catch (e) {
        // Текст ошибки формирует сам документ — передаём как есть,
        // но с максимумом деталей (имя, сообщение, стек)
        return { ok: false, error: describeError(e) };
    }
}

// Лог изменений:
// v1.0.0 (2026.11.23): первая версия. Исполнитель команд Р7-Офиса: setCellColor
//   (покраска ячейки через Builder API) и NormalizeCell (кириллица -> латиница).
//   Вызывается плагином внутри callCommand; распознавание команд живёт только
//   здесь — новые команды добавляются в switch без правок плагина и моста.
// v1.1.0 (2026.11.23): файл переписан на чистого исполнителя кода. Убраны
//   switch, setCellColor и normalizeCell — команд в файле больше нет.
//   R7Executor принимает готовый код команды строкой и исполняет его
//   через eval в контексте документа. Успех — {ok: true, info}, ошибка
//   исполнения — {ok: false, error} с текстом от документа. Проверка
//   корректности кода (адрес, цвет) ушла на сторону Алисы — в тело команды.
// v1.1.1 (2026.11.24): расширенный сбор данных при сбое. Добавлена describeError:
//   в error попадает имя ошибки (e.name), сообщение (e.message) и первые 5 строк
//   стека (e.stack) вместо одного сообщения. Проверка входа уточнена: отдельная
//   диагностика "код не строка" (с фактическим typeof) и "пустой код команды".
//   Успех с undefined-результатом явно помечен: "команда исполнена (без
//   возвращаемого значения)". Цель — по логу всегда видеть, почему команда
//   не удалась и в чём ошибка.
// v1.1.2 (2026.11.24): добавлен раздел встроенных команд (по запросу пользователя):
//   get_version (версия Builder API), get_lock (проба блокировок документа),
//   get_object_status ЯЧЕЙКА (адрес, текст, значение, цвет заливки ячейки).
//   Словарь BUILTINS объявлен ВНУТРИ R7Executor — плагин сериализует только
//   тело этой функции (Function.toString), наружные переменные в контексте
//   документа недоступны. Имя команды распознаётся без учёта регистра;
//   произвольный код по-прежнему исполняется как есть (тонкий исполнитель
//   сохранён). Три попутных исправления под читающие команды:
//   (1) код оборачивается в (function(){ ... })() — на верхнем уровне eval
//   оператор return запрещён (SyntaxError "Illegal return statement"), раньше
//   любая команда с return не исполнялась вовсе;
//   (2) info для объектов сериализуется в json — вместо "[object Object]"
//   теперь видно содержимое;
//   (3) в успешный ответ добавлено поле value — «сырой» результат команды
//   для обратного канала (хранилище результатов моста, GET /result); оно
//   включается только если значение сериализуемо, чтобы не ломать ответ.
