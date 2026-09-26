/*
 * 小黑盒自动抓取凭据脚本 (Egern)
 * 匹配 URL: ^https?:\/\/(api|data)\.xiaoheihe\.cn\/.*heybox_id=
 */

const KEY_COOKIE = "BLACKBOX_COOKIE";

function capture() {
  const url = $request.url;
  const headers = $request.headers || {};

  // 1. 从 URL query 中提取 heybox_id
  const idMatch = url.match(/[?&]heybox_id=([^&#]+)/);
  if (!idMatch) {
    $done({});
    return;
  }
  const heyboxId = idMatch[1];

  // 2. 从 Request Header 获取 Cookie
  const cookieHeader = headers["Cookie"] || headers["cookie"] || "";
  const pkeyMatch = cookieHeader.match(/(?:^|;\s*)pkey=([^;]+)/);
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)x_xhh_tokenid=([^;]+)/);

  if (!pkeyMatch || !tokenMatch) {
    $done({});
    return;
  }

  const pkey = pkeyMatch[1];
  const tokenId = tokenMatch[1];
  const newAccountStr = `${heyboxId}#pkey=${pkey};x_xhh_tokenid=${tokenId}`;

  // 3. 读取本地已存储的凭据
  let currentVal = $persistentStore.read(KEY_COOKIE) || "";
  let accounts = currentVal ? currentVal.split("&").filter(Boolean) : [];

  // 判断是否已存在该 heybox_id，存在则更新，不存在则追加
  let existsIndex = accounts.findIndex((acc) => acc.startsWith(`${heyboxId}#`));
  let isUpdate = false;

  if (existsIndex !== -1) {
    if (accounts[existsIndex] === newAccountStr) {
      // 凭据未变化，无需重复提醒
      $done({});
      return;
    }
    accounts[existsIndex] = newAccountStr;
    isUpdate = true;
  } else {
    accounts.push(newAccountStr);
  }

  const savedVal = accounts.join("&");
  const success = $persistentStore.write(savedVal, KEY_COOKIE);

  if (success) {
    const title = "小黑盒 Cookie 获取成功";
    const subTitle = isUpdate ? `更新账号: ${heyboxId}` : `新增账号: ${heyboxId}`;
    const body = `当前共存储 ${accounts.length} 个账号\n已自动保存至本地持久化存储。`;
    $notification.post(title, subTitle, body);
  } else {
    $notification.post("小黑盒 Cookie 获取失败", "写入持久化存储失败", "");
  }

  $done({});
}

capture();
