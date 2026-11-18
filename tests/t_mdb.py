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

print("\n--- personnes enregistrées sur la pointeuse mais absentes de l'application ---")
TD = datetime.date.today()
def J(n): return (TD - datetime.timedelta(days=n)).isoformat()
def base(emps=None, **kw):
    s = {'employees': emps or [], 'settings': {'jours': {str(i): {'actif': True, 'debut': '07:30', 'fin': '16:30'} for i in range(7)},
                                               'periodes': [], 'feriesActifs': False, 'feries': []},
         'pointages': {}, 'exclus': []}
    s.update(kw); return s
def emp(id_, mat, nom='Nom', prenom='Prenom', **kw):
    e = {'id': id_, 'matricule': mat, 'cin': mat, 'nom': nom, 'prenom': prenom, 'actif': True}; e.update(kw); return e
def jour(b, n, e='07:30', s='16:30'): return [{'badge': b, 'dt': J(n) + ' ' + e + ':00'}, {'badge': b, 'dt': J(n) + ' ' + s + ':00'}]

# 1. enregistrée SANS nom sur la pointeuse (seulement un numéro)
s = M.merge_punches(base([emp('E001', '101')]), [{'badge': '101', 'name': 'Amel Ben'}, {'badge': '207', 'name': ''}],
                    jour('101', 3) + jour('207', 3) + jour('207', 2))
e207 = [e for e in s['employees'] if e['matricule'] == '207']
t("sans nom sur la pointeuse : la fiche est créée (avant : ignorée en silence)", len(e207), 1)
t("elle porte un nom provisoire lisible", (e207[0]['nom'], e207[0]['prenom']), ('Badge 207', ''))
t("elle est marquée « à compléter »", e207[0].get('aCompleter'), True)
t("ses pointages sont importés", s['pointages'][J(3)][e207[0]['id']]['entree'], '07:30')
st = s['_import_stats']
t("elle figure au rapport, signalée sans nom", [(x['badge'], x['sansNom'], x['jours']) for x in st['nouvelles']], [('207', True, 2)])

# 2. nouvelle recrue qui n'a badgé qu'UN jour
s = M.merge_punches(base([emp('E001', '101')]), [{'badge': '101', 'name': 'A B'}, {'badge': '310', 'name': 'Salma Trabelsi'}],
                    jour('101', 5) + jour('101', 1) + jour('310', 1))
e310 = [e for e in s['employees'] if e['matricule'] == '310']
t("recrue d'un seul jour : fiche créée (avant : il fallait 3 jours)", [(e['prenom'], e['nom']) for e in e310], [('Trabelsi', 'Salma')])  # « NOM Prénom » sur la pointeuse, comme avant
t("son premier jour est importé, pas perdu", s['pointages'][J(1)][e310[0]['id']]['statut'], 'present')
t("date d'embauche = premier badge, pas la date de l'import", e310[0]['embauche'], J(1))
t("elle n'est pas « absente » les jours d'avant son arrivée", e310[0]['id'] in s['pointages'][J(5)], False)
t("l'ancienne, elle, reste absente le jour où elle n'a pas badgé", s['pointages'][J(1)]['E001']['statut'], 'present')

# 3. fiche créée à la main AVANT que la personne ait 3 jours de badge
s = M.merge_punches(base([emp('E001', '101'), emp('E050', '412', 'Manuelle', 'Rim', embauche=J(2))]),
                    [{'badge': '101', 'name': 'A B'}, {'badge': '412', 'name': 'RIM M'}], jour('101', 2) + jour('412', 2))
t("fiche saisie à la main : ses pointages arrivent dès le premier jour (avant : perdus)", s['pointages'][J(2)]['E050']['entree'], '07:30')
t("aucune fiche en double", sum(1 for e in s['employees'] if e['matricule'] == '412'), 1)
t("le nom saisi à la main est conservé", s['employees'][1]['nom'], 'Manuelle')

