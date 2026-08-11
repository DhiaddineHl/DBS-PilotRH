/* ============================================================================
   PilotRH — interface RH · saisie & administration (3/3)
   Saisie rapide du pointage, correction sur une plage de dates, import,
   paramètres horaires (fériés, pause), notes de service, sondages, sécurité.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { pad, toMin, hDec, fr2, hLabel, esc, escJs } = C;

/* ============================================================================
   SAISIE RAPIDE
   L'ancienne feuille de pointage imposait de dérouler un menu et de taper deux
   heures pour chaque personne. Ici : un clic par salarié pour les cas courants,
   navigation au clavier, application en masse, et copie de la veille.
   ============================================================================ */
let SR_SEL = new Set();

async function openSaisieRapide(){
  if(!can('edit')){toast('Compte en lecture seule','warn');return}
  if(moisClos(PRES_DATE.slice(0,7))){toast('Mois clôturé','warn');return}
  SR_SEL=new Set();
  const rg=regimeFor(PRES_DATE), f=ferieFor(PRES_DATE);
  openModal('<div class="modal-head">'+I.clock+'<h3>Saisie rapide — '+esc(fmtJour(PRES_DATE))+'</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    (f?'<div class="banner banner-info">'+I.cal+'<div class="grow"><b>'+esc(f.nom)+'</b> — jour férié : les heures saisies comptent en heures supplémentaires.</div></div>':'')+
    '<div class="card" style="padding:12px 14px;margin-bottom:14px;background:var(--surface-2)">'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">'+
        '<div><label class="fldlab" for="srE">Entrée par défaut</label><input class="tinput" id="srE" type="time" value="'+esc(rg.debut||'07:30')+'"></div>'+
        '<div><label class="fldlab" for="srS">Sortie par défaut</label><input class="tinput" id="srS" type="time" value="'+esc(rg.fin||'16:30')+'"></div>'+
        '<div style="flex:1"></div>'+
        '<button class="btn btn-ghost" onclick="srCopierVeille()">'+I.refresh+' Copier la veille</button>'+
        '<button class="btn btn-ghost" onclick="srToutPresent()">'+I.check+' Tous présents</button>'+
      '</div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">'+
        '<span style="font-size:12px;color:var(--muted);font-weight:600">Sélection (<span id="srN">0</span>) :</span>'+
        '<button class="btn btn-ghost" onclick="srAppliquer(\'present\')">Présent</button>'+
        '<button class="btn btn-ghost" onclick="srAppliquer(\'absent\')">Absent</button>'+
        '<button class="btn btn-ghost" onclick="srAppliquer(\'leave\')">Congé</button>'+
        '<button class="btn btn-ghost" onclick="srAppliquer(\'mission\')">Mission</button>'+
        '<div style="flex:1"></div>'+
        '<button class="linkish" onclick="srSelTout(true)">Tout sélectionner</button>'+
        '<button class="linkish" onclick="srSelTout(false)">Aucun</button>'+
      '</div>'+
    '</div>'+
    '<div class="filterbar" style="margin-bottom:10px">'+
      '<div class="field">'+I.search+'<label for="srQ" class="sr-only">Recherche</label>'+
        '<input id="srQ" type="search" placeholder="Nom, matricule…" oninput="srFill()"></div>'+
      '<div class="field"><label for="srServ">Service</label><select id="srServ" onchange="srFill()"><option value="">Tous</option>'+
        SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="srAtel">Atelier</label><select id="srAtel" onchange="srFill()"><option value="">Tous</option>'+
        ATELIERS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="srReste">Afficher</label><select id="srReste" onchange="srFill()">'+
        '<option value="">Tous</option><option value="1">Non saisis seulement</option></select></div>'+
    '</div>'+
    '<div class="hint" style="margin-bottom:8px">Astuce clavier : <b>P</b> présent · <b>A</b> absent · <b>C</b> congé · <b>M</b> mission '+
      'quand le curseur est sur une ligne. <b>Entrée</b> passe à la ligne suivante.</div>'+
    '<div class="tblwrap"><table class="tbl" id="srTable"><thead><tr>'+
      '<th style="width:34px"><span class="sr-only">Sélection</span></th><th>Mat.</th><th>Employée</th>'+
      '<th>Statut</th><th>Entrée</th><th>Sortie</th><th>Heures</th></tr></thead>'+
      '<tbody id="srBody"></tbody></table></div>'+
  '</div>'+
  '<div class="modal-foot"><span style="margin-right:auto;font-size:12px;color:var(--muted)" id="srInfo"></span>'+
    '<button class="btn btn-ghost" onclick="closeModal()">Fermer</button>'+
    '<button class="btn btn-gold" onclick="srEnregistrer()">'+I.check+' Enregistrer la journée</button></div>','wide');
  srFill();
}
function srRows(){
  const q=((($('#srQ')||{}).value)||'').toLowerCase(),sv=(($('#srServ')||{}).value)||'',
        at=(($('#srAtel')||{}).value)||'',reste=(($('#srReste')||{}).value)||'';
  const rec=DB.pointages[PRES_DATE]||{};
  return DB.employees.filter(e=>e.actif!==false)
    .filter(e=>(!q||((e.prenom||'')+' '+(e.nom||'')+' '+matOf(e)).toLowerCase().includes(q))
      &&(!sv||e.service===sv)&&(!at||e.atelier===at)&&(!reste||!rec[e.id]))
    .sort((a,b)=>(a.nom||'').localeCompare(b.nom||'')||(a.prenom||'').localeCompare(b.prenom||''));
}
function srFill(){
  const rec=DB.pointages[PRES_DATE]||{};
  const rows=srRows();
  const opts=[['present','Présent'],['absent','Absent'],['leave','Congé'],['mission','Mission'],['autorisation','Autorisation']];
  const tb=$('#srBody');if(!tb)return;
  tb.innerHTML=rows.map(e=>{
    const r=rec[e.id]||null;
    const m=r?metrics(r,PRES_DATE):null;
    const st=r?r.statut:'';
    const showT=st==='present'||st==='autorisation';
    return '<tr data-id="'+esc(e.id)+'" onkeydown="srTouche(event,\''+escJs(e.id)+'\')">'+
      '<td><input type="checkbox" '+(SR_SEL.has(e.id)?'checked ':'')+'onchange="srCoche(\''+escJs(e.id)+'\',this.checked)" aria-label="Sélectionner '+esc(empName(e.id))+'"></td>'+
      '<td class="mono">'+esc(matOf(e))+'</td>'+
      '<td><b>'+esc((e.prenom||'')+' '+(e.nom||''))+'</b><small style="display:block;color:var(--muted);font-size:11px">'+
        esc((e.service||'')+' · '+(e.atelier||''))+'</small></td>'+
      '<td><select class="ssel" onchange="srStatut(\''+escJs(e.id)+'\',this.value)" aria-label="Statut de '+esc(empName(e.id))+'">'+
        '<option value=""'+(st?'':' selected')+'>— non saisi —</option>'+
        opts.map(o=>'<option value="'+o[0]+'"'+(st===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></td>'+
      '<td>'+(showT?'<input class="tinput" type="time" value="'+esc(entreeAff(r))+'" onchange="srHeure(\''+escJs(e.id)+'\',\'entree\',this.value)" aria-label="Entrée">':'<span style="color:var(--faint)">—</span>')+'</td>'+
      '<td>'+(showT?'<input class="tinput" type="time" value="'+esc(sortieAff(r))+'" onchange="srHeure(\''+escJs(e.id)+'\',\'sortie\',this.value)" aria-label="Sortie">':'<span style="color:var(--faint)">—</span>')+'</td>'+
      '<td>'+(m&&m.heures?'<b>'+hLabel(m.heures)+'</b>':(m&&m.hs?'<b style="color:var(--mission)">'+hLabel(m.hs)+' sup</b>':'—'))+
        (m&&m.revue?' <span class="tag t-late" title="'+esc(m.motifRevue)+'">⚠</span>':'')+'</td></tr>';
  }).join('')||'<tr><td colspan="7"><div class="empty">Aucun salarié</div></td></tr>';
  const n=$('#srN');if(n)n.textContent=SR_SEL.size;
  const saisis=DB.employees.filter(e=>e.actif!==false&&rec[e.id]).length;
  const tot=DB.employees.filter(e=>e.actif!==false).length;
  const info=$('#srInfo');if(info)info.textContent=saisis+' / '+tot+' salariés saisis';
}
function srRec(id){
  if(!DB.pointages[PRES_DATE])DB.pointages[PRES_DATE]={};
  if(!DB.pointages[PRES_DATE][id])DB.pointages[PRES_DATE][id]={statut:'absent',entree:'',sortie:''};
  return DB.pointages[PRES_DATE][id];
}
function srStatut(id,val){
  if(!val){delete (DB.pointages[PRES_DATE]||{})[id];srFill();return}
  const r=srRec(id);
  r.statut=val;r.manuel=1;r.src='manuel';
  if(val==='present'||val==='autorisation'){
    if(!r.entree)r.entree=($('#srE')||{}).value||regimeFor(PRES_DATE).debut||'07:30';
    if(!r.sortie)r.sortie=($('#srS')||{}).value||regimeFor(PRES_DATE).fin||'16:30';
  }else{r.entree='';r.sortie='';delete r.punches;delete r.hM;delete r.hsM}
  srFill();
}
function srHeure(id,champ,val){
  const r=srRec(id);
  if(r.punches){if(!r.entree)r.entree=r.punches[0]||'';if(!r.sortie)r.sortie=r.punches[r.punches.length-1]||'';delete r.punches}
  r[champ]=val;r.manuel=1;r.src='manuel';srFill();
}
function srCoche(id,on){if(on)SR_SEL.add(id);else SR_SEL.delete(id);const n=$('#srN');if(n)n.textContent=SR_SEL.size}
function srSelTout(on){SR_SEL=on?new Set(srRows().map(e=>e.id)):new Set();srFill()}
function srAppliquer(statut){
  if(!SR_SEL.size){toast('Sélectionnez d’abord des salariés','warn');return}
  SR_SEL.forEach(id=>srStatut(id,statut));
  toast(SR_SEL.size+' ligne(s) mises à jour — n’oubliez pas d’enregistrer');
}
function srToutPresent(){
  const e0=($('#srE')||{}).value||'07:30',s0=($('#srS')||{}).value||'16:30';
  srRows().forEach(e=>{const r=srRec(e.id);r.statut='present';r.entree=e0;r.sortie=s0;r.manuel=1;r.src='manuel'});
  srFill();toast('Tous les salariés affichés sont présents '+e0+' → '+s0);
}
async function srCopierVeille(){
  let ds=addDays(PRES_DATE,-1),k=0;
  while(k<10&&!dayRec(ds)){await ensureRange(ds,ds);if(dayRec(ds))break;ds=addDays(ds,-1);k++}
  const src=dayRec(ds);
  if(!src){toast('Aucune journée précédente trouvée à copier','warn');return}
  if(!confirm('Copier la journée du '+fmtDate(ds)+' sur le '+fmtDate(PRES_DATE)+' ?\n\nLes lignes déjà saisies seront remplacées.'))return;
  if(!DB.pointages[PRES_DATE])DB.pointages[PRES_DATE]={};
  let n=0;
  DB.employees.forEach(e=>{
    const r=src[e.id];if(!r)return;
    DB.pointages[PRES_DATE][e.id]={statut:r.statut,entree:r.entree||'',sortie:r.sortie||'',manuel:1,src:'manuel'};n++;
  });
  srFill();toast(n+' ligne(s) copiées du '+fmtDate(ds)+' — enregistrez pour valider');
}
function srTouche(ev,id){
  const k=(ev.key||'').toLowerCase();
  if(ev.target.tagName==='INPUT'&&ev.target.type==='time')return;
  if(k==='p'){srStatut(id,'present');ev.preventDefault()}
  else if(k==='a'){srStatut(id,'absent');ev.preventDefault()}
  else if(k==='c'){srStatut(id,'leave');ev.preventDefault()}
  else if(k==='m'){srStatut(id,'mission');ev.preventDefault()}
  else if(k==='enter'){
    const tr=ev.target.closest('tr'),next=tr&&tr.nextElementSibling;
    if(next){const s=next.querySelector('select');if(s)s.focus()}
    ev.preventDefault();
  }
}
async function srEnregistrer(){
  const rec=DB.pointages[PRES_DATE]||{};
  const n=Object.keys(rec).length;
  if(!n){toast('Rien à enregistrer','warn');return}
  if(await persistDay(PRES_DATE)){
    closeModal();await go('presences');
    toast(n+' pointage(s) enregistrés pour le '+fmtDate(PRES_DATE));
  }
}
Object.assign(window,{openSaisieRapide,srFill,srStatut,srHeure,srCoche,srSelTout,srAppliquer,
  srToutPresent,srCopierVeille,srTouche,srEnregistrer});

/* ============================================================================
   CORRECTION SUR UNE PLAGE DE DATES — pour UN salarié
   ============================================================================ */
let CO={id:'',du:'',au:'',sel:new Set()};

async function openCorrection(id,du,au){
  if(!can('edit')){toast('Compte en lecture seule','warn');return}
  const m=monthBounds(TODAY.slice(0,7));
  CO={id,du:du||m[0],au:au||TODAY,sel:new Set()};
  const e=emp(id);
  openModal('<div class="modal-head">'+I.gear+'<h3>Corriger le pointage — '+esc((e.prenom||'')+' '+(e.nom||''))+
    ' <span class="mono" style="font-size:13px;color:var(--muted)">#'+esc(matOf(e))+'</span></h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="range-bar" style="margin:0 0 12px">'+
      '<div class="field"><label for="coDu">Du</label><input type="date" id="coDu" value="'+CO.du+'" onchange="coRange()"></div>'+
      '<div class="field"><label for="coAu">Au</label><input type="date" id="coAu" value="'+CO.au+'" onchange="coRange()"></div>'+
      '<button class="btn btn-ghost" onclick="coMois(-1)">Mois précédent</button>'+
      '<button class="btn btn-ghost" onclick="coMois(0)">Mois en cours</button>'+
      '<div style="flex:1"></div>'+
      '<button class="linkish" onclick="coSel(\'tout\')">Tout</button>'+
      '<button class="linkish" onclick="coSel(\'ouvres\')">Jours ouvrés</button>'+
      '<button class="linkish" onclick="coSel(\'absents\')">Absences</button>'+
      '<button class="linkish" onclick="coSel(\'revue\')">À vérifier</button>'+
      '<button class="linkish" onclick="coSel(\'rien\')">Aucun</button>'+
    '</div>'+
    '<div class="card" style="padding:12px 14px;margin-bottom:14px;background:var(--surface-2)">'+
      '<div style="font-size:12px;color:var(--muted);font-weight:600;margin-bottom:9px">'+
        'Appliquer aux <span id="coN">0</span> jour(s) sélectionné(s) :</div>'+
      '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">'+
        '<div><label class="fldlab" for="coStatut">Statut</label><select class="ssel" id="coStatut">'+
          '<option value="present">Présent</option><option value="absent">Absent</option>'+
          '<option value="leave">Congé</option><option value="mission">Mission</option>'+
          '<option value="autorisation">Autorisation</option></select></div>'+
        '<div><label class="fldlab" for="coE">Entrée</label><input class="tinput" id="coE" type="time" value="'+esc(regimeFor(TODAY).debut||'07:30')+'"></div>'+
        '<div><label class="fldlab" for="coS">Sortie</label><input class="tinput" id="coS" type="time" value="'+esc(regimeFor(TODAY).fin||'16:30')+'"></div>'+
        '<div><label class="fldlab" for="coH">Heures (option.)</label><input class="tinput" id="coH" placeholder="ex. 8 ou 8h30" style="width:110px"></div>'+
        '<button class="btn btn-gold" onclick="coAppliquer()">'+I.check+' Appliquer à la sélection</button>'+
      '</div>'+
      '<div class="hint" style="margin-top:8px">Si vous renseignez « Heures », c’est cette valeur qui est retenue pour la paie, '+
      'et les heures supplémentaires calculées sont mises à zéro (saisissez-les séparément dans la colonne H. sup. si besoin).</div>'+
    '</div>'+
    '<div class="tblwrap"><table class="tbl"><thead><tr><th style="width:34px"><span class="sr-only">Sélection</span></th>'+
      '<th>Date</th><th>Jour</th><th>Statut</th><th>Entrée</th><th>Sortie</th><th>Heures</th><th>H. sup.</th><th>Retard</th><th></th></tr></thead>'+
      '<tbody id="coBody"></tbody></table></div>'+
  '</div>'+
  '<div class="modal-foot"><span style="margin-right:auto;font-size:12px;color:var(--muted)" id="coInfo"></span>'+
    '<button class="btn btn-ghost" onclick="closeModal();openProfile(\''+escJs(id)+'\')">Retour à la fiche</button>'+
    '<button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>','wide');
  await coFill();
}
async function coRange(){
  CO.du=$('#coDu').value;CO.au=$('#coAu').value;
  if(CO.au<CO.du){const t=CO.du;CO.du=CO.au;CO.au=t}
  CO.sel=new Set();await coFill();
}
async function coMois(delta){
  const d=new Date((delta?CO.du:TODAY)+'T12:00');
  if(delta)d.setMonth(d.getMonth()+delta);
  const [a,b]=monthBounds(d.getFullYear()+'-'+pad(d.getMonth()+1));
  CO.du=a;CO.au=(b>TODAY&&!delta)?TODAY:b;CO.sel=new Set();
  const i1=$('#coDu'),i2=$('#coAu');if(i1)i1.value=CO.du;if(i2)i2.value=CO.au;
  await coFill();
}
async function coFill(){
  const tb=$('#coBody');if(!tb)return;
  tb.innerHTML='<tr><td colspan="10"><div class="skel"></div></td></tr>';
  try{ await ensureRange(CO.du,CO.au); }catch(e){ tb.innerHTML='<tr><td colspan="10" style="color:var(--absent)">'+esc(e.message)+'</td></tr>';return }
  const e=emp(CO.id);
  const lignes=[];
  eachDay(CO.du,CO.au,ds=>lignes.push(ds));
  tb.innerHTML=lignes.map(ds=>{
    const rec=(DB.pointages[ds]||{})[CO.id]||null;
    const m=metrics(rec,ds);
    const clos=moisClos(ds.slice(0,7));
    const w=new Date(ds+'T12:00').getDay();
    const f=ferieFor(ds);
    const showT=rec&&(rec.statut==='present'||rec.statut==='autorisation');
    const cls=m.revue?' class="revue-row"':(f?' class="ferie-row"':'');
    return '<tr'+cls+'>'+
      '<td><input type="checkbox" '+(CO.sel.has(ds)?'checked ':'')+(clos?'disabled ':'')+
        'onchange="coCoche(\''+ds+'\',this.checked)" aria-label="Sélectionner le '+fmtDate(ds)+'"></td>'+
      '<td class="mono">'+fmtDate(ds)+'</td>'+
      '<td style="color:var(--muted);font-size:12px">'+DAYS_FR[w].slice(0,3)+
        (f?' <span class="tag t-ferie" title="'+esc(f.nom)+'">férié</span>':'')+
        (!estOuvre(ds)&&!f?' <span class="tag t-neutral">repos</span>':'')+
        (clos?' '+I.lock:'')+'</td>'+
      '<td>'+(rec?statutTag(m.statut,e.sexe):'<span style="color:var(--faint)">non créé</span>')+
        (m.revue?' <span class="tag t-late" title="'+esc(m.motifRevue)+'">⚠</span>':'')+
        (C.estProtege(rec)?' <span title="Journée protégée : les imports de la pointeuse ne l\'écraseront pas'+
          (rec.src==='conge'?' (congé validé)':'')+'" style="color:var(--gold-ink)">&#128274;</span>':'')+'</td>'+
      '<td>'+(showT&&!clos?'<input class="tinput" type="time" value="'+esc(entreeAff(rec))+'" onchange="coHeure(\''+ds+'\',\'entree\',this.value)" aria-label="Entrée">':(showT?esc(entreeAff(rec)):'—'))+'</td>'+
      '<td>'+(showT&&!clos?'<input class="tinput" type="time" value="'+esc(sortieAff(rec))+'" onchange="coHeure(\''+ds+'\',\'sortie\',this.value)" aria-label="Sortie">':(showT?esc(sortieAff(rec)):'—'))+'</td>'+
      '<td>'+(clos?(m.heures?hLabel(m.heures):'—'):'<input class="tinput'+(m.manuel?' manuel':'')+'" style="width:74px;text-align:center" value="'+
        (m.heures?fr2(hDec(m.heures)):'')+'" onchange="coHM(\''+ds+'\',\'hM\',this.value)" aria-label="Heures">')+'</td>'+
      '<td>'+(clos?(m.hs?hLabel(m.hs):'—'):'<input class="tinput'+(m.manuelHS?' manuel':'')+'" style="width:74px;text-align:center" value="'+
        (m.hs?fr2(hDec(m.hs)):'')+'" onchange="coHM(\''+ds+'\',\'hsM\',this.value)" aria-label="Heures supplémentaires">')+'</td>'+
      '<td>'+(m.retard?'<b style="color:var(--late)">+'+m.retard+'</b>':'—')+'</td>'+
      '<td>'+(C.estProtege(rec)&&!clos?'<button class="linkish" onclick="coDeprotege(\''+ds+'\')" title="Retirer la protection">déprotéger</button>':'')+'</td>'+
    '</tr>';
  }).join('');
  coMajInfo();
}
function coCoche(ds,on){if(on)CO.sel.add(ds);else CO.sel.delete(ds);coMajInfo()}
function coMajInfo(){
  const n=$('#coN');if(n)n.textContent=CO.sel.size;
  let jT=0,hN=0,hS=0,ret=0,abs=0,rev=0;
  eachDay(CO.du,CO.au,ds=>{
    const rec=(DB.pointages[ds]||{})[CO.id];if(!rec)return;
    const m=metrics(rec,ds);
    if(m.revue)rev++;
    if(m.statut==='absent')abs++;
    else if(!['leave','mission','ferie','repos'].includes(m.statut)){jT++;hN+=m.heures;hS+=m.hs;ret+=m.retard}
  });
  const i=$('#coInfo');
  if(i)i.textContent=jT+' j travaillés · '+fr2(hDec(ENGINE.arrondirTotal(hN)))+' h + '+
    fr2(hDec(ENGINE.arrondirTotal(hS)))+' h sup · '+ret+' min de retard · '+abs+' absence(s)'+
    (rev?' · '+rev+' à vérifier':'');
}
function coSel(quoi){
  CO.sel=new Set();
  eachDay(CO.du,CO.au,ds=>{
    if(moisClos(ds.slice(0,7)))return;
    const rec=(DB.pointages[ds]||{})[CO.id];
    const m=metrics(rec,ds);
    if(quoi==='tout')CO.sel.add(ds);
    else if(quoi==='ouvres'&&estOuvre(ds))CO.sel.add(ds);
    else if(quoi==='absents'&&m.statut==='absent')CO.sel.add(ds);
    else if(quoi==='revue'&&m.revue)CO.sel.add(ds);
  });
  coFill();
}
function _coRec(ds){
  if(!DB.pointages[ds])DB.pointages[ds]={};
  if(!DB.pointages[ds][CO.id])DB.pointages[ds][CO.id]={statut:'absent',entree:'',sortie:''};
  return DB.pointages[ds][CO.id];
}
async function coHeure(ds,champ,val){
  const r=_coRec(ds);
  if(r.punches){if(!r.entree)r.entree=r.punches[0]||'';if(!r.sortie)r.sortie=r.punches[r.punches.length-1]||'';delete r.punches}
  r[champ]=val;r.manuel=1;r.src='manuel';
  if(await persistPointage(ds,CO.id)){await coFill()}
}
async function coHM(ds,champ,val){
  const r=_coRec(ds);
  const v=String(val).trim().replace(',','.');
  if(v===''){delete r[champ]}
  else{
    let mins;
    if(v.indexOf('h')>=0){const p=v.split('h');mins=(parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0)}
    else if(v.indexOf(':')>=0)mins=toMin(v);
    else mins=Math.round(parseFloat(v)*60);
    if(mins==null||isNaN(mins)||mins<0||mins>1440){toast('Valeur non comprise (ex. 8, 8,5 ou 8h30)','warn');await coFill();return}
    r[champ]=mins;
    if(champ==='hM'&&r.statut==='absent')r.statut='present';
  }
  r.src='manuel';
  if(await persistPointage(ds,CO.id)){await coFill()}
}
async function coDeprotege(ds){
  const r=(DB.pointages[ds]||{})[CO.id];if(!r)return;
  if((r.hM!=null||r.hsM!=null)&&!confirm('Cette journée porte des heures saisies à la main.\n\n'+
    'Retirer la protection ET les heures saisies ? Le calcul repartira des badges de la pointeuse.')){
    delete r.manuel;
  }else{
    delete r.manuel;delete r.hM;delete r.hsM;
  }
  if(r.src==='conge')delete r.src;
  if(await persistPointage(ds,CO.id)){await coFill();toast('Journée déprotégée — le prochain import pourra la remplacer')}
}
async function coAppliquer(){
  if(!CO.sel.size){toast('Sélectionnez d’abord des jours','warn');return}
  const statut=$('#coStatut').value;
  const e0=$('#coE').value,s0=$('#coS').value;
  const hTxt=String($('#coH').value||'').trim().replace(',','.');
  let hM=null;
  if(hTxt){
    let mins;
    if(hTxt.indexOf('h')>=0){const p=hTxt.split('h');mins=(parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0)}
    else mins=Math.round(parseFloat(hTxt)*60);
    if(isNaN(mins)||mins<0||mins>1440){toast('Heures non comprises','warn');return}
    hM=mins;
  }
  const jours=[...CO.sel].sort();
  const feries=jours.filter(ds=>!estOuvre(ds));
  if(!confirm('Appliquer « '+({present:'Présent',absent:'Absent',leave:'Congé',mission:'Mission',autorisation:'Autorisation'}[statut])+
    ' » à '+jours.length+' jour(s) pour '+empName(CO.id)+' ?\n\n'+
    (statut==='present'||statut==='autorisation'?'Horaire : '+e0+' → '+s0+'\n':'')+
    (hM!=null?'Heures forcées : '+fr2(hDec(hM))+' h\n':'')+
    (feries.length?'\n'+feries.length+' jour(s) sélectionné(s) sont fériés ou de repos : les heures y seront comptées en heures supplémentaires.\n':'')+
    '\nCes journées seront marquées « saisie manuelle » et protégées des imports de la pointeuse.'))return;
  const recs=jours.map(ds=>{
    const base={date:ds,id:CO.id,statut,manuel:1,src:'manuel',punches:null,hsM:null};
    if(statut==='present'||statut==='autorisation'){base.entree=e0;base.sortie=s0}
    else{base.entree='';base.sortie=''}
    base.hM=hM;
    return base;
  });
  if(!await persistBulk(recs,'Correction sur plage · '+empName(CO.id)+' · '+jours.length+' jours','manuel'))return;
  jours.forEach((ds,i)=>{
    if(!DB.pointages[ds])DB.pointages[ds]={};
    const r={statut,entree:recs[i].entree||'',sortie:recs[i].sortie||'',manuel:1,src:'manuel'};
    if(hM!=null)r.hM=hM;
    DB.pointages[ds][CO.id]=r;
  });
  CO.sel=new Set();
  await coFill();
  toast(jours.length+' journée(s) corrigées');
}
Object.assign(window,{openCorrection,coRange,coMois,coFill,coCoche,coSel,coHeure,coHM,coDeprotege,coAppliquer});

/* ============================================================================
   IMPORT DU POINTAGE
   Le bouton « Simuler un import » et le détournement des .xlsx vers des données
   FABRIQUÉES ont été supprimés : un fichier Excel déposé écrasait la vraie
   journée par des valeurs générées, avec un message qui ressemblait à un succès.
   ============================================================================ */
function openImport(){
  if(!can('import')){toast('Réservé aux RH','warn');return}
  openModal('<div class="modal-head">'+I.cloud+'<h3>Importer le pointage</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="dropzone" id="dz" ondragover="event.preventDefault();this.classList.add(\'drag\')" '+
      'ondragleave="this.classList.remove(\'drag\')" ondrop="dropFile(event)">'+
      '<div class="dz-ic">'+I.cloud+'</div><h3>Glissez le fichier d’export</h3>'+
      '<p><b>.mdb</b> (base ZKTeco — lue directement par le serveur) · ou <b>.csv</b> / <b>.txt</b></p>'+
      '<input type="file" id="fileInput" accept=".csv,.txt,.mdb" style="display:none" onchange="handleFile(this.files[0])">'+
      '<button class="btn btn-primary" onclick="document.getElementById(\'fileInput\').click()">'+I.up+' Choisir un fichier</button>'+
    '</div>'+
    '<div style="margin-top:16px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:12.5px;color:var(--muted)">'+
      '<b style="color:var(--text)">Format CSV attendu</b> — une ligne par pointage :'+
      '<code class="mono" style="display:block;margin-top:6px;color:var(--text)">Matricule ; Nom ; Date ; Entrée ; Sortie</code>'+
      '<div style="margin-top:8px">Rapprochement par matricule puis par nom. Les lignes non rapprochées sont listées à la fin de l’import.</div>'+
      '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">'+
        '<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">'+
          '<input type="checkbox" id="impAbs" style="margin-top:3px">'+
          '<span>Marquer <b>absents</b> les salariés qui n’apparaissent pas dans le fichier'+
          '<br><small>Décoché (recommandé) : un fichier partiel — un seul atelier par exemple — n’efface pas le reste de la journée.</small></span>'+
        '</label>'+
        '<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin-top:8px">'+
          '<input type="checkbox" id="impForce" style="margin-top:3px">'+
          '<span>Écraser aussi les <b>corrections manuelles</b>'+
          '<br><small>Décoché (recommandé) : les journées corrigées à la main et les congés validés sont préservés.</small></span>'+
        '</label>'+
      '</div>'+
    '</div>'+
    '<div id="impRes"></div>'+
  '</div>');
}
function dropFile(e){e.preventDefault();$('#dz').classList.remove('drag');if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0])}
function normName(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim()}
function findEmp(matricule,nom){
  const mat=String(matricule||'').trim();
  if(mat){
    const e=DB.employees.find(x=>matOf(x)===mat||x.id===mat);
    if(e)return e;
  }
  const n=normName(nom);
  if(!n)return null;
  return DB.employees.find(x=>normName((x.prenom||'')+' '+(x.nom||''))===n||normName((x.nom||'')+' '+(x.prenom||''))===n)||null;
}
function normDate(s){
  if(!s)return '';s=String(s).trim();
  let m=s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+pad(+m[2])+'-'+pad(+m[3]);
  m=s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);if(m)return m[3]+'-'+pad(+m[2])+'-'+pad(+m[1]);
  return '';
}
function normTime(s){const m=String(s||'').match(/(\d{1,2}):(\d{2})/);return m?pad(+m[1])+':'+m[2]:''}

