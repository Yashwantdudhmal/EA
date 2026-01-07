import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  Snackbar,
  createTheme
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import SaveIcon from '@mui/icons-material/SaveOutlined';
import DownloadIcon from '@mui/icons-material/DownloadOutlined';
import AddIcon from '@mui/icons-material/AddCircleOutline';
import RefreshIcon from '@mui/icons-material/Autorenew';
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from 'reactflow';
import { toPng } from 'html-to-image';
import GenericNode from './components/GenericNode.jsx';
import { getInitialNode, useStudioStore } from './store.js';
import 'reactflow/dist/style.css';

const nodeTypes = {
  generic: GenericNode
};

const studioTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#6b8cff'
    },
    secondary: {
      main: '#3dd68c'
    },
    background: {
      default: '#0b0d11',
      paper: '#12161f'
    },
    divider: 'rgba(255,255,255,0.08)',
    text: {
      primary: '#f4f6fb',
      secondary: '#a2a9b4'
    }
  },
  typography: {
    fontFamily: `'Segoe UI', 'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif`,
    h6: {
      fontWeight: 600,
      letterSpacing: 0.8
    }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8
        }
      }
    }
  }
});

function CanvasView({ containerRef }) {
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);
  const onNodesChange = useStudioStore((state) => state.onNodesChange);
  const onEdgesChange = useStudioStore((state) => state.onEdgesChange);
  const onConnect = useStudioStore((state) => state.onConnect);
  const setSelection = useStudioStore((state) => state.setSelection);
  const snapGrid = useStudioStore((state) => state.snapGrid);
  const reactFlow = useReactFlow();

  useEffect(() => {
    if (nodes.length === 0 && typeof reactFlow.fitView === 'function') {
      reactFlow.fitView({ duration: 200, padding: 0.9 });
      console.log('[studio] canvas fit view executed for empty state');
    }
  }, [nodes.length, reactFlow]);

  useEffect(() => {
    const viewport = reactFlow.getViewport?.();
    if (viewport) {
      console.log('[studio] canvas viewport initialized', viewport);
    }
    const zoom = reactFlow.getZoom?.() ?? null;
    if (zoom !== null) {
      console.log('[studio] canvas zoom baseline', { zoom });
    }
  }, [reactFlow]);

  const handleSelectionChange = useCallback(
    (params) => {
      setSelection({
        nodes: (params?.nodes ?? []).map((node) => node.id),
        edges: (params?.edges ?? []).map((edge) => edge.id)
      });
    },
    [setSelection]
  );

  return (
    <Box ref={containerRef} sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={handleSelectionChange}
        fitView
        fitViewOptions={{ padding: 0.8, duration: 200 }}
        minZoom={0.25}
        maxZoom={4}
        snapToGrid
        snapGrid={snapGrid}
        panOnScroll
        panOnDrag
        nodesDraggable
        nodesConnectable
        nodesFocusable
        elementsSelectable
        attributionPosition="bottom-right"
        style={{ background: '#0b0d11' }}
      >
        <Background color="#1f2431" gap={16} size={1} />
        <MiniMap
          nodeColor={() => '#6b8cff'}
          maskColor="rgba(11, 13, 17, 0.6)"
          pannable
          zoomable
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </Box>
  );
}

