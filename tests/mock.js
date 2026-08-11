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
  if(w===0)continue;
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
const documents=[{docId:'D1',id:'E001',type:'Contrat CDI',date:'2019-03-11',resume:'CDI signé',source:'Manuel'}];
const conges=[{cid:'C1',id:'E002',type:'Congé annuel',debut:d(5),fin:d(9),jours:4,statut:'En attente'},
              {cid:'C2',id:'E003',type:'Congé annuel',debut:d(-20),fin:d(-16),jours:4,statut:'Validé',applique:true}];
const absences=[{id:'E001',type:'Maladie',debut:d(-9),fin:d(-8),jours:2,statut:'justifiée',note:'Certificat'}];
const signalements=[{emp:'E004',nom:'Prenom4 Nom4',date:d(-2),message:'J etais presente',ts:new Date().toISOString(),traite:false}];
const notes=[{id:'N1',titre:'Fermeture vendredi',texte:'Atelier ferme',cible:{},important:true,ts:new Date().toISOString(),par:'RH',lus:['E001']}];
const votes=[{id:'V1',question:'Pause a 12h ou 12h30 ?',options:['12:00','12:30'],cible:{},anonyme:true,
  resultats:[12,30],votants:[],detail:{},ferme:false,ts:new Date().toISOString(),par:'RH'}];
const audit=[{ts:new Date().toISOString(),qui:'Système',role:'admin',ip:'10.0.0.1',action:'Amorçage'},
             {ts:new Date().toISOString(),qui:'<img src=x onerror="window.__XSS3=1">',role:'rh',ip:'10.0.0.2',action:'<b>test</b>'}];
const WIN=70;
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
          pointages:sub,fenetre:{du:from,au:TODAY}});
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
                  ts:new Date().toISOString(),par:'RH',lu:false}],
          votes:[{id:'V1',question:'Pause a 12h ou 12h30 ?',options:['12:00','12:30'],
                  ferme:false,vote:false,resultats:null,monChoix:null}]});
      }
      if(p==='/api/me/lu'||p==='/api/me/flag')return json(res,{ok:true});
      if(p==='/api/me/vote')return json(res,{ok:true,resultats:[13,30]});
      if(p==='/api/state-meta'||p==='/api/pointage'||p==='/api/day'||p==='/api/pointages/bulk')
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
      if(p==='/api/employees/modele.xlsx'){
        res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        return res.end('PK stub');
      }
      if(p==='/api/report/pdf'){res.writeHead(200,{'Content-Type':'application/pdf'});return res.end('%PDF-1.4 stub')}
      return json(res,{ok:true});
    });
    return;
  }
  let f=p==='/'?'/index.html':(p==='/moi'?'/moi.html':(p==='/login'?'/login.html':p));
  const full=path.join(ROOT,f.replace(/^\/+/,''));
  if(!full.startsWith(ROOT)||!fs.existsSync(full)){res.writeHead(404);return res.end('404')}
  const ext=path.extname(full);
  const ct={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8',
    '.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
    '.webmanifest':'application/manifest+json'}[ext]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':ct});res.end(fs.readFileSync(full));
}).listen(8777,()=>console.log('mock sur 8777'));
process.on('SIGTERM',()=>{console.log('APPELS:'+LOG.length);process.exit(0)});
