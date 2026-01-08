export const DIAGRAM_TYPE_IDS = {
  CAPABILITY_MAP: 'capability-map',
  APPLICATION_LANDSCAPE: 'application-landscape',
  TECHNOLOGY_ARCHITECTURE: 'technology-architecture',
  PROGRAMME_PORTFOLIO: 'programme-portfolio',
  CROSS_DOMAIN_TRACEABILITY: 'cross-domain-traceability'
};

export const DIAGRAM_TYPES = [
  { id: DIAGRAM_TYPE_IDS.CAPABILITY_MAP, label: 'Capability Map' },
  { id: DIAGRAM_TYPE_IDS.APPLICATION_LANDSCAPE, label: 'Application Landscape' },
  { id: DIAGRAM_TYPE_IDS.TECHNOLOGY_ARCHITECTURE, label: 'Technology Architecture' },
  { id: DIAGRAM_TYPE_IDS.PROGRAMME_PORTFOLIO, label: 'Programme Portfolio' },
  { id: DIAGRAM_TYPE_IDS.CROSS_DOMAIN_TRACEABILITY, label: 'Traceability View' }
];

export const EA_GROUP_TYPES = {
  CAP_CATEGORY: 'ea.catDept',
  CAP_CAPABILITY: 'ea.capability',
  CAP_SUBCAPABILITY: 'ea.subCapability',

  APP_CATEGORY: 'app.catDept',

  PROG_CATEGORY: 'prog.catDept',
  PROG_PROGRAMME: 'prog.programme',

  TECH_LAYER_INFRA: 'tech.layer.infrastructure',
  TECH_LAYER_HOSTING: 'tech.layer.hostingOps',
  TECH_LAYER_PLATFORM: 'tech.layer.platformServices',
  TECH_GROUP: 'tech.group'
};

export const EA_COMPONENT_TYPES = {
  BUSINESS_PROCESS: 'ea.businessProcess',
  APPLICATION: 'app.application',
  PROGRAMME_PROJECT: 'prog.project',
  TECH_ELEMENT: 'tech.element'
};

export const EA_EDGE_TYPES = {
  PROCESS_TO_APP: 'rel.processToApp',
  PROGRAMME_TO_CAPABILITY: 'rel.programmeToCapability',
  PROGRAMME_TO_APPLICATION: 'rel.programmeToApplication',
  APPLICATION_TO_TECH: 'rel.appToTechnology'
};

export function getDiagramTypeLabel(diagramTypeId) {
  return DIAGRAM_TYPES.find((t) => t.id === diagramTypeId)?.label ?? '';
}

export function isKnownDiagramType(diagramTypeId) {
  return DIAGRAM_TYPES.some((t) => t.id === diagramTypeId);
}

