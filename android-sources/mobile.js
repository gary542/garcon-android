if (!Object.fromEntries) Object.fromEntries = entries => {const obj={}; for(const [k,v] of entries)obj[k]=v;return obj;};
if (!Array.prototype.at) Array.prototype.at=function(i){return this[i<0?this.length+i:i];};
if (!window.structuredClone) window.structuredClone = value => JSON.parse(JSON.stringify(value));
const onHost = Mobile.hosting();
let needsSetup = false;
let nextRequest = 0;
const waiting = new Map();
window.cafeResult = (id, envelope) => {const callback=waiting.get(id); if(callback){waiting.delete(id);callback(envelope);}};
function callCafe(path,data) {
  return new Promise((resolve,reject)=>{
    const id=++nextRequest;
    const timeout=setTimeout(()=>{waiting.delete(id);reject(new Error("Host timeout"));},100000);
    waiting.set(id,value=>{clearTimeout(timeout);resolve(value);});
    Mobile.request(id,path,JSON.stringify(data));
  });
}