function handleFile(f){
  if(!f)return;
  const nom=f.name.toLowerCase();
  if(nom.endsWith('.mdb')){importMdb(f);return}
  if(nom.endsWith('.xlsx')||nom.endsWith('.xls')){
    toast('Les fichiers Excel ne sont pas lus directement. Enregistrez-le en CSV (point-virgule) depuis Excel, ou envoyez le .mdb de la pointeuse.','warn',9000);
    return;
  }
  const forcer=(($('#impForce')||{}).checked)||false;
  const marquerAbs=(($('#impAbs')||{}).checked)||false;
  const r=new FileReader();
  r.onerror=()=>toast('Lecture du fichier impossible','err');
  r.onload=async ev=>{
    const lignes=String(ev.target.result||'').split(/\r?\n/).filter(l=>l.trim());
    let ok=0,late=0,sansSortie=0,protegees=0,clos=0;
    const nonRapprochees=[],datesInvalides=[];
    const touched=new Set();
    const recs=[];
    lignes.forEach((l,idx)=>{
      if(idx===0&&/matricule|cin|nom|badge/i.test(l)&&!/\d{1,2}:\d{2}/.test(l))return;   // en-tête
      const p=l.split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x=>String(x||'').trim().replace(/^"|"$/g,''));
      const e=findEmp(p[0],p[1]);
      if(!e){nonRapprochees.push({ligne:idx+1,mat:p[0]||'',nom:p[1]||''});return}
      const date=normDate(p[2]);
      if(!date){datesInvalides.push({ligne:idx+1,val:p[2]||''});return}   // plus de repli silencieux sur la journée affichée
      if(moisClos(date.slice(0,7))){clos++;return}
      const existant=(DB.pointages[date]||{})[e.id];
      if(!forcer&&existant&&(existant.manuel||existant.hM!=null||existant.hsM!=null||existant.src==='conge')){
        protegees++;return;                                    // corrections manuelles préservées
      }
      const entree=normTime(p[3]),sortie=normTime(p[4]);
      touched.add(date);
      if(!entree){recs.push({date,id:e.id,statut:'absent',entree:'',sortie:'',src:'import'});ok++;return}
      if(!sortie)sansSortie++;
      const rec={date,id:e.id,statut:'present',entree,sortie,src:'import'};
      recs.push(rec);ok++;
      if(metrics({statut:'present',entree,sortie},date).late)late++;
    });
    if(marquerAbs){
      touched.forEach(date=>{
        DB.employees.forEach(e=>{
          if(e.actif===false)return;
          if(recs.some(r2=>r2.date===date&&r2.id===e.id))return;
          const ex=(DB.pointages[date]||{})[e.id];
          if(!forcer&&ex&&(ex.manuel||ex.hM!=null||ex.hsM!=null||ex.src==='conge'))return;
          if(!estOuvre(date))return;
          recs.push({date,id:e.id,statut:'absent',entree:'',sortie:'',src:'import'});
        });
      });
    }
    if(!recs.length){
      afficherResultatImport({ok:0,nonRapprochees,datesInvalides,protegees,clos,jours:0,late,sansSortie});
      return;
    }
    if(!await persistBulk(recs,'Import CSV du pointage','import'))return;
    recs.forEach(r2=>{
      if(!DB.pointages[r2.date])DB.pointages[r2.date]={};
      DB.pointages[r2.date][r2.id]={statut:r2.statut,entree:r2.entree,sortie:r2.sortie,src:'import'};
    });
    const ds=[...touched].sort();
    if(ds.length)PRES_DATE=ds[ds.length-1];
    afficherResultatImport({ok,nonRapprochees,datesInvalides,protegees,clos,jours:touched.size,late,sansSortie});
  };
  r.readAsText(f,'UTF-8');
}
function afficherResultatImport(r){
  const box=$('#impRes');
  const html='<div class="banner '+(r.ok?'banner-info':'banner-warn')+'" style="margin-top:16px">'+
    (r.ok?I.check:I.warn)+'<div class="grow"><b>'+r.ok+' pointage(s) importés</b> sur '+r.jours+' jour(s).'+
    (r.late?' · '+r.late+' retard(s)':'')+
    (r.sansSortie?' · <b style="color:var(--absent)">'+r.sansSortie+' sans heure de sortie</b> (à vérifier)':'')+
    (r.protegees?' · '+r.protegees+' journée(s) protégée(s) non modifiée(s)':'')+
    (r.clos?' · '+r.clos+' ligne(s) ignorée(s) (mois clôturé)':'')+'</div></div>'+
    ((r.nonRapprochees.length||r.datesInvalides.length)
      ? '<div class="card" style="padding:12px 14px;margin-top:10px;max-height:220px;overflow:auto">'+
        (r.nonRapprochees.length?'<b style="color:var(--absent);font-size:13px">'+r.nonRapprochees.length+
          ' ligne(s) non rapprochée(s)</b><div class="hint">Aucun salarié ne correspond à ce matricule ni à ce nom. '+
          'Vérifiez le matricule dans la fiche du salarié.</div><ul style="margin:8px 0 0 18px;font-size:12px;color:var(--muted)">'+
          r.nonRapprochees.slice(0,40).map(x=>'<li>ligne '+x.ligne+' : matricule « '+esc(x.mat)+' », nom « '+esc(x.nom)+' »</li>').join('')+
          (r.nonRapprochees.length>40?'<li>…</li>':'')+'</ul>':'')+
        (r.datesInvalides.length?'<b style="color:var(--absent);font-size:13px;display:block;margin-top:10px">'+
          r.datesInvalides.length+' date(s) illisible(s)</b><div class="hint">Ces lignes ont été ignorées '+
          '(auparavant elles étaient rattachées, à tort, à la journée affichée).</div>'+
          '<ul style="margin:8px 0 0 18px;font-size:12px;color:var(--muted)">'+
          r.datesInvalides.slice(0,20).map(x=>'<li>ligne '+x.ligne+' : « '+esc(x.val)+' »</li>').join('')+'</ul>':'')+
        '</div>'
      : '')+
    '<div style="margin-top:12px;text-align:right"><button class="btn btn-gold" onclick="closeModal();recharger()">Terminer</button></div>';
  if(box)box.innerHTML=html;else{toast(r.ok+' pointages importés');recharger()}
}
async function importMdb(f){
  toast('Lecture de la base Access (.mdb) sur le serveur…');
  const fd=new FormData();fd.append('file',f);
  try{
    const d=await api('/api/import-mdb',{method:'POST',body:fd});
    closeModal();await charger();await rendre();
    toast('Base .mdb importée — '+d.employees+' salariés, '+d.jours+' jours','ok',6000);
  }catch(e){toast('Import .mdb impossible : '+e.message,'err',9000)}
}
Object.assign(window,{openImport,dropFile,handleFile,importMdb,findEmp,normDate,normTime,afficherResultatImport});

