import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,Timestamp,getDoc} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-odc-ui',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
const db=env.authenticatedContext('admin',{email:'omotesandodc@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const dom=new JSDOM(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'));
globalThis.document=dom.window.document;
const moduleSource=readFileSync(new URL('../public/admin-attendance.js',import.meta.url),'utf8').replace('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js',import.meta.resolve('firebase/firestore')).replace('./attendance-report.js',new URL('../public/attendance-report.js',import.meta.url).href);
const {setupAttendance}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
const $=id=>document.getElementById(id);
const config={staff:['A','B','','','',''],emails:['a@example.com','b@example.com','','','',''],patterns:{}};
const downloads=[];
const report=setupAttendance({db,auth:{currentUser:{uid:'admin'}},getConfig:()=>config,download:(...args)=>downloads.push(args)});
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();await setDoc(doc(db,'settings','clinic'),config);
  await setDoc(doc(db,'staffProfiles','a'),{email:'a@example.com',name:'A',slot:0});
  const data={day:20741,clockIn:Timestamp.fromDate(new Date('2026-10-15T12:22:31+09:00')),clockOut:Timestamp.fromDate(new Date('2026-10-15T16:33:56+09:00'))};
  await setDoc(doc(db,'attendance','a'),data);await setDoc(doc(db,'attendance','a','days','20741'),data);
 });
 report.reset(true);$('reportMonth').value='2026-10';await $('loadReport').onclick();
 assert.match($('reportRows').textContent,/4:11:25/);assert.match($('reportRows').textContent,/休憩未確認/);
 assert.equal($('reportRows').rows.length,1);assert.equal($('reportSummary').rows.length,1);
 $('reportRows').querySelector('input').value='60';await $('reportRows').querySelector('button').onclick();
 assert.equal((await getDoc(doc(db,'attendance','a','reviews','20741'))).data().breakMinutes,60);
 assert.match($('reportSummary').textContent,/3:11:25/);
 $('reportCsv').onclick();$('summaryCsv').onclick();assert.equal(downloads.length,2);assert.match(downloads[1][1],/3:11:25/);
 $('reportMonth').value='2026-11';$('reportMonth').onchange();assert.equal($('reportCsv').disabled,true);await $('loadReport').onclick();
 assert.equal($('reportRows').rows.length,0);assert.match($('reportStatus').textContent,/ありません/);
 $('reportMonth').value='2026-10';$('reportMonth').onchange();const pending=$('loadReport').onclick();report.reset(false);await pending;
 assert.equal($('adminAttendance').hidden,true);assert.equal($('reportRows').rows.length,0);$('reportCsv').onclick();assert.equal(downloads.length,2);
 console.log('PASS UI: server load, rest save, calculated totals, two CSVs, empty month, stale request cleared on logout');
}finally{await env.cleanup();dom.window.close();}
