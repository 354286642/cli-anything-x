// Content Script for CLI-Anything-X Live Lens 2.0

(function () {
  if (window.__ANYCLI_LENS_INJECTED__) return;
  window.__ANYCLI_LENS_INJECTED__ = true;

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;

    const eventData = {
      timestamp: Date.now(),
      clientX: e.clientX,
      clientY: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY,
      devicePixelRatio: window.devicePixelRatio || 1.0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      tagName: target.tagName,
      text: (target.innerText || target.value || '').substring(0, 50),
      selector: getCssSelector(target),
    };

    chrome.runtime.sendMessage({
      action: 'ADD_CLICK_EVENT',
      event: eventData,
    }).catch(() => {});
  }, true);

  function getCssSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return `#${el.id}`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
    }
    return el.tagName.toLowerCase();
  }
})();
