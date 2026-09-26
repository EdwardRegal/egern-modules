/**
 * Antigravity Quota Widget for Egern (Canvas 绘制)
 * Author: EdwardRegal
 * 
 * 环境变量（在小组件或脚本配置中设置）：
 * - REFRESH_TOKEN 或 TOKEN: Antigravity (Google OAuth) 的长效 refresh_token
 * 
 * 配置示例（在 Egern 脚本或 widgets 配置中）：
 * widgets:
 *   - name: "Antigravity 额度"
 *     script_name: "antigravity_quota_widget"
 *     env:
 *       REFRESH_TOKEN: "1//06jc..."
 */

export default async function(ctx) {
  // 1. 严格从环境变量 (ctx.env) 获取 refresh_token
  const env = ctx.env || {};
  const refreshToken = (env.REFRESH_TOKEN || env.TOKEN || env.refresh_token || '').trim();

  // 若未在环境变量配置 Token，渲染提示卡片
  if (!refreshToken) {
    return renderErrorWidget("未配置环境变量", "请在小组件/脚本环境变量中设置 REFRESH_TOKEN");
  }

  try {
    // 2. 换取 Access Token
    const accessToken = await refreshAccessToken(ctx, refreshToken);

    // 3. 获取配额数据
    const quotaData = await fetchQuotaSummary(ctx, accessToken);

    // 4. 解析 Claude 与 Gemini 的 5h 与周额度
    const parsed = parseQuotas(quotaData);

    // 5. 渲染 Canvas UI（适配 systemSmall 与 systemMedium）
    const widgetFamily = ctx.widgetFamily || 'systemMedium';
    const isSmall = widgetFamily === 'systemSmall';

    const dataUri = await renderCanvasWidget(parsed, isSmall);

    // 下次刷新时间：15分钟后
    const refreshAfter = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    return {
      type: 'widget',
      refreshAfter: refreshAfter,
      backgroundImage: dataUri,
      padding: 0,
      children: []
    };

  } catch (err) {
    return renderErrorWidget("获取配额失败", err.message || String(err));
  }
}

/**
 * 换取 Access Token
 */
async function refreshAccessToken(ctx, refreshToken) {
  const c1 = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep" + ".apps.googleusercontent.com";
  const c2 = "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";

  const bodyParams = [
    `client_id=${encodeURIComponent(c1)}`,
    `client_secret=${encodeURIComponent(c2)}`,
    `refresh_token=${encodeURIComponent(refreshToken)}`,
    `grant_type=refresh_token`
  ].join('&');

  const resp = await (ctx.http ? ctx.http.post : fetch)('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: bodyParams
  });

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "Token 刷新失败");
  }
  return data.access_token;
}

/**
 * 查询配额汇总 (仅提取汇总配额)
 */
async function fetchQuotaSummary(ctx, accessToken) {
  const resp = await (ctx.http ? ctx.http.post : fetch)('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity-cli/0.1.0'
    },
    body: '{}'
  });

  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error.message || "配额接口返回错误");
  }
  return data;
}

/**
 * 解析配额分组（只取 Claude/3P 与 Gemini）
 */
function parseQuotas(data) {
  const groups = data.quotaGroups || [];
  
  let claudeGroup = null;
  let geminiGroup = null;

  for (const g of groups) {
    const name = (g.name || '').toLowerCase();
    if (name.includes('claude') || name.includes('3p')) {
      claudeGroup = g;
    } else if (name.includes('gemini')) {
      geminiGroup = g;
    }
  }

  return {
    claude: extractGroupQuota(claudeGroup, "Claude / 3P"),
    gemini: extractGroupQuota(geminiGroup, "Gemini")
  };
}

function extractGroupQuota(group, defaultTitle) {
  if (!group || !group.quotas) {
    return {
      title: defaultTitle,
      h5: { percent: 100, resetText: "—" },
      weekly: { percent: 100, resetText: "—" }
    };
  }

  let h5 = { percent: 100, resetText: "—" };
  let weekly = { percent: 100, resetText: "—" };

  for (const q of group.quotas) {
    const dur = (q.duration || '').toLowerCase();
    const frac = q.remainingFraction != null ? q.remainingFraction : 1.0;
    const pct = Math.round(frac * 100);
    const resetTime = q.resetTime ? formatResetTime(q.resetTime) : "—";

    if (dur.includes('18000s') || dur.includes('5h')) {
      h5 = { percent: pct, resetText: resetTime };
    } else if (dur.includes('604800s') || dur.includes('7d') || dur.includes('week')) {
      weekly = { percent: pct, resetText: resetTime };
    }
  }

  return {
    title: defaultTitle,
    h5: h5,
    weekly: weekly
  };
}

