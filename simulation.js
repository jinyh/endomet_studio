// Educational, dimensionless mechanisms. Parameters have not been fitted to patients.
export const MODEL_VERSION='teaching-0.1.0';
const clamp=(v,min=0.02,max=8)=>Math.min(max,Math.max(min,v));
export function parameters(module, scenarioId, intervention=false) {
  const scenario=module.scenarios.find(s=>s.id===scenarioId);
  if(!scenario) throw new Error('Unknown scenario');
  const p={...scenario.params};
  if(intervention){
    if(module.id==='glucose')p.sensitivity=1;
    else if(module.id==='calcium'){p.capacity=1;p.autonomous=0;}
    else if(module.id==='energy')p.excess=0;
    else p.capacity=1;
  }
  return p;
}
export function derivative(m,t,s,p){
  const {g,i=1,h,p:pit=1,u=1}=s;
  if(m.id==='glucose'){
    // Meal appearance is a smooth input; output depends on evolving glucose and insulin.
    const meal=0.055*(t/28)*Math.exp(1-t/28);
    const uptake=1+p.sensitivity*Math.max(0,i-1)*0.8;
    const hepatic=1/(1+p.sensitivity*Math.max(0,i-1)*0.85);
    return {g:meal+(0.018*hepatic-0.018*g*uptake),i:(1+p.capacity*Math.max(0,g-1)*3.1-i)/15,h:(hepatic-h)/8,u:(uptake-u)/8};
  }
  if(m.id==='calcium'){
    const target=clamp(p.capacity*(1+4*(1-g))+p.autonomous);
    return {p:(target-pit)/3,g:(1+0.3*(pit-1)-g)/8,h:(clamp(1-0.25*(pit-1))-h)/7,u:(clamp(1+0.6*(pit-1))-u)/5};
  }
  if(m.id==='energy'){
    const intake=clamp(1+p.excess-p.response*0.65*(pit-1));
    const expenditure=clamp(1+0.18*(g-1));
    return {g:(h-u)*0.09,p:(g-pit)/3,h:(intake-h)/1.5,u:(expenditure-u)/2};
  }
  let drive=1;
  if(m.id==='adrenal') drive=1+0.24*Math.sin((t-2)*Math.PI/12)+0.9*Math.exp(-(((t-8)/1.4)**2));
  const time=m.id==='adrenal'?1:0.7;
  return {h:(clamp(drive+0.7*(1-g))-h)/(1.1*time),p:(clamp(p.pituitary*h*(1+0.75*(1-g)))-pit)/(0.8*time),g:(clamp(p.capacity*pit)-g)/(2*time)};
}
export function simulate(m,scenarioId,{branchAt=null}={}) {
  if(branchAt!==null&&(!Number.isFinite(branchAt)||branchAt<0||branchAt>m.duration))throw new Error('Invalid branch time');
  const count=Math.round(m.duration/m.step),dt=m.duration/count;
  let s={g:1,i:1,p:1,h:1,u:1};
  const rows=[{t:0,...s}];
  const base=parameters(m,scenarioId), intervention=parameters(m,scenarioId,true);
  for(let n=0;n<count;n++){
    const t=n*dt;
    // Split an integration step exactly at an intervention event.
    const cuts=branchAt!==null&&branchAt>t&&branchAt<t+dt ? [branchAt-t,t+dt-branchAt] : [dt];
    let cursor=t;
    for(const delta of cuts){
      const d=derivative(m,cursor,s,branchAt!==null&&cursor>=branchAt-1e-10?intervention:base);
      s={...s,...Object.fromEntries(Object.entries(d).map(([k,v])=>[k,clamp(s[k]+v*delta)]))};
      cursor+=delta;
    }
    rows.push({t:(n+1)*dt,...s});
  }
  return rows;
}
export function sample(rows,time){
  if(!Number.isFinite(time))throw new Error('Invalid time');
  const t=Math.max(0,Math.min(rows.at(-1).t,time));
  const i=Math.min(rows.length-2,Math.floor(t/rows.at(-1).t*(rows.length-1)));
  const a=rows[i],b=rows[i+1],r=(t-a.t)/(b.t-a.t);
  return Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+(b[k]-a[k])*r]));
}
