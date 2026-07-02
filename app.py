# -*- coding: utf-8 -*-
"""
PilotRH — serveur applicatif (FastAPI + SQLite)
===============================================
- Lit directement le .mdb de la pointeuse ZKTeco (côté serveur)
- Historique des pointages conservé intégralement (table dédiée, jamais écrasée)
- Journal d'audit de chaque modification (inspection du travail / vérifications)
- Photos / documents sur le disque ; OCR + assistant IA via l'API Anthropic
"""
import re
import os, json, sqlite3, base64, threading, time, datetime, io, secrets, random, hashlib, hmac
from fastapi import FastAPI, UploadFile, File, Request, Form
from fastapi.responses import JSONResponse, FileResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
import httpx
import mdb_import

BASE = os.path.dirname(__file__)
DATA_DIR = os.environ.get("PILOTRH_DATA", os.path.join(BASE, "data"))
PHOTO_DIR = os.path.join(DATA_DIR, "photos")
DOC_DIR   = os.path.join(DATA_DIR, "docs")
DB_PATH   = os.path.join(DATA_DIR, "pilotrh.db")
SEED_MDB  = os.path.join(BASE, "seed", "attBackup.mdb")
API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL     = os.environ.get("PILOTRH_MODEL", "claude-sonnet-4-6")
MDB_PATH  = os.environ.get("PILOTRH_MDB_PATH", "")
SYNC_MIN  = int(os.environ.get("PILOTRH_SYNC_MINUTES", "60"))

for d in (DATA_DIR, PHOTO_DIR, DOC_DIR):
    os.makedirs(d, exist_ok=True)

SYNC = {"source": MDB_PATH, "last": None, "mtime": None, "error": None, "employees": 0}
_LOCK = threading.Lock()

def default_settings():
    base = {"actif": True, "debut": "07:30", "fin": "16:30", "pause": 30, "tol": 15, "grace": 15}
    sat  = {"actif": True, "debut": "07:30", "fin": "13:00", "pause": 0,  "tol": 15, "grace": 15}
    jours = {str(d): dict(base) for d in (1, 2, 3, 4, 5)}
    jours["6"] = sat
    jours["0"] = {"actif": False}
    return {"modeHS": "fin", "jours": jours, "periodes": []}

# expose pour mdb_import
mdb_import.default_settings = default_settings

def _conn():
    c = sqlite3.connect(DB_PATH)
    c.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)")
    c.execute("""CREATE TABLE IF NOT EXISTS pointage(
                 d TEXT, emp TEXT, statut TEXT, entree TEXT, sortie TEXT, punches TEXT, hM TEXT,
                 PRIMARY KEY(d, emp))""")
    for col in ("punches", "hM"):
        try:
            c.execute("ALTER TABLE pointage ADD COLUMN %s TEXT" % col)
        except Exception:
            pass
    c.execute("""CREATE TABLE IF NOT EXISTS audit(
                 ts TEXT, qui TEXT, action TEXT)""")
    return c

def get_meta():
    c = _conn(); r = c.execute("SELECT v FROM kv WHERE k='meta'").fetchone(); c.close()
    if r:
        m = json.loads(r[0])
    else:
        m = {"employees": [], "settings": default_settings(),
             "documents": [], "conges": [], "absences": []}
    m.setdefault("signalements", [])
    m.setdefault("exclus", [])
    return m

def set_meta(partial):
    """Fusionne les clés fournies dans l'état méta existant (ne perd pas le reste)."""
    c = _conn(); r = c.execute("SELECT v FROM kv WHERE k='meta'").fetchone()
    cur = json.loads(r[0]) if r else {}
    for k in ("employees", "settings", "documents", "conges", "absences", "signalements", "exclus", "users", "_secret"):
        if k in partial and partial[k] is not None:
            cur[k] = partial[k]
    if not cur.get("settings"):
        cur["settings"] = default_settings()
    c.execute("INSERT OR REPLACE INTO kv(k,v) VALUES('meta',?)", (json.dumps(cur, ensure_ascii=False),))
    c.commit(); c.close()

