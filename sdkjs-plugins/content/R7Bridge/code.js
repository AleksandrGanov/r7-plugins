// R7Bridge code.js v1.0.13
// Изменения v1.0.13:
// - кнопки ON/OFF/Test/Clear выстроены в один ряд: контейнер-строка во всю ширину лога,
//   у каждой кнопки равная доля (flex:1), ряд не шире окна лога — "Clear" больше не падает вниз
// - внутренняя надпись "Плагин R7 Bridge" больше не создаётся, старая (если осталась) прячется:
//   заголовок в шапку окна ставит inject.js
// - лог пересчитан под окно без внутреннего заголовка (резерв 121px -> 85px)
// - защита от двойной загрузки (index.html + "var" из config.json): инициализация выполняется один раз
// Накопленное: 4 кнопки ON/OFF/Test/Clear одной ширины (v1.0.11), лог на всю высоту окна (v1.0.8),
// цвет шрифта строк лога (v1.0.7), компактный статус с подсветкой (v1.0.7), версия модуля в статусе (v1.0.6),
// высота окна задаётся config.json (size).
(function (window, undefined) {
    if (window.__r7bridge_inited) return;
    window.__r7bridge_inited = true;

    var PLUGIN_VERSION = "1.0.13";
    var BRIDGE_HTTP = "http://127.0.0.1:8791";
    var BRIDGE_WS   = "ws://127.0.0.1:8791/";
    var TOKEN = "14ee059503d41af353dfb78a5b65426efa8f2db7f52d1f572563666243dc478b";

    // цвет ШРИФТА строк лога: входящее / исходящее / системное
    var LOG_COLOR_IN  = "#3f9b3f"; // светло-зелёный
    var LOG_COLOR_OUT = "#e05c5c"; // светло-красный
    var LOG_COLOR_SYS = "#909090"; // светло-серый

    // фон строки статуса по состоянию
    var ST_BG_OK  = "#e3f4e3"; // зелёная подсветка — "подключен"
    var ST_BG_OFF = "#f0f0f0"; // светло-серая подсветка — "отключен"
    var ST_BG_ERR = "#fdeaea"; // светло-красная подсветка — "ошибка подключения"

    function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

    // лог занимает всё свободное место окна (без внутреннего заголовка: статус + кнопки)
    function styleLog() {
        var el = document.getElementById("log");
        if (!el) return;
        el.style.whiteSpace = "pre-wrap";
        el.style.wordBreak  = "break-word";
        el.style.overflowX  = "hidden";
        el.style.overflowY  = "auto";
        el.style.boxSizing  = "border-box";
        el.style.height     = "calc(100vh - 85px)";
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
        };
        window.__r7bridge_ws = ws;
    }

    function disconnect() {
        var ws = window.__r7bridge_ws;
        log("WS: отключаюсь от " + BRIDGE_WS);
        if (ws) {
            try { ws.onclose = null; ws.close(); } catch (e) {}
            window.__r7bridge_ws = null;
        }
        setStatus("отключен", "off");
    }

    // кнопки наших id не прячем и принудительно возвращаем видимость
    function showBtn(id) {
        var b = document.getElementById(id);
        if (b) { b.style.display = ""; b.style.visibility = "visible"; }
    }

    // прячем разметочные надписи и кнопки старой разметки
    function fixMarkup() {
        // старые надписи заголовков внутри окна — прятать всегда
        var leaves = document.querySelectorAll("*");
        for (var i = 0; i < leaves.length; i++) {
            var el = leaves[i];
            if (el.children.length !== 0) continue;
            var t = norm(el.textContent || "");
            if (t === "" ) continue;
            var isOurBtn = el.id === "btnConnect" || el.id === "btnDisconnect" ||
                           el.id === "btnTest"    || el.id === "btnClear";
            if (isOurBtn) continue; // наши кнопки не прятать
            if (t.indexOf("R7 Мост") !== -1 || t === "R7Bridge" || t.indexOf("R7Bridge v") !== -1 ||
                t === "Плагин R7 Bridge" || t === "Плагин \"R7 Bridge\"") {
                el.style.display = "none";
            }
        }
        // старые разметочные кнопки "Проверить мост" и "Подключиться" — прятать всегда
        for (var j = 0; j < leaves.length; j++) {
            var btn = leaves[j];
            if (!btn || !btn.textContent) continue;
            if (btn.children.length !== 0) continue;
            if (norm(btn.textContent) === "Проверить мост" || norm(btn.textContent) === "Подключиться") {
                btn.style.display = "none";
            }
        }
        // кнопки наших id — вернуть видимость
        showBtn("btnConnect"); showBtn("btnDisconnect"); showBtn("btnTest"); showBtn("btnClear");
    }

    // разметка окна: ряд кнопок (одна строка, ширина лога), статус, лог
    function buildUI() {
        var btnRow = document.getElementById("btnRow");
        if (!btnRow) {
            btnRow = document.createElement("div");
            btnRow.id = "btnRow";
            document.body.insertBefore(btnRow, document.body.firstChild);
        }
        btnRow.style.display = "flex";
        btnRow.style.flexWrap = "nowrap";
        btnRow.style.width = "100%";
        btnRow.style.boxSizing = "border-box";
        btnRow.style.gap = "8px";
        btnRow.style.margin = "0 0 2px 0";
        btnRow.style.padding = "0";

        var defs = [
            { id: "btnConnect",    text: "ON",    title: "Подключиться к мосту",  fn: connect },
            { id: "btnDisconnect", text: "OFF",   title: "Отключиться от моста",  fn: disconnect },
            { id: "btnTest",       text: "Test",  title: "Опросить мост",         fn: checkStatus },
            { id: "btnClear",      text: "Clear", title: "Очистить лог",          fn: clearLog }
        ];
        for (var i = 0; i < defs.length; i++) {
            (function (d) {
                var b = document.getElementById(d.id);
                if (!b) {
                    b = document.createElement("button");
                    b.id = d.id;
                    b.textContent = d.text;
                    btnRow.appendChild(b);
                }
                b.textContent = d.text;
                b.title = d.title;
                b.type = "button";
                b.style.flex = "1 1 0";
                b.style.minWidth = "0";
                b.style.boxSizing = "border-box";
                b.style.margin = "0";
                b.style.padding = "4px 0";
                b.style.whiteSpace = "nowrap";
                b.style.display = "";
                b.onclick = d.fn;
            })(defs[i]);
        }

        var st = document.getElementById("status");
        if (!st) {
            st = document.createElement("div");
            st.id = "status";
            btnRow.parentNode.insertBefore(st, btnRow.nextSibling);
        }

        var lg = document.getElementById("log");
        if (!lg) {
            lg = document.createElement("div");
            lg.id = "log";
            st.parentNode.insertBefore(lg, st.nextSibling);
        }

        // body и панели без лишних отступов — контент прижат кверху
        document.body.style.margin  = "0";
        document.body.style.padding = "2px 6px 0 6px";
        document.body.style.boxSizing = "border-box";
        document.body.style.overflow = "hidden";

        fixMarkup();
        setStatus("не проверен", "off");
        log("загружен, версия модуля: " + PLUGIN_VERSION);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildUI);
    } else {
        buildUI();
    }
})(window, undefined);
