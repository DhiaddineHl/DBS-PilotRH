import sys, os, datetime, json
ICI=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,ICI)                    # doublures de test (fastapi, httpx...)
sys.path.insert(0,os.path.dirname(ICI))    # le projet
import mdb_import as M

ok=ko=0
def t(nom,got,exp):
    global ok,ko
    if got==exp: ok+=1
    else:
        ko+=1
        print("  ECHEC %s\n    attendu %r\n    obtenu  %r" % (nom,exp,got))

print("\n--- correction du sexe (les deux branches renvoyaient F) ---")
t("Gender='M' -> H", M._sexe('M'), 'H')
t("Gender='Male' -> H", M._sexe('Male'), 'H')
t("Gender='F' -> F", M._sexe('F'), 'F')
t("Gender vide -> F", M._sexe(''), 'F')
t("Gender=None -> F", M._sexe(None), 'F')

print("\n--- protection des corrections manuelles ---")
t("manuel", M._est_protege({'manuel':1}), True)
t("hM", M._est_protege({'hM':480}), True)
t("hsM (nouveau)", M._est_protege({'hsM':60}), True)
t("congé validé (nouveau)", M._est_protege({'src':'conge'}), True)
t("import simple non protégé", M._est_protege({'src':'import','statut':'present'}), False)
t("None", M._est_protege(None), False)

print("\n--- calendrier ---")
S = {'jours':{'0':{'actif':False},'1':{'actif':True,'debut':'07:30','fin':'16:30'},
              '6':{'actif':True,'debut':'07:30','fin':'13:00'}},
     'periodes':[], 'feriesActifs':True, 'feriesFixes':M.FERIES_FIXES, 'feries':[]}
t("dimanche 2026-08-09 non ouvré", M._regime(S,'2026-08-09').get('actif'), False)
t("lundi 2026-08-10 ouvré", M._regime(S,'2026-08-10').get('actif'), True)
t("samedi 2026-08-08 -> fin 13:00", M._regime(S,'2026-08-08').get('fin'), '13:00')
f = M._feries_set(S, {'2026-05-01','2026-08-11','2026-03-20','2026-01-01'})
t("fêtes fixes détectées", sorted(f), ['2026-01-01','2026-03-20','2026-05-01'])
S2=dict(S); S2['feries']=[{'date':'2026-08-12','nom':'Aid','jours':3}]
t("fête mobile sur 3 jours", sorted(M._feries_set(S2,{'2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15'})),
  ['2026-08-12','2026-08-13','2026-08-14'])
S3=dict(S); S3['feriesActifs']=False
t("fériés désactivés", M._feries_set(S3,{'2026-05-01'}), set())

print("\n--- fusion : ce que l'import écrase ou pas ---")
def etat():
    return {
      'employees':[{'id':'E001','matricule':'10','prenom':'A','nom':'Aa','actif':True},
                   {'id':'E002','matricule':'20','prenom':'B','nom':'Bb','actif':True}],
      'settings':S,'exclus':[],
      'pointages':{
        '2026-08-10':{'E001':{'statut':'present','entree':'09:00','sortie':'17:00','manuel':1},
                      'E002':{'statut':'leave','entree':'','sortie':'','src':'conge'}},
      }}
users={'10':{'badge':'10','nom':'Aa','prenom':'A','sexe':'F'},
       '20':{'badge':'20','nom':'Bb','prenom':'B','sexe':'F'}}
day_user={'2026-08-10':{'10':['07:31','16:33'],'20':['07:29','16:35']}}
s=M._merge_assembled(etat(),users,{'10','20'},day_user)
t("correction manuelle preservee", s['pointages']['2026-08-10']['E001'],
  {'statut':'present','entree':'09:00','sortie':'17:00','manuel':1})
t("congé validé preserve", s['pointages']['2026-08-10']['E002'],
  {'statut':'leave','entree':'','sortie':'','src':'conge'})

st=etat(); del st['pointages']['2026-08-10']
s=M._merge_assembled(st,users,{'10','20'},day_user)
t("sans protection : import applique", s['pointages']['2026-08-10']['E001'],
  {'statut':'present','entree':'07:31','sortie':'16:33','src':'import'})

print("\n--- férié : plus d'absences fantômes ---")
st=etat(); st['pointages']={}
s=M._merge_assembled(st,users,{'10','20'},{'2026-05-01':{'10':['08:00','12:00']}})
t("celle qui pointe le 01/05", s['pointages']['2026-05-01']['E001']['statut'], 'present')
t("celle qui ne pointe pas le 01/05 => ferie et non absent",
  s['pointages']['2026-05-01']['E002']['statut'], 'ferie')

st=etat(); st['pointages']={}
s=M._merge_assembled(st,users,{'10','20'},{'2026-08-11':{'10':['07:30','16:30']}})
t("un jour ouvré, l'absente reste absente", s['pointages']['2026-08-11']['E002']['statut'], 'absent')

st=etat(); st['pointages']={}
s=M._merge_assembled(st,users,{'10','20'},{'2026-08-09':{'10':['08:00','12:00']}})
t("dimanche : l'absente est en repos, pas absente", s['pointages']['2026-08-09']['E002']['statut'], 'repos')

print("\n--- mois clôturé intouchable ---")
st=etat(); st['settings']=dict(S); st['settings']['clotures']=['2026-08']
st['pointages']={}
s=M._merge_assembled(st,users,{'10','20'},day_user)
t("aucun pointage écrit sur un mois clos", s['pointages'].get('2026-08-10'), None)
t("compteur d'ignorés", s['_import_stats']['ignores_clos'], 1)

print("\n--- identifiants : plus de collision après suppression ---")
st={'employees':[{'id':'E001','matricule':'10'},{'id':'E003','matricule':'30'}],
    'settings':S,'exclus':[],'pointages':{}}
u2={'40':{'badge':'40','nom':'Dd','prenom':'D','sexe':'F'}}
s=M._merge_assembled(st,u2,{'40'},{'2026-08-10':{'40':['07:30','16:30']}})
ids=[e['id'] for e in s['employees']]
t("nouvel id = E004 (max+1), pas E003", ids, ['E001','E003','E004'])

print("\n--- démission : jamais réimportée ---")
st={'employees':[],'settings':S,'exclus':['10'],'pointages':{}}
s=M._merge_assembled(st,users,{'10','20'},day_user)
t("badge exclu absent de l'effectif", [e['matricule'] for e in s['employees']], ['20'])

print("\n=========================")
print("  %d réussis · %d échoués" % (ok,ko))
sys.exit(1 if ko else 0)
