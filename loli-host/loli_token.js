/**
 * LOLI Labs (https://loli.host) Token 抓取脚本
 * 适用环境: Egern
 */

const STORAGE_KEY = "LOLI_HOST_TOKEN";

function capture() {
  try {
    const headers = $request.headers || {};
    const headerName = Object.keys(headers).find(
      (key) => key.toLowerCase() === "authorization"
    );
    const authHeader = headerName ? String(headers[headerName]).trim() : "";

    if (!authHeader.startsWith("Bearer ")) return;

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return;

    const currentToken = $persistentStore.read(STORAGE_KEY);
    if (token === currentToken) return;

    if ($persistentStore.write(token, STORAGE_KEY)) {
      $notification.post(
        "LOLI Labs Token 已保存",
        "获取凭据成功",
        "已存储最新 Token，每日自动签到已就绪。"
      );
    } else {
      $notification.post("LOLI Labs Token 保存失败", "", "请检查 Egern 持久化存储权限。");
    }
  } catch (error) {
    console.log("LOLI Labs Token capture failed: " + error);
  } finally {
    $done({});
  }
}

capture();
