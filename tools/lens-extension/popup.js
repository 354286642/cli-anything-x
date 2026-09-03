// Popup JS for CLI-Anything-X Live Lens 2.0

document.addEventListener('DOMContentLoaded', () => {
  const startForm = document.getElementById('startForm');
  const stopForm = document.getElementById('stopForm');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const tokenInput = document.getElementById('tokenInput');
  const intentInput = document.getElementById('intentInput');
  const statusBadge = document.getElementById('statusBadge');
  const msgBox = document.getElementById('msgBox');

  // 查询当前录制状态
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (res) => {
    if (res && res.isRecording) {
      setUiRecording(true);
    } else {
      setUiRecording(false);
    }
  });

  btnStart.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    msgBox.innerText = '正在初始化 CDP 抓包...';
    chrome.runtime.sendMessage({ action: 'START_RECORDING', token }, (res) => {
      if (res && res.success) {
        setUiRecording(true);
        msgBox.innerText = '正在录制中...请在页面中正常操作。';
      } else {
        msgBox.innerText = `启动失败: ${(res && res.reason) || '未知错误'}`;
      }
    });
  });

  btnStop.addEventListener('click', () => {
    const intent = intentInput.value.trim();
    msgBox.innerText = '正在导出并推送数据给本地 CLI...';
    btnStop.disabled = true;

    chrome.runtime.sendMessage({ action: 'STOP_RECORDING', intent }, (res) => {
      btnStop.disabled = false;
      if (res && res.success) {
        setUiRecording(false);
        msgBox.innerText = '🎉 抓包数据已成功发送至本地 CLI-Anything-X！';
      } else {
        msgBox.innerText = `提交失败: ${(res && res.reason) || '未知错误'}`;
      }
    });
  });

  function setUiRecording(recording) {
    if (recording) {
      startForm.style.display = 'none';
      stopForm.style.display = 'block';
      statusBadge.innerText = '录制中';
      statusBadge.className = 'status-badge recording';
    } else {
      startForm.style.display = 'block';
      stopForm.style.display = 'none';
      statusBadge.innerText = '未开始';
      statusBadge.className = 'status-badge';
    }
  }
});
