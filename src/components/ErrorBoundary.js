import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected application error.' };
  }

  componentDidCatch(error, info) {
    // Keep production failures visible without exposing stack traces to users.
    if (process.env.NODE_ENV !== 'production') {
      console.error('Favourit application error', error, info);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <section style={{ maxWidth: 560, textAlign: 'center', background: '#1d222c', border: '1px solid rgba(255,255,255,.08)', borderRadius: 20, padding: 36 }}>
          <div className="logo" style={{ marginBottom: 20 }}>Favour<span style={{ fontFamily: "'Oleo Script', cursive", color: '#7b75ff' }}>it</span></div>
          <h1 style={{ margin: '0 0 12px' }}>Something went wrong</h1>
          <p style={{ color: '#9299aa', lineHeight: 1.7, margin: '0 0 24px' }}>
            Favourit hit an unexpected error. Your account data is kept on the server. Try refreshing the page.
          </p>
          {process.env.NODE_ENV !== 'production' && <small style={{ color: '#e18b8b' }}>{this.state.message}</small>}
          <div style={{ marginTop: 24 }}>
            <button className="primary" onClick={() => window.location.reload()}>Refresh Favourit</button>
          </div>
        </section>
      </main>
    );
  }
}
