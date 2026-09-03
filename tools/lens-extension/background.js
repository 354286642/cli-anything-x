// Background Service Worker for CLI-Anything-X Live Lens 2.0 (MV3)

let isRecording = false;
let currentTabId = null;
let startTime = 0;
let token = '';
let networkLogs = [];
let clickEvents = [];
let userIntent = '';

// 监听扩展 Popup 消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_RECORDING') {
    startRecording(message.token).then((res) => sendResponse(res));
    return true;
  } else if (message.action === 'STOP_RECORDING') {
    stopRecording(message.intent).then((res) => sendResponse(res));
    return true;
  } else if (message.action === 'ADD_CLICK_EVENT') {
    if (isRecording) {
      const evt = message.event || {};
      try {
        chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 80 }, (dataUrl) => {
          if (dataUrl) {
            evt.screenshot = dataUrl;
          }
          clickEvents.push(evt);
        });
      } catch {
        clickEvents.push(evt);
      }
    }
  }
 else if (message.action === 'GET_STATUS') {
    sendResponse({ isRecording, startTime });
  }
});

// 启动离屏视频录制
async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [path],
  });
  if (existingContexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: path,
    reasons: ['USER_MEDIA'],
    justification: '用于 CLI-Anything-X Live Lens 录制全彩无音轨 Tab 视频流',
  });
}

// 启动录制
async function startRecording(pairingToken) {
  if (isRecording) return { success: false, reason: '已经在录制中' };

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return { success: false, reason: '未找到活跃标签页' };

  currentTabId = tabs[0].id;
  token = pairingToken || '';
  startTime = Date.now();
  networkLogs = [];
  clickEvents = [];
  userIntent = '';
  isRecording = true;

  try {
    // 动态给当前已打开的标签页注入 content.js 监听器
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content.js'],
      });
    } catch {
      // 忽略已存在注入
    }

    // 启动离屏 WebM 视频录制
    try {
      await setupOffscreenDocument('offscreen.html');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: currentTabId });
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'START_VIDEO_RECORDING',
        streamId,
      });
    } catch (e) {
      console.warn('Offscreen 视频录屏唤起警告:', e);
    }

    // Attach CDP Debugger
    await chrome.debugger.attach({ tabId: currentTabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId: currentTabId }, 'Network.enable');

    // 监听全页跳转保持
    await chrome.debugger.sendCommand({ tabId: currentTabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId: currentTabId }, 'Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__ANYCLI_LENS_RECORDING__ = true;`
    });

    // 绑定 CDP 事件
    chrome.debugger.onEvent.addListener(onCdpEvent);

    return { success: true, startTime };
  } catch (err) {
    isRecording = false;
    return { success: false, reason: err.message };
  }
}


// CDP 事件处理器
const pendingRequests = new Map();

function isApiRequest(url, method) {
  if (String(method).toUpperCase() === 'OPTIONS') return false;

  try {
    const pathname = new URL(url).pathname;
    return pathname === '/api' || pathname.includes('/api/');
  } catch {
    return false;
  }
}

async function onCdpEvent(debuggee, method, params) {
  if (!isRecording || debuggee.tabId !== currentTabId) return;

  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, timestamp, type } = params;
    const url = request.url || '';

    // 排除 css/js/png/jpg/woff 等静态资源与扩展内部通信
    const isStatic = /\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|map)(\?.*)?$/i.test(url);
    const isExtensionUrl = url.startsWith('chrome-extension://');
    const isApiRequestUrl = isApiRequest(url, request.method);

    if (!isStatic && !isExtensionUrl && isApiRequestUrl && url.startsWith('http')) {
      const item = {
        requestId,
        url: request.url,
        method: request.method,
        headers: request.headers || {},
        postData: request.postData || null,
        timestamp: Date.now(),
        resourceType: type || 'XHR',
        status: 200,
        responseBody: null,
      };
      pendingRequests.set(requestId, item);
      networkLogs.push(item);

      // 双重视轨截图保障：接口触发时自动拍摄视口全屏
      try {
        chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 70 }, (dataUrl) => {
          if (dataUrl) {
            clickEvents.push({
              timestamp: Date.now(),
              screenshot: dataUrl,
              tagName: 'API_ACTION',
              text: request.url,
            });
          }
        });
      } catch {
        // 静默
      }
    }
  } else if (method === 'Network.responseReceived') {

    const { requestId, response } = params;
    const item = pendingRequests.get(requestId);
    if (item) {
      item.status = response.status;
      item.responseHeaders = response.headers;
      item.mimeType = response.mimeType;

      try {
        const bodyRes = await chrome.debugger.sendCommand(
          { tabId: currentTabId },
          'Network.getResponseBody',
          { requestId }
        );
        if (bodyRes && bodyRes.body) {
          let bodyText = bodyRes.body;
          if (bodyText.length > 256 * 1024) {
            bodyText = bodyText.substring(0, 256 * 1024) + '...[TRUNCATED]';
          }
          item.responseBody = bodyText;
        }
      } catch {
        // Body 不可读时忽略
      }
    }
  }
}


// 停止录制并发送数据至 CLI Daemon (127.0.0.1:19877)
async function stopRecording(intentText) {
  if (!isRecording) return { success: false, reason: '未在录制状态' };
  isRecording = false;
  userIntent = intentText || '';

  let videoDataUrl = null;
  try {
    const videoRes = await chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'STOP_VIDEO_RECORDING',
    });
    if (videoRes && videoRes.videoDataUrl) {
      videoDataUrl = videoRes.videoDataUrl;
    }
  } catch {
    // 录屏关闭优雅降级
  }

  try {
    chrome.debugger.onEvent.removeListener(onCdpEvent);
    await chrome.debugger.detach({ tabId: currentTabId });
  } catch {
    // 忽略 detach 异常
  }

  const tab = await chrome.tabs.get(currentTabId);

  const sessionManifest = {
    sessionId: `lens-session-${Date.now()}`,
    timestampStart: startTime,
    timestampEnd: Date.now(),
    tabUrl: tab.url || '',
    tabTitle: tab.title || '',
    chromeVersion: navigator.userAgent,
    viewport: {
      width: tab.width || 1280,
      height: tab.height || 720,
      devicePixelRatio: 1.0,
    },
  };

  const payload = {
    token,
    session: sessionManifest,
    networkLogs,
    clickEvents,
    videoDataUrl,
    intent: userIntent,
  };


  // 通过 Background 特权 Context 发送上传请求，绕过网页 Mixed Content 与 PNA 限制
  try {
    const res = await fetch('http://127.0.0.1:19877/api/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Anycli-Token': token,
      },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    return { success: true, result };
  } catch (err) {
    return { success: false, reason: `连接本地 CLI Daemon 失败: ${err.message}` };
  }
}
