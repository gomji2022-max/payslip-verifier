/* Qantas PaySlip Verifier - core app logic
   All data stored locally in the browser (localStorage). No server, no network calls. */

/* ---------------- Storage helpers ---------------- */
const LS_PROFILE = 'qpv_profile_v1';
const LS_SHIFTS = 'qpv_shifts_v1';
const LS_PAYSLIPS = 'qpv_payslips_v1';
const LS_OPEN = 'qpv_open_shift_v1';

function defaultProfile(){
  return {
    level: 'Level 5',
    dept: 'Airport Customer Experience',
    mascot: true,
    standardDailyHours: 7.6,
    // Rate history derived from the user's real payslips (BASIC / TRANSPORT / TEA move together on EBA increase day).
    rateHistory: [
      { from: '2025-01-01', base: 35.1301, transport: 11.93, tea: 18.36 },
      { from: '2026-07-01', base: 36.1837, transport: 12.32, tea: 19.08 }
    ]
  };
}

function loadProfile(){
  const raw = localStorage.getItem(LS_PROFILE);
  return raw ? JSON.parse(raw) : defaultProfile();
}
function saveProfile(p){ localStorage.setItem(LS_PROFILE, JSON.stringify(p)); }

function loadShifts(){
  const raw = localStorage.getItem(LS_SHIFTS);
  return raw ? JSON.parse(raw) : [];
}
function saveShifts(s){ localStorage.setItem(LS_SHIFTS, JSON.stringify(s)); }

function loadPayslips(){
  const raw = localStorage.getItem(LS_PAYSLIPS);
  return raw ? JSON.parse(raw) : [];
}
function savePayslips(p){ localStorage.setItem(LS_PAYSLIPS, JSON.stringify(p)); }

function loadOpenShift(){
  const raw = localStorage.getItem(LS_OPEN);
  return raw ? JSON.parse(raw) : null;
}
function saveOpenShift(o){
  if(o) localStorage.setItem(LS_OPEN, JSON.stringify(o));
  else localStorage.removeItem(LS_OPEN);
}

let profile = loadProfile();
let shifts = loadShifts();
let payslips = loadPayslips();

