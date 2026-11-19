/* ============================================================================
   PilotRH — saisie des passages d'une journée
   1re entrée, 1re sortie, 2e entrée, 2e sortie… au lieu d'une seule entrée et
   d'une seule sortie. C'est ce qu'il faut pour corriger une journée aux badges
   impairs (un passage oublié) de façon lisible par tout le monde : le service
   RH voit ce qu'il corrige, et l'ouvrière retrouve les mêmes heures dans son
   espace.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { esc, escJs, toMin, fromMin, hDec, fr2, hLabel } = C;
const RANG = n => n === 1 ? '1re' : n + 'e';
const MAX_PASSAGES = 8;

/* Les heures badgées d'une journée, dans l'ordre (« HH:MM »). */
function passagesDe(rec){
  if(!rec) return [];
  const p = (rec.punches && rec.punches.length) ? rec.punches : [rec.entree, rec.sortie];
  return p.filter(x => x && toMin(x) != null).map(x => String(x).slice(0,5));
}
/* Contrôle d'une saisie : [{ok, erreur, avis}] — fonction pure, testée telle quelle. */
function verifierPassages(valeurs){
  const v = valeurs.map(x => String(x || '').trim());
  /* un trou au milieu (2e entrée vide mais 2e sortie remplie) ne veut rien dire */
  const dernier = v.reduce((k, x, i) => x ? i : k, -1);
  if(dernier < 0) return {ok:false, erreur:'Saisissez au moins la 1re entrée.'};
  for(let i = 0; i <= dernier; i++){
    if(!v[i]) return {ok:false, erreur:'La case « '+libelle(i)+' » est vide alors qu’une heure plus loin est remplie.'};
    if(!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v[i].slice(0,5)) || toMin(v[i]) == null)
      return {ok:false, erreur:'Heure non comprise : « '+v[i]+' » ('+libelle(i)+').'};
    if(i && toMin(v[i]) <= toMin(v[i-1]))
      return {ok:false, erreur:'« '+libelle(i)+' » ('+v[i]+') doit être après « '+libelle(i-1)+' » ('+v[i-1]+').'};
  }
  const liste = v.slice(0, dernier + 1).map(x => x.slice(0,5));
  const avis = liste.length % 2 ? 'Nombre de passages impair : il manque encore la « '+libelle(liste.length)+' ». '+
    'La journée restera « à vérifier ».' : '';
  return {ok:true, passages:liste, avis};
}
function libelle(i){ return RANG(Math.floor(i/2)+1)+' '+(i%2 ? 'sortie' : 'entrée'); }
/* L'enregistrement qui sera écrit pour ces passages. */
function recDepuisPassages(rec, liste){
  const r = Object.assign({}, rec || {});
  r.statut = (r.statut === 'autorisation') ? 'autorisation' : 'present';
  r.entree = liste[0] || '';
  r.sortie = liste.length > 1 ? liste[liste.length-1] : '';
  if(liste.length > 2) r.punches = liste.slice(); else delete r.punches;
  delete r.hM; delete r.hsM;                 // les heures se recalculent depuis les passages
  r.manuel = 1; r.src = 'manuel';
  return r;
}

