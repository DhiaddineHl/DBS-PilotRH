/* Ouvre le fichier construit avec les données réelles et vérifie qu'il fonctionne */
const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage({viewport:{width:1440,height:1000}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  let ok=0,ko=0; const t=(n,c,d)=>{if(c)ok++;else{ko++;console.log('  ECHEC '+n+(d?' :: '+d:''))}};
  const cible=require('path').join(__dirname,'..','demo','PilotRH_mes_donnees.html');
  if(!require('fs').existsSync(cible)){
    console.log('  (ignoré : lancez d\'abord  python3 outils/integrer_sauvegarde.py votre_sauvegarde.json)');
    await b.close(); process.exit(0);
  }
  await p.goto('file://'+cible);
  await p.waitForSelector('#nav .nav-item',{timeout:20000});
  t('ouverture sans erreur', errs.filter(e=>!/font|manifest|sw\.js|Failed to load/i.test(e)).length===0,
    errs.slice(0,3).join(' | '));
  t('bandeau signale les données réelles',
    (await p.locator('#demoBar').innerText()).includes('VOS DONNÉES RÉELLES'));
  t('effectif chargé', +(await p.locator('.kpi .val').first().innerText())>0,
    await p.locator('.kpi .val').first().innerText());
  await p.click('[data-v="presences"]'); await p.waitForSelector('#presBody tr');
  t('feuille de pointage remplie', await p.locator('#presBody tr').count()>90);
  t('journées à vérifier signalées', await p.locator('.banner-warn').count()>=1);
  await p.click('[data-v="rapports"]'); await p.waitForSelector('#repBody tr');
  const tot=await p.locator('.rep-tot').innerText();
  console.log('  TOTAL du mois affiché :', tot.replace(/\s+/g,' '));
  t('total de paie calculé', tot.includes('h'));
  await p.click('[data-v="dashboard"]'); await p.waitForSelector('#cAbs svg');
  t('courbe absentéisme sur données réelles', await p.locator('#cAbs svg polyline').count()===1);
  await p.click('button[aria-label="Alertes"]').catch(()=>{});
  await p.click('[data-v="presences"]'); await p.waitForSelector('#presBody tr');
  await p.click('button[aria-label="Paramètres horaires"]'); await p.waitForSelector('#setBody');
  const sh=await p.locator('#setBody').innerHTML();
  t('réglages de pause repris', /value="\d+"/.test(sh));
  t('plages de pause renseignées', /pauseDe/.test(sh));
  t('portée = chaque journée', /<option value="jour"[^>]*selected/.test(sh), 'portée non journalière');
  t('périodes personnalisées reprises', /cfgPer\(/.test(sh)||!/periodes/.test(sh));
  
  await p.keyboard.press('Escape');
  await p.screenshot({path:'./captures/donnees_reelles.png'});
  console.log('\n  '+ok+' réussis · '+ko+' échoués');
  await b.close(); process.exit(ko?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
