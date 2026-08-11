/* ============================================================================
   PilotRH — notes de service & sondages
   Chaque salarié possède déjà un accès personnel (QR + code) : on s'en sert pour
   diffuser des notes de service et poser des questions, avec accusé de lecture
   et résultats de vote.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { esc, escJs } = C;

let COMS = {notes:[], votes:[]};
let COMS_ONGLET = 'notes';

async function chargerComs(){
  try{ COMS = await api('/api/coms'); }
  catch(e){ COMS={notes:[],votes:[]}; toast('Messagerie indisponible : '+e.message,'warn'); }
}

async function openComs(){
  if(!can('edit')){toast('Réservé aux RH','warn');return}
  openModal('<div class="modal-head">'+I.send+'<h3>Notes de service & sondages</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
    '<div class="modal-body" id="comsBody"><div class="skel"></div></div>','wide');
  await chargerComs();
  renderComs();
}
function renderComs(){
  const b=document.getElementById('comsBody');if(!b)return;
  b.innerHTML=
    '<div class="seg" style="margin-bottom:16px">'+
      '<button class="'+(COMS_ONGLET==='notes'?'on':'')+'" onclick="comsOnglet(\'notes\')">Notes de service ('+COMS.notes.length+')</button>'+
      '<button class="'+(COMS_ONGLET==='votes'?'on':'')+'" onclick="comsOnglet(\'votes\')">Sondages ('+COMS.votes.length+')</button>'+
    '</div>'+(COMS_ONGLET==='notes'?vueNotes():vueVotes());
}
function comsOnglet(o){COMS_ONGLET=o;renderComs()}

/* -------------------------------------------------------------- ciblage commun */
function champsCible(prefixe){
  return '<div style="display:flex;gap:10px;flex-wrap:wrap">'+
    '<div><label class="fldlab" for="'+prefixe+'Serv">Service ciblé</label>'+
      '<select class="ssel" id="'+prefixe+'Serv"><option value="">Tout le personnel</option>'+
      SERVICES.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
    '<div><label class="fldlab" for="'+prefixe+'Atel">Atelier ciblé</label>'+
      '<select class="ssel" id="'+prefixe+'Atel"><option value="">Tous</option>'+
      ATELIERS.map(s=>'<option>'+esc(s)+'</option>').join('')+'</select></div>'+
    '<div><label class="fldlab" for="'+prefixe+'Cat">Catégorie</label>'+
      '<select class="ssel" id="'+prefixe+'Cat"><option value="">Toutes</option><option>Ouvrier</option><option>Cadre</option></select></div>'+
    '<div><label class="fldlab" for="'+prefixe+'Fin">Visible jusqu’au</label>'+
      '<input class="tinput" type="date" id="'+prefixe+'Fin" value="'+addDays(TODAY,30)+'"></div>'+
  '</div>';
}
function lireCible(prefixe){
  return {service:($('#'+prefixe+'Serv')||{}).value||'',
          atelier:($('#'+prefixe+'Atel')||{}).value||'',
          categorie:($('#'+prefixe+'Cat')||{}).value||'',
          fin:($('#'+prefixe+'Fin')||{}).value||''};
}
function nbCibles(c){
  return DB.employees.filter(e=>e.actif!==false
    &&(!c.service||e.service===c.service)
    &&(!c.atelier||e.atelier===c.atelier)
    &&(!c.categorie||e.categorie===c.categorie)).length;
}
function libelleCible(c){
  const p=[];
  if(c.service)p.push(c.service);
  if(c.atelier)p.push(c.atelier);
  if(c.categorie)p.push(c.categorie);
  return p.length?p.join(' · '):'tout le personnel';
}
window.nbCibles=nbCibles;

