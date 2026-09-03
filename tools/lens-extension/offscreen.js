// CLI-Anything-X Live Lens Offscreen Document - MediaRecorder 真实视频录制器

let mediaRecorder = null;
let recordedChunks = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'START_VIDEO_RECORDING') {
    startVideoRecording(message.streamId).then((res) => sendResponse(res));
    return true;
  } else if (message.action === 'STOP_VIDEO_RECORDING') {
    stopVideoRecording().then((res) => sendResponse(res));
    return true;
  }
});

async function startVideoRecording(streamId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.start(1000);
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function stopVideoRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve({ success: false, reason: 'MediaRecorder 未启动' });
      return;
    }

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Video = reader.result;
        resolve({ success: true, videoDataUrl: base64Video });
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.stop();
    // 停止视频轨
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  });
}
