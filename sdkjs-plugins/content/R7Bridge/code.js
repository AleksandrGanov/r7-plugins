// R7Bridge code.js v1.0.20
// Изменения v1.0.20 (на базе реального v1.0.19):
// - исправлено "команда не распознана: ?": мост доставляет команду в обёртке
//   { url, method, body }, где команда лежит ВНУТРИ поля body строкой.
//   В routeMessage добавлена распаковка: если у сообщения есть поле body
//   (строка или готовый объект), команда берётся из него;
// - добавлен второй чекбокс "скрывать системные сообщения" под окном лога,
//   по умолчанию включён (такой же синий, как у "выводить json в строку");
// - к системным отнесены все служебные сообщения плагина: жизненный цикл WS,
//   имя документа, исходящий hello, переключение flatten, result, status.
//   При включённой галочке они не выводятся в лог; при снятой — появляются
//   (в том числе ранее скрытые: строки не удаляются, а скрываются классом);
// - исходящий hello теперь пишется как системный (серый), а не исходящий (красный);
// - высота лога calc(100vh - 134px) вместо calc(100vh - 112px) — место отдано
//   второму чекбоксу.
// Изменения v1.0.19 (пересборка на базе реального v1.0.17 — чекбокса в нём не было):
// - добавлен чекбокс "выводить json в строку" под окном лога, по умолчанию включён;
// - при включённой галочке любой json в логе плагина выводится в одну строку:
//   без скобок и кавычек, пары "ключ: значение" через запятую (вложенные объекты
//   и массивы разворачиваются рекурсивно, json внутри строк — тоже);
// - не-json текст выводится как есть;
// - состояние галочки уходит мосту: поле flatten в hello и сообщение
//   {"type":"flatten","value":true/false} при каждом переключении;
// - при снятой галочке json выводится в формате json как раньше;
// - высота лога calc(100vh - 112px) вместо calc(100vh - 90px) — место отдано чекбоксу.
// Изменения v1.0.17 (проверка и правка версии 1.0.16):
// - снята оговорка прошлой версии: Api.GetFullName() подтверждён и для текстового
//   редактора (есть в Api-классе document API), основной способ имени — рабочий;
// - добавлена подстраховка по таймауту 2 сек: если callCommand не вернул имя,
//   приветствие hello уходит с пустым docName (раньше hello мог не уйти вовсе);
// - запасной способ усилен: пробуется window.docEditor и window.parent.docEditor.
// Изменения v1.0.16:
// - причина пустого docName: window.docEditor в контексте плагина недоступен,
//   getDocumentName() падал в catch и имя всегда было пустым;
// - имя документа берётся через callCommand + Api.GetFullName() (основной способ),
//   запасной — window.docEditor.getDocumentName();
// - hello отправляется после получения имени, при закрытом сокете — не отправляется.
// Изменения v1.0.15:
// - внутренний заголовок "Плагин \"R7 Bridge\"" полностью удалён (makeHeader убрана),
//   верхний заголовок редактора с крестиком остаётся единственным;
// - панель кнопок стала первым элементом окна, под ней строка статуса, под ней лог;
// - окно лога увеличено по высоте на ~5%: высота calc(100vh - 90px) вместо
//   calc(100vh - 121px) — место убранного заголовка отдано логу.
// Накопленное: кнопки одним рядом, ON слева от OFF, равные ширины (v1.0.14),
// лог на всю высоту окна (v1.0.8), цвет шрифта строк лога (v1.0.7),
// компактная строка статуса с подсветкой по состоянию (v1.0.7),
// версия модуля в статусе (v1.0.6), высота окна задаётся config.json (size).
(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.20";
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
        st.textContent = "#log.log-hide-sys .sys-line { display: none; }";
        (document.head || document.body).appendChild(st);
    }

    // лог занимает всё свободное место окна (с учётом кнопок, статуса и чекбоксов)
    function styleLog() {
        var el = document.getElementById("log");
        if (!el) return;
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.style.overflowY  = "auto";
        el.style.boxSizing  = "border-box";
        el.style.height     = "calc(100vh - 134px)";
        el.style.margin     = "2px 0 0 0";
    }

    // каждая строка лога — отдельный блок, цвет задаётся ШРИФТУ, фон не трогаем.
    // kind: "in" (зелёный), "out" (красный), "sys" (серый, системное).
    // Системные строки получают класс sys-line — при включённой галочке
    // "скрывать системные сообщения" они скрываются классом на контейнере лога.
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
            log("status fail: " + e.message, "sys");
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
            log("WS: ошибка создания сокета: " + e.message, "sys");
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
            log("WS: закрыт, код " + e.code, "sys");
            setStatus("отключен", "off");
        };
        ws.onerror = function () {
            log("WS: ошибка соединения", "sys");
            setStatus("ошибка подключения", "err");
        };
        ws.onmessage = function (ev) {
            log("входящее: " + fmtJson(ev.data), "in");
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

    function insertText(text) {
        if (!window.Asc || !window.Asc.plugin || !window.Asc.plugin.callCommand) {
            log("ошибка: callCommand недоступен", "sys");
            return;
        }
        window.Asc.plugin.callCommand(new Function(
            "var t = " + JSON.stringify(text) + ";" +
            "var doc = Api.GetDocument();" +
            "var p = Api.CreateParagraph();" +
            "p.AddText(t);" +
            "doc.InsertContent(p);"
        ), false, false, function () {
            log("текст вставлен", "sys");
        });
    }

    // разбор входящих сообщений. Мост доставляет команду в обёртке:
    // { url: "/send", method: "POST", body: "{\"action\":\"insertText\",...}" } —
    // команда лежит ВНУТРИ поля body строкой, поэтому перед разбором body
    // распаковывается (строка парсится, готовый объект берётся как есть).
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
        if (msg.action === "insertText" && typeof msg.text === "string") {
            insertText(msg.text);
            sendResult("insertText", true);
        } else if (msg.action === "ping") {
            sendResult("ping", true);
        } else {
            log("команда не распознана: " + (msg.action || "?"), "sys");
        }
    }

    function sendResult(action, ok) {
        var ws = window.__r7bridge_ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWS(ws, { type: "result", action: action, ok: ok }, "sys");
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

        // ряд кнопок: flex, без переносов, ровно 3 промежутка между 4 кнопками
        var row = document.getElementById("btnRow");
        if (!row) {
            row = document.createElement("div");
            row.id = "btnRow";
            row.style.display    = "flex";
            row.style.flexWrap   = "nowrap";
            row.style.alignItems = "stretch";
            row.style.gap        = BTN_GAP;
            row.style.width      = "100%";
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
                log(hideSysMode ? "системные сообщения: скрыты" : "системные сообщения: показаны", "in");
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
        // прижимаем контент к верхней кромке окна
        try {
            document.body.style.margin   = "0";
            document.body.style.padding  = "0";
        } catch (e) {}
        fixHeaders();
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