/* ------------------------------------------------------------ notes de service */
function vueNotes(){
  return '<div class="card" style="padding:14px 16px;margin-bottom:16px;background:var(--surface-2)">'+
    '<div style="font-weight:700;font-size:14px;margin-bottom:10px">Nouvelle note de service</div>'+
    '<div><label class="fldlab" for="nTitre">Titre</label>'+
      '<input class="fldin" id="nTitre" maxlength="120" placeholder="ex. Fermeture de l’atelier le vendredi 15"></div>'+
    '<div style="margin-top:10px"><label class="fldlab" for="nTexte">Message</label>'+
      '<textarea class="fldin" id="nTexte" rows="4" maxlength="3000" placeholder="Texte de la note, tel qu’il apparaîtra dans l’espace de chaque salarié."></textarea></div>'+
    '<div style="margin-top:10px">'+champsCible('n')+'</div>'+
    '<div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">'+
      '<label style="display:flex;gap:7px;align-items:center;font-size:13px;cursor:pointer">'+
        '<input type="checkbox" id="nImportant"> Marquer comme <b>important</b></label>'+
      '<div style="flex:1"></div>'+
      '<button class="btn btn-gold" onclick="publierNote()">'+I.send+' Publier</button></div>'+
    '<div class="hint" style="margin-top:8px">La note apparaît immédiatement dans l’espace personnel des salariés concernés. '+
      'Vous voyez ci-dessous qui l’a ouverte.</div></div>'+
  (COMS.notes.length
    ? COMS.notes.map(n=>{
        const cibles=nbCibles(n.cible||{});
        const lus=(n.lus||[]).length;
        return '<div class="card" style="padding:14px 16px;margin-bottom:12px">'+
          '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">'+
            '<div style="flex:1;min-width:220px"><b style="font-size:14px">'+esc(n.titre)+'</b>'+
              (n.important?' <span class="tag t-absent">important</span>':'')+
              (n.fin&&n.fin<TODAY?' <span class="tag t-neutral">expirée</span>':'')+
              '<div style="font-size:12px;color:var(--muted);margin-top:3px">Publiée le '+
              esc(String(n.ts||'').replace('T',' ').slice(0,16))+' par '+esc(n.par||'')+
              ' · destinataires : '+esc(libelleCible(n.cible||{}))+
              (n.fin?' · jusqu’au '+fmtDate(n.fin):'')+'</div></div>'+
            '<div style="text-align:right"><div style="font-family:var(--display);font-size:22px;font-weight:600">'+
              lus+'<span style="font-size:13px;color:var(--muted)"> / '+cibles+'</span></div>'+
              '<div style="font-size:11px;color:var(--muted)">ont lu</div></div>'+
            '<button class="linkish danger" onclick="supprNote(\''+escJs(n.id)+'\')">Supprimer</button></div>'+
          '<div style="margin-top:9px;font-size:13px;white-space:pre-wrap;color:var(--text)">'+esc(n.texte)+'</div>'+
          '<div style="margin-top:10px"><div class="rse-card" style="border:none;padding:0"><div class="rb">'+
            '<i style="width:'+(cibles?Math.round(lus/cibles*100):0)+'%"></i></div></div>'+
            (lus?'<button class="linkish" style="margin-top:8px" onclick="detailLecture(\''+escJs(n.id)+'\')">Voir qui a lu / qui n’a pas lu →</button>':'')+
          '</div></div>';
      }).join('')
    : '<div class="card"><div class="empty">Aucune note publiée</div></div>');
}
async function publierNote(){
  const titre=$('#nTitre').value.trim(),texte=$('#nTexte').value.trim();
  if(!titre){toast('Donnez un titre','warn');return}
  if(!texte){toast('Écrivez le message','warn');return}
  const cible=lireCible('n');
  const n=nbCibles(cible);
  if(!n){toast('Aucun salarié ne correspond à ce ciblage','warn');return}
  if(!confirm('Publier « '+titre+' » ?\n\nElle sera visible par '+n+' salarié(s) : '+libelleCible(cible)+'.'))return;
  try{
    await api('/api/coms/note',{method:'POST',body:{titre,texte,cible,important:$('#nImportant').checked}});
    await chargerComs();renderComs();
    toast('Note publiée · '+n+' destinataire(s)');
  }catch(e){toast('Publication impossible : '+e.message,'err')}
}
async function supprNote(id){
  if(!confirm('Supprimer cette note ? Elle disparaîtra de l’espace des salariés.'))return;
  try{await api('/api/coms/note/delete',{method:'POST',body:{id}});await chargerComs();renderComs();toast('Note supprimée')}
  catch(e){toast(e.message,'err')}
}
function detailLecture(id){
  const n=COMS.notes.find(x=>x.id===id);if(!n)return;
  const c=n.cible||{};
  const dest=DB.employees.filter(e=>e.actif!==false
    &&(!c.service||e.service===c.service)&&(!c.atelier||e.atelier===c.atelier)
    &&(!c.categorie||e.categorie===c.categorie));
  const lus=new Set(n.lus||[]);
  openModal('<div class="modal-head">'+I.doc+'<h3>Accusés de lecture — '+esc(n.titre)+'</h3>'+
    '<button class="x" onclick="openComs()" aria-label="Retour">'+I.x+'</button></div>'+
  '<div class="modal-body"><div class="tblwrap"><table class="tbl"><thead><tr>'+
    '<th>Mat.</th><th>Employée</th><th>Service</th><th>Atelier</th><th>Lecture</th></tr></thead><tbody>'+
    dest.sort((a,b)=>(lus.has(a.id)?1:0)-(lus.has(b.id)?1:0)||(a.nom||'').localeCompare(b.nom||''))
      .map(e=>'<tr'+(lus.has(e.id)?'':' class="revue-row"')+'><td class="mono">'+esc(matOf(e))+'</td>'+
      '<td>'+esc((e.prenom||'')+' '+(e.nom||''))+'</td><td style="color:var(--muted)">'+esc(e.service||'—')+'</td>'+
      '<td style="color:var(--muted)">'+esc(e.atelier||'—')+'</td>'+
      '<td>'+(lus.has(e.id)?'<span class="tag t-present">lue</span>':'<span class="tag t-absent">non lue</span>')+'</td></tr>').join('')+
    '</tbody></table></div></div>'+
  '<div class="modal-foot"><button class="btn btn-ghost" onclick="openComs()">Retour</button>'+
    '<button class="btn btn-ghost" onclick="csvLecture(\''+escJs(id)+'\')">'+I.download+' CSV</button></div>','wide');
}
function csvLecture(id){
  const n=COMS.notes.find(x=>x.id===id);if(!n)return;
  const c=n.cible||{};const lus=new Set(n.lus||[]);
  const out=[['Accusés de lecture — '+n.titre],['Publiée le',n.ts||''],[],
    ['Matricule','Nom','Prénom','Service','Atelier','Lecture']];
  DB.employees.filter(e=>e.actif!==false&&(!c.service||e.service===c.service)
    &&(!c.atelier||e.atelier===c.atelier)&&(!c.categorie||e.categorie===c.categorie))
    .forEach(e=>out.push([matOf(e),e.nom||'',e.prenom||'',e.service||'',e.atelier||'',lus.has(e.id)?'lue':'non lue']));
  csvDL('lecture_note_'+id+'.csv',out);
}

