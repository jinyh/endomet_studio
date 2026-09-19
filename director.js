// One command boundary for the UI, course steps, WebMCP, and a future AI adapter.
export function validateCommand(command,module){
  if(!command||typeof command!=='object')throw new Error('操作必须是结构化指令');
  const {type}=command;
  if(type==='seek'){
    if(!Number.isFinite(command.time)||command.time<0||command.time>module.duration)throw new Error('时间超出当前实验范围');
    return {type,time:command.time};
  }
  if(type==='focus'){
    if(command.nodeId!==null&&!module.nodes.some(n=>n[0]===command.nodeId))throw new Error('当前场景中没有这个结构');
    return {type,nodeId:command.nodeId};
  }
  if(type==='scenario'){
    if(!module.scenarios.some(s=>s.id===command.scenarioId))throw new Error('当前系统中没有这个情景');
    return {type,scenarioId:command.scenarioId};
  }
  if(['play','pause','branch','undoBranch','explain'].includes(type))return {type};
  throw new Error('该操作不在实验室支持的范围内');
}
export function parseLocalRequest(text,module){
  const value=text.trim();
  if(/暂停|停止/.test(value))return {type:'pause'};
  if(/播放|继续/.test(value))return {type:'play'};
  if(/撤销|取消干预/.test(value))return {type:'undoBranch'};
  if(/恢复全景|全景/.test(value))return {type:'focus',nodeId:null};
  const time=value.match(/(?:跳到|回到|定位到)\s*(\d+(?:\.\d+)?)\s*(分钟|小时|天)?/);
  if(time){if(time[2]&&time[2]!==module.unit)throw new Error(`当前实验时间单位为${module.unit}，请输入相同单位。`);return validateCommand({type:'seek',time:Number(time[1])},module);}
  const node=module.nodes.find(n=>value.includes(n[1]));
  if(node&&/看|定位|聚焦|解释/.test(value))return {type:'focus',nodeId:node[0]};
  if(/比较|干预|实验/.test(value))return {type:'branch'};
  if(/为什么|变化|解释|反馈|下降|上升/.test(value))return {type:'explain'};
  return null;
}
