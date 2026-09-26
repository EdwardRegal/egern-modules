/**
 * Antigravity Quota Monitor for Egern
 * Author: EdwardRegal
 * 
 * 功能：
 * 1. 利用 Refresh Token 自动向 Google OAuth 换取 Access Token；
 * 2. 请求 cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary 获取配额分组；
 * 3. 提取 Gemini 和 Claude/第三方模型分组的「5小时额度」与「周额度」；
 * 4. 支持 Egern Panel (组件面板) 与定时通知 (Schedule)。
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
        if (error) return reject(error);
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

function fetchQuotaSummary(accessToken) {
  return new Promise((resolve, reject) => {
    const url = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
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
        if (error) return reject(error);
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
    if (diffMs <= 0) return "已重置";
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffDays > 0) {
      return `${diffDays}天${diffHours}小时后重置`;
    }
    if (diffHours > 0) {
      return `${diffHours}小时${diffMins}分后重置`;
    }
    return `${diffMins}分钟后重置`;
  } catch (e) {
    return "";
  }
}

function getProgressIcon(percent) {
  if (percent <= 20) return "🔴";
  if (percent <= 50) return "🟡";
  return "🟢";
}

async function main() {
  const isPanel = typeof $panel !== "undefined";

  try {
    let accessToken = getStore("antigravity_access_token");
    const refreshTokenValue = getStore("antigravity_refresh_token");

    if (refreshTokenValue) {
      try {
        accessToken = await refreshToken(refreshTokenValue);
        setStore("antigravity_access_token", accessToken);
      } catch (err) {
        console.log("Token refresh failed: " + err);
      }
    }

    if (!accessToken) {
      const errMsg = "未找到凭据，请在 Persistent Store 填入 antigravity_refresh_token";
      if (isPanel) {
        $panel.set({
          title: "Antigravity Quota",
          content: errMsg,
          icon: "exclamationmark.triangle"
        });
      } else {
        notify("Antigravity 额度", "未配置凭据", errMsg);
      }
      return $done({});
    }

    let res = await fetchQuotaSummary(accessToken);

    if (res.error && res.error.code === 401 && refreshTokenValue) {
      accessToken = await refreshToken(refreshTokenValue);
      setStore("antigravity_access_token", accessToken);
      res = await fetchQuotaSummary(accessToken);
    }

    if (res.error) {
      const errDetail = res.error.message || `Code ${res.error.code}`;
      if (isPanel) {
        $panel.set({
          title: "Antigravity Quota",
          content: `查询失败: ${errDetail}`,
          icon: "xmark.circle"
        });
      } else {
        notify("Antigravity 查询失败", "API 报错", errDetail);
      }
      return $done({});
    }

    const groups = res.groups || [];
    let claudeInfo = { h5: null, weekly: null };
    let geminiInfo = { h5: null, weekly: null };

    for (const g of groups) {
      const name = (g.displayName || "").toLowerCase();
      const isClaudeGroup = name.includes("claude") || name.includes("gpt");
      const isGeminiGroup = name.includes("gemini");
      const target = isClaudeGroup ? claudeInfo : isGeminiGroup ? geminiInfo : null;

      if (!target) continue;

      for (const b of g.buckets || []) {
        const fraction = typeof b.remainingFraction === "number" ? b.remainingFraction : 1;
        const percent = Math.round(fraction * 100);
        const resetDesc = formatRelativeReset(b.resetTime);
        const data = { percent, resetDesc, icon: getProgressIcon(percent) };

        if (b.window === "5h") {
          target.h5 = data;
        } else if (b.window === "weekly") {
          target.weekly = data;
        }
      }
    }

    // 构建展示文本
    const lines = [];

    // Claude / 3P
    if (claudeInfo.h5 || claudeInfo.weekly) {
      lines.push("🤖 Claude / 3P");
      if (claudeInfo.h5) {
        lines.push(`  ${claudeInfo.h5.icon} 5小时: ${claudeInfo.h5.percent}% (${claudeInfo.h5.resetDesc})`);
      }
      if (claudeInfo.weekly) {
        lines.push(`  ${claudeInfo.weekly.icon} 周额度: ${claudeInfo.weekly.percent}% (${claudeInfo.weekly.resetDesc})`);
      }
    }

    // Gemini
    if (geminiInfo.h5 || geminiInfo.weekly) {
      if (lines.length > 0) lines.push("");
      lines.push("✨ Gemini");
      if (geminiInfo.h5) {
        lines.push(`  ${geminiInfo.h5.icon} 5小时: ${geminiInfo.h5.percent}% (${geminiInfo.h5.resetDesc})`);
      }
      if (geminiInfo.weekly) {
        lines.push(`  ${geminiInfo.weekly.icon} 周额度: ${geminiInfo.weekly.percent}% (${geminiInfo.weekly.resetDesc})`);
      }
    }

    const outputContent = lines.join("\n");

    if (isPanel) {
      $panel.set({
        title: "Antigravity Quota",
        content: outputContent,
        icon: "sparkles"
      });
    } else {
      notify("Antigravity 额度状态", "Claude & Gemini 配额概览", outputContent);
    }
  } catch (e) {
    const errStr = String(e && e.message ? e.message : e);
    if (isPanel) {
      $panel.set({
        title: "Antigravity Quota",
        content: `运行出错: ${errStr}`,
        icon: "exclamationmark.circle"
      });
    } else {
      notify("Antigravity 异常", "执行失败", errStr);
    }
  } finally {
    $done({});
  }
}

main();
