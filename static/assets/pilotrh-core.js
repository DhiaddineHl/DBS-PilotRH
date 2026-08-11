/* ============================================================================
   PilotRH — moteur de calcul partagé
   ============================================================================
   Ce fichier est chargé par l'interface RH (index.html) ET par l'espace salarié
   (moi.html). Il contient l'UNIQUE implémentation du calcul des heures, retards,
   heures supplémentaires, pauses et jours fériés.

   Avant, ce calcul était dupliqué dans les deux pages et les deux copies avaient
   déjà divergé : une ouvrière pouvait lire dans son espace un nombre d'heures
   différent de celui envoyé au comptable. Un seul fichier = plus de divergence.
   ============================================================================ */
(function (root) {
'use strict';

/* ---------------------------------------------------------------- utilitaires */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function toMin(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}
function fromMin(m) {
  if (m == null || isNaN(m)) return '';
  m = Math.round(m);
  const j = Math.floor(m / 1440);            // dépassement de minuit conservé, pas replié
  const r = ((m % 1440) + 1440) % 1440;
  return pad(Math.floor(r / 60)) + ':' + pad(r % 60) + (j > 0 ? ' (+' + j + 'j)' : '');
}
const hDec = min => min / 60;
const fr2 = n => Number(n).toFixed(2).replace('.', ',');
function hLabel(min) {
  const neg = min < 0; min = Math.abs(min);
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return (neg ? '-' : '') + h + 'h' + (m ? pad(m) : '');
}
/* Échappement HTML — OBLIGATOIRE sur toute donnée venant du serveur, de la
   pointeuse (le nom d'une employée est un champ libre sur l'appareil) ou de l'IA. */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* Échappement pour un attribut onclick="fn('…')" */
function escJs(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '\\u003c'); }

/* ------------------------------------------------------- jours fériés (Tunisie) */
/* Fêtes à date fixe — s'appliquent chaque année. */
const FERIES_FIXES_DEFAUT = [
  { md: '01-01', nom: 'Nouvel An' },
  { md: '01-14', nom: 'Fête de la Révolution' },
  { md: '03-20', nom: "Fête de l'Indépendance" },
  { md: '04-09', nom: 'Jour des Martyrs' },
  { md: '05-01', nom: 'Fête du Travail' },
  { md: '07-25', nom: 'Fête de la République' },
  { md: '08-13', nom: 'Fête de la Femme' },
  { md: '10-15', nom: "Fête de l'Évacuation" },
];
/* Les fêtes religieuses (Aïd El Fitr, Aïd El Idha, Mouled, Ras El Am El Hejri)
   se déplacent chaque année : elles se saisissent dans les paramètres, dans
   settings.feries = [{date:'2026-03-20', nom:'…', jours:1}]. */

/* --------------------------------------------------- normalisation des réglages */
function normalizeSettings(s) {
  s = s || {};
  if (s.modeHS !== 'seuil') s.modeHS = 'fin';          // un seul défaut, plus de contradiction
  if (s.arrondi === undefined) s.arrondi = 0;
  if (s.arrondiSens === undefined) s.arrondiSens = 'proche';
  /* Arrondi appliqué À LA JOURNÉE, comme dans la version d'origine : chaque jour
     affiché est un nombre rond, et la somme des journées est exactement égale au
     total du mois. Une ouvrière peut donc additionner ses journées et retrouver le
     total de son bulletin — ce qui n'est plus vrai si l'on arrondit le cumul. */
  if (s.arrondiPortee !== 'periode') s.arrondiPortee = 'jour';
  if (s.congesDu === undefined) s.congesDu = '';
  if (s.congesAu === undefined) s.congesAu = '';
  if (s.congesCoef === undefined) s.congesCoef = 0;
  if (!Array.isArray(s.feries)) s.feries = [];
  if (!Array.isArray(s.feriesFixes) || !s.feriesFixes.length) s.feriesFixes = FERIES_FIXES_DEFAUT.map(f => ({ ...f }));
  if (s.feriesActifs === undefined) s.feriesActifs = true;
  if (!Array.isArray(s.clotures)) s.clotures = [];      // mois verrouillés : ['2026-06', …]
  /* Taux par défaut de la convention : servent de repli quand la fiche n'a pas
     de taux propre, pour ne pas ressaisir le même chiffre sur tout l'effectif. */
  if (s.tauxHoraireDefaut === undefined) s.tauxHoraireDefaut = 0;
  if (s.tauxJourDefaut === undefined) s.tauxJourDefaut = 0;

  const legacy = {
    debut: s.heureDebut || '07:30', fin: s.heureFin || '16:30',
    pause: (s.pause !== undefined ? s.pause : 30),
    tol: (s.toleranceRetard !== undefined ? s.toleranceRetard : 15),
    grace: (s.graceHS !== undefined ? s.graceHS : 15),
  };
  if (!s.jours) s.jours = {};
  for (let d = 0; d < 7; d++) s.jours[d] = normalizeDay(s.jours[d], d, legacy);

  if (!Array.isArray(s.periodes)) s.periodes = [];
  s.periodes.forEach(p => {
    if (!p.jours) {
      p.jours = {};
      const lv = p.lunven || { debut: '07:00', fin: '14:00', pause: 0 };
      const sa = p.samedi || { actif: false, debut: '07:00', fin: '13:00', pause: 0 };
      [1, 2, 3, 4, 5].forEach(d => p.jours[d] = { actif: true, debut: lv.debut, fin: lv.fin, pause: +lv.pause || 0, tol: p.tol || 15, grace: p.grace || 15 });
      p.jours[6] = sa.actif ? { actif: true, debut: sa.debut, fin: sa.fin, pause: +sa.pause || 0, tol: p.tol || 15, grace: p.grace || 15 }
                            : { actif: false };
      p.jours[0] = { actif: false };
    }
    for (let d = 0; d < 7; d++) p.jours[d] = normalizeDay(p.jours[d], d, { debut: '07:00', fin: '14:00', pause: 0, tol: 15, grace: 15 });
  });
  /* Une période sans dates valides ne doit jamais s'appliquer silencieusement. */
  s.periodes.forEach(p => { if (p.du && p.au && p.au < p.du) { const t = p.du; p.du = p.au; p.au = t; } });
  return s;
}
function normalizeDay(r, d, def) {
  r = r || {};
  const day = {
    actif: (r.actif === undefined ? (d !== 0) : !!r.actif),
    debut: r.debut || def.debut || '07:30',
    fin: r.fin || (d === 6 ? '13:00' : (def.fin || '16:30')),
    pause: (r.pause !== undefined ? +r.pause : (d === 6 ? 0 : (def.pause !== undefined ? +def.pause : 30))),
    tol: (r.tol !== undefined ? +r.tol : (def.tol !== undefined ? +def.tol : 15)),
    grace: (r.grace !== undefined ? +r.grace : (def.grace !== undefined ? +def.grace : 15)),
    pauseDe: r.pauseDe || '',
    pauseA: r.pauseA || '',
    pauseAuto: false,
  };
  /* Plage de pause : si elle n'est pas renseignée, on la déduit du milieu de la
     journée pour que la pause ne soit PLUS déduite d'une demi-journée ou d'une
     autorisation de sortie. La plage déduite est signalée dans l'interface pour
     que les RH saisissent la vraie plage (ex. 12:00 → 12:30). */
  if (day.pause > 0 && (!day.pauseDe || !day.pauseA)) {
    const a = toMin(day.debut), b = toMin(day.fin);
    if (a != null && b != null && b > a) {
      const mid = Math.round((a + b) / 2);
      day.pauseDe = fromMin(mid - day.pause / 2).slice(0, 5);
      day.pauseA = fromMin(mid + day.pause / 2).slice(0, 5);
      day.pauseAuto = true;
    }
  }
  return day;
}

/* ------------------------------------------------------------ régime d'un jour */
/* Les résultats sont mémoïsés : regimeFor était appelé des centaines de milliers
   de fois par rendu, en allouant un objet Date à chaque appel. */
function makeEngine(getSettings) {
  const cacheReg = new Map();
  const cacheFerie = new Map();
  let stamp = 0;

  function invalidate() { cacheReg.clear(); cacheFerie.clear(); stamp++; }

  function S() { return getSettings() || {}; }

  function regimeFor(ds) {
    if (cacheReg.has(ds)) return cacheReg.get(ds);
    const s = S();
    const w = new Date(ds + 'T12:00').getDay();
    let reg = null;
    if (s.periodes) {
      for (const p of s.periodes) {
        if (p.du && p.au && p.du <= ds && ds <= p.au) { reg = (p.jours || {})[w] || { actif: false }; break; }
      }
    }
    if (!reg) reg = (s.jours || {})[w] || { actif: true, debut: '07:30', fin: '16:30', pause: 30, tol: 15, grace: 15, pauseDe: '', pauseA: '' };
    cacheReg.set(ds, reg);
    return reg;
  }

  /* Renvoie {nom} si le jour est férié, sinon null. */
  function ferieFor(ds) {
    if (cacheFerie.has(ds)) return cacheFerie.get(ds);
    const s = S();
    let out = null;
    if (s.feriesActifs !== false) {
      const md = String(ds).slice(5);
      /* le drapeau `off` (bouton × des paramètres) était ignoré : une fête fixe
         désactivée continuait à être comptée comme jour férié */
      const fx = (s.feriesFixes || []).find(f => f.md === md && !f.off);
      if (fx) out = { nom: fx.nom, fixe: true };
      if (!out) {
        for (const f of (s.feries || [])) {
          if (!f.date) continue;
          const n = Math.max(1, +f.jours || 1);
          const d0 = new Date(f.date + 'T12:00');
          for (let k = 0; k < n; k++) {
            if (isoOf(d0) === ds) { out = { nom: f.nom || 'Jour férié', fixe: false }; break; }
            d0.setDate(d0.getDate() + 1);
          }
          if (out) break;
        }
      }
    }
    cacheFerie.set(ds, out);
    return out;
  }

  /* Un jour est-il « attendu au travail » ? Non si repos hebdomadaire OU férié. */
  function estOuvre(ds) {
    const reg = regimeFor(ds);
    if (reg.actif === false) return false;
    if (ferieFor(ds)) return false;
    return true;
  }

  const roundMin = (x, step, sens) => (!step || step <= 0) ? x : (sens === 'inferieur' ? Math.floor(x / step) * step : Math.round(x / step) * step);

  function badges(rec) {
    const P = (rec.punches && rec.punches.length) ? rec.punches.slice() : [rec.entree, rec.sortie];
    const out = [];
    P.map(toMin).filter(x => x != null).sort((a, b) => a - b).forEach(m => {
      /* déduplication : deux badges à moins de 5 min sont le même passage
         (double lecture du doigt), sinon la journée est coupée en deux à tort */
      if (out.length && m - out[out.length - 1] < 5) return;
      out.push(m);
    });
    return out;
  }

  /* Durée d'intersection entre une liste de segments et une fenêtre [a,b]. */
  function chevauchement(segs, a, b) {
    if (a == null || b == null || b <= a) return 0;
    let t = 0;
    for (const s of segs) { const x = Math.max(s[0], a), y = Math.min(s[1], b); if (y > x) t += y - x; }
    return t;
  }

  /* ------------------------------------------------------------------ metrics */
  /* Renvoie, pour un enregistrement de pointage :
       statut   : present | late | absent | leave | mission | autorisation | ferie | ferieTravaille | repos
       heures   : minutes normales payées
       hs       : minutes supplémentaires
       retard   : minutes de retard
       revue    : true si la journée doit être vérifiée par les RH avant la paie
       motifRevue : raison lisible
       manuel / manuelHS : la valeur a été saisie à la main
  */
  function metrics(rec, date) {
    const ds = date || isoOf(new Date());
    const reg = regimeFor(ds);
    const ferie = ferieFor(ds);
    const arrondiParJour = S().arrondiPortee === 'jour';
    const base = { statut: 'absent', worked: false, heures: 0, retard: 0, hs: 0, late: false,
                   manuel: false, manuelHS: false, coupures: false, revue: false, motifRevue: '',
                   ferie: !!ferie, ferieNom: ferie ? ferie.nom : '', ouvre: estOuvre(ds) };

    const P = rec ? badges(rec) : [];
    const aucunPointage = !P.length;

    /* Statuts sans pointage : le jour n'est PAS une absence s'il est férié ou de repos. */
    if (!rec || rec.statut === 'absent') {
      if (aucunPointage) {
        if (ferie) return { ...base, statut: 'ferie' };
        if (reg.actif === false) return { ...base, statut: 'repos' };
        return { ...base, statut: 'absent' };
      }
    }
    if (rec && ['leave', 'mission'].includes(rec.statut) && aucunPointage) {
      return { ...base, statut: rec.statut };
    }
    if (aucunPointage && rec && rec.statut !== 'present' && rec.statut !== 'autorisation') {
      return { ...base, statut: rec.statut || 'absent' };
    }

    let heures = 0, retard = 0, hs = 0, late = false, coupures = false, revue = false, motifRevue = '';

    if (P.length === 1) {
      /* Un seul badge : la sortie (ou l'entrée) manque. On ne paie PAS 0 h en
         silence — la journée est marquée à revoir et remonte dans les alertes.
         Le RETARD, lui, reste calculé : l'heure d'arrivée est connue, et la
         version précédente le comptait déjà. L'oublier ferait disparaître la
         moitié des retards du mois. */
      revue = true;
      motifRevue = 'Un seul badge (' + fromMin(P[0]) + ') — sortie manquante';
      if (reg.actif !== false && !ferie) {
        const debut1 = toMin(reg.debut), tol1 = +reg.tol || 0;
        if (debut1 != null) {
          late = P[0] > debut1 + tol1;
          retard = late ? (P[0] - debut1) : 0;
        }
      }
    } else if (P.length) {
      const firstIn = P[0], lastOut = P[P.length - 1];
      if (reg.actif === false || ferie) {
        /* Repos hebdomadaire ou jour férié travaillé : tout le temps de présence
           est en heures supplémentaires.
           On somme les SEGMENTS badgés au lieu de faire (dernier - premier) :
           l'ancien calcul comptait comme travaillée une sortie de deux heures au
           milieu de la journée, et retirait à l'inverse une pause théorique que
           personne n'avait prise. */
        if (P.length % 2 === 0) {
          for (let i = 0; i + 1 < P.length; i += 2) hs += P[i + 1] - P[i];
          coupures = P.length > 2;
        } else {
          hs = lastOut - firstIn;
          revue = true;
          motifRevue = 'Nombre de badges impair (' + P.length + ') un jour non ouvré';
        }
        hs = Math.max(0, hs);
      } else {
        const debut = toMin(reg.debut), fin = toMin(reg.fin);
        const grace = +reg.grace || 0, tol = +reg.tol || 0, pause = +reg.pause || 0;
        late = firstIn > debut + tol;
        retard = late ? (firstIn - debut) : 0;

        let segs = [];
        if (P.length % 2 === 0) { for (let i = 0; i + 1 < P.length; i += 2) segs.push([P[i], P[i + 1]]); coupures = P.length > 2; }
        else { segs = [[firstIn, lastOut]]; revue = true; motifRevue = 'Nombre de badges impair (' + P.length + ') — un pointage a été oublié'; }

        const clip = segs.map(s => [Math.max(s[0], debut), Math.min(s[1], fin)]).filter(s => s[1] > s[0]);
        let norm = clip.reduce((t, s) => t + (s[1] - s[0]), 0);

        /* Pause : déduite uniquement à hauteur du temps réellement travaillé
           PENDANT la plage de pause. Une autorisation 07:55 → 11:00 ne se voit
           donc plus retirer 30 minutes de déjeuner qu'elle n'a pas prises. */
        if (pause > 0) {
          const pa = toMin(reg.pauseDe), pb = toMin(reg.pauseA);
          if (pa != null && pb != null && pb > pa) norm -= Math.min(pause, chevauchement(clip, pa, pb));
          else {
            /* pas de plage définie : on retombe sur l'ancien calcul, mais au
               prorata du temps de présence pour ne pas surdéduire */
            let gaps = 0;
            for (let i = 0; i + 1 < clip.length; i++) { const g0 = clip[i][1], g1 = clip[i + 1][0]; if (g1 > g0) gaps += g1 - g0; }
            const attendu = Math.max(1, (fin - debut) - pause);
            norm -= Math.max(0, pause - gaps) * Math.min(1, norm / attendu);
          }
        }
        heures = Math.max(0, norm);
        if (lastOut >= fin + grace) hs = (S().modeHS === 'fin') ? (lastOut - fin) : (lastOut - (fin + grace));
        hs = Math.max(0, hs);
      }
    }

    /* Arrondi : par défaut sur le CUMUL de la période (voir arrondirTotal), pas
       par jour — l'arrondi journalier dérivait jusqu'à plusieurs heures par mois. */
    if (arrondiParJour) {
      const ar = +S().arrondi || 0;
      if (ar > 0) { heures = roundMin(heures, ar, S().arrondiSens); hs = roundMin(hs, ar, S().arrondiSens); }
    }

    /* Saisie manuelle. hM remplace les heures normales ; hsM remplace les heures
       supplémentaires. Si les RH saisissent hM sans saisir hsM, les heures sup.
       calculées sont mises à zéro : la saisie manuelle est considérée comme
       exhaustive, sinon on payait deux fois la même journée. */
    let manuel = false, manuelHS = false;
    if (rec && rec.hM != null && rec.hM !== '') { heures = +rec.hM; manuel = true; }
    if (rec && rec.hsM != null && rec.hsM !== '') { hs = +rec.hsM; manuelHS = true; }
    else if (manuel) hs = 0;

    let statut;
    if (ferie) statut = (heures || hs || P.length) ? 'ferieTravaille' : 'ferie';
    else if (reg.actif === false && P.length) statut = 'reposTravaille';
    else if (rec && rec.statut === 'present') statut = late ? 'late' : 'present';
    else statut = (rec && rec.statut) || 'absent';

    return { ...base, statut, worked: true, heures, retard, hs, late, manuel, manuelHS, coupures, revue, motifRevue };
  }

  /* Arrondi appliqué au TOTAL d'une période (comportement par défaut). */
  function arrondirTotal(min) {
    if (S().arrondiPortee === 'jour') return min;
    const ar = +S().arrondi || 0;
    return ar > 0 ? roundMin(min, ar, S().arrondiSens) : min;
  }

  function moisClos(ym) { return (S().clotures || []).indexOf(ym) >= 0; }

  /* ------------------------------------------------------------ rémunération */
  /* Le taux de la fiche l'emporte ; s'il est vide, on retombe sur le taux par
     défaut des paramètres (convention collective). Cela évite de saisir le même
     taux horaire sur les 97 fiches. */
  function taux(e) {
    const s = S(), m = modePaie(e);
    if (m === 'journalier') return +(e && e.tauxJour) || +s.tauxJourDefaut || 0;
    return +(e && e.tauxHoraire) || +s.tauxHoraireDefaut || 0;
  }
  /* Base de paie d'une personne sur une période, à partir d'une ligne de
     synthèse {jT,jFT,hN,hS}. Aucune majoration légale n'est appliquée ici :
     la quantité est celle qui est réellement constatée sur les pointages. */
  function paie(e, s) {
    s = s || {};
    const mode = modePaie(e), t = taux(e);
    const qte = (mode === 'journalier')
      ? ((+s.jT || 0) + (+s.jFT || 0))
      : hDec((+s.hN || 0) + (+s.hS || 0));
    return {
      mode: mode,
      unite: (mode === 'journalier') ? 'j' : 'h',
      uniteLong: (mode === 'journalier') ? 'jour(s) travaillé(s)' : 'heure(s) payée(s)',
      label: (mode === 'journalier') ? 'Journée' : 'Heure',
      qte: qte,
      taux: t,
      montant: t ? Math.round(qte * t * 1000) / 1000 : 0,
      tauxDefaut: !(mode === 'journalier' ? (e && +e.tauxJour) : (e && +e.tauxHoraire)),
    };
  }

  return { regimeFor, ferieFor, estOuvre, metrics, badges, roundMin, arrondirTotal, moisClos,
           taux, paie, invalidate, get stamp() { return stamp; } };
}

/* ------------------------------------------------------------------- libellés */
/* Libellés accordés au genre de la personne pour les lignes individuelles, et
   neutres pour les compteurs collectifs (l'effectif comporte des hommes). */
const STATUTS = {
  present:        { f: 'Présente',    h: 'Présent',    cls: 't-present' },
  late:           { f: 'En retard',   h: 'En retard',  cls: 't-late' },
  absent:         { f: 'Absente',     h: 'Absent',     cls: 't-absent' },
  leave:          { f: 'En congé',    h: 'En congé',   cls: 't-leave' },
  mission:        { f: 'En mission',  h: 'En mission', cls: 't-mission' },
  autorisation:   { f: 'Autorisation', h: 'Autorisation', cls: 't-leave' },
  ferie:          { f: 'Férié',       h: 'Férié',      cls: 't-ferie' },
  ferieTravaille: { f: 'Férié travaillé', h: 'Férié travaillé', cls: 't-mission' },
  repos:          { f: 'Repos',       h: 'Repos',      cls: 't-neutral' },
  reposTravaille: { f: 'Repos travaillé', h: 'Repos travaillé', cls: 't-mission' },
};
function statutLabel(st, sexe) {
  const s = STATUTS[st];
  if (!s) return st || '—';
  return (sexe === 'H') ? s.h : s.f;
}
function statutClass(st) { return (STATUTS[st] || { cls: 't-neutral' }).cls; }
/* Les statuts qui comptent comme une absence à justifier. */
const EST_ABSENCE = st => st === 'absent';

/* Une journée est protégée des imports dès qu'elle porte une trace de saisie
   manuelle. Doit rester le MIROIR EXACT de _est_protege() dans mdb_import.py :
   sinon l'interface affiche un cadenas là où le serveur n'en met pas, ou pire,
   n'en affiche pas là où la journée est réellement protégée. */
/* ------------------------------------------------------------- rémunération */
/* Deux modes seulement, volontairement : les ouvrières sont payées à l'heure
   (convention collective du textile) et les cadres à la journée travaillée.
   Si la fiche ne dit rien, on déduit le mode de la catégorie — c'est ce que
   faisait l'application avant que le mode devienne saisissable. */
const MODES_PAIE = ['horaire', 'journalier'];
const MODES_PAIE_LABEL = { horaire: 'À l’heure', journalier: 'À la journée' };
function modePaie(e) {
  if (e && MODES_PAIE.indexOf(e.modePaie) >= 0) return e.modePaie;
  return (e && e.categorie === 'Cadre') ? 'journalier' : 'horaire';
}

function estProtege(rec) {
  if (!rec) return false;
  if (rec.manuel) return true;
  if (rec.hM != null && rec.hM !== '') return true;
  if (rec.hsM != null && rec.hsM !== '') return true;
  if (rec.src === 'conge') return true;
  return false;
}

root.PilotRHCore = {
  pad, isoOf, toMin, fromMin, hDec, fr2, hLabel, esc, escJs,
  normalizeSettings, normalizeDay, makeEngine,
  FERIES_FIXES_DEFAUT, STATUTS, statutLabel, statutClass, EST_ABSENCE, estProtege,
  MODES_PAIE, MODES_PAIE_LABEL, modePaie,
};
})(typeof window !== 'undefined' ? window : this);