/* ============================================================================
   OCR / documents
   ============================================================================ */
function openOCR(){
  openModal('<div class="modal-head">'+I.spark+'<h3>Numériser & analyser</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body" id="ocrBody"><div class="dropzone" id="ocrDz" '+
    'ondragover="event.preventDefault();this.classList.add(\'drag\')" ondragleave="this.classList.remove(\'drag\')" ondrop="ocrDrop(event)">'+
    '<div class="dz-ic">'+I.doc+'</div><h3>Déposez une photo ou un PDF</h3><p>Certificat · contrat · CIN · diplôme</p>'+
    '<input type="file" id="ocrInput" accept="image/*,.pdf" style="display:none" onchange="if(this.files[0])runOCR(this.files[0])">'+
    '<button class="btn btn-primary" onclick="document.getElementById(\'ocrInput\').click()">'+I.up+' Choisir un fichier</button></div>'+
    '<div class="hint" style="margin-top:12px">Le document est envoyé au service d’IA pour lecture. Pour un certificat médical, '+
    'il s’agit d’une donnée de santé transmise à un sous-traitant : assurez-vous d’avoir informé le personnel.</div></div>','narrow');
}
function ocrDrop(e){e.preventDefault();$('#ocrDz').classList.remove('drag');if(e.dataTransfer.files[0])runOCR(e.dataTransfer.files[0])}
function parseJSON(t){
  let s=String(t||'').replace(/```json/g,'').replace(/```/g,'').trim();
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a>=0&&b>a)s=s.slice(a,b+1);
  return JSON.parse(s);
}
async function runOCR(file){
  $('#ocrBody').innerHTML='<div style="text-align:center;padding:30px 10px"><div class="dz-ic" style="margin:0 auto 16px;background:var(--gold-soft)">'+
    I.spark+'</div><h3 style="font-family:var(--display);font-size:18px">Analyse en cours…</h3>'+
    '<p style="color:var(--muted);margin:8px 0 18px">Lecture OCR · extraction des informations</p><div class="scan-anim"></div></div>';
  try{
    const fd=new FormData();fd.append('file',file);
    fd.append('names',DB.employees.map(e=>(e.prenom||'')+' '+(e.nom||'')).join(', '));
    const d=await api('/api/ocr',{method:'POST',body:fd});
    showOCR(parseJSON(d.text),true);
  }catch(err){
    $('#ocrBody').innerHTML='<div class="banner banner-warn">'+I.warn+'<div class="grow"><b>Lecture automatique indisponible</b><br>'+
      esc(err.message)+'</div></div><div class="hint" style="margin-top:10px">Vous pouvez classer le document manuellement depuis la fiche du salarié.</div>'+
      '<div style="margin-top:14px;text-align:right"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>';
  }
}
function showOCR(d,ok){
  const match=DB.employees.find(e=>((e.prenom||'')+' '+(e.nom||''))===d.employee_match)
    ||DB.employees.find(e=>d.nom&&normName((e.prenom||'')+' '+(e.nom||'')).includes(normName(String(d.nom).split(' ')[0])));
  window._ocr={d,matchId:match?match.id:''};
  const opts=DB.employees.slice().sort((a,b)=>(a.nom||'').localeCompare(b.nom||''))
    .map(e=>'<option value="'+esc(e.id)+'"'+(match&&match.id===e.id?' selected':'')+'>'+
      esc((e.nom||'')+' '+(e.prenom||'')+' — '+matOf(e))+'</option>').join('');
  $('#ocrBody').innerHTML=
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
      '<span class="tag '+(ok?'t-present':'t-late')+'">'+(ok?'Analyse réussie':'Analyse partielle')+'</span>'+
      '<span style="font-size:12px;color:var(--muted)">Informations extraites — vérifiez avant de classer</span></div>'+
    '<div class="ocr-line"><span>Type</span><b>'+esc(d.type||'—')+'</b></div>'+
    '<div class="ocr-line"><span>Nom détecté</span><b>'+esc(d.nom||'—')+'</b></div>'+
    (d.date_debut?'<div class="ocr-line"><span>Début</span><b>'+fmtDate(d.date_debut)+'</b></div>':'')+
    (d.date_fin?'<div class="ocr-line"><span>Fin</span><b>'+fmtDate(d.date_fin)+'</b></div>':'')+
    '<div class="ocr-line"><span>Résumé</span><b style="max-width:60%;text-align:right">'+esc(d.resume||'—')+'</b></div>'+
    '<div style="margin-top:14px"><label class="fldlab" for="ocrEmp">Rattacher au salarié</label>'+
      '<select class="fldin" id="ocrEmp">'+opts+'</select></div>'+
    (String(d.type||'').toLowerCase().includes('certificat')&&d.date_debut
      ? '<label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13px;cursor:pointer">'+
        '<input type="checkbox" id="ocrPointage" checked> Inscrire les jours en <b>congé maladie</b> dans le pointage</label>':'')+
    '<div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">'+
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>'+
      '<button class="btn btn-gold" onclick="confirmOCR()">'+I.check+' Classer</button></div>';
}
async function confirmOCR(){
  const o=window._ocr||{};const d=o.d||{};
  const id=$('#ocrEmp').value;
  if(!id){toast('Choisissez un salarié','warn');return}
  DB.documents.unshift({docId:'D'+Date.now().toString(36),id,type:d.type||'Document',
    date:d.date_debut||TODAY,resume:d.resume||'Document numérisé',source:'IA'});
  const estCert=String(d.type||'').toLowerCase().includes('certificat')&&d.date_debut;
  if(estCert){
    const fin=d.date_fin||d.date_debut;
    let j=0;eachDay(d.date_debut,fin,ds=>{if(estOuvre(ds))j++});
    DB.absences.unshift({id,type:'Maladie',debut:d.date_debut,fin,jours:j||1,
      statut:'justifiée',note:'Certificat lu par IA'});
    const cocher=($('#ocrPointage')||{}).checked;
    if(cocher){
      await ensureRange(d.date_debut,fin);
      const recs=[];
      eachDay(d.date_debut,fin,ds=>{
        if(!estOuvre(ds)||moisClos(ds.slice(0,7)))return;
        recs.push({date:ds,id,statut:'leave',entree:'',sortie:'',punches:null,hM:null,hsM:null,manuel:1,src:'conge'});
      });
      if(recs.length&&await persistBulk(recs,'Congé maladie (certificat) · '+empName(id),'conge')){
        recs.forEach(r=>{if(!DB.pointages[r.date])DB.pointages[r.date]={};
          DB.pointages[r.date][id]={statut:'leave',entree:'',sortie:'',manuel:1,src:'conge'}});
        toast('Certificat classé · '+recs.length+' journée(s) inscrites en congé');
      }
    }else toast('Certificat classé · absence justifiée ('+(j||1)+' j)');
  }else toast('Document classé · '+empName(id));
  await saveNow();closeModal();await go('documents');
}
Object.assign(window,{openOCR,ocrDrop,runOCR,showOCR,confirmOCR,parseJSON});

