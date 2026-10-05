import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import Game from './Game';
import LoadingScreen from './components/LoadingScreen';
import reportWebVitals from './reportWebVitals';
import { initTheme } from './services/theme';

initTheme();

function ManapallyApp() {
  const [isLoading, setIsLoading] = useState(true);

  if (isLoading) {
    return (
      <LoadingScreen
        onComplete={() => {
          setIsLoading(false);
        }}
      />
    );
  }

  return <Game />;
}

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <ManapallyApp />
  </React.StrictMode>,
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();