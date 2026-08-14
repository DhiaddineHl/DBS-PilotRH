/* ============================================================================
   PilotRH — interface RH · vues (2/3)
   Rapports & paie, personnel, documents, absences, retards, congés, alertes,
   RSE, assistant IA, sécurité.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { pad, toMin, hDec, fr2, hLabel, esc, escJs } = C;

/* ============================================================================
   SYNTHÈSE — base de tous les rapports
   ============================================================================ */
function summarize(a,b){
  const parEmp = {};
  DB.employees.forEach(e=>parEmp[e.id]={e,jT:0,jA:0,jC:0,jF:0,jR:0,jFT:0,hN:0,hS:0,ret:0,rt:0,revue:0});
  eachDay(a,b,ds=>{
    const rec=dayRec(ds);
    if(!rec)return;                       // journée non créée : on ne l'invente pas
    DB.employees.forEach(e=>{
      const s=parEmp[e.id];const m=metrics(rec[e.id],ds);
      if(m.revue)s.revue++;
      switch(m.statut){
        case 'absent': s.jA++;break;
        case 'leave':  s.jC++;break;
        case 'ferie':  s.jF++;break;
        case 'repos':  s.jR++;break;
        case 'ferieTravaille': case 'reposTravaille':
          s.jFT++;s.hS+=m.hs;break;
        default:
          s.jT++;s.hN+=m.heures;s.hS+=m.hs;s.ret+=m.retard;if(m.late)s.rt++;
      }
    });
  });
  return DB.employees.map(e=>{
    const s=parEmp[e.id];
    s.hN=ENGINE.arrondirTotal(s.hN);       // arrondi sur le CUMUL, plus par jour
    s.hS=ENGINE.arrondirTotal(s.hS);
    return s;
  });
}
window.summarize=summarize;

