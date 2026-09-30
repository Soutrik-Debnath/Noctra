// Traces the owner's reference heart into a path on the icon grid, then RENDERS the result next to
// the source outline so the fit can be judged on pixels rather than on a path string.
//   node scripts/trace-heart.mjs <png|webp|jpg>
import fs from "node:fs";

const [, , pngPath] = process.argv;
if (!pngPath) {
  console.error("usage: node scripts/trace-heart.mjs <image>");
  process.exit(1);
}
const MIME = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const mime = MIME[/\.\w+$/.exec(pngPath)[0].toLowerCase()] ?? "image/png";
const b64 = fs.readFileSync(pngPath).toString("base64");
const PORT = process.env.NOCTRA_CDP_PORT ?? "9223";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === "page" && t.url.includes("1420") && !t.url.includes("mini"));
if (!target) throw new Error("main window not found on the debug port");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
  setTimeout(() => rej(new Error("websocket open timed out")), 8000);
});
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    const timer = setTimeout(() => {
      pending.delete(n);
      rej(new Error(`${method} timed out`));
    }, 25000);
    pending.set(n, {
      resolve: (m) => {
        clearTimeout(timer);
        res(m);
      },
    });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

const WORK = `
(async () => {
  const img = new Image();
  img.src = "data:__MIME__;base64,__B64__";
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("decode failed")); });
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;

  // Which polarity is the ink? The first reference was a white ring on a dark ground; the current one
  // is a dark outline on white. Guess from the mean luminance rather than hard-coding either.
  let luma = 0;
  for (let i = 0; i < W * H; i++) luma += 0.2126 * px[i*4] + 0.7152 * px[i*4+1] + 0.0722 * px[i*4+2];
  luma /= W * H;
  const onWhite = luma > 128;

  const white = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i*4], gg = px[i*4+1], b = px[i*4+2];
    const lo = Math.min(r, gg, b), hi = Math.max(r, gg, b);
    white[i] = onWhite ? (hi < 200 ? 1 : 0) : (lo > 185 && hi - lo < 34 ? 1 : 0);
  }
  let best = null; const seen = new Uint8Array(W * H); const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!white[s] || seen[s]) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1; const comp = [];
    let minX=W, maxX=-1, minY=H, maxY=-1;
    while (sp > 0) {
      const p = stack[--sp]; const x = p % W, y = (p - x) / W; comp.push(p);
      if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        if (!dx && !dy) continue;
        const nx=x+dx, ny=y+dy;
        if (nx<0||ny<0||nx>=W||ny>=H) continue;
        const q=ny*W+nx;
        if (white[q] && !seen[q]) { seen[q]=1; stack[sp++]=q; }
      }
    }
    if (!best || comp.length > best.comp.length) best = { comp, minX, maxX, minY, maxY };
  }
  if (!best) return { err: "no outline found" };
  const inC = new Uint8Array(W * H);
  for (const p of best.comp) inC[p] = 1;

  const x0=best.minX, x1=best.maxX, y0=best.minY, y1=best.maxY;
  const bw = x1-x0+1, bh = y1-y0+1;

  // Outer silhouette per column: top of the ring and bottom of the ring.
  let topRaw=[], botRaw=[];
  for (let x=x0; x<=x1; x++) {
    let t=-1,b=-1;
    for (let y=0;y<H;y++) if (inC[y*W+x]) { if (t<0) t=y; b=y; }
    topRaw.push(t<0?null:t-y0); botRaw.push(b<0?null:b-y0);
  }
  const idxOf = (frac) => Math.round(frac*(bw-1));

  // Smooth, then MIRROR-AVERAGE. A hand-traced ring is never quite symmetric; an icon must be, and
  // averaging left with mirrored right is what removes both the pixel noise and the lean.
  const smooth = (arr) => arr.map((v,i) => {
    let s=0,n=0;
    for (let k=-2;k<=2;k++){ const j=i+k; if(j>=0&&j<arr.length&&arr[j]!=null){s+=arr[j];n++;} }
    return n? s/n : 0;
  });
  const tS = smooth(topRaw), bS = smooth(botRaw);
  const top = tS.map((v,i)=> (v + tS[bw-1-i]) / 2);
  const bot = bS.map((v,i)=> (v + bS[bw-1-i]) / 2);

  // Walk the outline: top profile left->right, then bottom profile right->left.
  const dense = [];
  for (let i=0;i<bw;i++) dense.push([i, top[i]]);
  for (let i=bw-1;i>=0;i--) dense.push([i, bot[i]]);

  // Resample evenly by arc length.
  const N=dense.length, cum=[0];
  for (let i=1;i<=N;i++){ const a=dense[i-1],b=dense[i%N]; cum.push(cum[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1])); }
  const total=cum[N], SAMPLES=${Number(process.env.SAMPLES ?? 80)}, step=total/SAMPLES, pts=[];
  let j=0;
  for (let k=0;k<SAMPLES;k++){
    const d=k*step;
    while (j<N-1 && cum[j+1]<d) j++;
    const seg=cum[j+1]-cum[j]||1, f=(d-cum[j])/seg;
    const a=dense[j%N], b=dense[(j+1)%N];
    pts.push([a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f]);
  }

  // Into the icon grid: 16.4 wide, centred, base at y=20.4, aspect preserved.
  const TW=16.4, scale=TW/bw, TH=bh*scale, TX0=12-TW/2, TY1=20.4, TY0=TY1-TH;
  const ip = pts.map(([x,y])=>[TX0+x*scale, TY0+y*scale]);

  const r2=(v)=>Math.round(v*100)/100;
  const P=(i)=>ip[((i%ip.length)+ip.length)%ip.length];
  let d="M"+r2(P(0)[0])+" "+r2(P(0)[1]);
  for (let i=0;i<ip.length;i++){
    const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    const c1=[p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6];
    const c2=[p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6];
    d+="C"+r2(c1[0])+" "+r2(c1[1])+" "+r2(c2[0])+" "+r2(c2[1])+" "+r2(p2[0])+" "+r2(p2[1]);
  }
  d+="Z";

  // ---- fit error: evaluate the emitted beziers and measure how far they stray from the source ----
  // Kept in SOURCE pixels: the icon grid is only 24 units wide, so every judgement here is easier to
  // read against the 941px reference than against a 0.01-unit rounding error.
  const curve=[];
  for (let i=0;i<ip.length;i++){
    const p0=P(i-1),p1=P(i),p2=P(i+1),p3=P(i+2);
    const c1=[p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6];
    const c2=[p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6];
    for (let k=0;k<12;k++){
      const t=k/12, u=1-t;
      const bx=u*u*u*p1[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*p2[0];
      const by=u*u*u*p1[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*p2[1];
      curve.push([(bx-TX0)/scale, (by-TY0)/scale]);
    }
  }
  // Distance to the outline POLYLINE, not to its vertices — in steep sections vertices sit tens of
  // pixels apart, and vertex distance would report that spacing as if it were shape error.
  const segDist=(px,py,ax,ay,bx2,by2)=>{
    const dx=bx2-ax, dy=by2-ay; const L=dx*dx+dy*dy;
    const t=L?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/L)):0;
    return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
  };
  let eSum=0, eMax=0, eMaxAt=null;
  for (const [sx,sy] of curve){
    let best=Infinity;
    for (let q=0;q<dense.length;q++){
      const a=dense[q], b=dense[(q+1)%dense.length];
      const e=segDist(sx,sy,a[0],a[1],b[0],b[1]);
      if (e<best) best=e;
    }
    eSum+=best;
    if (best>eMax){ eMax=best; eMaxAt=[Math.round(sx), Math.round(sy)]; }
  }
  // Corner fidelity: the apex and the cleft are the two features that make a heart read as a heart,
  // and arc-length resampling is exactly what rounds them off. Measure both against the source.
  const near=(frac,tol)=>{ const lo=(frac-tol)*bw, hi=(frac+tol)*bw;
    return curve.filter(([sx])=>sx>=lo&&sx<=hi).map(([,sy])=>sy); };
  const srcNear=(frac,tol)=>{ const lo=Math.max(0,Math.round((frac-tol)*bw)), hi=Math.min(bw-1,Math.round((frac+tol)*bw));
    return bot.slice(lo,hi+1); };
  const apexSrc=Math.max(...srcNear(0.5,0.02));
  const apexOut=Math.max(...near(0.5,0.02));
  // The cleft sits on the UPPER boundary and the apex on the LOWER one, both at x≈centre, so each
  // window has to be cut by height as well or the apex is read as the cleft.
  const cleftSrc=Math.max(...top.slice(idxOf(0.485),idxOf(0.515)+1));
  const cleftOut=Math.max(...near(0.5,0.006).filter((sy)=>sy<bh/2));

  // ---- render a comparison: traced path (white) over the source outline (cyan) ----
  const SIZE=420, pad=30;
  const out=document.createElement("canvas"); out.width=SIZE; out.height=SIZE;
  const og=out.getContext("2d");
  og.fillStyle="#101014"; og.fillRect(0,0,SIZE,SIZE);
  const mapX=(x)=>pad+(x/24)*(SIZE-2*pad), mapY=(y)=>pad+(y/24)*(SIZE-2*pad);
  // source, scaled to the same 24 grid
  og.save(); og.translate(0,0); og.globalAlpha=.85; og.strokeStyle="#3fd0ff"; og.lineWidth=2;
  og.beginPath();
  for (let i=0;i<bw;i++){ const X=mapX(TX0+i*scale), Y=mapY(TY0+topRaw[i]*scale); i?og.lineTo(X,Y):og.moveTo(X,Y); }
  for (let i=bw-1;i>=0;i--){ og.lineTo(mapX(TX0+i*scale), mapY(TY0+botRaw[i]*scale)); }
  og.closePath(); og.stroke(); og.restore();
  // traced
  og.strokeStyle="#ffffff"; og.lineWidth=3; og.lineJoin="round";
  og.save();
  og.beginPath();
  {
    const toks=d.match(/[MCZ][^MCZ]*/g);
    for (const tk of toks){
      const cmd=tk[0]; const nums=(tk.slice(1).match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);
      if (cmd==="M") og.moveTo(mapX(nums[0]),mapY(nums[1]));
      else if (cmd==="C") og.bezierCurveTo(mapX(nums[0]),mapY(nums[1]),mapX(nums[2]),mapY(nums[3]),mapX(nums[4]),mapY(nums[5]));
      else if (cmd==="Z") og.closePath();
    }
  }
  og.stroke(); og.restore();
  og.fillStyle="#3fd0ff"; og.font="13px sans-serif"; og.fillText("source outline", pad, 18);
  og.fillStyle="#fff"; og.fillText("traced path", pad+120, 18);

  return {
    path: d,
    metrics: {
      sourceBox: bw+"x"+bh,
      aspect: Math.round((bw/bh)*100)/100,
      mapped: TW+"x"+(Math.round(TH*100)/100),
      cleftDepthPct: Math.round(((top[idxOf(0.5)] - Math.min(...top))/bh)*100),
      samples: SAMPLES,
      fitMeanPx: Math.round((eSum/curve.length)*100)/100,
      fitMaxPx: Math.round(eMax),
      fitMaxAt: eMaxAt ? "x"+eMaxAt[0]+" y"+eMaxAt[1] : null,
      apexCutPx: Math.round((apexSrc-apexOut)*10)/10,
      cleftCutPx: Math.round((cleftSrc-cleftOut)*10)/10,
      symmetryErrPx: Math.round(Math.max(...topRaw.map((v,i)=>Math.abs((v??0)-(topRaw[bw-1-i]??0))))),
    },
    png: out.toDataURL("image/png").split(",")[1],
  };
})()
`.replace("__B64__", b64).replace("__MIME__", mime);

const r = await evaluate(WORK);
if (r.err) {
  console.error(r.err);
  process.exit(1);
}
fs.writeFileSync("scripts/heart-trace-preview.png", Buffer.from(r.png, "base64"));
console.log("metrics:", JSON.stringify(r.metrics, null, 2));
console.log("\npath:\n" + r.path);
console.log("\npreview written to scripts/heart-trace-preview.png");
ws.close();
