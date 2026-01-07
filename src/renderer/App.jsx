import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Snackbar } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CytoscapeComponent from 'react-cytoscapejs';

export default function App() {
  const theme = useTheme();
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [loading, setLoading] = useState(false);
  const [elements, setElements] = useState([]);
  const [cy, setCy] = useState(null);

  const stylesheet = useMemo(() => {
    const primary = theme.palette.primary.main;
    const surface = theme.palette.background.paper;
    const onPrimary = theme.palette.primary.contrastText;
    const edge = theme.palette.text.disabled;
    const impacted = theme.palette.error.main;
    const selected = theme.palette.error.dark;

    return [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'background-color': primary,
          color: onPrimary,
          'font-size': 12,
          width: 60,
          height: 60,
          shape: 'round-rectangle'
        }
      },
      {
        selector: 'node.impacted',
        style: {
          'background-color': impacted,
          color: theme.palette.error.contrastText
        }
      },
      {
        selector: 'node.selected',
        style: {
          'background-color': selected,
          color: theme.palette.error.contrastText
        }
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': edge,
          'target-arrow-color': edge,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: 'data(label)',
          'font-size': 10,
          'text-rotation': 'autorotate',
          'text-background-color': surface,
          'text-background-opacity': 1,
          'text-background-padding': 2
        }
      }
    ];
  }, [theme]);

  const loadGraph = async () => {
    try {
      setLoading(true);
      const graph = await window.electronAPI?.getGraph?.();
      setElements(Array.isArray(graph) ? graph : []);
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Neo4j graph load failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cy) return;

    const handler = async (evt) => {
      const nodeId = evt.target.id();
      try {
        const impactedIds = await window.electronAPI?.getImpact?.(nodeId);
        const impactedSet = new Set(Array.isArray(impactedIds) ? impactedIds : []);

        cy.nodes().removeClass('impacted selected');
        cy.getElementById(nodeId).addClass('selected');
        for (const id of impactedSet) {
          if (id === nodeId) continue;
          cy.getElementById(id).addClass('impacted');
        }
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Impact analysis failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      }
    };

    cy.on('tap', 'node', handler);
    return () => {
      cy.off('tap', 'node', handler);
    };
  }, [cy]);

  const handleImportApplications = async () => {
    try {
      setLoading(true);
      const filePath = await window.electronAPI?.selectFile({
        title: 'Select Applications CSV'
      });

      if (!filePath) return;

      const result = await window.electronAPI?.importApplications(filePath);
      if (result?.success) {
        setSnackbar({
          open: true,
          message: `✓ Imported ${result.count} applications`,
          severity: 'success'
        });
        await loadGraph();
      } else {
        setSnackbar({
          open: true,
          message: `Import failed: ${result?.error ?? 'unknown error'}`,
          severity: 'error'
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Error: ${error?.message ?? error}`,
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImportDependencies = async () => {
    try {
      setLoading(true);
      const filePath = await window.electronAPI?.selectFile({
        title: 'Select Dependencies CSV'
      });

      if (!filePath) return;

      const result = await window.electronAPI?.importDependencies(filePath);
      if (result?.success) {
        setSnackbar({
          open: true,
          message: `✓ Imported ${result.count} dependencies`,
          severity: 'success'
        });
        await loadGraph();
      } else {
        setSnackbar({
          open: true,
          message: `Import failed: ${result?.error ?? 'unknown error'}`,
          severity: 'error'
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Error: ${error?.message ?? error}`,
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          p: 2,
          display: 'flex',
          gap: 2,
          alignItems: 'center',
          borderBottom: `1px solid ${theme.palette.divider}`
        }}
      >
        <Button variant="contained" onClick={handleImportApplications} disabled={loading}>
          Import Applications
        </Button>
        <Button variant="contained" onClick={handleImportDependencies} disabled={loading}>
          Import Dependencies
        </Button>
        {loading ? <CircularProgress size={24} /> : null}
      </Box>

      <Box sx={{ flex: 1 }}>
        <CytoscapeComponent
          elements={elements}
          style={{ width: '100%', height: '100%' }}
          stylesheet={stylesheet}
          layout={{ name: 'cose' }}
          cy={(nextCy) => setCy(nextCy)}
        />
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
