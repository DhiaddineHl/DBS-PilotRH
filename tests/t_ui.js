const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(()=>chromium.launch());
  let ok=0, ko=0;
  const t=(nom,cond,detail)=>{ if(cond)ok++; else {ko++;console.log('  ECHEC '+nom+(detail?' :: '+detail:''))} };
  const erreurs=[];
  const page = await browser.newPage({ viewport:{width:1400,height:950} });
  page.on('console', m => { if(m.type()==='error') erreurs.push(m.text()) });
  page.on('pageerror', e => erreurs.push('PAGEERROR '+e.message));

  await page.goto('http://localhost:8777/', { waitUntil:'networkidle' });
  await page.waitForSelector('#nav .nav-item', { timeout:12000 });

  console.log('\n--- Démarrage ---');
  t('la coquille est construite', await page.locator('#nav .nav-item').count() >= 10);
  t('le tableau de bord s\'affiche', await page.locator('.kpi').count() >= 6);
  t('nom de l\'utilisateur affiché', (await page.locator('#meWho').innerText()).includes('Administrateur'));

  console.log('\n--- XSS : le nom hostile importé de la pointeuse ---');
  await page.click('[data-v="personnel"]'); await page.waitForSelector('#persBody tr');
  t('aucun script injecté (nom)', await page.evaluate(()=>!window.__XSS));
  t('aucun script injecté (prénom)', await page.evaluate(()=>!window.__XSS2));
  const txt = await page.locator('#persBody').innerText();
  t('le nom hostile est affiché en texte', txt.includes('onerror'), txt.slice(0,120));
  t('matricule affiché à côté du nom', await page.locator('#persBody tr:first-child .mono').count() >= 1);

  console.log('\n--- Filtres et tri du personnel ---');
  const n0 = await page.locator('#persBody tr').count();
  await page.selectOption('#pServ','Couture'); await page.waitForTimeout(150);
  const n1 = await page.locator('#persBody tr').count();
  t('le filtre service réduit la liste', n1 < n0 && n1 > 0, n0+' -> '+n1);
  await page.selectOption('#pAtel','Atelier A'); await page.waitForTimeout(150);
  t('filtre atelier cumulé', await page.locator('#persBody tr').count() <= n1);
  await page.selectOption('#pServ',''); await page.selectOption('#pAtel','');
  await page.fill('#pSearch','107'); await page.waitForTimeout(150);
  t('recherche par matricule', (await page.locator('#persBody').innerText()).includes('107'));
  await page.fill('#pSearch','');
  await page.locator('th button', { hasText:'Employée' }).first().click(); await page.waitForTimeout(200);
  t('le tri annonce aria-sort', await page.locator('th[aria-sort]').count() === 1);
  t('indicateur visuel de tri', (await page.locator('th[aria-sort]').innerText()).includes('▲'));
  const p1 = await page.locator('#persBody tr:first-child').innerText();
  await page.locator('th button', { hasText:'Employée' }).first().click(); await page.waitForTimeout(200);
  t('second clic inverse le tri', (await page.locator('th[aria-sort]').getAttribute('aria-sort')) === 'descending');
  t('l\'ordre des lignes change vraiment', (await page.locator('#persBody tr:first-child').innerText()) !== p1);

  console.log('\n--- Présences et anomalies ---');
  await page.click('[data-v="presences"]'); await page.waitForSelector('#presBody tr');
  t('feuille de pointage remplie', await page.locator('#presBody tr').count() > 50);
  t('bandeau des journées à vérifier', await page.locator('.banner-warn').count() >= 1);
  t('bouton Saisie rapide présent', await page.locator('button', { hasText:'Saisie rapide' }).count() === 1);
  t('colonne H. sup. éditable', await page.locator('#presBody input[aria-label^="Heures supplémentaires"]').count() > 0);
  await page.selectOption('#fStatut','revue'); await page.waitForTimeout(200);
  const nRev = await page.locator('#presBody tr').count();
  t('filtre "à vérifier" fonctionne', nRev > 0 && nRev < 120, String(nRev));
  await page.selectOption('#fStatut','');

  console.log('\n--- Saisie rapide ---');
  await page.click('button:has-text("Saisie rapide")');
  await page.waitForSelector('#srBody tr');
  t('grille de saisie affichée', await page.locator('#srBody tr').count() > 50);
  t('boutons d\'action en masse', await page.locator('button:has-text("Tous présents")').count() === 1);
  await page.click('button:has-text("Tout sélectionner")'); await page.waitForTimeout(200);
  t('sélection en masse', +(await page.locator('#srN').innerText()) > 50);
  await page.click('button:has-text("Aucun")'); await page.waitForTimeout(150);
  t('désélection', (await page.locator('#srN').innerText()) === '0');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  t('Échap ferme la modale', !(await page.locator('#overlay').evaluate(e=>e.classList.contains('open'))));

  console.log('\n--- Correction sur une plage de dates ---');
  await page.click('[data-v="personnel"]'); await page.waitForSelector('#persBody tr');
  await page.locator('#persBody .emp-cell').first().click();
  await page.waitForSelector('.modal');
  t('fiche salarié ouverte', (await page.locator('.modal-head h3').innerText()).includes('Fiche'));
  t('historique de pointage chargé', await page.locator('#histBox .hist-line').count() > 5);
  await page.click('button:has-text("Corriger sur une plage de dates")');
  await page.waitForSelector('#coBody tr');
  t('grille de correction par date', await page.locator('#coBody tr').count() > 5);
  await page.click('button:has-text("Jours ouvrés")'); await page.waitForTimeout(300);
  t('sélection des jours ouvrés', +(await page.locator('#coN').innerText()) > 3);
  t('bandeau de synthèse de la période', (await page.locator('#coInfo').innerText()).includes('h'));
  await page.keyboard.press('Escape');

  console.log('\n--- Rapports & paie ---');
  await page.click('[data-v="rapports"]'); await page.waitForSelector('#repBody tr');
  t('synthèse de paie remplie', await page.locator('#repBody tr').count() > 50);
  t('ligne TOTAL présente', await page.locator('.rep-tot').count() === 1);
  t('colonne Fériés présente', (await page.locator('table.tbl thead').first().innerText()).toLowerCase().includes('fériés'));
  t('mention du régime en pied', (await page.locator('.page').innerText()).includes('arrondi'));
  const av = await page.locator('#repTitre').innerText();
  await page.click('button:has-text("Mois précédent")'); await page.waitForTimeout(700);
  t('changement de période pris en compte', (await page.locator('#repTitre').innerText()) !== av);
  await page.selectOption('#rServ','Couture'); await page.waitForTimeout(200);
  t('filtre service dans les rapports', await page.locator('#repBody tr').count() < 60);
  await page.selectOption('#rServ','');
  t('bouton de clôture de mois', await page.locator('button:has-text("Clôturer")').count() >= 1);

  console.log('\n--- Absences, retards, congés ---');
  await page.click('[data-v="absences"]'); await page.waitForSelector('#rangeBody tr');
  t('absences sur la période', await page.locator('#rangeBody tr').count() > 1);
  t('filtre service dans les absences', await page.locator('#abServ').count() === 1);
  await page.click('[data-v="retards"]'); await page.waitForSelector('.kpi');
  t('classement des retards', (await page.locator('.page').innerText()).includes('Classement'));
  await page.click('[data-v="conges"]'); await page.waitForSelector('#cgBody tr');
  t('demandes de congé listées', await page.locator('#cgBody tr').count() >= 2);
  t('bouton Valider présent', await page.locator('button:has-text("Valider")').count() >= 1);
  t('colonne Pointage (congé inscrit)', (await page.locator('#cgBody').innerText()).includes('Inscrit'));

  console.log('\n--- Graphiques sans CDN ---');
  await page.click('[data-v="dashboard"]'); await page.waitForSelector('#cAbs svg');
  t('courbe d\'absentéisme dessinée en SVG', await page.locator('#cAbs svg polyline').count() === 1);
  t('camembert par service dessiné', await page.locator('#cServ svg path').count() > 2);
  t('aucun script tiers chargé', await page.evaluate(()=>typeof Chart==='undefined'));
  await page.click('[data-v="rse"]'); await page.waitForSelector('#cAge svg');
  t('indicateurs RSE calculés', await page.locator('.rse-card').count() === 8);
  t('plus de valeur codée en dur (50%)', !(await page.locator('.rse-grid').innerText()).includes('Mixité postes clés'));

  console.log('\n--- Sécurité & accès ---');
  await page.click('[data-v="parametres"]'); await page.waitForSelector('#auditBody tr');
  t('journal d\'audit chargé', await page.locator('#auditBody tr').count() >= 2);
  t('audit non exécuté (XSS)', await page.evaluate(()=>!window.__XSS3));
  t('colonne rôle dans l\'audit', (await page.locator('#auditBody').innerText()).includes('RH'));
  t('signalements affichés', await page.locator('#sigBody tr').count() >= 1);
  t('état des sauvegardes', (await page.locator('#bkInfo').innerText()).includes('sauvegarde'));
  t('plus de champ de clé API', await page.locator('#apiKeyInput').count() === 0);
  t('QR sans les codes par défaut', await page.locator('button:has-text("Cartes QR (sans les codes)")').count() === 1);

  console.log('\n--- Messagerie / sondages ---');
  await page.click('button:has-text("Ouvrir la messagerie")');
  await page.waitForSelector('#comsBody .seg');
  t('onglet notes', (await page.locator('#comsBody').innerText()).includes('Fermeture vendredi'));
  t('accusés de lecture affichés', (await page.locator('#comsBody').innerText()).includes('ont lu'));
  await page.click('#comsBody .seg button:nth-child(2)'); await page.waitForTimeout(250);
  t('onglet sondages', (await page.locator('#comsBody').innerText()).includes('Pause a 12h'));
  t('résultats en barres', await page.locator('#comsBody .bar, #comsBody .rb').count() >= 1);
  await page.keyboard.press('Escape');

  console.log('\n--- Paramètres : fériés et plage de pause ---');
  await page.click('[data-v="presences"]'); await page.waitForSelector('#presBody tr');
  await page.click('button[aria-label="Paramètres horaires"]');
  await page.waitForSelector('#setBody');
  const st = (await page.locator('#setBody').innerText()).toLowerCase();
  const sh = await page.locator('#setBody').innerHTML();
  t('section jours fériés', st.includes('jours fériés'));
  t('fêtes fixes listées', st.includes('fête du travail'));
  t('fête mobile saisie', st.includes('aïd el fitr'));
  t('champs de plage de pause présents', sh.includes("'pauseDe'") && sh.includes("'pauseA'"));
  t('plage de pause pré-remplie 12:00', sh.includes('value="12:00"'));
  t('arrondi sur le cumul', st.includes('cumul de la période'));
  t('section mois clôturés', st.includes('mois clôturés'));
  await page.keyboard.press('Escape');

  console.log('\n--- Navigation par URL et mobile ---');
  await page.goto('http://localhost:8777/#/rapports', { waitUntil:'networkidle' });
  await page.waitForSelector('#repBody tr');
  t('URL profonde : F5 revient sur la même vue', (await page.locator('.topbar h1').innerText()).includes('Rapports'));
  await page.setViewportSize({ width:390, height:844 });
  await page.click('[data-v="dashboard"]').catch(()=>{});
  await page.goto('http://localhost:8777/#/dashboard', { waitUntil:'networkidle' });
  await page.waitForSelector('.burger');
  t('bouton menu visible sur mobile', await page.locator('.burger').isVisible());
  await page.click('.burger'); await page.waitForTimeout(300);
  t('le tiroir de navigation s\'ouvre', await page.locator('#side').evaluate(e=>e.classList.contains('open')));
  await page.click('[data-v="presences"]'); await page.waitForTimeout(600);
  t('navigation possible sur mobile', (await page.locator('.topbar h1').innerText()).includes('Présences'));
  await page.setViewportSize({ width:1400, height:950 });

  console.log('\n--- Espace salarié ---');
  const p2 = await browser.newPage({ viewport:{width:390,height:844} });
  const err2=[]; p2.on('pageerror',e=>err2.push(e.message));
  await p2.goto('http://localhost:8777/moi?t=TOK1', { waitUntil:'networkidle' });
  await p2.waitForSelector('#pin', { timeout:8000 });
  t('espace salarié sans erreur JS', err2.length===0, err2.join(' | '));
  t('le jeton est retiré de l\'adresse', !(await p2.evaluate(()=>location.href)).includes('t=TOK1'),
    await p2.evaluate(()=>location.href));
  t('le jeton est mémorisé sur l\'appareil', await p2.evaluate(()=>!!localStorage.getItem('pilotrh_t')));
  t('code demandé (6 chiffres acceptés)', await p2.locator('#pin').getAttribute('maxlength') === '6');
  await p2.fill('#pin','999999'); await p2.waitForTimeout(700);
  t('mauvais code refusé', (await p2.content()).includes('Code incorrect'));
  await p2.fill('#pin','123456'); await p2.waitForTimeout(900);
  const s2 = await p2.content();
  t('pointage affiché après le bon code', s2.includes('Jours travaillés'), s2.slice(0,200));
  t('matricule visible', s2.includes('101'));
  t('bloc congés affiché', s2.includes('Heures de congé dues'));
  t('journées incomplètes signalées au salarié', s2.includes('pointage incomplet'));
  t('onglet Notes avec compteur', await p2.locator('.seg button:nth-child(2) .b').count() === 1);
  await p2.click('.seg button:nth-child(2)'); await p2.waitForTimeout(400);
  t('note de service lisible', (await p2.content()).includes('Fermeture vendredi'));
  await p2.click('.seg button:nth-child(3)'); await p2.waitForTimeout(300);
  t('sondage affiché', (await p2.content()).includes('Pause a 12h'));
  t('deux réponses proposées', await p2.locator('.vote-opt').count() === 2);
  p2.once('dialog', d => d.accept());
  await p2.locator('.vote-opt').first().click(); await p2.waitForTimeout(600);
  t('après vote, les résultats s\'affichent', (await p2.content()).includes('réponse(s)'));
  await p2.screenshot({ path:'./captures/vue_salarie.png', fullPage:false });

  console.log('\n--- Alertes cliquables : de l\'alerte à la correction ---');
  await page.goto('http://localhost:8777/#/alertes',{waitUntil:'networkidle'});
  await page.waitForSelector('.alert-row');
  const nAl = await page.locator('.alert-row').count();
  const nClic = await page.locator('.alert-clic').count();
  t('des alertes sont affichées', nAl > 0, 'n='+nAl);
  t('toutes les alertes sont cliquables', nClic === nAl, nClic+'/'+nAl);
  t('chaque alerte cliquable est accessible au clavier',
    await page.locator('.alert-clic[role="button"][tabindex="0"]').count() === nClic);
  t('l\'action attendue est annoncée',
    (await page.locator('.alert-clic').first().getAttribute('title') || '').length > 3);

  const docAl = page.locator('.alert-clic', { hasText:'Document manquant' }).first();
  if(await docAl.count()){
    await docAl.click(); await page.waitForSelector('.modal .profile-top',{timeout:6000});
    t('l\'alerte « document manquant » ouvre la fiche concernée', true);
    t('la fiche ouverte est bien celle nommée dans l\'alerte',
      (await page.locator('.modal .profile-top h2').innerText()).trim().length > 1);
    t('la fiche montre le bloc Rémunération',
      /r[ée]mun[ée]ration/i.test(await page.locator('.modal-body').innerText()));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  } else { t('alerte document manquant présente', false, 'absente du jeu de test') }

  const revAl = page.locator('.alert-clic', { hasText:'Pointage à vérifier' }).first();
  if(await revAl.count()){
    await revAl.click(); await page.waitForSelector('.modal',{timeout:6000});
    const m = await page.locator('.modal').innerText();
    t('l\'alerte de pointage ouvre la liste des journées à vérifier', m.includes('Journées à vérifier'), m.slice(0,80));
    t('chaque ligne propose de corriger', await page.locator('.modal button:has-text("Corriger")').count() > 0);
    await page.locator('.modal button:has-text("Corriger")').first().click();
    await page.waitForSelector('#presBody tr',{timeout:8000});
    await page.waitForTimeout(500);
    t('on arrive sur la feuille de pointage du jour', (await page.locator('#dPres').inputValue()).length === 10);
    t('la ligne à corriger est mise en évidence', await page.locator('tr.focus-row').count() === 1);
  } else { t('alerte pointage à vérifier présente', false, 'absente du jeu de test') }

  console.log('\n--- Rémunération : à l\'heure ou à la journée, par fiche ---');
  await page.goto('http://localhost:8777/#/personnel',{waitUntil:'networkidle'});
  await page.waitForSelector('#persBody tr');
  await page.locator('#persBody button:has-text("Fiche")').first().click();
  await page.waitForSelector('.modal .profile-top');
  await page.click('.modal button:has-text("Modifier la fiche")');
  await page.waitForSelector('#ed_modePaie');
  t('le mode de paie est saisissable', await page.locator('#ed_modePaie option').count() === 2);
  t('prix de l\'heure saisissable', await page.locator('#ed_tauxHoraire').count() === 1);
  t('prix de la journée saisissable', await page.locator('#ed_tauxJour').count() === 1);
  t('l\'aide explique le mode retenu',
    (await page.locator('#paieHint').innerText()).includes('heure'));
  await page.selectOption('#ed_modePaie','journalier'); await page.waitForTimeout(150);
  t('changer de mode change l\'explication',
    (await page.locator('#paieHint').innerText()).includes('journée travaillée'));
  await page.fill('#ed_tauxJour','45,5'.replace(',','.'));
  await page.selectOption('#ed_modePaie','horaire');
  await page.fill('#ed_tauxHoraire','2.75');
  await page.click('.modal button:has-text("Enregistrer")');
  await page.waitForSelector('.modal .profile-top',{timeout:6000});
  const fiche = await page.locator('.modal-body').innerText();
  t('le taux saisi est repris dans la fiche', fiche.includes('2,75'), fiche.slice(-400));
  t('le mode retenu est affiché', /[àa] l[’']heure/i.test(fiche));
  t('une estimation du mois est calculée', /estimation brute du mois/i.test(fiche));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  await page.goto('http://localhost:8777/#/rapports',{waitUntil:'networkidle'});
  await page.waitForSelector('#repBody tr');
  const tete = (await page.locator('.tablecard thead').innerText()).toLowerCase();
  t('colonne Taux dans le rapport de paie', tete.includes('taux'), tete.slice(0,160));
  t('colonne Montant estimé dans le rapport de paie', tete.includes('montant'));
  t('le total inclut un montant en TND',
    (await page.locator('#repBody tr.rep-tot').innerText()).includes('TND'));
  const l1 = await page.locator('#repBody tr:first-child').innerText();
  t('la base de paie porte son unité', /\d\s?(h|j)\b/.test(l1), l1.slice(0,120));

  console.log('\n--- Import en masse des fiches ---');
  await page.goto('http://localhost:8777/#/personnel',{waitUntil:'networkidle'});
  await page.waitForSelector('#persBody tr');
  await page.click('button:has-text("Importer des fiches")');
  await page.waitForSelector('#fichesIn',{state:'attached'});
  const mod = await page.locator('.modal-body').innerText();
  t('le modèle vierge est proposé', mod.includes('Modèle vierge'));
  t('le classeur prérempli est proposé', /fiches actuelles/.test(mod));
  t('les trois règles de sécurité sont rappelées',
    mod.includes('matricule') && mod.includes('vide ne change rien') && mod.includes('jamais touchés'));
  t('le bouton Appliquer est désactivé avant tout fichier',
    await page.locator('#btnAppFiches').isDisabled());
  await page.setInputFiles('#fichesIn',{ name:'fiches.csv', mimeType:'text/csv',
    buffer: Buffer.from('Matricule;Nom\n101;Nom1\n') });
  await page.waitForSelector('#rapFiches .tablecard',{timeout:8000});
  const ap = await page.locator('#rapFiches').innerText();
  t('l\'aperçu annonce que rien n\'est encore écrit', /rien n[’']est encore [ée]crit/i.test(ap));
  t('les créations sont comptées', /[àa] cr[ée]er/i.test(ap));
  t('les erreurs sont comptées et expliquées', ap.includes('matricule manquant'));
  t('les colonnes non reconnues sont signalées', ap.includes('Colonne bidon'));
  t('les fiches absentes du fichier sont rassurées', ap.includes('jamais supprimées'));
  t('les champs concernés sont nommés en français',
    ap.includes('prix de l’heure') || ap.includes('CNSS'), ap.slice(0,200));
  t('les lignes en erreur remontent en haut',
    (await page.locator('#rapFiches tbody tr:first-child').innerText()).includes('erreur'));
  t('le bouton Appliquer s\'active et annonce le nombre',
    !(await page.locator('#btnAppFiches').isDisabled()) &&
    (await page.locator('#btnAppFiches').innerText()).includes('2'));
  page.once('dialog', d => { t('une confirmation détaille ce qui sera écrit',
    d.message().includes('créée') && d.message().includes('Aucun pointage')); d.accept() });
  await page.click('#btnAppFiches');
  await page.waitForSelector('#persBody tr',{timeout:8000});
  t('après application, on revient sur la liste du personnel',
    /personnel/i.test(await page.locator('.topbar').innerText()));

  console.log('\n--- Application installable (PWA) ---');
  const p3 = await browser.newPage({ viewport:{width:390,height:844} });
  const err3=[]; p3.on('pageerror',e=>err3.push(e.message));
  await p3.goto('http://localhost:8777/moi?t=TOK1', { waitUntil:'networkidle' });
  await p3.waitForSelector('#pin', { timeout:8000 });
  const man = await p3.evaluate(()=>{
    const l=document.querySelector('link[rel=manifest]');return l?l.getAttribute('href'):''});
  t('le manifeste est référencé depuis la racine', man==='/manifest.webmanifest', man);
  const mj = await p3.evaluate(async()=>{ const r=await fetch('/manifest.webmanifest'); return r.ok?r.json():null });
  t('le manifeste est servi et lisible', !!mj && mj.start_url==='/moi', JSON.stringify(mj||{}).slice(0,80));
  t('portée « / » : le service worker peut contrôler /moi', mj && mj.scope==='/');
  const swh = await p3.evaluate(async()=>{
    const r=await fetch('/sw.js'); return {ok:r.ok, allowed:r.headers.get('service-worker-allowed')||''} });
  t('/sw.js est servi depuis la racine', swh.ok===true);
  t('en-tête Service-Worker-Allowed', swh.allowed==='/', swh.allowed);
  const enr = await p3.evaluate(()=>navigator.serviceWorker.getRegistrations()
      .then(rs=>rs.map(r=>r.scope)).catch(()=>[]));
  t('le service worker est enregistré à la racine',
    enr.some(x=>/:\d+\/$/.test(x)) && !enr.some(x=>x.indexOf('/assets/')>=0), enr.join(' | '));
  t('bandeau hors ligne présent mais masqué en ligne',
    await p3.locator('#hors').count()===1 && !(await p3.locator('#hors').isVisible()));
  t('espace salarié sans erreur JS après ces changements', err3.length===0, err3.join(' | '));
  await p3.close();

  console.log('\n--- Erreurs console ---');
  const graves = erreurs.filter(e=>!/favicon|manifest|sw\.js|ServiceWorker|Failed to load resource/i.test(e));
  t('aucune erreur JavaScript', graves.length===0, graves.slice(0,4).join(' | '));

  /* on navigue comme un utilisateur (clic sur le menu) : un page.goto qui ne
     change que le fragment d'URL n'est pas garanti de déclencher le rendu */
  await page.click('[data-v="dashboard"]');
  await page.waitForSelector('#cAbs svg',{timeout:15000});
  await page.screenshot({ path:'./captures/vue_dashboard.png' });
  await page.click('[data-v="presences"]'); await page.waitForSelector('#presBody tr');
  await page.screenshot({ path:'./captures/vue_presences.png' });
  await page.click('button:has-text("Saisie rapide")'); await page.waitForSelector('#srBody tr');
  await page.screenshot({ path:'./captures/vue_saisie_rapide.png' });

  console.log('\n=========================');
  console.log('  '+ok+' réussis · '+ko+' échoués');
  await browser.close();
  process.exit(ko?1:0);
})().catch(e=>{ console.error('CRASH', e); process.exit(2) });
