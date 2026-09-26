const STORAGE_KEY = "GLADOS_RAILGUN_COOKIES";
const PLAN_KEY = "GLADOS_RAILGUN_EXCHANGE_PLAN";
const DOMAINS = ["glados.cloud", "railgun.info"];
const PLANS = { plan100: 100, plan200: 200, plan500: 500 };
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36";

function request(domain, cookie, path, body) {
  return new Promise((resolve) => {
    const options = {
      url: `https://${domain}/api/user/${path}`,
      headers: {
        Cookie: cookie,
        Origin: `https://${domain}`,
        "User-Agent": USER_AGENT,
      },
      timeout: 12000,
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.body = body;
    }
    const method = body === undefined ? "get" : "post";
    $httpClient[method](options, (error, response, data) => {
      if (error || !response || (response.status || response.statusCode) >= 400) {
        resolve({ error: error ? String(error) : `HTTP ${response && (response.status || response.statusCode) || "unknown"}` });
        return;
      }
      try {
        resolve({ data: JSON.parse(data) });
      } catch (parseError) {
        resolve({ error: "返回数据不是 JSON" });
      }
    });
  });
}

function accountsFor(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((cookie) => typeof cookie === "string" && /(?:^|;\s*)koa:sess(?:\.sig)?=/.test(cookie));
}

function formatNumber(value, suffix) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(number)
    ? `${Math.trunc(number)}${suffix}` : "未知";
}

async function runAccount(domain, cookie, index, plan) {
  const label = `${domain}${index > 0 ? ` #${index + 1}` : ""}`;
  const status = await request(domain, cookie, "status");
  const checkin = await request(domain, cookie, "checkin", `token=${encodeURIComponent(domain)}`);
  const points = await request(domain, cookie, "points");
  const code = checkin.data && checkin.data.code;
  const result = code === 0 ? "签到成功" : code === 1 ? "今日已签到" :
    `签到失败: ${checkin.error || checkin.data && checkin.data.message || "未知错误"}`;
  const days = status.data && status.data.code === 0
    ? formatNumber(status.data.data && status.data.data.leftDays, "天") : "未知";
  const balance = points.data && points.data.code === 0 ? Number(points.data.points) : NaN;
  const balanceText = Number.isFinite(balance) ? formatNumber(balance, "积分") : "未知";
  let exchange = "未兑换";
  if (Number.isFinite(balance) && balance >= PLANS[plan] && (code === 0 || code === 1)) {
    const response = await request(domain, cookie, "exchange", `planType=${encodeURIComponent(plan)}`);
    exchange = response.data && response.data.code === 0 ? `兑换成功 (${plan})` :
      `兑换失败: ${response.error || response.data && response.data.message || "未知错误"}`;
  }
  return `${label}: ${result} | 剩余 ${days} | ${balanceText} | ${exchange}`;
}

async function main() {
  try {
    let stored;
    try {
      stored = JSON.parse($persistentStore.read(STORAGE_KEY) || "{}");
    } catch (error) {
      throw new Error("本地 Cookie 数据不是有效 JSON");
    }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      throw new Error("本地 Cookie 数据格式错误");
    }
    const configured = $persistentStore.read(PLAN_KEY);
    const plan = Object.prototype.hasOwnProperty.call(PLANS, configured) ? configured : "plan500";
    const lines = [];
    for (const domain of DOMAINS) {
      const accounts = accountsFor(stored[domain]);
      if (!accounts.length) {
        lines.push(`${domain}: 未保存 Cookie`);
        continue;
      }
      for (const [index, cookie] of accounts.entries()) {
        try {
          lines.push(await runAccount(domain, cookie, index, plan));
        } catch (error) {
          lines.push(`${domain} #${index + 1}: 运行失败: ${error}`);
        }
      }
    }
    console.log(lines.join("\n"));
    $notification.post("GLaDOS / Railgun 签到", "", lines.join("\n"));
  } catch (error) {
    console.log("GLaDOS / Railgun: " + error);
    $notification.post("GLaDOS / Railgun 签到失败", "", String(error));
  } finally {
    $done();
  }
}

main();
