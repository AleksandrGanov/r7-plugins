// Версия 26.48.16 от 24.11.2026
// Название файла при выдаче в чат code.js

(function (window, undefined) {
    var PLUGIN_VERSION = "26.48.16";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";
    var BTN_GAP = "6px"; // три промежутка между четырьмя кнопками
    var BTN_H   = "20px"; // единая высота всех кнопок (ON/OFF/TEST/CLEAR и Save) И поля
                          // интервала: Save равен полю с цифрами, остальные — Save (v26.48.8)
    var EXEC_TIMEOUT_MS = 10000; // сколько ждём callback от документа

    // минимальное время между командами, сек: по умолчанию 5.
    // Команда, пришедшая раньше этого интервала после предыдущей ПРИНЯТОЙ,
    // игнорируется с пометкой в логе. Источники значения при загрузке:
    // 1) файл настроек моста (GET /settings — мост пишет R7Bridge.json на диск),
    // 2) localStorage (запасной вариант, пока мост недоступен),
    // 3) дефолт GAP_DEFAULT_SEC.
    var GAP_DEFAULT_SEC = 5;
    var GAP_STORE_KEY = "r7bridgeMinGap";
    var minGapSec = GAP_DEFAULT_SEC;

    // время последней ПРИНЯТОЙ команды (мс epoch). Игнорируемые команды
    // отсчёт НЕ сбрасывают. 0 — команда ещё не приходила.
    var lastCmdTime = 0;

    // имя документа этого экземпляра плагина (v26.48.13): сохраняется при
    // hello (getDocName) и обновляется сервисной командой get_doc_name.
    // Уходит в мост с каждым сообщением type:"result" (поле doc) — по нему
    // мост сопоставляет ответ с конкретным документом.
    var currentDocName = "";

    // цвет ШРИФТА строк лога: входящее / исходящее / системное / ошибочное
    var LOG_COLOR_IN  = "#3f9b3f"; // светло-зелёный
    var LOG_COLOR_OUT = "#e05c5c"; // светло-красный
    var LOG_COLOR_SYS = "#909090"; // светло-серый
    var LOG_COLOR_WARN = "#FFE597"; // светло-жёлтый — ошибочные системные строки (v26.48.10)

    // фон строки статуса по состоянию
    var ST_BG_OK  = "#e3f4e3"; // зелёная подсветка — "подключен"
    var ST_BG_OFF = "#f0f0f0"; // светло-серая подсветка — "отключен"
    var ST_BG_ERR = "#fdeaea"; // светло-красная подсветка — "ошибка подключения"

    // режим вывода json в лог: галочка "выводить json в строку"
    var FLATTEN_DEFAULT = true;          // по умолчанию галочка установлена
    var flattenMode = FLATTEN_DEFAULT;   // текущее состояние галочки

    // режим скрытия системных сообщений: галочка "скрывать системные сообщения"
    var HIDE_SYS_DEFAULT = true;         // по умолчанию галочка установлена
    var hideSysMode = HIDE_SYS_DEFAULT;  // текущее состояние галочки

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    // таймстемп для строк лога: локальное время ЧЧ:ММ:СС (две цифры на разряд)
    function ts() {
        var d = new Date();
        function p(n) { return (n < 10 ? "0" : "") + n; }
        return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    // безопасная сериализация значения в строку для лога:
    // JSON.stringify падает на циклических ссылках — тогда просто String().
    function safeJson(v) {
        try { return JSON.stringify(v); } catch (e) { return String(v); }
    }

    // разворачивает json в одну строку: {"a":1,"b":{"c":2}} -> "a: 1, b: c: 2".
    // Не-json (например, "R7Bridge v1.2.8 connected") возвращается как есть.
    function flattenValue(v) {
        if (typeof v === "string" && v !== "") {
            try {
                var inner = JSON.parse(v);
                if (inner !== null && typeof inner === "object") return flattenValue(inner);
            } catch (e) { /* обычная строка */ }
            return v;
        }
        if (v === null || typeof v !== "object") return String(v);
        if (Array.isArray(v)) return v.map(flattenValue).join(", ");
        var parts = [];
        for (var k in v) {
            if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
            parts.push(k + ": " + flattenValue(v[k]));
        }
        return parts.join(", ");
    }
    function flattenJson(text) {
        var v;
        try { v = JSON.parse(text); } catch (e) { return text; }
        if (v === null || typeof v !== "object") return text;
        return flattenValue(v);
    }
    function fmtJson(s) { return flattenMode ? flattenJson(s) : s; }

    // стиль для скрытия системных строк: класс на контейнере лога,
    // сами строки остаются в DOM — снял галочку, всё вернулось на место
    function ensureHideSysStyle() {
        if (document.getElementById("hideSysStyle")) return;
        var st = document.createElement("style");
        st.id = "hideSysStyle";
        // ошибочные системные строки (sys-err) НЕ скрываются никогда:
        // "не смог подключиться", "пропала связь", "команда не распознана" —
        // о них надо знать даже при включённой галочке
        st.textContent = "#log.log-hide-sys .sys-line:not(.sys-err) { display: none; }";
        (document.head || document.body).appendChild(st);
    }

    // гарантированная видимость окна лога и строки статуса: стиль с !important
    // добавляется в head ПОСЛЕ стилей index.html, поэтому перекрывает их скрытие;
    // заодно принудительно выравнивает панель кнопок и ряд по левому краю
    function ensureVisibleStyle() {
        if (document.getElementById("logVisibleStyle")) return;
        var st = document.createElement("style");
        st.id = "logVisibleStyle";
        st.textContent =
            "#log, #status { display: block !important; visibility: visible !important; opacity: 1 !important; } " +
            "#buttons, #btnRow { margin-left: 0 !important; text-align: left !important; align-self: flex-start !important; } " +
            "body { text-align: left !important; }";
        (document.head || document.body).appendChild(st);
    }

    // лог занимает всё свободное место окна (с учётом кнопок, статуса и чекбоксов)
    function styleLog() {
        var el = document.getElementById("log");
        ensureVisibleStyle();
        if (!el) return;
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.style.overflowY  = "auto";
        el.style.boxSizing  = "border-box";
        // внешний вид окна: тёмный фон раньше задавал CSS index.html,
        // теперь вид окна полностью определяется здесь (index.html упрощён)
        el.style.background = "#1e1e1e"; // тёмный фон окна лога
        el.style.color      = "#cde";    // базовый цвет шрифта
        // шрифт лога = шрифту строки статуса (v26.48.15, по запросу пользователя):
        // раньше не задавался явно и наследовался из index.html — был крупнее
        el.style.fontSize   = "11px";
        el.style.padding    = "8px";
        el.style.borderRadius = "6px";
        // видимость: упрощённый index.html держит #log скрытым на время загрузки,
        // без этой строки окно есть в DOM, но на экране не появляется
        el.style.setProperty("display", "block", "important"); // !important: перекрывает скрытие из index.html
        el.style.height     = "calc(100vh - 134px)"; // высота не менялась: кнопки стали ниже (~3px), но строка Save стала выше на столько же — баланс сохранён
        el.style.margin     = "2px 0 0 0";
    }

    // каждая строка лога — отдельный блок, цвет задаётся ШРИФТУ, фон не трогаем.
    // Вместо префикса "--" — таймстемп локального времени ЧЧ:ММ:СС.
    // kind: "in" (зелёный), "out" (красный), "sys" (серый, системное),
    // "syserr" (серый, системное-ошибка — НЕ скрывается галочкой),
    // "systest" (серый, строки кнопки TEST — НЕ скрывается галочкой, v26.48.11).
    // Системные строки получают класс sys-line — при включённой галочке
    // "скрывать системные сообщения" они скрываются классом на контейнере лога.
    // Строки-ошибки получают класс sys-line sys-err — не скрываются никогда,
    // цвет шрифта — светло-жёлтый LOG_COLOR_WARN (#FFE597, v26.48.10):
    // ошибка видна сразу и отличима от серых системных строк.
    function log(msg, kind) {
        var el = document.getElementById("log");
        if (!el) { try { console.log("-- " + msg); } catch (e) {} return; }
        styleLog();
        ensureHideSysStyle();
        var line = document.createElement("div");
        line.textContent = ts() + " " + msg;
        if (msg.indexOf("\n") !== -1) line.style.whiteSpace = "pre-line";
        line.style.margin  = "0";
        line.style.padding = "0";
        line.style.color = kind === "in"     ? LOG_COLOR_IN :
                           kind === "out"    ? LOG_COLOR_OUT :
                           kind === "syserr" ? LOG_COLOR_WARN : LOG_COLOR_SYS;
        if (kind === "sys") line.className = "sys-line";
        else if (kind === "syserr") line.className = "sys-line sys-err";
        el.appendChild(line);
        if (hideSysMode) el.classList.add("log-hide-sys");
        el.scrollTop = el.scrollHeight;
    }

    function clearLog() {
        var el = document.getElementById("log");
        if (el) el.innerHTML = "";
        log("лог очищен");
    }

    // компактная строка статуса — высота по шрифту, отступы сжаты
    function setStatus(text, kind) {
        var el = document.getElementById("status");
        if (!el) return;
        // по просьбе пользователя (v26.48.3): версия модуля всегда видна в
        // строке статуса, перед состоянием: "Версия 26.48.3. Статус: подключен"
        el.textContent = "Версия " + PLUGIN_VERSION + ". Статус: " + text;
        el.style.fontSize   = "11px";
        el.style.lineHeight = "1.2";
        el.style.padding    = "1px 6px";
        el.style.margin     = "1px 0";
        el.style.background = kind === "ok"  ? ST_BG_OK :
                              kind === "err" ? ST_BG_ERR : ST_BG_OFF;
    }

    // человекочитаемый статус + версия реально загруженного модуля
    function fmtStatus(data) {
        var parts = [];
        if (data && typeof data.version !== "undefined") parts.push("version: " + data.version);
        parts.push("online: " + (data && data.online ? "true" : "false"));
        var cl = (data && data.clients) ? data.clients : [];
        var clStr = cl.map(function (c) { return String(c).replace(/,\s+/g, "-"); }).join("-");
        parts.push("clients: " + (clStr || "нет"));
        parts.push("версия модуля: " + PLUGIN_VERSION);
        return parts.join(", ");
    }

    // обработчик кнопки TEST. Строки лога помечены видом "systest": цвет тот же
    // серый, но класс sys-line такой строке НЕ назначается, поэтому скрытие через
    // контейнерный класс log-hide-sys на неё не действует — галочка «скрывать
    // системные сообщения» в любом положении эти строки показывает (v26.48.11).
    function checkStatus() {
        log("Info: опрашиваю мост...", "systest");
        fetch(BRIDGE_HTTP + "/status", {
            headers: { "X-Proxy-Token-R7": TOKEN },
            cache: "no-store"
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
            setStatus(data && data.online ? "подключен" : "отключен",
                      data && data.online ? "ok" : "off");
            log("status ok, " + fmtStatus(data) + ".", "systest");
        })
        .catch(function (e) {
            setStatus("ошибка подключения", "err");
            log("status fail: " + e.message, "syserr");
        });
    }

    // единая точка отправки — каждое исходящее сообщение видно в логе.
    // kind: тип строки лога ("out" — красная, "sys" — серая системная).
    function sendWS(ws, obj, kind) {
        var s = JSON.stringify(obj);
        log("исходящее: " + fmtJson(s), kind || "out");
        ws.send(s);
    }

    // имя документа: основной способ — Api.GetFullName() внутри редактора через callCommand,
    // запасной — window.docEditor.getDocumentName() (свой и родительского окна).
    // callCommand: (func, isClose, isCalc, callback) — callback получает результат func.
    function getDocName(cb) {
        var done = false;
        var finish = function (name) {
            if (done) return;
            done = true;
            currentDocName = String(name || "").trim();
            cb(currentDocName);
        };
        var fallback = function () {
            var n = "", de = null;
            try {
                if (window.docEditor && window.docEditor.getDocumentName) de = window.docEditor;
                else if (window.parent && window.parent.docEditor &&
                         window.parent.docEditor.getDocumentName) de = window.parent.docEditor;
                if (de) n = de.getDocumentName();
            } catch (e) {}
            finish(n);
        };
        try {
            if (window.Asc && window.Asc.plugin && window.Asc.plugin.callCommand) {
                window.Asc.plugin.callCommand(new Function(
                    "try { return Api.GetFullName() || \"\"; } catch (e) { return \"\"; }"
                ), false, true, function (res) { // isCalculate=true: только так callback получает результат
                    if (res) finish(res); else fallback();
                });
            } else {
                fallback();
            }
        } catch (e) {
            fallback();
        }
        setTimeout(fallback, 2000);
    }

    function connect() {
        var old = window.__r7bridge_ws;
        if (old) {
            try { old.onclose = null; old.close(); } catch (e) {}
            window.__r7bridge_ws = null;
            setStatus("отключен", "off");
        }
        log("WS: подключаюсь к " + BRIDGE_WS, "sys");
        var ws;
        try { ws = new WebSocket(BRIDGE_WS + "?token=" + TOKEN); }
        catch (e) {
            log("WS: ошибка создания сокета: " + e.message, "syserr");
            setStatus("ошибка подключения", "err");
            return;
        }

        ws.onopen = function () {
            log("WS: открыт", "sys");
            setStatus("подключен", "ok");
            getDocName(function (docName) {
                if (ws.readyState !== WebSocket.OPEN) {
                    log("имя документа: " + (docName || "нет") +
                        ", но сокет уже закрыт — приветствие не отправлено", "sys");
                    return;
                }
                if (docName) log("имя документа: " + docName, "sys");
                else log("имя документа получить не удалось, docName будет пустым", "sys");
                sendWS(ws, {
                    type: "hello",
                    client: "R7Bridge",
                    version: PLUGIN_VERSION,
                    docName: docName,
                    flatten: flattenMode,
                    userAgent: navigator.userAgent
                }, "sys");
            });
        };
        ws.onclose = function (e) {
            log("WS: закрыт, код " + e.code, "syserr");
            setStatus("отключен", "off");
        };
        ws.onerror = function () {
            log("WS: ошибка соединения", "syserr");
            setStatus("ошибка подключения", "err");
        };
        // входящие классифицируются: обычный текст (например, "R7Bridge v1.2.13
        // connected") — серая системная "sys"; json-команда документу — зелёная
        // "in"; СЕРВИСНОЕ сообщение (адресат "Плагин") — серая системная "sys":
        // полностью скрывается галочкой "скрывать системные сообщения" (v26.48.4).
        ws.onmessage = function (ev) {
            var kind = "sys";
            try {
                var t = JSON.parse(ev.data);
                if (t !== null && typeof t === "object" && !isServiceMessage(t)) kind = "in";
            } catch (e) { /* обычный текст — системное сообщение */ }
            // v26.48.16: для команд документу (R7-Office) вместо полной обёртки
            // { url, method, body } в лог выводится только суть — цепочки вызовов
            // методов API, каждая с новой строки. Техническая информация не
            // теряется: она остаётся в суточных логах моста. Если вызовы найти
            // не удалось — выводится прежняя полная запись.
            var shown = "входящее: " + fmtJson(ev.data);
            if (kind === "in") {
                var ess = essenceFromMessage(ev.data);
                if (ess.length > 0) shown = ess.join("\n");
            }
            log(shown, kind);
            routeMessage(ev.data);
        };
        window.__r7bridge_ws = ws;
    }

    // отключение от моста по кнопке OFF
    function disconnect() {
        var ws = window.__r7bridge_ws;
        if (ws) {
            try { ws.onclose = null; } catch (e) {}
            try { ws.close(); } catch (e) {}
            window.__r7bridge_ws = null;
        }
        log("WS: отключаюсь от " + BRIDGE_WS, "sys");
        setStatus("отключен", "off");
    }

    // нормализация маркера адресата: trim + lowercase. Протокол полностью
    // на английском (v26.48.9): кириллица в запросах не участвует.
    // Эталоны: "r7-office" (команды документу) и "plugin" (сервисные команды).
    // Пример: "R7-Office" → "r7-office".
    function normMarker(s) {
        return String(s).trim().toLowerCase();
    }

    // isServiceMessage: определяет, сервисное ли это сообщение (адресат
    // "Plugin", латиница с v26.48.9) — такие сообщения обрабатывает сам
    // плагин, документ не
    // затрагивается, а в логе они системные (скрываются галочкой).
    // Данные берёт из распарсенного объекта t (или строки); при необходимости
    // распаковывает обёртку моста {url, method, body} — так же, как это делает
    // routeMessage. Отдаёт true/false.
    // ── v26.48.16: «суть» входящей команды в логе ──────────────────────────
    // Мост доставляет команду в обёртке { url, method, body }, и раньше в
    // чёрное окно лога падала она целиком (url, requestId, doc и весь код
    // одной строкой). Теперь для команд адресату R7-Office в лог выводится
    // ТОЛЬКО суть — цепочки вызовов методов API, каждая с новой строки.
    // Техническая информация не теряется: мост пишет её в свои суточные
    // логи (brLogPath). Логика команд, ответов и передачи не менялась.

    // unwrapIncoming(data): распаковывает обёртку моста и возвращает команду
    // адресату R7-Office (или null — это не команда документу)
    function unwrapIncoming(data) {
        var msg;
        try { msg = JSON.parse(data); } catch (e) { return null; }
        if (msg && msg.body) {
            if (typeof msg.body === "string") {
                try { msg = JSON.parse(msg.body); } catch (e2) { return null; }
            } else if (typeof msg.body === "object" && msg.body !== null) {
                msg = msg.body;
            }
        }
        return (msg && msg.target && normMarker(msg.target) === "r7-office" &&
                typeof msg.code === "string") ? msg : null;
    }

    // extractCalls(code): собирает из кода цепочки вызовов методов вида
    // Api.GetActiveSheet().GetRange('A1').SetValue('текст') — с корректным
    // балансом скобок (вложенные вызовы внутри аргументов сохраняются) и
    // пропуском строковых литералов и комментариев. Отбираются только цепочки,
    // где корень И каждый метод начинаются с заглавной буквы (стиль Р7 API) —
    // локальные вспомогательные (r.push, T(...), e.stack) в суть не попадают.
    // Возвращает массив строк в порядке появления в коде.
    function extractCalls(code) {
        var src = String(code || "");
        var out = [];
        var i = 0, n = src.length;
        function isIdChar(c) {
            return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") ||
                   (c >= "0" && c <= "9") || c === "_" || c === "$";
        }
        // пропустить строковый литерал, вернуть позицию после закрывающей кавычки
        function skipString(pos) {
            var q = src[pos];
            pos++;
            while (pos < n) {
                if (src[pos] === "\\") { pos += 2; continue; }
                if (src[pos] === q) { return pos + 1; }
                pos++;
            }
            return pos;
        }
        // прочитать сбалансированную группу скобок начиная с "(";
        // вернёт позицию после закрывающей скобки или -1 при сбое
        function skipGroup(pos) {
            var depth = 0;
            while (pos < n) {
                var ch = src[pos];
                if (ch === "'" || ch === '"' || ch === "`") { pos = skipString(pos); continue; }
                if (ch === "/" && src[pos + 1] === "/") {
                    while (pos < n && src[pos] !== "\n") pos++;
                    continue;
                }
                if (ch === "/" && src[pos + 1] === "*") {
                    pos += 2;
                    while (pos + 1 < n && !(src[pos] === "*" && src[pos + 1] === "/")) pos++;
                    pos += 2;
                    continue;
                }
                if (ch === "(") depth++;
                else if (ch === ")") {
                    depth--;
                    if (depth === 0) return pos + 1;
                }
                pos++;
            }
            return -1;
        }
        function isWs(ch) { return ch === " " || ch === "\n" || ch === "\t" || ch === "\r"; }
        function skipWs(pos) { while (pos < n && isWs(src[pos])) pos++; return pos; }
        while (i < n) {
            var c = src[i];
            if (c === "'" || c === '"' || c === "`") { i = skipString(i); continue; }
            if (c === "/" && src[i + 1] === "/") {
                while (i < n && src[i] !== "\n") i++;
                continue;
            }
            if (c === "/" && src[i + 1] === "*") {
                i += 2;
                while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
                i += 2;
                continue;
            }
            // имя идентификатора (не начинается с цифры)
            if (isIdChar(c) && !(c >= "0" && c <= "9")) {
                var j = i;
                while (j < n && isIdChar(src[j])) j++;
                var word = src.slice(i, j);
                // цепочки собираем только от корня с заглавной буквы (Api.*)
                if (word[0] >= "A" && word[0] <= "Z") {
                    var k = skipWs(j);
                    if (src[k] === ".") {
                        var ok = true, pos = k;
                        while (true) {
                            if (src[pos] !== ".") { ok = false; break; }
                            pos++;
                            var m0 = pos;
                            while (pos < n && isIdChar(src[pos])) pos++;
                            if (pos === m0) { ok = false; break; }
                            var mname = src.slice(m0, pos);
                            // методы Р7 API — с заглавной (GetRange, SetValue…)
                            if (!(mname[0] >= "A" && mname[0] <= "Z")) { ok = false; break; }
                            var p3 = skipWs(pos);
                            if (src[p3] !== "(") { ok = false; break; }
                            var e3 = skipGroup(p3);
                            if (e3 < 0) { ok = false; break; }
                            pos = e3;
                            var p4 = skipWs(pos);
                            if (src[p4] === ".") { pos = p4; continue; }
                            break;
                        }
                        if (ok) {
                            out.push(src.slice(i, pos));
                            i = pos;
                            continue;
                        }
                    }
                }
                i = j;
                continue;
            }
            i++;
        }
        return out;
    }

    // essenceFromMessage(data): список строк-вызовов для лога; пустой массив,
    // если сообщение не команда документу или вызовы не найдены
    function essenceFromMessage(data) {
        var msg = unwrapIncoming(data);
        if (!msg) return [];
        return extractCalls(msg.code);
    }

    function isServiceMessage(t) {
        var msg = t;
        if (typeof msg === "string") {
            try { msg = JSON.parse(msg); } catch (e) { return false; }
        }
        if (msg && msg.body) {
            if (typeof msg.body === "string") {
                try { msg = JSON.parse(msg.body); } catch (e2) { /* не-json body */ }
            } else if (typeof msg.body === "object" && msg.body !== null) {
                msg = msg.body;
            }
        }
        return !!(msg && msg.target && normMarker(msg.target) === "plugin");
    }

    // разбор входящих сообщений. Мост доставляет команду в обёртке:
    // { url: "/send", method: "POST", body: "{...}" } — команда лежит
    // ВНУТРИ поля body строкой, поэтому перед разбором body распаковывается
    // (строка парсится, готовый объект берётся как есть).
    // Скорость приёма: команда, пришедшая РАНЬШЕ, чем прошло minGapSec секунд
    // с предыдущей ПРИНЯТОЙ команды, игнорируется — не исполняется вовсе,
    // в лог выводится с пометкой "(проигнорировано: не прошло минимальное время)".
    // Игнорируемая команда отсчёт интервала НЕ сбрасывает.
    function routeMessage(data) {
        var msg;
        try { msg = JSON.parse(data); } catch (e) { return; }
        if (msg && msg.body) {
            if (typeof msg.body === "string") {
                try { msg = JSON.parse(msg.body); } catch (e2) { /* не-json body — оставляем как есть */ }
            } else if (typeof msg.body === "object" && msg.body !== null) {
                msg = msg.body;
            }
        }
        // СЕРВИСНЫЕ команды: адресат "Plugin" (латиница, v26.48.9). Обрабатываются
        // самим плагином (документ не затрагивается), минимальный интервал НЕ
        // применяется — сервисные запросы бесплатны и нужны, в том числе,
        // чтобы интервал узнать. Все логи — "sys" (скрываются галочкой).
        if (msg.target && normMarker(msg.target) === "plugin") {
            // имя сервисной команды ищем в code, при его отсутствии — в action
            // и command: страховка от опечатки в имени поля. Раньше сообщение
            // с адресатом "Plugin" без поля code падало в «команда не распознана»
            // и оставалось без ответа — запрашивающая сторона ждала результат,
            // которого не будет (лог 03:22 24.11, v26.48.12).
            var svcName = (typeof msg.code === "string" && msg.code) ||
                          (typeof msg.action === "string" && msg.action) ||
                          (typeof msg.command === "string" && msg.command) || "";
            if (svcName) {
                log("сервисная команда: " + svcName + " (requestId: " + (msg.requestId || "нет") + ")", "sys");
                handleServiceCommand(svcName, msg.requestId);
                return;
            }
            // адресат сервисный, а имени команды нет: в лог (syserr) пишется всё
            // тело, при наличии requestId в обратный канал уходит ошибка — тишины нет
            log("сервисное сообщение без имени команды, тело: " +
                fmtJson(safeJson(msg)).slice(0, 300), "syserr");
            if (msg.requestId) {
                sendResult("plugin", false, msg.requestId,
                           { ok: false, error: "сервисное сообщение без имени команды (ожидалось поле code)" });
            }
            return;
        }
        // ретранслятор: плагин не разбирает команду и не проверяет её корректность.
        // Единственное, что он умеет — увидеть маркер адресата (нормализованный
        // normMarker: lowercase, v26.48.9 — только латиница) "r7-office" и передать
        // код команды исполнителю. Корректность кода проверяет сам документ.
        if (msg.target && normMarker(msg.target) === "r7-office" &&
            typeof msg.code === "string") {
            var now = Date.now();
            var gapMs = minGapSec * 1000;
            if (now - lastCmdTime < gapMs) {
                // рано: игнорируем. Сообщение — сервисное/тестовое, оно
                // НЕ нужен в любом режиме, поэтому "sys" (серое, скрывается
                // галочкой "скрывать системные сообщения"), а не "syserr"
                // (ошибки не скрываются никогда)
                log("команда Р7-Офиса (requestId: " + (msg.requestId || "нет") +
                    ") (проигнорировано: не прошло минимальное время)", "sys");
                return;
            }
            lastCmdTime = now;
            log("команда Р7-Офиса, передача исполнителю (requestId: " +
                (msg.requestId || "нет") + ")", "sys");
            executeCode(msg.code, msg.requestId);
        } else {
            // тело сообщения в лог — сразу видно, что именно пришло (v26.48.12)
            log("команда не распознана: " + (msg.action || msg.target || "?") +
                "; тело: " + fmtJson(safeJson(msg)).slice(0, 300), "syserr");
        }
    }

    // сервисные команды плагина: обрабатываются самим плагином, документ
    // не вызывается. Данные берёт из code (имя команды) и requestId,
    // отдаёт результат через sendResult (канал type:"result" в мост, запись
    // хранится по requestId, Алиса читает через GET /result).
    // Поддерживаются:
    //   get_version — версия модуля плагина (PLUGIN_VERSION);
    //   get_min_gap — минимальное время между командами, сек (minGapSec —
    //                 именно то, каким плагин реально руководствуется,
    //                 включая запасной путь localStorage).
    // Прочие — {ok:false, error:"неизвестная сервисная команда"}.
    function handleServiceCommand(code, requestId) {
        var name = String(code).trim().split(/\s+/)[0].toLowerCase();
        if (name === "get_version") {
            sendResult("plugin", true, requestId,
                       { ok: true, info: "версия плагина: " + PLUGIN_VERSION, value: PLUGIN_VERSION });
        } else if (name === "get_min_gap") {
            sendResult("plugin", true, requestId,
                       { ok: true, info: "минимальное время между командами: " + minGapSec + " сек", value: minGapSec });
        } else if (name === "get_doc_name") {
            // v26.48.13: свежее имя документа (getDocName — callCommand,
            // Api.GetFullName). Имя запоминается в currentDocName и сразу
            // уходит в мост сообщением type:"doc" — тот обновляет
            // client.docName для /docnames и адресации POST /cmd.
            getDocName(function (fresh) {
                currentDocName = fresh;
                var ws = window.__r7bridge_ws;
                if (ws && ws.readyState === WebSocket.OPEN && fresh) {
                    sendWS(ws, { type: "doc", docName: fresh }, "sys");
                }
                sendResult("plugin", true, requestId,
                           { ok: true, info: "имя документа: " + (fresh || "нет"), value: fresh });
            });
        } else {
            sendResult("plugin", false, requestId,
                       { ok: false, error: "неизвестная сервисная команда: " + name });
        }
    }

    // исполнение кода команды в документе: готовый код передаётся строкой
    // в R7Executor внутри callCommand. R7Executor объявлен в executor.js
    // плагина — его исходник встраивается в сериализуемую функцию через
    // Function.toString, потому что callCommand исполняет код в контексте
    // документа, где функции плагина напрямую не видны. Результат исполнителя
    // ({ok, info} при успехе, {ok, error} при сбое) уходит в мост сообщением
    // type: "result". Корректность кода не проверяется — её проверяет документ.
    // Расширенное логирование в точке неудачи: перед запуском логируется сам код,
    // в callback различаются все три исхода (undefined / null / объект) с полным
    // ответом исполнителя, плюс таймаут — если callback вообще не пришёл за
    // EXEC_TIMEOUT_MS, это тоже фиксируется как сбой с текстом причины.
    function executeCode(code, requestId) {
        if (!window.Asc || !window.Asc.plugin || !window.Asc.plugin.callCommand) {
            log("ошибка: callCommand недоступен", "syserr");
            sendResult("r7command", false, requestId, { ok: false, error: "callCommand недоступен" });
            return;
        }
        if (typeof R7Executor === "undefined") {
            log("ошибка: R7Executor не загружен — executor.js не подключён к плагину", "syserr");
            sendResult("r7command", false, requestId, { ok: false, error: "R7Executor не загружен" });
            return;
        }
        try {
            // callCommand исполняет функцию БЕЗ аргументов: параметр "code" не
            // передавался, и исполнитель получал undefined (подтверждено логом
            // 01:51 24.11: «код команды не строка, получено: undefined»).
            // Поэтому код команды вшивается в тело функции строковым литералом
            // (JSON.stringify экранирует кавычки и спецсимволы).
            var fn = new Function(
                "var R7Executor = " + R7Executor.toString() + ";\n" +
                // Результат возвращается СТРОКОЙ (JSON): callCommand в Р7 надёжно
                // передаёт в callback простые значения, объекты терялись.
                "var code = " + JSON.stringify(code) + ";\n" +
                "return JSON.stringify(R7Executor(code));");
            // расширенный лог: видно, какой именно код уходит в документ
            log("исполнитель запущен, код: " + code, "sys");

            var answered = false; // флаг: ответ уже получен (или уходит по таймауту)

            // таймаут: если callCommand вообще не вызвал callback — фиксируем сбой,
            // иначе команда висела бы молча без всякого ответа
            var timer = setTimeout(function () {
                if (answered) return;
                answered = true;
                log("команда не удалась: callback не пришёл за " + (EXEC_TIMEOUT_MS / 1000) +
                    " сек — документ не вернул результат (requestId: " + (requestId || "нет") + ")", "syserr");
                sendResult("r7command", false, requestId,
                    { ok: false, error: "callback не пришёл за " + (EXEC_TIMEOUT_MS / 1000) +
                      " сек — документ не вернул результат" });
            }, EXEC_TIMEOUT_MS);

            window.Asc.plugin.callCommand(fn, false, true, function (res) { // isCalculate=true: без него callback получает undefined
                if (answered) return; // ответ уже уходит таймаутом — дубль не пишем
                answered = true;
                clearTimeout(timer);
                // Исполнитель возвращает СТРОКУ (JSON) — распаковываем её.
                // Если пришёл не-JSON — фиксируем как сбой с полным содержимым.
                var resObj = res;
                if (typeof res === "string") {
                    try { resObj = JSON.parse(res); }
                    catch (e) { resObj = { ok: false, error: "исполнитель вернул не-JSON: " + String(res).slice(0, 200) }; }
                }
                var ok = !!(resObj && resObj.ok);
                if (ok) {
                    log("исполнено: " + (resObj.info || "команда исполнена"), "sys");
                } else {
                    // расширенное логирование при неудаче: различаем все исходы.
                    // undefined/null — документ не вернул результат (частая причина:
                    // callCommand не передаёт данные обратно, а не ошибка в коде).
                    // Объект — выводим его целиком: error исполнителя с именем,
                    // сообщением и стеком видно полностью.
                    var details =
                        (resObj === undefined) ? "callback получил undefined — документ не вернул результат" :
                        (resObj === null)      ? "callback получил null — документ не вернул результат" :
                        "полный ответ исполнителя: " + safeJson(resObj);
                    log("команда не удалась: " + details +
                        " (requestId: " + (requestId || "нет") + ")", "syserr");
                }
                sendResult("r7command", ok, requestId,
                           resObj || { ok: false,
                                    error: (resObj === undefined) ? "нет ответа исполнителя (callback undefined)" :
                                           (resObj === null)      ? "нет ответа исполнителя (callback null)" :
                                           "нет ok в ответе исполнителя" });
            });
        } catch (e) {
            // ошибка при запуске исполнителя: сообщение + стек целиком
            log("ошибка запуска исполнителя: " + e.message +
                "; stack: " + (e.stack || "нет"), "syserr");
            sendResult("r7command", false, requestId,
                       { ok: false, error: "ошибка запуска исполнителя: " + e.message });
        }
    }

    // отправка результата в мост: статус исполнения команды и requestId —
    // чтобы ответ можно было сопоставить с исходной командой. Данные берёт
    // из аргументов, отдаёт сообщение type: "result" через сокет.
    function sendResult(action, ok, requestId, result) {
        var ws = window.__r7bridge_ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWS(ws, { type: "result", action: action, ok: ok,
                         requestId: requestId || "", doc: currentDocName || "",
                         result: result || null }, "sys");
        }
    }

    // ===== НАСТРОЙКА "МИНИМАЛЬНОЕ ВРЕМЯ МЕЖДУ КОМАНДАМИ" =====
    // Постоянное хранение — в файле на диске (C:\r7bridge\settings\R7Bridge.json),
    // его пишет МОСТ: плагин сам не имеет доступа к файловой системе (браузерная
    // песочница iframe). Плагин общается с мостом по HTTP:
    //   GET  /settings — мост отдаёт содержимое файла {"minGapSec": N}
    //   POST /settings — плагин отдаёт {"minGapSec": N}, мост пишет в файл.
    // Запасной путь (если мост/эндпоинт недоступен): localStorage браузера.

    // применяет текущее значение minGapSec к полю ввода (если оно уже создано)
    function applyGapToField() {
        var inp = document.getElementById("gapInput");
        if (inp) inp.value = String(minGapSec);
    }

    // загрузка настройки из файла моста: GET /settings. Успех — значение
    // применяется к minGapSec и полю, логируется. Файла нет или мост молчит —
    // остаётся значение из localStorage/дефолта, ошибка фиксируется в логе.
    function loadGapFromBridge() {
        fetch(BRIDGE_HTTP + "/settings", {
            headers: { "X-Proxy-Token-R7": TOKEN },
            cache: "no-store"
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
            var v = parseInt(data && data.minGapSec, 10);
            if (!isNaN(v) && v >= 0) {
                minGapSec = v;
                applyGapToField();
                log("настройка загружена из файла моста: минимальное время между командами = " +
                    minGapSec + " сек", "sys");
            } else {
                log("файл настроек моста прочитан, но minGapSec в нём нет — осталось " +
                    minGapSec + " сек", "syserr");
            }
        })
        .catch(function (e) {
            log("файл настроек моста недоступен (" + e.message +
                ") — настройка взята из localStorage/по умолчанию: " + minGapSec + " сек", "syserr");
        });
    }

    // запись настройки в файл моста: POST /settings с телом {"minGapSec": N}.
    // Успех — подтверждение в логе. Неудача — настройка продолжает жить
    // в localStorage до следующей попытки.
    function saveGapToBridge() {
        fetch(BRIDGE_HTTP + "/settings", {
            method: "POST",
            headers: { "X-Proxy-Token-R7": TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ minGapSec: minGapSec })
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
            log("настройка записана в файл моста: минимальное время между командами = " +
                minGapSec + " сек", "sys");
        })
        .catch(function (e) {
            log("запись в файл моста не удалась: " + e.message +
                " — настройка действует до перезагрузки (localStorage)", "syserr");
        });
    }

    // дублирующие надписи внутри страницы скрываем целиком,
    // разделительные линии (hr) тоже убираем.
    // кнопки наших id (btnConnect/btnDisconnect/btnTest/btnClear) не прячем никогда —
    // раньше разметочная кнопка "Подключиться" с id btnConnect пряталась по тексту
    function fixHeaders() {
        try {
            var keepIds = { btnConnect: 1, btnDisconnect: 1, btnTest: 1, btnClear: 1 };
            var els = document.querySelectorAll("body *");
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (el.children.length !== 0) continue;
                if (keepIds[el.id]) continue;
                var t = (el.textContent || "").replace(/\s+/g, " ").trim();
                if (t === "R7 Мост" || t === "R7Bridge" ||
                    t === "Проверить мост" || t === "Подключиться" ||
                    t.indexOf("R7Bridge v") !== -1) {
                    el.style.display = "none";
                }
            }
            var hrs = document.getElementsByTagName("hr");
            for (var k = 0; k < hrs.length; k++) hrs[k].style.display = "none";
        } catch (e) {}
    }

    // 4 кнопки в один ряд — ON / OFF / Test / Clear.
    // Ряд — flex-контейнер во всю ширину окна лога: у каждой кнопки равная доля,
    // сумма ширин кнопок и трёх промежутков равна ширине ряда (= окну лога).
    // Если кнопок нет в разметке — создаём их сами с обработчиками.
    // Панель кнопок — первый элемент окна (заголовок внутри страницы удалён),
    // дальше идут строка статуса и окно лога.
    function ensureButtons() {
        var btnOn    = document.getElementById("btnConnect");
        var btnOff   = document.getElementById("btnDisconnect");
        var btnTest  = document.getElementById("btnTest");
        var btnClear = document.getElementById("btnClear");

        // панель кнопок — во всю ширину окна, первая в окне:
        // вставляем перед строкой статуса, если она есть, иначе первым элементом
        var panel = document.getElementById("buttons");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "buttons";
            panel.style.width     = "100%";
            panel.style.boxSizing = "border-box";
            panel.style.margin    = "2px 0 2px 0";
            var body = document.body;
            var statusEl = document.getElementById("status");
            if (statusEl && statusEl.parentNode === body) body.insertBefore(panel, statusEl);
            else if (body && body.firstChild) body.insertBefore(panel, body.firstChild);
            else if (body) body.appendChild(panel);
        }

        // выравнивание по левому краю: левая кромка ON совпадает с краем окна
        panel.style.marginLeft = "0";
        panel.style.alignSelf  = "flex-start";
        panel.style.textAlign  = "left";

        // ряд кнопок: flex, без переносов, ровно 3 промежутка между 4 кнопками
        var row = document.getElementById("btnRow");
        if (!row) {
            row = document.createElement("div");
            row.id = "btnRow";
            row.style.display    = "flex";
            row.style.flexWrap   = "nowrap";
            row.style.alignItems = "stretch";
            row.style.gap        = BTN_GAP;
            row.style.width      = "85%";
            row.style.boxSizing  = "border-box";
            panel.appendChild(row);
        }

        function mkBtn(id, text, fn) {
            var b = document.createElement("button");
            b.id = id;
            b.textContent = text;
            b.onclick = fn;
            return b;
        }

        if (!btnOn)    btnOn    = mkBtn("btnConnect",    "ON",    connect);
        if (!btnOff)   btnOff   = mkBtn("btnDisconnect", "OFF",   disconnect);
        if (!btnTest)  btnTest  = mkBtn("btnTest",       "Test",  checkStatus);
        if (!btnClear) btnClear = mkBtn("btnClear",      "Clear", clearLog);

        // порядок в ряду: ON, OFF, Test, Clear — ON слева от OFF
        var order = [btnOn, btnOff, btnTest, btnClear];
        for (var i = 0; i < order.length; i++) {
            if (order[i].parentNode !== row) row.appendChild(order[i]);
        }

        // равная ширина и ЕДИНАЯ ВЫСОТА: каждая кнопка — равная доля ряда
        // (окна лога); высота фиксирована BTN_H = высоте поля интервала (v26.48.8).
        // Паддинг 1px по вертикали: при высоте 20px контент 16px — текст 13px
        // не обрезается
        for (var j = 0; j < order.length; j++) {
            var b = order[j];
            b.style.flex       = "1 1 0";
            b.style.width      = "auto";
            b.style.height     = BTN_H;
            b.style.minWidth   = "0";
            b.style.margin     = "0";
            b.style.padding    = "1px 0";
            b.style.fontSize   = "13px";
            b.style.whiteSpace = "nowrap";
            b.style.boxSizing  = "border-box";
        }
        btnOn.textContent    = "ON";
        btnOff.textContent   = "OFF";
        btnTest.textContent  = "TEST";
        btnClear.textContent = "CLEAR";
        btnOn.style.display    = "block";
        btnOff.style.display   = "block";
        btnTest.style.display  = "block";
        btnClear.style.display = "block";
        btnOn.onclick    = connect;
        btnOff.onclick   = disconnect;
        btnTest.onclick  = checkStatus;
        btnClear.onclick = clearLog;
    }

    // единая отрисовка чекбокса: два одинаковых по стилю под окном лога —
    // "выводить json в строку" (id chkFlatten) и
    // "скрывать системные сообщения" (id chkHideSys, по умолчанию включён).
    function ensureCheckboxes() {
        var logEl = document.getElementById("log");
        if (!logEl) return;
        var anchor = logEl;

        // чекбокс "выводить json в строку" (как в v1.0.19)
        if (!document.getElementById("chkFlatten")) {
            var wrapF = document.createElement("label");
            wrapF.id = "chkFlattenWrap";
            var cbF = document.createElement("input");
            cbF.type = "checkbox";
            cbF.id = "chkFlatten";
            cbF.checked = flattenMode;
            wrapF.appendChild(cbF);
            wrapF.appendChild(document.createTextNode(" выводить json в строку"));
            wrapF.style.fontSize   = "11px";
            wrapF.style.lineHeight = "1.4";
            wrapF.style.display    = "block";
            wrapF.style.margin     = "3px 0 0 2px";
            wrapF.style.color      = "#333";
            if (logEl.parentNode) logEl.parentNode.insertBefore(wrapF, logEl.nextSibling);
            else document.body.appendChild(wrapF);
            cbF.onchange = function () {
                flattenMode = cbF.checked;
                log(flattenMode ? "json: вывод в строку" : "json: в формате json", "sys");
                var ws = window.__r7bridge_ws;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    sendWS(ws, { type: "flatten", value: flattenMode }, "sys");
                }
            };
            anchor = wrapF;
        } else {
            var exF = document.getElementById("chkFlattenWrap");
            if (exF) anchor = exF;
        }

        // чекбокс "скрывать системные сообщения" — после чекбокса flatten
        if (!document.getElementById("chkHideSys")) {
            var wrapH = document.createElement("label");
            wrapH.id = "chkHideSysWrap";
            var cbH = document.createElement("input");
            cbH.type = "checkbox";
            cbH.id = "chkHideSys";
            cbH.checked = hideSysMode;
            wrapH.appendChild(cbH);
            wrapH.appendChild(document.createTextNode(" скрывать системные сообщения"));
            wrapH.style.fontSize   = "11px";
            wrapH.style.lineHeight = "1.4";
            wrapH.style.display    = "block";
            wrapH.style.margin     = "0 0 4px 2px";
            wrapH.style.color      = "#333";
            if (anchor.parentNode) anchor.parentNode.insertBefore(wrapH, anchor.nextSibling);
            else document.body.appendChild(wrapH);
            cbH.onchange = function () {
                hideSysMode = cbH.checked;
                applyHideSys();
                log(hideSysMode ? "системные сообщения: скрыты" : "системные сообщения: показаны", "sys");
            };
            anchor = wrapH;
        } else {
            var exH = document.getElementById("chkHideSysWrap");
            if (exH) anchor = exH;
        }

        // строка настройки "минимальное время между командами" — после чекбокса
        // hideSys: лейбл + текстовое поле (только целые неотрицательные цифры)
        // + кнопка Save справа от поля. Значение действует на приём команд
        // в routeMessage; сохранение — в файл моста (Save) + localStorage (запас).
        if (!document.getElementById("gapSettingWrap")) {
            var wrapG = document.createElement("div");
            wrapG.id = "gapSettingWrap";
            wrapG.style.display    = "flex";
            wrapG.style.alignItems = "center";
            wrapG.style.justifyContent = "flex-start"; // всё прижато влево, без растяжения (v26.48.7)
            wrapG.style.flexWrap  = "nowrap"; // всё строго в одну строку (v26.48.8)
            wrapG.style.gap        = BTN_GAP; // зазор между лейблом и полем — ровно как между кнопками
            wrapG.style.margin     = "0 0 4px 2px";

            var lblG = document.createElement("span");
            lblG.textContent = "мин. сек между командами:"; // короткая надпись (v26.48.8)
            lblG.style.fontSize   = "11px";
            lblG.style.lineHeight = "1.4";
            lblG.style.color      = "#333";
            lblG.style.margin  = "0"; // зазор задаёт gap контейнера, не отступ
            lblG.style.padding = "0"; // внешние стили темы могут добавлять паддинг — гасим (v26.48.7)
            lblG.style.flex    = "0 0 auto"; // не растягивается и не отталкивает поле (v26.48.7)
            lblG.style.whiteSpace = "nowrap"; // не переносится — строка всегда одна (v26.48.8)
            wrapG.appendChild(lblG);

            var inpG = document.createElement("input");
            inpG.id = "gapInput";
            inpG.type = "text";
            inpG.value = String(minGapSec);
            inpG.maxLength = "2";      // максимум 60 сек — два символа (v26.48.7)
            inpG.style.width    = "3ch";   // узкое поле под два символа (v26.48.7)
            inpG.style.height   = BTN_H;   // высота = высоте кнопки Save и всех кнопок (v26.48.8)
            inpG.style.fontSize = "11px";
            inpG.style.padding  = "2px 0"; // без левого паддинга: зазор только от gap контейнера
            inpG.style.margin   = "0";     // без собственных отступов: зазор задаёт только gap контейнера
            inpG.style.minWidth  = "0";    // внешние стили могут задавать min-width — гасим
            inpG.style.textAlign = "left"; // цифры у левой кромки — визуально ближе к лейблу
            inpG.style.flex      = "0 0 auto"; // не растягивается (v26.48.7)
            inpG.style.boxSizing = "border-box";
            // фильтр ввода: только цифры (0-9), максимум 2 знака (до 60 сек).
            // Буквы, минус, точка и прочее вырезаются прямо при вводе.
            inpG.oninput = function () {
                var v = String(inpG.value).replace(/\D+/g, "");
                if (v.length > 4) v = v.slice(0, 4);
                if (inpG.value !== v) inpG.value = v;
            };
            wrapG.appendChild(inpG);

            var btnG = document.createElement("button");
            btnG.id = "gapSaveBtn";
            btnG.textContent = "Save";
            btnG.style.fontSize  = "11px";
            btnG.style.padding   = "2px 10px";
            // зазор до поля задаёт gap контейнера (BTN_GAP, как между кнопками
            // ряда); собственный отступ кнопки убран, высота — единая BTN_H (v26.48.3)
            btnG.style.margin    = "0";
            btnG.style.height    = BTN_H;
            btnG.style.boxSizing = "border-box";
            btnG.style.whiteSpace = "nowrap";
            btnG.onclick = saveGap;
            wrapG.appendChild(btnG);

            if (anchor.parentNode) anchor.parentNode.insertBefore(wrapG, anchor.nextSibling);
            else document.body.appendChild(wrapG);
        }
    }

    // сохранение настройки минимального времени между командами:
    // читает поле, проверяет на целое неотрицательное, применяет, пишет
    // в localStorage (запасной вариант) и отправляет мосту POST /settings —
    // мост записывает значение в R7Bridge.json на диске. При некорректном
    // значении — сброс поля на действующее значение и запись в лог.
    function saveGap() {
        var inp = document.getElementById("gapInput");
        if (!inp) return;
        var v = parseInt(inp.value, 10);
        if (isNaN(v) || v < 0) {
            log("сохранение не выполнено: значение пустое или некорректное (только целые, 0 и больше)", "syserr");
            inp.value = String(minGapSec);
            return;
        }
        minGapSec = v;
        try { localStorage.setItem(GAP_STORE_KEY, String(minGapSec)); } catch (e) { /* хранилище недоступно */ }
        saveGapToBridge();
    }

    // загрузка сохранённой настройки при старте (первый, быстрый источник):
    // если в localStorage есть корректное целое неотрицательное — берём его,
    // иначе остаётся значение по умолчанию (GAP_DEFAULT_SEC).
    function loadGapSetting() {
        try {
            var v = parseInt(localStorage.getItem(GAP_STORE_KEY), 10);
            if (!isNaN(v) && v >= 0) minGapSec = v;
        } catch (e) { /* хранилище недоступно — значение по умолчанию */ }
    }

    // применяет/снимает скрытие системных строк: класс на контейнере лога
    function applyHideSys() {
        var el = document.getElementById("log");
        if (!el) return;
        ensureHideSysStyle();
        if (hideSysMode) el.classList.add("log-hide-sys");
        else el.classList.remove("log-hide-sys");
    }

    // САМОПРОВЕРКА при загрузке плагина. Запускается через 500 мс после init.
    // ВСЕ строки самопроверки — категория сервисных "sys" (скрываются галочкой
    // "скрывать системные сообщения"), включая неудачные пробы: это тестовые
    // сообщения, в любом режиме они не нужны (по решению пользователя, v26.48.6).
    // Тест 1a/1b: канат возврата результата через callCommand. Функция просто
    // возвращает число 777; если callback получит 777 — канал работает.
    // Проверяются оба режима isCalculate: false и true (в OnlyOffice данные
    // возвращаются только при true; в Р7 поведение может отличаться).
    // Тест 2: исполнение кода в документе с возвратом строки "done".
    // По логу видно, доходит ли результат. Всё фиксируется в логе плагина.
    function runSelfTests() {
        log("самопроверка: запущена", "sys");
        if (!window.Asc || !window.Asc.plugin || !window.Asc.plugin.callCommand) {
            log("самопроверка: callCommand недоступен — дальнейшие пробы не имеют смысла", "sys");
            return;
        }
        var probe = new Function("return 777;");
        var t1a = setTimeout(function () {
            log("самопроверка 1a (isCalculate=false): callback не пришёл за 3 сек", "sys");
        }, 3000);
        window.Asc.plugin.callCommand(probe, false, false, function (res) {
            clearTimeout(t1a);
            log("самопроверка 1a (isCalculate=false): callback вернул " + safeJson(res), "sys");
        });
        var t1b = setTimeout(function () {
            log("самопроверка 1b (isCalculate=true): callback не пришёл за 3 сек", "sys");
        }, 3000);
        window.Asc.plugin.callCommand(probe, false, true, function (res) {
            clearTimeout(t1b);
            log("самопроверка 1b (isCalculate=true): callback вернул " + safeJson(res), "sys");
        });
        // тест 2: чтение A1 активного листа + return "done" — проверка канала
        // исполнения кода в документе БЕЗ побочных эффектов (v26.48.14: раньше
        // тест красил A1 жёлтым, и это выполнялось в каждом открываемом
        // документе; канат возврата давно подтверждён — рудимент убран)
        setTimeout(function () {
            executeCode("Api.GetActiveSheet().GetRange(\"A1\").GetText(); return \"done\";",
                        "selftest-2");
        }, 200);
    }

    function init() {
        // убираем загрузочную строку из index.html — code.js построил панель
        var lm = document.getElementById("loadingMsg");
        if (lm && lm.parentNode) lm.parentNode.removeChild(lm);
        // прижимаем контент к верхней кромке окна
        try {
            document.body.style.margin   = "0";
            document.body.style.padding  = "0";
        } catch (e) {}
        fixHeaders();
        ensureVisibleStyle();
        loadGapSetting();   // 1) localStorage — мгновенно
        ensureButtons();
        ensureCheckboxes();
        applyHideSys();
        loadGapFromBridge(); // 2) файл моста — перекроет localStorage, если есть
        log("загружен, версия модуля: " + PLUGIN_VERSION, "sys");
        log("минимальное время между командами: " + minGapSec + " сек (localStorage/дефолт; файл моста уточнит)", "sys");
        setStatus("отключен", "off");
        setTimeout(runSelfTests, 500);
    }

    if (window.Asc && window.Asc.plugin) {
        window.Asc.plugin.init = init;
        try { window.Asc.plugin.onThemeChanged = function () {}; } catch (e) {}
    } else {
        if (document.readyState === "complete") init();
        else window.addEventListener("load", init);
    }

})(window, undefined);

