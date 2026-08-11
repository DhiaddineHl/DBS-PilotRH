import sys, os, json, tempfile, shutil, hashlib, sqlite3, subprocess
ICI=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,ICI); sys.path.insert(0,os.path.dirname(ICI))
DATA=tempfile.mkdtemp(prefix='pilotrh_pw_')
os.environ.update(PILOTRH_DATA=DATA, PILOTRH_SEED='0',
                  PILOTRH_ADMIN_PASSWORD='motdepasse-initial',
                  PILOTRH_SESSION_SECRET='s')
import app as A
ok=ko=0
def t(n,g,e):
    global ok,ko
    if g==e: ok+=1
    else: ko+=1; print("  ECHEC %s\n    attendu %r\n    obtenu  %r"%(n,e,g))
def tv(n,c,d=''):
    global ok,ko
    if c: ok+=1
    else: ko+=1; print("  ECHEC %s %s"%(n,d))

print("\n--- compatibilite des mots de passe de l'ancienne version ---")
# ce que produisait la v2 : sel$empreinte, 100 000 iterations
def hash_v2(pw, salt='abcd1234'):
    return salt+'$'+hashlib.pbkdf2_hmac('sha256',pw.encode(),salt.encode(),100000).hex()
ancien = hash_v2('MonMotDePasse2024')
tv("un mot de passe cree par la v2 est toujours accepte", A._check_pw('MonMotDePasse2024', ancien))
tv("un mauvais mot de passe reste refuse", not A._check_pw('autre', ancien))
tv("l'ancien format est detecte comme a renforcer", A._besoin_rehash(ancien))

nouveau = A._hash_pw('MonMotDePasse2024')
t("le nouveau format porte le nombre d'iterations", nouveau.count('$'), 2)
t("iterations enregistrees", int(nouveau.split('$')[1]), 210000)
tv("le nouveau format est accepte", A._check_pw('MonMotDePasse2024', nouveau))
tv("le nouveau format n'a plus besoin d'etre renforce", not A._besoin_rehash(nouveau))
tv("sel aleatoire a chaque hachage", A._hash_pw('x')!=A._hash_pw('x'))
tv("format invalide refuse sans planter", not A._check_pw('x','nimportequoi'))

print("\n--- renforcement transparent a la connexion ---")
A.set_meta_serveur({'users':[{'login':'rh1','nom':'RH','role':'rh','pass':hash_v2('AncienPass123')}]})
import asyncio
class Req:
    def __init__(self,body): self._b=body; self.cookies={}; self.headers={}
    def __getattr__(self,n): raise AttributeError(n)
    async def json(self): return self._b
Req.client=property(lambda s: type('c',(),{'host':'9.9.9.9'})())
Req.url=property(lambda s: type('u',(),{'scheme':'https'})())
r=asyncio.get_event_loop().run_until_complete(A.api_login(Req({'login':'rh1','password':'AncienPass123'})))
t("connexion reussie avec l'ancien hachage", getattr(r,'status_code',200), 200)
stocke=[u for u in A.get_meta()['users'] if u['login']=='rh1'][0]['pass']
t("le hachage a ete reecrit au format renforce", stocke.count('$'), 2)
tv("et le mot de passe fonctionne toujours", A._check_pw('AncienPass123', stocke))

print("\n--- reinitialisation par variable d'environnement ---")
A.RESET_ADMIN='NouveauAdmin2026'
A.reset_admin()
admin=[u for u in A.get_meta()['users'] if u['login']=='admin'][0]
tv("le mot de passe admin est bien remplace", A._check_pw('NouveauAdmin2026', admin['pass']))
tv("l'ancien ne fonctionne plus", not A._check_pw('motdepasse-initial', admin['pass']))
A.RESET_ADMIN='court'
avant=admin['pass']
A.reset_admin()
t("un mot de passe trop court est refuse",
  [u for u in A.get_meta()['users'] if u['login']=='admin'][0]['pass'], avant)
A.RESET_ADMIN=''

print("\n--- script de depannage hors ligne ---")
proj=os.path.dirname(ICI)
p=subprocess.run([sys.executable,os.path.join(proj,'reinit_admin.py'),'--data',DATA,'--liste'],
                 capture_output=True,text=True)
tv("--liste affiche les comptes", 'admin' in p.stdout and 'rh1' in p.stdout, p.stdout+p.stderr)
p=subprocess.run([sys.executable,os.path.join(proj,'reinit_admin.py'),'--data',DATA,
                  '--mot-de-passe','DepannageOK2026'],capture_output=True,text=True)