# 4. zéros en tête : « 0412 » dans la fiche, « 412 » sur la pointeuse
s = M.merge_punches(base([emp('E050', '0412', 'Zero', 'Tete')]), [{'badge': '412', 'name': 'X Y'}], jour('412', 1))
t("« 0412 » et « 412 » sont la même personne (avant : doublon créé)", len(s['employees']), 1)
t("et ses pointages vont sur sa fiche", s['pointages'][J(1)]['E050']['statut'], 'present')
t("normalisation", [M.norm_badge(x) for x in ('0412', ' 412 ', '412', '0', '000', '', 'A12', None)], ['412', '412', '412', '0', '0', '', 'A12', ''])

# 5. badge d'une personne sortie, redonné à une nouvelle recrue
s = M.merge_punches(base([emp('E001', '101')], exclus=['520'], exclus_dates={'520': J(40)}),
                    [{'badge': '101', 'name': 'A B'}, {'badge': '520', 'name': 'Nouvelle Recrue'}],
                    jour('520', 60) + jour('520', 10) + jour('520', 9) + jour('101', 9))
st = s['_import_stats']
t("badge d'une sortie : jamais réimporté d'office (la démission reste respectée)", any(e['matricule'] == '520' for e in s['employees']), False)
ig = [x for x in st['ignores'] if x['badge'] == '520']
t("mais il est SIGNALÉ, avec la raison", [x['raison'] for x in ig], ['badge_sorti'])
t("avec la date de sortie et les jours badgés après", (ig[0]['sortie'], ig[0]['apres']), (J(40), 2))
s = M.merge_punches(base([emp('E001', '101')], exclus=['521'], exclus_dates={'521': J(5)}),
                    [{'badge': '521', 'name': 'Partie'}], jour('521', 30) + jour('521', 20))
t("badge d'une sortie sans badge après la sortie : rien à signaler", s['_import_stats']['ignores'], [])
s = M.merge_punches(base([emp('E001', '101')], exclus=['0522']), [{'badge': '522', 'name': 'X'}], jour('522', 3))
t("ancienne sortie sans date, qui badge encore : signalée aussi", [x['raison'] for x in s['_import_stats']['ignores']], ['badge_sorti'])

# 6. badge 0, et personnes parties depuis longtemps
s = M.merge_punches(base([emp('E001', '101')]), [{'badge': '0', 'name': 'Admin'}, {'badge': '777', 'name': 'Partie Depuis'}],
                    jour('0', 2) + jour('777', 400) + jour('777', 380))
st = s['_import_stats']
t("badge 0 (test) : ignoré mais nommé dans le rapport", [x['raison'] for x in st['ignores']], ['badge_zero'])
t("personne partie depuis plus de 5 mois, sans fiche : pas de fiche fantôme", any(e['matricule'] == '777' for e in s['employees']), False)
t("comptée dans le rapport", st['anciens'], 1)

# 7. un nom vide sur la pointeuse n'efface pas le nom de la fiche
s = M.merge_punches(base([emp('E001', '101', 'Gharbi', 'Ines')]), [{'badge': '101', 'name': ''}], jour('101', 1))
t("nom de la fiche conservé", (s['employees'][0]['prenom'], s['employees'][0]['nom']), ('Ines', 'Gharbi'))

# 8. fichier .mdb : USERINFO avec un nom vide
class FauxMdb:
    def __init__(self, p): pass
    def parse_table(self, n):
        if n == 'USERINFO':
            return {'USERID': [1, 2], 'Name': ['Amel Ben', None], 'Badgenumber': ['101', '208'], 'Gender': ['F', '']}
        return {'USERID': [1, 1, 2, 2], 'CHECKTIME': [J(1) + ' 07:30:00', J(1) + ' 16:30:00', J(1) + ' 07:31:00', J(1) + ' 16:29:00']}
vrai = M.AccessParser; M.AccessParser = FauxMdb
try:
    s = M.merge(base(), 'x.mdb')
finally:
    M.AccessParser = vrai
t("import .mdb : la personne sans nom dans USERINFO est importée", sorted(e['matricule'] for e in s['employees']), ['101', '208'])
t("avec ses pointages", s['pointages'][J(1)][[e for e in s['employees'] if e['matricule'] == '208'][0]['id']]['entree'], '07:31')

