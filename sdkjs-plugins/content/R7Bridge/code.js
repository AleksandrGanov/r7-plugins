// R7Bridge code.js v1.0.6
// Изменения v1.0.6: в строку статуса добавлена версия реально загруженного
// модуля: "-- status ok, version: ..., online: ..., clients: ..., версия модуля: X.X.X."
// Заодно: цветной лог (v1.0.5), три статуса с подсветкой (v1.0.5),
// кнопки Connect / Info / Clear одной ширины (v1.0.4), окно x3 (v1.0.3).
(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.6";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";
    var BTN_WIDTH = "90px";

    // цвета лога: входящее / исходящее / системное
    var LOG_BG_IN  = "#e3f4e3"; // светло-зелёный
    var LOG_BG_OUT = "#fdeaea"; // светло-красный
    var LOG_BG_SYS = "#f0f0f0"; // светло-серый

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    // v1.0.5: каждая строка лога — отдельный блок с подсветкой.
    // kind: "in" — входящее, "out" — исходящее, остальное — системное.
    function log(msg, kind) {
        var el = document.getElementById("log");
        if (!el) { try { console.log("-- " + msg); } catch (e) {} return; }
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        var line = document.createElement("div");
        line.textContent = "-- " + msg;
        line.style.background = kind === "in" ? LOG_BG_IN :
                                kind === "out" ? LOG_BG_OUT : LOG_BG_SYS;
        el.appendChild(line);
        el.scrollTop = el.scrollHeight;
    }

    function clearLog() {
        var el = document.getElementById("log");
        if (el) el.innerHTML = "";
        log("лог очищен");
    }

    function setStatus(text, kind) {
        var el = document.getElementById("status");
        if (!el) return;
        el.textContent = "Статус: " + text;
        el.style.background = kind === "ok"   ? "#e3f4e3" :
                              kind === "err"  ? "#fdeaea" : "#f0f0f0";
    }

    // v1.0.6: человекочитаемый статус + версия реально загруженного модуля
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
            setStatus("подключен", "ok");
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
        ws.onclose   = function (e) {
            log("WS: закрыт, код " + e.code);
            setStatus("отключен", "off");
        };
        ws.onerror   = function ()  {
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
        }
    }

    function sendResult(action, ok) {
        var ws = window.__r7bridge_ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendWS(ws, { type: "result", action: action, ok: ok });
        }
    }

    // дублирующие надписи внутри страницы скрываем целиком,
    // разделительные линии (hr) тоже убираем
    function fixHeaders() {
        try {
            var els = document.body.getElementsByTagName("*");
            for (var i = 0; i < els.length; i++) {
                var el = els[i];
                if (el.id === "log" || el.id === "status") continue;
                if (el.tagName === "HR") { el.style.display = "none"; continue; }
                if (el.children.length !== 0) continue;
                var t = norm(el.textContent);
                if (t === "" || t === "Test" || t === "Info" || t === "Connect" || t === "Clear") continue;
                if (t.indexOf("R7 Мост") !== -1 || t.indexOf("R7Bridge") !== -1) {
                    el.style.display = "none";
                }
            }
        } catch (e) { log("fixHeaders: " + e.message); }
    }

    // кнопки одной ширины в порядке Connect / Info / Clear
    function styleButton(b) {
        if (!b) return;
        b.style.width = BTN_WIDTH;
        b.style.marginRight = "6px";
        b.style.boxSizing = "border-box";
    }

    function setupButtons() {
        var bConn  = document.getElementById("btnConnect");
        var bInfo  = document.getElementById("btnCheck");
        var bClear = document.getElementById("btnClear");

        if (!bConn || !bInfo) {
            // разметка без ожидаемых id — рисуем свою панель
            var panel = document.createElement("div");
            panel.id = "r7bridge_panel";
            panel.style.margin = "4px 0";

            bConn = document.createElement("button");
            bConn.id = "btnConnect"; bConn.textContent = "Connect";
            panel.appendChild(bConn);

            bInfo = document.createElement("button");
            bInfo.id = "btnCheck"; bInfo.textContent = "Info";
            panel.appendChild(bInfo);

            bClear = document.createElement("button");
            bClear.id = "btnClear"; bClear.textContent = "Clear";
            panel.appendChild(bClear);

            var anchor = document.getElementById("log") || document.body.firstChild;
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor);
            else document.body.appendChild(panel);
        } else {
            bInfo.textContent = "Info";
            bConn.textContent = "Connect";
            if (!bClear) {
                bClear = document.createElement("button");
                bClear.id = "btnClear"; bClear.textContent = "Clear";
                bConn.parentNode.insertBefore(bClear, bConn.nextSibling);
            }
        }

        // порядок кнопок в панели: Connect, Info, Clear
        try {
            var parent = bConn.parentNode;
            if (parent && bInfo.parentNode === parent && bClear.parentNode === parent) {
                parent.insertBefore(bClear, bConn.nextSibling);
                parent.insertBefore(bInfo, bClear.nextSibling);
            }
        } catch (e) {}

        styleButton(bConn);
        styleButton(bInfo);
        styleButton(bClear);

        if (bInfo)  bInfo.onclick  = checkStatus;
        if (bConn)  bConn.onclick  = connect;
        if (bClear) bClear.onclick = clearLog;
        log("кнопки готовы: Connect / Info / Clear");
    }

    // высоту окна увеличиваем в 3 раза через API плагина
    function enlargeWindow() {
        try {
            if (window.Asc.plugin.resizeWindow) {
                var w = window.innerWidth;
                var h = window.innerHeight * 3;
                window.Asc.plugin.resizeWindow(w, h);
            }
        } catch (e) { log("enlargeWindow: " + e.message); }
    }

    window.onerror = function (msg, src, line) {
        log("ошибка скрипта: " + msg + " (строка " + line + ")");
    };

    function initSafe() {
        try {
            document.title = "R7Bridge v" + PLUGIN_VERSION;
            log("плагин v" + PLUGIN_VERSION + " загружен");
            fixHeaders();
            setupButtons();
            enlargeWindow();
            checkStatus();
        } catch (e) {
            log("ошибка инициализации: " + e.message);
        }
    }

    window.Asc.plugin.init = initSafe;

    window.Asc.plugin.button = function (id) {
        this.executeCommand("close", "");
    };
})(window, undefined);
