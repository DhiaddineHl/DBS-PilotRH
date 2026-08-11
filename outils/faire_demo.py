#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
faire_demo.py — fabrique deux fichiers HTML de démonstration autonomes
======================================================================
Sortie :
  PilotRH_demo.html            interface RH complète, sans serveur ni mot de passe
  PilotRH_demo_salarie.html    espace salarié (vue téléphone)

Ces fichiers s'ouvrent par simple double-clic. Ils embarquent le VRAI code de
l'application (les fichiers de static/assets sont inclus tels quels) et remplacent
uniquement les appels réseau par un jeu de données fictives en mémoire. Ce qui
s'affiche est donc bien le comportement réel de l'application.

Rien n'est enregistré : à chaque rechargement, tout repart de zéro.

    python outils/faire_demo.py
"""
import os, json, datetime, random, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(BASE, "static", "assets")
SORTIE = os.path.join(BASE, "demo")

def lire(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()

# ---------------------------------------------------------------------------
# Jeu de données fictif — noms inventés, aucune donnée réelle
# ---------------------------------------------------------------------------
PRENOMS_F = ["Amal","Sonia","Rania","Hela","Ines","Nour","Salma","Mariem","Olfa","Wafa",
             "Dorra","Yosra","Imen","Fatma","Sirine","Asma","Leila","Nadia","Souad","Hajer",
             "Manel","Sabrine","Rim","Khaoula","Zeineb","Chaima","Maha","Ahlem","Sarra","Nesrine"]
PRENOMS_H = ["Mohamed","Karim","Slim","Anis","Bilel","Hatem","Walid","Nizar"]
NOMS = ["Belhadj","Trabelsi","Jlassi","Gharbi","Mbarki","Khelifi","Bouzid","Saidi","Hamdi",
        "Chaabane","Mejri","Ferchichi","Bouaziz","Nasri","Ayari","Zaied","Karoui","Sassi",
        "Amri","Dridi","Ouertani","Rekik","Zouari","Maaloul","Hammami","Jebali","Kacem",
        "Marzouki","Bennour","Chaieb"]
SERVICES = ["Couture","Coupe","Finition","Repassage","Qualité","Méthodes","Magasin"]
ATELIERS = ["Atelier A","Atelier B","Atelier C"]
POSTES_OUV = ["Couturière piqueuse","Mécanicienne","Repasseuse","Contrôleuse qualité",
              "Coupeuse","Finition main","Préparatrice","Magasinier"]
POSTES_CAD = ["Chef d’atelier","Agent de méthode"]
CONTRATS = ["CDI","CDI","CDI","CDI","CDD","CIVP"]
NIVEAUX = ["Primaire","Base","Secondaire","Bac","Licence","Maîtrise"]
FAMILLES = ["Célibataire","Marié(e)","Divorcé(e)","Veuf(ve)"]

def construire(nb=86, jours=95):
    rnd = random.Random(20260810)
    today = datetime.date.today()
    def d(n): return (today + datetime.timedelta(days=n)).isoformat()

    employees = []
    for i in range(1, nb + 1):
        homme = (i % 14 == 0)
        prenom = rnd.choice(PRENOMS_H if homme else PRENOMS_F)
        nom = rnd.choice(NOMS)
        cadre = (i % 22 == 0)
        emb = today - datetime.timedelta(days=rnd.randint(120, 4200))
        nai = today - datetime.timedelta(days=rnd.randint(19*365, 56*365))
        employees.append({
            "id": "E%03d" % i, "matricule": str(100 + i),
            "prenom": prenom, "nom": nom,
            "poste": rnd.choice(POSTES_CAD if cadre else POSTES_OUV),
            "categorie": "Cadre" if cadre else "Ouvrier",
            "service": SERVICES[i % len(SERVICES)],
            "atelier": ATELIERS[i % 3],
            "contrat": "CDI" if cadre else rnd.choice(CONTRATS),
            "embauche": emb.isoformat(), "naissance": nai.isoformat(),
            "famille": rnd.choice(FAMILLES), "enfants": rnd.randint(0, 4),
            "niveau": rnd.choice(NIVEAUX),
            "email": "", "tel": "2%d %d%d%d %d%d%d" % tuple(rnd.randint(0, 9) for _ in range(7)),
            "adresse": rnd.choice(["Nabeul","Hammamet","Beni Khiar","Dar Chaabane","Korba","Maamoura"]),
            "salaire": (1500 + rnd.randint(0, 500)) if cadre else (850 + rnd.randint(0, 300)),
            "cnss": "", "cin": str(rnd.randint(1000000, 14999999)),
            "sexe": "H" if homme else "F",
            "responsable": "Direction" if cadre else "Chef d’atelier",
            "actif": True,
        })
    if employees:
        employees[3]["aCompleter"] = True          # fiche créée par un import, à compléter

    settings = {
        "modeHS": "fin", "arrondi": 0, "arrondiSens": "proche", "arrondiPortee": "periode",
        "congesDu": "", "congesAu": "", "congesCoef": 0.0417,
        "feriesActifs": True, "clotures": [],
        "feriesFixes": [
            {"md": "01-01", "nom": "Nouvel An"},
            {"md": "01-14", "nom": "Fête de la Révolution"},
            {"md": "03-20", "nom": "Fête de l’Indépendance"},
            {"md": "04-09", "nom": "Jour des Martyrs"},
            {"md": "05-01", "nom": "Fête du Travail"},
            {"md": "07-25", "nom": "Fête de la République"},
            {"md": "08-13", "nom": "Fête de la Femme"},
            {"md": "10-15", "nom": "Fête de l’Évacuation"},
        ],
        # AUCUNE fête mobile pré-remplie : une fête inventée dans le jeu de
        # démonstration donne l'impression que l'application invente des jours
        # fériés. À vous de les saisir dans les paramètres pour voir l'effet.
        "feries": [],
        "jours": {},
        "periodes": [],
    }
    ouvre = {"actif": True, "debut": "07:30", "fin": "16:30", "pause": 30,
             "pauseDe": "12:00", "pauseA": "12:30", "tol": 15, "grace": 15}
    for j in (1, 2, 3, 4, 5):
        settings["jours"][str(j)] = dict(ouvre)
    settings["jours"]["6"] = {"actif": True, "debut": "07:30", "fin": "13:00", "pause": 0,
                              "pauseDe": "", "pauseA": "", "tol": 15, "grace": 15}
    settings["jours"]["0"] = {"actif": False}

    feries = set()
    for f in settings["feries"]:
        d0 = datetime.date.fromisoformat(f["date"])
        for k in range(f.get("jours", 1)):
            feries.add((d0 + datetime.timedelta(days=k)).isoformat())
    fixes = {f["md"] for f in settings["feriesFixes"]}

    pointages = {}
    for k in range(jours):
        ds = d(-k)
        dt = datetime.date.fromisoformat(ds)
        dow = (dt.weekday() + 1) % 7
        est_ferie = ds in feries or ds[5:] in fixes
        rec = {}
        for e in employees:
            if dow == 0:
                rec[e["id"]] = {"statut": "repos", "entree": "", "sortie": "", "src": "calendrier"}
                continue
            if est_ferie:
                rec[e["id"]] = {"statut": "ferie", "entree": "", "sortie": "", "src": "calendrier"}
                continue
            fin_theo = "13:00" if dow == 6 else "16:30"
            h = rnd.randint(0, 999)
            if h < 45:
                rec[e["id"]] = {"statut": "absent", "entree": "", "sortie": "", "src": "import"}
            elif h < 80:
                rec[e["id"]] = {"statut": "leave", "entree": "", "sortie": "", "src": "conge", "manuel": 1}
            elif h < 92:
                # sortie manquante : la journée doit remonter dans « à vérifier »
                rec[e["id"]] = {"statut": "present", "entree": "07:%02d" % rnd.randint(25, 34),
                                "sortie": "", "src": "import"}
            elif h < 110:
                rec[e["id"]] = {"statut": "mission", "entree": "", "sortie": "", "src": "manuel", "manuel": 1}
            elif h < 160:
                rec[e["id"]] = {"statut": "present", "entree": "07:%02d" % rnd.randint(46, 59),
                                "sortie": fin_theo, "src": "import"}          # retard
            elif h < 230 and dow != 6:
                rec[e["id"]] = {"statut": "present", "entree": "07:%02d" % rnd.randint(20, 30),
                                "sortie": "18:%02d" % rnd.randint(0, 40), "src": "import"}   # heures sup.
            elif h < 280 and dow != 6:
                rec[e["id"]] = {"statut": "present",
                                "punches": ["07:%02d" % rnd.randint(22, 30), "12:00", "12:%02d" % rnd.randint(31, 50), fin_theo],
                                "entree": "", "sortie": "", "src": "import"}   # coupure
            elif h < 292:
                rec[e["id"]] = {"statut": "autorisation", "entree": "07:55", "sortie": "11:00",
                                "src": "manuel", "manuel": 1}                  # demi-journée
            else:
                rec[e["id"]] = {"statut": "present", "entree": "07:%02d" % rnd.randint(20, 32),
                                "sortie": fin_theo, "src": "import"}
        # une correction manuelle protégée, pour voir le cadenas
        if k == 1 and employees:
            rec[employees[0]["id"]] = {"statut": "present", "entree": "09:00", "sortie": "17:00",
                                       "manuel": 1, "src": "manuel"}
        if k == 2 and len(employees) > 1:
            rec[employees[1]["id"]] = {"statut": "present", "entree": "07:30", "sortie": "16:30",
                                       "hM": 480, "hsM": 60, "manuel": 1, "src": "manuel"}
        pointages[ds] = rec

    documents = []
    for i, e in enumerate(employees):
        if i % 3:
            documents.append({"docId": "D%03d" % (i * 2), "id": e["id"], "type": "Contrat " + e["contrat"],
                              "date": e["embauche"], "resume": "Contrat signé", "source": "Manuel"})
        if i % 7 == 0:
            documents.append({"docId": "D%03dm" % i, "id": e["id"], "type": "Certificat médical",
                              "date": d(-rnd.randint(5, 60)), "resume": "Arrêt de 2 jours", "source": "IA"})

    conges = []
    for i in range(9):
        e = employees[(i * 7) % len(employees)]
        du = d(rnd.randint(-40, 25))
        au = (datetime.date.fromisoformat(du) + datetime.timedelta(days=rnd.randint(2, 9))).isoformat()
        conges.append({"cid": "C%02d" % i, "id": e["id"],
                       "type": rnd.choice(["Congé annuel","Congé annuel","Congé sans solde","Congé maladie"]),
                       "debut": du, "fin": au, "jours": rnd.randint(2, 8),
                       "statut": "En attente" if i < 4 else "Validé",
                       "applique": i >= 4, "cree": d(-30)})
    conges.append({"cid": "C90", "id": employees[5]["id"], "type": "Autorisation de sortie",
                   "debut": d(-1), "fin": d(-1), "jours": 0.5, "statut": "Validé"})

    absences = []
    for i in range(7):
        e = employees[(i * 11) % len(employees)]
        du = d(-rnd.randint(3, 70))
        absences.append({"id": e["id"], "type": rnd.choice(["Maladie","Absence"]),
                         "debut": du, "fin": du, "jours": rnd.randint(1, 3),
                         "statut": "justifiée" if i % 2 else "injustifiée",
                         "note": "Certificat médical fourni" if i % 2 else "Non signalée"})

    signalements = [
        {"emp": employees[9]["id"], "nom": employees[9]["prenom"] + " " + employees[9]["nom"],
         "date": d(-3), "message": "J’étais présente mais je suis marquée absente",
         "ts": d(-3) + "T17:12:00", "traite": False},
        {"emp": employees[12]["id"], "nom": employees[12]["prenom"] + " " + employees[12]["nom"],
         "date": d(-8), "message": "Ma sortie n’a pas été enregistrée, j’ai fini à 18h",
         "ts": d(-8) + "T18:40:00", "traite": False},
    ]

    notes = [
        {"id": "N1", "titre": "Fermeture de l’atelier vendredi après-midi",
         "texte": "En raison de l’inventaire, l’atelier fermera vendredi à 13h00.\nLes heures non travaillées seront rattrapées la semaine suivante.",
         "cible": {}, "fin": d(20), "important": True, "ts": d(-2) + "T09:15:00",
         "par": "Service RH", "lus": [e["id"] for e in employees[:31]]},
        {"id": "N2", "titre": "Nouvelle procédure de contrôle qualité",
         "texte": "Le contrôle se fait désormais en fin de chaîne. Une formation aura lieu mardi.",
         "cible": {"service": "Qualité"}, "fin": d(30), "important": False,
         "ts": d(-9) + "T14:00:00", "par": "Service RH", "lus": []},
    ]
    votes = [
        {"id": "V1", "question": "Préférez-vous la pause déjeuner à 12h00 ou à 12h30 ?",
         "options": ["12:00 – 12:30", "12:30 – 13:00"], "cible": {}, "fin": d(15),
         "anonyme": True, "resultats": [37, 21], "votants": [], "detail": {},
         "ferme": False, "ts": d(-4) + "T08:00:00", "par": "Service RH"},
        {"id": "V2", "question": "Souhaitez-vous une navette le samedi ?",
         "options": ["Oui", "Non", "Sans avis"], "cible": {}, "fin": d(-1),
         "anonyme": True, "resultats": [44, 12, 7], "votants": [], "detail": {},
         "ferme": True, "ts": d(-25) + "T08:00:00", "par": "Service RH"},
    ]

    audit = []
    for i in range(28):
        audit.append({"ts": (datetime.datetime.now() - datetime.timedelta(hours=i * 3)).isoformat(timespec="seconds"),
                      "qui": rnd.choice(["Service RH","Administrateur","Pointeuse","Système"]),
                      "role": rnd.choice(["rh","admin","",""]),
                      "ip": "192.168.1.%d" % rnd.randint(2, 60),
                      "action": rnd.choice([
                          "Import direct pointeuse · 412 pointages, 86 employées",
                          "Pointage modifié · E014 · %s (present 07:30-16:30)" % d(-1),
                          "Sauvegarde automatique",
                          "Congé validé · 5 journées inscrites au pointage",
                          "Connexion réussie",
                          "Mise à jour des données de référence (employees, settings)",
                      ])})
    return dict(employees=employees, settings=settings, pointages=pointages,
                documents=documents, conges=conges, absences=absences,
                signalements=signalements, notes=notes, votes=votes, audit=audit)

# ---------------------------------------------------------------------------
# Simulateur réseau embarqué (remplace fetch)
# ---------------------------------------------------------------------------
FAUX_RESEAU = r"""
/* ============================================================================
   DÉMONSTRATION — simulateur réseau
   Le vrai code de l'application est inclus tel quel ci-dessous. Seuls les appels
   au serveur sont interceptés ici et servis depuis un jeu de données fictives en
   mémoire. Rien n'est enregistré : tout repart de zéro au rechargement.
   ============================================================================ */