tv("le script s'execute", p.returncode==0, p.stdout+p.stderr)
c=sqlite3.connect(os.path.join(DATA,'pilotrh.db'))
meta=json.loads(c.execute("SELECT v FROM kv WHERE k='meta'").fetchone()[0]); c.close()
admin=[u for u in meta['users'] if u['login']=='admin'][0]
tv("le nouveau mot de passe est accepte par le serveur", A._check_pw('DepannageOK2026', admin['pass']))
p=subprocess.run([sys.executable,os.path.join(proj,'reinit_admin.py'),'--data','/inexistant',
                  '--mot-de-passe','x'],capture_output=True,text=True)
tv("dossier introuvable signale proprement", p.returncode==1 and 'introuvable' in p.stdout)
p=subprocess.run([sys.executable,os.path.join(proj,'reinit_admin.py'),'--data',DATA,
                  '--mot-de-passe','court'],capture_output=True,text=True)
tv("mot de passe trop court refuse par le script", p.returncode==1)

print("\n--- espace salarie : les codes a 4 chiffres deja distribues restent valides ---")
A.set_meta({'employees':[{'id':'E001','matricule':'10','prenom':'A','nom':'Aa','token':'JETON-V2','pin':'1234'}]})
A.ensure_tokens_persist()
e=A.get_meta()['employees'][0]
t("le code a 4 chiffres est conserve", e['pin'], '1234')
t("le jeton existant est conserve", e['token'], 'JETON-V2')
A.ensure_tokens_persist(); A.ensure_tokens_persist()
e=A.get_meta()['employees'][0]
tv("plusieurs redemarrages ne regenerent rien",
   e['pin']=='1234' and e['token']=='JETON-V2')

print("\n--- une carte QR deja distribuee ouvre encore l'espace salarie ---")
# C'est LE test qui compte pour les 97 cartes deja en circulation : le jeton de la
# carte et le code a 4 chiffres doivent suffire, sans reimpression.
A.set_meta({'employees':[{'id':'E001','matricule':'195','prenom':'A','nom':'Aa',
                          'token':'JETON-V2','pin':'1234','sexe':'F','categorie':'Ouvrier'}],
            'settings':A.default_settings()})
class ReqMe:
    client=type('c',(),{'host':'10.9.9.9'})()
    def __init__(self,b): self._b=b; self.cookies={}; self.headers={}
    async def json(self): return self._b
def me(body):
    A._PIN_FAILS.clear()
    return asyncio.get_event_loop().run_until_complete(A.api_me_post(ReqMe(body)))
rep=me({'t':'JETON-V2','pin':'1234'})
tv("carte v2 + code a 4 chiffres : acces accorde", isinstance(rep,dict) and bool(rep.get('matricule')),
   getattr(rep,'status_code',rep))
t("c'est bien la bonne salariee", rep.get('matricule') if isinstance(rep,dict) else None, '195')
t("mauvais code refuse", getattr(me({'t':'JETON-V2','pin':'9999'}),'status_code',None), 401)
t("jeton inconnu refuse", getattr(me({'t':'JETON-INEXISTANT','pin':'1234'}),'status_code',None), 401)
t("sans code : on demande le code", getattr(me({'t':'JETON-V2'}),'status_code',None), 401)
rep2=me({'t':'JETON-V2','pin':'1234'})
tv("le refus precedent ne bloque pas la vraie salariee", isinstance(rep2,dict) and bool(rep2.get('matricule')))
# ancienne forme GET, encore appelee par une page mise en cache sur un telephone
g=A.api_me(t='JETON-V2', pin='1234')
t("l'ancien appel GET repond sans casser", getattr(g,'status_code',None), 401)
tv("il demande simplement de repasser en POST", (getattr(g,'content',{}) or {}).get('post') is True)
src=open(os.path.join(os.path.dirname(ICI),'app.py'),encoding='utf-8').read()
tv("l'adresse imprimee sur les cartes est inchangee (/moi?t=JETON)", '"%s/moi?t=%s"' in src)
moi=open(os.path.join(os.path.dirname(ICI),'static','moi.html'),encoding='utf-8').read()
tv("le jeton est encore lu depuis l'adresse (le QR fonctionne)", "params.get('t')" in moi)
tv("le champ de code accepte 4 chiffres", 'maxlength="6"' in moi and 'minlength' not in moi)

print("\n=========================")
print("  %d réussis · %d échoués"%(ok,ko))
shutil.rmtree(DATA,ignore_errors=True)
sys.exit(1 if ko else 0)
