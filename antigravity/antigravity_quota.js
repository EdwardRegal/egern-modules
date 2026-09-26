/** Antigravity 配额 · Egern 小组件（Canvas 液态玻璃视觉）
 * 小组件环境变量：REFRESH_TOKEN（也兼容 TOKEN / refresh_token）
 * 说明：Canvas 中的玻璃高光是视觉模拟；iOS 壁纸实时折射须由系统原生材质提供。
 */
export default async function (ctx) {
  const env = (ctx && ctx.env) || {};
  const arg = ctx && ctx.argument;
  const raw = env.REFRESH_TOKEN || env.TOKEN || env.refresh_token ||
    (typeof arg === 'string' ? arg : arg && (arg.REFRESH_TOKEN || arg.token)) || '';
  const small = ctx && ctx.widgetFamily === 'systemSmall';
  let data, error;
  if (typeof raw !== 'string' || !raw.trim()) {
    error = ['缺少 REFRESH_TOKEN', '请在小组件环境变量中配置'];
  } else {
    try {
      const token = await refreshAccessToken(ctx, raw.trim());
      data = parseQuotas(await fetchQuotaSummary(ctx, token));
    } catch (e) {
      error = ['配额获取失败', String(e && (e.message || e) || '未知错误')];
    }
  }
  try {
    return {
      type: 'widget',
      refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      backgroundImage: await renderWidget(data, small, error),
      padding: 0,
      children: []
    };
  } catch (e) {
    // Canvas 不可用时仍给出可读的原生 DSL 提示，不让小组件空白。
    return {
      type: 'widget', backgroundColor: { light: '#e9eff9', dark: '#172336' },
      padding: 18, children: [
        { type: 'text', text: error ? error[0] : 'Antigravity 配额',
          font: { size: 16, weight: 'bold' }, color: '#385477' },
        { type: 'text', text: error ? error[1] : '当前设备不支持 Canvas 绘制',
          font: { size: 12 }, color: '#607899' }
      ]
    };
  }
}

async function postJson(ctx, url, options) {
  const post = ctx && ctx.http && ctx.http.post;
  const response = post ? await post.call(ctx.http, url, options) : await fetch(url, options);
  if (!response || typeof response.json !== 'function') throw new Error('网络响应格式错误');
  const result = await response.json();
  if (response.ok === false || (response.status && response.status >= 400) || result.error) {
    const reason = result.error_description || (result.error && (result.error.message || result.error)) || '请求失败';
    throw new Error(String(reason));
  }
  return result;
}

async function refreshAccessToken(ctx, refreshToken) {
  const clientId = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep' + '.apps.googleusercontent.com';
  const clientSecret = ['GOCSPX', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'].join('-');
  const body = [
    ['client_id', clientId], ['client_secret', clientSecret],
    ['refresh_token', refreshToken], ['grant_type', 'refresh_token']
  ].map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const result = await postJson(ctx, 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!result.access_token) throw new Error('Token 刷新失败');
  return result.access_token;
}

async function fetchQuotaSummary(ctx, token) {
  return postJson(ctx, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      'User-Agent': 'antigravity-cli/0.1.0' },
    body: '{}'
  });
}

function parseQuotas(data) {
  const result = { claude: emptyGroup(), gemini: emptyGroup() };
  for (const group of (Array.isArray(data.groups) ? data.groups : [])) {
    const name = String(group.displayName || group.name || '').toLowerCase();
    const key = /claude|3p|gpt/.test(name) ? 'claude' : /gemini/.test(name) ? 'gemini' : null;
    if (!key || !Array.isArray(group.buckets)) continue;
    for (const bucket of group.buckets) {
      const window = String(bucket.window || bucket.name || '').toLowerCase();
      const kind = /week|7.day|10080/.test(window) ? 'weekly' :
        /5\s*[-_ ]?h|5.hour|300/.test(window) ? 'h5' : null;
      if (!kind) continue;
      const fraction = Number(bucket.remainingFraction);
      if (bucket.remainingFraction == null || !Number.isFinite(fraction)) continue;
      const value = {
        percent: Math.round(Math.max(0, Math.min(1, fraction)) * 100),
        resetText: formatResetTime(bucket.resetTime)
      };
      // 多个同类桶取最低剩余量，避免把真正的瓶颈显示为满额。
      if (result[key][kind].percent == null || value.percent < result[key][kind].percent) {
        result[key][kind] = value;
      }
    }
  }
  return result;
}

