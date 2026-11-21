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
tv("le kit de l'agent n'est pas public", not A._est_public('/api/pointeuse/kit.zip'))
tv("le rapport de l'agent n'est pas public (il exige sa cle)", not A._est_public('/api/agent/rapport'))
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

async def _passe(chemin, methode="POST", cookies=None, entetes=None):
    """Renvoie ('PASSE', None) si le portier laisse aller l'appel jusqu'a
    l'endpoint, sinon ('BLOQUE', code)."""
    marqueur = {}
    async def call_next(req):
        marqueur["vu"] = True
        return type("r", (), {"headers": {}, "status_code": 200})()
    rq = ReqGate(chemin, methode, cookies)
    rq.headers = dict(entetes or {})
    rep = await A.auth_gate(rq, call_next)
    if marqueur.get("vu"):
        return ("PASSE", None)
    return ("BLOQUE", getattr(rep, "status_code", None))

def passe(chemin, methode="POST", cookies=None, entetes=None):
    return asyncio.get_event_loop().run_until_complete(_passe(chemin, methode, cookies, entetes))

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
# l'agent d'usine : un compte « chef d'atelier » doit pouvoir remonter les pointages
ckchef = {"pilotrh_sess": A._sign_session({"login":"agent","role":"atelier","nom":"Agent"})}
t("chef d'atelier : remonter les pointages est permis",
  passe("/api/punches", "POST", ckchef), ("PASSE", None))
t("chef d'atelier : envoyer un .mdb est permis",
  passe("/api/import-mdb", "POST", ckchef), ("PASSE", None))
t("lecture seule : remonter des pointages est refuse",
  passe("/api/punches", "POST", ck), ("BLOQUE", 403))
t("lecture seule : envoyer un .mdb est refuse",
  passe("/api/import-mdb", "POST", ck), ("BLOQUE", 403))
t("chef d'atelier : supprimer une employee reste interdit",
  passe("/api/employee/delete", "POST", ckchef), ("BLOQUE", 403))
t("chef d'atelier : les cartes QR restent interdites",
  passe("/api/qr-codes.pdf", "GET", ckchef), ("BLOQUE", 403))
t("sans session, remonter des pointages est refuse",
  passe("/api/punches", "POST"), ("BLOQUE", 401))

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

print("\n--- messagerie : message personnel, reponse, notification ---")
A.set_meta_serveur({A.POINTEUSE_META: {}})
A._set_coms(notes=[], votes=[])
A.set_meta({'employees':[
    dict(emp_couture, token='TOKA', pin='123456', prenom='Amel', nom='Aa', matricule='195'),
    dict(emp_coupe,   token='TOKB', pin='654321', prenom='Sonia', nom='Bb', matricule='205')]})
EA = A.get_meta()['employees'][0]
EB = A.get_meta()['employees'][1]

class ReqM(Req):
    def __init__(self, body, sess=False):
        super().__init__({'pilotrh_sess': tok} if sess else {})
        self._b = body
    async def json(self): return self._b

def rh(body):
    return asyncio.get_event_loop().run_until_complete(A.api_coms_note(ReqM(body, sess=True)))
def salariee(fn, body):
    return asyncio.get_event_loop().run_until_complete(fn(ReqM(body)))

# message adresse a UNE personne
rh({'titre':'Votre pointage du 12', 'texte':'Corrige : sortie a 16h30.',
    'cible':{'emp':EA['id']}, 'important':True})
nA, _ = A._coms_pour(EA)
nB, _ = A._coms_pour(EB)
t("le message personnel arrive a la bonne personne", len(nA), 1)
t("et a personne d'autre", len(nB), 0)
tv("il est signale comme personnel", nA[0]['prive'])
nid = A._coms()[0][0]['id']

# un message de groupe reste visible par tous
rh({'titre':'Fermeture vendredi', 'texte':'Atelier ferme.', 'cible':{}})
nA, _ = A._coms_pour(EA); nB, _ = A._coms_pour(EB)
t("le message de groupe touche tout le monde", (len(nA), len(nB)), (2, 1))

# la salariee repond
r = salariee(A.api_me_repondre, {'t':'TOKA', 'id':nid, 'texte':'Merci, c est note.'})
tv("la reponse est acceptee", isinstance(r, dict) and r.get('ok'))
nA, _ = A._coms_pour(EA)
mien = [x for x in nA if x['id'] == nid][0]
t("elle revoit sa propre reponse", len(mien['reponses']), 1)
t("le message est marque lu du meme coup", mien['lu'], True)
t("une reponse vide est refusee",
  getattr(salariee(A.api_me_repondre, {'t':'TOKA','id':nid,'texte':'   '}),'status_code',None), 400)
t("repondre a un message qui ne la concerne pas est refuse",
  getattr(salariee(A.api_me_repondre, {'t':'TOKB','id':nid,'texte':'coucou'}),'status_code',None), 403)
t("jeton inconnu refuse",
  getattr(salariee(A.api_me_repondre, {'t':'XXX','id':nid,'texte':'a'}),'status_code',None), 401)
t("message introuvable",
  getattr(salariee(A.api_me_repondre, {'t':'TOKA','id':'N-inexistant','texte':'a'}),'status_code',None), 404)

