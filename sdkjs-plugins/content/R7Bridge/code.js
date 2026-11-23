// R7Bridge code.js — Версия 1.0.29 (2026.11.24)

(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.29";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";
    var BTN_GAP = "6px"; // три промежутка между четырьмя кнопками

    // цвет ШРИФТА строк лога: входящее / исходящее / системное
    var LOG_COLOR_IN  = "#3f9b3f"; // светло-зелёный
    var LOG_COLOR_OUT = "#e05c5c"; // светло-красный
    var LOG_COLOR_SYS = "#909090"; // светло-серый

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
        el.style.padding    = "8px";
        el.style.borderRadius = "6px";
        // видимость: упрощённый index.html держит #log скрытым на время загрузки,
        // без этой строки окно есть в DOM, но на экране не появляется
        el.style.setProperty("display", "block", "important"); // !important: перекрывает скрытие из index.html
        el.style.height     = "calc(100vh - 134px)";
        el.style.margin     = "2px 0 0 0";
    }

    // каждая строка лога — отдельный блок, цвет задаётся ШРИФТУ, фон не трогаем.
    // kind: "in" (зелёный), "out" (красный), "sys" (серый, системное),
    // "syserr" (серый, системное-ошибка — НЕ скрывается галочкой).
    // Системные строки получают класс sys-line — при включённой галочке
    // "скрывать системные сообщения" они скрываются классом на контейнере лога.
    // Строки-ошибки получают класс sys-line sys-err — не скрываются никогда.
    function log(msg, kind) {
        var el = document.getElementById("log");
        if (!el) { try { console.log("-- " + msg); } catch (e) {} return; }
        styleLog();
        ensureHideSysStyle();
        var line = document.createElement("div");
        line.textContent = "-- " + msg;
        line.style.margin  = "0";
        line.style.padding = "0";
        line.style.color = kind === "in"  ? LOG_COLOR_IN :
                           kind === "out" ? LOG_COLOR_OUT : LOG_COLOR_SYS;
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
        el.textContent = "Статус: " + text;
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

    function checkStatus() {
        log("Info: опрашиваю мост...", "sys");
        fetch(BRIDGE_HTTP + "/status", {
            headers: { "X-Proxy-Token-R7": TOKEN },
            cache: "no-store"
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
            setStatus(data && data.online ? "подключен" : "отключен",
                      data && data.online ? "ok" : "off");
            log("status ok, " + fmtStatus(data) + ".", "sys");
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
            cb(String(name || "").trim());
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
                ), false, false, function (res) {
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
        // входящие классифицируются: json (команда/результат моста) — зелёная "in",
        // обычный текст (например, "R7Bridge v1.2.13 connected") — серая системная "sys".
        ws.onmessage = function (ev) {
            var isJson = false;
            try {
                var t = JSON.parse(ev.data);
                if (t !== null && typeof t === "object") isJson = true;
            } catch (e) { /* обычный текст — системное сообщение */ }
            log("входящее: " + fmtJson(ev.data), isJson ? "in" : "sys");
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

    // нормализация маркера адресата: латинская R/r и кириллическая Р/р —
    // двойники (визуально одинаковы), приравниваются друг к другу.
    // На входе любая запись ("R7-Офис", "Р7-Офис", "р7-офис"), на выходе
    // единое значение для сравнения с эталоном "r7-офис".
    function normMarker(s) {
        return String(s).toLowerCase().replace(/р/g, "r");
    }

    // разбор входящих сообщений. Мост доставляет команду в обёртке:
    // { url: "/send", method: "POST", body: "{...}" } — команда лежит
    // ВНУТРИ поля body строкой, поэтому перед разбором body распаковывается
    // (строка парсится, готовый объект берётся как есть).
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
        // ретранслятор: плагин не разбирает команду и не проверяет её корректность.
        // Единственное, что он умеет — увидеть маркер адресата (нормализованный
        // normMarker: латиница/кириллица двойников приравнены) "r7-офис" и передать
        // код команды исполнителю. Корректность кода проверяет сам документ.
        if (msg.target && normMarker(msg.target) === "r7-офис" &&
            typeof msg.code === "string") {
            log("команда Р7-Офиса, передача исполнителю (requestId: " +
                (msg.requestId || "нет") + ")", "sys");
            executeCode(msg.code, msg.requestId);
        } else {
            log("команда не распознана: " + (msg.action || msg.target || "?"), "syserr");
        }
    }

    // исполнение кода команды в документе: готовый код передаётся строкой
    // в R7Executor внутри callCommand. R7Executor объявлен в executor.js
    // плагина — его исходник встраивается в сериализуемую функцию через
    // Function.toString, потому что callCommand исполняет код в контексте
    // документа, где функции плагина напрямую не видны. Результат исполнителя
    // ({ok, info} при успехе, {ok, error} при сбое) уходит в мост сообщением
    // type: "result". Корректность кода не проверяется — её проверяет документ.
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
            var fn = new Function("code",
                "var R7Executor = " + R7Executor.toString() + ";\n" +
                "return R7Executor(code);");
            window.Asc.plugin.callCommand(fn, false, false, function (res) {
                var ok = !!(res && res.ok);
                if (ok) log("исполнено: " + (res.info || "команда исполнена"), "sys");
                else log("команда не удалась: " + ((res && res.error) || "нет данных"), "syserr");
                sendResult("r7command", ok, requestId,
                           res || { ok: false, error: "нет ответа исполнителя" });
            });
        } catch (e) {
            log("ошибка запуска исполнителя: " + e.message, "syserr");
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
                         requestId: requestId || "", result: result || null }, "sys");
        }
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

        // равная ширина: каждая кнопка — равная доля ряда (окна лога)
        for (var j = 0; j < order.length; j++) {
            var b = order[j];
            b.style.flex       = "1 1 0";
            b.style.width      = "auto";
            b.style.minWidth   = "0";
            b.style.margin     = "0";
            b.style.padding    = "4px 0";
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
        }
    }

    // применяет/снимает скрытие системных строк: класс на контейнере лога
    function applyHideSys() {
        var el = document.getElementById("log");
        if (!el) return;
        ensureHideSysStyle();
        if (hideSysMode) el.classList.add("log-hide-sys");
        else el.classList.remove("log-hide-sys");
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
        ensureButtons();
        ensureCheckboxes();
        applyHideSys();
        log("загружен, версия модуля: " + PLUGIN_VERSION, "sys");
        setStatus("отключен", "off");
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
