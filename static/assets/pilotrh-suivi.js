/* ============================================================================
   PilotRH — suivi de l'assiduité et corrections de pointage en masse

   1. ASSIDUITÉ : absences et retards par personne, sur la période choisie,
      avec la répartition par mois et par jour de la semaine. Les vues
      « Absences » et « Retards » montrent le jour et le mois en cours ; celle-ci
      répond à « qui, combien de fois, depuis quand ».

   2. CORRECTIONS EN MASSE : les journées au pointage anormal (sortie non badgée,
      badges impairs, heures de nuit, démarrage anticipé) regroupées par famille
      et par jour, pour les corriger d'un geste au lieu d'une ligne à la fois.
      Toute correction est montrée AVANT d'être écrite, protégée des réimports
      de la pointeuse, tracée dans le journal, et annulable.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { esc, escJs, toMin, fromMin, hDec, fr2, hLabel, pad } = C;
const JSEM = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MOIS_ABR = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const moisCourt = ym => MOIS_ABR[+ym.slice(5,7)-1]+' '+ym.slice(2,4);
const peutDiscipline = () => ['admin','rh'].includes(ME.role);

/* ----------------------------------------------------------------------------
   1. ASSIDUITÉ
   ---------------------------------------------------------------------------- */
let AS_FROM='', AS_TO='', AS_Q='', AS_TRI='score', AS_SENS=-1, AS_SEUL=false, AS=null;

function seuils(){
  const s=(DB.settings.suivi)||{};
  return {retards:+s.retards||3, absences:+s.absences||2};
}
function absenceJustifiee(id,ds){
  return DB.absences.some(a=>a.id===id && a.statut==='justifiée' && a.debut<=ds && ds<=(a.fin||a.debut));
}
/* Le calcul est une fonction pure de (DB, période) : elle est testée telle quelle. */
function calcAssiduite(a,b){
  const fin = b>TODAY?TODAY:b;
  const par={}, mois=[], parMois={}, parJsem=[0,0,0,0,0,0,0];
  DB.employees.forEach(e=>{ if(e.actif===false) return;
    par[e.id]={e,attendus:0,pres:0,absI:0,absJ:0,conge:0,ret:0,retMin:0,inc:0,mois:{},jsem:[0,0,0,0,0,0,0],ev:[],debut:''}; });
  /* Une personne importée après coup figure « absente » sur tous les jours
     d'avant son arrivée. On ne compte donc qu'à partir de sa date d'embauche si
     la fiche est remplie, sinon à partir de sa première présence sur la période. */
  const premiere={};
  eachDay(a,fin,ds=>{ const rec=dayRec(ds); if(!rec) return;
    for(const id in par){ if(premiere[id]) continue;
      const r=rec[id]; if(r && ENGINE.badges(r).length) premiere[id]=ds; } });
  for(const id in par){ const e=par[id].e;
    par[id].debut = (e.embauche && !e.aCompleter) ? e.embauche : (premiere[id]||'9999-99-99'); }
  eachDay(a,fin,ds=>{
    const rec=dayRec(ds); if(!rec) return;
    const ym=ds.slice(0,7); if(!parMois[ym]){parMois[ym]={ym,abs:0,ret:0,attendus:0};mois.push(ym)}
    const w=new Date(ds+'T12:00').getDay(), ouvre=estOuvre(ds);
    for(const id in par){
      const s=par[id]; if(ds<s.debut) continue;
      /* pas d'enregistrement pour elle ce jour-là : on ne l'invente pas (même règle que l'espace salarié) */
      if(!rec[id]) continue;
      const m=metrics(rec[id],ds);
      const sm=s.mois[ym]||(s.mois[ym]={abs:0,ret:0});
      if(m.statut==='absent'){
        if(!ouvre) continue;
        s.attendus++; parMois[ym].attendus++;
        const just=absenceJustifiee(id,ds);
        if(just){s.absJ++} else {s.absI++}
        sm.abs++; s.jsem[w]++; parMois[ym].abs++; parJsem[w]++;
        s.ev.push({ds,type:just?'absJ':'absI'});
      }else if(m.statut==='leave'||m.statut==='mission'){
        if(ouvre){s.attendus++; parMois[ym].attendus++; s.conge++; s.ev.push({ds,type:'conge'})}
      }else if(m.statut==='ferie'||m.statut==='repos'){
        /* ni attendu ni absent */
      }else{
        if(ouvre){s.attendus++; parMois[ym].attendus++}
        s.pres++;
        if(m.late){s.ret++; s.retMin+=m.retard; sm.ret++; parMois[ym].ret++;
          s.ev.push({ds,type:'ret',min:m.retard,heure:(rec[id]||{}).entree||''})}
        if(m.revue){s.inc++; s.ev.push({ds,type:'inc',motif:m.motifRevue})}
      }
    }
  });
  const se=seuils();
  const lignes=Object.values(par).filter(s=>s.attendus>0).map(s=>{
    s.abs=s.absI+s.absJ;
    s.taux=s.attendus?Math.round(s.abs*1000/s.attendus)/10:0;
    s.alerteRet=s.ret>=se.retards; s.alerteAbs=s.absI>=se.absences;
    /* un score simple pour le tri par défaut : une absence injustifiée pèse plus qu'un retard */
    s.score=s.absI*3+s.absJ+s.ret;
    return s;
  });
  const tot=lignes.reduce((t,s)=>({attendus:t.attendus+s.attendus,abs:t.abs+s.abs,absI:t.absI+s.absI,
    ret:t.ret+s.ret,retMin:t.retMin+s.retMin}),{attendus:0,abs:0,absI:0,ret:0,retMin:0});
  tot.taux=tot.attendus?Math.round(tot.abs*1000/tot.attendus)/10:0;
  tot.signales=lignes.filter(s=>s.alerteRet||s.alerteAbs).length;
  return {a,b:fin,lignes,mois,parMois,parJsem,tot,seuils:se};
}

