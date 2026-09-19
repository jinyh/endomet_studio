// Runtime contract for versioned teaching assets; no network/model dependency.
export const schematicAssetPaths = Object.freeze({
  glucose:'./assets/glucose-schematic.json',
  thyroid:'./assets/thyroid-schematic.json',
});

const text = value => typeof value === 'string' && value.trim().length > 0;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const safeUri = value => text(value) && !/^(?:javascript|data|file):/i.test(value) && !value.includes('..');
const unique = (items,key,errors,path) => {
  const ids = new Set();
  items.forEach((item,index) => {
    if (!object(item) || !text(item[key])) errors.push(`${path}[${index}].${key} is required`);
    else if (ids.has(item[key])) errors.push(`${path}: duplicate ${key} ${item[key]}`);
    else ids.add(item[key]);
  });
  return ids;
};

/** Validate shape and cross references. Errors are paths/messages, never throws. */
export function validateAssetManifest(manifest) {
  const errors = [];
  if (!object(manifest)) return {valid:false,errors:['manifest must be an object']};
  const m = manifest;
  const allowed = ['assetId','version','system','representation','source','review','coordinates','lods','labels','materials','cameraAnchors','collisionUri','animations','geometry','highlight'];
  Object.keys(m).forEach(key => { if (!allowed.includes(key)) errors.push(`unknown property ${key}`); });
  if (!/^[a-z][a-z0-9-]+$/.test(m.assetId ?? '')) errors.push('assetId must be a stable lowercase id');
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) errors.push('version must be semantic x.y.z');
  if (!text(m.system)) errors.push('system is required');
  if (!['schematic','anatomical','cellular','molecular'].includes(m.representation)) errors.push('representation is invalid');
  for (const key of ['origin','license','attribution']) if (!text(m.source?.[key])) errors.push(`source.${key} is required`);
  if (!['procedural','model-file'].includes(m.source?.creationMethod)) errors.push('source.creationMethod is required');
  if (!['draft','pending','approved'].includes(m.review?.status)) errors.push('review.status is invalid');
  if (!['mechanism-illustration','anatomy','cellular','molecular'].includes(m.review?.scope)) errors.push('review.scope is required');
  if (m.review?.status === 'approved' && (!text(m.review.reviewer) || !/^\d{4}-\d{2}-\d{2}$/.test(m.review.reviewedAt ?? ''))) errors.push('approved review requires reviewer and reviewedAt');
  if (!['m','mm','um','nm','schematic'].includes(m.coordinates?.unit)) errors.push('coordinates.unit is invalid');
  if (!['Y','Z'].includes(m.coordinates?.upAxis)) errors.push('coordinates.upAxis is invalid');
  if (!['right','left'].includes(m.coordinates?.handedness)) errors.push('coordinates.handedness is invalid');
  for (const key of ['lods','labels','materials','cameraAnchors']) if (!Array.isArray(m[key])) errors.push(`${key} must be an array`);
  const labels = Array.isArray(m.labels) ? m.labels : [];
  const materials = Array.isArray(m.materials) ? m.materials : [];
  const cameras = Array.isArray(m.cameraAnchors) ? m.cameraAnchors : [];
  const lods = Array.isArray(m.lods) ? m.lods : [];
  if (!labels.length) errors.push('labels cannot be empty');
  if (!materials.length) errors.push('materials cannot be empty');
  if (!cameras.length) errors.push('cameraAnchors cannot be empty');
  const labelIds = unique(labels,'structureId',errors,'labels');
  const slots = unique(materials,'slot',errors,'materials');
  unique(cameras,'id',errors,'cameraAnchors');
  const labelMap = new Map(labels.filter(object).map(l => [l.structureId,l]));
  labels.forEach((label,i) => {
    if (!object(label)) return;
    if (!text(label.name)) errors.push(`labels[${i}].name is required`);
    if (!vector(label.anchor)) errors.push(`labels[${i}].anchor must be a finite vector`);
    if (label.parentId != null && !labelIds.has(label.parentId)) errors.push(`labels[${i}].parentId references unknown structure`);
    const visited = new Set([label.structureId]);
    let parent = label.parentId;
    while (parent != null && labelMap.has(parent)) {
      if (visited.has(parent)) { errors.push(`labels[${i}].parentId contains a cycle`); break; }
      visited.add(parent); parent = labelMap.get(parent).parentId;
    }
  });
  materials.forEach((material,i) => {
    if (!object(material)) return;
    if (!text(material.preset)) errors.push(`materials[${i}].preset is required`);
    if (material.textureUris !== undefined && (!Array.isArray(material.textureUris) || !material.textureUris.every(safeUri))) errors.push(`materials[${i}].textureUris is invalid`);
  });
  cameras.forEach((camera,i) => {
    if (!object(camera)) return;
    if (camera.structureId !== null && !labelIds.has(camera.structureId)) errors.push(`cameraAnchors[${i}].structureId references unknown structure`);
    if (camera.structureId === null && camera.id !== 'overview') errors.push(`cameraAnchors[${i}]: only overview may target the whole scene`);
    if (!vector(camera.position) || !vector(camera.target)) errors.push(`cameraAnchors[${i}] requires finite position and target vectors`);
    else if (camera.position.every((v,k) => v === camera.target[k])) errors.push(`cameraAnchors[${i}] position and target cannot coincide`);
  });
  const levels = new Set();
  lods.forEach((lod,i) => {
    if (!object(lod) || !Number.isInteger(lod.level) || lod.level < 0 || !Number.isInteger(lod.triangleCount) || lod.triangleCount < 0 || !safeUri(lod.uri)) errors.push(`lods[${i}] is invalid`);
    else if (levels.has(lod.level)) errors.push(`lods[${i}]: duplicate level`);
    else levels.add(lod.level);
  });
  if (m.collisionUri !== undefined && !safeUri(m.collisionUri)) errors.push('collisionUri is invalid');
  if (m.animations !== undefined) {
    if (!Array.isArray(m.animations)) errors.push('animations must be an array');
    else { unique(m.animations,'id',errors,'animations'); m.animations.forEach((a,i) => { if (!safeUri(a?.uri) || !text(a?.mechanismEvent)) errors.push(`animations[${i}] is invalid`); }); }
  }
  if (m.source?.creationMethod === 'procedural' && m.representation !== 'schematic') errors.push('procedural geometry must be declared schematic, never anatomical');
  if (m.representation === 'schematic') {
    if (m.source?.creationMethod !== 'procedural') errors.push('schematic source must declare procedural creation');
    if (m.coordinates?.unit !== 'schematic' || m.coordinates?.upAxis !== 'Y' || m.coordinates?.handedness !== 'right') errors.push('schematic coordinates must use schematic units, Y up, right handed');
    if (m.review?.scope !== 'mechanism-illustration') errors.push('schematic assets cannot claim anatomical review scope');
    if (lods.length) errors.push('procedural schematic assets use geometry, not external GLB/LOD files');
    if (m.geometry?.kind !== 'procedural-mechanism' || !text(m.geometry?.description)) errors.push('geometry must explicitly describe procedural mechanism illustration');
    const nodes = Array.isArray(m.geometry?.nodes) ? m.geometry.nodes : [];
    const edges = Array.isArray(m.geometry?.edges) ? m.geometry.edges : [];
    if (!nodes.length) errors.push('geometry.nodes cannot be empty');
    if (!Array.isArray(m.geometry?.edges)) errors.push('geometry.edges must be an array');
    const nodeIds = unique(nodes,'structureId',errors,'geometry.nodes');
    nodes.forEach((node,i) => {
      if (!object(node)) return;
      if (!labelIds.has(node.structureId)) errors.push(`geometry.nodes[${i}].structureId references unknown label`);
      if (!slots.has(node.materialSlot)) errors.push(`geometry.nodes[${i}].materialSlot references unknown material`);
      if (!text(node.metricKey)) errors.push(`geometry.nodes[${i}].metricKey is required`);
      if (node.primitive !== 'icosahedron' || !Number.isFinite(node.radius) || node.radius <= 0 || node.radius > 1 || !Number.isInteger(node.detail) || node.detail < 0 || node.detail > 3) errors.push(`geometry.nodes[${i}] has unsupported or excessive primitive geometry`);
    });
    for (const id of labelIds) if (!nodeIds.has(id)) errors.push(`label ${id} has no geometry node`);
    edges.forEach((edge,i) => { if (!object(edge) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to) || !['+','−'].includes(edge.sign)) errors.push(`geometry.edges[${i}] has invalid node reference or sign`); });
    if (!cameras.some(c => c?.id === 'overview' && c.structureId === null)) errors.push('cameraAnchors requires an overview');
    for (const id of nodeIds) if (!cameras.some(c => c?.structureId === id)) errors.push(`node ${id} has no camera anchor`);
    materials.forEach((mat,i) => {
      if (!object(mat)) return;
      if (!['signal','tissueSchematic'].includes(mat.preset) || !color(mat.color)) errors.push(`materials[${i}] requires a supported preset and hex color`);
      if (!Array.isArray(mat.structureIds) || !mat.structureIds.length || mat.structureIds.some(id => !nodeIds.has(id))) errors.push(`materials[${i}].structureIds has invalid references`);
      if (Object.keys(mat).some(key => /emissive|highlight/i.test(key))) errors.push(`materials[${i}]: activity highlight must be separate from surface material`);
    });
    nodes.forEach(node => {
      if (!object(node)) return;
      const ids = materials.find(mat => mat?.slot === node.materialSlot)?.structureIds;
      if (!Array.isArray(ids) || !ids.includes(node.structureId)) errors.push(`node ${node.structureId} material binding disagrees with structureIds`);
    });
    for (const key of ['selectionEmissive','baselineEmissive','activityGain','ringScale']) if (!Number.isFinite(m.highlight?.[key]) || m.highlight[key] < 0 || m.highlight[key] > 2) errors.push(`highlight.${key} must be between 0 and 2`);
  } else {
    if (!lods.length) errors.push('non-schematic assets require a model LOD');
    if (m.coordinates?.unit === 'schematic' || m.geometry?.kind === 'procedural-mechanism') errors.push('schematic geometry cannot be presented as a non-schematic asset');
    if (m.representation === 'anatomical' && m.review?.scope !== 'anatomy') errors.push('anatomical assets require anatomy review scope');
  }
  return {valid:errors.length === 0,errors};
}

