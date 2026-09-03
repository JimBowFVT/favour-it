import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './ResponsiveHardening.css';
import AppShell from './AppShell';
import ErrorBoundary from './components/ErrorBoundary';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
