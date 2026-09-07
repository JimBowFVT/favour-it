import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './ResponsiveHardening.css';
import { isFoundingPath } from './marketing/programme';
import ErrorBoundary from './components/ErrorBoundary';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
const marketingRoute = isFoundingPath(window.location.pathname) || process.env.REACT_APP_MARKETING_SITE_ONLY === 'true';
const Entry = React.lazy(() => marketingRoute ? import('./marketing/FoundingCreators') : import('./AppShell'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={<p style={{ padding: 24 }}>Loading Favourit…</p>}><Entry /></React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
