/**
 * AgentRouter 每日定时签到 (Egern 适配版)
 * 目标站点: https://ps.air-outer.com
 *
 * 账号配置（二选一）：
 * 1. 自动抓取（推荐）：开启 Egern 模块与 MitM，在浏览器登录 https://ps.air-outer.com 一次即可自动保存凭据。
 * 2. 手动填写：直接在下方 CONFIG_USERNAME 与 CONFIG_PASSWORD 填入账号和密码（已自动抓取则留空）。
 */

const CONFIG_USERNAME = ""; // 可选：手动填写账号或邮箱
const CONFIG_PASSWORD = ""; // 可选：手动填写密码

const $ = new Env("AgentRouter");
const BASE_URL = "https://ps.air-outer.com";
const USER_KEY = "agentrouter_username";
const PASSWORD_KEY = "agentrouter_password";
const ACCOUNTS_KEY = "agentrouter_accounts";
const DEBUG_KEY = "agentrouter_debug";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

run().catch((error) => {
    $.msg($.name, "❌ 运行失败", error.message);
}).finally(() => $.done());

async function run() {
    const accounts = readAccounts();
    if (!accounts.length) {
        $.msg($.name, "🚫 未配置账号", "请在手机浏览器登录 https://ps.air-outer.com 自动抓取凭据，或在脚本中填写账号与密码");
        return;
    }

    let quotaUnit = null;
    try {
        const status = await request("GET", "/api/status", { Accept: "application/json" }, undefined, "余额显示配置查询");
        const config = status.json.data;
        if (status.json.success === true && config && config.display_in_currency === true
            && typeof config.quota_per_unit === "number" && Number.isFinite(config.quota_per_unit) && config.quota_per_unit > 0) {
            quotaUnit = config.quota_per_unit;
        }
    } catch (_) {
        debug("余额显示配置未取得，将显示原始额度");
    }

    const results = [];
    for (let i = 0; i < accounts.length; i++) {
        debug(`开始账号 ${i + 1}/${accounts.length}`);
        try {
            results.push(await checkin(accounts[i], quotaUnit));
        } catch (error) {
            results.push({ title: "❌ 运行失败", content: error.message });
        }
    }

    if (results.length === 1) {
        $.msg($.name, results[0].title, `👤 账号：${maskAccount(accounts[0].username)}\n${results[0].content}`);
    } else {
        $.msg($.name, `签到汇总（${results.length} 个账号）`, results.map((result, i) =>
            `👤 账号 ${i + 1} · ${maskAccount(accounts[i].username)}\n${result.title}\n${result.content}`).join("\n\n"));
    }
}

function readAccounts() {
    const multi = ($.getdata(ACCOUNTS_KEY) || "").trim();
    if (multi) {
        let accounts;
        try {
            accounts = JSON.parse(multi);
        } catch (_) {
            throw new Error("多账号格式错误，请按 JSON 数组格式填写");
        }
        if (!Array.isArray(accounts) || !accounts.length) {
            throw new Error("多账号必须是非空 JSON 数组");
        }
        return accounts.map((account, i) => {
            if (!account || typeof account.username !== "string" || !account.username.trim()
                || typeof account.password !== "string" || !account.password) {
                throw new Error(`多账号第 ${i + 1} 项缺少有效的 username 或 password`);
            }
            return { username: account.username.trim(), password: account.password };
        });
    }

    const username = (CONFIG_USERNAME || $.getdata(USER_KEY) || "").trim();
    const password = CONFIG_PASSWORD || $.getdata(PASSWORD_KEY) || "";
    return username && password ? [{ username, password }] : [];
}