def ensure_tokens_persist():
    """Attribue un jeton secret + un PIN à 4 chiffres aux employées qui n'en ont pas."""
    m = get_meta(); changed = False
    for e in m["employees"]:
        if not e.get("token"):
            e["token"] = secrets.token_urlsafe(9); changed = True
        if not e.get("pin"):
            e["pin"] = f"{random.randint(0, 9999):04d}"; changed = True
    if changed:
        set_meta(m)
    return m

def _find_by_token(t):
    if not t:
        return None
    for e in get_meta()["employees"]:
        if e.get("token") == t:
            return e
    return None

def get_pointages():
    c = _conn()
    rows = c.execute("SELECT d, emp, statut, entree, sortie, punches, hM FROM pointage").fetchall()
    c.close()
    out = {}
    for d, emp, st, e, s, p, hm in rows:
        rec = {"statut": st, "entree": e or "", "sortie": s or ""}
        if p:
            try: rec["punches"] = json.loads(p)
            except Exception: pass
        if hm not in (None, ""):
            try: rec["hM"] = int(hm)
            except Exception: pass
        out.setdefault(d, {})[emp] = rec
    return out

def get_state():
    m = get_meta()
    m["pointages"] = get_pointages()
    return m

def replace_pointages(pts):
    c = _conn()
    rows = [(d, emp, r.get("statut", "absent"), r.get("entree", ""), r.get("sortie", ""),
             json.dumps(r["punches"]) if r.get("punches") else None,
             str(r["hM"]) if r.get("hM") not in (None, "") else None)
            for d, day in pts.items() for emp, r in day.items()]
    c.executemany("INSERT OR REPLACE INTO pointage(d,emp,statut,entree,sortie,punches,hM) VALUES(?,?,?,?,?,?,?)", rows)
    c.commit(); c.close()

def set_state(s):
    with _LOCK:
        set_meta(s)
        replace_pointages(s.get("pointages", {}))

def audit(qui, action):
    c = _conn()
    c.execute("INSERT INTO audit(ts,qui,action) VALUES(?,?,?)",
              (datetime.datetime.now().isoformat(timespec="seconds"), qui, action))
    c.commit(); c.close()

def empty_state():
    return {"employees": [], "settings": default_settings(),
            "pointages": {}, "documents": [], "conges": [], "absences": []}

# --- amorçage : importe la base fournie au premier démarrage ---
with _conn() as _c:
    _has = _c.execute("SELECT 1 FROM kv WHERE k='meta'").fetchone()
if not _has:
    s = empty_state()
    if os.path.exists(SEED_MDB):
        try:
            s = mdb_import.merge(s, SEED_MDB)
            print(f"[seed] {len(s['employees'])} employées · {len(s['pointages'])} jours")
        except Exception as e:
            print("[seed] échec:", e)
    set_state(s)
    audit("Système", "Amorçage initial de la base")
    ensure_tokens_persist()

# --- synchronisation réseau ---
def do_sync(force=False):
    if not MDB_PATH:
        SYNC["error"] = "PILOTRH_MDB_PATH non configuré"; return SYNC
    if not os.path.exists(MDB_PATH):
        SYNC["error"] = "fichier introuvable : " + MDB_PATH; return SYNC
    try:
        mt = os.path.getmtime(MDB_PATH)
        if not force and SYNC["mtime"] == mt:
            return SYNC
        s = mdb_import.merge(get_state(), MDB_PATH)
        set_state(s)
        ensure_tokens_persist()
        SYNC.update(mtime=mt, error=None, employees=len(s["employees"]),
                    last=datetime.datetime.now().isoformat(timespec="seconds"))
        audit("Système", f"Synchronisation pointeuse ({SYNC['employees']} employées)")
        print(f"[sync] {SYNC['last']}")
    except Exception as e:
        SYNC["error"] = str(e)
    return SYNC