function formatResetTime(isoStr) {
  try {
    const target = new Date(isoStr).getTime();
    const now = Date.now();
    const diff = target - now;
    if (diff <= 0) return "已重置";
    const mins = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;

    if (days > 0) return `${days}天${remHours}h`;
    if (hours > 0) return `${hours}h${remMins}m`;
    return `${mins}m`;
  } catch (e) {
    return "—";
  }
}

/**
 * Canvas 离屏绘制
 */
async function renderCanvasWidget(parsed, isSmall) {
  const W = isSmall ? 180 : 380;
  const H = 180;
  const DPR = 3;

  const canvas = new OffscreenCanvas(W * DPR, H * DPR);
  const cx = canvas.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.scale(DPR, DPR);

  // 背景底色
  const bgGrad = cx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#13151b');
  bgGrad.addColorStop(1, '#1a1d26');
  cx.fillStyle = bgGrad;
  cx.fillRect(0, 0, W, H);

  // 顶部微光
  const glowGrad = cx.createRadialGradient(W / 2, -20, 10, W / 2, 50, W);
  glowGrad.addColorStop(0, 'rgba(66, 133, 244, 0.12)');
  glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  cx.fillStyle = glowGrad;
  cx.fillRect(0, 0, W, H);

  const SYS = '-apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const MONO = '"SF Mono", Menlo, monospace';

  if (isSmall) {
    // ----------------------------------------
    // Small 尺寸 (180x180)
    // ----------------------------------------
    cx.fillStyle = '#8e9aa8';
    cx.font = '600 12px ' + SYS;
    cx.textAlign = 'left';
    cx.fillText("ANTIGRAVITY", 16, 26);

    const nowStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    cx.textAlign = 'right';
    cx.font = '500 10px ' + MONO;
    cx.fillStyle = '#5c6675';
    cx.fillText(nowStr, W - 16, 26);

    drawCompactCard(cx, 16, 38, W - 32, 58, "Claude 3P", parsed.claude, '#d97706');
    drawCompactCard(cx, 16, 104, W - 32, 58, "Gemini", parsed.gemini, '#2563eb');

  } else {
    // ----------------------------------------
    // Medium 尺寸 (380x180)
    // ----------------------------------------
    cx.fillStyle = '#8e9aa8';
    cx.font = '600 13px ' + SYS;
    cx.textAlign = 'left';
    cx.fillText("ANTIGRAVITY QUOTA", 20, 26);

    const nowStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    cx.textAlign = 'right';
    cx.font = '500 11px ' + MONO;
    cx.fillStyle = '#64748b';
    cx.fillText("更新于 " + nowStr, W - 20, 26);

    const colW = (W - 40 - 14) / 2;
    const colH = 126;
    const startY = 38;

    drawMediumColumn(cx, 20, startY, colW, colH, "Claude / 3P", parsed.claude, '#ea580c');
    drawMediumColumn(cx, 20 + colW + 14, startY, colW, colH, "Gemini", parsed.gemini, '#3b82f6');
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:image/png;base64,' + btoa(binary);
}

function drawMediumColumn(cx, x, y, w, h, title, data, themeColor) {
  const SYS = '-apple-system, system-ui, sans-serif';
  const MONO = '"SF Mono", Menlo, monospace';

  cx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  roundRect(cx, x, y, w, h, 12);
  cx.fill();

  cx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  cx.lineWidth = 1;
  cx.stroke();

  cx.fillStyle = themeColor;
  roundRectTop(cx, x, y, w, 3, 12);
  cx.fill();

  cx.font = '600 13px ' + SYS;
  cx.fillStyle = '#f1f5f9';
  cx.textAlign = 'left';
  cx.fillText(title, x + 12, y + 24);

  drawQuotaRow(cx, x + 12, y + 40, w - 24, "5小时", data.h5.percent, data.h5.resetText);

  cx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  cx.beginPath();
  cx.moveTo(x + 12, y + 78);
  cx.lineTo(x + w - 12, y + 78);
  cx.stroke();

  drawQuotaRow(cx, x + 12, y + 86, w - 24, "周额度", data.weekly.percent, data.weekly.resetText);
}

function drawQuotaRow(cx, x, y, w, label, pct, resetText) {
  const SYS = '-apple-system, system-ui, sans-serif';
  const MONO = '"SF Mono", Menlo, monospace';

  cx.font = '500 11px ' + SYS;
  cx.fillStyle = '#94a3b8';
  cx.textAlign = 'left';
  cx.fillText(label, x, y + 12);

  const color = getPercentColor(pct);
  cx.font = '700 13px ' + MONO;
  cx.fillStyle = color;
  cx.textAlign = 'right';
  cx.fillText(pct + "%", x + w, y + 12);

  const barY = y + 18;
  const barH = 5;
  cx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  roundRect(cx, x, barY, w, barH, 3);
  cx.fill();

  const fillW = Math.max(4, Math.round(w * (pct / 100)));
  cx.fillStyle = color;
  roundRect(cx, x, barY, fillW, barH, 3);
  cx.fill();

  cx.font = '400 9px ' + SYS;
  cx.fillStyle = '#64748b';
  cx.textAlign = 'left';
  cx.fillText(`重置: ${resetText}`, x, y + 33);
}

function drawCompactCard(cx, x, y, w, h, title, data, themeColor) {
  const SYS = '-apple-system, system-ui, sans-serif';
  const MONO = '"SF Mono", Menlo, monospace';

  cx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  roundRect(cx, x, y, w, h, 10);
  cx.fill();

  cx.fillStyle = themeColor;
  roundRectLeft(cx, x, y, 3, h, 10);
  cx.fill();

  cx.font = '600 11px ' + SYS;
  cx.fillStyle = '#e2e8f0';
  cx.textAlign = 'left';
  cx.fillText(title, x + 10, y + 16);

  const c5 = getPercentColor(data.h5.percent);
  cx.font = '600 11px ' + MONO;
  cx.fillStyle = c5;
  cx.textAlign = 'right';
  cx.fillText(`${data.h5.percent}%`, x + w - 8, y + 16);

  const barY = y + 22;
  const barW = w - 18;
  cx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  roundRect(cx, x + 10, barY, barW, 4, 2);
  cx.fill();

  cx.fillStyle = c5;
  roundRect(cx, x + 10, barY, Math.max(3, barW * (data.h5.percent / 100)), 4, 2);
  cx.fill();

  const cw = getPercentColor(data.weekly.percent);
  cx.font = '400 9px ' + SYS;
  cx.fillStyle = '#94a3b8';
  cx.textAlign = 'left';
  cx.fillText("周: " + data.weekly.percent + "%", x + 10, y + 42);

  cx.textAlign = 'right';
  cx.font = '400 9px ' + SYS;
  cx.fillStyle = '#64748b';
  cx.fillText(data.h5.resetText, x + w - 8, y + 42);
}

function getPercentColor(pct) {
  if (pct >= 50) return '#10b981';
  if (pct >= 20) return '#f59e0b';
  return '#ef4444';
}

function roundRect(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
}

function roundRectTop(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.lineTo(x + w - r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.lineTo(x + w, y + h);
  cx.lineTo(x, y + h);
  cx.lineTo(x, y + r);
  cx.arcTo(x, y, x + r, y, r);
  cx.closePath();
}

function roundRectLeft(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x, y, x + w, y, r);
  cx.lineTo(x + w, y);
  cx.lineTo(x + w, y + h);
  cx.lineTo(x, y + h);
  cx.arcTo(x, y + h, x, y + h - r, r);
  cx.closePath();
}

async function renderErrorWidget(title, subtitle) {
  const W = 380, H = 180, DPR = 3;
  const canvas = new OffscreenCanvas(W * DPR, H * DPR);
  const cx = canvas.getContext('2d');
  cx.scale(DPR, DPR);

  cx.fillStyle = '#1c1917';
  cx.fillRect(0, 0, W, H);

  cx.fillStyle = '#ef4444';
  cx.font = 'bold 15px -apple-system, sans-serif';
  cx.textAlign = 'center';
  cx.fillText(title, W / 2, H / 2 - 8);

  cx.fillStyle = '#a8a29e';
  cx.font = '12px -apple-system, sans-serif';
  cx.fillText(subtitle, W / 2, H / 2 + 16);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const dataUri = 'data:image/png;base64,' + btoa(binary);

  return {
    type: 'widget',
    backgroundImage: dataUri,
    padding: 0,
    children: []
  };
}
