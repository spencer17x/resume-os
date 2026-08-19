const PLATFORM_HOSTS = {
  greenhouse: ['boards.greenhouse.io'],
  lever: ['jobs.lever.co'],
  boss: ['zhipin.com'],
  '51job': ['51job.com'],
  lagou: ['lagou.com'],
  liepin: ['liepin.com'],
  linkedin: ['linkedin.com'],
  indeed: ['indeed.com'],
  '58': ['58.com']
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'detect-platforms' || typeof message.requestId !== 'string') return false
  detectSessions().then((sessions) => sendResponse({
    requestId: message.requestId,
    ok: true,
    extensionVersion: chrome.runtime.getManifest().version,
    sessions
  })).catch(() => sendResponse({ requestId: message.requestId, ok: false, error: 'PROBE_FAILED' }))
  return true
})

async function detectSessions() {
  const tabs = await chrome.tabs.query({})
  const sessions = []
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    const tab = tabs.find((candidate) => {
      if (!candidate.url) return false
      try {
        const hostname = new URL(candidate.url).hostname
        return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
      } catch {
        return false
      }
    })
    if (!tab?.id) {
      sessions.push({ platform, state: 'unknown' })
      continue
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'probe-session' })
      const state = ['available', 'login-required'].includes(response?.state) ? response.state : 'unknown'
      sessions.push({ platform, state, tabId: tab.id })
    } catch {
      sessions.push({ platform, state: 'unknown', tabId: tab.id })
    }
  }
  return sessions
}