export function getDiagramDefinition(diagramTypeId) {
  switch (diagramTypeId) {
    case DIAGRAM_TYPE_IDS.CAPABILITY_MAP:
      return {
        id: diagramTypeId,
        label: getDiagramTypeLabel(diagramTypeId),
        defaultLayoutStyle: 'flow-tb',
        palette: [
          {
            id: 'capability.structure',
            label: 'Capability Structure',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_CATEGORY, groupTypeId: EA_GROUP_TYPES.CAP_CATEGORY, label: 'Category / Department' },
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_CAPABILITY, groupTypeId: EA_GROUP_TYPES.CAP_CAPABILITY, label: 'Capability' },
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_SUBCAPABILITY, groupTypeId: EA_GROUP_TYPES.CAP_SUBCAPABILITY, label: 'Sub-Capability' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.BUSINESS_PROCESS, componentTypeId: EA_COMPONENT_TYPES.BUSINESS_PROCESS, label: 'Business Process' }
            ]
          }
        ]
      };

    case DIAGRAM_TYPE_IDS.APPLICATION_LANDSCAPE:
      return {
        id: diagramTypeId,
        label: getDiagramTypeLabel(diagramTypeId),
        defaultLayoutStyle: 'flow-lr',
        palette: [
          {
            id: 'application.structure',
            label: 'Application Structure',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.APP_CATEGORY, groupTypeId: EA_GROUP_TYPES.APP_CATEGORY, label: 'Category / Department' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.APPLICATION, componentTypeId: EA_COMPONENT_TYPES.APPLICATION, label: 'Application' }
            ]
          }
        ]
      };

    case DIAGRAM_TYPE_IDS.TECHNOLOGY_ARCHITECTURE:
      return {
        id: diagramTypeId,
        label: getDiagramTypeLabel(diagramTypeId),
        defaultLayoutStyle: 'flow-lr',
        palette: [
          {
            id: 'tech.layers',
            label: 'Technology Layers',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_LAYER_INFRA, groupTypeId: EA_GROUP_TYPES.TECH_LAYER_INFRA, label: 'Infrastructure Layer' },
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_LAYER_HOSTING, groupTypeId: EA_GROUP_TYPES.TECH_LAYER_HOSTING, label: 'Application Hosting & Ops' },
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_LAYER_PLATFORM, groupTypeId: EA_GROUP_TYPES.TECH_LAYER_PLATFORM, label: 'Platform Services' },
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_GROUP, groupTypeId: EA_GROUP_TYPES.TECH_GROUP, label: 'Layer Group' }
            ]
          },
          {
            id: 'tech.elements',
            label: 'Technology Elements',
            items: [{ kind: 'componentType', id: EA_COMPONENT_TYPES.TECH_ELEMENT, componentTypeId: EA_COMPONENT_TYPES.TECH_ELEMENT, label: 'Technology Element' }]
          },
          {
            id: 'applications',
            label: 'Applications',
            items: [{ kind: 'componentType', id: EA_COMPONENT_TYPES.APPLICATION, componentTypeId: EA_COMPONENT_TYPES.APPLICATION, label: 'Application' }]
          }
        ]
      };

    case DIAGRAM_TYPE_IDS.PROGRAMME_PORTFOLIO:
      return {
        id: diagramTypeId,
        label: getDiagramTypeLabel(diagramTypeId),
        defaultLayoutStyle: 'flow-tb',
        palette: [
          {
            id: 'programme.structure',
            label: 'Programme Structure',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.PROG_CATEGORY, groupTypeId: EA_GROUP_TYPES.PROG_CATEGORY, label: 'Category / Department' },
              { kind: 'groupType', id: EA_GROUP_TYPES.PROG_PROGRAMME, groupTypeId: EA_GROUP_TYPES.PROG_PROGRAMME, label: 'Programme' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.PROGRAMME_PROJECT, componentTypeId: EA_COMPONENT_TYPES.PROGRAMME_PROJECT, label: 'Project' }
            ]
          },
          {
            id: 'references',
            label: 'Reference Nodes',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_CATEGORY, groupTypeId: EA_GROUP_TYPES.CAP_CATEGORY, label: 'Capability Category' },
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_CAPABILITY, groupTypeId: EA_GROUP_TYPES.CAP_CAPABILITY, label: 'Capability' },
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_SUBCAPABILITY, groupTypeId: EA_GROUP_TYPES.CAP_SUBCAPABILITY, label: 'Sub-Capability' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.BUSINESS_PROCESS, componentTypeId: EA_COMPONENT_TYPES.BUSINESS_PROCESS, label: 'Business Process' },
              { kind: 'groupType', id: EA_GROUP_TYPES.APP_CATEGORY, groupTypeId: EA_GROUP_TYPES.APP_CATEGORY, label: 'Application Category' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.APPLICATION, componentTypeId: EA_COMPONENT_TYPES.APPLICATION, label: 'Application' }
            ]
          }
        ]
      };

    case DIAGRAM_TYPE_IDS.CROSS_DOMAIN_TRACEABILITY:
      return {
        id: diagramTypeId,
        label: getDiagramTypeLabel(diagramTypeId),
        defaultLayoutStyle: 'flow-lr',
        palette: [
          {
            id: 'capabilities',
            label: 'Capabilities',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_CATEGORY, groupTypeId: EA_GROUP_TYPES.CAP_CATEGORY, label: 'Category / Department' },
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_CAPABILITY, groupTypeId: EA_GROUP_TYPES.CAP_CAPABILITY, label: 'Capability' },
              { kind: 'groupType', id: EA_GROUP_TYPES.CAP_SUBCAPABILITY, groupTypeId: EA_GROUP_TYPES.CAP_SUBCAPABILITY, label: 'Sub-Capability' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.BUSINESS_PROCESS, componentTypeId: EA_COMPONENT_TYPES.BUSINESS_PROCESS, label: 'Business Process' }
            ]
          },
          {
            id: 'applications',
            label: 'Applications',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.APP_CATEGORY, groupTypeId: EA_GROUP_TYPES.APP_CATEGORY, label: 'Category / Department' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.APPLICATION, componentTypeId: EA_COMPONENT_TYPES.APPLICATION, label: 'Application' }
            ]
          },
          {
            id: 'technology',
            label: 'Technology',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_LAYER_INFRA, groupTypeId: EA_GROUP_TYPES.TECH_LAYER_INFRA, label: 'Infrastructure Layer' },
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_LAYER_HOSTING, groupTypeId: EA_GROUP_TYPES.TECH_LAYER_HOSTING, label: 'Application Hosting & Ops' },
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_LAYER_PLATFORM, groupTypeId: EA_GROUP_TYPES.TECH_LAYER_PLATFORM, label: 'Platform Services' },
              { kind: 'groupType', id: EA_GROUP_TYPES.TECH_GROUP, groupTypeId: EA_GROUP_TYPES.TECH_GROUP, label: 'Layer Group' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.TECH_ELEMENT, componentTypeId: EA_COMPONENT_TYPES.TECH_ELEMENT, label: 'Technology Element' }
            ]
          },
          {
            id: 'programmes',
            label: 'Programmes',
            items: [
              { kind: 'groupType', id: EA_GROUP_TYPES.PROG_CATEGORY, groupTypeId: EA_GROUP_TYPES.PROG_CATEGORY, label: 'Category / Department' },
              { kind: 'groupType', id: EA_GROUP_TYPES.PROG_PROGRAMME, groupTypeId: EA_GROUP_TYPES.PROG_PROGRAMME, label: 'Programme' },
              { kind: 'componentType', id: EA_COMPONENT_TYPES.PROGRAMME_PROJECT, componentTypeId: EA_COMPONENT_TYPES.PROGRAMME_PROJECT, label: 'Project' }
            ]
          }
        ]
      };

    default:
      return null;
  }
}

