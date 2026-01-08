import componentTypesRegistry from './component-registry/component-types.v1.json';
import edgeTypesRegistry from './component-registry/edge-types.v1.json';
import groupTypesRegistry from './component-registry/group-types.v1.json';
import templatesRegistry from './component-registry/templates.v1.json';
import Ajv from 'ajv/dist/2020';

const ajv2020 = new Ajv({ allErrors: true, strict: false });

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
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

const SCHEMA_COMPONENT_TYPES_REGISTRY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['registryKind', 'registryVersion', 'componentTypes'],
  properties: {
    registryKind: { const: 'componentTypes' },
    registryVersion: { type: 'integer' },
    componentTypes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['typeId', 'displayName', 'category', 'iconKey', 'allowedParentTypes', 'allowedChildTypes', 'allowedEdgeTypes', 'requiredAttributes', 'version'],
        properties: {
          typeId: { type: 'string', minLength: 1 },
          displayName: { type: 'string', minLength: 1 },
          category: { type: 'string' },
          iconKey: { type: 'string' },
          allowedParentTypes: { type: 'array', items: { type: 'string' } },
          allowedChildTypes: { type: 'array', items: { type: 'string' } },
          allowedEdgeTypes: { type: 'array', items: { type: 'string' } },
          requiredAttributes: { type: 'object' },
          version: { type: 'number' }
        }
      }
    }
  }
};

const SCHEMA_GROUP_TYPES_REGISTRY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['registryKind', 'registryVersion', 'groupTypes'],
  properties: {
    registryKind: { const: 'groupTypes' },
    registryVersion: { type: 'integer' },
    groupTypes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['groupTypeId', 'displayName', 'allowedChildGroupTypes', 'allowedParentGroupTypes', 'allowedChildComponentTypes', 'version'],
        properties: {
          groupTypeId: { type: 'string', minLength: 1 },
          displayName: { type: 'string', minLength: 1 },
          allowedChildGroupTypes: { type: 'array', items: { type: 'string' } },
          allowedParentGroupTypes: { type: 'array', items: { type: 'string' } },
          allowedChildComponentTypes: { type: 'array', items: { type: 'string' } },
          version: { type: 'number' }
        }
      }
    }
  }
};

const SCHEMA_EDGE_TYPES_REGISTRY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['registryKind', 'registryVersion', 'edgeTypes'],
  properties: {
    registryKind: { const: 'edgeTypes' },
    registryVersion: { type: 'integer' },
    edgeTypes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['edgeTypeId', 'displayName', 'version'],
        properties: {
          edgeTypeId: { type: 'string', minLength: 1 },
          displayName: { type: 'string', minLength: 1 },
          version: { type: 'number' }
        }
      }
    }
  }
};

const SCHEMA_TEMPLATES_REGISTRY = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['registryKind', 'registryVersion', 'templates'],
  properties: {
    registryKind: { const: 'templates' },
    registryVersion: { type: 'integer' },
    templates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['templateId', 'displayName', 'version', 'nodes', 'edges'],
        properties: {
          templateId: { type: 'string', minLength: 1 },
          displayName: { type: 'string', minLength: 1 },
          version: { type: 'number' },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['localId', 'componentTypeId', 'attributes', 'position'],
              properties: {
                localId: { type: 'string', minLength: 1 },
                componentTypeId: { type: 'string', minLength: 1 },
                attributes: { type: 'object' },
                position: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['x', 'y'],
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' }
                  }
                }
              }
            }
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['localId', 'sourceLocalId', 'targetLocalId', 'edgeTypeId'],
              properties: {
                localId: { type: 'string', minLength: 1 },
                sourceLocalId: { type: 'string', minLength: 1 },
                targetLocalId: { type: 'string', minLength: 1 },
                edgeTypeId: { type: 'string', minLength: 1 }
              }
            }
          }
        }
      }
    }
  }
};

function validateRegistryFileOrThrow({ fileName, schema, data }) {
  const validate = ajv2020.compile(schema);
  const ok = validate(data);
  if (!ok) {
    const details = formatAjvErrors(validate.errors);
    const err = new Error(`Schema validation failed: ${details}`);
    err.fileName = fileName;
    err.validationErrors = validate.errors;
    throw err;
  }
}

let registryLoadPromise = null;

