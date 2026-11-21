const http=require('http'), fs=require('fs'), path=require('path');
const ROOT=require('path').join(__dirname,'..','static');
const TODAY=new Date().toISOString().slice(0,10);
function d(n){const x=new Date();x.setDate(x.getDate()+n);return x.toISOString().slice(0,10)}
const SERVICES=['Couture','Coupe','Finition','Repassage','Qualité','Méthodes','Magasin'];
const ATELIERS=['Atelier A','Atelier B','Atelier C'];
const employees=[];
for(let i=1;i<=120;i++){
  employees.push({id:'E'+String(i).padStart(3,'0'),matricule:String(100+i),
    // un nom hostile pour verifier l'echappement
    prenom:i===7?'<img src=x onerror="window.__XSS=1">':'Prenom'+i,
    nom:i===8?'"><script>window.__XSS2=1</script>':'Nom'+i,
    poste:'Couturière piqueuse',categorie:i%20===0?'Cadre':'Ouvrier',
    service:SERVICES[i%SERVICES.length],atelier:ATELIERS[i%3],contrat:i%5?'CDI':'CDD',
    embauche:'2019-03-1'+(i%9),naissance:'199'+(i%10)+'-0'+(1+i%9)+'-1'+(i%9),
    famille:'Célibataire',enfants:i%3,niveau:'Bac',email:'',tel:'',adresse:'Nabeul',
    salaire:900+i,cin:String(8000000+i),sexe:i%15===0?'H':'F',responsable:'',actif:true});
}
const settings={modeHS:'fin',arrondi:0,arrondiSens:'proche',arrondiPortee:'periode',
  congesDu:'',congesAu:'',congesCoef:0.0417,feriesActifs:true,clotures:[],
  feriesFixes:[{md:'01-01',nom:'Nouvel An'},{md:'05-01',nom:'Fête du Travail'},{md:'08-13',nom:'Fête de la Femme'}],
  feries:[{date:d(3),nom:'Aïd El Fitr',jours:2}],
  jours:{0:{actif:false},6:{actif:true,debut:'07:30',fin:'13:00',pause:0,tol:15,grace:15},
    1:{actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15},
    2:{actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15},
    3:{actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15},
    4:{actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15},
    5:{actif:true,debut:'07:30',fin:'16:30',pause:30,pauseDe:'12:00',pauseA:'12:30',tol:15,grace:15}},
  periodes:[]};
const pointages={};
for(let k=0;k<75;k++){
  const ds=d(-k); const w=new Date(ds+'T12:00').getDay();
  if(w===0&&k!==0)continue;      // (aujourd'hui est gardé même un dimanche : les tests ouvrent la feuille du jour)
  const rec={};
  employees.forEach((e,i)=>{
    const h=(k*31+i*17)%100;
    if(h<5)rec[e.id]={statut:'absent',entree:'',sortie:''};
    else if(h<8)rec[e.id]={statut:'leave',entree:'',sortie:''};
    else if(h<10)rec[e.id]={statut:'present',entree:'07:32',sortie:''};    // sortie manquante
    else if(h<14)rec[e.id]={statut:'present',entree:'07:55',sortie:'16:33'};
    else if(h<18)rec[e.id]={statut:'present',entree:'07:28',sortie:'18:12'};
    else if(h<21)rec[e.id]={statut:'present',punches:['07:30','12:00','12:40','16:35']};
    else rec[e.id]={statut:'present',entree:'07:2'+(i%9),sortie:'16:3'+(i%9)};
  });
  pointages[ds]=rec;
}
/* Journées volontairement anormales, pour l'écran des corrections en masse.
   On prend des jours de semaine travaillés (ni dimanche, ni samedi court). */
function jourOuvre(depuis){for(let k=depuis;k<70;k++){const w=new Date(d(-k)+'T12:00').getDay();if(w>=1&&w<=5&&pointages[d(-k)])return d(-k)}return d(-depuis)}
const J_PANNE=jourOuvre(6), J_TOT=jourOuvre(11), J_NUIT=jourOuvre(16);
employees.forEach((e,i)=>{
  /* panne de capture : presque tout l'atelier n'a que le badge du matin */
  if(i%10!==0)pointages[J_PANNE][e.id]={statut:'present',entree:'07:2'+(i%9),sortie:''};
  /* démarrage collectif à 06 h 30 */
  if(i%10<7)pointages[J_TOT][e.id]={statut:'present',entree:'06:2'+(i%9),sortie:'16:3'+(i%9)};
  /* horloge déréglée : entrées à 22 h, sorties après minuit */
  if(i<6)pointages[J_NUIT][e.id]={statut:'present',entree:'22:0'+i,sortie:''};
  else if(i<10)pointages[J_NUIT][e.id]={statut:'present',punches:['00:4'+(i%9),'07:30']};
});
/* absences : E005 absente depuis 3 jours ouvrés sans justificatif ; E006 aussi, mais couverte
   par un certificat ; E009 absente seulement hier */
