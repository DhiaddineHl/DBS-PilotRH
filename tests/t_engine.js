global.window = global;
require(require('path').join(__dirname,'..','static','assets','pilotrh-core.js'));
const C = global.PilotRHCore;

// on reproduit la configuration par defaut du serveur (pause 12:00-12:30)
function conf(extra){
  const base=C.normalizeSettings(Object.assign({},extra||{}));
  for(const d of [1,2,3,4,5]){base.jours[d].pauseDe='12:00';base.jours[d].pauseA='12:30';base.jours[d].pauseAuto=false;}
  return base;
}
let S = conf();
const E = C.makeEngine(()=>S);
const ENGINE_INVALID = ()=>E.invalidate();
let ok=0, ko=0;
function t(nom, got, exp){
  const g=JSON.stringify(got), e=JSON.stringify(exp);
  if(g===e){ok++;} else {ko++;console.log('  ECHEC  '+nom+'\n    attendu '+e+'\n    obtenu  '+g);}
}
function m(rec,ds){const r=E.metrics(rec,ds);return {st:r.statut,h:r.heures,hs:r.hs,ret:r.retard,rev:r.revue}}

// mardi 2026-08-11 : jour ouvré 07:30-16:30, pause 30 (12:00-12:30), tol 15, grace 15
console.log('\n--- Journée normale ---');
t('journée pleine 07:30-16:30 => 8h30', m({statut:'present',entree:'07:30',sortie:'16:30'},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:false});
t('retard 07:50 (tol 15) => retard 20, late', m({statut:'present',entree:'07:50',sortie:'16:30'},'2026-08-11'),
  {st:'late',h:490,hs:0,ret:20,rev:false});
t('07:40 dans la tolérance => pas de retard', m({statut:'present',entree:'07:40',sortie:'16:30'},'2026-08-11'),
  {st:'present',h:500,hs:0,ret:0,rev:false});
t('sortie 18:00 => 1h30 HS (mode fin)', m({statut:'present',entree:'07:30',sortie:'18:00'},'2026-08-11'),
  {st:'present',h:510,hs:90,ret:0,rev:false});
t('arrivée avant début non payée', m({statut:'present',entree:'06:30',sortie:'16:30'},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:false});

console.log('\n--- M3 : pointage incomplet ---');
t('un seul badge => 0h MAIS revue=true', m({statut:'present',entree:'07:30',sortie:''},'2026-08-11'),
  {st:'present',h:0,hs:0,ret:0,rev:true});
t('badges impairs => revue=true', m({statut:'present',punches:['07:30','12:00','16:30']},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:true});
t('entree==sortie (ancien bug CSV) => revue', m({statut:'present',entree:'07:30',sortie:'07:30'},'2026-08-11'),
  {st:'present',h:0,hs:0,ret:0,rev:true});

console.log('\n--- retard conserve quand la sortie manque ---');
t('un seul badge en retard : heures 0 mais retard compte',
  m({statut:'present',entree:'07:50',sortie:''},'2026-08-11'),
  {st:'late',h:0,hs:0,ret:20,rev:true});
t('un seul badge dans la tolerance : pas de retard',
  m({statut:'present',entree:'07:40',sortie:''},'2026-08-11'),
  {st:'present',h:0,hs:0,ret:0,rev:true});
t('un seul badge un jour ferie : pas de retard',
  m({statut:'present',entree:'07:50',sortie:''},'2026-05-01'),
  {st:'ferieTravaille',h:0,hs:0,ret:0,rev:true});
t('un seul badge un dimanche : pas de retard',
  m({statut:'present',entree:'07:50',sortie:''},'2026-08-09'),
  {st:'reposTravaille',h:0,hs:0,ret:0,rev:true});

console.log('\n--- fete fixe desactivee dans les parametres ---');
t('fete fixe marquee off n est plus feriee', (function(){
  S.feriesFixes=S.feriesFixes.map(f=>f.md==='05-01'?Object.assign({},f,{off:true}):f);
  ENGINE_INVALID();
  const r=E.ferieFor('2026-05-01');
  S.feriesFixes=S.feriesFixes.map(f=>{const c=Object.assign({},f);delete c.off;return c});
  ENGINE_INVALID();
  return r;
})(), null);
t('et redevient feriee quand on la reactive', !!E.ferieFor('2026-05-01'), true);

