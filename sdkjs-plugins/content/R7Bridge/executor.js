// Версия 26.48.1 (2026.11.24)

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
        // значение (GetValue), цвет заливки (GetFillColor -> color.rgb или GetRGB, плюс
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
                "   if (f && f.color && typeof f.color.rgb === 'number') {" +
                "    out.fillRGB = f.color.rgb;" +
                "    out.fillHex = '#' + ('000000' + (out.fillRGB & 0xFFFFFF).toString(16).toUpperCase()).slice(-6);" +
                "   } else if (f && typeof f.GetRGB === 'function') {" +
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


    // ---------- автокопилка: разбор команды на методы ----------
    // stripStrings: делает копию кода для СКАНИРОВАНИЯ — вырезает содержимое
    // строковых литералов ('...', "...", `...`), однострочных и блочных
    // комментариев, чтобы методы в тексте-литерале не считались вызовами.
    // Переводы строк сохраняются — границы стейтментов не ломаются.
    // Данные берёт из аргумента src, отдаёт очищенную строку той же длины.
    function stripStrings(src) {
        var out = [];
        var i = 0;
        var n = src.length;
        var state = 0; // 0 — код; 1 '...' ; 2 "..." ; 3 `...`; 4 // ; 5 /* */
        while (i < n) {
            var c = src.charAt(i);
            var c2 = (i + 1 < n) ? src.charAt(i + 1) : "";
            if (state === 0) {
                if (c === "'") { state = 1; out.push("''"); i++; continue; }
                if (c === '"') { state = 2; out.push('""'); i++; continue; }
                if (c === "`") { state = 3; out.push("``"); i++; continue; }
                if (c === "/" && c2 === "/") { state = 4; i += 2; out.push("  "); continue; }
                if (c === "/" && c2 === "*") { state = 5; i += 2; out.push("  "); continue; }
                out.push(c); i++; continue;
            }
            if (state === 1 || state === 2 || state === 3) {
                var q = (state === 1) ? "'" : (state === 2 ? '"' : "`");
                if (c === "\\") { out.push("  "); i += 2; continue; }
                if (c === q) { state = 0; }
                out.push(c === "\n" ? "\n" : " "); i++; continue;
            }
            if (state === 4) {
                if (c === "\n") { state = 0; out.push("\n"); } else { out.push(" "); }
                i++; continue;
            }
            // state === 5 (блочный комментарий)
            if (c === "*" && c2 === "/") { state = 0; out.push("  "); i += 2; continue; }
            out.push(c === "\n" ? "\n" : " "); i++; continue;
        }
        return out.join("");
    }

    // extractMethods: статически разбирает КОД КОМАНДЫ (после вырезания строк
    // и комментариев) и выделяет вызовы методов с привязкой к классу объекта.
    // Механика (эвристика, без запуска кода):
    //   1) карта переменных: если вызов — ПОСЛЕДНИЙ в стейтменте вида
    //      `var X = ...`, X привязывается к классу ВОЗВРАТА вызова
    //      (GetRange -> ApiRange, GetContent -> ApiDocumentContent и т. д.);
    //   2) для каждого вызова `.Метод(...)` класс определяется так:
    //      приёмник-идентификатор из карты переменных -> его класс; иначе
    //      последний производитель в текущем стейтменте (Api., GetRange(...),
    //      GetActiveSheet(), AddShape(...) и т. п.); иначе Unknown.
    //      Встроенные функции JS и хелперы Алисы отфильтрованы.
    // Отдаёт массив уникальных строк "Класс.Метод" (до 50 на команду); список
    // попадает в ответ исполнителя (поле methods), мост ведёт по нему
    // библиотеку r7_api (заготовки в папку New).
    function extractMethods(src) {
        var scan = stripStrings(String(src || ""));
        var PRODUCERS = {
            "GetActiveSheet": "ApiWorksheet", "GetSheet": "ApiWorksheet", "GetSheets": "ApiWorksheet",
            "AddSheet": "ApiWorksheet", "GetAutoFilter": "ApiWorksheet",
            "GetRange": "ApiRange", "GetRangeByNumber": "ApiRange", "GetUsedRange": "ApiRange",
            "GetCells": "ApiRange", "GetCols": "ApiRange", "GetRows": "ApiRange",
            "GetSelection": "ApiRange", "GetActiveCell": "ApiRange",
            "GetEntireColumn": "ApiRange", "GetEntireRow": "ApiRange", "GetCurrentRegion": "ApiRange",
            "GetAreas": "ApiRange", "GetItem": "ApiRange", "GetOffset": "ApiRange",
            "GetComment": "ApiComment", "GetCharacters": "ApiCharacters", "GetFont": "ApiFont",
            "GetContent": "ApiDocumentContent", "GetDocContent": "ApiDocumentContent",
            "GetElement": "ApiParagraph", "GetParaPr": "ApiParaPr", "GetLastRunWithText": "ApiRun",
            "GetDefName": "ApiName", "GetRefersToRange": "ApiName",
            "GetAllShapes": "ApiShape", "GetAllCharts": "ApiChart", "GetAllImages": "ApiImage",
            "GetAllOleObjects": "ApiOleObject", "GetAllDrawings": "ApiDrawing",
            "AddChart": "ApiChart", "AddShape": "ApiShape", "AddImage": "ApiImage",
            "AddOleObject": "ApiOleObject", "AddWordArt": "ApiDrawing",
            "CreateRun": "ApiRun", "CreateParagraph": "ApiParagraph", "CreateTextPr": "ApiTextPr",
            "CreateNoFill": "ApiFill", "CreateSolidFill": "ApiFill", "CreateLinearGradientFill": "ApiFill",
            "CreateRadialGradientFill": "ApiFill", "CreatePatternFill": "ApiFill", "CreateBlipFill": "ApiFill",
            "CreateStroke": "ApiStroke", "CreateRGBColor": "ApiRGBColor", "CreateColorFromRGB": "ApiColor",
            "CreateColorByName": "ApiColor", "CreatePresetColor": "ApiPresetColor",
            "CreateSchemeColor": "ApiSchemeColor", "CreateBullet": "ApiBullet", "CreateNumbering": "ApiBullet"
        };
        var RETURNS = {
            "GetActiveSheet": "ApiWorksheet", "GetSheet": "ApiWorksheet", "AddSheet": "ApiWorksheet",
            "GetSheets": "#ARR:ApiWorksheet",
            "GetRange": "ApiRange", "GetRangeByNumber": "ApiRange", "GetUsedRange": "ApiRange",
            "GetCells": "ApiRange", "GetCols": "ApiRange", "GetRows": "ApiRange",
            "GetSelection": "ApiRange", "GetActiveCell": "ApiRange",
            "GetEntireColumn": "ApiRange", "GetEntireRow": "ApiRange", "GetCurrentRegion": "ApiRange",
            "GetAreas": "ApiRange", "GetItem": "ApiRange", "GetOffset": "ApiRange",
            "GetRefersToRange": "ApiRange",
            "GetComment": "ApiComment", "GetCharacters": "ApiCharacters", "GetFont": "ApiFont",
            "GetContent": "ApiDocumentContent", "GetDocContent": "ApiDocumentContent",
            "GetElement": "ApiParagraph", "GetParaPr": "ApiParaPr", "GetLastRunWithText": "ApiRun",
            "GetDefName": "ApiName",
            "GetAllShapes": "#ARR:ApiShape", "GetAllCharts": "#ARR:ApiChart",
            "GetAllImages": "#ARR:ApiImage", "GetAllOleObjects": "#ARR:ApiOleObject",
            "GetAllDrawings": "#ARR:ApiDrawing",
            "AddChart": "ApiChart", "AddShape": "ApiShape", "AddImage": "ApiImage",
            "AddOleObject": "ApiOleObject", "AddWordArt": "ApiDrawing",
            "CreateRun": "ApiRun", "CreateParagraph": "ApiParagraph", "CreateTextPr": "ApiTextPr",
            "CreateNoFill": "ApiFill", "CreateSolidFill": "ApiFill", "CreateLinearGradientFill": "ApiFill",
            "CreateRadialGradientFill": "ApiFill", "CreatePatternFill": "ApiFill", "CreateBlipFill": "ApiFill",
            "CreateStroke": "ApiStroke", "CreateRGBColor": "ApiRGBColor", "CreateColorFromRGB": "ApiColor",
            "CreateColorByName": "ApiColor", "CreatePresetColor": "ApiPresetColor",
            "CreateSchemeColor": "ApiSchemeColor", "CreateBullet": "ApiBullet", "CreateNumbering": "ApiBullet"
        };
        var SKIP = { push: 1, join: 1, indexOf: 1, slice: 1, substring: 1, substr: 1, toString: 1, trim: 1,
            replace: 1, split: 1, toUpperCase: 1, toLowerCase: 1, charAt: 1, charCodeAt: 1, sort: 1,
            map: 1, filter: 1, reduce: 1, forEach: 1, includes: 1, find: 1, findIndex: 1, keys: 1,
            values: 1, entries: 1, has: 1, get: 1, set: 1, parse: 1, stringify: 1, concat: 1, shift: 1,
            pop: 1, splice: 1, reverse: 1, every: 1, some: 1, match: 1, test: 1, exec: 1, call: 1,
            apply: 1, bind: 1, floor: 1, round: 1, abs: 1, min: 1, max: 1, pow: 1, sqrt: 1, random: 1,
            now: 1, padStart: 1, padEnd: 1, repeat: 1, length: 1, log: 1, error: 1, warn: 1 };
        var out = [];
        var seen = {};
        var varMap = {};
        var re = /([A-Za-z_$][A-Za-z0-9_$]*)?\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
        var m;
        while ((m = re.exec(scan)) !== null) {
            var recv = m[1] || "";
            var name = m[2];
            if (SKIP[name]) continue;
            var before = scan.slice(Math.max(0, m.index - 600), m.index);
            var cut = Math.max(before.lastIndexOf(";"), before.lastIndexOf("\n"),
                               before.lastIndexOf("}"), before.lastIndexOf("{"));
            var stmt = (cut >= 0) ? before.slice(cut + 1) : before;
            var cls;
            if (recv === "Api") {
                cls = "Api";
            } else if (recv && varMap[recv]) {
                cls = varMap[recv];
            } else {
                cls = "Unknown";
                var best = -1;
                var bestCls = null;
                for (var prod in PRODUCERS) {
                    var idx = stmt.lastIndexOf(prod);
                    if (idx > best) { best = idx; bestCls = PRODUCERS[prod]; }
                }
                if (best >= 0) cls = bestCls;
            }
            var key = cls + "." + name;
            if (!seen[key]) { seen[key] = 1; out.push(key); }
            if (out.length >= 50) break;
            // привязка переменных: если этот вызов — ПОСЛЕДНИЙ в стейтменте вида
            // `var X = ...` / `X = ...`, то X получает класс ВОЗВРАТА вызова
            var fwdFrom = m.index + m[0].length;
            var fwd = scan.slice(m.index);
            var semi = fwd.indexOf(";", 1);
            var nl = fwd.indexOf("\n", 1);
            var stmtEnd = Math.min(semi === -1 ? fwd.length : semi,
                                   nl === -1 ? fwd.length : nl);
            var tail = scan.slice(fwdFrom, m.index + stmtEnd);
            var nextCall = /[.]([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(tail);
            if (!nextCall) {
                var ret = RETURNS[name];
                if (ret) {
                    var vm = /var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/.exec(stmt);
                    var am = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/.exec(stmt);
                    var varName = vm ? vm[1] : (am ? am[1] : null);
                    if (varName && varName !== "function" && varName !== "return") {
                        varMap[varName] = (ret.indexOf("#ARR:") === 0) ? ret.slice(5) : ret;
                    }
                }
            }
        }
        return out;
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
        // автокопилка: список методов, встреченных в коде команды, идёт в мост —
        // мост ведёт библиотеку r7_api (методы без файла — заготовки в папку New)
        response.methods = extractMethods(code);
        return response;
    } catch (e) {
        // Текст ошибки формирует сам документ — передаём как есть,
        // но с максимумом деталей (имя, сообщение, стек)
        return { ok: false, error: describeError(e) };
    }
}

// v26.48.1 (2026.11.24): МЕХАНИЗМ АВТОКОПИЛКИ (по заданию пользователя).
//   Версия переведена на схему X.Y.Z (год-неделя): 26.48.1 заменяет 1.1.3.
//   После успешного исполнения команды R7Executor разбирает код команды
//   (extractMethods) и выделяет методы с привязкой к классу объекта:
//   (0) перед разбором код очищается от строк и комментариев (stripStrings) —
//   методы внутри строк-литералов не считаются вызовами;
//   (1) карта переменных: если вызов — последний в стейтменте `var X = ...`,
//   X привязывается к классу возврата (GetRange -> ApiRange, GetContent ->
//   ApiDocumentContent и т. д.); (2) для каждого вызова `.Метод(...)` класс
//   берётся из приёмника-переменной, иначе — последний производитель в
//   текущем стейтменте (Api., GetRange(...), GetActiveSheet(), AddShape(...)
//   и т. п.), иначе Unknown. Встроенные функции JS (push, join, charAt,
//   stringify и пр.) и хелперы Алисы отфильтрованы. Список уникальных строк
//   "Класс.Метод" (до 50 на команду) попадает в ответ полем methods; мост
//   по нему ведёт библиотеку r7_api: метод без файла в Tested/NotWork/New
//   получает заготовку в New со статусом "не тестировалось" (bridge v26.48.1).
//   Прочая логика исполнителя (обёртка (function(){...})(), BUILTINS,
//   value/info, describeError) сохранена без изменений.
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
// v1.1.3 (2026.11.24): уточнено извлечение цвета заливки в get_object_status.
//   Проба fill-probe-002 (24.11) показала реальную структуру цвета в Р7:
//   GetFillColor() возвращает объект { color: { rgb: 45136, _hash: 45136 } }
//   (45136 = 0x00B050 = RGB(0,176,80)), метода GetRGB у объекта нет. Теперь
//   fillRGB/fillHex берутся из f.color.rgb; если у объекта цвета вдруг есть
//   метод GetRGB — используется он; прочие случаи — как раньше (null → "нет
//   заливки", прочее → String). Проверка структуры выполнена на живом
//   документе через обратный канал /result.
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
