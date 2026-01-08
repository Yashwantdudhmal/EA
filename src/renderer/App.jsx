import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CytoscapeComponent from 'react-cytoscapejs';
import { DataGrid } from '@mui/x-data-grid';

const PLACEHOLDER_LABELS = {
  'architecture:application-inventory': 'Application Inventory',
  'architecture:dependency-model': 'Dependency Model',
  'architecture:impact-analysis': 'Impact Analysis',
  'architecture:blast-radius': 'Blast Radius View',
  'architecture:upstream-downstream': 'Upstream / Downstream Analysis',
  'architecture:criticality-overview': 'Criticality Overview',
  'architecture:lifecycle-overview': 'Lifecycle Overview',
  'architecture:dependency-validation': 'Dependency Validation',
  'architecture:orphan-detection': 'Orphan Application Detection',
  'analysis:decommission-impact': 'Application Decommission Impact',
  'analysis:change-impact': 'Change Impact Summary',
  'modeling:create-view': 'Create View',
  'modeling:layout-presets': 'Layout Presets',
  'modeling:group-owner': 'Group by Owner',
  'modeling:group-criticality': 'Group by Criticality',
  'modeling:group-lifecycle': 'Group by Lifecycle State',
  'tools:validate-data': 'Validate Data Integrity',
  'tools:broken-dependencies': 'Check Broken Dependencies',
  'help:product-overview': 'Product Overview',
  'help:documentation': 'Documentation',
  'help:architecture-concepts': 'Architecture Concepts',
  'help:open-logs': 'Open Logs Folder',
  'help:diagnostics': 'Diagnostics'
};

function createEmptyImpactReport() {
  return {
    appId: null,
    depthUsed: 0,
    direct: [],
    indirect: [],
    summary: {
      totalImpacted: 0,
      highestCriticality: null,
      retiringCount: 0
    }
  };
}

const VIEW_TYPE_OPTIONS = [
  { value: 'impact-analysis', label: 'Impact Analysis' },
  { value: 'risk-overview', label: 'Risk Overview' },
  { value: 'dependency-health', label: 'Dependency Health' },
  { value: 'custom', label: 'Custom' }
];

