/* ============================================================================
   PilotRH — dossier disciplinaire et documents en arabe

   Chaque pièce (questionnaire, avertissement, mise à pied…) est rattachée à une
   personne, numérotée, datée, suivie (brouillon → remise → signée), et produit
   un document en arabe prérempli : identité, faits relevés dans le pointage,
   antécédents. L'historique complet se lit dans la fiche de la personne.

   Deux principes :
   * PilotRH prépare, il ne décide pas. Le texte reste modifiable avant
     impression, et les modèles eux-mêmes se personnalisent.
   * Ces modèles sont des bases de travail, pas un avis juridique : à faire
     relire une fois par le conseil de l'entreprise (mise à pied et conseil de
     discipline obéissent à la convention collective applicable).

   Réservé aux rôles Administrateur et RH — le serveur le vérifie aussi.
   ============================================================================ */
'use strict';
{
const C = window.PilotRHCore;
const { esc, escJs, pad } = C;

const TYPES = {
  questionnaire:{fr:'Questionnaire (demande d’explications)', ar:'استجواب', court:'Questionnaire'},
  observation:  {fr:'Lettre d’observation', ar:'لفت نظر', court:'Observation'},
  avertissement:{fr:'Avertissement', ar:'إنذار', court:'Avertissement'},
  blame:        {fr:'Blâme', ar:'توبيخ', court:'Blâme'},
  miseapied:    {fr:'Mise à pied', ar:'قرار إيقاف عن العمل', court:'Mise à pied'},
  reprise:      {fr:'Mise en demeure de reprendre le travail', ar:'تنبيه بوجوب الالتحاق بالعمل', court:'Mise en demeure'},
  convocation:  {fr:'Convocation au conseil de discipline', ar:'استدعاء للمثول أمام مجلس التأديب', court:'Convocation'},
  pv:           {fr:'Procès-verbal de constat', ar:'محضر معاينة', court:'PV de constat'},
};
const STATUTS = {brouillon:'Brouillon', remis:'Remis', signe:'Signé par l’intéressé(e)', refus:'Refus de signer', classe:'Classé sans suite'};
const STATUT_TAG = {brouillon:'t-neutral', remis:'t-late', signe:'t-present', refus:'t-absent', classe:'t-neutral'};
const MOTIFS = {
  retards:   {fr:'Retards répétés', ar:'التأخير المتكرّر عن مواعيد العمل'},
  absence:   {fr:'Absence injustifiée', ar:'الغياب عن العمل دون إذن أو مبرّر'},
  abandon:   {fr:'Abandon de poste', ar:'مغادرة مركز العمل دون إذن'},
  refus:     {fr:'Refus d’exécuter le travail demandé', ar:'رفض تنفيذ العمل المطلوب أو تعليمات المسؤول المباشر'},
  respect:   {fr:'Manque de respect', ar:'عدم احترام الرؤساء أو الزملاء في العمل'},
  qualite:   {fr:'Négligence, malfaçon', ar:'الإهمال في العمل وعدم احترام مواصفات الجودة'},
  telephone: {fr:'Usage du téléphone pendant le travail', ar:'استعمال الهاتف الجوّال أثناء العمل'},
  securite:  {fr:'Non-respect des consignes de sécurité', ar:'عدم احترام قواعد الصحّة والسلامة المهنية'},
  altercation:{fr:'Altercation', ar:'المشاركة في شجار داخل المؤسسة'},
  materiel:  {fr:'Détérioration de matériel', ar:'إتلاف معدّات أو موادّ على ملك المؤسسة'},
  reglement: {fr:'Non-respect du règlement intérieur', ar:'مخالفة أحكام النظام الداخلي للمؤسسة'},
  signature: {fr:'Refus de signer ou de recevoir un document', ar:'رفض الإمضاء على وثيقة إدارية أو رفض تسلّمها'},
  autre:     {fr:'Autre (à préciser dans les faits)', ar:''},
};
/* Intitulés de poste courants. Un poste absent de cette liste s'imprime tel qu'il est saisi
   dans la fiche — ou tel que le champ « posteAr » de la fiche l'indique. */
const POSTES_AR = {
  'Couturière piqueuse':'[عامل|عاملة] خياطة', 'Mécanicienne':'[عامل|عاملة] على آلة خياطة', 'Repasseuse':'[عامل|عاملة] كيّ',
  'Contrôleuse qualité':'[مراقب|مراقبة] جودة', 'Coupeuse':'[عامل|عاملة] قصّ', 'Finition main':'[عامل|عاملة] تشطيب',
  'Chef d’atelier':'[رئيس|رئيسة] ورشة', "Chef d'atelier":'[رئيس|رئيسة] ورشة', 'Agent de méthode':'[عون|عونة] طرق',
  'Préparatrice':'[عامل|عاملة] تحضير', 'Magasinier':'[أمين|أمينة] مخزن',
};
function atelierAr(a){ const m=String(a||'').match(/^Atelier\s+(.+)$/i); return m?'الورشة '+m[1]:(a||''); }
const MOIS_AR = ['جانفي','فيفري','مارس','أفريل','ماي','جوان','جويلية','أوت','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const JOURS_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

/* --- Modèles ---------------------------------------------------------------
   {variable} est remplacée ; [مذكر|مؤنث] choisit la forme selon le sexe de la
   personne ; une ligne dont toutes les variables sont vides est retirée.      */
const SUITE = 'ونلفت نظرك إلى أنّ تكرار مثل هذه المخالفات يعرّضك إلى عقوبات تأديبية أشدّ، طبقا لأحكام مجلّة الشغل والاتفاقية المشتركة القطاعية والنظام الداخلي للمؤسسة.';
const CONSTAT = '{suite}\nوحيث ثبت لدى إدارة المؤسسة بتاريخ {date_faits} ما يلي: {motif}.\n{faits}\n{antecedents}\nوحيث أنّ هذه الأفعال تمثّل إخلالا بواجباتك المهنية وبأحكام النظام الداخلي للمؤسسة،';
const MODELES = {
  questionnaire:
    'تبعا لما تمّت معاينته بتاريخ {date_faits}، والمتمثّل في: {motif}.\n{faits}\n'+
    'وحيث أنّ هذه الأفعال، إن ثبتت، تمثّل إخلالا بواجباتك المهنية وبأحكام النظام الداخلي للمؤسسة،\n'+
    'فإنّ إدارة المؤسسة تدعوك إلى تقديم توضيحاتك الكتابية حول ما نُسب إليك، وذلك في أجل أقصاه {delai} ساعة من تاريخ تسلّمك هذا الاستجواب.\n'+
    'ونعلمك أنّ عدم الإجابة في الأجل المحدّد يُعتبر تخلّيا عن حقّك في تقديم توضيحاتك، وتحتفظ الإدارة بحقّها في اتخاذ ما تراه مناسبا من إجراءات طبقا للتشريع الجاري به العمل.',
  observation:
    'لقد تمّت بتاريخ {date_faits} معاينة ما يلي: {motif}.\n{faits}\n'+
    'وعليه، فإنّ إدارة المؤسسة تلفت نظرك إلى ضرورة احترام واجباتك المهنية وأحكام النظام الداخلي، وتدعوك إلى تفادي تكرار مثل هذه التصرّفات مستقبلا.\n'+
    'ونأمل أن يكون هذا التنبيه كافيا دون الحاجة إلى اتخاذ إجراءات أخرى.',
  avertissement: CONSTAT+'\nلذا، قرّرت إدارة المؤسسة توجيه إنذار كتابي إليك يُدرج بملفّك الشخصي.\n'+SUITE,
  blame:         CONSTAT+'\nلذا، قرّرت إدارة المؤسسة توجيه توبيخ كتابي إليك يُدرج بملفّك الشخصي.\n'+SUITE,
  miseapied:     CONSTAT+'\nلذا، قرّرت إدارة المؤسسة إيقافك عن العمل لمدّة {jours} دون أجر، وذلك من يوم {du} إلى يوم {au} بدخول الغاية، على أن تستأنف عملك يوم {reprise}.\n'+SUITE,
  reprise:
    'لقد سجّلت إدارة المؤسسة تغيّبك عن العمل دون إذن مسبق ودون تقديم ما يبرّر ذلك منذ يوم {date_faits} وإلى غاية تاريخ هذا التنبيه.\n{faits}\n'+
    'وعليه، فإنّ إدارة المؤسسة تدعوك إلى الالتحاق بمركز عملك أو تقديم ما يبرّر غيابك في أجل أقصاه {delai} ساعة من تاريخ تسلّمك هذا التنبيه.\n'+
    'ونعلمك أنّه في صورة عدم الالتحاق بالعمل أو عدم تبرير الغياب في الأجل المذكور، تحتفظ الإدارة بحقّها في اتخاذ الإجراءات القانونية المترتّبة عن ذلك طبقا لأحكام مجلّة الشغل.',
  convocation:
    'تبعا لما نُسب إليك بتاريخ {date_faits}: {motif}.\n{faits}\n{antecedents}\n'+
    'نعلمك أنّه تقرّر عرض ملفّك على مجلس التأديب، وندعوك إلى الحضور أمامه يوم {du} على الساعة ............ بمقرّ المؤسسة.\n'+
    'ويمكنك الاطّلاع على ملفّك التأديبي، وتقديم دفاعك كتابيا أو شفاهيا، والاستعانة بمن تختاره للدفاع عنك طبقا للتراتيب الجاري بها العمل.',
  pv:
    'في يوم {date_faits}، نحن الممضين أسفله، نشهد بأنّه تمّت معاينة ما يلي بخصوص [السيد|السيدة] {nom}، رقم التسجيل {matricule}، {poste}:\n{motif}.\n{faits}\n'+
    'وقد حُرّر هذا المحضر لإثبات ما ذُكر والاستظهار به عند الاقتضاء.',
};
const AVEC_DELAI = ['questionnaire','reprise'], AVEC_JOURS = ['miseapied'], AVEC_DATE_CIBLE = ['miseapied','convocation'];
const DELAI_DEFAUT = {questionnaire:48, reprise:48};

let DISC = null;          // {entrees, societe, modeles}

/* --- petits outils de langue ------------------------------------------------ */
function dateAr(iso){ if(!iso) return '....................'; const [a,m,j]=iso.split('-').map(Number); return j+' '+MOIS_AR[m-1]+' '+a; }
function dateJourAr(iso){ if(!iso) return '....................'; return JOURS_AR[new Date(iso+'T12:00').getDay()]+' '+dateAr(iso); }
function dateNum(iso){ if(!iso) return ''; const [a,m,j]=iso.split('-'); return j+'/'+m+'/'+a; }
function joursAr(n){ n=+n||0; return n===1?'يوم واحد':n===2?'يومين':n<=10?n+' أيام':n+' يوما'; }
function foisAr(n){ n=+n||0; return n===1?'مناسبة واحدة':n===2?'مناسبتين':n<=10?n+' مناسبات':n+' مناسبة'; }
function genre(txt,femme){ return String(txt).replace(/\[([^\[\]|]*)\|([^\[\]|]*)\]/g,(_,m,f)=>femme?f:m); }

/* Texte des faits rédigé à partir du pointage : c'est le « prérempli ». */
function faitsDepuisEvenements(motif,evs,du,au){
  if(!evs||!evs.length) return '';
  if(motif==='retards'){
    return 'سُجّل تأخّرك عن موعد بداية العمل في '+foisAr(evs.length)+' خلال الفترة من '+dateNum(du)+' إلى '+dateNum(au)+'، وذلك في التواريخ التالية:\n'+
      evs.map(v=>'- '+JOURS_AR[new Date(v.ds+'T12:00').getDay()]+' '+dateNum(v.ds)+': الحضور على الساعة '+(v.heure||'--:--')+' (تأخير بـ '+v.min+' دقيقة)').join('\n');
  }
  if(motif==='absence'){
    return 'سُجّل غيابك عن العمل دون إذن أو مبرّر لمدّة '+joursAr(evs.length)+' خلال الفترة من '+dateNum(du)+' إلى '+dateNum(au)+'، وذلك في التواريخ التالية:\n'+
      evs.map(v=>'- '+JOURS_AR[new Date(v.ds+'T12:00').getDay()]+' '+dateNum(v.ds)).join('\n');
  }
  return '';
}
function antecedentsAr(en){
  const il=(DISC.entrees||[]).filter(x=>x.emp===en.emp&&x.id!==en.id&&x.date<=en.date&&['avertissement','blame','miseapied','observation'].includes(x.type)&&x.statut!=='brouillon'&&x.statut!=='classe')
    .sort((a,b)=>a.date<b.date?-1:1);
  if(!il.length) return '';
  return 'علما وأنّه سبق أن وُجّه إليك: '+il.map(x=>TYPES[x.type].ar+' عدد '+x.ref+' بتاريخ '+dateNum(x.date)).join('، ')+'.';
}
function suiteAr(en){
  const q=(DISC.entrees||[]).find(x=>x.id===en.suite_de); if(!q) return '';
  const tete='تبعا لل'+TYPES[q.type].ar+' عدد '+q.ref+' الموجّه إليك بتاريخ '+dateNum(q.date)+'، ';
  return tete+((q.reponse||'').trim()?'وبعد الاطّلاع على إجابتك التي لم تتضمّن ما يبرّر ما نُسب إليك،':'والذي بقي دون ردّ في الأجل المحدّد،');
}
function finMiseAPied(du,jours){
  /* N jours OUVRÉS à partir de « du » ; la reprise est le jour ouvré suivant */
  if(!du||!jours) return {au:'',reprise:''};
  let d=du, n=0, au=du, garde=0;
  while(n<jours&&garde++<90){ if(estOuvre(d)){n++; au=d} d=addDays(d,1); }
  while(!estOuvre(d)&&garde++<120) d=addDays(d,1);
  return {au,reprise:d};
}
function variables(en){
  const e=emp(en.emp), femme=e.sexe!=='H', so=DISC.societe||{};
  const mp=finMiseAPied(en.du,en.jours);
  const m=MOTIFS[en.motif]||{};
  return {femme, v:{
    nom:(e.nomAr||'').trim()||((e.prenom||'')+' '+(e.nom||'')).trim(), matricule:matOf(e), cin:e.cin&&e.cin!==matOf(e)?e.cin:'', poste:e.posteAr||(POSTES_AR[e.poste]?genre(POSTES_AR[e.poste],femme):(e.poste||'')),
    atelier:atelierAr(e.atelier), societe:so.nomAr||so.nom||'', ville:so.villeAr||so.ville||'', ref:en.ref||'',
    date:dateAr(en.date), date_faits:dateAr(en.date_faits||en.date), motif:m.ar||'', faits:(en.faits||'').trim(),
    delai:en.delai_h||DELAI_DEFAUT[en.type]||48, jours:joursAr(en.jours), du:en.du?dateJourAr(en.du):'', au:(en.au||mp.au)?dateJourAr(en.au||mp.au):'',
    reprise:mp.reprise?dateJourAr(mp.reprise):'', antecedents:antecedentsAr(en), suite:suiteAr(en)}};
}
/* Corps du document à partir du modèle (celui de l'entreprise s'il a été personnalisé). */
function corpsDepuisModele(en){
  const {femme,v}=variables(en);
  const modele=(DISC.modeles||{})[en.type]||MODELES[en.type]||'';
  return genre(modele,femme).split('\n').map(l=>{
    const vars=[...l.matchAll(/\{(\w+)\}/g)].map(x=>x[1]);
    const rempli=l.replace(/\{(\w+)\}/g,(_,k)=>v[k]!=null?String(v[k]):'');
    /* une ligne faite uniquement de variables restées vides disparaît */
    if(vars.length && vars.every(k=>!String(v[k]==null?'':v[k]).trim()) && !l.replace(/\{\w+\}/g,'').replace(/[\s.،:]/g,'')) return null;
    return rempli.replace(/: \./g,'.').replace(/ +/g,' ');
  }).filter(l=>l!==null&&l.trim()!=='').join('\n');
}
function h(s){ return esc(s==null?'':s); }
/* Le document complet, prêt à imprimer (A4, droite à gauche). */
function discHtml(en,apercu){
  const {femme,v}=variables(en), so=DISC.societe||{}, t=TYPES[en.type];
  const corps=(en.corps||'').trim()||corpsDepuisModele(en);
  const paras=corps.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>
    l.startsWith('- ')?'<div class="puce">'+h(l.slice(2))+'</div>':'<p>'+h(l)+'</p>').join('');
  const pv=en.type==='pv';
  const lignes=n=>Array.from({length:n},()=>'<div class="ligne"></div>').join('');
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+h(t.ar+' '+(en.ref||''))+'</title><style>'+
    '@page{size:A4;margin:13mm 15mm}*{box-sizing:border-box}'+
    'body{font-family:"Amiri","Noto Naskh Arabic","Traditional Arabic","Sakkal Majalla","Segoe UI",Tahoma,Arial,sans-serif;font-size:13pt;line-height:1.72;color:#000;margin:0;direction:rtl}'+
    '.tete{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px;line-height:1.45}'+
    '.tete .ar{text-align:right;font-weight:700;font-size:15pt}.tete .fr{text-align:left;direction:ltr;font-family:Georgia,"Times New Roman",serif;font-size:11pt}'+
    '.tete small{display:block;font-weight:400;font-size:10.5pt}'+
    '.lieu{display:flex;justify-content:space-between;font-size:12.5pt;margin-bottom:6px}'+
    'h1{text-align:center;font-size:18pt;margin:8px 0 10px;text-decoration:underline;text-underline-offset:6px}'+
    '.dest{border:1px solid #000;padding:4px 12px;margin-bottom:10px;line-height:1.6;font-size:12.5pt}.dest b{display:inline-block;min-width:38mm}'+
    'p{margin:0 0 4px;text-align:justify}.puce{padding-right:10mm;line-height:1.55}'+
    '.rep{margin-top:6px;page-break-inside:avoid}.ligne{border-bottom:1px dotted #000;height:8mm}'+
    '.sig{display:flex;justify-content:space-between;gap:16px;margin-top:12px;page-break-inside:avoid;font-size:12pt;line-height:1.5}'+
    '.sig>div{flex:1;text-align:center}.sig .cadre{height:20mm}.sig small{font-size:10.5pt;display:block}'+
    '.pied{margin-top:12px;font-size:10.5pt;border-top:1px solid #999;padding-top:4px;line-height:1.5;page-break-inside:avoid}'+
    '.ltr{direction:ltr;unicode-bidi:embed;display:inline-block}'+
    '@media screen{body{background:#eee}.page{background:#fff;width:210mm;min-height:297mm;margin:10px auto;padding:13mm 15mm;box-shadow:0 1px 8px rgba(0,0,0,.2)}}'+
    (apercu?'html{zoom:.5}':'')+'</style></head><body><div class="page">'+
    '<div class="tete"><div class="ar">'+h(so.nomAr||so.nom||'')+'<small>'+h(so.adresseAr||'')+'</small></div>'+
      '<div class="fr"><b>'+h(so.nom||'')+'</b><small>'+h(so.adresse||'')+'</small>'+(so.mf?'<small>MF : '+h(so.mf)+'</small>':'')+'</div></div>'+
    '<div class="lieu"><span>عدد: <span class="ltr">'+h(en.ref||'........')+'</span></span><span>'+h(v.ville||'............')+' في '+h(v.date)+'</span></div>'+
    '<h1>'+h(t.ar)+'</h1>'+
    (pv?'':'<div class="dest">'+
      '<div><b>إلى '+(femme?'السيدة':'السيد')+':</b> '+h(v.nom)+'</div>'+
      '<div><b>رقم التسجيل:</b> <span class="ltr">'+h(v.matricule)+'</span>'+(v.cin?' &nbsp;—&nbsp; <b style="min-width:0">ب.ت.و عدد:</b> <span class="ltr">'+h(v.cin)+'</span>':'')+'</div>'+
      (v.poste||v.atelier?'<div><b>الخطّة:</b> '+h(v.poste)+(v.atelier?' — '+h(v.atelier):'')+'</div>':'')+'</div>')+
    paras+
    (en.type==='questionnaire'?'<div class="rep"><p><b>جواب '+(femme?'المعنية':'المعني')+' بالأمر:</b></p>'+lignes(5)+
      '<p style="margin-top:8px">التاريخ: ..................... &nbsp;&nbsp; الإمضاء: .....................</p></div>':'')+
    (pv
      ?'<div class="sig"><div>الشاهد الأول<small>الاسم واللقب والإمضاء</small><div class="cadre"></div></div>'+
        '<div>الشاهد الثاني<small>الاسم واللقب والإمضاء</small><div class="cadre"></div></div>'+
        '<div>عن الإدارة<small>'+h(so.representantAr||so.representant||'')+'</small><div class="cadre"></div></div></div>'
      :'<div class="sig"><div>إمضاء '+(femme?'المعنية':'المعني')+' بالأمر<small>(اطّلعتُ وتسلّمتُ نسخة بتاريخ ..................)</small><div class="cadre"></div></div>'+
        '<div>عن الإدارة<small>'+h(so.qualiteAr||'المدير')+(so.representantAr||so.representant?' — '+h(so.representantAr||so.representant):'')+'</small><div class="cadre"></div></div></div>'+
       '<div class="pied">في صورة رفض الإمضاء أو التسلّم — شاهدان (الاسم واللقب والإمضاء): &nbsp; 1) ............................................ &nbsp; 2) ............................................</div>')+
    '</div></body></html>';
}
function discImprimerHtml(html){
  const vieux=document.getElementById('discCadre'); if(vieux) vieux.remove();
  const f=document.createElement('iframe'); f.id='discCadre';
  f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  f.srcdoc=html;
  f.onload=()=>{ try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(e){ toast('Impression impossible : '+e.message,'err') } };
}

/* --- données ---------------------------------------------------------------- */
async function discCharger(force){
  if(DISC&&!force) return DISC;
  try{ DISC=await api('/api/discipline'); }
  catch(e){ DISC={entrees:[],societe:{},modeles:{},erreur:e.message}; }
  return DISC;
}
function discDe(id){ return (DISC.entrees||[]).filter(x=>x.emp===id).sort((a,b)=>a.date<b.date?1:(a.date>b.date?-1:(a.ref<b.ref?1:-1))); }
function conseil(id,type){
  const l=discDe(id), an=addDays(TODAY,-365), rec=l.filter(x=>x.date>=an&&x.statut!=='classe');
  const nb=t=>rec.filter(x=>x.type===t&&x.statut!=='brouillon').length;
  const qAttente=rec.filter(x=>x.type==='questionnaire'&&x.statut!=='brouillon'&&!(x.reponse||'').trim()&&!l.some(y=>y.suite_de===x.id));
  const out=[];
  if(!rec.length) out.push('Aucune pièce sur les 12 derniers mois. L’usage est de commencer par un <b>questionnaire</b> (استجواب) : il recueille les explications de la personne avant toute sanction.');
  else out.push('Sur 12 mois : '+['questionnaire','observation','avertissement','blame','miseapied'].filter(t=>nb(t)).map(t=>nb(t)+' '+TYPES[t].court.toLowerCase()+(nb(t)>1?'s':'')).join(', ')+'.');
  if(qAttente.length) out.push('Le questionnaire <b>'+esc(qAttente[0].ref)+'</b> du '+fmtDate(qAttente[0].date)+' n’a ni réponse enregistrée ni suite.');
  if(['avertissement','blame','miseapied'].includes(type)&&!l.some(x=>x.type==='questionnaire'&&x.date>=addDays(TODAY,-60)))
    out.push('Aucun questionnaire récent : une sanction sans avoir demandé d’explications est plus fragile en cas de contestation.');
  if(type==='miseapied'||type==='convocation') out.push('La mise à pied et le conseil de discipline suivent la convention collective applicable (durée, procédure) : à valider avec votre conseil.');
  return out;
}

/* --- vue liste -------------------------------------------------------------- */
let DI_Q='', DI_TYPE='', DI_STATUT='';
VUES.discipline = async function(main){
  if(!peutDisc()){ main.innerHTML=topbar('Personnel','Dossiers disciplinaires','')+'<div class="page view"><div class="empty">'+I.lock+'<div>Réservé aux rôles Administrateur et RH</div></div></div>'; return; }
  await discCharger(true);
  const an=addDays(TODAY,-365), l=DISC.entrees||[], rec=l.filter(x=>x.date>=an);
  const attente=l.filter(x=>x.type==='questionnaire'&&x.statut!=='brouillon'&&x.statut!=='classe'&&!(x.reponse||'').trim()&&!l.some(y=>y.suite_de===x.id)).length;
  main.innerHTML=topbar('Personnel','Dossiers disciplinaires',
    '<button class="btn btn-ghost" onclick="discReglages()">'+I.gear+' En-tête et modèles</button>'+
    '<button class="btn btn-ghost" onclick="csvDiscipline()">'+I.download+' CSV</button>'+
    '<button class="btn btn-gold" onclick="discNouveau()">'+I.plus+' Nouvelle pièce</button>')+
  '<div class="page view">'+
    (DISC.erreur?'<div class="banner banner-err">'+I.warn+'<div class="grow">'+esc(DISC.erreur)+'</div></div>':'')+
    (!(DISC.societe||{}).nomAr?'<div class="banner banner-warn" style="margin-bottom:14px">'+I.warn+'<div class="grow"><b>L’en-tête de la société n’est pas renseigné.</b> '+
      'Les documents sortiront sans nom d’entreprise en arabe.</div><button class="btn btn-ghost" onclick="discReglages()">Renseigner</button></div>':'')+
    '<div class="kpis" style="grid-template-columns:repeat(4,1fr)">'+
      kpi('Pièces sur 12 mois',rec.length,new Set(rec.map(x=>x.emp)).size+' personne(s)',I.doc,'var(--ink)','#eae5d9')+
      kpi('Questionnaires sans réponse',attente,'remis, ni réponse ni suite',I.late,'var(--late)','var(--late-bg)')+
      kpi('Avertissements et blâmes',rec.filter(x=>['avertissement','blame'].includes(x.type)).length,'sur 12 mois',I.warn,'var(--absent)','var(--absent-bg)')+
      kpi('Mises à pied',rec.filter(x=>x.type==='miseapied').length,'sur 12 mois',I.calx,'var(--absent)','var(--absent-bg)')+'</div>'+
    '<div class="card tablecard"><div class="table-head">'+I.doc+'<h3>Toutes les pièces</h3><div class="spacer"></div>'+
      '<div class="field"><label for="diType" class="sr-only">Type</label><select id="diType" onchange="DI_TYPE=this.value;fillDiscipline()"><option value="">Tous les types</option>'+
        Object.keys(TYPES).map(k=>'<option value="'+k+'"'+(DI_TYPE===k?' selected':'')+'>'+esc(TYPES[k].court)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="diSt" class="sr-only">Statut</label><select id="diSt" onchange="DI_STATUT=this.value;fillDiscipline()"><option value="">Tous les statuts</option>'+
        Object.keys(STATUTS).map(k=>'<option value="'+k+'"'+(DI_STATUT===k?' selected':'')+'>'+esc(STATUTS[k])+'</option>').join('')+'</select></div>'+
      '<div class="field">'+I.search+'<label for="diQ" class="sr-only">Recherche</label><input id="diQ" type="search" value="'+esc(DI_Q)+'" placeholder="Nom, matricule, référence…" oninput="DI_Q=this.value;fillDiscipline()"></div></div>'+
      '<div class="tblwrap"><table class="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Mat.</th><th>Employée</th><th>Pièce</th><th>Motif</th><th>Statut</th><th></th></tr></thead>'+
      '<tbody id="diBody"></tbody></table></div></div>'+
    '<div class="hint" style="margin-top:12px">Les modèles sont des bases de travail à faire relire par votre conseil juridique. PilotRH prépare les documents et garde l’historique ; il ne décide d’aucune sanction.</div>'+
  '</div>';
  fillDiscipline();
};
function diLignes(){
  const q=DI_Q.toLowerCase();
  return (DISC.entrees||[]).filter(x=>{const e=emp(x.emp);
    return (!DI_TYPE||x.type===DI_TYPE)&&(!DI_STATUT||x.statut===DI_STATUT)&&
      (!q||((e.prenom||'')+' '+(e.nom||'')+' '+matOf(e)+' '+(x.ref||'')).toLowerCase().includes(q))})
    .sort((a,b)=>a.date<b.date?1:(a.date>b.date?-1:0));
}
function ligneDisc(x,sansNom){
  return '<tr data-disc="'+esc(x.id)+'"><td class="mono">'+esc(x.ref||'')+'</td><td class="mono">'+fmtDate(x.date)+'</td>'+
    (sansNom?'':'<td class="mono">'+esc(matOf(emp(x.emp)))+'</td><td>'+empCell(x.emp,true)+'</td>')+
    '<td>'+esc((TYPES[x.type]||{}).court||x.type)+(x.type==='miseapied'&&x.jours?' · '+x.jours+' j':'')+
      ' <span lang="ar" dir="rtl" style="color:var(--muted);font-size:12px">'+esc((TYPES[x.type]||{}).ar||'')+'</span></td>'+
    '<td style="color:var(--muted);font-size:12.5px">'+esc((MOTIFS[x.motif]||{}).fr||'')+'</td>'+
    '<td><span class="tag '+(STATUT_TAG[x.statut]||'t-neutral')+'">'+esc(STATUTS[x.statut]||x.statut)+'</span></td>'+
    '<td style="white-space:nowrap"><button class="linkish" onclick="discEditer(\''+escJs(x.id)+'\')">Ouvrir</button> · '+
      '<button class="linkish" onclick="discImprimer(\''+escJs(x.id)+'\')">Imprimer</button></td></tr>';
}
function fillDiscipline(){
  const tb=$('#diBody'); if(!tb) return;
  tb.innerHTML=diLignes().map(x=>ligneDisc(x)).join('')||
    '<tr><td colspan="8"><div class="empty">'+I.doc+'<div>Aucune pièce. « Nouvelle pièce » pour préparer un questionnaire ou un avertissement.</div></div></td></tr>';
}
function csvDiscipline(){
  const out=[['Dossiers disciplinaires'],['Exporté le',TODAY],[],
    ['Référence','Date','Matricule','Nom','Prénom','Service','Pièce','Motif','Date des faits','Jours de mise à pied','Statut','Remis le','Réponse enregistrée','Créé par']];
  diLignes().forEach(x=>{const e=emp(x.emp);
    out.push([x.ref,x.date,matOf(e),e.nom||'',e.prenom||'',e.service||'',(TYPES[x.type]||{}).court||x.type,(MOTIFS[x.motif]||{}).fr||'',x.date_faits||'',
      x.type==='miseapied'?x.jours:'',STATUTS[x.statut]||x.statut,x.remis_le||'',(x.reponse||'').trim()?'oui':'non',x.cree_par||''])});
  csvDL('dossiers_disciplinaires_'+TODAY+'.csv',out); toast('Dossiers exportés');
}
function peutDisc(){ return ['admin','rh'].includes(ME.role); }

/* --- fiche de la personne : son historique ---------------------------------- */
async function discProfil(id){
  const box=document.getElementById('discProfil'); if(!box||!peutDisc()) return;
  await discCharger();
  if(!document.getElementById('discProfil')) return;
  const l=discDe(id);
  box.innerHTML='<h4>Dossier disciplinaire'+(l.length?' ('+l.length+')':'')+'</h4>'+
    '<div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">'+conseil(id,'')[0]+'</div>'+
    (l.length?'<div class="tblwrap" style="margin-bottom:10px"><table class="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Pièce</th><th>Motif</th><th>Statut</th><th></th></tr></thead><tbody>'+
      l.map(x=>ligneDisc(x,true)).join('')+'</tbody></table></div>':'')+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-ghost" onclick="discNouveau(\''+escJs(id)+'\',\'questionnaire\')">'+I.plus+' Questionnaire</button>'+
      '<button class="btn btn-ghost" onclick="discNouveau(\''+escJs(id)+'\',\'avertissement\')">'+I.plus+' Avertissement</button>'+
      '<button class="btn btn-ghost" onclick="discNouveau(\''+escJs(id)+'\')">'+I.plus+' Autre pièce…</button></div>';
}

/* --- création / modification ------------------------------------------------ */
let EN=null, EN_CTX=null, CORPS_MODIFIE=false;
async function discNouveau(id,type,ctx){
  if(!peutDisc()){ toast('Réservé aux RH','warn'); return; }
  await discCharger();
  type=type||'questionnaire'; ctx=ctx||{};
  EN={id:'',emp:id||'',type,date:TODAY,statut:'brouillon',motif:ctx.motif||'',date_faits:'',faits:'',corps:'',reponse:'',note:'',
      jours:type==='miseapied'?1:0,du:'',au:'',delai_h:DELAI_DEFAUT[type]||0,suite_de:'',remis_le:''};
  EN_CTX=ctx; CORPS_MODIFIE=false;
  if(ctx.evenements&&ctx.evenements.length){
    EN.faits=faitsDepuisEvenements(ctx.motif,ctx.evenements,ctx.du,ctx.au);
    EN.date_faits=ctx.evenements[ctx.evenements.length-1].ds;
  }
  discFormulaire();
}
async function discEditer(id){
  await discCharger();
  const x=(DISC.entrees||[]).find(y=>y.id===id); if(!x){ toast('Pièce introuvable','warn'); return; }
  EN=JSON.parse(JSON.stringify(x)); EN_CTX={};
  /* une pièce déjà remise garde son texte tel qu'il a été imprimé, même si le modèle a changé depuis */
  CORPS_MODIFIE=!!(x.corps||'').trim() && (x.statut!=='brouillon' || x.corps.trim()!==corpsDepuisModele(x).trim());
  discFormulaire();
}
function champ(l,id,html,large){ return '<div'+(large?' style="grid-column:1/-1"':'')+'><label class="fldlab" for="'+id+'">'+l+'</label>'+html+'</div>'; }
function discFormulaire(){
  const e=EN.emp?emp(EN.emp):null, verrou=!!EN.id;
  const qs=EN.emp?discDe(EN.emp).filter(x=>['questionnaire','reprise'].includes(x.type)&&x.id!==EN.id):[];
  const sel=(id,opts,val,on)=>'<select class="fldin" id="'+id+'" onchange="'+on+'">'+opts.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===val?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>';
  openModal('<div class="modal-head">'+I.doc+'<h3>'+(EN.id?esc(EN.ref)+' — ':'Nouvelle pièce — ')+esc(TYPES[EN.type].court)+'</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body" id="discForm">'+
    '<div id="discConseil"></div>'+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">'+
      champ('Salarié(e)','dEmp',verrou
        ?'<input class="fldin" id="dEmp" disabled value="'+esc(empName(EN.emp)+' · '+matOf(e))+'">'
        :sel('dEmp',[['','— choisir —']].concat(DB.employees.slice().sort((a,b)=>((a.nom||'')+(a.prenom||'')).localeCompare((b.nom||'')+(b.prenom||''))).map(x=>[x.id,(x.nom||'')+' '+(x.prenom||'')+' · '+matOf(x)])),EN.emp,'discChamp(\'emp\',this.value,1)'))+
      champ('Pièce','dType',verrou?'<input class="fldin" id="dType" disabled value="'+esc(TYPES[EN.type].fr)+'">'
        :sel('dType',Object.keys(TYPES).map(k=>[k,TYPES[k].fr]),EN.type,'discChamp(\'type\',this.value,1)'))+
      champ('Date du document','dDate','<input class="fldin" type="date" id="dDate" value="'+esc(EN.date)+'" onchange="discChamp(\'date\',this.value)">')+
      champ('Motif','dMotif',sel('dMotif',[['','— choisir —']].concat(Object.keys(MOTIFS).map(k=>[k,MOTIFS[k].fr])),EN.motif,'discChamp(\'motif\',this.value)'))+
      champ('Date des faits','dFaitsLe','<input class="fldin" type="date" id="dFaitsLe" value="'+esc(EN.date_faits||'')+'" onchange="discChamp(\'date_faits\',this.value)">')+
      (AVEC_DELAI.includes(EN.type)?champ('Délai de réponse (heures)','dDelai','<input class="fldin" type="number" id="dDelai" min="0" max="240" value="'+(+EN.delai_h||48)+'" onchange="discChamp(\'delai_h\',+this.value)">'):'')+
      (AVEC_JOURS.includes(EN.type)?champ('Durée (jours ouvrés)','dJours','<input class="fldin" type="number" id="dJours" min="1" max="30" value="'+(+EN.jours||1)+'" onchange="discChamp(\'jours\',+this.value)">'):'')+
      (AVEC_DATE_CIBLE.includes(EN.type)?champ(EN.type==='miseapied'?'À compter du':'Date de la séance','dDu','<input class="fldin" type="date" id="dDu" value="'+esc(EN.du||'')+'" onchange="discChamp(\'du\',this.value)">'):'')+
      (['avertissement','blame','miseapied','convocation','observation'].includes(EN.type)?champ('Fait suite à','dSuite',
        sel('dSuite',[['','— aucun questionnaire —']].concat(qs.map(x=>[x.id,x.ref+' du '+fmtDate(x.date)+((x.reponse||'').trim()?' (réponse reçue)':' (sans réponse)')])),EN.suite_de||'','discChamp(\'suite_de\',this.value)')):'')+
      (e?champ('Nom et prénom en arabe <span style="font-weight:400;color:var(--muted)">(enregistré dans la fiche)</span>','dNomAr',
        '<input class="fldin" id="dNomAr" dir="rtl" lang="ar" value="'+esc(e.nomAr||'')+'" placeholder="'+esc((e.prenom||'')+' '+(e.nom||''))+'" onchange="discNomAr(this.value)">'):'')+
      champ('Faits <span style="font-weight:400;color:var(--muted)">(repris tels quels dans le document)</span>'+
          (e&&['retards','absence'].includes(EN.motif)?' · <button type="button" class="linkish" onclick="discFaitsPointage()">Remplir depuis le pointage (60 derniers jours)</button>':''),'dFaits',
        '<textarea class="fldin" id="dFaits" dir="auto" rows="4" style="font-size:14px;line-height:1.7" oninput="discChamp(\'faits\',this.value)">'+esc(EN.faits||'')+'</textarea>',true)+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">'+
      '<div><label class="fldlab" for="dCorps">Texte du document <span style="font-weight:400;color:var(--muted)">(modifiable)</span> · '+
        '<button type="button" class="linkish" onclick="discRegenerer()">Reprendre le modèle</button></label>'+
        '<textarea class="fldin" id="dCorps" dir="rtl" lang="ar" rows="15" style="font-size:15px;line-height:1.9;font-family:\'Amiri\',\'Noto Naskh Arabic\',\'Segoe UI\',Tahoma,Arial" oninput="discCorps(this.value)"></textarea></div>'+
      '<div><div class="fldlab">Aperçu</div><iframe id="discApercu" title="Aperçu du document" style="width:100%;height:372px;border:1px solid var(--line);border-radius:8px;background:#eee"></iframe></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px">'+
      champ('Statut','dStatut',sel('dStatut',Object.keys(STATUTS).map(k=>[k,STATUTS[k]]),EN.statut,'discChamp(\'statut\',this.value)'))+
      champ('Remis le','dRemis','<input class="fldin" type="date" id="dRemis" value="'+esc(EN.remis_le||'')+'" onchange="discChamp(\'remis_le\',this.value)">')+
      champ('Note interne (non imprimée)','dNote','<input class="fldin" id="dNote" value="'+esc(EN.note||'')+'" oninput="discChamp(\'note\',this.value)">')+
      (['questionnaire','reprise'].includes(EN.type)?champ('Réponse de l’intéressé(e) <span style="font-weight:400;color:var(--muted)">(à saisir quand elle revient)</span>','dRep',
        '<textarea class="fldin" id="dRep" dir="auto" rows="3" oninput="discChamp(\'reponse\',this.value)">'+esc(EN.reponse||'')+'</textarea>',true):'')+
    '</div>'+
  '</div><div class="modal-foot">'+
    (EN.id?'<button class="btn btn-danger" style="margin-right:auto" onclick="discSupprimer()">Supprimer</button>':'')+
    '<button class="btn btn-ghost" onclick="closeModal()">Fermer</button>'+
    (EN.id&&['questionnaire','reprise'].includes(EN.type)?'<button class="btn btn-ghost" onclick="discSuite()">Donner une suite…</button>':'')+
    '<button class="btn btn-ghost" onclick="discEnregistrer(false,true)">'+I.download+' Enregistrer et imprimer</button>'+
    '<button class="btn btn-gold" id="discOk" onclick="discEnregistrer()">'+I.check+' Enregistrer</button></div>','wide');
  discRafraichir(true);
}
function discRafraichir(initial){
  const c=$('#discConseil');
  if(c) c.innerHTML=EN.emp?'<div class="banner banner-info" style="margin:0 0 12px">'+I.warn+'<div class="grow">'+conseil(EN.emp,EN.type).join('<br>')+'</div></div>':'';
  const ta=$('#dCorps');
  if(ta && (initial||!CORPS_MODIFIE)) ta.value = EN.emp ? (CORPS_MODIFIE?(EN.corps||''):corpsDepuisModele(EN)) : '';
  if(!CORPS_MODIFIE) EN.corps='';
  const f=$('#discApercu');
  if(f) f.srcdoc = EN.emp ? discHtml(Object.assign({},EN,{corps:ta?ta.value:''}),true) : '<p style="font-family:sans-serif;padding:20px;color:#666">Choisissez d’abord la personne.</p>';
}
function discChamp(k,v,reconstruire){
  EN[k]=v;
  if(k==='type'){ EN.delai_h=DELAI_DEFAUT[v]||0; EN.jours=v==='miseapied'?(EN.jours||1):0; CORPS_MODIFIE=false; }
  if(reconstruire||k==='motif'){ const garde=EN; discFormulaire(); EN=garde; return; }
  discRafraichir();
}
function discCorps(v){ CORPS_MODIFIE=true; EN.corps=v; const f=$('#discApercu'); if(f) f.srcdoc=discHtml(EN,true); }
function discRegenerer(){ CORPS_MODIFIE=false; EN.corps=''; discRafraichir(); toast('Texte repris du modèle'); }
function discNomAr(v){ const e=emp(EN.emp); if(!e||!e.id) return; e.nomAr=String(v||'').trim(); save(); discRafraichir(); }
async function discFaitsPointage(){
  const a=addDays(TODAY,-60); await ensureRange(a,TODAY);
  const s=window.calcAssiduite(a,TODAY).lignes.find(x=>x.e.id===EN.emp);
  const evs=s?s.ev.filter(v=>EN.motif==='retards'?v.type==='ret':v.type==='absI').sort((x,y)=>x.ds<y.ds?-1:1):[];
  if(!evs.length){ toast('Rien de tel dans le pointage des 60 derniers jours','warn'); return; }
  EN.faits=faitsDepuisEvenements(EN.motif,evs,a,TODAY);
  if(!EN.date_faits) EN.date_faits=evs[evs.length-1].ds;
  discFormulaire();
}
async function discEnregistrer(silence,imprimer){
  if(!EN.emp){ toast('Choisissez la personne','warn'); return null; }
  if(!EN.motif&&EN.type!=='pv'){ toast('Choisissez le motif','warn'); return null; }
  if(EN.type==='miseapied'&&!EN.du){ toast('Indiquez à compter de quel jour','warn'); return null; }
  const ta=$('#dCorps'); const corps=ta?ta.value:(EN.corps||'');
  if(EN.type==='miseapied'){ EN.au=finMiseAPied(EN.du,EN.jours).au; }
  if(EN.statut!=='brouillon'&&!EN.remis_le) EN.remis_le=TODAY;
  const b=$('#discOk'); if(b) b.disabled=true;
  try{
    /* le texte est figé avec la pièce : un modèle modifié plus tard ne réécrit pas ce qui a été remis */
    const r=await api('/api/discipline',{method:'POST',body:Object.assign({},EN,{corps})});
    const en=r.entree; DISC.entrees=(DISC.entrees||[]).filter(x=>x.id!==en.id).concat([en]);
    EN=JSON.parse(JSON.stringify(en));
    if(!silence) toast('Pièce '+en.ref+' enregistrée');
    if(imprimer) discImprimerHtml(discHtml(en));
    if(VIEW==='discipline') fillDiscipline();
    if(!silence){ discFormulaire(); }
    return en;
  }catch(e){ toast('Enregistrement refusé : '+e.message,'err',9000); if(b) b.disabled=false; return null; }
}
async function discImprimer(id){
  await discCharger();
  const x=(DISC.entrees||[]).find(y=>y.id===id); if(!x) return;
  discImprimerHtml(discHtml(x));
}
async function discSupprimer(){
  if(!EN.id||!confirm('Supprimer définitivement la pièce '+EN.ref+' ?\n\nPour une pièce déjà remise, préférez le statut « Classé sans suite » : elle reste dans l’historique.')) return;
  try{ await api('/api/discipline/supprimer',{method:'POST',body:{id:EN.id}});
    DISC.entrees=DISC.entrees.filter(x=>x.id!==EN.id); closeModal(); toast('Pièce supprimée');
    if(VIEW==='discipline') fillDiscipline();
  }catch(e){ toast('Refusé : '+e.message,'err',9000) }
}
/* Après un questionnaire : préparer la pièce suivante en reprenant motif et faits. */
async function discSuite(){
  const q=await discEnregistrer(true); if(!q) return;
  const choix=prompt('Quelle suite donner à '+q.ref+' ?\n\n1 = Lettre d’observation\n2 = Avertissement\n3 = Blâme\n4 = Mise à pied\n5 = Classer sans suite','2');
  if(!choix) { discFormulaire(); return; }
  if(choix.trim()==='5'){ EN.statut='classe'; await discEnregistrer(); return; }
  const type={1:'observation',2:'avertissement',3:'blame',4:'miseapied'}[choix.trim()];
  if(!type){ toast('Choix non compris','warn'); discFormulaire(); return; }
  EN={id:'',emp:q.emp,type,date:TODAY,statut:'brouillon',motif:q.motif,date_faits:q.date_faits,faits:q.faits,corps:'',reponse:'',note:'',
      jours:type==='miseapied'?1:0,du:'',au:'',delai_h:0,suite_de:q.id,remis_le:''};
  CORPS_MODIFIE=false; discFormulaire();
}

/* --- en-tête de la société et modèles ---------------------------------------- */
async function discReglages(){
  await discCharger();
  const so=DISC.societe||{};
  const f=(l,k,ar)=>'<div><label class="fldlab" for="so_'+k+'">'+l+'</label><input class="fldin" id="so_'+k+'" value="'+esc(so[k]||'')+'"'+(ar?' dir="rtl" lang="ar"':'')+'></div>';
  openModal('<div class="modal-head">'+I.gear+'<h3>En-tête de la société et modèles de documents</h3>'+
    '<button class="x" onclick="closeModal()" aria-label="Fermer">'+I.x+'</button></div>'+
  '<div class="modal-body">'+
    '<div class="info-block"><h4>En-tête imprimé sur chaque document</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      f('Raison sociale (français)','nom')+f('Raison sociale (arabe)','nomAr',1)+
      f('Adresse (français)','adresse')+f('Adresse (arabe)','adresseAr',1)+
      f('Ville (français)','ville')+f('Ville (arabe) — ex. نابل','villeAr',1)+
      f('Signataire (français)','representant')+f('Signataire (arabe)','representantAr',1)+
      f('Matricule fiscal','mf')+f('Qualité du signataire (arabe) — ex. المدير العام','qualiteAr',1)+'</div></div>'+
    '<div class="info-block"><h4>Modèles</h4>'+
      '<div class="hint" style="margin-bottom:10px">Chaque modèle est le corps du document. Variables : <span class="mono">{date_faits} {motif} {faits} {delai} {jours} {du} {au} {reprise} {antecedents} {suite} {nom} {matricule} {poste}</span>. '+
        'Pour accorder au masculin ou au féminin : <span class="mono" dir="rtl">[السيد|السيدة]</span>. Laissez vide pour revenir au modèle d’origine. '+
        '<b>À faire relire une fois par votre conseil juridique.</b></div>'+
      '<div class="field" style="margin-bottom:8px"><label for="moType">Modèle</label><select id="moType" onchange="discModeleMontrer()">'+
        Object.keys(TYPES).map(k=>'<option value="'+k+'">'+esc(TYPES[k].fr)+((DISC.modeles||{})[k]?' — personnalisé':'')+'</option>').join('')+'</select>'+
        ' <button type="button" class="linkish" onclick="document.getElementById(\'moTexte\').value=\'\';discModeleGarder()">Rétablir le modèle d’origine</button></div>'+
      '<textarea class="fldin" id="moTexte" dir="rtl" lang="ar" rows="11" style="font-size:15px;line-height:1.9" oninput="discModeleGarder()"></textarea></div>'+
  '</div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button>'+
    '<button class="btn btn-gold" onclick="discReglagesEnregistrer()">'+I.check+' Enregistrer</button></div>','wide');
  window._discMo=Object.assign({},DISC.modeles||{});
  discModeleMontrer();
}
function discModeleMontrer(){ const k=$('#moType').value; $('#moTexte').value=window._discMo[k]||MODELES[k]; }
function discModeleGarder(){ const k=$('#moType').value, v=$('#moTexte').value;
  window._discMo[k]=(!v.trim()||v.trim()===MODELES[k].trim())?'':v; if(!v.trim()) $('#moTexte').value=MODELES[k]; }
async function discReglagesEnregistrer(){
  const societe={}; ['nom','nomAr','adresse','adresseAr','ville','villeAr','representant','representantAr','qualiteAr','mf'].forEach(k=>societe[k]=($('#so_'+k)||{}).value||'');
  const modeles={}; Object.keys(TYPES).forEach(k=>modeles[k]=window._discMo[k]||'');
  try{ const r=await api('/api/discipline/reglages',{method:'POST',body:{societe,modeles}});
    DISC.societe=r.societe; DISC.modeles=r.modeles; closeModal(); toast('En-tête et modèles enregistrés');
    if(VIEW==='discipline') go('discipline');
  }catch(e){ toast('Refusé : '+e.message,'err',9000) }
}

Object.assign(window,{discNouveau,discEditer,discImprimer,discProfil,discChamp,discCorps,discRegenerer,discNomAr,discFaitsPointage,discEnregistrer,
  discSupprimer,discSuite,discReglages,discModeleMontrer,discModeleGarder,discReglagesEnregistrer,fillDiscipline,csvDiscipline,
  discHtml,corpsDepuisModele,faitsDepuisEvenements,discCharger,
  DISC_OUTILS:{TYPES,MOTIFS,MODELES,joursAr,foisAr,genre,dateAr,finMiseAPied,get donnees(){return DISC},set donnees(v){DISC=v}}});
Object.defineProperty(window,'DI_Q',{get:()=>DI_Q,set:v=>{DI_Q=v},configurable:true});
Object.defineProperty(window,'DI_TYPE',{get:()=>DI_TYPE,set:v=>{DI_TYPE=v},configurable:true});
Object.defineProperty(window,'DI_STATUT',{get:()=>DI_STATUT,set:v=>{DI_STATUT=v},configurable:true});

(function(){
  const i=NAV.findIndex(n=>n.v==='conges');
  NAV.splice(i+1,0,{v:'discipline',ic:I.doc,t:'Discipline',roles:['admin','rh']});
})();
}
