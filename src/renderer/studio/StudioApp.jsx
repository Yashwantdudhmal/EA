import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/DownloadOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import GridOffIcon from '@mui/icons-material/GridOff';
import GridOnIcon from '@mui/icons-material/GridOn';
import RefreshIcon from '@mui/icons-material/Autorenew';
import SaveIcon from '@mui/icons-material/SaveOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import { Background, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import './studioCanvas.css';

import GenericNode from './components/GenericNode.jsx';
import GroupNode from './components/GroupNode.jsx';
import TemplateInstanceNode from './components/TemplateInstanceNode.jsx';
import { computeImpactAnalysis } from './impact/impact.js';
import { getComponentType, getEdgeType, getGroupType, loadRegistries } from './modeling/registry.js';
import { DIAGRAM_TYPES, EA_EDGE_TYPES, EA_GROUP_TYPES, getDiagramDefinition, getDiagramTypeLabel, isKnownDiagramType } from './modeling/diagramTypes.js';
import { useStudioStore } from './store.js';

const nodeTypes = {
  component: GenericNode,
  group: GroupNode,
  templateInstance: TemplateInstanceNode
};

const LAYOUT_STYLES = [
  {
    id: 'flow-lr',
    label: 'Left → Right',
    direction: 'LR'
  },
  {
    id: 'flow-tb',
    label: 'Top → Bottom',
    direction: 'TB'
  },
  {
    id: 'groups-only',
    label: 'Groups Only',
    direction: 'LR'
  }
];

function runDagreLayout({ nodes, edges, rankdir = 'LR', padding = 24 }) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir, ranksep: 64, nodesep: 48, marginx: padding, marginy: padding });

  for (const n of nodes ?? []) {
    const width = Number(n?.width ?? n?.measured?.width ?? 180);
    const height = Number(n?.height ?? n?.measured?.height ?? 88);
    g.setNode(n.id, { width, height });
  }

  for (const e of edges ?? []) {
    if (!e?.source || !e?.target) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const positioned = (nodes ?? []).map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    const width = Number(n?.width ?? n?.measured?.width ?? p.width ?? 180);
    const height = Number(n?.height ?? n?.measured?.height ?? p.height ?? 88);
    return {
      ...n,
      position: {
        x: (p.x ?? 0) - width / 2,
        y: (p.y ?? 0) - height / 2
      }
    };
  });

  return { positioned };
}