function csvEsc(v){
  const s=(v==null?'':String(v));
  return /[";\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function csvDL(name,rows){
  const csv=rows.map(r=>r.map(csvEsc).join(';')).join('\r\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const u=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),4000);
}
window.csvDL=csvDL; window.csvEsc=csvEsc;

async function downloadPDF(payload,filename){
  toast('Génération du PDF…');
  try{
    const r=await fetch('/api/report/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok){const t=await r.text();let m='';try{m=JSON.parse(t).error}catch(e){m='erreur '+r.status}throw new Error(m)}
    const blob=await r.blob();const u=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=u;a.download=filename;a.click();
    setTimeout(()=>URL.revokeObjectURL(u),4000);
    toast('PDF téléchargé');
  }catch(e){toast('PDF impossible : '+e.message,'err')}
}
window.downloadPDF=downloadPDF;

/* Mention portée sur tous les exports : indispensable pour qu'un rapport reste
   auditable (l'arrondi et le régime changent les chiffres). */
function mentionRegime(){
  const s=S();
  const ar=+s.arrondi||0;
  return 'Mode heures sup. : '+(s.modeHS==='fin'?'bloc depuis l’heure de fin':'à partir de fin + délai')+
    ' · arrondi : '+(ar?ar+' min '+(s.arrondiSens==='inferieur'?'à l’inférieur':'au plus proche')+
      ' sur '+(s.arrondiPortee==='periode'?'le cumul de la période':'chaque journée'):'aucun')+
    ' · jours fériés : '+(s.feriesActifs===false?'désactivés':'actifs');
}
window.mentionRegime=mentionRegime;

/* ============================================================================
   RAPPORTS & PAIE
   ============================================================================ */
let REP_FROM=monthBounds(TODAY.slice(0,7))[0], REP_TO=TODAY;
Object.defineProperty(window,'REP_FROM',{get:()=>REP_FROM,set:v=>{REP_FROM=v},configurable:true});
Object.defineProperty(window,'REP_TO',{get:()=>REP_TO,set:v=>{REP_TO=v},configurable:true});

async function setRep(champ,val){
  if(champ==='from')REP_FROM=val; else REP_TO=val;
  if(REP_TO<REP_FROM){const t=REP_FROM;REP_FROM=REP_TO;REP_TO=t}
  await ensureRange(REP_FROM,REP_TO);
  fillRep();
  const t=document.getElementById('repTitre');
  if(t)t.textContent=fmtDate(REP_FROM)+' → '+fmtDate(REP_TO);
}
async function repMoisPrecedent(){
  const d=new Date(REP_FROM+'T12:00');d.setMonth(d.getMonth()-1);
  const ym=d.getFullYear()+'-'+pad(d.getMonth()+1);
  [REP_FROM,REP_TO]=monthBounds(ym);
  await go('rapports');
}
async function repMoisCourant(){[REP_FROM,REP_TO]=[monthBounds(TODAY.slice(0,7))[0],TODAY];await go('rapports')}
Object.assign(window,{setRep,repMoisPrecedent,repMoisCourant});

VUES.rapports = async function(main){
  const ymF=REP_FROM.slice(0,7), memeMois=ymF===REP_TO.slice(0,7);
  const clos=memeMois&&moisClos(ymF);
  main.innerHTML=topbar('Rapports & paie','Rapports & paie')+'<div class="page view">'+
    bandeauRevue(REP_FROM,REP_TO)+
    '<div class="card" style="padding:16px 18px;margin-bottom:16px">'+
      '<div class="range-bar" style="margin:0">'+
        '<div class="field"><label for="repFrom">Du</label><input type="date" id="repFrom" value="'+REP_FROM+'" onchange="setRep(\'from\',this.value)"></div>'+
        '<div class="field"><label for="repTo">Au</label><input type="date" id="repTo" value="'+REP_TO+'" onchange="setRep(\'to\',this.value)"></div>'+
        '<button class="btn btn-ghost" onclick="repMoisPrecedent()">Mois précédent</button>'+
        '<button class="btn btn-ghost" onclick="repMoisCourant()">Mois en cours</button>'+
        '<div style="flex:1"></div>'+
        (memeMois?(clos
          ? '<span class="lock-chip">'+I.lock+' '+ymF+' clôturé</span>'+(can('cloture')?' <button class="btn btn-ghost" onclick="rouvrirMois(\''+ymF+'\')">Rouvrir</button>':'')
          : (can('cloture')?'<button class="btn btn-ghost" onclick="cloturerMois(\''+ymF+'\')">'+I.lock+' Clôturer '+ymF+'</button>':'')):'')+
      '</div>'+
      '<div class="range-bar" style="margin:12px 0 0">'+
        '<button class="btn btn-ghost" onclick="pdfDaily()">'+I.download+' PDF journalier</button>'+
        '<button class="btn btn-ghost" onclick="pdfAbsRetards()">'+I.download+' PDF absences / retards</button>'+
        '<button class="btn btn-gold" onclick="pdfPaie()">'+I.download+' PDF paie</button>'+
        '<button class="btn btn-ghost" onclick="csvPaie()">'+I.download+' CSV paie</button>'+
        '<button class="btn btn-ghost" onclick="csvJournalier()">'+I.download+' CSV journalier</button>'+
      '</div>'+
      '<div class="hint" style="margin-top:10px">Les exports portent <b>exactement</b> sur la période affichée ci-dessus '+
      '(auparavant le PDF et le CSV de paie forçaient le mois entier, sans le signaler).</div>'+
    '</div>'+
    '<div class="filterbar">'+
      '<div class="field">'+I.search+'<label for="rQ" class="sr-only">Nom</label><input id="rQ" type="search" placeholder="Nom, matricule…" oninput="fillRep()"></div>'+
      '<div class="field"><label for="rServ">Service</label><select id="rServ" onchange="fillRep()"><option value="">Tous</option>'+SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="rAtel">Atelier</label><select id="rAtel" onchange="fillRep()"><option value="">Tous</option>'+ATELIERS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="rCat">Catégorie</label><select id="rCat" onchange="fillRep()"><option value="">Toutes</option><option>Ouvrier</option><option>Cadre</option></select></div>'+
      '<div class="field"><label for="rCtr">Contrat</label><select id="rCtr" onchange="fillRep()"><option value="">Tous</option>'+CONTRATS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div class="card tablecard">'+
      '<div class="table-head">'+I.report+'<h3>Synthèse — <span id="repTitre">'+fmtDate(REP_FROM)+' → '+fmtDate(REP_TO)+'</span></h3>'+
      '<div class="spacer"></div><span style="font-size:12px;color:var(--muted)">Chaque fiche a son mode : à l’heure ou à la journée</span></div>'+
      '<div class="tblwrap"><table class="tbl"><thead>'+
        theadRow('rep',[['mat','Mat.'],['name','Employée'],'Cat.',['jt','Jours trav.'],['ja','Absences'],
          'Congés','Fériés',['hn','H. normales'],['hs','H. sup.'],['ret','Retards'],'Base paie',
          ['taux','Taux'],['mt','Montant estimé']])+
      '</thead><tbody id="repBody"></tbody></table></div></div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">'+esc(mentionRegime())+'</div>'+
  '</div>';
  fillRep();
};

function repFiltre(rows){
  const q=((($('#rQ')||{}).value)||'').toLowerCase(),sv=(($('#rServ')||{}).value)||'',
        at=(($('#rAtel')||{}).value)||'',ca=(($('#rCat')||{}).value)||'',ct=(($('#rCtr')||{}).value)||'';
  return rows.filter(r=>{const e=r.e;
    return (!q||((e.prenom||'')+' '+(e.nom||'')+' '+matOf(e)).toLowerCase().includes(q))
      &&(!sv||e.service===sv)&&(!at||e.atelier===at)&&(!ca||e.categorie===ca)&&(!ct||e.contrat===ct)});
}
function repRows(){
  let rows=repFiltre(summarize(REP_FROM,REP_TO));
  if(SORT.rep){const s=SORT.rep;const g=r=>({mat:matOf(r.e),name:r.e.nom||'',jt:r.jT,ja:r.jA,hn:r.hN,hs:r.hS,ret:r.ret,
    taux:ENGINE.paie(r.e,r).taux,mt:ENGINE.paie(r.e,r).montant}[s.k]);
    rows=[...rows].sort((a,b)=>{const va=g(a),vb=g(b);return(va>vb?1:va<vb?-1:0)*s.dir})}
  return rows;
}
function fillRep(){
  const rows=repRows();
  let TjT=0,ThN=0,ThS=0,Tret=0,TjA=0,Tmt=0;
  const tb=$('#repBody'); if(!tb)return;
  tb.innerHTML=(rows.map(r=>{
    TjT+=r.jT;ThN+=r.hN;ThS+=r.hS;Tret+=r.ret;TjA+=r.jA;
    const p=ENGINE.paie(r.e,r);Tmt+=p.montant;
    const base='<b>'+fr2(p.qte)+' '+p.unite+'</b>';
    return '<tr'+(r.revue?' class="revue-row"':'')+'><td class="mono">'+esc(matOf(r.e))+'</td><td>'+empCell(r.e.id,true)+'</td><td>'+catTag(r.e.categorie,r.e)+'</td>'+
      '<td>'+r.jT+'</td><td>'+(r.jA?'<b style="color:var(--absent)">'+r.jA+'</b>':'0')+'</td><td>'+(r.jC||'0')+'</td>'+
      '<td>'+(r.jF||'0')+(r.jFT?' <span class="tag t-ferie">+'+r.jFT+' trav.</span>':'')+'</td>'+
      '<td>'+(p.mode==='journalier'?'<span style="color:var(--faint)">—</span>':fr2(hDec(r.hN))+' h')+'</td>'+
      '<td>'+(r.hS?'<b style="color:var(--mission)">'+fr2(hDec(r.hS))+' h</b>':'—')+'</td>'+
      '<td>'+(r.ret?r.ret+' min':'—')+'</td><td>'+base+
      (r.revue?' <span class="tag t-late" title="'+r.revue+' journée(s) à vérifier">⚠</span>':'')+'</td>'+
      '<td class="mono">'+(p.taux?fr2(p.taux)+'<small style="color:var(--faint)">/'+p.unite+'</small>':
        '<button class="linkish" title="Aucun taux sur la fiche ni par défaut" onclick="openEditEmp(\''+escJs(r.e.id)+'\')">à saisir</button>')+'</td>'+
      '<td class="mono">'+(p.taux?'<b>'+fr2(p.montant)+'</b>':'—')+'</td></tr>';
  }).join('')||'<tr><td colspan="13"><div class="empty">Aucune ligne</div></td></tr>')+
    '<tr class="rep-tot"><td colspan="3">TOTAL ('+rows.length+')</td><td>'+TjT+'</td><td>'+TjA+
    '</td><td colspan="2"></td><td>'+fr2(hDec(ThN))+' h</td><td>'+fr2(hDec(ThS))+' h</td><td>'+Tret+' min</td><td></td>'+
    '<td></td><td class="mono">'+fr2(Math.round(Tmt*1000)/1000)+' TND</td></tr>';
}
window.fillRep=fillRep;

function hcell(min){return min?fr2(hDec(min)):'0'}
function dailySections(ds){
  const rec=dayRec(ds)||{};const pres=[],ret=[],abs=[],autres=[];
  DB.employees.forEach(e=>{
    const m=metrics(rec[e.id],ds);const r=rec[e.id]||{};const mat=matOf(e);
    const nom=(e.prenom||'')+' '+(e.nom||'');
    if(m.statut==='absent')abs.push([mat,nom,e.service||'','Absence']);
    else if(m.statut==='leave')abs.push([mat,nom,e.service||'','Congé']);
    else if(m.statut==='mission')abs.push([mat,nom,e.service||'','Mission']);
    else if(m.statut==='ferie'||m.statut==='repos')autres.push([mat,nom,e.service||'',C.statutLabel(m.statut,e.sexe)+(m.ferieNom?' — '+m.ferieNom:'')]);
    else if(m.statut==='late')ret.push([mat,nom,e.service||'',entreeAff(r),sortieAff(r),'+'+m.retard+' min',hcell(m.heures)+' h',hcell(m.hs)+' h',m.revue?'à vérifier':'']);
    else pres.push([mat,nom,e.service||'',entreeAff(r),sortieAff(r),hcell(m.heures)+' h',hcell(m.hs)+' h',m.revue?'à vérifier':'']);
  });
  const s=[
    {title:'Présents ('+pres.length+')',columns:['Mat.','Nom','Service','Entrée','Sortie','Heures','H. sup.','Remarque'],rows:pres},
    {title:'Retards ('+ret.length+')',columns:['Mat.','Nom','Service','Entrée','Sortie','Retard','Heures','H. sup.','Remarque'],rows:ret},
    {title:'Absences / congés / missions ('+abs.length+')',columns:['Mat.','Nom','Service','Motif'],rows:abs},
  ];
  if(autres.length)s.push({title:'Fériés / repos ('+autres.length+')',columns:['Mat.','Nom','Service','Motif'],rows:autres});
  return s;
}
function pdfDailyFor(ds){
  if(!dayRec(ds)){toast('Aucun pointage pour le '+fmtDate(ds),'warn');return}
  downloadPDF({title:'Liste journalière des présences',subtitle:'DBS Fashion · '+fmtJour(ds),
    note:mentionRegime(),sections:dailySections(ds)},'liste_journaliere_'+ds+'.pdf');
}
function pdfDaily(){pdfDailyFor(REP_TO)}
function pdfPaie(){
  const rows=repRows();
  const l=aRevoir(REP_FROM,REP_TO);
  if(l.length&&!confirm(l.length+' journée(s) de la période sont à vérifier (pointage incomplet).\n\nCes journées comptent 0 h ou une durée approximative.\n\nÉditer le rapport de paie quand même ?'))return;
  let tot=0;
  const data=rows.map(r=>{
    const p=ENGINE.paie(r.e,r);tot+=p.montant;
    return [matOf(r.e),(r.e.prenom||'')+' '+(r.e.nom||''),r.e.service||'',r.e.categorie,
      String(r.jT),String(r.jA),String(r.jC),String(r.jF),fr2(hDec(r.hN))+' h',
      r.hS?fr2(hDec(r.hS))+' h':'-',r.ret?r.ret+' min':'-',
      fr2(p.qte)+' '+p.unite,p.taux?fr2(p.taux):'-',p.taux?fr2(p.montant):'-'];
  });
  data.push(['','TOTAL ('+rows.length+')','','','','','','','','','','','',fr2(Math.round(tot*1000)/1000)]);
  downloadPDF({title:'Rapport de paie',
    subtitle:'DBS Fashion · du '+fmtDate(REP_FROM)+' au '+fmtDate(REP_TO)+' · quantité et taux propres à chaque fiche',
    note:mentionRegime()+' · montants indicatifs, sans majoration légale ni retenue'+
      (l.length?' · ATTENTION : '+l.length+' journée(s) à vérifier':''),
    sections:[{title:'Synthèse de la période',
      columns:['Mat.','Nom','Service','Cat.','J.trav','Abs','Congé','Férié','H.norm.','H.sup.','Retards','Base paie','Taux','Montant'],rows:data}]},
    'rapport_paie_'+REP_FROM+'_'+REP_TO+'.pdf');
}
function absRetSections(a,b){
  const ret=[],abs=[];
  eachDay(a,b,ds=>{
    const rec=dayRec(ds);if(!rec)return;
    if(!estOuvre(ds))return;                     // fériés et repos exclus des états d'absence
    DB.employees.forEach(e=>{
      const r=rec[e.id];const m=metrics(r,ds);const mat=matOf(e);
      const nom=(e.prenom||'')+' '+(e.nom||'');
      if(m.statut==='absent')abs.push([fmtDate(ds),mat,nom,e.service||'','Absence']);
      else if(m.statut==='leave')abs.push([fmtDate(ds),mat,nom,e.service||'','Congé']);
      else if(m.statut==='mission')abs.push([fmtDate(ds),mat,nom,e.service||'','Mission']);
      else if(m.late)ret.push([fmtDate(ds),mat,nom,e.service||'',entreeAff(r),'+'+m.retard+' min']);
    });
  });
  return [
    {title:'Retards ('+ret.length+')',columns:['Date','Mat.','Nom','Service','Entrée','Retard'],rows:ret},
    {title:'Absences / congés / missions ('+abs.length+')',columns:['Date','Mat.','Nom','Service','Motif'],rows:abs},
  ];
}
function pdfAbsRetards(){
  downloadPDF({title:'État des absences et retards',
    subtitle:'DBS Fashion · du '+fmtDate(REP_FROM)+' au '+fmtDate(REP_TO),
    note:mentionRegime()+' · les jours fériés et de repos sont exclus',
    sections:absRetSections(REP_FROM,REP_TO)},'absences_retards_'+REP_FROM+'_'+REP_TO+'.pdf');
}
function csvPaie(){
  const rows=repRows();
  const out=[['Rapport de paie — DBS Fashion'],['Période','du '+REP_FROM,'au '+REP_TO],[mentionRegime()],[],
    ['Matricule','Nom','Prénom','Service','Atelier','Catégorie','Mode de paie','Base de paie','Quantité paie',
     'Taux (TND)','Montant estimé (TND)',
     'Jours travaillés','Jours absents','Jours congé','Jours fériés','Heures normales','Heures sup.','Retards (min)','Nb retards','À vérifier']];
  let tot=0;
  rows.forEach(r=>{
    const p=ENGINE.paie(r.e,r);tot+=p.montant;
    out.push([matOf(r.e),r.e.nom||'',r.e.prenom||'',r.e.service||'',r.e.atelier||'',r.e.categorie,
      C.MODES_PAIE_LABEL[p.mode],p.mode==='journalier'?'Jours':'Heures',fr2(p.qte),
      p.taux?fr2(p.taux):'',p.taux?fr2(p.montant):'',
      r.jT,r.jA,r.jC,r.jF,fr2(hDec(r.hN)),fr2(hDec(r.hS)),r.ret,r.rt,r.revue||'']);
  });
  out.push([]);
  out.push(['TOTAL',rows.length+' salarié(s)','','','','','','','','',fr2(Math.round(tot*1000)/1000)]);
  csvDL('rapport_paie_'+REP_FROM+'_'+REP_TO+'.csv',out);
  toast('CSV de paie exporté — prêt pour le comptable');
}
function csvJournalier(){
  const out=[['Rapport journalier — DBS Fashion'],['Période','du '+REP_FROM,'au '+REP_TO],[mentionRegime()],[],
    ['Date','Matricule','Nom','Prénom','Service','Atelier','Catégorie','Statut','Entrée','Sortie','Badges',
     'Heures','Retard (min)','Heures sup.','Saisie manuelle','À vérifier']];
  let n=0;
  eachDay(REP_FROM,REP_TO,ds=>{
    const rec=dayRec(ds);if(!rec)return;
    DB.employees.forEach(e=>{
      const r=rec[e.id];if(!r)return;const m=metrics(r,ds);n++;
      out.push([ds,matOf(e),e.nom||'',e.prenom||'',e.service||'',e.atelier||'',e.categorie,
        C.statutLabel(m.statut,e.sexe),entreeAff(r),sortieAff(r),(r.punches||[]).join(' '),
        m.heures?fr2(hDec(m.heures)):'0',m.retard||0,m.hs?fr2(hDec(m.hs)):'0',
        (m.manuel||m.manuelHS)?'oui':'',m.revue?m.motifRevue:'']);
    });
  });
  if(!n){toast('Aucun pointage sur la période','warn');return}
  csvDL('detail_pointage_'+REP_FROM+'_'+REP_TO+'.csv',out);
  toast(n+' lignes exportées');
}
Object.assign(window,{pdfDailyFor,pdfDaily,pdfPaie,pdfAbsRetards,csvPaie,csvJournalier,dailySections});

/* ============================================================================
   PERSONNEL
   ============================================================================ */
VUES.personnel = async function(main){
  main.innerHTML=topbar('Dossiers personnel','Personnel ('+DB.employees.length+')',
    (can('import')?'<button class="btn btn-ghost" onclick="openImportFiches()">'+I.up+' Importer des fiches</button>':'')+
    (can('edit')?'<button class="btn btn-gold" onclick="openAddEmp()">'+I.plus+' Nouveau salarié</button>':''))+
  '<div class="page view">'+
    '<div class="filterbar">'+
      '<div class="field">'+I.search+'<label for="pSearch" class="sr-only">Recherche</label><input id="pSearch" type="search" placeholder="Nom, matricule, poste…" oninput="fillPers()"></div>'+
      '<div class="field"><label for="pServ">Service</label><select id="pServ" onchange="fillPers()"><option value="">Tous</option>'+SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="pAtel">Atelier</label><select id="pAtel" onchange="fillPers()"><option value="">Tous</option>'+ATELIERS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="pPoste">Poste</label><select id="pPoste" onchange="fillPers()"><option value="">Tous</option>'+POSTES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="pCat">Catégorie</label><select id="pCat" onchange="fillPers()"><option value="">Toutes</option><option>Ouvrier</option><option>Cadre</option></select></div>'+
      '<div class="field"><label for="pCtr">Contrat</label><select id="pCtr" onchange="fillPers()"><option value="">Tous</option>'+CONTRATS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="pIncomplet">Fiches</label><select id="pIncomplet" onchange="fillPers()"><option value="">Toutes</option><option value="1">À compléter</option></select></div>'+
      '<button class="btn btn-ghost" onclick="csvPersonnel()">'+I.download+' CSV</button>'+
    '</div>'+
    '<div class="card tablecard"><div class="tblwrap"><table class="tbl"><thead>'+
      theadRow('pers',[['mat','Mat.'],['name','Employée'],['poste','Poste'],'Cat.',['serv','Service'],
        ['atel','Atelier'],['age','Âge'],['anc','Ancienneté'],'Contrat',''])+
    '</thead><tbody id="persBody"></tbody></table></div></div>'+
    '<div class="hint" id="persCount" style="margin-top:8px"></div>'+
  '</div>';
  fillPers();
};
function persRows(){
  const q=((($('#pSearch')||{}).value)||'').toLowerCase(),sv=(($('#pServ')||{}).value)||'',
        at=(($('#pAtel')||{}).value)||'',po=(($('#pPoste')||{}).value)||'',
        ca=(($('#pCat')||{}).value)||'',ct=(($('#pCtr')||{}).value)||'',ic=(($('#pIncomplet')||{}).value)||'';
  let rows=DB.employees.filter(e=>
    ((((e.prenom||'')+' '+(e.nom||'')+' '+(e.poste||'')+' '+matOf(e))).toLowerCase().includes(q))
    &&(!sv||e.service===sv)&&(!at||e.atelier===at)&&(!po||e.poste===po)
    &&(!ca||e.categorie===ca)&&(!ct||e.contrat===ct)&&(!ic||e.aCompleter));
  if(SORT.pers){const s=SORT.pers;
    const g=e=>({mat:matOf(e),name:e.nom||'',poste:e.poste||'',serv:e.service||'',atel:e.atelier||'',
      age:age(e.naissance),anc:anciennete(e.embauche)}[s.k]);
    rows=[...rows].sort((a,b)=>{const va=g(a),vb=g(b);return(va>vb?1:va<vb?-1:0)*s.dir})}
  return rows;
}
function fillPers(){
  const rows=persRows();
  const tb=$('#persBody');if(!tb)return;
  tb.innerHTML=rows.map(e=>'<tr><td class="mono">'+esc(matOf(e))+'</td><td>'+empCell(e.id,true)+'</td>'+
    '<td>'+esc(e.poste||'—')+(e.aCompleter?' <span class="tag t-late" title="Fiche créée par l’import — à compléter">à compléter</span>':'')+'</td>'+
    '<td>'+catTag(e.categorie,e)+'</td><td>'+esc(e.service||'—')+'</td><td>'+esc(e.atelier||'—')+'</td>'+
    '<td class="mono">'+(e.naissance?age(e.naissance)+' ans':'—')+'</td><td>'+ancLabel(e.embauche)+'</td>'+
    '<td><span class="tag '+(e.contrat==='CDI'?'t-present':'t-neutral')+'">'+esc(e.contrat||'—')+'</span></td>'+
    '<td><button class="linkish" onclick="openProfile(\''+escJs(e.id)+'\')">Fiche →</button></td></tr>').join('')
    ||'<tr><td colspan="10"><div class="empty">Aucun salarié ne correspond aux filtres</div></td></tr>';
  const c=$('#persCount');if(c)c.textContent=rows.length+' salarié(s) affiché(s) sur '+DB.employees.length;
}
function csvPersonnel(){
  const out=[['Personnel — DBS Fashion',TODAY],[],
    ['Matricule','Nom','Prénom','Poste','Catégorie','Service','Atelier','Contrat','Embauche','Naissance','Âge','Ancienneté',
     'Téléphone','Email','Adresse','Mode de paie','Taux horaire','Taux jour','Salaire mensuel','CNSS','Sexe']];
  persRows().forEach(e=>out.push([matOf(e),e.nom||'',e.prenom||'',e.poste||'',e.categorie||'',e.service||'',
    e.atelier||'',e.contrat||'',e.embauche||'',e.naissance||'',e.naissance?age(e.naissance):'',
    e.embauche?ancLabel(e.embauche):'',e.tel||'',e.email||'',e.adresse||'',
    C.MODES_PAIE_LABEL[C.modePaie(e)],e.tauxHoraire||'',e.tauxJour||'',e.salaire||'',e.cnss||'',e.sexe==='H'?'H':'F']));
  csvDL('personnel_'+TODAY+'.csv',out);toast('Liste du personnel exportée');
}
Object.assign(window,{fillPers,csvPersonnel,persRows});

/* ---------------------------------------------------------------- rémunération */
function tnd(v){return fr2(Math.round((+v||0)*1000)/1000)+' TND'}
/* Le mode de paie est propre à chaque fiche : les ouvrières sont payées à
   l'heure suivant la convention, les cadres à la journée travaillée. Le taux
   de la fiche l'emporte sur le taux par défaut des paramètres. */
function blocRemuneration(e,sum,ym){
  const p=ENGINE.paie(e,sum||{});
  return '<div class="info-block"><h4>Rémunération</h4>'+
    row('Mode de paie',C.MODES_PAIE_LABEL[p.mode]+(e.modePaie?'':' (déduit de la catégorie)'))+
    row(p.mode==='journalier'?'Prix d’une journée':'Prix d’une heure',
        p.taux?tnd(p.taux)+(p.tauxDefaut?' (taux par défaut)':''):'non renseigné')+
    row('Salaire mensuel de référence',e.salaire?tnd(e.salaire):'')+
    row('Quantité du mois ('+ym+')',fr2(p.qte)+' '+p.unite+' — '+p.uniteLong)+
    row('Estimation brute du mois',p.taux?tnd(p.montant):'—')+
    '<div class="hint" style="margin-top:8px">Estimation indicative : quantité constatée × taux, '+
    'sans majoration légale des heures supplémentaires ni retenues.</div></div>';
}
Object.assign(window,{blocRemuneration,tnd});

/* --------------------------------------------------------------- fiche salarié */
function openProfile(id){
  const e=emp(id);
  const docs=DB.documents.filter(d=>d.id===id);
  const ym=TODAY.slice(0,7),[a,b]=monthBounds(ym);
  const sum=summarize(a,b).find(s=>s.e.id===id)||{jT:0,hN:0,hS:0,rt:0,jA:0,jC:0};
  openModal('<div class="modal-head">'+I.users+'<h3>Fiche signalétique</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="profile-top">'+(e.photo
      ? '<img src="'+esc(e.photo)+'" class="big-av" style="object-fit:cover" alt="">'
      : '<div class="big-av" style="background:'+avColor(e.prenom+' '+e.nom)+'">'+esc(initials(e.prenom+' '+e.nom))+'</div>')+
      '<div style="flex:1;min-width:200px"><h2>'+esc((e.prenom||'')+' '+(e.nom||''))+'</h2>'+
      '<div class="meta">Matricule <b class="mono">'+esc(matOf(e))+'</b> · '+esc((e.poste||'—')+' · '+(e.service||'—')+' · '+(e.atelier||'—'))+'</div>'+
      (can('edit')?'<div style="margin-top:7px"><input type="file" id="photoIn" accept="image/jpeg,image/png" style="display:none" onchange="uploadPhoto(\''+escJs(e.id)+'\',this.files[0])">'+
        '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="document.getElementById(\'photoIn\').click()">'+
        (e.photo?'Changer la photo':'Ajouter une photo')+'</button></div>':'')+
      '<div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap">'+
        '<span class="tag '+(e.contrat==='CDI'?'t-present':'t-neutral')+'">'+esc(e.contrat||'—')+'</span>'+catTag(e.categorie,e)+
        '<span class="tag t-neutral">'+ancLabel(e.embauche)+'</span>'+
        (e.aCompleter?'<span class="tag t-late">Fiche à compléter</span>':'')+'</div></div></div>'+
    '<div class="info-grid">'+
      '<div class="info-block"><h4>Informations personnelles</h4>'+row('CIN',e.cin)+row('Matricule',matOf(e))+
        row('N° CNSS',e.cnss)+row('Naissance',e.naissance?fmtDate(e.naissance)+' ('+age(e.naissance)+' ans)':'')+
        row('Lieu',e.adresse)+row('Téléphone',e.tel)+row('Email',e.email)+'</div>'+
      '<div class="info-block"><h4>Situation familiale</h4>'+row('Situation',e.famille)+row('Enfants',e.enfants)+
        row('Niveau scolaire',e.niveau)+row('Sexe',e.sexe==='H'?'Homme':'Femme')+'</div>'+
      '<div class="info-block"><h4>Informations professionnelles</h4>'+row('Poste',e.poste)+
        row('Catégorie',e.categorie||'')+
        row('Service',e.service)+row('Atelier',e.atelier)+row('Responsable',e.responsable)+
        row('Embauche',e.embauche?fmtDate(e.embauche):'')+'</div>'+
      '<div class="info-block"><h4>Synthèse du mois ('+ym+')</h4>'+row('Jours travaillés',sum.jT)+
        row('Heures (norm. + sup.)',fr2(hDec(sum.hN+sum.hS))+' h')+row('Dont heures sup.',fr2(hDec(sum.hS))+' h')+
        row('Retards',sum.rt)+row('Absences',sum.jA)+row('Congés',sum.jC)+'</div>'+
      blocRemuneration(e,sum,ym)+
    '</div>'+
    '<div class="info-block"><h4>Historique de pointage</h4>'+
      '<div class="range-bar" style="margin:0 0 12px">'+
        '<div class="field"><label for="hFrom">Du</label><input type="date" id="hFrom" value="'+a+'" onchange="fillHist(\''+escJs(id)+'\')"></div>'+
        '<div class="field"><label for="hTo">Au</label><input type="date" id="hTo" value="'+TODAY+'" onchange="fillHist(\''+escJs(id)+'\')"></div>'+
        (can('edit')?'<button class="btn btn-gold" onclick="closeModal();openCorrection(\''+escJs(id)+'\')">'+I.gear+' Corriger sur une plage de dates</button>':'')+
      '</div><div id="histBox"><div class="skel"></div></div></div>'+
    '<div class="info-block"><h4>Dossier numérique</h4>'+
      (docs.map(d=>'<span class="doc-chip">'+I.doc+' '+esc(d.type)+' <small style="color:var(--faint)">'+fmtDate(d.date)+'</small></span>').join('')
       ||'<span style="color:var(--muted);font-size:13px">Aucun document</span>')+'</div>'+
    (can('users')?'<div class="info-block"><h4>Accès espace salarié</h4>'+
      '<div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">En cas de carte QR perdue, régénérez l’accès : l’ancien lien devient inutilisable.</div>'+
      '<button class="btn btn-ghost" onclick="resetAcces(\''+escJs(id)+'\')">'+I.refresh+' Régénérer le QR et le code</button></div>':'')+
  '</div>'+
  '<div class="modal-foot">'+
    (can('delete')?'<button class="btn btn-danger" style="margin-right:auto" onclick="deleteEmp(\''+escJs(id)+'\')">Supprimer (démission)</button>':'')+
    '<button class="btn btn-ghost" onclick="closeModal()">Fermer</button>'+
    (can('edit')?'<button class="btn btn-gold" onclick="openEditEmp(\''+escJs(id)+'\')">'+I.gear+' Modifier la fiche</button>':'')+
  '</div>','wide');
  fillHist(id);
}
async function fillHist(id){
  const a=$('#hFrom').value,b=$('#hTo').value;
  const box=$('#histBox');
  try{ await ensureRange(a,b); }catch(e){ box.innerHTML='<div style="color:var(--absent)">'+esc(e.message)+'</div>';return }
  const lines=[];
  eachDay(a,b,ds=>{
    const rec=dayRec(ds);if(!rec||!rec[id])return;
    const m=metrics(rec[id],ds),r=rec[id];
    let detail;
    if(['absent','leave','mission','ferie','repos'].includes(m.statut))
      detail=statutTag(m.statut,emp(id).sexe)+(m.ferieNom?' <span style="color:var(--muted)">'+esc(m.ferieNom)+'</span>':'');
    else detail=esc(entreeAff(r)||'—')+' → '+esc(sortieAff(r)||'—')+' · <b>'+hLabel(m.heures)+'</b>'+
      (m.late?' · <span style="color:var(--late)">+'+m.retard+' min</span>':'')+
      (m.hs?' · <span style="color:var(--mission)">'+hLabel(m.hs)+' sup</span>':'')+
      (m.revue?' · <span class="tag t-late" title="'+esc(m.motifRevue)+'">⚠</span>':'')+
      ((m.manuel||m.manuelHS)?' <span title="Saisie manuelle" style="color:var(--gold-ink)">&#9998;</span>':'');
    lines.push('<div class="hist-line"><span class="hd">'+fmtDate(ds)+'</span><span>'+detail+
      '</span><span>'+statutTag(m.statut,emp(id).sexe)+'</span></div>');
  });
  box.innerHTML=lines.reverse().slice(0,120).join('')||
    '<div style="color:var(--muted);font-size:13px;padding:8px 0">Aucun pointage sur la période.</div>';
}
Object.assign(window,{openProfile,fillHist});

async function resetAcces(id){
  if(!confirm('Régénérer le QR code et le code de '+empName(id)+' ?\n\nSa carte actuelle ne fonctionnera plus.'))return;
  try{
    const d=await api('/api/employee/'+encodeURIComponent(id)+'/reset-acces',{method:'POST',body:{}});
    await charger();
    alert('Nouveau code de '+empName(id)+' : '+d.pin+'\n\nNotez-le : il faudra réimprimer sa carte QR.');
    toast('Accès régénéré');
  }catch(e){toast('Échec : '+e.message,'err')}
}
async function uploadPhoto(id,f){
  if(!f)return;
  const fd=new FormData();fd.append('file',f);
  try{
    const d=await api('/api/employee/'+encodeURIComponent(id)+'/photo',{method:'POST',body:fd});
    const e=emp(id);e.photo=d.photo;toast('Photo enregistrée');openProfile(id);
  }catch(e){toast('Photo refusée : '+e.message,'warn')}
}
async function deleteEmp(id){
  if(!can('delete')){toast('Réservé aux RH','warn');return}
  const e=emp(id);
  if(!confirm('Supprimer '+((e.prenom||'')+' '+(e.nom||''))+' (matricule '+matOf(e)+') ?\n\n'+
    'Sa fiche ET tout son historique de pointage seront supprimés, et elle ne réapparaîtra plus lors des imports (démission).\n\nCette action est irréversible.'))return;
  try{
    await api('/api/employee/delete',{method:'POST',body:{id}});
    await charger();closeModal();await go('personnel');
    toast((e.prenom||'')+' '+(e.nom||'')+' supprimée');
  }catch(err){toast('Suppression impossible : '+err.message,'err')}
}
Object.assign(window,{resetAcces,uploadPhoto,deleteEmp});

/* ------------------------------------------------------------ édition fiche */
const FAMILLES=['Célibataire','Marié(e)','Divorcé(e)','Veuf(ve)'];
const NIVEAUX=['Sans','Primaire','Base','Secondaire','Bac','Licence','Maîtrise','Ingénieur'];
function fldTxt(lbl,k,val,type){return '<div class="info-block" style="margin-bottom:0">'+
  '<label class="fldlab" for="ed_'+k+'">'+esc(lbl)+'</label>'+
  '<input class="fldin" id="ed_'+k+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'"></div>'}
function fldSel(lbl,k,val,opts){
  const o2=opts.includes(val)?opts:(val?[val,...opts]:opts);
  return '<div class="info-block" style="margin-bottom:0"><label class="fldlab" for="ed_'+k+'">'+esc(lbl)+'</label>'+
    '<select class="fldin" id="ed_'+k+'">'+o2.map(o=>'<option'+(o===val?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></div>'}
/* Bloc de rémunération de l'éditeur de fiche : le mode est explicite et le taux
   se saisit directement, à l'heure ou à la journée selon la personne. */
function champsPaie(e){
  e=e||{};
  const mode=C.modePaie(e);
  return '<div class="info-block" style="margin-top:14px;background:var(--surface-2)">'+
    '<h4>Rémunération</h4>'+
    '<div class="info-grid" style="gap:14px 16px">'+
      '<div class="info-block" style="margin-bottom:0"><label class="fldlab" for="ed_modePaie">Payé(e)</label>'+
        '<select class="fldin" id="ed_modePaie" onchange="majChampsPaie()">'+
        C.MODES_PAIE.map(m=>'<option value="'+m+'"'+(m===mode?' selected':'')+'>'+esc(C.MODES_PAIE_LABEL[m])+'</option>').join('')+
        '</select></div>'+
      fldTxt('Prix d’une heure (TND)','tauxHoraire',e.tauxHoraire,'number')+
      fldTxt('Prix d’une journée (TND)','tauxJour',e.tauxJour,'number')+
      fldTxt('Salaire mensuel de référence (TND)','salaire',e.salaire,'number')+
    '</div>'+
    '<div class="hint" id="paieHint" style="margin-top:8px"></div></div>';
}
function majChampsPaie(){
  const m=(($('#ed_modePaie')||{}).value)||'horaire';
  const h=$('#paieHint');
  const bH=$('#ed_tauxHoraire'),bJ=$('#ed_tauxJour');
  if(bH&&bH.parentNode)bH.parentNode.style.opacity=(m==='horaire')?'1':'.45';
  if(bJ&&bJ.parentNode)bJ.parentNode.style.opacity=(m==='journalier')?'1':'.45';
  const s=S();
  const dft=(m==='journalier')?(+s.tauxJourDefaut||0):(+s.tauxHoraireDefaut||0);
  if(h)h.innerHTML=(m==='journalier'
    ? 'Payé(e) <b>à la journée travaillée</b> : la paie du mois = jours travaillés × prix de la journée.'
    : 'Payé(e) <b>à l’heure</b> : la paie du mois = heures pointées (normales + supplémentaires) × prix de l’heure.')+
    ' Laissé vide, c’est le taux par défaut des paramètres qui s’applique'+(dft?' ('+fr2(dft)+' TND)':' — non renseigné pour l’instant')+'.'+
    ' Le salaire mensuel n’entre pas dans le calcul : c’est une information de dossier.';
}
Object.assign(window,{champsPaie,majChampsPaie});
function openEditEmp(id){
  const e=emp(id);
  openModal('<div class="modal-head">'+I.gear+'<h3>Modifier la fiche — '+esc((e.prenom||'')+' '+(e.nom||''))+'</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body"><div class="info-grid" style="gap:14px 16px">'+
    fldTxt('Prénom','prenom',e.prenom)+fldTxt('Nom','nom',e.nom)+
    fldTxt('Matricule (clé de rapprochement avec la pointeuse)','matricule',matOf(e))+fldTxt('CIN','cin',e.cin)+
    fldTxt('N° CNSS','cnss',e.cnss)+fldTxt('Téléphone','tel',e.tel)+
    fldTxt('Email','email',e.email)+fldSel('Poste','poste',e.poste,POSTES)+
    fldSel('Catégorie','categorie',e.categorie,['Ouvrier','Cadre'])+fldSel('Service','service',e.service,SERVICES)+
    fldSel('Atelier','atelier',e.atelier,ATELIERS)+fldSel('Contrat','contrat',e.contrat,CONTRATS)+
    fldTxt('Date de naissance','naissance',e.naissance,'date')+
    fldTxt('Date d’embauche','embauche',e.embauche,'date')+fldSel('Situation','famille',e.famille,FAMILLES)+
    fldTxt('Enfants','enfants',e.enfants,'number')+fldSel('Niveau scolaire','niveau',e.niveau,NIVEAUX)+
    fldSel('Sexe','sexe',(e.sexe==='H'?'Homme':'Femme'),['Femme','Homme'])+fldTxt('Responsable','responsable',e.responsable)+
    fldTxt('Adresse','adresse',e.adresse)+
  '</div>'+champsPaie(e)+
  '<div class="hint" style="margin-top:8px">Un champ vidé est bien effacé (ce n’était pas le cas auparavant).</div></div>'+
  '<div class="modal-foot"><button class="btn btn-ghost" onclick="openProfile(\''+escJs(id)+'\')">Annuler</button>'+
    '<button class="btn btn-gold" onclick="saveEditEmp(\''+escJs(id)+'\')">'+I.check+' Enregistrer</button></div>','wide');
  majChampsPaie();
}
function saveEditEmp(id){
  const e=emp(id),g=k=>{const el=$('#ed_'+k);return el?el.value:undefined};
  const mat=String(g('matricule')||'').trim();
  if(mat&&DB.employees.some(x=>x.id!==id&&matOf(x)===mat)){
    toast('Ce matricule est déjà utilisé par '+DB.employees.filter(x=>x.id!==id&&matOf(x)===mat).map(x=>x.prenom+' '+x.nom).join(', '),'warn',9000);
    return;
  }
  ['prenom','nom','matricule','cin','cnss','tel','email','poste','categorie','service','atelier','contrat',
   'famille','responsable','adresse','niveau','modePaie'].forEach(k=>{const v=g(k);if(v!==undefined)e[k]=v.trim?v.trim():v});
  e.salaire=+g('salaire')||0;
  e.tauxHoraire=+g('tauxHoraire')||0;
  e.tauxJour=+g('tauxJour')||0;
  e.enfants=+g('enfants')||0;
  e.naissance=g('naissance')||'';
  e.embauche=g('embauche')||'';
  e.sexe=(g('sexe')==='Homme')?'H':'F';
  delete e.aCompleter;
  ENGINE.invalidate();
  save();toast('Fiche mise à jour');openProfile(id);
}
function nouvelId(){
  /* on repart du plus grand identifiant existant : compter les employées
     recréait un identifiant déjà attribué après une suppression */
  let max=0;DB.employees.forEach(e=>{const n=parseInt(String(e.id||'E0').slice(1),10);if(!isNaN(n)&&n>max)max=n});
  return 'E'+pad(max+1);
}
function openAddEmp(){
  openModal('<div class="modal-head">'+I.users+'<h3>Nouveau salarié</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body"><div class="info-grid" style="gap:14px 16px">'+
    fldTxt('Prénom *','prenom','')+fldTxt('Nom *','nom','')+
    fldTxt('Matricule * (celui de la pointeuse)','matricule','')+fldTxt('CIN','cin','')+
    fldTxt('N° CNSS','cnss','')+fldTxt('Téléphone','tel','')+
    fldSel('Poste','poste',POSTES[0],POSTES)+fldSel('Catégorie','categorie','Ouvrier',['Ouvrier','Cadre'])+
    fldSel('Service','service',SERVICES[0],SERVICES)+fldSel('Atelier','atelier',ATELIERS[0],ATELIERS)+
    fldSel('Contrat','contrat',CONTRATS[0],CONTRATS)+
    fldTxt('Date de naissance','naissance','','date')+fldTxt('Date d’embauche','embauche',TODAY,'date')+
    fldSel('Situation','famille',FAMILLES[0],FAMILLES)+fldTxt('Enfants','enfants','0','number')+
    fldSel('Sexe','sexe','Femme',['Femme','Homme'])+fldTxt('Email','email','')+
  '</div>'+champsPaie({})+
  '<div class="hint" style="margin-top:8px">Le <b>matricule</b> doit être celui du badge sur la pointeuse : c’est lui qui permet de rapprocher les pointages importés. '+
  'Pour créer beaucoup de fiches d’un coup, utilisez plutôt <b>Importer des fiches</b> depuis la liste du personnel.</div></div>'+
  '<div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button>'+
    '<button class="btn btn-gold" onclick="saveNewEmp()">'+I.check+' Créer la fiche</button></div>','wide');
  majChampsPaie();
}
async function saveNewEmp(){
  const g=k=>{const el=$('#ed_'+k);return el?el.value.trim():''};
  if(!g('prenom')||!g('nom')){toast('Prénom et nom obligatoires','warn');return}
  const mat=g('matricule');
  if(!mat){toast('Matricule obligatoire (celui du badge sur la pointeuse)','warn');return}
  if(DB.employees.some(x=>matOf(x)===mat)){toast('Ce matricule existe déjà','warn');return}
  const id=nouvelId();
  DB.employees.push({id,prenom:g('prenom'),nom:g('nom'),matricule:mat,cin:g('cin')||mat,cnss:g('cnss'),
    poste:g('poste'),categorie:g('categorie'),service:g('service'),atelier:g('atelier'),contrat:g('contrat'),
    embauche:g('embauche')||TODAY,naissance:g('naissance'),famille:g('famille'),enfants:+g('enfants')||0,
    niveau:'',email:g('email'),tel:g('tel'),adresse:'',salaire:+g('salaire')||0,
    modePaie:g('modePaie')||undefined,tauxHoraire:+g('tauxHoraire')||0,tauxJour:+g('tauxJour')||0,
    sexe:g('sexe')==='Homme'?'H':'F',responsable:'',actif:true});
  if(await saveNow()){closeModal();await charger();await go('personnel');toast('Fiche créée pour '+g('prenom')+' '+g('nom'))}
}
Object.assign(window,{openEditEmp,saveEditEmp,openAddEmp,saveNewEmp,nouvelId,fldTxt,fldSel,FAMILLES,NIVEAUX});

/* ============================================================================
   ABSENCES
   ============================================================================ */
let ABS_FROM,ABS_TO,ABS_Q='';
function lastPresence(id,depuis){
  let best='';
  for(const ds in DB.pointages){
    if(ds>TODAY||(depuis&&ds<depuis))continue;
    const r=DB.pointages[ds][id];
    if(r&&(r.statut==='present'||r.statut==='autorisation')&&ds>best)best=ds;
  }
  return best;
}
function absStreak(id){
  /* les jours fériés, les jours de repos ET les autorisations ne cassent plus la
     série à tort, et les fériés ne la prolongent pas */
  let days=0,start='';
  let ds=TODAY;
  for(let k=0;k<200;k++){
    if(estOuvre(ds)){
      const r=(DB.pointages[ds]||{})[id];
      const m=metrics(r,ds);
      if(['present','late','leave','mission','autorisation','ferieTravaille','reposTravaille'].includes(m.statut))break;
      if(DB.pointages[ds]){days++;start=ds}
    }
    ds=addDays(ds,-1);
  }
  return {days,start};
}
function absInRange(id,a,b){
  let n=0;
  eachDay(a,b,ds=>{
    if(ds>TODAY||!estOuvre(ds))return;
    const rec=DB.pointages[ds];if(!rec)return;
    if(metrics(rec[id],ds).statut==='absent')n++;
  });
  return n;
}
Object.assign(window,{absStreak,absInRange,lastPresence});

VUES.absences = async function(main){
  if(!ABS_FROM){ABS_FROM=monthBounds(TODAY.slice(0,7))[0];ABS_TO=TODAY}
  await ensureRange(ABS_FROM,ABS_TO);
  /* calculé UNE fois par rendu (c'était fait deux fois, sur 200 jours par personne) */
  const now=DB.employees.map(e=>({e,st:absStreak(e.id)})).filter(x=>x.st.days>0);
  const range=DB.employees.map(e=>({e,n:absInRange(e.id,ABS_FROM,ABS_TO)})).filter(x=>x.n>0);
  window._absData={now,range};
  const totRange=range.reduce((s,x)=>s+x.n,0);
  main.innerHTML=topbar('Suivi des absences','Absences',
    '<button class="btn btn-ghost" onclick="csvAbsences()">'+I.download+' CSV</button>')+
  '<div class="page view">'+
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr)">'+
      kpi('Absents aujourd’hui',now.length,'au '+fmtDate(TODAY),I.calx,'var(--absent)','var(--absent-bg)')+
      kpi('Jours d’absence',totRange,'sur la période',I.calx,'var(--late)','var(--late-bg)')+
      kpi('Salariés concernés',range.length,'sur la période',I.users,'var(--ink)','#eae5d9')+
      kpi('Justificatifs',DB.absences.length,'enregistrés',I.doc,'var(--leave)','var(--leave-bg)')+'</div>'+
    '<div class="card" style="padding:14px 16px;margin-bottom:16px" class="filterbar">'+
      '<div class="range-bar" style="margin:0">'+
      '<div class="field"><label for="abFrom">Du</label><input type="date" id="abFrom" value="'+ABS_FROM+'" onchange="setAbsRange()"></div>'+
      '<div class="field"><label for="abTo">Au</label><input type="date" id="abTo" value="'+ABS_TO+'" onchange="setAbsRange()"></div>'+
      '<div class="field"><label for="abServ">Service</label><select id="abServ" onchange="fillAbsLists()"><option value="">Tous</option>'+SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="abAtel">Atelier</label><select id="abAtel" onchange="fillAbsLists()"><option value="">Tous</option>'+ATELIERS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field" style="flex:1;min-width:180px">'+I.search+'<label for="abQ" class="sr-only">Recherche</label>'+
        '<input id="abQ" type="search" value="'+esc(ABS_Q)+'" placeholder="Nom, matricule…" oninput="ABS_Q=this.value;fillAbsLists()"></div>'+
      '</div></div>'+
    '<div class="card tablecard" style="margin-bottom:16px"><div class="table-head">'+I.warn+
      '<h3>Actuellement absents — depuis quand</h3><div class="spacer"></div><span style="font-size:12px;color:var(--muted)" id="nowCount"></span></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Mat.</th><th>Employée</th><th>Service</th><th>Absent depuis</th><th>Jours ouvrés</th><th>Dernière présence</th><th></th></tr></thead>'+
      '<tbody id="nowBody"></tbody></table></div></div>'+
    '<div class="card tablecard" style="margin-bottom:16px"><div class="table-head">'+I.calx+
      '<h3>Absences sur la période — '+fmtDate(ABS_FROM)+' → '+fmtDate(ABS_TO)+'</h3>'+
      '<div class="spacer"></div><span style="font-size:12px;color:var(--muted)" id="rangeCount"></span></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Mat.</th><th>Employée</th><th>Service</th><th>Atelier</th><th>Jours absents</th><th></th></tr></thead>'+
      '<tbody id="rangeBody"></tbody></table></div></div>'+
    '<div class="card tablecard"><div class="table-head">'+I.doc+'<h3>Justificatifs enregistrés</h3><div class="spacer"></div>'+
      '<div class="field">'+I.filter+'<label for="aFilt" class="sr-only">Filtre</label><select id="aFilt" onchange="fillAbs()">'+
      '<option value="">Tous</option><option value="justifiée">Justifiés</option><option value="injustifiée">Injustifiés</option></select></div></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Mat.</th><th>Employée</th><th>Type</th><th>Période</th><th>Jours</th><th>Statut</th><th>Note</th></tr></thead>'+
      '<tbody id="absBody"></tbody></table></div></div>'+
  '</div>';
  fillAbsLists();fillAbs();
};
async function setAbsRange(){ABS_FROM=$('#abFrom').value;ABS_TO=$('#abTo').value;await go('absences')}
function absFiltre(e){
  const q=ABS_Q.toLowerCase(),sv=(($('#abServ')||{}).value)||'',at=(($('#abAtel')||{}).value)||'';
  return (!q||((e.prenom||'')+' '+(e.nom||'')+' '+matOf(e)).toLowerCase().includes(q))
    &&(!sv||e.service===sv)&&(!at||e.atelier===at);
}
function fillAbsLists(){
  const d=window._absData||{now:[],range:[]};
  const now=d.now.filter(x=>absFiltre(x.e)).sort((a,b)=>b.st.days-a.st.days);
  const range=d.range.filter(x=>absFiltre(x.e)).sort((a,b)=>b.n-a.n);
  const nc=$('#nowCount');if(nc)nc.textContent=now.length+' salarié(s)';
  const rc=$('#rangeCount');if(rc)rc.textContent=range.reduce((s,x)=>s+x.n,0)+' jour(s)';
  const nb=$('#nowBody');
  if(nb)nb.innerHTML=now.map(x=>{const lp=lastPresence(x.e.id);
    return '<tr><td class="mono">'+esc(matOf(x.e))+'</td><td>'+empCell(x.e.id,true)+'</td>'+
      '<td style="color:var(--muted)">'+esc(x.e.service||'—')+'</td>'+
      '<td class="mono"><b>'+fmtDate(x.st.start)+'</b></td><td><b style="color:var(--absent)">'+x.st.days+' j</b></td>'+
      '<td class="mono" style="color:var(--muted)">'+(lp?fmtDate(lp):'—')+'</td>'+
      '<td><button class="linkish" onclick="openCorrection(\''+escJs(x.e.id)+'\')">Corriger →</button></td></tr>'}).join('')
    ||'<tr><td colspan="7"><div class="empty">'+I.check+'<div>Aucune absence en cours</div></div></td></tr>';
  const rb=$('#rangeBody');
  if(rb)rb.innerHTML=range.map(x=>'<tr><td class="mono">'+esc(matOf(x.e))+'</td><td>'+empCell(x.e.id,true)+'</td>'+
    '<td style="color:var(--muted)">'+esc(x.e.service||'—')+'</td><td style="color:var(--muted)">'+esc(x.e.atelier||'—')+'</td>'+
    '<td><b>'+x.n+'</b> j</td><td><button class="linkish" onclick="openCorrection(\''+escJs(x.e.id)+'\')">Corriger →</button></td></tr>').join('')
    ||'<tr><td colspan="6"><div class="empty">Aucune absence sur la période</div></td></tr>';
}
function fillAbs(){
  const f=(($('#aFilt')||{}).value)||'';
  const rows=DB.absences.filter(a=>!f||a.statut===f);
  const tb=$('#absBody');if(!tb)return;
  tb.innerHTML=rows.map(a=>'<tr><td class="mono">'+esc(matOf(emp(a.id)))+'</td><td>'+empCell(a.id,true)+'</td>'+
    '<td>'+esc(a.type||'')+'</td><td class="mono">'+fmtDate(a.debut)+(a.fin!==a.debut?' → '+fmtDate(a.fin):'')+'</td>'+
    '<td><b>'+esc(String(a.jours||''))+'</b> j</td>'+
    '<td><span class="tag '+(a.statut==='justifiée'?'t-present':'t-absent')+'">'+esc(a.statut||'')+'</span></td>'+
    '<td style="color:var(--muted);font-size:12px">'+esc(a.note||'')+'</td></tr>').join('')
    ||'<tr><td colspan="7"><div class="empty">Aucun justificatif enregistré</div></td></tr>';
}
function csvAbsences(){
  const d=window._absData||{now:[],range:[]};
  const out=[['Absences — DBS Fashion'],['Période','du '+ABS_FROM,'au '+ABS_TO],[],
    ['Matricule','Nom','Prénom','Service','Atelier','Jours absents sur la période','Absent depuis','Jours consécutifs','Dernière présence']];
  DB.employees.filter(absFiltre).forEach(e=>{
    const n=absInRange(e.id,ABS_FROM,ABS_TO);const st=absStreak(e.id);
    if(!n&&!st.days)return;
    out.push([matOf(e),e.nom||'',e.prenom||'',e.service||'',e.atelier||'',n,st.start||'',st.days||0,lastPresence(e.id)||'']);
  });
  csvDL('absences_'+ABS_FROM+'_'+ABS_TO+'.csv',out);toast('Absences exportées');
}
Object.assign(window,{setAbsRange,fillAbsLists,fillAbs,csvAbsences,absFiltre});
Object.defineProperty(window,'ABS_Q',{get:()=>ABS_Q,set:v=>{ABS_Q=v},configurable:true});

/* ============================================================================
   RETARDS
   ============================================================================ */
VUES.retards = async function(main){
  const r=dayRec(TODAY)||{};const lates=[];
  DB.employees.forEach(e=>{const mm=metrics(r[e.id],TODAY);
    if(mm.statut==='late')lates.push({e,min:mm.retard,heure:(r[e.id]||{}).entree||''})});
  const totMin=lates.reduce((s,l)=>s+l.min,0);
  const [a,b]=monthBounds(TODAY.slice(0,7));
  const rank=summarize(a,b).filter(s=>s.rt>0).sort((x,y)=>y.rt-x.rt||y.ret-x.ret);
  const reg=regimeFor(TODAY);
  main.innerHTML=topbar('Ponctualité','Retards',
    '<button class="btn btn-ghost" onclick="csvRetards()">'+I.download+' CSV</button>')+
  '<div class="page view">'+
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr)">'+
      kpi('Retards du jour',lates.length,'après '+esc((reg.debut||'—'))+' + '+(+reg.tol||0)+' min',I.late,'var(--late)','var(--late-bg)')+
      kpi('Minutes perdues',totMin,'cumul du jour',I.clock,'var(--absent)','var(--absent-bg)')+
      kpi('Retards du mois',rank.reduce((s,x)=>s+x.rt,0),'mois en cours',I.late,'var(--ink)','#eae5d9')+
      kpi('Tolérance',(+reg.tol||0)+' min','régime du jour',I.gear,'var(--gold-ink)','var(--gold-soft)')+'</div>'+
    '<div class="split">'+
      '<div class="card tablecard"><div class="table-head">'+I.late+'<h3>Retards du jour</h3></div>'+
        '<div class="tblwrap"><table class="tbl"><thead><tr><th>Mat.</th><th>Employée</th><th>Service</th><th>Arrivée</th><th>Retard</th></tr></thead><tbody>'+
        (lates.length?lates.sort((x,y)=>y.min-x.min).map(l=>'<tr><td class="mono">'+esc(matOf(l.e))+'</td><td>'+empCell(l.e.id,true)+
          '</td><td style="color:var(--muted)">'+esc(l.e.service||'—')+'</td><td class="mono">'+esc(l.heure)+
          '</td><td><b style="color:var(--late)">+'+l.min+' min</b></td></tr>').join('')
         :'<tr><td colspan="5"><div class="empty">'+I.check+'<div>Aucun retard</div></div></td></tr>')+'</tbody></table></div></div>'+
      '<div class="card tablecard"><div class="table-head">'+I.warn+'<h3>Classement du mois</h3></div>'+
        '<div class="tblwrap"><table class="tbl"><thead><tr><th>#</th><th>Employée</th><th>Retards</th><th>Minutes</th><th>Alerte</th></tr></thead><tbody>'+
        (rank.slice(0,12).map((x,i)=>'<tr><td class="mono">'+(i+1)+'</td><td>'+empCell(x.e.id,true)+'</td><td><b>'+x.rt+
          '</b></td><td class="mono">'+x.ret+'</td><td>'+(x.rt>=3?'<span class="tag t-absent">Seuil dépassé</span>':'<span class="tag t-present">OK</span>')+
          '</td></tr>').join('')||'<tr><td colspan="5"><div class="empty">Aucun retard ce mois</div></td></tr>')+
        '</tbody></table></div></div>'+
    '</div></div>';
};
function csvRetards(){
  const [a,b]=monthBounds(TODAY.slice(0,7));
  const out=[['Retards — DBS Fashion'],['Mois',TODAY.slice(0,7)],[mentionRegime()],[],
    ['Date','Matricule','Nom','Prénom','Service','Atelier','Entrée','Retard (min)']];
  eachDay(a,b,ds=>{
    const rec=dayRec(ds);if(!rec||!estOuvre(ds))return;
    DB.employees.forEach(e=>{const m=metrics(rec[e.id],ds);
      if(m.late)out.push([ds,matOf(e),e.nom||'',e.prenom||'',e.service||'',e.atelier||'',(rec[e.id]||{}).entree||'',m.retard])});
  });
  csvDL('retards_'+TODAY.slice(0,7)+'.csv',out);toast('Retards exportés');
}
window.csvRetards=csvRetards;

/* ============================================================================
   CONGÉS — la validation génère désormais les journées de congé
   ============================================================================ */
const TYPES_CONGE=['Congé annuel','Congé sans solde','Congé maladie','Congé maternité','Autorisation de sortie'];
const TYPES_JOURNEE=['Congé annuel','Congé sans solde','Congé maladie','Congé maternité'];

VUES.conges = async function(main){
  const att=DB.conges.filter(c=>c.statut==='En attente').length;
  main.innerHTML=topbar('Congés & autorisations','Congés & sorties',
    (can('edit')?'<button class="btn btn-gold" onclick="openConge()">'+I.plus+' Nouvelle demande</button>':''))+
  '<div class="page view">'+
    '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">'+
      kpi('En attente',att,'à valider',I.cal,'var(--late)','var(--late-bg)')+
      kpi('En congé aujourd’hui',counts(TODAY).leave,'sur le pointage',I.leaf,'var(--leave)','var(--leave-bg)')+
      kpi('Autorisations',DB.conges.filter(c=>String(c.type||'').includes('Autorisation')).length,'sorties',I.clock,'var(--present)','var(--present-bg)')+'</div>'+
    '<div class="banner banner-info">'+I.check+'<div class="grow">Valider une demande <b>inscrit désormais les journées de congé dans le pointage</b>. '+
      'Auparavant les jours restaient comptés « absents » dans les rapports et les états d’absence.</div></div>'+
    '<div class="filterbar">'+
      '<div class="field">'+I.search+'<label for="cgQ" class="sr-only">Recherche</label><input id="cgQ" type="search" placeholder="Nom, matricule…" oninput="fillConges()"></div>'+
      '<div class="field"><label for="cgFStatut">Statut</label><select id="cgFStatut" onchange="fillConges()"><option value="">Tous</option><option>En attente</option><option>Validé</option><option>Refusé</option></select></div>'+
      '<div class="field"><label for="cgFType">Type</label><select id="cgFType" onchange="fillConges()"><option value="">Tous</option>'+TYPES_CONGE.map(t=>'<option>'+esc(t)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="cgFServ">Service</label><select id="cgFServ" onchange="fillConges()"><option value="">Tous</option>'+SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div class="card tablecard"><div class="table-head">'+I.cal+'<h3>Demandes</h3><div class="spacer"></div>'+
      '<span style="font-size:12px;color:var(--muted)" id="cgCount"></span></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Mat.</th><th>Employée</th><th>Type</th><th>Période</th><th>Jours</th><th>Statut</th><th>Pointage</th><th></th></tr></thead>'+
      '<tbody id="cgBody"></tbody></table></div></div></div>';
  fillConges();
};
function fillConges(){
  const q=((($('#cgQ')||{}).value)||'').toLowerCase(),st=(($('#cgFStatut')||{}).value)||'',
        ty=(($('#cgFType')||{}).value)||'',sv=(($('#cgFServ')||{}).value)||'';
  const rows=DB.conges.map((c,i)=>({c,i})).filter(x=>{const e=emp(x.c.id);
    return (!q||((e.prenom||'')+' '+(e.nom||'')+' '+matOf(e)).toLowerCase().includes(q))
      &&(!st||x.c.statut===st)&&(!ty||x.c.type===ty)&&(!sv||e.service===sv)});
  const cc=$('#cgCount');if(cc)cc.textContent=rows.length+' demande(s)';
  const tb=$('#cgBody');if(!tb)return;
  tb.innerHTML=rows.map(x=>{
    const c=x.c,e=emp(c.id);
    const cid=c.cid||('i'+x.i);
    return '<tr><td class="mono">'+esc(matOf(e))+'</td><td>'+empCell(c.id,true)+'</td><td>'+esc(c.type||'')+'</td>'+
      '<td class="mono">'+fmtDate(c.debut)+(c.fin!==c.debut?' → '+fmtDate(c.fin):'')+'</td><td>'+esc(String(c.jours||''))+' j</td>'+
      '<td><span class="tag '+(c.statut==='Validé'?'t-present':c.statut==='Refusé'?'t-absent':'t-late')+'">'+esc(c.statut||'')+'</span></td>'+
      '<td>'+(c.applique?'<span class="tag t-leave">Inscrit</span>':'<span style="color:var(--faint)">—</span>')+'</td>'+
      '<td>'+(can('edit')?(c.statut==='En attente'
        ? '<button class="linkish" onclick="validConge(\''+escJs(cid)+'\')">Valider</button> · <button class="linkish danger" onclick="refuseConge(\''+escJs(cid)+'\')">Refuser</button>'
        : (c.statut==='Validé'&&!c.applique&&TYPES_JOURNEE.includes(c.type)
           ? '<button class="linkish" onclick="validConge(\''+escJs(cid)+'\')">Inscrire au pointage</button>'
           : '<button class="linkish danger" onclick="delConge(\''+escJs(cid)+'\')">Supprimer</button>')):'—')+'</td></tr>';
  }).join('')||'<tr><td colspan="8"><div class="empty">Aucune demande</div></td></tr>';
}
function _conge(cid){
  /* identification par identifiant stable : l'ancien code utilisait l'index du
     tableau alors que les nouvelles demandes sont insérées en tête — on validait
     la mauvaise demande */
  if(String(cid).startsWith('i')){const i=+String(cid).slice(1);return DB.conges[i]}
  return DB.conges.find(c=>c.cid===cid);
}
async function validConge(cid){
  const c=_conge(cid);if(!c){toast('Demande introuvable','warn');return}
  const e=emp(c.id);
  if(!TYPES_JOURNEE.includes(c.type)){
    c.statut='Validé';
    if(await saveNow()){toast('Autorisation validée');await go('conges')}
    return;
  }
  await ensureRange(c.debut,c.fin);
  const jours=[],ignores=[],ecrases=[];
  eachDay(c.debut,c.fin,ds=>{
    if(!estOuvre(ds)){ignores.push(ds);return}
    if(moisClos(ds.slice(0,7))){ignores.push(ds);return}
    const ex=(DB.pointages[ds]||{})[c.id];
    const m=ex?metrics(ex,ds):null;
    if(m&&['present','late','autorisation','ferieTravaille','reposTravaille'].includes(m.statut))ecrases.push(ds);
    jours.push(ds);
  });
  if(!jours.length){toast('Aucun jour ouvré dans cette période','warn');return}
  if(!confirm('Valider le '+c.type.toLowerCase()+' de '+((e.prenom||'')+' '+(e.nom||''))+' ?\n\n'+
    jours.length+' journée(s) ouvrée(s) seront inscrites en « congé » dans le pointage.\n'+
    (ignores.length?ignores.length+' jour(s) ignoré(s) (repos, férié ou mois clôturé).\n':'')+
    (ecrases.length?'\nATTENTION : '+ecrases.length+' journée(s) comportent déjà un pointage de présence qui sera remplacé :\n'+
      ecrases.slice(0,8).map(fmtDate).join(', ')+(ecrases.length>8?'…':'')+'\n':'')))return;
  const recs=jours.map(ds=>({date:ds,id:c.id,statut:'leave',entree:'',sortie:'',
    punches:null,hM:null,hsM:null,manuel:1,src:'conge'}));
  if(!await persistBulk(recs,'Congé validé · '+empName(c.id)+' · '+c.type,'conge'))return;
  jours.forEach(ds=>{
    if(!DB.pointages[ds])DB.pointages[ds]={};
    DB.pointages[ds][c.id]={statut:'leave',entree:'',sortie:'',manuel:1,src:'conge'};
  });
  c.statut='Validé';c.applique=true;c.joursAppliques=jours.length;
  await saveNow();
  toast('Congé validé · '+jours.length+' journée(s) inscrites au pointage');
  await go('conges');
}
async function refuseConge(cid){
  const c=_conge(cid);if(!c)return;
  if(!confirm('Refuser cette demande ?'))return;
  c.statut='Refusé';
  if(await saveNow()){toast('Demande refusée');await go('conges')}
}
async function delConge(cid){
  const c=_conge(cid);if(!c)return;
  if(!confirm('Supprimer cette demande ?\n\n'+(c.applique?'Les journées déjà inscrites au pointage ne seront PAS retirées automatiquement — corrigez-les depuis la fiche du salarié si nécessaire.':'')))return;
  DB.conges=DB.conges.filter(x=>x!==c);
  if(await saveNow()){toast('Demande supprimée');await go('conges')}
}
function openConge(){
  const opts=DB.employees.slice().sort((a,b)=>(a.nom||'').localeCompare(b.nom||''))
    .map(e=>'<option value="'+esc(e.id)+'">'+esc((e.nom||'')+' '+(e.prenom||'')+' — '+matOf(e))+'</option>').join('');
  openModal('<div class="modal-head">'+I.cal+'<h3>Nouvelle demande</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body"><div class="info-grid" style="gap:14px 16px">'+
    '<div class="info-block" style="margin-bottom:0"><label class="fldlab" for="cgEmp">Salarié</label>'+
      '<select class="fldin" id="cgEmp">'+opts+'</select></div>'+
    '<div class="info-block" style="margin-bottom:0"><label class="fldlab" for="cgType">Type</label>'+
      '<select class="fldin" id="cgType">'+TYPES_CONGE.map(t=>'<option>'+esc(t)+'</option>').join('')+'</select></div>'+
    '<div class="info-block" style="margin-bottom:0"><label class="fldlab" for="cgD">Du</label>'+
      '<input class="fldin" type="date" id="cgD" value="'+TODAY+'"></div>'+
    '<div class="info-block" style="margin-bottom:0"><label class="fldlab" for="cgF">Au</label>'+
      '<input class="fldin" type="date" id="cgF" value="'+TODAY+'"></div>'+
  '</div><div class="hint" style="margin-top:8px">Le salarié est identifié par son <b>matricule</b> : plus de confusion entre homonymes.</div></div>'+
  '<div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button>'+
    '<button class="btn btn-gold" onclick="saveConge()">'+I.check+' Enregistrer</button></div>');
}
async function saveConge(){
  const id=$('#cgEmp').value;
  if(!id){toast('Choisissez un salarié','warn');return}
  let d=$('#cgD').value||TODAY, f=$('#cgF').value||d;
  if(f<d){const t=d;d=f;f=t}
  let j=0;eachDay(d,f,ds=>{if(estOuvre(ds))j++});
  DB.conges.unshift({cid:'C'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36),
    id,type:$('#cgType').value,debut:d,fin:f,jours:j||1,statut:'En attente',cree:TODAY});
  if(await saveNow()){closeModal();await go('conges');toast('Demande enregistrée ('+(j||1)+' jour(s) ouvré(s))')}
}
Object.assign(window,{fillConges,validConge,refuseConge,delConge,openConge,saveConge,TYPES_CONGE});

/* ============================================================================
   ALERTES
   ============================================================================ */
function computeAlerts(){
  const al=[];
  const dm=[];
  const [mA,mB]=monthBounds(TODAY.slice(0,7));
  DB.employees.forEach(e=>{
    if(e.naissance){const b=new Date(e.naissance);
      if(!isNaN(b)&&b.getMonth()===today.getMonth())
        al.push({type:'Anniversaire',ic:I.cake,col:'var(--leave)',bg:'var(--leave-bg)',
          txt:(e.prenom||'')+' '+(e.nom||''),sub:'Anniversaire le '+pad(b.getDate())+'/'+pad(b.getMonth()+1),when:'Ce mois',id:e.id,
          act:"openProfile('"+escJs(e.id)+"')",actLbl:'Ouvrir la fiche'});}
    if(e.contrat&&e.contrat!=='CDI'&&e.embauche&&anciennete(e.embauche)<1.2){
      const fin=new Date(e.embauche);fin.setMonth(fin.getMonth()+(String(e.contrat).includes('IVP')?12:6));
      const dl=Math.round((fin-today)/864e5);
      if(dl>0&&dl<60)al.push({type:'Fin de période',ic:I.briefcase,col:'var(--late)',bg:'var(--late-bg)',
        txt:(e.prenom||'')+' '+(e.nom||''),sub:'Fin '+e.contrat+' dans '+dl+' j',when:dl+' j',id:e.id,
        act:"openProfile('"+escJs(e.id)+"')",actLbl:'Ouvrir la fiche'});}
    if(e.aCompleter)dm.push(e);
  });
  /* O(E) au lieu de O(E×D) : l'ancien code refiltrait tous les documents pour
     chaque employée, trois fois par rendu du tableau de bord */
  const avecContrat=new Set();
  DB.documents.forEach(d=>{if(String(d.type||'').includes('Contrat'))avecContrat.add(d.id)});
  DB.employees.forEach(e=>{if(!avecContrat.has(e.id))
    al.push({type:'Document manquant',ic:I.warn,col:'var(--absent)',bg:'var(--absent-bg)',
      txt:(e.prenom||'')+' '+(e.nom||''),sub:'Contrat absent du dossier',when:'À régulariser',id:e.id,
      act:"openProfile('"+escJs(e.id)+"')",actLbl:'Ouvrir le dossier'})});
  if(dm.length)al.unshift({type:'Fiches incomplètes',ic:I.users,col:'var(--late)',bg:'var(--late-bg)',
    txt:dm.length+' fiche(s) créée(s) par l’import',sub:'Poste, salaire, dates à compléter',when:'À compléter',
    act:"allerFichesIncompletes()",actLbl:'Voir les fiches à compléter'});
  const revue=aRevoirCount();
  if(revue)al.unshift({type:'Pointage à vérifier',ic:I.warn,col:'var(--absent)',bg:'var(--absent-bg)',
    txt:revue+' journée(s) incomplètes ce mois',sub:'Sortie manquante ou badges impairs — heures faussées',when:'Avant la paie',
    act:"openRevue('"+mA+"','"+mB+"')",actLbl:'Voir et corriger la liste'});
  /* Silence de la pointeuse. C'est l'alerte qui manquait : des journées entières
     sans heure de sortie sont passées inaperçues jusqu'à la paie, faute d'un
     signal disant « plus rien n'arrive ». */
  const ptz=DB.pointeuse;
  if(ptz && ptz.muet){
    al.unshift({type:'Pointeuse muette',ic:I.warn,col:'var(--absent)',bg:'var(--absent-bg)',
      txt:(ptz.silence_h==null?'Aucun pointage jamais reçu':'Aucun pointage depuis '+
        (ptz.silence_h<48?Math.round(ptz.silence_h)+' h':Math.round(ptz.silence_h/24)+' jours')),
      sub:'Le PC de l’atelier est peut-être éteint, ou l’agent ne tourne plus',when:'À vérifier',
      act:"allerPointeuse()",actLbl:'Vérifier la liaison'});
  }
  const nonTraites=(DB.signalements||[]).filter(s=>!s.traite).length;
  if(nonTraites)al.unshift({type:'Signalements salariés',ic:I.bell,col:'var(--leave)',bg:'var(--leave-bg)',
    txt:nonTraites+' signalement(s) non traité(s)',sub:'Erreurs de pointage remontées depuis l’espace salarié',when:'À traiter',
    act:"allerSignalements()",actLbl:'Traiter les signalements'});
  DB.absences.filter(a=>a.statut==='injustifiée'&&a.debut===TODAY).forEach(a=>
    al.push({type:'Absence injustifiée',ic:I.warn,col:'var(--absent)',bg:'var(--absent-bg)',
      txt:empName(a.id),sub:'Non signalée aujourd’hui',when:'Aujourd’hui',id:a.id,
      act:"allerAuJour('"+TODAY+"','"+escJs(a.id)+"')",actLbl:'Aller à la feuille du jour'}));
  return al;
}
function alertCount(){return computeAlerts().length}
/* Chaque alerte est une porte d'entrée vers la correction : un clic ouvre la
   fiche, la liste des journées à vérifier ou la feuille de pointage du jour
   concerné. Avant, l'alerte se contentait de décrire le problème et il fallait
   retrouver soi-même la personne et la date. */
function alertRow(a){
  const dedans='<div class="ai" style="background:'+a.bg+';color:'+a.col+'">'+a.ic+'</div>'+
    '<div class="txt"><b>'+esc(a.txt)+' — '+esc(a.type)+'</b><small>'+esc(a.sub)+'</small></div>'+
    '<div class="when">'+esc(a.when)+'</div>';
  if(!a.act) return '<div class="alert-row">'+dedans+'</div>';
  return '<div class="alert-row alert-clic" role="button" tabindex="0" title="'+esc(a.actLbl||'Corriger')+'" '+
    'onclick="closeModal();'+esc(a.act)+'" '+
    'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}">'+
    dedans+'<span class="alert-go" aria-hidden="true">'+esc(a.actLbl||'Corriger')+' →</span></div>';
}
/* Raccourcis de navigation utilisés par les alertes */
async function allerFichesIncompletes(){
  await go('personnel');
  const s=document.getElementById('pIncomplet');
  if(s){s.value='1';fillPers()}
}
async function allerSignalements(){
  await go('parametres');
  const t=document.getElementById('sigBody');
  if(t&&t.scrollIntoView)t.scrollIntoView({block:'center'});
}
async function allerPointeuse(){
  await go('parametres');
  const t=document.getElementById('ptzBox');
  if(t&&t.scrollIntoView)t.scrollIntoView({block:'center'});
}
Object.assign(window,{allerFichesIncompletes,allerSignalements,allerPointeuse});
VUES.alertes = async function(main){
  const al=computeAlerts(),g={};al.forEach(a=>(g[a.type]=g[a.type]||[]).push(a));
  main.innerHTML=topbar('Notifications','Alertes ('+al.length+')')+'<div class="page view">'+
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr)">'+
      kpi('Total',al.length,'actives',I.bell,'var(--thread)','var(--absent-bg)')+
      kpi('Docs manquants',(g['Document manquant']||[]).length,'dossiers',I.doc,'var(--absent)','var(--absent-bg)')+
      kpi('Anniversaires',(g['Anniversaire']||[]).length,'ce mois',I.cake,'var(--leave)','var(--leave-bg)')+
      kpi('Contrats',(g['Fin de période']||[]).length,'échéances',I.briefcase,'var(--late)','var(--late-bg)')+'</div>'+
    Object.keys(g).map(t=>'<div class="card tablecard" style="margin-bottom:14px">'+
      '<div class="table-head">'+I.bell+'<h3>'+esc(t)+' ('+g[t].length+')</h3></div>'+
      g[t].slice(0,40).map(alertRow).join('')+'</div>').join('')+
    (al.length?'':'<div class="card"><div class="empty">'+I.check+'<div>Aucune alerte</div></div></div>')+
  '</div>';
};
Object.assign(window,{computeAlerts,alertCount,alertRow});

/* ============================================================================
   RSE — indicateurs réels
   ============================================================================ */
VUES.rse = async function(main){
  const E=DB.employees;const n=E.length;
  if(!n){main.innerHTML=topbar('RSE','RSE & bien-être')+'<div class="page"><div class="card"><div class="empty">Aucun salarié enregistré</div></div></div>';return}
  const [a,b]=monthBounds(TODAY.slice(0,7));
  const sum=summarize(a,b);
  const jTot=sum.reduce((s,x)=>s+x.jT+x.jA+x.jC,0);
  const jAbs=sum.reduce((s,x)=>s+x.jA,0);
  const taux=jTot?(jAbs/jTot*100):0;
  const avecNaiss=E.filter(e=>e.naissance);
  const avecEmb=E.filter(e=>e.embauche);
  const ageMoy=avecNaiss.length?(avecNaiss.reduce((s,e)=>s+age(e.naissance),0)/avecNaiss.length):0;
  const ancMoy=avecEmb.length?(avecEmb.reduce((s,e)=>s+anciennete(e.embauche),0)/avecEmb.length):0;
  const femP=pct(E.filter(e=>e.sexe!=='H').length,n);
  const cdi=pct(E.filter(e=>e.contrat==='CDI').length,n);
  const formP=pct(E.filter(e=>['Bac','Licence','Maîtrise','Ingénieur'].includes(e.niveau)).length,n);
  const cadres=E.filter(e=>e.categorie==='Cadre');
  const pariteEnc=cadres.length?pct(cadres.filter(e=>e.sexe!=='H').length,cadres.length):null;
  const stats=await api('/api/stats/absenteisme?mois=12').catch(()=>[]);
  main.innerHTML=topbar('Responsabilité sociétale','RSE & bien-être',
    '<button class="btn btn-ghost" onclick="exportRSE()">'+I.download+' Rapport RSE</button>')+
  '<div class="page view">'+
    '<div class="banner banner-info">'+I.check+'<div class="grow">Tous les indicateurs ci-dessous sont <b>calculés sur vos données réelles</b>. '+
      'Les valeurs codées en dur (turn-over, parité encadrement, courbe d’absentéisme) ont été supprimées.</div></div>'+
    '<div class="rse-grid">'+
      rse('Féminisation',femP+'%',femP,n+' salariés')+
      rse('Âge moyen',ageMoy?ageMoy.toFixed(1)+' ans':'—',ageMoy/60*100,avecNaiss.length+' dates connues')+
      rse('Ancienneté moyenne',ancMoy?ancMoy.toFixed(1)+' ans':'—',ancMoy/15*100,avecEmb.length+' dates connues')+
      rse('Absentéisme (mois)',taux.toFixed(1)+'%',Math.max(0,100-taux*8),'objectif < 5 %')+
      rse('Emplois CDI',cdi+'%',cdi,'sécurité de l’emploi')+
      rse('Personnel Bac et +',formP+'%',formP,(E.filter(e=>e.niveau).length)+' niveaux renseignés')+
      rse('Encadrement',cadres.length,Math.min(100,cadres.length/n*400),'cadres sur '+n)+
      rse('Parité encadrement',pariteEnc==null?'—':pariteEnc+'%',pariteEnc||0,cadres.length?cadres.length+' cadres':'aucun cadre')+
    '</div>'+
    '<div class="split"><div class="card chartcard"><h3>Absentéisme — 12 mois</h3>'+
      '<div class="csub">Calculé sur les pointages</div><div class="chart-wrap" id="cAbs12"></div></div>'+
      '<div class="card chartcard"><h3>Répartition par âge</h3><div class="csub">Pyramide</div>'+
      '<div class="chart-wrap" id="cAge"></div></div></div>'+
    '<div class="split" style="margin-top:16px"><div class="card chartcard"><h3>Par ancienneté</h3>'+
      '<div class="csub">Séniorité</div><div class="chart-wrap" id="cAnc"></div></div>'+
      '<div class="card chartcard"><h3>Effectif par atelier</h3><div class="csub">Répartition</div>'+
      '<div class="chart-wrap" id="cAtel"></div></div></div>'+
  '</div>';
  dessinerLigne('cAbs12',stats.map(s=>({l:MOIS_FR[+s.mois.slice(5,7)-1].slice(0,3)+'.',v:s.taux})),'%');
  const dAge=[0,0,0,0];avecNaiss.forEach(e=>{const x=age(e.naissance);dAge[x<25?0:x<35?1:x<45?2:3]++});
  dessinerBarres('cAge',[{l:'<25',v:dAge[0]},{l:'25-34',v:dAge[1]},{l:'35-44',v:dAge[2]},{l:'45+',v:dAge[3]}]);
  const dAnc=[0,0,0,0];avecEmb.forEach(e=>{const x=anciennete(e.embauche);dAnc[x<2?0:x<5?1:x<10?2:3]++});
  dessinerBarres('cAnc',[{l:'<2 ans',v:dAnc[0]},{l:'2-5',v:dAnc[1]},{l:'5-10',v:dAnc[2]},{l:'10+',v:dAnc[3]}]);
  dessinerDonut('cAtel',ATELIERS.map(x=>({l:x,v:E.filter(e=>e.atelier===x).length})).filter(x=>x.v));
};
function rse(l,v,p,n){return '<div class="rse-card"><div class="rl">'+esc(l)+'</div><div class="rv">'+esc(String(v))+
  '</div><div class="rb"><i style="width:'+Math.min(100,Math.max(4,p||0))+'%"></i></div>'+
  '<div class="progress-note">'+esc(n||'')+'</div></div>'}
function exportRSE(){
  const E=DB.employees;const n=E.length||1;
  const [a,b]=monthBounds(TODAY.slice(0,7));const sum=summarize(a,b);
  const jTot=sum.reduce((s,x)=>s+x.jT+x.jA+x.jC,0),jAbs=sum.reduce((s,x)=>s+x.jA,0);
  const avecNaiss=E.filter(e=>e.naissance),avecEmb=E.filter(e=>e.embauche);
  const cadres=E.filter(e=>e.categorie==='Cadre');
  const out=[['Rapport RSE — DBS Fashion',TODAY],['Périmètre','mois en cours ('+TODAY.slice(0,7)+')'],[],
    ['Indicateur','Valeur','Base de calcul'],
    ['Effectif',n,'fiches actives'],
    ['Féminisation',pct(E.filter(e=>e.sexe!=='H').length,n)+'%',n+' salariés'],
    ['Âge moyen',avecNaiss.length?(avecNaiss.reduce((s,e)=>s+age(e.naissance),0)/avecNaiss.length).toFixed(1)+' ans':'non calculable',avecNaiss.length+' dates de naissance connues'],
    ['Ancienneté moyenne',avecEmb.length?(avecEmb.reduce((s,e)=>s+anciennete(e.embauche),0)/avecEmb.length).toFixed(1)+' ans':'non calculable',avecEmb.length+' dates d’embauche connues'],
    ['Absentéisme',jTot?(jAbs/jTot*100).toFixed(1)+'%':'non calculable',jAbs+' jours absents sur '+jTot+' jours pointés'],
    ['Part de CDI',pct(E.filter(e=>e.contrat==='CDI').length,n)+'%',n+' contrats'],
    ['Personnel Bac et +',pct(E.filter(e=>['Bac','Licence','Maîtrise','Ingénieur'].includes(e.niveau)).length,n)+'%',E.filter(e=>e.niveau).length+' niveaux renseignés'],
    ['Encadrement',cadres.length,'cadres'],
    ['Parité encadrement',cadres.length?pct(cadres.filter(e=>e.sexe!=='H').length,cadres.length)+'%':'non calculable',cadres.length+' cadres'],
  ];
  csvDL('rapport_RSE_'+TODAY+'.csv',out);toast('Rapport RSE exporté');
}
Object.assign(window,{rse,exportRSE});

/* ============================================================================
   DOCUMENTS
   ============================================================================ */
VUES.documents = async function(main){
  main.innerHTML=topbar('Gestion documentaire','Documents & lecture IA',
    (can('edit')?'<button class="btn btn-gold" onclick="openOCR()">'+I.spark+' Numériser</button>':''))+
  '<div class="page view">'+
    '<div class="split"><div class="card tablecard">'+
      '<div class="table-head">'+I.doc+'<h3>Dossiers numériques ('+DB.documents.length+')</h3><div class="spacer"></div>'+
        '<div class="field">'+I.search+'<label for="dSearch" class="sr-only">Recherche</label>'+
        '<input id="dSearch" type="search" placeholder="Type, nom, matricule…" oninput="fillDoc()"></div>'+
        '<div class="field"><label for="dType">Type</label><select id="dType" onchange="fillDoc()"><option value="">Tous</option>'+
        [...new Set(DB.documents.map(d=>d.type).filter(Boolean))].map(t=>'<option>'+esc(t)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="dServ">Service</label><select id="dServ" onchange="fillDoc()"><option value="">Tous</option>'+
        SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Mat.</th><th>Employée</th><th>Type</th><th>Date</th><th>Source</th><th></th></tr></thead>'+
      '<tbody id="docBody"></tbody></table></div></div>'+
      '<div><div class="card chartcard" style="margin-bottom:16px"><h3>Lecture automatique (OCR + IA)</h3>'+
        '<div class="csub" style="margin-top:6px">Scannez un certificat, contrat, CIN ou diplôme : l’IA lit, identifie le type, extrait le nom et les dates, classe le document.</div>'+
        (can('import')?'<button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px" onclick="openOCR()">'+I.up+' Importer une image / PDF</button>':'')+
        '<div class="hint" style="margin-top:10px">Le document est transmis au service d’IA d’Anthropic pour analyse. '+
        'Pour un certificat médical, cela constitue un transfert de <b>donnée de santé</b> : informez le personnel et tracez ce traitement.</div></div>'+
        '<div class="card chartcard"><h3>Répartition des documents</h3><div class="csub">Par type</div>'+
        '<div class="chart-wrap sm" id="cDocs"></div></div></div></div></div>';
  fillDoc();
  const t={};DB.documents.forEach(d=>{const k=d.type||'Autre';t[k]=(t[k]||0)+1});
  dessinerBarres('cDocs',Object.keys(t).map(k=>({l:k,v:t[k]})),true);
};
function fillDoc(){
  const q=((($('#dSearch')||{}).value)||'').toLowerCase(),ty=(($('#dType')||{}).value)||'',sv=(($('#dServ')||{}).value)||'';
  const rows=DB.documents.filter(d=>{const e=emp(d.id);
    return ((empName(d.id)+' '+(d.type||'')+' '+matOf(e)).toLowerCase().includes(q))
      &&(!ty||d.type===ty)&&(!sv||e.service===sv)});
  const tb=$('#docBody');if(!tb)return;
  tb.innerHTML=rows.map(d=>'<tr><td class="mono">'+esc(matOf(emp(d.id)))+'</td><td>'+empCell(d.id,true)+'</td>'+
    '<td><b>'+esc(d.type||'')+'</b><small style="display:block;color:var(--muted);font-size:11px">'+esc(d.resume||'')+'</small></td>'+
    '<td class="mono">'+fmtDate(d.date)+'</td>'+
    '<td><span class="tag '+(d.source==='IA'?'t-leave':'t-neutral')+'">'+(d.source==='IA'?'Lu par IA':'Manuel')+'</span></td>'+
    '<td><button class="linkish" onclick="openProfile(\''+escJs(d.id)+'\')">Dossier →</button></td></tr>').join('')
    ||'<tr><td colspan="6"><div class="empty">Aucun document</div></td></tr>';
}
window.fillDoc=fillDoc;

/* ============================================================================
   ASSISTANT IA
   ============================================================================ */
const SUG=['Qui est en retard aujourd’hui ?','Combien d’heures supplémentaires ce mois ?',
  'Quelles journées sont à vérifier ?','Qui a plus de 10 ans d’ancienneté ?','Anniversaires du mois ?'];
VUES.assistant = async function(main){
  main.innerHTML=topbar('Intelligence RH','Assistant IA')+'<div class="page view">'+
    '<div class="suggest">'+SUG.map(s=>'<button onclick="askAI(this.textContent)">'+esc(s)+'</button>').join('')+'</div>'+
    '<div class="ai-wrap"><div class="ai-stream" id="aiStream" role="log" aria-live="polite">'+
      (aiHistory.length?aiHistory.map(renderMsg).join('')
       :'<div class="ai-msg bot"><div class="b-av">'+I.spark+'</div><div class="ai-bubble">'+
         '<p><strong>Assistant RH DBS Fashion.</strong></p><p>Posez une question sur le personnel : présences, heures, retards, paie, ancienneté. Je réponds à partir de la base.</p></div></div>')+
    '</div>'+
    '<div class="ai-input"><label for="aiInput" class="sr-only">Votre question</label>'+
      '<textarea id="aiInput" rows="1" placeholder="Votre question…" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();askAI()}" oninput="this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'"></textarea>'+
      '<button class="btn btn-gold" onclick="askAI()" style="height:42px" aria-label="Envoyer">'+I.send+'</button></div></div></div>';
  const s=$('#aiStream');s.scrollTop=s.scrollHeight;
};
function renderMsg(msg){
  return '<div class="ai-msg '+(msg.role==='user'?'user':'bot')+'"><div class="b-av">'+
    (msg.role==='user'?esc(initials(ME.nom)):I.spark)+'</div><div class="ai-bubble">'+formatMD(msg.content)+'</div></div>';
}
function formatMD(t){
  return esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/^- (.+)$/gm,'<li>$1</li>').replace(/(<li>[\s\S]*<\/li>)/,'<ul>$1</ul>')
    .split(/\n\n+/).map(p=>p.startsWith('<ul>')?p:'<p>'+p.replace(/\n/g,'<br>')+'</p>').join('');
}
function aiContext(){
  const [a,b]=monthBounds(TODAY.slice(0,7));const sum=summarize(a,b);
  const reg=regimeFor(TODAY);
  const E=sum.slice(0,220).map(s=>{const e=s.e;
    return matOf(e)+' | '+(e.prenom||'')+' '+(e.nom||'')+' | '+(e.poste||'')+' | '+(e.categorie||'')+
      ' | '+(e.service||'')+'/'+(e.atelier||'')+(e.naissance?' | '+age(e.naissance)+'ans':'')+
      (e.embauche?' | anc '+anciennete(e.embauche).toFixed(1)+'ans':'')+' | '+(e.contrat||'')+
      ' | mois: '+s.jT+'j trav, '+fr2(hDec(s.hN+s.hS))+'h dont '+fr2(hDec(s.hS))+'h sup, '+
      s.rt+' retards, '+s.jA+' abs, '+s.jC+' congés'+(s.revue?', '+s.revue+' à vérifier':'')}).join('\n');
  const r=dayRec(TODAY)||{};
  const att=DB.employees.slice(0,220).map(e=>{const m=metrics(r[e.id],TODAY);
    return (e.prenom||'')+' '+(e.nom||'')+' ('+matOf(e)+'): '+C.statutLabel(m.statut,e.sexe)+
      ((r[e.id]&&r[e.id].entree)?' '+r[e.id].entree:'')}).join('\n');
  const f=ferieFor(TODAY);
  return 'DONNÉES RH — DBS Fashion (usine textile, Nabeul). Date : '+TODAY+'.\n'+
    'Régime du jour : '+(reg.actif===false?'jour de repos':(reg.debut+'→'+reg.fin+', pause '+(+reg.pause||0)+
      'min'+(reg.pauseDe?' ('+reg.pauseDe+'→'+reg.pauseA+')':'')+', tolérance '+(+reg.tol||0)+
      'min, délai H.sup '+(+reg.grace||0)+'min'))+(f?' — JOUR FÉRIÉ : '+f.nom:'')+'.\n'+
    mentionRegime()+'\nOuvriers payés en heures, cadres en jours.\n\n'+
    'EFFECTIF (synthèse du mois en cours) :\n'+E+'\n\nPOINTAGE DU JOUR :\n'+att;
}
async function askAI(preset){
  const input=$('#aiInput');const q=preset||(input?input.value.trim():'');if(!q)return;
  if(input){input.value='';input.style.height='auto'}
  aiHistory.push({role:'user',content:q});
  const s=$('#aiStream');
  s.insertAdjacentHTML('beforeend',renderMsg({role:'user',content:q}));
  s.insertAdjacentHTML('beforeend','<div class="ai-msg bot" id="aiPending"><div class="b-av">'+I.spark+
    '</div><div class="ai-bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>');
  s.scrollTop=s.scrollHeight;
  try{
    const sys='Tu es l’assistant RH de DBS Fashion. Réponds en français, concis et factuel, uniquement '+
      'à partir des données fournies. Si l’information manque, dis-le. Gras (**) pour les chiffres clés, listes (- ) si utile.\n\n'+aiContext();
    const d=await api('/api/ai',{method:'POST',body:{messages:aiHistory.slice(-6).map(m=>({role:m.role,content:m.content})),system:sys}});
    const el=$('#aiPending');if(el)el.remove();
    aiHistory.push({role:'assistant',content:d.text});
    s.insertAdjacentHTML('beforeend',renderMsg({role:'assistant',content:d.text}));
  }catch(err){
    const el=$('#aiPending');if(el)el.remove();
    const fb=localAnswer(q)+'\n\n_(Assistant IA indisponible : '+err.message+')_';
    aiHistory.push({role:'assistant',content:fb});
    s.insertAdjacentHTML('beforeend',renderMsg({role:'assistant',content:fb}));
  }
  s.scrollTop=s.scrollHeight;
}
function localAnswer(q){
  const l=q.toLowerCase(),r=dayRec(TODAY)||{};
  if(l.includes('retard')){const x=DB.employees.filter(e=>metrics(r[e.id],TODAY).statut==='late');
    return x.length?'**'+x.length+'** en retard aujourd’hui :\n'+x.map(e=>'- '+e.prenom+' '+e.nom+' ('+matOf(e)+') · '+((r[e.id]||{}).entree||'')).join('\n')
      :'Aucun retard aujourd’hui.'}
  if(l.includes('vérifier')||l.includes('verifier')){const n=aRevoirCount();
    return n?'**'+n+'** journée(s) à vérifier ce mois (pointage incomplet).':'Aucune journée à vérifier ce mois.'}
  if(l.includes('anniversaire')){const b=DB.employees.filter(e=>e.naissance&&new Date(e.naissance).getMonth()===today.getMonth());
    return b.length?'Anniversaires ce mois :\n'+b.map(e=>'- '+e.prenom+' '+e.nom).join('\n'):'Aucun ce mois.'}
  if(l.includes('ancienn')||l.includes('10 ans')){const n=DB.employees.filter(e=>anciennete(e.embauche)>=10);
    return '**'+n.length+'** salarié(s) ont plus de 10 ans :\n'+n.map(e=>'- '+e.prenom+' '+e.nom+' ('+ancLabel(e.embauche)+')').join('\n')}
  if(l.includes('sup')){const[a,b]=monthBounds(TODAY.slice(0,7));
    const t=summarize(a,b).reduce((s,x)=>s+x.hS,0);
    return 'Total des heures supplémentaires ce mois : **'+fr2(hDec(t))+' h**.'}
  return 'Je ne peux pas répondre hors ligne à cette question.';
}
Object.assign(window,{askAI,renderMsg,formatMD,aiContext,localAnswer});
}
