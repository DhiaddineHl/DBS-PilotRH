import sys, os, json, tempfile, threading, time, asyncio, shutil, datetime
ICI=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,ICI)
sys.path.insert(0,os.path.dirname(ICI))
DATA = tempfile.mkdtemp(prefix='pilotrh_test_')
os.environ['PILOTRH_DATA']=DATA
os.environ['PILOTRH_SEED']='0'          # pas d'amorçage depuis le .mdb
os.environ['PILOTRH_ADMIN_PASSWORD']='motdepasse-test'
os.environ['PILOTRH_SESSION_SECRET']='secret-de-test'
sys.path.insert(0,'/home/claude/rh/pilotrh_server_final')
import app as A

ok=ko=0
def t(nom,got,exp):
    global ok,ko
    if got==exp: ok+=1
    else:
        ko+=1
        print("  ECHEC %s\n    attendu %r\n    obtenu  %r" % (nom,exp,got))
def tv(nom,cond,detail=''):
    global ok,ko
    if cond: ok+=1
    else: ko+=1; print("  ECHEC %s %s" % (nom,detail))

print("\n--- schema et index ---")
with A.conn_ro() as c:
    cols={r[1] for r in c.execute("PRAGMA table_info(pointage)").fetchall()}
    idx={r[1] for r in c.execute("PRAGMA index_list(pointage)").fetchall()}
    jm=c.execute("PRAGMA journal_mode").fetchone()[0]
    acols={r[1] for r in c.execute("PRAGMA table_info(audit)").fetchall()}
tv("colonne hsM ajoutée", 'hsM' in cols, cols)
tv("colonnes de tracabilite src/maj/par", {'src','maj','par'} <= cols, cols)
tv("index sur pointage(emp,d)", 'idx_pointage_emp_d' in idx, idx)
t("mode WAL actif", jm, 'wal')
tv("audit horodate avec role et ip", {'id','role','ip'} <= acols, acols)

print("\n--- C1 : /api/state ne fuite plus les comptes ni la cle de signature ---")
A.set_meta_serveur({'users':[{'login':'admin','role':'admin','pass':'sel$hash'}],'_secret':'CLE-SECRETE'})
priv = A.get_meta(prive=True)
pub  = A.get_meta(prive=False)
tv("en interne le secret existe", priv.get('_secret')=='CLE-SECRETE')
t("_secret absent de la reponse client", pub.get('_secret'), None)
t("users absent de la reponse client", pub.get('users'), None)
t("notes/votes hors de /api/state", (pub.get('notes'),pub.get('votes')), (None,None))
st = A.get_state(prive=False)
tv("get_state expurge aussi", '_secret' not in st and 'users' not in st, list(st.keys()))

print("\n--- C2 : le client ne peut plus s'octroyer le role admin ---")
A.set_meta({'users':[{'login':'pirate','role':'admin','pass':'x'}],'_secret':'0000'})
m = A.get_meta()
t("users inchange apres ecriture client", [u['login'] for u in m['users']], ['admin'])
t("_secret inchange apres ecriture client", m['_secret'], 'CLE-SECRETE')

print("\n--- validation : plus de mise hors service par donnee malformee ---")
for mauvais in ({'employees':0},{'employees':'x'},{'settings':[]},{'employees':[{'nom':'sans id'}]}):
    try:
        A.set_meta(mauvais); tv("refuse %r" % mauvais, False)
    except ValueError: ok+=1
t("l'etat reste sain", isinstance(A.get_meta().get('employees'),list), True)

print("\n--- ecriture des pointages ---")
A.set_meta({'employees':[{'id':'E001','matricule':'10','prenom':'A','nom':'Aa'},
                         {'id':'E002','matricule':'20','prenom':'B','nom':'Bb'}]})
A.write_pointages([A._rec_row('2026-08-10','E001',{'statut':'present','entree':'07:30','sortie':'16:30'},'RH','import')])
p=A.get_pointages('2026-08-01','2026-08-31')
t("relecture du pointage", p['2026-08-10']['E001']['statut'], 'present')
A.write_pointages([A._rec_row('2026-08-11','E001',{'statut':'present','entree':'07:30','sortie':'19:00','hM':480,'hsM':60,'manuel':1},'RH','manuel')])
r=A.get_pointages('2026-08-11','2026-08-11')['2026-08-11']['E001']
t("hM relu", r.get('hM'), 480)
t("hsM relu (nouvelle colonne)", r.get('hsM'), 60)
t("manuel relu", r.get('manuel'), 1)

print("\n--- fenetrage : /api/state ne renvoie plus 3 ans ---")
A.write_pointages([A._rec_row('2023-01-05','E001',{'statut':'present','entree':'07:30','sortie':'16:30'},'RH','import')])
tout = A.get_pointages()
fen  = A.get_pointages('2026-06-01','2026-12-31')
tv("l'historique complet contient 2023", '2023-01-05' in tout)
tv("la fenetre ne contient PAS 2023", '2023-01-05' not in fen, sorted(fen))

