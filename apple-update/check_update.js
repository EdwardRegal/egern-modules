/**
 * Egern - Apple 系统固件更新监控脚本
 * 数据源: api.ipsw.me
 * 支持本地系统通知与可选 Bark 远程推送
 */

// 默认监控设备 (iPhone 16 Pro Max: iPhone17,2; iPhone 16 Pro: iPhone17,1)
const DEFAULT_DEVICE = "iPhone17,2";
const STORAGE_KEY = "last_known_apple_fw_build";

// Bark 推送配置
const BARK_KEY = "E87QNuZF2i4wd5FxswmhLn";
const BARK_SERVER = "https://api.day.app";

function sendNotification(title, subtitle, body) {
  // 1. 发送 Egern 本地系统通知
  if (typeof $notification !== "undefined") {
    $notification.post(title, subtitle, body);
  }

  // 2. 发送 Bark 推送
  if (BARK_KEY) {
    const barkTitle = encodeURIComponent(title + " - " + subtitle);
    const barkBody = encodeURIComponent(body);
    const barkUrl = BARK_SERVER + "/" + BARK_KEY + "/" + barkTitle + "/" + barkBody + "?group=AppleUpdate&icon=https%3A%2F%2Fwww.apple.com%2Ffavicon.ico";
    $httpClient.get({ url: barkUrl }, function () {
      $done();
    });
    return;
  }

  $done();
}

function checkAppleUpdate() {
  const deviceId = (typeof $persistentStore !== "undefined" && $persistentStore.read("apple_monitor_device_id")) || DEFAULT_DEVICE;
  const apiUrl = "https://api.ipsw.me/v4/device/" + deviceId;

  console.log("[Apple Update] 开始检查设备: " + deviceId);

  $httpClient.get({ url: apiUrl }, function (error, response, data) {
    if (error) {
      console.log("[Apple Update] 检查失败: " + error);
      $done();
      return;
    }

    try {
      const res = JSON.parse(data);
      const firmwares = res.firmwares || [];
      if (firmwares.length === 0) {
        console.log("[Apple Update] 未获取到固件列表");
        $done();
        return;
      }

      const latest = firmwares[0];
      const latestVersion = latest.version;
      const latestBuild = latest.buildid;
      const releaseDate = latest.releasedate ? latest.releasedate.split("T")[0] : "未知";
      const isSigned = latest.signed ? "官方验证中 (可刷机/升级)" : "签名已关闭";
      const deviceName = res.name || deviceId;

      const lastBuild = (typeof $persistentStore !== "undefined") ? $persistentStore.read(STORAGE_KEY) : null;
      console.log("[Apple Update] 最新版本: iOS " + latestVersion + " (" + latestBuild + ") | 上次版本: " + (lastBuild || "无"));

      if (!lastBuild) {
        // 首次运行：记录当前版本并推送初始化提醒
        if (typeof $persistentStore !== "undefined") {
          $persistentStore.write(latestBuild, STORAGE_KEY);
        }
        sendNotification(
          " Apple 固件更新监控已激活",
          deviceName + " 最新版本: iOS " + latestVersion,
          "Build: " + latestBuild + "\n发布日期: " + releaseDate + "\n状态: " + isSigned
        );
      } else if (lastBuild !== latestBuild) {
        // 检测到新版本变动
        if (typeof $persistentStore !== "undefined") {
          $persistentStore.write(latestBuild, STORAGE_KEY);
        }
        sendNotification(
          "🚨 发现 Apple 新系统更新！",
          deviceName + " 已推送 iOS " + latestVersion,
          "Build: " + latestBuild + "\n发布时间: " + releaseDate + "\n状态: " + isSigned
        );
      } else {
        console.log("[Apple Update] 暂无新版本发布");
        $done();
      }
    } catch (e) {
      console.log("[Apple Update] 数据解析异常: " + e);
      $done();
    }
  });
}

checkAppleUpdate();