export async function loadRegistries() {
  if (registryLoadPromise) return registryLoadPromise;

  registryLoadPromise = (async () => {
    try {
      validateRegistryFileOrThrow({
        fileName: 'component-types.v1.json',
        schema: SCHEMA_COMPONENT_TYPES_REGISTRY,
        data: componentTypesRegistry
      });
      validateRegistryFileOrThrow({
        fileName: 'group-types.v1.json',
        schema: SCHEMA_GROUP_TYPES_REGISTRY,
        data: groupTypesRegistry
      });
      validateRegistryFileOrThrow({
        fileName: 'edge-types.v1.json',
        schema: SCHEMA_EDGE_TYPES_REGISTRY,
        data: edgeTypesRegistry
      });
      validateRegistryFileOrThrow({
        fileName: 'templates.v1.json',
        schema: SCHEMA_TEMPLATES_REGISTRY,
        data: templatesRegistry
      });

      const componentTypes = normalizeArray(componentTypesRegistry.componentTypes);
      if (componentTypes.length === 0) {
        const err = new Error('Component Type Registry missing or empty.');
        err.fileName = 'component-types.v1.json';
        throw err;
      }

      const edgeTypes = normalizeArray(edgeTypesRegistry?.edgeTypes);
      const groupTypes = normalizeArray(groupTypesRegistry?.groupTypes);
      const templates = normalizeArray(templatesRegistry?.templates);

      // Fail fast: attribute schemas must compile under draft 2020-12.
      for (const componentType of componentTypes) {
        const typeId = String(componentType?.typeId ?? '');
        const requiredAttributesSchema = componentType?.requiredAttributes;
        if (!requiredAttributesSchema) continue;
        if (typeof requiredAttributesSchema !== 'object') {
          const err = new Error(`Invalid requiredAttributes schema for component type ${typeId} (expected schema object).`);
          err.fileName = 'component-types.v1.json';
          throw err;
        }
        try {
          ajv2020.compile(requiredAttributesSchema);
        } catch (error) {
          const err = new Error(
            `Invalid requiredAttributes schema for component type ${typeId}: ${String(error?.message ?? error)}`
          );
          err.fileName = 'component-types.v1.json';
          throw err;
        }
      }

      const componentTypesById = new Map(componentTypes.map((t) => [t.typeId, t]));
      const edgeTypesById = new Map(edgeTypes.map((t) => [t.edgeTypeId, t]));
      const groupTypesById = new Map(groupTypes.map((t) => [t.groupTypeId, t]));
      const templatesById = new Map(templates.map((t) => [t.templateId, t]));

      const ready = {
        status: 'ready',
        registryVersion: componentTypesRegistry.registryVersion ?? 1,
        componentTypes,
        componentTypesById,
        edgeTypes,
        edgeTypesById,
        groupTypes,
        groupTypesById,
        templates,
        templatesById
      };

      if (import.meta.env.DEV) {
        console.info(`[registry] loaded component types: ${componentTypes.length}`);
      }

      return ready;
    } catch (error) {
      const fileName = String(error?.fileName ?? 'unknown');
      const message = String(error?.message ?? error);
      // Exactly one console error for registry loading failure.
      console.error(`[registry] failed to load ${fileName}: ${message}`);
      return {
        status: 'error',
        message: `Failed to load ${fileName}: ${message}`
      };
    }
  })();

  return registryLoadPromise;
}

// Backwards compatibility (legacy name used during early prototyping).
export async function loadStudioRegistry() {
  return loadRegistries();
}

export function getComponentType(registry, typeId) {
  if (!registry || registry.status !== 'ready' || !typeId) return null;
  return registry.componentTypesById?.get(typeId) ?? null;
}

export function getGroupType(registry, groupTypeId) {
  if (!registry || registry.status !== 'ready' || !groupTypeId) return null;
  return registry.groupTypesById?.get(groupTypeId) ?? null;
}

export function getEdgeType(registry, edgeTypeId) {
  if (!registry || registry.status !== 'ready' || !edgeTypeId) return null;
  return registry.edgeTypesById?.get(edgeTypeId) ?? null;
}

export function getTemplate(registry, templateId) {
  if (!registry || registry.status !== 'ready' || !templateId) return null;
  return registry.templatesById?.get(templateId) ?? null;
}
