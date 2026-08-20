const REQUEST_EVENT = 'resume-os:browser-agent:request'
const RESPONSE_EVENT = 'resume-os:browser-agent:response'
const WAKE_EVENT = 'resume-os:job-agent:wakeup'

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'job-agent-wakeup') {
    window.dispatchEvent(new CustomEvent(WAKE_EVENT, { detail: message.cycle }))
  }
  return false
})

const reportPageReady = () => chrome.runtime.sendMessage({ action: 'job-agent-page-ready' }).catch(() => undefined)
if (document.readyState === 'complete') reportPageReady()
else window.addEventListener('load', reportPageReady, { once: true })
window.setTimeout(reportPageReady, 2_000)

window.addEventListener(REQUEST_EVENT, (event) => {
  const detail = event instanceof CustomEvent ? event.detail : null
  if (!detail || !['detect-platforms', 'collect-boss-jobs', 'collect-boss-job-detail', 'search-boss-jobs', 'inspect-boss-conversation', 'collect-boss-conversation-signals', 'summarize-boss-history', 'diagnose-boss-adapter', 'send-boss-message', 'send-boss-resume-attachment', 'configure-job-agent', 'get-job-agent-runtime', 'report-job-agent-cycle'].includes(detail.action) || typeof detail.requestId !== 'string') return
  chrome.runtime.sendMessage({
    action: detail.action,
    requestId: detail.requestId,
    ...(['collect-boss-job-detail', 'search-boss-jobs', 'send-boss-message', 'send-boss-resume-attachment', 'configure-job-agent', 'report-job-agent-cycle'].includes(detail.action) ? { payload: detail.payload } : {})
  }, (response) => {
    const lastError = chrome.runtime.lastError
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: lastError
      ? { requestId: detail.requestId, ok: false, error: 'PROBE_FAILED' }
      : response
    }))
  })
})