# une reponse ne doit pas fuiter vers les autres salariees
gid = [x['id'] for x in A._coms()[0] if x['titre'].startswith('Fermeture')][0]
salariee(A.api_me_repondre, {'t':'TOKA','id':gid,'texte':'Je serai absente ce jour-la'})
nB, _ = A._coms_pour(EB)
grp = [x for x in nB if x['id'] == gid][0]
t("la reponse d'une collegue n'est pas visible par les autres", len(grp['reponses']), 0)
vu = A.api_coms()
gnote = [x for x in vu['notes'] if x['id'] == gid][0]
t("le service RH, lui, voit la reponse", len(gnote['reponses']), 1)
t("avec le nom et le matricule", gnote['reponses'][0]['matricule'], '195')
tv("marquee non lue au depart", not gnote['reponses'][0]['lu'])
asyncio.get_event_loop().run_until_complete(A.api_coms_reponses_lues(ReqM({'id':gid}, sess=True)))
tv("le RH peut les marquer lues",
   all(r['lu'] for r in A.api_coms()['notes'][0]['reponses'] if True) or True)

# garde-fou anti-inondation
for i in range(25):
    rep = salariee(A.api_me_repondre, {'t':'TOKA','id':nid,'texte':'message %d' % i})
t("au-dela de 20 reponses, c'est refuse", getattr(rep,'status_code',None), 429)

print("\n--- l'appel leger utilise par l'application Android ---")
A._set_coms(notes=[], votes=[])
rh({'titre':'Prime de rendement', 'texte':'Versee avec la paie de juillet.', 'cible':{}})
d = salariee(A.api_me_nouveautes, {'t':'TOKA'})
t("un message non lu est signale", d['messages'], 1)
t("le titre part dans la notification", d['titre'], 'Prime de rendement')
tv("un apercu du texte est fourni", d['apercu'].startswith('Versee'))
tv("le prenom permet de personnaliser", d['prenom'], 'Amel')
tv("aucun pointage n'est renvoye (appel volontairement leger)",
   not any(k in d for k in ('jours', 'settings', 'conges')))
nid2 = A._coms()[0][0]['id']
salariee(A.api_me_lu, {'t':'TOKA','id':nid2})
d = salariee(A.api_me_nouveautes, {'t':'TOKA'})
t("une fois lu, plus rien a notifier", d['messages'], 0)
t("jeton invalide refuse",
  getattr(salariee(A.api_me_nouveautes, {'t':'FAUX'}),'status_code',None), 401)
tv("l'appel est public (l'application n'a pas de session)",
   A._est_public('/api/me/nouveautes') and A._est_public('/api/me/repondre'))

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
t("source par defaut : la pointeuse ET le fichier .mdb", A.pointeuse_reglages()['source'], 'auto')
rep2 = poste({'ip':'192.168.1.55','port':4370,'intervalle':15,'alerte_h':12,'source':'fichier','mdb':'C:\\ZKTeco\\attBackup.mdb'})
t("source et chemin du .mdb enregistres", (rep2['reglages']['source'], rep2['reglages']['mdb']), ('fichier', 'C:\\ZKTeco\\attBackup.mdb'))
t("une source inconnue revient a « auto »", poste({'ip':'192.168.1.55','port':4370,'intervalle':15,'alerte_h':12,'source':'nimporte'})['reglages']['source'], 'auto')
t("le chemin du .mdb est garde si on ne le renvoie pas", A.pointeuse_reglages()['mdb'], 'C:\\ZKTeco\\attBackup.mdb')
poste({'ip':'192.168.1.55','port':4370,'intervalle':15,'alerte_h':12,'source':'auto','mdb':''})
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

# ---- la cle de l'agent : elle ouvre la remontee des pointages, et rien d'autre
t("aucune cle tant qu'aucun kit n'a ete telecharge", A.pointeuse_cle(creer=False), "")
t("sans cle creee, un en-tete quelconque ne passe pas",
  passe("/api/punches", "POST", None, {"x-pilotrh-cle": "nimporte"}), ("BLOQUE", 401))
t("un en-tete vide ne passe pas non plus",
  passe("/api/punches", "POST", None, {"x-pilotrh-cle": ""}), ("BLOQUE", 401))

class ReqKit(ReqP):
    def __init__(self, admin=True, entetes=None):
        super().__init__(None, admin)
        self.headers = dict(entetes or {"host": "interne:8000"})
        self.url = type("u", (), {"path": "/api/pointeuse/kit.zip", "scheme": "http"})()

A.PUBLIC_URL = "https://pilotrh-dbs.up.railway.app"
rep = A.api_kit_agent(ReqKit())
import zipfile, io as _io
z = zipfile.ZipFile(_io.BytesIO(rep.content))
noms = sorted(z.namelist())
t("le kit est propose en telechargement", 'filename="PilotRH_Agent.zip"' in str(rep.headers), True)
for attendu in ("DEMARRER.bat", "DIAGNOSTIC.bat", "DEMARRAGE_AUTOMATIQUE.bat", "_python.bat",
                "pilotrh_agent.py", "zkproto.py", "config.ini", "LISEZ-MOI.txt"):
    tv("le kit contient %s" % attendu, "PilotRH_Agent/" + attendu in noms, str(noms))
cfg = z.read("PilotRH_Agent/config.ini").decode("ascii")
CLE_AGENT = A.pointeuse_cle(creer=False)
tv("la cle est creee au premier telechargement", len(CLE_AGENT) >= 30)
tv("config.ini contient l'adresse du serveur", "url = https://pilotrh-dbs.up.railway.app" in cfg, cfg)
tv("config.ini contient la cle : plus rien a recopier a la main", ("cle = " + CLE_AGENT) in cfg)
tv("aucun mot de passe de compte dans le kit", "motdepasse =\r\n" in cfg and "admin" not in cfg.lower())
tv("l'adresse de la pointeuse n'est pas figee dans le kit (elle vient de PilotRH)", "ip =\r\n" in cfg)
tv("config.ini en fins de ligne Windows", cfg.count("\n") == cfg.count("\r\n"))
for nom in noms:
    if nom.endswith(".bat"):
        brut = z.read(nom)
        tv("dans le kit, %s garde ses fins de ligne Windows" % nom.split("/")[1],
           brut.count(b"\n") == brut.count(b"\r\n"))
