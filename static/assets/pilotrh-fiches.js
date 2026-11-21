/* ============================================================================
   PilotRH — fiches de pointage mensuelles
   Une page A4 par personne et par mois : chaque jour, chaque passage (jusqu'à
   3 entrées et 3 sorties), les heures, le retard, les heures sup., et les
   totaux — exactement les chiffres de la paie. C'est la feuille que l'on remet
   à une ouvrière qui veut vérifier son pointage, et qu'elle peut signer.
   Imprimée par le navigateur : aucun serveur nécessaire, marche hors ligne.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { esc, escJs, hDec, fr2, hLabel } = C;
const JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const PAIRES = 3;                         // 3 entrées et 3 sorties en colonnes

function nomSociete(){
  const so = (window.DISC_OUTILS && DISC_OUTILS.donnees && DISC_OUTILS.donnees.societe) || {};
  return so.nom || (DB.settings && DB.settings.societe) || 'STE DBS FASHION';
}
const hh = min => min ? fr2(hDec(min)) : '';

/* Les lignes et les totaux d'une fiche — fonction pure, testée telle quelle.
   Mêmes règles que le rapport de paie (summarize) : un jour non importé n'est
   pas inventé, un férié ou un repos n'est jamais une absence. */
function lignesFiche(id, ym){
  const [a, b] = monthBounds(ym);
  const fin = b > TODAY ? TODAY : b;
  const e = emp(id);
  const lignes = [], t = {trav:0, abs:0, conge:0, ferie:0, repos:0, ret:0, retMin:0, hN:0, hS:0, revue:0, corrige:0};
  eachDay(a, b, ds => {
    const w = new Date(ds+'T12:00').getDay();
    const avenir = ds > fin;
    const rec = avenir ? null : (DB.pointages[ds] || {})[id] || null;
    const jourCree = !avenir && !!DB.pointages[ds];
    /* un dimanche ou un férié sans aucune donnée n'est pas « non importé » : c'est un repos */
    const m = (rec || jourCree || (!avenir && !estOuvre(ds))) ? metrics(rec, ds) : null;
    const P = rec ? passagesDe(rec) : [];
    let obs = [];
    if(m){
      if(m.ferie) obs.push(m.ferieNom || 'Jour férié');
      if(m.revue) obs.push(P.length % 2 ? 'Sortie non badgée' : (m.motifRevue || 'À vérifier'));
      if(rec && C.estProtege(rec)) obs.push(rec.src === 'conge' ? 'Congé validé' : 'Corrigé RH');
      if(m.manuel) obs.push('Heures saisies');
      if(P.length > PAIRES*2) obs.push('Autres passages : '+P.slice(PAIRES*2).join(' · '));
      switch(m.statut){
        case 'absent': t.abs++; break;
        case 'leave': case 'mission': t.conge++; break;
        case 'ferie': t.ferie++; break;
        case 'repos': t.repos++; break;
        case 'ferieTravaille': case 'reposTravaille': t.hS += m.hs; break;
        default: t.trav++; t.hN += m.heures; t.hS += m.hs; t.retMin += m.retard; if(m.late) t.ret++;
      }
      if(m.revue) t.revue++;
      if(rec && C.estProtege(rec)) t.corrige++;
    }
    lignes.push({ds, w, avenir, nonImporte: !avenir && !m, m, P, obs,
      statut: m ? C.statutLabel(m.statut, e.sexe) : (avenir ? '' : '—')});
  });
  t.hN = ENGINE.arrondirTotal(t.hN); t.hS = ENGINE.arrondirTotal(t.hS);
  return {e, ym, a, b, fin, lignes, t};
}