function emptyGroup() {
  return { h5: { percent: null, resetText: '—' }, weekly: { percent: null, resetText: '—' } };
}

function formatResetTime(value) {
  if (!value) return '—';
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.max(0, Math.ceil((ms - Date.now()) / 60000));
  if (!minutes) return 'soon';
  const days = Math.floor(minutes / 1440);
  if (days) return days + 'd ' + Math.floor((minutes % 1440) / 60) + 'h';
  const hours = Math.floor(minutes / 60);
  return hours ? hours + 'h ' + (minutes % 60) + 'm' : minutes + 'm';
}

const FONT = '-apple-system, system-ui, sans-serif';
function path(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r);
  cx.arcTo(x, y, x + w, y, r);
  cx.closePath();
}
function rect(cx, x, y, w, h, r, color) {
  cx.fillStyle = color;
  path(cx, x, y, w, h, r);
  cx.fill();
}
function text(cx, value, x, y, size, color, weight = 500, align = 'left', maxWidth) {
  cx.textAlign = align;
  cx.textBaseline = 'alphabetic';
  cx.font = weight + ' ' + size + 'px ' + FONT;
  cx.fillStyle = color;
  cx.fillText(String(value), x, y, maxWidth);
}
function glass(cx, x, y, w, h, r, tint) {
  cx.save();
  path(cx, x, y, w, h, r);
  cx.clip();
  const fill = cx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, 'rgba(255,255,255,.75)');
  fill.addColorStop(.48, 'rgba(244,249,255,.48)');
  fill.addColorStop(1, 'rgba(219,231,250,.56)');
  cx.fillStyle = fill;
  cx.fillRect(x, y, w, h);
  const glow = cx.createRadialGradient(x + w * .15, y - h * .2, 0, x + w * .15, y - h * .2, w);
  glow.addColorStop(0, tint);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = glow;
  cx.fillRect(x, y, w, h);
  const shine = cx.createLinearGradient(x, y, x, y + h * .6);
  shine.addColorStop(0, 'rgba(255,255,255,.86)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = shine;
  cx.fillRect(x, y, w, h * .6);
  cx.restore();
  cx.save();
  path(cx, x + .5, y + .5, w - 1, h - 1, r);
  cx.lineWidth = 1;
  cx.strokeStyle = 'rgba(255,255,255,.92)';
  cx.stroke();
  cx.restore();
}
function percentColor(pct, accent) {
  return pct == null ? '#8493a9' : pct < 20 ? '#d64c61' : pct < 50 ? '#ad7420' : accent;
}
function percentText(pct) { return pct == null ? '—' : pct + '%'; }
function bar(cx, x, y, w, pct, color, h = 5) {
  rect(cx, x, y, w, h, h / 2, 'rgba(100,127,166,.15)');
  if (pct > 0) rect(cx, x, y, w * Math.min(100, pct) / 100, h, h / 2, color);
}
function quotaLine(cx, x, y, w, label, item, accent, compact) {
  const color = percentColor(item.percent, accent);
  text(cx, label, x, y, compact ? 10 : 11, '#405873', 600);
  text(cx, percentText(item.percent), x + w, y, compact ? 12 : 14, color, 700, 'right');
  bar(cx, x, y + (compact ? 7 : 10), w, item.percent, color, compact ? 4 : 5);
  if (!compact) text(cx, 'Reset ' + item.resetText, x, y + 30, 10, '#536b88', 600, 'left', w);
}
function mediumCard(cx, x, y, w, data, title, accent, tint) {
  glass(cx, x, y, w, 135, 20, tint);
  rect(cx, x + 13, y + 15, 22, 22, 8, accent);
  text(cx, title.slice(0, 1), x + 24, y + 31, 12, '#ffffff', 700, 'center');
  text(cx, title, x + 42, y + 31, 12, '#223751', 700, 'left', w - 53);
  quotaLine(cx, x + 14, y + 52, w - 28, '5h', data.h5, accent, false);
  quotaLine(cx, x + 14, y + 94, w - 28, 'Weekly', data.weekly, accent, false);
}
function smallCard(cx, x, y, w, data, title, accent, tint) {
  glass(cx, x, y, w, 58, 17, tint);
  rect(cx, x + 10, y + 12, 5, 15, 3, accent);
  text(cx, title, x + 21, y + 24, 11, '#253a54', 700, 'left', w - 65);
  text(cx, percentText(data.h5.percent), x + w - 10, y + 24, 12,
    percentColor(data.h5.percent, accent), 700, 'right');
  bar(cx, x + 11, y + 32, w - 22, data.h5.percent, percentColor(data.h5.percent, accent), 4);
  text(cx, 'Week ' + percentText(data.weekly.percent), x + 11, y + 49, 10, '#455c79', 600);
  text(cx, data.h5.resetText, x + w - 10, y + 49, 10, '#526983', 600, 'right', w - 80);
}
function toDataUri(canvas) {
  return canvas.convertToBlob({ type: 'image/png' }).then(async blob => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return 'data:image/png;base64,' + btoa(binary);
  });
}
async function renderWidget(data, small, error) {
  const W = small ? 180 : 380, H = 180, dpr = 3;
  const canvas = new OffscreenCanvas(W * dpr, H * dpr);
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('无法创建 Canvas');
  cx.scale(dpr, dpr);
  const bg = cx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#c9ddfa');
  bg.addColorStop(.55, '#edf2fb');
  bg.addColorStop(1, '#dbd3f6');
  cx.fillStyle = bg;
  cx.fillRect(0, 0, W, H);
  // 暖冷色晕衬托半透明玻璃层；所有卡片裁切在自身圆角路径内。
  const halo = cx.createRadialGradient(W * .78, 4, 2, W * .78, 4, W * .85);
  halo.addColorStop(0, 'rgba(149,131,246,.42)');
  halo.addColorStop(1, 'rgba(149,131,246,0)');
  cx.fillStyle = halo;
  cx.fillRect(0, 0, W, H);
  text(cx, '✦  ANTIGRAVITY', small ? 15 : 19, 26, small ? 11 : 12, '#344665', 700);
  if (!small) text(cx, new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    W - 20, 26, 10, '#647793', 600, 'right');
  if (error) {
    glass(cx, 15, 40, W - 30, 120, 21, 'rgba(253,180,186,.25)');
    text(cx, error[0], W / 2, 91, small ? 13 : 17, '#a93450', 700, 'center', W - 48);
    text(cx, error[1], W / 2, 116, small ? 9 : 11, '#526681', 500, 'center', W - 50);
  } else if (small) {
    smallCard(cx, 13, 38, W - 26, data.claude, 'Claude / 3P', '#cf7050', 'rgba(255,182,135,.32)');
    smallCard(cx, 13, 105, W - 26, data.gemini, 'Gemini', '#4778dc', 'rgba(122,180,255,.30)');
  } else {
    const w = (W - 52) / 2;
    mediumCard(cx, 19, 39, w, data.claude, 'Claude / 3P', '#cf7050', 'rgba(255,182,135,.32)');
    mediumCard(cx, 33 + w, 39, w, data.gemini, 'Gemini', '#4778dc', 'rgba(122,180,255,.30)');
  }
  return toDataUri(canvas);
}