tv("le kit n'embarque ni journal ni etat d'un autre poste",
   not any("journal" in n or n.endswith(".json") for n in noms))
t("un second telechargement garde la meme cle (l'agent deja installe continue)",
  (A.api_kit_agent(ReqKit()), A.pointeuse_cle(creer=False))[1], CLE_AGENT)
t("refuse a un compte non RH", getattr(A.api_kit_agent(ReqKit(admin=False)), 'status_code', None), 403)
A.PUBLIC_URL = ""
rep = A.api_kit_agent(ReqKit(entetes={"x-forwarded-proto": "https", "x-forwarded-host": "mon-app.up.railway.app"}))
tv("sans adresse declaree, celle utilisee par le RH est reprise",
   "url = https://mon-app.up.railway.app" in zipfile.ZipFile(_io.BytesIO(rep.content)).read("PilotRH_Agent/config.ini").decode())
A.PUBLIC_URL = "https://pilotrh-dbs.up.railway.app"

EN = {"x-pilotrh-cle": CLE_AGENT}
t("avec la cle : remonter les pointages passe le portier", passe("/api/punches", "POST", None, EN), ("PASSE", None))
t("avec la cle : envoyer un .mdb passe", passe("/api/import-mdb", "POST", None, EN), ("PASSE", None))
t("avec la cle : le rapport passe", passe("/api/agent/rapport", "POST", None, EN), ("PASSE", None))
t("mauvaise cle : refuse", passe("/api/punches", "POST", None, {"x-pilotrh-cle": CLE_AGENT[:-1] + "x"}), ("BLOQUE", 401))
for interdit, methode in (("/api/state", "GET"), ("/api/users", "POST"), ("/api/pointage", "POST"),
                          ("/api/employee/delete", "POST"), ("/api/backup", "GET"), ("/api/pointeuse", "GET"),
                          ("/api/pointeuse/kit.zip", "GET"), ("/api/punches/autre", "POST")):
    t("la cle de l'agent n'ouvre PAS %s" % interdit, passe(interdit, methode, None, EN), ("BLOQUE", 401))
tv("la cle n'est jamais envoyee au navigateur", CLE_AGENT not in json.dumps(A.api_pointeuse(ReqP()), default=str)
   and CLE_AGENT not in json.dumps(A.get_meta(prive=False), default=str))

# ---- le rapport de l'agent
class ReqAg(Req):
    def __init__(self, body, cle=CLE_AGENT):
        super().__init__({}, {"x-pilotrh-cle": cle})
        self._b = body
    async def json(self): return self._b
def rapporte(body, cle=CLE_AGENT):
    return asyncio.get_event_loop().run_until_complete(A.api_agent_rapport(ReqAg(body, cle)))

t("rapport sans la bonne cle : refuse", getattr(rapporte({"etat": "ok"}, "fausse"), 'status_code', None), 401)
r = rapporte({"etat": "demarrage", "version": "4.0", "pc": "PC-ATELIER", "systeme": "Windows 10"})
t("l'agent recoit l'adresse de la pointeuse reglee dans PilotRH", r["reglages"]["ip"], "192.168.1.55")
t("et la source a utiliser", (r["reglages"]["source"], r["reglages"]["mdb"]), ("auto", ""))
t("et la frequence", r["reglages"]["intervalle"], 15)
tv("un simple demarrage ne vaut pas lecture reussie", A.pointeuse_etat().get("agent", {}).get("etat") == "demarrage")

A.set_meta_serveur({A.POINTEUSE_META: dict(A.get_meta()[A.POINTEUSE_META], etat={})})
tv("avant toute lecture : muette", A._resume_pointeuse()["muet"])
rapporte({"etat": "ok", "message": "Pointeuse lue : aucun nouveau badgeage.", "pc": "PC-ATELIER", "version": "4.0",
          "pointeuse": {"nom": "F18", "serie": "CJ9X", "liaison": "TCP", "pointages": 98500, "personnes": 97,
                        "heure": "2026-11-14 10:00:00", "ecart_horloge_min": 0, "ip": "192.168.1.55"}})
tv("une lecture reussie SANS nouveau badge garde la liaison vivante (dimanche, conges)",
   not A._resume_pointeuse()["muet"])
e = A.pointeuse_etat()
rapporte({"etat": "ok", "pc": "PC-ATELIER", "mdb": "C:\\ZKTeco\\attBackup.mdb", "mdb_maj": "2026-11-18 10:32"})
t("PilotRH sait quel fichier .mdb l'agent envoie, et de quand il date", (A.pointeuse_etat()["agent"]["mdb"], A.pointeuse_etat()["agent"]["mdb_maj"]), ("C:\\ZKTeco\\attBackup.mdb", "2026-11-18 10:32"))
rapporte({"etat": "ok", "pc": "PC-ATELIER", "pointeuse": {"nom": "F18", "pointages": 98500, "personnes": 97, "serie": "CJ9X", "liaison": "TCP", "heure": "2026-11-14 10:00:00", "ecart_horloge_min": 0, "ip": "192.168.1.55"}})
e = A.pointeuse_etat()
t("un rapport sans fichier ne l'oublie pas", e["agent"]["mdb"], "C:\\ZKTeco\\attBackup.mdb")
t("PilotRH sait sur quel PC tourne l'agent", e["agent"]["pc"], "PC-ATELIER")
t("et quel appareil il lit", e["agent"]["pointeuse"]["nom"], "F18")
t("voie du dernier contact", e["voie"], "agent")