/* ============================================================================
   PARAMÈTRES HORAIRES — fériés, plage de pause, arrondi
   ============================================================================ */
function openSettings(){
  if(!can('settings')){toast('Réservé aux RH et à l’administrateur','warn');return}
  window._cfg=C.normalizeSettings(JSON.parse(JSON.stringify(S())));
  openModal('<div class="modal-head">'+I.gear+'<h3>Paramètres horaires</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
    '<div class="modal-body" id="setBody"></div>'+
    '<div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button>'+
    '<button class="btn btn-gold" onclick="saveSettings()">'+I.check+' Enregistrer & recalculer</button></div>','wide');
  renderSettings();
}
function regRow(r,d,scope){
  const dis=r.actif?'':' disabled';
  const c=(scope==null)?('cfgDay('+d+',') : ('cfgPerDay('+scope+','+d+',');
  return '<tr><td style="font-weight:600">'+DAYS_FR[d]+'</td>'+
    '<td><input type="checkbox"'+(r.actif?' checked':'')+' onchange="'+c+'\'actif\',this.checked)" aria-label="'+DAYS_FR[d]+' ouvré"></td>'+
    '<td><input class="tinput" type="time" value="'+esc(r.debut)+'"'+dis+' onchange="'+c+'\'debut\',this.value)" aria-label="Début"></td>'+
    '<td><input class="tinput" type="time" value="'+esc(r.fin)+'"'+dis+' onchange="'+c+'\'fin\',this.value)" aria-label="Fin"></td>'+
    '<td><input class="tinput" style="width:60px" type="number" min="0" max="240" value="'+(+r.pause||0)+'"'+dis+' onchange="'+c+'\'pause\',+this.value)" aria-label="Pause en minutes"></td>'+
    '<td><input class="tinput" type="time" value="'+esc(r.pauseDe||'')+'"'+dis+' onchange="'+c+'\'pauseDe\',this.value)" aria-label="Pause de">'+
      (r.pauseAuto?'<div style="font-size:9.5px;color:var(--late)">déduit</div>':'')+'</td>'+
    '<td><input class="tinput" type="time" value="'+esc(r.pauseA||'')+'"'+dis+' onchange="'+c+'\'pauseA\',this.value)" aria-label="Pause à"></td>'+
    '<td><input class="tinput" style="width:56px" type="number" min="0" max="120" value="'+(+r.tol||0)+'"'+dis+' onchange="'+c+'\'tol\',+this.value)" aria-label="Tolérance"></td>'+
    '<td><input class="tinput" style="width:56px" type="number" min="0" max="120" value="'+(+r.grace||0)+'"'+dis+' onchange="'+c+'\'grace\',+this.value)" aria-label="Délai heures sup."></td></tr>';
}
const TETE_JOURS='<thead><tr><th>Jour</th><th>Ouvré</th><th>Début</th><th>Fin</th><th>Pause<br>(min)</th>'+
  '<th>Pause<br>de</th><th>Pause<br>à</th><th>Tol.<br>(min)</th><th>Délai<br>H.sup</th></tr></thead>';
