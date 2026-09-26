/*
 * 小黑盒日常签到与任务脚本 (Egern)
 */

const KEY_COOKIE = "BLACKBOX_COOKIE";
const HKEY_SERVER = "http://47.120.39.109:9900/hkey";

const BASE_APP_REFERER = "http://api.maxjia.com/";
const API_HOST = "api.xiaoheihe.cn";
const DATA_HOST = "data.xiaoheihe.cn";
const USER_AGENT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML like Gecko) Chrome/41.0.2272.118 Safari/537.36 ApiMaxJia/1.0";
const REPORT_USER_AGENT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36 ApiMaxJia/1.0";

const DEVICE_QUERY = "&imei=4187fb55b1be198a&device_info=XiaoMi%2013%E7%A7%81%E4%BA%BA%E8%AE%A2%E5%88%B6%E7%89%88";
const APP_VERSION = "1.3.347";
const APP_BUILD = "916";
const SIGN_APP_VERSION = "1.3.332";
const SIGN_APP_BUILD = "871";
const COMMON_QUERY = `&os_type=Android&x_os_type=Android&x_client_type=mobile&os_version=9&version=${APP_VERSION}&build=${APP_BUILD}&_time=`;
const SIGN_COMMON_QUERY = `&os_type=Android&x_os_type=Android&x_client_type=mobile&os_version=9&version=${SIGN_APP_VERSION}&build=${SIGN_APP_BUILD}&_time=`;
const APP_QUERY = "&dw=428&channel=heybox_xiaomi&x_app=heybox";

const TASK_ACTIONS = [
  { label: "分享贴子任务", taskName: "shareArticle", titlePattern: /(分享|发布|发帖).*(帖子|贴子|内容)|发布内容|发帖/ },
  { label: "分享游戏详情任务", taskName: "shareGameDetail", titlePattern: /(分享|前往).*(游戏详情|发布内容)|游戏详情/ },
  { label: "分享游戏评价任务", taskName: "shareGameComment", titlePattern: /(分享|发表|发布).*(游戏评价|评论)|游戏评价|评论/ },
  { label: "游戏榜单停留10s任务", taskName: "visitGameRank", titlePattern: /(游戏榜单|榜单|前往榜单).*(10s|停留10秒|停留10s)|停留10s|visitGameRank/ },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(options) {
  return new Promise((resolve) => {
    const method = (options.method || "GET").toLowerCase();
    const reqOptions = {
      url: options.url,
      headers: options.headers || {},
      body: options.body,
      timeout: options.timeout || 8000,
    };
    if (method === "post") {
      $httpClient.post(reqOptions, (error, response, data) => {
        if (error) {
          resolve(null);
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        }
      });
    } else {
      $httpClient.get(reqOptions, (error, response, data) => {
        if (error) {
          resolve(null);
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        }
      });
    }
  });
}

function getTaskState(taskList, taskAction) {
  const groups = taskList?.result?.task_list ?? [];
  for (const group of groups) {
    for (const task of group.tasks ?? []) {
      if (typeof task.title === "string" && taskAction.titlePattern.test(task.title)) {
        return task.state;
      }
    }
  }
  return null;
}

function getBoxElectricityText(data) {
  const directBattery = data?.result?.user?.battery ?? data?.user?.battery;
  if (directBattery !== undefined && directBattery !== null) {
    return String(directBattery);
  }
  return "未知";
}

function getSignInStatusText(signResult) {
  if (!signResult) return "签到失败";
  if (signResult.result?.state === "ignore") return "今日已签到过";
  if (signResult.msg === "请重新登录") return "Cookie过期";
  return "签到成功";
}

async function getHkey(heyboxId, type, taskName = "null") {
  const res = await httpRequest({
    url: HKEY_SERVER,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ heyboxId, type, taskName }),
    timeout: 5000,
  });
  return res && typeof res === "object" ? res : null;
}

