// All month boundaries use the Japanese calendar; stored day is the JST epoch day.
export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('対象月を選んでください。');
  const [year,m]=month.split('-').map(Number);
  if(year<2000 || year>2200) throw Error('対象月は2000〜2200年で指定してください。');
  return [Date.UTC(year,m-1,1)/86400000,Date.UTC(year,m,1)/86400000];
}
export const dayLabel=day=>new Date(day*86400000).toISOString().slice(0,10);
export function duration(ms) {
  if(ms==null) return '—';
  const seconds=Math.floor(ms/1000);
  return `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
export function calculate(record,review) {
  if(!record.clockIn?.toMillis || !record.clockOut?.toMillis) return {gross:null,net:null,status:'退勤未打刻'};
  const gross=record.clockOut.toMillis()-record.clockIn.toMillis();
  if(gross<0) return {gross:null,net:null,status:'時刻要確認'};
  const rest=review?.breakMinutes;
  if(!Number.isInteger(rest) || rest<0 || rest*60000>gross) return {gross,net:null,status:'休憩未確認'};
  return {gross,net:gross-rest*60000,status:review.source==='automatic'?'自動（60分）':'確認済み'};
}
export function totals(rows) {
  return rows.reduce((s,r)=>{s.days++; if(r.net==null) s.pending++; else {s.confirmed++;s.net+=r.net;} if(r.gross!=null)s.gross+=r.gross;return s;},{days:0,confirmed:0,pending:0,gross:0,net:0});
}
export const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