print("\n--- E11 : ecritures concurrentes, plus de perte de mise a jour ---")
A.set_meta({'documents':[]})
def ajoute(i):
    for k in range(12):
        with A._WLOCK:
            m=A.get_meta()
            docs=m.get('documents') or []
            docs.append({'docId':'D%d-%d'%(i,k)})
            A.set_meta({'documents':docs})
th=[threading.Thread(target=ajoute,args=(i,)) for i in range(6)]
[x.start() for x in th]; [x.join() for x in th]
t("6 threads x 12 ecritures = 72 documents conserves", len(A.get_meta()['documents']), 72)

def ecrit_pointages(i):
    rows=[A._rec_row('2026-09-%02d'%(d+1),'E%03d'%(i+1),{'statut':'present','entree':'07:30','sortie':'16:30'},'T%d'%i,'import') for d in range(25)]
    A.write_pointages(rows)
th=[threading.Thread(target=ecrit_pointages,args=(i,)) for i in range(8)]
[x.start() for x in th]; [x.join() for x in th]
sept=A.get_pointages('2026-09-01','2026-09-30')
t("8 threads x 25 jours, aucune perte", sum(len(v) for v in sept.values()), 200)

print("\n--- restauration : remplacer vs fusionner ---")
n=A.set_state({'employees':[{'id':'E001'}],'settings':A.default_settings(),
               'pointages':{'2026-10-01':{'E001':{'statut':'present','entree':'08:00','sortie':'16:00'}}}},
              remplacer=False)
tv("fusion : l'ancien historique subsiste", '2023-01-05' in A.get_pointages())
A.set_state({'employees':[{'id':'E001'}],'settings':A.default_settings(),
             'pointages':{'2026-10-02':{'E001':{'statut':'present','entree':'08:00','sortie':'16:00'}}}},
            remplacer=True)
tout=A.get_pointages()
t("remplacement : seule la sauvegarde subsiste", sorted(tout.keys()), ['2026-10-02'])

print("\n--- cloture de mois ---")
s=A.default_settings(); s['clotures']=['2026-10']
A.set_meta({'settings':s})
t("mois clos detecte", A._mois_clos(['2026-10-05','2026-11-02']), ['2026-10'])
t("mois ouvert non signale", A._mois_clos(['2026-11-02']), [])

print("\n--- mots de passe ---")
h=A._hash_pw('secret123')
tv("format sel$iterations$empreinte", h.count('$')==2 and len(h)>60, h[:30])
tv("ancien format (v2) toujours accepte",
   A._check_pw('abc', 'sel12345$'+__import__('hashlib').pbkdf2_hmac('sha256',b'abc',b'sel12345',100000).hex()))
tv("bon mot de passe accepte", A._check_pw('secret123',h))
tv("mauvais mot de passe refuse", not A._check_pw('secret124',h))
tv("hash non deterministe (sel aleatoire)", A._hash_pw('a')!=A._hash_pw('a'))

print("\n--- C4 : la porte derobee ADMIN_PW a disparu ---")
src=open(os.path.join(os.path.dirname(ICI),'app.py')).read()
tv("plus de 'pw == ADMIN_PW'", 'pw == ADMIN_PW' not in src)
tv("ADMIN_PW ne sert plus qu'a l'amorcage", src.count('ADMIN_PW')<=4, src.count('ADMIN_PW'))

print("\n--- sessions ---")
u={'login':'admin','role':'admin','nom':'Admin'}
tok=A._sign_session(u)
class Req:
    def __init__(self,cookies=None,headers=None):
        self.cookies=cookies or {}; self.headers=headers or {}
        self.client=type('c',(),{'host':'1.2.3.4'})()
t("session valide relue", A._read_session(Req({'pilotrh_sess':tok}))['role'], 'admin')
payload,sig=tok.rsplit('.',1)
t("signature falsifiee rejetee", A._read_session(Req({'pilotrh_sess':payload+'.'+('0'*32)})), None)
import base64 as b64
faux=b64.urlsafe_b64encode(json.dumps({'login':'x','role':'admin','exp':9999999999}).encode()).decode()
t("payload forge sans signature valide rejete", A._read_session(Req({'pilotrh_sess':faux+'.'+sig})), None)

print("\n--- auteur des modifications : la session, plus le client ---")
tv("_acteur derive de la session", A._acteur(Req({'pilotrh_sess':tok}))==('Admin','admin'))
t("sans session : role minimal", A._acteur(Req())[1], 'lecture')
tv("le corps de requete n'est plus lu pour 'qui'", "b.get(\"qui\"" not in src)

