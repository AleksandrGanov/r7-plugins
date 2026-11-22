// R7Bridge code.js v1.0.8
// Изменения v1.0.8:
// - лог растягивается на всю свободную высоту окна (calc(100vh - шапка/статус/кнопки))
// - лишние кнопки "Проверить мост" и "Подключиться" скрываются автоматически
// - из заголовка окна убрана версия: теперь просто "R7Bridge"
// Накопленное: цвет шрифта строк лога (v1.0.7), компактная строка статуса с
// подсветкой по состоянию (v1.0.7), кнопки Connect / Info / Clear одной ширины (v1.0.4),
// версия модуля в статусе (v1.0.6), высота окна задаётся config.json (size).
(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.8";
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

    // v1.0.8: лог занимает всё свободное место окна, а не фиксированные ~150px
    function styleLog() {
        var el = document.getElementById("log");
        if (!el) return;
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.style.overflowY  = "auto";
        el.style.boxSizing  = "border-box";
        el.style.height     = "calc(100vh - 90px)";
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
        } else if (msg.action === "status") {
            log("статус по запросу: " + fmtStatus(msg.data || null) + ".");
        }
    }

    function sendResult(action, ok) {
        var ws = window.__r7bridge_ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWS(ws, { type: "result", action: action, ok: ok });
        }
    }

    // v1.0.8: скрываем лишние кнопки, пришедшие из разметки страницы
    function removeExtraButtons() {
        try {
            var btns = document.body.getElementsByTagName("button");
            for (var i = 0; i < btns.length; i++) {
                var t = (btns[i].textContent || "").trim().toLowerCase();
                if (t === "проверить мост" || t === "подключиться") {
                    btns[i].style.display = "none";
                }
            }
        } catch (e) {}
    }

    // v1.0.8: в заголовке окна версии больше нет
    function fixHeader() {
        try {
            var els = document.body.getElementsByTagName("*");
            for (var i = 0; i < els.length; i++) {
                if (els[i].children.length > 0) continue;
                var t = (els[i].textContent || "").trim();
                if (/^r7bridge(\s*v\.?\s*[\d.]+)?$/i.test(t) && t.toLowerCase() !== "r7bridge") {
                    els[i].textContent = "R7Bridge";
                }
            }
            if (document.title && /r7bridge/i.test(document.title)) {
                document.title = "R7Bridge";
            }
        } catch (e) {}
    }

    // порядок и ширина кнопок: Connect / Info / Clear
    function styleButtons() {
        try {
            var wanted = ["connect", "info", "clear"];
            var found = {};
            var btns = document.body.getElementsByTagName("button");
            for (var i = 0; i < btns.length; i++) {
                var t = (btns[i].textContent || "").trim().toLowerCase();
                if (wanted.indexOf(t) !== -1 && !found[t]) found[t] = btns[i];
            }
            var parent = found.connect ? found.connect.parentNode : null;
            if (!parent) return;
            for (var j = 0; j < wanted.length; j++) {
                if (found[wanted[j]]) parent.appendChild(found[wanted[j]]);
            }
            for (var k in found) {
                found[k].style.width = BTN_WIDTH;
            }
        } catch (e) {}
    }

    // навешиваем обработчики по тексту кнопки
    function wireButtons() {
        var map = { connect: connect, info: checkStatus, clear: clearLog };
        var btns = document.body.getElementsByTagName("button");
        for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || "").trim().toLowerCase();
            if (map[t]) btns[i].onclick = map[t];
        }
    }

    function refreshUI() {
        styleLog();
        fixHeader();
        removeExtraButtons();
        styleButtons();
        wireButtons();
    }

    (function init() {
        try {
            refreshUI();
            log("R7Bridge v" + PLUGIN_VERSION + " загружен");
        } catch (e) {
            try { console.log(e); } catch (e2) {}
        }
        if (window.Asc && window.Asc.plugin) {
            window.Asc.plugin.init = function () { refreshUI(); };
            window.Asc.plugin.button = function () { this.executeCommand("close", ""); };
        }
    })();
})(window, undefined);