/* ------------------------------------------------------------------- sondages */
function vueVotes(){
  return '<div class="card" style="padding:14px 16px;margin-bottom:16px;background:var(--surface-2)">'+
    '<div style="font-weight:700;font-size:14px;margin-bottom:10px">Nouveau sondage</div>'+
    '<div><label class="fldlab" for="vQ">Question</label>'+
      '<input class="fldin" id="vQ" maxlength="200" placeholder="ex. Préférez-vous la pause déjeuner à 12h00 ou à 12h30 ?"></div>'+
    '<div style="margin-top:10px"><label class="fldlab">Réponses proposées</label>'+
      '<div id="vOpts">'+[0,1].map(i=>'<input class="fldin" style="margin-bottom:6px" data-opt="1" maxlength="80" placeholder="Réponse '+(i+1)+'">').join('')+'</div>'+
      '<button class="linkish" onclick="ajouterOption()">+ Ajouter une réponse</button></div>'+
    '<div style="margin-top:10px">'+champsCible('v')+'</div>'+
    '<div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">'+
      '<label style="display:flex;gap:7px;align-items:center;font-size:13px;cursor:pointer">'+
        '<input type="checkbox" id="vAnon" checked> Réponses <b>anonymes</b> '+
        '<small style="color:var(--muted)">(vous voyez les totaux, pas qui a voté quoi)</small></label>'+
      '<div style="flex:1"></div>'+
      '<button class="btn btn-gold" onclick="publierVote()">'+I.send+' Lancer le sondage</button></div>'+
    '</div>'+
  (COMS.votes.length
    ? COMS.votes.map(v=>{
        const cibles=nbCibles(v.cible||{});
        const tot=(v.resultats||[]).reduce((s,x)=>s+x,0);
        const ferme=v.ferme||(v.fin&&v.fin<TODAY);
        return '<div class="card" style="padding:14px 16px;margin-bottom:12px">'+
          '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">'+
            '<div style="flex:1;min-width:220px"><b style="font-size:14px">'+esc(v.question)+'</b>'+
              (ferme?' <span class="tag t-neutral">clos</span>':' <span class="tag t-present">en cours</span>')+
              (v.anonyme?' <span class="tag t-leave">anonyme</span>':'')+
              '<div style="font-size:12px;color:var(--muted);margin-top:3px">Lancé le '+
              esc(String(v.ts||'').replace('T',' ').slice(0,16))+' par '+esc(v.par||'')+
              ' · '+esc(libelleCible(v.cible||{}))+(v.fin?' · jusqu’au '+fmtDate(v.fin):'')+'</div></div>'+
            '<div style="text-align:right"><div style="font-family:var(--display);font-size:22px;font-weight:600">'+
              tot+'<span style="font-size:13px;color:var(--muted)"> / '+cibles+'</span></div>'+
              '<div style="font-size:11px;color:var(--muted)">ont répondu</div></div>'+
            (ferme?'':'<button class="linkish" onclick="fermerVote(\''+escJs(v.id)+'\')">Clore</button>')+
            '<button class="linkish danger" onclick="supprVote(\''+escJs(v.id)+'\')">Supprimer</button></div>'+
          '<div style="margin-top:12px">'+(v.options||[]).map((o,i)=>{
            const n=(v.resultats||[])[i]||0;
            const p=tot?Math.round(n/tot*100):0;
            return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">'+
              '<span>'+esc(o)+'</span><b>'+n+' ('+p+'%)</b></div>'+
              '<div class="rb" style="height:8px;border-radius:6px;background:var(--line);overflow:hidden">'+
              '<i style="display:block;height:100%;width:'+p+'%;background:'+PALETTE[i%PALETTE.length]+'"></i></div></div>';
          }).join('')+'</div>'+
          '<button class="linkish" style="margin-top:4px" onclick="csvVote(\''+escJs(v.id)+'\')">'+I.download+' Exporter les résultats</button>'+
          '</div>';
      }).join('')
    : '<div class="card"><div class="empty">Aucun sondage</div></div>');
}
function ajouterOption(){
  const box=document.getElementById('vOpts');
  if(box.querySelectorAll('input').length>=8){toast('8 réponses maximum','warn');return}
  const i=document.createElement('input');
  i.className='fldin';i.style.marginBottom='6px';i.dataset.opt='1';i.maxLength=80;
  i.placeholder='Réponse '+(box.querySelectorAll('input').length+1);
  box.appendChild(i);i.focus();
}
async function publierVote(){
  const question=$('#vQ').value.trim();
  const options=[...document.querySelectorAll('#vOpts input')].map(i=>i.value.trim()).filter(Boolean);
  if(!question){toast('Écrivez la question','warn');return}
  if(options.length<2){toast('Proposez au moins deux réponses','warn');return}
  const cible=lireCible('v');
  const n=nbCibles(cible);
  if(!n){toast('Aucun salarié ne correspond à ce ciblage','warn');return}
  if(!confirm('Lancer le sondage ?\n\n« '+question+' »\n\n'+options.map((o,i)=>(i+1)+'. '+o).join('\n')+
    '\n\nDestinataires : '+n+' salarié(s) — '+libelleCible(cible)))return;
  try{
    await api('/api/coms/vote',{method:'POST',body:{question,options,cible,anonyme:$('#vAnon').checked}});
    await chargerComs();renderComs();
    toast('Sondage lancé · '+n+' destinataire(s)');
  }catch(e){toast('Impossible : '+e.message,'err')}
}
async function fermerVote(id){
  if(!confirm('Clore ce sondage ? Les salariés ne pourront plus répondre.'))return;
  try{await api('/api/coms/vote/close',{method:'POST',body:{id}});await chargerComs();renderComs();toast('Sondage clos')}
  catch(e){toast(e.message,'err')}
}
async function supprVote(id){
  if(!confirm('Supprimer ce sondage et ses réponses ?'))return;
  try{await api('/api/coms/vote/delete',{method:'POST',body:{id}});await chargerComs();renderComs();toast('Sondage supprimé')}
  catch(e){toast(e.message,'err')}
}
function csvVote(id){
  const v=COMS.votes.find(x=>x.id===id);if(!v)return;
  const tot=(v.resultats||[]).reduce((s,x)=>s+x,0);
  const out=[['Sondage — '+v.question],['Lancé le',v.ts||''],['Anonyme',v.anonyme?'oui':'non'],
    ['Destinataires',nbCibles(v.cible||{})],['Réponses',tot],[],['Réponse','Voix','Part']];
  (v.options||[]).forEach((o,i)=>{const n=(v.resultats||[])[i]||0;
    out.push([o,n,(tot?Math.round(n/tot*100):0)+'%'])});
  if(!v.anonyme&&v.detail){
    out.push([],['Détail des réponses'],['Matricule','Nom','Prénom','Réponse']);
    Object.keys(v.detail).forEach(eid=>{const e=emp(eid);
      out.push([matOf(e),e.nom||'',e.prenom||'',(v.options||[])[v.detail[eid]]||''])});
  }
  csvDL('sondage_'+id+'.csv',out);
}
Object.assign(window,{openComs,renderComs,comsOnglet,publierNote,supprNote,detailLecture,csvLecture,
  ajouterOption,publierVote,fermerVote,supprVote,csvVote,chargerComs});
}
