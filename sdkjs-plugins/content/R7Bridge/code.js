// R7Bridge code.js v1.0.7
// Изменения v1.0.7:
// - цвет строк лога — теперь цвет ШРИФТА (фон убран): входящие светло-зелёные,
//   исходящие светло-красные, системные светло-серые
// - строка статуса компактная: высота по шрифту (11px), отступы сжаты, кнопки прижаты выше
// - фон строки статуса по состоянию: "подключен" — зелёный, "отключен" — светло-серый,
//   "ошибка подключения" — светло-красный
// Накопленное: кнопки Connect / Info / Clear одной ширины (v1.0.4),
// версия модуля в статусе (v1.0.6), высота окна задаётся config.json (size).
(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.7";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";
    var BTN_WIDTH = "90px";

    // цвета лога: цвет шрифта — входящее / исходящее / системное
    var LOG_COLOR_IN  = "#3f9b3f"; // светло-зелёный
    var LOG_COLOR_OUT = "#e05c5c"; // светло-красный
    var LOG_COLOR_SYS = "#909090"; // светло-серый

    // фон строки статуса по состоянию
    var ST_BG_OK  = "#e3f4e3"; // зелёная подсветка
    var ST_BG_OFF = "#f0f0f0"; // светло-серая подсветка
    var ST_BG_ERR = "#fdeaea"; // светло-красная подсветка

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    // каждая строка лога — отдельный блок, цвет задаётся ШРИФТУ, фон не трогаем
    function log(msg, kind) {
        var el = document.getElementById("log");
        if (!el) { try { console.log("-- " + msg); } catch (e) {} return; }
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
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

    // v1.0.7: компактная строка статуса — высота по шрифту, отступы сжаты
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

    // v1.0.2: дублирующие надписи внутри страницы скрываем целиком,
    // разделительные линии (hr) тоже убираем
    function fixHeaders() {
        try {
            var els = document.body.getElementsByTagName("*");
            var arr = [];
            for (var i = 0; i < els.length; i++) arr.push(els[i]);
            for (var j = 0; j < arr.length; j++) {
                var el = arr[j];
                if (el.tagName === "HR") { el.style.display = "none"; continue; }
                if (el.id === "status" || el.id === "log" || el.id === "btnbar") continue;
                var t = (el.textContent || "").trim();
                if (t === "R7 Мост" || t === "R7 Bridge") el.style.display = "none";
            }
        } catch (e) {}
    }

    // интерфейс: статус -> кнопки (Connect / Info / Clear) -> лог
    function ensureUI() {
        var body = document.body;

        var status = document.getElementById("status");
        if (!status) {
            status = document.createElement("div");
            status.id = "status";
            body.insertBefore(status, body.firstChild);
        }

        var bar = document.getElementById("btnbar");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "btnbar";
            bar.style.margin  = "4px 0";
            bar.style.display = "flex";
            bar.style.gap     = "6px";
            status.parentNode.insertBefore(bar, status.nextSibling);
        }
        if (!bar.childNodes.length) {
            function mkBtn(text, fn) {
                var b = document.createElement("button");
                b.textContent = text;
                b.style.width = BTN_WIDTH;
                b.onclick = fn;
                bar.appendChild(b);
            }
            mkBtn("Connect", connect);
            mkBtn("Info", checkStatus);
            mkBtn("Clear", clearLog);
        }

        var logEl = document.getElementById("log");
        if (!logEl) {
            logEl = document.createElement("div");
            logEl.id = "log";
            logEl.style.overflowY   = "auto";
            logEl.style.fontFamily  = "monospace";
            logEl.style.fontSize    = "11px";
            body.appendChild(logEl);
        }
    }

    // высота окна задаётся config.json (size: [400, 1050]):
    // штатный resizeWindow в этой сборке редактора не действует

    function init() {
        ensureUI();
        fixHeaders();
        log("модуль загружен, версия " + PLUGIN_VERSION);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    if (window.Asc && window.Asc.plugin && window.Asc.plugin.init) {
        var prevInit = window.Asc.plugin.init;
        window.Asc.plugin.init = function () {
            init();
            if (prevInit) prevInit.apply(this, arguments);
        };
    }
})(window);
