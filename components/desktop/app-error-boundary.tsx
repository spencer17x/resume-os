'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { AppId } from '@/lib/desktop/types'

type AppErrorBoundaryProps = {
  appId: AppId
  appName: string
  children: ReactNode
  onClose(): void
}

type AppErrorBoundaryState = {
  hasError: boolean
  retryKey: number
}

class AppErrorBoundaryCore extends Component<AppErrorBoundaryProps & { labels: { close: string; retry: string; message: string } }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, retryKey: 0 }

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  retry = () => {
    this.setState((state) => ({ hasError: false, retryKey: state.retryKey + 1 }))
  }

  render() {
    const { appName, children, labels, onClose } = this.props
    if (this.state.hasError) {
      return (
        <section className="desktop-app-error" role="alert">
          <p>{labels.message}</p>
          <div className="desktop-app-error__actions">
            <button type="button" onClick={this.retry}>{labels.retry}</button>
            <button type="button" onClick={onClose} aria-label={`${labels.close} ${appName}`}>{labels.close}</button>
          </div>
        </section>
      )
    }

    return <div key={this.state.retryKey} className="desktop-app-content">{children}</div>
  }
}

export function AppErrorBoundary(props: AppErrorBoundaryProps) {
  const t = useTranslations('desktop')
  return <AppErrorBoundaryCore {...props} labels={{ close: t('close'), retry: t('retry'), message: t('error') }} />
}
