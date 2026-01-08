import Ajv from 'ajv/dist/2020';

function nowIso() {
  return new Date().toISOString();
}

const ajv = new Ajv({ allErrors: true, strict: false });

export function compileAttributeValidator(schema) {
  if (!schema || typeof schema !== 'object') {
    return {
      validate: () => false,
      errors: () => [{ message: 'Missing schema.' }]
    };
  }

  const validate = ajv.compile(schema);
  return {
    validate: (value) => validate(value),
    errors: () => validate.errors ?? []
  };
}

export function computeComponentTitle(componentType, attributes) {
  const name = attributes?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return componentType?.displayName ?? 'Component';
}

function inferDefaultForSchemaProperty(propSchema) {
  if (!propSchema || typeof propSchema !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(propSchema, 'default')) return propSchema.default;
  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) return propSchema.enum[0];
  const t = propSchema.type;
  if (t === 'string') return '';
  if (t === 'number' || t === 'integer') return 0;
  if (t === 'boolean') return false;
  if (t === 'object') return {};
  if (t === 'array') return [];
  return null;
}

function buildDefaultAttributes(componentType) {
  const schema = componentType?.requiredAttributes;
  if (!schema || typeof schema !== 'object') return {};

  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const requiredKeys = Array.isArray(schema.required) ? schema.required : [];

  const out = {};

  // Apply explicit defaults first (even if not required).
  for (const [key, propSchema] of Object.entries(props)) {
    if (!propSchema || typeof propSchema !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(propSchema, 'default')) {
      out[key] = propSchema.default;
    }
  }

  // Ensure required fields exist.
  for (const key of requiredKeys) {
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;

    const propSchema = props[key];
    let value = inferDefaultForSchemaProperty(propSchema);

    // Make newly created nodes immediately valid for common "name" schemas.
    if ((key === 'name' || key === 'title') && (propSchema?.type === 'string' || typeof propSchema?.type !== 'string')) {
      if (typeof value !== 'string' || !value.trim()) {
        value = componentType?.displayName ?? 'Component';
      }
    }

    out[key] = value;
  }

  return out;
}

export function createComponentNode({ registry, componentTypeId, position }) {
  if (!registry || registry.status !== 'ready') throw new Error('Component Type Registry not loaded.');
  const componentType = registry.componentTypesById.get(componentTypeId);
  if (!componentType) throw new Error(`Unknown component type: ${componentTypeId}`);

  const createdAt = nowIso();
  const attributes = buildDefaultAttributes(componentType);

  const title = computeComponentTitle(componentType, attributes);

  return {
    id: `node-${crypto.randomUUID()}`,
    type: 'component',
    position: position ?? { x: 0, y: 0 },
    data: {
      kind: 'component',
      componentTypeId,
      componentTypeVersion: componentType.version,
      title,
      iconKey: componentType.iconKey ?? '',
      attributes,
      metadata: {
        createdAt,
        updatedAt: createdAt,
        version: 1
      }
    },
    width: 160,
    height: 92
  };
}

export function createGroupNode({ registry, groupTypeId, position }) {
  if (!registry || registry.status !== 'ready') throw new Error('Group Type Registry not loaded.');
  const groupType = registry.groupTypesById.get(groupTypeId);
  if (!groupType) throw new Error(`Unknown group type: ${groupTypeId}`);

  const createdAt = nowIso();

  return {
    id: `group-${crypto.randomUUID()}`,
    type: 'group',
    position: position ?? { x: 0, y: 0 },
    data: {
      kind: 'group',
      groupTypeId,
      groupTypeVersion: groupType.version,
      title: groupType.displayName ?? 'Group',
      attributes: {
        name: groupType.displayName ?? 'Group'
      },
      metadata: {
        createdAt,
        updatedAt: createdAt,
        version: 1
      }
    },
    width: 320,
    height: 200,
    style: {
      zIndex: 0
    }
  };
}

export function createRelationshipEdge({ edgeTypeId, edgeTypeVersion, source, target }) {
  const createdAt = nowIso();
  return {
    id: `edge-${crypto.randomUUID()}`,
    source,
    target,
    type: 'default',
    label: '',
    data: {
      kind: 'relationship',
      edgeTypeId,
      edgeTypeVersion,
      metadata: {
        createdAt,
        updatedAt: createdAt,
        version: 1
      }
    }
  };
}

export function normalizeNode(registry, node) {
  if (!node || typeof node !== 'object') return node;
  if (!registry || registry.status !== 'ready') return node;

  const data = node.data ?? {};

  if (node.type === 'component' && data.kind === 'component' && data.componentTypeId) {
    return {
      ...node,
      data: {
        ...data,
        attributes: data.attributes ?? {},
        metadata: {
          createdAt: data.metadata?.createdAt ?? nowIso(),
          updatedAt: data.metadata?.updatedAt ?? data.metadata?.createdAt ?? nowIso(),
          version: data.metadata?.version ?? 1,
          template: data.metadata?.template
        }
      }
    };
  }

  if (node.type === 'group' && data.kind === 'group' && data.groupTypeId) {
    return {
      ...node,
      data: {
        ...data,
        attributes: data.attributes ?? { name: data.title ?? 'Group' },
        metadata: {
          createdAt: data.metadata?.createdAt ?? nowIso(),
          updatedAt: data.metadata?.updatedAt ?? data.metadata?.createdAt ?? nowIso(),
          version: data.metadata?.version ?? 1,
          template: data.metadata?.template
        }
      }
    };
  }

  // Legacy migration from generic node
  const legacyTypeId = registry?.componentTypesById?.has('legacy.unknown') ? 'legacy.unknown' : null;
  const migratedTypeId = legacyTypeId ?? (registry?.componentTypes?.[0]?.typeId ?? 'legacy.unknown');
  const migratedType = registry?.componentTypesById?.get(migratedTypeId) ?? null;
  const migrated = {
    ...node,
    type: 'component',
    data: {
      kind: 'component',
      componentTypeId: migratedTypeId,
      componentTypeVersion: migratedType?.version,
      iconKey: data.iconKey ?? data.icon ?? 'LG',
      attributes: {
        name: data.attributes?.name ?? data.label ?? 'Legacy Component',
        description: data.attributes?.description ?? data.description ?? ''
      },
      metadata: {
        createdAt: data.metadata?.createdAt ?? nowIso(),
        updatedAt: data.metadata?.updatedAt ?? data.metadata?.createdAt ?? nowIso(),
        version: data.metadata?.version ?? 1
      }
    }
  };

  delete migrated.data.label;
  delete migrated.data.description;
  delete migrated.data.icon;
  delete migrated.data.style;

  return migrated;
}

export function normalizeEdge(edge) {
  if (!edge || typeof edge !== 'object') return edge;
  const data = edge.data ?? {};
  const createdAt = data.metadata?.createdAt ?? nowIso();
  return {
    ...edge,
    type: edge.type ?? 'default',
    data: {
      ...data,
      kind: data.kind ?? 'relationship',
      edgeTypeId: data.edgeTypeId ?? 'rel.dependsOn',
      edgeTypeVersion: data.edgeTypeVersion,
      metadata: {
        createdAt,
        updatedAt: data.metadata?.updatedAt ?? createdAt,
        version: data.metadata?.version ?? 1
      }
    }
  };
}

export function normalizeDiagram(registry, diagram) {
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : [];
  const edges = Array.isArray(diagram?.edges) ? diagram.edges : [];
  return {
    ...diagram,
    nodes: nodes.map((n) => normalizeNode(registry, n)),
    edges: edges.map((e) => normalizeEdge(e))
  };
}