print("\n--- E9 : chemin de photo valide ---")
tv("E001 accepte", A._ID_RE.match('E001') is not None)
for mauvais in ('..\\..\\evil','../../evil','E001/../x','D:evil','',' '):
    tv("refuse %r" % mauvais, A._ID_RE.match(mauvais) is None)

print("\n--- E12 : la sauvegarde automatique existe vraiment ---")
info=A.faire_backup('test')
chemin=os.path.join(A.BACKUP_DIR,info['fichier'])
tv("fichier de sauvegarde ecrit", os.path.exists(chemin))
import sqlite3
c2=sqlite3.connect(chemin)
n=c2.execute("SELECT COUNT(*) FROM pointage").fetchone()[0]
c2.close()
tv("la sauvegarde est lisible et coherente", n>=1, n)
for i in range(4): A.faire_backup('test%d'%i)
tv("rotation en place", len([f for f in os.listdir(A.BACKUP_DIR) if f.endswith('.db')])<=A.BACKUP_KEEP)

print("\n--- notes de service et sondages ---")
A._set_coms(notes=[],votes=[])
async def go():
    class R(Req):
        def __init__(self,body): super().__init__({'pilotrh_sess':tok}); self._b=body
        async def json(self): return self._b
    await A.api_coms_note(R({'titre':'Fermeture','texte':'Vendredi ferme',
                             'cible':{'service':'Couture'},'important':True}))
    await A.api_coms_vote(R({'question':'Pause a 12h ou 12h30 ?','options':['12:00','12:30'],
                             'cible':{},'anonyme':True}))
    return A.api_coms()
res=asyncio.get_event_loop().run_until_complete(go())
t("note publiee", res['notes'][0]['titre'], 'Fermeture')
t("ciblage enregistre", res['notes'][0]['cible']['service'], 'Couture')
t("sondage publie", res['votes'][0]['question'], 'Pause a 12h ou 12h30 ?')
t("compteurs de vote initialises", res['votes'][0]['resultats'], [0,0])

emp_couture={'id':'E001','service':'Couture','atelier':'Atelier A','categorie':'Ouvrier','actif':True}
emp_coupe  ={'id':'E002','service':'Coupe','atelier':'Atelier B','categorie':'Ouvrier','actif':True}
tv("ciblage : la couturiere est concernee", A._cible_ok(emp_couture,{'service':'Couture'}))
tv("ciblage : la coupeuse n'est pas concernee", not A._cible_ok(emp_coupe,{'service':'Couture'}))
tv("ciblage vide = tout le monde", A._cible_ok(emp_coupe,{}))

A.set_meta({'employees':[dict(emp_couture,token='TOK1',pin='123456',prenom='A',nom='Aa'),
                         dict(emp_coupe,token='TOK2',pin='654321',prenom='B',nom='Bb')]})
n1,v1=A._coms_pour(A.get_meta()['employees'][0])
n2,v2=A._coms_pour(A.get_meta()['employees'][1])
t("E001 (Couture) voit la note", len(n1), 1)
t("E002 (Coupe) ne la voit pas", len(n2), 0)
t("les deux voient le sondage", (len(v1),len(v2)), (1,1))
t("resultats masques avant d'avoir vote", v1[0]['resultats'], None)

async def voter():
    class R(Req):
        def __init__(self,body): super().__init__(); self._b=body
        async def json(self): return self._b
    vid=A._coms()[1][0]['id']
    a=await A.api_me_vote(R({'t':'TOK1','id':vid,'choix':1}))
    b=await A.api_me_vote(R({'t':'TOK1','id':vid,'choix':0}))   # deuxieme vote
    c=await A.api_me_vote(R({'t':'TOK2','id':vid,'choix':1}))
    return a,b,c
a,b,c=asyncio.get_event_loop().run_until_complete(voter())
t("premier vote compte", a['resultats'], [0,1])
t("second vote de la meme personne refuse", getattr(b,'status_code',None), 409)
t("vote d'une autre personne compte", c['resultats'], [0,2])

# le vote doit REMONTER cote RH : c'est ce que l'utilisateur constatait absent
vu_rh = A.api_coms()
vote_rh = vu_rh['votes'][0]
t("cote RH : les resultats du sondage sont a jour", vote_rh['resultats'], [0,2])
t("cote RH : le nombre de votantes est connu", len(vote_rh.get('votants') or []), 2)
tv("cote RH : le sondage anonyme ne dit pas qui a vote quoi",
   not vote_rh.get('detail'))