/** Resolve a validated manifest into the existing renderer's tuple format. */
export function resolveSchematicAsset(manifest,module) {
  const result = validateAssetManifest(manifest);
  if (!result.valid) throw new Error(`Invalid asset manifest: ${result.errors.join('; ')}`);
  if (manifest.representation !== 'schematic') throw new Error('Only procedural schematic assets are supported by this renderer');
  if (!module || manifest.system !== module.id) throw new Error('Asset system does not match module');
  const nodes = manifest.geometry.nodes.map(node => {
    const label = manifest.labels.find(label => label.structureId === node.structureId);
    return [node.structureId,label.name,...label.anchor,node.metricKey];
  });
  const edges = manifest.geometry.edges.map(edge => [edge.from,edge.to,edge.sign]);
  const sort = list => list.map(item => JSON.stringify(item)).sort();
  if (JSON.stringify(sort(nodes)) !== JSON.stringify(sort(module.nodes)) || JSON.stringify(sort(edges)) !== JSON.stringify(sort(module.edges))) throw new Error('Asset labels, coordinates, metrics or edges do not match module data');
  // Return independent data so runtime changes cannot mutate the source manifest.
  return JSON.parse(JSON.stringify({nodes,edges,cameraAnchors:manifest.cameraAnchors,materials:manifest.materials,geometry:manifest.geometry,highlight:manifest.highlight,manifest}));
}

/** Unsupported modules intentionally retain the existing renderer fallback. */
export async function loadSchematicAsset(module,{fetchImpl=globalThis.fetch}={}) {
  const path = schematicAssetPaths[module.id];
  if (!path) return null;
  const response = await fetchImpl(new URL(path,import.meta.url));
  if (!response.ok) throw new Error(`Asset load failed (${response.status}): ${path}`);
  return resolveSchematicAsset(await response.json(),module);
}