// Лог изменений:
// v1.0.15 (2026.11.23): внутренний заголовок "Плагин R7 Bridge" удалён; панель кнопок
//   стала первым элементом окна; окно лога увеличено по высоте.
// v1.0.16 (2026.11.23): причина пустого docName — window.docEditor недоступен в контексте
//   плагина; имя берётся через callCommand + Api.GetFullName(), запасной — docEditor.
// v1.0.17 (2026.11.23): Api.GetFullName() подтверждён для текстового редактора; таймаут
//   2 сек на имя документа; запасной способ усилен (свой и родительский docEditor).
// v1.0.19 (2026.11.23): добавлен чекбокс "выводить json в строку" (по умолчанию включён);
//   json разворачивается в одну строку; состояние уходит мосту (flatten в hello и
//   сообщение {"type":"flatten","value":...}); высота лога под чекбокс.
// v1.0.20 (2026.11.23): распаковка body в routeMessage (мост доставляет команду в
//   обёртке { url, method, body }) — исправлено "команда не распознана"; добавлен
//   чекбокс "скрывать системные сообщения" (по умолчанию включён); hello — системное;
//   высота лога под второй чекбокс.
// v1.0.21 (2026.11.23): "системные сообщения: показаны/скрыты" — серым; приветствие
//   моста "R7Bridge vX.Y.Z connected" — серым (входящие: json — зелёный, текст — серый).
// v1.0.22 (2026.11.23): все 4 кнопки (ON, OFF, TEST, CLEAR) покрашены в светло-кремовый
//   #FFFBED (255, 251, 237) — фон применяется в общем цикле стилизации кнопок.
//   Примечание: в приложенном на доработку файле была v1.0.21 без этой покраски —
//   покраска включена в v1.0.23, чтобы не потерялась.
// v1.0.23 (2026.11.23): ошибки больше НЕ скрываются галочкой "скрывать системные
//   сообщения": строки-ошибки получают отдельный класс sys-err и остаются видимыми
//   при включённой галочке. К ошибкам отнесены: "WS: ошибка создания сокета",
//   "WS: ошибка соединения" (не смог подключиться), "WS: закрыт, код N" (пропала
//   связь), "status fail: ..." (мост не отвечает), "ошибка: callCommand недоступен",
//   "команда не распознана: ...". Стиль скрытия изменён на
//   #log.log-hide-sys .sys-line:not(.sys-err) { display: none; } — снял галочку,
//   скрытые строки возвращаются на место (не удаляются).
// v1.0.24 (2026.11.23): кнопки ON, OFF, TEST, CLEAR уменьшены на ~15% —
//   ширина ряда кнопок 100% -> 85% (промежутки 6px и выравнивание по левому
//   краю не менялись); отменена покраска кнопок в кремовый (v1.0.22):
//   константа BTN_BG удалена, фон кнопок снова стандартный серый.
// Накопленное: кнопки одним рядом, ON слева от OFF, равные ширины (v1.0.14),
//   лог на всю высоту окна (v1.0.8), цвет шрифта строк лога (v1.0.7),
//   компактная строка статуса с подсветкой по состоянию (v1.0.7),
//   версия модуля в статусе (v1.0.6), высота окна задаётся config.json (size).
// v1.0.25 (2026.11.23): восстановлен внешний вид окна лога — тёмный фон #1e1e1e,
//   базовый цвет шрифта #cde, отступ 8px, скругление 6px теперь задаются
//   в styleLog() из code.js (раньше их давал CSS index.html, убранный
//   при упрощении разметки).
// v1.0.26 (2026.11.23): в styleLog() добавлено el.style.display = "block":
//   упрощённый index.html держит #log скрытым при загрузке, из-за этого
//   окно лога не появлялось на экране; styleLog() возвращает видимость.
// v1.0.27 (2026.11.23): окно лога и строка статуса возвращаются на экран стилем
//   с !important (ensureVisibleStyle): скрытие в index.html сделано правилом с
//   !important, обычная строка el.style.display = "block" его не перекрыла —
//   поэтому в v1.0.26 окно так и не появилось; заодно панель кнопок и ряд
//   выровнены по левому краю (левая кромка ON — край окна).
// v1.0.28 (2026.11.23): плагин переведён на роль ретранслятора. Старые команды
//   insertText и ping убраны: routeMessage распознаёт только маркер адресата
//   "Р7-Офис" (команда {target: "Р7-Офис", code, requestId}) и передаёт код
//   исполнителю. Новая executeCode() сериализует исходник R7Executor
//   из executor.js внутрь callCommand (в контексте документа функции плагина
//   напрямую не видны) и исполняет код команды в документе. sendResult
//   передаёт в мост requestId и полный результат исполнителя
//   ({ok, info} / {ok, error}). Корректность команды нигде не проверяется —
//   её проверяет сам документ при исполнении.
// v1.0.29 (2026.11.24): исправлено "команда не распознана: R7-Офис" — причина в
//   сравнении маркера: латинская R в "R7-Офис" не совпадала с кириллической «р»
//   в эталоне "р7-офис" ни при каком toLowerCase. Добавлена функция normMarker:
//   кириллическая «р»/«Р» приравнивается к латинской r/R перед сравнением.
//   Теперь "R7-Офис", "Р7-Офис", "р7-офис" — один маркер. Остальной код без изменений.
// v1.0.30 (2026.11.24): расширенное логирование в точке "команда не удалась".
//   Перед запуском исполнителя в лог пишется сам код команды. В callback
//   различаются три исхода: undefined — "документ не вернул результат",
//   null — то же, объект — выводится ЦЕЛИКОМ через safeJson (вместо "нет данных"
//   теперь виден error исполнителя с именем ошибки, сообщением и стеком).
//   В каждый лог-строку добавляется requestId. Добавлен таймаут EXEC_TIMEOUT_MS
//   (10 сек): если callback от callCommand вообще не пришёл — фиксируется сбой
//   с текстом "callback не пришёл за N сек", результат отправляется в мост
//   только один раз (флаг answered против дублей). Добавлена safeJson —
//   сериализация ответа в лог с защитой от циклических ссылок.
//   В catch запуска исполнителя добавлен e.stack.
// v1.0.31 (2026.11.24): две доработки. (1) Вместо префикса "--" в лог выводится
//   таймстемп локального времени ЧЧ:ММ:СС (функция ts()), затем сообщение.
//   (2) Настройка "минимальное время между командами, сек": под чекбоксом
//   "скрывать системные сообщения" добавлена строка лейбл + текстовое поле
//   (только целые неотрицательные цифры, фильтр oninput вырезает всё кроме 0-9,
//   максимум 4 знака) + кнопка Save справа от поля. По умолчанию 5 сек.
//   Команда, пришедшая раньше интервала после предыдущей ПРИНЯТОЙ команды,
//   игнорируется (не исполняется), но в лог выводится строка
//   "команда Р7-Офиса (requestId: ...) (проигнорировано: не прошло минимальное
//   время)". Игнорируемая команда отсчёт интервала не сбрасывает. Настройка
//   сохраняется кнопкой Save в localStorage (ключ r7bridgeMinGap) и загружается
//   при старте (loadGapSetting); в init логируется действующее значение.
// v1.0.32 (2026.11.24): постоянное хранение настройки в файле на диске.
//   Плагин сам писать на диск не может (браузерная песочница iframe), поэтому
//   файл пишет мост. Добавлены HTTP-запросы к мосту (127.0.0.1:8791):
//   loadGapFromBridge() — GET /settings при старте: мост отдаёт содержимое
//   R7Bridge.json, значение minGapSec применяется и вносится в поле;
//   saveGapToBridge() — POST /settings при нажатии Save: мост записывает
//   файл на диск. Логи: "настройка загружена из файла моста: N сек",
//   "настройка записана в файл моста: N сек", при недоступности моста —
//   ошибка в лог и работа по запасному пути (localStorage). Порядок загрузки
//   в init: localStorage (мгновенно) -> затем файл моста перекрывает его.
//   Плагин рассчитывает на эндпоинты GET/POST /settings в мосту — доработка
//   моста выполняется отдельно (v1.2.14).
// v1.0.33 (2026.11.24): поле ввода с секундами подвинуто вплотную к лейблу:
//   отступ лейбла справа 6px -> 2px; вместе с внутренним паддингом поля (4px)
//   видимый зазор между текстом "сек:" и цифрой становится ~6px — как между
//   кнопками (BTN_GAP). Остальное без изменений.
// v1.0.34 (2026.11.24): причина «команда не удалась: callback получил undefined —
//   документ не вернул результат» подтверждена логом (cmd-20261124-0131-001, Д3):
//   callCommand при isCalculate=false НЕ передаёт результат функции в callback.
//   В обоих вызовах callCommand (executeCode и getDocName) третий аргумент
//   изменён на true — теперь callback получает результат исполнителя R7Executor
//   ({ok, info}/{ok, error}). Второй аргумент (isClose) остался false.
// v1.0.35 (2026.11.24): поле с секундами подвинуто вплотную к лейблу ЖЁСТКО:
//   зазор между лейблом и полем теперь задаёт gap контейнера (BTN_GAP = 6px,
//   как между кнопками); у лейбла отступ убран (marginRight: 0), у поля
//   убран левый паддинг (padding: 2px 0). Раньше зазор складывался из отступа
//   лейбла и паддинга поля — визуально получалось ~10px и больше.
// v1.0.36 (2026.11.24): факты от пользователя: ни Д3, ни E5 не покрасились —
//   код в документе НЕ исполняется, а не просто не возвращается. Добавлена
//   автоматическая самопроверка runSelfTests() при загрузке плагина (через
//   500 мс): 1a — callCommand с isCalculate=false и return 777 (канат возврата
//   в исходном режиме), 1b — то же с isCalculate=true, таймаут 3 сек на каждый,
//   ответы логируются; 2 — исполнение в документе кода с побочным эффектом:
//   покраска A1 жёлтым (RGB 255,255,0) + return "done" через executeCode.
//   По ячейке A1 видно, исполняется ли код вообще; по строкам лога — работает
//   ли канал возврата в обоих режимах. Все три пробы логируются с явными
//   пометками «самопроверка …».
// 26.48.1 (2026.11.24): (1) нумерация версий переведена на новую схему
//   X.Y.Z: X = год ГГ (26), Y = номер недели (48), Z = порядковый номер
//   исправления (файл code.js — первый по новой схеме).
//   (2) Важное исправление: факт со скрина — docName "ТЕСТ_МОСТ.xlsx" дошёл
//   в hello, то есть callCommand вернул строку (имя документа) — канал
//   возврата работает для СТРОК, а объекты теряются (callback undefined).
//   Исполнитель теперь возвращает результат строкой:
//   fn внутри callCommand делает JSON.stringify(R7Executor(code)),
//   а callback распаковывает JSON.parse — несоответствие форматов устранено.
//   Самопроверки 1a/1b/2 остались, логика прежняя.
// 26.48.2 (2026.11.24): подтверждено логом 01:51 — после перехода на строку
//   callback получил полный ответ исполнителя {"ok":false,"error":"код
//   команды не строка, получено: undefined"}: канал возврата СТРОКОЙ работает.
//   Причина найдена: callCommand исполняет функцию без аргументов, параметр
//   "code" в fn был undefined. Исправлено: код команды вшивается в тело
//   функции строковым литералом через JSON.stringify (var code = <литерал>).
// 26.48.3 (2026.11.24): четыре доработки окна плагина (по запросу пользователя):
//   (1) поле ввода секунд прижато к лейблу: у лейбла и поля собственные
//   отступы обнулены (margin: 0), зазор задаёт только gap контейнера
//   (BTN_GAP = 6px — как между кнопками ON/OFF/TEST/CLEAR);
//   (2) зазор между полем и кнопкой Save теперь тоже только gap контейнера:
//   собственный marginLeft: 6px у Save убран — расстояние ровно 6px,
//   как между кнопками ряда;
//   (3) кнопки ON/OFF/TEST/CLEAR по высоте равны кнопке Save: у всех пяти
//   задана единая фиксированная высота BTN_H = 22px (box-sizing: border-box);
//   раньше ON/OFF/TEST/CLEAR были ~25px (padding 4px), Save ~19px. Строка
//   статуса и всё, что ниже, поднимаются автоматически (поток), высота
//   окна лога не менялась: экономия на кнопках компенсируется выросшей
//   строкой настройки;
//   (4) в строке статуса перед словом "Статус:" всегда выводится версия
//   модуля: "Версия 26.48.3. Статус: подключен" (setStatus).
// 26.48.4 (2026.11.24): сервисный канал плагина (по запросу пользователя).
//   (1) Сервисные запросы (запрос данных у плагина) больше НЕ адресуются
//   документу: новый маркер адресата "Плагин" (target: "Плагин"). Команды
//   с этим маркером обрабатывает сам плагин (handleServiceCommand):
//   get_version — версия модуля плагина; get_min_gap — действующее
//   минимальное время между командами (то, каким плагин реально
//   руководствуется, включая запасной путь localStorage). Документ не
//   вызывается, минимальный интервал к сервисным командам НЕ применяется.
//   (2) Сервисные сообщения полностью скрываются: входящие сервисные
//   сообщения распознаются заранее (isServiceMessage) и логируются как "sys"
//   (входящее/сервисная команда/исходящее — все серые), галочка "скрывать
//   системные сообщения" убирает их с экрана. Команды документу (Р7-Офис)
//   по-прежнему зелёные "in".
//   (3) Протокол работы Алисы: первой командой сессии идёт get_min_gap —
//   так она узнаёт допустимую частоту команд и не тратит запросы впустую.
// 26.48.5 (2026.11.24): строки «проигнорировано: не прошло минимальное время»
//   переведены из категории ошибок (syserr — не скрываются никогда) в
//   категорию сервисных/тестовых (sys — серое, скрывается галочкой «скрывать
//   системные сообщения»). По запросу пользователя: такие сообщения не нужны
//   в любом режиме — команда просто ушла впустую из-за интервала, а результат
//   Алиса и так узнаёт через канал /result (записи с этим requestId не будет).
// 26.48.6 (2026.11.24): ВСЕ строки самопроверки (runSelfTests) переведены в
//   категорию сервисных (sys — серое, скрывается галочкой «скрывать системные
//   сообщения»): старт, недоступный callCommand, пробы 1a/1b как при удаче,
//   так и при неудаче. По запросу пользователя: тестовые сообщения не нужны
//   в любом режиме. Сообщения теста 2 (исполнение кода A1) уже шли как sys.
// 26.48.7 (2026.11.24): окно плагина — строка настройки интервала (по запросу
//   пользователя: поле так и не сдвинулось к лейблу):
//   (1) поле сужено под два символа: width 3ch (раньше 50px), maxLength=2 —
//   допустимый максимум 60 сек (комментарий фильтра ввода обновлён);
//   (2) поле дожато влево: у контейнера задан justifyContent: flex-start,
//   у лейбла и поля — flex: 0 0 auto (не растягиваются и не отталкиваются),
//   у лейбла обнулён ещё и padding (внешние стили темы могли добавлять свой
//   отступ, которого не было в чистом браузере); textAlign: left — цифры
//   у левой кромки поля, ближе к лейблу.
// 26.48.8 (2026.11.24): строка настройки интервала — по запросу пользователя:
//   (1) надпись сокращена: «мин. сек между командами:» (раньше «минимальное
//   время между командами, сек:»);
//   (2) всё собирается в одну строку: flexWrap: nowrap у контейнера,
//   whiteSpace: nowrap у лейбла (лейбл, поле, Save — без переносов);
//   (3) кнопка Save теперь точно по высоте поля с цифрами: и полю, и Save
//   задана единая высота BTN_H = 20px; остальные кнопки (ON/OFF/TEST/CLEAR)
//   следуют за Save — тоже 20px (у них вертикальный паддинг 1px, чтобы текст
//   13px не обрезался).
// 26.48.9 (2026.11.24): протокол переведён на латиницу (по запросу пользователя:
//   кириллица не должна участвовать ни в каких запросах). Маркер команд
//   документу теперь "R7-Office" (эталон "r7-office"), сервисные команды —
//   "Plugin" (эталон "plugin"). normMarker упрощён: trim + lowercase,
//   таблица замены кириллической «р» → r удалена. Старые кириллические
//   маркеры ("Р7-Офис", "Плагин") больше НЕ распознаются — сообщения с ними
//   попадают в ветку «команда не распознана». Тексты лога плагина остались
//   русскими (это интерфейс, а не протокол). Мост правок не требует: /cmd
//   проверяет только наличие target, значение не фильтрует.
// 26.48.10 (2026.11.24): цвет ошибочных системных строк лога (kind "syserr",
//   прежде всего «команда не удалась: полный ответ исполнителя: ...» и таймаут
//   callback) изменён с серого (наследовали LOG_COLOR_SYS) на светло-жёлтый
//   LOG_COLOR_WARN = #FFE597 — по запросу пользователя. Эти строки и раньше
//   никогда не скрывались галочкой «скрывать системные сообщения» — теперь
//   они ещё и сразу видны цветом. Серые sys-строки без изменений.
// 26.48.11 (2026.11.24): сообщения кнопки TEST видны всегда (по запросу
//   пользователя). Новый вид строки лога "systest": цвет тот же серый
//   (LOG_COLOR_SYS), но класс sys-line такой строке не назначается, поэтому
//   скрытие через контейнерный класс log-hide-sys на неё не действует —
//   галочка «скрывать системные сообщения» в любом положении показывает
//   строки кнопки TEST («Info: опрашиваю мост...», «status ok, ...»).
//   Исключение действует только в checkStatus: самопроверка при загрузке
//   (runSelfTests) и прочие системные строки остались на прежнем поведении.
// 26.48.12 (2026.11.24): починена «команда не распознана: Plugin» (лог 03:22
//   24.11). Причина: плагин получил сообщение с адресатом "Plugin" (сервисный
//   канал), но без поля code (либо code не строка) — оно падало в ветку
//   «команда не распознана» и оставалось без ответа: запрашивающая сторона
//   ждала результат, которого не будет. Исправление в routeMessage:
//   (1) имя сервисной команды ищется в code, при отсутствии — в action и
//   command (страховка от опечатки в имени поля);
//   (2) если адресат "Plugin", а имени команды нет — в лог (syserr) пишется
//   всё тело сообщения, а при наличии requestId в обратный канал уходит
//   {ok:false, error:"сервисное сообщение без имени команды"} — тишины больше нет;
//   (3) ветка «команда не распознана» теперь пишет в лог и тело сообщения
//   (развернутый json, до 300 знаков) — сразу видно, что именно пришло.
// 26.48.13 (2026.11.24): МУЛЬТИДОКУМЕНТ (по заданию пользователя: работа с
//   несколькими подключёнными документами одновременно). Правки:
//   (1) имя документа хранится в переменной уровня плагина currentDocName —
//   заполняется в getDocName (при hello и при каждом вызове);
//   (2) каждое сообщение type:"result" уходит в мост с полем doc (имя
//   документа) — мост сохраняет его вместе с результатом, Алиса видит,
//   от какого документа пришёл ответ (bridge v26.48.8);
//   (3) новая сервисная команда Plugin get_doc_name: отвечает свежим именем
//   документа (getDocName через callCommand, Api.GetFullName) и отправляет
//   мосту type:"doc" — мост обновляет client.docName (hello шлётся один раз,
//   поэтому переименованный/открытый позже документ иначе держал бы в мосту
//   устаревшее имя). Executor (executor.js) не менялся — код и так
//   исполняется в контексте конкретного документа.
// 26.48.14 (2026.11.24): самопроверка без побочных эффектов (по сообщению
//   пользователя: при подключении плагина к ЛЮБОМУ документу ячейка A1
//   активного листа красилась в жёлтый). Причина: тест 2 в runSelfTests
//   (запуск через 500 мс после init каждого экземпляра плагина) исполнял
//   SetFillColor(A1, жёлтый) как флажок «код доходит до документа» — норма
//   для 26.48.6, рудимент теперь. Исправление: тест 2 заменён на безвредное
//   чтение Api.GetActiveSheet().GetRange("A1").GetText() с тем же return
//   "done" — проверка канала исполнения сохранена, документ не изменяется.
//   Тесты 1a/1b (возврат 777) не тронуты — побочных эффектов не имели.
//   Уже покрашенные ранее документы плагином не восстанавливаются — заливка
//   снимается вручную.
// 26.48.15 (2026.11.24): шрифт окна лога уменьшен до размера шрифта строки
//   статуса (по запросу пользователя). styleLog() теперь задаёт явно
//   el.style.fontSize = "11px" (как в setStatus) — раньше размер лога не
//   задавался и наследовался из index.html, поэтому был крупнее статуса.
// 26.48.16 (2026.11.24): «суть» входящей команды в логе (по запросу
//   пользователя). Для команд адресату R7-Office вместо полной обёртки
//   («входящее: url:/cmd, method:POST, body: ...») в чёрное окно лога
//   выводятся только цепочки вызовов методов API, каждая с новой строки,
//   например: Api.GetActiveSheet().GetRange('A1').SetValue('привет, это Алиса').
//   Добавлены функции: unwrapIncoming (распаковка обёртки моста),
//   extractCalls (извлечение цепочек вызовов: корректный баланс скобок,
//   пропуск строковых литералов и комментариев; отбор — корень и методы
//   с заглавной буквы, стиль Р7 API), essenceFromMessage (сборка списка).
//   Если вызовы не найдены — выводится прежняя полная запись (страховка).
//   Многострочные записи: log() ставит whiteSpace:pre-line, таймстамп —
//   только на первой строке. ЛОГИКА КОМАНД, ОТВЕТОВ И ПЕРЕДАЧИ ИНФОРМАЦИИ
//   НЕ МЕНЯЛАСЬ: routeMessage, executeCode, sendResult не тронуты;
//   техническая строка по-прежнему попадает в суточные логи моста.