function renderSettings(){
  const c=window._cfg;
  const baseRows=[1,2,3,4,5,6,0].map(d=>regRow(c.jours[d],d,null)).join('');
  const per=c.periodes.map((p,i)=>'<div class="card" style="padding:12px 14px;margin-bottom:12px;background:var(--surface-2)">'+
    '<div style="display:flex;gap:9px;align-items:center;margin-bottom:10px;flex-wrap:wrap">'+
      '<input class="tinput" style="width:200px;font-family:var(--sans);font-weight:600" value="'+esc(p.nom||'')+'" onchange="cfgPer('+i+',\'nom\',this.value)" aria-label="Nom du mode">'+
      '<span style="font-size:12px;color:var(--muted)">du</span><input class="tinput" type="date" value="'+esc(p.du||'')+'" onchange="cfgPer('+i+',\'du\',this.value)" aria-label="Début">'+
      '<span style="font-size:12px;color:var(--muted)">au</span><input class="tinput" type="date" value="'+esc(p.au||'')+'" onchange="cfgPer('+i+',\'au\',this.value)" aria-label="Fin">'+
      '<button class="linkish danger" style="margin-left:auto" onclick="delPeriode('+i+')">Supprimer</button></div>'+
    (!p.du||!p.au?'<div class="hint" style="color:var(--absent)">Ce mode n’a pas de dates valides : il ne sera pas appliqué.</div>':'')+
    '<div class="tblwrap"><table class="tbl" style="font-size:12px">'+TETE_JOURS+'<tbody>'+
      [1,2,3,4,5,6,0].map(d=>regRow(p.jours[d],d,i)).join('')+'</tbody></table></div></div>').join('');

  $('#setBody').innerHTML=
    '<h4 class="info-block" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:0 0 8px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px">Calcul</h4>'+
    '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">'+
      '<div><label class="fldlab" for="cfMode">Mode heures supplémentaires</label>'+
        '<select class="ssel" id="cfMode" onchange="cfgSet(\'modeHS\',this.value)">'+
        '<option value="seuil"'+(c.modeHS==='seuil'?' selected':'')+'>À partir de l’heure de fin + délai</option>'+
        '<option value="fin"'+(c.modeHS==='fin'?' selected':'')+'>Bloc depuis l’heure de fin</option></select></div>'+
      '<div><label class="fldlab" for="cfAr">Arrondi</label>'+
        '<select class="ssel" id="cfAr" onchange="cfgSet(\'arrondi\',+this.value)">'+
        [0,5,15,30].map(v=>'<option value="'+v+'"'+(+c.arrondi===v?' selected':'')+'>'+(v?v+' minutes':'Aucun')+'</option>').join('')+'</select></div>'+
      '<div><label class="fldlab" for="cfArS">Sens</label>'+
        '<select class="ssel" id="cfArS"'+(+c.arrondi?'':' disabled')+' onchange="cfgSet(\'arrondiSens\',this.value)">'+
        '<option value="proche"'+(c.arrondiSens==='proche'?' selected':'')+'>au plus proche</option>'+
        '<option value="inferieur"'+(c.arrondiSens==='inferieur'?' selected':'')+'>à l’inférieur</option></select></div>'+
      '<div><label class="fldlab" for="cfArP">Appliqué sur</label>'+
        '<select class="ssel" id="cfArP"'+(+c.arrondi?'':' disabled')+' onchange="cfgSet(\'arrondiPortee\',this.value)">'+
        '<option value="jour"'+(c.arrondiPortee!=='periode'?' selected':'')+'>chaque journée</option>'+
        '<option value="periode"'+(c.arrondiPortee==='periode'?' selected':'')+'>le cumul de la période</option></select></div>'+
    '</div>'+
    '<div class="hint" style="margin-bottom:14px">Avec l’arrondi <b>sur chaque journée</b>, chaque jour affiché est un nombre rond '+
      'et la somme des journées est exactement égale au total du mois : une ouvrière peut additionner ses journées et retrouver '+
      'son bulletin. C’est le réglage par défaut.</div>'+

    '<h4 class="info-block" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:18px 0 8px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px">Rémunération — taux par défaut</h4>'+
    '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">'+
      '<div><label class="fldlab" for="cfTxH">Prix d’une heure (TND)</label>'+
        '<input class="tinput" style="width:120px" type="number" step="0.001" min="0" id="cfTxH" value="'+(+c.tauxHoraireDefaut||0)+
        '" onchange="cfgSet(\'tauxHoraireDefaut\',+this.value)"></div>'+
      '<div><label class="fldlab" for="cfTxJ">Prix d’une journée (TND)</label>'+
        '<input class="tinput" style="width:120px" type="number" step="0.001" min="0" id="cfTxJ" value="'+(+c.tauxJourDefaut||0)+
        '" onchange="cfgSet(\'tauxJourDefaut\',+this.value)"></div>'+
    '</div>'+
    '<div class="hint" style="margin-bottom:14px">Ces deux taux servent de <b>repli</b> : ils s’appliquent aux fiches qui n’ont pas de taux propre. '+
      'Le mode (à l’heure ou à la journée) et le taux se saisissent fiche par fiche — ouvrières payées à l’heure suivant la convention, '+
      'cadres à la journée travaillée. Vous pouvez aussi les remplir en masse par le modèle d’import des fiches.</div>'+

    '<h4 class="info-block" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:18px 0 8px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px">Jours fériés</h4>'+
    '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:10px;cursor:pointer">'+
      '<input type="checkbox"'+(c.feriesActifs!==false?' checked':'')+' onchange="cfgSet(\'feriesActifs\',this.checked)">'+
      '<span>Tenir compte des jours fériés <small style="color:var(--muted)">— un jour férié sans pointage n’est plus compté comme une absence, et les heures pointées y sont comptées en heures supplémentaires</small></span></label>'+
    '<div style="font-size:12px;color:var(--muted);font-weight:600;margin:10px 0 4px">Fêtes à date fixe (chaque année)</div>'+
    '<div class="ferie-list">'+c.feriesFixes.map((f,i)=>'<span class="ferie-item'+(f.off?' off':'')+'">'+
      esc(f.md)+' · '+esc(f.nom)+
      '<button onclick="cfgFerieFixe('+i+')" title="'+(f.off?'Réactiver':'Désactiver')+'" aria-label="'+(f.off?'Réactiver':'Désactiver')+'">'+
      (f.off?I.plus:I.x)+'</button></span>').join('')+'</div>'+
    '<div style="font-size:12px;color:var(--muted);font-weight:600;margin:14px 0 4px">Fêtes religieuses et jours exceptionnels'+
      ' <small style="font-weight:400">(à saisir chaque année : Aïd El Fitr, Aïd El Idha, Mouled, Ras El Am El Hejri…)</small></div>'+
    '<div class="ferie-list">'+(c.feries.length?c.feries.map((f,i)=>'<span class="ferie-item">'+
      esc(f.date)+(+f.jours>1?' (+'+(+f.jours-1)+'j)':'')+' · '+esc(f.nom||'')+
      '<button onclick="delFerie('+i+')" aria-label="Supprimer">'+I.x+'</button></span>').join('')
      :'<span style="font-size:12.5px;color:var(--muted)">Aucun jour saisi</span>')+'</div>'+
    '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">'+
      '<div><label class="fldlab" for="nfDate">Date</label><input class="tinput" type="date" id="nfDate"></div>'+
      '<div><label class="fldlab" for="nfNom">Intitulé</label><input class="tinput" style="width:200px;font-family:var(--sans)" id="nfNom" placeholder="Aïd El Fitr"></div>'+
      '<div><label class="fldlab" for="nfJ">Nb de jours</label><input class="tinput" style="width:70px" type="number" id="nfJ" min="1" max="10" value="1"></div>'+
      '<button class="btn btn-ghost" onclick="addFerie()">'+I.plus+' Ajouter</button>'+
    '</div>'+

    '<h4 class="info-block" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:20px 0 8px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px">Congés — période & calcul du dû (espace salarié)</h4>'+
    '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">'+
      '<div><label class="fldlab" for="cgDu">Période — du</label><input class="tinput" type="date" id="cgDu" value="'+esc(c.congesDu||'')+'" onchange="cfgSet(\'congesDu\',this.value)"></div>'+
      '<div><label class="fldlab" for="cgAu">au</label><input class="tinput" type="date" id="cgAu" value="'+esc(c.congesAu||'')+'" onchange="cfgSet(\'congesAu\',this.value)"></div>'+
      '<div><label class="fldlab" for="cgCo">Coefficient (heures dues = heures travaillées × coef.)</label>'+
        '<input class="tinput" style="width:110px" type="number" step="0.0001" id="cgCo" value="'+(+c.congesCoef||0)+'" onchange="cfgSet(\'congesCoef\',+this.value)"></div>'+
    '</div>'+
    '<div class="hint" style="margin-bottom:14px">Chaque salarié voit dans son espace personnel son cumul d’heures travaillées sur cette période '+
      'et le nombre d’heures de congé dues. Laissez les dates vides pour le calcul automatique (15 août → 14 août).</div>'+

    '<h4 class="info-block" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:20px 0 8px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px">Semaine de référence</h4>'+
    '<div class="tblwrap"><table class="tbl" style="font-size:12.5px">'+TETE_JOURS+'<tbody>'+baseRows+'</tbody></table></div>'+
    '<div class="hint" style="margin-top:8px">La <b>plage de pause</b> détermine quand la pause est déduite. '+
      'Sans elle, une autorisation de sortie de 07:55 à 11:00 se voyait retirer 30 minutes de déjeuner jamais prises. '+
      'Les plages marquées « déduit » ont été estimées automatiquement — corrigez-les avec vos horaires réels.</div>'+

    '<div style="display:flex;align-items:center;margin:20px 0 10px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px;flex-wrap:wrap;gap:8px">'+
      '<h4 style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:0">Modes personnalisés (Ramadan, été…)</h4>'+
      '<div style="flex:1"></div>'+
      '<button class="btn btn-ghost" style="padding:4px 11px;font-size:12px" onclick="addRamadan()">'+I.plus+' Ramadan</button>'+
      '<button class="btn btn-ghost" style="padding:4px 11px;font-size:12px" onclick="addPeriode()">'+I.plus+' Créer un mode</button></div>'+
    (per||'<div style="color:var(--muted);font-size:12.5px;padding:4px 0">Aucun mode personnalisé — la semaine de référence s’applique toute l’année.</div>')+

    '<h4 class="info-block" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-ink);margin:20px 0 8px;border-bottom:1px dashed var(--gold-line);padding-bottom:6px">Mois clôturés</h4>'+
    '<div class="ferie-list">'+((c.clotures||[]).length?c.clotures.map(ym=>'<span class="ferie-item">'+I.lock+' '+esc(ym)+'</span>').join('')
      :'<span style="font-size:12.5px;color:var(--muted)">Aucun mois clôturé — les rapports passés restent modifiables et recalculés à chaque changement de paramètre.</span>')+'</div>'+
    '<div class="hint" style="margin-top:8px">La clôture se fait depuis l’écran <b>Rapports & paie</b>. '+
      'Sans clôture, modifier un paramètre ici change rétroactivement des heures déjà payées.</div>';
}
function cfgDay(d,f,v){window._cfg.jours[d][f]=v;if(f==='actif'||f==='pause')renderSettings()}
function cfgSet(f,v){window._cfg[f]=v;if(['arrondi','feriesActifs'].includes(f))renderSettings()}
function cfgPer(i,f,v){window._cfg.periodes[i][f]=v;if(f==='du'||f==='au')renderSettings()}
function cfgPerDay(i,d,f,v){window._cfg.periodes[i].jours[d][f]=v;if(f==='actif'||f==='pause')renderSettings()}
function cfgFerieFixe(i){const f=window._cfg.feriesFixes[i];f.off=!f.off;renderSettings()}
function addFerie(){
  const d=$('#nfDate').value,n=$('#nfNom').value.trim(),j=+$('#nfJ').value||1;
  if(!d){toast('Choisissez une date','warn');return}
  if(!n){toast('Donnez un intitulé','warn');return}
  window._cfg.feries.push({date:d,nom:n,jours:Math.max(1,Math.min(10,j))});
  window._cfg.feries.sort((a,b)=>a.date<b.date?-1:1);
  renderSettings();
}
function delFerie(i){window._cfg.feries.splice(i,1);renderSettings()}
function addPeriode(){
  const j={};[1,2,3,4,5,6].forEach(d=>j[d]={actif:true,debut:'07:00',fin:'14:00',pause:0,tol:15,grace:15,pauseDe:'',pauseA:''});
  j[0]={actif:false};
  window._cfg.periodes.push({nom:'Nouveau mode',du:TODAY,au:TODAY,jours:C.normalizeSettings({jours:j}).jours});
  renderSettings();
}
function addRamadan(){
  const j={};[1,2,3,4,5].forEach(d=>j[d]={actif:true,debut:'07:00',fin:'15:00',pause:0,tol:15,grace:15,pauseDe:'',pauseA:''});
  j[6]={actif:true,debut:'07:00',fin:'13:00',pause:0,tol:15,grace:15,pauseDe:'',pauseA:''};
  j[0]={actif:false};
  window._cfg.periodes.push({nom:'Ramadan',du:TODAY,au:TODAY,jours:C.normalizeSettings({jours:j}).jours});
  renderSettings();toast('Mode Ramadan ajouté — ajustez les dates');
}
function delPeriode(i){window._cfg.periodes.splice(i,1);renderSettings()}
async function saveSettings(){
  const cfg=window._cfg;
  const mauvaises=cfg.periodes.filter(p=>!p.du||!p.au);
  if(mauvaises.length&&!confirm(mauvaises.length+' mode(s) personnalisé(s) n’ont pas de dates valides et ne seront pas appliqués.\n\nEnregistrer quand même ?'))return;
  cfg.feriesFixes=cfg.feriesFixes.filter(f=>!f.off).concat(cfg.feriesFixes.filter(f=>f.off));
  const clos=(cfg.clotures||[]).length;
  if(!clos&&!confirm('Enregistrer les paramètres ?\n\nAucun mois n’est clôturé : ce changement recalcule aussi les heures des mois passés, y compris ceux déjà payés.\n\nContinuer ?'))return;
  DB.settings=cfg;
  ENGINE.invalidate();
  if(await saveNow()){closeModal();await rendre();toast('Paramètres enregistrés · valeurs recalculées')}
}
Object.assign(window,{openSettings,renderSettings,cfgDay,cfgSet,cfgPer,cfgPerDay,cfgFerieFixe,
  addFerie,delFerie,addPeriode,addRamadan,delPeriode,saveSettings,normName});