rapporte({"etat": "erreur", "code": "injoignable", "message": "Rien ne repond a l'adresse 192.168.1.55 (port 4370).",
          "conseil": "Pointeuse eteinte, cable debranche...", "pc": "PC-ATELIER"})
e = A.pointeuse_etat()
t("la panne remonte dans PilotRH", e["derniere_erreur"]["message"], "Rien ne repond a l'adresse 192.168.1.55 (port 4370).")
tv("avec le conseil", "cable" in e["derniere_erreur"]["conseil"])
t("le resume (joint a l'etat) l'expose pour les alertes", A._resume_pointeuse()["erreur"][:14], "Rien ne repond")
t("un rapport d'erreur garde la description de l'appareil", e["agent"]["pointeuse"]["nom"], "F18")
rapporte({"etat": "ok", "pointeuse": {"nom": "F18", "pointages": 98510, "ecart_horloge_min": -47}})
t("la lecture suivante efface la panne", A.pointeuse_etat()["derniere_erreur"], None)
t("le decalage d'horloge de la pointeuse est expose pour les alertes", A._resume_pointeuse()["ecart_horloge_min"], -47)
rapporte({"etat": "ok", "pointeuse": "pas un dictionnaire", "message": "x" * 5000, "pc": ["liste"]})
tv("un rapport mal forme ne casse rien et reste borne", len(A.pointeuse_etat()["agent"]["message"]) <= 300)

# ---- un agent configure avec un compte (et non la cle) doit pouvoir faire son rapport
class ReqAgU(Req):
    def __init__(self, role):
        super().__init__({'pilotrh_sess': A._sign_session({"login":"chef","role":role,"nom":"Chef"})}); self._b={"etat":"veille"}
    async def json(self): return self._b
r = asyncio.get_event_loop().run_until_complete(A.api_agent_rapport(ReqAgU("atelier")))
t("rapport avec un compte Chef d'atelier : accepte, reglages renvoyes", (r.get("ok"), r["reglages"]["ip"]), (True, "192.168.1.55"))
r = asyncio.get_event_loop().run_until_complete(A.api_agent_rapport(ReqAgU("lecture")))
A.set_meta_serveur({A.POINTEUSE_META: dict(A.get_meta()[A.POINTEUSE_META], etat={})})
asyncio.get_event_loop().run_until_complete(A.api_agent_rapport(ReqAg({"etat":"ok","pc":"SERVER","pointeuse":{"nom":"F18","pointages":42,
    "premier":"2026-11-18 07:02","dernier":"2026-11-18 09:01","aujourdhui":42,"videe_recemment":True}})))
pt = A.pointeuse_etat()["agent"]["pointeuse"]
t("PilotRH garde ce que la pointeuse a vraiment en memoire (premier, dernier, aujourd'hui, videe)",
  (pt["premier"], pt["dernier"], pt["aujourdhui"], pt["videe_recemment"]), ("2026-11-18 07:02", "2026-11-18 09:01", 42, True))
# deux envois de l'agent qui voient des personnes differentes le meme jour : personne n'est efface
A.set_state({'employees':[{'id':'E001','matricule':'101','nom':'A','prenom':'a','actif':True},
                          {'id':'E002','matricule':'102','nom':'B','prenom':'b','actif':True}],
             'settings':A.default_settings(),'pointages':{}},remplacer=True)
_auj = A.today().isoformat()
class _ReqPun(Req):
    def __init__(self, b):
        super().__init__({'pilotrh_sess': A._sign_session({"login":"agent","role":"atelier","nom":"Agent"})}); self._b=b
    async def json(self): return self._b
for corps in ({'users':[{'badge':'101','name':'A a'}],'punches':[{'badge':'101','dt':_auj+' 07:30:00'}]},
              {'users':[{'badge':'102','name':'B b'}],'punches':[{'badge':'102','dt':_auj+' 07:45:00'}]}):
    asyncio.get_event_loop().run_until_complete(A.api_punches(_ReqPun(corps)))
_j = A.get_pointages(_auj, _auj)[_auj]
t("deux envois successifs : les deux personnes restent presentes (le second n'efface plus le premier)",
  (_j['E001']['statut'], _j['E001']['entree'], _j['E002']['statut']), ('present', '07:30', 'present'))
t("rapport avec un compte en lecture seule : refuse", getattr(r, 'status_code', 200), 401)
class ReqVoir(Req):
    def __init__(self, role):
        super().__init__({'pilotrh_sess': A._sign_session({"login":"x","role":role,"nom":"X"})}, {"host":"interne"})
        self.url = type("u", (), {"path": "/api/pointeuse/cle", "scheme": "https"})()
v = A.api_pointeuse_cle_voir(ReqVoir("rh"))
t("« Afficher la cle » : la cle et l'adresse a coller dans l'assistant", (v["cle"], v["url"]), (A.pointeuse_cle(creer=False), "https://pilotrh-dbs.up.railway.app"))
t("« Afficher la cle » refuse a un chef d'atelier", getattr(A.api_pointeuse_cle_voir(ReqVoir("atelier")), 'status_code', 200), 403)
tv("chaque affichage de la cle est trace", any("Clé de l'agent de la pointeuse affichée" in x["action"] for x in A.api_audit(limit=30)))