# meme chose sur un sondage nomme
async def vote_nomme():
    class R(Req):
        def __init__(self,body,sess=False):
            super().__init__({'pilotrh_sess':tok} if sess else {}); self._b=body
        async def json(self): return self._b
    await A.api_coms_vote(R({'question':'Heure de la pause ?','options':['12:00','12:30'],
                             'cible':{},'anonyme':False}, sess=True))
    vid=[v for v in A._coms()[1] if v['question'].startswith('Heure')][0]['id']
    await A.api_me_vote(R({'t':'TOK1','id':vid,'choix':0}))
    return [v for v in A.api_coms()['votes'] if v['question'].startswith('Heure')][0]
vn=asyncio.get_event_loop().run_until_complete(vote_nomme())
t("cote RH : sondage nomme, le resultat est compte", vn['resultats'], [1,0])
t("cote RH : sondage nomme, on sait qui a repondu quoi", vn.get('detail'), {'E001':0})
tv("les sondages ne fuient pas dans /api/state (endpoint dedie)",
   'votes' not in A.get_state(prive=False) and 'notes' not in A.get_state(prive=False))

async def lire():
    class R(Req):
        def __init__(self,body): super().__init__(); self._b=body
        async def json(self): return self._b
    nid=A._coms()[0][0]['id']
    await A.api_me_lu(R({'t':'TOK1','id':nid}))
    await A.api_me_lu(R({'t':'TOK1','id':nid}))     # deux fois
    await A.api_me_lu(R({'t':'TOK2','id':nid}))     # pas concernee
    return A._coms()[0][0]['lus']
lus=asyncio.get_event_loop().run_until_complete(lire())
t("accuse de lecture unique et cible", lus, ['E001'])

print("\n--- E2 : anti-force brute du code salarie ---")
A._PIN_FAILS.clear()
cle='E001|1.2.3.4'
for i in range(4): A._pin_echec(cle)
tv("4 essais : pas encore bloque", not A._pin_bloque(cle))
A._pin_echec(cle); A._pin_echec(cle)
tv("au-dela : bloque", A._pin_bloque(cle))
A._pin_ok(cle)
tv("succes remet le compteur a zero", not A._pin_bloque(cle))

print("\n--- code salarie tire avec secrets, 6 chiffres ---")
A.set_meta({'employees':[{'id':'E009','matricule':'99','prenom':'C','nom':'Cc'}]})
m=A.ensure_tokens_persist()
e=[x for x in A.get_meta()['employees'] if x['id']=='E009'][0]
t("code a 6 chiffres", len(e['pin']), 6)
tv("jeton suffisamment long", len(e['token'])>=12, e['token'])
tv("plus de module random pour les secrets", 'random.randint' not in src)
avant=dict(e)
A.ensure_tokens_persist()
e2=[x for x in A.get_meta()['employees'] if x['id']=='E009'][0]
t("un second appel ne regenere pas l'acces", (e2['token'],e2['pin']), (avant['token'],avant['pin']))

print("\n--- echappement du balisage PDF ---")
t("balise img neutralisee", A._rl('<img src="/app/data/pilotrh.db"/>'),
  '&lt;img src="/app/data/pilotrh.db"/&gt;')
t("None -> vide", A._rl(None), '')

print("\n--- SSRF : la pointeuse doit etre sur le reseau local ---")
tv("192.168.1.201 accepte", A._ip_privee('192.168.1.201'))
tv("10.0.0.5 accepte", A._ip_privee('10.0.0.5'))
tv("8.8.8.8 refuse", not A._ip_privee('8.8.8.8'))
tv("169.254.169.254 (metadonnees cloud) refuse", not A._ip_privee('169.254.169.254'))
tv("127.0.0.1 refuse", not A._ip_privee('127.0.0.1'))

print("\n--- journal d'audit ---")
A.audit('Testeur','Action de test','admin','1.2.3.4')
rows=A.api_audit(limit=5)
tv("entree enregistree avec role et ip",
   any(r['qui']=='Testeur' and r['role']=='admin' and r['ip']=='1.2.3.4' for r in rows), rows[:2])
t("limite bornee cote signature", A.api_audit(limit=1).__len__(), 1)

print("\n--- surface publique du middleware ---")
tv("/api/state n'est pas public", not A._est_public('/api/state'))
tv("/api/metrics ne devient pas public par prefixe", not A._est_public('/api/metrics'))
tv("/api/me public", A._est_public('/api/me'))
tv("/api/me/flag public", A._est_public('/api/me/flag'))
tv("/photos n'est plus public", not A._est_public('/photos/E001.jpg'))
tv("/assets/ public", A._est_public('/assets/pilotrh-core.js'))
tv("/api/health public et minimal", A._est_public('/api/health') and A.health()=={'ok':True})
tv("/sw.js public (l'espace salarie doit s'installer sans connexion RH)", A._est_public('/sw.js'))
tv("/api/me/lu public : l'accuse de lecture ne passe pas par une session RH",
   A._est_public('/api/me/lu'))
