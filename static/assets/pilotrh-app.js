/* ============================================================================
   PilotRH — interface RH · noyau applicatif (1/2)
   État, accès réseau fiable, chargement fenêtré, coquille, tableau de bord,
   feuille de pointage, paramètres horaires, import.
   ============================================================================ */
'use strict';
const C = window.PilotRHCore;
const { pad, isoOf, toMin, fromMin, hDec, fr2, hLabel, esc, escJs } = C;

/* ------------------------------------------------------------------- icônes */
const I = {
  grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M21 20c0-2.5-1.6-4.7-4-5.6"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  calx:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M9.5 14.5l5 3M14.5 14.5l-5 3"/></svg>',
  late:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M5 4 8 6M19 4l-3 2"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  report:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 12v5M12 9v8M16 13v4"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  leaf:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 20a7 7 0 0 1-7-7c0-5 5-9 16-9 0 8-4 13-9 13z"/><path d="M4 20c4-5 7-7 12-9"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l1.8 4.8L18 9.5l-4.2 1.7L12 16l-1.8-4.8L6 9.5l4.2-1.7z"/><path d="M19 14l.7 1.9L21.5 17l-1.8.7L19 19.5l-.7-1.8L16.5 17l1.8-.6z"/></svg>',
  shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V6M5 12l7-7 7 7"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a4 4 0 0 1 .5 8.97"/><path d="M12 12v6M9 15l3-3 3 3"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  filter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>',
  cake:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 21h16M5 21v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"/><path d="M12 8V5M9 6V4M15 6V4M4 16c2 0 2 1.5 4 1.5S12 16 12 16s2 1.5 4 1.5S20 16 20 16"/></svg>',
  briefcase:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  scissors:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8 20 19M8.5 16 20 5"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  chevL:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  chevR:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
};
window.I = I;

/* --------------------------------------------------------------- constantes */
const SERVICES = ['Couture','Coupe','Finition','Repassage','Qualité','Méthodes','Magasin'];
const ATELIERS = ['Atelier A','Atelier B','Atelier C'];
const POSTES = ['Couturière piqueuse','Mécanicienne','Repasseuse','Contrôleuse qualité','Coupeuse','Finition main','Chef d’atelier','Agent de méthode','Préparatrice','Magasinier'];
const CONTRATS = ['CDI','CDD','CIVP','SIVP'];
const AV_COLORS = ['#96382a','#a3822f','#276b48','#3d52a8','#68489a','#0b7373','#8e4736','#4b5c26'];
const DAYS_FR = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
Object.assign(window, { SERVICES, ATELIERS, POSTES, CONTRATS, DAYS_FR, MOIS_FR });

