import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import App from './App.jsx';
import StudioApp from './studio/StudioApp.jsx';

const STORAGE_KEY = 'ea-ui-mode';

const getDesignTokens = (mode) => {
  const isDark = mode === 'dark';

  return {
    palette: {
      mode,
      primary: {
        main: isDark ? '#6b8cff' : '#2346c3'
      },
      secondary: {
        main: isDark ? '#3dd68c' : '#147d64'
      },
      background: {
        default: isDark ? '#0f1115' : '#f3f4f6',
        paper: isDark ? '#161a22' : '#ffffff'
      },
      divider: isDark ? 'rgba(230, 232, 235, 0.12)' : 'rgba(15, 23, 42, 0.12)',
      text: {
        primary: isDark ? '#e6e8eb' : '#151924',
        secondary: isDark ? '#9aa0aa' : '#4b5563'
      }
    },
    shape: {
      borderRadius: 10
    },
    typography: {
      fontFamily: `'Segoe UI', 'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif`
    }
  };
};

function RouterHost({ colorMode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!window?.electronAPI?.onMenuCommand) return () => {};
    const unsubscribe = window.electronAPI.onMenuCommand((command, payload) => {
      if (!command) return;
      if (command === 'studio:open') {
        if (location.pathname !== '/studio') {
          navigate('/studio');
        }
        return;
      }

      if (location.pathname === '/studio') {
        navigate('/');
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('studio:command', {
              detail: { command, payload }
            })
          );
        }, 0);
      }
    });
    return unsubscribe;
  }, [navigate, location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<App colorMode={colorMode} />} />
      <Route path="/studio" element={<StudioApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Root() {
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return 'light';

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;

    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;

    const listener = (event) => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return;
      setMode(event.matches ? 'dark' : 'light');
    };

    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, []);

  const theme = useMemo(() => {
    const baseTheme = createTheme(getDesignTokens(mode));

    return createTheme(baseTheme, {
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundColor: baseTheme.palette.background.default,
              color: baseTheme.palette.text.primary,
              margin: 0
            },
            '#root': {
              minHeight: '100vh',
              backgroundColor: baseTheme.palette.background.default
            }
          }
        }
      }
    });
  }, [mode]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <RouterHost colorMode={{ mode, toggleMode }} />
      </HashRouter>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