function joursOuvresAvant(n){const r=[];for(let k=1;r.length<n&&k<20;k++){const ds=d(-k),w=new Date(ds+'T12:00').getDay();if(w>=1&&w<=6&&pointages[ds])r.push(ds)}return r}
const ABS3=joursOuvresAvant(3);
ABS3.forEach(ds=>{pointages[ds]['E005']={statut:'absent',entree:'',sortie:''};pointages[ds]['E006']={statut:'absent',entree:'',sortie:''}});
if(pointages[TODAY]){pointages[TODAY]['E005']={statut:'absent',entree:'',sortie:''};pointages[TODAY]['E006']={statut:'absent',entree:'',sortie:''}}
pointages[ABS3[0]]['E009']={statut:'absent',entree:'',sortie:''};
/* une journée déjà corrigée à la main ne doit plus être proposée */
pointages[J_PANNE]['E002']={statut:'present',entree:'07:30',sortie:'',hM:480,manuel:1};
const documents=[{docId:'D1',id:'E001',type:'Contrat CDI',date:'2019-03-11',resume:'CDI signé',source:'Manuel'}];
const conges=[{cid:'C1',id:'E002',type:'Congé annuel',debut:d(5),fin:d(9),jours:4,statut:'En attente'},
              {cid:'C2',id:'E003',type:'Congé annuel',debut:d(-20),fin:d(-16),jours:4,statut:'Validé',applique:true}];
const absences=[{id:'E001',type:'Maladie',debut:d(-9),fin:d(-8),jours:2,statut:'justifiée',note:'Certificat'},
  {id:'E006',type:'Maladie',debut:d(-12),fin:d(1),jours:5,statut:'justifiée',note:'Certificat médical'}];
const signalements=[{emp:'E004',nom:'Prenom4 Nom4',date:d(-2),message:'J etais presente',ts:new Date().toISOString(),traite:false}];
const notes=[{id:'N1',titre:'Fermeture vendredi',texte:'Atelier ferme',cible:{},important:true,
  ts:new Date().toISOString(),par:'RH',lus:['E001'],
  reponses:[{id:'R1',emp:'E001',nom:'Prenom1 Nom1',matricule:'101',
             texte:'Je serai absente ce jour-là',ts:new Date().toISOString(),lu:false}]}];
const votes=[{id:'V1',question:'Pause a 12h ou 12h30 ?',options:['12:00','12:30'],cible:{},anonyme:true,
  resultats:[12,30],votants:[],detail:{},ferme:false,ts:new Date().toISOString(),par:'RH'}];
const audit=[{ts:new Date().toISOString(),qui:'Système',role:'admin',ip:'10.0.0.1',action:'Amorçage'},
             {ts:new Date().toISOString(),qui:'<img src=x onerror="window.__XSS3=1">',role:'rh',ip:'10.0.0.2',action:'<b>test</b>'}];
const WIN=70;
/* liaison pointeuse : muette depuis 30 h, pour que l'alerte s'affiche */
const SILENCE=30;
const pointeuse={ip:'192.168.1.201',port:4370,motdepasse:0,intervalle:30,alerte_h:12,note:''};
const ptzEtat={ts:new Date(Date.now()-SILENCE*3600e3).toISOString(),voie:'agent',
  pointages:1180,jours:3,employees:96,par:'agent',
  derniere_erreur:{ts:new Date(Date.now()-600e3).toISOString(),voie:'agent',code:'injoignable',
    message:'Rien ne répond à l’adresse 192.168.1.201 (port 4370).',
    conseil:'Pointeuse éteinte, câble débranché, mauvaise adresse IP, ou PC sur un autre réseau.'},
  agent:{ts:new Date(Date.now()-600e3).toISOString(),etat:'erreur',pc:'PC-ATELIER',systeme:'Windows 10',version:'4.0',
    mdb:'C:\\ZKTeco\\attBackup.mdb',mdb_maj:TODAY+' 10:32',
    message:'Rien ne répond à l’adresse 192.168.1.201 (port 4370).',
    pointeuse:{nom:'F18/ID',serie:'CJ9X123456789',liaison:'TCP',pointages:98500,personnes:97,ecart_horloge_min:-47,
      premier:TODAY+' 07:02',dernier:TODAY+' 09:01',aujourdhui:184,videe_recemment:true}}};
