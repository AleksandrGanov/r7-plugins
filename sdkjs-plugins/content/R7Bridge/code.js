// R7Bridge code.js v1.0.17
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
    var PLUGIN_VERSION = "1.0.17";
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

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    // лог занимает всё свободное место окна (с учётом кнопок и статуса)
    function styleLog() {
        var el = document.getElementById("log");
        if (!el) return;
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.style.overflowY  = "auto";
        el.style.boxSizing  = "border-box";
        el.style.height     = "calc(100vh - 90px)";
        el.style.margin     = "2px 0 0 0";
    }

    // каждая строка лога — отдельный блок, цвет задаётся ШРИФТУ, фон не трогаем
    function log(msg, kind) {
        var el = document.getElementById("log");
        if (!el) { try { console.log("-- " + msg); } catch (e) {} return; }
        styleLog();
        var line = document.createElement("div");
        line.textContent = "-- " + msg;
        line.style.margin  = "0";
        line.style.padding = "0";
        line.style.color = kind === "in"  ? LOG_COLOR_IN :
                           kind === "out" ? LOG_COLOR_OUT : LOG_COLOR_SYS;
        el.appendChild(line);
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
        log("Info: опрашиваю мост...");
        fetch(BRIDGE_HTTP + "/status", {
            headers: { "X-Proxy-Token-R7": TOKEN },
            cache: "no-store"
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
            setStatus(data && data.online ? "подключен" : "отключен",
                      data && data.online ? "ok" : "off");
            log("status ok, " + fmtStatus(data) + ".");
        })
        .catch(function (e) {
            setStatus("ошибка подключения", "err");
            log("status fail: " + e.message);
        });
    }

    // единая точка отправки — каждое исходящее сообщение видно в логе
    function sendWS(ws, obj) {
        var s = JSON.stringify(obj);
        log("исходящее: " + s, "out");
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
        log("WS: подключаюсь к " + BRIDGE_WS);
        var ws;
        try { ws = new WebSocket(BRIDGE_WS + "?token=" + TOKEN); }
        catch (e) {
            log("WS: ошибка создания сокета: " + e.message);
            setStatus("ошибка подключения", "err");
            return;
        }

        ws.onopen = function () {
            log("WS: открыт");
            setStatus("подключен", "ok");
            getDocName(function (docName) {
                if (ws.readyState !== WebSocket.OPEN) {
                    log("имя документа: " + (docName || "нет") +
                        ", но сокет уже закрыт — приветствие не отправлено");
                    return;
                }
                if (docName) log("имя документа: " + docName);
                else log("имя документа получить не удалось, docName будет пустым");
                sendWS(ws, {
                    type: "hello",
                    client: "R7Bridge",
                    version: PLUGIN_VERSION,
                    docName: docName,
                    userAgent: navigator.userAgent
                });
            });
        };
        ws.onclose = function (e) {
            log("WS: закрыт, код " + e.code);
            setStatus("отключен", "off");
        };
        ws.onerror = function () {
            log("WS: ошибка соединения");
            setStatus("ошибка подключения", "err");
        };
        ws.onmessage = function (ev) {
            log("входящее: " + ev.data, "in");
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
        log("WS: отключаюсь от " + BRIDGE_WS);
        setStatus("отключен", "off");
    }

    function insertText(text) {
        if (!window.Asc || !window.Asc.plugin || !window.Asc.plugin.callCommand) {
            log("ошибка: callCommand недоступен");
            return;
        }
        window.Asc.plugin.callCommand(new Function(
            "var t = " + JSON.stringify(text) + ";" +
            "var doc = Api.GetDocument();" +
            "var p = Api.CreateParagraph();" +
            "p.AddText(t);" +
            "doc.InsertContent(p);"
        ), false, false, function () {
            log("текст вставлен");
        });
    }

    function routeMessage(data) {
        var msg;
        try { msg = JSON.parse(data); } catch (e) { return; }
        if (msg.action === "insertText" && typeof msg.text === "string") {
            insertText(msg.text);
            sendResult("insertText", true);
        } else if (msg.action === "ping") {
            sendResult("ping", true);
        } else {
            log("команда не распознана: " + (msg.action || "?"));
        }
    }

    function sendResult(action, ok) {
        var ws = window.__r7bridge_ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWS(ws, { type: "result", action: action, ok: ok });
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

    function init() {
        // прижимаем контент к верхней кромке окна
        try {
            document.body.style.margin   = "0";
            document.body.style.padding  = "0";
        } catch (e) {}
        fixHeaders();
        ensureButtons();
        log("загружен, версия модуля: " + PLUGIN_VERSION);
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
