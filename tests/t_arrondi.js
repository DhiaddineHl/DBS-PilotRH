const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage({viewport:{width:1100,height:1000}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  let ok=0,ko=0; const t=(n,c,d)=>{if(c)ok++;else{ko++;console.log('  ECHEC '+n+(d?' :: '+d:''))}};
  await p.goto('file://'+require('path').join(__dirname,'..','demo')+'/PilotRH_arrondi.html');
  await p.waitForSelector('#tb tr');
  t('page ouverte sans erreur', errs.length===0, errs.join(' | '));

  // cas par defaut : arrivee 07:37, pas 15 proche, 26 jours
  const reel=await p.locator('#vReel').innerText();
  const jour=await p.locator('#vJour').innerText();
  const tot =await p.locator('#vTot').innerText();
  console.log('  arrivée 07:37 · pas 15 proche · 26 j →  réel',reel,'| /jour',jour,'| /cumul',tot);
  t('réel = 217 h 58', reel.replace(/\s/g,'')==='217h58', reel);
  t('arrondi journée = 221 h 00', jour.replace(/\s/g,'')==='221h00', jour);
  t('arrondi cumul = 218 h 00', tot.replace(/\s/g,'')==='218h00', tot);
  t('verdict signale l\'écart', (await p.locator('#verdict').innerText()).includes('3 h 00'),
    await p.locator('#verdict').innerText());
  t('écart cumulé croît dans le tableau',
    (await p.locator('#tb tr:nth-child(26) td:last-child').innerText()).includes('3 h 02'));

  // une minute plus tard : bascule dans l'autre sens
  await p.selectOption('#arr','07:38'); await p.waitForTimeout(250);
  const j2=await p.locator('#vJour').innerText();
  console.log('  arrivée 07:38 →  /jour',j2,'| /cumul',await p.locator('#vTot').innerText());
  t('07:38 bascule à 214 h 30', j2.replace(/\s/g,'')==='214h30', j2);

  // à l'inférieur, 1 minute de retard
  await p.selectOption('#arr','07:31'); await p.selectOption('#sens','inferieur'); await p.waitForTimeout(250);
  console.log('  arrivée 07:31 · à l\'inférieur →  réel',await p.locator('#vReel').innerText(),
    '| /jour',await p.locator('#vJour').innerText(),'| /cumul',await p.locator('#vTot').innerText());
  t('à l\'inférieur : 6 h de dérive', (await p.locator('#verdict').innerText()).includes('6 h 00'),
    await p.locator('#verdict').innerText());

  // sans arrondi : les deux methodes coincident
  await p.selectOption('#pas','0'); await p.waitForTimeout(250);
  t('sans arrondi, tout coïncide',
    (await p.locator('#vReel').innerText())===(await p.locator('#vJour').innerText()) &&
    (await p.locator('#vReel').innerText())===(await p.locator('#vTot').innerText()));

  // heures supplementaires
  await p.selectOption('#pas','15'); await p.selectOption('#sens','proche');
  await p.selectOption('#cas','hs'); await p.waitForTimeout(300);
  console.log('  H.sup sortie 18:07 →  réel',await p.locator('#vReel').innerText(),
    '| /jour',await p.locator('#vJour').innerText(),'| /cumul',await p.locator('#vTot').innerText());
  t('H.sup : réel 42 h 02', (await p.locator('#vReel').innerText()).replace(/\s/g,'')==='42h02');
  t('H.sup : arrondi journée 39 h 00', (await p.locator('#vJour').innerText()).replace(/\s/g,'')==='39h00');

  // cas variable : les erreurs se compensent en partie
  await p.selectOption('#cas','varie'); await p.waitForTimeout(300);
  console.log('  arrivées variables →  réel',await p.locator('#vReel').innerText(),
    '| /jour',await p.locator('#vJour').innerText(),'| /cumul',await p.locator('#vTot').innerText());
  t('cas variable calculé', (await p.locator('#vReel').innerText()).includes('217'));

  t('tableau des deux ouvrières', (await p.locator('#duo').innerText()).includes('Amal'));
  t('écart de 6 h 30 entre les deux', (await p.locator('#duo').innerText()).includes('6 h 30'),
    await p.locator('#duo').innerText());
  t('tableau des pires cas', (await p.locator('#pire').innerText()).includes('12 h 34'));
  t('effet atelier chiffré', (await p.locator('#atelier').innerText()).includes('heures par an'));
  t('curseur de jours', await p.locator('#nj').count()===1);
  await p.locator('#nj').fill('10'); await p.waitForTimeout(250);
  t('10 jours → tableau réduit', await p.locator('#tb tr').count()===11);

  await p.selectOption('#cas','fixe'); await p.selectOption('#arr','07:37');
  await p.locator('#nj').fill('26'); await p.waitForTimeout(300);
  await p.screenshot({path:'./captures/arrondi.png',fullPage:false});
  console.log('\n  '+ok+' réussis · '+ko+' échoués');
  await b.close(); process.exit(ko?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
