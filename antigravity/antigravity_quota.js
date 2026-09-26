/** Antigravity 配额 · Egern 自适应玻璃小组件
 * 小组件环境变量：REFRESH_TOKEN（也兼容 TOKEN / refresh_token）
 * 颜色随系统外观切换；渐变与透明层是玻璃视觉模拟，不是实时壁纸折射。
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
  return nativeWidget(data, small, error);
}

const adaptive = (light, dark) => ({ light, dark });
const COLOR = {
  title: adaptive('#344665', '#dbe8f8'),
  body: adaptive('#233952', '#f2f6ff'),
  muted: adaptive('#465d78', '#b4c8e3'),
  subtle: adaptive('#526681', '#a8bfdc'),
  error: adaptive('#a93450', '#ff96ac'),
  unknown: adaptive('#8493a9', '#a7bbd6'),
  low: adaptive('#d64c61', '#ff788e'),
  mid: adaptive('#ad7420', '#ffc577'),
  claude: adaptive('#b4593e', '#ffc19d'),
  gemini: adaptive('#3566cc', '#92b9ff'),
  track: adaptive('#8295ae4d', '#a3b8d247')
};
const GRADIENT_POINTS = {
  startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 }
};

function nativeText(value, size, color, weight = 'medium') {
  return { type: 'text', text: String(value), font: { size, weight },
    textColor: color, maxLines: 1, minScale: 0.7 };
}

function nativeQuota(label, item, accent, small) {
  const value = item.percent;
  const color = value == null ? COLOR.unknown : value < 20 ? COLOR.low :
    value < 50 ? COLOR.mid : accent;
  const percent = value == null ? 0 : Math.max(0, Math.min(100, value));
  const trackWidth = small ? 100 : 116;
  const trackHeight = small ? 4 : 6;
  const track = { type: 'stack', direction: 'row', width: trackWidth, height: trackHeight,
    borderRadius: trackHeight / 2, backgroundColor: COLOR.track,
    children: percent ? [{ type: 'stack', width: trackWidth * percent / 100,
      height: trackHeight, borderRadius: trackHeight / 2, backgroundColor: color, children: [] }] : [] };
  return { type: 'stack', direction: 'column', gap: small ? 1 : 4, children: [
    { type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
      children: [
        nativeText(label, small ? 9 : 11, COLOR.muted, 'semibold'),
        { type: 'spacer' },
        nativeText(percentText(value), small ? 11 : 16, color, 'bold')
      ] },
    track
  ] };
}

function nativeCard(title, data, accent, small) {
  return { type: 'stack', direction: 'column', flex: 1, gap: small ? 2 : 8,
    padding: small ? [5, 8, 5, 8] : [11, 10, 11, 10],
    borderRadius: 8, borderWidth: 1,
    borderColor: adaptive('#ffffffdd', '#ffffff32'),
    backgroundGradient: { type: 'linear', ...GRADIENT_POINTS,
      colors: [adaptive('#ffffffed', '#293d58ee'),
        adaptive('#e8f1fae3', '#202f47df'), adaptive('#dce7f4e8', '#18263de9')] },
    children: [
      nativeText(title, small ? 11 : 12, COLOR.body, 'bold'),
      nativeQuota('5h', data.h5, accent, small),
      nativeQuota('Weekly', data.weekly, accent, small)
    ] };
}

function nativeWidget(data, small, error) {
  const children = [nativeText('ANTIGRAVITY', small ? 10 : 12, COLOR.title, 'bold')];
  if (error) {
    children.push(nativeText(error[0], 15, COLOR.error, 'bold'));
    children.push(nativeText(error[1], 11, COLOR.subtle));
  } else if (small) {
    children.push(nativeCard('Claude / 3P', data.claude, COLOR.claude, true));
    children.push(nativeCard('Gemini', data.gemini, COLOR.gemini, true));
  } else {
    children.push({ type: 'stack', direction: 'row', alignItems: 'start', gap: 8,
      children: [nativeCard('Claude / 3P', data.claude, COLOR.claude, false),
        nativeCard('Gemini', data.gemini, COLOR.gemini, false)] });
  }
  return { type: 'widget', refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    padding: small ? 8 : 12, gap: small ? 3 : 9,
    backgroundGradient: { type: 'linear', ...GRADIENT_POINTS,
      colors: [adaptive('#c9ddfa', '#111e32'), adaptive('#edf2fb', '#1c2d46'),
        adaptive('#dbd3f6', '#2c2c4b')] }, children };
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

function percentText(pct) { return pct == null ? '—' : pct + '%'; }
