const themeScript = `
  (() => {
    const storageKey = 'resume-os-theme';
    let stored = null;
    try {
      stored = localStorage.getItem(storageKey);
    } catch {
      stored = null;
    }
    const theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
    document.documentElement.dataset.themeMode = theme;
  })();
`

export function ThemeScript() {
  return <script id="resume-os-theme" dangerouslySetInnerHTML={{ __html: themeScript }} />
}