def _sync_loop():
    while True:
        time.sleep(max(60, SYNC_MIN * 60))
        do_sync()

if MDB_PATH:
    threading.Thread(target=_sync_loop, daemon=True).start()
    threading.Thread(target=lambda: do_sync(force=True), daemon=True).start()

app = FastAPI(title="PilotRH")

ADMIN_PW = os.environ.get("PILOTRH_ADMIN_PASSWORD", "")

# ---------------------------------------------------------------------------
# Comptes utilisateurs + rôles + sessions
# ---------------------------------------------------------------------------
ROLES = {"admin": "Administrateur", "rh": "RH",
         "atelier": "Chef d'atelier", "lecture": "Lecture seule"}

def _hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", str(pw).encode(), salt.encode(), 100000).hex()
    return salt + "$" + h

def _check_pw(pw, stored):
    try:
        salt, _ = str(stored).split("$", 1)
        return hmac.compare_digest(_hash_pw(pw, salt), stored)
    except Exception:
        return False

def _secret():
    s = get_meta().get("_secret")
    if not s:
        s = secrets.token_hex(24); set_meta({"_secret": s})
    return s

def ensure_users():
    if not get_meta().get("users"):
        set_meta({"users": [{"login": "admin", "nom": "Administrateur",
                             "role": "admin", "pass": _hash_pw(ADMIN_PW or "admin")}]})

def _find_user(login):
    for u in get_meta().get("users", []):
        if u.get("login", "").lower() == str(login).lower():
            return u
    return None

def _sign_session(u, days=7):
    exp = int(time.time()) + days * 86400
    payload = base64.urlsafe_b64encode(json.dumps(
        {"login": u["login"], "role": u["role"], "nom": u.get("nom", ""), "exp": exp}).encode()).decode()
    sig = hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return payload + "." + sig

def _read_session(request):
    tok = request.cookies.get("pilotrh_sess", "")
    if "." not in tok:
        return None
    payload, sig = tok.rsplit(".", 1)
    good = hmac.new(_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, good):
        return None
    try:
        d = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        return None
    return d if d.get("exp", 0) >= time.time() else None

def _basic_user(request):
    auth = request.headers.get("authorization", "")
    if auth.startswith("Basic "):
        try:
            login, pw = base64.b64decode(auth[6:]).decode().split(":", 1)
            u = _find_user(login)
            if u and _check_pw(pw, u["pass"]):
                return {"login": u["login"], "role": u["role"], "nom": u.get("nom", "")}
            if ADMIN_PW and pw == ADMIN_PW:      # compat : ancien mot de passe admin unique
                return {"login": "admin", "role": "admin", "nom": "Administrateur"}
        except Exception:
            pass
    return None

def _current_user(request):
    return _read_session(request) or _basic_user(request)

PUBLIC_PREFIXES = ("/moi", "/api/me", "/photos", "/favicon", "/login", "/api/login", "/api/logout", "/static")
ADMIN_ONLY = ("/api/users",)
RH_PLUS = ("/api/employee/delete", "/api/import-mdb", "/api/punches", "/api/sync")
WRITE_PREFIXES = ("/api/pointage", "/api/day", "/api/state", "/api/state-meta", "/api/employee")

