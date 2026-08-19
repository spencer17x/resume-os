chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'probe-session') return false
  sendResponse({ state: detectSessionState() })
  return false
})

function detectSessionState() {
  const host = location.hostname
  if (host === 'www.zhipin.com' || host.endsWith('.zhipin.com')) {
    if (document.querySelector('a[href*="/web/geek/resume"], a[href*="/web/geek/recommend"]')) return 'available'
    if (visibleTextIncludes(['登录', '扫码登录'])) return 'login-required'
    return 'unknown'
  }
  if (host === 'www.linkedin.com' || host.endsWith('.linkedin.com')) {
    if (document.querySelector('a[href*="/in/"], a[href*="/mynetwork/"]')) return 'available'
    if (visibleTextIncludes(['sign in', 'join now'])) return 'login-required'
    return 'unknown'
  }
  if (host.endsWith('.51job.com') || host === '51job.com') {
    if (document.querySelector('a[href*="resume"], a[href*="usercenter"]')) return 'available'
    if (visibleTextIncludes(['登录', '扫码登录'])) return 'login-required'
    return 'unknown'
  }
  return 'unknown'
}

function visibleTextIncludes(signals) {
  const text = document.body?.innerText.slice(0, 30_000).toLocaleLowerCase() ?? ''
  return signals.some((signal) => text.includes(signal))
}
