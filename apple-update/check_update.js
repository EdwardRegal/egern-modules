/**
 * Egern - Apple 系统固件更新监控脚本
 * 数据源: api.ipsw.me
 * 支持本地系统通知与可选 Bark 远程推送
 */

// 默认监控设备 (iPhone 16 Pro: iPhone17,1; iPhone 15 Pro: iPhone16,1; iPhone 16: iPhone17,3)
const DEFAULT_DEVICE = "iPhone17,1";
const STORAGE_KEY = "last_known_apple_fw_build";

// Bark 推送配置 (若留空则不触发 Bark 推送)
const BARK_KEY = "E87QNuZF2i4wd5FxswmhLn";
const BARK_SERVER = "https://api.day.app";

function sendNotification(title, subtitle, body) {
  // 1. 发送 Egern 本地系统通知
  if (typeof  !== "undefined") {
    .post(title, subtitle, body);
  }

  // 2. 发送 Bark 推送 (如果有配置)
  if (BARK_KEY) {
    const barkTitle = encodeURIComponent();
    const barkBody = encodeURIComponent(body);
    const barkUrl = ;
    .get({ url: barkUrl }, function () {
      ();
    });
    return;
  }

  ();
}

function checkAppleUpdate() {
  const deviceId = ( && .read("apple_monitor_device_id")) || DEFAULT_DEVICE;
  const apiUrl = ;

  console.log();

  .get({ url: apiUrl }, function (error, response, data) {
    if (error) {
      console.log();
      ();
      return;
    }

    try {
      const res = JSON.parse(data);
      const firmwares = res.firmwares || [];
      if (firmwares.length === 0) {
        console.log("[Apple Update] 未获取到固件列表");
        ();
        return;
      }

      const latest = firmwares[0];
      const latestVersion = latest.version;
      const latestBuild = latest.buildid;
      const releaseDate = latest.releasedate ? latest.releasedate.split("T")[0] : "未知";
      const isSigned = latest.signed ? "官方验证中 (可刷机/升级)" : "签名已关闭";
      const deviceName = res.name || deviceId;

      const lastBuild =  ? .read(STORAGE_KEY) : null;
      console.log();

      if (!lastBuild) {
        // 首次运行：记录当前版本并推送初始化提醒
        if () .write(latestBuild, STORAGE_KEY);
        sendNotification(
          " Apple 固件更新监控已激活",
          ,
          
        );
      } else if (lastBuild !== latestBuild) {
        // 检测到新版本变动
        if () .write(latestBuild, STORAGE_KEY);
        sendNotification(
          "🚨 发现 Apple 新系统更新！",
          ,
          
        );
      } else {
        console.log("[Apple Update] 暂无新版本发布");
        ();
      }
    } catch (e) {
      console.log();
      ();
    }
  });
}

checkAppleUpdate();