VUES.assiduite = async function(main){
  if(!AS_FROM){
    const d=new Date(TODAY+'T12:00'); d.setDate(1); d.setMonth(d.getMonth()-2);
    AS_FROM=C.isoOf(d); AS_TO=TODAY;
  }
  await ensureRange(AS_FROM,AS_TO);
  AS=calcAssiduite(AS_FROM,AS_TO);
  const t=AS.tot, se=AS.seuils;
  main.innerHTML=topbar('Suivi par personne','Assiduité',
    '<button class="btn btn-ghost" onclick="csvAssiduite()">'+I.download+' Synthèse CSV</button>'+
    '<button class="btn btn-ghost" onclick="csvAssiduiteDetail()">'+I.download+' Détail CSV</button>')+
  '<div class="page view">'+
    '<div class="kpis" style="grid-template-columns:repeat(5,1fr)">'+
      kpi('Taux d’absentéisme',fr2(t.taux).replace(',00','')+' %',t.abs+' jour(s) sur '+t.attendus,I.calx,'var(--absent)','var(--absent-bg)')+
      kpi('Absences injustifiées',t.absI,'sur la période',I.warn,'var(--absent)','var(--absent-bg)')+
      kpi('Retards',t.ret,'sur la période',I.late,'var(--late)','var(--late-bg)')+
      kpi('Temps perdu en retards',hLabel(t.retMin),'cumul',I.clock,'var(--ink)','#eae5d9')+
      kpi('Personnes signalées',t.signales,'≥ '+se.retards+' retards ou ≥ '+se.absences+' abs. injust.',I.users,'var(--gold-ink)','var(--gold-soft)')+'</div>'+
    '<div class="card" style="padding:14px 16px;margin-bottom:16px"><div class="range-bar" style="margin:0">'+
      '<div class="field"><label for="asFrom">Du</label><input type="date" id="asFrom" value="'+AS_FROM+'" onchange="asPeriode()"></div>'+
      '<div class="field"><label for="asTo">Au</label><input type="date" id="asTo" value="'+AS_TO+'" onchange="asPeriode()"></div>'+
      '<button class="btn btn-ghost" onclick="asRaccourci(0)">Ce mois</button>'+
      '<button class="btn btn-ghost" onclick="asRaccourci(2)">3 mois</button>'+
      '<button class="btn btn-ghost" onclick="asRaccourci(11)">12 mois</button>'+
      '<div class="field"><label for="asServ">Service</label><select id="asServ" onchange="fillAssiduite()"><option value="">Tous</option>'+SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field" style="flex:1;min-width:170px">'+I.search+'<label for="asQ" class="sr-only">Recherche</label>'+
        '<input id="asQ" type="search" value="'+esc(AS_Q)+'" placeholder="Nom, matricule…" oninput="AS_Q=this.value;fillAssiduite()"></div>'+
      '</div>'+
      '<div class="range-bar" style="margin:10px 0 0;align-items:center">'+
        '<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="asSeul" '+(AS_SEUL?'checked':'')+' onchange="AS_SEUL=this.checked;fillAssiduite()"> Seulement les personnes signalées</label>'+
        '<span class="hint" style="margin-left:auto">Signaler à partir de</span>'+
        '<div class="field"><label for="asSR">retards</label><input type="number" id="asSR" min="1" max="60" value="'+se.retards+'" style="width:64px" onchange="asSeuils()"></div>'+
        '<div class="field"><label for="asSA">absences injustifiées</label><input type="number" id="asSA" min="1" max="60" value="'+se.absences+'" style="width:64px" onchange="asSeuils()"></div>'+
      '</div></div>'+
    '<div class="split" style="margin-bottom:16px">'+
      '<div class="card chartcard"><h3>Absences et retards par mois</h3><div class="chart" id="asMois"></div></div>'+
      '<div class="card chartcard"><h3>Absences selon le jour de la semaine</h3><div class="chart" id="asJsem"></div></div>'+
    '</div>'+
    '<div class="card tablecard"><div class="table-head">'+I.users+'<h3>Par personne — '+fmtDate(AS.a)+' → '+fmtDate(AS.b)+'</h3>'+
      '<div class="spacer"></div><span style="font-size:12px;color:var(--muted)" id="asCount"></span></div>'+
      '<div class="tblwrap"><table class="tbl" id="asTbl"><thead><tr>'+
        asTh('mat','Mat.')+asTh('nom','Employée')+asTh('taux','Absentéisme')+asTh('absI','Abs. injust.')+asTh('absJ','Abs. justif.')+
        asTh('ret','Retards')+asTh('retMin','Minutes')+asTh('inc','Pointages incomplets')+
        AS.mois.slice(-6).map(ym=>'<th title="Absences / retards du mois" style="text-align:center">'+esc(moisCourt(ym))+'</th>').join('')+
        '<th></th></tr></thead><tbody id="asBody"></tbody></table></div>'+
      '<div class="hint" style="padding:10px 16px">Colonnes de mois : <b>absences</b> / <b>retards</b>. '+
        'Une absence est « justifiée » si un justificatif couvre la date (vue Absences). Les jours fériés et de repos ne comptent pas.</div></div>'+
  '</div>';
  dessinerBarresDoubles('asMois',AS.mois.map(ym=>({l:moisCourt(ym),a:AS.parMois[ym].abs,b:AS.parMois[ym].ret})),'Absences','Retards');
  dessinerBarres('asJsem',[1,2,3,4,5,6,0].filter(w=>AS.parJsem[w]||w!==0).map(w=>({l:JSEM[w],v:AS.parJsem[w],c:'#96382a'})));
  fillAssiduite();
};
function asTh(k,l){
  return '<th style="cursor:pointer;white-space:nowrap" onclick="asTri(\''+k+'\')" title="Trier">'+esc(l)+
    (AS_TRI===k?(AS_SENS<0?' ▼':' ▲'):'')+'</th>';
}
function dessinerBarresDoubles(id,data,la,lb){
  const el=document.getElementById(id); if(!el) return;
  if(!data.length){el.innerHTML='<div class="empty" style="padding:20px">Pas encore de données</div>';return}
  const W=560,H=240,ml=38,mb=26,mt=10,mr=8, max=Math.max(1,...data.map(d=>Math.max(d.a,d.b)));
  const bw=(W-ml-mr)/data.length; let g='';
  for(let k=0;k<=4;k++){const v=max*k/4, y=mt+(H-mt-mb)*(1-v/max);
    g+='<line x1="'+ml+'" y1="'+y+'" x2="'+(W-mr)+'" y2="'+y+'" stroke="#efebe0"/><text x="'+(ml-7)+'" y="'+(y+3.5)+'" text-anchor="end" font-size="10" fill="#6b7280">'+Math.round(v)+'</text>'}
  data.forEach((d,i)=>{
    [['a','#96382a',la],['b','#a3822f',lb]].forEach((s,j)=>{
      const h=(H-mt-mb)*d[s[0]]/max, x=ml+i*bw+bw*(0.14+j*0.37);
      g+='<rect x="'+x+'" y="'+(H-mb-h)+'" width="'+bw*0.33+'" height="'+Math.max(1,h)+'" rx="2" fill="'+s[1]+'"><title>'+esc(d.l+' — '+s[2]+' : '+d[s[0]])+'</title></rect>';
    });
    g+='<text x="'+(ml+i*bw+bw/2)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="#6b7280">'+esc(d.l)+'</text>';
  });
  el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img">'+g+'</svg>'+
    '<div class="hint" style="display:flex;gap:14px;justify-content:center;margin-top:4px">'+
    '<span><span class="dotmark" style="background:#96382a"></span> '+esc(la)+'</span><span><span class="dotmark" style="background:#a3822f"></span> '+esc(lb)+'</span></div>';
}
function asLignes(){
  const q=AS_Q.toLowerCase(), sv=(($('#asServ')||{}).value)||'';
  const val=(s,k)=>k==='mat'?(+matOf(s.e)||matOf(s.e)):k==='nom'?((s.e.nom||'')+' '+(s.e.prenom||'')).toLowerCase():s[k];
  return AS.lignes.filter(s=>(!q||((s.e.prenom||'')+' '+(s.e.nom||'')+' '+matOf(s.e)).toLowerCase().includes(q))
      &&(!sv||s.e.service===sv)&&(!AS_SEUL||s.alerteRet||s.alerteAbs))
    .sort((x,y)=>{const a=val(x,AS_TRI),b=val(y,AS_TRI);return (a<b?-1:a>b?1:0)*AS_SENS||(y.score-x.score)});
}
function fillAssiduite(){
  const tb=$('#asBody'); if(!tb||!AS) return;
  const l=asLignes(), mois=AS.mois.slice(-6);
  $('#asCount').textContent=l.length+' personne(s)';
  tb.innerHTML=l.map(s=>'<tr data-emp="'+esc(s.e.id)+'">'+
    '<td class="mono">'+esc(matOf(s.e))+'</td><td>'+empCell(s.e.id,true)+'</td>'+
    '<td><b>'+fr2(s.taux).replace(',00','')+' %</b> <span style="color:var(--muted);font-size:12px">'+s.abs+'/'+s.attendus+' j</span></td>'+
    '<td>'+(s.absI?'<b style="color:var(--absent)">'+s.absI+'</b>':'<span style="color:var(--faint)">0</span>')+(s.alerteAbs?' <span class="tag t-absent">seuil</span>':'')+'</td>'+
    '<td>'+(s.absJ||'<span style="color:var(--faint)">0</span>')+'</td>'+
    '<td>'+(s.ret?'<b style="color:var(--late)">'+s.ret+'</b>':'<span style="color:var(--faint)">0</span>')+(s.alerteRet?' <span class="tag t-late">seuil</span>':'')+'</td>'+
    '<td class="mono">'+(s.retMin||'')+'</td>'+
    '<td>'+(s.inc||'<span style="color:var(--faint)">0</span>')+'</td>'+
    mois.map(ym=>{const m=s.mois[ym]||{abs:0,ret:0};
      return '<td class="mono" style="text-align:center;font-size:12px">'+((m.abs||m.ret)
        ?'<span style="color:'+(m.abs?'var(--absent)':'var(--faint)')+'">'+m.abs+'</span> / <span style="color:'+(m.ret?'var(--late)':'var(--faint)')+'">'+m.ret+'</span>'
        :'<span style="color:var(--faint)">·</span>')+'</td>'}).join('')+
    '<td><button class="linkish" onclick="openAssiduite(\''+escJs(s.e.id)+'\')">Détail →</button></td></tr>').join('')
   ||'<tr><td colspan="'+(9+mois.length)+'"><div class="empty">'+I.check+'<div>Personne à afficher sur cette période</div></div></td></tr>';
}
function asTri(k){ if(AS_TRI===k) AS_SENS=-AS_SENS; else {AS_TRI=k; AS_SENS=(k==='nom'||k==='mat')?1:-1}
  go('assiduite'); }