async function follow(account) {
  const [heyboxId, accountCookie] = account.split("#");
  const hkeyInfo = await getHkey(heyboxId, 3);
  if (!hkeyInfo) return null;
  const { hkey, timestamp } = hkeyInfo;

  return await httpRequest({
    url: `https://api.xiaoheihe.cn/bbs/app/profile/follow/user?heybox_id=${heyboxId}${DEVICE_QUERY}&nonce=l7iQ8IQMHzj3hSydLxxsQMSzjnCvkiY3&hkey=${hkey}${COMMON_QUERY}${timestamp}${APP_QUERY}`,
    method: "POST",
    headers: {
      Referer: BASE_APP_REFERER,
      "User-Agent": USER_AGENT,
      Host: API_HOST,
      Cookie: accountCookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "following_id=12318034",
  });
}

async function getTaskList(account) {
  const [heyboxId, accountCookie] = account.split("#");
  const hkeyInfo = await getHkey(heyboxId, 2);
  if (!hkeyInfo) return null;
  const { hkey, timestamp } = hkeyInfo;

  return await httpRequest({
    url: `https://api.xiaoheihe.cn/task/list_v2/?heybox_id=${heyboxId}${DEVICE_QUERY}&nonce=tb6e1k7WqQCIHToyzWzI8Ogq9d0EIgpb&hkey=${hkey}${COMMON_QUERY}${timestamp}${APP_QUERY}`,
    method: "GET",
    headers: {
      Referer: BASE_APP_REFERER,
      "User-Agent": USER_AGENT,
      Host: API_HOST,
      Cookie: accountCookie,
    },
  });
}

async function getSignIn(account) {
  const [heyboxId, accountCookie] = account.split("#");
  const hkeyInfo = await getHkey(heyboxId, 1);
  if (!hkeyInfo) return null;
  const { hkey, timestamp } = hkeyInfo;

  return await httpRequest({
    url: `https://api.xiaoheihe.cn/task/sign_v3/sign?heybox_id=${heyboxId}${DEVICE_QUERY}&nonce=tb6e1k7WqQCIHToyzWzI8Ogq9d0EIgpb&hkey=${hkey}${SIGN_COMMON_QUERY}${timestamp}${APP_QUERY}`,
    method: "GET",
    headers: {
      Referer: BASE_APP_REFERER,
      "User-Agent": USER_AGENT,
      Host: API_HOST,
      Cookie: accountCookie,
    },
  });
}

async function doTask(account, taskName) {
  const [heyboxId, accountCookie] = account.split("#");
  const hkeyInfo = await getHkey(heyboxId, 5, taskName);
  if (!hkeyInfo) return null;

  const { timestamp: time, hkey, data: postData, key: postKey, sid: postSid } = hkeyInfo;
  const body = `data=${encodeURIComponent(postData)}&key=${encodeURIComponent(postKey)}&sid=${encodeURIComponent(postSid)}`;

  return await httpRequest({
    url: `https://data.xiaoheihe.cn/account/data_report/?type=104&time_=${time}&session_id=77ee4fea-46d9-4a53-b5ce-5df9cf056b7e&heybox_id=${heyboxId}${DEVICE_QUERY}&nonce=fSz04CwxvcWzG737aFNKKxNeGZDFOqJ1&hkey=${hkey}${COMMON_QUERY}${time}${APP_QUERY}`,
    method: "POST",
    headers: {
      Referer: BASE_APP_REFERER,
      "User-Agent": REPORT_USER_AGENT,
      Cookie: accountCookie,
      "Content-Type": "application/x-www-form-urlencoded",
      Host: DATA_HOST,
    },
    body,
  });
}

async function refreshTaskList(account, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const taskList = await getTaskList(account);
    if (taskList?.result?.task_list) return taskList;
    if (attempt < retries) await sleep(1000);
  }
  return null;
}

async function runTaskWithVerify(account, taskAction) {
  const before = await refreshTaskList(account);
  if (!before) return "获取任务列表失败";

  const beforeState = getTaskState(before, taskAction);
  if (beforeState === null) return "不在列表";
  if (beforeState === "finish") return "已完成";

  await doTask(account, taskAction.taskName);

  for (let retry = 0; retry < 3; retry++) {
    await sleep(1200);
    const after = await refreshTaskList(account);
    if (!after) continue;

    if (getTaskState(after, taskAction) === "finish") {
      return "完成";
    }
  }
  return "未确认";
}

async function main() {
  const cookie = $persistentStore.read(KEY_COOKIE);
  if (!cookie) {
    console.log("未检测到小黑盒凭据，请先打开小黑盒 App 自动捕获 Cookie");
    $notification.post("小黑盒签到", "未找到 Cookie", "请先打开小黑盒 App 触发凭据捕获。");
    $done();
    return;
  }

  const accounts = cookie.includes("&") ? cookie.split("&") : [cookie];
  console.log(`检测到 ${accounts.length} 个账号`);

  let notifySummary = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i].trim();
    if (!account) continue;

    const [heyboxId] = account.split("#");
    const accountNo = i + 1;
    let lines = [];

    await follow(account);

    const signResult = await getSignIn(account);
    const signStatus = getSignInStatusText(signResult);
    lines.push(`签到: ${signStatus}`);

    const taskList = await refreshTaskList(account);
    const username = taskList?.result?.user?.username || `用户_${heyboxId}`;

    if (taskList) {
      for (const action of TASK_ACTIONS) {
        const state = await runTaskWithVerify(account, action);
        lines.push(`${action.label.replace("任务", "")}: ${state}`);
      }
    }

    const finalTaskList = (await refreshTaskList(account)) || taskList;
    const finalUser = finalTaskList?.result?.user;
    if (finalUser?.level_info) {
      const coin = finalUser.level_info.coin;
      const coinYuan = (Number(coin) / 1000).toFixed(2);
      lines.push(`盒币: ${coin} (≈${coinYuan}元) | 等级: Lv.${finalUser.level_info.level}`);
    }

    const summaryBlock = `【${username}】\n` + lines.join("\n");
    console.log(summaryBlock);
    notifySummary.push(summaryBlock);
  }

  $notification.post("小黑盒任务完成", `共执行 ${accounts.length} 个账号`, notifySummary.join("\n\n"));
  $done();
}

main();