(function(){
  const D = window.__DEMO__;
  const TODAY = new Date().toISOString().slice(0,10);
  const FENETRE = 70;
  const dec = n => { const x=new Date(); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10) };
  function ok(o){ return Promise.resolve(new Response(JSON.stringify(o===undefined?{ok:true}:o),
    {status:200, headers:{'Content-Type':'application/json'}})) }
  function err(msg, code){ return Promise.resolve(new Response(JSON.stringify({error:msg}),
    {status:code||400, headers:{'Content-Type':'application/json'}})) }
  function cibleOk(e,c){ c=c||{};
    return (!c.service||e.service===c.service)&&(!c.atelier||e.atelier===c.atelier)&&(!c.categorie||e.categorie===c.categorie) }

  const vrai = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = (typeof input==='string') ? input : (input && input.url) || '';
    const u = url.replace(/^https?:\/\/[^/]+/,'');
    if(!u.startsWith('/api/')) return vrai(input, init);
    const m = (init&&init.method)||'GET';
    let corps = {};
    try{ if(init&&init.body&&typeof init.body==='string') corps = JSON.parse(init.body) }catch(e){}
    const q = new URLSearchParams((u.split('?')[1]||''));
    const chemin = u.split('?')[0];

    switch(chemin){
      case '/api/whoami':
        return ok({login:'demo', nom:'Démonstration', role:'admin', roles:{}});
      case '/api/state': {
        const from = dec(-FENETRE), sub = {};
        for(const k in D.pointages) if(k>=from) sub[k]=D.pointages[k];
        return ok({employees:D.employees, settings:D.settings, documents:D.documents,
                   conges:D.conges, absences:D.absences, signalements:D.signalements,
                   pointages:sub, fenetre:{du:from, au:TODAY}});
      }
      case '/api/pointages': {
        const a=q.get('frm'), b=q.get('to');
        if(!a||!b) return err("Paramètres 'frm' et 'to' obligatoires");
        const sub={}; for(const k in D.pointages) if(k>=a&&k<=b) sub[k]=D.pointages[k];
        return ok(sub);
      }
      case '/api/stats/absenteisme': {
        const n = +(q.get('mois')||6), out=[];
        const par = {};
        for(const ds in D.pointages){
          const ym=ds.slice(0,7); par[ym]=par[ym]||{t:0,a:0};
          const r=D.pointages[ds];
          for(const id in r){ par[ym].t++; if(r[id].statut==='absent') par[ym].a++ }
        }
        const mois=Object.keys(par).sort().slice(-n);
        mois.forEach(ym=>out.push({mois:ym, taux:par[ym].t?Math.round(par[ym].a*1000/par[ym].t)/10:0,
                                   jours:par[ym].t, absences:par[ym].a}));
        return ok(out);
      }
      case '/api/audit': return ok(D.audit.slice(0, +(q.get('limit')||60)));
      case '/api/users': return ok([{login:'demo', nom:'Démonstration', role:'admin'},
                                    {login:'rh1', nom:'Service RH', role:'rh'},
                                    {login:'chef.a', nom:'Chef d’atelier A', role:'atelier'}]);
      case '/api/coms': return ok({notes:D.notes.slice().reverse(), votes:D.votes.slice().reverse()});
      case '/api/backups': return ok({dossier:'data/backups', conserve:30, sauvegardes:[
        {fichier:'pilotrh_'+TODAY.replace(/-/g,'')+'_060000_auto.db', taille:4210688, date:TODAY+'T06:00:00'},
        {fichier:'pilotrh_'+dec(-1).replace(/-/g,'')+'_060000_auto.db', taille:4198400, date:dec(-1)+'T06:00:00'}]});
      case '/api/backup/now': return ok({fichier:'pilotrh_demo_manuel.db', taille:4210688, ts:new Date().toISOString()});
      case '/api/health': return ok({ok:true});

      /* --- écritures : acceptées, appliquées en mémoire, jamais enregistrées --- */
      case '/api/pointage': {
        const d=corps.date, id=corps.id;
        if(!D.pointages[d]) D.pointages[d]={};
        const r={statut:corps.statut, entree:corps.entree||'', sortie:corps.sortie||'', src:corps.src||'manuel'};
        if(corps.punches) r.punches=corps.punches;
        if(corps.hM!=null) r.hM=corps.hM;
        if(corps.hsM!=null) r.hsM=corps.hsM;
        if(corps.manuel) r.manuel=1;
        D.pointages[d][id]=r;
        return ok();
      }
      case '/api/day': {
        D.pointages[corps.date]=JSON.parse(JSON.stringify(corps.recs||{}));
        return ok({ok:true, ecrits:Object.keys(corps.recs||{}).length});
      }
      case '/api/pointages/bulk': {
        (corps.recs||[]).forEach(r=>{
          if(!D.pointages[r.date]) D.pointages[r.date]={};
          const o={statut:r.statut, entree:r.entree||'', sortie:r.sortie||'', src:r.src||'manuel'};
          if(r.hM!=null) o.hM=r.hM;
          if(r.hsM!=null) o.hsM=r.hsM;
          if(r.manuel) o.manuel=1;
          D.pointages[r.date][r.id]=o;
        });
        return ok({ok:true, ecrits:(corps.recs||[]).length});
      }
      case '/api/state-meta': {
        ['employees','settings','documents','conges','absences','signalements'].forEach(k=>{
          if(corps[k]!=null) D[k]=corps[k];
        });
        return ok();
      }
      case '/api/employee/delete': {
        D.employees = D.employees.filter(e=>e.id!==corps.id);
        return ok({ok:true, exclus:[]});
      }
      case '/api/coms/note': {
        D.notes.push({id:'N'+Date.now(), titre:corps.titre, texte:corps.texte,
          cible:corps.cible||{}, fin:(corps.cible||{}).fin||'', important:!!corps.important,
          ts:new Date().toISOString(), par:'Démonstration', lus:[]});
        return ok();
      }
      case '/api/coms/note/delete': D.notes=D.notes.filter(n=>n.id!==corps.id); return ok();
      case '/api/coms/vote': {
        D.votes.push({id:'V'+Date.now(), question:corps.question, options:corps.options,
          cible:corps.cible||{}, fin:(corps.cible||{}).fin||'', anonyme:corps.anonyme!==false,
          resultats:corps.options.map(()=>0), votants:[], detail:{}, ferme:false,
          ts:new Date().toISOString(), par:'Démonstration'});
        return ok();
      }
      case '/api/coms/vote/close': D.votes.forEach(v=>{if(v.id===corps.id)v.ferme=true}); return ok();
      case '/api/coms/vote/delete': D.votes=D.votes.filter(v=>v.id!==corps.id); return ok();

      /* --- espace salarié --- */
      case '/api/me': {
        const e = D.employees[0];
        if(corps.pin && corps.pin!=='123456') return err('code', 401);
        if(!corps.pin) return Promise.resolve(new Response(JSON.stringify({need_pin:true}),
          {status:401, headers:{'Content-Type':'application/json'}}));
        const ym = (corps.mois&&corps.mois.length===7) ? corps.mois : TODAY.slice(0,7);
        const jours={}, cj={};
        for(const k in D.pointages){
          const r=D.pointages[k][e.id]; if(!r) continue;
          cj[k]=r; if(k.slice(0,7)===ym) jours[k]=r;
        }
        const mesNotes = D.notes.filter(n=>cibleOk(e,n.cible))
          .map(n=>({id:n.id,titre:n.titre,texte:n.texte,important:n.important,ts:n.ts,par:n.par,
                    lu:(n.lus||[]).indexOf(e.id)>=0})).reverse();
        const mesVotes = D.votes.filter(v=>cibleOk(e,v.cible)).map(v=>{
          const vote=(v.votants||[]).indexOf(e.id)>=0;
          return {id:v.id,question:v.question,options:v.options,ferme:!!v.ferme,vote:vote,
                  resultats:(vote||v.ferme)?v.resultats:null,monChoix:null};
        }).reverse();
        return ok({nom:e.nom, prenom:e.prenom, matricule:e.matricule, categorie:e.categorie,
                   sexe:e.sexe, mois:ym, today:TODAY, settings:D.settings, jours:jours,
                   notes:mesNotes, votes:mesVotes,
                   conges:{du:dec(-330), au:dec(35), auEffectif:TODAY, jours:cj}});
      }
      case '/api/me/lu': {
        const e=D.employees[0];
        D.notes.forEach(n=>{ if(n.id===corps.id && (n.lus||[]).indexOf(e.id)<0) n.lus.push(e.id) });
        return ok();
      }
      case '/api/me/vote': {
        const e=D.employees[0];
        const v=D.votes.filter(x=>x.id===corps.id)[0];
        if(!v) return err('Sondage introuvable',404);
        if(v.ferme) return err('Ce sondage est clos',409);
        if((v.votants||[]).indexOf(e.id)>=0) return err('Vous avez déjà répondu',409);
        v.resultats[corps.choix]=(v.resultats[corps.choix]||0)+1;
        v.votants.push(e.id);
        return ok({ok:true, resultats:v.resultats});
      }
      case '/api/me/flag': return ok();

      /* --- fonctions qui exigent réellement le serveur --- */
      case '/api/report/pdf':
        return err("Les PDF sont produits par le serveur : indisponibles dans cette démonstration hors ligne. Les exports CSV, eux, fonctionnent.", 503);
      case '/api/ai': case '/api/ocr':
        return err("L’assistant IA et la lecture de documents passent par le serveur : indisponibles dans cette démonstration.", 503);
      case '/api/import-mdb':
        return err("La lecture d’un fichier .mdb est faite par le serveur : indisponible dans cette démonstration. L’import CSV, lui, fonctionne.", 503);
      case '/api/sync': return err("Aucune pointeuse joignable depuis cette démonstration.", 503);
      case '/api/logout': return ok();
      default:
        if(chemin.indexOf('/reset-acces')>0) return ok({ok:true, pin:'482913'});
        if(chemin.indexOf('/photo')>0) return err("L’envoi de photo passe par le serveur.", 503);
        return ok();
    }
  };
})();
"""

BANNIERE = """
<div id="demoBar" style="position:fixed;left:0;right:0;bottom:0;z-index:500;background:#1a1d29;
  color:#fff;font:600 12.5px/1.45 Inter,system-ui,sans-serif;padding:9px 16px;display:flex;
  gap:12px;align-items:center;box-shadow:0 -6px 20px rgba(0,0,0,.22)">
  <span style="background:#c19a3e;color:#241c06;border-radius:20px;padding:2px 9px;font-size:11px">DÉMONSTRATION</span>
  <span style="flex:1;font-weight:400;color:#cdd1dc">Données <b style="color:#fff">fictives</b>.
    Vous pouvez tout modifier : rien n’est enregistré, tout repart de zéro au rechargement.
    Les PDF, l’assistant IA et l’import .mdb demandent le serveur.</span>
  <button onclick="location.reload()" style="background:rgba(255,255,255,.12);color:#fff;border:0;
    border-radius:8px;padding:6px 12px;font:600 12px Inter,sans-serif;cursor:pointer">Réinitialiser</button>
  <button onclick="document.getElementById('demoBar').remove()" aria-label="Masquer"
    style="background:none;color:#8d94ad;border:0;cursor:pointer;font-size:15px;padding:0 4px">&times;</button>