tv("/api/me/vote public : une ouvriere doit pouvoir repondre a un sondage",
   A._est_public('/api/me/vote'))

print("\n--- garde-fou : TOUT endpoint de l'espace salarie doit etre public ---")
# Le bug reel : /api/me/vote et /api/me/lu n'etaient pas dans la liste publique.
# Le portier renvoyait « non_connecte » et le vote de l'ouvriere etait perdu. Les
# tests ne le voyaient pas parce qu'ils appelaient la fonction directement, sans
# traverser le portier. On enumere donc les routes REELLEMENT declarees.
routes_me = sorted({p for (m, p, f) in A.app.routes if p.startswith('/api/me')})
tv("les routes de l'espace salarie sont bien declarees", len(routes_me) >= 4, str(routes_me))
for chemin in routes_me:
    tv("route de l'espace salarie accessible sans session : %s" % chemin,
       A._est_public(chemin))
manquantes = [p for p in routes_me if p not in A.PUBLIC_SALARIE]
t("aucune route /api/me oubliee dans PUBLIC_SALARIE", manquantes, [])
inutiles = [p for p in A.PUBLIC_SALARIE if p not in routes_me]
t("aucun chemin declare public sans route correspondante", inutiles, [])
# et l'inverse : rien d'autre ne doit devenir public par megarde
attendus_publics = {'/moi', '/moi.html', '/login', '/login.html', '/api/login',
                    '/api/logout', '/api/health', '/favicon.ico', '/sw.js',
                    '/manifest.webmanifest'} | set(A.PUBLIC_SALARIE)
t("la liste publique ne contient rien d'inattendu",
  sorted(A.PUBLIC_EXACT - attendus_publics), [])
tv("les reglages de la pointeuse ne sont pas publics", not A._est_public('/api/pointeuse'))
tv("le fichier de lancement de l'agent n'est pas public",
   not A._est_public('/api/pointeuse/agent.txt'))
tv("les donnees RH restent protegees",
   not any(A._est_public(x) for x in ('/api/state', '/api/coms', '/api/pointage',
                                      '/api/audit', '/api/users', '/api/employees/modele.xlsx',
                                      '/api/employees/import-fiches')))
tv("/manifest.webmanifest public", A._est_public('/manifest.webmanifest'))

print("\n--- le portier d'authentification, exerce pour de vrai ---")
# La couche qui manquait : les tests appelaient les endpoints en direct, donc le
# portier n'etait jamais traverse. C'est lui qui renvoyait « non_connecte » sur le
# vote d'une ouvriere. On le fait donc tourner ici, tel quel.
class ReqGate:
    def __init__(self, chemin, methode="POST", cookies=None):
        self.method = methode
        self.cookies = cookies or {}
        self.headers = {}
        self.url = type("u", (), {"path": chemin})()
        self.client = type("c", (), {"host": "10.0.0.9"})()

async def _passe(chemin, methode="POST", cookies=None):
    """Renvoie ('PASSE', None) si le portier laisse aller l'appel jusqu'a
    l'endpoint, sinon ('BLOQUE', code)."""
    marqueur = {}
    async def call_next(req):
        marqueur["vu"] = True
        return type("r", (), {"headers": {}, "status_code": 200})()
    rep = await A.auth_gate(ReqGate(chemin, methode, cookies), call_next)
    if marqueur.get("vu"):
        return ("PASSE", None)
    return ("BLOQUE", getattr(rep, "status_code", None))

def passe(chemin, methode="POST", cookies=None):
    return asyncio.get_event_loop().run_until_complete(_passe(chemin, methode, cookies))

# sans aucune session : c'est le cas d'une ouvriere sur son telephone
for chemin in ("/api/me", "/api/me/flag", "/api/me/lu", "/api/me/vote"):
    t("sans session, le portier laisse passer %s" % chemin, passe(chemin), ("PASSE", None))
t("le vote d'une ouvriere n'est plus refuse (c'etait le bug)",
  passe("/api/me/vote"), ("PASSE", None))
t("l'accuse de lecture d'une note passe aussi", passe("/api/me/lu"), ("PASSE", None))
t("l'espace salarie lui-meme est servi", passe("/moi", "GET"), ("PASSE", None))
t("le service worker est servi sans session", passe("/sw.js", "GET"), ("PASSE", None))

# et le reste demeure ferme
t("sans session, les donnees RH sont refusees", passe("/api/state", "GET"), ("BLOQUE", 401))
t("sans session, la messagerie RH est refusee", passe("/api/coms", "GET"), ("BLOQUE", 401))
t("sans session, publier une note est refuse", passe("/api/coms/vote"), ("BLOQUE", 401))
t("sans session, le modele de fiches est refuse",
  passe("/api/employees/modele.xlsx", "GET"), ("BLOQUE", 401))
