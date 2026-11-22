(function (window, undefined) {
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";

    function log(msg) {
        var el = document.getElementById("log");
        el.textContent += msg + "\n";
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

    // Вставка текста в документ через Office API.
    // Текст вшиваем в тело функции через JSON.stringify — так он безопасно
    // проходит сериализацию callCommand (замыкания туда не переносятся).
    function insertText(text) {
        try {
            if (!window.Asc || !window.Asc.plugin || !window.Asc.plugin.callCommand) {
                log("Ошибка: callCommand недоступен в этом окружении");
                return;
            }
            var fn = new Function(
                "return function () {" +
                "    var oDocument = Api.GetDocument();" +
                "    var oParagraph = Api.CreateParagraph();" +
                "    oParagraph.AddText(" + JSON.stringify(String(text)) + ");" +
                "    oDocument.InsertContent([oParagraph]);" +
                "};"
            )();
            window.Asc.plugin.callCommand(fn, function () {
                log("Текст вставлен в документ: " + text);
            }, false, false);
        } catch (e) {
            log("Ошибка вставки: " + (e && e.message ? e.message : String(e)));
        }
    }

    // Разбор входящих сообщений моста
    function routeMessage(raw) {
        var data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return; // не JSON — уже показано в логе, молча игнорируем
        }
        if (!data || typeof data !== "object") return;

        // Команда вставки текста: {"action":"insertText","text":"..."}
        if (data.action === "insertText" && typeof data.text === "string") {
            log("Команда: вставить текст");
            insertText(data.text);
            return;
        }

        // Ответ на пинг
        if (data.type === "ping") {
            var ws = window.__r7bridge_ws;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "pong" }));
                log("Pong отправлен");
            }
        }
    }

    function connect() {
        var old = window.__r7bridge_ws;
        if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) {
            old.onclose = null; // чтобы не дёргал логику при закрытии
            old.close();
            log("WS: старый сокет закрыт");
        }

        log("WS: подключаюсь к " + BRIDGE_WS);
        var ws = new WebSocket(BRIDGE_WS + "?token=" + TOKEN);
        ws.onopen = function () {
            log("WS: открыт");
            ws.send(JSON.stringify({ type: "hello", client: "R7Bridge" }));
        };
        ws.onclose   = function (e)  { log("WS: закрыт, код " + e.code); };
        ws.onerror   = function ()   { log("WS: ошибка соединения"); };
        ws.onmessage = function (ev) { routeMessage(ev.data); };
        window.__r7bridge_ws = ws;
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
