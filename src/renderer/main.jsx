import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import App from './App.jsx';
import StudioApp from './studio/StudioApp.jsx';

if (import.meta.env.DEV) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = String(args?.[0] ?? '');
    if (message.includes('Fast Refresh') && message.includes('only works when a file')) {
      return;
    }
    originalWarn(...args);
  };
}

const STORAGE_KEY = 'ea-ui-mode';

// Desktop-first density mode (default ON).
// This is intentionally not exposed as a UI toggle (no new features).
const DESKTOP_DENSITY = true;

const getDesignTokens = (mode) => {
  const isDark = mode === 'dark';

  return {
    palette: {
      mode,
      primary: {
        // Muted enterprise blue (avoid saturated "web SaaS" feel)
        main: isDark ? '#7c93d6' : '#2d4f9f'
      },
      secondary: {
        // Muted green (used sparingly)
        main: isDark ? '#5fbf9b' : '#1b6f58'
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
      borderRadius: DESKTOP_DENSITY ? 3 : 10
    },
    spacing: DESKTOP_DENSITY ? 6 : 8,
    typography: {
      fontFamily: `'Segoe UI', 'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif`,
      // Enterprise desktop baseline: smaller, tighter.
      fontSize: DESKTOP_DENSITY ? 13 : 14,
      body1: {
        fontSize: DESKTOP_DENSITY ? 13 : 14,
        lineHeight: DESKTOP_DENSITY ? 1.25 : 1.35
      },
      body2: {
        fontSize: DESKTOP_DENSITY ? 12.5 : 13,
        lineHeight: DESKTOP_DENSITY ? 1.25 : 1.35
      },
      caption: {
        fontSize: DESKTOP_DENSITY ? 11 : 12,
        lineHeight: 1.2
      },
      subtitle2: {
        fontSize: DESKTOP_DENSITY ? 12 : 13,
        fontWeight: 650,
        letterSpacing: 1,
        textTransform: 'uppercase'
      }
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

      if (command === 'studio:import-ea-snapshot') {
        if (location.pathname !== '/studio') {
          navigate('/studio');
        }
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('studio:command', {
              detail: { command, payload }
            })
          );
        }, 0);
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

    const noShadows = Array.from({ length: 25 }, () => 'none');

    return createTheme(baseTheme, {
      shadows: DESKTOP_DENSITY ? noShadows : baseTheme.shadows,
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundColor: baseTheme.palette.background.default,
              color: baseTheme.palette.text.primary,
              margin: 0,
              fontSize: DESKTOP_DENSITY ? 13 : undefined,
              lineHeight: DESKTOP_DENSITY ? 1.25 : undefined,
              letterSpacing: DESKTOP_DENSITY ? '0.1px' : undefined,
              textRendering: 'optimizeLegibility'
            },
            '#root': {
              minHeight: '100vh',
              backgroundColor: baseTheme.palette.background.default
            },
            ...(DESKTOP_DENSITY
              ? {
                  '*, *::before, *::after': {
                    boxSizing: 'border-box'
                  },
                  // Keyboard-first signaling: keep focus rings crisp and consistent.
                  '*:focus-visible': {
                    outline: `1px solid ${alpha(baseTheme.palette.primary.main, 0.7)}`,
                    outlineOffset: 1
                  }
                }
              : null)
          }
        },

        MuiPaper: {
          defaultProps: {
            elevation: 0,
            square: DESKTOP_DENSITY
          },
          styleOverrides: {
            root: {
              backgroundImage: 'none'
            }
          }
        },

        MuiButton: {
          defaultProps: {
            disableElevation: true,
            size: DESKTOP_DENSITY ? 'small' : 'medium'
          },
          styleOverrides: {
            root: {
              textTransform: 'none',
              borderRadius: baseTheme.shape.borderRadius,
              minHeight: DESKTOP_DENSITY ? 28 : undefined,
              paddingTop: DESKTOP_DENSITY ? 4 : undefined,
              paddingBottom: DESKTOP_DENSITY ? 4 : undefined,
              paddingLeft: DESKTOP_DENSITY ? 10 : undefined,
              paddingRight: DESKTOP_DENSITY ? 10 : undefined,
              fontWeight: 650,
              letterSpacing: '0.2px'
            }
          }
        },

        MuiIconButton: {
          defaultProps: {
            size: DESKTOP_DENSITY ? 'small' : 'medium'
          },
          styleOverrides: {
            root: {
              borderRadius: baseTheme.shape.borderRadius,
              padding: DESKTOP_DENSITY ? 4 : undefined
            }
          }
        },

        MuiSvgIcon: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY ? { fontSize: 18 } : null)
            }
          }
        },

        MuiTooltip: {
          styleOverrides: {
            tooltip: {
              ...(DESKTOP_DENSITY
                ? {
                    fontSize: 11,
                    padding: '4px 6px'
                  }
                : null)
            }
          }
        },

        MuiInputLabel: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY
                ? {
                    fontSize: 11,
                    letterSpacing: '0.2px',
                    color: baseTheme.palette.text.secondary
                  }
                : null)
            }
          }
        },

        MuiTextField: {
          defaultProps: {
            size: DESKTOP_DENSITY ? 'small' : 'medium'
          }
        },

        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: baseTheme.shape.borderRadius
            },
            input: {
              ...(DESKTOP_DENSITY
                ? {
                    paddingTop: 6,
                    paddingBottom: 6,
                    paddingLeft: 8,
                    paddingRight: 8,
                    fontSize: 12.5
                  }
                : null)
            }
          }
        },

        MuiSelect: {
          defaultProps: {
            size: DESKTOP_DENSITY ? 'small' : 'medium'
          }
        },

        MuiMenuItem: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY
                ? {
                    minHeight: 28,
                    fontSize: 12.5
                  }
                : null)
            }
          }
        },

        MuiListItemButton: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY
                ? {
                    minHeight: 28,
                    paddingTop: 4,
                    paddingBottom: 4,
                    paddingLeft: 10,
                    paddingRight: 10,
                    borderRadius: 0
                  }
                : null)
            }
          }
        },

        MuiListItemText: {
          styleOverrides: {
            primary: {
              ...(DESKTOP_DENSITY
                ? {
                    fontSize: 12.5,
                    fontWeight: 600
                  }
                : null)
            },
            secondary: {
              ...(DESKTOP_DENSITY
                ? {
                    fontSize: 11.5
                  }
                : null)
            }
          }
        },

        MuiAccordionSummary: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY
                ? {
                    minHeight: 32,
                    paddingLeft: 10,
                    paddingRight: 10
                  }
                : null)
            },
            content: {
              ...(DESKTOP_DENSITY ? { margin: 0 } : null)
            }
          }
        },

        MuiAccordionDetails: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY
                ? {
                    paddingTop: 4,
                    paddingBottom: 6,
                    paddingLeft: 0,
                    paddingRight: 0
                  }
                : null)
            }
          }
        },

        MuiChip: {
          styleOverrides: {
            root: {
              ...(DESKTOP_DENSITY ? { height: 22 } : null)
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
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
