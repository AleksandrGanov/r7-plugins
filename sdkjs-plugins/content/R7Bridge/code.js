(function (window, undefined) {
    var PLUGIN_VERSION = "1.0.1";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    function log(msg) {
        var el = document.getElementById("log");
        if (!el) { try { console.log("-- " + msg); } catch (e) {} return; }
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.textContent += "-- " + msg + "\n";
        el.scrollTop = el.scrollHeight;
    }

    function clearLog() {
        var el = document.getElementById("log");
        if (el) el.textContent = "";
        log("лог очищен");
    }

    function setStatus(text, ok) {
        var el = document.getElementById("status");
        if (!el) return;
        el.textContent = "Статус: " + text;
        el.style.background = ok ? "#e3f4e3" : "#fdeaea";
    }

    function checkStatus() {
        log("Test: опрашиваю мост...");
        fetch(BRIDGE_HTTP + "/status", {
            headers: { "X-Proxy-Token-R7": TOKEN },
            cache: "no-store"
        })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
            setStatus("мост отвечает, online=" + data.online +
                      ", клиентов=" + (data.clients ? data.clients.length : 0), true);
            log("status ok: " + JSON.stringify(data));
        })
        .catch(function (e) {
            setStatus("ошибка: " + e.message, false);
            log("status fail: " + e.message);
        });
    }

    function connect() {
        var old = window.__r7bridge_ws;
        if (old) {
            try { old.onclose = null; old.close(); } catch (e) {}
            window.__r7bridge_ws = null;
        }
        log("WS: подключаюсь к " + BRIDGE_WS);
        var ws;
        try { ws = new WebSocket(BRIDGE_WS + "?token=" + TOKEN); }
        catch (e) { log("WS: ошибка создания сокета: " + e.message); return; }

        ws.onopen = function () {
            log("WS: открыт");
            var docName = "";
            try {
                if (window.docEditor && window.docEditor.getDocumentName) docName = window.docEditor.getDocumentName();
            } catch (e) {}
            ws.send(JSON.stringify({
                type: "hello",
                client: "R7Bridge",
                version: PLUGIN_VERSION,
                docName: docName,
                userAgent: navigator.userAgent
            }));
        };
        ws.onclose   = function (e) { log("WS: закрыт, код " + e.code); };
        ws.onerror   = function ()  { log("WS: ошибка соединения"); };
        ws.onmessage = function (ev) {
            log("WS -> " + ev.data);
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
            ws.send(JSON.stringify({ type: "result", action: action, ok: ok }));
        }
    }

    function fixHeaders() {
        try {
            var els = document.body.getElementsByTagName("*");
            var leaf = [];
            for (var i = 0; i < els.length; i++) {
                if (els[i].children.length !== 0) continue;
                if (els[i].id === "log" || els[i].id === "status") continue;
                leaf.push(els[i]);
            }
            var done = false;
            for (var j = 0; j < leaf.length; j++) {
                var t = norm(leaf[j].textContent);
                if (t === "" || t === "Test" || t === "Connect" || t === "Clear") continue;
                if (t.indexOf("R7 Мост") !== -1 || t.indexOf("R7Bridge") !== -1) {
                    if (!done) { leaf[j].textContent = "R7Bridge v" + PLUGIN_VERSION; done = true; }
                    else leaf[j].style.display = "none";
                }
            }
        } catch (e) { log("fixHeaders: " + e.message); }
    }

    function setupButtons() {
        var bTest  = document.getElementById("btnCheck");
        var bConn  = document.getElementById("btnConnect");
        var bClear = document.getElementById("btnClear");

        if (!bTest || !bConn) {
            // разметка без ожидаемых id — рисуем свою панель
            var panel = document.createElement("div");
            panel.id = "r7bridge_panel";
            panel.style.margin = "4px 0";

            bTest = document.createElement("button");
            bTest.id = "btnCheck"; bTest.textContent = "Test";
            panel.appendChild(bTest);

            bConn = document.createElement("button");
            bConn.id = "btnConnect"; bConn.textContent = "Connect";
            panel.appendChild(bConn);

            bClear = document.createElement("button");
            bClear.id = "btnClear"; bClear.textContent = "Clear";
            panel.appendChild(bClear);

            var anchor = document.getElementById("log") || document.body.firstChild;
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor);
            else document.body.appendChild(panel);
        } else {
            bTest.textContent = "Test";
            bConn.textContent = "Connect";
            if (!bClear) {
                bClear = document.createElement("button");
                bClear.id = "btnClear"; bClear.textContent = "Clear";
                bConn.parentNode.insertBefore(bClear, bConn.nextSibling);
            }
        }

        if (bTest)  bTest.onclick  = checkStatus;
        if (bConn)  bConn.onclick  = connect;
        if (bClear) bClear.onclick = clearLog;
        log("кнопки готовы: Test / Connect / Clear");
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
