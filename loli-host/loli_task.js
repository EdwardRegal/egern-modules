/**
 * LOLI Labs (https://loli.host) 每日定时签到脚本
 * 适用环境: Egern
 */

const STORAGE_KEY = "LOLI_HOST_TOKEN";
const BASE_URL = "https://labs-api.loli.host/api/v1";
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";

function request(path, method = "GET", body = undefined) {
  return new Promise((resolve) => {
    const token = $persistentStore.read(STORAGE_KEY);
    if (!token) {
      resolve({ error: "NO_TOKEN" });
      return;
    }

    const options = {
      url: `${BASE_URL}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      timeout: 15000,
    };

    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const httpMethod = method.toLowerCase();
    $httpClient[httpMethod](options, (error, response, data) => {
      if (error || !response || (response.status || response.statusCode) >= 400) {
        const status = response && (response.status || response.statusCode);
        resolve({
          error: error ? String(error) : `HTTP ${status || "unknown"}`,
          status,
        });
        return;
      }
      try {
        resolve({ data: JSON.parse(data) });
      } catch (parseError) {
        resolve({ error: "返回数据不是有效的 JSON" });
      }
    });
  });
}

async function checkin() {
  try {
    const token = $persistentStore.read(STORAGE_KEY);
    if (!token) {
      $notification.post(
        "LOLI Labs 签到失败",
        "未找到 Token",
        "请在浏览器中打开并登录 https://loli.host 以自动抓取 Token。"
      );
      return;
    }

    // 1. 查询签到状态
    const statusRes = await request("/signin/status", "GET");
    if (statusRes.error) {
      if (statusRes.status === 401 || (statusRes.data && statusRes.data.code === 40100)) {
        $notification.post(
          "LOLI Labs 签到失败",
          "Token 已过期",
          "登录凭据已失效，请重新登录 https://loli.host 更新 Token。"
        );
      } else {
        $notification.post("LOLI Labs 签到状态查询异常", "", statusRes.error);
      }
      return;
    }

    const statusData = statusRes.data;
    const isSigned = !!(statusData.data?.signed_today || statusData.data?.signed || statusData.data?.has_signed);
    let signMsg = "";

    if (isSigned) {
      signMsg = `今日已签到 ✓ (连续 ${statusData.data?.total_days || 0} 天)`;
    } else {
      // 2. 执行签到
      const signRes = await request("/signin", "POST", {});
      if (signRes.error) {
        $notification.post("LOLI Labs 签到请求失败", "", signRes.error);
        return;
      }

      const res = signRes.data;
      if (res.code === 0) {
        const gained = res.data?.primogems ?? 0;
        const totalDays = res.data?.total_days ?? res.data?.days ?? 0;
        signMsg = `🎉 签到成功！+${gained} 原石 (连续 ${totalDays} 天)`;
      } else if (res.code === 42003) {
        signMsg = `今日已经签到过啦 ✓`;
      } else {
        signMsg = `签到失败: ${res.message || "未知原因"}`;
      }
    }

    // 3. 查询当前资产
    let assetMsg = "";
    const walletRes = await request("/wallet", "GET");
    if (walletRes.data && walletRes.data.code === 0 && walletRes.data.data) {
      const w = walletRes.data.data;
      assetMsg = `💎 原石: ${w.primogems ?? 0} | ✨ 星尘: ${w.stardust ?? 0} | 🌌 星穹: ${w.stellar ?? 0}`;
    }

    $notification.post(
      "LOLI Labs 每日签到",
      signMsg,
      assetMsg ? `当前资产:\n${assetMsg}` : ""
    );
  } catch (err) {
    console.log("LOLI Labs checkin task error: " + err);
    $notification.post("LOLI Labs 任务执行异常", "", String(err));
  } finally {
    $done();
  }
}

checkin();