console.log('\n--- portee de l arrondi : defaut = chaque journee ---');
t('arrondiPortee par defaut', C.normalizeSettings({}).arrondiPortee, 'jour');
t('portee periode conservee si demandee', C.normalizeSettings({arrondiPortee:'periode'}).arrondiPortee, 'periode');
t('valeur inconnue ramenee a jour', C.normalizeSettings({arrondiPortee:'nawak'}).arrondiPortee, 'jour');

console.log('\n--- protection des journees (miroir du serveur) ---');
t('manuel protege', C.estProtege({manuel:1}), true);
t('hM protege', C.estProtege({hM:480}), true);
t('hsM protege', C.estProtege({hsM:60}), true);
t('conge protege', C.estProtege({src:'conge'}), true);
t('import non protege', C.estProtege({src:'import',statut:'present'}), false);
t('null non protege', C.estProtege(null), false);

console.log('\n--- M7 : plage de pause ---');
t('demi-journée 07:55-11:00 => PAS de pause déduite', m({statut:'autorisation',entree:'07:55',sortie:'11:00'},'2026-08-11'),
  {st:'autorisation',h:185,hs:0,ret:25,rev:false});
t('journée complète => 30 min déduites', m({statut:'present',entree:'07:30',sortie:'16:30'},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:false});
t('badge sortie pendant la pause 12:00-12:45 => rien de plus déduit',
  m({statut:'present',punches:['07:30','12:00','12:45','16:30']},'2026-08-11'),
  {st:'present',h:495,hs:0,ret:0,rev:false});
t('sortie 12:00 retour 12:15 => 15 min encore déduites',
  m({statut:'present',punches:['07:30','12:00','12:15','16:30']},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:false});
t('plage de pause deduite automatiquement quand non renseignee',
  (function(){const d=C.normalizeSettings({}).jours[1];return [d.pauseDe,d.pauseA,d.pauseAuto]})(),
  ['11:45','12:15',true]);
t('jour de repos travaille avec coupure : la sortie n est pas payee',
  m({statut:'present',punches:['08:00','10:00','12:00','13:00']},'2026-08-09'),
  {st:'reposTravaille',h:0,hs:180,ret:0,rev:false});

console.log('\n--- M5 : heures manuelles ---');
t('hM=480 remplace les heures ET annule les HS calculées',
  m({statut:'present',entree:'07:30',sortie:'19:00',hM:480},'2026-08-11'),
  {st:'present',h:480,hs:0,ret:0,rev:false});
t('hM + hsM => les deux respectés',
  m({statut:'present',entree:'07:30',sortie:'19:00',hM:480,hsM:60},'2026-08-11'),
  {st:'present',h:480,hs:60,ret:0,rev:false});
t('hsM seul => heures calculées conservées',
  m({statut:'present',entree:'07:30',sortie:'16:30',hsM:30},'2026-08-11'),
  {st:'present',h:510,hs:30,ret:0,rev:false});

console.log('\n--- M1 : jours fériés ---');
t('01/05 sans pointage => ferie, PAS absent', m(null,'2026-05-01'), {st:'ferie',h:0,hs:0,ret:0,rev:false});
t('01/05 statut absent enregistré => ferie quand même', m({statut:'absent',entree:'',sortie:''},'2026-05-01'),
  {st:'ferie',h:0,hs:0,ret:0,rev:false});
t('01/05 travaillé 08:00-14:00 => 6h entierement en HS (aucune pause theorique retiree)',
  m({statut:'present',entree:'08:00',sortie:'14:00'},'2026-05-01'),
  {st:'ferieTravaille',h:0,hs:360,ret:0,rev:false});
t('estOuvre(01/05) = false', E.estOuvre('2026-05-01'), false);
t('estOuvre(11/08 mardi) = true', E.estOuvre('2026-08-11'), true);
t('ferie mobile ajouté sur 2 jours', (function(){
  S.feries=[{date:'2026-03-20',nom:'Aid',jours:2}];E.invalidate();
  const a=E.ferieFor('2026-03-20'),b=E.ferieFor('2026-03-21'),c=E.ferieFor('2026-03-22');
  S.feries=[];E.invalidate();
  return [!!a,!!b,!!c];
})(), [true,true,false]);