/* ---------------------------------------------------------------- utilitaires */
const $ = s => document.querySelector(s);
const today = new Date();
const TODAY = isoOf(today);
window.TODAY = TODAY;
function initials(n){const p=String(n||'').trim().split(/\s+/);return ((p[0]||'')[0]||'')+((p[1]||'')[0]||'')}
function avColor(n){let h=0;for(const c of String(n||''))h=(h*31+c.charCodeAt(0))>>>0;return AV_COLORS[h%AV_COLORS.length]}
function age(d){if(!d)return 0;const b=new Date(d);if(isNaN(b))return 0;let a=today.getFullYear()-b.getFullYear();if(today.getMonth()<b.getMonth()||(today.getMonth()===b.getMonth()&&today.getDate()<b.getDate()))a--;return a}
function anciennete(d){if(!d)return 0;const b=new Date(d);return isNaN(b)?0:(today-b)/(365.25*864e5)}
function ancLabel(d){if(!d)return '—';const y=anciennete(d);const yr=Math.floor(y);const mo=Math.round((y-yr)*12);return yr+' an'+(yr>1?'s':'')+(mo?' '+mo+' mois':'')}
function fmtDate(d){if(!d)return '—';const x=new Date(d);return isNaN(x)?String(d):pad(x.getDate())+'/'+pad(x.getMonth()+1)+'/'+x.getFullYear()}
function fmtJour(iso){return new Date(iso+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}
function monthBounds(ym){const[y,mo]=ym.split('-').map(Number);return[ym+'-01',isoOf(new Date(y,mo,0))]}
function addDays(iso,n){const d=new Date(iso+'T12:00');d.setDate(d.getDate()+n);return isoOf(d)}
function eachDay(a,b,fn){const end=new Date(b+'T12:00');for(let d=new Date(a+'T12:00');d<=end;d.setDate(d.getDate()+1))fn(isoOf(d))}
function pct(n,d){return d?Math.round(n/d*100):0}
Object.assign(window,{$,initials,avColor,age,anciennete,ancLabel,fmtDate,fmtJour,monthBounds,addDays,eachDay,pct});

/* ------------------------------------------------------------------- toasts */
function toast(msg,type='ok',duree){
  const t=document.createElement('div');
  t.className='toast '+type;
  t.innerHTML=(type==='ok'?I.check:I.warn)+'<span>'+esc(msg)+'</span>';
  $('#toasts').appendChild(t);
  setTimeout(()=>{t.style.opacity=0;t.style.transform='translateX(20px)';setTimeout(()=>t.remove(),300)},duree||(type==='ok'?3200:6000));
}
window.toast=toast;

/* ============================================================================
   ACCÈS RÉSEAU FIABLE
   Auparavant chaque écriture finissait par `.catch(()=>{})` : une coupure
   réseau, un 403 « lecture seule » ou un 500 serveur laissaient l'écran afficher
   une correction qui n'avait jamais été enregistrée. Désormais toute écriture
   qui échoue est conservée dans une file, signalée dans un bandeau permanent, et
   réessayable en un clic.
   ============================================================================ */
let PENDING = [];                    // écritures non confirmées
let OFFLINE = false;

async function api(url, opts){
  const o = Object.assign({headers:{}}, opts||{});
  if(o.body && !(o.body instanceof FormData)){
    o.headers['Content-Type']='application/json';
    if(typeof o.body!=='string')o.body=JSON.stringify(o.body);
  }
  let r;
  try{ r = await fetch(url,o); }
  catch(e){ const err=new Error('Connexion au serveur impossible'); err.reseau=true; throw err; }
  if(r.status===401){ location.href='/login'; throw new Error('Session expirée'); }
  const txt = await r.text();
  let data = null;
  try{ data = txt ? JSON.parse(txt) : null; }catch(e){ data = null; }
  if(!r.ok){
    const err = new Error((data && data.error) || ('Erreur serveur '+r.status));
    err.status = r.status; err.data = data;
    throw err;
  }
  return data;
}
window.api = api;

function majBandeauSync(){
  const b = $('#syncbar');
  if(!b) return;
  if(!PENDING.length){ b.classList.remove('on'); b.innerHTML=''; return; }
  const n = PENDING.length;
  b.className = 'banner banner-err on';
  b.innerHTML = I.warn +
    '<div class="grow"><b>'+n+' modification'+(n>1?'s':'')+' non enregistrée'+(n>1?'s':'')+'.</b> '+
    esc(PENDING[0].label||'')+(n>1?' …':'')+'</div>'+
    '<button class="btn btn-gold" onclick="rejouerEcritures()">'+I.refresh+' Réessayer</button>'+
    '<button class="btn btn-ghost" onclick="abandonnerEcritures()">Abandonner</button>';
}

/* Écriture « garantie » : on tente, et si ça échoue on garde la trace. */
async function ecrire(url, body, label){
  const item = {url, body, label};
  try{
    await api(url,{method:'POST',body});
    OFFLINE=false;
    return true;
  }catch(e){
    if(e.status===403 || e.status===409 || e.status===400){
      // refus définitif : inutile de réessayer, mais il faut le dire clairement
      toast((label?label+' : ':'')+e.message,'warn',8000);
      return false;
    }
    PENDING.push(item);
    majBandeauSync();
    toast((label?label+' : ':'')+e.message+' — la modification est en attente.','err',8000);
    return false;
  }
}
async function rejouerEcritures(){
  if(!PENDING.length) return;
  const file = PENDING.slice(); PENDING = [];
  majBandeauSync();
  let ko = 0;
  for(const it of file){
    try{ await api(it.url,{method:'POST',body:it.body}); }
    catch(e){ PENDING.push(it); ko++; }
  }
  majBandeauSync();
  if(ko) toast(ko+' modification(s) toujours en échec.','err');
  else { toast('Toutes les modifications ont été enregistrées'); await recharger(); }
}
function abandonnerEcritures(){
  if(!confirm('Abandonner définitivement '+PENDING.length+' modification(s) non enregistrée(s) ?\n\nElles seront perdues et l’écran sera rechargé depuis le serveur.'))return;
  PENDING=[]; majBandeauSync(); recharger();
}
window.rejouerEcritures=rejouerEcritures; window.abandonnerEcritures=abandonnerEcritures;

window.addEventListener('beforeunload', e=>{
  if(PENDING.length){ e.preventDefault(); e.returnValue=''; }
});

/* ============================================================================
   ÉTAT
   ============================================================================ */
let DB = {employees:[],settings:{},pointages:{},documents:[],conges:[],absences:[],signalements:[]};
let CHARGE = false;                  // la base est-elle réellement chargée ?
let ME = {login:'',nom:'…',role:'lecture'};
let VIEW = 'dashboard';
let SORT = {};
let aiHistory = [];
let PRES_DATE = TODAY;
const ROLE_LABELS = {admin:'Administrateur',rh:'RH',atelier:"Chef d'atelier",lecture:'Lecture seule'};
const PERM = {admin:{settings:1,users:1,delete:1,import:1,edit:1,cloture:1},
              rh:{settings:1,users:0,delete:1,import:1,edit:1,cloture:1},
              atelier:{settings:0,users:0,delete:0,import:0,edit:1,cloture:0},
              lecture:{settings:0,users:0,delete:0,import:0,edit:0,cloture:0}};
const can = k => !!((PERM[ME.role]||PERM.lecture)[k]);
Object.assign(window,{DB:null,can,ROLE_LABELS});
Object.defineProperty(window,'DB',{get:()=>DB,set:v=>{DB=v},configurable:true});
Object.defineProperty(window,'ME',{get:()=>ME,configurable:true});
Object.defineProperty(window,'VIEW',{get:()=>VIEW,configurable:true});
Object.defineProperty(window,'SORT',{get:()=>SORT,configurable:true});
Object.defineProperty(window,'aiHistory',{get:()=>aiHistory,configurable:true});
Object.defineProperty(window,'PRES_DATE',{get:()=>PRES_DATE,set:v=>{PRES_DATE=v},configurable:true});

/* Moteur de calcul partagé avec l'espace salarié */
const ENGINE = C.makeEngine(()=>DB.settings);
const regimeFor = ds => ENGINE.regimeFor(ds);
const ferieFor  = ds => ENGINE.ferieFor(ds);
const estOuvre  = ds => ENGINE.estOuvre(ds);
const metrics   = (rec,ds) => ENGINE.metrics(rec,ds);
const moisClos  = ym => ENGINE.moisClos(ym);
const S = () => DB.settings;
Object.assign(window,{ENGINE,regimeFor,ferieFor,estOuvre,metrics,moisClos,S});

const emp = id => DB.employees.find(e=>e.id===id) || {id,prenom:'?',nom:'',service:'',poste:'',categorie:'Ouvrier',sexe:'F'};
const empName = id => {const e=emp(id);return (e.prenom+' '+e.nom).trim()};
const dayRec = date => DB.pointages[date] || null;
const empRec = (date,id) => (dayRec(date)||{})[id] || null;
Object.assign(window,{emp,empName,dayRec,empRec});

/* ============================================================================
   CHARGEMENT FENÊTRÉ
   /api/state renvoyait TOUT l'historique (≈7 à 13 Mo pour 3 ans) à chaque
   ouverture. On ne charge plus que ce que la vue affichée demande, et on garde
   la trace des plages déjà chargées.
   ============================================================================ */
let PLAGES = [];                     // [{a,b}] plages de dates déjà en mémoire

function plageManquante(a,b){
  let trous=[{a,b}];
  for(const p of PLAGES){
    const out=[];
    for(const t of trous){
      if(p.b < t.a || p.a > t.b){ out.push(t); continue; }
      if(p.a > t.a) out.push({a:t.a,b:addDays(p.a,-1)});
      if(p.b < t.b) out.push({a:addDays(p.b,1),b:t.b});
    }
    trous=out;
    if(!trous.length) break;
  }
  return trous;
}
function noterPlage(a,b){
  PLAGES.push({a,b});
  PLAGES.sort((x,y)=>x.a<y.a?-1:1);
  const out=[];
  for(const p of PLAGES){
    const last=out[out.length-1];
    if(last && p.a <= addDays(last.b,1)){ if(p.b>last.b) last.b=p.b; }
    else out.push({...p});
  }
  PLAGES=out;
}
async function ensureRange(a,b){
  if(!a||!b) return;
  if(b<a){const t=a;a=b;b=t;}
  const trous=plageManquante(a,b);
  for(const t of trous){
    const d=await api('/api/pointages?frm='+t.a+'&to='+t.b);
    for(const ds in d){
      DB.pointages[ds]=Object.assign(DB.pointages[ds]||{}, d[ds]);
    }
    noterPlage(t.a,t.b);
  }
}
window.ensureRange=ensureRange;

async function charger(){
  const d = await api('/api/state');
  DB = d;
  DB.pointages = DB.pointages || {};
  DB.pointeuse = DB.pointeuse || null;      // liaison avec la pointeuse (résumé)
  DB.settings = C.normalizeSettings(DB.settings);
  ENGINE.invalidate();
  PLAGES = [];
  if(d.fenetre) noterPlage(d.fenetre.du, d.fenetre.au);
  CHARGE = true;
}
async function recharger(){
  try{ await charger(); await rendre(); toast('Données rechargées'); }
  catch(e){ ecranErreur(e); }
}
window.recharger=recharger;

function ecranErreur(e){
  /* Avant, un échec de chargement vidait DB en silence : l'utilisateur voyait une
     application vide et pouvait « enregistrer » ce vide par-dessus la vraie base. */
  CHARGE=false;
  document.getElementById('app').innerHTML=
    '<div style="grid-column:1/-1;display:grid;place-items:center;padding:40px">'+
    '<div class="card" style="max-width:520px;padding:28px;text-align:center">'+
    '<div style="color:var(--absent);margin-bottom:10px">'+I.warn+'</div>'+
    '<h2 style="font-family:var(--display);font-size:20px;margin-bottom:8px">Données indisponibles</h2>'+
    '<p style="color:var(--muted);font-size:13.5px;margin-bottom:18px">'+esc(e&&e.message||'Erreur inconnue')+
    '<br><br>Aucune modification n’est possible tant que la base n’est pas chargée — pour éviter d’écraser vos données par un état vide.</p>'+
    '<button class="btn btn-gold" onclick="recharger()">'+I.refresh+' Réessayer</button></div></div>';
}

/* Enregistrement des données de référence (employées, réglages, documents…) */
let _saveT=null, _saveEnAttente=false;
function save(){
  if(!CHARGE){ toast('Base non chargée — enregistrement bloqué','warn'); return; }
  _saveEnAttente=true;
  clearTimeout(_saveT);
  _saveT=setTimeout(async()=>{
    _saveEnAttente=false;
    await ecrire('/api/state-meta',{employees:DB.employees,settings:DB.settings,
      documents:DB.documents,conges:DB.conges,absences:DB.absences},'Enregistrement des données');
  },400);
}
async function saveNow(){ clearTimeout(_saveT); _saveEnAttente=false;
  return ecrire('/api/state-meta',{employees:DB.employees,settings:DB.settings,
    documents:DB.documents,conges:DB.conges,absences:DB.absences},'Enregistrement des données'); }
window.save=save; window.saveNow=saveNow;

function persistPointage(date,id){
  const r=(DB.pointages[date]||{})[id]||{statut:'absent',entree:'',sortie:''};
  return ecrire('/api/pointage',{date,id,statut:r.statut,entree:r.entree||'',sortie:r.sortie||'',
    punches:r.punches||null,hM:(r.hM!=null?r.hM:null),hsM:(r.hsM!=null?r.hsM:null),
    manuel:(r.manuel?1:null),src:r.src||'manuel'},'Pointage '+fmtDate(date)+' · '+empName(id));
}
function persistDay(date){
  return ecrire('/api/day',{date,recs:DB.pointages[date]||{}},'Journée '+fmtDate(date));
}
function persistBulk(recs,motif,src){
  return ecrire('/api/pointages/bulk',{recs,motif,src:src||'manuel'},motif||'Écriture groupée');
}
Object.assign(window,{persistPointage,persistDay,persistBulk});

/* ============================================================================
   COQUILLE — construite UNE fois, seul #main est réécrit ensuite
   ============================================================================ */
const NAV=[
  {grp:'Pilotage'},{v:'dashboard',ic:I.grid,t:'Tableau de bord'},{v:'presences',ic:I.clock,t:'Présences'},{v:'rapports',ic:I.report,t:'Rapports & paie'},
  {grp:'Personnel'},{v:'personnel',ic:I.users,t:'Personnel'},{v:'documents',ic:I.doc,t:'Documents'},{v:'absences',ic:I.calx,t:'Absences'},{v:'retards',ic:I.late,t:'Retards'},{v:'conges',ic:I.cal,t:'Congés & sorties'},
  {grp:'Intelligence'},{v:'alertes',ic:I.bell,t:'Alertes'},{v:'rse',ic:I.leaf,t:'RSE & bien-être'},{v:'assistant',ic:I.spark,t:'Assistant IA'},
  {grp:'Système'},{v:'parametres',ic:I.shield,t:'Sécurité & accès'},
];
/* Les plages nécessaires à chaque vue (chargement à la demande) */
function plagePourVue(v){
  const m=monthBounds(TODAY.slice(0,7));
  switch(v){
    case 'presences': return [PRES_DATE,PRES_DATE];
    case 'rapports':  return [window.REP_FROM||m[0], window.REP_TO||TODAY];
    case 'absences':  return [addDays(TODAY,-210), TODAY];
    case 'retards':   return m;
    case 'assistant': return m;
    case 'dashboard': return [addDays(TODAY,-7), TODAY];
    default:          return [TODAY,TODAY];
  }
}

function construireCoquille(){
  document.getElementById('app').innerHTML =
   '<aside class="side" id="side" aria-label="Navigation principale">'+
     '<div class="brand"><div class="mark"><div class="glyph">'+I.scissors+'</div>'+
     '<div><div class="name">PilotRH</div><div class="sub">DBS Fashion</div></div></div></div>'+
     '<nav class="nav" id="nav"></nav>'+
     '<div class="side-foot"><div class="role-box"><div class="av" id="meAv"></div>'+
       '<div class="who" id="meWho"></div></div>'+
       '<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:9px;font-size:12px" onclick="logout()">Se déconnecter</button></div>'+
   '</aside><main class="main" id="main" tabindex="-1"></main>';
  majSidebar();
  document.getElementById('nav').addEventListener('click',e=>{
    const b=e.target.closest('[data-v]'); if(!b)return; go(b.dataset.v); fermerMenu();
  });
}
function majSidebar(){
  const nav=document.getElementById('nav'); if(!nav)return;
  nav.innerHTML=NAV.map(n=>{
    if(n.v==='parametres'&&!can('settings')&&!can('users'))return '';
    if(n.grp)return '<div class="nav-group">'+n.grp+'</div>';
    const nb = n.v==='alertes' ? alertCount() : (n.v==='presences' ? aRevoirCount() : 0);
    const pill = nb ? '<span class="pill">'+nb+'</span>' : '';
    return '<button class="nav-item'+(VIEW===n.v?' active':'')+'" data-v="'+n.v+'"'+
      (VIEW===n.v?' aria-current="page"':'')+'>'+n.ic+'<span>'+n.t+'</span>'+pill+'</button>';
  }).join('');
  const av=document.getElementById('meAv'), who=document.getElementById('meWho');
  if(av) av.textContent=initials(ME.nom);
  if(who) who.innerHTML=esc(ME.nom)+'<small>'+esc(ROLE_LABELS[ME.role]||ME.role)+'</small>';
}
function ouvrirMenu(){document.getElementById('side').classList.add('open');document.getElementById('scrim').classList.add('on')}
function fermerMenu(){const s=document.getElementById('side');if(s)s.classList.remove('open');const c=document.getElementById('scrim');if(c)c.classList.remove('on')}
window.ouvrirMenu=ouvrirMenu; window.fermerMenu=fermerMenu;

function topbar(crumb,title,actions){
  return '<div class="topbar">'+
    '<button class="burger" onclick="ouvrirMenu()" aria-label="Ouvrir le menu">'+I.menu+'</button>'+
    '<div><div class="crumb">'+esc(crumb)+'</div><h1>'+esc(title)+'</h1></div><div class="spacer"></div>'+
    '<div class="searchbox"><label for="gSearch" class="sr-only">Rechercher une employée</label>'+I.search+
      '<input id="gSearch" type="search" placeholder="Rechercher…" autocomplete="off" oninput="quickSearch(this.value)" onblur="setTimeout(fermerRecherche,180)">'+
      '<div class="sresults" id="sres" role="listbox"></div></div>'+
    '<div class="date-chip">'+today.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'})+'</div>'+
    '<button class="icon-btn" onclick="go(\'alertes\')" aria-label="Alertes">'+I.bell+(alertCount()?'<span class="dot"></span>':'')+'</button>'+
    (actions||'')+'</div>';
}
window.topbar=topbar;

const VUES = {};                     // remplies par pilotrh-views.js
window.VUES = VUES;

async function go(v){
  VIEW=v;
  if(location.hash!=='#/'+v) location.hash='#/'+v;
  await rendre();
}
window.go=go;

async function rendre(){
  if(!CHARGE) return;
  majSidebar();
  const main=document.getElementById('main');
  const [a,b]=plagePourVue(VIEW);
  main.innerHTML=topbar('Chargement','…')+'<div class="page"><div class="card" style="padding:22px">'+
    '<div class="skel" style="width:40%;margin-bottom:10px"></div><div class="skel" style="width:70%"></div></div></div>';
  try{ await ensureRange(a,b); }
  catch(e){ toast('Chargement des pointages : '+e.message,'err'); }
  const fn = VUES[VIEW] || VUES.dashboard;
  try{ await fn(main); }
  catch(e){ console.error(e); main.innerHTML=topbar('Erreur','Affichage impossible')+
    '<div class="page"><div class="banner banner-err">'+I.warn+'<div class="grow">'+esc(e.message)+
    '</div><button class="btn btn-ghost" onclick="recharger()">Recharger</button></div></div>'; }
  main.scrollTop=0;
}
window.rendre=rendre;

function logout(){
  if(PENDING.length && !confirm('Des modifications ne sont pas enregistrées. Se déconnecter quand même ?'))return;
  PENDING=[];
  api('/api/logout',{method:'POST'}).finally(()=>location.href='/login');
}
window.logout=logout;

/* -------------------------------------------------------- recherche globale */
function quickSearch(v){
  const box=document.getElementById('sres'); if(!box)return;
  const q=String(v||'').trim().toLowerCase();
  if(q.length<2){ box.classList.remove('on'); box.innerHTML=''; return; }
  const res=DB.employees.filter(e=>((e.prenom||'')+' '+(e.nom||'')+' '+(e.poste||'')+' '+(e.matricule||'')+' '+(e.cin||'')).toLowerCase().includes(q)).slice(0,12);
  box.innerHTML = res.length
    ? res.map(e=>'<button type="button" onclick="openProfile(\''+escJs(e.id)+'\')"><b>'+esc(e.prenom+' '+e.nom)+
        '</b><br><small style="color:var(--muted)">'+esc((e.poste||'')+' · '+(e.matricule||e.cin||e.id))+'</small></button>').join('')
    : '<div style="padding:12px;color:var(--muted);font-size:13px">Aucun résultat</div>';
  box.classList.add('on');
}
function fermerRecherche(){const b=document.getElementById('sres');if(b)b.classList.remove('on')}
window.quickSearch=quickSearch; window.fermerRecherche=fermerRecherche;

/* ----------------------------------------------------------- composants HTML */
function avatarBox(e,sz){
  const n=(e.prenom||'')+' '+(e.nom||'');
  return '<span class="ava" style="width:'+sz+'px;height:'+sz+'px;background:'+avColor(n)+'">'+esc(initials(n))+'</span>';
}
const matOf = e => String((e && (e.matricule || e.cin || e.id)) || '');
/* Quand le pointage vient de badges multiples, entree/sortie ne sont pas
   renseignés : on affiche le premier et le dernier badge, sinon l'écran montrait
   des champs vides à côté d'un total d'heures calculé. */
const entreeAff = r => (r && (r.entree || ((r.punches && r.punches.length) ? r.punches[0] : ''))) || '';
const sortieAff = r => (r && (r.sortie || ((r.punches && r.punches.length > 1) ? r.punches[r.punches.length-1] : ''))) || '';
Object.assign(window,{entreeAff,sortieAff});
function empCell(id,sansPoste){
  const e=emp(id), n=((e.prenom||'')+' '+(e.nom||'')).trim();
  const mat=matOf(e);
  return '<button type="button" class="emp-cell" onclick="openProfile(\''+escJs(id)+'\')">'+
    '<span class="ava" style="background:'+avColor(n)+'">'+esc(initials(n))+'</span>'+
    '<span><b>'+esc(n)+'</b> <span class="mono" style="font-size:11px;color:var(--muted)">#'+esc(mat)+'</span>'+
    (sansPoste?'':'<small>'+esc((e.poste||'—')+' · '+(e.categorie||''))+'</small>')+'</span></button>';
}
window.matOf=matOf;
function statutTag(st,sexe){
  return '<span class="tag '+C.statutClass(st)+'">'+esc(C.statutLabel(st,sexe))+'</span>';
}
/* La base de paie n'est PLUS déduite de la seule catégorie : chaque fiche porte
   son mode (à l'heure ou à la journée). Sans l'employée, on n'affiche que la
   catégorie plutôt qu'une base de paie possiblement fausse. */
function catTag(c,e){
  const cls=(c==='Cadre'?'cat-cad':'cat-ouv');
  let lbl=c||'—';
  if(e){lbl=(c||'—')+(C.modePaie(e)==='journalier'?' · jour':' · heure')}
  return '<span class="cat-tag '+cls+'">'+esc(lbl)+'</span>';
}
function kpi(l,v,s,ic,col,bg){return '<div class="kpi"><div class="ic" style="background:'+bg+';color:'+col+'">'+ic+
  '</div><div class="lab">'+esc(l)+'</div><div class="val">'+esc(String(v))+'</div><div class="sub">'+esc(s||'')+'</div></div>'}
function miniKpi(l,v,col){return '<div class="kpi"><div class="lab" style="color:'+col+'"><span class="dotmark" style="background:'+col+
  '"></span>'+esc(l)+'</div><div class="val">'+esc(String(v))+'</div></div>'}
function row(l,v){return '<div class="info-row"><span>'+esc(l)+'</span><b>'+esc(v==null||v===''?'—':String(v))+'</b></div>'}
function th(scope,k,label){
  const s=SORT[scope];
  const dir=s&&s.k===k?(s.dir>0?'ascending':'descending'):null;
  return '<th'+(dir?' aria-sort="'+dir+'"':'')+'><button type="button" onclick="sortBy(\''+scope+'\',\''+k+'\')">'+
    esc(label)+'<span aria-hidden="true">'+(dir?(s.dir>0?'▲':'▼'):'↕')+'</span></button></th>';
}
/* Ligne d'en-tête mémorisée, pour que l'indicateur de tri se mette réellement à
   jour : le tri ne réécrivait que le corps du tableau, la flèche restait figée
   et aria-sort n'était jamais annoncé aux lecteurs d'écran. */
const THCOLS={};
function theadRow(scope,cols){
  THCOLS[scope]=cols;
  return '<tr data-th="'+scope+'">'+cols.map(c=>Array.isArray(c)
    ? th(scope,c[0],c[1])
    : '<th>'+(c===''?'<span class="sr-only">Actions</span>':esc(c))+'</th>').join('')+'</tr>';
}
function majEntetes(scope){
  const tr=document.querySelector('[data-th="'+scope+'"]');
  if(!tr||!THCOLS[scope])return;
  const html=theadRow(scope,THCOLS[scope]);
  tr.outerHTML=html;
}
function sortBy(scope,k){
  const c=SORT[scope];SORT[scope]=(c&&c.k===k)?{k,dir:-c.dir}:{k,dir:1};
  majEntetes(scope);
  ({pers:window.fillPers,pres:fillPres,rep:window.fillRep}[scope]||rendre)();
}
Object.assign(window,{avatarBox,empCell,statutTag,catTag,kpi,miniKpi,row,th,theadRow,majEntetes,sortBy});

/* ------------------------------------------------------------------- modales */
let _focusAvant=null;
function openModal(html,cls){
  const o=$('#overlay');
  _focusAvant=document.activeElement;
  o.innerHTML='<div class="modal '+(cls||'')+'" role="dialog" aria-modal="true">'+html+'</div>';
  o.classList.add('open');
  o.onclick=e=>{if(e.target===o)closeModal()};
  const f=o.querySelector('input,select,textarea,button');
  if(f)setTimeout(()=>f.focus(),40);
}
function closeModal(){
  const o=$('#overlay'); o.classList.remove('open'); o.innerHTML='';
  if(_focusAvant&&_focusAvant.focus)try{_focusAvant.focus()}catch(e){}
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if($('#overlay').classList.contains('open')){closeModal();return}
    fermerMenu();
  }
  /* piège de focus basique dans la modale */
  if(e.key==='Tab'&&$('#overlay').classList.contains('open')){
    const f=[...$('#overlay').querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>x.offsetParent!==null);
    if(!f.length)return;
    const first=f[0],last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
});
Object.assign(window,{openModal,closeModal});

