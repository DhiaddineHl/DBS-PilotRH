/* Assiduité, corrections en masse, dossiers disciplinaires — dans un vrai navigateur.

   Les calculs (qui compte comme absence, quelle correction est acceptée, quel
   texte arabe sort) sont d'abord vérifiés sur des données construites à la main,
   où le résultat attendu se calcule de tête. Les écrans sont ensuite parcourus
   comme le ferait le service RH, jusqu'à ce qui part réellement vers le serveur.

   Prérequis : node mock.js (port 8777).                                        */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(()=>chromium.launch());
  let ok=0, ko=0;
  const t=(nom,cond,detail)=>{ if(cond)ok++; else {ko++;console.log('  ECHEC '+nom+(detail!==undefined?' :: '+String(detail).slice(0,400):''))} };
  const eg=(nom,a,b)=>t(nom, JSON.stringify(a)===JSON.stringify(b), 'attendu '+JSON.stringify(b)+' · obtenu '+JSON.stringify(a));
  const erreurs=[];
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  page.on('pageerror', e => erreurs.push('PAGEERROR '+e.message));
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8777/', { waitUntil:'networkidle' });
  await page.waitForSelector('#nav .nav-item', { timeout:12000 });
  const aller = async v => { await page.evaluate(v=>go(v), v); await page.waitForTimeout(700); };
  const bulks = async () => (await (await page.request.get('http://localhost:8777/api/__bulks')).json());

  /* ======================================================================== */
  console.log('\n--- Absence non justifiée > 48 h : lettre recommandée préparée d\'office ---');
  let auto = [];
  for (let k = 0; k < 20 && !auto.length; k++) {
    await page.waitForTimeout(500);
    auto = (await (await page.request.get('http://localhost:8777/api/discipline')).json()).entrees.filter(x => x.type === 'recommandee');
  }
  t('au démarrage, une lettre recommandée est préparée pour l\'absence de plus de 48 h', auto.length === 1, JSON.stringify(auto).slice(0,200));
  const lr = auto[0] || {};
  const abs3 = await page.evaluate(() => absencesSansJustif().map(x => [x.id, x.debut, x.jours.length]));
  eg('pour la bonne personne et la bonne absence (E005, 3 jours ; E006 a un certificat ; E009 un seul jour)', abs3.map(x=>x[0]), ['E005']);
  eg('brouillon, numéroté, motif absence, délai 48 h, rattaché à l\'absence', [lr.statut, /^LR-\d{4}-001$/.test(lr.ref), lr.motif, lr.delai_h, lr.cle_auto], ['brouillon', true, 'absence', 48, 'E005|'+abs3[0][1]]);
  t('les dates d\'absence sont écrites en arabe dans les faits', /سُجّل غيابك عن العمل دون إذن أو مبرّر لمدّة 3 أيام/.test(lr.faits||''), lr.faits);
  t('la note dit qu\'elle a été préparée automatiquement', /Préparée automatiquement par PilotRH/.test(lr.note||''));
  const encore = await page.evaluate(async () => (await discAutoLettres()).length);
  const tous = (await (await page.request.get('http://localhost:8777/api/discipline')).json()).entrees.filter(x => x.type === 'recommandee');
  t('un second passage ne crée pas de doublon', encore === 0 && tous.length === 1);
  await aller('alertes'); await page.waitForSelector('.alert-row');
  const prem = await page.locator('.alert-row').first().innerText();
  t('l\'alerte est en tête de liste', /Absence non justifiée > 48 h/.test(prem), prem);
  t('elle dit qui, depuis quand, combien de jours', /3 jour\(s\) ouvré\(s\) d’absence depuis le/.test(prem));
  t('et que la lettre est prête', /Lettre recommandée LR-\d{4}-001 préparée \(brouillon\)/.test(prem));
  await page.locator('.alert-clic', {hasText:'Absence non justifiée'}).first().click(); await page.waitForSelector('#dCorps');
  t('un clic ouvre la lettre', /LR-\d{4}-001 — Lettre recommandée/.test(await page.locator('.modal-head h3').innerText()));
  const apLR = await page.evaluate(() => document.getElementById('discApercu').srcdoc);
  t('mention « رسالة مضمونة الوصول مع الإعلام بالبلوغ »', /رسالة مضمونة الوصول مع الإعلام بالبلوغ/.test(apLR));
  t('objet, adresse de la destinataire, délai de 48 h', /الموضوع: غياب غير مبرّر عن العمل/.test(apLR) && /العنوان:/.test(apLR) && /48 ساعة/.test(apLR));
  t('ligne du numéro d\'envoi recommandé, sans signature de la destinataire', /عدد الإرسالية المضمونة الوصول/.test(apLR) && !/إمضاء المعنية بالأمر/.test(apLR));
  await page.evaluate(()=>closeModal());
  /* le certificat arrive : l'alerte s'éteint */
  await page.evaluate(d => { DB.absences.push({id:'E005',type:'Maladie',debut:d,fin:addDays(TODAY,2),jours:3,statut:'justifiée'}); }, abs3[0][1]);
  await aller('alertes');
  t('justificatif enregistré : l\'alerte disparaît', !/Absence non justifiée/.test(await page.locator('#main').innerText()));
  await page.evaluate(() => { DB.absences.pop(); });
  const chef = await page.evaluate(async () => { const v=ME.role; ME.role='atelier';
    const a = computeAlerts().find(x => /Absence non justifiée/.test(x.type)); const c = (await discAutoLettres()).length; ME.role=v; return {act:a&&a.actLbl, sub:a&&a.sub, c}; });
  t('chef d\'atelier : il voit l\'alerte, sans la lettre ni la création', chef.act === 'Voir la journée' && !/LR-/.test(chef.sub||'') && chef.c === 0, JSON.stringify(chef));
  /* on retire la lettre pour que la suite des tests parte d'un dossier vide */
  await page.request.post('http://localhost:8777/api/discipline/supprimer', {data:{id:lr.id}});
  await page.evaluate(async () => { await discCharger(true); });

  console.log('\n--- Absence > 48 h : les règles, cas par cas ---');
  const regl = await page.evaluate(() => {
    const sv = {e:DB.employees, p:DB.pointages, a:DB.absences, c:DB.conges, s:JSON.parse(JSON.stringify(DB.settings))};
    const J = {actif:true,debut:'07:30',fin:'16:30',pause:30,tol:15,grace:15};
    DB.settings.jours = {0:{actif:false},1:J,2:J,3:J,4:J,5:J,6:J}; DB.settings.periodes=[]; DB.settings.feries=[]; DB.settings.feriesFixes=[]; DB.settings.suivi={};
    ENGINE.invalidate();
    const ouvres = []; for (let k = 1; ouvres.length < 6; k++) { const d = addDays(TODAY, -k); if (estOuvre(d)) ouvres.push(d); }
    const ids = ['A','B','C','D','E','F','G','H','I'];
    DB.employees = ids.map((id,i) => ({id, matricule:String(i+1), prenom:'P'+id, nom:'N'+id, sexe:'F', actif:id!=='H', adresse:id==='A'?'':'Nabeul'}));
    const P = {statut:'present',entree:'07:30',sortie:'16:30'}, ABS = {statut:'absent',entree:'',sortie:''};
    DB.pointages = {};
    [TODAY, ...ouvres].forEach(d => { DB.pointages[d] = {}; ids.forEach(id => DB.pointages[d][id] = P); });
    const absent = (id, n) => ouvres.slice(0, n).forEach(d => DB.pointages[d][id] = ABS);
    ['A','B','C','D','F','G','H','I'].forEach(id => absent(id, 3)); absent('E', 1);
    DB.pointages[TODAY].A = ABS; DB.pointages[TODAY].B = ABS;
    DB.pointages[TODAY].F = {statut:'present',entree:'09:40',sortie:''};      // revenue ce matin
    delete DB.pointages[ouvres[1]].G;                                        // jour sans enregistrement
    DB.employees.find(e => e.id === 'I').embauche = TODAY;                    // embauchée aujourd'hui
    DB.absences = [{id:'B',debut:ouvres[2],fin:TODAY,statut:'justifiée'}];
    DB.conges = [{id:'C',debut:ouvres[2],fin:ouvres[0],statut:'En attente'}];
    const r1 = absencesSansJustif().map(x => x.id + x.jours.length + (x.sansAdresse ? '-sansAdresse' : ''));
    /* deux jours seulement, dont celui d'avant-hier : 48 h écoulées → alerte */
    absent('D', 2); ouvres.slice(2).forEach(d => DB.pointages[d].D = P); DB.pointages[TODAY].D = ABS;
    const r2 = absencesSansJustif().map(x => x.id + x.jours.length);
    const r3 = absencesSansJustif(5).map(x => x.id);
    DB.employees = sv.e; DB.pointages = sv.p; DB.absences = sv.a; DB.conges = sv.c; DB.settings = sv.s; ENGINE.invalidate();
    return {r1, r2, r3};
  });
  t('3 jours sans justificatif : alerte (et adresse manquante signalée)', regl.r1.includes('A3-sansAdresse'), regl.r1);
  t('couvert par un justificatif : pas d\'alerte', !regl.r1.some(x => x[0]==='B'));
  t('une demande de congé, même en attente, suffit : pas d\'alerte', !regl.r1.some(x => x[0]==='C'));
  t('absente un seul jour : pas d\'alerte', !regl.r1.some(x => x[0]==='E'));
  t('revenue ce matin (a badgé) : pas d\'alerte', !regl.r1.some(x => x[0]==='F'));
  t('un jour sans enregistrement arrête le décompte (on ne conclut pas sans données)', !regl.r1.some(x => x[0]==='G'));
  t('sortie de l\'effectif : pas d\'alerte', !regl.r1.some(x => x[0]==='H'));
  t('embauchée aujourd\'hui : pas d\'alerte pour des jours d\'avant son arrivée', !regl.r1.some(x => x[0]==='I'));
  t('deux jours ouvrés complets sans nouvelles, 48 h passées : alerte', regl.r2.includes('D2'), regl.r2);
  eg('le seuil est réglable (5 jours : plus personne)', regl.r3, []);

  /* ======================================================================== */
  console.log('\n--- Assiduité : le calcul, sur des données faites à la main ---');
  /* Semaine du lundi 05/10/2026 au samedi 10/10/2026, horaire 07:30–16:30, tolérance 15 min.
     A : présente 4 j dont 2 retards (07:50, 08:10), absente mardi (injustifiée), absente jeudi (justifiée)
     B : toujours à l'heure        C : arrive dans l'entreprise le jeudi                         */
  const as = await page.evaluate(() => {
    const sauve = { e:DB.employees, p:DB.pointages, a:DB.absences, s:JSON.parse(JSON.stringify(DB.settings)) };
    const J = {actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15};
    DB.settings.jours = {0:{actif:false},1:J,2:J,3:J,4:J,5:J,6:Object.assign({},J,{fin:'13:00',pause:0})};
    DB.settings.periodes=[]; DB.settings.feries=[]; DB.settings.feriesFixes=[]; DB.settings.suivi={retards:2,absences:1};
    ENGINE.invalidate();
    DB.employees = [{id:'A',matricule:'1',prenom:'Amel',nom:'A',sexe:'F',actif:true,service:'Couture'},
                    {id:'B',matricule:'2',prenom:'Besma',nom:'B',sexe:'F',actif:true,service:'Coupe'},
                    {id:'C',matricule:'3',prenom:'Chokri',nom:'C',sexe:'H',actif:true,service:'Couture'},
                    {id:'Z',matricule:'9',prenom:'Partie',nom:'Z',sexe:'F',actif:false}];
    const P = (e,s)=>({statut:'present',entree:e,sortie:s}), ABS={statut:'absent',entree:'',sortie:''};
    DB.pointages = {
      '2026-10-04': {A:ABS,B:ABS,C:ABS},                                   // dimanche : repos
      '2026-10-05': {A:P('07:50','16:30'), B:P('07:30','16:30'), C:ABS},
      '2026-10-06': {A:ABS,                 B:P('07:28','16:31'), C:ABS},
      '2026-10-07': {A:P('08:10','16:30'), B:P('07:44','16:30'), C:ABS},   // 07:44 : dans la tolérance
      '2026-10-08': {A:ABS,                 B:P('07:30','16:30'), C:P('07:30','16:30')},
      '2026-10-09': {A:P('07:30','16:30'), B:P('07:30','16:30'), C:P('07:31','')},   // C : sortie non badgée
      '2026-10-10': {A:P('07:30','13:00'), B:{statut:'leave',entree:'',sortie:''}, C:ABS},
    };
    DB.absences = [{id:'A',type:'Maladie',debut:'2026-10-08',fin:'2026-10-08',jours:1,statut:'justifiée'}];
    const r = calcAssiduite('2026-10-01','2026-10-31');
    const L = id => { const s=r.lignes.find(x=>x.e.id===id); return s && {attendus:s.attendus,pres:s.pres,absI:s.absI,absJ:s.absJ,conge:s.conge,
        ret:s.ret,retMin:s.retMin,inc:s.inc,taux:s.taux,alerteRet:s.alerteRet,alerteAbs:s.alerteAbs,mois:s.mois['2026-10'],ev:s.ev.map(v=>v.ds.slice(8)+v.type)}; };
    const out = {A:L('A'),B:L('B'),C:L('C'),Z:L('Z')||null,tot:r.tot,jsem:r.parJsem,mois:r.mois};
    window.__sauve = sauve;
    return out;
  });
  eg('A : 6 jours attendus (le dimanche ne compte pas)', as.A.attendus, 6);
  eg('A : 4 présences', as.A.pres, 4);
  eg('A : 1 absence injustifiée (mardi)', as.A.absI, 1);
  eg('A : 1 absence justifiée (jeudi, couverte par un justificatif)', as.A.absJ, 1);
  eg('A : 2 retards', as.A.ret, 2);
  eg('A : 60 minutes de retard (20 + 40, comptées depuis l\'heure prévue)', as.A.retMin, 60);
  eg('A : taux 2/6 = 33,3 %', as.A.taux, 33.3);
  eg('A : signalée pour les retards (seuil 2) et les absences (seuil 1)', [as.A.alerteRet,as.A.alerteAbs], [true,true]);
  eg('A : le mois porte 2 absences et 2 retards', as.A.mois, {abs:2,ret:2});
  eg('A : événements dans l\'ordre', as.A.ev, ['05ret','06absI','07ret','08absJ']);
  eg('B : 07:44 est dans la tolérance de 15 min — aucun retard', as.B.ret, 0);
  eg('B : le congé du samedi est attendu mais n\'est pas une absence', [as.B.attendus,as.B.conge,as.B.absI], [6,1,0]);
  eg('B : taux 0', as.B.taux, 0);
  eg('C : les jours d\'avant sa première présence ne sont pas des absences', [as.C.attendus,as.C.absI], [3,1]);
  eg('C : la sortie non badgée est signalée comme pointage incomplet', as.C.inc, 1);
  eg('une personne sortie de l\'effectif n\'apparaît pas', as.Z, null);
  eg('total : 15 jours attendus, 3 absences', [as.tot.attendus,as.tot.abs], [15,3]);
  eg('total : taux 20 %', as.tot.taux, 20);
  eg('répartition par jour de semaine (mardi, jeudi, samedi)', as.jsem, [0,0,1,0,1,0,1]);

  console.log('\n--- Corrections : la détection ---');
  const det = await page.evaluate(() => {
    const P = (e,s)=>({statut:'present',entree:e,sortie:s});
    const emp5 = ['A','B','C','D','E','F'].map((id,i)=>({id,matricule:String(i+1),prenom:'P'+id,nom:'N'+id,sexe:'F',actif:true}));
    DB.employees = emp5;
    DB.pointages = {
      /* lundi 12 : 5 sur 6 n'ont que le badge du matin -> panne collective ; F déjà corrigée à la main */
      '2026-10-12': {A:P('07:30',''),B:P('07:29',''),C:P('07:31',''),D:P('07:28',''),E:P('07:30',''),F:{statut:'present',entree:'07:30',sortie:'',hM:480,manuel:1}},
      /* mardi 13 : un oubli individuel + trois badges + une entrée à 22 h + un badge après minuit */
      '2026-10-13': {A:P('07:30','16:30'),B:P('07:30',''),C:{statut:'present',punches:['07:30','12:00','16:30']},
                     D:P('22:05',''),E:{statut:'present',punches:['00:40','07:30']},F:P('07:30','16:30')},
      /* mercredi 14 : tout le monde commence à 06 h 30 */
      '2026-10-14': {A:P('06:28','16:30'),B:P('06:31','16:30'),C:P('06:29','16:32'),D:P('06:30','16:30'),E:P('07:05','16:30'),F:P('07:30','16:30')},
    };
    ENGINE.invalidate();
    const r = detecterAnomalies('2026-10-01','2026-10-31');
    window.__det = r;
    const j = ds => ({presents:r.jours[ds].presents, n:r.jours[ds].n, col:r.jours[ds].collectif});
    return {total:r.total, deja:r.dejaCorrigees, j12:j('2026-10-12'), j13:j('2026-10-13'), j14:j('2026-10-14'),
            cles:r.items.map(x=>x.cle.slice(8)+':'+x.fam).sort()};
  });
  eg('sorties non badgées : 5 (lundi) + 1 (mardi) + 1 (entrée de 22 h, seule)', det.total.sortie, 7);
  eg('badges impairs : 1', det.total.impair, 1);
  eg('heures de nuit : l\'entrée de 22 h et le badge de 00 h 40', det.total.nuit, 2);
  eg('démarrage anticipé : 4 (07:05 est à moins de 30 min de l\'horaire)', det.total.tot, 4);
  eg('la journée déjà corrigée à la main n\'est plus proposée', det.deja, 1);
  eg('lundi : 5 sur 6 -> panne collective', [det.j12.n.sortie, det.j12.presents, det.j12.col.sortie], [5,6,true]);
  eg('mardi : un oubli isolé reste individuel', det.j13.col.sortie, false);
  eg('mercredi : 4 sur 6 en avance -> démarrage collectif', [det.j14.n.tot, det.j14.col.tot], [4,true]);
  t('un badge de nuit n\'est pas compté en plus comme « démarrage anticipé »', !det.cles.includes('13|E:tot'), det.cles);

  console.log('\n--- Corrections : chaque règle, cas par cas ---');
  const cor = await page.evaluate(() => {
    const it = (cle,fam) => __det.items.find(x=>x.cle===cle&&x.fam===fam);
    const un = (cle,fam,action,opt) => { const r=corrigerUn(it(cle,fam),action,opt||{}); return r.rec?{e:r.rec.entree,s:r.rec.sortie,st:r.rec.statut,hM:r.rec.hM,m:r.rec.manuel,p:r.rec.punches,src:r.rec.src}:{refus:r.refus}; };
    const h = (cle,fam,action,opt) => { const x=it(cle,fam), r=corrigerUn(x,action,opt||{}); const m=metrics(r.rec,x.ds); return m.heures+m.hs; };
    return {
      sortieRegime: un('2026-10-12|A','sortie','sortie',{mode:'regime'}),
      sortieFixe:   un('2026-10-12|A','sortie','sortie',{mode:'fixe',heure:'15:00'}),
      sortieAvant:  un('2026-10-12|A','sortie','sortie',{mode:'fixe',heure:'07:00'}),
      sortieNuit:   un('2026-10-13|D','sortie','sortie',{mode:'regime'}),
      horaireNuit:  un('2026-10-13|D','nuit','horaire'),
      horaireMinuit:un('2026-10-13|E','nuit','horaire'),
      entreeFixe:   un('2026-10-13|E','nuit','entree',{mode:'fixe',heure:'07:30'}),
      heures:       un('2026-10-12|B','sortie','heures',{minutes:480}),
      heuresVide:   un('2026-10-12|B','sortie','heures',{minutes:null}),
      absent:       un('2026-10-12|C','sortie','absent'),
      impair:       un('2026-10-13|C','impair','horaire'),
      hSortieRegime: h('2026-10-12|A','sortie','sortie',{mode:'regime'}),
      hHeures:       h('2026-10-12|B','sortie','heures',{minutes:450}),
      lire: ['8','8,5','8h30','7:45','abc','','25'].map(lireHeures),
    };
  });
  eg('sortie à l\'heure prévue : 07:30 → 16:30', [cor.sortieRegime.e,cor.sortieRegime.s], ['07:30','16:30']);
  eg('la journée corrigée est marquée manuelle (protégée des réimports)', [cor.sortieRegime.m,cor.sortieRegime.src], [1,'correction']);
  eg('les anciens badges sont remplacés, pas additionnés', cor.sortieRegime.p, null);
  eg('elle compte désormais 8 h 30 (9 h moins 30 min de pause)', cor.hSortieRegime, 510);
  eg('sortie à une heure précise', cor.sortieFixe.s, '15:00');
  t('sortie avant l\'entrée : refusée, avec la raison', /avant l’entrée/.test(cor.sortieAvant.refus||''), cor.sortieAvant);
  t('entrée à 22 h + sortie prévue 16 h 30 : refusée plutôt que d\'écrire une journée à l\'envers', /avant l’entrée/.test(cor.sortieNuit.refus||''), cor.sortieNuit);
  eg('« horaire prévu » sur une entrée de 22 h : 07:30 → 16:30', [cor.horaireNuit.e,cor.horaireNuit.s], ['07:30','16:30']);
  eg('« horaire prévu » sur un badge d\'après minuit', [cor.horaireMinuit.e,cor.horaireMinuit.s], ['07:30','16:30']);
  t('entrée fixée à l\'heure du dernier badge : refusée (journée de durée nulle)', !!cor.entreeFixe.refus, cor.entreeFixe);
  eg('heures saisies : 8 h, entrée d\'origine gardée', [cor.heures.hM,cor.heures.e,cor.heures.st], [480,'07:29','present']);
  eg('7 h 30 saisies comptent 7 h 30', cor.hHeures, 450);
  t('nombre d\'heures absent : refusé', !!cor.heuresVide.refus);
  eg('marquer absent', [cor.absent.st,cor.absent.e,cor.absent.s], ['absent','','']);
  eg('badges impairs → horaire prévu', [cor.impair.e,cor.impair.s], ['07:30','16:30']);
  eg('lecture des heures : 8 · 8,5 · 8h30 · 7:45 · refus', cor.lire, [480,510,510,465,null,null,null]);

  console.log('\n--- Documents en arabe : accords, variables, antécédents ---');
  const doc = await page.evaluate(async () => {
    await discCharger();
    const O = DISC_OUTILS;
    O.donnees = {societe:{nom:'DBS Fashion',nomAr:'شركة دي بي أس فاشن',villeAr:'نابل',qualiteAr:'المدير العام'}, modeles:{}, entrees:[
      {id:'q1',ref:'Q-2026-001',emp:'A',type:'questionnaire',date:'2026-10-20',statut:'remis',reponse:''},
      {id:'q2',ref:'Q-2026-002',emp:'A',type:'questionnaire',date:'2026-10-21',statut:'signe',reponse:'pas de transport'},
      {id:'a1',ref:'AV-2026-001',emp:'A',type:'avertissement',date:'2026-09-01',statut:'signe'},
      {id:'a2',ref:'AV-2026-009',emp:'A',type:'avertissement',date:'2026-09-15',statut:'brouillon'},
      {id:'a3',ref:'BL-2026-001',emp:'B',type:'blame',date:'2026-09-15',statut:'signe'}]};
    DB.employees[0].nomAr='أمل بن صالح'; DB.employees[0].poste='Couturière piqueuse'; DB.employees[0].atelier='Atelier B';
    DB.employees[2].sexe='H'; DB.employees[2].poste='Magasinier';
    const base = {id:'n',ref:'AV-2026-002',emp:'A',date:'2026-10-26',motif:'retards',date_faits:'2026-10-23',faits:'',corps:''};
    const evR = [{ds:'2026-10-05',min:20,heure:'07:50'},{ds:'2026-10-07',min:40,heure:'08:10'}];
    return {
      faitsRet: faitsDepuisEvenements('retards',evR,'2026-10-01','2026-10-31'),
      faitsAbs: faitsDepuisEvenements('absence',[{ds:'2026-10-06'}],'2026-10-01','2026-10-31'),
      faitsVide: faitsDepuisEvenements('retards',[],'a','b'),
      avSansRep: corpsDepuisModele(Object.assign({},base,{type:'avertissement',suite_de:'q1'})),
      avAvecRep: corpsDepuisModele(Object.assign({},base,{type:'avertissement',suite_de:'q2'})),
      avSeul:    corpsDepuisModele(Object.assign({},base,{type:'avertissement',emp:'D'})),
      quest:     corpsDepuisModele(Object.assign({},base,{type:'questionnaire',delai_h:72,faits:'نص الوقائع'})),
      mp:        corpsDepuisModele(Object.assign({},base,{type:'miseapied',jours:2,du:'2026-10-27'})),   // mardi
      mpVendredi:corpsDepuisModele(Object.assign({},base,{type:'miseapied',jours:3,du:'2026-10-30'})),   // vendredi : enjambe le dimanche
      htmlF: discHtml(Object.assign({},base,{type:'avertissement'})),
      htmlH: discHtml(Object.assign({},base,{type:'questionnaire',emp:'C'})),
      htmlPV: discHtml(Object.assign({},base,{type:'pv',motif:'signature'})),
      htmlFige: discHtml(Object.assign({},base,{type:'avertissement',corps:'نص حرّره المسؤول بيده'})),
      xss: discHtml(Object.assign({},base,{type:'avertissement',faits:'<img src=x onerror="window.__XSSD=1">'})),
      jours: [1,2,3,10,11].map(O.joursAr), fois:[1,2,5,12].map(O.foisAr),
      genre: [O.genre('[السيد|السيدة] X',true), O.genre('[السيد|السيدة] X',false)],
      fin: [O.finMiseAPied('2026-10-27',2), O.finMiseAPied('2026-10-30',3)],
      titres: Object.keys(O.TYPES).map(k=>O.TYPES[k].ar),
      tousModeles: Object.keys(O.TYPES).every(k=>O.MODELES[k] && O.MODELES[k].length>80),
    };
  });
  t('faits « retards » : nombre de fois, période et chaque date avec l\'heure d\'arrivée',
    /مناسبتين/.test(doc.faitsRet) && /01\/10\/2026/.test(doc.faitsRet) && /05\/10\/2026: الحضور على الساعة 07:50 \(تأخير بـ 20 دقيقة\)/.test(doc.faitsRet) && /الأربعاء 07\/10\/2026/.test(doc.faitsRet), doc.faitsRet);
  t('faits « absence » : durée et jour de la semaine', /يوم واحد/.test(doc.faitsAbs) && /الثلاثاء 06\/10\/2026/.test(doc.faitsAbs), doc.faitsAbs);
  eg('aucun événement : aucun texte inventé', doc.faitsVide, '');
  t('avertissement après un questionnaire resté sans réponse : le dit', /تبعا للاستجواب عدد Q-2026-001/.test(doc.avSansRep) && /بقي دون ردّ/.test(doc.avSansRep), doc.avSansRep);
  t('après un questionnaire avec réponse : formule différente', /Q-2026-002/.test(doc.avAvecRep) && /بعد الاطّلاع على إجابتك/.test(doc.avAvecRep) && !/بقي دون ردّ/.test(doc.avAvecRep));
  t('les antécédents réellement remis sont rappelés', /سبق أن وُجّه إليك: إنذار عدد AV-2026-001 بتاريخ 01\/09\/2026/.test(doc.avSansRep), doc.avSansRep);
  t('un brouillon n\'est pas un antécédent', !/AV-2026-009/.test(doc.avSansRep));
  t('les pièces d\'une autre personne n\'apparaissent pas', !/BL-2026-001/.test(doc.avSansRep));
  t('sans questionnaire ni antécédent : aucune ligne vide ni variable oubliée', !/\{|\}/.test(doc.avSeul) && !/تبعا لل/.test(doc.avSeul) && !/سبق أن/.test(doc.avSeul) && !/\n\n/.test(doc.avSeul), doc.avSeul);
  t('date des faits en toutes lettres (mois tunisiens)', /23 أكتوبر 2026/.test(doc.avSeul));
  t('questionnaire : délai repris, faits insérés', /72 ساعة/.test(doc.quest) && /نص الوقائع/.test(doc.quest));
  t('mise à pied de 2 jours du mardi 27 : jusqu\'au mercredi 28, reprise le jeudi 29',
    /لمدّة يومين/.test(doc.mp) && /الثلاثاء 27 أكتوبر 2026/.test(doc.mp) && /الأربعاء 28 أكتوبر 2026/.test(doc.mp) && /الخميس 29 أكتوبر 2026/.test(doc.mp), doc.mp);
  eg('3 jours à partir du vendredi : le dimanche ne compte pas (ven, sam, lun → reprise mardi)', doc.fin[1], {au:'2026-11-02',reprise:'2026-11-03'});
  eg('2 jours à partir du mardi', doc.fin[0], {au:'2026-10-28',reprise:'2026-10-29'});
  eg('pluriel arabe des jours', doc.jours, ['يوم واحد','يومين','3 أيام','10 أيام','11 يوما']);
  eg('pluriel arabe des occurrences', doc.fois, ['مناسبة واحدة','مناسبتين','5 مناسبات','12 مناسبة']);
  eg('accord au féminin et au masculin', doc.genre, ['السيدة X','السيد X']);
  t('document d\'une femme : « إلى السيدة » et « المعنية »', /إلى السيدة:/.test(doc.htmlF) && /إمضاء المعنية بالأمر/.test(doc.htmlF) && !/إلى السيد:/.test(doc.htmlF));
  t('document d\'un homme : « إلى السيد » et « المعني »', /إلى السيد:/.test(doc.htmlH) && /جواب المعني بالأمر/.test(doc.htmlH) && !/السيدة/.test(doc.htmlH));
  t('nom en arabe de la fiche utilisé', /أمل بن صالح/.test(doc.htmlF));
  t('poste traduit et accordé (عاملة خياطة / أمين مخزن)', /عاملة خياطة/.test(doc.htmlF) && /أمين مخزن/.test(doc.htmlH), '');
  t('atelier traduit', /الورشة B/.test(doc.htmlF));
  t('document de droite à gauche, en arabe', /<html lang="ar" dir="rtl">/.test(doc.htmlF));
  t('en-tête société, ville, référence', /شركة دي بي أس فاشن/.test(doc.htmlF) && /نابل في 26 أكتوبر 2026/.test(doc.htmlF) && /AV-2026-002/.test(doc.htmlF));
  t('titre du document', /<h1>إنذار<\/h1>/.test(doc.htmlF));
  t('format A4 pour l\'impression', /@page\{size:A4/.test(doc.htmlF));
  t('questionnaire : zone de réponse manuscrite', (doc.htmlH.match(/class="ligne"/g)||[]).length===5);
  t('mention des deux témoins en cas de refus de signer', /في صورة رفض الإمضاء/.test(doc.htmlF));
  t('PV : deux témoins et la direction, pas de destinataire', /الشاهد الأول/.test(doc.htmlPV) && /الشاهد الثاني/.test(doc.htmlPV) && !/class="dest"/.test(doc.htmlPV));
  t('un texte modifié à la main est imprimé tel quel, sans retour au modèle', /نص حرّره المسؤول بيده/.test(doc.htmlFige) && !/قرّرت إدارة المؤسسة/.test(doc.htmlFige));
  t('des faits contenant du HTML sont imprimés comme du texte', /&lt;img src=x/.test(doc.xss) && !/<img src=x/.test(doc.xss));
  eg('neuf types de pièces (dont la lettre recommandée), chacun avec son titre arabe', doc.titres.length, 9);
  t('chaque type a son modèle', doc.tousModeles);

  console.log('\n--- Passages : 1re entrée, 1re sortie, 2e entrée, 2e sortie ---');
  const ps = await page.evaluate(() => {
    const V = v => { const r = verifierPassages(v); return r.ok ? {ok:true, p:r.passages, avis:!!r.avis} : {ok:false, e:r.erreur}; };
    const rec = (base, l) => { const r = recDepuisPassages(base, l); return {st:r.statut, e:r.entree, s:r.sortie, p:r.punches||null, hM:r.hM, m:r.manuel, src:r.src}; };
    DB.settings.jours = {0:{actif:false},1:{actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15}};
    ENGINE.invalidate();
    const h = l => { const m = metrics(recDepuisPassages({}, l), '2026-10-05'); return [m.heures, m.revue]; };
    return {
      quatre: V(['07:30','12:00','12:30','16:30']), trois: V(['07:30','12:00','12:30','']),
      trou: V(['07:30','','12:30','16:30']), ordre: V(['07:30','12:30','12:00','16:30']),
      vide: V(['','','','']), invalide: V(['07:30','25:99','','']), six: V(['07:30','10:00','10:15','12:00','12:30','16:30']),
      lib: [0,1,2,3,4,5].map(libellePassage),
      r2: rec({statut:'present',punches:['07:30','12:00','12:30'],hM:300,hsM:20}, ['07:30','16:30']),
      r4: rec({statut:'present',entree:'07:30',sortie:''}, ['07:30','12:00','12:30','16:30']),
      rAut: rec({statut:'autorisation'}, ['07:30','11:00']),
      h4: h(['07:30','12:00','12:30','16:30']), h3: h(['07:30','12:00','12:30']), hPause: h(['07:30','11:00','13:00','16:30']),
      lu: passagesDe({entree:'07:30',sortie:'16:30'}).concat(['|'], passagesDe({punches:['07:31','12:02','12:41']}), ['|'], passagesDe(null)),
    };
  });
  eg('quatre passages dans l\'ordre : acceptés', ps.quatre, {ok:true, p:['07:30','12:00','12:30','16:30'], avis:false});
  eg('trois passages : acceptés, mais signalés impairs', ps.trois, {ok:true, p:['07:30','12:00','12:30'], avis:true});
  t('une case vide au milieu : refusée, en nommant la case', !ps.trou.ok && /1re sortie/.test(ps.trou.e), ps.trou.e);
  t('heures dans le désordre : refusées, en nommant les deux cases', !ps.ordre.ok && /2e entrée/.test(ps.ordre.e) && /1re sortie/.test(ps.ordre.e), ps.ordre.e);
  t('rien de saisi : refusé', !ps.vide.ok && /1re entrée/.test(ps.vide.e));
  t('heure impossible : refusée', !ps.invalide.ok && /non comprise/.test(ps.invalide.e), ps.invalide.e);
  eg('trois coupures (6 passages) : acceptées', ps.six.ok, true);
  eg('libellés des cases', ps.lib, ['1re entrée','1re sortie','2e entrée','2e sortie','3e entrée','3e sortie']);
  eg('deux passages : une entrée et une sortie simples, sans liste', [ps.r2.e, ps.r2.s, ps.r2.p], ['07:30','16:30',null]);
  eg('les heures saisies à la main sont remplacées par le calcul des passages', ps.r2.hM, undefined);
  eg('quatre passages : la liste est gardée', ps.r4.p, ['07:30','12:00','12:30','16:30']);
  eg('la journée corrigée est protégée des imports', [ps.r4.m, ps.r4.src, ps.r4.st], [1,'manuel','present']);
  eg('une autorisation reste une autorisation', ps.rAut.st, 'autorisation');
  eg('07:30-12:00 + 12:30-16:30 = 8 h 30, plus « à vérifier »', ps.h4, [510, false]);
  eg('trois passages : toujours « à vérifier »', ps.h3[1], true);
  eg('sortie de 11:00 à 13:00 : la pause n\'est pas déduite une seconde fois (7 h)', ps.hPause, [420, false]);
  eg('lecture des passages existants', ps.lu, ['07:30','16:30','|','07:31','12:02','12:41','|']);

  console.log('\n--- Passages : à l\'écran, jusqu\'à ce qui part vers le serveur ---');
  await page.evaluate(() => { DB.settings = JSON.parse(JSON.stringify(__sauve.s)); ENGINE.invalidate(); });
  const dsPas = await page.evaluate(async () => { for (let k = 1; k < 60; k++) { const d = addDays(TODAY, -k);
    if (estOuvre(d) && regimeFor(d).fin === '16:30') { await ensureRange(d, d); DB.pointages[d] = Object.assign({}, __sauve.p[d] || DB.pointages[d] || {});
      DB.pointages[d]['E003'] = {statut:'present', punches:['07:31','12:02','12:41']}; return d; } } });
  await page.evaluate(d => { DB.employees = __sauve.e; PRES_DATE = d; return go('presences'); }, dsPas); await page.waitForTimeout(800);
  const ligne = page.locator('tr[data-emp="E003"]');
  t('journée impaire : bouton « 3 passages — compléter » sur la ligne', /3 passages — compléter/.test(await ligne.innerText()));
  await ligne.locator('button:has-text("compléter")').click(); await page.waitForSelector('#psGrille input');
  t('six cases d\'office : 3 entrées et 3 sorties', (await page.locator('#psGrille label').allInnerTexts()).map(x=>x.split(' —')[0]).join('|') === '1re entrée|1re sortie|2e entrée|2e sortie|3e entrée|3e sortie');
  t('préremplies avec les badges lus', (await page.inputValue('#ps0'))==='07:31' && (await page.inputValue('#ps1'))==='12:02' && (await page.inputValue('#ps2'))==='12:41' && (await page.inputValue('#ps3'))==='');
  t('la case manquante est désignée : « 2e sortie — non badgée »', /2e sortie — non badgée/.test(await page.locator('#psGrille').innerText()));
  t('l\'horaire prévu est rappelé', /Horaire prévu ce jour : 07:30 → 16:30/.test(await page.locator('.modal-body').innerText()));
  await page.fill('#ps3','16:30'); await page.dispatchEvent('#ps3','input'); await page.waitForTimeout(150);
  t('aperçu immédiat des heures', /07:31 → 12:02 · 12:41 → 16:30/.test(await page.locator('#psApercu').innerText()) && /8h18/.test(await page.locator('#psApercu').innerText()), await page.locator('#psApercu').innerText());
  await page.fill('#ps2','11:00'); await page.dispatchEvent('#ps2','input'); await page.waitForTimeout(150);
  t('une erreur bloque l\'enregistrement et dit pourquoi', await page.locator('#psOk').isDisabled() && /doit être après/.test(await page.locator('#psApercu').innerText()));
  await page.fill('#ps2','12:41'); await page.dispatchEvent('#ps2','input'); await page.waitForTimeout(150);
  await page.fill('#ps3','14:00'); await page.dispatchEvent('#ps3','input');
  await page.fill('#ps4','14:20'); await page.dispatchEvent('#ps4','input');
  await page.fill('#ps5','16:30'); await page.dispatchEvent('#ps5','input'); await page.waitForTimeout(150);
  t('3 entrées et 3 sorties : trois segments calculés', /07:31 → 12:02 · 12:41 → 14:00 · 14:20 → 16:30/.test(await page.locator('#psApercu').innerText()) && /7h58/.test(await page.locator('#psApercu').innerText()), await page.locator('#psApercu').innerText());
  await page.click('button:has-text("+ Ajouter un passage")'); await page.waitForTimeout(150);
  t('« + Ajouter un passage » ajoute une 4e entrée et une 4e sortie, valeurs gardées', await page.locator('#psGrille input').count()===8 && (await page.inputValue('#ps5'))==='16:30');
  t('au-delà de 4 coupures, le bouton disparaît', !(await page.locator('#psPlus').isVisible()));
  for (const i of [5,4]) { await page.fill('#ps'+i,''); await page.dispatchEvent('#ps'+i,'input'); }
  await page.fill('#ps3','16:30'); await page.dispatchEvent('#ps3','input'); await page.waitForTimeout(150);
  const nAvant = (await (await page.request.get('http://localhost:8777/api/__pointage')).json()).length;
  await page.click('#psOk'); await page.waitForTimeout(800);
  const envois = await (await page.request.get('http://localhost:8777/api/__pointage')).json();
  const dern = envois[envois.length-1];
  t('un seul enregistrement part vers le serveur', envois.length === nAvant+1);
  eg('avec les quatre passages, marqué manuel', dern && [dern.date, dern.id, dern.punches, dern.entree, dern.sortie, dern.manuel], [dsPas, 'E003', ['07:31','12:02','12:41','16:30'], '07:31', '16:30', 1]);
  const l2 = await page.locator('tr[data-emp="E003"]').innerText();
  t('la ligne affiche maintenant « 4 passages », sans « à vérifier »', /4 passages/.test(l2) && !/à vérifier/.test(l2), l2);
  t('et la journée est protégée (cadenas)', await page.locator('tr[data-emp="E003"] button[aria-label="Journée protégée"]').count()===1);
  await page.locator('tr[data-emp="E003"] button:has-text("4 passages")').click(); await page.waitForSelector('#psGrille input');
  t('à la réouverture : « déjà corrigé à la main »', /déjà corrigé à la main/.test(await page.locator('.modal-body').innerText()));
  await page.evaluate(()=>closeModal());
  const lectPas = await page.evaluate(async d => { const v=ME.role; ME.role='lecture'; openPassages(d,'E003',''); await new Promise(r=>setTimeout(r,100));
    const r={dis:[...document.querySelectorAll('#psGrille input')].every(i=>i.disabled), ok:!!document.getElementById('psOk')}; closeModal(); ME.role=v; return r; }, dsPas);
  eg('un compte en lecture seule consulte les passages sans pouvoir les modifier', [lectPas.dis, lectPas.ok], [true, false]);

  /* on rend les vraies données de démonstration */
  await page.evaluate(() => { DB.employees=__sauve.e; DB.pointages=__sauve.p; DB.absences=__sauve.a; DB.settings=__sauve.s; ENGINE.invalidate(); DISC_OUTILS.donnees=null; });

  /* ======================================================================== */
  console.log('\n--- Écran Assiduité ---');
  t('entrée « Assiduité » dans le menu', await page.locator('#nav [data-v="assiduite"]').count()===1);
  await aller('assiduite');
  await page.waitForSelector('#asBody tr');
  t('cinq indicateurs', await page.locator('.kpi').count()===5);
  t('les deux graphiques sont dessinés', await page.locator('#asMois svg rect').count()>=2 && await page.locator('#asJsem svg rect').count()>=5);
  const n0 = await page.locator('#asBody tr').count();
  t('une ligne par personne', n0>=100, n0);
  const col1 = await page.locator('#asTbl thead').innerText();
  t('colonnes par mois', /oct\. 26/i.test(col1) && /nov\. 26/i.test(col1), col1);
  await page.check('#asSeul'); await page.waitForTimeout(200);
  const n1 = await page.locator('#asBody tr').count();
  const nSig = +(await page.locator('.kpi').nth(4).locator('.val').innerText());
  t('« seulement les personnes signalées » ne garde que celles-là', n1>0 && n1===nSig && n1<=n0, n1+' / '+nSig+' / '+n0);
  t('chaque ligne restante porte une étiquette « seuil »', await page.locator('#asBody tr .tag').count()>=n1);
  await page.uncheck('#asSeul');
  await page.fill('#asQ','Nom11'); await page.waitForTimeout(200);
  t('recherche par nom', (await page.locator('#asBody tr').count())<=11 && (await page.locator('#asBody').innerText()).includes('Nom11'));
  await page.fill('#asQ',''); await page.waitForTimeout(150);
  await page.fill('#asSR','50'); await page.dispatchEvent('#asSR','change'); await page.waitForTimeout(800);
  t('relever le seuil des retards fait baisser le nombre de personnes signalées',
    +(await page.locator('.kpi').nth(4).locator('.val').innerText()) < 118, await page.locator('.kpi').nth(4).innerText());
  await page.click('button:has-text("12 mois")'); await page.waitForTimeout(1200);
  t('raccourci « 12 mois » : la période s\'élargit', (await page.inputValue('#asFrom')) < (await page.evaluate(()=>addDays(TODAY,-300))));
  await page.click('button:has-text("3 mois")'); await page.waitForTimeout(900);
  const [dl1] = await Promise.all([page.waitForEvent('download',{timeout:8000}).catch(()=>null), page.click('button:has-text("Synthèse CSV")')]);
  t('export CSV de synthèse', dl1 && /^assiduite_\d{4}/.test(dl1.suggestedFilename()), dl1&&dl1.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent('download',{timeout:8000}).catch(()=>null), page.click('button:has-text("Détail CSV")')]);
  t('export CSV du détail', dl2 && /^assiduite_detail_/.test(dl2.suggestedFilename()));
  const idR = await page.evaluate(()=>calcAssiduite(document.getElementById('asFrom').value,TODAY).lignes.find(s=>s.ret>=2&&s.absI>=1&&s.e.sexe!=='H'&&!/[<"]/.test(s.e.prenom+s.e.nom)).e.id);
  await page.evaluate(id=>openAssiduite(id), idR); await page.waitForSelector('.modal-body');
  const det1 = await page.locator('.modal-body').innerText();
  t('détail d\'une personne : frise mois par mois et légende', /Présente/.test(det1) && /Absence injustifiée/.test(det1) && await page.locator('.modal-body span[title]').count()>30);
  t('liste datée des événements', await page.locator('.modal-body table tbody tr').count()>=3);
  t('depuis le détail, un questionnaire peut être préparé', await page.locator('.modal-foot button:has-text("Questionnaire — retards")').count()===1);
  await page.screenshot({ path:'./captures/vue_assiduite_detail.png' });

  console.log('\n--- De l\'assiduité au document prérempli ---');
  await page.click('.modal-foot button:has-text("Questionnaire — retards")');
  await page.waitForSelector('#dCorps');
  t('la personne est déjà choisie', (await page.inputValue('#dEmp'))===idR);
  t('le motif est déjà « retards »', (await page.inputValue('#dMotif'))==='retards');
  const faits = await page.inputValue('#dFaits');
  t('les faits sont préremplis depuis le pointage, en arabe', /سُجّل تأخّرك/.test(faits) && /\d{2}\/\d{2}\/\d{4}: الحضور على الساعة/.test(faits), faits.slice(0,200));
  t('la date des faits est proposée', /^\d{4}-\d{2}-\d{2}$/.test(await page.inputValue('#dFaitsLe')));
  const corps = await page.inputValue('#dCorps');
  t('le texte du document reprend ces faits', corps.includes(faits.split('\n')[1]) && /48 ساعة/.test(corps));
  t('conseil affiché : commencer par un questionnaire', /commencer par un/.test(await page.locator('#discConseil').innerText()));
  await page.fill('#dNomAr','فاطمة بن علي'); await page.dispatchEvent('#dNomAr','change'); await page.waitForTimeout(400);
  const ap = await page.frameLocator('#discApercu').locator('body').innerText();
  t('l\'aperçu se met à jour avec le nom en arabe', /فاطمة بن علي/.test(ap), ap.slice(0,200));
  t('le nom arabe est enregistré dans la fiche', (await page.evaluate(id=>emp(id).nomAr, idR))==='فاطمة بن علي');
  await page.fill('#dDelai','24'); await page.dispatchEvent('#dDelai','change'); await page.waitForTimeout(300);
  t('changer le délai met à jour le texte', /24 ساعة/.test(await page.inputValue('#dCorps')));
  await page.screenshot({ path:'./captures/vue_discipline_formulaire.png' });
  await page.click('#discOk'); await page.waitForTimeout(700);
  const refQ = await page.locator('.modal-head h3').innerText();
  t('enregistrée avec une référence automatique', /^Q-\d{4}-001/.test(refQ), refQ);
  const sv = await page.evaluate(()=>DISC_OUTILS.donnees.entrees[0]);
  t('le texte arabe est figé avec la pièce', sv && /24 ساعة/.test(sv.corps) && sv.statut==='brouillon');

  /* texte retouché à la main, puis repris du modèle */
  await page.fill('#dCorps','نص معدّل يدويا'); await page.waitForTimeout(250);
  await page.fill('#dDelai','72'); await page.dispatchEvent('#dDelai','change'); await page.waitForTimeout(250);
  t('un texte retouché à la main n\'est plus écrasé par les champs', (await page.inputValue('#dCorps'))==='نص معدّل يدويا');
  await page.click('button:has-text("Reprendre le modèle")'); await page.waitForTimeout(300);
  t('« Reprendre le modèle » rétablit le texte', /72 ساعة/.test(await page.inputValue('#dCorps')));
  await page.selectOption('#dStatut','remis'); await page.fill('#dRep','Problème de transport'); await page.waitForTimeout(150);
  await page.click('#discOk'); await page.waitForTimeout(700);
  const sv2 = await page.evaluate(()=>DISC_OUTILS.donnees.entrees[0]);
  t('statut « remis » : la date de remise est posée', sv2.statut==='remis' && sv2.remis_le===await page.evaluate(()=>TODAY), JSON.stringify([sv2.statut,sv2.remis_le]));
  t('la réponse de la salariée est gardée', sv2.reponse==='Problème de transport');

  console.log('\n--- Donner une suite : du questionnaire à l\'avertissement ---');
  page.removeAllListeners('dialog');
  page.once('dialog', d => d.accept('2'));
  await page.click('.modal-foot button:has-text("Donner une suite")'); await page.waitForTimeout(900);
  t('une nouvelle pièce « Avertissement » est ouverte', /Nouvelle pièce — Avertissement/.test(await page.locator('.modal-head h3').innerText()));
  t('elle reprend la personne, le motif et les faits', (await page.inputValue('#dMotif'))==='retards' && /سُجّل تأخّرك/.test(await page.inputValue('#dFaits')));
  t('elle est rattachée au questionnaire', (await page.inputValue('#dSuite'))===sv2.id);
  const cAv = await page.inputValue('#dCorps');
  t('son texte cite le questionnaire et tient compte de la réponse reçue', cAv.includes('تبعا للاستجواب عدد '+sv2.ref) && /بعد الاطّلاع على إجابتك/.test(cAv), cAv.slice(0,160));
  t('et prononce l\'avertissement', /توجيه إنذار كتابي/.test(cAv));
  page.on('dialog', d => d.accept());
  await page.click('#discOk'); await page.waitForTimeout(700);
  t('l\'avertissement reçoit sa propre numérotation', /^AV-\d{4}-001/.test(await page.locator('.modal-head h3').innerText()));
  await page.evaluate(()=>closeModal());

  console.log('\n--- Écran Discipline et fiche de la personne ---');
  await aller('discipline'); await page.waitForSelector('#diBody tr');
  t('les deux pièces sont listées', await page.locator('#diBody tr[data-disc]').count()===2);
  const li = await page.locator('#diBody').innerText();
  t('référence, type en français et en arabe, statut', /Q-\d{4}-001/.test(li) && /Questionnaire/.test(li) && /استجواب/.test(li) && /Remis/.test(li), li.slice(0,300));
  t('bandeau : en-tête de société à renseigner', /en-tête de la société n’est pas renseigné/i.test(await page.locator('#main').innerText()));
  await page.selectOption('#diType','avertissement'); await page.waitForTimeout(150);
  t('filtre par type', await page.locator('#diBody tr[data-disc]').count()===1);
  await page.selectOption('#diType',''); await page.fill('#diQ','Q-'); await page.waitForTimeout(150);
  t('recherche par référence', await page.locator('#diBody tr[data-disc]').count()===1);
  await page.fill('#diQ','');
  await page.click('button:has-text("En-tête et modèles")'); await page.waitForSelector('#so_nomAr');
  await page.fill('#so_nom','DBS Fashion'); await page.fill('#so_nomAr','شركة دي بي أس فاشن'); await page.fill('#so_villeAr','نابل');
  t('le modèle d\'origine est affiché et modifiable', /فإنّ إدارة المؤسسة تدعوك/.test(await page.inputValue('#moTexte')));
  await page.selectOption('#moType','observation');
  await page.fill('#moTexte','نص مخصّص للمؤسسة: {motif}.\n{faits}'); await page.waitForTimeout(100);
  await page.click('.modal-foot button:has-text("Enregistrer")'); await page.waitForTimeout(800);
  t('l\'en-tête enregistré fait disparaître le bandeau', !/n’est pas renseigné/i.test(await page.locator('#main').innerText()));
  const perso = await page.evaluate(id=>corpsDepuisModele({id:'z',emp:id,type:'observation',date:TODAY,motif:'telephone',faits:''}), idR);
  eg('le modèle personnalisé de l\'entreprise est utilisé (et la ligne de faits vide retirée)', perso, 'نص مخصّص للمؤسسة: استعمال الهاتف الجوّال أثناء العمل.');
  const [dl3] = await Promise.all([page.waitForEvent('download',{timeout:8000}).catch(()=>null), page.click('.topbar button:has-text("CSV"), button:has-text("CSV") >> nth=0')]);
  t('export CSV des dossiers', dl3 && /^dossiers_disciplinaires_/.test(dl3.suggestedFilename()), dl3&&dl3.suggestedFilename());
  await page.screenshot({ path:'./captures/vue_discipline.png' });
  /* impression : le document part bien dans un cadre d'impression */
  await page.evaluate(()=>{ window.__imp=0; });
  await page.locator('#diBody tr[data-disc] button:has-text("Imprimer")').first().click(); await page.waitForTimeout(900);
  const cadre = await page.evaluate(()=>{const f=document.getElementById('discCadre'); return f?f.srcdoc:''});
  t('« Imprimer » prépare le document arabe complet', /dir="rtl"/.test(cadre) && /شركة دي بي أس فاشن/.test(cadre) && /فاطمة بن علي/.test(cadre), cadre.slice(0,120));
  /* fiche de la personne */
  await page.evaluate(id=>openProfile(id), idR); await page.waitForSelector('#discProfil table',{timeout:8000});
  const pf = await page.locator('#discProfil').innerText();
  t('la fiche montre le dossier disciplinaire de la personne', /Dossier disciplinaire \(2\)/i.test(pf) && /AV-\d{4}-001/.test(pf), pf.slice(0,200));
  t('avec un résumé sur 12 mois — un avertissement encore en brouillon n\'y compte pas', /Sur 12 mois : 1 questionnaire\./.test(pf), pf.slice(0,200));
  t('et de quoi ajouter une pièce', await page.locator('#discProfil button:has-text("Questionnaire")').count()===1);
  await page.screenshot({ path:'./captures/vue_fiche_discipline.png' });
  await page.locator('#discProfil button:has-text("Ouvrir")').first().click(); await page.waitForSelector('#dCorps');
  t('une pièce remise se rouvre avec son texte figé', (await page.inputValue('#dCorps')).length>100);
  await page.evaluate(()=>closeModal());

  /* un chef d'atelier ne voit rien de tout cela */
  const vuChef = await page.evaluate(async () => {
    const vrai = ME.role; ME.role='atelier'; majSidebar();
    const menu = !!document.querySelector('#nav [data-v="discipline"]');
    await go('discipline'); const txt = document.getElementById('main').innerText;
    openProfile(DB.employees[0].id); const bloc = !!document.getElementById('discProfil'); closeModal();
    ME.role=vrai; majSidebar(); return {menu,txt,bloc};
  });
  t('chef d\'atelier : pas d\'entrée « Discipline » au menu', vuChef.menu===false);
  t('chef d\'atelier : la vue est refusée', /Réservé aux rôles Administrateur et RH/.test(vuChef.txt));
  t('chef d\'atelier : rien dans la fiche', vuChef.bloc===false);

  /* ======================================================================== */
  console.log('\n--- Écran Corrections en masse ---');
  t('entrée « Corrections en masse » dans le menu', await page.locator('#nav [data-v="corrections"]').count()===1);
  await aller('corrections');
  await page.click('button:has-text("12 mois")'); await page.waitForTimeout(1500);
  await page.waitForSelector('#cmBody tr');
  const fams = await page.locator('#cmFams').innerText();
  t('quatre familles d\'anomalies avec leur compte', /Sortie non badgée/.test(fams) && /Badges impairs/.test(fams) && /Heures de nuit/.test(fams) && /Démarrage anticipé/.test(fams));
  const tot = await page.evaluate(()=>detecterAnomalies(document.getElementById('cmFrom').value,TODAY).total);
  t('des sorties non badgées sont détectées', tot.sortie>100, JSON.stringify(tot));
  t('les heures de nuit sont détectées', tot.nuit===10, tot.nuit);
  t('le démarrage anticipé est détecté', tot.tot>=80, tot.tot);
  const lignes = await page.locator('#cmBody tr.cm-jour').count();
  t('une ligne par journée', lignes>=20, lignes);
  t('la journée de panne est marquée « Collective »', await page.locator('#cmBody tr.cm-jour:has-text("Collective")').count()===1);
  t('aucune case cochée au départ', (await page.locator('#cmN').innerText())==='0');
  await page.click('button:has-text("Aperçu avant correction")'); await page.waitForTimeout(300);
  t('sans sélection : rien ne s\'ouvre, un message le dit', await page.locator('.modal-body').count()===0 && /Cochez d’abord/.test(await page.locator('#toasts').innerText()));
  await page.screenshot({ path:'./captures/vue_corrections.png' });

  const jp = page.locator('#cmBody tr.cm-jour:has-text("Collective")');
  const dsP = await jp.getAttribute('data-ds');
  await jp.locator('input[type=checkbox]').check(); await page.waitForTimeout(200);
  const nSel = +(await page.locator('#cmN').innerText());
  t('cocher la journée sélectionne toutes les personnes concernées', nSel>=100, nSel);
  await jp.locator('button:has-text("Voir les")').click(); await page.waitForTimeout(200);
  t('le détail de la journée montre chaque personne et son badge', await page.locator('#cmBody tr[data-cle]').count()===nSel);
  t('la personne déjà corrigée à la main n\'y figure pas', !(await page.locator('#cmBody tr[data-cle="'+dsP+'|E002"]').count()));
  await page.locator('#cmBody tr[data-cle]').first().locator('input').uncheck(); await page.waitForTimeout(150);
  t('on peut retirer une personne de la sélection', +(await page.locator('#cmN').innerText())===nSel-1);
  await page.locator('#cmBody tr[data-cle]').first().locator('input').check();
  t('l\'action proposée par défaut est « fixer l\'heure de sortie »', (await page.inputValue('#cmAction'))==='sortie');
  const avant = (await bulks()).length;
  await page.click('button:has-text("Aperçu avant correction")'); await page.waitForSelector('#cmValider');
  const apc = await page.locator('.modal-body').innerText();
  t('l\'aperçu annonce le nombre de journées', new RegExp('Journées corrigées\\s*'+nSel).test(apc.replace(/\n/g,' ')), apc.slice(0,200));
  t('et montre les heures avant et après', /Heures avant/.test(apc) && /Heures après/.test(apc) && /0,00 → /.test(apc));
  t('chaque ligne montre ce que la journée deviendra', /→ 16:30/.test(apc));
  t('RIEN n\'est écrit tant que l\'aperçu n\'est pas validé', (await bulks()).length===avant);
  await page.screenshot({ path:'./captures/vue_corrections_apercu.png' });
  await page.fill('#cmMotif','Panne de la pointeuse — sortie non enregistrée');
  await page.click('#cmValider'); await page.waitForTimeout(1200);
  const bl = await bulks(); const dernier = bl[bl.length-1];
  t('une seule écriture groupée part vers le serveur', bl.length===avant+1);
  t('avec toutes les journées', dernier && dernier.recs.length===nSel, dernier&&dernier.recs.length);
  t('le motif saisi est transmis au journal', dernier && /Panne de la pointeuse/.test(dernier.motif), dernier&&dernier.motif);
  const r0 = dernier.recs[0];
  t('chaque ligne : date, personne, sortie fixée, marque manuelle', r0.date===dsP && /^E\d+/.test(r0.id) && r0.sortie==='16:30' && r0.manuel===1 && r0.statut==='present', JSON.stringify(r0));
  t('l\'entrée badgée le matin est conservée', /^07:2\d$/.test(r0.entree), r0.entree);
  const apres = await page.evaluate(ds=>({n:detecterAnomalies(ds,ds).total.sortie, h:metrics(DB.pointages[ds]['E005'],ds).heures, man:DB.pointages[ds]['E005'].manuel}), dsP);
  eg('la journée ne compte plus aucune sortie manquante', apres.n, 0);
  t('les heures sont maintenant comptées', apres.h>480, apres.h);
  eg('et la journée est protégée', apres.man, 1);
  t('la journée a disparu de la liste', !(await page.locator('#cmBody tr.cm-jour[data-ds="'+dsP+'"]').count()));
  t('un bouton permet d\'annuler', await page.locator('#cmAnnuler').count()===1);

  console.log('\n--- Annuler la dernière correction ---');
  await page.click('#cmAnnuler'); await page.waitForTimeout(1200);
  const bl2 = await bulks(); const ann = bl2[bl2.length-1];
  t('l\'annulation réécrit les mêmes journées', ann.recs.length===nSel && /^Annulation/.test(ann.motif), ann.motif);
  t('telles qu\'elles étaient : sans sortie et sans marque manuelle', ann.recs[0].sortie==='' && !ann.recs[0].manuel, JSON.stringify(ann.recs[0]));
  const rev = await page.evaluate(ds=>({n:detecterAnomalies(ds,ds).total.sortie, man:DB.pointages[ds]['E005'].manuel||null}), dsP);
  t('les anomalies sont de retour', rev.n===nSel, rev.n);
  eg('et la protection est retirée', rev.man, null);
  t('le bouton d\'annulation disparaît', await page.locator('#cmAnnuler').count()===0);

  console.log('\n--- Heures de nuit : refus expliqués ---');
  await page.click('#cmFams [data-fam="nuit"]'); await page.waitForTimeout(700);
  await page.check('#cmTout'); await page.waitForTimeout(200);
  eg('« tout sélectionner » prend les 10 lignes', +(await page.locator('#cmN').innerText()), 10);
  t('action proposée : horaire prévu', (await page.inputValue('#cmAction'))==='horaire');
  await page.selectOption('#cmAction','sortie'); await page.waitForTimeout(150);
  await page.click('button:has-text("Aperçu avant correction")'); await page.waitForSelector('#cmValider');
  const apn = await page.locator('.modal-body').innerText();
  t('les entrées de 22 h ne peuvent pas recevoir une sortie à 16 h 30 : laissées telles quelles, et c\'est dit',
    /6 journée\(s\) ne seront pas modifiées/.test(apn) && /serait avant l’entrée/.test(apn), apn.slice(0,400));
  await page.evaluate(()=>closeModal());
  await page.selectOption('#cmAction','horaire');
  await page.click('button:has-text("Aperçu avant correction")'); await page.waitForSelector('#cmValider');
  t('avec « horaire prévu », les 10 sont corrigeables', /Corriger 10 journée/.test(await page.locator('#cmValider').innerText()));
  await page.click('#cmValider'); await page.waitForTimeout(1000);
  eg('plus aucune heure de nuit', await page.evaluate(()=>detecterAnomalies(document.getElementById('cmFrom').value,TODAY).total.nuit), 0);

  console.log('\n--- Démarrage anticipé : horaire exceptionnel d\'une journée ---');
  await page.click('#cmFams [data-fam="tot"]'); await page.waitForTimeout(700);
  const jt = page.locator('#cmBody tr.cm-jour:has-text("Collective")').first();
  const dsT = await jt.getAttribute('data-ds');
  const hAv = await page.evaluate(ds=>metrics(DB.pointages[ds]['E001'],ds).heures, dsT);
  await jt.locator('button:has-text("Horaire exceptionnel")').click(); await page.waitForSelector('#hxD');
  t('l\'heure de début proposée suit l\'arrivée réelle (vers 06 h 30)', /^06:(15|30)$/.test(await page.inputValue('#hxD')), await page.inputValue('#hxD'));
  await page.fill('#hxD','06:30');
  await page.click('button:has-text("Appliquer à cette journée")'); await page.waitForTimeout(1200);
  const hx = await page.evaluate(ds=>({h:metrics(DB.pointages[ds]['E001'],ds).heures, p:DB.settings.periodes[0], reg:regimeFor(ds).debut,
      voisin:regimeFor(addDays(ds,1)).debut, n:detecterAnomalies(ds,ds).total.tot, man:DB.pointages[ds]['E001'].manuel||null}), dsT);
  t('une période d\'un seul jour est créée, en tête de liste', hx.p && hx.p.du===dsT && hx.p.au===dsT && hx.p.exception===true, JSON.stringify(hx.p).slice(0,200));
  eg('ce jour-là l\'horaire commence à 06 h 30', hx.reg, '06:30');
  t('le lendemain n\'est pas touché', hx.voisin!=='06:30', hx.voisin);
  eg('l\'heure faite avant 07 h 30 est maintenant comptée (+60 min)', hx.h-hAv, 60);
  eg('la journée n\'est plus signalée', hx.n, 0);
  eg('aucun badge n\'a été modifié', hx.man, null);
  const meta = await (await page.request.get('http://localhost:8777/api/__meta')).json();
  t('le réglage est enregistré sur le serveur', meta.settings && meta.settings.periodes[0].du===dsT);

  console.log('\n--- Mois clôturé : rien n\'est modifiable ---');
  const clos = await page.evaluate(async () => {
    const ym = addDays(TODAY,-45).slice(0,7); DB.settings.clotures=[ym]; ENGINE.invalidate();
    await go('corrections'); document.querySelector('#cmFams [data-fam="sortie"]').click(); await new Promise(r=>setTimeout(r,900));
    const l=[...document.querySelectorAll('#cmBody tr.cm-jour')].filter(tr=>tr.dataset.ds.slice(0,7)===ym);
    document.getElementById('cmTout').click(); await new Promise(r=>setTimeout(r,200));
    const sel = +document.getElementById('cmN').textContent;
    const total = detecterAnomalies(document.getElementById('cmFrom').value,TODAY);
    const ouverts = total.items.filter(x=>x.fam==='sortie'&&x.ds.slice(0,7)!==ym).length;
    const r = {n:l.length, desact:l.every(tr=>tr.querySelector('input').disabled), bandeau:/Mois clôturé/.test(document.getElementById('main').innerText), sel, ouverts};
    DB.settings.clotures=[]; ENGINE.invalidate(); return r;
  });
  t('les journées d\'un mois clos sont listées mais non cochables', clos.n>0 && clos.desact, JSON.stringify(clos));
  t('un bandeau l\'explique', clos.bandeau);
  eg('« tout sélectionner » ne prend que les mois ouverts', clos.sel, clos.ouverts);

  const lect = await page.evaluate(async () => { const v=ME.role; ME.role='lecture'; await go('corrections'); const b=!!document.getElementById('cmBarre'); ME.role=v; return b; });
  t('un compte en lecture seule voit les anomalies mais pas la barre de correction', lect===false);

  console.log('\n--- Fiches de pointage mensuelles ---');
  await page.evaluate(()=>closeModal());
  const fi = await page.evaluate(async () => {
    const ym = addDays(TODAY, -35).slice(0,7); const [a, b] = monthBounds(ym); await ensureRange(a, b);
    const id = DB.employees.find(e => !/[<"]/.test(e.prenom+e.nom)).id;
    /* une journée impaire, une à 8 passages, une corrigée */
    const jo = []; eachDay(a, b, ds => { if (estOuvre(ds) && DB.pointages[ds]) jo.push(ds); });
    DB.pointages[jo[0]][id] = {statut:'present', punches:['07:31','12:02','12:41']};
    DB.pointages[jo[1]][id] = {statut:'present', punches:['07:30','09:00','09:10','10:00','10:10','12:00','12:30','16:30']};
    DB.pointages[jo[2]][id] = {statut:'present', entree:'07:30', sortie:'16:30', manuel:1};
    ENGINE.invalidate();
    const F = lignesFiche(id, ym), s = summarize(a, b).find(x => x.e.id === id);
    const dim = F.lignes.filter(l => l.w === 0);
    const html = fichesHtml([id], ym);
    const l0 = F.lignes.find(l => l.ds === jo[0]), l1 = F.lignes.find(l => l.ds === jo[1]), l2 = F.lignes.find(l => l.ds === jo[2]);
    const cur = lignesFiche(id, TODAY.slice(0,7));
    return { n: F.lignes.length, jours: +b.slice(8), tot: [F.t.trav, F.t.abs, F.t.conge, F.t.hN, F.t.hS, F.t.ret],
      paie: [s.jT, s.jA, s.jC, s.hN, s.hS, s.rt],
      dim: dim.every(l => l.statut === 'Repos' && !l.nonImporte),
      impair: [l0.P.length, l0.obs.join('|')], huit: l1.obs.join('|'), corr: l2.obs.join('|'),
      pages: (html.match(/class="page"/g)||[]).length, cols: (html.match(/<th>(Entrée|Sortie) \d<\/th>/g)||[]).length,
      manque: /class="t s manque">\?</.test(html), societe: /STE DBS FASHION|<b>[^<]+<\/b><br><span>Fiche de pointage mensuelle/.test(html),
      sig: /Visa du service du personnel/.test(html) && /Lu et vérifié par l’intéressé\(e\)/.test(html),
      avenir: cur.lignes.filter(l => l.ds > TODAY).every(l => l.avenir && !l.m), regle: html.indexOf(mentionRegime()) > 0,
      deux: (fichesHtml([id, DB.employees[1].id], ym).match(/class="page"/g)||[]).length };
  });
  eg('une ligne par jour du mois', fi.n, fi.jours);
  eg('totaux identiques au rapport de paie (jours, absences, congés, heures, H. sup., retards)', fi.tot, fi.paie);
  t('les dimanches sans donnée s\'affichent « Repos », pas « non importé »', fi.dim);
  t('journée impaire : la sortie manquante est marquée « ? » et « Sortie non badgée »', fi.impair[0]===3 && /Sortie non badgée/.test(fi.impair[1]) && fi.manque, JSON.stringify(fi.impair));
  t('au-delà de 3 entrées / 3 sorties, les autres passages sont écrits en observation', /Autres passages : 12:30 · 16:30/.test(fi.huit), fi.huit);
  t('une journée corrigée porte « Corrigé RH »', /Corrigé RH/.test(fi.corr));
  eg('6 colonnes de passages : Entrée 1 … Sortie 3', fi.cols, 6);
  t('cadre « ? » sur la case manquante', fi.manque);
  t('deux cadres de signature (service du personnel, intéressée)', fi.sig);
  t('la règle de calcul est imprimée sur la fiche', fi.regle);
  t('mois en cours : les jours à venir restent vides', fi.avenir);
  eg('une page par personne', [fi.pages, fi.deux], [1, 2]);

  await aller('rapports');
  await page.click('button:has-text("Fiches de pointage individuelles")'); await page.waitForSelector('#fiBody tr');
  t('le bouton du rapport ouvre le choix des personnes et du mois', await page.locator('#fiMois').count()===1);
  t('sans personne cochée, impossible d\'imprimer', await page.locator('#fiImp').isDisabled());
  await page.locator('#fiBody input[type=checkbox]').nth(0).check(); await page.locator('#fiBody input[type=checkbox]').nth(1).check();
  t('le compte de pages s\'affiche', /2 fiche\(s\) — 2 page\(s\)/.test(await page.locator('#fiN').innerText()));
  await page.fill('#fiQ','Nom1'); await page.waitForTimeout(150);
  t('la recherche filtre la liste sans perdre les personnes cochées', /2 fiche\(s\)/.test(await page.locator('#fiN').innerText()));
  await page.click('#fiImp'); await page.waitForTimeout(900);
  const cad = await page.evaluate(()=>{const f=document.getElementById('ficheCadre');return f?f.srcdoc:''});
  t('« Imprimer » prépare 2 pages A4', (cad.match(/class="page"/g)||[]).length===2 && /@page\{size:A4 portrait/.test(cad));
  await page.fill('#fiQ',''); await page.click('button:has-text("Tout cocher")'); await page.waitForTimeout(150);
  t('« Tout cocher » prend tout l\'effectif', +((await page.locator('#fiN').innerText()).match(/\d+/)||[0])[0] >= 100);
  await page.evaluate(()=>closeModal());
  await page.evaluate(()=>openProfile(DB.employees[2].id)); await page.waitForSelector('#histBox');
  await page.click('.modal-body button:has-text("Fiche de pointage du mois")'); await page.waitForSelector('#fiBody tr');
  t('depuis la fiche d\'une personne : elle est déjà cochée', /1 fiche\(s\)/.test(await page.locator('#fiN').innerText()));
  t('le mois proposé est celui de l\'historique affiché', (await page.inputValue('#fiMois'))===await page.evaluate(()=>TODAY.slice(0,7)));
  t('on ne peut pas choisir un mois futur', (await page.getAttribute('#fiMois','max'))===await page.evaluate(()=>TODAY.slice(0,7)));
  await page.evaluate(()=>closeModal());

  t('aucune erreur JavaScript pendant tout le parcours', erreurs.length===0, erreurs.join(' | '));
  t('aucun script injecté n\'a été exécuté', !(await page.evaluate(()=>window.__XSS||window.__XSS2||window.__XSSD)));

  console.log('\n=========================');
  console.log('  '+ok+' réussis · '+ko+' échoués');
  await browser.close();
  process.exit(ko?1:0);
})().catch(e=>{ console.error('CRASH', e); process.exit(2) });
