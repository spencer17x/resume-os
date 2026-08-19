const REQUEST_EVENT = 'resume-os:browser-agent:request'
const RESPONSE_EVENT = 'resume-os:browser-agent:response'

window.addEventListener(REQUEST_EVENT, (event) => {
  const detail = event instanceof CustomEvent ? event.detail : null
  if (!detail || detail.action !== 'detect-platforms' || typeof detail.requestId !== 'string') return
  chrome.runtime.sendMessage({ action: detail.action, requestId: detail.requestId }, (response) => {
    const lastError = chrome.runtime.lastError
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: lastError
      ? { requestId: detail.requestId, ok: false, error: 'PROBE_FAILED' }
      : response
    }))
  })
})
