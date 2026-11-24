import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

/** 全局错误边界: 渲染异常时显示可恢复的提示而非白屏 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: unknown) {
    // 保留在控制台便于排查
    console.error('BVS 渲染异常:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, maxWidth: 640, margin: '60px auto', background: '#1b2740', border: '1px solid #eb5448', borderRadius: 12 }}>
          <h2 style={{ color: '#eb5448', marginTop: 0 }}>页面渲染异常</h2>
          <p className="muted" style={{ color: '#8fa0bd' }}>{this.state.message}</p>
          <button
            className="btn"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