export default function App({ colorMode }) {
  const theme = useTheme();
  const toggleColorMode = colorMode?.toggleMode;
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [loading, setLoading] = useState(false);
  const [isSelectingFile, setIsSelectingFile] = useState(false);
  const [elements, setElements] = useState([]);
  const cyRef = useRef(null);
  const [cyReady, setCyReady] = useState(false);
  const [appsLoading, setAppsLoading] = useState(false);
  const [allApplications, setAllApplications] = useState([]);
  const [applications, setApplications] = useState([]);
  const [filters, setFilters] = useState({ text: '', criticality: '', status: '' });
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [showInventoryPanel, setShowInventoryPanel] = useState(true);
  const [showGraphPanel, setShowGraphPanel] = useState(true);
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showGridGuides, setShowGridGuides] = useState(false);
  const [impactDepth, setImpactDepth] = useState(3);
  const [impactReport, setImpactReport] = useState(() => createEmptyImpactReport());
  const [impactLoading, setImpactLoading] = useState(false);
  const [highlightRules, setHighlightRules] = useState({ direct: true, indirect: true });
  const [riskIndicators, setRiskIndicators] = useState(null);
  const [savedViews, setSavedViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState(null);
  const [viewDraft, setViewDraft] = useState({ name: '', viewType: 'impact-analysis' });
  const [applicationAnnotations, setApplicationAnnotations] = useState([]);
  const [appAnnotationText, setAppAnnotationText] = useState('');
  const [viewAnnotations, setViewAnnotations] = useState([]);
  const [viewAnnotationText, setViewAnnotationText] = useState('');
  const [isSavingView, setIsSavingView] = useState(false);

  const stylesheet = useMemo(() => {
    const primary = theme.palette.primary.main;
    const surface = theme.palette.background.paper;
    const onSurface = theme.palette.text.primary;
    const edge = alpha(theme.palette.text.primary, 0.38);
    const border = theme.palette.divider;
    const directFill = alpha(theme.palette.error.main, 0.14);
    const indirectFill = alpha(theme.palette.warning.main, 0.14);

    return [
      {
        selector: 'node',
        style: {
          label: showLabels ? 'data(label)' : '',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '100px',
          'background-color': surface,
          color: onSurface,
          'font-size': 11,
          'width': 120,
          'height': 64,
          'padding': '6px',
          shape: 'rectangle',
          'border-width': 1,
          'border-color': border
        }
      },
      {
        selector: 'node.impact-direct',
        style: {
          'background-color': directFill,
          'border-color': theme.palette.error.main
        }
      },
      {
        selector: 'node.impact-indirect',
        style: {
          'background-color': indirectFill,
          'border-color': theme.palette.warning.main
        }
      },
      {
        selector: 'node.selected',
        style: {
          'background-color': alpha(primary, 0.12),
          'border-width': 2,
          'border-color': primary
        }
      },
      {
        selector: 'edge',
        style: {
          width: 1.5,
          'line-color': edge,
          'target-arrow-color': edge,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: showLabels ? 'data(label)' : '',
          'font-size': 10,
          'color': theme.palette.text.secondary,
          'text-rotation': 'autorotate',
          'text-background-color': surface,
          'text-background-opacity': 0.9,
          'text-background-padding': 2,
          'text-wrap': 'wrap',
          'text-max-width': '120px'
        }
      }
    ];
  }, [theme, showLabels]);

  const inventoryColumns = useMemo(
    () => [
      { field: 'id', headerName: 'id', flex: 1, minWidth: 90 },
      { field: 'name', headerName: 'name', flex: 1.4, minWidth: 140 },
      { field: 'owner', headerName: 'owner', flex: 1.2, minWidth: 120 },
      { field: 'criticality', headerName: 'criticality', flex: 1, minWidth: 110 },
      { field: 'status', headerName: 'status', flex: 1, minWidth: 110 }
    ],
    []
  );

  const criticalityOptions = useMemo(() => {
    const values = allApplications.map((a) => a.criticality).filter(Boolean);
    return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  }, [allApplications]);

  const statusOptions = useMemo(() => {
    const values = allApplications.map((a) => a.status).filter(Boolean);
    return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  }, [allApplications]);

  const getCy = useCallback(() => {
    const instance = cyRef.current;
    if (!instance) return null;
    if (typeof instance.destroyed === 'function' && instance.destroyed()) return null;
    return instance;
  }, []);

  const highlightImpact = useCallback(
    (selectedId, report, rulesOverride) => {
      if (!cyReady) return;
      const cy = getCy();
      if (!cy) return;

      const rules = rulesOverride ?? highlightRules;
      const directIds =
        Array.isArray(report?.direct) && rules?.direct !== false
          ? report.direct
              .map((item) => item?.id)
              .filter((id) => Boolean(id) && id !== selectedId)
          : [];
      const indirectIds =
        Array.isArray(report?.indirect) && rules?.indirect !== false
          ? report.indirect
              .map((item) => item?.id)
              .filter((id) => Boolean(id) && id !== selectedId && !directIds.includes(id))
          : [];

      cy.batch(() => {
        cy.nodes().removeClass('impact impact-direct impact-indirect selected');

        if (selectedId) {
          const selectedNode = cy.getElementById(selectedId);
          if (selectedNode && selectedNode.nonempty()) {
            selectedNode.addClass('selected');
          }
        }

        directIds.forEach((id) => {
          const node = cy.getElementById(id);
          if (node && node.nonempty()) {
            node.addClass('impact-direct');
          }
        });

        indirectIds.forEach((id) => {
          const node = cy.getElementById(id);
          if (node && node.nonempty()) {
            node.addClass('impact-indirect');
          }
        });
      });
    },
    [cyReady, getCy, highlightRules]
  );

  const visibleApplicationIds = useMemo(() => {
    return new Set(applications.map((a) => a.id).filter(Boolean));
  }, [applications]);

  const hasActiveFilters = useMemo(() => {
    return Boolean(filters.text || filters.criticality || filters.status);
  }, [filters]);

  const selectedApplication = useMemo(() => {
    if (!selectedApplicationId) return null;
    return allApplications.find((app) => app.id === selectedApplicationId) ?? null;
  }, [allApplications, selectedApplicationId]);

  const riskData = useMemo(() => riskIndicators ?? { thresholds: {} }, [riskIndicators]);

  const formatApplicationLabel = useCallback((app) => app?.name ?? app?.id ?? 'Unknown', []);

  const applicationById = useMemo(() => {
    const map = new Map();
    allApplications.forEach((app) => {
      if (app?.id) {
        map.set(app.id, app);
      }
    });
    return map;
  }, [allApplications]);

  const hasGraphData = useMemo(() => Array.isArray(elements) && elements.length > 0, [elements]);
  const emptyElements = useMemo(() => [], []);

  const layoutColumns = useMemo(() => {
    const segments = [];
    if (showInventoryPanel) segments.push('420px');
    if (showGraphPanel) segments.push('minmax(0, 1fr)');
    if (showDetailsPanel) segments.push('360px');
    if (segments.length === 0) {
      return 'minmax(0, 1fr)';
    }
    return segments.join(' ');
  }, [showInventoryPanel, showGraphPanel, showDetailsPanel]);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const graph = await window.electronAPI.getGraph();
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
  }, []);

  const handlePlaceholderCommand = useCallback((command) => {
    const label = PLACEHOLDER_LABELS[command];
    if (!label) {
      return;
    }
    setSnackbar({ open: true, message: `${label} is not available in this build.`, severity: 'info' });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedApplicationId(null);
    const empty = createEmptyImpactReport();
    setImpactReport(empty);
    highlightImpact(null, empty);
  }, [highlightImpact]);

  const refreshSavedViews = useCallback(async () => {
    try {
      const result = await window.electronAPI.listAnalysisViews();
      const views = Array.isArray(result) ? result : [];
      setSavedViews(views);
      if (selectedViewId && !views.some((view) => view?.id === selectedViewId)) {
        setSelectedViewId(null);
        setViewAnnotations([]);
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Loading saved views failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, [selectedViewId]);

  const reloadData = useCallback(async () => {
    const errorMessages = [];

    const [appsResult, riskResult] = await Promise.allSettled([
      window.electronAPI.getApplications(),
      window.electronAPI.getRiskIndicators()
    ]);

    if (appsResult.status === 'fulfilled') {
      const apps = Array.isArray(appsResult.value) ? appsResult.value : [];
      setAllApplications(apps);
      if (!hasActiveFilters) {
        setApplications(apps);
      }
    } else {
      setAllApplications([]);
      setApplications([]);
      errorMessages.push(`Loading applications failed: ${appsResult.reason?.message ?? appsResult.reason}`);
    }

    if (riskResult.status === 'fulfilled') {
      setRiskIndicators(riskResult.value ?? null);
    } else {
      setRiskIndicators(null);
      errorMessages.push(`Loading risk indicators failed: ${riskResult.reason?.message ?? riskResult.reason}`);
    }

    await loadGraph();
    await refreshSavedViews();

    if (errorMessages.length) {
      setSnackbar({ open: true, message: errorMessages.join(' '), severity: 'error' });
    }
  }, [hasActiveFilters, loadGraph, refreshSavedViews]);

  const loadApplicationAnnotationList = useCallback(async (appId) => {
    if (!appId) {
      setApplicationAnnotations([]);
      return;
    }

    try {
      const result = await window.electronAPI.listAnnotations({ scope: 'application', targetId: appId });
      setApplicationAnnotations(Array.isArray(result) ? result : []);
    } catch (error) {
      setApplicationAnnotations([]);
      setSnackbar({
        open: true,
        message: `Loading application annotations failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, []);

  const loadViewAnnotationList = useCallback(async (viewId) => {
    if (!viewId) {
      setViewAnnotations([]);
      return;
    }

    try {
      const result = await window.electronAPI.listAnnotations({ scope: 'view', targetId: viewId });
      setViewAnnotations(Array.isArray(result) ? result : []);
    } catch (error) {
      setViewAnnotations([]);
      setSnackbar({
        open: true,
        message: `Loading view annotations failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, []);

  const handleSaveView = useCallback(async () => {
    const name = viewDraft.name?.trim();
    if (!name) {
      setSnackbar({ open: true, message: 'View name is required.', severity: 'warning' });
      return;
    }

    setIsSavingView(true);
    try {
      const payload = {
        id: viewDraft.id,
        name,
        viewType: viewDraft.viewType ?? 'analysis',
        filters,
        traversalDepth: impactDepth,
        highlightRules,
        layout: {
          name: 'cose',
          focusApplicationId: selectedApplicationId ?? null
        }
      };

      const saved = await window.electronAPI.saveAnalysisView(payload);
      await refreshSavedViews();
      if (saved?.id) {
        setSelectedViewId(saved.id);
        setViewDraft((draft) => ({ ...draft, id: saved.id, name: '' }));
      } else {
        setViewDraft((draft) => ({ ...draft, name: '' }));
      }
      setSnackbar({ open: true, message: 'Analysis view saved.', severity: 'success' });
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Saving analysis view failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    } finally {
      setIsSavingView(false);
    }
  }, [viewDraft, filters, impactDepth, highlightRules, selectedApplicationId, refreshSavedViews]);

  const handleLoadView = useCallback(
    async (viewId) => {
      if (!viewId) return;
      try {
        const view = await window.electronAPI.loadAnalysisView(viewId);
        if (!view) {
          setSnackbar({ open: true, message: 'Saved view not found.', severity: 'warning' });
          return;
        }
        setSelectedViewId(viewId);
        setViewDraft((draft) => ({
          ...draft,
          viewType: view.viewType ?? draft.viewType,
          id: viewId,
          name: view.name ?? ''
        }));
        if (view.filters && typeof view.filters === 'object') {
          setFilters({ text: '', criticality: '', status: '', ...view.filters });
        }
        if (Number.isInteger(view.traversalDepth) && view.traversalDepth > 0) {
          setImpactDepth(view.traversalDepth);
        }
        if (view.highlightRules && typeof view.highlightRules === 'object') {
          setHighlightRules((rules) => ({ ...rules, ...view.highlightRules }));
        }
        if (view.layout?.focusApplicationId) {
          setSelectedApplicationId(view.layout.focusApplicationId);
        }
        setSnackbar({ open: true, message: 'Saved view loaded.', severity: 'success' });
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Loading saved view failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      }
    },
    []
  );

  const handleDeleteView = useCallback(
    async (viewId) => {
      if (!viewId) return;
      try {
        const removed = await window.electronAPI.deleteAnalysisView(viewId);
        if (removed) {
          await refreshSavedViews();
          if (selectedViewId === viewId) {
            setSelectedViewId(null);
            setViewAnnotations([]);
          }
          setSnackbar({ open: true, message: 'Saved view deleted.', severity: 'info' });
        }
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Deleting saved view failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      }
    },
    [refreshSavedViews, selectedViewId]
  );

  const handleAddApplicationAnnotation = useCallback(async () => {
    const text = appAnnotationText.trim();
    if (!selectedApplicationId || !text) {
      return;
    }
    try {
      await window.electronAPI.addAnnotation({
        scope: 'application',
        targetId: selectedApplicationId,
        text
      });
      setAppAnnotationText('');
      await loadApplicationAnnotationList(selectedApplicationId);
      setSnackbar({ open: true, message: 'Annotation added.', severity: 'success' });
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Adding annotation failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, [appAnnotationText, selectedApplicationId, loadApplicationAnnotationList]);

  const handleAddViewAnnotation = useCallback(async () => {
    const text = viewAnnotationText.trim();
    if (!selectedViewId || !text) {
      return;
    }
    try {
      await window.electronAPI.addAnnotation({
        scope: 'view',
        targetId: selectedViewId,
        text
      });
      setViewAnnotationText('');
      await loadViewAnnotationList(selectedViewId);
      setSnackbar({ open: true, message: 'View annotation added.', severity: 'success' });
    } catch (error) {
      setSnackbar({
        open: true,
        message: `Adding view annotation failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, [viewAnnotationText, selectedViewId, loadViewAnnotationList]);

  const handleImportApplications = useCallback(async () => {
    if (isSelectingFile) return;
    setIsSelectingFile(true);
    try {
      const filePath = await window.electronAPI.selectFile({ userInitiated: true });
      if (!filePath) return;

      const result = await window.electronAPI.importApplications(filePath);
      if (result.success) {
        await reloadData();
      } else {
        alert(result.error);
      }
    } finally {
      setIsSelectingFile(false);
    }
  }, [isSelectingFile, reloadData]);

  const handleImportDependencies = useCallback(async () => {
    if (isSelectingFile) return;
    setIsSelectingFile(true);
    try {
      const filePath = await window.electronAPI.selectFile({ userInitiated: true });
      if (!filePath) return;

      const result = await window.electronAPI.importDependencies(filePath);
      if (result.success) {
        await reloadData();
      } else {
        alert(result.error);
      }
    } finally {
      setIsSelectingFile(false);
    }
  }, [isSelectingFile, reloadData]);

  const handleInventoryRowClick = useCallback((params) => {
    const nextId = params?.row?.id;
    if (!nextId) return;
    setSelectedApplicationId(nextId);
  }, []);

  const refreshGraphView = useCallback(() => {
    if (!cyReady) return;
    const cy = getCy();
    if (!cy) return;
    cy.resize();
    cy.style?.().update?.();
  }, [cyReady, getCy]);

  const resetGraphLayout = useCallback(() => {
    if (!cyReady || !hasGraphData) return;
    const cy = getCy();
    if (!cy) return;
    cy.layout({ name: 'cose', animate: false }).run();
  }, [cyReady, getCy, hasGraphData]);

  const fitGraphToScreen = useCallback(() => {
    if (!cyReady || !hasGraphData) return;
    const cy = getCy();
    if (!cy) return;
    cy.fit(undefined, 48);
  }, [cyReady, getCy, hasGraphData]);

  const zoomGraph = useCallback(
    (factor) => {
      if (!cyReady || !hasGraphData) return;
      const cy = getCy();
      if (!cy) return;
      const current = cy.zoom();
      const next = Math.max(0.1, Math.min(current * factor, 4));
      cy.zoom({ level: next, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    },
    [cyReady, getCy, hasGraphData]
  );

  const processMenuCommand = useCallback(
    (command, payload) => {
      if (!command) return;

      // Studio navigation and Studio-only commands are handled by the router host.
      if (typeof command === 'string' && command.startsWith('studio:')) {
        return;
      }

      switch (command) {
        case 'workspace:import-applications':
          handleImportApplications();
          break;
        case 'workspace:import-dependencies':
          handleImportDependencies();
          break;
        case 'edit:clear-selection':
          clearSelection();
          break;
        case 'view:reload-data':
          reloadData();
          break;
        case 'view:refresh-graph':
          refreshGraphView();
          break;
        case 'view:reset-layout':
          resetGraphLayout();
          break;
        case 'view:fit-graph':
          fitGraphToScreen();
          break;
        case 'view:zoom-in':
          zoomGraph(1.2);
          break;
        case 'view:zoom-out':
          zoomGraph(1 / 1.2);
          break;
        case 'view:toggle-inventory':
          setShowInventoryPanel(Boolean(payload));
          break;
        case 'view:toggle-graph':
          setShowGraphPanel(Boolean(payload));
          break;
        case 'view:toggle-details':
          setShowDetailsPanel(Boolean(payload));
          break;
        case 'view:toggle-dark-mode':
          toggleColorMode?.();
          break;
        case 'view:toggle-labels':
          setShowLabels(Boolean(payload));
          break;
        case 'view:toggle-grid':
          setShowGridGuides(Boolean(payload));
          break;
        case 'help:about':
          setSnackbar({ open: true, message: 'Redly Intelligence — EA Lite Desktop (internal build).', severity: 'info' });
          break;
        case 'modeling:create-view':
          setShowDetailsPanel(true);
          setSnackbar({
            open: true,
            message: 'Configure the current impact view and save it from the Details panel.',
            severity: 'info'
          });
          break;
        default:
          handlePlaceholderCommand(command);
      }
    },
    [
      clearSelection,
      fitGraphToScreen,
      handleImportApplications,
      handleImportDependencies,
      handlePlaceholderCommand,
      refreshGraphView,
      reloadData,
      resetGraphLayout,
      setShowDetailsPanel,
      setShowGraphPanel,
      setShowInventoryPanel,
      setShowLabels,
      setShowGridGuides,
      toggleColorMode,
      zoomGraph
    ]
  );

  useEffect(() => {
    const api = window?.electronAPI;
    if (!api?.onMenuCommand) return () => {};

    const unsubscribe = api.onMenuCommand((command, payload) => {
      processMenuCommand(command, payload);
    });

    const proxyHandler = (event) => {
      const detail = event?.detail;
      if (!detail?.command) return;
      processMenuCommand(detail.command, detail.payload);
    };

    window.addEventListener('studio:command', proxyHandler);

    return () => {
      unsubscribe?.();
      window.removeEventListener('studio:command', proxyHandler);
    };
  }, [processMenuCommand]);

  const handleCyInit = useCallback(
    (instance) => {
      if (!instance) return;
      if (cyRef.current === instance && cyReady) return;

      cyRef.current = instance;
      setCyReady(false);
      instance.ready(() => {
        if (cyRef.current !== instance) return;
        setCyReady(true);
      });
      instance.one('destroy', () => {
        if (cyRef.current === instance) {
          cyRef.current = null;
          setCyReady(false);
        }
      });
    },
    [cyReady]
  );

  useEffect(() => {
    if (!cyReady) return;
    const cy = getCy();
    if (!cy) return;

    if (!hasGraphData) {
      cy.elements().remove();
      return;
    }

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });

    cy.layout({ name: 'cose', animate: false }).run();
  }, [elements, cyReady, hasGraphData, getCy]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  useEffect(() => {
    refreshSavedViews();
  }, [refreshSavedViews]);

  useEffect(() => {
    loadApplicationAnnotationList(selectedApplicationId);
  }, [selectedApplicationId, loadApplicationAnnotationList]);

  useEffect(() => {
    loadViewAnnotationList(selectedViewId);
  }, [selectedViewId, loadViewAnnotationList]);

  useEffect(() => {
    if (!cyReady) return;
    const cy = getCy();
    if (!cy) return;

    const handler = (evt) => {
      const nodeId = evt.target.id();
      setSelectedApplicationId(nodeId);
    };

    cy.on('tap', 'node', handler);
    return () => cy.off('tap', 'node', handler);
  }, [cyReady, getCy]);

  useEffect(() => {
    if (!cyReady) return;
    const cy = getCy();
    if (!cy) return;
    if (!hasGraphData) return;

    // Filter graph visibility based on inventory result set.
    cy.batch(() => {
      const ids = visibleApplicationIds;

      cy.nodes().forEach((n) => {
        const shouldShow = !hasActiveFilters || ids.has(n.id());
        if (shouldShow) n.show();
        else n.hide();
      });

      cy.edges().forEach((e) => {
        const shouldShow = e.source().visible() && e.target().visible();
        if (shouldShow) e.show();
        else e.hide();
      });
    });
  }, [visibleApplicationIds, hasActiveFilters, cyReady, hasGraphData, getCy]);

  useEffect(() => {
    const reset = () => {
      const empty = createEmptyImpactReport();
      setImpactReport(empty);
      highlightImpact(null, empty);
      setImpactLoading(false);
    };

    if (!hasGraphData || !selectedApplicationId) {
      reset();
      return;
    }

    if (hasActiveFilters && !visibleApplicationIds.has(selectedApplicationId)) {
      reset();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setImpactLoading(true);
        const result = await window.electronAPI.getImpact({ appId: selectedApplicationId, depth: impactDepth });
        if (cancelled) return;
        const baseline = createEmptyImpactReport();
        const normalized =
          result && typeof result === 'object'
            ? {
                ...baseline,
                ...result,
                summary: { ...baseline.summary, ...(result.summary ?? {}) },
                direct: Array.isArray(result.direct) ? result.direct : [],
                indirect: Array.isArray(result.indirect) ? result.indirect : []
              }
            : baseline;
        setImpactReport(normalized);
      } catch (error) {
        if (!cancelled) {
          setSnackbar({
            open: true,
            message: `Impact analysis failed: ${error?.message ?? error}`,
            severity: 'error'
          });
          setImpactReport(createEmptyImpactReport());
        }
      } finally {
        if (!cancelled) {
          setImpactLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedApplicationId, impactDepth, hasGraphData, hasActiveFilters, visibleApplicationIds, highlightImpact]);

  useEffect(() => {
    if (!selectedApplicationId) {
      highlightImpact(null, impactReport);
      return;
    }

    if (hasActiveFilters && !visibleApplicationIds.has(selectedApplicationId)) {
      highlightImpact(null, impactReport);
      return;
    }

    highlightImpact(selectedApplicationId, impactReport);
  }, [selectedApplicationId, impactReport, hasActiveFilters, visibleApplicationIds, highlightImpact]);

  useEffect(() => {
    if (!hasGraphData) return;
    highlightImpact(selectedApplicationId, impactReport, highlightRules);
  }, [highlightRules, hasGraphData, selectedApplicationId, impactReport, highlightImpact]);

  useEffect(() => {
    if (!cyReady) return;
    const cy = getCy();
    const container = cy?.container?.();
    if (!container) return;

    if (showGridGuides) {
      container.style.backgroundImage = `linear-gradient(to right, ${alpha(theme.palette.primary.main, 0.12)} 1px, transparent 1px), linear-gradient(to bottom, ${alpha(theme.palette.primary.main, 0.12)} 1px, transparent 1px)`;
      container.style.backgroundSize = '48px 48px';
      container.style.backgroundPosition = '0 0';
    } else {
      container.style.backgroundImage = '';
      container.style.backgroundSize = '';
      container.style.backgroundPosition = '';
    }
  }, [showGridGuides, cyReady, getCy, theme]);

  useEffect(() => {
    // Neo4j-backed search: one filter logic source.
    const run = async () => {
      if (!hasActiveFilters) {
        setApplications(allApplications);
        return;
      }

      try {
        setAppsLoading(true);
        const result = await window.electronAPI.searchApplications(filters);
        setApplications(Array.isArray(result) ? result : []);
      } catch (error) {
        setSnackbar({
          open: true,
          message: `Application search failed: ${error?.message ?? error}`,
          severity: 'error'
        });
      } finally {
        setAppsLoading(false);
      }
    };

    run();
  }, [filters, hasActiveFilters, allApplications]);

  useEffect(() => {
    if (!showGraphPanel) return;
    refreshGraphView();
  }, [showGraphPanel, refreshGraphView]);

  useEffect(() => {
    if (!cyReady) return;
    if (!showGraphPanel) return;
    refreshGraphView();
  }, [cyReady, showGraphPanel, refreshGraphView]);


  const hasVisiblePanels = showInventoryPanel || showGraphPanel || showDetailsPanel;

  return (
    <Box sx={{ height: '100vh', bgcolor: 'background.default', color: 'text.primary', display: 'flex', flexDirection: 'column' }}>
      {hasVisiblePanels ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: layoutColumns,
            overflow: 'hidden',
            bgcolor: 'background.default'
          }}
        >
          {showInventoryPanel ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                borderRight: showGraphPanel || showDetailsPanel ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                bgcolor: 'background.paper',
                minHeight: 0
              }}
            >
              <Box sx={{ px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Application Inventory
                  </Typography>
                  {loading ? <CircularProgress size={16} sx={{ color: 'primary.main' }} /> : null}
                </Box>
                <TextField
                  label="Search"
                  value={filters.text}
                  size="small"
                  onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
                  placeholder="Filter by application name"
                  fullWidth
                  variant="outlined"
                  disabled={loading}
                  sx={(theme) => ({
                    '& .MuiInputBase-root': {
                      backgroundColor:
                        theme.palette.mode === 'dark'
                          ? alpha(theme.palette.background.default, 0.7)
                          : theme.palette.background.paper
                    },
                    '& .MuiInputBase-input': {
                      color: theme.palette.text.primary
                    },
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: theme.palette.divider
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: theme.palette.primary.main
                    },
                    '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor: theme.palette.primary.main
                    }
                  })}
                />

                <Box sx={{ display: 'flex', gap: 2 }}>
                  <FormControl
                    size="small"
                    fullWidth
                    disabled={loading}
                    sx={(theme) => ({
                      '& .MuiInputBase-root': {
                        backgroundColor:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.background.default, 0.7)
                            : theme.palette.background.paper,
                        color: theme.palette.text.primary
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.divider
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.primary.main
                      },
                      '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.primary.main
                      },
                      '& .MuiSvgIcon-root': {
                        color: theme.palette.text.secondary
                      }
                    })}
                  >
                    <InputLabel
                      id="criticality-label"
                      sx={{ color: 'text.secondary', '&.Mui-focused': { color: 'primary.main' } }}
                    >
                      Criticality
                    </InputLabel>
                    <Select
                      labelId="criticality-label"
                      label="Criticality"
                      value={filters.criticality}
                      onChange={(e) => setFilters((f) => ({ ...f, criticality: e.target.value }))}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            bgcolor: 'background.paper'
                          }
                        }
                      }}
                    >
                      <MenuItem value="">All</MenuItem>
                      {criticalityOptions.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl
                    size="small"
                    fullWidth
                    disabled={loading}
                    sx={(theme) => ({
                      '& .MuiInputBase-root': {
                        backgroundColor:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.background.default, 0.7)
                            : theme.palette.background.paper,
                        color: theme.palette.text.primary
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.divider
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.primary.main
                      },
                      '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme.palette.primary.main
                      },
                      '& .MuiSvgIcon-root': {
                        color: theme.palette.text.secondary
                      }
                    })}
                  >
                    <InputLabel
                      id="status-label"
                      sx={{ color: 'text.secondary', '&.Mui-focused': { color: 'primary.main' } }}
                    >
                      Status
                    </InputLabel>
                    <Select
                      labelId="status-label"
                      label="Status"
                      value={filters.status}
                      onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            bgcolor: 'background.paper'
                          }
                        }
                      }}
                    >
                      <MenuItem value="">All</MenuItem>
                      {statusOptions.map((s) => (
                        <MenuItem key={s} value={s}>
                          {s}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              </Box>

              <Divider sx={{ borderColor: 'divider' }} />

              <Box sx={{ flex: 1, minHeight: 0, p: 3, pt: 2 }}>
                <DataGrid
                  rows={applications}
                  columns={inventoryColumns}
                  loading={appsLoading}
                  density="compact"
                  disableColumnMenu
                  disableRowSelectionOnClick={false}
                  onRowClick={handleInventoryRowClick}
                  rowSelectionModel={selectedApplicationId ? [selectedApplicationId] : []}
                  onRowSelectionModelChange={(model) => {
                    const nextId = model?.[0];
                    if (nextId) setSelectedApplicationId(nextId);
                  }}
                  initialState={{
                    pagination: { paginationModel: { pageSize: 25, page: 0 } }
                  }}
                  pageSizeOptions={[25, 50, 100]}
                  sx={(theme) => {
                    const selectedOpacity = theme.palette.action.selectedOpacity + 0.08;
                    const hoverOpacity = theme.palette.action.hoverOpacity + 0.04;
                    return {
                      border: 0,
                      color: theme.palette.text.primary,
                      '& .MuiDataGrid-cell': {
                        borderBottom: `1px solid ${theme.palette.divider}`
                      },
                      '& .MuiDataGrid-columnHeaders': {
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        backgroundColor: theme.palette.background.paper,
                        color: theme.palette.text.secondary,
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5
                      },
                      '& .MuiDataGrid-virtualScroller': {
                        backgroundColor: theme.palette.background.paper
                      },
                      '& .MuiDataGrid-row.Mui-selected': {
                        backgroundColor: `${alpha(theme.palette.primary.main, selectedOpacity)} !important`
                      },
                      '& .MuiDataGrid-row.Mui-selected:hover': {
                        backgroundColor: `${alpha(theme.palette.primary.main, selectedOpacity + hoverOpacity)} !important`
                      },
                      '& .MuiDataGrid-footerContainer': {
                        borderTop: `1px solid ${theme.palette.divider}`,
                        color: theme.palette.text.secondary,
                        backgroundColor: theme.palette.background.paper
                      },
                      '& .MuiDataGrid-selectedRowCount': {
                        visibility: 'hidden'
                      }
                    };
                  }}
                />
              </Box>
            </Box>
          ) : null}

          {showGraphPanel ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.paper',
                minHeight: 0
              }}
            >
              <Box
                sx={{
                  px: 3,
                  py: 2,
                  borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Application Dependency Graph
                </Typography>
                {showLabels ? (
                  <Typography variant="caption" color="text.secondary">
                    Labels visible
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Labels hidden
                  </Typography>
                )}
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  position: 'relative',
                  bgcolor: 'background.default'
                }}
              >
                <CytoscapeComponent
                  elements={emptyElements}
                  style={{ width: '100%', height: '100%', backgroundColor: theme.palette.background.default }}
                  stylesheet={stylesheet}
                  cy={handleCyInit}
                />
                {!hasGraphData ? (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      color: 'text.secondary'
                    }}
                  >
                    <Typography variant="body2">No dependency graph data available</Typography>
                  </Box>
                ) : null}
              </Box>
            </Box>
          ) : null}

          {showDetailsPanel ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.paper',
                borderLeft: (theme) => `1px solid ${theme.palette.divider}`,
                minHeight: 0,
                p: 3,
                gap: 2
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Architectural Analysis
              </Typography>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  pr: 1
                }}
              >
                <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Selection Overview
                    </Typography>
                    {selectedApplication ? (
                      <Stack spacing={0.75}>
                        <Typography variant="body2">
                          <strong>Name:</strong> {formatApplicationLabel(selectedApplication)}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Owner:</strong> {selectedApplication.owner ?? '—'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Criticality:</strong> {selectedApplication.criticality ?? '—'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>Status:</strong> {selectedApplication.status ?? '—'}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="outlined" onClick={clearSelection}>
                            Clear selection
                          </Button>
                        </Stack>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Select an application in the inventory or graph to inspect impact and risk details.
                      </Typography>
                    )}
                  </Stack>
                </Paper>

                <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Impact Analysis
                      </Typography>
                      {impactLoading ? <CircularProgress size={16} /> : null}
                    </Stack>
                    <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
                      <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel id="impact-depth-label">Depth</InputLabel>
                        <Select
                          labelId="impact-depth-label"
                          label="Depth"
                          value={impactDepth}
                          onChange={(e) => setImpactDepth(Number(e.target.value))}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                            <MenuItem key={value} value={value}>
                              {value === 10 ? '10 (max)' : value}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            color="primary"
                            checked={Boolean(highlightRules.direct)}
                            onChange={(event) =>
                              setHighlightRules((rules) => ({ ...rules, direct: event.target.checked }))
                            }
                          />
                        }
                        label="Highlight direct"
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            size="small"
                            color="primary"
                            checked={Boolean(highlightRules.indirect)}
                            onChange={(event) =>
                              setHighlightRules((rules) => ({ ...rules, indirect: event.target.checked }))
                            }
                          />
                        }
                        label="Highlight indirect"
                      />
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip label={`Total impacted: ${impactReport.summary.totalImpacted}`} size="small" />
                      <Chip
                        label={`Highest criticality: ${impactReport.summary.highestCriticality ?? '—'}`}
                        size="small"
                      />
                      <Chip label={`Retiring impacted: ${impactReport.summary.retiringCount}`} size="small" />
                    </Stack>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Direct Impacts ({impactReport.direct.length})
                      </Typography>
                      {impactReport.direct.length ? (
                        <List dense disablePadding>
                          {impactReport.direct.map((item) => (
                            <ListItem key={item.id} disableGutters sx={{ py: 0.5 }}>
                              <ListItemText
                                primary={formatApplicationLabel(item)}
                                secondary={`Criticality: ${item.criticality ?? '—'} · Status: ${item.status ?? '—'}`}
                              />
                            </ListItem>
                          ))}
                        </List>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No direct impacts identified at this depth.
                        </Typography>
                      )}
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Indirect Impacts ({impactReport.indirect.length})
                      </Typography>
                      {impactReport.indirect.length ? (
                        <List dense disablePadding>
                          {impactReport.indirect.map((item) => (
                            <ListItem key={item.id} disableGutters sx={{ py: 0.5 }}>
                              <ListItemText
                                primary={`${formatApplicationLabel(item)} (depth ${item.depth})`}
                                secondary={`Criticality: ${item.criticality ?? '—'} · Status: ${item.status ?? '—'}`}
                              />
                            </ListItem>
                          ))}
                        </List>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No indirect impacts identified at this depth.
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Paper>

                <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Architectural Risk Indicators
                    </Typography>
                    {riskIndicators === null ? (
                      <Typography variant="body2" color="text.secondary">
                        Risk indicators will appear once data is available.
                      </Typography>
                    ) : (
                      <Stack spacing={1.5}>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          <Chip
                            label={`Single points: ${riskData.singlePointsOfFailure?.length ?? 0}`}
                            size="small"
                            color={riskData.singlePointsOfFailure?.length ? 'warning' : 'default'}
                          />
                          <Chip
                            label={`Overloaded providers: ${riskData.overloadedProviders?.length ?? 0}`}
                            size="small"
                            color={riskData.overloadedProviders?.length ? 'warning' : 'default'}
                          />
                          <Chip
                            label={`Critical→retiring: ${riskData.criticalRetiringRisks?.length ?? 0}`}
                            size="small"
                            color={riskData.criticalRetiringRisks?.length ? 'error' : 'default'}
                          />
                          <Chip
                            label={`Cycles: ${riskData.circularDependencies?.length ?? 0}`}
                            size="small"
                            color={riskData.circularDependencies?.length ? 'error' : 'default'}
                          />
                        </Stack>
                        <Box>
                          <Typography variant="overline" sx={{ letterSpacing: 0.8 }}>
                            Single Points of Failure (fan-in ≥ {riskData.thresholds?.fanIn ?? '—'})
                          </Typography>
                          {riskData.singlePointsOfFailure?.length ? (
                            <List dense disablePadding>
                              {riskData.singlePointsOfFailure.map((item) => (
                                <ListItem key={item.id} disableGutters sx={{ py: 0.5 }}>
                                  <ListItemText
                                    primary={formatApplicationLabel(item)}
                                    secondary={`Dependents: ${item.fanIn}`}
                                  />
                                </ListItem>
                              ))}
                            </List>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No single points of failure detected.
                            </Typography>
                          )}
                        </Box>
                        <Box>
                          <Typography variant="overline" sx={{ letterSpacing: 0.8 }}>
                            Overloaded Providers (fan-out ≥ {riskData.thresholds?.fanOut ?? '—'})
                          </Typography>
                          {riskData.overloadedProviders?.length ? (
                            <List dense disablePadding>
                              {riskData.overloadedProviders.map((item) => (
                                <ListItem key={item.id} disableGutters sx={{ py: 0.5 }}>
                                  <ListItemText
                                    primary={formatApplicationLabel(item)}
                                    secondary={`Consumers: ${item.fanOut}`}
                                  />
                                </ListItem>
                              ))}
                            </List>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No overloaded providers detected.
                            </Typography>
                          )}
                        </Box>
                        <Box>
                          <Typography variant="overline" sx={{ letterSpacing: 0.8 }}>
                            Critical → Retiring Dependencies
                          </Typography>
                          {riskData.criticalRetiringRisks?.length ? (
                            <List dense disablePadding>
                              {riskData.criticalRetiringRisks.map((item, index) => (
                                <ListItem
                                  key={`${item.consumer?.id ?? 'unknown'}-${item.provider?.id ?? 'unknown'}-${index}`}
                                  disableGutters
                                  sx={{ py: 0.5 }}
                                >
                                  <ListItemText
                                    primary={`${formatApplicationLabel(item.consumer)} → ${formatApplicationLabel(item.provider)}`}
                                    secondary={`${item.dependency?.label || 'Dependency'} · Provider status: ${item.provider?.status ?? '—'}`}
                                  />
                                </ListItem>
                              ))}
                            </List>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No critical-to-retiring exposures detected.
                            </Typography>
                          )}
                        </Box>
                        <Box>
                          <Typography variant="overline" sx={{ letterSpacing: 0.8 }}>
                            Circular Dependencies
                          </Typography>
                          {riskData.circularDependencies?.length ? (
                            <List dense disablePadding>
                              {riskData.circularDependencies.map((cycle) => {
                                const label = cycle.nodes
                                  .map((id) => formatApplicationLabel(applicationById.get(id) ?? { id }))
                                  .join(' → ');
                                return (
                                  <ListItem key={cycle.nodes.join('>')} disableGutters sx={{ py: 0.5 }}>
                                    <ListItemText primary={label} secondary={`Length: ${cycle.size}`} />
                                  </ListItem>
                                );
                              })}
                            </List>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              No circular dependencies detected.
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                    )}
                  </Stack>
                </Paper>

                <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Saved Analysis Views
                      </Typography>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleSaveView}
                        disabled={isSavingView}
                      >
                        {viewDraft?.id ? 'Update view' : 'Save view'}
                      </Button>
                    </Stack>
                    <Stack spacing={1.2}>
                      <TextField
                        label="View name"
                        size="small"
                        value={viewDraft.name}
                        onChange={(e) => setViewDraft((draft) => ({ ...draft, name: e.target.value }))}
                      />
                      <FormControl size="small">
                        <InputLabel id="view-type-label">View type</InputLabel>
                        <Select
                          labelId="view-type-label"
                          label="View type"
                          value={viewDraft.viewType ?? VIEW_TYPE_OPTIONS[0].value}
                          onChange={(e) => setViewDraft((draft) => ({ ...draft, viewType: e.target.value }))}
                        >
                          {VIEW_TYPE_OPTIONS.map((option) => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Stack>
                    {savedViews.length ? (
                      <List dense disablePadding>
                        {savedViews.map((view) => (
                          <ListItem
                            key={view.id}
                            disableGutters
                            sx={{
                              py: 0.75,
                              px: 1,
                              borderRadius: 1,
                              bgcolor: selectedViewId === view.id ? 'action.selected' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1
                            }}
                          >
                            <ListItemText
                              primary={view.name}
                              secondary={`${view.viewType ?? 'analysis'} · depth ${view.traversalDepth ?? 1}`}
                            />
                            <Stack direction="row" spacing={1}>
                              <Button size="small" variant="outlined" onClick={() => handleLoadView(view.id)}>
                                Load
                              </Button>
                              <Button size="small" color="error" onClick={() => handleDeleteView(view.id)}>
                                Delete
                              </Button>
                            </Stack>
                          </ListItem>
                        ))}
                      </List>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No saved analysis views yet. Configure the impact view and save it for reuse.
                      </Typography>
                    )}
                  </Stack>
                </Paper>

                <Paper sx={{ p: 2, bgcolor: 'background.default', mb: 1 }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Annotations
                    </Typography>
                    <Stack spacing={1}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Application Notes
                      </Typography>
                      {selectedApplicationId ? (
                        <>
                          <TextField
                            label="Add annotation"
                            size="small"
                            multiline
                            minRows={2}
                            value={appAnnotationText}
                            onChange={(e) => setAppAnnotationText(e.target.value)}
                          />
                          <Button
                            size="small"
                            variant="contained"
                            onClick={handleAddApplicationAnnotation}
                            disabled={!appAnnotationText.trim()}
                          >
                            Add annotation
                          </Button>
                        </>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Select an application to capture contextual notes.
                        </Typography>
                      )}
                      {applicationAnnotations.length ? (
                        <List dense disablePadding>
                          {applicationAnnotations.map((item) => (
                            <ListItem key={item.id} disableGutters sx={{ py: 0.5 }}>
                              <ListItemText
                                primary={item.text}
                                secondary={item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                              />
                            </ListItem>
                          ))}
                        </List>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No annotations for this application.
                        </Typography>
                      )}
                    </Stack>
                    <Divider />
                    <Stack spacing={1}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Saved View Notes
                      </Typography>
                      {selectedViewId ? (
                        <>
                          <TextField
                            label="Add view annotation"
                            size="small"
                            multiline
                            minRows={2}
                            value={viewAnnotationText}
                            onChange={(e) => setViewAnnotationText(e.target.value)}
                          />
                          <Button
                            size="small"
                            variant="contained"
                            onClick={handleAddViewAnnotation}
                            disabled={!viewAnnotationText.trim()}
                          >
                            Add annotation
                          </Button>
                        </>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Load a saved view to attach annotations.
                        </Typography>
                      )}
                      {viewAnnotations.length ? (
                        <List dense disablePadding>
                          {viewAnnotations.map((item) => (
                            <ListItem key={item.id} disableGutters sx={{ py: 0.5 }}>
                              <ListItemText
                                primary={item.text}
                                secondary={item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                              />
                            </ListItem>
                          ))}
                        </List>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No annotations for this saved view yet.
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                </Paper>
              </Box>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
          <Typography variant="body1">Enable a panel from the View menu to begin working.</Typography>
        </Box>
      )}

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