function fichePage(id, ym){
  const F = lignesFiche(id, ym), e = F.e, t = F.t;
  const titreMois = MOIS[+ym.slice(5,7)-1]+' '+ym.slice(0,4);
  const cases = (P, impair) => {
    let h = '';
    for(let i = 0; i < PAIRES*2; i++){
      const v = P[i] || '';
      const manque = impair && i === P.length;           // la sortie oubliée
      h += '<td class="t'+(i%2 ? ' s' : '')+(manque ? ' manque' : '')+'">'+(v ? esc(v) : (manque ? '?' : ''))+'</td>';
    }
    return h;
  };
  const corps = F.lignes.map(l => {
    const m = l.m, impair = l.P.length % 2 === 1;
    const cls = [l.w === 0 || (m && m.statut === 'repos') ? 'repos' : '', m && m.ferie ? 'ferie' : '',
                 m && m.statut === 'absent' ? 'abs' : '', m && m.revue ? 'revue' : ''].filter(Boolean).join(' ');
    return '<tr'+(cls ? ' class="'+cls+'"' : '')+'>'+
      '<td class="d">'+l.ds.slice(8)+'</td><td class="j">'+JOURS[l.w]+'</td>'+
      '<td class="st">'+esc(l.avenir ? '' : (l.nonImporte ? 'non importé' : l.statut))+'</td>'+
      cases(l.P, impair)+
      '<td class="n">'+(m ? hh(m.heures) : '')+'</td>'+
      '<td class="n">'+(m && m.retard ? m.retard : '')+'</td>'+
      '<td class="n">'+(m ? hh(m.hs) : '')+'</td>'+
      '<td class="o">'+esc(l.obs.join(' · '))+'</td></tr>';
  }).join('');
  const entete = [];
  for(let i = 1; i <= PAIRES; i++) entete.push('<th>Entrée '+i+'</th><th>Sortie '+i+'</th>');
  return '<section class="page">'+
    '<div class="tete"><div><b>'+esc(nomSociete())+'</b><br><span>Fiche de pointage mensuelle</span></div>'+
      '<div class="mois">'+esc(titreMois.charAt(0).toUpperCase()+titreMois.slice(1))+'</div></div>'+
    '<table class="id"><tr><td><span>Nom et prénom</span><b>'+esc(((e.nom||'')+' '+(e.prenom||'')).trim())+'</b></td>'+
      '<td><span>Matricule</span><b>'+esc(matOf(e))+'</b></td>'+
      '<td><span>Poste</span><b>'+esc(e.poste||'—')+'</b></td>'+
      '<td><span>Service / atelier</span><b>'+esc((e.service||'—')+(e.atelier ? ' · '+e.atelier : ''))+'</b></td></tr></table>'+
    '<table class="jours"><thead><tr><th>Date</th><th>Jour</th><th>Statut</th>'+entete.join('')+
      '<th>Heures</th><th>Retard (min)</th><th>H. sup.</th><th>Observation</th></tr></thead><tbody>'+corps+'</tbody>'+
      '<tfoot><tr><td colspan="'+(3+PAIRES*2)+'" class="tot">Totaux du mois'+(F.fin < F.b ? ' (au '+fmtDate(F.fin)+')' : '')+'</td>'+
      '<td class="n"><b>'+fr2(hDec(t.hN))+'</b></td><td class="n"><b>'+t.retMin+'</b></td><td class="n"><b>'+fr2(hDec(t.hS))+'</b></td><td></td></tr></tfoot></table>'+
    '<table class="bilan"><tr>'+
      '<td><span>Jours travaillés</span><b>'+t.trav+'</b></td>'+
      '<td><span>Absences</span><b>'+t.abs+'</b></td>'+
      '<td><span>Congés / missions</span><b>'+t.conge+'</b></td>'+
      '<td><span>Jours fériés</span><b>'+t.ferie+'</b></td>'+
      '<td><span>Retards</span><b>'+t.ret+(t.retMin ? ' <small>('+t.retMin+' min)</small>' : '')+'</b></td>'+
      '<td><span>Heures normales</span><b>'+fr2(hDec(t.hN))+' h</b></td>'+
      '<td><span>Heures sup.</span><b>'+fr2(hDec(t.hS))+' h</b></td>'+
      '<td><span>Total</span><b>'+fr2(hDec(t.hN + t.hS))+' h</b></td></tr></table>'+
    (t.revue ? '<p class="alerte">'+t.revue+' journée(s) au pointage incomplet (marquées « ? ») : leurs heures sont provisoires.</p>' : '')+
    '<p class="regle">'+esc(mentionRegime())+'. Un « ? » marque une sortie non badgée. « Corrigé RH » : journée rectifiée par le service du personnel.</p>'+
    '<div class="sig"><div>Visa du service du personnel<div class="cadre"></div></div>'+
      '<div>Lu et vérifié par l’intéressé(e) — date et signature<div class="cadre"></div></div></div>'+
    '<div class="pied">Édité le '+esc(fmtDate(TODAY))+' · PilotRH</div>'+
  '</section>';
}