function isTextInputTarget(target) {
  const element = target;
  if (!element) return false;
  const tag = (element.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (element.isContentEditable) return true;
  return false;
}

function buildDragImage(theme, label) {
  const node = document.createElement('div');
  node.textContent = label;
  node.style.padding = '4px 6px';
  node.style.borderRadius = '3px';
  node.style.border = `1px solid ${theme.palette.divider}`;
  node.style.background = theme.palette.background.paper;
  node.style.color = theme.palette.text.primary;
  node.style.fontFamily = 'Segoe UI, Inter, Roboto, Helvetica, Arial, sans-serif';
  node.style.fontWeight = '600';
  node.style.letterSpacing = '0.2px';
  node.style.boxShadow = 'none';
  node.style.pointerEvents = 'none';
  return node;
}

function deriveNodeVisual(registry, node) {
  if (!registry || !node || node.type === 'group' || node.data?.kind === 'group') {
    return { fill: 'paper', border: 'divider' };
  }

  const typeId = node.data?.componentTypeId;
  const ct = typeId ? registry.componentTypesById?.get(typeId) : null;
  const category = ct?.category ?? '';

  // Structural, explainable: outline encodes category (subtle, not decorative).
  if (category === 'Integration') return { fill: 'paper', border: 'primary' };
  if (category === 'Data') return { fill: 'paper', border: 'secondary' };
  return { fill: 'paper', border: 'divider' };
}

function CanvasView({
  containerRef,
  spacePressed,
  impact,
  onDrop,
  onDragOver,
  onPaneContextMenu,
  onNodeContextMenu,
  onEdgeContextMenu,
  onNodeDragStart,
  onNodeDragStop
}) {
  const theme = useTheme();
  const [canvasReady, setCanvasReady] = useState(false);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const panRef = useRef({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    originX: 0,
    originY: 0
  });
  const rafViewportRef = useRef({
    raf: 0,
    next: null
  });
  const lastCycleRef = useRef({ key: '', idx: 0, ids: [] });
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);
  const diagramViews = useStudioStore((state) => state.diagramViews);
  const registry = useStudioStore((state) => state.registry);
  const validationErrors = useStudioStore((state) => state.validationErrors);
  const diagramTypeId = useStudioStore((state) => state.metadata?.diagramTypeId ?? null);
  const connectMode = useStudioStore((state) => state.connectMode);
  const beginConnect = useStudioStore((state) => state.beginConnect);
  const endConnect = useStudioStore((state) => state.endConnect);
  const activeLayerIds = useStudioStore((state) => state.view?.activeLayerIds ?? []);
  const collapsedContainerIds = useStudioStore((state) => state.view?.collapsedContainerIds ?? []);
  const toggleCollapsedContainer = useStudioStore((state) => state.toggleCollapsedContainer);
  const onNodesChange = useStudioStore((state) => state.onNodesChange);
  const onEdgesChange = useStudioStore((state) => state.onEdgesChange);
  const onConnectStore = useStudioStore((state) => state.onConnect);
  const setSelection = useStudioStore((state) => state.setSelection);
  const snapGrid = useStudioStore((state) => state.snapGrid);
  const showGrid = useStudioStore((state) => state.showGrid);
  const setShowGrid = useStudioStore((state) => state.setShowGrid);
  const reactFlow = useReactFlow();
  const activated = isKnownDiagramType(diagramTypeId);

  const activeDiagramView = useMemo(() => {
    const id = diagramViews?.activeViewId;
    const list = diagramViews?.views ?? [];
    return list.find((v) => v.id === id) ?? list[0] ?? null;
  }, [diagramViews]);

  const activeNodeIdSet = useMemo(() => new Set((activeDiagramView?.nodeIds ?? []).filter(Boolean)), [activeDiagramView?.nodeIds]);
  const activeEdgeIdSet = useMemo(() => new Set((activeDiagramView?.edgeIds ?? []).filter(Boolean)), [activeDiagramView?.edgeIds]);

  useLayoutEffect(() => {
    if (canvasReady) return;
    const element = containerRef?.current;
    if (!element) return;

    const updateReady = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasReady(true);
      }
    };

    updateReady();
    if (canvasReady) return;

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateReady();
      });
      observer.observe(element);
      return () => observer.disconnect();
    }

    const onResize = () => updateReady();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canvasReady, containerRef]);

  const layerRules = useMemo(() => {
    const active = new Set(activeLayerIds ?? []);
    const edgeTypeFilter = new Set();
    for (const id of active) {
      if (typeof id === 'string' && id.startsWith('layer.edges.')) {
        edgeTypeFilter.add(id.slice('layer.edges.'.length));
      }
    }
    return {
      hideExternal: active.has('layer.hide.external'),
      highlightData: active.has('layer.highlight.data'),
      edgeTypeFilter
    };
  }, [activeLayerIds]);

  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set();
    if (!layerRules.hideExternal) return hidden;
    if (!registry || registry.status !== 'ready') return hidden;
    for (const node of nodes ?? []) {
      if (!node || node.type === 'group' || node.data?.kind === 'group') continue;
      if (node?.data?.metadata?.source === 'EA_CORE') continue;
      const typeId = node.data?.componentTypeId;
      const ct = typeId ? registry.componentTypesById?.get(typeId) : null;
      if (ct?.category === 'External') {
        hidden.add(node.id);
      }
    }
    return hidden;
  }, [nodes, registry, layerRules.hideExternal]);

  const collapsedGroupIds = useMemo(() => {
    const ids = (collapsedContainerIds ?? []).filter((id) => typeof id === 'string' && !id.startsWith('tpl:'));
    return new Set(ids);
  }, [collapsedContainerIds]);

  const collapsedTemplateInstanceIds = useMemo(() => {
    const ids = (collapsedContainerIds ?? [])
      .filter((id) => typeof id === 'string' && id.startsWith('tpl:'))
      .map((id) => id.slice('tpl:'.length))
      .filter(Boolean);
    return new Set(ids);
  }, [collapsedContainerIds]);

  const descendantIdsOfCollapsed = useMemo(() => {
    if (!collapsedGroupIds.size) return new Set();
    const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));

    // Build children lists for traversal.
    const childrenByParent = new Map();
    for (const n of nodes ?? []) {
      const p = n?.parentNode;
      if (!p) continue;
      const list = childrenByParent.get(p) ?? [];
      list.push(n.id);
      childrenByParent.set(p, list);
    }

    const out = new Set();
    const stack = [];
    for (const id of collapsedGroupIds) {
      if (nodeById.has(id)) stack.push(id);
    }
    while (stack.length) {
      const parent = stack.pop();
      const kids = childrenByParent.get(parent) ?? [];
      for (const kid of kids) {
        if (out.has(kid)) continue;
        out.add(kid);
        if (collapsedGroupIds.has(kid)) {
          // If nested collapsed, still treat its descendants as hidden by that container.
          stack.push(kid);
        } else {
          stack.push(kid);
        }
      }
    }
    return out;
  }, [nodes, collapsedGroupIds]);

  const nodeIdsOfCollapsedTemplates = useMemo(() => {
    if (!collapsedTemplateInstanceIds.size) return new Set();
    const out = new Set();
    for (const n of nodes ?? []) {
      const instanceId = n?.data?.metadata?.template?.instanceId;
      if (!instanceId) continue;
      if (collapsedTemplateInstanceIds.has(instanceId)) out.add(n.id);
    }
    return out;
  }, [nodes, collapsedTemplateInstanceIds]);

  const collapsedIssueSummaryByGroupId = useMemo(() => {
    if (!collapsedGroupIds.size) return new Map();
    const issues = Array.isArray(validationErrors) ? validationErrors : [];
    const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));

    const collapsedAncestorByNodeId = new Map();
    for (const n of nodes ?? []) {
      if (!n?.id) continue;
      let cur = n;
      let ancestor = null;
      while (cur?.parentNode) {
        const p = nodeById.get(cur.parentNode);
        if (!p) break;
        if (collapsedGroupIds.has(p.id)) {
          ancestor = p.id;
          break;
        }
        cur = p;
      }
      if (ancestor) collapsedAncestorByNodeId.set(n.id, ancestor);
    }

    const byGroup = new Map();
    const bump = (groupId, severity) => {
      if (!groupId) return;
      const cur = byGroup.get(groupId) ?? { ERROR: 0, WARNING: 0, INFO: 0 };
      if (severity === 'ERROR') cur.ERROR += 1;
      else if (severity === 'WARNING') cur.WARNING += 1;
      else cur.INFO += 1;
      byGroup.set(groupId, cur);
    };

    for (const issue of issues) {
      const sev = issue?.severity ?? 'INFO';
      const target = issue?.target;
      if (!target) continue;

      if (target.kind === 'node' && target.id) {
        // Direct issue on group itself.
        if (collapsedGroupIds.has(target.id)) {
          bump(target.id, sev);
          continue;
        }
        const groupId = collapsedAncestorByNodeId.get(target.id);
        if (groupId) bump(groupId, sev);
        continue;
      }

      if (target.kind === 'edge' && target.id) {
        const edge = (edges ?? []).find((e) => e?.id === target.id);
        if (!edge) continue;
        const g1 = collapsedAncestorByNodeId.get(edge.source);
        const g2 = collapsedAncestorByNodeId.get(edge.target);
        bump(g1 ?? g2, sev);
      }
    }

    return byGroup;
  }, [collapsedGroupIds, validationErrors, nodes, edges]);

  const collapsedIssueSummaryByTemplateInstanceId = useMemo(() => {
    if (!collapsedTemplateInstanceIds.size) return new Map();
    const issues = Array.isArray(validationErrors) ? validationErrors : [];
    const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));
    const edgeById = new Map((edges ?? []).map((e) => [e.id, e]));

    const byTpl = new Map();
    const bump = (instanceId, severity) => {
      if (!instanceId) return;
      const cur = byTpl.get(instanceId) ?? { ERROR: 0, WARNING: 0, INFO: 0 };
      if (severity === 'ERROR') cur.ERROR += 1;
      else if (severity === 'WARNING') cur.WARNING += 1;
      else cur.INFO += 1;
      byTpl.set(instanceId, cur);
    };

    for (const issue of issues) {
      const sev = issue?.severity ?? 'INFO';
      const target = issue?.target;
      if (!target) continue;

      if (target.kind === 'node' && target.id) {
        const n = nodeById.get(target.id);
        const instanceId = n?.data?.metadata?.template?.instanceId;
        if (instanceId && collapsedTemplateInstanceIds.has(instanceId)) bump(instanceId, sev);
        continue;
      }

      if (target.kind === 'edge' && target.id) {
        const e = edgeById.get(target.id);
        if (!e) continue;
        const s = nodeById.get(e.source);
        const instanceId = s?.data?.metadata?.template?.instanceId;
        if (instanceId && collapsedTemplateInstanceIds.has(instanceId)) bump(instanceId, sev);
      }
    }

    return byTpl;
  }, [collapsedTemplateInstanceIds, validationErrors, nodes, edges]);

  const renderedNodes = useMemo(() => {
    const list = (nodes ?? []).filter(
      (n) =>
        n &&
        (activeNodeIdSet.size === 0 || activeNodeIdSet.has(n.id)) &&
        !hiddenNodeIds.has(n.id) &&
        !descendantIdsOfCollapsed.has(n.id) &&
        !nodeIdsOfCollapsedTemplates.has(n.id)
    );
    const impactActive = Boolean(impact?.enabled);
    const impactedNodeIds = impactActive ? impact?.analysis?.impactedNodeIds : null;
    const startIds = impactActive ? impact?.analysis?.startNodeIds ?? [] : [];
    const startSet = impactActive ? new Set(startIds) : null;
    const indicators = impactActive ? impact?.analysis?.indicators : null;
    const hasStart = impactActive ? startIds.length > 0 : false;

    const connectActive = Boolean(connectMode?.active);
    const connectSourceId = connectMode?.sourceNodeId ?? null;
    const connectAllowedSet = connectActive ? new Set(connectMode?.allowedTargetIds ?? []) : null;

    const base = list.map((n) => {
      if (!registry || registry.status !== 'ready') return n;

      const derived = deriveNodeVisual(registry, n);

      // Layer-driven emphasis (visual only).
      let opacity = n.style?.opacity;
      if (layerRules.highlightData && n.type !== 'group' && n.data?.kind !== 'group') {
        const typeId = n.data?.componentTypeId;
        const ct = typeId ? registry.componentTypesById?.get(typeId) : null;
        const isData = ct?.category === 'Data';
        opacity = isData ? 1 : 0.45;
      }

      const isImpacted = Boolean(hasStart && impactedNodeIds?.has(n.id));
      const isStart = Boolean(hasStart && startSet?.has(n.id));
      const impactNodeIndicators =
        hasStart && indicators
          ? {
              highFanIn: indicators.highFanInNodeIds?.has(n.id) ?? false,
              highFanOut: indicators.highFanOutNodeIds?.has(n.id) ?? false,
              chain: indicators.chainNodeIds?.has(n.id) ?? false
            }
          : null;

      let nextOpacity = opacity;
      if (impactActive && hasStart) {
        if (isImpacted) nextOpacity = 1;
        else if (typeof nextOpacity === 'number') nextOpacity = Math.min(nextOpacity, 0.18);
        else nextOpacity = 0.18;
      }

      const isConnectSource = connectActive && connectSourceId === n.id;
      const isConnectAllowed = connectActive && connectAllowedSet?.has(n.id);
      if (connectActive && !isConnectSource && !isConnectAllowed) {
        if (typeof nextOpacity === 'number') nextOpacity = Math.min(nextOpacity, 0.12);
        else nextOpacity = 0.12;
      }

      return {
        ...n,
        data: {
          ...(n.data ?? {}),
          // Render-time derived styling only (no manual overrides in Phase D).
          __derivedVisual: derived,
          __impact:
            impactActive && hasStart
              ? {
                  active: true,
                  impacted: isImpacted,
                  start: isStart,
                  indicators: impactNodeIndicators
                }
              : undefined,
          __collapsed: collapsedGroupIds.has(n.id),
          __collapsedIssueSummary: collapsedGroupIds.has(n.id) ? collapsedIssueSummaryByGroupId.get(n.id) ?? { ERROR: 0, WARNING: 0, INFO: 0 } : undefined,
          __connectMode:
            connectActive
              ? {
                  active: true,
                  isSource: Boolean(isConnectSource),
                  allowedTarget: Boolean(isConnectAllowed)
                }
              : undefined
        },
        style: {
          ...(n.style ?? {}),
          ...(typeof nextOpacity === 'number' ? { opacity: nextOpacity } : null)
        }
      };
    });

    // Add render-only placeholder nodes for collapsed template instances.
    if (collapsedTemplateInstanceIds.size) {
      for (const instanceId of Array.from(collapsedTemplateInstanceIds).sort()) {
        const members = (nodes ?? []).filter((n) => n?.data?.metadata?.template?.instanceId === instanceId);
        if (!members.length) continue;

        let minX = Infinity;
        let minY = Infinity;
        for (const m of members) {
          minX = Math.min(minX, m.position?.x ?? 0);
          minY = Math.min(minY, m.position?.y ?? 0);
        }

        const templateId = members[0]?.data?.metadata?.template?.templateId;
        const templateName = templateId ? registry?.templatesById?.get(templateId)?.displayName ?? templateId : 'Template';
        const summary = collapsedIssueSummaryByTemplateInstanceId.get(instanceId) ?? { ERROR: 0, WARNING: 0, INFO: 0 };

        base.push({
          id: `tpl-container:${instanceId}`,
          type: 'templateInstance',
          position: { x: Math.round(minX), y: Math.round(minY) },
          draggable: false,
          connectable: false,
          data: {
            kind: 'templateInstance',
            title: `Template: ${templateName}`,
            __collapsedIssueSummary: summary,
            __templateInstanceId: instanceId
          },
          width: 240,
          height: 120
        });
      }
    }

    return base;
  }, [
    nodes,
    hiddenNodeIds,
    descendantIdsOfCollapsed,
    nodeIdsOfCollapsedTemplates,
    activeNodeIdSet,
    registry,
    layerRules.highlightData,
    impact,
    collapsedGroupIds,
    collapsedIssueSummaryByGroupId,
    collapsedTemplateInstanceIds,
    collapsedIssueSummaryByTemplateInstanceId,
    connectMode
  ]);

  const renderedEdges = useMemo(() => {
    const filterActive = (layerRules.edgeTypeFilter?.size ?? 0) > 0;
    const impactActive = Boolean(impact?.enabled);
    const impactedEdgeIds = impactActive ? impact?.analysis?.impactedEdgeIds : null;
    const hasStart = impactActive ? (impact?.analysis?.startNodeIds?.length ?? 0) > 0 : false;

    return (edges ?? [])
      .filter((edge) => activeEdgeIdSet.size === 0 || activeEdgeIdSet.has(edge?.id))
      .filter((edge) => {
        if (!edge) return false;
        if (hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target)) return false;
        if (descendantIdsOfCollapsed.has(edge.source) || descendantIdsOfCollapsed.has(edge.target)) return false;
        if (nodeIdsOfCollapsedTemplates.has(edge.source) || nodeIdsOfCollapsedTemplates.has(edge.target)) return false;
        if (edge?.data?.metadata?.source === 'EA_CORE') return true;
        if (!filterActive) return true;
        const edgeTypeId = edge?.data?.edgeTypeId;
        return layerRules.edgeTypeFilter.has(edgeTypeId);
      })
      .map((edge) => {
        const isSelected = Boolean(edge?.selected);
        const edgeTypeId = edge?.data?.edgeTypeId ?? 'rel.dependsOn';
        const isEaCore = edge?.data?.metadata?.source === 'EA_CORE';
        const isImpactPath = Boolean(impactActive && hasStart && impactedEdgeIds?.has(edge.id));

        const baseStroke =
          edgeTypeId === 'rel.dataFlow'
            ? alpha(theme.palette.secondary.main, 0.55)
            : alpha(theme.palette.text.primary, 0.28);

        const stroke =
          isSelected
            ? theme.palette.primary.main
            : impactActive && hasStart
              ? isImpactPath
                ? theme.palette.primary.main
                : alpha(theme.palette.text.primary, 0.10)
              : baseStroke;

        const strokeWidth =
          isSelected
            ? 3
            : impactActive && hasStart
              ? isImpactPath
                ? 3
                : 1
              : edgeTypeId === 'rel.dataFlow'
                ? 2
                : 1.5;

        return {
          ...edge,
          style: {
            ...(edge.style ?? {}),
            stroke,
            strokeWidth,
            opacity: impactActive && hasStart ? (isImpactPath ? 1 : 0.18) : 1,
            ...(isEaCore ? { strokeDasharray: '4 3' } : null)
          }
        };
      });
  }, [edges, theme, hiddenNodeIds, descendantIdsOfCollapsed, nodeIdsOfCollapsedTemplates, layerRules.edgeTypeFilter, impact, activeEdgeIdSet]);

  useEffect(() => {
    if (nodes.length === 0 && typeof reactFlow.fitView === 'function') {
      reactFlow.fitView({ duration: 0, padding: 0.9 });
    }
  }, [nodes.length, reactFlow]);

  const handleSelectionChange = useCallback(
    (params) => {
      setSelection({
        nodes: (params?.nodes ?? []).map((node) => node.id),
        edges: (params?.edges ?? []).map((edge) => edge.id)
      });
    },
    [setSelection]
  );

  const updateZoomLevelClass = useCallback(
    (zoom) => {
      const el = containerRef?.current;
      if (!el) return;
      const z = Number(zoom);
      const level = z < 0.4 ? 'low' : z < 1 ? 'medium' : 'high';
      if (el.dataset.zoomLevel !== level) el.dataset.zoomLevel = level;
      el.style.setProperty('--ea-zoom', String(z));
    },
    [containerRef]
  );

  const syncViewportFromReactFlow = useCallback(() => {
    const v = reactFlow.getViewport?.();
    if (!v) return;
    viewportRef.current = { x: v.x ?? 0, y: v.y ?? 0, zoom: v.zoom ?? 1 };
    updateZoomLevelClass(v.zoom ?? 1);
  }, [reactFlow, updateZoomLevelClass]);

  const scheduleViewport = useCallback(
    (nextViewport) => {
      rafViewportRef.current.next = nextViewport;
      if (rafViewportRef.current.raf) return;
      rafViewportRef.current.raf = window.requestAnimationFrame(() => {
        rafViewportRef.current.raf = 0;
        const v = rafViewportRef.current.next;
        rafViewportRef.current.next = null;
        if (!v) return;
        reactFlow.setViewport?.({ x: v.x, y: v.y, zoom: v.zoom }, { duration: 0 });
        viewportRef.current = { x: v.x, y: v.y, zoom: v.zoom };
        updateZoomLevelClass(v.zoom);
      });
    },
    [reactFlow, updateZoomLevelClass]
  );

  const handlePaneDoubleClick = useCallback(
    (event) => {
      if (event?.defaultPrevented) return;
      // Double-click background = reset view.
      scheduleViewport({ x: 0, y: 0, zoom: 1 });
    },
    [scheduleViewport]
  );

  const handleWheelCapture = useCallback(
    (event) => {
      if (!containerRef?.current) return;

      // Camera is authoritative: we always prevent default scrolling.
      event.preventDefault();
      event.stopPropagation();

      const current = viewportRef.current;
      const curZoom = Number(current.zoom ?? 1);

      // Plain wheel = pan. Ctrl/Meta + wheel = zoom.
      if (!event.ctrlKey && !event.metaKey) {
        const nextX = Number(current.x ?? 0) - Number(event.deltaX ?? 0);
        const nextY = Number(current.y ?? 0) - Number(event.deltaY ?? 0);
        scheduleViewport({ x: nextX, y: nextY, zoom: curZoom });
        return;
      }

      const bounds = containerRef.current.getBoundingClientRect();
      const mx = event.clientX - bounds.left;
      const my = event.clientY - bounds.top;
      const minZoom = 0.05;
      const maxZoom = 4;
      const factor = Math.pow(1.0015, -event.deltaY);
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, curZoom * factor));

      const px = (mx - (current.x ?? 0)) / curZoom;
      const py = (my - (current.y ?? 0)) / curZoom;

      const nextX = mx - px * nextZoom;
      const nextY = my - py * nextZoom;

      scheduleViewport({ x: nextX, y: nextY, zoom: nextZoom });
    },
    [containerRef, scheduleViewport]
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (!spacePressed) return;
      if (event.button !== 0) return;
      if (isTextInputTarget(event.target)) return;
      const el = containerRef?.current;
      if (!el) return;
      event.preventDefault();
      event.stopPropagation();
      panRef.current = {
        active: true,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX: viewportRef.current.x ?? 0,
        originY: viewportRef.current.y ?? 0
      };
      el.setPointerCapture?.(event.pointerId);
    },
    [spacePressed, containerRef]
  );

  const handlePointerMove = useCallback(
    (event) => {
      const pan = panRef.current;
      if (!pan.active) return;
      if (pan.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - pan.startClientX;
      const dy = event.clientY - pan.startClientY;
      scheduleViewport({ x: pan.originX + dx, y: pan.originY + dy, zoom: viewportRef.current.zoom ?? 1 });
    },
    [scheduleViewport]
  );

  const handlePointerUp = useCallback(
    (event) => {
      const el = containerRef?.current;
      const pan = panRef.current;
      if (pan.active && pan.pointerId === event.pointerId) {
        panRef.current = { active: false, pointerId: null, startClientX: 0, startClientY: 0, originX: 0, originY: 0 };
        el?.releasePointerCapture?.(event.pointerId);
      }
    },
    [containerRef]
  );

  const handlePaneClick = useCallback(
    (event) => {
      if (isTextInputTarget(event.target)) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      setSelection({ nodes: [], edges: [] });
    },
    [setSelection]
  );

  const handleNodeClick = useCallback(
    (event, node) => {
      if (!node?.id) return;
      if (isTextInputTarget(event.target)) return;

      const meta = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;

      let targetId = node.id;

      // Click-through cycling for overlaps (repeat-click cycles IDs under cursor).
      if (typeof reactFlow.screenToFlowPosition === 'function') {
        const p = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const under = [];
        for (const n of renderedNodes) {
          const w = Number(n.width ?? n.measured?.width ?? 160);
          const h = Number(n.height ?? n.measured?.height ?? 92);
          const x = Number(n.position?.x ?? 0);
          const y = Number(n.position?.y ?? 0);
          if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) under.push(n.id);
        }
        under.sort();
        if (under.length > 1) {
          const key = `${Math.round(event.clientX)}:${Math.round(event.clientY)}:${under.join('|')}`;
          if (lastCycleRef.current.key === key) {
            lastCycleRef.current.idx = (lastCycleRef.current.idx + 1) % under.length;
          } else {
            lastCycleRef.current = { key, idx: 0, ids: under };
          }
          targetId = under[lastCycleRef.current.idx] ?? targetId;
        }
      }

      const current = useStudioStore.getState().selection;
      const nodesSel = new Set(current?.nodes ?? []);
      const edgesSel = new Set(current?.edges ?? []);
      edgesSel.clear();

      if (shift) {
        nodesSel.add(targetId);
      } else if (meta) {
        if (nodesSel.has(targetId)) nodesSel.delete(targetId);
        else nodesSel.add(targetId);
      } else {
        nodesSel.clear();
        nodesSel.add(targetId);
      }

      setSelection({ nodes: Array.from(nodesSel), edges: Array.from(edgesSel) });
    },
    [reactFlow, renderedNodes, setSelection]
  );

  const handleEdgeClick = useCallback(
    (event, edge) => {
      if (!edge?.id) return;
      if (isTextInputTarget(event.target)) return;

      const meta = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;

      const current = useStudioStore.getState().selection;
      const nodesSel = new Set(current?.nodes ?? []);
      const edgesSel = new Set(current?.edges ?? []);
      nodesSel.clear();

      if (shift) {
        edgesSel.add(edge.id);
      } else if (meta) {
        if (edgesSel.has(edge.id)) edgesSel.delete(edge.id);
        else edgesSel.add(edge.id);
      } else {
        edgesSel.clear();
        edgesSel.add(edge.id);
      }

      setSelection({ nodes: Array.from(nodesSel), edges: Array.from(edgesSel) });
    },
    [setSelection]
  );

  const isValidConnection = useCallback(
    (connection) => {
      if (!registry || registry.status !== 'ready') return false;
      if (!diagramTypeId || !isKnownDiagramType(diagramTypeId)) return false;
      if (!connection?.source || !connection?.target) return false;

      // Phase H: guided connectivity only.
      if (connectMode?.active && connectMode?.sourceNodeId === connection.source) {
        return (connectMode?.allowedTargetIds ?? []).includes(connection.target);
      }

      return false;
    },
    [registry, diagramTypeId, connectMode]
  );

  const handleConnect = useCallback(
    (connection) => {
      onConnectStore(connection);
      endConnect();
    },
    [onConnectStore, endConnect]
  );

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        cursor: spacePressed ? 'grab' : 'default'
      }}
      onWheelCapture={handleWheelCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {!activated ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            zIndex: 1
          }}
        >
          <Typography variant="h5" sx={{ color: 'text.secondary', opacity: 0.12, fontWeight: 800, letterSpacing: 0.6 }}>
            No diagram type selected
          </Typography>
        </Box>
      ) : null}

      {canvasReady ? (
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onConnectStart={(_, params) => {
            const nodeId = params?.nodeId;
            if (nodeId) beginConnect({ sourceNodeId: nodeId });
          }}
          onConnectEnd={() => endConnect()}
          onSelectionChange={handleSelectionChange}
          onDrop={activated ? onDrop : undefined}
          onDragOver={activated ? onDragOver : undefined}
          onPaneDoubleClick={handlePaneDoubleClick}
          onPaneClick={handlePaneClick}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.8, duration: 0 }}
          minZoom={0.05}
          maxZoom={4}
          snapToGrid={showGrid}
          snapGrid={snapGrid}
          panOnScroll={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesDraggable={activated && !spacePressed}
          nodesConnectable={activated}
          nodesFocusable={activated}
          elementsSelectable={activated}
          selectionOnDrag={activated && !spacePressed}
          selectionMode="partial"
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          onlyRenderVisibleElements
          isValidConnection={isValidConnection}
          attributionPosition="bottom-right"
          style={{ background: theme.palette.background.default }}
          onNodeDoubleClick={(event, node) => {
            if (!node?.id) return;
            if (node.type === 'group' || node.data?.kind === 'group') {
              toggleCollapsedContainer(node.id);
              return;
            }
            const instanceId = node.data?.metadata?.template?.instanceId ?? node.data?.__templateInstanceId;
            if (instanceId) {
              toggleCollapsedContainer(`tpl:${instanceId}`);
            }
          }}
        >
          {showGrid ? <Background color={theme.palette.divider} gap={16} size={1} /> : null}

          <MiniMap
            nodeStrokeColor={() => theme.palette.divider}
            nodeColor={(n) => (n.type === 'group' ? alpha(theme.palette.primary.main, 0.20) : alpha(theme.palette.text.primary, 0.12))}
            nodeBorderRadius={2}
            maskColor={alpha(theme.palette.background.default, 0.65)}
            style={{ border: `1px solid ${theme.palette.divider}`, background: theme.palette.background.paper }}
          />
        </ReactFlow>
      ) : null}

      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
          zIndex: 5,
          backgroundColor: 'background.paper',
          border: (t) => `1px solid ${t.palette.divider}`,
          borderRadius: 1,
          p: 0.5
        }}
      >
        <Tooltip title="Zoom in">
          <IconButton
            size="small"
            onClick={() => {
              const el = containerRef?.current;
              const bounds = el?.getBoundingClientRect?.();
              const mx = bounds ? bounds.width / 2 : 0;
              const my = bounds ? bounds.height / 2 : 0;
              const current = viewportRef.current;
              const curZoom = Number(current.zoom ?? 1);
              const nextZoom = Math.min(4, Math.max(0.05, curZoom * 1.2));
              const px = (mx - (current.x ?? 0)) / curZoom;
              const py = (my - (current.y ?? 0)) / curZoom;
              scheduleViewport({ x: mx - px * nextZoom, y: my - py * nextZoom, zoom: nextZoom });
            }}
          >
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out">
          <IconButton
            size="small"
            onClick={() => {
              const el = containerRef?.current;
              const bounds = el?.getBoundingClientRect?.();
              const mx = bounds ? bounds.width / 2 : 0;
              const my = bounds ? bounds.height / 2 : 0;
              const current = viewportRef.current;
              const curZoom = Number(current.zoom ?? 1);
              const nextZoom = Math.min(4, Math.max(0.05, curZoom / 1.2));
              const px = (mx - (current.x ?? 0)) / curZoom;
              const py = (my - (current.y ?? 0)) / curZoom;
              scheduleViewport({ x: mx - px * nextZoom, y: my - py * nextZoom, zoom: nextZoom });
            }}
          >
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit to view">
          <IconButton
            size="small"
            onClick={() => {
              reactFlow.fitView?.({ duration: 0, padding: 0.85 });
              window.requestAnimationFrame(() => syncViewportFromReactFlow());
            }}
          >
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={showGrid ? 'Hide grid' : 'Show grid'}>
          <IconButton size="small" onClick={() => setShowGrid(!showGrid)}>
            {showGrid ? <GridOffIcon fontSize="small" /> : <GridOnIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function StudioContent() {
  const canvasRef = useRef(null);
  const theme = useTheme();
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [diagrams, setDiagrams] = useState([]);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteExpanded, setPaletteExpanded] = useState(() => new Set());
  const [layoutStyle, setLayoutStyle] = useState('flow-lr');
  const [impactModeEnabled, setImpactModeEnabled] = useState(false);
  const [impactDirection, setImpactDirection] = useState('downstream');
  const [impactDepth, setImpactDepth] = useState(2);
  const [spacePressed, setSpacePressed] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [lastMousePos, setLastMousePos] = useState(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [renamingViewId, setRenamingViewId] = useState(null);
  const [renamingViewName, setRenamingViewName] = useState('');

  const metadata = useStudioStore((state) => state.metadata);
  const diagramId = useStudioStore((state) => state.diagramId);
  const dirty = useStudioStore((state) => state.dirty);
  const serialize = useStudioStore((state) => state.serialize);
  const markClean = useStudioStore((state) => state.markClean);
  const loadDiagram = useStudioStore((state) => state.loadDiagram);
  const reset = useStudioStore((state) => state.reset);
  const setMetadata = useStudioStore((state) => state.setMetadata);
  const updateNodes = useStudioStore((state) => state.updateNodes);
  const updateEdges = useStudioStore((state) => state.updateEdges);
  const selection = useStudioStore((state) => state.selection);
  const setSelectionEphemeral = useStudioStore((state) => state.setSelectionEphemeral);
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);
  const registry = useStudioStore((state) => state.registry);
  const registryReady = registry?.status === 'ready';
  const activeLayerIds = useStudioStore((state) => state.view?.activeLayerIds ?? []);
  const toggleViewLayer = useStudioStore((state) => state.toggleViewLayer);
  const setShowGrid = useStudioStore((state) => state.setShowGrid);

  const diagramViews = useStudioStore((state) => state.diagramViews);
  const setActiveDiagramView = useStudioStore((state) => state.setActiveDiagramView);
  const createDiagramView = useStudioStore((state) => state.createDiagramView);
  const renameDiagramView = useStudioStore((state) => state.renameDiagramView);
  const deleteDiagramView = useStudioStore((state) => state.deleteDiagramView);

  const removeSelectionFromActiveView = useStudioStore((state) => state.removeSelectionFromActiveView);
  const deleteSelectionFromModel = useStudioStore((state) => state.deleteSelectionFromModel);
  const nudgeSelection = useStudioStore((state) => state.nudgeSelection);
  const alignSelection = useStudioStore((state) => state.alignSelection);
  const distributeSelection = useStudioStore((state) => state.distributeSelection);

  const availableLayers = useMemo(() => {
    const list = [
      { id: 'layer.hide.external', label: 'Hide External Systems' },
      { id: 'layer.highlight.data', label: 'Highlight Data Stores' }
    ];
    for (const edgeType of registry?.edgeTypes ?? []) {
      if (!edgeType?.edgeTypeId) continue;
      list.push({
        id: `layer.edges.${edgeType.edgeTypeId}`,
        label: `Edges: ${edgeType.displayName ?? edgeType.edgeTypeId}`
      });
    }
    return list;
  }, [registry]);
  const registryError = useStudioStore((state) => state.registryError);
  const setRegistry = useStudioStore((state) => state.setRegistry);
  const validationErrors = useStudioStore((state) => state.validationErrors);
  const lastModelingError = useStudioStore((state) => state.lastModelingError);
  const clearLastModelingError = useStudioStore((state) => state.clearLastModelingError);
  const addComponentNode = useStudioStore((state) => state.addComponentNode);
  const addGroupNode = useStudioStore((state) => state.addGroupNode);
  const instantiateTemplate = useStudioStore((state) => state.instantiateTemplate);
  const setNodeAttribute = useStudioStore((state) => state.setNodeAttribute);
  const enableTemplateOverridesForSelection = useStudioStore((state) => state.enableTemplateOverridesForSelection);
  const setParentGroup = useStudioStore((state) => state.setParentGroup);
  const setEdgeType = useStudioStore((state) => state.setEdgeType);
  const setEdgeDescription = useStudioStore((state) => state.setEdgeDescription);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const deleteSelection = useStudioStore((state) => state.deleteSelection);
  const copySelection = useStudioStore((state) => state.copySelection);
  const pasteClipboard = useStudioStore((state) => state.pasteClipboard);
  const selectAll = useStudioStore((state) => state.selectAll);
  const armHistory = useStudioStore((state) => state.armHistory);
  const clearArmedHistory = useStudioStore((state) => state.clearArmedHistory);
  const importEaSnapshot = useStudioStore((state) => state.importEaSnapshot);
  const loadStressGraph = useStudioStore((state) => state.loadStressGraph);
  const reactFlow = useReactFlow();

  const activated = isKnownDiagramType(metadata?.diagramTypeId);
  const hasModeled = Boolean((nodes ?? []).length > 0);
  const diagramTypeLocked = Boolean(activated && hasModeled);

  const activateDiagramType = useCallback(
    (nextDiagramTypeId) => {
      if (!isKnownDiagramType(nextDiagramTypeId)) return;
      if (!registryReady) {
        setSnackbar({ open: true, message: 'Loading registries…', severity: 'info' });
        return;
      }

      // Migration-safe: if nodes already exist, only set diagramTypeId + defaults.
      if (hasModeled) {
        setMetadata({ diagramTypeId: nextDiagramTypeId });
        setShowGrid(true);
        setLayoutStyle(getDiagramDefinition(nextDiagramTypeId)?.defaultLayoutStyle ?? 'flow-lr');
        return;
      }

      const def = getDiagramDefinition(nextDiagramTypeId);
      setMetadata({ diagramTypeId: nextDiagramTypeId });
      setShowGrid(true);
      setLayoutStyle(def?.defaultLayoutStyle ?? 'flow-lr');

      const createGroup = ({ groupTypeId, position, width, height, name }) => {
        addGroupNode({ groupTypeId, position });
        const id = useStudioStore.getState().selection?.nodes?.[0];
        if (!id) return null;
        if (name) setNodeAttribute({ nodeId: id, key: 'name', value: name });
        if (typeof width === 'number' || typeof height === 'number') {
          updateNodes((prev) =>
            (prev ?? []).map((n) =>
              n.id !== id
                ? n
                : {
                    ...n,
                    ...(typeof width === 'number' ? { width } : null),
                    ...(typeof height === 'number' ? { height } : null)
                  }
            )
          );
        }
        return id;
      };

      // Required roots: ensure diagram is not empty after activation.
      if (nextDiagramTypeId === 'capability-map') {
        createGroup({ groupTypeId: EA_GROUP_TYPES.CAP_CATEGORY, position: { x: 80, y: 80 }, width: 520, height: 320, name: 'Category / Department' });
      } else if (nextDiagramTypeId === 'application-landscape') {
        createGroup({ groupTypeId: EA_GROUP_TYPES.APP_CATEGORY, position: { x: 80, y: 80 }, width: 520, height: 320, name: 'Category / Department' });
      } else if (nextDiagramTypeId === 'programme-portfolio') {
        createGroup({ groupTypeId: EA_GROUP_TYPES.PROG_CATEGORY, position: { x: 80, y: 80 }, width: 520, height: 320, name: 'Category / Department' });
      } else if (nextDiagramTypeId === 'technology-architecture') {
        createGroup({ groupTypeId: EA_GROUP_TYPES.TECH_LAYER_INFRA, position: { x: 60, y: 60 }, width: 720, height: 170, name: 'Infrastructure Layer' });
        createGroup({ groupTypeId: EA_GROUP_TYPES.TECH_LAYER_HOSTING, position: { x: 60, y: 260 }, width: 720, height: 170, name: 'Application Hosting & Ops' });
        createGroup({ groupTypeId: EA_GROUP_TYPES.TECH_LAYER_PLATFORM, position: { x: 60, y: 460 }, width: 720, height: 170, name: 'Platform Services' });
      } else if (nextDiagramTypeId === 'cross-domain-traceability') {
        createGroup({ groupTypeId: EA_GROUP_TYPES.CAP_CATEGORY, position: { x: 80, y: 80 }, width: 420, height: 280, name: 'Capabilities' });
        createGroup({ groupTypeId: EA_GROUP_TYPES.APP_CATEGORY, position: { x: 560, y: 80 }, width: 420, height: 280, name: 'Applications' });
      }

      window.requestAnimationFrame(() => {
        reactFlow.setViewport?.({ x: 0, y: 0, zoom: nextDiagramTypeId === 'technology-architecture' ? 0.8 : 1 }, { duration: 0 });
        window.requestAnimationFrame(() => reactFlow.fitView?.({ duration: 0, padding: 0.85 }));
      });
    },
    [registryReady, hasModeled, setMetadata, setShowGrid, setLayoutStyle, addGroupNode, setNodeAttribute, updateNodes, reactFlow]
  );

  const [pendingEaImport, setPendingEaImport] = useState(null);

  const createNodeFromRegistryType = useCallback(
    (typeId, position) => {
      if (!registryReady) {
        setSnackbar({ open: true, message: 'Registry not loaded. Cannot create components.', severity: 'error' });
        return;
      }

      if (!isKnownDiagramType(metadata?.diagramTypeId)) {
        setSnackbar({ open: true, message: 'Diagram type not set. Select a diagram type to enable modeling.', severity: 'error' });
        return;
      }

      if (import.meta.env.DEV) {
        console.info('[palette] creating node', typeId);
      }

      try {
        addComponentNode({ componentTypeId: typeId, position });
      } catch (error) {
        setSnackbar({ open: true, message: String(error?.message ?? error), severity: 'error' });
      }
    },
    [registryReady, addComponentNode, metadata?.diagramTypeId]
  );

  const computeEaDiffSummary = useCallback(
    (payload) => {
      const currentNodes = nodes ?? [];
      const currentEdges = edges ?? [];

      const currentApps = new Map(
        currentNodes
          .filter((n) => n?.data?.metadata?.source === 'EA_CORE' && n?.data?.metadata?.eaSourceType === 'Application')
          .map((n) => [n?.data?.metadata?.eaSourceId, n])
          .filter(([id]) => typeof id === 'string' && id)
      );

      const nextApps = new Map(
        (payload?.applications ?? [])
          .filter((a) => typeof a?.id === 'string' && a.id)
          .map((a) => [a.id, a])
      );

      const currentDeps = new Map(
        currentEdges
          .filter((e) => e?.data?.metadata?.source === 'EA_CORE' && e?.data?.metadata?.eaSourceType === 'Dependency')
          .map((e) => [e?.data?.metadata?.eaSourceId, e])
          .filter(([id]) => typeof id === 'string' && id)
      );

      const nextDeps = new Map(
        (payload?.dependencies ?? [])
          .map((d) => {
            const sig = typeof d?.signature === 'string' && d.signature
              ? d.signature
              : `${d?.sourceId ?? ''}|${d?.targetId ?? ''}|${d?.dependency_type ?? ''}|${d?.dependency_strength ?? ''}|${d?.dependency_mode ?? ''}`;
            return [sig, { ...d, signature: sig }];
          })
          .filter(([sig, d]) => typeof sig === 'string' && sig && typeof d?.sourceId === 'string' && typeof d?.targetId === 'string')
      );

      let appsAdded = 0;
      let appsRemoved = 0;
      let appsChanged = 0;

      for (const id of nextApps.keys()) {
        if (!currentApps.has(id)) appsAdded += 1;
      }
      for (const id of currentApps.keys()) {
        if (!nextApps.has(id)) appsRemoved += 1;
      }
      for (const [id, app] of nextApps.entries()) {
        const node = currentApps.get(id);
        if (!node) continue;
        const attrs = node?.data?.attributes ?? {};
        const currentSig = JSON.stringify({ name: attrs.name ?? '', owner: attrs.owner ?? '', criticality: attrs.criticality ?? '', status: attrs.status ?? '' });
        const nextSig = JSON.stringify({ name: app?.name ?? app?.id ?? '', owner: app?.owner ?? '', criticality: app?.criticality ?? '', status: app?.status ?? '' });
        if (currentSig !== nextSig) appsChanged += 1;
      }

      let depsAdded = 0;
      let depsRemoved = 0;
      let depsChanged = 0;

      for (const sig of nextDeps.keys()) {
        if (!currentDeps.has(sig)) depsAdded += 1;
      }
      for (const sig of currentDeps.keys()) {
        if (!nextDeps.has(sig)) depsRemoved += 1;
      }
      for (const [sig, dep] of nextDeps.entries()) {
        const edge = currentDeps.get(sig);
        if (!edge) continue;
        const cur = edge?.data ?? {};
        const currentSig = JSON.stringify({
          signature: cur.signature ?? null,
          dependency_type: cur.dependency_type ?? null,
          dependency_strength: cur.dependency_strength ?? null,
          dependency_mode: cur.dependency_mode ?? null
        });
        const nextSig = JSON.stringify({
          signature: dep?.signature ?? null,
          dependency_type: dep?.dependency_type ?? null,
          dependency_strength: dep?.dependency_strength ?? null,
          dependency_mode: dep?.dependency_mode ?? null
        });
        if (currentSig !== nextSig) depsChanged += 1;
      }

      return {
        applications: { added: appsAdded, removed: appsRemoved, changed: appsChanged },
        dependencies: { added: depsAdded, removed: depsRemoved, changed: depsChanged }
      };
    },
    [nodes, edges]
  );

  const handleImportEaSnapshot = useCallback(async () => {
    if (!window?.electronAPI?.getEaSnapshot) {
      setSnackbar({ open: true, message: 'EA snapshot import is not available.', severity: 'error' });
      return;
    }

    try {
      const payload = await window.electronAPI.getEaSnapshot();
      const hasExisting = Boolean(metadata?.eaSnapshot?.snapshotId);

      if (!hasExisting) {
        const ok = importEaSnapshot({ ...payload, mode: 'replace' });
        if (ok) {
          setSnackbar({ open: true, message: 'EA snapshot imported (read-only).', severity: 'success' });
        }
        return;
      }

      const diff = computeEaDiffSummary(payload);
      setPendingEaImport({ payload, diff });
    } catch (error) {
      setSnackbar({ open: true, message: `EA snapshot import failed: ${error?.message ?? error}`, severity: 'error' });
    }
  }, [metadata?.eaSnapshot?.snapshotId, importEaSnapshot, computeEaDiffSummary]);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail;
      if (!detail?.command) return;
      if (detail.command === 'studio:import-ea-snapshot') {
        handleImportEaSnapshot();
      }
    };
    window.addEventListener('studio:command', handler);
    return () => window.removeEventListener('studio:command', handler);
  }, [handleImportEaSnapshot]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__eaStudioStress = {
      load: (nodeCount = 1000, edgesPerNode = 2) => loadStressGraph({ nodeCount, edgesPerNode })
    };
    return () => {
      try {
        delete window.__eaStudioStress;
      } catch {
        window.__eaStudioStress = undefined;
      }
    };
  }, [loadStressGraph]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let raf = 0;
    let last = performance.now();
    let spikeCount = 0;
    let lastReportAt = 0;

    const tick = (t) => {
      const dt = t - last;
      last = t;

      // Basic frame-time guard. If we see repeated >34ms frames, log once per second.
      if (dt > 34) {
        spikeCount += 1;
        if (t - lastReportAt > 1000 && spikeCount >= 3) {
          lastReportAt = t;
          // eslint-disable-next-line no-console
          console.warn(`[perf] frame spikes detected: ${spikeCount} spikes (>34ms) in last interval`);
          spikeCount = 0;
        }
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const handleApplyAutoLayout = useCallback(() => {
    const allNodes = nodes ?? [];
    const allEdges = edges ?? [];

    if (allNodes.length === 0) return;

    const rankdir = layoutStyle === 'flow-tb' ? 'TB' : 'LR';
    const groupOnly = layoutStyle === 'groups-only';

    const nodesById = new Map(allNodes.map((n) => [n.id, n]));
    const groups = allNodes.filter((n) => (n.type === 'group' || n.data?.kind === 'group') && n.id);
    const parentKeys = new Set();
    if (!groupOnly) parentKeys.add(null);
    for (const g of groups) {
      parentKeys.add(g.id);
    }

    const nodeIdsByParent = new Map();
    for (const n of allNodes) {
      const parent = computeParentKey(n);
      if (!parentKeys.has(parent)) continue;
      // Only layout nodes within their current parent partition.
      const list = nodeIdsByParent.get(parent) ?? [];
      list.push(n.id);
      nodeIdsByParent.set(parent, list);
    }

    // Compute descendants set per group for later bounding (even if not moved).
    const childrenByParent = new Map();
    for (const n of allNodes) {
      const parent = computeParentKey(n);
      if (!parent) continue;
      const list = childrenByParent.get(parent) ?? [];
      list.push(n.id);
      childrenByParent.set(parent, list);
    }

    const beforeNodes = (allNodes ?? []).map((n) => ({ ...n, data: n.data ?? {} }));
    const beforeEdges = (allEdges ?? []).map((e) => ({ ...e, data: e.data ?? {} }));

    const positionUpdates = new Map();

    for (const parent of Array.from(parentKeys)) {
      const ids = (nodeIdsByParent.get(parent) ?? []).slice().sort();
      if (ids.length === 0) continue;

      // Exclude locked template items from movement.
      const movableIds = ids.filter((id) => {
        const n = nodesById.get(id);
        if (!n) return false;
        if (groupOnly && parent === null) return false;
        return !isTemplateLocked(n);
      });

      const movableNodes = movableIds.map((id) => nodesById.get(id)).filter(Boolean);
      if (movableNodes.length >= 2) {
        const eligibleIdSet = new Set(movableIds);
        const localEdges = (allEdges ?? []).filter((e) => {
          if (!e?.source || !e?.target) return false;
          if (!eligibleIdSet.has(e.source) || !eligibleIdSet.has(e.target)) return false;
          const sParent = computeParentKey(nodesById.get(e.source));
          const tParent = computeParentKey(nodesById.get(e.target));
          return sParent === parent && tParent === parent;
        });

        const { positioned } = runDagreLayout({ nodes: movableNodes, edges: localEdges, rankdir, padding: 24 });
        for (const [id, pos] of positioned.entries()) {
          positionUpdates.set(id, { x: Math.round(pos.x), y: Math.round(pos.y) });
        }
      }
    }

    if (positionUpdates.size === 0) return;

    // Guard: layout must be non-destructive; only position may change.
    const proposedNodes = (beforeNodes ?? []).map((n) => {
      const nextPos = positionUpdates.get(n.id);
      if (!nextPos) return n;
      return { ...n, position: { x: nextPos.x, y: nextPos.y } };
    });
    assertLayoutOnlyMovedPositions({ beforeNodes, beforeEdges, afterNodes: proposedNodes, afterEdges: beforeEdges });

    updateNodes(
      (draft) =>
        (draft ?? []).map((n) => {
          const nextPos = positionUpdates.get(n.id);
          if (!nextPos) return n;
          return {
            ...n,
            position: { x: nextPos.x, y: nextPos.y }
          };
        }),
      { history: 'push' }
    );
  }, [nodes, edges, layoutStyle, updateNodes]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const loaded = await loadRegistries();
      if (cancelled) return;
      setRegistry(loaded);

      if (loaded?.status === 'ready') {
        setPaletteExpanded((prev) => {
          if (prev.size) return prev;
          const firstCategory = loaded.componentTypes.find((t) => !String(t.typeId ?? '').startsWith('legacy.'))?.category;
          const next = new Set();
          if (firstCategory) next.add(`cat:${firstCategory}`);
          next.add('groups');
          next.add('templates');
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setRegistry]);

  useEffect(() => {
    if (!lastModelingError) return;
    setSnackbar({ open: true, message: lastModelingError, severity: 'error' });
    clearLastModelingError();
  }, [lastModelingError, clearLastModelingError]);

  const selectedNodes = useMemo(() => {
    if (!selection?.nodes?.length) return [];
    const selectedIds = new Set(selection.nodes);
    return nodes.filter((node) => selectedIds.has(node.id));
  }, [selection, nodes]);

  const selectedEdges = useMemo(() => {
    if (!selection?.edges?.length) return [];
    const selectedIds = new Set(selection.edges);
    return edges.filter((edge) => selectedIds.has(edge.id));
  }, [selection, edges]);

  const inspectorMode = useMemo(() => {
    const nodeCount = selectedNodes.length;
    const edgeCount = selectedEdges.length;
    if (nodeCount === 0 && edgeCount === 0) return 'diagram';
    if (nodeCount === 1 && edgeCount === 0) return 'node';
    if (nodeCount === 0 && edgeCount === 1) return 'edge';
    return 'multi';
  }, [selectedNodes.length, selectedEdges.length]);

  const impactAnalysis = useMemo(() => {
    if (!impactModeEnabled) return null;
    // Explicitly compute only when user activates Impact Mode.
    return computeImpactAnalysis({
      nodes,
      edges,
      selectedNodeIds: selection?.nodes ?? [],
      direction: impactDirection,
      maxDepth: impactDepth
    });
  }, [impactModeEnabled, nodes, edges, selection?.nodes, impactDirection, impactDepth]);

  const impactExplainability = useMemo(() => {
    if (!impactModeEnabled) return null;
    const snapshotId = metadata?.eaSnapshot?.snapshotId ?? null;
    const snapTs = metadata?.eaSnapshot?.eaCoreTimestamp ?? metadata?.eaSnapshot?.importedAt ?? metadata?.updatedAt ?? null;
    const hasStart = (impactAnalysis?.startNodeIds?.length ?? 0) > 0;
    const impactedNodeCount = impactAnalysis?.impactedNodeIds?.size ?? 0;
    const impactedEdgeCount = impactAnalysis?.impactedEdgeIds?.size ?? 0;

    const indicators = impactAnalysis?.indicators ?? null;
    const hiFi = indicators?.highFanInNodeIds?.size ?? 0;
    const hiFo = indicators?.highFanOutNodeIds?.size ?? 0;
    const chain = indicators?.chainNodeIds?.size ?? 0;

    return {
      snapshotId,
      snapshotTimestamp: snapTs,
      direction: impactAnalysis?.direction ?? impactDirection,
      depthLimit: impactAnalysis?.depthLimit ?? impactDepth,
      hasStart,
      startCount: impactAnalysis?.startNodeIds?.length ?? 0,
      impactedNodeCount,
      impactedEdgeCount,
      indicators: {
        maxFanIn: indicators?.maxFanIn ?? 0,
        maxFanOut: indicators?.maxFanOut ?? 0,
        highFanInCount: hiFi,
        highFanOutCount: hiFo,
        chainCount: chain
      }
    };
  }, [impactModeEnabled, impactAnalysis, impactDirection, impactDepth, metadata]);

  const validationSummary = useMemo(() => {
    const list = Array.isArray(validationErrors) ? validationErrors : [];
    const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
    for (const item of list) {
      if (item?.severity === 'ERROR') counts.ERROR += 1;
      else if (item?.severity === 'WARNING') counts.WARNING += 1;
      else if (item?.severity === 'INFO') counts.INFO += 1;
    }
    return {
      ...counts,
      blocking: counts.ERROR > 0
    };
  }, [validationErrors]);

  useEffect(() => {
    if (!window?.electronAPI?.getGraph) return;
    try {
      window.electronAPI.getGraph();
    } catch {
      // Best-effort isolation check (silent by design).
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === ' ') {
        if (!isTextInputTarget(event.target)) {
          event.preventDefault();
          setSpacePressed(true);
        }
        return;
      }
      if (isTextInputTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.shiftKey && key === 'p') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (key === 'escape') {
        if (commandPaletteOpen) {
          event.preventDefault();
          setCommandPaletteOpen(false);
          return;
        }
      }

      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        removeSelectionFromActiveView();
        return;
      }

      if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        nudgeSelection({ dx, dy });
        return;
      }

      if (meta && key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }

      if (meta && key === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }

      if (meta && key === 'v') {
        event.preventDefault();
        pasteClipboard(lastMousePos);
        return;
      }

      if (meta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (meta && key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === ' ') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [removeSelectionFromActiveView, selectAll, copySelection, pasteClipboard, undo, redo, lastMousePos, nudgeSelection, commandPaletteOpen]);

  const handleExportJson = useCallback(async () => {
    if (!window?.electronAPI?.exportStudioJson) return;
    if (!registryReady) {
      setSnackbar({
        open: true,
        message: 'Export blocked: registry not loaded yet.',
        severity: 'error'
      });
      return;
    }
    if (validationSummary.blocking) {
      setSnackbar({
        open: true,
        message: `Export blocked: ${validationSummary.ERROR} validation error${validationSummary.ERROR === 1 ? '' : 's'}.`,
        severity: 'error'
      });
      return;
    }
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
  }, [registryReady, metadata.name, serialize, validationSummary]);

  const handleExportPng = useCallback(async () => {
    if (!window?.electronAPI?.exportStudioPng) return;
    if (validationSummary.blocking) {
      setSnackbar({
        open: true,
        message: `Export blocked: ${validationSummary.ERROR} validation error${validationSummary.ERROR === 1 ? '' : 's'}.`,
        severity: 'error'
      });
      return;
    }

    if ((nodes?.length ?? 0) === 0 && (edges?.length ?? 0) === 0) {
      setSnackbar({ open: true, message: 'Canvas is empty. Nothing to export.', severity: 'info' });
      return;
    }

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

      const prefix = 'data:image/png;base64,';
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length <= prefix.length) {
        setSnackbar({ open: true, message: 'PNG export failed: canvas image was empty.', severity: 'error' });
        return;
      }

      const result = await window.electronAPI.exportStudioPng({
        name: metadata.name || 'diagram',
        dataUrl
      });

      if (result?.saved) {
        setSnackbar({ open: true, message: 'PNG export complete.', severity: 'success' });
        return;
      }

      if (result?.error) {
        setSnackbar({ open: true, message: `PNG export failed: ${result.error}`, severity: 'error' });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: `PNG export failed: ${error?.message ?? error}`,
        severity: 'error'
      });
    }
  }, [metadata.name, validationSummary, nodes, edges]);

  const commandList = useMemo(() => {
    const selectedNodeIds = selection?.nodes ?? [];
    const selectedEdgeIds = selection?.edges ?? [];
    const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
    const canAutoLayout = (nodes ?? []).length > 0;
    const canConnectDepends = selectedNodeIds.length === 2;
    const registryOk = Boolean(registryReady);
    const diagramTypeOk = Boolean(metadata?.diagramTypeId && isKnownDiagramType(metadata.diagramTypeId));

    const anchor = lastMousePos ?? { x: 80, y: 80 };

    const commands = [
      {
        id: 'add.application',
        label: 'Add Application',
        shortcut: '',
        enabled: registryOk && diagramTypeOk && registry?.componentTypesById?.has('app.application'),
        blockedReason: !registryOk
          ? 'Registry not loaded.'
          : !diagramTypeOk
            ? 'Diagram type not set.'
            : !registry?.componentTypesById?.has('app.application')
              ? 'Missing component type app.application.'
              : '',
        run: () => addComponentNode({ componentTypeId: 'app.application', position: anchor })
      },
      {
        id: 'edge.dependsOn',
        label: 'Create Guided Edge (selected 2 nodes)',
        shortcut: '',
        enabled: registryOk && diagramTypeOk && canConnectDepends,
        blockedReason: !registryOk
          ? 'Registry not loaded.'
          : !diagramTypeOk
            ? 'Diagram type not set.'
            : !canConnectDepends
              ? 'Select exactly 2 nodes.'
              : '',
        run: () => {
          const [source, target] = selectedNodeIds;
          useStudioStore.getState().onConnect({ source, target });
        }
      },
      {
        id: 'layout.auto',
        label: 'Run Auto Layout',
        shortcut: '',
        enabled: canAutoLayout,
        blockedReason: canAutoLayout ? '' : 'No nodes.',
        run: () => handleApplyAutoLayout()
      },
      {
        id: 'impact.toggle',
        label: impactModeEnabled ? 'Disable Impact Mode' : 'Enable Impact Mode',
        shortcut: '',
        enabled: true,
        blockedReason: '',
        run: () => setImpactModeEnabled((v) => !v)
      },
      {
        id: 'view.new',
        label: 'Create New Diagram View',
        shortcut: '',
        enabled: true,
        blockedReason: '',
        run: () => createDiagramView({ name: `View ${(diagramViews?.views?.length ?? 0) + 1}` })
      },
      {
        id: 'view.delete',
        label: 'Delete Active Diagram View',
        shortcut: '',
        enabled: (diagramViews?.views?.length ?? 0) > 1,
        blockedReason: (diagramViews?.views?.length ?? 0) > 1 ? '' : 'Cannot delete last view.',
        run: () => deleteDiagramView({ viewId: diagramViews?.activeViewId })
      },
      {
        id: 'align.left',
        label: 'Align Left',
        enabled: (selection?.nodes?.length ?? 0) >= 2,
        blockedReason: (selection?.nodes?.length ?? 0) >= 2 ? '' : 'Select 2+ nodes.',
        run: () => alignSelection({ mode: 'left' })
      },
      {
        id: 'align.hcenter',
        label: 'Align Horizontal Center',
        enabled: (selection?.nodes?.length ?? 0) >= 2,
        blockedReason: (selection?.nodes?.length ?? 0) >= 2 ? '' : 'Select 2+ nodes.',
        run: () => alignSelection({ mode: 'hcenter' })
      },
      {
        id: 'align.top',
        label: 'Align Top',
        enabled: (selection?.nodes?.length ?? 0) >= 2,
        blockedReason: (selection?.nodes?.length ?? 0) >= 2 ? '' : 'Select 2+ nodes.',
        run: () => alignSelection({ mode: 'top' })
      },
      {
        id: 'align.vcenter',
        label: 'Align Vertical Center',
        enabled: (selection?.nodes?.length ?? 0) >= 2,
        blockedReason: (selection?.nodes?.length ?? 0) >= 2 ? '' : 'Select 2+ nodes.',
        run: () => alignSelection({ mode: 'vcenter' })
      },
      {
        id: 'distribute.h',
        label: 'Distribute Horizontally',
        enabled: (selection?.nodes?.length ?? 0) >= 3,
        blockedReason: (selection?.nodes?.length ?? 0) >= 3 ? '' : 'Select 3+ nodes.',
        run: () => distributeSelection({ mode: 'horizontal' })
      },
      {
        id: 'distribute.v',
        label: 'Distribute Vertically',
        enabled: (selection?.nodes?.length ?? 0) >= 3,
        blockedReason: (selection?.nodes?.length ?? 0) >= 3 ? '' : 'Select 3+ nodes.',
        run: () => distributeSelection({ mode: 'vertical' })
      },
      {
        id: 'delete.view',
        label: 'Remove Selection From Diagram View',
        enabled: hasSelection,
        blockedReason: hasSelection ? '' : 'No selection.',
        run: () => removeSelectionFromActiveView()
      },
      {
        id: 'delete.model',
        label: 'Delete Selection From Model (destructive)',
        enabled: hasSelection,
        blockedReason: hasSelection ? '' : 'No selection.',
        run: () => deleteSelectionFromModel()
      },
      {
        id: 'export.json',
        label: 'Export Diagram JSON',
        enabled: !validationSummary.blocking,
        blockedReason: validationSummary.blocking ? 'Validation blocking.' : '',
        run: () => handleExportJson()
      },
      {
        id: 'export.png',
        label: 'Export Diagram PNG',
        enabled: !validationSummary.blocking,
        blockedReason: validationSummary.blocking ? 'Validation blocking.' : '',
        run: () => handleExportPng()
      }
    ];

    return commands;
  }, [
    selection,
    nodes,
    metadata,
    registryReady,
    registry,
    lastMousePos,
    addComponentNode,
    impactModeEnabled,
    setImpactModeEnabled,
    diagramViews,
    createDiagramView,
    deleteDiagramView,
    alignSelection,
    distributeSelection,
    removeSelectionFromActiveView,
    deleteSelectionFromModel,
    handleApplyAutoLayout,
    validationSummary.blocking,
    handleExportJson,
    handleExportPng
  ]);

  const filteredCommands = useMemo(() => {
    const q = String(commandQuery ?? '').trim().toLowerCase();
    if (!q) return commandList;
    return commandList.filter((c) => String(c.label ?? '').toLowerCase().includes(q));
  }, [commandList, commandQuery]);

  const runCommand = useCallback(
    (cmd) => {
      if (!cmd) return;
      if (!cmd.enabled) {
        setSnackbar({ open: true, message: cmd.blockedReason || 'Command blocked.', severity: 'warning' });
        return;
      }
      try {
        cmd.run();
        setCommandPaletteOpen(false);
        setCommandQuery('');
      } catch (error) {
        setSnackbar({ open: true, message: String(error?.message ?? error), severity: 'error' });
      }
    },
    [setSnackbar]
  );

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
      if (!registryReady) {
        setSnackbar({
          open: true,
          message: 'Save blocked: registry not loaded yet.',
          severity: 'error'
        });
        return;
      }
      if (validationSummary.blocking) {
        setSnackbar({
          open: true,
          message: `Save blocked: ${validationSummary.ERROR} validation error${validationSummary.ERROR === 1 ? '' : 's'}.`,
          severity: 'error'
        });
        return;
      }
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
    [registryReady, serialize, metadata.name, markClean, loadDiagramList, validationSummary]
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

  const basePalette = useMemo(() => {
    if (!registryReady) return [];

    const diagramTypeId = metadata?.diagramTypeId;
    if (!diagramTypeId || !isKnownDiagramType(diagramTypeId)) return [];

    const def = getDiagramDefinition(diagramTypeId);
    const sections = def?.palette ?? [];

    return (sections ?? [])
      .map((section) => {
        const items = (section.items ?? []).filter((item) => {
          if (item.kind === 'componentType') return registry.componentTypesById?.has(item.componentTypeId);
          if (item.kind === 'groupType') return registry.groupTypesById?.has(item.groupTypeId);
          return false;
        });
        return { ...section, items };
      })
      .filter((s) => (s.items ?? []).length);
  }, [registryReady, registry, metadata?.diagramTypeId]);

  useEffect(() => {
    setPaletteExpanded(new Set(basePalette.map((s) => s.id)));
  }, [basePalette]);

  const filteredPalette = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) return basePalette;
    return basePalette
      .map((section) => {
        const items = (section.items ?? []).filter((item) => {
          const haystack = `${item.label} ${item.description ?? ''}`.toLowerCase();
          return haystack.includes(query);
        });
        return { ...section, items };
      })
      .filter((section) => (section.items ?? []).length > 0);
  }, [paletteQuery, basePalette]);

  const handlePaletteAccordion = useCallback((id) => {
    setPaletteExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePaletteDragStart = useCallback((event, item) => {
    event.dataTransfer.setData('application/x-ea-studio', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'copy';

    const dragImage = buildDragImage(theme, item.label);
    document.body.appendChild(dragImage);
    event.dataTransfer.setDragImage(dragImage, 10, 10);
    requestAnimationFrame(() => {
      document.body.removeChild(dragImage);
    });
  }, [theme]);

  const handlePaletteActivate = useCallback(
    (item) => {
      const position = { x: Math.random() * 420, y: Math.random() * 260 };
      if (item.kind === 'componentType') {
        createNodeFromRegistryType(item.componentTypeId, position);
        return;
      }
      if (item.kind === 'groupType') {
        addGroupNode({ groupTypeId: item.groupTypeId, position });
        return;
      }
      if (item.kind === 'template') {
        instantiateTemplate({ templateId: item.templateId, position });
      }
    },
    [createNodeFromRegistryType, addGroupNode, instantiateTemplate]
  );

  const handleCanvasDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback(
    (event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/x-ea-studio');
      if (!raw) return;

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload?.kind) return;

      const flowPos =
        reactFlow.screenToFlowPosition?.({ x: event.clientX, y: event.clientY }) ??
        reactFlow.project?.({ x: event.clientX, y: event.clientY }) ??
        { x: 0, y: 0 };

      if (payload.kind === 'componentType') {
        createNodeFromRegistryType(payload.componentTypeId, flowPos);
        return;
      }

      if (payload.kind === 'groupType') {
        addGroupNode({ groupTypeId: payload.groupTypeId, position: flowPos });
        return;
      }

      if (payload.kind === 'template') {
        instantiateTemplate({ templateId: payload.templateId, position: flowPos });
      }
    },
    [reactFlow, addComponentNode, addGroupNode, instantiateTemplate]
  );

  const handlePaneMouseMove = useCallback(
    (event) => {
      const pos = reactFlow.screenToFlowPosition?.({ x: event.clientX, y: event.clientY });
      if (!pos) return;
      setLastMousePos(pos);
    },
    [reactFlow]
  );

  const handleNodeDragStop = useCallback(
    (_event, draggedNode) => {
      if (!draggedNode) return;
      if (!registryReady) return;

      const intersecting = (reactFlow.getIntersectingNodes?.(draggedNode) ?? [])
        .filter((n) => n?.id && n.id !== draggedNode.id)
        .filter((n) => n.type === 'group');

      const bestGroup = intersecting
        .map((n) => ({
          node: n,
          area: (n.width ?? 0) * (n.height ?? 0)
        }))
        .sort((a, b) => (a.area || Infinity) - (b.area || Infinity))[0]?.node;

      const current = reactFlow.getNode?.(draggedNode.id) ?? draggedNode;
      const abs = current.positionAbsolute ?? current.position;

      if (bestGroup) {
        const parent = reactFlow.getNode?.(bestGroup.id) ?? bestGroup;
        const parentAbs = parent.positionAbsolute ?? parent.position ?? { x: 0, y: 0 };
        const rel = { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y };
        const ok = setParentGroup({ nodeId: draggedNode.id, parentGroupId: bestGroup.id, nextPosition: rel });
        if (!ok) {
          undo();
        }
        [registryReady, reactFlow, setParentGroup, undo]
      }

      if (draggedNode.parentNode) {
        const ok = setParentGroup({ nodeId: draggedNode.id, parentGroupId: null, nextPosition: abs });
        if (!ok) {
          undo();
        }
      }
    },
    [reactFlow, registry, setParentGroup, undo]
  );

  const openContextMenu = useCallback(
    (payload) => {
      setContextMenu(payload);
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handlePaneContextMenu = useCallback(
    (event) => {
      event.preventDefault();
      openContextMenu({
        kind: 'canvas',
        mouseX: event.clientX,
        mouseY: event.clientY
      });
    },
    [openContextMenu]
  );

  const handleNodeContextMenu = useCallback(
    (event, node) => {
      event.preventDefault();
      setSelectionEphemeral({ nodes: [node.id], edges: [] });
      openContextMenu({
        kind: 'node',
        targetId: node.id,
        mouseX: event.clientX,
        mouseY: event.clientY
      });
    },
    [openContextMenu, setSelectionEphemeral]
  );

  const handleEdgeContextMenu = useCallback(
    (event, edge) => {
      event.preventDefault();
      setSelectionEphemeral({ nodes: [], edges: [edge.id] });
      openContextMenu({
        kind: 'edge',
        targetId: edge.id,
        mouseX: event.clientX,
        mouseY: event.clientY
      });
    },
    [openContextMenu, setSelectionEphemeral]
  );

  const handleNodeLabelChange = useCallback(
    (value) => {
      const node = selectedNodes[0];
      if (!node) return;
      setNodeAttribute({ nodeId: node.id, key: 'name', value });
    },
    [selectedNodes, setNodeAttribute]
  );

  const handleNodeDescriptionChange = useCallback(
    (value) => {
      const node = selectedNodes[0];
      if (!node) return;
      setNodeAttribute({ nodeId: node.id, key: 'description', value });
    },
    [selectedNodes, setNodeAttribute]
  );

  const computeAlertSeverity = useCallback((issues) => {
    const list = Array.isArray(issues) ? issues : [];
    if (list.some((i) => i?.severity === 'ERROR')) return 'error';
    if (list.some((i) => i?.severity === 'WARNING')) return 'warning';
    if (list.some((i) => i?.severity === 'INFO')) return 'info';
    return 'info';
  }, []);

  const computeAllowedEdgeTypeIds = useCallback(
    (edge) => {
      if (!registryReady || !edge) return [];
      const sourceNode = (nodes ?? []).find((n) => n.id === edge.source);
      const targetNode = (nodes ?? []).find((n) => n.id === edge.target);
      const sourceType = getComponentType(registry, sourceNode?.data?.componentTypeId);
      const targetType = getComponentType(registry, targetNode?.data?.componentTypeId);
      if (!sourceType || !targetType) return [];
      const sourceAllowed = Array.isArray(sourceType.allowedEdgeTypes) ? sourceType.allowedEdgeTypes : [];
      const targetAllowed = Array.isArray(targetType.allowedEdgeTypes) ? targetType.allowedEdgeTypes : [];
      return sourceAllowed
        .filter((id) => targetAllowed.includes(id))
        .filter((id) => Boolean(registry.edgeTypesById?.has(id)))
        .slice()
        .sort();
    },
    [registry, registryReady, nodes]
  );

  const handleEdgeDescriptionChange = useCallback(
    (value) => {
      const edge = selectedEdges[0];
      if (!edge) return;
      setEdgeDescription({ edgeId: edge.id, description: value });
    },
    [selectedEdges, setEdgeDescription]
  );

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(200px, 240px) minmax(0, 1fr) minmax(220px, 260px)',
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
          minWidth: 200,
          p: 1,
          gap: 1,
          backgroundColor: 'background.paper'
        }}
      >
        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
            Palette
          </Typography>
          <TextField
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.target.value)}
            placeholder="Search palette"
            size="small"
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
        </Stack>

        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            Auto-layout
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              size="small"
              value={layoutStyle}
              onChange={(e) => setLayoutStyle(e.target.value)}
              fullWidth
            >
              {LAYOUT_STYLES.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" onClick={handleApplyAutoLayout}>
              Apply
            </Button>
          </Stack>
        </Stack>

        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            Diagram Views
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              size="small"
              label="Active View"
              value={diagramViews?.activeViewId ?? 'view-main'}
              onChange={(e) => setActiveDiagramView(e.target.value)}
              fullWidth
            >
              {(diagramViews?.views ?? []).map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.name}
                </MenuItem>
              ))}
            </TextField>
            <Tooltip title="New view">
              <IconButton
                size="small"
                onClick={() => createDiagramView({ name: `View ${(diagramViews?.views?.length ?? 0) + 1}` })}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete view">
              <span>
                <IconButton
                  size="small"
                  onClick={() => deleteDiagramView({ viewId: diagramViews?.activeViewId })}
                  disabled={(diagramViews?.views?.length ?? 0) <= 1}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            View Layers
          </Typography>
          <List dense disablePadding>
            {availableLayers.map((layer) => (
              <ListItem key={layer.id} disablePadding>
                <FormControlLabel
                  sx={{ m: 0, width: '100%', pl: 1 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={activeLayerIds.includes(layer.id)}
                      onChange={() => toggleViewLayer(layer.id)}
                    />
                  }
                  label={<Typography variant="body2">{layer.label}</Typography>}
                />
              </ListItem>
            ))}
          </List>
        </Stack>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            Impact Mode
          </Typography>
          <FormControlLabel
            sx={{ m: 0, pl: 1 }}
            control={
              <Switch
                size="small"
                checked={impactModeEnabled}
                onChange={(e) => setImpactModeEnabled(Boolean(e.target.checked))}
              />
            }
            label={<Typography variant="body2">Impact Mode (explicit)</Typography>}
          />
          {impactModeEnabled ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                select
                size="small"
                label="Direction"
                value={impactDirection}
                onChange={(e) => setImpactDirection(e.target.value)}
                fullWidth
              >
                <MenuItem value="downstream">Downstream (source → target)</MenuItem>
                <MenuItem value="upstream">Upstream (target → source)</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="Depth"
                value={impactDepth}
                onChange={(e) => setImpactDepth(Number(e.target.value))}
                sx={{ width: 110 }}
              >
                <MenuItem value={1}>1</MenuItem>
                <MenuItem value={2}>2</MenuItem>
                <MenuItem value={3}>3</MenuItem>
              </TextField>
            </Stack>
          ) : null}
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
          {!isKnownDiagramType(metadata?.diagramTypeId) ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Palette disabled until diagram type is selected
            </Alert>
          ) : !registryReady ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Component Type Registry not loaded. Component creation is disabled.
            </Typography>
          ) : filteredPalette.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              No matches.
            </Typography>
          ) : (
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {filteredPalette.map((section) => (
                <Accordion
                  key={section.id}
                  disableGutters
                  elevation={0}
                  expanded={paletteExpanded.has(section.id)}
                  onChange={() => handlePaletteAccordion(section.id)}
                  sx={{
                    backgroundColor: 'transparent',
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    borderLeft: 'none',
                    borderRight: 'none',
                    borderBottom: 'none',
                    borderRadius: 0,
                    '&:before': { display: 'none' }
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {section.label}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0 }}>
                    <List dense disablePadding>
                      {(section.items ?? []).map((item) => (
                        <ListItem key={item.id} disablePadding>
                          <Tooltip title={item.description ?? item.label} placement="right" arrow>
                            <ListItemButton
                              draggable
                              onDragStart={(event) => handlePaletteDragStart(event, item)}
                              onDoubleClick={() => handlePaletteActivate(item)}
                              sx={{ borderRadius: 0 }}
                            >
                              <ListItemText primary={item.label} secondary={item.description} />
                            </ListItemButton>
                          </Tooltip>
                        </ListItem>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          )}
        </Box>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
            Persistence
          </Typography>
          {validationSummary.blocking ? (
            <Alert severity="error">Validation blocking: {validationSummary.ERROR} error{validationSummary.ERROR === 1 ? '' : 's'}.</Alert>
          ) : validationSummary.WARNING > 0 ? (
            <Alert severity="warning">Validation warnings: {validationSummary.WARNING} warning{validationSummary.WARNING === 1 ? '' : 's'}.</Alert>
          ) : null}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={() => handleSaveDiagram(false)}
              disabled={saving || !dirty || validationSummary.blocking}
            >
              Save
            </Button>
            <Button variant="outlined" onClick={() => handleSaveDiagram(true)} disabled={saving || validationSummary.blocking}>
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

        <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
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
                    sx={{ borderRadius: 0 }}
                  >
                    <ListItemButton
                      selected={diagramId === item.id}
                      onClick={() => handleLoadDiagram(item.id)}
                      sx={{ borderRadius: 0 }}
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

        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
            Export
          </Typography>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportJson} disabled={validationSummary.blocking}>
            Export JSON
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportPng} disabled={validationSummary.blocking}>
            Export PNG
          </Button>
        </Stack>

        <Divider sx={{ borderColor: 'divider' }} />

        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
            EA Snapshot
          </Typography>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleImportEaSnapshot}>
            {metadata?.eaSnapshot?.snapshotId ? 'Re-import Snapshot' : 'Import Snapshot'}
          </Button>

          {metadata?.eaSnapshot?.snapshotId ? (
            <Typography variant="caption" color="text.secondary">
              Snapshot {String(metadata.eaSnapshot.snapshotId).slice(0, 8)} • Imported {new Date(metadata.eaSnapshot.importedAt ?? metadata.updatedAt).toLocaleString()}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Explicit, snapshot-based, read-only binding from EA Core.
            </Typography>
          )}

          {pendingEaImport?.diff ? (
            <Alert
              severity="info"
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      const ok = importEaSnapshot({ ...pendingEaImport.payload, mode: 'replace' });
                      if (ok) {
                        setPendingEaImport(null);
                        setSnackbar({ open: true, message: 'EA snapshot replaced.', severity: 'success' });
                      }
                    }}
                  >
                    Replace snapshot
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => setPendingEaImport(null)}>
                    Keep current
                  </Button>
                </Stack>
              }
            >
              Drift detected — Applications: +{pendingEaImport.diff.applications.added} / -{pendingEaImport.diff.applications.removed} / Δ{pendingEaImport.diff.applications.changed}. Dependencies: +{pendingEaImport.diff.dependencies.added} / -{pendingEaImport.diff.dependencies.removed} / Δ{pendingEaImport.diff.dependencies.changed}.
            </Alert>
          ) : null}
        </Stack>
      </Box>

      <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }} onMouseMove={handlePaneMouseMove}>
            <CanvasView
              containerRef={canvasRef}
              spacePressed={spacePressed}
              impact={{
                enabled: impactModeEnabled,
                analysis: impactAnalysis
              }}
              onDrop={handleCanvasDrop}
              onDragOver={handleCanvasDragOver}
              onPaneContextMenu={handlePaneContextMenu}
              onNodeContextMenu={handleNodeContextMenu}
              onEdgeContextMenu={handleEdgeContextMenu}
              onNodeDragStop={handleNodeDragStop}
            />

            {!activated ? (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  backgroundColor: (t) => alpha(t.palette.background.default, 0.92),
                  border: (t) => `1px solid ${t.palette.divider}`
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 750 }}>
                  Select a diagram type to start modeling
                </Typography>
                <Box sx={{ width: 'min(860px, 92%)' }}>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 1.25
                    }}
                  >
                    {DIAGRAM_TYPES.map((t) => (
                      <Box
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => activateDiagramType(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            activateDiagramType(t.id);
                          }
                        }}
                        sx={{
                          p: 2,
                          borderRadius: 1,
                          border: (theme) => `1px solid ${theme.palette.divider}`,
                          backgroundColor: 'background.paper',
                          cursor: registryReady ? 'pointer' : 'not-allowed',
                          opacity: registryReady ? 1 : 0.6,
                          userSelect: 'none',
                          '&:hover': registryReady ? { borderColor: (theme) => theme.palette.primary.main } : null
                        }}
                      >
                        <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
                          {t.label}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {t.id === 'capability-map'
                            ? 'Strict capability hierarchy + business processes'
                            : t.id === 'application-landscape'
                              ? 'Category → Applications + process links'
                              : t.id === 'technology-architecture'
                                ? '3 fixed technology layers + cross-layer links'
                                : t.id === 'programme-portfolio'
                                  ? 'Category → Programme → Projects + targets'
                                  : 'Cross-domain relationships across capabilities, apps, and tech'}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                  {!registryReady ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      Loading registries…
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          borderLeft: (theme) => `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 220,
          p: 1,
          gap: 1,
          backgroundColor: 'background.paper'
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>
          Inspector
        </Typography>
                {impactModeEnabled ? (
                  <Stack spacing={0.5} sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: 1, p: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Impact Legend (explainable)
                    </Typography>
                    {!metadata?.eaSnapshot?.snapshotId ? (
                      <Alert severity="warning">No EA snapshot imported. Impact traversal uses EA snapshot dependencies only.</Alert>
                    ) : null}
                    {impactExplainability?.hasStart ? (
                      <Typography variant="body2" color="text.secondary">
                        Impacted = selected start node(s) + EA dependency traversal (direction: {impactExplainability.direction}, depth: {impactExplainability.depthLimit}).
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Select one or more nodes to compute impact (no background computation).
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      Snapshot: {impactExplainability?.snapshotId ? String(impactExplainability.snapshotId).slice(0, 8) : '—'} • Timestamp: {impactExplainability?.snapshotTimestamp ? new Date(impactExplainability.snapshotTimestamp).toLocaleString() : '—'}
                    </Typography>
                    {impactExplainability?.hasStart ? (
                      <Typography variant="caption" color="text.secondary">
                        Start: {impactExplainability.startCount} • Impacted nodes: {impactExplainability.impactedNodeCount} • Impact path edges: {impactExplainability.impactedEdgeCount}
                      </Typography>
                    ) : null}
                    {impactExplainability?.hasStart ? (
                      <Typography variant="caption" color="text.secondary">
                        Risk signals (EA-only, computed): High fan-in (max {impactExplainability.indicators.maxFanIn}) = {impactExplainability.indicators.highFanInCount} node(s) • High fan-out (max {impactExplainability.indicators.maxFanOut}) = {impactExplainability.indicators.highFanOutCount} node(s) • Chains (in=1,out=1) = {impactExplainability.indicators.chainCount} node(s)
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary">
                      Badges: START = traversal origin • FI = highest fan-in • FO = highest fan-out • CH = in=1,out=1 (within impacted EA subgraph)
                    </Typography>
                  </Stack>
                ) : null}
        {validationSummary.ERROR || validationSummary.WARNING || validationSummary.INFO ? (
          <Typography variant="caption" color={validationSummary.blocking ? 'error.main' : 'text.secondary'}>
            {validationSummary.ERROR} error{validationSummary.ERROR === 1 ? '' : 's'} • {validationSummary.WARNING} warning{validationSummary.WARNING === 1 ? '' : 's'}
          </Typography>
        ) : null}
        {inspectorMode === 'diagram' ? (
          <Stack spacing={0.75}>
            <Typography variant="caption" color="text.secondary">
              Diagram
            </Typography>
            <Tooltip title={diagramTypeLocked ? 'Diagram type cannot be changed after modeling begins' : ''} placement="top" arrow disableHoverListener={!diagramTypeLocked}>
              <TextField
                select
                label="Diagram Type"
                value={isKnownDiagramType(metadata?.diagramTypeId) ? metadata.diagramTypeId : ''}
                onChange={(event) => setMetadata({ diagramTypeId: event.target.value || null })}
                size="small"
                fullWidth
                disabled={diagramTypeLocked}
                helperText={metadata?.diagramTypeId ? getDiagramTypeLabel(metadata.diagramTypeId) : 'Required. Select a type to enable modeling.'}
              >
                <MenuItem value="">(Select)</MenuItem>
                {DIAGRAM_TYPES.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
            </Tooltip>
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
              minRows={3}
            />
            <Typography variant="caption" color="text.secondary">
              Updated {new Date(metadata.updatedAt).toLocaleString()}
              {dirty ? ' • Unsaved changes' : ''}
            </Typography>
          </Stack>
        ) : null}

        {inspectorMode === 'node' ? (
          <Stack spacing={0.75}>
            <Typography variant="caption" color="text.secondary">
              Node
            </Typography>

            {registryError ? (
              <Alert severity="error">Registry error: {registryError}</Alert>
            ) : null}

            {(() => {
              const node = selectedNodes[0];
              const eaLocked = node?.data?.metadata?.source === 'EA_CORE';
              const template = node?.data?.metadata?.template;
              const locked = Boolean(template?.locked) && !Boolean(template?.overridesEnabled);

              if (eaLocked) {
                return <Alert severity="info">EA Core snapshot element (read-only).</Alert>;
              }
              if (!locked) return null;
              return (
                <Alert
                  severity="warning"
                  action={
                    <Button size="small" variant="outlined" onClick={enableTemplateOverridesForSelection}>
                      Enable overrides
                    </Button>
                  }
                >
                  Locked template instance. Editing/moving requires explicit overrides.
                </Alert>
              );
            })()}

            {(() => {
              const node = selectedNodes[0];
              const nodeIssues = (validationErrors ?? []).filter((e) => e?.target?.kind === 'node' && e?.target?.id === node?.id);
              if (!nodeIssues.length) return null;
              return (
                <Alert severity={computeAlertSeverity(nodeIssues)}>{nodeIssues.map((e) => e.message).join(' ')}</Alert>
              );
            })()}

            {(() => {
              const node = selectedNodes[0];
              const kind = node?.data?.kind;
              const eaLocked = node?.data?.metadata?.source === 'EA_CORE';

              if (kind === 'group' || node?.type === 'group') {
                const groupType = node?.data?.groupTypeId ? registry?.groupTypesById?.get(node.data.groupTypeId) : null;
                return (
                  <>
                    <TextField label="Group Type" value={groupType?.displayName ?? node?.data?.groupTypeId ?? ''} size="small" fullWidth disabled />
                    <TextField
                      label="Name"
                      value={node?.data?.attributes?.name ?? ''}
                      onFocus={armHistory}
                      onBlur={clearArmedHistory}
                      onChange={(event) => setNodeAttribute({ nodeId: node.id, key: 'name', value: event.target.value })}
                      size="small"
                      fullWidth
                    />
                  </>
                );
              }

              const componentType = getComponentType(registry, node?.data?.componentTypeId);
              const schema = componentType?.requiredAttributes;
              const properties = schema?.properties ?? {};
              const required = new Set(schema?.required ?? []);
              const keys = Object.keys(properties).sort();

              return (
                <>
                  <TextField label="Component Type" value={componentType?.displayName ?? node?.data?.componentTypeId ?? ''} size="small" fullWidth disabled />
                  <TextField label="Category" value={componentType?.category ?? ''} size="small" fullWidth disabled />

                  {keys.map((key) => {
                    const def = properties[key] ?? {};
                    const label = `${key}${required.has(key) ? ' *' : ''}`;
                    const current = node?.data?.attributes?.[key];

                    if (Array.isArray(def.enum)) {
                      return (
                        <TextField
                          key={key}
                          select
                          label={label}
                          value={current ?? ''}
                          onFocus={armHistory}
                          onBlur={clearArmedHistory}
                          onChange={(event) => setNodeAttribute({ nodeId: node.id, key, value: event.target.value })}
                          size="small"
                          fullWidth
                          disabled={eaLocked}
                        >
                          {def.enum.map((opt) => (
                            <MenuItem key={String(opt)} value={opt}>
                              {String(opt)}
                            </MenuItem>
                          ))}
                        </TextField>
                      );
                    }

                    return (
                      <TextField
                        key={key}
                        label={label}
                        value={current ?? ''}
                        onFocus={armHistory}
                        onBlur={clearArmedHistory}
                        onChange={(event) => setNodeAttribute({ nodeId: node.id, key, value: event.target.value })}
                        size="small"
                        fullWidth
                        disabled={eaLocked}
                      />
                    );
                  })}

                  {eaLocked ? (
                    <>
                      <Divider sx={{ borderColor: 'divider' }} />
                      <Typography variant="caption" color="text.secondary">
                        Traceability (EA Core)
                      </Typography>
                      <TextField label="eaSourceType" value={node?.data?.metadata?.eaSourceType ?? ''} size="small" fullWidth disabled />
                      <TextField label="eaSourceId" value={node?.data?.metadata?.eaSourceId ?? ''} size="small" fullWidth disabled />
                      <TextField label="eaSnapshotId" value={node?.data?.metadata?.eaSnapshotId ?? ''} size="small" fullWidth disabled />
                      <TextField label="eaImportedAt" value={node?.data?.metadata?.eaImportedAt ?? ''} size="small" fullWidth disabled />
                    </>
                  ) : null}

                  <Divider sx={{ borderColor: 'divider' }} />

                  <Typography variant="caption" color="text.secondary">
                    Visual styling is derived from component/relationship types and active view layers.
                  </Typography>

                  <Divider sx={{ borderColor: 'divider' }} />

                  <Typography variant="caption" color="text.secondary">
                    Position: {Math.round(node.position.x)}, {Math.round(node.position.y)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Size: {Math.round(node.width ?? 0)} × {Math.round(node.height ?? 0)}
                  </Typography>
                </>
              );
            })()}
          </Stack>
        ) : null}

        {inspectorMode === 'edge' ? (
          <Stack spacing={1.25}>
            <Typography variant="caption" color="text.secondary">
              Edge
            </Typography>
            {(() => {
              const edge = selectedEdges[0];
              const eaLocked = edge?.data?.metadata?.source === 'EA_CORE';
              const template = edge?.data?.metadata?.template;
              const locked = Boolean(template?.locked) && !Boolean(template?.overridesEnabled);

              if (eaLocked) {
                return <Alert severity="info">EA Core snapshot relationship (read-only).</Alert>;
              }
              if (!locked) return null;
              return (
                <Alert
                  severity="warning"
                  action={
                    <Button size="small" variant="outlined" onClick={enableTemplateOverridesForSelection}>
                      Enable overrides
                    </Button>
                  }
                >
                  Locked template instance. Editing requires explicit overrides.
                </Alert>
              );
            })()}

            {(() => {
              const edge = selectedEdges[0];
              const edgeIssues = (validationErrors ?? []).filter((e) => e?.target?.kind === 'edge' && e?.target?.id === edge?.id);
              if (!edgeIssues.length) return null;
              return <Alert severity={computeAlertSeverity(edgeIssues)}>{edgeIssues.map((e) => e.message).join(' ')}</Alert>;
            })()}

            {(() => {
              const edge = selectedEdges[0];
              const locked = Boolean(edge?.data?.metadata?.template?.locked) && !Boolean(edge?.data?.metadata?.template?.overridesEnabled);
              const eaLocked = edge?.data?.metadata?.source === 'EA_CORE';
              const guidedEdgeTypeIds = new Set(Object.values(EA_EDGE_TYPES));
              const isGuided = guidedEdgeTypeIds.has(edge?.data?.edgeTypeId);
              const allowed = isGuided ? [edge?.data?.edgeTypeId].filter(Boolean) : computeAllowedEdgeTypeIds(edge);
              const value = isGuided ? edge?.data?.edgeTypeId ?? '' : allowed.includes(edge?.data?.edgeTypeId) ? edge?.data?.edgeTypeId : '';
              return (
                <TextField
                  select
                  label="Edge Type"
                  value={value}
                  onFocus={armHistory}
                  onBlur={clearArmedHistory}
                  onChange={(event) => setEdgeType({ edgeId: edge.id, edgeTypeId: event.target.value })}
                  size="small"
                  fullWidth
                  disabled={!registryReady || locked || eaLocked || isGuided || allowed.length === 0}
                  helperText={!registryReady ? 'Registry not loaded.' : isGuided ? 'Guided edges are fixed.' : allowed.length === 0 ? 'No allowed edge types for this connection.' : ' '}
                >
                  {allowed.map((edgeTypeId) => {
                    const type = getEdgeType(registry, edgeTypeId);
                    return (
                      <MenuItem key={edgeTypeId} value={edgeTypeId}>
                        {type?.displayName ?? edgeTypeId}
                      </MenuItem>
                    );
                  })}
                </TextField>
              );
            })()}
            <TextField
              label="Description"
              value={selectedEdges[0].data?.description ?? ''}
              onFocus={armHistory}
              onBlur={clearArmedHistory}
              onChange={(event) => handleEdgeDescriptionChange(event.target.value)}
              size="small"
              fullWidth
              multiline
              minRows={3}
              disabled={
                (Boolean(selectedEdges[0].data?.metadata?.template?.locked) && !Boolean(selectedEdges[0].data?.metadata?.template?.overridesEnabled)) ||
                selectedEdges[0]?.data?.metadata?.source === 'EA_CORE' ||
                new Set(Object.values(EA_EDGE_TYPES)).has(selectedEdges[0]?.data?.edgeTypeId)
              }
            />

            {selectedEdges[0]?.data?.metadata?.source === 'EA_CORE' ? (
              <>
                <Divider sx={{ borderColor: 'divider' }} />
                <Typography variant="caption" color="text.secondary">
                  Traceability (EA Core)
                </Typography>
                <TextField label="eaSourceType" value={selectedEdges[0]?.data?.metadata?.eaSourceType ?? ''} size="small" fullWidth disabled />
                <TextField label="eaSourceId" value={selectedEdges[0]?.data?.metadata?.eaSourceId ?? ''} size="small" fullWidth disabled />
                <TextField label="eaSnapshotId" value={selectedEdges[0]?.data?.metadata?.eaSnapshotId ?? ''} size="small" fullWidth disabled />
                <TextField label="eaImportedAt" value={selectedEdges[0]?.data?.metadata?.eaImportedAt ?? ''} size="small" fullWidth disabled />
              </>
            ) : null}
            <Divider sx={{ borderColor: 'divider' }} />
            <Typography variant="caption" color="text.secondary">
              Visual styling is derived from relationship type and active view layers.
            </Typography>
          </Stack>
        ) : null}

        {inspectorMode === 'multi' ? (
          <Stack spacing={1.25}>
            <Typography variant="caption" color="text.secondary">
              Multi-select
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedNodes.length} node{selectedNodes.length === 1 ? '' : 's'} • {selectedEdges.length} edge{selectedEdges.length === 1 ? '' : 's'}
            </Typography>
          </Stack>
        ) : null}
      </Box>

      <Dialog
        open={commandPaletteOpen}
        onClose={() => {
          setCommandPaletteOpen(false);
          setCommandQuery('');
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Command Palette</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Type a command"
            value={commandQuery}
            onChange={(event) => setCommandQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setCommandPaletteOpen(false);
                setCommandQuery('');
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const first = (filteredCommands ?? []).find((c) => c?.enabled) ?? (filteredCommands ?? [])[0];
                if (first) runCommand(first);
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
          <List dense sx={{ mt: 1, maxHeight: 360, overflow: 'auto' }}>
            {(filteredCommands ?? []).length === 0 ? (
              <ListItem>
                <ListItemText primary="No matching commands." />
              </ListItem>
            ) : (
              (filteredCommands ?? []).map((cmd) => (
                <ListItem key={cmd.id} disablePadding>
                  <ListItemButton disabled={!cmd.enabled} onClick={() => runCommand(cmd)}>
                    <ListItemText
                      primary={cmd.label}
                      secondary={cmd.enabled ? cmd.group : cmd.blockedReason ?? cmd.reason ?? cmd.group}
                      secondaryTypographyProps={{
                        sx: { color: cmd.enabled ? 'text.secondary' : 'warning.main' }
                      }}
                    />
                    {cmd.shortcut ? (
                      <Typography variant="caption" color="text.secondary">
                        {cmd.shortcut}
                      </Typography>
                    ) : null}
                  </ListItemButton>
                </ListItem>
              ))
            )}
          </List>
        </DialogContent>
      </Dialog>

      <Menu
        open={Boolean(contextMenu)}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu
            ? {
                top: contextMenu.mouseY,
                left: contextMenu.mouseX
              }
            : undefined
        }
      >
        {contextMenu?.kind === 'canvas' ? (
          <>
            <MenuItem
              onClick={() => {
                const pos = reactFlow.screenToFlowPosition?.({ x: contextMenu.mouseX, y: contextMenu.mouseY }) ?? lastMousePos;
                closeContextMenu();
                pasteClipboard(pos);
              }}
            >
              Paste
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                closeContextMenu();
                reactFlow.fitView?.({ duration: 0, padding: 0.85 });
              }}
            >
              Fit to view
            </MenuItem>
          </>
        ) : null}

        {contextMenu?.kind === 'node' || contextMenu?.kind === 'edge' ? (
          <>
            <MenuItem
              onClick={() => {
                closeContextMenu();
                copySelection();
              }}
            >
              Copy
            </MenuItem>
            <MenuItem
              onClick={() => {
                closeContextMenu();
                deleteSelection();
              }}
            >
              Delete
            </MenuItem>
          </>
        ) : null}
      </Menu>

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
    <ReactFlowProvider>
      <StudioContent />
    </ReactFlowProvider>
  );
}