</div>
<style>.toast-wrap{bottom:64px!important}#syncbar{bottom:60px!important}.page{padding-bottom:80px!important}</style>
"""

def faire_rh(data):
    css = lire(ASSETS, "pilotrh-ui.css")
    js = [lire(ASSETS, f) for f in ("pilotrh-core.js", "pilotrh-app.js",
                                    "pilotrh-views.js", "pilotrh-saisie.js", "pilotrh-coms.js")]
    return """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PilotRH — démonstration (hors ligne)</title>
<style>
/* police système : ce fichier fonctionne sans aucune connexion */
%(css)s
</style>
</head>
<body>
<div class="app" id="app"><div style="grid-column:1/-1;display:grid;place-items:center;height:100vh;color:#5c6270">Préparation de la démonstration…</div></div>
<div class="scrim" id="scrim" onclick="fermerMenu()"></div>
<div class="overlay" id="overlay"></div>
<div class="toast-wrap" id="toasts" role="status" aria-live="polite"></div>
<div id="syncbar" role="alert"></div>
%(banniere)s
<script>window.__DEMO__ = %(data)s;</script>
<script>%(reseau)s</script>
<script>%(js0)s</script>
<script>%(js1)s</script>
<script>%(js2)s</script>
<script>%(js3)s</script>
<script>%(js4)s</script>
<script>demarrer();</script>
</body>
</html>
""" % dict(css=css, banniere=BANNIERE, reseau=FAUX_RESEAU,
           data=json.dumps(data, ensure_ascii=False),
           js0=js[0], js1=js[1], js2=js[2], js3=js[3], js4=js[4])

def faire_salarie(data):
    html = lire(BASE, "static", "moi.html")
    core = lire(ASSETS, "pilotrh-core.js")
    html = html.replace('<script src="/assets/pilotrh-core.js"></script>',
                        "<script>window.__DEMO__ = %s;</script>\n<script>%s</script>\n<script>%s</script>"
                        % (json.dumps(data, ensure_ascii=False), FAUX_RESEAU, core))
    # pas de manifeste ni d'icône en local : on retire les liens pour éviter les 404
    for balise in ('<link rel="manifest" href="/assets/manifest.webmanifest">',
                   '<link rel="icon" href="/assets/icone.svg" type="image/svg+xml">',
                   '<link rel="apple-touch-icon" href="/assets/icone-192.png">'):
        html = html.replace(balise, "")
    html = html.replace("if('serviceWorker' in navigator){navigator.serviceWorker.register('/assets/sw.js').catch(()=>{})}", "")
    # en démonstration, le jeton est fourni d'office
    html = html.replace("let TOKEN = params.get('t') || '';", "let TOKEN = 'DEMO';")
    html = html.replace("<title>Mon pointage — DBS Fashion</title>",
                        "<title>Mon pointage — démonstration</title>")
    aide = ("""<div style="background:#fff8e6;border:1px solid #e3cf9c;color:#5f4409;border-radius:12px;
      padding:12px 14px;font-size:12.5px;margin:14px 16px 0;max-width:600px;margin-left:auto;margin-right:auto">
      <b>Démonstration.</b> Le code d’accès est <b>123456</b>. Données fictives, rien n’est enregistré.</div>""")
    html = html.replace('<div class="wrap" id="app">', aide + '\n<div class="wrap" id="app">')
    return html

def faire_arrondi():
    """Page pédagogique sur l'arrondi : le moteur de calcul y est embarqué pour
    que les chiffres affichés soient ceux de l'application, pas une redite."""
    src = os.path.join(BASE, "demo", "PilotRH_arrondi.html")
    if not os.path.exists(src):
        return None
    html = open(src, encoding="utf-8").read()
    if '<script src="/assets/pilotrh-core.js"></script>' in html:
        html = html.replace('<script src="/assets/pilotrh-core.js"></script>',
                            "<script>%s</script>" % lire(ASSETS, "pilotrh-core.js"))
    return html

def main():
    os.makedirs(SORTIE, exist_ok=True)
    data = construire()
    fichiers = [("PilotRH_demo.html", faire_rh(data)),
                ("PilotRH_demo_salarie.html", faire_salarie(data))]
    arr = faire_arrondi()
    if arr:
        fichiers.append(("PilotRH_arrondi.html", arr))
    for nom, contenu in fichiers:
        chemin = os.path.join(SORTIE, nom)
        with open(chemin, "w", encoding="utf-8") as f:
            f.write(contenu)
        print("%-30s %6.0f Ko" % (nom, os.path.getsize(chemin) / 1024))
    print("\nDossier : %s" % SORTIE)
    print("Ouvrez les fichiers par double-clic — aucun serveur, aucun mot de passe.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