print("\n--- le bug vu en vrai : l'agent effaçait la journée apportée par le fichier .mdb ---")
emps = [emp('E%03d' % i, str(100 + i)) for i in range(1, 6)]
users = [{'badge': str(100 + i), 'name': 'NOM%d Prenom' % i} for i in range(1, 6)]
AUJ = J(0)
# 1) le fichier .mdb (logiciel ZKTeco) apporte la matinée de tout le monde
mdb = [{'badge': str(100 + i), 'dt': AUJ + ' 07:2%d:00' % i} for i in range(1, 6)]
s = M.merge_punches(base(emps), users, mdb)
t("après le .mdb : 5 présentes ce matin", sum(1 for r in s['pointages'][AUJ].values() if r['statut'] == 'present'), 5)
# 2) le logiciel a vidé la pointeuse ; l'agent ne lit plus que deux badges arrivés après
agent = [{'badge': '103', 'dt': AUJ + ' 12:00:00'}, {'badge': '105', 'dt': AUJ + ' 12:31:00'}]
s = M.merge_punches(s, users, agent, du=J(60))
jr = s['pointages'][AUJ]
t("après l'agent : les 5 sont TOUJOURS présentes (avant : 3 repassaient « absentes »)",
  sum(1 for r in jr.values() if r['statut'] == 'present'), 5)
t("l'entrée du matin apportée par le .mdb est conservée", jr['E001']['entree'], '07:21')
t("les badges de l'agent s'ajoutent à ceux du .mdb", (jr['E003']['entree'], jr['E003']['sortie']), ('07:23', '12:00'))
t("compté dans le rapport", s['_import_stats']['badges_conserves'] >= 3, True)
# 3) puis le .mdb du soir : ni doublon, ni perte
mdb2 = mdb + [{'badge': str(100 + i), 'dt': AUJ + ' 16:3%d:00' % i} for i in range(1, 6)]
s = M.merge_punches(s, users, mdb2)
jr = s['pointages'][AUJ]
t("le soir : la journée complète de chacune", [(jr['E00%d' % i]['entree'], jr['E00%d' % i]['sortie']) for i in (1, 3)], [('07:21', '16:31'), ('07:23', '16:33')])
t("les badges de midi de l'agent sont gardés au milieu", jr['E003'].get('punches'), ['07:23', '12:00', '16:33'])
t("réimporter la même chose ne change rien (pas de doublon)", M.merge_punches(s, users, mdb2)['pointages'][AUJ]['E003'].get('punches'), ['07:23', '12:00', '16:33'])
t("deux badges à moins de 5 minutes d'écart, venant de deux sources, ne comptent qu'une fois",
  M._fusion_badges(['07:30'], ['07:32', '16:30']), ['07:30', '16:30'])
# 4) une absence marquée par un import devient présence si un badge arrive ensuite
s = M.merge_punches(base(emps), users, [{'badge': '101', 'dt': AUJ + ' 07:30:00'}])
t("une personne non vue est d'abord « absente »", s['pointages'][AUJ]['E002']['statut'], 'absent')
s = M.merge_punches(s, users, [{'badge': '102', 'dt': AUJ + ' 08:05:00'}])
t("puis présente dès qu'un badge arrive", s['pointages'][AUJ]['E002']['statut'], 'present')
t("sans que l'autre ne repasse « absente »", s['pointages'][AUJ]['E001']['statut'], 'present')
# 5) les corrections manuelles restent intouchables
s['pointages'][AUJ]['E001'] = {'statut': 'present', 'entree': '07:30', 'sortie': '16:30', 'manuel': 1}
s = M.merge_punches(s, users, [{'badge': '101', 'dt': AUJ + ' 13:13:00'}])
t("une journée corrigée à la main n'est pas complétée par l'import", s['pointages'][AUJ]['E001'].get('punches'), None)
t("ni modifiée", (s['pointages'][AUJ]['E001']['entree'], s['pointages'][AUJ]['E001']['sortie']), ('07:30', '16:30'))

print("\n=========================")
print("  %d réussis · %d échoués" % (ok,ko))
sys.exit(1 if ko else 0)
