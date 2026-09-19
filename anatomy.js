import * as THREE from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

const MAX_MODEL_BYTES=96*1024*1024;
const finiteVector=v=>v.every(Number.isFinite);
const labelColumnWidth=width=>Math.min(128,Math.max(76,width*.2));

// Callouts stay in side columns. Crowded secondary labels are omitted rather than
// moved to a distant anatomical region; every visible callout retains its anchor.
export function layoutAnatomyLabels(points,width,height){
  const labelWidth=labelColumnWidth(width),halfHeight=15,gap=36,edge=12,placements=[];
  const ordered=[...points].sort((a,b)=>Number(!!b.selected)-Number(!!a.selected)||a.anchorY-b.anchorY);
  for(const point of ordered){
    if(!finiteVector([point.anchorX,point.anchorY])||point.anchorX<0||point.anchorX>width||point.anchorY<0||point.anchorY>height)continue;
    const preferred=point.anchorX<width/2?'left':'right',candidates=[];
    for(const side of [preferred,preferred==='left'?'right':'left']){
      const x=side==='left'?edge+labelWidth/2:width-edge-labelWidth/2;
      for(const offset of [0,-gap,gap,-gap*2,gap*2]){
        const y=Math.max(edge+halfHeight,Math.min(height-edge-halfHeight,point.anchorY+offset));
        if(Math.abs(y-point.anchorY)>72||placements.some(item=>item.side===side&&Math.abs(item.y-y)<gap))continue;
        candidates.push({x,y,side,cost:Math.abs(y-point.anchorY)+(side===preferred?0:18)});
      }
    }
    candidates.sort((a,b)=>a.cost-b.cost);
    if(candidates.length){const {x,y,side}=candidates[0];placements.push({...point,x,y,side,width:labelWidth,lineEndX:x+(side==='left'?1:-1)*(labelWidth/2+4)});}
  }
  return placements;
}

// Models must stay beside the checked manifest; a GLB cannot pull in remote resources.
export function resolveAnatomyModelUrl(uri,manifestUrl,pageUrl){
  const page=new URL(pageUrl),base=new URL(manifestUrl,page),url=new URL(uri,base);
  const folder=new URL('.',base).pathname;
  if(!['http:','https:'].includes(url.protocol)||base.origin!==page.origin||url.origin!==page.origin||!url.pathname.startsWith(folder)||!url.pathname.endsWith('.glb')||url.search||url.hash||url.username||url.password)throw new Error('解剖模型必须是清单目录内的本地 GLB 文件。');
  return url.href;
}

export function inspectEmbeddedGLB(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<20||buffer.byteLength>MAX_MODEL_BYTES)throw new Error('GLB 文件大小无效。');
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw new Error('GLB 文件头无效。');
  let json=null,binaryChunks=0;
  for(let offset=12;offset<buffer.byteLength;){
    if(offset+8>buffer.byteLength)throw new Error('GLB 数据块不完整。');
    const size=view.getUint32(offset,true),type=view.getUint32(offset+4,true);offset+=8;
    if(size%4||offset+size>buffer.byteLength)throw new Error('GLB 数据块长度无效。');
    if(type===0x4e4f534a){if(json||offset!==20)throw new Error('GLB JSON 数据块无效。');json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,size)));}
    if(type===0x004e4942)binaryChunks++;
    offset+=size;
  }
  if(!json||json.asset?.version!=='2.0'||binaryChunks!==1||!Array.isArray(json.buffers)||json.buffers.length!==1)throw new Error('需要包含几何数据的 GLB 2.0 文件。');
  if(json.buffers.some(item=>item.uri!==undefined)||(json.images??[]).some(item=>item.uri!==undefined))throw new Error('GLB 不可引用外部缓冲区或图像。');
  if((json.extensionsRequired??[]).length)throw new Error('当前解剖查看器不支持需要额外解码器的 GLB 扩展。');
  return json;
}

export async function verifyAnatomyModelIntegrity(buffer,lod){
  if(buffer.byteLength!==lod.byteLength)throw new Error('模型文件大小与清单不一致。');
  if(!globalThis.crypto?.subtle)throw new Error('浏览器不支持模型完整性校验，请通过 HTTPS 或本机地址访问。');
  const hash=await crypto.subtle.digest('SHA-256',buffer);
  const actual=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(actual!==lod.sha256)throw new Error('模型 SHA-256 校验失败，文件与清单不一致。');
}

export function verifyAnatomyBounds(actual,declared){
  const tolerance=1e-5;
  if(!['min','max'].every(key=>actual[key].every((value,index)=>Math.abs(value-declared[key][index])<=tolerance)))throw new Error('实际结构边界与清单不一致。');
}

