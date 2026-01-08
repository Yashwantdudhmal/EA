import { compileAttributeValidator } from './model.js';
import {
  DIAGRAM_TYPES,
  EA_COMPONENT_TYPES,
  EA_EDGE_TYPES,
  EA_GROUP_TYPES,
  computeAllowedTargetIds,
  isKnownDiagramType,
  resolveGuidedConnection
} from './diagramTypes.js';

function stableSortBy(arr, keyFn) {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

function formatAjvErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return 'Schema validation failed.';
  return errors
    .map((e) => {
      const path = e.instancePath || e.schemaPath || '';
      const msg = e.message || 'invalid';
      return path ? `${path}: ${msg}` : msg;
    })
    .join('; ');
}

function countChildrenByParentId(nodes) {
  const byParent = new Map();
  for (const node of nodes ?? []) {
    const parentId = node?.parentNode;
    if (!parentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(node);
  }
  return byParent;
}

function findTopLevelGroups(nodes, groupTypeId) {
  return (nodes ?? []).filter((n) => (n?.type === 'group' || n?.data?.kind === 'group') && n?.data?.groupTypeId === groupTypeId && !n?.parentNode);
}

export function validateDiagram({ registry, nodes, edges, diagramTypeId }) {
  const issues = [];

  function pushIssue(severity, payload) {
    issues.push({
      severity,
      ...payload
    });
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  const registryReady = registry?.status === 'ready';
  const registryFailed = registry?.status === 'error';
  if (registryFailed) {
    pushIssue('ERROR', {
      code: 'REGISTRY_MISSING',
      message: 'Component Type Registry is not loaded. Component creation is disabled.',
      target: { kind: 'diagram' }
    });
  }

  const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));
  const childrenByParentId = countChildrenByParentId(nodes);

  // Phase H: diagram type is mandatory.
  if (!diagramTypeId) {
    pushIssue('ERROR', {
      code: 'DIAGRAM_TYPE_MISSING',
      message: 'Diagram type is not set. Select a diagram type to enable modeling.',
      target: { kind: 'diagram' }
    });
  } else if (!isKnownDiagramType(diagramTypeId)) {
    pushIssue('ERROR', {
      code: 'DIAGRAM_TYPE_UNKNOWN',
      message: `Unknown diagram type: ${diagramTypeId}.`,
      target: { kind: 'diagram' }
    });
  }

  for (const node of nodes ?? []) {
    if (!node?.id) continue;
    const data = node.data ?? {};

    if (node.type === 'group' || data.kind === 'group') {
      const groupTypeId = data.groupTypeId;
      const groupType = registryReady ? registry?.groupTypesById?.get(groupTypeId) : null;
      if (!groupTypeId || !groupType) {
        pushIssue('ERROR', {
          code: 'GROUP_UNKNOWN_TYPE',
          message: groupTypeId ? `Unknown groupTypeId: ${groupTypeId}` : 'Group is missing groupTypeId.',
          target: { kind: 'node', id: node.id }
        });
      }

      if (groupTypeId && groupType) {
        const instanceVersion = data.groupTypeVersion;
        const registryVersion = groupType.version;
        if (instanceVersion === undefined || instanceVersion === null) {
          pushIssue('ERROR', {
            code: 'GROUP_TYPE_VERSION_MISSING',
            message: `Group is missing groupTypeVersion for ${groupType.displayName} (${groupTypeId}).`,
            target: { kind: 'node', id: node.id }
          });
        } else if (!isFiniteNumber(instanceVersion)) {
          pushIssue('ERROR', {
            code: 'GROUP_TYPE_VERSION_INVALID',
            message: `Group groupTypeVersion must be a number for ${groupTypeId}.`,
            target: { kind: 'node', id: node.id }
          });
        } else if (!isFiniteNumber(registryVersion)) {
          pushIssue('ERROR', {
            code: 'GROUP_TYPE_REGISTRY_VERSION_INVALID',
            message: `Registry group type ${groupTypeId} is missing a valid version number.`,
            target: { kind: 'diagram' }
          });
        } else if (instanceVersion !== registryVersion) {
          pushIssue('WARNING', {
            code: 'GROUP_TYPE_VERSION_MISMATCH',
            message: `Group type version mismatch for ${groupType.displayName} (${groupTypeId}): instance v${instanceVersion} is locked; registry is v${registryVersion}.`,
            target: { kind: 'node', id: node.id }
          });
        }
      }
      continue;
    }

    if (node.type !== 'component' || data.kind !== 'component') {
      pushIssue('ERROR', {
        code: 'NODE_UNTYPED',
        message: 'Node is not a typed component (missing kind/componentTypeId).',
        target: { kind: 'node', id: node.id }
      });
      continue;
    }

    const componentTypeId = data.componentTypeId;
    const componentType = registryReady ? registry?.componentTypesById?.get(componentTypeId) : null;
    if (!componentTypeId || !componentType) {
      pushIssue('ERROR', {
        code: 'COMPONENT_UNKNOWN_TYPE',
        message: componentTypeId ? `Unknown componentTypeId: ${componentTypeId}` : 'Component is missing componentTypeId.',
        target: { kind: 'node', id: node.id }
      });
      continue;
    }

    const instanceVersion = data.componentTypeVersion;
    const registryVersion = componentType.version;
    if (instanceVersion === undefined || instanceVersion === null) {
      pushIssue('ERROR', {
        code: 'COMPONENT_TYPE_VERSION_MISSING',
        message: `Component is missing componentTypeVersion for ${componentType.displayName} (${componentTypeId}).`,
        target: { kind: 'node', id: node.id }
      });
    } else if (!isFiniteNumber(instanceVersion)) {
      pushIssue('ERROR', {
        code: 'COMPONENT_TYPE_VERSION_INVALID',
        message: `Component componentTypeVersion must be a number for ${componentTypeId}.`,
        target: { kind: 'node', id: node.id }
      });
    } else if (!isFiniteNumber(registryVersion)) {
      pushIssue('ERROR', {
        code: 'COMPONENT_TYPE_REGISTRY_VERSION_INVALID',
        message: `Registry component type ${componentTypeId} is missing a valid version number.`,
        target: { kind: 'diagram' }
      });
    } else if (instanceVersion !== registryVersion) {
      pushIssue('WARNING', {
        code: 'COMPONENT_TYPE_VERSION_MISMATCH',
        message: `Component type version mismatch for ${componentType.displayName} (${componentTypeId}): instance v${instanceVersion} is locked; registry is v${registryVersion}.`,
        target: { kind: 'node', id: node.id }
      });
    }

    const validator = compileAttributeValidator(componentType.requiredAttributes);
    const ok = validator.validate(data.attributes ?? {});
    if (!ok) {
      pushIssue('ERROR', {
        code: 'COMPONENT_ATTRIBUTES_INVALID',
        message: `Invalid attributes for ${componentType.displayName}: ${formatAjvErrors(validator.errors())}`,
        target: { kind: 'node', id: node.id }
      });
    }
  }

  // Nesting rules (group containment)
  for (const node of nodes ?? []) {
    if (!node?.id) continue;
    const parentId = node.parentNode;
    if (!parentId) continue;

    const parent = nodeById.get(parentId);
    if (!parent) {
      pushIssue('ERROR', {
        code: 'GROUP_MISSING_PARENT',
        message: `Node references missing parent group: ${parentId}`,
        target: { kind: 'node', id: node.id }
      });
      continue;
    }

    const parentData = parent.data ?? {};
    if (parent.type !== 'group' || parentData.kind !== 'group') {
      pushIssue('ERROR', {
        code: 'GROUP_INVALID_PARENT',
        message: 'Nodes can only be nested within groups.',
        target: { kind: 'node', id: node.id }
      });
      continue;
    }

    const parentGroupType = registryReady ? registry?.groupTypesById?.get(parentData.groupTypeId) : null;
    if (!parentGroupType) continue;

    const data = node.data ?? {};
    if (node.type === 'group' || data.kind === 'group') {
      const childGroupType = registryReady ? registry?.groupTypesById?.get(data.groupTypeId) : null;
      const allowedByParent = (parentGroupType.allowedChildGroupTypes ?? []).includes(data.groupTypeId);
      const allowedByChild = childGroupType ? (childGroupType.allowedParentGroupTypes ?? []).includes(parentData.groupTypeId) : false;
      if (!allowedByParent || !allowedByChild) {
        pushIssue('ERROR', {
          code: 'GROUP_NESTING_INVALID',
          message: `Invalid group nesting: ${parentGroupType.displayName} cannot contain ${childGroupType?.displayName ?? data.groupTypeId}.`,
          target: { kind: 'node', id: node.id }
        });
      }
      continue;
    }

    const componentTypeId = data.componentTypeId;
    if (!componentTypeId) continue;
    const allowed = (parentGroupType.allowedChildComponentTypes ?? []).includes(componentTypeId);
    if (!allowed) {
      pushIssue('ERROR', {
        code: 'GROUP_CHILD_TYPE_INVALID',
        message: `Invalid nesting: ${parentGroupType.displayName} cannot contain component type ${componentTypeId}.`,
        target: { kind: 'node', id: node.id }
      });
    }
  }

  // Phase H: structural semantics and cardinalities.
  if (diagramTypeId && isKnownDiagramType(diagramTypeId)) {
    // Capability structure must be nested (not loose) when using those types.
    for (const node of nodes ?? []) {
      if (!node?.id) continue;
      const isGroup = node.type === 'group' || node.data?.kind === 'group';
      const groupTypeId = isGroup ? node.data?.groupTypeId : null;
      const compTypeId = !isGroup ? node.data?.componentTypeId : null;

      if (groupTypeId === EA_GROUP_TYPES.CAP_CATEGORY && node.parentNode) {
        pushIssue('ERROR', {
          code: 'CAP_CATEGORY_PARENT_INVALID',
          message: 'Category / Department must be top-level (cannot be nested).',
          target: { kind: 'node', id: node.id }
        });
      }

      if (groupTypeId === EA_GROUP_TYPES.CAP_CAPABILITY) {
        const parent = node.parentNode ? nodeById.get(node.parentNode) : null;
        if (!parent || parent.data?.groupTypeId !== EA_GROUP_TYPES.CAP_CATEGORY) {
          pushIssue('ERROR', {
            code: 'CAPABILITY_PARENT_INVALID',
            message: 'Capability must be nested under a Category / Department.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (groupTypeId === EA_GROUP_TYPES.CAP_SUBCAPABILITY) {
        const parent = node.parentNode ? nodeById.get(node.parentNode) : null;
        if (!parent || parent.data?.groupTypeId !== EA_GROUP_TYPES.CAP_CAPABILITY) {
          pushIssue('ERROR', {
            code: 'SUBCAPABILITY_PARENT_INVALID',
            message: 'Sub-Capability must be nested under a Capability.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (compTypeId === EA_COMPONENT_TYPES.BUSINESS_PROCESS) {
        const parent = node.parentNode ? nodeById.get(node.parentNode) : null;
        if (!parent || parent.data?.groupTypeId !== EA_GROUP_TYPES.CAP_SUBCAPABILITY) {
          pushIssue('ERROR', {
            code: 'BUSINESS_PROCESS_PARENT_INVALID',
            message: 'Business Process must be nested under a Sub-Capability.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (groupTypeId === EA_GROUP_TYPES.APP_CATEGORY && node.parentNode) {
        pushIssue('ERROR', {
          code: 'APP_CATEGORY_PARENT_INVALID',
          message: 'Application Category / Department must be top-level (cannot be nested).',
          target: { kind: 'node', id: node.id }
        });
      }

      if (compTypeId === EA_COMPONENT_TYPES.APPLICATION) {
        // In Application Landscape diagrams, applications must be nested under an application category.
        if (diagramTypeId === 'application-landscape') {
          const parent = node.parentNode ? nodeById.get(node.parentNode) : null;
          if (!parent || parent.data?.groupTypeId !== EA_GROUP_TYPES.APP_CATEGORY) {
            pushIssue('ERROR', {
              code: 'APPLICATION_PARENT_INVALID',
              message: 'Applications must be nested under a Category / Department in Application Landscape diagrams.',
              target: { kind: 'node', id: node.id }
            });
          }
        }
      }

      if (groupTypeId === EA_GROUP_TYPES.PROG_CATEGORY && node.parentNode) {
        pushIssue('ERROR', {
          code: 'PROG_CATEGORY_PARENT_INVALID',
          message: 'Programme Category / Department must be top-level (cannot be nested).',
          target: { kind: 'node', id: node.id }
        });
      }

      if (groupTypeId === EA_GROUP_TYPES.PROG_PROGRAMME) {
        const parent = node.parentNode ? nodeById.get(node.parentNode) : null;
        if (!parent || parent.data?.groupTypeId !== EA_GROUP_TYPES.PROG_CATEGORY) {
          pushIssue('ERROR', {
            code: 'PROGRAMME_PARENT_INVALID',
            message: 'Programme must be nested under a Category / Department.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (compTypeId === EA_COMPONENT_TYPES.PROGRAMME_PROJECT) {
        const parent = node.parentNode ? nodeById.get(node.parentNode) : null;
        if (!parent || parent.data?.groupTypeId !== EA_GROUP_TYPES.PROG_PROGRAMME) {
          pushIssue('ERROR', {
            code: 'PROJECT_PARENT_INVALID',
            message: 'Project must be nested under a Programme.',
            target: { kind: 'node', id: node.id }
          });
        }
      }
    }

    // Cardinality rules for capability map.
    for (const node of nodes ?? []) {
      if (!node?.id) continue;
      if (node.type !== 'group' && node.data?.kind !== 'group') continue;
      const groupTypeId = node.data?.groupTypeId;
      const children = childrenByParentId.get(node.id) ?? [];

      if (groupTypeId === EA_GROUP_TYPES.CAP_CATEGORY) {
        const capCount = children.filter((c) => (c.type === 'group' || c.data?.kind === 'group') && c.data?.groupTypeId === EA_GROUP_TYPES.CAP_CAPABILITY).length;
        if (capCount > 5) {
          pushIssue('ERROR', {
            code: 'CAP_CATEGORY_MAX_CHILDREN',
            message: 'Category / Department can contain at most 5 Capabilities.',
            target: { kind: 'node', id: node.id }
          });
        } else if (capCount === 0) {
          pushIssue('WARNING', {
            code: 'CAP_CATEGORY_MIN_CHILDREN',
            message: 'Category / Department has no Capabilities. Add at least 1.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (groupTypeId === EA_GROUP_TYPES.CAP_CAPABILITY) {
        const subCount = children.filter((c) => (c.type === 'group' || c.data?.kind === 'group') && c.data?.groupTypeId === EA_GROUP_TYPES.CAP_SUBCAPABILITY).length;
        if (subCount > 3) {
          pushIssue('ERROR', {
            code: 'CAPABILITY_MAX_CHILDREN',
            message: 'Capability can contain at most 3 Sub-Capabilities.',
            target: { kind: 'node', id: node.id }
          });
        } else if (subCount === 0) {
          pushIssue('WARNING', {
            code: 'CAPABILITY_MIN_CHILDREN',
            message: 'Capability has no Sub-Capabilities. Add at least 1.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (groupTypeId === EA_GROUP_TYPES.CAP_SUBCAPABILITY) {
        const procCount = children.filter((c) => c.type === 'component' && c.data?.kind === 'component' && c.data?.componentTypeId === EA_COMPONENT_TYPES.BUSINESS_PROCESS).length;
        if (procCount > 2) {
          pushIssue('ERROR', {
            code: 'SUBCAPABILITY_MAX_CHILDREN',
            message: 'Sub-Capability can contain at most 2 Business Processes.',
            target: { kind: 'node', id: node.id }
          });
        } else if (procCount === 0) {
          pushIssue('WARNING', {
            code: 'SUBCAPABILITY_MIN_CHILDREN',
            message: 'Sub-Capability has no Business Processes. Add at least 1.',
            target: { kind: 'node', id: node.id }
          });
        }
      }

      if (groupTypeId === EA_GROUP_TYPES.PROG_PROGRAMME) {
        const projectCount = children.filter((c) => c.type === 'component' && c.data?.kind === 'component' && c.data?.componentTypeId === EA_COMPONENT_TYPES.PROGRAMME_PROJECT).length;
        if (projectCount > 3) {
          pushIssue('ERROR', {
            code: 'PROGRAMME_MAX_PROJECTS',
            message: 'Programme can contain at most 3 Projects.',
            target: { kind: 'node', id: node.id }
          });
        }
      }
    }

    // Technology Architecture: enforce the 3 fixed layers exist (as top-level swimlanes).
    if (diagramTypeId === 'technology-architecture') {
      const infra = findTopLevelGroups(nodes, EA_GROUP_TYPES.TECH_LAYER_INFRA);
      const hosting = findTopLevelGroups(nodes, EA_GROUP_TYPES.TECH_LAYER_HOSTING);
      const platform = findTopLevelGroups(nodes, EA_GROUP_TYPES.TECH_LAYER_PLATFORM);
      if (infra.length !== 1 || hosting.length !== 1 || platform.length !== 1) {
        pushIssue('ERROR', {
          code: 'TECH_LAYERS_MISSING',
          message: 'Technology Architecture must contain exactly 3 top-level layers: Infrastructure, Application Hosting & Ops, Platform Services.',
          target: { kind: 'diagram' }
        });
      }

      // Max 3 elements per level (lane direct + group direct).
      for (const laneId of [EA_GROUP_TYPES.TECH_LAYER_INFRA, EA_GROUP_TYPES.TECH_LAYER_HOSTING, EA_GROUP_TYPES.TECH_LAYER_PLATFORM]) {
        for (const lane of findTopLevelGroups(nodes, laneId)) {
          const laneChildren = childrenByParentId.get(lane.id) ?? [];
          const directElements = laneChildren.filter((c) => c.type === 'component' && c.data?.componentTypeId === EA_COMPONENT_TYPES.TECH_ELEMENT).length;
          const directGroups = laneChildren.filter((c) => (c.type === 'group' || c.data?.kind === 'group') && c.data?.groupTypeId === EA_GROUP_TYPES.TECH_GROUP).length;
          if (directElements > 3) {
            pushIssue('ERROR', {
              code: 'TECH_LANE_MAX_ELEMENTS',
              message: 'Each technology layer can contain at most 3 elements at the top level.',
              target: { kind: 'node', id: lane.id }
            });
          }
          if (directGroups > 3) {
            pushIssue('ERROR', {
              code: 'TECH_LANE_MAX_GROUPS',
              message: 'Each technology layer can contain at most 3 groups at the top level.',
              target: { kind: 'node', id: lane.id }
            });
          }
        }
      }
    }
  }

  // Edge compatibility
  for (const edge of edges ?? []) {
    if (!edge?.id) continue;

    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);

    if (!source || !target) {
      pushIssue('ERROR', {
        code: 'EDGE_MISSING_ENDPOINT',
        message: 'Edge references missing source or target node.',
        target: { kind: 'edge', id: edge.id }
      });
      continue;
    }

    const sData = source.data ?? {};
    const tData = target.data ?? {};

    const sIsComponent = source.type === 'component' && sData.kind === 'component';
    const tIsComponent = target.type === 'component' && tData.kind === 'component';
    const sIsGroup = (source.type === 'group' || sData.kind === 'group') && Boolean(sData.groupTypeId);
    const tIsGroup = (target.type === 'group' || tData.kind === 'group') && Boolean(tData.groupTypeId);

    if (!sIsComponent && !sIsGroup) {
      pushIssue('ERROR', {
        code: 'EDGE_SOURCE_INVALID',
        message: 'Edge source must be a typed component or a supported semantic group.',
        target: { kind: 'edge', id: edge.id }
      });
      continue;
    }
    if (!tIsComponent && !tIsGroup) {
      pushIssue('ERROR', {
        code: 'EDGE_TARGET_INVALID',
        message: 'Edge target must be a typed component or a supported semantic group.',
        target: { kind: 'edge', id: edge.id }
      });
      continue;
    }

    const edgeTypeId = edge.data?.edgeTypeId;
    if (!edgeTypeId) {
      pushIssue('ERROR', {
        code: 'EDGE_TYPE_ID_MISSING',
        message: 'Edge is missing edgeTypeId.',
        target: { kind: 'edge', id: edge.id }
      });
      continue;
    }

    const edgeType = registryReady ? registry?.edgeTypesById?.get(edgeTypeId) : null;
    if (!edgeType) {
      pushIssue('ERROR', {
        code: 'EDGE_TYPE_UNKNOWN',
        message: `Unknown edgeTypeId (not in registry): ${edgeTypeId}.`,
        target: { kind: 'edge', id: edge.id }
      });
      continue;
    }

    const edgeTypeVersion = edge.data?.edgeTypeVersion;
    if (edgeTypeVersion === undefined || edgeTypeVersion === null) {
      pushIssue('ERROR', {
        code: 'EDGE_TYPE_VERSION_MISSING',
        message: `Edge is missing edgeTypeVersion for ${edgeTypeId}.`,
        target: { kind: 'edge', id: edge.id }
      });
    } else if (!isFiniteNumber(edgeTypeVersion)) {
      pushIssue('ERROR', {
        code: 'EDGE_TYPE_VERSION_INVALID',
        message: `Edge edgeTypeVersion must be a number for ${edgeTypeId}.`,
        target: { kind: 'edge', id: edge.id }
      });
    } else if (!isFiniteNumber(edgeType.version)) {
      pushIssue('ERROR', {
        code: 'EDGE_TYPE_REGISTRY_VERSION_INVALID',
        message: `Registry edge type ${edgeTypeId} is missing a valid version number.`,
        target: { kind: 'diagram' }
      });
    } else if (edgeTypeVersion !== edgeType.version) {
      pushIssue('WARNING', {
        code: 'EDGE_TYPE_VERSION_MISMATCH',
        message: `Edge type version mismatch for ${edgeTypeId}: instance v${edgeTypeVersion} is locked; registry is v${edgeType.version}.`,
        target: { kind: 'edge', id: edge.id }
      });
    }

    // Phase H: guided edges are validated semantically.
    const guided = resolveGuidedConnection({ diagramTypeId, nodes, sourceId: edge.source, targetId: edge.target });
    const isGuidedType = Object.values(EA_EDGE_TYPES).includes(edgeTypeId);

    if (isGuidedType) {
      if (!guided || guided.edgeTypeId !== edgeTypeId) {
        pushIssue('ERROR', {
          code: 'GUIDED_EDGE_INVALID',
          message: 'This relationship is not valid for the selected endpoints in this diagram type.',
          target: { kind: 'edge', id: edge.id }
        });
      }

      // Technology Architecture: cross-layer edges only.
      if (diagramTypeId === 'technology-architecture' && edgeTypeId === EA_EDGE_TYPES.APPLICATION_TO_TECH) {
        const targetAncestors = [];
        let cur = target;
        while (cur?.parentNode) {
          const p = nodeById.get(cur.parentNode);
          if (!p) break;
          targetAncestors.push(p);
          cur = p;
        }
        const targetLane = targetAncestors.find((n) => n.data?.groupTypeId?.startsWith('tech.layer.'));
        if (!targetLane) {
          pushIssue('ERROR', {
            code: 'TECH_EDGE_TARGET_NOT_IN_LANE',
            message: 'Application → Technology edges must target a Technology Element placed inside a technology layer swimlane.',
            target: { kind: 'edge', id: edge.id }
          });
        }
      }
      continue;
    }

    // Back-compat / generic edges: preserve old compatibility logic.
    if (!sIsComponent || !tIsComponent) {
      pushIssue('ERROR', {
        code: 'EDGE_ENDPOINT_NOT_COMPONENT',
        message: 'Legacy edges can only connect typed components (not groups).',
        target: { kind: 'edge', id: edge.id }
      });
      continue;
    }

    const sType = registry?.componentTypesById?.get(sData.componentTypeId);
    const tType = registry?.componentTypesById?.get(tData.componentTypeId);
    if (!sType || !tType) continue;

    const allowedEdgeBySource = (sType.allowedEdgeTypes ?? []).includes(edgeTypeId);
    const allowedEdgeByTarget = (tType.allowedEdgeTypes ?? []).includes(edgeTypeId);
    if (!allowedEdgeBySource || !allowedEdgeByTarget) {
      pushIssue('ERROR', {
        code: 'EDGE_TYPE_NOT_ALLOWED',
        message: `Edge type ${edgeTypeId} is not allowed between ${sType.displayName} and ${tType.displayName}.`,
        target: { kind: 'edge', id: edge.id }
      });
    }

    const allowedChild = (sType.allowedChildTypes ?? []).includes(tType.typeId);
    const allowedParent = (tType.allowedParentTypes ?? []).includes(sType.typeId);
    if ((sType.allowedChildTypes ?? []).length || (tType.allowedParentTypes ?? []).length) {
      if (!allowedChild || !allowedParent) {
        pushIssue('ERROR', {
          code: 'EDGE_ENDPOINTS_INCOMPATIBLE',
          message: `Invalid relationship: ${sType.displayName} cannot connect to ${tType.displayName}.`,
          target: { kind: 'edge', id: edge.id }
        });
      }
    }
  }

  // Phase H: missing mandatory links (warnings only).
  if (diagramTypeId === 'programme-portfolio') {
    for (const node of nodes ?? []) {
      if (!node?.id) continue;
      if (node.type !== 'group' || node.data?.groupTypeId !== EA_GROUP_TYPES.PROG_PROGRAMME) continue;
      const outgoing = (edges ?? []).filter((e) => e?.source === node.id);
      const hasRequired = outgoing.some((e) => e?.data?.edgeTypeId === EA_EDGE_TYPES.PROGRAMME_TO_APPLICATION || e?.data?.edgeTypeId === EA_EDGE_TYPES.PROGRAMME_TO_CAPABILITY);
      if (!hasRequired) {
        pushIssue('WARNING', {
          code: 'PROGRAMME_MISSING_TARGETS',
          message: 'Programme has no links to Capabilities or Applications. Add at least one to make it meaningful.',
          target: { kind: 'node', id: node.id }
        });
      }
    }
  }

  if (diagramTypeId === 'cross-domain-traceability') {
    for (const node of nodes ?? []) {
      if (!node?.id) continue;
      if (node.type !== 'component' || node.data?.componentTypeId !== EA_COMPONENT_TYPES.APPLICATION) continue;
      const attached = (edges ?? []).filter((e) => e?.source === node.id || e?.target === node.id);
      if (!attached.length) {
        pushIssue('WARNING', {
          code: 'APPLICATION_UNLINKED',
          message: 'Application has no relationships. In traceability views, link Applications to Business Processes and/or Technology.',
          target: { kind: 'node', id: node.id }
        });
      }
    }
  }

  const severityRank = { ERROR: 0, WARNING: 1, INFO: 2 };
  const sorted = stableSortBy(issues, (e) => {
    const rank = severityRank[e.severity] ?? 9;
    return `${e.target?.kind ?? 'z'}:${e.target?.id ?? ''}:${rank}:${e.code}`;
  });
  return sorted;
}