let PS = null;   // {ds, id, apres, origine}
function openPassages(ds, id, apres){
  const rec = (DB.pointages[ds] || {})[id] || null;
  const clos = moisClos(ds.slice(0,7));
  const lecture = !can('edit') || clos;
  const liste = passagesDe(rec);
  const n = Math.min(MAX_PASSAGES, Math.max(4, liste.length + (liste.length % 2)));
  PS = {ds, id, apres:apres||'', n, aHeures:!!(rec && (rec.hM != null || rec.hsM != null))};
  const reg = regimeFor(ds);
  openModal('<div class="modal-head">'+I.clock+'<h3>Passages du '+fmtDate(ds)+' — '+esc(empName(id))+'</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
    '<div class="modal-body">'+
      '<p style="font-size:13px;color:var(--muted);margin:0 0 10px">Horaire prévu ce jour : <b>'+
        (reg.actif === false ? 'repos' : esc((reg.debut||'?')+' → '+(reg.fin||'?')))+'</b>'+
        (reg.pauseDe && reg.pauseA ? ' · pause '+esc(reg.pauseDe+' → '+reg.pauseA) : '')+'. '+
        'Saisissez chaque passage dans l’ordre ; une case vide en fin de liste = passage non badgé.</p>'+
      (liste.length ? '<div class="hint" style="margin-bottom:10px">Actuellement enregistré : <span class="mono">'+
        esc(liste.join(' · '))+'</span>'+(C.estProtege(rec) ? ' (déjà corrigé à la main)' : ' (lu sur la pointeuse)')+'</div>' : '')+
      '<div id="psGrille"></div>'+
      (lecture ? '' : '<button class="linkish" id="psPlus" onclick="passagesPlus()" style="margin-top:6px">+ Ajouter un passage (une entrée et une sortie)</button>')+
      '<div id="psApercu" style="margin-top:12px"></div>'+
      (PS.aHeures && !lecture ? '<div class="banner banner-warn" style="margin:10px 0 0">'+I.warn+'<div class="grow">Cette journée porte des heures '+
        'saisies à la main. En enregistrant les passages, les heures seront <b>recalculées à partir des passages</b>.</div></div>' : '')+
      (clos ? '<div class="banner banner-info" style="margin:10px 0 0">'+I.lock+'<div class="grow">Mois clôturé : consultation seulement.</div></div>' : '')+
    '</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">'+(lecture ? 'Fermer' : 'Annuler')+'</button>'+
      (lecture ? '' : '<button class="btn btn-gold" id="psOk" onclick="passagesEnregistrer()">'+I.check+' Enregistrer les passages</button>')+'</div>');
  PS.valeurs = Array.from({length:n}, (_, i) => liste[i] || '');
  PS.lecture = lecture;
  dessinerGrille();
  apercuPassages();
  const vide = document.querySelector('#psGrille input:not([value]), #psGrille input[value=""]');
  if(vide && !lecture) vide.focus();
}
function dessinerGrille(){
  const g = document.getElementById('psGrille'); if(!g) return;
  let h = '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">';
  const nb = PS.valeurs.filter(Boolean).length;
  for(let i = 0; i < PS.n; i++){
    /* la case qui suit le dernier passage d'une journée impaire : c'est la sortie oubliée */
    const manque = nb % 2 === 1 && i === nb;
    h += '<div><label class="fldlab" for="ps'+i+'">'+libelle(i)+(manque ? ' <span style="color:var(--late)">— non badgée</span>' : '')+'</label>'+
      '<input class="fldin'+(manque ? ' ps-manque' : '')+'" type="time" id="ps'+i+'" value="'+esc(PS.valeurs[i])+'"'+
      (PS.lecture ? ' disabled' : '')+' oninput="passageSaisi('+i+',this.value)"'+
      (manque ? ' style="border-color:var(--late);background:var(--late-bg)"' : '')+'></div>';
  }
  g.innerHTML = h + '</div>';
  const plus = document.getElementById('psPlus'); if(plus) plus.style.display = PS.n >= MAX_PASSAGES ? 'none' : '';
}
function passageSaisi(i, v){ PS.valeurs[i] = v; apercuPassages(); }
function passagesPlus(){
  PS.valeurs = PS.valeurs.map((v, i) => { const el = document.getElementById('ps'+i); return el ? el.value : v; });
  PS.n = Math.min(MAX_PASSAGES, PS.n + 2); PS.valeurs.push('', '');
  dessinerGrille(); apercuPassages();
}
function apercuPassages(){
  const box = document.getElementById('psApercu'); if(!box) return;
  const v = verifierPassages(PS.valeurs);
  const ok = document.getElementById('psOk');
  if(!v.ok){ box.innerHTML = '<div class="banner banner-err" style="margin:0">'+I.warn+'<div class="grow">'+esc(v.erreur)+'</div></div>'; if(ok) ok.disabled = true; return; }
  if(ok) ok.disabled = false;
  const rec = recDepuisPassages((DB.pointages[PS.ds] || {})[PS.id], v.passages);
  const m = metrics(rec, PS.ds);
  const segs = []; for(let i = 0; i < v.passages.length; i += 2) segs.push(v.passages[i]+' → '+(v.passages[i+1] || '?'));
  box.innerHTML = '<div class="banner '+(v.avis ? 'banner-warn' : 'banner-info')+'" style="margin:0">'+(v.avis ? I.warn : I.check)+
    '<div class="grow"><b>'+esc(segs.join('  ·  '))+'</b><br>'+
    'Heures : <b>'+(m.heures ? hLabel(m.heures) : '0 h')+'</b>'+(m.hs ? ' · heures sup. : <b>'+hLabel(m.hs)+'</b>' : '')+
    (m.retard ? ' · retard : <b>'+m.retard+' min</b>' : '')+
    (v.avis ? '<br>'+esc(v.avis) : '')+'</div></div>';
}
async function passagesEnregistrer(){
  const v = verifierPassages(PS.valeurs);
  if(!v.ok){ toast(v.erreur, 'warn'); return; }
  if(!DB.pointages[PS.ds]) DB.pointages[PS.ds] = {};
  const avant = DB.pointages[PS.ds][PS.id];
  DB.pointages[PS.ds][PS.id] = recDepuisPassages(avant, v.passages);
  const b = document.getElementById('psOk'); if(b) b.disabled = true;
  const ok = await persistPointage(PS.ds, PS.id);
  if(!ok){ DB.pointages[PS.ds][PS.id] = avant; if(b) b.disabled = false; return; }
  closeModal();
  toast('Passages enregistrés — '+v.passages.length+' passage(s)'+(v.avis ? ' · nombre encore impair' : ''), v.avis ? 'warn' : 'ok');
  ENGINE.invalidate && ENGINE.invalidate();
  const apres = PS.apres; PS = null;
  if(apres && typeof window[apres] === 'function') await window[apres]();
  if(typeof majSidebar === 'function') majSidebar();
}
/* Petit bouton « passages » à placer dans une ligne de tableau. */
function boutonPassages(ds, id, rec, apres){
  const p = passagesDe(rec), impair = p.length % 2 === 1, plus = p.length > 2;
  if(!p.length && !(rec && (rec.statut === 'present' || rec.statut === 'autorisation'))) return '';
  const lib = impair ? '⚠ '+p.length+' passage'+(p.length > 1 ? 's' : '')+' — compléter' : (plus ? '⇄ '+p.length+' passages' : 'Passages');
  return ' <button class="'+(impair ? 'tag t-late' : (plus ? 'tag t-neutral' : 'linkish'))+'" style="cursor:pointer;border:0'+(plus||impair?'':';font-size:11.5px')+'" '+
    'title="Voir et saisir 1re entrée, 1re sortie, 2e entrée, 2e sortie…'+(p.length ? ' — actuellement : '+esc(p.join(' · ')) : '')+'" '+
    'onclick="openPassages(\''+ds+'\',\''+escJs(id)+'\',\''+escJs(apres||'')+'\')">'+lib+'</button>';
}
Object.assign(window, {passagesDe, verifierPassages, recDepuisPassages, openPassages, passageSaisi, passagesPlus,
  apercuPassages, passagesEnregistrer, boutonPassages, libellePassage:libelle});
}
