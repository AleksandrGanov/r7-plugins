// R7Bridge code.js v1.0.11
// Изменения v1.0.11:
// - кнопка "Connect" переименована в "ON"
// - добавлена кнопка "OFF" (сразу за ON): отключение от моста,
//   в лог пишется "-- WS: отключаюсь от ws://127.0.0.1:8791/"
// - все 4 кнопки (ON / OFF / Test / Clear) одинаковой ширины
// Накопленное: заголовок Плагин "R7 Bridge" (v1.0.10), лог на всю высоту окна (v1.0.8),
// цвет шрифта строк лога (v1.0.7), компактная строка статуса с подсветкой по состоянию (v1.0.7),
// версия модуля в статусе (v1.0.6), высота окна задаётся config.json (size).
(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.11";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";
    var BTN_WIDTH = "90px";

    // цвет ШРИФТА строк лога: входящее / исходящее / системное
    var LOG_COLOR_IN  = "#3f9b3f"; // светло-зелёный
    var LOG_COLOR_OUT = "#e05c5c"; // светло-красный
    var LOG_COLOR_SYS = "#909090"; // светло-серый

    // фон строки статуса по состоянию
    var ST_BG_OK  = "#e3f4e3"; // зелёная подсветка — "подключен"
    var ST_BG_OFF = "#f0f0f0"; // светло-серая подсветка — "отключен"
    var ST_BG_ERR = "#fdeaea"; // светло-красная подсветка — "ошибка подключения"

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    // лог занимает всё свободное место окна (с учётом заголовка, статуса и кнопок)
    function styleLog() {
        var el = document.getElementById("log");
        if (!el) return;
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.style.overflowY  = "auto";
        el.style.boxSizing  = "border-box";
        el.style.height     = "calc(100vh - 130px)";
        el.style.margin     = "4px 0 0 0";
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
        el.style.margin     = "2px 0";
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
            var docName = "";
            try {
                if (window.docEditor && window.docEditor.getDocumentName) docName = window.docEditor.getDocumentName();
            } catch (e) {}
            sendWS(ws, {
                type: "hello",
                client: "R7Bridge",
                version: PLUGIN_VERSION,
                docName: docName,
                userAgent: navigator.userAgent
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

    // v1.0.11: отключение от моста по кнопке OFF
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
        }
    }

    function sendResult(action, ok) {
        var ws = window.__r7bridge_ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWS(ws, { type: "result", action: action, ok: ok });
        }
    }

    // v1.0.10: заголовок окна — жирный, по высоте заголовка,
    // сверху и снизу от букв по 10% высоты заголовка
    function makeHeader() {
        var h = document.getElementById("r7bridge_header");
        if (!h) {
            h = document.createElement("div");
            h.id = "r7bridge_header";
            h.textContent = "Плагин \"R7 Bridge\"";
            h.style.fontWeight = "bold";
            h.style.fontSize   = "22px";
            h.style.lineHeight = "1.4";   // буквы ~22px, воздух по 10% сверху и снизу
            h.style.padding    = "3px 8px";
            h.style.margin     = "0";
            var body = document.body;
            if (body && body.firstChild) body.insertBefore(h, body.firstChild);
            else if (body) body.appendChild(h);
        }
        return h;
    }

    // дублирующие надписи внутри страницы скрываем целиком,
    // разделительные линии (hr) тоже убираем
    function fixHeaders() {
        try {
            var els = document.querySelectorAll("body *");
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (el.children.length !== 0) continue;
                if (el.id === "r7bridge_header") continue;
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

    // v1.0.11: 4 кнопки одинаковой ширины — ON / OFF / Test / Clear.
    // Если кнопок нет в разметке — создаём их сами с обработчиками.
    function ensureButtons() {
        var btnOn    = document.getElementById("btnConnect");
        var btnOff   = document.getElementById("btnDisconnect");
        var btnTest  = document.getElementById("btnTest");
        var btnClear = document.getElementById("btnClear");

        if (!btnOn || !btnOff || !btnTest || !btnClear) {
            var panel = document.getElementById("buttons");
            if (!panel) {
                panel = document.createElement("div");
                panel.id = "buttons";
                panel.style.margin = "6px 0 2px 0";
                var body = document.body;
                var anchor = document.getElementById("r7bridge_header");
                if (anchor && anchor.nextSibling) body.insertBefore(panel, anchor.nextSibling);
                else if (body) body.appendChild(panel);
            }

            function mkBtn(id, text, fn) {
                var b = document.createElement("button");
                b.id = id;
                b.textContent = text;
                b.style.width = BTN_WIDTH;
                b.style.margin = "0 4px 0 0";
                b.style.padding = "4px 0";
                b.style.fontSize = "13px";
                b.onclick = fn;
                return b;
            }

            if (!btnOn)    btnOn    = mkBtn("btnConnect",    "ON",    connect);
            if (!btnOff)   btnOff   = mkBtn("btnDisconnect", "OFF",   disconnect);
            if (!btnTest)  btnTest  = mkBtn("btnTest",       "Test",  checkStatus);
            if (!btnClear) btnClear = mkBtn("btnClear",      "Clear", clearLog);

            // порядок: ON, OFF, Test, Clear
            var order = [btnOn, btnOff, btnTest, btnClear];
            for (var i = 0; i < order.length; i++) {
                if (order[i].parentNode !== panel) panel.appendChild(order[i]);
            }
        }

        // выравниваем ширину и вешаем обработчики (в т.ч. если кнопки из разметки)
        btnOn.style.width = btnOff.style.width = btnTest.style.width = btnClear.style.width = BTN_WIDTH;
        btnOn.textContent    = "ON";
        btnOff.textContent   = "OFF";
        btnTest.textContent  = "Test";
        btnClear.textContent = "Clear";
        btnOn.onclick    = connect;
        btnOff.onclick   = disconnect;
        btnTest.onclick  = checkStatus;
        btnClear.onclick = clearLog;
    }

    function init() {
        makeHeader();
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
