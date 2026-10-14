const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(responses, configured=true) {
  const calls=[];
  const context={window:{ODC_CONFIG:configured?{url:'https://example.supabase.co',publishableKey:'sb_publishable_test',loginDomain:'odc.invalid'}:{}},AbortSignal,
    fetch:async(url,options)=>{calls.push({url,...options});const r=responses.shift();if(r instanceof Error)throw r;return {ok:(r.status||200)<400,status:r.status||200,json:async()=>r.body};}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/cloud.js','utf8'),context);
  return {api:context.window.ODCCloud,calls};
}
const auth={body:{access_token:'test-token',user:{id:'test-user'}}};
const membership=role=>({body:[{role}]});
const state={body:[{revision:3,payload:{staff:[]}}]};
test('unconfigured never sends credentials',async()=>{
 const {api,calls}=setup([],false);await assert.rejects(api.login('admin','x'));assert.equal(calls.length,0);
});
test('membership required even after valid authentication',async()=>{
 const {api}=setup([auth,{body:[]}]);await assert.rejects(api.login('staff01','x'));assert.equal(api.isAdmin(),false);
});
test('staff cannot save',async()=>{
 const {api,calls}=setup([auth,membership('staff'),state]);await api.login('staff01','x');await assert.rejects(api.save({}));assert.equal(calls.length,3);
});
test('admin sends revision and rejects stale conflict',async()=>{
 const {api,calls}=setup([auth,membership('admin'),state,{body:4},{body:null}]);await api.login('admin','x');await api.save({});await assert.rejects(api.save({}),/別の端末/);
 assert.equal(JSON.parse(calls[3].body).expected_revision,3);assert.equal(JSON.parse(calls[4].body).expected_revision,4);
 assert.equal(JSON.parse(calls[0].body).email,'admin@odc.invalid');
});
test('expired token removes admin permission',async()=>{
 const {api}=setup([auth,membership('admin'),state,{status:401}]);await api.login('admin','x');await assert.rejects(api.load());assert.equal(api.isAdmin(),false);
});
test('network failure never reports save success',async()=>{
 const {api}=setup([auth,membership('admin'),state,new Error('offline')]);await api.login('admin','x');await assert.rejects(api.save({}),/通信/);
});
test('logout clears permission even if network fails',async()=>{
 const {api}=setup([auth,membership('admin'),state,new Error('offline')]);await api.login('admin','x');await assert.rejects(api.logout());assert.equal(api.isAdmin(),false);
});