t("sans session, une page RH renvoie vers la connexion", passe("/", "GET"), ("BLOQUE", 302))

# avec une session en lecture seule
lect = A._sign_session({"login": "obs", "role": "lecture", "nom": "Observateur"})
ck = {"pilotrh_sess": lect}
t("lecture seule : consulter est permis", passe("/api/state", "GET", ck), ("PASSE", None))
t("lecture seule : ecrire un pointage est refuse", passe("/api/pointage", "POST", ck), ("BLOQUE", 403))
t("lecture seule : gerer les comptes est refuse", passe("/api/users", "POST", ck), ("BLOQUE", 403))
t("lecture seule : importer des fiches est refuse",
  passe("/api/employees/import-fiches", "POST", ck), ("BLOQUE", 403))
ckadmin = {"pilotrh_sess": tok}
t("administrateur : tout passe", passe("/api/users", "POST", ckadmin), ("PASSE", None))

print("\n--- application installable : portee du service worker ---")
# Un service worker servi depuis /assets/ n'a autorite que sur /assets/ : il
# n'interceptait donc jamais /moi. Il doit etre servi depuis la racine.
rep = A.service_worker()
tv("le service worker est servi depuis la racine", getattr(rep,'status_code',200)==200)
tv("en-tete Service-Worker-Allowed presente", getattr(rep,'headers',{}).get('Service-Worker-Allowed')=='/')
tv("le manifeste est servi depuis la racine", getattr(A.web_manifest(),'status_code',200)==200)
sw = open(os.path.join(os.path.dirname(ICI),'static','assets','sw.js'),encoding='utf-8').read()
tv("le service worker ne met jamais /api/ en cache", "startsWith('/api/')" in sw)
moi = open(os.path.join(os.path.dirname(ICI),'static','moi.html'),encoding='utf-8').read()
tv("moi.html enregistre /sw.js et non /assets/sw.js", "register('/sw.js'" in moi)
tv("l'ancien enregistrement sous /assets/ est supprime", "unregister()" in moi)
tv("le manifeste est reference depuis la racine", 'href="/manifest.webmanifest"' in moi)
man = json.loads(open(os.path.join(os.path.dirname(ICI),'static','assets','manifest.webmanifest'),encoding='utf-8').read())
t("portee du manifeste", man['scope'], '/')
t("demarrage sur l'espace salarie", man['start_url'], '/moi')
t("affichage plein ecran", man['display'], 'standalone')
tv("icones 192 et 512 fournies (exigence Android)",
   {i.get('sizes') for i in man['icons']} >= {'192x192','512x512'})
tv("icone maskable fournie", any('maskable' in (i.get('purpose') or '') for i in man['icons']))
tv("/api/health/detail protege", not A._est_public('/api/health/detail'))

print("\n--- pointeuse : reglages, surveillance, silence ---")
A.set_meta_serveur({A.POINTEUSE_META: {}})
t("reglages par defaut", A.pointeuse_reglages()['port'], 4370)
t("intervalle par defaut", A.pointeuse_reglages()['intervalle'], 30)
t("aucun contact au depart : silence inconnu", A.pointeuse_silence_h(), None)
tv("et considere comme muet", A._resume_pointeuse()['muet'])

class ReqP(Req):
    def __init__(self, body=None, admin=True):
        super().__init__({'pilotrh_sess': tok} if admin else {})
        self._b = body or {}
    async def json(self): return self._b

def poste(body, admin=True):
    return asyncio.get_event_loop().run_until_complete(A.api_pointeuse_set(ReqP(body, admin)))

rep = poste({'ip':'192.168.1.55','port':4370,'motdepasse':0,'intervalle':15,'alerte_h':12,'note':'atelier A'})
t("reglages enregistres", rep['reglages']['ip'], '192.168.1.55')
t("intervalle enregistre", A.pointeuse_reglages()['intervalle'], 15)
t("delai d'alerte enregistre", A.pointeuse_reglages()['alerte_h'], 12)
t("adresse IP invalide refusee",
  getattr(poste({'ip':'pas-une-ip'}),'status_code',None), 400)
t("port farfelu refuse", getattr(poste({'port':8080}),'status_code',None), 400)
t("intervalle d'une minute refuse", getattr(poste({'intervalle':1}),'status_code',None), 400)
t("intervalle de deux jours refuse", getattr(poste({'intervalle':4000}),'status_code',None), 400)
t("delai d'alerte hors bornes refuse", getattr(poste({'alerte_h':999}),'status_code',None), 400)
t("un compte en lecture seule ne peut pas modifier",
  getattr(poste({'ip':'192.168.1.9'}, admin=False),'status_code',None), 403)
t("la valeur refusee n'a rien change", A.pointeuse_reglages()['ip'], '192.168.1.55')

