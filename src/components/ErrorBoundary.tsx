// 全局错误边界 —— 任何子树抛错时给出可恢复的错误页，而不是整页白屏。
// 记录原始 error 与组件栈到 console，便于 DevTools 与桌面端日志定位。

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tStatic } from '@/i18n';

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash" role="alert" aria-live="assertive">
        <div className="crash-card">
          <h1 className="crash-title">{tStatic('error.title')}</h1>
          <p className="crash-text">{tStatic('error.desc')}</p>
          <pre className="crash-detail">{error.message}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>
              {tStatic('error.reload')}
            </button>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              {tStatic('error.dismiss')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
