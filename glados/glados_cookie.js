const STORAGE_KEY = "GLADOS_RAILGUN_COOKIES";
const DOMAINS = ["glados.cloud", "railgun.info"];

function capture() {
  try {
    const domain = new URL($request.url).hostname.toLowerCase();
    if (!DOMAINS.includes(domain)) return;
    const headers = $request.headers || {};
    const headerName = Object.keys(headers).find((key) => key.toLowerCase() === "cookie");
    const cookie = headerName ? String(headers[headerName]).trim() : "";
    if (!/(?:^|;\s*)koa:sess(?:\.sig)?=/.test(cookie)) return;

    let saved = {};
    try {
      const parsed = JSON.parse($persistentStore.read(STORAGE_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
    } catch (error) {
      console.log("GLaDOS: stored Cookie data is invalid; resetting it");
    }
    if (saved[domain] === cookie) return;
    saved[domain] = cookie;
    if ($persistentStore.write(JSON.stringify(saved), STORAGE_KEY)) {
      $notification.post("GLaDOS Cookie 已保存", domain, "凭据已存储在 Egern 本地。");
    } else {
      $notification.post("GLaDOS Cookie 保存失败", domain, "请检查 Egern 持久化存储。");
    }
  } catch (error) {
    console.log("GLaDOS Cookie capture failed: " + error);
  } finally {
    $done({});
  }
}

capture();