function StudioContent() {
  const canvasRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [diagrams, setDiagrams] = useState([]);

  const metadata = useStudioStore((state) => state.metadata);
  const diagramId = useStudioStore((state) => state.diagramId);
  const dirty = useStudioStore((state) => state.dirty);
  const serialize = useStudioStore((state) => state.serialize);
  const markClean = useStudioStore((state) => state.markClean);
  const loadDiagram = useStudioStore((state) => state.loadDiagram);
  const reset = useStudioStore((state) => state.reset);
  const setMetadata = useStudioStore((state) => state.setMetadata);
  const updateNodes = useStudioStore((state) => state.updateNodes);
  const selection = useStudioStore((state) => state.selection);
  const nodes = useStudioStore((state) => state.nodes);

  const selectedNodes = useMemo(() => {
    if (!selection?.nodes?.length) return [];
    const selectedIds = new Set(selection.nodes);
    return nodes.filter((node) => selectedIds.has(node.id));
  }, [selection, nodes]);

  useEffect(() => {
    if (!window?.electronAPI?.getGraph) return;
    try {
      window.electronAPI.getGraph();
      console.error('[studio] isolation guard FAILED — Neo4j access permitted');
    } catch (error) {
      console.log('[studio] isolation guard active:', error?.message ?? error);
    }
  }, []);

  useEffect(() => {
    if (nodes.length >= 100) {
      const checkpoint = performance.now();
      requestAnimationFrame(() => {
        const duration = performance.now() - checkpoint;
        console.log('[studio] performance checkpoint', { nodeCount: nodes.length, frameLatencyMs: Number(duration.toFixed(2)) });
      });
    }
  }, [nodes]);

  const loadDiagramList = useCallback(async () => {
    if (!window?.electronAPI?.listStudioDiagrams) return;
    setLoadingList(true);
    try {
      const list = await window.electronAPI.listStudioDiagrams();
      setDiagrams(Array.isArray(list) ? list : []);
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Loading diagrams failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadDiagramList();
  }, [loadDiagramList]);

  const handleNewDiagram = useCallback(() => {
    reset();
  }, [reset]);

  const handleSaveDiagram = useCallback(
    async (saveAs = false) => {
      if (!window?.electronAPI?.saveStudioDiagram) return;
      setSaving(true);
      try {
        const payload = serialize();
        if (saveAs) {
          delete payload.id;
        }
        const saved = await window.electronAPI.saveStudioDiagram({
          ...payload,
          name: metadata.name
        });
        if (saved?.id) {
          markClean(saved.id, { createdAt: saved.createdAt, updatedAt: saved.updatedAt });
          await loadDiagramList();
          setSnackbar({ open: true, message: 'Diagram saved.', severity: 'success' });
        }
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Save failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      } finally {
        setSaving(false);
      }
    },
    [serialize, metadata.name, markClean, loadDiagramList]
  );

  const handleLoadDiagram = useCallback(
    async (id) => {
      if (!id || !window?.electronAPI?.loadStudioDiagram) return;
      try {
        const diagram = await window.electronAPI.loadStudioDiagram(id);
        if (!diagram) {
          setSnackbar({ open: true, message: 'Diagram not found.', severity: 'warning' });
          return;
        }
        loadDiagram(diagram);
        markClean(diagram.id, { createdAt: diagram.createdAt, updatedAt: diagram.updatedAt });
        setSnackbar({ open: true, message: `Loaded ${diagram.name}.`, severity: 'info' });
        setTimeout(() => {
          const current = serialize();
          const mismatches = (diagram.nodes ?? []).filter((node) => {
            const match = current.nodes?.find((item) => item.id === node.id);
            if (!match) return true;
            const dx = Math.abs((match.position?.x ?? 0) - (node.position?.x ?? 0));
            const dy = Math.abs((match.position?.y ?? 0) - (node.position?.y ?? 0));
            return dx > 0.5 || dy > 0.5;
          });
          if (mismatches.length) {
            console.warn('[studio] position mismatch after load', mismatches.map((node) => node.id));
          } else {
            console.log('[studio] position verification passed for loaded diagram');
          }
        }, 0);
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Load failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      }
    },
    [loadDiagram, markClean, serialize]
  );

  const handleDeleteDiagram = useCallback(
    async (id, event) => {
      event?.stopPropagation?.();
      if (!id || !window?.electronAPI?.deleteStudioDiagram) return;
      try {
        await window.electronAPI.deleteStudioDiagram(id);
        if (diagramId === id) {
          reset();
        }
        await loadDiagramList();
        setSnackbar({ open: true, message: 'Diagram deleted.', severity: 'info' });
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Delete failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      }
    },
    [diagramId, reset, loadDiagramList]
  );

  const handleExportJson = useCallback(async () => {
    if (!window?.electronAPI?.exportStudioJson) return;
    try {
      await window.electronAPI.exportStudioJson({
        name: metadata.name || 'diagram',
        data: serialize()
      });
      setSnackbar({ open: true, message: 'JSON export complete.', severity: 'success' });
    } catch (error) {
      setSnackbar({
        open: true,
        message: `JSON export failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, [metadata.name, serialize]);

  const handleExportPng = useCallback(async () => {
    if (!window?.electronAPI?.exportStudioPng) return;
    const container = canvasRef.current;
    if (!container) {
      setSnackbar({ open: true, message: 'Canvas not ready for export.', severity: 'warning' });
      return;
    }
    try {
      const viewport = container.querySelector('.react-flow__viewport');
      const target = viewport ?? container;
      const dataUrl = await toPng(target, {
        backgroundColor: '#0b0d11',
        cacheBust: true,
        pixelRatio: 2
      });
      await window.electronAPI.exportStudioPng({
        name: metadata.name || 'diagram',
        dataUrl
      });
      setSnackbar({ open: true, message: 'PNG export complete.', severity: 'success' });
    } catch (error) {
      setSnackbar({
        open: true,
        message: `PNG export failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, [metadata.name]);

  const handleAddNode = useCallback(() => {
    const position = { x: Math.random() * 400, y: Math.random() * 240 };
    updateNodes((nodesDraft) => [...nodesDraft, getInitialNode(position)]);
  }, [updateNodes]);

  const handleNodeLabelChange = useCallback(
    (value) => {
      const node = selectedNodes[0];
      if (!node) return;
      updateNodes((nodesDraft) =>
        nodesDraft.map((item) => {
          if (item.id !== node.id) return item;
          return {
            ...item,
            data: {
              ...item.data,
              label: value
            }
          };
        })
      );
    },
    [selectedNodes, updateNodes]
  );

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr) minmax(300px, 360px)',
        minHeight: '100vh',
        minWidth: 960,
        width: '100%',
        backgroundColor: 'background.default',
        color: 'text.primary',
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          borderRight: (theme) => `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 280,
          p: 3,
          gap: 2,
          backgroundColor: 'background.paper'
        }}
      >
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 1 }}>
            Diagram Metadata
          </Typography>
          <TextField
            label="Name"
            value={metadata.name}
            onChange={(event) => setMetadata({ name: event.target.value })}
            size="small"
            fullWidth
          />
          <TextField
            label="Description"
            value={metadata.description}
            onChange={(event) => setMetadata({ description: event.target.value })}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <Typography variant="caption" color="text.secondary">
            Updated {new Date(metadata.updatedAt).toLocaleString()}
            {dirty ? ' • Unsaved changes' : ''}
          </Typography>
        </Stack>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 1 }}>
            Palette
          </Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleAddNode}
            color="primary"
          >
            Add Generic Node
          </Button>
          <Typography variant="body2" color="text.secondary">
            Future enterprise element palettes will appear here.
          </Typography>
        </Stack>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 1 }}>
            Persistence
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => handleSaveDiagram(false)} disabled={saving || !dirty}>
              Save
            </Button>
            <Button variant="outlined" onClick={() => handleSaveDiagram(true)} disabled={saving}>
              Save As
            </Button>
          </Stack>
          <Button
            variant="text"
            startIcon={<RefreshIcon />}
            onClick={handleNewDiagram}
            color="secondary"
          >
            New Diagram
          </Button>
        </Stack>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 1 }}>
              Saved Diagrams
            </Typography>
            {loadingList ? <CircularProgress size={16} /> : null}
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 1 }}>
            {diagrams.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No diagrams saved yet.
              </Typography>
            ) : (
              <List dense>
                {diagrams.map((item) => (
                  <ListItem
                    key={item.id}
                    disablePadding
                    secondaryAction={
                      <Tooltip title="Delete diagram">
                        <IconButton edge="end" onClick={(event) => handleDeleteDiagram(item.id, event)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                    sx={{ borderRadius: 1, mb: 0.5 }}
                  >
                    <ListItemButton
                      selected={diagramId === item.id}
                      onClick={() => handleLoadDiagram(item.id)}
                      sx={{ borderRadius: 1 }}
                    >
                      <ListItemText
                        primary={item.name}
                        secondary={new Date(item.updatedAt ?? item.createdAt).toLocaleString()}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Stack>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 1 }}>
            Export
          </Typography>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportJson}>
            Export JSON
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportPng}>
            Export PNG
          </Button>
        </Stack>
      </Box>

      <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CanvasView containerRef={canvasRef} />
        </Box>
      </Box>

      <Box
        sx={{
          borderLeft: (theme) => `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 300,
          p: 3,
          gap: 2,
          backgroundColor: 'background.paper'
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: 1 }}>
          Inspector
        </Typography>
        {selectedNodes.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Select a node or edge to inspect its properties.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="caption" color="text.secondary">
              {selectedNodes.length} node{selectedNodes.length > 1 ? 's' : ''} selected
            </Typography>
            {selectedNodes.length === 1 ? (
              <Stack spacing={1}>
                <TextField
                  label="Node Label"
                  value={selectedNodes[0].data?.label ?? ''}
                  onChange={(event) => handleNodeLabelChange(event.target.value)}
                  size="small"
                  fullWidth
                />
                <Typography variant="caption" color="text.secondary">
                  Position: {Math.round(selectedNodes[0].position.x)}, {Math.round(selectedNodes[0].position.y)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Size: {Math.round(selectedNodes[0].width ?? 0)} × {Math.round(selectedNodes[0].height ?? 0)}
                </Typography>
              </Stack>
            ) : null}
          </Stack>
        )}
      </Box>
      <Snackbar
        open={snackbar.open}
        onClose={() => setSnackbar((state) => ({ ...state, open: false }))}
        autoHideDuration={4000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((state) => ({ ...state, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default function StudioApp() {
  return (
    <ThemeProvider theme={studioTheme}>
      <CssBaseline />
      <ReactFlowProvider>
        <StudioContent />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