export function resolveGuidedConnection({ diagramTypeId, nodes, sourceId, targetId }) {
  if (!diagramTypeId || !sourceId || !targetId) return null;
  const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));
  const sourceNode = nodeById.get(sourceId);
  const targetNode = nodeById.get(targetId);
  if (!sourceNode || !targetNode) return null;

  const sKind = sourceNode.type;
  const tKind = targetNode.type;

  const sGroupType = sourceNode.data?.kind === 'group' ? sourceNode.data?.groupTypeId : null;
  const tGroupType = targetNode.data?.kind === 'group' ? targetNode.data?.groupTypeId : null;
  const sCompType = sourceNode.data?.kind === 'component' ? sourceNode.data?.componentTypeId : null;
  const tCompType = targetNode.data?.kind === 'component' ? targetNode.data?.componentTypeId : null;

  const isProgramme = sKind === 'group' && sGroupType === EA_GROUP_TYPES.PROG_PROGRAMME;
  const isCapabilityGroup = tKind === 'group' && (tGroupType === EA_GROUP_TYPES.CAP_CAPABILITY || tGroupType === EA_GROUP_TYPES.CAP_SUBCAPABILITY);

  if (sKind === 'component' && sCompType === EA_COMPONENT_TYPES.BUSINESS_PROCESS && tKind === 'component' && tCompType === EA_COMPONENT_TYPES.APPLICATION) {
    return { edgeTypeId: EA_EDGE_TYPES.PROCESS_TO_APP, label: 'Process → Application' };
  }

  if (isProgramme && tKind === 'component' && tCompType === EA_COMPONENT_TYPES.APPLICATION) {
    return { edgeTypeId: EA_EDGE_TYPES.PROGRAMME_TO_APPLICATION, label: 'Programme → Application' };
  }

  if (isProgramme && isCapabilityGroup) {
    return { edgeTypeId: EA_EDGE_TYPES.PROGRAMME_TO_CAPABILITY, label: 'Programme → Capability' };
  }

  if (sKind === 'component' && sCompType === EA_COMPONENT_TYPES.APPLICATION && tKind === 'component' && tCompType === EA_COMPONENT_TYPES.TECH_ELEMENT) {
    return { edgeTypeId: EA_EDGE_TYPES.APPLICATION_TO_TECH, label: 'Application → Technology' };
  }

  // Cross-domain view supports the same guided connections.
  return null;
}

export function computeAllowedTargetIds({ diagramTypeId, nodes, sourceId }) {
  if (!diagramTypeId || !sourceId) return new Set();
  const allowed = new Set();
  for (const node of nodes ?? []) {
    if (!node?.id || node.id === sourceId) continue;
    const ok = resolveGuidedConnection({ diagramTypeId, nodes, sourceId, targetId: node.id });
    if (ok) allowed.add(node.id);
  }
  return allowed;
}

export function isConnectableGroupType(groupTypeId) {
  return groupTypeId === EA_GROUP_TYPES.CAP_CAPABILITY || groupTypeId === EA_GROUP_TYPES.CAP_SUBCAPABILITY || groupTypeId === EA_GROUP_TYPES.PROG_PROGRAMME;
}