async function checkin({ username, password }, quotaUnit) {
    const headers = {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/login`,
    };
    const loginStarted = Math.floor(Date.now() / 1000);
    const login = await request("POST", "/api/user/login", headers, JSON.stringify({ username, password }), "登录");
    const loginFinished = Math.floor(Date.now() / 1000);

    if (login.json.success !== true) {
        const msg = login.json.message || "账号密码错误或触发安全验证";
        return { title: "❌ 登录失败", content: `请先在浏览器打开 ${BASE_URL} 确认账号密码及是否需要验证码 (${msg})` };
    }

    const data = login.json.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { title: "⚠️ 签到待确认", content: "登录成功，但响应缺少用户信息，请到网站日志中核对" };
    }
    debug(`登录成功；checked_in=${data.checked_in === true ? "true" : data.checked_in === false ? "false" : "缺失"}`);

    const cookie = sessionCookie(login.headers);
    if (!cookie || !Number.isInteger(data.id) || data.id <= 0) {
        return { title: "⚠️ 签到待确认", content: "登录响应缺少 Cookie 或用户编号，请到网站核对签到记录与余额" };
    }

    const userHeaders = {
        ...headers,
        Referer: `${BASE_URL}/console`,
        Cookie: cookie,
        "New-API-User": String(data.id),
    };

    let stats;
    try {
        const profile = await request("GET", "/api/user/self", userHeaders, undefined, "余额查询");
        const quota = profile.json.data && profile.json.data.quota;
        if (profile.json.success !== true || typeof quota !== "number" || !Number.isFinite(quota)) {
            throw new Error("余额查询未返回有效额度，请到网站核对");
        }
        const user = profile.json.data;
        stats = `${formatAmount("💳 当前余额", quota, quotaUnit)}\n${formatAmount("📉 累计消耗", user.used_quota, quotaUnit)}`;
        if (Number.isInteger(user.request_count) && user.request_count >= 0) {
            stats += `\n⚡ 累计调用：${user.request_count} 次`;
        }
    } catch (error) {
        stats = `💳 当前余额：查询失败\n📉 累计消耗：查询失败\n${error.message}`;
    }

    let checkinRecord = null;
    let detail = "";
    try {
        const logs = await request("GET", "/api/log/self?p=1&page_size=20", {
            ...userHeaders,
            Referer: `${BASE_URL}/console/log`,
        }, undefined, "签到记录查询");
        if (logs.json.success !== true || !logs.json.data || !Array.isArray(logs.json.data.items)) {
            throw new Error("签到记录查询未成功，请在网站使用日志中核对");
        }
        const items = logs.json.data.items;
        checkinRecord = findTodayCheckin(items, Date.now());
        debug(`最近记录数=${items.length}；今日签到记录=${!!checkinRecord}`);
        if (!checkinRecord) detail = "最近 20 条日志中未找到今日签到记录，请到网站核对";
    } catch (error) {
        detail = error.message;
    }

    if (checkinRecord) {
        const time = new Date(checkinRecord.created_at * 1000);
        const clock = [time.getHours(), time.getMinutes(), time.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
        const isNew = data.checked_in === true && checkinRecord.created_at >= loginStarted && checkinRecord.created_at <= loginFinished;
        const reward = formatCheckinReward(checkinRecord.content, isNew);
        return { title: "✅ 今日签到已确认", content: `${reward}\n${stats}\n🕒 签到时间：${clock}` };
    } else {
        const state = data.checked_in === true ? "服务端返回已签到，但日志尚未确认" : "登录成功，签到状态尚未确认";
        return { title: "⚠️ 签到待确认", content: `🎁 签到奖励：待确认\n${stats}\n\n${state}\n${detail}` };
    }
}

function maskAccount(username) {
    const name = username.split("@")[0];
    return name.length > 4 ? `${name.slice(0, 2)}***${name.slice(-2)}` : `${name.slice(0, 1)}***`;
}

function formatAmount(label, value, quotaUnit) {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${label}：未返回`;
    return quotaUnit === null ? `${label}（原始额度）：${value}` : `${label}：$${(value / quotaUnit).toFixed(2)}`;
}

function formatCheckinReward(content, isNew) {
    const match = content.trim().match(/^每日签到成功，\s*增加额度\s*\$\s*(\d+(?:\.\d+)?)\s*额度$/);
    const amount = match ? Number(match[1]) : NaN;
    const label = isNew ? "🎁 本次奖励" : "🎁 今日奖励";
    if (!Number.isFinite(amount)) return `${label}：金额未识别，请到网站核对`;
    return `${label}：${amount > 0 ? "+" : ""}$${amount.toFixed(2)}${isNew ? "" : "（今日记录）"}`;
}

function findTodayCheckin(items, now) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    let latest = null;
    for (const item of items) {
        if (item && item.type === 4
            && typeof item.content === "string" && item.content.includes("签到成功")
            && typeof item.created_at === "number" && Number.isFinite(item.created_at)
            && item.created_at * 1000 >= start.getTime() && item.created_at * 1000 <= now
            && (!latest || item.created_at > latest.created_at)) latest = item;
    }
    return latest;
}