/* ============================================================================
   ANOMALIES — journées à revoir avant la paie
   Un badge unique ou un nombre de badges impair ne doit pas produire
   silencieusement « 0 h, présente ».
   ============================================================================ */
function aRevoir(a,b){
  const out=[];
  eachDay(a,b,ds=>{
    const rec=dayRec(ds); if(!rec)return;
    for(const e of DB.employees){
      const r=rec[e.id]; if(!r)continue;
      const m=metrics(r,ds);
      if(m.revue) out.push({ds,e,m,rec:r});
    }
  });
  return out;
}
let _revoirCache={cle:'',n:0};
function aRevoirCount(){
  const [a,b]=monthBounds(TODAY.slice(0,7));
  const cle=a+b+ENGINE.stamp+Object.keys(DB.pointages).length;
  if(_revoirCache.cle!==cle) _revoirCache={cle,n:aRevoir(a,b).length};
  return _revoirCache.n;
}
Object.assign(window,{aRevoir,aRevoirCount});

function bandeauRevue(a,b){
  const l=aRevoir(a,b);
  if(!l.length)return '';
  return '<div class="banner banner-warn">'+I.warn+'<div class="grow"><b>'+l.length+
    ' journée(s) à vérifier</b> — pointage incomplet (sortie manquante ou badges impairs). '+
    'Ces journées comptent actuellement 0 h ou une durée approximative.</div>'+
    '<button class="btn btn-ghost" onclick="openRevue(\''+a+'\',\''+b+'\')">Voir la liste</button></div>';
}
function openRevue(a,b){
  const l=aRevoir(a,b);
  openModal('<div class="modal-head">'+I.warn+'<h3>Journées à vérifier</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
    '<div class="modal-body"><p style="color:var(--muted);font-size:13px;margin-bottom:14px">'+
    'Corrigez l’entrée/sortie ou saisissez directement les heures. Une journée corrigée à la main '+
    'est protégée : les imports de la pointeuse ne l’écraseront plus.</p>'+
    '<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Employée</th><th>Badges</th><th>Motif</th><th>Heures</th><th></th></tr></thead><tbody>'+
    (l.map(x=>'<tr><td class="mono">'+fmtDate(x.ds)+'</td><td>'+esc(empName(x.e.id))+'</td>'+
      '<td class="mono">'+esc(((x.rec.punches||[x.rec.entree,x.rec.sortie]).filter(Boolean)).join(' · '))+'</td>'+
      '<td style="color:var(--muted);font-size:12px">'+esc(x.m.motifRevue)+'</td>'+
      '<td>'+(x.m.heures?hLabel(x.m.heures):'<b style="color:var(--absent)">0 h</b>')+'</td>'+
      '<td><button class="linkish" onclick="closeModal();allerAuJour(\''+x.ds+'\',\''+escJs(x.e.id)+'\')" '+
        'title="Ouvre la feuille du '+fmtDate(x.ds)+' avec la ligne de '+esc(empName(x.e.id))+' en évidence">Corriger →</button>'+
      (can('edit')?'<br><button class="linkish" style="font-size:11.5px" onclick="closeModal();openCorrection(\''+escJs(x.e.id)+'\',\''+x.ds+'\',\''+x.ds+'\')">Saisir les heures</button>':'')+
      '</td></tr>').join('')
     ||'<tr><td colspan="6"><div class="empty">Rien à vérifier</div></td></tr>')+
    '</tbody></table></div></div>','wide');
}
/* Cible d'une alerte : la ligne est surlignée et amenée à l'écran après le
   rendu, pour que « corriger » désigne une ligne précise et pas une page. */