function fichesHtml(ids, ym){
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiches de pointage '+esc(ym)+'</title><style>'+
    '@page{size:A4 portrait;margin:9mm 9mm}*{box-sizing:border-box}'+
    'body{font-family:Arial,Helvetica,sans-serif;font-size:8.3pt;color:#000;margin:0}'+
    '.page{page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}'+
    '.tete{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:5px;font-size:10pt}'+
    '.tete span{font-size:9pt}.mois{font-size:14pt;font-weight:700}'+
    'table{border-collapse:collapse;width:100%}'+
    '.id td{border:1px solid #000;padding:2px 5px;width:25%}.id span,.bilan span{display:block;font-size:6.8pt;color:#333}'+
    '.jours{margin-top:5px}.jours th{border:1px solid #000;background:#e9e9e9;font-size:7pt;padding:2px 1px;font-weight:700}'+
    '.jours td{border:1px solid #888;padding:1.2px 3px;height:4.75mm;white-space:nowrap}'+
    '.jours .d,.jours .j{text-align:center}.jours .t{text-align:center;font-family:"Courier New",monospace;width:10mm}'+
    '.jours .t.s{border-right:1px solid #000}.jours .n{text-align:right;width:12mm}'+
    '.jours .st{width:20mm;font-size:7.4pt}.jours .o{font-size:6.8pt;white-space:normal;max-width:48mm}'+
    '.jours tr.repos td{background:#f1f1f1;color:#666}.jours tr.ferie td{background:#eaf3f3}'+
    '.jours tr.abs .st{font-weight:700}.jours .manque{background:#fff1c9;font-weight:700}'+
    '.jours tfoot td{border:1px solid #000;padding:2px 3px;background:#f6f6f6}.tot{text-align:right;font-weight:700}'+
    '.bilan{margin-top:5px}.bilan td{border:1px solid #000;padding:2px 4px;text-align:center}.bilan b{font-size:9.5pt}'+
    '.alerte{margin:4px 0 0;font-weight:700}.regle{margin:3px 0 0;font-size:6.8pt;color:#333}'+
    '.sig{display:flex;gap:10mm;margin-top:5mm}.sig>div{flex:1;font-size:8pt}.sig .cadre{border:1px solid #000;height:15mm;margin-top:2px}'+
    '.pied{margin-top:3mm;font-size:6.8pt;color:#555;text-align:right}'+
    '@media screen{body{background:#ddd}.page{background:#fff;width:210mm;min-height:297mm;margin:8px auto;padding:9mm}}'+
    '</style></head><body>'+ids.map(id => fichePage(id, ym)).join('')+'</body></html>';
}
function imprimerHtml(html){
  const vieux = document.getElementById('ficheCadre'); if(vieux) vieux.remove();
  const f = document.createElement('iframe'); f.id = 'ficheCadre';
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  f.srcdoc = html;
  f.onload = () => { try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(e){ toast('Impression impossible : '+e.message,'err') } };
}