console.log('\n--- Repos hebdomadaire ---');
t('dimanche sans pointage => repos', m(null,'2026-08-09'), {st:'repos',h:0,hs:0,ret:0,rev:false});
t('dimanche travaillé => tout en HS', m({statut:'present',entree:'08:00',sortie:'13:00'},'2026-08-09'),
  {st:'reposTravaille',h:0,hs:300,ret:0,rev:false});
t('samedi régime 07:30-13:00 pause 0', m({statut:'present',entree:'07:30',sortie:'13:00'},'2026-08-08'),
  {st:'present',h:330,hs:0,ret:0,rev:false});

console.log('\n--- M4 : arrondi sur le cumul, pas par jour ---');
S.arrondi=15;S.arrondiSens='proche';S.arrondiPortee='periode';E.invalidate();
const brut = m({statut:'present',entree:'07:38',sortie:'16:30'},'2026-08-11').h;
t('arrondi periode : metrics ne touche pas la journée', brut, 502);
const totPeriode = E.arrondirTotal(brut*26);
t('arrondirTotal arrondi une seule fois, sur le cumul', totPeriode, 13050);
S.arrondiPortee='jour';E.invalidate();
const parJour = m({statut:'present',entree:'07:38',sortie:'16:30'},'2026-08-11').h;
t('arrondi jour : la journée est arrondie', parJour, 495);
t('dérive du mode jour sur 26 jours (pas de 15 min)', Math.abs(parJour*26 - totPeriode), 180);
S.arrondi=0;S.arrondiPortee='periode';E.invalidate();

console.log('\n--- M12 : defaut modeHS unique ---');
t('modeHS par defaut = fin', C.normalizeSettings({}).modeHS, 'fin');
t('modeHS seuil conserve', C.normalizeSettings({modeHS:'seuil'}).modeHS, 'seuil');
t('modeHS inconnu ramene a fin', C.normalizeSettings({modeHS:'nawak'}).modeHS, 'fin');

console.log('\n--- Deduplication des badges ---');
t('double lecture du doigt a 2 min => 1 seul badge',
  m({statut:'present',punches:['07:30','07:32','12:00','16:30']},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:true});

console.log('\n--- Congés / missions ---');
t('congé => 0h, pas absent', m({statut:'leave',entree:'',sortie:''},'2026-08-11'),
  {st:'leave',h:0,hs:0,ret:0,rev:false});
t('absence réelle un jour ouvré', m({statut:'absent',entree:'',sortie:''},'2026-08-11'),
  {st:'absent',h:0,hs:0,ret:0,rev:false});

console.log('\n--- Mode période (Ramadan) ---');
S=conf({periodes:[{nom:'Ramadan',du:'2026-02-18',au:'2026-03-19',
  jours:{1:{actif:true,debut:'07:00',fin:'15:00',pause:0},2:{actif:true,debut:'07:00',fin:'15:00',pause:0},
  3:{actif:true,debut:'07:00',fin:'15:00',pause:0},4:{actif:true,debut:'07:00',fin:'15:00',pause:0},
  5:{actif:true,debut:'07:00',fin:'15:00',pause:0},6:{actif:false},0:{actif:false}}}]});
E.invalidate();
t('Ramadan 07:00-15:00 => 8h', m({statut:'present',entree:'07:00',sortie:'15:00'},'2026-03-03'),
  {st:'present',h:480,hs:0,ret:0,rev:false});
t('hors periode => semaine de reference', m({statut:'present',entree:'07:30',sortie:'16:30'},'2026-08-11'),
  {st:'present',h:510,hs:0,ret:0,rev:false});

console.log('\n--- Échappement HTML (XSS) ---');
t('esc neutralise les balises', C.esc('<img src=x onerror=alert(1)>'),
  '&lt;img src=x onerror=alert(1)&gt;');
t('esc guillemets', C.esc('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
t('escJs apostrophes', C.escJs("O'Brien"), "O\\'Brien");

console.log('\n--- fromMin ne replie plus minuit ---');
t('fromMin(1500) signale le jour suivant', C.fromMin(1500), '01:00 (+1j)');

console.log('\n=========================');
console.log('  '+ok+' réussis · '+ko+' échoués');
process.exit(ko?1:0);