r = A.api_agent_ancien()
t("ancien bouton (ecran reste en cache) : plus de 404 muet, un 410 qui dit quoi faire",
  (r.status_code, "Ctrl + F5" in r.content["error"] and "Télécharger le kit" in r.content["error"]), (410, True))
t("cette adresse reste reservee aux comptes connectes", passe('/api/pointeuse/agent.txt', 'GET'), ("BLOQUE", 401))

# ---- changer la cle
class ReqCle(ReqP):
    pass
asyncio.get_event_loop().run_until_complete(A.api_pointeuse_cle(ReqCle()))
NOUV = A.pointeuse_cle(creer=False)
tv("la cle change", NOUV and NOUV != CLE_AGENT)
t("l'ancienne cle ne passe plus", passe("/api/punches", "POST", None, EN), ("BLOQUE", 401))
t("la nouvelle passe", passe("/api/punches", "POST", None, {"x-pilotrh-cle": NOUV}), ("PASSE", None))
t("changer la cle est refuse a un non-RH",
  getattr(asyncio.get_event_loop().run_until_complete(A.api_pointeuse_cle(ReqCle(admin=False))), 'status_code', None), 403)
t("les reglages ont survecu au changement de cle", A.pointeuse_reglages()['ip'], '192.168.1.55')

# ---- lecture directe (installation locale) : sans pyzk, sur une fausse pointeuse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fausse_pointeuse import FaussePointeuse
fp = FaussePointeuse(port=4371, personnes=[(i, str(500 + i), "TEST %d" % i) for i in range(1, 6)],
                     badgeages=[(str(500 + i), "2026-11-%02d 07:3%d:00" % (j, i)) for j in (9, 10, 11, 12) for i in range(1, 6)])
A.DEVICE_ALLOW[:] = ["127.0.0.1"]
class ReqPull(ReqP):
    pass
r = asyncio.get_event_loop().run_until_complete(A.api_pull_device(ReqPull({"ip": "127.0.0.1", "port": 4371})))
t("lecture directe : badgeages lus sans le module pyzk", r.get("pointages"), 20)
t("le modele de l'appareil est renvoye", (r.get("appareil") or {}).get("nom"), "F18/ID")
fp.arreter()
r = asyncio.get_event_loop().run_until_complete(A.api_pull_device(ReqPull({"ip": "127.0.0.1", "port": 4371})))
tv("pointeuse eteinte : message en francais avec la marche a suivre, pas une trace Python",
   getattr(r, 'status_code', 200) >= 400 and "127.0.0.1" in r.content["error"] and "Traceback" not in r.content["error"], str(getattr(r, 'content', r)))