async function asPeriode(){ const a=$('#asFrom').value,b=$('#asTo').value; if(!a||!b) return;
  AS_FROM=a<b?a:b; AS_TO=a<b?b:a; await go('assiduite'); }
async function asRaccourci(n){ const d=new Date(TODAY+'T12:00'); d.setDate(1); d.setMonth(d.getMonth()-n);
  AS_FROM=C.isoOf(d); AS_TO=TODAY; await go('assiduite'); }
function asSeuils(){
  DB.settings.suivi={retards:Math.max(1,+$('#asSR').value||3), absences:Math.max(1,+$('#asSA').value||2)};
  if(can('settings')) save();
  go('assiduite');
}
const EV_LIB={absI:'Absence injustifiée',absJ:'Absence justifiée',conge:'Congé / mission',ret:'Retard',inc:'Pointage incomplet'};
const EV_COL={absI:'#96382a',absJ:'#7a8794',conge:'#68489a',ret:'#c58a1c',inc:'#3d52a8'};
function openAssiduite(id){
  const s=AS&&AS.lignes.find(x=>x.e.id===id); if(!s) return;
  const parJour={}; s.ev.forEach(v=>{(parJour[v.ds]=parJour[v.ds]||[]).push(v)});
  /* frise : un carré par jour de la période, mois par mois */
  let frise='';
  AS.mois.forEach(ym=>{
    const [a,b]=monthBounds(ym); let cases='';
    eachDay(a<AS.a?AS.a:a, b>AS.b?AS.b:b, ds=>{
      const ev=(parJour[ds]||[])[0], rec=dayRec(ds);
      let col='#e9e4d6', tip=fmtDate(ds);
      if(ev){col=EV_COL[ev.type]; tip+=' — '+EV_LIB[ev.type]+(ev.min?' ('+ev.min+' min)':'')}
      else if(rec && ds>=s.debut){const m=metrics(rec[id],ds); if(m.worked||['present','late'].includes(m.statut)){col='#8fbf9f'; tip+=' — présente'}}
      cases+='<span title="'+esc(tip)+'" style="display:inline-block;width:13px;height:13px;border-radius:3px;margin:1px;background:'+col+'"></span>';
    });
    frise+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span class="mono" style="width:62px;font-size:11.5px;color:var(--muted)">'+esc(moisCourt(ym))+'</span><div>'+cases+'</div></div>';
  });
  const ev=s.ev.filter(v=>v.type!=='conge').sort((x,y)=>x.ds<y.ds?1:-1);
  const maxJ=Math.max(...s.jsem), jFort=maxJ>=2&&maxJ>=s.abs*0.4?s.jsem.indexOf(maxJ):-1;
  openModal('<div class="modal-head">'+I.users+'<h3>Assiduité — '+esc(empName(id))+'</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">'+
      miniKpi('Absentéisme',fr2(s.taux).replace(',00','')+' %','var(--absent)')+miniKpi('Abs. injustifiées',s.absI,'var(--absent)')+
      miniKpi('Retards',s.ret+(s.retMin?' · '+s.retMin+' min':''),'var(--late)')+miniKpi('Jours attendus',s.attendus,'var(--ink)')+'</div>'+
    (jFort>=0?'<div class="banner banner-info" style="margin:0 0 12px">'+I.warn+'<div class="grow">'+s.jsem[jFort]+' des '+s.abs+
      ' absences tombent un <b>'+['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][jFort]+'</b>.</div></div>':'')+
    '<div class="info-block"><h4>Du '+fmtDate(AS.a)+' au '+fmtDate(AS.b)+'</h4>'+frise+
      '<div class="hint" style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap">'+
        [['#8fbf9f','Présente'],[EV_COL.ret,'Retard'],[EV_COL.absI,'Absence injustifiée'],[EV_COL.absJ,'Absence justifiée'],[EV_COL.conge,'Congé'],[EV_COL.inc,'Pointage incomplet'],['#e9e4d6','Repos / férié']]
          .map(x=>'<span><span class="dotmark" style="background:'+x[0]+'"></span> '+x[1]+'</span>').join('')+'</div></div>'+
    '<div class="info-block"><h4>Détail ('+ev.length+')</h4><div class="tblwrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th>Date</th><th>Jour</th><th>Événement</th><th>Précision</th><th></th></tr></thead><tbody>'+
      (ev.map(v=>'<tr><td class="mono">'+fmtDate(v.ds)+'</td><td>'+JSEM[new Date(v.ds+'T12:00').getDay()]+'</td>'+
        '<td><span class="dotmark" style="background:'+EV_COL[v.type]+'"></span> '+EV_LIB[v.type]+'</td>'+
        '<td style="color:var(--muted);font-size:12.5px">'+esc(v.type==='ret'?'arrivée '+(v.heure||'?')+' · +'+v.min+' min':(v.motif||''))+'</td>'+
        '<td><button class="linkish" onclick="closeModal();allerAuJour(\''+v.ds+'\',\''+escJs(id)+'\')">Voir le jour →</button></td></tr>').join('')
        ||'<tr><td colspan="5"><div class="empty">Aucun retard ni absence</div></td></tr>')+'</tbody></table></div></div>'+
  '</div><div class="modal-foot">'+
    '<button class="btn btn-ghost" style="margin-right:auto" onclick="closeModal();openProfile(\''+escJs(id)+'\')">Ouvrir la fiche</button>'+
    (peutDiscipline()&&window.discNouveau?
      (s.ret?'<button class="btn btn-ghost" onclick="discDepuisAssiduite(\''+escJs(id)+'\',\'retards\')">Questionnaire — retards</button>':'')+
      (s.absI?'<button class="btn btn-gold" onclick="discDepuisAssiduite(\''+escJs(id)+'\',\'absence\')">Questionnaire — absences</button>':''):'')+
    '<button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>','wide');
}
/* Passe au dossier disciplinaire les faits relevés ici : c'est ce qui préremplit le document. */
function discDepuisAssiduite(id,motif){
  const s=AS.lignes.find(x=>x.e.id===id); if(!s) return;
  const faits=s.ev.filter(v=>motif==='retards'?v.type==='ret':v.type==='absI').sort((x,y)=>x.ds<y.ds?-1:1);
  closeModal();
  window.discNouveau(id,'questionnaire',{motif,evenements:faits,du:AS.a,au:AS.b});
}
function csvAssiduite(){
  const out=[['Assiduité par personne'],['Période','du '+AS.a,'au '+AS.b],[mentionRegime()],[],
    ['Matricule','Nom','Prénom','Service','Atelier','Jours attendus','Présences','Absences injustifiées','Absences justifiées','Congés',
     'Taux d’absentéisme (%)','Retards','Minutes de retard','Pointages incomplets'].concat(AS.mois.map(ym=>ym+' abs.')).concat(AS.mois.map(ym=>ym+' retards'))];
  asLignes().forEach(s=>out.push([matOf(s.e),s.e.nom||'',s.e.prenom||'',s.e.service||'',s.e.atelier||'',s.attendus,s.pres,s.absI,s.absJ,s.conge,
    String(s.taux).replace('.',','),s.ret,s.retMin,s.inc].concat(AS.mois.map(ym=>(s.mois[ym]||{}).abs||0)).concat(AS.mois.map(ym=>(s.mois[ym]||{}).ret||0))));
  csvDL('assiduite_'+AS.a+'_'+AS.b+'.csv',out); toast('Synthèse exportée');
}
function csvAssiduiteDetail(){
  const out=[['Assiduité — détail des événements'],['Période','du '+AS.a,'au '+AS.b],[],
    ['Date','Jour','Matricule','Nom','Prénom','Service','Événement','Arrivée','Retard (min)','Précision']];
  asLignes().forEach(s=>s.ev.filter(v=>v.type!=='conge').forEach(v=>out.push([v.ds,JSEM[new Date(v.ds+'T12:00').getDay()],matOf(s.e),
    s.e.nom||'',s.e.prenom||'',s.e.service||'',EV_LIB[v.type],v.heure||'',v.min||'',v.motif||''])));
  csvDL('assiduite_detail_'+AS.a+'_'+AS.b+'.csv',out); toast('Détail exporté');
}
Object.assign(window,{calcAssiduite,fillAssiduite,asTri,asPeriode,asRaccourci,asSeuils,openAssiduite,discDepuisAssiduite,csvAssiduite,csvAssiduiteDetail});
Object.defineProperty(window,'AS_Q',{get:()=>AS_Q,set:v=>{AS_Q=v},configurable:true});
Object.defineProperty(window,'AS_SEUL',{get:()=>AS_SEUL,set:v=>{AS_SEUL=v},configurable:true});

/* ----------------------------------------------------------------------------
   2. CORRECTIONS EN MASSE
   ---------------------------------------------------------------------------- */
const FAMILLES = {
  sortie:{t:'Sortie non badgée', d:'Un seul badge dans la journée : l’heure de sortie manque, la journée compte 0 h.'},
  impair:{t:'Badges impairs', d:'Trois ou cinq badges : un passage a été oublié, la durée est approximative.'},
  nuit:{t:'Heures de nuit', d:'Badge avant 05 h 30 ou première entrée après 20 h : horaire impossible pour l’atelier (horloge de la pointeuse déréglée, ou badge d’après minuit).'},
  tot:{t:'Démarrage anticipé', d:'Arrivée au moins 30 minutes avant l’horaire prévu : le temps d’avant l’heure officielle n’est pas compté.'},
};
const NUIT_AVANT=5*60+30, NUIT_ENTREE=20*60, TOT_MARGE=30;
let CM_FROM='', CM_TO='', CM_FAM='sortie', CM=null, CM_SEL=new Set(), CM_OUVERT=new Set(), CM_ANNUL=null;

/* Détection — fonction pure de (DB, période), testée telle quelle. */
function detecterAnomalies(a,b){
  const fin=b>TODAY?TODAY:b;
  const items=[], jours={}; let dejaCorrigees=0; const clos=new Set();
  eachDay(a,fin,ds=>{
    const rec=dayRec(ds); if(!rec) return;
    const reg=regimeFor(ds), debut=toMin(reg.debut), ouvre=estOuvre(ds);
    const j=jours[ds]={ds,presents:0,n:{sortie:0,impair:0,nuit:0,tot:0},clos:moisClos(ds.slice(0,7))};
    if(j.clos) clos.add(ds.slice(0,7));
    DB.employees.forEach(e=>{
      const r=rec[e.id]; if(!r) return;
      const P=ENGINE.badges(r); if(!P.length) return;
      j.presents++;
      const fams=[];
      if(P.length===1) fams.push('sortie');
      else if(P.length%2===1) fams.push('impair');
      if(P.some(p=>p<NUIT_AVANT)||P[0]>=NUIT_ENTREE) fams.push('nuit');
      else if(ouvre && debut!=null && P[0]<=debut-TOT_MARGE) fams.push('tot');
      if(!fams.length) return;
      if(r.manuel||(r.hM!=null&&r.hM!=='')){dejaCorrigees++; return}   // déjà traitée à la main : on n'y revient pas
      fams.forEach(f=>{j.n[f]++; items.push({cle:ds+'|'+e.id,ds,e,r,P,fam:f})});
    });
  });
  const total={sortie:0,impair:0,nuit:0,tot:0};
  items.forEach(x=>total[x.fam]++);
  /* une journée où la moitié des présentes n'ont qu'un badge n'est pas un oubli
     individuel : c'est la pointeuse (ou sa remontée) qui a manqué la sortie */
  Object.values(jours).forEach(j=>{ j.collectif={};
    for(const f in j.n) j.collectif[f]=j.presents>=5 && j.n[f]>=j.presents*(f==='tot'?0.3:0.5); });
  return {a,b:fin,items,jours,total,dejaCorrigees,clos:[...clos].sort()};
}

VUES.corrections = async function(main){
  if(!CM_FROM){[CM_FROM,CM_TO]=[monthBounds(TODAY.slice(0,7))[0],TODAY]}
  await ensureRange(CM_FROM,CM_TO);
  CM=detecterAnomalies(CM_FROM,CM_TO);
  if(!CM.total[CM_FAM]){ const f=Object.keys(FAMILLES).find(k=>CM.total[k]); if(f) CM_FAM=f; }
  CM_SEL=new Set([...CM_SEL].filter(k=>CM.items.some(x=>x.cle===k&&x.fam===CM_FAM)));
  const totalTout=Object.values(CM.total).reduce((s,n)=>s+n,0);
  main.innerHTML=topbar('Pointage','Corrections en masse','')+
  '<div class="page view">'+
    '<div class="banner banner-info" style="margin-bottom:14px">'+I.warn+'<div class="grow">'+
      '<b>Avant de corriger à la main</b> : si beaucoup de sorties manquent sur toute une journée, réimportez d’abord un fichier récent de la pointeuse — '+
      'les badges manquants y sont peut-être. Ce que vous corrigez ici est <b>protégé</b> : les imports suivants ne l’écraseront plus.</div></div>'+
    '<div class="card" style="padding:14px 16px;margin-bottom:16px"><div class="range-bar" style="margin:0">'+
      '<div class="field"><label for="cmFrom">Du</label><input type="date" id="cmFrom" value="'+CM_FROM+'" onchange="cmPeriode()"></div>'+
      '<div class="field"><label for="cmTo">Au</label><input type="date" id="cmTo" value="'+CM_TO+'" onchange="cmPeriode()"></div>'+
      '<button class="btn btn-ghost" onclick="cmRaccourci(0)">Ce mois</button>'+
      '<button class="btn btn-ghost" onclick="cmRaccourci(1)">Mois précédent</button>'+
      '<button class="btn btn-ghost" onclick="cmRaccourci(12)">12 mois</button>'+
      '<div class="spacer" style="flex:1"></div>'+
      (CM_ANNUL?'<button class="btn btn-ghost" id="cmAnnuler" onclick="cmAnnuler()">'+I.refresh+' Annuler la dernière correction ('+CM_ANNUL.recs.length+')</button>':'')+
    '</div></div>'+
    '<div class="kpis" id="cmFams" style="grid-template-columns:repeat(4,1fr)">'+Object.keys(FAMILLES).map(f=>
      '<button class="kpi" data-fam="'+f+'" onclick="cmFamille(\''+f+'\')" style="text-align:left;cursor:pointer;border:2px solid '+(CM_FAM===f?'var(--gold)':'transparent')+'">'+
        '<div class="lab">'+esc(FAMILLES[f].t)+'</div><div class="val">'+CM.total[f]+'</div>'+
        '<div class="sub">'+Object.values(CM.jours).filter(j=>j.n[f]).length+' journée(s) · '+Object.values(CM.jours).filter(j=>j.collectif[f]).length+' collective(s)</div></button>').join('')+'</div>'+
    (CM.clos.length?'<div class="banner banner-warn" style="margin-bottom:14px">'+I.lock+'<div class="grow">Mois clôturé(s) dans la période : <b>'+CM.clos.join(', ')+
      '</b>. Leurs journées sont listées mais ne peuvent pas être corrigées sans rouvrir le mois.</div></div>':'')+
    '<div class="card tablecard"><div class="table-head">'+I.warn+'<h3>'+esc(FAMILLES[CM_FAM].t)+'</h3><div class="spacer"></div>'+
        '<span style="font-size:12px;color:var(--muted)">'+totalTout+' anomalie(s) au total · '+CM.dejaCorrigees+' déjà corrigée(s) à la main</span></div>'+
      '<div class="hint" style="padding:10px 16px 0">'+esc(FAMILLES[CM_FAM].d)+'</div>'+
      '<div class="tblwrap"><table class="tbl" id="cmTbl"><thead><tr><th style="width:34px"><input type="checkbox" id="cmTout" onchange="cmToutCocher(this.checked)" aria-label="Tout sélectionner"></th>'+
        '<th>Journée</th><th>Concernées</th><th>Présentes</th><th>Part</th><th>Nature</th><th></th></tr></thead><tbody id="cmBody"></tbody></table></div>'+
      (can('edit')?'<div id="cmBarre" style="position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">'+
        '<b id="cmN">0</b><span style="font-size:13px;color:var(--muted)">journée(s)-personne sélectionnée(s)</span>'+
        '<div class="field"><label for="cmAction">Correction</label><select id="cmAction" onchange="cmMajAction()">'+
          '<option value="sortie">Fixer l’heure de sortie</option>'+
          '<option value="entree">Fixer l’heure d’entrée</option>'+
          '<option value="horaire">Remplacer par l’horaire prévu ce jour-là</option>'+
          '<option value="heures">Compter un nombre d’heures</option>'+
          '<option value="absent">Marquer absent</option></select></div>'+
        '<span id="cmParam"></span>'+
        '<button class="btn btn-gold" onclick="cmApercu()">'+I.check+' Aperçu avant correction</button></div>':'')+
    '</div></div>';
  fillCorrections(); if(can('edit')){ const sel=$('#cmAction'); sel.value={sortie:'sortie',impair:'horaire',nuit:'horaire',tot:'heures'}[CM_FAM]; cmMajAction(); }
};
function cmJours(){
  return Object.values(CM.jours).filter(j=>j.n[CM_FAM]).sort((x,y)=>x.ds<y.ds?1:-1);
}
function cmItems(ds){ return CM.items.filter(x=>x.fam===CM_FAM&&(!ds||x.ds===ds)); }
function fillCorrections(){
  const tb=$('#cmBody'); if(!tb) return;
  const jours=cmJours();
  tb.innerHTML=jours.map(j=>{
    const its=cmItems(j.ds), nSel=its.filter(x=>CM_SEL.has(x.cle)).length, ouvert=CM_OUVERT.has(j.ds);
    const reg=regimeFor(j.ds);
    let h='<tr class="cm-jour" data-ds="'+j.ds+'" style="background:var(--surface-2)">'+
      '<td><input type="checkbox" '+(j.clos?'disabled ':'')+(nSel===its.length&&its.length?'checked ':'')+'onchange="cmCocherJour(\''+j.ds+'\',this.checked)" aria-label="Sélectionner la journée"></td>'+
      '<td><b>'+JSEM[new Date(j.ds+'T12:00').getDay()]+' '+fmtDate(j.ds)+'</b>'+(j.clos?' <span class="tag t-neutral">mois clos</span>':'')+
        '<div style="font-size:11.5px;color:var(--muted)">horaire prévu '+(reg.actif===false?'— (repos)':esc((reg.debut||'?')+' → '+(reg.fin||'?')))+'</div></td>'+
      '<td><b>'+its.length+'</b>'+(nSel&&nSel<its.length?' <span style="color:var(--muted);font-size:12px">('+nSel+' sél.)</span>':'')+'</td>'+
      '<td>'+j.presents+'</td><td>'+pct(its.length,j.presents)+' %</td>'+
      '<td>'+(j.collectif[CM_FAM]?'<span class="tag t-absent">Collective</span>':'<span class="tag t-neutral">Individuelle</span>')+'</td>'+
      '<td style="white-space:nowrap"><button class="linkish" onclick="cmOuvrir(\''+j.ds+'\')">'+(ouvert?'Masquer':'Voir les '+its.length)+'</button>'+
        (CM_FAM==='tot'&&can('settings')&&!j.clos?' · <button class="linkish" onclick="cmHoraireJour(\''+j.ds+'\')">Horaire exceptionnel…</button>':'')+'</td></tr>';
    if(ouvert) h+=its.map(x=>{const m=metrics(x.r,x.ds);
      return '<tr data-cle="'+esc(x.cle)+'"><td><input type="checkbox" '+(j.clos?'disabled ':'')+(CM_SEL.has(x.cle)?'checked ':'')+
        'onchange="cmCocher(\''+escJs(x.cle)+'\',this.checked)" aria-label="Sélectionner"></td>'+
        '<td colspan="2" style="padding-left:26px">'+empCell(x.e.id,true)+'</td>'+
        '<td colspan="2" class="mono">'+x.P.map(fromMin).join(' · ')+'</td>'+
        '<td>'+(m.heures||m.hs?hLabel(m.heures+m.hs):'<b style="color:var(--absent)">0 h</b>')+'</td>'+
        '<td style="white-space:nowrap">'+(can('edit')&&!CM.jours[x.ds].clos?'<button class="linkish" onclick="openPassages(\''+x.ds+'\',\''+escJs(x.e.id)+'\',\'cmRecharger\')">Saisir les passages</button> · ':'')+
          '<button class="linkish" onclick="allerAuJour(\''+x.ds+'\',\''+escJs(x.e.id)+'\')">Ouvrir →</button></td></tr>'}).join('');
    return h;
  }).join('')||'<tr><td colspan="7"><div class="empty">'+I.check+'<div>Aucune anomalie de ce type sur la période</div></div></td></tr>';
  const n=$('#cmN'); if(n) n.textContent=CM_SEL.size;
  const tout=$('#cmTout'); if(tout){ const possibles=cmItems().filter(x=>!CM.jours[x.ds].clos); tout.checked=possibles.length>0&&possibles.every(x=>CM_SEL.has(x.cle)); }
}
function cmCocher(cle,on){ if(on) CM_SEL.add(cle); else CM_SEL.delete(cle); fillCorrections(); }
function cmCocherJour(ds,on){ if(CM.jours[ds].clos) return; cmItems(ds).forEach(x=>{ if(on) CM_SEL.add(x.cle); else CM_SEL.delete(x.cle) }); fillCorrections(); }
function cmToutCocher(on){ CM_SEL=new Set(on?cmItems().filter(x=>!CM.jours[x.ds].clos).map(x=>x.cle):[]); fillCorrections(); }
function cmOuvrir(ds){ if(CM_OUVERT.has(ds)) CM_OUVERT.delete(ds); else CM_OUVERT.add(ds); fillCorrections(); }
function cmFamille(f){ CM_FAM=f; CM_SEL=new Set(); CM_OUVERT=new Set(); go('corrections'); }
async function cmPeriode(){ const a=$('#cmFrom').value,b=$('#cmTo').value; if(!a||!b) return;
  CM_FROM=a<b?a:b; CM_TO=a<b?b:a; CM_SEL=new Set(); await go('corrections'); }
async function cmRaccourci(n){
  if(n===1){ const d=new Date(TODAY+'T12:00'); d.setDate(0); [CM_FROM,CM_TO]=monthBounds(C.isoOf(d).slice(0,7)); }
  else if(n===0){ [CM_FROM,CM_TO]=[monthBounds(TODAY.slice(0,7))[0],TODAY]; }
  else { const d=new Date(TODAY+'T12:00'); d.setMonth(d.getMonth()-n); CM_FROM=C.isoOf(d); CM_TO=TODAY; }
  CM_SEL=new Set(); await go('corrections');
}
function cmMajAction(){
  const a=$('#cmAction').value, p=$('#cmParam'); if(!p) return;
  if(a==='sortie'||a==='entree') p.innerHTML=
    '<div class="field"><label for="cmMode">à</label><select id="cmMode" onchange="document.getElementById(\'cmHeure\').style.display=this.value===\'fixe\'?\'\':\'none\'">'+
    '<option value="regime">l’heure prévue ce jour-là</option><option value="fixe">une heure précise</option></select>'+
    '<input type="time" id="cmHeure" value="'+(a==='sortie'?'16:30':'07:30')+'" style="display:none;margin-left:6px"></div>';
  else if(a==='heures') p.innerHTML='<div class="field"><label for="cmH">Heures</label><input id="cmH" value="8" style="width:70px" placeholder="8 ou 8h30"></div>';
  else p.innerHTML='';
}
function lireHeures(txt){
  const v=String(txt||'').trim().replace(',','.'); if(!v) return null;
  let m; if(v.indexOf('h')>=0){const p=v.split('h'); m=(parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0)}
  else if(v.indexOf(':')>=0) m=toMin(v); else m=Math.round(parseFloat(v)*60);
  return (m==null||isNaN(m)||m<0||m>1440)?null:m;
}
/* Construit le nouvel enregistrement d'UNE journée-personne — ou une raison de refuser.
   Fonction pure : c'est elle que les tests vérifient cas par cas. */
function corrigerUn(x,action,opt){
  const reg=regimeFor(x.ds), entreeActuelle=x.r.entree||fromMin(x.P[0]);
  const base={date:x.ds,id:x.e.id,statut:'present',manuel:1,src:'correction',punches:null,hM:null,hsM:null,entree:'',sortie:''};
  const prevu=champ=>{ if(reg.actif===false) return null; return reg[champ]||null; };
  if(action==='absent') return {rec:Object.assign(base,{statut:'absent'})};
  if(action==='heures'){
    if(opt.minutes==null) return {refus:'nombre d’heures non compris'};
    return {rec:Object.assign(base,{entree:entreeActuelle,sortie:x.r.sortie||'',hM:opt.minutes})};
  }
  if(action==='horaire'){
    const d=prevu('debut'), f=prevu('fin');
    if(!d||!f) return {refus:'pas d’horaire prévu ce jour-là (repos)'};
    return {rec:Object.assign(base,{entree:d,sortie:f})};
  }
  if(action==='sortie'){
    const s=opt.mode==='fixe'?opt.heure:prevu('fin');
    if(!s) return {refus:'pas d’heure de fin prévue ce jour-là'};
    if(toMin(s)<=toMin(entreeActuelle)) return {refus:'la sortie ('+s+') serait avant l’entrée ('+entreeActuelle+')'};
    return {rec:Object.assign(base,{entree:entreeActuelle,sortie:s})};
  }
  if(action==='entree'){
    const d=opt.mode==='fixe'?opt.heure:prevu('debut');
    const sortie=x.P.length>1?fromMin(x.P[x.P.length-1]):(x.r.sortie||'');
    if(!d) return {refus:'pas d’heure de début prévue ce jour-là'};
    if(sortie && toMin(d)>=toMin(sortie)) return {refus:'l’entrée ('+d+') serait après la sortie ('+sortie+')'};
    return {rec:Object.assign(base,{entree:d,sortie})};
  }
  return {refus:'correction inconnue'};
}
function cmPreparer(){
  const action=$('#cmAction').value;
  const opt={mode:(($('#cmMode')||{}).value)||'regime', heure:(($('#cmHeure')||{}).value)||'', minutes:lireHeures((($('#cmH')||{}).value))};
  if(action==='heures'&&opt.minutes==null){ toast('Nombre d’heures non compris (ex. 8, 8,5 ou 8h30)','warn'); return null; }
  if((action==='sortie'||action==='entree')&&opt.mode==='fixe'&&!opt.heure){ toast('Indiquez l’heure','warn'); return null; }
  const faits=[], refus=[];
  cmItems().filter(x=>CM_SEL.has(x.cle)).forEach(x=>{
    const r=corrigerUn(x,action,opt);
    if(r.rec){ const av=metrics(x.r,x.ds), ap=metrics(r.rec,x.ds);
      faits.push({x,rec:r.rec,avant:av.heures+av.hs,apres:ap.heures+ap.hs}); }
    else refus.push({x,raison:r.refus});
  });
  return {action,opt,faits,refus};
}
const LIB_ACTION={sortie:'Heure de sortie fixée',entree:'Heure d’entrée fixée',horaire:'Horaire prévu appliqué',heures:'Heures saisies',absent:'Marquées absentes'};
function cmApercu(){
  if(!CM_SEL.size){ toast('Cochez d’abord des journées dans la liste','warn'); return; }
  const p=cmPreparer(); if(!p) return;
  window._cmPlan=p;
  const tAv=p.faits.reduce((s,f)=>s+f.avant,0), tAp=p.faits.reduce((s,f)=>s+f.apres,0);
  const motif=LIB_ACTION[p.action]+' — '+FAMILLES[CM_FAM].t.toLowerCase()+' ('+fmtDate(CM.a)+' → '+fmtDate(CM.b)+')';
  openModal('<div class="modal-head">'+I.check+'<h3>Aperçu de la correction</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">'+
      miniKpi('Journées corrigées',p.faits.length,'var(--present)')+miniKpi('Laissées telles quelles',p.refus.length,p.refus.length?'var(--late)':'var(--muted)')+
      miniKpi('Heures avant',fr2(hDec(tAv))+' h','var(--muted)')+miniKpi('Heures après',fr2(hDec(tAp))+' h','var(--ink)')+'</div>'+
    (p.refus.length?'<div class="banner banner-warn" style="margin:0 0 12px">'+I.warn+'<div class="grow"><b>'+p.refus.length+' journée(s) ne seront pas modifiées</b> : '+
      esc([...new Set(p.refus.map(r=>r.raison))].join(' ; '))+'.</div></div>':'')+
    '<div class="tblwrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th>Date</th><th>Employée</th><th>Badges actuels</th><th>Deviendra</th><th>Heures</th></tr></thead><tbody>'+
      p.faits.slice(0,200).map(f=>'<tr><td class="mono">'+fmtDate(f.x.ds)+'</td><td>'+esc(empName(f.x.e.id))+'</td>'+
        '<td class="mono">'+f.x.P.map(fromMin).join(' · ')+'</td>'+
        '<td class="mono">'+(f.rec.statut==='absent'?'absente':esc((f.rec.entree||'—')+' → '+(f.rec.sortie||'—'))+(f.rec.hM!=null?' · '+fr2(hDec(f.rec.hM))+' h saisies':''))+'</td>'+
        '<td>'+fr2(hDec(f.avant))+' → <b>'+fr2(hDec(f.apres))+' h</b></td></tr>').join('')+
      (p.faits.length>200?'<tr><td colspan="5" class="hint">… et '+(p.faits.length-200)+' autres</td></tr>':'')+
    '</tbody></table></div>'+
    '<div style="margin-top:14px"><label class="fldlab" for="cmMotif">Motif inscrit au journal</label><input class="fldin" id="cmMotif" value="'+esc(motif)+'"></div>'+
    '<div class="hint" style="margin-top:8px">Les journées corrigées sont marquées « saisie manuelle » : les imports de la pointeuse ne les écraseront plus. '+
      'Vous pourrez annuler cette correction tant que vous restez sur cet écran.</div>'+
  '</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Ne rien modifier</button>'+
    '<button class="btn btn-gold" id="cmValider" '+(p.faits.length?'':'disabled ')+'onclick="cmValider()">Corriger '+p.faits.length+' journée(s)</button></div>','wide');
}
async function cmValider(){
  const p=window._cmPlan; if(!p||!p.faits.length) return;
  const motif=(($('#cmMotif')||{}).value||'Correction en masse').slice(0,160);
  const b=$('#cmValider'); if(b) b.disabled=true;
  if(!await persistBulk(p.faits.map(f=>f.rec),'Correction en masse · '+motif,'correction')){ if(b) b.disabled=false; return; }
  /* de quoi revenir en arrière : l'enregistrement exact d'avant, protection comprise */
  CM_ANNUL={motif,recs:p.faits.map(f=>Object.assign({date:f.x.ds,id:f.x.e.id,punches:null,hM:null,hsM:null,manuel:null},JSON.parse(JSON.stringify(f.x.r))))};
  p.faits.forEach(f=>{ const r={statut:f.rec.statut,entree:f.rec.entree,sortie:f.rec.sortie,manuel:1,src:'correction'};
    if(f.rec.hM!=null) r.hM=f.rec.hM; DB.pointages[f.x.ds][f.x.e.id]=r; });
  ENGINE.invalidate&&ENGINE.invalidate();
  CM_SEL=new Set(); closeModal();
  toast(p.faits.length+' journée(s) corrigée(s)'+(p.refus.length?' · '+p.refus.length+' laissée(s) telles quelles':''),'ok',7000);
  await go('corrections');
}
async function cmAnnuler(){
  if(!CM_ANNUL) return;
  if(!confirm('Annuler la dernière correction ?\n\n'+CM_ANNUL.recs.length+' journée(s) retrouveront exactement leur état précédent.')) return;
  const recs=CM_ANNUL.recs.map(r=>Object.assign({},r,{src:r.src||'import'}));
  if(!await persistBulk(recs,'Annulation · '+CM_ANNUL.motif,'annulation')) return;
  recs.forEach(r=>{ const c=Object.assign({},r); delete c.date; delete c.id;
    ['punches','hM','hsM','manuel'].forEach(k=>{ if(c[k]==null) delete c[k] }); DB.pointages[r.date][r.id]=c; });
  const n=recs.length; CM_ANNUL=null; ENGINE.invalidate&&ENGINE.invalidate();
  toast('Correction annulée : '+n+' journée(s) rétablie(s)'); await go('corrections');
}
/* Démarrage anticipé collectif : plutôt que de retoucher 90 lignes, on déclare
   l'horaire réellement pratiqué ce jour-là. Le calcul de tout l'atelier suit. */
function cmHoraireJour(ds){
  const reg=regimeFor(ds), its=CM.items.filter(x=>x.fam==='tot'&&x.ds===ds);
  const tri=its.map(x=>x.P[0]).sort((a,b)=>a-b), med=tri.length?tri[Math.floor(tri.length/2)]:toMin(reg.debut);
  const prop=fromMin(Math.round(med/15)*15);
  openModal('<div class="modal-head">'+I.clock+'<h3>Horaire exceptionnel — '+fmtDate(ds)+'</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body"><p style="color:var(--muted);font-size:13px;margin-bottom:14px">Ce jour-là, '+its.length+' personne(s) ont commencé bien avant '+esc(reg.debut||'')+
    ' (arrivée médiane : <b>'+fromMin(med)+'</b>). Indiquez l’horaire réellement pratiqué : les heures de <b>tout l’atelier</b> seront recalculées pour cette journée, sans toucher aux badges.</p>'+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">'+
      '<div><label class="fldlab" for="hxD">Début</label><input class="fldin" type="time" id="hxD" value="'+prop+'"></div>'+
      '<div><label class="fldlab" for="hxF">Fin</label><input class="fldin" type="time" id="hxF" value="'+esc(reg.fin||'16:30')+'"></div>'+
      '<div><label class="fldlab" for="hxP">Pause (min)</label><input class="fldin" type="number" id="hxP" min="0" max="180" value="'+(+reg.pause||0)+'"></div></div>'+
    '<div class="hint" style="margin-top:10px">L’horaire est enregistré comme une période d’un jour dans les réglages (Horaires → Périodes), où vous pourrez le modifier ou le supprimer.</div>'+
  '</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button>'+
    '<button class="btn btn-gold" onclick="cmHoraireEnregistrer(\''+ds+'\')">Appliquer à cette journée</button></div>');
}
async function cmHoraireEnregistrer(ds){
  const d=$('#hxD').value, f=$('#hxF').value, p=Math.max(0,+$('#hxP').value||0);
  if(!d||!f||toMin(f)<=toMin(d)){ toast('La fin doit être après le début','warn'); return; }
  const w=new Date(ds+'T12:00').getDay(), reg=regimeFor(ds);
  const jours={}; for(let i=0;i<7;i++) jours[i]={actif:false};
  jours[w]=Object.assign({},reg,{actif:true,debut:d,fin:f,pause:p});
  if(reg.pauseDe&&toMin(reg.pauseDe)<toMin(d)){ jours[w].pauseDe=''; jours[w].pauseA=''; }
  DB.settings.periodes=DB.settings.periodes||[];
  /* en tête de liste : la première période qui couvre la date l'emporte */
  DB.settings.periodes=DB.settings.periodes.filter(x=>!(x.exception&&x.du===ds));
  DB.settings.periodes.unshift({nom:'Horaire exceptionnel du '+fmtDate(ds),du:ds,au:ds,jours,exception:true});
  ENGINE.invalidate&&ENGINE.invalidate();
  await saveNow();
  closeModal(); toast('Horaire du '+fmtDate(ds)+' enregistré : '+d+' → '+f,'ok',7000);
  await go('corrections');
}
async function cmRecharger(){ await go('corrections'); }
Object.assign(window,{cmRecharger,detecterAnomalies,corrigerUn,lireHeures,fillCorrections,cmCocher,cmCocherJour,cmToutCocher,cmOuvrir,cmFamille,cmPeriode,
  cmRaccourci,cmMajAction,cmApercu,cmValider,cmAnnuler,cmHoraireJour,cmHoraireEnregistrer});

/* ----------------------------------------------------------------------------
   Navigation
   ---------------------------------------------------------------------------- */
(function(){
  const iP=NAV.findIndex(n=>n.v==='presences');
  NAV.splice(iP+1,0,{v:'corrections',ic:I.gear,t:'Corrections en masse'});
  const iR=NAV.findIndex(n=>n.v==='retards');
  NAV.splice(iR+1,0,{v:'assiduite',ic:I.report,t:'Assiduité'});
})();
}