function sessionCookie(headers) {
    const key = Object.keys(headers).find((name) => name.toLowerCase() === "set-cookie");
    const raw = key ? [].concat(headers[key]).join("\n") : "";
    const match = raw.match(/(?:^|[\n,])\s*(?:set-cookie:\s*)?(session=[^;\s,]+)/i);
    return match ? match[1] : "";
}

function request(method, path, headers, body, label) {
    return new Promise((resolve, reject) => {
        const options = { url: BASE_URL + path, headers, timeout: 30000 };
        if (body !== undefined) options.body = body;

        $.send(options, method, (error, response, text) => {
            if (error) {
                reject(new Error(`${label}网络请求失败，请检查网络或分流规则`));
                return;
            }
            const status = Number(response && (response.status || response.statusCode));
            debug(`${label} HTTP ${status}`);
            if (status < 200 || status >= 300 || !status) {
                reject(new Error(`${label}返回 HTTP ${status || "未知"}，请确认网站是否可访问`));
                return;
            }
            let json;
            try {
                json = JSON.parse(text);
            } catch (_) {
                reject(new Error(`${label}返回非 JSON 内容（可能触发了阿里云 WAF 滑块验证，请将 ps.air-outer.com 设置为 DIRECT 直连）`));
                return;
            }
            if (!json || typeof json !== "object" || Array.isArray(json)) {
                reject(new Error(`${label}响应格式异常，请到网站检查`));
                return;
            }
            resolve({ json, headers: response.headers || {} });
        });
    });
}

function debug(message) {
    if ($.getdata(DEBUG_KEY) === "true") $.log(`[DEBUG] ${message}`);
}

function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== "undefined";
    this.isQuanX = () => typeof $task !== "undefined";
    this.isLoon = () => typeof $loon !== "undefined";
    this.log = (...a) => console.log(a.join("\n"));
    this.msg = (t = this.name, s = "", b = "") => {
        if (typeof $notification !== "undefined") $notification.post(t, s, b);
        else if (typeof $notify !== "undefined") $notify(t, s, b);
        console.log(["", `====📣${t}====`, s, b].filter(Boolean).join("\n"));
    };
    this.getdata = (k) => {
        if (typeof $persistentStore !== "undefined") return $persistentStore.read(k);
        if (typeof $prefs !== "undefined") return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (typeof $persistentStore !== "undefined") return $persistentStore.write(v, k);
        if (typeof $prefs !== "undefined") return $prefs.setValueForKey(v, k);
        return false;
    };
    this.send = (req, method, cb) => {
        if (typeof $httpClient !== "undefined") {
            const fn = method.toUpperCase() === "POST" ? $httpClient.post : $httpClient.get;
            fn(req, (err, resp, data) => {
                if (resp) {
                    resp.body = data;
                    resp.statusCode = resp.status || resp.statusCode;
                }
                cb(err, resp, data);
            });
        } else if (typeof $task !== "undefined") {
            req.method = method;
            $task.fetch(req).then(
                (r) => {
                    r.status = r.statusCode;
                    cb(null, r, r.body);
                },
                (e) => cb(e.error || e, null, null),
            );
        }
    };
    this.done = (v = {}) => {
        if (typeof $done !== "undefined") $done(v);
    };
}