# un contact remet le compteur a zero, quelle que soit la voie
etat = A._note_contact("agent", pointages=1200, jours=3, employees=97, qui="agent")
t("voie du dernier contact", etat['voie'], 'agent')
t("badges comptes", etat['pointages'], 1200)
tv("le silence est desormais mesure", (A.pointeuse_silence_h() or 0) < 1)
tv("la pointeuse n'est plus muette", not A._resume_pointeuse()['muet'])
t("le resume expose la voie", A._resume_pointeuse()['voie'], 'agent')

# une erreur est conservee SANS effacer le dernier succes
A._note_contact("agent", erreur_msg="Connexion refusee par 192.168.1.55")
e = A.pointeuse_etat()
tv("l'echec est conserve", 'refusee' in (e['derniere_erreur'] or {}).get('message',''))
t("le dernier succes reste connu", e['voie'], 'agent')
tv("un echec ne rend pas muet a lui seul", not A._resume_pointeuse()['muet'])

# silence ancien : l'alerte doit se declencher
with A._WLOCK:
    m = A.get_meta(); p = dict(m.get(A.POINTEUSE_META) or {}); et = dict(p['etat'])
    et['ts'] = (A.now() - datetime.timedelta(hours=30)).isoformat()
    p['etat'] = et; A.set_meta_serveur({A.POINTEUSE_META: p})
t("silence de 30 h mesure", round(A.pointeuse_silence_h()), 30)
tv("30 h > seuil de 12 h : muet", A._resume_pointeuse()['muet'])
poste({'alerte_h': 48})
tv("seuil releve a 48 h : plus d'alerte", not A._resume_pointeuse()['muet'])

# l'etat part bien avec /api/state pour que l'alerte s'affiche
et = A.api_state()
tv("l'etat de la pointeuse accompagne /api/state", isinstance(et.get('pointeuse'), dict))
tv("les reglages detailles NE partent PAS dans /api/state",
   'ip' not in (et.get('pointeuse') or {}))
tv("la cle serveur 'pointeuse' n'est jamais exposee brute", 'pointeuse' in A.SERVER_META_KEYS
   and A.POINTEUSE_META in A.SECRETES)
brut = A.get_meta(prive=False)
tv("le blob expurge ne contient pas les reglages reseau", A.POINTEUSE_META not in brut)

# le fichier de lancement de l'agent
A.PUBLIC_URL = "https://pilotrh-dbs.up.railway.app"
rep = A.api_agent_config(ReqP())
corps = getattr(rep, 'content', b'').decode('utf-8')
tv("le fichier de lancement contient l'adresse du serveur",
   "pilotrh-dbs.up.railway.app" in corps)
tv("il reprend l'IP configuree", "192.168.1.55" in corps)
tv("il utilise le compte de service, pas l'admin",
   "PILOTRH_LOGIN=agent" in corps and "ADMIN" not in corps.upper().replace("ADMINISTRATEUR",""))
tv("il ne contient aucun mot de passe en clair", "A_REMPLACER" in corps)
t("il est propose en telechargement", 'filename="lancer_agent.bat"' in
  str(getattr(rep,'headers',{})), True)
t("refuse a un compte en lecture seule",
  getattr(A.api_agent_config(ReqP(admin=False)),'status_code',None), 403)

# un chef d'atelier voit l'etat, pas l'adresse de l'appareil
class ReqLect2(Req):
    def __init__(self):
        super().__init__({'pilotrh_sess': A._sign_session(
            {'login':'chef','role':'atelier','nom':'Chef'})})
vu = A.api_pointeuse(ReqLect2())
tv("un chef d'atelier voit si la liaison est muette", 'silence_h' in vu)
t("mais pas l'adresse de la pointeuse", vu['reglages'], {})
tv("ni le droit de modifier", not vu['peut_modifier'])
vu = A.api_pointeuse(ReqP())
t("un RH voit l'adresse", vu['reglages']['ip'], '192.168.1.55')
tv("un RH peut modifier", vu['peut_modifier'])

# lecture directe : le garde-fou SSRF reste en place
t("les reglages servent de valeurs par defaut a la lecture directe",
  A.pointeuse_reglages()['ip'], '192.168.1.55')
tv("une adresse publique reste refusee", not A._ip_privee('8.8.8.8'))
tv("une adresse locale est acceptee", A._ip_privee('192.168.1.55'))

print("\n--- statistiques d'absenteisme reelles ---")
A.set_state({'employees':[{'id':'E001'}],'settings':A.default_settings(),'pointages':{}},remplacer=True)
rows=[]
for d in range(1,11):
    rows.append(A._rec_row('2026-08-%02d'%d,'E001',{'statut':'absent' if d<=2 else 'present','entree':'','sortie':''},'T','import'))
