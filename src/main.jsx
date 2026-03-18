import React from 'react';
import ReactDOM from 'react-dom/client';
import App, { ErrorBoundary } from './App.jsx';
import './styles.css';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element #root was not found. Check index.html.');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
