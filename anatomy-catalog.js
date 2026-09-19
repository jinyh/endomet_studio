import {validateAssetManifest} from './assets.js';
import {modules} from './data.js';

export const anatomyManifestPath='./assets/anatomy/bodyparts3d-endocrine.json';
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const https=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};

// The common asset contract is extended only with the references needed by the GLB viewer.
export function validateAnatomyManifest(manifest){
  const result=validateAssetManifest(manifest);
  if(!result.valid)throw new Error(`解剖资源清单无效：${result.errors.join('；')}`);
  const require=(condition,message)=>{if(!condition)throw new Error(`解剖资源清单无效：${message}`);};
  require(manifest.representation==='anatomical'&&manifest.source.creationMethod==='model-file','必须使用来源明确的解剖网格');
  require(manifest.coordinates.unit==='m'&&manifest.coordinates.upAxis==='Y'&&manifest.coordinates.handedness==='right','坐标必须统一为米、Y 轴向上、右手系');
  require(https(manifest.source.sourceUrl)&&https(manifest.source.licenseUrl),'缺少来源或授权链接');
  require(sha(manifest.source.sha256),'缺少原始资源校验值');
  require(manifest.lods.length===1&&manifest.lods[0].level===0,'当前查看器需要一个已声明的基础模型');
  const lod=manifest.lods[0];
  require(/^\.\/[a-z0-9][a-z0-9._-]*\.glb$/i.test(lod.uri),'模型必须来自当前资源目录');
  require(sha(lod.sha256)&&Number.isInteger(lod.byteLength)&&lod.byteLength>0,'缺少模型校验值或文件大小');
  const meshNames=new Set();
  for(const label of manifest.labels){
    require(typeof label.meshName==='string'&&label.meshName===label.structureId&&!meshNames.has(label.meshName),'结构与网格必须一一对应');
    meshNames.add(label.meshName);
    require(Array.isArray(label.moduleIds)&&label.moduleIds.every(id=>modules.some(m=>m.id===id)),'结构引用了未知课程系统');
    require(typeof label.context==='boolean'&&/^#[a-f0-9]{6}$/i.test(label.color),'缺少结构分组或显示颜色');
    require(Array.isArray(label.sourceIds)&&label.sourceIds.length>0&&label.sourceIds.every(id=>typeof id==='string'&&id.length>0),'缺少原始结构编号');
    const bounds=label.bounds;
    require(vector(bounds?.min)&&vector(bounds?.max)&&bounds.min.every((v,i)=>v<=bounds.max[i]),'结构边界无效');
    require(label.anchor.every((v,i)=>v>=bounds.min[i]-1e-6&&v<=bounds.max[i]+1e-6),'标签锚点必须位于所属结构范围内');
  }
  return manifest;
}

export async function loadAnatomyManifest({fetchImpl=globalThis.fetch}={}){
  const url=new URL(anatomyManifestPath,import.meta.url);
  const response=await fetchImpl(url);
  if(!response.ok)throw new Error('解剖资源暂时无法加载，请重试；机制实验仍可使用。');
  return {manifest:validateAnatomyManifest(await response.json()),url};
}

export function relatedAnatomy(manifest,moduleId){
  if(!modules.some(m=>m.id===moduleId))throw new Error('未知课程系统');
  return manifest.labels.filter(label=>label.moduleIds.includes(moduleId));
}

export function validateAnatomyCommand(command,manifest){
  if(!command||typeof command!=='object')throw new Error('需要结构化的解剖操作');
  if(command.type==='focus'){
    if(command.structureId!==null&&!manifest.labels.some(label=>label.structureId===command.structureId))throw new Error('当前图谱没有这个结构');
    return {type:'focus',structureId:command.structureId};
  }
  if(command.type==='layer'&&['body','regional','organ'].includes(command.layer))return {type:'layer',layer:command.layer};
  if(['context','manual'].includes(command.type)&&typeof command.enabled==='boolean')return {type:command.type,enabled:command.enabled};
  throw new Error('不支持的解剖操作');
}