/* ============================================================================
   SÉCURITÉ & ACCÈS
   ============================================================================ */
VUES.parametres = async function(main){
  main.innerHTML=topbar('Administration','Sécurité & accès',
    (can('settings')?'<button class="btn btn-ghost" onclick="openSettings()">'+I.gear+' Paramètres horaires</button>':''))+
  '<div class="page view"><div class="split"><div>'+
    usersCard()+
    '<div class="card tablecard" style="margin-bottom:16px"><div class="table-head">'+I.bell+
      '<h3>Signalements des salariés</h3><div class="spacer"></div>'+
      '<span style="font-size:12px;color:var(--muted)">Remontés depuis l’espace QR</span></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Salarié</th><th>Jour signalé</th><th>Message</th><th></th></tr></thead>'+
      '<tbody id="sigBody"></tbody></table></div></div>'+
    '<div class="card tablecard"><div class="table-head">'+I.clock+'<h3>Journal des modifications</h3>'+
      '<div class="spacer"></div><button class="linkish" onclick="loadAudit(200)">Voir plus</button></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Auteur</th><th>Rôle</th><th>Action</th><th>Horodatage</th></tr></thead>'+
      '<tbody id="auditBody"><tr><td colspan="4"><div class="skel"></div></td></tr></tbody></table></div></div></div>'+
  '<div>'+
    '<div class="card chartcard" style="margin-bottom:16px"><h3>Espace salarié · QR codes</h3>'+
      '<div class="csub" style="margin-top:6px">Chaque salarié consulte son pointage du mois en scannant son QR puis en saisissant son code personnel. Lecture seule.</div>'+
      (can('import')?'<button class="btn btn-gold" style="width:100%;justify-content:center;margin-top:12px" onclick="window.open(\'/api/qr-codes.pdf\',\'_blank\',\'noopener\')">'+
        I.download+' Cartes QR (sans les codes)</button>'+
      '<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px" onclick="if(confirm(\'Ce PDF contient les codes personnels en clair. À imprimer et remettre en main propre, séparément des cartes. Continuer ?\'))window.open(\'/api/qr-codes.pdf?codes=1\',\'_blank\',\'noopener\')">'+
        I.lock+' Liste des codes (confidentiel)</button>':'')+
      '<div class="hint" style="margin-top:10px">Les codes ne sont plus imprimés sur la carte : QR et code sur le même support, '+
      'ce n’est pas un second facteur — une photo de la carte suffisait. Adresse de l’espace : <span class="mono">'+esc(location.origin)+'/moi</span></div></div>'+
    '<div class="card chartcard" style="margin-bottom:16px"><h3>Notes de service & sondages</h3>'+
      '<div class="csub" style="margin-top:6px">Diffusez une note à tout le personnel ou à un service, et posez une question à choix multiples. '+
      'Chaque salarié les voit dans son espace QR ; vous suivez les lectures et les réponses.</div>'+
      (can('edit')?'<button class="btn btn-gold" style="width:100%;justify-content:center;margin-top:12px" onclick="openComs()">'+
        I.send+' Ouvrir la messagerie</button>':'')+'</div>'+
    '<div class="card chartcard" style="margin-bottom:16px"><h3>Sauvegardes</h3>'+
      '<div class="csub" style="margin-top:6px" id="bkInfo">Chargement…</div>'+
      '<div style="display:flex;gap:10px;margin-top:12px">'+
        '<button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="backupNow()">'+I.shield+' Sauvegarder maintenant</button></div>'+
      '<div style="display:flex;gap:10px;margin-top:8px">'+
        '<button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="exportDB()">'+I.download+' Exporter (JSON)</button>'+
        '<button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="document.getElementById(\'impDB\').click()">'+I.up+' Restaurer un fichier</button>'+
        '<input type="file" id="impDB" accept=".json" style="display:none" onchange="importDB(this.files[0])"></div>'+
      '<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px" onclick="recharger()">'+I.refresh+' Recharger depuis le serveur</button>'+
      '<div class="hint" style="margin-top:10px">La sauvegarde automatique quotidienne est réellement active côté serveur '+
      '(elle était seulement annoncée dans l’interface). L’export JSON ne contient plus ni comptes ni clés. '+
      'La restauration accepte les sauvegardes des versions précédentes, <b>pointages compris</b> : '+
      'l’ancienne version les ignorait en silence et l’historique était perdu.</div></div>'+
    '<div class="card chartcard"><h3>Assistant IA</h3>'+
      '<div class="csub" style="margin-top:6px">La clé Anthropic est configurée côté serveur, dans la variable d’environnement '+
      '<span class="mono">ANTHROPIC_API_KEY</span>. Elle ne transite jamais par le navigateur.</div>'+
      '<div class="hint" style="margin-top:10px">Le champ de saisie de clé a été retiré : il stockait une clé secrète en clair dans le navigateur sans jamais la relire.</div></div>'+
  '</div></div></div>';
  loadAudit();loadUsers();loadSignalements();loadBackups();
};
function usersCard(){
  if(!can('users'))return '<div class="card tablecard" style="margin-bottom:16px"><div class="table-head">'+I.shield+
    '<h3>Votre accès</h3></div><div style="padding:14px 18px;color:var(--muted);font-size:13px">Connecté en tant que <b>'+
    esc(ME.nom)+'</b> — rôle <b>'+esc(ROLE_LABELS[ME.role]||ME.role)+
    '</b>. La gestion des comptes est réservée à l’administrateur.</div></div>';
  return '<div class="card tablecard" style="margin-bottom:16px"><div class="table-head">'+I.users+'<h3>Comptes & rôles</h3></div>'+
    '<div class="tblwrap"><table class="tbl"><thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th></th></tr></thead>'+
    '<tbody id="usersBody"><tr><td colspan="4"><div class="skel"></div></td></tr></tbody></table></div>'+
    '<div style="border-top:1px dashed var(--line);margin:12px 18px 0;padding:12px 0 18px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        '<div><label class="fldlab" for="u_login">Identifiant</label><input id="u_login" class="fldin"></div>'+
        '<div><label class="fldlab" for="u_nom">Nom affiché</label><input id="u_nom" class="fldin"></div>'+
        '<div><label class="fldlab" for="u_role">Rôle</label><select id="u_role" class="fldin">'+
          Object.keys(ROLE_LABELS).map(r=>'<option value="'+r+'">'+esc(ROLE_LABELS[r])+'</option>').join('')+'</select></div>'+
        '<div><label class="fldlab" for="u_pass">Mot de passe</label><input id="u_pass" type="password" class="fldin" autocomplete="new-password"></div>'+
      '</div>'+
      '<button class="btn btn-primary" style="margin-top:10px" onclick="saveUser()">'+I.check+' Ajouter / modifier</button>'+
      '<div class="hint" style="margin-top:8px">Administrateur (tout) · RH (tout sauf comptes) · Chef d’atelier (présences, sans paramètres ni suppression) · '+
      'Lecture seule (consultation). 8 caractères minimum pour le mot de passe.</div></div></div>';
}
async function loadAudit(limit){
  try{
    const rows=await api('/api/audit?limit='+(limit||60));
    const tb=document.getElementById('auditBody');if(!tb)return;
    tb.innerHTML=rows.map(a=>'<tr><td><b>'+esc(a.qui)+'</b></td>'+
      '<td style="color:var(--muted);font-size:12px">'+esc(ROLE_LABELS[a.role]||a.role||'')+'</td>'+
      '<td style="color:var(--muted)">'+esc(a.action)+'</td>'+
      '<td class="mono" style="font-size:12px">'+esc(String(a.ts||'').replace('T',' '))+'</td></tr>').join('')
      ||'<tr><td colspan="4"><div class="empty">Aucune entrée</div></td></tr>';
  }catch(e){
    const tb=document.getElementById('auditBody');
    if(tb)tb.innerHTML='<tr><td colspan="4"><div class="empty">'+esc(e.message)+'</div></td></tr>';
  }
}
function loadSignalements(){
  const tb=document.getElementById('sigBody');if(!tb)return;
  const sig=(DB.signalements||[]).slice().reverse();
  tb.innerHTML=sig.slice(0,40).map((s,i)=>'<tr'+(s.traite?'':' class="revue-row"')+'>'+
    '<td class="mono" style="font-size:12px">'+esc(String(s.ts||'').replace('T',' ').slice(0,16))+'</td>'+
    '<td>'+esc(s.nom||'')+'</td><td class="mono">'+(s.date?fmtDate(s.date):'—')+'</td>'+
    '<td style="color:var(--muted)">'+esc(s.message||'')+'</td>'+
    '<td>'+(s.traite?'<span class="tag t-present">traité</span>'
      :'<button class="linkish" onclick="traiterSignalement('+(sig.length-1-i)+')">Marquer traité</button>'+
       (s.date&&s.emp?' · <button class="linkish" onclick="closeModal();openCorrection(\''+escJs(s.emp)+'\',\''+esc(s.date)+'\',\''+esc(s.date)+'\')">Corriger</button>':''))+'</td></tr>').join('')
    ||'<tr><td colspan="5"><div class="empty">Aucun signalement</div></td></tr>';
}
async function traiterSignalement(i){
  const s=(DB.signalements||[])[i];if(!s)return;
  s.traite=true;
  if(await ecrireMeta({signalements:DB.signalements})){loadSignalements();majSidebar();toast('Signalement marqué traité')}
}
async function ecrireMeta(obj){
  try{ await api('/api/state-meta',{method:'POST',body:obj}); return true }
  catch(e){ toast('Enregistrement impossible : '+e.message,'err'); return false }
}
async function loadBackups(){
  const el=document.getElementById('bkInfo');if(!el)return;
  try{
    const d=await api('/api/backups');
    const last=d.sauvegardes[0];
    el.innerHTML=d.sauvegardes.length
      ? '<b>'+d.sauvegardes.length+' sauvegarde(s)</b> conservées (max '+d.conserve+'). Dernière : '+
        esc(String(last.date).replace('T',' '))+' — '+(last.taille/1e6).toFixed(1)+' Mo.'
      : 'Aucune sauvegarde encore écrite. La première est créée au démarrage du serveur.';
  }catch(e){el.textContent='État des sauvegardes indisponible : '+e.message}
}
async function backupNow(){
  toast('Sauvegarde en cours…');
  try{const d=await api('/api/backup/now',{method:'POST',body:{}});toast('Sauvegarde écrite : '+d.fichier);loadBackups()}
  catch(e){toast('Sauvegarde impossible : '+e.message,'err')}
}
function loadUsers(){
  if(!can('users'))return;
  api('/api/users').then(us=>{
    const b=document.getElementById('usersBody');if(!b)return;
    b.innerHTML=us.map(u=>'<tr><td class="mono">'+esc(u.login)+'</td><td>'+esc(u.nom||'')+'</td>'+
      '<td>'+esc(ROLE_LABELS[u.role]||u.role)+'</td><td style="text-align:right">'+
      '<button class="linkish" onclick="editUser(\''+escJs(u.login)+'\',\''+escJs(u.nom||'')+'\',\''+escJs(u.role)+'\')">Modifier</button>'+
      (String(u.login).toLowerCase()==='admin'?''
        :' · <button class="linkish danger" onclick="delUser(\''+escJs(u.login)+'\')">Supprimer</button>')+'</td></tr>').join('')
      ||'<tr><td colspan="4"><div class="empty">Aucun compte</div></td></tr>';
  }).catch(e=>{
    const b=document.getElementById('usersBody');
    if(b)b.innerHTML='<tr><td colspan="4"><div class="empty">'+esc(e.message)+'</div></td></tr>';
  });
}
function editUser(login,nom,role){
  $('#u_login').value=login;$('#u_nom').value=nom;$('#u_role').value=role;
  $('#u_pass').value='';$('#u_pass').placeholder='Nouveau mot de passe (vide = inchangé)';
  $('#u_login').focus();
}
async function saveUser(){
  const login=$('#u_login').value.trim(),nom=$('#u_nom').value.trim(),
        role=$('#u_role').value,password=$('#u_pass').value;
  if(!login){toast('Identifiant requis','warn');return}
  try{
    await api('/api/users',{method:'POST',body:{login,nom,role,password}});
    toast('Compte enregistré');
    $('#u_login').value='';$('#u_nom').value='';$('#u_pass').value='';
    loadUsers();
  }catch(e){toast(e.message,'warn')}
}
async function delUser(login){
  if(!confirm('Supprimer le compte « '+login+' » ?'))return;
  try{await api('/api/users/delete',{method:'POST',body:{login}});toast('Compte supprimé');loadUsers()}
  catch(e){toast(e.message,'warn')}
}
function exportDB(){
  const clean={employees:DB.employees,settings:DB.settings,documents:DB.documents,
    conges:DB.conges,absences:DB.absences,signalements:DB.signalements,
    _export:{date:TODAY,par:ME.login,note:'Sauvegarde PilotRH — sans comptes ni clés. Les pointages sont dans les sauvegardes serveur.'}};
  const blob=new Blob([JSON.stringify(clean,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=u;a.download='pilotrh_donnees_'+TODAY+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(u),4000);
  toast('Données exportées (hors pointages et hors comptes)');
}
function importDB(f){
  if(!f)return;
  const r=new FileReader();
  r.onerror=()=>toast('Lecture du fichier impossible','err');
  r.onload=async e=>{
    let d;
    try{d=JSON.parse(e.target.result)}catch(x){toast('Fichier JSON invalide','warn');return}
    if(!d||!Array.isArray(d.employees)){toast('Ce fichier ne contient pas de liste d’employés valide','warn');return}

    /* Les sauvegardes produites par les versions précédentes contiennent AUSSI les
       pointages. L'ancienne restauration les ignorait en silence : on restaurait les
       fiches et on perdait tout l'historique. */
    const pts=d.pointages||{};
    const jours=Object.keys(pts).sort();
    let nbRec=0; jours.forEach(j=>{nbRec+=Object.keys(pts[j]||{}).length});

    let msg='Restaurer depuis ce fichier ?\n\n'+
      '· '+d.employees.length+' fiche(s) salarié\n'+
      '· réglages horaires'+(d.settings?'':' (absents du fichier)')+'\n'+
      '· '+(d.documents||[]).length+' document(s), '+(d.conges||[]).length+' congé(s), '+(d.absences||[]).length+' absence(s)\n';
    if(nbRec) msg+='· '+nbRec.toLocaleString('fr-FR')+' pointages sur '+jours.length+' journées ('+jours[0]+' → '+jours[jours.length-1]+')\n';
    else msg+='· AUCUN pointage dans ce fichier\n';
    msg+='\nLes fiches, réglages, documents, congés et absences actuels seront remplacés.';
    if(nbRec) msg+='\nLes pointages seront ajoutés ou mis à jour journée par journée (les journées absentes du fichier sont conservées).';
    if(d._secret||d.users) msg+='\n\nCe fichier contient aussi des comptes et/ou une clé de session : ils seront IGNORÉS (le serveur ne les accepte plus depuis un import).';
    if(!confirm(msg))return;

    const btn=document.getElementById('impDB');
    try{
      toast('Restauration des fiches et réglages…');
      await api('/api/state-meta',{method:'POST',body:{employees:d.employees,settings:d.settings,
        documents:d.documents||[],conges:d.conges||[],absences:d.absences||[],
        signalements:d.signalements||[],exclus:d.exclus||[]}});

      if(nbRec){
        /* envoi par lots : un seul appel de 10 Mo échouerait sur beaucoup
           d'hébergements, et on ne saurait pas où ça s'est arrêté */
        const LOT=4000;
        let recs=[],faits=0,ignores=0;
        const envoyer=async()=>{
          if(!recs.length)return;
          const r2=await api('/api/pointages/bulk',{method:'POST',
            body:{recs:recs,motif:'Restauration depuis une sauvegarde',src:'restauration'}});
          faits+=(r2&&r2.ecrits)||recs.length;
          recs=[];
          toast('Restauration des pointages… '+faits.toLocaleString('fr-FR')+' / '+nbRec.toLocaleString('fr-FR'));
        };
        for(const j of jours){
          if(moisClos(j.slice(0,7))){ignores+=Object.keys(pts[j]||{}).length;continue}
          for(const id in pts[j]){
            const o=pts[j][id]||{};
            recs.push({date:j,id:id,statut:o.statut||'absent',entree:o.entree||'',sortie:o.sortie||'',
              punches:o.punches||null,hM:(o.hM!=null?o.hM:null),hsM:(o.hsM!=null?o.hsM:null),
              manuel:(o.manuel?1:null),src:o.src||'restauration'});
            if(recs.length>=LOT) await envoyer();
          }
        }
        await envoyer();
        toast(faits.toLocaleString('fr-FR')+' pointages restaurés'+
          (ignores?' · '+ignores+' ignorés (mois clôturés)':''),'ok',8000);
      }
      await charger();await rendre();
      toast('Restauration terminée','ok',6000);
    }catch(x){
      toast('Restauration interrompue : '+x.message+' — relancez-la, les journées déjà écrites ne seront pas perdues.','err',12000);
    }
    if(btn)btn.value='';
  };
  r.readAsText(f);
}
Object.assign(window,{usersCard,loadAudit,loadUsers,loadSignalements,traiterSignalement,ecrireMeta,
  loadBackups,backupNow,editUser,saveUser,delUser,exportDB,importDB});

/* ============================================================================
   IMPORT EN MASSE DES FICHES DU PERSONNEL
   Saisir 97 fiches à la main dans l'interface prend des heures. On télécharge un
   classeur Excel (vierge ou prérempli avec les fiches actuelles), on le remplit,
   on le renvoie : l'application montre d'abord un aperçu ligne par ligne et
   n'écrit qu'après validation.
   ============================================================================ */
let _RAP_FICHES=null;
function openImportFiches(){
  if(!can('import')){toast('Réservé aux RH','warn');return}
  _RAP_FICHES=null;
  openModal('<div class="modal-head">'+I.users+'<h3>Importer des fiches du personnel</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="info-block" style="background:var(--surface-2)"><h4>1 · Prenez le modèle</h4>'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">'+
        '<button class="btn btn-ghost" onclick="telechargerModele(0)">'+
          I.download+' Modèle vierge</button>'+
        '<button class="btn btn-gold" onclick="telechargerModele(1)">'+
          I.download+' Mes '+DB.employees.length+' fiches actuelles</button>'+
      '</div>'+
      '<div class="hint" style="margin-top:10px">Le second bouton est le plus pratique : le classeur arrive <b>déjà rempli</b> '+
      'avec vos fiches. Vous complétez les colonnes manquantes (mode de paie, prix de l’heure ou de la journée, CNSS, dates…) '+
      'directement dans Excel, puis vous renvoyez le fichier. Les colonnes ont des listes déroulantes et un onglet <b>Notice</b> '+
      'explique chaque champ.</div></div>'+
    '<div class="info-block" style="background:var(--surface-2);margin-top:12px"><h4>2 · Renvoyez le fichier rempli</h4>'+
      '<div class="dropzone" style="margin-top:8px" ondragover="event.preventDefault();this.classList.add(\'drag\')" '+
        'ondragleave="this.classList.remove(\'drag\')" ondrop="dropFiches(event)">'+
        '<div class="dz-ic">'+I.up+'</div><h3>Glissez le classeur rempli</h3>'+
        '<p><b>.xlsx</b> (Excel) ou <b>.csv</b></p>'+
        '<input type="file" id="fichesIn" accept=".xlsx,.csv,.txt" style="display:none" onchange="lireFiches(this.files[0])">'+
        '<button class="btn btn-primary" onclick="document.getElementById(\'fichesIn\').click()">'+I.up+' Choisir un fichier</button>'+
      '</div></div>'+
    '<div id="rapFiches" style="margin-top:14px"></div>'+
    '<div class="hint" style="margin-top:12px">Trois règles à retenir : le <b>matricule</b> est la clé (déjà connu → la fiche est '+
    'mise à jour, inconnu → elle est créée) · une cellule <b>vide ne change rien</b> (écrivez « - » pour effacer un champ) · '+
    'les <b>pointages, congés et accès QR ne sont jamais touchés</b> et aucune fiche n’est supprimée.</div>'+
  '</div>'+
  '<div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button>'+
    '<button class="btn btn-gold" id="btnAppFiches" disabled onclick="appliquerFiches()">'+I.check+' Appliquer</button></div>','wide');
}
/* Téléchargement par fetch plutôt que window.open : les erreurs du serveur
   (droits insuffisants, démonstration hors ligne) sont alors lisibles dans un
   message au lieu d'ouvrir un onglet blanc. */
async function telechargerModele(actuels){
  toast('Préparation du classeur…');
  try{
    const r=await fetch('/api/employees/modele.xlsx'+(actuels?'?actuels=1':''));
    if(!r.ok){
      let msg='erreur '+r.status;
      try{ msg=(JSON.parse(await r.text()).error)||msg }catch(e){}
      throw new Error(msg);
    }
    const blob=await r.blob();
    const u=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=u;a.download=actuels?'PilotRH_fiches_actuelles.xlsx':'PilotRH_modele_fiches.xlsx';
    a.click();setTimeout(()=>URL.revokeObjectURL(u),4000);
    toast('Classeur téléchargé — remplissez-le puis renvoyez-le ici');
  }catch(e){ toast('Téléchargement impossible : '+e.message,'err',9000) }
}
function dropFiches(ev){
  ev.preventDefault();ev.currentTarget.classList.remove('drag');
  const f=(ev.dataTransfer.files||[])[0];if(f)lireFiches(f);
}
async function envoyerFiches(f,appliquer){
  const fd=new FormData();fd.append('file',f);fd.append('appliquer',appliquer?'1':'0');
  return api('/api/employees/import-fiches',{method:'POST',body:fd});
}
let _FICHIER_FICHES=null;
async function lireFiches(f){
  if(!f)return;
  _FICHIER_FICHES=f;_RAP_FICHES=null;
  const box=$('#rapFiches');
  if(box)box.innerHTML='<div class="skel"></div><div class="skel" style="width:60%;margin-top:6px"></div>';
  const btn=$('#btnAppFiches');if(btn)btn.disabled=true;
  try{
    _RAP_FICHES=await envoyerFiches(f,false);
    afficherRapFiches(_RAP_FICHES);
  }catch(e){
    _RAP_FICHES=null;
    if(box)box.innerHTML='<div class="banner banner-err">'+I.warn+'<div class="grow">'+esc(e.message)+'</div></div>';
  }
}
const ACT_LBL={creation:'à créer',maj:'à mettre à jour',inchange:'inchangée',erreur:'erreur'};
const ACT_TAG={creation:'t-present',maj:'t-late',inchange:'t-neutral',erreur:'t-absent'};
function afficherRapFiches(r){
  const box=$('#rapFiches');if(!box)return;
  const R=r.resume||{};
  const aEcrire=(R.creation||0)+(R.maj||0);
  const lignes=(r.lignes||[]).slice();
  /* les erreurs d'abord : ce sont elles qu'il faut corriger dans le classeur */
  lignes.sort((a,b)=>(a.action==='erreur'?0:1)-(b.action==='erreur'?0:1));
  box.innerHTML=
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">'+
      miniKpi('À créer',R.creation||0,'var(--present)')+
      miniKpi('À mettre à jour',R.maj||0,'var(--late)')+
      miniKpi('Inchangées',R.inchange||0,'var(--muted)')+
      miniKpi('Erreurs',R.erreur||0,'var(--absent)')+'</div>'+
    (R.erreur?'<div class="banner banner-warn">'+I.warn+'<div class="grow"><b>'+R.erreur+' ligne(s) en erreur</b> '+
      'seront ignorées. Corrigez-les dans le classeur et renvoyez-le si vous voulez aussi les intégrer.</div></div>':'')+
    ((r.inconnues||[]).length?'<div class="banner banner-info">'+I.warn+'<div class="grow">Colonne(s) non reconnue(s), '+
      'ignorée(s) : <b>'+esc(r.inconnues.join(', '))+'</b></div></div>':'')+
    (R.absents?'<div class="banner banner-info">'+I.check+'<div class="grow"><b>'+R.absents+' fiche(s) existante(s)</b> '+
      'ne figurent pas dans le fichier : elles sont laissées intactes, jamais supprimées.</div></div>':'')+
    '<div class="card tablecard"><div class="table-head">'+I.users+'<h3>Aperçu — rien n’est encore écrit</h3></div>'+
      '<div class="tblwrap" style="max-height:320px"><table class="tbl"><thead><tr><th>Ligne</th><th>Matricule</th>'+
      '<th>Nom</th><th>Action</th><th>Champs concernés</th></tr></thead><tbody>'+
      lignes.slice(0,300).map(l=>'<tr'+(l.action==='erreur'?' class="revue-row"':'')+'>'+
        '<td class="mono">'+l.n+'</td><td class="mono">'+esc(l.matricule||'—')+'</td>'+
        '<td>'+esc(l.nom||'—')+'</td>'+
        '<td><span class="tag '+ACT_TAG[l.action]+'">'+esc(ACT_LBL[l.action]||l.action)+'</span></td>'+
        '<td style="font-size:12px;color:var(--muted)">'+
          (l.erreurs&&l.erreurs.length?'<span style="color:var(--absent)">'+esc(l.erreurs.join(' · '))+'</span>'
            :esc((l.champs||[]).map(nomChamp).join(', ')||'—'))+
          ((l.avis&&l.avis.length)?'<br><span style="color:var(--late)">'+esc(l.avis.join(' · '))+'</span>':'')+
        '</td></tr>').join('')+
      '</tbody></table></div>'+
      ((r.lignes||[]).length>300?'<div class="hint" style="padding:8px 18px">'+((r.lignes.length-300))+' ligne(s) supplémentaire(s) non affichée(s) — elles seront bien traitées.</div>':'')+
    '</div>';
  const btn=$('#btnAppFiches');
  if(btn){btn.disabled=!aEcrire;
    btn.innerHTML=I.check+' Appliquer'+(aEcrire?' ('+aEcrire+' fiche'+(aEcrire>1?'s':'')+')':'')}
}
const NOMS_CHAMPS={matricule:'matricule',nom:'nom',prenom:'prénom',cin:'CIN',cnss:'CNSS',poste:'poste',
  categorie:'catégorie',service:'service',atelier:'atelier',contrat:'contrat',embauche:'embauche',
  naissance:'naissance',sexe:'sexe',famille:'situation',enfants:'enfants',niveau:'niveau',tel:'téléphone',
  email:'email',adresse:'adresse',responsable:'responsable',modePaie:'mode de paie',
  tauxHoraire:'prix de l’heure',tauxJour:'prix de la journée',salaire:'salaire mensuel'};
function nomChamp(k){return NOMS_CHAMPS[k]||k}
async function appliquerFiches(){
  if(!_RAP_FICHES||!_FICHIER_FICHES)return;
  const R=_RAP_FICHES.resume||{};
  const n=(R.creation||0)+(R.maj||0);
  if(!confirm('Appliquer l’import ?\n\n'+
    (R.creation||0)+' fiche(s) créée(s)\n'+
    (R.maj||0)+' fiche(s) mise(s) à jour\n'+
    (R.erreur?(R.erreur+' ligne(s) en erreur ignorée(s)\n'):'')+
    '\nAucun pointage n’est modifié, aucune fiche supprimée.'))return;
  const btn=$('#btnAppFiches');
  if(btn){btn.disabled=true;btn.innerHTML='Application…'}
  try{
    const r=await envoyerFiches(_FICHIER_FICHES,true);
    const a=r.applique||{};
    await charger();
    closeModal();
    await go('personnel');
    toast(a.crees+' fiche(s) créée(s) · '+a.majs+' mise(s) à jour','ok',8000);
  }catch(e){
    toast('Import refusé : '+e.message,'err',10000);
    if(btn){btn.disabled=false;btn.innerHTML=I.check+' Appliquer ('+n+')'}
  }
}
Object.assign(window,{openImportFiches,telechargerModele,dropFiches,lireFiches,afficherRapFiches,appliquerFiches,nomChamp});
}
