import {modules} from './data.js';

export const globalViews=['overview','catalog','history'];
export const workspaceViews=['course','lab','anatomy','knowledge'];
export function viewContext(view,module,mode='course'){
  const global={overview:['学习首页','ENDOCRINE & METABOLIC LEARNING','从一个问题开始，用观察建立机制解释。'],catalog:['课程目录','GUIDED COURSES','六个系统，沿预测、观察、比较与干预逐步学习。'],history:['学习记录','YOUR LEARNING HISTORY','回看各系统的实验与作答摘要。']};
  if(global[view])return {global:true,title:global[view][0],eyebrow:global[view][1],subtitle:global[view][2],breadcrumb:global[view][0]};
  if(!workspaceViews.includes(view)||!modules.some(m=>m.id===module?.id))throw new Error('未知学习视图');
  const label={course:'课程任务',lab:'机制实验',anatomy:'解剖定位',knowledge:'机制与证据'}[view];
  return {global:false,title:module.title,eyebrow:module.en,subtitle:module.subtitle,breadcrumb:`${mode==='course'?'课程学习':'自由探索'} / ${module.short} / ${label}`};
}

export const experimentFields=['scenario','time','speed','compare','branchAt','focus','manual'];
export function captureExperiment(state,activeCourseStep){
  return {...Object.fromEntries(experimentFields.map(key=>[key,state[key]])),activeCourseStep:activeCourseStep?structuredClone(activeCourseStep):null};
}
export function historyEntries(records,moduleId='all'){
  if(moduleId!=='all'&&!modules.some(m=>m.id===moduleId))throw new Error('未知记录筛选系统');
  return records.map((record,index)=>({record,index})).filter(({record})=>moduleId==='all'||record.module===moduleId).reverse();
}

export function teachingText(value){
  const escaped=String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return escaped.replace(/β\s*细胞|\d+(?:\.\d+)?\s*(?:分钟|小时|天|min|×)|\b(?:TRH|TSH|ACTH|CRH|GnRH|LH|PTH|GLUT4)\b/g,word=>`<span class="text-unit">${word}</span>`);
}