@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Connexion obligatoire (sauf espace salarié). Applique les rôles."""
    p = request.url.path
    if not any(p == x or p.startswith(x) for x in PUBLIC_PREFIXES):
        user = _current_user(request)
        if not user:
            if p.startswith("/api"):
                return JSONResponse({"error": "non_connecte"}, status_code=401)
            return RedirectResponse("/login", status_code=302)
        role = user.get("role", "lecture")
        if any(p.startswith(x) for x in ADMIN_ONLY) and role != "admin":
            return JSONResponse({"error": "Réservé à l'administrateur"}, status_code=403)
        if any(p.startswith(x) for x in RH_PLUS) and role not in ("admin", "rh"):
            return JSONResponse({"error": "Action non autorisée pour votre rôle"}, status_code=403)
        if role == "lecture" and request.method == "POST" and any(p.startswith(x) for x in WRITE_PREFIXES):
            return JSONResponse({"error": "Compte en lecture seule"}, status_code=403)
    resp = await call_next(request)
    if p in ("/", "/moi", "/login", "/index.html", "/moi.html") or p.endswith(".html"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp

@app.get("/api/state")
def api_state():
    return get_state()

@app.post("/api/state")
async def api_set_state(req: Request):
    set_state(await req.json())
    audit("RH", "Restauration / import complet de la base")
    return {"ok": True}

@app.post("/api/state-meta")
async def api_set_meta(req: Request):
    set_meta(await req.json())
    return {"ok": True}

@app.post("/api/employee/delete")
async def api_employee_delete(req: Request):
    b = await req.json()
    eid = b.get("id")
    m = get_meta()
    emps = m.get("employees", [])
    target = next((e for e in emps if e.get("id") == eid), None)
    if not target:
        return {"ok": False, "error": "introuvable"}
    badge = str(target.get("matricule") or target.get("cin") or "").strip()
    exclus = set(str(x) for x in m.get("exclus", []))
    if badge:
        exclus.add(badge)                      # ne réapparaîtra plus lors des imports .mdb
    new_emps = [e for e in emps if e.get("id") != eid]
    set_meta({"employees": new_emps, "exclus": sorted(exclus)})
    c = _conn(); c.execute("DELETE FROM pointage WHERE emp=?", (eid,)); c.commit(); c.close()
    audit(b.get("qui", "RH"),
          "Ouvrière supprimée (démission) · %s %s [badge %s]" %
          (target.get("prenom", ""), target.get("nom", ""), badge or "?"))
    return {"ok": True, "exclus": sorted(exclus)}

@app.post("/api/pointage")
async def api_pointage(req: Request):
    b = await req.json()
    d, emp = b["date"], b["id"]
    c = _conn()
    c.execute("INSERT OR REPLACE INTO pointage(d,emp,statut,entree,sortie,punches,hM) VALUES(?,?,?,?,?,?,?)",
              (d, emp, b.get("statut", "absent"), b.get("entree", ""), b.get("sortie", ""),
               json.dumps(b["punches"]) if b.get("punches") else None,
               str(b["hM"]) if b.get("hM") not in (None, "") else None))
    c.commit(); c.close()
    audit(b.get("qui", "RH"), f"Pointage modifié · {emp} · {d} ({b.get('statut')} {b.get('entree','')}-{b.get('sortie','')})")
    return {"ok": True}

@app.post("/api/day")
async def api_day(req: Request):
    b = await req.json()
    d = b["date"]; recs = b["recs"]
    c = _conn()
    c.executemany("INSERT OR REPLACE INTO pointage(d,emp,statut,entree,sortie,punches,hM) VALUES(?,?,?,?,?,?,?)",
                  [(d, emp, r.get("statut", "absent"), r.get("entree", ""), r.get("sortie", ""),
                    json.dumps(r["punches"]) if r.get("punches") else None,
                    str(r["hM"]) if r.get("hM") not in (None, "") else None) for emp, r in recs.items()])
    c.commit(); c.close()
    audit("RH", f"Journée créée/mise à jour · {d} ({len(recs)} employées)")
    return {"ok": True}

@app.get("/api/pointages")
def api_pointages(frm: str = "", to: str = ""):
    c = _conn()
    rows = c.execute("SELECT d,emp,statut,entree,sortie FROM pointage WHERE d>=? AND d<=?",
                     (frm or "0000", to or "9999")).fetchall()
    c.close()
    out = {}
    for d, emp, st, e, s in rows:
        out.setdefault(d, {})[emp] = {"statut": st, "entree": e or "", "sortie": s or ""}
    return out

@app.get("/api/audit")
def api_audit(limit: int = 50):
    c = _conn()
    rows = c.execute("SELECT ts,qui,action FROM audit ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    c.close()
    return [{"ts": t, "qui": q, "action": a} for t, q, a in rows]

@app.post("/api/import-mdb")
async def api_import_mdb(file: UploadFile = File(...),
                         du: str = Form(mdb_import.DEFAULT_DU),
                         au: str = Form("")):
    tmp = os.path.join(DATA_DIR, "_upload.mdb")
    with open(tmp, "wb") as f:
        f.write(await file.read())
    try:
        s = mdb_import.merge(get_state(), tmp, du, au or None)
        set_state(s)
        ensure_tokens_persist()
        audit("RH", f"Import .mdb ({len(s['employees'])} employées, {len(s['pointages'])} jours)")
        return s
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    finally:
        try: os.remove(tmp)
        except OSError: pass

@app.post("/api/punches")
async def api_punches(req: Request):
    """Reçoit les pointages lus directement sur la pointeuse par l'agent d'usine.
    Corps JSON : {"users":[{"badge","name","sexe"}], "punches":[{"badge","dt"}]}"""
    b = await req.json()
    users = b.get("users", []) or []
    punches = b.get("punches", []) or []
    if not punches:
        return JSONResponse({"error": "aucun pointage reçu"}, status_code=400)
    try:
        s = mdb_import.merge_punches(get_state(), users, punches, au=(b.get("au") or None))
        set_state(s)
        ensure_tokens_persist()
        audit("Pointeuse", "Import direct pointeuse · %d pointages, %d employées"
              % (len(punches), len(s["employees"])))
        return {"ok": True, "employees": len(s["employees"]), "jours": len(s["pointages"])}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@app.post("/api/sync")
def api_sync():
    return do_sync(force=True)

@app.post("/api/employee/{eid}/photo")
async def api_photo(eid: str, file: UploadFile = File(...)):
    path = os.path.join(PHOTO_DIR, eid + ".jpg")
    with open(path, "wb") as f:
        f.write(await file.read())
    url = "/photos/" + eid + ".jpg"
    m = get_meta()
    for e in m["employees"]:
        if e["id"] == eid:
            e["photo"] = url
    set_meta(m)
    audit("RH", f"Photo mise à jour · {eid}")
    return {"photo": url}

@app.get("/photos/{fn}")
def photos(fn):
    p = os.path.join(PHOTO_DIR, os.path.basename(fn))
    return FileResponse(p) if os.path.exists(p) else Response(status_code=404)

async def _anthropic(payload):
    if not API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY non configurée")
    async with httpx.AsyncClient(timeout=120) as cli:
        r = await cli.post("https://api.anthropic.com/v1/messages",
            headers={"x-api-key": API_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"}, json=payload)
    d = r.json()
    return "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")

@app.post("/api/ai")
async def api_ai(req: Request):
    b = await req.json()
    try:
        return {"text": await _anthropic({"model": MODEL, "max_tokens": 1024,
                "system": b.get("system", ""), "messages": b["messages"]})}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=503)

@app.post("/api/ocr")
async def api_ocr(file: UploadFile = File(...), names: str = Form("")):
    raw = await file.read(); b64 = base64.b64encode(raw).decode()
    media = "application/pdf" if file.filename.lower().endswith(".pdf") else (file.content_type or "image/jpeg")
    sys = ("Tu es un moteur OCR RH (usine textile tunisienne). Réponds UNIQUEMENT en JSON strict, "
           "sans markdown: {type, nom, date_debut(YYYY-MM-DD), date_fin, resume, employee_match}. "
           "employee_match = le nom le plus proche parmi: " + names)
    content = [{"type": "document" if media == "application/pdf" else "image",
                "source": {"type": "base64", "media_type": media, "data": b64}},
               {"type": "text", "text": "Analyse ce document RH."}]
    try:
        return {"text": await _anthropic({"model": MODEL, "max_tokens": 1024, "system": sys,
                "messages": [{"role": "user", "content": content}]})}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=503)

@app.get("/api/health")
def health():
    m = get_meta()
    c = _conn(); n = c.execute("SELECT COUNT(DISTINCT d) FROM pointage").fetchone()[0]; c.close()
    return {"ok": True, "employees": len(m.get("employees", [])),
            "jours_pointage": n, "ia": bool(API_KEY), "sync": SYNC}

@app.post("/api/report/pdf")
async def report_pdf(req: Request):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    b = await req.json()
    INK = colors.HexColor("#1a1d29"); GOLD = colors.HexColor("#c19a3e")
    LINE = colors.HexColor("#e7e1d4"); SOFT = colors.HexColor("#fbf9f4")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                            leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=12*mm)
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], textColor=INK, fontSize=18, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=ss["Normal"], textColor=colors.HexColor("#6c7180"), fontSize=10, spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=GOLD, fontSize=12, spaceBefore=10, spaceAfter=4)
    el = [Paragraph(b.get("title", "Rapport"), h1)]
    if b.get("subtitle"):
        el.append(Paragraph(b["subtitle"], sub))
    avail = landscape(A4)[0] - 28 * mm
    cellSt = ParagraphStyle("cell", parent=ss["Normal"], fontSize=8, leading=9.5)
    hdrSt = ParagraphStyle("hdr", parent=ss["Normal"], fontSize=8, leading=9.5,
                           textColor=colors.white, fontName="Helvetica-Bold")
    for sec in b.get("sections", []):
        el.append(Paragraph(sec.get("title", ""), h2))
        cols = sec["columns"]
        n = max(1, len(cols))
        wts = []
        for c in cols:
            lc = str(c).lower()
            wts.append(2.6 if lc.startswith("nom") else (1.1 if "mat" in lc else 1.0))
        tot = sum(wts) or 1
        cw = [avail * w / tot for w in wts]
        header = [Paragraph(str(c), hdrSt) for c in cols]
        rows = sec["rows"] or [["—"] * n]
        body = [[Paragraph("" if x is None else str(x), cellSt) for x in r] for r in rows]
        t = Table([header] + body, colWidths=cw, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
        el.append(t); el.append(Spacer(1, 6))
    el.append(Spacer(1, 8))
    el.append(Paragraph("Édité le " + datetime.datetime.now().strftime("%d/%m/%Y %H:%M") + " — PilotRH · DBS Fashion",
                        ParagraphStyle("foot", parent=ss["Normal"], textColor=colors.HexColor("#9aa0ad"), fontSize=8)))
    doc.build(el)
    raw = b.get("title", "rapport")
    fn = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw.replace(" ", "_")).strip("_") or "rapport"
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="%s.pdf"' % fn})

@app.get("/api/me")
def api_me(t: str = "", pin: str = "", mois: str = ""):
    e = _find_by_token(t)
    if not e:
        return JSONResponse({"error": "Lien invalide"}, status_code=401)
    if e.get("pin") and str(pin) != str(e["pin"]):
        return JSONResponse({"need_pin": True}, status_code=401)
    today = datetime.date.today()
    first = today.replace(day=1)
    if mois and len(mois) == 7:
        try:
            y, mo = int(mois[:4]), int(mois[5:7])
            cand = datetime.date(y, mo, 1)
            if cand <= first:            # pas de mois futur au-delà du mois courant
                first = cand
        except Exception:
            pass
    y, mo = first.year, first.month
    nextm = datetime.date(y + 1, 1, 1) if mo == 12 else datetime.date(y, mo + 1, 1)
    last = nextm - datetime.timedelta(days=1)
    to = min(last, today)
    frm, to_s = first.isoformat(), to.isoformat()
    c = _conn()
    rows = c.execute("SELECT d,statut,entree,sortie,punches,hM FROM pointage WHERE emp=? AND d>=? AND d<=?",
                     (e["id"], frm, to_s)).fetchall()
    c.close()
    m = get_meta()
    jours = {}
    for d, st, en, so, p, hm in rows:
        rec = {"statut": st, "entree": en or "", "sortie": so or ""}
        if p:
            try: rec["punches"] = json.loads(p)
            except Exception: pass
        if hm not in (None, ""):
            try: rec["hM"] = int(hm)
            except Exception: pass
        jours[d] = rec
    return {"nom": e.get("nom", ""), "prenom": e.get("prenom", ""),
            "matricule": e.get("matricule") or e.get("cin") or e["id"],
            "categorie": e.get("categorie", ""), "mois": first.strftime("%Y-%m"),
            "today": today.isoformat(), "settings": m["settings"], "jours": jours}

@app.post("/api/me/flag")
async def api_me_flag(req: Request, t: str = ""):
    e = _find_by_token(t)
    if not e:
        return JSONResponse({"error": "invalide"}, status_code=401)
    b = await req.json()
    qui = (e.get("prenom", "") + " " + e.get("nom", "")).strip()
    audit(qui, f"Signalement salarié · {b.get('date','')} · {b.get('message','')[:200]}")
    m = get_meta()
    m["signalements"].append({"emp": e["id"], "nom": qui, "date": b.get("date", ""),
                              "message": b.get("message", ""),
                              "ts": datetime.datetime.now().isoformat(timespec="seconds")})
    set_meta(m)
    return {"ok": True}

@app.get("/moi")
def page_salarie():
    return FileResponse(os.path.join(BASE, "static", "moi.html"))

@app.get("/api/qr-codes.pdf")
def qr_codes_pdf(request: Request):
    """PDF de cartes QR (une par employée) à imprimer et distribuer."""
    import qrcode
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Image, Spacer
    INK = colors.HexColor("#1a1d29"); GOLD = colors.HexColor("#c19a3e"); LINE = colors.HexColor("#e7e1d4")
    base = str(request.base_url).rstrip("/")
    emps = sorted(get_meta()["employees"], key=lambda e: (e.get("nom", ""), e.get("prenom", "")))
    ss = getSampleStyleSheet()
    nm = ParagraphStyle("nm", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=10, textColor=INK, alignment=1, spaceBefore=4)
    sm = ParagraphStyle("sm", parent=ss["Normal"], fontSize=8, textColor=colors.HexColor("#6c7180"), alignment=1)
    pn = ParagraphStyle("pn", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=11, textColor=GOLD, alignment=1, spaceBefore=2)

    def card(e):
        url = f"{base}/moi?t={e.get('token','')}"
        q = qrcode.QRCode(box_size=10, border=1); q.add_data(url); q.make()
        img = q.make_image(fill_color="#1a1d29", back_color="white")
        buf = io.BytesIO(); img.save(buf, format="PNG"); buf.seek(0)
        mat = e.get("matricule") or e.get("cin") or e["id"]
        return [Image(buf, width=34*mm, height=34*mm),
                Paragraph(f"{e.get('prenom','')} {e.get('nom','')}", nm),
                Paragraph(f"Matricule {mat}", sm),
                Paragraph(f"Code&nbsp;: {e.get('pin','----')}", pn)]

    cells, row = [], []
    for e in emps:
        row.append(card(e))
        if len(row) == 3:
            cells.append(row); row = []
    if row:
        while len(row) < 3:
            row.append("")
        cells.append(row)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12*mm, rightMargin=12*mm, topMargin=14*mm, bottomMargin=12*mm)
    head = ParagraphStyle("h", parent=ss["Title"], fontSize=15, textColor=INK)
    sub = ParagraphStyle("s", parent=ss["Normal"], fontSize=9, textColor=colors.HexColor("#6c7180"), spaceAfter=8)
    el = [Paragraph("Espace salarié — accès au pointage", head),
          Paragraph("DBS Fashion · Chaque ouvrière scanne son QR puis saisit son code à 4 chiffres pour consulter ses présences, retards et absences du mois. Document confidentiel.", sub)]
    t = Table(cells, colWidths=[60*mm]*3)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                           ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
                           ("BOX", (0, 0), (-1, -1), 0.4, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE)]))
    el.append(t)
    doc.build(el)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="qr_codes_personnel.pdf"'})

@app.get("/login")
def login_page():
    return FileResponse(os.path.join(BASE, "static", "login.html"))

@app.post("/api/login")
async def api_login(req: Request):
    b = await req.json()
    u = _find_user(b.get("login", ""))
    if not u or not _check_pw(b.get("password", ""), u["pass"]):
        return JSONResponse({"error": "Identifiant ou mot de passe incorrect"}, status_code=401)
    resp = JSONResponse({"ok": True, "user": {"login": u["login"], "nom": u.get("nom", ""), "role": u["role"]}})
    resp.set_cookie("pilotrh_sess", _sign_session(u), max_age=7 * 86400, httponly=True, samesite="lax")
    return resp

@app.post("/api/logout")
def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("pilotrh_sess")
    return resp

@app.get("/api/whoami")
def api_whoami(request: Request):
    u = _current_user(request)
    if not u:
        return JSONResponse({"error": "non_connecte"}, status_code=401)
    return {"login": u["login"], "nom": u.get("nom", ""), "role": u["role"], "roles": ROLES}

@app.get("/api/users")
def api_users_list():
    return [{"login": u["login"], "nom": u.get("nom", ""), "role": u["role"]}
            for u in get_meta().get("users", [])]

@app.post("/api/users")
async def api_users_save(req: Request):
    b = await req.json()
    login = str(b.get("login", "")).strip()
    if not login:
        return JSONResponse({"error": "Identifiant requis"}, status_code=400)
    if b.get("role") and b["role"] not in ROLES:
        return JSONResponse({"error": "Rôle inconnu"}, status_code=400)
    users = get_meta().get("users", [])
    ex = next((u for u in users if u["login"].lower() == login.lower()), None)
    if ex:
        ex["nom"] = b.get("nom", ex.get("nom", ""))
        ex["role"] = b.get("role", ex.get("role", "lecture"))
        if b.get("password"):
            ex["pass"] = _hash_pw(b["password"])
    else:
        if not b.get("password"):
            return JSONResponse({"error": "Mot de passe requis pour un nouveau compte"}, status_code=400)
        users.append({"login": login, "nom": b.get("nom", login),
                      "role": b.get("role", "lecture"), "pass": _hash_pw(b["password"])})
    set_meta({"users": users})
    audit("Compte", "Utilisateur enregistré · %s (%s)" % (login, b.get("role", "")))
    return {"ok": True}

@app.post("/api/users/delete")
async def api_users_delete(req: Request):
    b = await req.json()
    login = str(b.get("login", "")).strip()
    users = get_meta().get("users", [])
    admins = [u for u in users if u["role"] == "admin"]
    if len(admins) <= 1 and any(a["login"].lower() == login.lower() for a in admins):
        return JSONResponse({"error": "Impossible de supprimer le dernier administrateur"}, status_code=400)
    set_meta({"users": [u for u in users if u["login"].lower() != login.lower()]})
    audit("Compte", "Utilisateur supprimé · %s" % login)
    return {"ok": True}

ensure_users()   # crée le compte admin par défaut au besoin

app.mount("/", StaticFiles(directory=os.path.join(BASE, "static"), html=True), name="static")