// Distance accounts for both aspect ratio and depth, including narrow desktop panels.
export function fitAnatomyBounds(min,max,aspect,fov=38,padding=1.2){
  if(!finiteVector([...min,...max])||min.some((n,i)=>n>max[i])||!Number.isFinite(aspect)||aspect<=0)throw new Error('解剖模型边界无效。');
  const size=max.map((n,i)=>n-min[i]);
  const tangent=Math.tan(fov*Math.PI/360);
  const distance=Math.max(size[1]/2/tangent,size[0]/2/(tangent*aspect),0.025)*padding+size[2]/2;
  return {target:min.map((n,i)=>(n+max[i])/2),distance};
}

function disposeObject(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root?.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[]){
      materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  textures.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());geometries.forEach(item=>item.dispose());
}

export class AnatomyScene {
  constructor(container,{onSelect=()=>{},onStatus=()=>{}}={}){
    this.host=container;this.onSelect=onSelect;this.onStatus=onStatus;this.active=true;this.destroyed=false;this.layer='body';this.contextVisible=true;this.selected=null;this.manual=false;this.entries=[];this.loadVersion=0;
    this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(38,1,0.001,100);this.camera.position.set(0,0,3);
    this.target=new THREE.Vector3();this.eye=new THREE.Vector3(0,0,3);this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    try{this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}
    catch(error){this.failed=true;this.status('error','当前设备无法开启解剖三维视图。请使用支持 WebGL 2 的浏览器。');return;}
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.7));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.domElement.className='anatomy-canvas';container.prepend(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xe2edff,0x495568,2));
    const key=new THREE.DirectionalLight(0xffefd9,2.5);key.position.set(2,3,4);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0xa8caff,1.6);rim.position.set(-3,1,-2);this.scene.add(rim);
    this.pointerDown=event=>{this.pointerStart={x:event.clientX,y:event.clientY};};
    this.pointerUp=event=>this.pick(event);
    this.contextLost=event=>{event.preventDefault();this.failed=true;this.setActive(false);this.status('error','WebGL 上下文已丢失，请重新载入解剖模型。');};
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.draw=this.draw.bind(this);
  }
  status(state,message,details){if(!this.destroyed)this.onStatus({state,message,...(details?{details}:{})});}
  async load(manifest,manifestUrl){
    if(this.destroyed||this.failed)return false;
    const version=++this.loadVersion;this.abort?.abort();this.abort=new AbortController();this.clear();this.status('loading','正在载入真实解剖模型…');
    let root=null;
    try{
      const lod=manifest.lods.find(item=>item.level===0)??manifest.lods[0];
      const url=resolveAnatomyModelUrl(lod.uri,manifestUrl,location.href);
      const response=await fetch(url,{signal:this.abort.signal,credentials:'same-origin',redirect:'error'});
      if(!response.ok)throw new Error(`模型文件载入失败（HTTP ${response.status}）。`);
      if(Number(response.headers.get('content-length'))>MAX_MODEL_BYTES)throw new Error('模型文件超过大小限制。');
      const buffer=await response.arrayBuffer();await verifyAnatomyModelIntegrity(buffer,lod);inspectEmbeddedGLB(buffer);
      const manager=new THREE.LoadingManager();manager.setURLModifier(resource=>{if(resource.startsWith('blob:'))return resource;throw new Error('模型包含未经允许的外部资源。');});
      const gltf=await new GLTFLoader(manager).parseAsync(buffer,'');root=gltf.scene;
      if(this.destroyed||version!==this.loadVersion){disposeObject(root);return false;}
      const {OrbitControls}=await import('./vendor/OrbitControls.js');
      if(this.destroyed||version!==this.loadVersion){disposeObject(root);return false;}
      if(!this.controls){this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=!this.reduced;this.controls.enablePan=true;this.controls.enabled=this.manual;}
      root.updateMatrixWorld(true);
      const meshes=[];root.traverse(object=>{if(object.isMesh)meshes.push(object);});
      const byName=new Map();for(const mesh of meshes){if(byName.has(mesh.name))throw new Error(`模型网格名称重复：${mesh.name}`);byName.set(mesh.name,mesh);}
      if(meshes.length!==manifest.labels.length)throw new Error('模型网格数量与解剖清单不一致。');
      const entries=manifest.labels.map(label=>{
        const mesh=byName.get(label.meshName??label.structureId);if(!mesh)throw new Error(`模型缺少清单结构：${label.name}`);
        const bounds=new THREE.Box3().setFromObject(mesh);
        if(bounds.isEmpty()||!finiteVector([...bounds.min.toArray(),...bounds.max.toArray()])||bounds.getSize(new THREE.Vector3()).length()>20)throw new Error(`结构几何边界无效：${label.name}`);
        verifyAnatomyBounds({min:bounds.min.toArray(),max:bounds.max.toArray()},label.bounds);
        return {label,mesh,bounds,anchor:new THREE.Vector3().fromArray(label.anchor)};
      });
      const triangles=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
      if(triangles!==lod.triangleCount)throw new Error('实际模型三角形数量与清单不一致。');
      const oldMaterials=new Set();
      for(const entry of entries){
        const {mesh,label}=entry;for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])oldMaterials.add(material);
        const color=new THREE.Color(label.color??(label.context?'#a4b2c2':'#e8b690'));
        mesh.material=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:0.02,roughness:0.67,metalness:0,transparent:!!label.context,opacity:label.context?(label.structureId==='body'||/skin|body|皮肤|体表/i.test(label.name)?0.07:0.2):1,depthWrite:!label.context,side:THREE.DoubleSide});
        if(!mesh.geometry.attributes.normal)mesh.geometry.computeVertexNormals();
        mesh.userData.structureId=label.structureId;mesh.renderOrder=label.context?1:0;
      }
      for(const material of oldMaterials){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}
      this.root=root;this.entries=entries;this.manifest=manifest;this.scene.add(root);this.selected=null;
      const svgNamespace='http://www.w3.org/2000/svg';this.leaders=document.createElementNS(svgNamespace,'svg');this.leaders.classList.add('anatomy-leaders');this.leaders.setAttribute('aria-hidden','true');Object.assign(this.leaders.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});this.host.append(this.leaders);
      for(const entry of entries){
        if(entry.label.structureId==='body')continue;
        const button=document.createElement('button');button.type='button';button.className='anatomy-label';button.dataset.structureId=entry.label.structureId;button.textContent=entry.label.name;button.addEventListener('click',()=>this.onSelect(entry.label.structureId));this.host.append(button);entry.button=button;
        entry.leader=document.createElementNS(svgNamespace,'polyline');entry.leader.classList.add('anatomy-leader');entry.leader.setAttribute('fill','none');entry.leader.setAttribute('stroke','#8ba7b8');entry.leader.setAttribute('stroke-width','1');
        entry.anchorDot=document.createElementNS(svgNamespace,'circle');entry.anchorDot.classList.add('anatomy-anchor');entry.anchorDot.setAttribute('r','2.2');entry.anchorDot.setAttribute('fill','#b5d4df');this.leaders.append(entry.leader,entry.anchorDot);
      }
      this.host.dataset.anatomyAssetId=manifest.assetId;this.applyView(true);this.status('ready','真实解剖模型已载入。',{meshCount:meshes.length,triangleCount:triangles});this.setActive(this.active);return true;
    }catch(error){
      if(root&&root!==this.root)disposeObject(root);
      if(version!==this.loadVersion||this.destroyed)return false;
      this.clear();this.status('error',error.name==='AbortError'?'模型载入已取消。':`无法显示解剖模型：${error.message}`);return false;
    }
  }
  clear(){
    cancelAnimationFrame(this.frame);this.frame=null;
    for(const entry of this.entries)entry.button?.remove();this.entries=[];
    this.leaders?.remove();this.leaders=null;
    if(this.root){this.scene.remove(this.root);disposeObject(this.root);this.root=null;}
    delete this.host.dataset.anatomyAssetId;
  }
  focus(id){if(id!==null&&!this.entries.some(entry=>entry.label.structureId===id))return;this.selected=id;this.applyView();}
  setLayer(layer){if(!['body','regional','organ'].includes(layer))return;this.layer=layer;this.applyView();}
  setContextVisible(visible){this.contextVisible=!!visible;this.applyView();}
  setManual(enabled){this.manual=!!enabled;if(this.controls)this.controls.enabled=this.manual;if(!enabled)this.applyView();}
  setActive(active){this.active=!!active;cancelAnimationFrame(this.frame);this.frame=null;if(this.active&&!this.failed&&!this.destroyed&&this.root){this.last=performance.now();this.frame=requestAnimationFrame(this.draw);}}
  applyView(snap=false){
    if(!this.root)return;
    const selected=this.entries.find(entry=>entry.label.structureId===this.selected),bounds=new THREE.Box3();
    const center=selected?.bounds.getCenter(new THREE.Vector3());
    const radius=selected?Math.max(selected.bounds.getSize(new THREE.Vector3()).length()*1.8,0.16):0;
    for(const entry of this.entries){
      const isSelected=entry===selected,context=!!entry.label.context;
      let visible=isSelected||!context||this.contextVisible;
      if(selected&&this.layer==='organ')visible=isSelected;
      if(selected&&this.layer==='regional')visible=visible&&(isSelected||entry.bounds.distanceToPoint(center)<=radius);
      entry.mesh.visible=visible;entry.mesh.material.emissiveIntensity=isSelected?0.3:0.02;
      if(context)entry.mesh.material.opacity=isSelected?0.88:entry.label.structureId==='body'?0.07:0.2;
      entry.button?.classList.toggle('selected',isSelected);entry.button?.setAttribute('aria-pressed',String(isSelected));
      entry.leader?.classList.toggle('selected',isSelected);entry.anchorDot?.classList.toggle('selected',isSelected);
      if(entry.button)entry.button.hidden=!visible||(context&&!isSelected);
      // Whole-body context stays translucent in regional views but does not force a full-body zoom.
      if(visible&&!(selected&&this.layer==='regional'&&context&&!isSelected))bounds.union(entry.bounds);
    }
    if(bounds.isEmpty())return;
    if(selected&&this.layer==='regional')bounds.expandByScalar(Math.max(radius*0.18,0.04));
    this.viewBounds=bounds;
    const width=this.host.clientWidth,height=this.host.clientHeight;
    const framingAspect=width&&height?Math.max(width*.3,width-2*(labelColumnWidth(width)+28))/height:this.camera.aspect;
    const frame=fitAnatomyBounds(bounds.min.toArray(),bounds.max.toArray(),framingAspect);
    this.target.fromArray(frame.target);this.eye.copy(this.target).add(new THREE.Vector3(0,0,frame.distance));
    this.camera.near=Math.max(frame.distance/5000,0.0001);this.camera.far=Math.max(frame.distance*12,10);this.camera.updateProjectionMatrix();
    this.controls.minDistance=Math.max(frame.distance*.14,0.01);this.controls.maxDistance=Math.max(frame.distance*5,3);
    if(snap||this.reduced){this.camera.position.copy(this.eye);this.controls.target.copy(this.target);this.camera.lookAt(this.target);}
  }
  resize(){
    if(!this.renderer||this.destroyed)return;
    const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height)return;
    this.renderer.setSize(width,height);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();if(this.root)this.applyView();
  }
  pick(event){
    if(!this.root||!this.pointerStart||Math.hypot(event.clientX-this.pointerStart.x,event.clientY-this.pointerStart.y)>6)return;
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
    const candidates=this.entries.filter(entry=>entry.mesh.visible&&entry.label.structureId!=='body').map(entry=>entry.mesh);
    const hit=this.raycaster.intersectObjects(candidates,false)[0];if(hit)this.onSelect(hit.object.userData.structureId);
  }
  draw(now){
    if(!this.active||this.destroyed||this.failed)return;
    const dt=Math.min((now-this.last)/1000,.1);this.last=now;
    if(this.manual)this.controls.update();else{const ease=this.reduced?1:1-Math.exp(-dt*5);this.camera.position.lerp(this.eye,ease);this.controls.target.lerp(this.target,ease);this.camera.lookAt(this.controls.target);}
    this.camera.updateMatrixWorld();
    const width=this.host.clientWidth,height=this.host.clientHeight,points=[];
    this.leaders.setAttribute('viewBox',`0 0 ${width} ${height}`);
    for(const entry of this.entries){
      if(entry.leader){entry.leader.style.display='none';entry.anchorDot.style.display='none';entry.button.style.visibility='hidden';}
      if(!entry.button||entry.button.hidden||!entry.mesh.visible)continue;
      const point=entry.anchor.clone().project(this.camera);
      if(point.z>=-1&&point.z<=1)points.push({entry,anchorX:(point.x/2+.5)*width,anchorY:(-point.y/2+.5)*height,selected:entry.label.structureId===this.selected});
    }
    for(const placement of layoutAnatomyLabels(points,width,height)){
      const {entry,x,y,side,anchorX,anchorY,lineEndX}=placement;
      Object.assign(entry.button.style,{visibility:'visible',left:`${x}px`,top:`${y}px`,width:`${placement.width}px`,maxWidth:`${placement.width}px`,boxSizing:'border-box',overflow:'hidden',textOverflow:'ellipsis'});
      const elbowX=lineEndX+(side==='left'?12:-12);
      entry.leader.setAttribute('points',`${anchorX},${anchorY} ${elbowX},${y} ${lineEndX},${y}`);entry.leader.style.display='';
      entry.anchorDot.setAttribute('cx',String(anchorX));entry.anchorDot.setAttribute('cy',String(anchorY));entry.anchorDot.style.display='';
    }
    this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(this.draw);
  }
  destroy(){
    this.destroyed=true;this.loadVersion++;this.abort?.abort();cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.controls?.dispose();this.clear();
    if(this.renderer){const canvas=this.renderer.domElement;canvas.removeEventListener('pointerdown',this.pointerDown);canvas.removeEventListener('pointerup',this.pointerUp);canvas.removeEventListener('webglcontextlost',this.contextLost);this.renderer.dispose();canvas.remove();}
  }
}