/* ---------------- Utilities ---------------- */
function pad(n){ return n.toString().padStart(2,'0'); }
function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function nowTimeStr(){ const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function timeToMinutes(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
function fmtHrs(h){ return (Math.round(h*100)/100).toFixed(2); }
function fmtMoney(n){ return '$' + (Math.round(n*100)/100).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function dow(dateStr){ return new Date(dateStr+'T00:00:00').getDay(); } // 0=Sun..6=Sat
function addDays(dateStr, n){
  const d = new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}
function uid(){ return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

function getRateForDate(dateStr){
  const hist = [...profile.rateHistory].sort((a,b)=> a.from < b.from ? -1 : 1);
  let chosen = hist[0];
  for(const h of hist){ if(h.from <= dateStr) chosen = h; }
  return chosen;
}

/* ---------------- Calculation engine ----------------
   Rules implemented (per the user's plan, EBA clauses 41.7 / 41.8.1 / 41.9.1(d) / 44.2.1):
   - Weekday time-of-day loading, whole-shift basis, priority 22.5% > 17.5% > 15% > 0%
   - Saturday: whole shift at 50% topup
   - Sunday / Public Holiday: whole shift at 100% topup
   - Hours beyond standardDailyHours -> O/TIME 200% (full 2x rate line, not also counted as BASIC)
   - "DO worked" flag -> entire shift treated as O/TIME 200% (this is an ASSUMPTION, not explicitly
     in the plan's clause list - flagged to the user as needing verification)
   - "48h notice change" flag -> overrides weekday/weekend tier with a flat 150% (50% topup) or
     200% (100% topup) for the whole shift, per clause 41.9.1(d)
   - Transport allowance: clock-out >=19:00, or clock-in <07:00, or (overnight) clock-out <07:00
   - Tea allowance: OT hours >= 1
*/
function decomposeShift(shift){
  const rate = getRateForDate(shift.date);
  const inMin = timeToMinutes(shift.clockIn);
  let outMin = timeToMinutes(shift.clockOut);
  let overnight = false;
  if(outMin <= inMin){ outMin += 24*60; overnight = true; }
  const breakMin = shift.breakMin || 0;
  const totalHours = Math.max(0, (outMin - inMin - breakMin) / 60);
  const std = profile.standardDailyHours;

  let normalHours = 0, otHours = 0, tier = '0', reason = '';

  if(shift.dayOffWorked){
    // Whole shift as overtime - ASSUMPTION, flagged in UI.
    otHours = totalHours;
    normalHours = 0;
    tier = 'do-ot';
    reason = 'DO worked (assumption: full O/TIME 200%)';
  } else {
    normalHours = Math.min(totalHours, std);
    otHours = Math.max(0, totalHours - std);

    if(shift.scheduleChange){
      tier = shift.scheduleChangePct === 200 ? '100' : '50';
      reason = `<48h notice change (${shift.scheduleChangePct}%)`;
    } else if(shift.publicHoliday || dow(shift.date) === 0){
      tier = '100';
      reason = shift.publicHoliday ? 'Public holiday' : 'Sunday';
    } else if(dow(shift.date) === 6){
      tier = '50';
      reason = 'Saturday';
    } else {
      const inTod = inMin % 1440;
      const outTod = outMin % 1440;
      const nightEnd = overnight && outTod < 8*60; // ended after midnight, before 08:00
      if((inTod >= 0 && inTod < 4*60) || nightEnd){
        tier = '22.5'; reason = '22.5% night';
      } else if(inTod >= 4*60 && inTod < 6*60){
        tier = '17.5'; reason = '17.5% early morning';
      } else if((inTod >= 6*60 && inTod < 7*60) || (outTod >= 18*60 && outTod < 24*60)){
        tier = '15'; reason = '15% morning/afternoon';
      } else {
        tier = '0'; reason = 'Weekday day shift';
      }
    }
  }

  const tierPct = { '0':0, '15':0.15, '17.5':0.175, '22.5':0.225, '50':0.5, '100':1.0 };
  const basicPay = normalHours * rate.base;
  const topupPay = tier === 'do-ot' ? 0 : normalHours * (tierPct[tier]||0) * rate.base;
  const otPay = otHours * rate.base * 2;

  // Allowances
  const inTod = inMin % 1440, outTod = outMin % 1440;
  let transportCount = 0;
  if(outTod >= 19*60 || inTod < 7*60 || (overnight && outTod < 7*60)) transportCount = 1;
  let teaCount = otHours >= 1 ? 1 : 0;
  const transportPay = transportCount * rate.transport;
  const teaPay = teaCount * rate.tea;

  const totalPay = basicPay + topupPay + otPay + transportPay + teaPay;

  return {
    id: shift.id, date: shift.date, totalHours, normalHours, otHours, tier, reason,
    basicPay, topupPay, otPay, transportCount, teaCount, transportPay, teaPay, totalPay,
    rate
  };
}

function aggregateBasic(fromDate, toDate){
  // BASIC hours = sum of normal (non-OT) hours for shifts in range, at each shift's own rate.
  let hours = 0, pay = 0;
  shifts.filter(s => s.date >= fromDate && s.date <= toDate).forEach(s=>{
    const d = decomposeShift(s);
    hours += d.normalHours;
    pay += d.basicPay;
  });
  return { hours, pay };
}

function aggregatePenalty(fromDate, toDate){
  const tiers = {'15':{hours:0,pay:0}, '17.5':{hours:0,pay:0}, '22.5':{hours:0,pay:0}, '50':{hours:0,pay:0}, '100':{hours:0,pay:0}};
  let otHours=0, otPay=0, transportCount=0, transportPay=0, teaCount=0, teaPay=0;
  shifts.filter(s => s.date >= fromDate && s.date <= toDate).forEach(s=>{
    const d = decomposeShift(s);
    if(tiers[d.tier]){ tiers[d.tier].hours += d.normalHours; tiers[d.tier].pay += d.topupPay; }
    otHours += d.otHours; otPay += d.otPay;
    transportCount += d.transportCount; transportPay += d.transportPay;
    teaCount += d.teaCount; teaPay += d.teaPay;
  });
  return { tiers, otHours, otPay, transportCount, transportPay, teaCount, teaPay };
}

/* ---------------- Tab navigation ---------------- */
function showTab(name){
  document.querySelectorAll('main > section').forEach(s=>s.classList.add('hidden'));
  document.getElementById('tab-'+name).classList.remove('hidden');
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  if(name==='log') renderLog();
  if(name==='settings') renderSettings();
  if(name==='verify') renderVerifySetup();
}
document.querySelectorAll('.tabbtn').forEach(b=> b.addEventListener('click', ()=> showTab(b.dataset.tab)));

/* ---------------- HOME tab ---------------- */
function renderHome(){
  document.getElementById('todayLabel').textContent = new Date().toLocaleDateString('en-AU',{month:'long',day:'numeric',weekday:'short'});
  const open = loadOpenShift();
  const pill = document.getElementById('statusPill');
  const btnIn = document.getElementById('btnClockIn');
  const btnOut = document.getElementById('btnClockOut');
  const info = document.getElementById('openShiftInfo');
  if(open){
    pill.textContent = 'On shift'; pill.className = 'status-pill pill-working';
    btnIn.disabled = true; btnOut.disabled = false;
    document.getElementById('clockInSub').textContent = `Started ${open.date} ${open.clockIn}`;
    document.getElementById('clockOutSub').textContent = '';
    info.classList.remove('hidden');
    info.textContent = `You clocked in at ${open.clockIn} on ${open.date}. Tap Clock Out when you finish.`;
    document.getElementById('qDayOff').checked = !!open.dayOffWorked;
    document.getElementById('qSchedChange').checked = !!open.scheduleChange;
    document.getElementById('qPublicHoliday').checked = !!open.publicHoliday;
    document.getElementById('qSchedPctWrap').classList.toggle('hidden', !open.scheduleChange);
    document.getElementById('qSchedPct').value = open.scheduleChangePct || 150;
  } else {
    pill.textContent = 'Off shift'; pill.className = 'status-pill pill-idle';
    btnIn.disabled = false; btnOut.disabled = true;
    document.getElementById('clockInSub').textContent = '';
    document.getElementById('clockOutSub').textContent = '';
    info.classList.add('hidden');
    document.getElementById('qDayOff').checked = false;
    document.getElementById('qSchedChange').checked = false;
    document.getElementById('qPublicHoliday').checked = false;
    document.getElementById('qSchedPctWrap').classList.add('hidden');
  }
  renderRecentShifts();
}

document.getElementById('btnClockIn').addEventListener('click', ()=>{
  const open = {
    date: todayStr(), clockIn: nowTimeStr(),
    dayOffWorked: document.getElementById('qDayOff').checked,
    scheduleChange: document.getElementById('qSchedChange').checked,
    scheduleChangePct: parseInt(document.getElementById('qSchedPct').value,10),
    publicHoliday: document.getElementById('qPublicHoliday').checked
  };
  saveOpenShift(open);
  toast('Clocked in at ' + open.clockIn);
  renderHome();
});

document.getElementById('btnClockOut').addEventListener('click', ()=>{
  const open = loadOpenShift();
  if(!open) return;
  // re-read latest checkbox state at clock-out time too (covers forgetting to check at clock-in)
  open.dayOffWorked = document.getElementById('qDayOff').checked || open.dayOffWorked;
  open.scheduleChange = document.getElementById('qSchedChange').checked || open.scheduleChange;
  open.scheduleChangePct = parseInt(document.getElementById('qSchedPct').value,10) || open.scheduleChangePct || 150;
  open.publicHoliday = document.getElementById('qPublicHoliday').checked || open.publicHoliday;
  const shift = {
    id: uid(), date: open.date, clockIn: open.clockIn, clockOut: nowTimeStr(),
    breakMin: 0, dayOffWorked: open.dayOffWorked, scheduleChange: open.scheduleChange,
    scheduleChangePct: open.scheduleChangePct, publicHoliday: open.publicHoliday, note: '', manual: false
  };
  shifts.push(shift); saveShifts(shifts);
  saveOpenShift(null);
  toast('Clocked out. Shift saved');
  renderHome();
});

document.getElementById('qSchedChange').addEventListener('change', (e)=>{
  document.getElementById('qSchedPctWrap').classList.toggle('hidden', !e.target.checked);
});

function tagsForShift(s){
  const tags = [];
  if(s.dayOffWorked) tags.push(['DO worked (assumption)','warn']);
  if(s.scheduleChange) tags.push([`<48h notice ${s.scheduleChangePct}%`,'warn']);
  if(s.publicHoliday) tags.push(['Public holiday','ot']);
  if(s.manual) tags.push(['Manual entry','']);
  return tags;
}

function renderRecentShifts(){
  const wrap = document.getElementById('recentShifts');
  const recent = [...shifts].sort((a,b)=> b.date.localeCompare(a.date) || b.clockIn.localeCompare(a.clockIn)).slice(0,5);
  if(recent.length===0){ wrap.innerHTML = '<div class="empty">No shifts logged yet. Tap Clock In to get started.</div>'; return; }
  wrap.innerHTML = recent.map(s=>{
    const d = decomposeShift(s);
    const tags = tagsForShift(s).map(([t,c])=>`<span class="tag ${c}">${t}</span>`).join('');
    const otTag = d.otHours>0 ? `<span class="tag ot">OT ${fmtHrs(d.otHours)}h</span>` : '';
    return `<div class="shift-item">
      <div class="top"><span class="date">${s.date}</span><span class="time">${s.clockIn}–${s.clockOut}</span></div>
      <div class="time">${fmtHrs(d.totalHours)}h · ${d.reason} · est. ${fmtMoney(d.totalPay)}</div>
      <div class="tags">${tags}${otTag}</div>
    </div>`;
  }).join('');
}

/* ---------------- LOG tab ---------------- */
function renderLog(){
  const wrap = document.getElementById('allShifts');
  const sorted = [...shifts].sort((a,b)=> b.date.localeCompare(a.date));
  if(sorted.length===0){ wrap.innerHTML = '<div class="empty">No shifts logged yet.</div>'; return; }
  wrap.innerHTML = sorted.map(s=>{
    const d = decomposeShift(s);
    const tags = tagsForShift(s).map(([t,c])=>`<span class="tag ${c}">${t}</span>`).join('');
    const otTag = d.otHours>0 ? `<span class="tag ot">OT ${fmtHrs(d.otHours)}h</span>` : '';
    return `<div class="shift-item">
      <div class="top"><span class="date">${s.date}</span>
        <span>
          <button class="btn-ghost" data-edit="${s.id}">Edit</button>
          <button class="btn-ghost danger-text" data-del="${s.id}">Delete</button>
        </span>
      </div>
      <div class="time">${s.clockIn}–${s.clockOut} · ${fmtHrs(d.totalHours)}h · ${d.reason}</div>
      <div class="time">Est. pay ${fmtMoney(d.totalPay)} (base ${fmtMoney(d.basicPay)} + loading ${fmtMoney(d.topupPay)} + OT ${fmtMoney(d.otPay)} + allowances ${fmtMoney(d.transportPay+d.teaPay)})</div>
      <div class="tags">${tags}${otTag}</div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=> openShiftForm(b.dataset.edit)));
  wrap.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{
    if(confirm('Delete this shift?')){
      shifts = shifts.filter(s=>s.id!==b.dataset.del); saveShifts(shifts); renderLog(); renderHome();
    }
  }));
}

document.getElementById('btnAddManual').addEventListener('click', ()=> openShiftForm(null));

function openShiftForm(id){
  const existing = id ? shifts.find(s=>s.id===id) : null;
  const s = existing || { id: uid(), date: todayStr(), clockIn:'06:45', clockOut:'14:15', breakMin:0,
    dayOffWorked:false, scheduleChange:false, scheduleChangePct:150, publicHoliday:false, note:'', manual:true };
  const wrap = document.getElementById('allShifts');
  const formHtml = `
  <div class="card" id="shiftFormCard" style="border:2px solid var(--red);">
    <h2>${existing ? 'Edit shift' : 'Add shift manually'}</h2>
    <div class="field"><label>Date</label><input type="date" id="fDate" value="${s.date}"></div>
    <div class="row2">
      <div class="field"><label>Clock in</label><input type="time" id="fIn" value="${s.clockIn}"></div>
      <div class="field"><label>Clock out</label><input type="time" id="fOut" value="${s.clockOut}"></div>
    </div>
    <div class="field"><label>Unpaid break (min)</label><input type="number" id="fBreak" value="${s.breakMin||0}"></div>
    <div class="checkrow"><input type="checkbox" id="fDayOff" ${s.dayOffWorked?'checked':''}><label for="fDayOff">DO (day off) worked (assumption)</label></div>
    <div class="checkrow"><input type="checkbox" id="fSched" ${s.scheduleChange?'checked':''}><label for="fSched">&lt;48h notice change</label></div>
    <div class="field" id="fSchedPctWrap" style="${s.scheduleChange?'':'display:none;'}">
      <label>Penalty</label>
      <select id="fSchedPct"><option value="150" ${s.scheduleChangePct==150?'selected':''}>150%</option><option value="200" ${s.scheduleChangePct==200?'selected':''}>200%</option></select>
    </div>
    <div class="checkrow"><input type="checkbox" id="fPH" ${s.publicHoliday?'checked':''}><label for="fPH">Public holiday</label></div>
    <div class="row2">
      <button class="btn btn-primary btn-block" id="fSave">Save</button>
      <button class="btn btn-secondary btn-block" id="fCancel">Cancel</button>
    </div>
  </div>`;
  document.getElementById('shiftFormCard')?.remove();
  wrap.insertAdjacentHTML('beforebegin', formHtml);
  document.getElementById('fSched').addEventListener('change', e=>{
    document.getElementById('fSchedPctWrap').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('fCancel').addEventListener('click', ()=> document.getElementById('shiftFormCard').remove());
  document.getElementById('fSave').addEventListener('click', ()=>{
    const newShift = {
      id: s.id,
      date: document.getElementById('fDate').value,
      clockIn: document.getElementById('fIn').value,
      clockOut: document.getElementById('fOut').value,
      breakMin: parseInt(document.getElementById('fBreak').value||'0',10),
      dayOffWorked: document.getElementById('fDayOff').checked,
      scheduleChange: document.getElementById('fSched').checked,
      scheduleChangePct: parseInt(document.getElementById('fSchedPct').value,10),
      publicHoliday: document.getElementById('fPH').checked,
      note: '', manual: true
    };
    if(existing){ shifts = shifts.map(x=> x.id===s.id ? newShift : x); }
    else { shifts.push(newShift); }
    saveShifts(shifts);
    document.getElementById('shiftFormCard').remove();
    renderLog(); renderHome();
    toast('Saved');
  });
}

/* ---------------- SETTINGS tab ---------------- */
function renderSettings(){
  document.getElementById('pLevel').value = profile.level;
  document.getElementById('pDept').value = profile.dept;
  document.getElementById('pMascot').checked = profile.mascot;
  document.getElementById('pStdHours').value = profile.standardDailyHours;
  renderRateHist();
  updateAllowanceNote();
}
['pLevel','pDept','pMascot','pStdHours'].forEach(id=>{
  document.getElementById(id).addEventListener('change', ()=>{
    profile.level = document.getElementById('pLevel').value;
    profile.dept = document.getElementById('pDept').value;
    profile.mascot = document.getElementById('pMascot').checked;
    profile.standardDailyHours = parseFloat(document.getElementById('pStdHours').value)||7.6;
    saveProfile(profile);
    document.getElementById('headerSub').textContent = `${profile.level} · ${profile.dept}`;
    renderHome();
    toast('Profile saved');
  });
});

function renderRateHist(){
  const wrap = document.getElementById('rateHistList');
  const sorted = [...profile.rateHistory].sort((a,b)=> a.from < b.from ? -1:1);
  wrap.innerHTML = sorted.map((h,idx)=>`
    <div class="rate-hist-item">
      <div class="row2">
        <div class="field"><label>Effective from</label><input type="date" data-i="${idx}" data-k="from" value="${h.from}" class="rh-input"></div>
        <div class="field"><label>Base hourly rate</label><input type="number" step="0.0001" data-i="${idx}" data-k="base" value="${h.base}" class="rh-input"></div>
      </div>
      <div class="row2">
        <div class="field"><label>Transport ($/occurrence)</label><input type="number" step="0.01" data-i="${idx}" data-k="transport" value="${h.transport}" class="rh-input"></div>
        <div class="field"><label>Tea ($/occurrence)</label><input type="number" step="0.01" data-i="${idx}" data-k="tea" value="${h.tea}" class="rh-input"></div>
      </div>
      <button class="btn-ghost danger-text" data-delrate="${idx}">Delete this entry</button>
    </div>`).join('');
  wrap.querySelectorAll('.rh-input').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const sortedArr = [...profile.rateHistory].sort((a,b)=> a.from < b.from ? -1:1);
      const i = parseInt(inp.dataset.i,10), k = inp.dataset.k;
      sortedArr[i][k] = (k==='from') ? inp.value : parseFloat(inp.value);
      profile.rateHistory = sortedArr;
      saveProfile(profile);
      renderHome(); updateAllowanceNote();
      toast('Rate history saved');
    });
  });
  wrap.querySelectorAll('[data-delrate]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const sortedArr = [...profile.rateHistory].sort((a,b)=> a.from < b.from ? -1:1);
      sortedArr.splice(parseInt(b.dataset.delrate,10),1);
      profile.rateHistory = sortedArr.length ? sortedArr : [defaultProfile().rateHistory[0]];
      saveProfile(profile); renderRateHist(); toast('Deleted');
    });
  });
}
document.getElementById('btnAddRate').addEventListener('click', ()=>{
  const last = [...profile.rateHistory].sort((a,b)=> a.from<b.from?-1:1).slice(-1)[0];
  profile.rateHistory.push({ from: todayStr(), base: last.base, transport: last.transport, tea: last.tea });
  saveProfile(profile); renderRateHist(); toast('New entry added. Edit the values');
});
function updateAllowanceNote(){
  const r = getRateForDate(todayStr());
  document.getElementById('allowanceRatesNote').textContent =
    `Rates in effect today (${todayStr()}) — base ${fmtMoney(r.base)}/h, 15% loading ${fmtMoney(r.base*0.15)}, 17.5% loading ${fmtMoney(r.base*0.175)}, 22.5% loading ${fmtMoney(r.base*0.225)}, Saturday (50%) ${fmtMoney(r.base*0.5)}, Sunday/public holiday (100%) ${fmtMoney(r.base*1.0)}, O/TIME 200% ${fmtMoney(r.base*2)}, Transport ${fmtMoney(r.transport)}, Tea ${fmtMoney(r.tea)}.`;
}

/* Export / Import */
document.getElementById('btnExport').addEventListener('click', ()=>{
  const data = { profile, shifts, payslips, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `qpv-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
document.getElementById('btnImport').addEventListener('click', ()=> document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change', (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if(data.profile) profile = data.profile;
      if(data.shifts) shifts = data.shifts;
      if(data.payslips) payslips = data.payslips;
      saveProfile(profile); saveShifts(shifts); savePayslips(payslips);
      renderHome(); renderSettings();
      toast('Import complete');
    }catch(err){ alert('There was an error reading the file: '+err.message); }
  };
  reader.readAsText(file);
});

/* ---------------- VERIFY tab ---------------- */
const PAYSLIP_FIELD_DEFS = [
  { key:'basic', label:'BASIC', unit:'hours', pctForRate:0, useBasicRate:true },
  { key:'p15', label:'15% SHIFT', unit:'hours', pctForRate:0.15 },
  { key:'p175', label:'17.5% SHIFT', unit:'hours', pctForRate:0.175 },
  { key:'p225', label:'22.5% SHIFT', unit:'hours', pctForRate:0.225 },
  { key:'p50', label:'50% SHIFT (Saturday)', unit:'hours', pctForRate:0.5 },
  { key:'p100', label:'100% SHIFT (Sunday/PH)', unit:'hours', pctForRate:1.0 },
  { key:'ot200', label:'O/TIME 200%', unit:'hours', pctForRate:2.0, fullRate:true },
  { key:'transport', label:'TRANSPORT', unit:'count', isAllowance:'transport' },
  { key:'tea', label:'TEA', unit:'count', isAllowance:'tea' }
];

function renderVerifySetup(){
  if(!document.getElementById('vPeriodEnd').value){
    document.getElementById('vPeriodEnd').value = todayStr();
    syncVerifyRanges();
  }
  renderPayslipFields();
  document.getElementById('compareResult').innerHTML = '';
}
document.getElementById('vPeriodEnd').addEventListener('change', syncVerifyRanges);
function syncVerifyRanges(){
  const end = document.getElementById('vPeriodEnd').value;
  if(!end) return;
  document.getElementById('vBasicEnd').value = end;
  document.getElementById('vBasicStart').value = addDays(end, -13);
  document.getElementById('vPenEnd').value = addDays(end, -7);
  document.getElementById('vPenStart').value = addDays(end, -20);
}

let otherLineCount = 0;
function renderPayslipFields(){
  const wrap = document.getElementById('payslipFields');
  wrap.innerHTML = PAYSLIP_FIELD_DEFS.map(f=>`
    <div class="field">
      <label>${f.label} (${f.unit})</label>
      <input type="number" step="0.01" id="ps_${f.key}" placeholder="0">
    </div>`).join('');
  document.getElementById('otherLines').innerHTML = '';
  otherLineCount = 0;
}
document.getElementById('btnAddOtherLine').addEventListener('click', ()=>{
  const wrap = document.getElementById('otherLines');
  const i = otherLineCount++;
  const div = document.createElement('div');
  div.className = 'row2';
  div.innerHTML = `<div class="field"><label>Item name</label><input type="text" class="other-label" placeholder="e.g. SPEC-PENLTY"></div>
                    <div class="field"><label>Amount ($)</label><input type="number" step="0.01" class="other-amount" placeholder="0"></div>`;
  wrap.appendChild(div);
});

document.getElementById('btnCalcApp').addEventListener('click', ()=>{
  const bStart = document.getElementById('vBasicStart').value;
  const bEnd = document.getElementById('vBasicEnd').value;
  const pStart = document.getElementById('vPenStart').value;
  const pEnd = document.getElementById('vPenEnd').value;
  if(!bStart||!bEnd||!pStart||!pEnd){ toast('Please fill in all date ranges'); return; }
  const basicAgg = aggregateBasic(bStart, bEnd);
  const penAgg = aggregatePenalty(pStart, pEnd);
  window.__lastAppCalc = { basicAgg, penAgg };
  toast('App calculation done. Enter your payslip numbers below, then tap Compare');
  document.getElementById('payslipInputCard').scrollIntoView({behavior:'smooth'});
});

document.getElementById('btnCompare').addEventListener('click', ()=>{
  if(!window.__lastAppCalc){ toast('Tap ① Calculate from my logged shifts first'); return; }
  const { basicAgg, penAgg } = window.__lastAppCalc;
  const bEnd = document.getElementById('vBasicEnd').value;
  const rate = getRateForDate(bEnd);

  const appVals = {
    basic: basicAgg.hours,
    p15: penAgg.tiers['15'].hours,
    p175: penAgg.tiers['17.5'].hours,
    p225: penAgg.tiers['22.5'].hours,
    p50: penAgg.tiers['50'].hours,
    p100: penAgg.tiers['100'].hours,
    ot200: penAgg.otHours,
    transport: penAgg.transportCount,
    tea: penAgg.teaCount
  };
  const appPay = {
    basic: basicAgg.pay,
    p15: penAgg.tiers['15'].pay,
    p175: penAgg.tiers['17.5'].pay,
    p225: penAgg.tiers['22.5'].pay,
    p50: penAgg.tiers['50'].pay,
    p100: penAgg.tiers['100'].pay,
    ot200: penAgg.otPay,
    transport: penAgg.transportPay,
    tea: penAgg.teaPay
  };

  let rows = '';
  let totalAppPay = 0, totalPayslipPay = 0, anyDiff = false;
  PAYSLIP_FIELD_DEFS.forEach(f=>{
    const inputEl = document.getElementById('ps_'+f.key);
    const psHrs = parseFloat(inputEl.value || '0');
    const appHrs = appVals[f.key] || 0;
    let psPay;
    if(f.key==='transport') psPay = psHrs * rate.transport;
    else if(f.key==='tea') psPay = psHrs * rate.tea;
    else if(f.fullRate) psPay = psHrs * rate.base * 2;
    else if(f.key==='basic') psPay = psHrs * rate.base;
    else psPay = psHrs * rate.base * f.pctForRate;
    const aPay = appPay[f.key] || 0;
    totalAppPay += aPay; totalPayslipPay += psPay;
    const diffHrs = Math.abs(appHrs - psHrs);
    const isDiff = diffHrs > 0.15;
    if(isDiff) anyDiff = true;
    rows += `<tr class="${isDiff?'diff':'ok'}">
      <td>${f.label}</td>
      <td>${fmtHrs(appHrs)}</td>
      <td>${fmtHrs(psHrs)}</td>
      <td>${fmtMoney(aPay)}</td>
      <td>${fmtMoney(psPay)}</td>
      <td>${isDiff ? (aPay>psPay?'−':'+')+fmtMoney(Math.abs(aPay-psPay)) : '✓'}</td>
    </tr>`;
  });

  // other lines
  let otherTotal = 0;
  document.querySelectorAll('#otherLines .row2').forEach(row=>{
    const label = row.querySelector('.other-label').value || 'Other';
    const amt = parseFloat(row.querySelector('.other-amount').value||'0');
    otherTotal += amt;
    totalPayslipPay += amt;
  });

  rows += `<tr class="totalrow"><td>Total</td><td></td><td></td><td>${fmtMoney(totalAppPay)}</td><td>${fmtMoney(totalPayslipPay)}</td><td>${fmtMoney(totalPayslipPay-totalAppPay)}</td></tr>`;

  const html = `
    <table class="calc">
      <thead><tr><th>Item</th><th>App (hrs/count)</th><th>Payslip</th><th>App est. $</th><th>Payslip $</th><th>Diff</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note">The "Other items" total (SPEC-PENLTY etc.) of ${fmtMoney(otherTotal)} is reference-only and added to the payslip total, but is not auto-verified.</p>
    ${anyDiff ? '<p class="note danger-text">⚠️ Rows highlighted in red differ by more than 0.15 hours. Double-check your actual roster/shift log for those items.</p>' : '<p class="note" style="color:var(--green)">✅ App calculations and your payslip mostly line up for this range.</p>'}
  `;
  document.getElementById('compareResult').innerHTML = html;
});

/* ---------------- init ---------------- */
document.getElementById('headerSub').textContent = `${profile.level} · ${profile.dept}`;
renderHome();

/* Register service worker for installability (best-effort, ignore failures e.g. on file://) */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
