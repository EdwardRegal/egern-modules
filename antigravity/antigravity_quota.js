/**
 * Antigravity Quota Monitor for Egern
 * Author: EdwardRegal
 * 
 * 功能：
 * 1. 自动利用配置好的 Refresh Token 向 Google OAuth 刷新长期凭据；
 * 2. 请求 cloudcode-pa.googleapis.com 获取 Antigravity/Google AI Pro 的实时额度；
 * 3. 格式化输出 Gemini 与 Claude 等模型的剩余百分比与重置时间并发送系统通知。
 */

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_SECRET_PART = ["GOCSPX", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("-");

function getStore(key) {
  return typeof $persistentStore !== "undefined" ? $persistentStore.read(key) : null;
}

function setStore(key, value) {
  if (typeof $persistentStore !== "undefined") {
    $persistentStore.write(value, key);
  }
}

function notify(title, subtitle, message) {
  if (typeof $notification !== "undefined") {
    $notification.post(title, subtitle, message);
  } else {
    console.log(`[${title}] ${subtitle} - ${message}`);
  }
}

function refreshToken(refreshTokenValue) {
  return new Promise((resolve, reject) => {
    const url = "https://oauth2.googleapis.com/token";
    const body = `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET_PART}&refresh_token=${encodeURIComponent(
      refreshTokenValue
    )}&grant_type=refresh_token`;

    $httpClient.post(
      {
        url: url,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "antigravity"
        },
        body: body
      },
      (error, response, data) => {
        if (error) {
          return reject(error);
        }
        try {
          const res = JSON.parse(data);
          if (res.access_token) {
            resolve(res.access_token);
          } else {
            reject(new Error(res.error_description || res.error || "Token refresh failed"));
          }
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function fetchModelsQuota(accessToken) {
  return new Promise((resolve, reject) => {
    const url = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
    $httpClient.post(
      {
        url: url,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "antigravity"
        },
        body: JSON.stringify({})
      },
      (error, response, data) => {
        if (error) {
          return reject(error);
        }
        try {
          const res = JSON.parse(data);
          resolve(res);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function formatRelativeReset(resetTimeStr) {
  if (!resetTimeStr) return "";
  try {
    const resetDate = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    if (diffMs <= 0) return "即将重置";
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffHours > 0) {
      return `${diffHours}小时${diffMins}分后重置`;
    }
    return `${diffMins}分钟后重置`;
  } catch (e) {
    return "";
  }
}

async function main() {
  const isHttp = typeof $request !== "undefined";

  // 1. 如果通过网络请求拦截捕获了 Bearer token
  if (isHttp) {
    const authHeader = $request.headers["Authorization"] || $request.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      setStore("antigravity_access_token", token);
      notify("Antigravity 凭证抓取成功", "已保存当前会话 Access Token", "定时检查将直接使用该凭证查询额度");
    }
    return $done({});
  }

  // 2. 定时 / 面板执行查询
  try {
    let accessToken = getStore("antigravity_access_token");
    const refreshTokenValue = getStore("antigravity_refresh_token");

    // 若配置了长效 refresh_token，直接换取最新的 access_token
    if (refreshTokenValue) {
      try {
        accessToken = await refreshToken(refreshTokenValue);
        setStore("antigravity_access_token", accessToken);
      } catch (err) {
        console.log("Refresh token failed, fallback to cached access token: " + err);
      }
    }

    if (!accessToken) {
      notify(
        "Antigravity 额度查询未就绪",
        "未找到登录凭据",
        "请在 Egern 设置中写入 antigravity_refresh_token 持久化变量。"
      );
      return $done({});
    }

    let quotaData = await fetchModelsQuota(accessToken);

    // 如果 401 且有 refresh_token，再次尝试刷新
    if (quotaData.error && quotaData.error.code === 401 && refreshTokenValue) {
      accessToken = await refreshToken(refreshTokenValue);
      setStore("antigravity_access_token", accessToken);
      quotaData = await fetchModelsQuota(accessToken);
    }

    if (quotaData.error) {
      notify("Antigravity 查询失败", `API 错误 (${quotaData.error.code})`, quotaData.error.message);
      return $done({});
    }

    const rawModels = quotaData.models || {};
    const modelList = Array.isArray(rawModels)
      ? rawModels
      : Object.keys(rawModels).map((k) => Object.assign({ id: k }, rawModels[k]));

    const quotaList = [];
    for (const m of modelList) {
      const q = m.quotaInfo;
      if (q && typeof q.remainingFraction !== "undefined") {
        const percent = Math.round(q.remainingFraction * 100);
        const name = m.displayName || m.name || m.id;
        const resetDesc = formatRelativeReset(q.resetTime);
        quotaList.push({
          name: name,
          percent: percent,
          resetDesc: resetDesc,
          resetTime: q.resetTime
        });
      }
    }

    if (quotaList.length === 0) {
      notify("Antigravity 额度状态", "未获取到模型配额信息", "当前账号无活动配额或模型列表为空");
      return $done({});
    }

    // 优先显示 Claude 和主力 Gemini
    const primaryKeywords = ["Claude", "Gemini 3.1 Pro", "Gemini 3.7", "Gemini 3.6 Flash"];
    quotaList.sort((a, b) => {
      const aIsPri = primaryKeywords.some((k) => a.name.includes(k));
      const bIsPri = primaryKeywords.some((k) => b.name.includes(k));
      if (aIsPri && !bIsPri) return -1;
      if (!aIsPri && bIsPri) return 1;
      return a.percent - b.percent;
    });

    const lines = quotaList.slice(0, 5).map((item) => {
      let icon = "🟢";
      if (item.percent <= 20) icon = "🔴";
      else if (item.percent <= 50) icon = "🟡";
      return `${icon} ${item.name}: ${item.percent}% (${item.resetDesc || "正常"})`;
    });

    const summaryText = lines.join("\n");
    notify("Antigravity 额度状态", `已监控 ${quotaList.length} 个模型`, summaryText);
  } catch (err) {
    notify("Antigravity 查询异常", "执行失败", String(err && err.message ? err.message : err));
  } finally {
    $done({});
  }
}

main();