let cleCreee=false;
/* rapport du dernier import : une fiche créée (badge sans nom) et un badge redonné */
const RAPPORT={ts:new Date().toISOString(),voie:'agent',anciens:3,rattaches:118,
  nouvelles:[{badge:'207',nom:'',sansNom:true,jours:2,premier:d(-2),dernier:d(-1),id:'E120'}],
  ignores:[{badge:'520',nom:'NOUVELLE Recrue',raison:'badge_sorti',sortie:d(-40),apres:4,jours:4,premier:d(-4),dernier:d(-1)},
           {badge:'0',nom:'Test',raison:'badge_zero',jours:1,premier:d(-1),dernier:d(-1)}]};
/* copie de PUBLIC_SALARIE dans app.py : tout endpoint de l'espace salarie */
const PUBLIC_SALARIE=['/api/me','/api/me/flag','/api/me/lu','/api/me/vote',
                     '/api/me/repondre','/api/me/nouveautes','/api/me/assiduite'];
const STORE={discipline:{entrees:[],modeles:{},compteurs:{},societe:{}}};

  /* --- dossiers disciplinaires (même logique que le serveur, en mémoire) --- */
  const DISC_PREF = {questionnaire:'Q',observation:'OB',avertissement:'AV',blame:'BL',miseapied:'MP',reprise:'RT',convocation:'CV',pv:'PV',recommandee:'LR'};
  function discApi(S, chemin, corps){
    if(!S.discipline) S.discipline = {entrees:[], societe:{}, modeles:{}, compteurs:{}};
    const d = S.discipline;
    if(chemin==='/api/discipline' && !corps) return [200,{entrees:d.entrees, societe:d.societe, modeles:d.modeles}];
    if(chemin==='/api/discipline'){
      if(!DISC_PREF[corps.type]) return [400,{error:'Type de document inconnu'}];
      if(!corps.emp) return [400,{error:'Salarié(e) non précisé(e)'}];
      let e = corps.id ? d.entrees.find(x=>x.id===corps.id) : null;
      if(!e && corps.cle_auto){ const meme=d.entrees.find(x=>x.cle_auto===corps.cle_auto); if(meme) return [200,{ok:true,entree:meme,existait:true}]; }
      if(corps.id && !e) return [404,{error:'Pièce introuvable'}];
      if(!e){
        const cle = DISC_PREF[corps.type]+'-'+String(corps.date).slice(0,4);
        d.compteurs[cle] = (d.compteurs[cle]||0)+1;
        e = {id:'D'+Math.random().toString(16).slice(2,12), emp:corps.emp, type:corps.type,
             ref:cle+'-'+String(d.compteurs[cle]).padStart(3,'0'), cree_le:new Date().toISOString(), cree_par:'RH'};
        d.entrees.push(e);
      }
      ['date','statut','jours','motif','date_faits','du','au','delai_h','faits','corps','reponse','note','suite_de','remis_le','cle_auto']
        .forEach(k=>{ if(corps[k]!==undefined) e[k]=corps[k] });
      return [200,{ok:true, entree:e}];
    }
    if(chemin==='/api/discipline/supprimer'){ d.entrees = d.entrees.filter(x=>x.id!==corps.id); return [200,{ok:true}]; }
    if(chemin==='/api/discipline/reglages'){
      if(corps.societe) d.societe = corps.societe;
      if(corps.modeles) Object.keys(corps.modeles).forEach(k=>{ if(corps.modeles[k]) d.modeles[k]=corps.modeles[k]; else delete d.modeles[k] });
      return [200,{ok:true, societe:d.societe, modeles:d.modeles}];
    }
    return null;
  }

