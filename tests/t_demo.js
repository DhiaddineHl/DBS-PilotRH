const { chromium } = require('playwright');
const path = require('path');
const DEMO = path.join(__dirname,'..','demo');
(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  let ok=0, ko=0;
  const t=(n,c,d)=>{ if(c)ok++; else {ko++;console.log('  ECHEC '+n+(d?' :: '+d:''))} };
  const errs=[];
  const p = await b.newPage({ viewport:{width:1440,height:1000} });
  p.on('dialog', d => d.accept());        // toutes les confirmations sont acceptées
  p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()) });

  // === fichier ouvert en file:// comme par un double-clic ===
  await p.goto('file://'+path.join(DEMO,'PilotRH_demo.html'));
  await p.waitForSelector('#nav .nav-item', { timeout:15000 });

  console.log('\n--- Ouverture sans serveur ni mot de passe ---');
  t('protocole file://', p.url().startsWith('file://'), p.url());
  t('application démarrée', await p.locator('#nav .nav-item').count() >= 10);
  t('aucune redirection vers /login', !p.url().includes('login'));
  t('bandeau de démonstration visible', await p.locator('#demoBar').isVisible());
  t('tableau de bord rempli', await p.locator('.kpi').count() >= 6);
  const eff = await p.locator('.kpi .val').first().innerText();
  t('effectif fictif chargé', +eff > 50, eff);

  console.log('\n--- Les écrans se remplissent ---');
  await p.click('[data-v="presences"]'); await p.waitForSelector('#presBody tr');
  t('feuille de pointage', await p.locator('#presBody tr').count() > 50);
  t('journées à vérifier détectées', await p.locator('.banner-warn').count() >= 1);
  await p.click('[data-v="rapports"]'); await p.waitForSelector('#repBody tr');
  t('rapport de paie', await p.locator('#repBody tr').count() > 50);
  t('total calculé', (await p.locator('.rep-tot').innerText()).includes('h'));
  await p.click('[data-v="personnel"]'); await p.waitForSelector('#persBody tr');
  t('liste du personnel', await p.locator('#persBody tr').count() > 50);
  t('matricules affichés', (await p.locator('#persBody tr').first().innerText()).match(/\d{3}/) !== null);
  await p.click('[data-v="absences"]'); await p.waitForSelector('#rangeBody tr');
  t('absences', await p.locator('#rangeBody tr').count() >= 1);
  await p.click('[data-v="conges"]'); await p.waitForSelector('#cgBody tr');
  t('congés', await p.locator('#cgBody tr').count() >= 5);
  await p.click('[data-v="retards"]'); await p.waitForSelector('.kpi');
  t('retards', (await p.locator('.page').innerText()).includes('Classement'));
  await p.click('[data-v="rse"]'); await p.waitForSelector('#cAge svg');
  t('RSE avec graphiques SVG', await p.locator('.rse-card').count() === 8);
  await p.click('[data-v="dashboard"]'); await p.waitForSelector('#cAbs svg');
  t('courbe d\'absentéisme réelle', await p.locator('#cAbs svg polyline').count() === 1);
  t('camembert', await p.locator('#cServ svg path').count() > 2);

  console.log('\n--- On peut vraiment modifier ---');
  await p.click('[data-v="presences"]'); await p.waitForSelector('#presBody tr');
  const sel = p.locator('#presBody select').first();
  const avant = await p.locator('#presBody tr').first().innerText();
  await sel.selectOption('leave'); await p.waitForTimeout(500);
  t('changement de statut appliqué', (await p.locator('#presBody tr').first().innerText()) !== avant);
  t('aucun bandeau d\'erreur d\'enregistrement', !(await p.locator('#syncbar').evaluate(e=>e.classList.contains('on'))));
  const h = p.locator('#presBody input[aria-label^="Heures travaillées"]').first();
  const ligne = await h.evaluate(el=>el.closest('tr').querySelector('td.mono').textContent);
  await h.fill('7,5'); await h.press('Enter'); await p.waitForTimeout(700);
  // la valeur est dans un champ : innerText ne la contient pas, on lit inputValue
  const tr = p.locator('#presBody tr').filter({ has: p.locator('td.mono', { hasText: ligne }) }).first();
  const relu = await tr.locator('input[aria-label^="Heures travaillées"]').inputValue();
  t('saisie manuelle des heures acceptée', relu === '7,50', 'valeur relue : '+relu);
  t('la saisie manuelle protège la journée (cadenas)',
    (await tr.innerHTML()).includes('\u{1F512}'), 'pas de cadenas');

  console.log('\n--- Saisie rapide ---');
  await p.click('button:has-text("Saisie rapide")'); await p.waitForSelector('#srBody tr');
  t('grille de saisie', await p.locator('#srBody tr').count() > 50);
  await p.click('button:has-text("Tout sélectionner")'); await p.waitForTimeout(300);
  t('sélection en masse', +(await p.locator('#srN').innerText()) > 50);
  await p.locator('#overlay button').filter({ hasText:/^Congé$/ }).first().click();
  await p.waitForTimeout(700);
  t('action en masse appliquée',
    await p.locator('#srBody select').first().inputValue() === 'leave',
    await p.locator('#srBody select').first().inputValue());
  await p.keyboard.press('Escape');

  console.log('\n--- Correction sur une plage de dates ---');
  await p.click('[data-v="personnel"]'); await p.waitForSelector('#persBody tr');
  await p.locator('#persBody .emp-cell').first().click(); await p.waitForSelector('#histBox .hist-line');
  await p.click('button:has-text("Corriger sur une plage")'); await p.waitForSelector('#coBody tr');
  t('grille par date', await p.locator('#coBody tr').count() > 5);
  await p.click('button:has-text("Jours ouvrés")'); await p.waitForTimeout(400);
  const nSel = +(await p.locator('#coN').innerText());
  t('sélection des jours ouvrés', nSel > 3, String(nSel));
  await p.click('button:has-text("Appliquer à la sélection")'); await p.waitForTimeout(900);
  t('correction en masse appliquée', (await p.locator('#coInfo').innerText()).includes('j travaillés'));
  await p.keyboard.press('Escape');

  console.log('\n--- Paramètres : fériés et plage de pause ---');
  await p.click('[data-v="presences"]'); await p.waitForSelector('#presBody tr');
  await p.click('button[aria-label="Paramètres horaires"]'); await p.waitForSelector('#setBody');
  const st = (await p.locator('#setBody').innerText()).toLowerCase();
  t('jours fériés paramétrables', st.includes('jours fériés') && st.includes('fête du travail'));
  t('fête mobile d\'exemple présente', st.includes('aïd'));
  t('plage de pause pré-remplie', (await p.locator('#setBody').innerHTML()).includes('value="12:00"'));
  await p.keyboard.press('Escape');

  console.log('\n--- Messagerie et sondages ---');
  await p.click('[data-v="parametres"]'); await p.waitForSelector('#auditBody tr');
  t('journal d\'audit', await p.locator('#auditBody tr').count() > 5);
  t('signalements des salariés', await p.locator('#sigBody tr').count() >= 2);
  await p.click('button:has-text("Ouvrir la messagerie")'); await p.waitForSelector('#comsBody .seg');
  t('note de service listée', (await p.locator('#comsBody').innerText()).includes('Fermeture de l’atelier'));
  t('accusés de lecture chiffrés', (await p.locator('#comsBody').innerText()).includes('ont lu'));
  await p.click('#comsBody .seg button:nth-child(2)'); await p.waitForTimeout(300);
  t('sondage avec résultats', (await p.locator('#comsBody').innerText()).includes('pause déjeuner'));
  await p.keyboard.press('Escape');

  console.log('\n--- Ce qui exige le serveur est expliqué, pas silencieux ---');
  await p.click('[data-v="rapports"]'); await p.waitForSelector('#repBody tr');
  await p.click('button:has-text("PDF paie")'); await p.waitForTimeout(1200);
  const toasts = await p.locator('#toasts').innerText();
  t('le PDF explique qu\'il faut le serveur', toasts.toLowerCase().includes('serveur'), toasts.slice(0,140));

  console.log('\n--- Export CSV (doit fonctionner hors ligne) ---');
  const dl = p.waitForEvent('download', {timeout:8000}).catch(()=>null);
  await p.click('button:has-text("CSV paie")');
  const fichier = await dl;
  t('CSV téléchargé', fichier !== null, fichier ? await fichier.suggestedFilename() : 'aucun');

  console.log('\n--- Mobile ---');
  await p.setViewportSize({width:390,height:844});
  await p.goto('file://'+path.join(DEMO,'PilotRH_demo.html'));
  await p.waitForSelector('.burger');
  t('bouton menu visible', await p.locator('.burger').isVisible());
  await p.click('.burger'); await p.waitForTimeout(300);
  t('tiroir ouvert', await p.locator('#side').evaluate(e=>e.classList.contains('open')));
  await p.click('[data-v="presences"]'); await p.waitForTimeout(800);
  t('navigation mobile', (await p.locator('.topbar h1').innerText()).includes('Présences'));
  await p.screenshot({path:'./captures/demo_mobile.png'});

  // === espace salarié ===
  console.log('\n--- Espace salarié (démonstration) ---');
  const s = await b.newPage({ viewport:{width:390,height:844} });
  const errS=[]; s.on('pageerror',e=>errS.push(e.message));
  await s.goto('file://'+path.join(DEMO,'PilotRH_demo_salarie.html'));
  await s.waitForSelector('#pin', { timeout:12000 });
  t('espace salarié s\'ouvre', true);
  t('code de démonstration indiqué', (await s.content()).includes('123456'));
  await s.fill('#pin','123456'); await s.waitForTimeout(1200);
  const cs = await s.content();
  t('pointage affiché', cs.includes('Jours travaillés'), cs.slice(0,150));
  t('bloc congés', cs.includes('Heures de congé dues'));
  t('onglets notes / sondages', await s.locator('.seg button').count() >= 3);
  await s.click('.seg button:nth-child(2)'); await s.waitForTimeout(400);
  t('note de service lisible', (await s.content()).includes('Fermeture de l’atelier'));
  await s.click('.seg button:nth-child(3)'); await s.waitForTimeout(400);
  t('sondage affiché', (await s.content()).includes('pause déjeuner'));
  s.once('dialog',d=>d.accept());
  await s.locator('.vote-opt').first().click(); await s.waitForTimeout(700);
  t('vote enregistré (en mémoire)', (await s.content()).includes('réponse(s)'));
  await s.screenshot({path:'./captures/demo_salarie.png'});
  t('aucune erreur JS côté salarié', errS.length===0, errS.join(' | '));

  console.log('\n--- Alertes cliquables et import de fiches (hors ligne) ---');
  await p.setViewportSize({width:1440,height:1000});
  await p.evaluate(()=>go('alertes')); await p.waitForSelector('.alert-row');
  const nA = await p.locator('.alert-row').count();
  t('les alertes de la démo sont cliquables', await p.locator('.alert-clic').count() === nA, 'n='+nA);
  const cible = await p.locator('.alert-clic').first().getAttribute('onclick');
  t('l’alerte porte bien une action', /\w+\(/.test(cible||''), cible||'');
  await p.locator('.alert-clic').first().click(); await p.waitForTimeout(1200);
  t('le clic mène ailleurs : modale ouverte ou changement de vue',
    (await p.locator('#overlay.open').count()) === 1 ||
    (await p.evaluate(()=>window.VIEW)) !== 'alertes',
    'vue='+(await p.evaluate(()=>window.VIEW)));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  await p.evaluate(()=>go('personnel')); await p.waitForSelector('#persBody tr');
  await p.click('button:has-text("Importer des fiches")');
  await p.waitForSelector('#fichesIn',{state:'attached'});
  t('le parcours d’import est présent dans la démo',
    (await p.locator('.modal-body').innerText()).includes('Modèle vierge'));
  await p.click('button:has-text("Modèle vierge")'); await p.waitForTimeout(800);
  const tst = await p.locator('#toasts').innerText().catch(()=>'');
  t('la démo explique honnêtement que le classeur vient du serveur',
    /serveur|impossible/i.test(tst), tst.slice(0,140));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  await p.evaluate(()=>go('rapports')); await p.waitForSelector('#repBody tr');
  t('les colonnes de rémunération sont là',
    /montant/i.test(await p.locator('.tablecard thead').innerText()));

  console.log('\n--- Erreurs console ---');
  const graves = errs.filter(e=>!/favicon|manifest|sw\.js|ServiceWorker|net::ERR_FILE_NOT_FOUND|fonts\.googleapis|fonts\.gstatic|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(e));
  t('aucune erreur JavaScript', graves.length===0, graves.slice(0,4).join(' | '));

  console.log('\n=========================');
  console.log('  '+ok+' réussis · '+ko+' échoués');
  await b.close();
  process.exit(ko?1:0);
})().catch(e=>{ console.error('CRASH', e); process.exit(2) });
