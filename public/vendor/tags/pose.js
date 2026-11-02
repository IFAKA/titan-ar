/* Pure pose helpers. Camera +X right, +Y down, +Z forward.
   Marker +X right, +Y down, +Z into its face; center origin. */
(function(root){
"use strict";
const transpose = R => R[0].map((_,i)=>R.map(row=>row[i]));
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const inverse = ({R,t}) => {const Q=transpose(R); return {R:Q,t:Q.map(row=>-dot(row,t))};};
const matrix = ({R,t}) => [...R.map((row,i)=>[...row,t[i]]),[0,0,0,1]];
const euler = R => {const pitch=Math.asin(Math.max(-1,Math.min(1,-R[2][0])));const regular=Math.abs(Math.cos(pitch))>1e-6;return [regular?Math.atan2(R[2][1],R[2][2]):0,pitch,regular?Math.atan2(R[1][0],R[0][0]):Math.atan2(-R[0][1],R[1][1])].map(v=>v*180/Math.PI);};
const distort = (x,y,d=[]) => {const [k1=0,k2=0,p1=0,p2=0,k3=0]=d;const r=x*x+y*y,a=1+k1*r+k2*r*r+k3*r*r*r;return [x*a+2*p1*x*y+p2*(r+2*x*x),y*a+p1*(r+2*y*y)+2*p2*x*y];};
const undistort = (p,K) => {const xd=(p.x-K.cx)/K.fx,yd=(p.y-K.cy)/K.fy;let x=xd,y=yd;for(let i=0;i<25;i++){const q=distort(x,y,K.dist);const dx=xd-q[0],dy=yd-q[1];x+=dx;y+=dy;if(Math.hypot(dx,dy)<1e-12)break;}if(!Number.isFinite(x+y)||Math.hypot(...distort(x,y,K.dist).map((v,i)=>v-[xd,yd][i]))>1e-6)throw new Error("왜곡 역변환 실패. 보정값을 확인해.");return {x:K.fx*x+K.cx,y:K.fy*y+K.cy};};
const project = (P,pose,K) => {const q=pose.R.map((r,i)=>dot(r,P)+pose.t[i]);const [x,y]=distort(q[0]/q[2],q[1]/q[2],K.dist);return {x:K.fx*x+K.cx,y:K.fy*y+K.cy,z:q[2]};};
const model = size => [[-size/2,-size/2,0],[size/2,-size/2,0],[size/2,size/2,0],[-size/2,size/2,0]];
function estimate(corners,size,K,Posit){
 if(!(size>0 && K.fx>0 && K.fy>0) || corners.length!==4) throw new Error("Invalid pose inputs");
 const points=corners.map(p=>undistort(p,K)).map(p=>({x:p.x-K.cx,y:(p.y-K.cy)*K.fx/K.fy}));
 const raw=new Posit(size,K.fx).pose(points);
 const candidates=[[raw.bestRotation,raw.bestTranslation],[raw.alternativeRotation,raw.alternativeTranslation]].map(([R,t])=>{
   if(!R||R.length!==3||R.some(r=>r.length!==3)||!t||t.length!==3)return null;
   const pose={R:R.map(row=>[row[0],-row[1],-row[2]]),t:[...t]};
   if(![...pose.R.flat(),...pose.t].every(Number.isFinite))return null;
   const projected=model(size).map(p=>project(p,pose,K));if(projected.some(p=>p.z<=0))return null;
   const error=Math.sqrt(projected.reduce((s,p,i)=>s+(p.x-corners[i].x)**2+(p.y-corners[i].y)**2,0)/4);
   return {...pose,error};
 }).filter(Boolean).sort((a,b)=>a.error-b.error);
 if(!candidates.length)throw new Error("No valid positive-depth pose");
 return {...candidates[0],alternativeError:candidates[1]?.error??null};
}
const api={inverse,matrix,euler,project,model,estimate,distort,undistort};
if(typeof module!=="undefined")module.exports=api;else root.PoseMath=api;
})(typeof window!=="undefined"?window:this);
