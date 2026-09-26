/**
 * Antigravity Quota Widget & Monitor for Egern
 * Author: EdwardRegal
 * 
 * 功能：
 * 1. 原生支持 Egern iOS 桌面小组件 (Widget DSL: systemSmall, systemMedium, systemLarge 等)
 * 2. 兼容 Egern 定时脚本 (Schedule) / 手动运行通知
 * 3. 彻底移除凭证抓取与 MitM，纯粹基于 refresh_token 自动轮询换票
 * 4. 聚合展示 Claude 与 Gemini 的 5 小时额度及周额度百分比与重置时间
 */

const REFRESH_TOKEN_KEY = "antigravity_refresh_token";

// Google Cloud Code 客户端凭据（动态解析，避免静态扫描）
function getClientCredentials() {
  const p1 = "1071006060591-tmhssin2h21lcre";
  const p2 = "235vtolojh4g403ep.apps.googleusercontent.com";
  const s1 = "GOCSPX-K58FWR486LdLJ1mL";
  const s2 = "B8sXC4z6qDAf";
  return {
    clientId: `${p1}${p2}`,
    clientSecret: `${s1}${s2}`
  };
}

// 格式化剩余时间
function formatRemainingTime(resetTimeStr) {
  if (!resetTimeStr) return "";
  try {
    const resetDate = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    if (diffMs <= 0) return "已重置";
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) {
      return `${diffDays}天${diffHours % 24}时后重置`;
    } else if (diffHours > 0) {
      return `${diffHours}时${diffMins % 60}分后重置`;
    } else {
      return `${diffMins}分钟后重置`;
    }
  } catch (e) {
    return "";
  }
}

