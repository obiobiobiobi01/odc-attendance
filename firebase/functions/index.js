const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const {handlePunch}=require('./punch');
initializeApp();
const clinicIP=defineString('CLINIC_IPV4',{description:'Clinic public IPv4 address for clock-in/out'});
exports.clinicPunch=onCall({region:'asia-northeast1',minInstances:0,maxInstances:1,concurrency:10,memory:'256MiB',timeoutSeconds:30},request=>handlePunch({
  db:getFirestore(),auth:request.auth,data:request.data,
  header:request.rawRequest.headers['x-forwarded-for'],allowed:clinicIP.value(),Timestamp,
  fail:(code,message)=>new HttpsError(code,message)
}));
