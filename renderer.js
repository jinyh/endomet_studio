import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';

export const materialPresets = Object.freeze({
  signal:{roughness:0.32,metalness:0.18,transparent:true,opacity:0.92},
  tissueSchematic:{roughness:0.63,metalness:0.04,transparent:true,opacity:0.9},
});

export class MechanismScene {
  constructor(container,onSelect){
    this.host=container;this.onSelect=onSelect;this.nodes=[];this.edges=[];this.labels=[];this.value={};this.target=new THREE.Vector3();this.eye=new THREE.Vector3(0,0.3,11.4);this.selected=null;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(43,1,0.1,80);this.camera.position.copy(this.eye);
    try{this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{
      this.host.innerHTML='<div class="scene-fallback">当前设备无法开启三维视图。可继续使用右侧指标、时间轴与课程任务。</div>';this.failed=true;return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    container.prepend(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xcfe2ff,1.6));
    const key=new THREE.DirectionalLight(0xc1fff7,3);key.position.set(2,6,8);this.scene.add(key);
    const rim=new THREE.DirectionalLight(0x8d9aff,2);rim.position.set(-4,-2,-3);this.scene.add(rim);
    this.group=new THREE.Group();this.scene.add(this.group);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enabled=false;this.controls.enableDamping=true;this.controls.enablePan=false;this.controls.minDistance=5;this.controls.maxDistance=17;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
    this.resize();this.last=performance.now();this.draw=this.draw.bind(this);this.frame=requestAnimationFrame(this.draw);
  }
  resize(){if(this.failed)return;const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  clear(){
    for(const l of this.labels)l.remove();this.labels=[];
    this.group.traverse(o=>{o.geometry?.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
    this.group.clear();this.nodes=[];this.edges=[];
  }
  setModule(m){
    if(this.failed)return;this.clear();this.module=m;const color=new THREE.Color(m.color);
    m.nodes.forEach(([id,label,x,y,z,key],index)=>{
      const sphere=new THREE.Mesh(new THREE.IcosahedronGeometry(0.32,3),new THREE.MeshStandardMaterial({...materialPresets.signal,color,emissive:color,emissiveIntensity:0.12}));sphere.position.set(x,y,z);this.group.add(sphere);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(0.52,0.013,8,64),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.35}));ring.position.copy(sphere.position);this.group.add(ring);
      const halo=new THREE.Mesh(new THREE.SphereGeometry(0.45,20,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.045,depthWrite:false}));halo.position.copy(sphere.position);this.group.add(halo);
      const button=document.createElement('button');button.className='node-label';button.dataset.node=id;button.innerHTML=`<span class="node-index">${String(index+1).padStart(2,'0')}</span><strong>${label}</strong><span class="node-reading"></span>`;button.addEventListener('click',()=>this.onSelect(id));this.host.append(button);this.labels.push(button);this.nodes.push({id,sphere,ring,halo,key,button});
    });
    m.edges.forEach(([from,to,sign],index)=>{
      const a=this.nodes.find(n=>n.id===from).sphere.position,b=this.nodes.find(n=>n.id===to).sphere.position;
      const mid=a.clone().lerp(b,0.5);mid.z=sign==='−'?-0.7:0.25;mid.x+=(index%2?0.24:-0.24);
      const curve=new THREE.QuadraticBezierCurve3(a,mid,b);
      const edgeColor=sign==='−'?0xb998f4:0x55d5c5;
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),new THREE.LineBasicMaterial({color:edgeColor,transparent:true,opacity:0.4}));this.group.add(line);
      const arrow=new THREE.Mesh(new THREE.ConeGeometry(0.065,0.18,8),new THREE.MeshBasicMaterial({color:edgeColor,transparent:true,opacity:0.7}));arrow.position.copy(curve.getPoint(.7));arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),curve.getTangent(.7).normalize());this.group.add(arrow);
      const dots=[];for(let i=0;i<3;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(0.028,6,6),new THREE.MeshBasicMaterial({color:edgeColor,transparent:true,opacity:0.8}));this.group.add(dot);dots.push(dot);}
      this.edges.push({curve,dots,sign,from,to,index});
    });
    this.focus(null);
  }
  setValues(value,time,playing){this.value=value;this.time=time;this.playing=playing;}
  setManual(enabled){if(this.failed)return;this.controls.enabled=enabled;this.manual=enabled;if(!enabled)this.focus(null);}
  focus(id){
    if(this.failed)return;this.selected=id;const n=this.nodes.find(n=>n.id===id);
    const desired=n?n.sphere.position.clone().multiplyScalar(0.4):new THREE.Vector3(0,-0.1,0);
    this.target.copy(desired);this.eye.copy(desired).add(new THREE.Vector3(0,0.3,n?8.6:11.4));
    for(const node of this.nodes)node.button.classList.toggle('selected',node.id===id);
  }
  draw(now){
    if(this.failed)return;
    const dt=Math.min((now-this.last)/1000,0.1);this.last=now;
    if(!this.manual){const ease=this.reduced?1:1-Math.exp(-dt*5);this.camera.position.lerp(this.eye,ease);this.controls.target.lerp(this.target,ease);this.camera.lookAt(this.controls.target);}else this.controls.update();
    const w=this.host.clientWidth,h=this.host.clientHeight;
    for(const n of this.nodes){
      const v=this.value[n.key]??1;n.sphere.scale.setScalar(0.86+Math.min(v,3)*0.14);n.sphere.material.emissiveIntensity=(n.id===this.selected?0.55:0.12)+Math.max(0,v-1)*0.12;
      n.ring.scale.setScalar(n.id===this.selected?1.25:1);
      const p=n.sphere.position.clone().project(this.camera);n.button.style.left=`${(p.x/2+0.5)*w}px`;n.button.style.top=`${(-p.y/2+0.5)*h+30}px`;n.button.style.visibility=p.z>1?'hidden':'visible';
      const qualitative=['gut','beta','tissue','stress','kidney','brain'].includes(n.id);
      n.button.querySelector('.node-reading').textContent=qualitative?'':`${v.toFixed(2)} ×`;
    }
    // Particles encode direction, not velocity or a molecule count. Freeze when paused.
    for(const e of this.edges){e.dots.forEach((dot,i)=>{const phase=(this.time/this.module.duration*10+i/3+e.index*0.13)%1;dot.position.copy(e.curve.getPoint(phase));});}
    this.renderer.render(this.scene,this.camera);this.frame=requestAnimationFrame(this.draw);
  }
  destroy(){cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.controls?.dispose();if(!this.failed){this.clear();this.renderer.dispose();}}
}
