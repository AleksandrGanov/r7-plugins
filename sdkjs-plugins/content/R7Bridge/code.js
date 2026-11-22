(function (window, undefined) {
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";

    // ---------- оформление: перенос строк, кнопки ----------
    (function setupUI() {
        var style = document.createElement("style");
        style.textContent =
            "#log{white-space:pre-wrap;word-wrap:break-word;overflow-x:hidden;}" +
            ".r7btn{margin-left:6px;}";
        document.head.appendChild(style);

        var btnCheck = document.getElementById("btnCheck");
        if (btnCheck) btnCheck.textContent = "Test";

        var btnConnect = document.getElementById("btnConnect");
        if (btnConnect) btnConnect.textContent = "Connect";

        var btnClear = document.createElement("button");
        btnClear.id = "btnClear";
        btnClear.textContent = "Clear";
        btnClear.className = "r7btn";
        if (btnConnect && btnConnect.parentNode) {
            btnConnect.parentNode.insertBefore(btnClear, btnConnect.nextSibling);
        } else if (btnCheck && btnCheck.parentNode) {
            btnCheck.parentNode.appendChild(btnClear);
        }
        btnClear.onclick = function () {
            document.getElementById("log").textContent = "";
        };
    })();

    // ---------- лог: каждая строка с префиксом "--" ----------
    function log(msg) {
        var el = document.getElementById("log");
        String(msg).split("\n").forEach(function (line) {
            el.textContent += "-- " + line + "\n";
        });
        el.scrollTop = el.scrollHeight;
    }

    function setStatus(text, ok) {
        var el = document.getElementById("status");
        el.textContent = "Статус: " + text;
        el.style.background = ok ? "#e3f4e3" : "#fdeaea";
    }

    function checkStatus() {
        fetch(BRIDGE_HTTP + "/status", {
            headers: { "X-Proxy-Token-R7": TOKEN },
            cache: "no-store"
        })
        .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        })
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
        if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) {
            old.onclose = null;
            old.close();
            log("WS: старый сокет закрыт");
        }

        log("WS: подключаюсь к " + BRIDGE_WS);
        var ws = new WebSocket(BRIDGE_WS + "?token=" + TOKEN);
        ws.onopen = function () {
            log("WS: открыт");
            ws.send(JSON.stringify({ type: "hello", client: "ONLYOFFICE-plugin" }));
        };
        ws.onclose   = function (e)  { log("WS: закрыт, код " + e.code); };
        ws.onerror   = function ()   { log("WS: ошибка соединения"); };
        ws.onmessage = function (ev) { routeMessage(ev.data); };
        window.__r7bridge_ws = ws;
    }

    // ---------- команды от моста ----------
    function insertText(text) {
        if (!window.Asc || !window.Asc.plugin || typeof window.Asc.plugin.callCommand !== "function") {
            log("ошибка: callCommand недоступен");
            return;
        }
        var payload = JSON.stringify(text);
        window.Asc.plugin.callCommand(function (s) {
            var doc = Api.GetDocument();
            var paragraph = Api.CreateParagraph();
            paragraph.AddText(s);
            doc.InsertContent([paragraph]);
        }, false, false, payload, function (res) {
            log("текст вставлен" + (res ? ", результат: " + JSON.stringify(res) : ""));
        });
    }

    function routeMessage(raw) {
        log("WS -> " + raw);
        var msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (msg.action === "ping") {
            if (window.__r7bridge_ws) window.__r7bridge_ws.send(JSON.stringify({ type: "pong" }));
            return;
        }
        if (msg.action === "insertText" && typeof msg.text === "string") {
            insertText(msg.text);
            return;
        }
        log("команда не распознана: " + (msg.action || "?"));
    }

    window.Asc.plugin.init = function () {
        document.getElementById("btnCheck").onclick = checkStatus;
        document.getElementById("btnConnect").onclick = connect;
        checkStatus();
    };

    window.Asc.plugin.button = function (id) {
        this.executeCommand("close", "");
    };
})(window, undefined);
