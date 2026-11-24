// The host is the only writer. Session and pairing tokens travel inside pinned TLS.
// API images use the same authenticated role session as commands and state reads.
class AndroidDatabase {
  exec(sql) { dbCall("exec",sql,[]); }
  close() {}
  prepare(sql) {
    return {
      run: (...args) => dbCall("run", sql, args),
      all: (...args) => dbCall("query", sql, args),
      get: (...args) => dbCall("query", sql, args)[0]
    };
  }
}
function dbCall(op,sql,args) {
  const r=JSON.parse(Native.sql(op,sql,JSON.stringify(args)));
  if(r.error) throw new Error(r.error);
  return r.value;
}
const store = new Store();
store.purgeExpired();
let lastMaintenance = Date.now();
const localSetupToken = "single-device-owner-setup";
function route(payload, peer, local) {
  try {
    if(Date.now()-lastMaintenance > 60000) {store.purgeExpired(); lastMaintenance=Date.now();}
    const { path, data, session = "", pair = "" } = JSON.parse(payload);
    const [name, query = ""] = path.split("?");
    const ok=(data, auth={})=>JSON.stringify({status:200,data,auth});
    if(name==="info") return ok({empty:!store.db.prepare("SELECT id FROM cafes LIMIT 1").get()});
    if(name==="setup"){
      if(!local || store.db.prepare("SELECT id FROM cafes LIMIT 1").get()) throw new Problem("Set up the café on its host phone.",403);
      const cafe=store.provision(data.name,data.email,data.password,localSetupToken);
      return ok({ok:true},{session:store.session(cafe)});
    }
    if(name==="login") return ok({ok:true},{session:store.login(data.email,data.password,peer)});
    if(name==="team-login"){
      const token=store.teamLogin(data.email,data.password,peer);
      if(pair) store.teamLogout(pair);
      if(session) store.logout(session);
      return ok({ok:true},{pair:token,session:""});
    }
    if(name==="team-logout"){if(pair)store.teamLogout(pair);if(session)store.logout(session);return ok({ok:true},{pair:"",session:""});}
    if(name==="staff-login")return ok({ok:true},{session:store.staffLogin(pair,data.slot)});
    if(name==="logout"){if(session)store.logout(session);return ok({ok:true},{session:""});}
    if(name==="pair"){try{return ok(store.teamProfiles(pair));}catch(e){return ok({team:false,slots:null});}}
    const actor=store.actor(session);
    if(name==="state"){
      const parameters=Object.fromEntries(query.split("&").filter(Boolean).map(x=>x.split("=").map(decodeURIComponent)));
      const today=day();
      if(parameters.version===String(store.row(actor.cafe).version) && parameters.cafe===actor.cafe && parameters.actor===actor.id && parameters.clientDay===today)
        return ok({unchanged:true,actor,day:today});
      return ok({actor,day:today,state:store.publicState(actor.cafe,actor)});
    }
    if(name==="command") return ok(store.command(actor,data.key,data.command));
    if(name==="unpair"){if(actor.role!=="Owner")throw new Problem("Owner access required.",403);store.revokeDevices(actor.cafe);return ok({ok:true});}
    if(/^image\/[0-9a-f]{64}$/.test(name)){
      const photo=store.db.prepare("SELECT data FROM images WHERE cafe=? AND id=?").get(actor.cafe,name.slice(6));
      if(!photo)throw new Problem("Photo unavailable.",404);return ok({image:photo.data});
    }
    throw new Problem("Unknown action.",404);
  } catch(e) {return JSON.stringify({status:e.status||500,data:{error:e.status?e.message:"Could not complete the action. Retry using the same submission reference."}});}
}
globalThis.Service = { handle: route };