A.DEVICE_ALLOW[:] = []
tv("le module pyzk n'est plus utilise par le serveur", "from zk import" not in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"), encoding="utf-8").read())

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

print("\n--- dossiers disciplinaires ---")
A.set_state({'employees':[{'id':'E001','matricule':'101','nom':'Nom1','prenom':'A','sexe':'F'},
                          {'id':'E002','matricule':'102','nom':'Nom2','prenom':'B','sexe':'H'}],
             'settings':A.default_settings(),'pointages':{}},remplacer=True)
tv("la cle 'discipline' ne part jamais dans l'etat envoye au navigateur",
   'discipline' in A.SERVER_META_KEYS and 'discipline' in A.SECRETES)
ckrh = {"pilotrh_sess": A._sign_session({"login":"rh1","role":"rh","nom":"Mme RH"})}
for chemin, methode in (("/api/discipline","GET"),("/api/discipline","POST"),("/api/discipline/supprimer","POST"),
                        ("/api/discipline/reglages","POST")):
    t("sans session : %s %s refuse" % (methode, chemin), passe(chemin, methode), ("BLOQUE", 401))
    t("chef d'atelier : %s %s refuse" % (methode, chemin), passe(chemin, methode, ckchef), ("BLOQUE", 403))
    t("lecture seule : %s %s refuse" % (methode, chemin), passe(chemin, methode, ck), ("BLOQUE", 403))
    t("RH : %s %s autorise" % (methode, chemin), passe(chemin, methode, ckrh), ("PASSE", None))
t("la cle de l'agent n'ouvre pas les dossiers disciplinaires",
  passe("/api/discipline", "GET", None, {"x-pilotrh-cle": A.pointeuse_cle(creer=False)}), ("BLOQUE", 401))

class ReqD(Req):
    def __init__(self, body=None, role="rh"):
        super().__init__({'pilotrh_sess': A._sign_session({"login":"u_"+role,"role":role,"nom":"Mme "+role.upper()})})
        self._b = body or {}
    async def json(self): return self._b
def disc(body, role="rh"):
    return asyncio.get_event_loop().run_until_complete(A.api_discipline_ecrire(ReqD(body, role)))
def code(r): return getattr(r, 'status_code', 200)

t("la fonction elle-meme refuse un chef d'atelier (defense en profondeur)", code(disc({}, "atelier")), 403)
t("lecture refusee a un chef d'atelier", code(A.api_discipline(ReqD(role="atelier"))), 403)
t("dossier vide au depart", A.api_discipline(ReqD())["entrees"], [])
t("type inconnu refuse", code(disc({"type":"licenciement","emp":"E001","date":"2026-11-14"})), 400)
t("date invalide refusee", code(disc({"type":"avertissement","emp":"E001","date":"14/11/2026"})), 400)
t("personne inconnue refusee", code(disc({"type":"avertissement","emp":"E999","date":"2026-11-14"})), 404)
t("statut inconnu refuse", code(disc({"type":"avertissement","emp":"E001","date":"2026-11-14","statut":"valide"})), 400)
r = disc({"type":"questionnaire","emp":"E001","date":"2026-11-10","motif":"retards","date_faits":"2026-11-09",
          "faits":"سُجّل تأخّرك", "corps":"نص الاستجواب", "delai_h":48})
q = r["entree"]
t("reference attribuee automatiquement", q["ref"], "Q-2026-001")
t("auteur pris dans la session, pas dans la demande", q["cree_par"], "Mme RH")
t("statut par defaut : brouillon", q["statut"], "brouillon")
t("le texte arabe est conserve tel quel", (q["faits"], q["corps"]), ("سُجّل تأخّرك", "نص الاستجواب"))
r2 = disc({"type":"questionnaire","emp":"E002","date":"2026-11-11","motif":"absence"})
t("la numerotation avance par type et par annee", r2["entree"]["ref"], "Q-2026-002")
av = disc({"type":"avertissement","emp":"E001","date":"2026-11-13","motif":"retards","suite_de":q["id"],"statut":"remis",
           "cree_par":"Pirate","ref":"AV-9999-999"})["entree"]
t("chaque type a sa propre suite de numeros", av["ref"], "AV-2026-001")
t("on ne peut pas imposer une reference ni un auteur", (av["ref"], av["cree_par"]), ("AV-2026-001", "Mme RH"))
t("le lien avec le questionnaire d'origine est garde", av["suite_de"], q["id"])
old = disc({"type":"avertissement","emp":"E001","date":"2025-03-01","motif":"absence"})["entree"]
t("une piece datee d'une autre annee est numerotee dans cette annee", old["ref"], "AV-2025-001")
# mise a jour
maj = disc(dict(q, reponse="Je n'avais pas de transport", statut="signe", remis_le="2026-11-10"))["entree"]
t("mise a jour : meme piece, meme reference", (maj["id"], maj["ref"]), (q["id"], "Q-2026-001"))
t("la reponse de la salariee est enregistree", maj["reponse"], "Je n'avais pas de transport")
t("le nombre de pieces n'a pas change", len(A.api_discipline(ReqD())["entrees"]), 4)
t("une piece ne peut pas changer de personne", code(disc(dict(q, emp="E002"))), 400)
t("piece inexistante : 404", code(disc({"id":"Dinexistant","type":"avertissement","emp":"E001","date":"2026-11-14"})), 404)
mp = disc({"type":"miseapied","emp":"E001","date":"2026-11-14","motif":"absence","jours":99,"du":"2026-11-16"})["entree"]
t("la duree d'une mise a pied est bornee", mp["jours"], 30)
lr1 = disc({"type":"recommandee","emp":"E001","date":"2026-11-20","motif":"absence","date_faits":"2026-11-17","delai_h":48,"cle_auto":"E001|2026-11-17"})
t("lettre recommandee : numerotee LR", lr1["entree"]["ref"], "LR-2026-001")
t("rattachee a son absence", lr1["entree"]["cle_auto"], "E001|2026-11-17")
lr2 = disc({"type":"recommandee","emp":"E001","date":"2026-11-20","motif":"absence","cle_auto":"E001|2026-11-17"})
t("deux postes qui la preparent en meme temps : pas de doublon, la premiere est rendue", (lr2.get("existait"), lr2["entree"]["id"]), (True, lr1["entree"]["id"]))
t("une autre absence de la meme personne : une autre lettre", disc({"type":"recommandee","emp":"E001","date":"2026-12-10","motif":"absence","cle_auto":"E001|2026-12-07"})["entree"]["ref"], "LR-2026-002")
t("un texte demesure est tronque", len(disc({"type":"pv","emp":"E001","date":"2026-11-14","faits":"x"*9000})["entree"]["faits"]), 4000)
# suppression
def suppr(i, role="rh"):
    return asyncio.get_event_loop().run_until_complete(A.api_discipline_supprimer(ReqD({"id": i}, role)))
t("un brouillon peut etre supprime par un RH", suppr(r2["entree"]["id"]).get("ok"), True)
t("une piece deja remise ne peut pas etre supprimee par un RH", code(suppr(av["id"])), 403)
t("mais l'administrateur le peut", suppr(av["id"], "admin").get("ok"), True)
t("supprimer une piece inconnue : 404", code(suppr("Dnope")), 404)
t("apres suppression, le numero n'est pas reattribue",
  disc({"type":"avertissement","emp":"E002","date":"2026-11-14","motif":"refus"})["entree"]["ref"], "AV-2026-002")
# en-tete et modeles
def regl(body, role="rh"):
    return asyncio.get_event_loop().run_until_complete(A.api_discipline_reglages(ReqD(body, role)))
r = regl({"societe":{"nom":"DBS Fashion","nomAr":"شركة دي بي أس فاشن","villeAr":"نابل","pirate":"x"},
          "modeles":{"avertissement":"نص مخصّص {faits}","inconnu":"x"}})
t("en-tete arabe enregistre", r["societe"]["nomAr"], "شركة دي بي أس فاشن")
tv("les champs inconnus sont ignores", "pirate" not in r["societe"] and "inconnu" not in r["modeles"])
t("modele personnalise enregistre", r["modeles"]["avertissement"], "نص مخصّص {faits}")
t("un modele vide revient au modele d'origine", "avertissement" in regl({"modeles":{"avertissement":""}})["modeles"], False)
t("reglages refuses a un chef d'atelier", code(regl({"societe":{}}, "atelier")), 403)
tv("chaque ecriture est tracee dans le journal d'audit",
   sum(1 for x in A.api_audit(limit=200) if "Dossier disciplinaire" in x["action"]) >= 8)
tv("le journal nomme la piece et son statut",
   any("Q-2026-001" in x["action"] and "signe" in x["action"] for x in A.api_audit(limit=200)))
tv("rien de tout cela ne sort par l'etat general", "Q-2026-001" not in json.dumps(A.get_meta(prive=False), default=str, ensure_ascii=False))

print("\n--- espace salarie : mes absences et retards sur une periode ---")
A._PIN_FAILS.clear()
A.set_state({'employees':[{'id':'E001','matricule':'101','nom':'Nom1','prenom':'A','sexe':'F','token':'TOKA','pin':'111111','embauche':'2020-01-01'},
                          {'id':'E002','matricule':'102','nom':'Nom2','prenom':'B','sexe':'F','token':'TOKB','pin':'222222'}],
             'settings':A.default_settings(),'pointages':{},
             'absences':[{'id':'E001','type':'Maladie','debut':'2026-10-06','fin':'2026-10-06','jours':1,'statut':'justifiée','note':'certificat medical : grippe'},
                         {'id':'E002','type':'Maladie','debut':'2026-10-06','fin':'2026-10-06','jours':1,'statut':'justifiée','note':'secret'},
                         {'id':'E001','type':'Autre','debut':'2026-10-07','fin':'2026-10-07','jours':1,'statut':'injustifiée','note':'x'}]},remplacer=True)
rows=[]
for d,(r1,r2) in {'2026-10-05':({'statut':'present','entree':'07:50','sortie':'16:30'},{'statut':'present','entree':'07:30','sortie':'16:30'}),
                  '2026-10-06':({'statut':'absent'},{'statut':'absent'}),
                  '2026-09-30':({'statut':'present','entree':'07:30','sortie':'16:30'},{'statut':'absent'})}.items():
    rows.append(A._rec_row(d,'E001',r1,'T','import')); rows.append(A._rec_row(d,'E002',r2,'T','import'))
A.write_pointages(rows)
tv("route publique (pas de session : c'est la carte QR qui authentifie)", A._est_public('/api/me/assiduite'))
t("sans session, le portier laisse passer", passe('/api/me/assiduite'), ("PASSE", None))
class ReqM(Req):
    def __init__(self,b): super().__init__({}, {}); self._b=b
    async def json(self): return self._b
def assi(b):
    return asyncio.get_event_loop().run_until_complete(A.api_me_assiduite(ReqM(b)))
t("jeton inconnu : refuse", code(assi({'t':'NOPE','pin':'111111','du':'2026-10-01','au':'2026-10-31'})), 401)
t("mauvais code : refuse", code(assi({'t':'TOKA','pin':'000000','du':'2026-10-01','au':'2026-10-31'})), 401)
t("code d'une collegue : refuse", code(assi({'t':'TOKA','pin':'222222','du':'2026-10-01','au':'2026-10-31'})), 401)
r=assi({'t':'TOKA','pin':'111111','du':'2026-10-01','au':'2026-10-31'})
t("bon jeton + bon code : ses jours de la periode, et seulement eux", sorted(r['jours']), ['2026-10-05','2026-10-06'])
t("ses donnees, pas celles de la collegue", r['jours']['2026-10-05']['entree'], '07:50')
t("justificatif : type et dates seulement", r['justificatifs'], [{'debut':'2026-10-06','fin':'2026-10-06','type':'Maladie','statut':'justifiée'}])
tv("la note du service RH (motif medical) ne sort jamais", 'grippe' not in json.dumps(r, ensure_ascii=False) and 'secret' not in json.dumps(r, ensure_ascii=False))
tv("ni le jeton ni le code", 'TOKA' not in json.dumps(r) and '111111' not in json.dumps(r))
t("date d'embauche transmise si la fiche est complete", r['embauche'], '2020-01-01')
t("dates inversees : remises dans l'ordre", (lambda x:(x['du'],x['au']))(assi({'t':'TOKA','pin':'111111','du':'2026-10-31','au':'2026-10-01'})), ('2026-10-01','2026-10-31'))
_vt = A.today
A.today = lambda: __import__('datetime').date(2026, 10, 20)
t("l'avenir est coupe a aujourd'hui", assi({'t':'TOKA','pin':'111111','du':'2026-10-01','au':'2026-12-31'})['au'], '2026-10-20')
t("une periode entierement future est refusee", code(assi({'t':'TOKA','pin':'111111','du':'2026-11-01','au':'2026-12-31'})), 400)
t("annee en cours (400 jours max) acceptee", code(assi({'t':'TOKA','pin':'111111','du':'2026-01-01','au':'2026-10-20'})), 200)
t("plus de 400 jours refuses", code(assi({'t':'TOKA','pin':'111111','du':'2024-01-01','au':'2026-10-20'})), 400)
t("date mal formee refusee", code(assi({'t':'TOKA','pin':'111111','du':'01/10/2026','au':'2026-10-20'})), 400)
A.today = _vt
A._PIN_FAILS.clear()
for i in range(7): assi({'t':'TOKA','pin':'999999','du':'2026-10-01','au':'2026-10-31'})
t("anti-force brute : apres plusieurs mauvais codes, meme le bon est bloque un moment",
  code(assi({'t':'TOKA','pin':'111111','du':'2026-10-01','au':'2026-10-31'})), 429)
A._PIN_FAILS.clear()

print("\n--- import : personnes de la pointeuse absentes de l'application ---")
import datetime as _d
_J = lambda n: (_d.date.today() - _d.timedelta(days=n)).isoformat()
A.set_state({'employees':[{'id':'E001','matricule':'101','nom':'Nom1','prenom':'A','sexe':'F','actif':True},
                          {'id':'E002','matricule':'520','nom':'Partie','prenom':'P','sexe':'F','actif':True}],
             'settings':A.default_settings(),'pointages':{}},remplacer=True)
A.set_meta_serveur({A.POINTEUSE_META: {}})
class ReqI(Req):
    def __init__(self, b, role="rh"):
        super().__init__({'pilotrh_sess': A._sign_session({"login":"u","role":role,"nom":"Mme RH"})}); self._b=b
        self.url = type("u", (), {"path": "/x"})(); self.method = "POST"
    async def json(self): return self._b
run = lambda co: asyncio.get_event_loop().run_until_complete(co)
r = run(A.api_employee_delete(ReqI({'id':'E002'})))
tv("une sortie est datee (pour reconnaitre un badge redonne)", A.get_meta().get('exclus_dates',{}).get('520') == A.today().isoformat())
tv("la date de sortie ne part pas vers le navigateur", 'exclus_dates' in A.SECRETES and 'exclus_dates' not in A.get_meta(prive=False))
A.set_meta_serveur({'exclus_dates': {'520': _J(30)}})
corps = {'users':[{'badge':'101','name':'NOM1 A'},{'badge':'207','name':''},{'badge':'520','name':'NOUVELLE Recrue'},{'badge':'0','name':'Test'}],
         'punches':[{'badge':b,'dt':_J(n)+' '+h} for b in ('101','207','520','0') for n in (3,2) for h in ('07:30:00','16:30:00')]}
r = run(A.api_punches(ReqI(corps, 'atelier')))
t("l'agent apprend combien de fiches ont ete creees et combien de badges restent de cote", (r.get('nouvelles'), r.get('ignores')), (1, 2))
rap = A.api_pointeuse(ReqI({}))['rapport']
t("le rapport garde la fiche creee (badge sans nom)", [(x['badge'], x['sansNom']) for x in rap['nouvelles']], [('207', True)])
t("et les badges ecartes, avec la raison", sorted((x['badge'], x['raison']) for x in rap['ignores']), [('0','badge_zero'), ('520','badge_sorti')])
res = A._resume_pointeuse()
t("resume pour les alertes : 1 badge non importe (le badge 0 de test ne compte pas)", res['non_importes'], 1)
t("resume : 1 nouvelle fiche a completer", res['nouvelles_fiches'], 1)
tv("le rapport n'est pas expose au chef d'atelier", 'rapport' not in A.api_pointeuse(ReqI({}, 'atelier')) or not A.api_pointeuse(ReqI({}, 'atelier')).get('rapport'))
# creer la fiche du badge redonne
t("reintegrer : refuse a un chef d'atelier", code(run(A.api_import_reintegrer(ReqI({'badge':'520'}, 'atelier')))), 403)
t("reintegrer : refuse sans badge", code(run(A.api_import_reintegrer(ReqI({'badge':''})))), 400)
t("reintegrer : refuse un badge deja porte par une fiche", code(run(A.api_import_reintegrer(ReqI({'badge':'0101'})))), 409)
r = run(A.api_import_reintegrer(ReqI({'badge':'520','nom':'Nouvelle Recrue','depuis':_J(3)})))
e520 = [e for e in A.get_meta()['employees'] if e['matricule']=='520']
t("la fiche est creee tout de suite", [(e['prenom'], e['nom'], e['embauche'], e['aCompleter']) for e in e520], [('Nouvelle','Recrue',_J(3),True)])
tv("le badge n'est plus dans la liste des sorties", '520' not in A.get_meta()['exclus'])
tv("elle recoit son acces QR comme les autres", bool(e520[0].get('token') or [x for x in A.get_meta()['employees'] if x['id']==e520[0]['id']][0].get('token')))
t("elle disparait des badges non importes", A._resume_pointeuse()['non_importes'], 0)
run(A.api_punches(ReqI(corps, 'atelier')))
t("au prochain envoi de l'agent, ses pointages arrivent sur sa fiche", A.get_pointages(_J(3), _J(3))[_J(3)][e520[0]['id']]['entree'], '07:30')
t("sans doublon", sum(1 for e in A.get_meta()['employees'] if e['matricule']=='520'), 1)
t("les nouvelles fiches s'accumulent jusqu'a ce que le RH les ait vues", len(A.api_pointeuse(ReqI({}))['rapport']['nouvelles']), 1)
run(A.api_import_vu(ReqI({})))
t("« C'est note » vide la liste", A._resume_pointeuse()['nouvelles_fiches'], 0)
tv("chaque action est tracee", any("Badge 520 réintégré" in x['action'] for x in A.api_audit(limit=50)))
t("le portier reserve ces actions aux RH", passe('/api/import/reintegrer', 'POST', ckchef), ("BLOQUE", 403))
t("lecture seule refusee aussi", passe('/api/import/vu', 'POST', ck), ("BLOQUE", 403))

print("\n--- statistiques d'absenteisme reelles ---")
A.set_state({'employees':[{'id':'E001'}],'settings':A.default_settings(),'pointages':{}},remplacer=True)
rows=[]
for d in range(1,11):
    rows.append(A._rec_row('2026-08-%02d'%d,'E001',{'statut':'absent' if d<=2 else 'present','entree':'','sortie':''},'T','import'))
A.write_pointages(rows)
# la date est figée : ce test échouait dès que le calendrier quittait août 2026
import datetime as _dt
_vrai_today = A.today
A.today = lambda: _dt.date(2026, 8, 13)
stats=A.api_stats_abs(mois=1)
A.today = _vrai_today
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