/* --- fenêtre de choix : quel mois, quelles personnes ------------------------- */
let FI = {ym:'', sel:new Set(), q:'', serv:''};
async function openFichesPointage(ids, ym){
  FI.ym = ym || TODAY.slice(0,7);
  FI.sel = new Set(ids || []); FI.q = ''; FI.serv = '';
  openModal('<div class="modal-head">'+I.report+'<h3>Fiches de pointage mensuelles</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
    '<div class="modal-body">'+
      '<div class="range-bar" style="margin:0 0 12px">'+
        '<div class="field"><label for="fiMois">Mois</label><input type="month" id="fiMois" value="'+FI.ym+'" max="'+TODAY.slice(0,7)+'" onchange="fiMois(this.value)"></div>'+
        '<div class="field">'+I.search+'<label for="fiQ" class="sr-only">Recherche</label><input id="fiQ" type="search" placeholder="Nom, matricule…" oninput="FI_Q(this.value)"></div>'+
        '<div class="field"><label for="fiServ">Service</label><select id="fiServ" onchange="FI_SERV(this.value)"><option value="">Tous</option>'+
          SERVICES.map(s => '<option>'+esc(s)+'</option>').join('')+'</select></div>'+
        '<button class="btn btn-ghost" onclick="fiTout(true)">Tout cocher</button>'+
        '<button class="btn btn-ghost" onclick="fiTout(false)">Tout décocher</button>'+
      '</div>'+
      '<div class="tblwrap" style="max-height:340px;overflow:auto"><table class="tbl"><thead><tr><th style="width:34px"></th><th>Mat.</th><th>Employée</th><th>Service</th></tr></thead>'+
        '<tbody id="fiBody"></tbody></table></div>'+
      '<div class="hint" style="margin-top:10px">Une page A4 par personne : chaque jour du mois, les passages (3 entrées et 3 sorties), '+
        'les heures, retards et heures sup., avec les mêmes totaux que le rapport de paie, et deux cadres de signature.</div>'+
    '</div><div class="modal-foot"><span id="fiN" style="margin-right:auto;font-size:13px;color:var(--muted)"></span>'+
      '<button class="btn btn-ghost" id="fiVoir" onclick="fiApercu()">Aperçu</button>'+
      '<button class="btn btn-gold" id="fiImp" onclick="fiImprimer()">'+I.download+' Imprimer</button></div>','wide');
  fiRemplir();
}
function fiLignes(){
  const q = FI.q.toLowerCase();
  return DB.employees.filter(e => e.actif !== false &&
      (!q || ((e.prenom||'')+' '+(e.nom||'')+' '+matOf(e)).toLowerCase().includes(q)) && (!FI.serv || e.service === FI.serv))
    .sort((x, y) => { const a = +matOf(x), b = +matOf(y); return (isNaN(a)||isNaN(b)) ? String(matOf(x)).localeCompare(matOf(y)) : a - b; });
}
function fiRemplir(){
  const tb = document.getElementById('fiBody'); if(!tb) return;
  tb.innerHTML = fiLignes().map(e => '<tr><td><input type="checkbox" '+(FI.sel.has(e.id) ? 'checked ' : '')+
      'onchange="fiCoche(\''+escJs(e.id)+'\',this.checked)" aria-label="Choisir '+esc(empName(e.id))+'"></td>'+
      '<td class="mono">'+esc(matOf(e))+'</td><td>'+empCell(e.id, true)+'</td><td style="color:var(--muted)">'+esc(e.service||'—')+'</td></tr>').join('')
    || '<tr><td colspan="4"><div class="empty">Personne ne correspond</div></td></tr>';
  fiCompte();
}
function fiCompte(){
  const n = FI.sel.size, el = document.getElementById('fiN');
  if(el) el.textContent = n ? n+' fiche(s) — '+n+' page(s)' : 'Cochez une ou plusieurs personnes';
  ['fiVoir','fiImp'].forEach(i => { const b = document.getElementById(i); if(b) b.disabled = !n; });
}
function fiCoche(id, on){ if(on) FI.sel.add(id); else FI.sel.delete(id); fiCompte(); }
function fiTout(on){ fiLignes().forEach(e => on ? FI.sel.add(e.id) : FI.sel.delete(e.id)); fiRemplir(); }
function fiMois(v){ if(v) FI.ym = v > TODAY.slice(0,7) ? TODAY.slice(0,7) : v; }
async function preparer(){
  if(!FI.sel.size){ toast('Cochez au moins une personne','warn'); return null; }
  const [a, b] = monthBounds(FI.ym);
  await ensureRange(a, b > TODAY ? TODAY : b);
  const ids = fiLignes().map(e => e.id).filter(id => FI.sel.has(id));
  /* une personne cochée puis masquée par le filtre reste imprimée */
  FI.sel.forEach(id => { if(ids.indexOf(id) < 0) ids.push(id); });
  return fichesHtml(ids, FI.ym);
}
async function fiImprimer(){ const h = await preparer(); if(h) imprimerHtml(h); }
async function fiApercu(){
  const h = await preparer(); if(!h) return;
  const w = window.open('', '_blank');
  if(!w){ toast('Le navigateur a bloqué la fenêtre d’aperçu : autorisez les fenêtres pour PilotRH, ou utilisez « Imprimer ».','warn',9000); return; }
  w.document.open(); w.document.write(h); w.document.close();
}
/* depuis la fiche d'une personne : sa fiche du mois, en un clic */
async function imprimerFicheMois(id, ym){
  ym = ym || TODAY.slice(0,7);
  const [a, b] = monthBounds(ym);
  await ensureRange(a, b > TODAY ? TODAY : b);
  imprimerHtml(fichesHtml([id], ym));
}
Object.assign(window, {lignesFiche, fichePage, fichesHtml, openFichesPointage, fiRemplir, fiCoche, fiTout, fiMois,
  fiImprimer, fiApercu, imprimerFicheMois,
  FI_Q: v => { FI.q = v; fiRemplir(); }, FI_SERV: v => { FI.serv = v; fiRemplir(); }});
}
