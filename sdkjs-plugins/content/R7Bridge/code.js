(function (window, undefined) {
    var BRIDGE_HTTP = "http://127.0.0.1:8790";
    var BRIDGE_WS   = "ws://127.0.0.1:8790/";
    var TOKEN = "d07ddf6b72236e28f22c683333511361d6c6b7136978a6889d1227627db31ad8";

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

    function connect() {
        log("WS: подключаюсь к " + BRIDGE_WS);
        var ws = new WebSocket(BRIDGE_WS + "?token=" + TOKEN);
        ws.onopen    = function ()    { log("WS: открыт"); };
        ws.onclose   = function (e)   { log("WS: закрыт, код " + e.code); };
        ws.onerror   = function ()    { log("WS: ошибка соединения"); };
        ws.onmessage = function (ev)  { log("WS -> " + ev.data); };
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