function json(res,o,code){res.writeHead(code||200,{'Content-Type':'application/json'});res.end(JSON.stringify(o))}
const LOG=[];
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');const p=u.pathname;
  LOG.push(req.method+' '+p);
  if(p.startsWith('/api/')){
    let body='';req.on('data',c=>body+=c);
    req.on('end',()=>{
      if(p==='/api/whoami')return json(res,{login:'admin',nom:'Administrateur',role:'admin',roles:{}});
      if(p==='/api/state'){
        const from=d(-WIN);const sub={};
        for(const k in pointages)if(k>=from)sub[k]=pointages[k];
        return json(res,{employees,settings,documents,conges,absences,signalements,
          pointages:sub,fenetre:{du:from,au:TODAY},
          pointeuse:{silence_h:SILENCE,muet:SILENCE>pointeuse.alerte_h,
                     seuil_h:pointeuse.alerte_h,voie:'agent',
                     erreur:ptzEtat.derniere_erreur.message,ecart_horloge_min:-47,
                     non_importes:RAPPORT.ignores.filter(x=>x.raison!=='badge_zero').length,
                     nouvelles_fiches:RAPPORT.nouvelles.length}});
      }
      if(p==='/api/pointages'){
        const a=u.searchParams.get('frm'),b=u.searchParams.get('to');
        if(!a||!b)return json(res,{error:'params'},400);
        const sub={};for(const k in pointages)if(k>=a&&k<=b)sub[k]=pointages[k];
        return json(res,sub);
      }
      if(p==='/api/stats/absenteisme'){
        const out=[];for(let i=5;i>=0;i--){const dt=new Date();dt.setMonth(dt.getMonth()-i);
          out.push({mois:dt.toISOString().slice(0,7),taux:3+i*0.4,jours:2000,absences:80})}
        return json(res,out);
      }
      if(p==='/api/audit')return json(res,audit);
      if(p==='/api/users')return json(res,[{login:'admin',nom:'Administrateur',role:'admin'}]);
      if(p.indexOf('/api/discipline')===0){
        let b=null;if(req.method==='POST'){try{b=JSON.parse(body||'{}')}catch(e){b={}}}
        const r=discApi(STORE,p,b);if(r)return json(res,r[1],r[0]);
      }
      if(p==='/api/coms')return json(res,{notes,votes});
      if(p==='/api/backups')return json(res,{dossier:'/data/backups',conserve:30,
        sauvegardes:[{fichier:'pilotrh_x.db',taille:1234567,date:new Date().toISOString()}]});
      if(p==='/api/me'){
        let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(b.t!=='TOK1')return json(res,{error:'Lien invalide'},401);
        if(b.pin!=='123456')return json(res,{need_pin:true},401);
        const ym=(b.mois&&b.mois.length===7)?b.mois:TODAY.slice(0,7);
        const jours={};
        for(const k in pointages){if(k.slice(0,7)===ym&&pointages[k]['E001'])jours[k]=pointages[k]['E001']}
        const cj={};for(const k in pointages){if(pointages[k]['E001'])cj[k]=pointages[k]['E001']}
        return json(res,{nom:'Nom1',prenom:'Prenom1',matricule:'101',categorie:'Ouvrier',sexe:'F',
          mois:ym,today:TODAY,settings,jours,
          conges:{du:d(-300),au:d(60),auEffectif:TODAY,jours:cj},
          notes:[{id:'N1',titre:'Fermeture vendredi',texte:'Atelier ferme le 15',important:true,
                  ts:new Date().toISOString(),par:'RH',lu:false,prive:false,reponses:[]},
                 {id:'N2',titre:'Votre pointage du 12',texte:'Corrigé : sortie à 16h30.',important:false,
                  ts:new Date().toISOString(),par:'RH',lu:true,prive:true,
                  reponses:[{texte:'Merci beaucoup',ts:new Date().toISOString(),moi:true}]}],
          votes:[{id:'V1',question:'Pause a 12h ou 12h30 ?',options:['12:00','12:30'],
                  ferme:false,vote:false,resultats:null,monChoix:null}]});
      }
      /* Le faux serveur applique la MEME regle publique que le vrai : seuls les
         chemins de l'espace salarie passent sans session. C'est ce qui manquait
         quand /api/me/vote a ete oublie de la liste publique cote serveur — le
         faux serveur repondait « ok » et le test ne voyait rien. */
      /* même contrat que le serveur : jeton + code, jours de la seule salariée E001 */
      if(p==='/api/me/assiduite'){
        let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(b.t!=='TOK1')return json(res,{error:'Lien invalide'},401);
        if(b.pin!=='123456')return json(res,{need_pin:true},401);
        STORE.assiAppels=(STORE.assiAppels||[]).concat([{du:b.du,au:b.au}]);
        let du=b.du,au=b.au>TODAY?TODAY:b.au;
        const jours={};for(const k in pointages){if(k>=du&&k<=au&&pointages[k]['E001'])jours[k]=pointages[k]['E001']}
        return json(res,{du,au,today:TODAY,embauche:'2019-03-11',jours,settings,
          justificatifs:absences.filter(a=>a.id==='E001'&&a.statut==='justifiée').map(a=>({debut:a.debut,fin:a.fin,type:a.type,statut:a.statut}))});
      }
      if(p==='/api/__assi')return json(res,STORE.assiAppels||[]);
      if(p.startsWith('/api/me')&&PUBLIC_SALARIE.indexOf(p)<0)
        return json(res,{error:'non_connecte'},401);
      if(p==='/api/me/lu'||p==='/api/me/flag')return json(res,{ok:true});
      if(p==='/api/me/repondre'){
        let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(!b.t)return json(res,{error:'invalide'},401);
        if(!String(b.texte||'').trim())return json(res,{error:'Message vide'},400);
        return json(res,{ok:true,ts:new Date().toISOString()});
      }
      if(p==='/api/me/nouveautes'){
        let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(b.t!=='TOK1')return json(res,{error:'invalide'},401);
        return json(res,{ok:true,messages:1,sondages:1,titre:'Fermeture vendredi',
          apercu:'Atelier ferme le 15',important:true,ts:new Date().toISOString(),prenom:'Prenom1'});
      }
      if(p==='/api/me/vote'){
        let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(!b.t)return json(res,{error:'invalide'},401);
        const v=votes.find(x=>x.id===b.id);
        if(!v)return json(res,{error:'Sondage introuvable'},404);
        if(v.votants&&v.votants.indexOf('E001')>=0)return json(res,{error:'Vous avez déjà répondu'},409);
        v.resultats=v.resultats||v.options.map(()=>0);
        v.resultats[b.choix]=(v.resultats[b.choix]||0)+1;
        v.votants=(v.votants||[]).concat(['E001']);
        return json(res,{ok:true,resultats:v.resultats});
      }
      if(p==='/api/coms/note/lu-reponses'){
        notes.forEach(n=>(n.reponses||[]).forEach(r=>r.lu=true));
        return json(res,{ok:true});
      }
      /* les écritures groupées sont gardées pour que les tests vérifient ce qui part réellement */
      if(p==='/api/pointages/bulk'){try{STORE.bulks=(STORE.bulks||[]).concat([JSON.parse(body||'{}')])}catch(e){}return json(res,{ok:true})}
      if(p==='/api/__bulks')return json(res,STORE.bulks||[]);
      if(p==='/api/state-meta'){try{STORE.meta=JSON.parse(body||'{}')}catch(e){}return json(res,{ok:true})}
      if(p==='/api/__meta')return json(res,STORE.meta||{});
      if(p==='/api/pointage'){try{STORE.pointage=(STORE.pointage||[]).concat([JSON.parse(body||'{}')])}catch(e){}return json(res,{ok:true})}
      if(p==='/api/__pointage')return json(res,STORE.pointage||[]);
      if(p==='/api/pointage'||p==='/api/day')
        return json(res,{ok:true});
      /* import de fiches : aperçu puis application, comme le vrai serveur */
      if(p==='/api/employees/import-fiches'){
        const app=/appliquer"?\r?\n?\r?\n?1/.test(body)||/name="appliquer"[\s\S]{0,40}?1/.test(body);
        const rap={fichier:'fiches.xlsx',inconnues:['Colonne bidon'],
          resume:{total:3,creation:1,maj:1,inchange:0,erreur:1,absents:4},
          lignes:[
            {n:6,matricule:'101',nom:'Prenom1 Nom1',action:'maj',champs:['tauxHoraire','cnss'],erreurs:[],avis:[]},
            {n:7,matricule:'999',nom:'Nouvelle Ouvriere',action:'creation',champs:['nom','matricule'],erreurs:[],avis:[]},
            {n:8,matricule:'',nom:'',action:'erreur',champs:[],erreurs:['matricule manquant'],avis:[]}]};
        if(app)rap.applique={crees:1,majs:1};
        return json(res,rap);
      }
      /* pointeuse : réglages, état de la liaison, fichier de lancement de l'agent */
      if(p==='/api/pointeuse'&&req.method==='GET')
        return json(res,{reglages:pointeuse,etat:ptzEtat,
          silence_h:ptzEtat.ts?SILENCE:null,muet:!ptzEtat.ts||SILENCE>pointeuse.alerte_h,
          lecture_directe_possible:false,mdb_path:'',sync:{},
          url_publique:'https://demo.up.railway.app',peut_modifier:true,cle_creee:cleCreee,rapport:RAPPORT});
      if(p==='/api/import/reintegrer'){let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(employees.some(e=>String(e.matricule).replace(/^0+/,'')===String(b.badge).replace(/^0+/,'')))return json(res,{error:'Une fiche porte déjà ce badge.'},409);
        const id='E'+String(employees.length+1).padStart(3,'0');
        employees.push({id,matricule:b.badge,cin:b.badge,prenom:'',nom:b.nom||('Badge '+b.badge),poste:'Couturière piqueuse',categorie:'Ouvrier',
          service:'Couture',atelier:'Atelier A',contrat:'CDI',embauche:b.depuis||'',sexe:'F',actif:true,aCompleter:true});
        RAPPORT.ignores=RAPPORT.ignores.filter(x=>x.badge!==b.badge);STORE.reintegres=(STORE.reintegres||[]).concat([b]);
        return json(res,{ok:true,id})}
      if(p==='/api/pointeuse/agent.txt')return json(res,{error:"Votre navigateur affiche une ancienne version de PilotRH. Rechargez la page (touches Ctrl + F5), puis utilisez « Télécharger le kit de l'agent »."},410);
      if(p==='/api/pointeuse/cle'&&req.method==='GET'){cleCreee=true;return json(res,{cle:'CLE-DEMO-abc123',url:'https://demo.up.railway.app'})}
      if(p==='/api/import/vu'){RAPPORT.nouvelles=[];return json(res,{ok:true})}
      if(p==='/api/__reint')return json(res,STORE.reintegres||[]);
      if(p==='/api/pointeuse/kit.zip'){cleCreee=true;res.writeHead(200,{'Content-Type':'application/zip',
        'Content-Disposition':'attachment; filename="PilotRH_Agent.zip"'});return res.end('PK\u0005\u0006'+'\u0000'.repeat(18))}
      if(p==='/api/pointeuse/cle'&&req.method==='POST')return json(res,{ok:true});
      if(p==='/api/pointeuse'&&req.method==='POST'){
        let b={};try{b=JSON.parse(body||'{}')}catch(e){}
        if(b.ip&&!/^\d+\.\d+\.\d+\.\d+$/.test(b.ip))
          return json(res,{error:'Adresse IP invalide : « '+b.ip+' »'},400);
        if(b.port&&[4370,4371].indexOf(+b.port)<0)
          return json(res,{error:'Port inattendu pour une pointeuse ZKTeco'},400);
        Object.assign(pointeuse,{ip:b.ip||pointeuse.ip,port:+b.port||pointeuse.port,
          motdepasse:+b.motdepasse||0,intervalle:+b.intervalle||pointeuse.intervalle,
          alerte_h:+b.alerte_h||pointeuse.alerte_h,note:b.note||'',source:b.source||'auto',mdb:b.mdb||''});
        return json(res,{ok:true,reglages:pointeuse});
      }
      if(p==='/api/employees/modele.xlsx'){
        res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        return res.end('PK stub');
      }
      if(p==='/api/report/pdf'){res.writeHead(200,{'Content-Type':'application/pdf'});return res.end('%PDF-1.4 stub')}
      return json(res,{ok:true});
    });
    return;
  }
  /* le service worker et le manifeste sont servis depuis la RACINE, comme le
     vrai serveur : sans cela leur portée se limiterait à /assets/ */
  let f=p==='/'?'/index.html':(p==='/moi'?'/moi.html':(p==='/login'?'/login.html':
        (p==='/sw.js'?'/assets/sw.js':(p==='/manifest.webmanifest'?'/assets/manifest.webmanifest':p))));
  const full=path.join(ROOT,f.replace(/^\/+/,''));
  if(!full.startsWith(ROOT)||!fs.existsSync(full)){res.writeHead(404);return res.end('404')}
  const ext=path.extname(full);
  const entetes={};
  if(p==='/sw.js')entetes['Service-Worker-Allowed']='/';
  const ct={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8',
    '.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
    '.webmanifest':'application/manifest+json'}[ext]||'application/octet-stream';
  res.writeHead(200,Object.assign({'Content-Type':ct},entetes));res.end(fs.readFileSync(full));
}).listen(8777,()=>console.log('mock sur 8777'));
process.on('SIGTERM',()=>{console.log('APPELS:'+LOG.length);process.exit(0)});
