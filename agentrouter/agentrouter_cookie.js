/**
 * AgentRouter 凭据抓取脚本 (Egern)
 * 当在手机浏览器登录 https://ps.air-outer.com 时自动捕获账号与密码
 */

const USER_KEY = "agentrouter_username";
const PASSWORD_KEY = "agentrouter_password";

function capture() {
  try {
    const bodyStr = $request.body || "";
    if (!bodyStr) return;

    let data;
    try {
      data = JSON.parse(bodyStr);
    } catch (_) {
      return;
    }

    if (data && typeof data.username === "string" && typeof data.password === "string" && data.username.trim() && data.password) {
      const username = data.username.trim();
      const password = data.password;

      const oldUser = $persistentStore.read(USER_KEY);
      const oldPass = $persistentStore.read(PASSWORD_KEY);

      if (username === oldUser && password === oldPass) return;

      const userOk = $persistentStore.write(username, USER_KEY);
      const passOk = $persistentStore.write(password, PASSWORD_KEY);

      if (userOk && passOk) {
        const masked = username.split("@")[0];
        const display = masked.length > 4 ? `${masked.slice(0, 2)}***${masked.slice(-2)}` : `${masked.slice(0, 1)}***`;

        $notification.post(
          "AgentRouter 凭据抓取成功",
          `👤 账号：${display}`,
          "已成功保存登录凭据，每天 09:00 将自动执行签到与余额查询。"
        );
      } else {
        $notification.post("AgentRouter 凭据保存失败", "", "请检查 Egern 的持久化存储权限。");
      }
    }
  } catch (error) {
    console.log("AgentRouter credential capture error: " + error);
  } finally {
    $done({});
  }
}

capture();