let FOCUS_EMP='';
async function allerAuJour(ds,id){
  PRES_DATE=ds; FOCUS_EMP=id||'';
  await go('presences');
  cadrerFocus();
}
function cadrerFocus(){
  if(!FOCUS_EMP)return;
  const tr=document.querySelector('tr[data-emp="'+FOCUS_EMP.replace(/"/g,'')+'"]');
  FOCUS_EMP='';
  if(!tr)return;
  tr.classList.add('focus-row');
  if(tr.scrollIntoView)tr.scrollIntoView({block:'center',behavior:'smooth'});
  const ch=tr.querySelector('input,select');
  if(ch)setTimeout(()=>{try{ch.focus()}catch(e){}},250);
  setTimeout(()=>tr.classList.remove('focus-row'),4000);
}
Object.assign(window,{bandeauRevue,openRevue,allerAuJour,cadrerFocus});

/* ============================================================================
   TABLEAU DE BORD
   ============================================================================ */
function counts(date){
  const r=dayRec(date)||{};
  const c={present:0,late:0,absent:0,leave:0,mission:0,autorisation:0,ferie:0,ferieTravaille:0,repos:0,reposTravaille:0};
  DB.employees.forEach(e=>{const m=metrics(r[e.id],date);if(c[m.statut]!==undefined)c[m.statut]++});
  return c;
}
window.counts=counts;

VUES.dashboard = async function(main){
  const c=counts(TODAY), tot=DB.employees.length;
  const presents=c.present+c.late+c.autorisation+c.ferieTravaille+c.reposTravaille;
  const f=ferieFor(TODAY), reg=regimeFor(TODAY);
  const stats=await api('/api/stats/absenteisme?mois=6').catch(()=>[]);
  main.innerHTML=topbar('Pilotage RH','Tableau de bord')+'<div class="page view">'+
    (f?'<div class="banner banner-info">'+I.cal+'<div class="grow"><b>'+esc(f.nom)+
      '</b> — jour férié. Le personnel sans pointage n’est pas compté absent.</div></div>':'')+
    (reg.actif===false&&!f?'<div class="banner banner-info">'+I.cal+'<div class="grow">'+
      esc(DAYS_FR[new Date(TODAY+'T12:00').getDay()])+' — repos hebdomadaire.</div></div>':'')+
    bandeauRevue(...monthBounds(TODAY.slice(0,7)))+
    '<div class="kpis">'+
      kpi('Effectif total',tot,'salariés inscrits',I.users,'var(--ink)','#eae5d9')+
      kpi('Présences',presents,pct(presents,tot)+'% de l’effectif',I.check,'var(--present)','var(--present-bg)')+
      kpi('Retards',c.late,'à traiter ce matin',I.late,'var(--late)','var(--late-bg)')+
      kpi('Absences',c.absent,'pointages manquants',I.warn,'var(--absent)','var(--absent-bg)')+
      kpi('Congés',c.leave,'congés validés',I.cal,'var(--leave)','var(--leave-bg)')+
      kpi('Missions',c.mission,'hors site',I.briefcase,'var(--mission)','var(--mission-bg)')+
    '</div>'+
    '<div class="split" style="margin-bottom:16px">'+
      '<div class="card chartcard"><h3>Évolution de l’absentéisme</h3>'+
        '<div class="csub">Taux mensuel calculé sur les pointages réels — 6 derniers mois</div>'+
        '<div class="chart-wrap" id="cAbs"></div></div>'+
      '<div class="card chartcard"><h3>Répartition par service</h3><div class="csub">Effectif par service</div>'+
        '<div class="chart-wrap" id="cServ"></div></div>'+
    '</div>'+
    '<div class="split">'+
      '<div class="card tablecard"><div class="table-head">'+I.clock+'<h3>À traiter aujourd’hui</h3>'+
        '<div class="spacer"></div><button class="linkish" onclick="go(\'presences\')">Présences →</button></div>'+miniMoves()+'</div>'+
      '<div class="card tablecard"><div class="table-head">'+I.bell+'<h3>Alertes prioritaires</h3>'+
        '<div class="spacer"></div><button class="linkish" onclick="go(\'alertes\')">Tout voir →</button></div>'+
        (computeAlerts().slice(0,4).map(alertRow).join('')||'<div class="empty">Aucune alerte</div>')+'</div>'+
    '</div></div>';
  dessinerLigne('cAbs', stats.map(s=>({l:MOIS_FR[+s.mois.slice(5,7)-1].slice(0,4)+'.',v:s.taux})),'%');
  const parServ=SERVICES.map(s=>({l:s,v:DB.employees.filter(e=>e.service===s).length})).filter(x=>x.v);
  dessinerDonut('cServ',parServ);
};

function miniMoves(){
  const r=dayRec(TODAY)||{};const rows=[];
  DB.employees.forEach(e=>{const m=metrics(r[e.id],TODAY);
    if(m.statut==='late'||m.statut==='absent'||m.revue)rows.push({e,m,rec:r[e.id]||{}})});
  if(!rows.length)return '<div class="empty">'+I.check+'<div>Rien à signaler</div></div>';
  return '<div class="tblwrap"><table class="tbl"><tbody>'+rows.slice(0,6).map(x=>{
    const d=x.m.revue?x.m.motifRevue:(x.m.statut==='late'?('Arrivée '+esc(x.rec.entree||'?')+' · +'+x.m.retard+' min'):'Pointage manquant');
    return '<tr'+(x.m.revue?' class="revue-row"':'')+'><td>'+empCell(x.e.id)+'</td><td>'+statutTag(x.m.statut,x.e.sexe)+
      '</td><td style="color:var(--muted);font-size:12px">'+esc(d)+'</td></tr>';}).join('')+'</tbody></table></div>';
}

/* ============================================================================
   PRÉSENCES — feuille de pointage
   ============================================================================ */
async function shiftDay(n){PRES_DATE=addDays(PRES_DATE,n);await go('presences')}
async function setDay(v){if(v)PRES_DATE=v;await go('presences')}
Object.assign(window,{shiftDay,setDay});

VUES.presences = async function(main){
  const exists=!!dayRec(PRES_DATE);
  const reg=regimeFor(PRES_DATE), f=ferieFor(PRES_DATE);
  const clos=moisClos(PRES_DATE.slice(0,7));
  const c=exists?counts(PRES_DATE):null;
  main.innerHTML=topbar('Suivi quotidien','Présences',
    '<button class="icon-btn" title="Paramètres horaires" aria-label="Paramètres horaires" onclick="openSettings()">'+I.gear+'</button>'+
    '<button class="btn btn-ghost" onclick="syncNow()">'+I.cloud+' Synchroniser</button>'+
    '<button class="btn btn-ghost" onclick="pdfDailyFor(PRES_DATE)">'+I.download+' PDF du jour</button>'+
    (can('edit')&&!clos?'<button class="btn btn-primary" onclick="openSaisieRapide()">'+I.clock+' Saisie rapide</button>':'')+
    (can('import')?'<button class="btn btn-gold" onclick="openImport()">'+I.cloud+' Importer pointage</button>':''))+
  '<div class="page view">'+
    '<div class="range-bar">'+
      '<div class="daynav"><button onclick="shiftDay(-1)" aria-label="Jour précédent">'+I.chevL+'</button>'+
      '<label for="dPres" class="sr-only">Date affichée</label>'+
      '<input id="dPres" type="date" value="'+PRES_DATE+'" onchange="setDay(this.value)">'+
      '<button onclick="shiftDay(1)" aria-label="Jour suivant">'+I.chevR+'</button></div>'+
      '<button class="btn btn-ghost" onclick="setDay(\''+TODAY+'\')">Aujourd’hui</button>'+
      '<div style="flex:1"></div>'+
      (clos?'<span class="lock-chip">'+I.lock+' Mois clôturé</span>':'')+
      '<div class="date-chip" style="text-transform:capitalize">'+esc(fmtJour(PRES_DATE))+'</div>'+
    '</div>'+
    (f?'<div class="banner banner-info">'+I.cal+'<div class="grow"><b>'+esc(f.nom)+'</b> — jour férié. '+
       'Les heures pointées ce jour sont comptées en heures supplémentaires.</div></div>':'')+
    (reg.actif===false&&!f?'<div class="banner banner-info">'+I.cal+'<div class="grow"><b>'+
       esc(DAYS_FR[new Date(PRES_DATE+'T12:00').getDay()])+'</b> — jour de repos. Tout pointage est compté en heures supplémentaires.</div></div>':'')+
    (clos?'<div class="banner banner-warn">'+I.lock+'<div class="grow">Le mois <b>'+PRES_DATE.slice(0,7)+
       '</b> est clôturé : aucune modification n’est possible.</div>'+
       (can('cloture')?'<button class="btn btn-ghost" onclick="rouvrirMois(\''+PRES_DATE.slice(0,7)+'\')">Rouvrir</button>':'')+'</div>':'')+
    bandeauRevue(PRES_DATE,PRES_DATE)+
    (!exists
      ? '<div class="card"><div class="empty">'+I.cal+
        '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px">Journée non créée</div>'+
        '<div style="margin-bottom:16px;max-width:520px;margin-left:auto;margin-right:auto">Aucun pointage pour le '+fmtDate(PRES_DATE)+
        '. Importez le fichier de la pointeuse, ou créez la journée pour saisir les pointages à la main.'+
        '<br><br><b>Attention :</b> créer la journée inscrit tout l’effectif comme présent aux horaires théoriques. '+
        'Ces heures sont marquées « saisie manuelle » et ne seront plus remplacées par l’import réel de la pointeuse.</div>'+
        (can('edit')&&!clos?'<button class="btn btn-primary" onclick="openSaisieRapide()">'+I.clock+' Saisie rapide</button> ':'')+
        (can('edit')&&!clos?'<button class="btn btn-ghost" onclick="createDay()">'+I.plus+' Tout présent aux horaires théoriques</button>':'')+
        (can('import')?' <button class="btn btn-gold" onclick="openImport()">'+I.cloud+' Importer le pointage</button>':'')+
        '</div></div>'
      : '<div class="kpis" style="grid-template-columns:repeat(6,1fr)">'+
        miniKpi('Présences',c.present,'var(--present)')+miniKpi('Retards',c.late,'var(--late)')+
        miniKpi('Absences',c.absent,'var(--absent)')+miniKpi('Congés',c.leave,'var(--leave)')+
        miniKpi('Missions',c.mission,'var(--mission)')+miniKpi('Autoris.',c.autorisation,'var(--leave)')+'</div>'+
        '<div class="card tablecard">'+
          '<div class="table-head">'+I.clock+'<h3>Feuille de pointage</h3><div class="spacer"></div>'+
            '<div class="field">'+I.filter+'<label for="fStatut" class="sr-only">Statut</label>'+
              '<select id="fStatut" onchange="fillPres()"><option value="">Tous statuts</option>'+
              '<option value="present">Présences</option><option value="late">Retards</option>'+
              '<option value="absent">Absences</option><option value="leave">Congés</option>'+
              '<option value="revue">À vérifier</option></select></div>'+
            '<div class="field"><label for="fServ">Service</label><select id="fServ" onchange="fillPres()"><option value="">Tous</option>'+
              SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
            '<div class="field"><label for="fAtel">Atelier</label><select id="fAtel" onchange="fillPres()"><option value="">Tous</option>'+
              ATELIERS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
            '<div class="field">'+I.search+'<label for="fQ" class="sr-only">Nom</label>'+
              '<input id="fQ" type="search" placeholder="Nom…" oninput="fillPres()"></div>'+
          '</div>'+
          '<div class="tblwrap"><table class="tbl"><thead>'+
            theadRow('pres',[['mat','Mat.'],['name','Employée'],'Cat.','Statut',['in','Entrée'],'Sortie',
              ['h','Heures'],['ret','Retard'],['hs','H. sup.']])+
            '</thead><tbody id="presBody"></tbody></table></div>'+
        '</div>'+
        '<div style="margin-top:10px;font-size:12px;color:var(--muted)">'+
          'Régime du jour : <b>'+esc(reg.actif===false?'repos':(reg.debut+' → '+reg.fin))+'</b>'+
          (reg.actif===false?'':' · pause '+(+reg.pause||0)+' min'+(reg.pauseDe?' ('+esc(reg.pauseDe)+' → '+esc(reg.pauseA)+')':'')+
           ' · tolérance '+(+reg.tol||0)+' min · délai H. sup. '+(+reg.grace||0)+' min')+
          '. Les colonnes <b>Heures</b> et <b>H. sup.</b> sont modifiables : une valeur saisie remplace le calcul et protège la journée des imports.'+
        '</div>')+
  '</div>';
  if(exists)fillPres();
};

function fillPres(){
  const f=(($('#fStatut')||{}).value)||'',sv=(($('#fServ')||{}).value)||'',
        at=(($('#fAtel')||{}).value)||'',q=((($('#fQ')||{}).value)||'').toLowerCase();
  const r=dayRec(PRES_DATE)||{};
  const clos=moisClos(PRES_DATE.slice(0,7));
  const editable=can('edit')&&!clos;
  let rows=DB.employees.map(e=>({e,rec:r[e.id]||{statut:'absent',entree:'',sortie:''},m:metrics(r[e.id],PRES_DATE)}))
    .filter(x=>(!f||(f==='revue'?x.m.revue:x.m.statut===f))&&(!sv||x.e.service===sv)&&(!at||x.e.atelier===at)
      &&(!q||((x.e.prenom||'')+' '+(x.e.nom||'')).toLowerCase().includes(q)));
  if(SORT.pres){const s=SORT.pres;rows=[...rows].sort((a,b)=>{let va,vb;
    if(s.k==='mat'){va=matOf(a.e);vb=matOf(b.e)}
    else if(s.k==='name'){va=a.e.nom||'';vb=b.e.nom||''}
    else if(s.k==='in'){va=a.rec.entree||'99';vb=b.rec.entree||'99'}
    else if(s.k==='h'){va=a.m.heures;vb=b.m.heures}
    else if(s.k==='ret'){va=a.m.retard;vb=b.m.retard}else{va=a.m.hs;vb=b.m.hs}
    return(va>vb?1:va<vb?-1:0)*s.dir});}
  const opts=['present','absent','leave','mission','autorisation'];
  const optLab={present:'Présent(e)',absent:'Absent(e)',leave:'Congé',mission:'Mission',autorisation:'Autorisation'};
  $('#presBody').innerHTML=rows.map(x=>{
    const{e,rec,m}=x;
    const dis=editable?'':' disabled';
    const showTimes=rec.statut==='present'||rec.statut==='autorisation';
    const prot=C.estProtege(rec);
    const motif=rec.src==='conge'?'Congé validé'
      :(rec.hM!=null||rec.hsM!=null)?'Heures saisies à la main':'Correction manuelle';
    const protege=prot?' <button class="linkish" style="color:var(--gold-ink)" title="'+motif+
      ' — journée protégée : les imports de la pointeuse ne l\'écraseront pas.'+
      (rec.manuel?' Cliquer pour retirer la protection.':' Videz les heures saisies pour lever la protection.')+
      '" onclick="revertManuel(\''+escJs(e.id)+'\')" aria-label="Journée protégée">&#128274;</button>':'';
    const badges=(rec.punches&&rec.punches.length>2)
      ? (rec.punches.length%2===0
         ? ' <span class="tag t-neutral" title="Badges : '+esc(rec.punches.join(' · '))+' — coupure(s) déduite(s)">⇄ '+rec.punches.length+'</span>'
         : ' <span class="tag t-late" title="Badges impairs : '+esc(rec.punches.join(' · '))+'">⚠ '+rec.punches.length+'</span>')
      : '';
    const hCell = (showTimes||m.manuel||m.manuelHS)
      ? '<input class="tinput'+(m.manuel?' manuel':'')+'" style="width:74px;text-align:center" value="'+
          (m.heures?fr2(hDec(m.heures)):'')+'" aria-label="Heures travaillées de '+esc(empName(e.id))+
          '" title="Heures travaillées — vide = calcul automatique" onchange="editHeures(\''+escJs(e.id)+'\',this.value)"'+dis+'>'+
        (m.manuel?' <span title="Saisie manuelle" style="color:var(--gold-ink)">&#9998;</span>':'')
      : (m.heures?'<b>'+hLabel(m.heures)+'</b>':'—');
    const hsCell = (showTimes||m.manuelHS||m.manuel||m.hs)
      ? '<input class="tinput'+(m.manuelHS?' manuel':'')+'" style="width:74px;text-align:center" value="'+
          (m.hs?fr2(hDec(m.hs)):'')+'" aria-label="Heures supplémentaires de '+esc(empName(e.id))+
          '" title="Heures supplémentaires — vide = calcul automatique" onchange="editHS(\''+escJs(e.id)+'\',this.value)"'+dis+'>'+
        (m.manuelHS?' <span title="Saisie manuelle" style="color:var(--gold-ink)">&#9998;</span>':'')
      : (m.hs?'<b style="color:var(--mission)">'+hLabel(m.hs)+'</b>':'—');
    const cls=m.revue?' class="revue-row"':(m.ferie?' class="ferie-row"':'');
    return '<tr'+cls+' data-emp="'+esc(e.id)+'"><td class="mono">'+esc(matOf(e))+'</td><td>'+empCell(e.id)+'</td><td>'+catTag(e.categorie,e)+'</td>'+
      '<td><label class="sr-only" for="st_'+esc(e.id)+'">Statut de '+esc(empName(e.id))+'</label>'+
        '<select class="ssel" id="st_'+esc(e.id)+'" onchange="editPres(\''+escJs(e.id)+'\',\'statut\',this.value)"'+dis+'>'+
        opts.map(o=>'<option value="'+o+'"'+(rec.statut===o?' selected':'')+'>'+optLab[o]+'</option>').join('')+
        (['ferie','repos','ferieTravaille','reposTravaille'].includes(rec.statut)?'<option value="'+esc(rec.statut)+'" selected>'+esc(C.statutLabel(rec.statut,e.sexe))+'</option>':'')+
        '</select>'+(m.late?' <span class="tag t-late">Retard</span>':'')+
        (m.ferie?' <span class="tag t-ferie" title="'+esc(m.ferieNom)+'">Férié</span>':'')+
        (m.revue?' <span class="tag t-late" title="'+esc(m.motifRevue)+'">⚠ à vérifier</span>':'')+protege+'</td>'+
      '<td>'+(showTimes?'<input class="tinput" type="time" value="'+esc(entreeAff(rec))+'" aria-label="Entrée de '+esc(empName(e.id))+
        '" onchange="editPres(\''+escJs(e.id)+'\',\'entree\',this.value)"'+dis+'>':'<span style="color:var(--faint)">—</span>')+'</td>'+
      '<td>'+(showTimes?'<input class="tinput" type="time" value="'+esc(sortieAff(rec))+'" aria-label="Sortie de '+esc(empName(e.id))+
        '" onchange="editPres(\''+escJs(e.id)+'\',\'sortie\',this.value)"'+dis+'>'+badges:'<span style="color:var(--faint)">—</span>')+'</td>'+
      '<td>'+hCell+'</td>'+
      '<td>'+(m.retard?'<b style="color:var(--late)">+'+m.retard+' min</b>':'—')+'</td>'+
      '<td>'+hsCell+'</td></tr>';
  }).join('')||'<tr><td colspan="9"><div class="empty">Aucune ligne ne correspond aux filtres</div></td></tr>';
}
window.fillPres=fillPres;

function _garde(){
  if(!can('edit')){toast('Compte en lecture seule','warn');fillPres();return false}
  if(moisClos(PRES_DATE.slice(0,7))){toast('Mois clôturé — modification refusée','warn');fillPres();return false}
  return true;
}
function _rec(id){
  if(!DB.pointages[PRES_DATE])DB.pointages[PRES_DATE]={};
  if(!DB.pointages[PRES_DATE][id])DB.pointages[PRES_DATE][id]={statut:'absent',entree:'',sortie:''};
  return DB.pointages[PRES_DATE][id];
}
function editPres(id,field,val){
  if(!_garde())return;
  const rec=_rec(id);
  if((field==='entree'||field==='sortie')&&rec.punches){
    /* on fige les badges en entree/sortie avant d'abandonner le detail, sinon
       corriger la sortie effacait aussi l'entree issue des badges */
    if(!rec.entree)rec.entree=rec.punches[0]||'';
    if(!rec.sortie)rec.sortie=rec.punches[rec.punches.length-1]||'';
    delete rec.punches;
  }
  rec[field]=val;
  rec.manuel=1; rec.src='manuel';
  if(field==='statut'&&val==='absent'){rec.entree='';rec.sortie='';delete rec.punches;delete rec.hM;delete rec.hsM}
  if(field==='statut'&&val==='present'&&!rec.entree){const rg=regimeFor(PRES_DATE);rec.entree=rg.debut||'07:30';rec.sortie=rg.fin||'16:30'}
  persistPointage(PRES_DATE,id);fillPres();majSidebar();
}
function _minutes(val){
  const v=String(val).trim().replace(',','.');
  if(v==='')return null;
  let mins;
  if(v.indexOf('h')>=0){const p=v.split('h');mins=(parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0);}
  else if(v.indexOf(':')>=0){mins=toMin(v);}
  else mins=Math.round(parseFloat(v)*60);
  if(mins==null||isNaN(mins)||mins<0)return NaN;
  if(mins>1440)return NaN;
  return mins;
}
function editHeures(id,val){
  if(!_garde())return;
  const rec=_rec(id);const m=_minutes(val);
  if(isNaN(m)){toast('Valeur d’heures non comprise (ex. 8, 8,5 ou 8h30)','warn');fillPres();return}
  if(m===null)delete rec.hM; else {rec.hM=m; if(rec.statut==='absent')rec.statut='present';}
  rec.src='manuel';
  persistPointage(PRES_DATE,id);fillPres();majSidebar();
  toast(m===null?'Heures remises en calcul automatique'
    :'Heures saisies · les heures supplémentaires passent aussi en saisie manuelle');
}
function editHS(id,val){
  if(!_garde())return;
  const rec=_rec(id);const m=_minutes(val);
  if(isNaN(m)){toast('Valeur non comprise (ex. 2, 1,5 ou 1h30)','warn');fillPres();return}
  if(m===null)delete rec.hsM; else rec.hsM=m;
  rec.src='manuel';
  persistPointage(PRES_DATE,id);fillPres();
}
function revertManuel(id){
  if(!_garde())return;
  const rec=(DB.pointages[PRES_DATE]||{})[id];if(!rec)return;
  const aDesHeures=rec.hM!=null||rec.hsM!=null;
  if(rec.src==='conge'&&!confirm('Cette journée provient d’un congé validé.\n\n'+
    'Retirer la protection permettra à un import de la remplacer par le pointage de la pointeuse.\n\nContinuer ?'))return;
  if(rec.src!=='conge'&&!confirm('Retirer la protection de cette journée ?\n\n'+
    (aDesHeures?'Les heures saisies à la main sont CONSERVÉES — elles maintiennent donc la protection. '+
      'Pour la lever complètement, videz aussi les colonnes Heures et H. sup.\n\n':'')+
    'Les prochains imports de la pointeuse pourront de nouveau écraser l’entrée et la sortie.'))return;
  delete rec.manuel;
  if(rec.src==='conge')delete rec.src;
  /* on ne supprime plus hM/hsM ici : lever la protection détruisait les heures
     corrigées à la main */
  persistPointage(PRES_DATE,id);fillPres();
  toast('Protection retirée — synchronisez pour restaurer les données de la pointeuse');
}
async function createDay(){
  if(!_garde())return;
  const rg=regimeFor(PRES_DATE), f=ferieFor(PRES_DATE);
  if(!confirm('Créer la journée du '+fmtDate(PRES_DATE)+' ?\n\n'+
    (f?'Ce jour est férié ('+f.nom+') : le personnel sera inscrit comme « férié ».\n\n':
      rg.actif===false?'Ce jour est un jour de repos : le personnel sera inscrit comme « repos ».\n\n':
      'Tout l’effectif sera inscrit présent de '+(rg.debut||'07:30')+' à '+(rg.fin||'16:30')+
      ', en SAISIE MANUELLE.\nCes heures ne seront plus remplacées par l’import réel de la pointeuse.\n\n')+
    'Continuer ?'))return;
  const rec={};
  DB.employees.forEach(e=>{
    if(e.actif===false)return;
    if(f)rec[e.id]={statut:'ferie',entree:'',sortie:'',src:'calendrier'};
    else if(rg.actif===false)rec[e.id]={statut:'repos',entree:'',sortie:'',src:'calendrier'};
    else rec[e.id]={statut:'present',entree:rg.debut||'07:30',sortie:rg.fin||'16:30',manuel:1,src:'manuel'};
  });
  DB.pointages[PRES_DATE]=rec;
  await persistDay(PRES_DATE);
  await go('presences');
  toast('Journée du '+fmtDate(PRES_DATE)+' créée');
}
Object.assign(window,{editPres,editHeures,editHS,revertManuel,createDay});

async function syncNow(){
  toast('Synchronisation avec la pointeuse…');
  try{
    const d=await api('/api/sync',{method:'POST'});
    if(d&&d.error){toast('Synchronisation : '+d.error,'warn');return}
    await charger();await rendre();
    toast('Synchronisé'+(d&&d.last?' ('+String(d.last).replace('T',' ')+')':''));
  }catch(e){toast('Synchronisation impossible : '+e.message,'err')}
}
window.syncNow=syncNow;

/* ---------------------------------------------------------- clôture de mois */
async function cloturerMois(ym){
  if(!can('cloture')){toast('Réservé aux RH','warn');return}
  const l=aRevoir(...monthBounds(ym));
  if(l.length&&!confirm(l.length+' journée(s) du mois sont encore à vérifier.\n\nClôturer quand même ?'))return;
  if(!confirm('Clôturer '+ym+' ?\n\nPlus aucun pointage de ce mois ne pourra être modifié, ni par la saisie, ni par un import de la pointeuse. Vous pourrez rouvrir le mois si nécessaire.'))return;
  const cl=[...new Set([...(S().clotures||[]),ym])].sort();
  S().clotures=cl;ENGINE.invalidate();
  if(await saveNow()){toast('Mois '+ym+' clôturé');await rendre()}
}
async function rouvrirMois(ym){
  if(!can('cloture')){toast('Réservé aux RH','warn');return}
  if(!confirm('Rouvrir le mois '+ym+' ? Les pointages redeviennent modifiables.'))return;
  S().clotures=(S().clotures||[]).filter(x=>x!==ym);ENGINE.invalidate();
  if(await saveNow()){toast('Mois '+ym+' rouvert');await rendre()}
}
Object.assign(window,{cloturerMois,rouvrirMois});

/* ============================================================================
   GRAPHIQUES — SVG maison
   Chart.js venait d'un CDN : sans Internet (mode local usine) tous les
   graphiques disparaissaient silencieusement, et un CDN compromis exécutait du
   code dans la session administrateur. Plus de dépendance externe.
   ============================================================================ */
const PALETTE=['#96382a','#a3822f','#276b48','#3d52a8','#68489a','#0b7373','#8e4736','#4b5c26'];
function _svg(id,w,h,inner,legend){
  const el=document.getElementById(id);if(!el)return;
  el.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img">'+inner+'</svg>'+(legend||'');
}
function dessinerLigne(id,data,suffixe){
  const el=document.getElementById(id);if(!el)return;
  if(!data.length){el.innerHTML='<div class="empty" style="padding:20px">Pas encore de données</div>';return}
  const W=560,H=240,ml=42,mb=26,mt=10,mr=8;
  const max=Math.max(1,...data.map(d=>d.v))*1.25;
  const x=i=>ml+(W-ml-mr)*(data.length===1?0.5:i/(data.length-1));
  const y=v=>mt+(H-mt-mb)*(1-v/max);
  let g='';
  for(let k=0;k<=4;k++){const v=max*k/4;g+='<line x1="'+ml+'" y1="'+y(v)+'" x2="'+(W-mr)+'" y2="'+y(v)+
    '" stroke="#efebe0" stroke-width="1"/><text x="'+(ml-7)+'" y="'+(y(v)+3.5)+
    '" text-anchor="end" font-size="10" fill="#6b7280">'+(Math.round(v*10)/10)+(suffixe||'')+'</text>';}
  const pts=data.map((d,i)=>x(i)+','+y(d.v)).join(' ');
  const aire='M'+x(0)+','+y(0)+' L'+data.map((d,i)=>x(i)+','+y(d.v)).join(' L')+' L'+x(data.length-1)+','+y(0)+' Z';
  g+='<path d="'+aire+'" fill="rgba(163,130,47,.14)"/>';
  g+='<polyline points="'+pts+'" fill="none" stroke="#a3822f" stroke-width="2.5" stroke-linejoin="round"/>';
  data.forEach((d,i)=>{g+='<circle cx="'+x(i)+'" cy="'+y(d.v)+'" r="4" fill="#a3822f"><title>'+esc(d.l+' : '+d.v+(suffixe||''))+'</title></circle>'+
    '<text x="'+x(i)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="#6b7280">'+esc(d.l)+'</text>';});
  _svg(id,W,H,g);
}
function dessinerBarres(id,data,horizontal){
  const el=document.getElementById(id);if(!el)return;
  if(!data.length){el.innerHTML='<div class="empty" style="padding:20px">Pas encore de données</div>';return}
  const W=560,H=el.classList.contains('sm')?200:240,ml=horizontal?120:42,mb=26,mt=10,mr=10;
  const max=Math.max(1,...data.map(d=>d.v));
  let g='';
  if(horizontal){
    const bh=(H-mt-mb)/data.length;
    data.forEach((d,i)=>{const w=(W-ml-mr)*d.v/max;const yy=mt+i*bh+bh*0.18;
      g+='<rect x="'+ml+'" y="'+yy+'" width="'+Math.max(2,w)+'" height="'+bh*0.64+'" rx="3" fill="'+(d.c||PALETTE[i%PALETTE.length])+'"><title>'+esc(d.l+' : '+d.v)+'</title></rect>'+
        '<text x="'+(ml-8)+'" y="'+(yy+bh*0.44)+'" text-anchor="end" font-size="10.5" fill="#5c6270">'+esc(d.l)+'</text>'+
        '<text x="'+(ml+w+6)+'" y="'+(yy+bh*0.44)+'" font-size="10.5" fill="#5c6270">'+d.v+'</text>';});
  }else{
    const bw=(W-ml-mr)/data.length;
    for(let k=0;k<=4;k++){const v=max*k/4;const yy=mt+(H-mt-mb)*(1-v/max);
      g+='<line x1="'+ml+'" y1="'+yy+'" x2="'+(W-mr)+'" y2="'+yy+'" stroke="#efebe0"/>'+
         '<text x="'+(ml-7)+'" y="'+(yy+3.5)+'" text-anchor="end" font-size="10" fill="#6b7280">'+(Math.round(v*10)/10)+'</text>';}
    data.forEach((d,i)=>{const h=(H-mt-mb)*d.v/max;const xx=ml+i*bw+bw*0.2;
      g+='<rect x="'+xx+'" y="'+(H-mb-h)+'" width="'+bw*0.6+'" height="'+Math.max(2,h)+'" rx="3" fill="'+(d.c||PALETTE[i%PALETTE.length])+'"><title>'+esc(d.l+' : '+d.v)+'</title></rect>'+
        '<text x="'+(xx+bw*0.3)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="#6b7280">'+esc(d.l)+'</text>';});
  }
  _svg(id,W,H,g);
}
function dessinerDonut(id,data){
  const el=document.getElementById(id);if(!el)return;
  const tot=data.reduce((s,d)=>s+d.v,0);
  if(!tot){el.innerHTML='<div class="empty" style="padding:20px">Pas encore de données</div>';return}
  const W=560,H=240,cx=130,cy=120,r=88,ir=54;
  let a0=-Math.PI/2,g='';
  data.forEach((d,i)=>{
    const a1=a0+2*Math.PI*d.v/tot;
    const big=(a1-a0)>Math.PI?1:0;
    const p=[cx+r*Math.cos(a0),cy+r*Math.sin(a0),cx+r*Math.cos(a1),cy+r*Math.sin(a1),
             cx+ir*Math.cos(a1),cy+ir*Math.sin(a1),cx+ir*Math.cos(a0),cy+ir*Math.sin(a0)];
    g+='<path d="M'+p[0]+','+p[1]+' A'+r+','+r+' 0 '+big+' 1 '+p[2]+','+p[3]+' L'+p[4]+','+p[5]+
       ' A'+ir+','+ir+' 0 '+big+' 0 '+p[6]+','+p[7]+' Z" fill="'+PALETTE[i%PALETTE.length]+
       '"><title>'+esc(d.l+' : '+d.v)+'</title></path>';
    a0=a1;
  });
  g+='<text x="'+cx+'" y="'+(cy+2)+'" text-anchor="middle" font-size="26" font-weight="600" fill="#1f2330">'+tot+'</text>'+
     '<text x="'+cx+'" y="'+(cy+20)+'" text-anchor="middle" font-size="10.5" fill="#6b7280">total</text>';
  data.forEach((d,i)=>{const yy=32+i*24;
    g+='<rect x="270" y="'+(yy-9)+'" width="10" height="10" rx="3" fill="'+PALETTE[i%PALETTE.length]+'"/>'+
       '<text x="288" y="'+yy+'" font-size="11.5" fill="#5c6270">'+esc(d.l)+' — '+d.v+'</text>';});
  _svg(id,W,H,g);
}
Object.assign(window,{dessinerLigne,dessinerBarres,dessinerDonut,PALETTE});

/* ============================================================================
   DÉMARRAGE
   ============================================================================ */
async function demarrer(){
  try{
    const w=await api('/api/whoami');
    ME={login:w.login,nom:w.nom||w.login,role:w.role||'lecture'};
  }catch(e){ /* le middleware redirige déjà si non connecté */ }
  construireCoquille();
  try{ await charger(); }
  catch(e){ ecranErreur(e); return; }
  const h=(location.hash||'').replace('#/','');
  if(h&&NAV.some(n=>n.v===h))VIEW=h;
  await rendre();
  window.addEventListener('hashchange',()=>{
    const v=(location.hash||'').replace('#/','');
    if(v&&v!==VIEW&&NAV.some(n=>n.v===v)){VIEW=v;rendre()}
  });
}
window.demarrer=demarrer;