A.write_pointages(rows)
stats=A.api_stats_abs(mois=1)
t("taux calcule sur les donnees", stats[-1]['taux'], 20.0)
t("nombre de jours pris en compte", stats[-1]['jours'], 10)

print("\n--- modèle et import des fiches du personnel ---")
A.set_state({'employees':[{'id':'E001','matricule':'101','nom':'Nom1','prenom':'A',
                           'categorie':'Ouvrier','sexe':'F'}],
             'settings':A.default_settings(),'pointages':{}},remplacer=True)
A.write_pointages([A._rec_row('2026-08-03','E001',
                              {'statut':'present','entree':'07:30','sortie':'16:30'},'T','import')])

class ReqS(Req):
    """Requête authentifiée en administrateur."""
    def __init__(self): super().__init__({'pilotrh_sess':tok})

class ReqLect(Req):
    """Requête d'un compte en lecture seule."""
    def __init__(self):
        super().__init__({'pilotrh_sess':A._sign_session(
            {'login':'obs','role':'lecture','nom':'Observateur'})})

rep=A.api_modele_fiches(ReqS(), actuels=0)
tv("le modèle est un classeur xlsx", getattr(rep,'content',b'')[:2]==b'PK')
tv("nom de fichier proposé",
   'PilotRH_modele_fiches.xlsx' in str(getattr(rep,'headers',{})))
rep2=A.api_modele_fiches(ReqS(), actuels=1)
tv("le classeur prérempli est produit", len(getattr(rep2,'content',b''))>2000)
t("modèle refusé à un compte en lecture seule",
  getattr(A.api_modele_fiches(ReqLect()),'status_code',None), 403)

class Up:
    """Doublure d'UploadFile : renvoie le contenu en un seul morceau."""
    def __init__(self,nom,data): self.filename=nom; self._d=data; self._lu=False
    async def read(self,n=None):
        if self._lu: return b''
        self._lu=True; return self._d

CSV_FICHES=('Matricule;Nom;Prénom;Salaire mensuel (TND)\r\n'
            '101;Nom1;A;600\r\n'
            '777;Nouvelle;Ouvriere;500\r\n'
            ';Sans matricule;;\r\n').encode('utf-8')

async def _apercu():
    return await A.api_import_fiches(ReqS(), Up('f.csv',CSV_FICHES), 0)
rap=asyncio.get_event_loop().run_until_complete(_apercu())
t("aperçu : 1 création, 1 mise à jour, 1 erreur",
  [rap['resume']['creation'],rap['resume']['maj'],rap['resume']['erreur']], [1,1,1])
t("l'aperçu n'écrit rien", len(A.get_meta()['employees']), 1)

async def _appliquer():
    return await A.api_import_fiches(ReqS(), Up('f.csv',CSV_FICHES), 1)
rap=asyncio.get_event_loop().run_until_complete(_appliquer())
t("application : 1 créée, 1 mise à jour",
  [rap['applique']['crees'],rap['applique']['majs']], [1,1])
emps={e['matricule']:e for e in A.get_meta()['employees']}
t("effectif après import", sorted(emps), ['101','777'])
t("salaire mis à jour", emps['101']['salaire'], 600)
t("nom conservé (cellule non vide, valeur identique)", emps['101']['nom'], 'Nom1')
tv("la nouvelle fiche reçoit un accès QR",
   bool(emps['777'].get('token')) and bool(emps['777'].get('pin')))
t("les pointages existants sont intacts",
  A.get_pointages('2026-08-03','2026-08-03')['2026-08-03']['E001']['entree'], '07:30')
tv("l'import est journalisé",
   any('Import de fiches' in r['action'] for r in A.api_audit(limit=20)))

async def _refus():
    return await A.api_import_fiches(ReqLect(), Up('f.csv',CSV_FICHES), 1)
t("import refusé à un compte en lecture seule",
  getattr(asyncio.get_event_loop().run_until_complete(_refus()),'status_code',None), 403)

async def _vide():
    return await A.api_import_fiches(ReqS(), Up('f.csv',b'Matricule;Nom\r\n'), 0)
t("fichier sans ligne de données refusé proprement",
  getattr(asyncio.get_event_loop().run_until_complete(_vide()),'status_code',None), 400)

async def _illisible():
    return await A.api_import_fiches(ReqS(), Up('f.csv',b'Colonne A;Colonne B\r\n1;2\r\n'), 0)
t("fichier sans colonne Matricule refusé",
  getattr(asyncio.get_event_loop().run_until_complete(_illisible()),'status_code',None), 400)

print("\n=========================")
print("  %d réussis · %d échoués" % (ok,ko))
shutil.rmtree(DATA, ignore_errors=True)
sys.exit(1 if ko else 0)