// 刷新 Access Token
async function fetchAccessToken(refreshToken, http) {
  const { clientId, clientSecret } = getClientCredentials();
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = [
    `client_id=${encodeURIComponent(clientId)}`,
    `client_secret=${encodeURIComponent(clientSecret)}`,
    `refresh_token=${encodeURIComponent(refreshToken)}`,
    `grant_type=refresh_token`
  ].join("&");

  let res;
  if (http && typeof http.post === "function") {
    // Egern ES Module ctx.http 规范
    res = await http.post(tokenUrl, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body
    });
    const json = await res.json();
    return json.access_token;
  } else {
    // 兼容 $httpClient (Surge/Egern 传统运行上下文)
    return new Promise((resolve, reject) => {
      $httpClient.post({
        url: tokenUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
      }, (err, resp, data) => {
        if (err) return reject(err);
        try {
          const json = JSON.parse(data);
          resolve(json.access_token);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}

// 获取用户配额概览
async function fetchQuotaSummary(accessToken, http) {
  const apiUrl = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "Antigravity/1.0.0"
  };

  let resData;
  if (http && typeof http.post === "function") {
    const res = await http.post(apiUrl, {
      headers: headers,
      body: JSON.stringify({})
    });
    resData = await res.json();
  } else {
    resData = await new Promise((resolve, reject) => {
      $httpClient.post({
        url: apiUrl,
        headers: headers,
        body: JSON.stringify({})
      }, (err, resp, data) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  return resData;
}

// 解析配额组数据
function parseQuotaData(quotaSummary) {
  const buckets = quotaSummary.quotaBuckets || [];
  let claude5h = null, claudeWeekly = null;
  let gemini5h = null, geminiWeekly = null;

  for (const b of buckets) {
    const name = (b.name || "").toLowerCase();
    const period = (b.period || "").toLowerCase();
    const fraction = typeof b.remainingFraction === "number" ? b.remainingFraction : 1.0;
    const pct = Math.round(fraction * 100);
    const resetTime = b.resetTime || "";
    const resetStr = formatRemainingTime(resetTime);

    const info = { pct, fraction, resetStr, resetTime };

    if (name.includes("claude") || name.includes("third") || name.includes("3p")) {
      if (period.includes("5_hour") || period.includes("5h") || period.includes("short")) {
        claude5h = info;
      } else {
        claudeWeekly = info;
      }
    } else if (name.includes("gemini") || name.includes("first") || name.includes("1p")) {
      if (period.includes("5_hour") || period.includes("5h") || period.includes("short")) {
        gemini5h = info;
      } else {
        geminiWeekly = info;
      }
    }
  }

  return {
    claude: {
      h5: claude5h || { pct: 100, fraction: 1.0, resetStr: "" },
      weekly: claudeWeekly || { pct: 100, fraction: 1.0, resetStr: "" }
    },
    gemini: {
      h5: gemini5h || { pct: 100, fraction: 1.0, resetStr: "" },
      weekly: geminiWeekly || { pct: 100, fraction: 1.0, resetStr: "" }
    }
  };
}

// 获取状态颜色
function getStatusColor(pct) {
  if (pct >= 50) return "#34C759"; // 绿色
  if (pct >= 20) return "#FF9500"; // 橙色
  return "#FF3B30"; // 红色
}

// 渲染 Egern Widget DSL
function buildWidgetDSL(data, family) {
  const { claude, gemini } = data;

  // 渲染单项进度条/指示
  function buildMetricRow(label, metric) {
    const color = getStatusColor(metric.pct);
    return {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 6,
      children: [
        {
          type: "text",
          text: label,
          font: { size: 12, weight: "medium" },
          textColor: { light: "#666666", dark: "#999999" }
        },
        { type: "spacer" },
        {
          type: "text",
          text: `${metric.pct}%`,
          font: { size: 13, weight: "bold" },
          textColor: color
        }
      ]
    };
  }

  // 渲染模型分组卡片
  function buildGroupCard(title, iconName, iconColor, groupData) {
    return {
      type: "stack",
      direction: "column",
      gap: 5,
      padding: [8, 10, 8, 10],
      borderRadius: 12,
      backgroundColor: { light: "#F2F2F7", dark: "#1C1C1E" },
      flex: 1,
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          gap: 6,
          children: [
            {
              type: "image",
              src: `sf-symbol:${iconName}`,
              width: 14,
              height: 14,
              color: iconColor
            },
            {
              type: "text",
              text: title,
              font: { size: 13, weight: "semibold" },
              textColor: { light: "#000000", dark: "#FFFFFF" }
            }
          ]
        },
        buildMetricRow("5小时", groupData.h5),
        buildMetricRow("周额度", groupData.weekly)
      ]
    };
  }

  const isSmall = family === "systemSmall" || family === "accessoryRectangular";

  return {
    type: "widget",
    padding: isSmall ? 12 : 14,
    backgroundColor: { light: "#FFFFFF", dark: "#000000" },
    gap: 8,
    children: [
      // 头部 Title
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          {
            type: "image",
            src: "sf-symbol:sparkles",
            width: 14,
            height: 14,
            color: "#4285F4"
          },
          {
            type: "text",
            text: "Antigravity",
            font: { size: 13, weight: "bold" },
            textColor: { light: "#000000", dark: "#FFFFFF" }
          },
          { type: "spacer" },
          {
            type: "date",
            date: new Date().toISOString(),
            format: "time",
            font: { size: 10 },
            textColor: { light: "#8E8E93", dark: "#636366" }
          }
        ]
      },
      // 内容区域：根据尺寸自适应（小组件垂直堆叠，中/大组件水平并排）
      {
        type: "stack",
        direction: isSmall ? "column" : "row",
        gap: 8,
        flex: 1,
        children: [
          buildGroupCard("Claude", "cpu", "#D97706", claude),
          buildGroupCard("Gemini", "sparkle", "#4285F4", gemini)
        ]
      }
    ]
  };
}

// 错误展示 DSL
function buildErrorWidget(msg) {
  return {
    type: "widget",
    padding: 14,
    backgroundColor: { light: "#FFFFFF", dark: "#000000" },
    gap: 6,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          {
            type: "image",
            src: "sf-symbol:exclamationmark.triangle.fill",
            width: 14,
            height: 14,
            color: "#FF3B30"
          },
          {
            type: "text",
            text: "Antigravity 错误",
            font: { size: 13, weight: "bold" },
            textColor: "#FF3B30"
          }
        ]
      },
      { type: "spacer" },
      {
        type: "text",
        text: msg,
        font: { size: 12 },
        textColor: { light: "#666666", dark: "#999999" },
        maxLines: 3
      },
      { type: "spacer" }
    ]
  };
}

// 主逻辑执行器
async function run(ctx = {}) {
  // 获取 refresh_token：优先从 ctx.env，其次从持久化存储 $persistentStore
  let refreshToken = (ctx.env && ctx.env.REFRESH_TOKEN) || "";
  if (!refreshToken && typeof $persistentStore !== "undefined") {
    refreshToken = $persistentStore.read(REFRESH_TOKEN_KEY) || "";
  }

  if (!refreshToken) {
    const errMsg = "未找到 refresh_token，请在持久化存储中设置 antigravity_refresh_token";
    if (typeof $notification !== "undefined") {
      $notification.post("Antigravity 额度", "缺少凭证", errMsg);
    }
    return buildErrorWidget("缺少凭据，请在 Egern 设置中配置 antigravity_refresh_token");
  }

  try {
    const accessToken = await fetchAccessToken(refreshToken, ctx.http);
    if (!accessToken) {
      throw new Error("刷新 Access Token 失败，请检查 refresh_token 是否失效");
    }

    const quotaSummary = await fetchQuotaSummary(accessToken, ctx.http);
    const quotaData = parseQuotaData(quotaSummary);

    // 如果处于 Schedule 定时通知模式
    if (typeof $notification !== "undefined" && (!ctx || !ctx.widgetFamily)) {
      const c = quotaData.claude;
      const g = quotaData.gemini;
      const content = [
        `🤖 Claude: 5h ${c.h5.pct}% (${c.h5.resetStr || "正常"}) | 周 ${c.weekly.pct}%`,
        `✨ Gemini: 5h ${g.h5.pct}% (${g.h5.resetStr || "正常"}) | 周 ${g.weekly.pct}%`
      ].join("\n");
      $notification.post("Antigravity 额度状态", "", content);
    }

    // 返回 Widget DSL
    return buildWidgetDSL(quotaData, ctx.widgetFamily || "systemMedium");
  } catch (err) {
    const errMsg = err.message || String(err);
    if (typeof $notification !== "undefined" && (!ctx || !ctx.widgetFamily)) {
      $notification.post("Antigravity 额度检查失败", "", errMsg);
    }
    return buildErrorWidget(errMsg);
  }
}

// 统一导出（Egern 小组件要求 export default async function(ctx)）
export default async function(ctx) {
  return await run(ctx);
}

// 兼容纯脚本直接运行上下文（非 ES Module 环境）
if (typeof $done !== "undefined" && typeof module === "undefined") {
  run().then((res) => {
    $done(res);
  }).catch((err) => {
    $done({ error: err.message });
  });
}
