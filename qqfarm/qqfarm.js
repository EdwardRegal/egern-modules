/**
 * QQ 农场 Egern 抓 Code 脚本
 *
 * 原理：QQ 农场小程序打开时会把 qq.login() 拿到的一次性 Code 拼到网关
 * WebSocket 地址里（wss://gate-obt.nqf.qq.com/prod/ws?platform=...&code=...&openID=...），
 * 本脚本在请求发出前读取该 URL，取出 code / openID：
 *   1. 发通知（点通知可复制 Code）；
 *   2. 配置了 PANEL_URL + PANEL_TOKEN + AUTO_ADD=1 时，直接调用面板接口建号并启动。
 *
 * 环境变量（Egern → 模块 → 编辑参数）：
 *   AUTO_ADD      1 表示自动提交到面板，默认 0（只通知 + 复制）
 *   PANEL_URL     面板地址，如 http://192.168.1.10:3007 或 https://farm.example.com
 *   PANEL_TOKEN   面板管理员 token（浏览器登录后在开发者工具里看 x-admin-token 请求头）
 *   ACCOUNT_NAME  账号备注；同名会视为重新登录。留空则用「QQ农场-MMDD-HHmm」
 *
 * 说明：Code 一次性有效，脚本对同一个 Code 只处理一次；重复打开小程序会拿到新 Code。
 */

const NOISE_CODE = /^(?:0|1|true|false|null|undefined)$/i;
const GATEWAY_HOST = /(^|\.)nqf\.qq\.com$/i;
const STORAGE_LAST_CODE = 'qqfarm:lastCode';
const STORAGE_LAST_CAPTURE = 'qqfarm:lastCapture';
const STORAGE_LAST_SUBMIT = 'qqfarm:lastSubmit';

/** 从 URL 里取 host（不依赖 URL 类，兼容性更好） */
function hostOf(url) {
  const sep = String(url).indexOf('://');
  const rest = sep >= 0 ? String(url).slice(sep + 3) : String(url);
  const end = rest.search(/[/?#]/);
  return (end >= 0 ? rest.slice(0, end) : rest).toLowerCase();
}

/** 解析 query string，重复 key 取第一个 */
function parseQuery(url) {
  const out = {};
  const text = String(url);
  const qIndex = text.indexOf('?');
  if (qIndex < 0) return out;
  let query = text.slice(qIndex + 1);
  const hashIndex = query.indexOf('#');
  if (hashIndex >= 0) query = query.slice(0, hashIndex);
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch (error) {
      // 保留原始值
    }
    if (!(key in out)) out[key] = value;
  }
  return out;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function defaultAccountName() {
  const now = new Date();
  return `QQ农场-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function isValidCode(code, isGateway) {
  if (!code || code.length < 4) return false;
  if (NOISE_CODE.test(code)) return false;
  return isGateway || code.length >= 16;
}

function notifyCaptured(ctx, code, openId, ver) {
  const lines = [`Code 已抓取（${code.length} 位）`, `点此复制 Code`];
  if (openId) lines.push(`openID: ${openId}`);
  if (ver) lines.push(`客户端版本: ${ver}`);
  ctx.notify({
    title: 'QQ农场：已抓到 Code',
    body: lines.join('\n'),
    duration: 10,
    action: { type: 'clipboard', text: code },
  });
}

async function submitToPanel(ctx, panelUrl, token, name, code) {
  const response = await ctx.http.post(`${panelUrl}/api/accounts`, {
    headers: {
      'x-admin-token': token,
      'Content-Type': 'application/json',
    },
    body: { name, code, platform: 'qq' },
    timeout: 15000,
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (response.status >= 200 && response.status < 300 && (!data || data.ok !== false)) {
    ctx.notify({
      title: 'QQ农场：账号已提交',
      body: `已用抓到的 Code 添加并启动「${name}」`,
      duration: 8,
      action: { type: 'openUrl', url: panelUrl },
    });
    return true;
  }
  const reason = (data && (data.error || data.message)) || `HTTP ${response.status}`;
  ctx.notify({
    title: 'QQ农场：面板提交失败',
    body: `${reason}\nCode 已复制，可手动粘贴到面板`,
    duration: 10,
    action: { type: 'clipboard', text: code },
  });
  return false;
}

export default async function (ctx) {
  try {
    const request = ctx.request;
    if (!request || !request.url) return;

    const url = String(request.url);
    const host = hostOf(url);
    const isGateway = GATEWAY_HOST.test(host);

    // 只处理网关域名或明确带长 code 的请求，避免 URL 追踪参数误报
    const params = parseQuery(url);
    const code = String(params.code || '').trim();
    if (!isValidCode(code, isGateway)) return;

    if (ctx.storage.get(STORAGE_LAST_CODE) === code) return;
    ctx.storage.set(STORAGE_LAST_CODE, code);

    const openId = String(params.openID || params.openid || '').trim();
    const ver = String(params.ver || '').trim();
    ctx.storage.setJSON(STORAGE_LAST_CAPTURE, {
      code,
      openId,
      ver,
      host,
      at: Date.now(),
    });

    const env = ctx.env || {};
    const autoAdd = /^(?:1|true|yes|on)$/i.test(String(env.AUTO_ADD || ''));
    const panelUrl = String(env.PANEL_URL || '').replace(/\/+$/, '');
    const token = String(env.PANEL_TOKEN || '');
    const name = String(env.ACCOUNT_NAME || '').trim() || defaultAccountName();

    if (autoAdd && panelUrl && token) {
      if (ctx.storage.get(STORAGE_LAST_SUBMIT) === code) return;
      ctx.storage.set(STORAGE_LAST_SUBMIT, code);
      try {
        await submitToPanel(ctx, panelUrl, token, name, code);
      } catch (error) {
        ctx.notify({
          title: 'QQ农场：面板请求失败',
          body: `${String((error && error.message) || error).slice(0, 120)}\nCode 已复制，可手动粘贴`,
          duration: 10,
          action: { type: 'clipboard', text: code },
        });
      }
      return;
    }

    notifyCaptured(ctx, code, openId, ver);
  } catch (error) {
    ctx.notify({
      title: 'QQ农场脚本出错',
      body: String((error && error.message) || error).slice(0, 160),
    });
  }
}
