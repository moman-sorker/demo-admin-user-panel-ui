# =========================================================
# Reusable Panel — v6.0
# Removed WS · bKash Payments · Multi-Plan · Secure Shared APIs
# =========================================================

import os, io, json, uuid, base64, hashlib, smtplib, time, hmac, ipaddress, socket
from functools import wraps
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from urllib.parse import urlparse, quote
from email.message import EmailMessage

import pyotp, qrcode, requests as rq
from flask import (Flask, request, jsonify, session, send_from_directory, redirect)

# ---------------- Paths ----------------
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR   = os.path.join(BASE_DIR, "data")
AVATAR_DIR = os.path.join(DATA_DIR, "avatars")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
for d in (DATA_DIR, AVATAR_DIR, UPLOAD_DIR): os.makedirs(d, exist_ok=True)

ADMINS_FILE       = os.path.join(DATA_DIR, "admins.json")
USERS_FILE        = os.path.join(DATA_DIR, "users.json")
ACTIVITY_FILE     = os.path.join(DATA_DIR, "activity.json")
NOTIF_FILE        = os.path.join(DATA_DIR, "notifications.json")
TICKETS_FILE      = os.path.join(DATA_DIR, "tickets.json")
PLANS_FILE        = os.path.join(DATA_DIR, "plans.json")
SUBS_FILE         = os.path.join(DATA_DIR, "subscriptions.json")
ROLES_FILE        = os.path.join(DATA_DIR, "roles.json")
COLLECTIONS_FILE  = os.path.join(DATA_DIR, "collections.json")
SAVED_REQ_FILE    = os.path.join(DATA_DIR, "saved_requests.json")
API_HISTORY_FILE  = os.path.join(DATA_DIR, "api_history.json")
SHARED_APIS_FILE  = os.path.join(DATA_DIR, "shared_apis.json")
API_USAGE_FILE    = os.path.join(DATA_DIR, "api_usage.json")
PAYMENTS_FILE     = os.path.join(DATA_DIR, "payments.json")

# ---------------- Email ----------------
SMTP_HOST = os.environ.get("SMTP_HOST")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_PASS = os.environ.get("SMTP_PASS")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "no-reply@panel.local")

# ---------------- bKash ----------------
BKASH_BASE_URL   = os.environ.get("BKASH_BASE_URL", "https://tokenized.sandbox.bka.sh/v1.2.0-beta")
BKASH_APP_KEY    = os.environ.get("BKASH_APP_KEY", "")
BKASH_APP_SECRET = os.environ.get("BKASH_APP_SECRET", "")
BKASH_USERNAME   = os.environ.get("BKASH_USERNAME", "")
BKASH_PASSWORD   = os.environ.get("BKASH_PASSWORD", "")
BKASH_CALLBACK   = os.environ.get("BKASH_CALLBACK_URL", "http://localhost:5000/api/payments/bkash/callback")
BKASH_WEBHOOK_SECRET = os.environ.get("BKASH_WEBHOOK_SECRET", "")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.secret_key = os.environ.get("SECRET_KEY", "demo-secret-please-change")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
ALLOWED_IMG = {"png", "jpg", "jpeg", "gif", "webp"}
ALLOWED_ATTACH = ALLOWED_IMG | {"pdf", "txt", "zip", "doc", "docx", "xls", "xlsx"}

# =========================================================
#  PERMISSIONS
# =========================================================
ALL_PERMISSIONS = [
    "dashboard.view",
    "users.view", "users.create", "users.edit", "users.delete",
    "admins.view", "admins.manage",
    "tickets.view", "tickets.reply", "tickets.manage",
    "broadcast.send",
    "activity.view_own", "activity.view_all",
    "api_tester.use", "api_tester.save",
    "api_share.manage",
    "roles.manage",
    "subscriptions.manage",
    "payments.view",
]

DEFAULT_ROLES = {
    "viewer": {
        "name": "viewer", "label": "Viewer", "color": "#00d4ff", "built_in": True,
        "permissions": ["dashboard.view", "users.view", "admins.view",
                        "tickets.view", "activity.view_own"],
    },
    "editor": {
        "name": "editor", "label": "Editor", "color": "#00ff9d", "built_in": True,
        "permissions": ["dashboard.view", "users.view", "users.create", "users.edit",
                        "admins.view", "tickets.view", "tickets.reply", "tickets.manage",
                        "activity.view_own", "api_tester.use", "api_tester.save"],
    },
    "superadmin": {
        "name": "superadmin", "label": "Superadmin", "color": "#ffd60a", "built_in": True,
        "permissions": ALL_PERMISSIONS[:],
    },
}

DEFAULT_PLANS = {
    "free": {
        "id": "free", "name": "Free", "price": 0, "currency": "BDT",
        "duration_days": 36500, "color": "#7d8590", "icon": "🆓",
        "built_in": True,
        "features": ["3 requests/day per API", "Community support", "Basic tools"],
        "request_limit_per_url": 3,   # default per-URL limit
        "request_period": "day",       # "day" | "total" | None
        "auto_renew": True,
        "show_features_input": True,
    },
    "pro": {
        "id": "pro", "name": "Pro", "price": 500, "currency": "BDT",
        "duration_days": 30, "color": "#00ff9d", "icon": "⭐",
        "built_in": True,
        "features": ["100 requests/day per API", "Priority support", "All tools"],
        "request_limit_per_url": 100, "request_period": "day",
        "auto_renew": False, "show_features_input": True,
    },
    "premium": {
        "id": "premium", "name": "Premium", "price": 1500, "currency": "BDT",
        "duration_days": 30, "color": "#ffd60a", "icon": "👑",
        "built_in": True,
        "features": ["Unlimited requests", "24/7 support", "All features"],
        "request_limit_per_url": None, "request_period": None,
        "auto_renew": False, "show_features_input": True,
    },
}

# =========================================================
#  Helpers
# =========================================================
def load(p, d):
    if not os.path.exists(p): save(p, d); return d
    try:
        with open(p, "r", encoding="utf-8") as f: return json.load(f)
    except: return d

def save(p, data):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def hpw(pw): return hashlib.sha256(pw.encode()).hexdigest()
def now_iso(): return datetime.utcnow().isoformat() + "Z"

def find_by_email(store, email):
    return next((x for x in store if x["email"].lower() == email.lower()), None)
def find_by_id(store, uid):
    return next((x for x in store if x["id"] == uid), None)

def strip(x):
    y = dict(x); y.pop("password", None); y.pop("twofa_secret", None)
    y["has2fa"] = bool(x.get("twofa_enabled")); return y

def strip_public(x):
    """Public-safe version — never expose email to other users."""
    y = dict(x)
    y.pop("password", None); y.pop("twofa_secret", None); y.pop("email", None)
    return y

def allowed_img(n):
    return "." in n and n.rsplit(".", 1)[1].lower() in ALLOWED_IMG
def allowed_attach(n):
    return "." in n and n.rsplit(".", 1)[1].lower() in ALLOWED_ATTACH

def get_roles():
    roles = load(ROLES_FILE, None)
    if not roles:
        save(ROLES_FILE, DEFAULT_ROLES); return DEFAULT_ROLES
    return roles

def user_permissions(role_name):
    return get_roles().get(role_name, {}).get("permissions", [])
def has_perm(role_name, perm):
    return perm in user_permissions(role_name)

def push_activity(who, action, meta=None):
    log = load(ACTIVITY_FILE, [])
    log.insert(0, {"id": str(uuid.uuid4()), "who": who, "action": action,
                    "meta": meta or {}, "at": now_iso()})
    save(ACTIVITY_FILE, log[:2000])

def push_notification(to, title, body, sender="system", kind="info",
                      redirect_view=None, redirect_id=None):
    n = load(NOTIF_FILE, [])
    n.insert(0, {"id": str(uuid.uuid4()), "to": to, "from": sender,
                 "title": title, "body": body, "kind": kind,
                 "redirect_view": redirect_view, "redirect_id": redirect_id,
                 "read": False, "at": now_iso()})
    save(NOTIF_FILE, n[:2000])
    if SMTP_HOST and to and "@" in to:
        try:
            msg = MIMEText(body); msg["Subject"] = title
            msg["From"] = SMTP_FROM; msg["To"] = to
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
                s.starttls()
                if SMTP_USER: s.login(SMTP_USER, SMTP_PASS)
                s.sendmail(SMTP_FROM, [to], msg.as_string())
        except Exception as e: print("[email] failed:", e)

def paginate(items, q=None, search_fields=None, filters=None,
             sort="created", order="desc", page=1, limit=10):
    if q and search_fields:
        ql = q.lower()
        items = [x for x in items if any(ql in str(x.get(f, "")).lower() for f in search_fields)]
    if filters:
        for k, v in filters.items():
            if v in (None, "", "all", "any"): continue
            items = [x for x in items if str(x.get(k, "")) == str(v)]
    if sort:
        items = sorted(items, key=lambda x: x.get(sort, "") or "", reverse=(order == "desc"))
    total = len(items)
    try: limit = max(1, min(500, int(limit)))
    except: limit = 10
    pages = max(1, (total + limit - 1) // limit)
    try: page = max(1, min(int(page), pages))
    except: page = 1
    start = (page - 1) * limit
    return {"items": items[start:start + limit], "total": total,
            "page": page, "pages": pages, "limit": limit}

def is_private_url(url):
    try:
        host = urlparse(url).hostname
        if not host: return True
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"): return True
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        except ValueError:
            try:
                info = socket.getaddrinfo(host, None)
                for i in info:
                    ip = ipaddress.ip_address(i[4][0])
                    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                        return True
            except: pass
            return False
    except: return True

# =========================================================
#  PLAN / SUBSCRIPTION helpers
# =========================================================
def get_plans():
    plans = load(PLANS_FILE, None)
    if not plans:
        save(PLANS_FILE, DEFAULT_PLANS); return DEFAULT_PLANS
    return plans

def get_subscription(email):
    subs = load(SUBS_FILE, {})
    sub = subs.get(email)
    if not sub: return None
    if sub.get("expires_at"):
        try:
            if datetime.fromisoformat(sub["expires_at"].replace("Z","")) < datetime.utcnow():
                if sub.get("status") != "expired":
                    sub["status"] = "expired"
                    subs[email] = sub; save(SUBS_FILE, subs)
        except: pass
    return sub

def ensure_subscription(email):
    subs = load(SUBS_FILE, {})
    if email not in subs:
        now = datetime.utcnow()
        subs[email] = {
            "email": email, "plan_id": "free", "plans": ["free"],
            "started_at": now.isoformat() + "Z",
            "expires_at": (now + timedelta(days=36500)).isoformat() + "Z",
            "status": "active", "auto_renew": True, "history": [],
        }
        save(SUBS_FILE, subs)
    sub = subs[email]
    # ensure plans array exists
    if "plans" not in sub:
        sub["plans"] = [sub.get("plan_id", "free")]
        subs[email] = sub; save(SUBS_FILE, subs)
    return sub

def get_user_plan(email):
    sub = ensure_subscription(email)
    plans = get_plans()
    active = []
    for pid in sub.get("plans", []):
        p = plans.get(pid)
        if p: active.append(p)
    # primary plan = highest-priority (premium > pro > free)
    order = {"premium": 3, "pro": 2, "free": 1}
    active.sort(key=lambda x: order.get(x["id"], 0), reverse=True)
    return active[0] if active else plans.get("free")

def get_user_plan_limit(email, shared_api=None):
    """Return effective request limit for this user for the given shared API."""
    if shared_api and shared_api.get("request_limit_per_plan"):
        # check per-API override
        for pid in (ensure_subscription(email).get("plans") or []):
            if pid in shared_api["request_limit_per_plan"]:
                return shared_api["request_limit_per_plan"][pid], shared_api.get("credit_period", "day")
    plan = get_user_plan(email)
    if not plan: return 3, "day"
    return plan.get("request_limit_per_url"), plan.get("request_period")

# =========================================================
#  bKash service (server-side only)
# =========================================================
class BkashService:
    _token = None
    _expires_at = 0

    @classmethod
    def _http(cls):
        return rq.Session()

    @classmethod
    def configured(cls):
        return bool(BKASH_APP_KEY and BKASH_APP_SECRET and BKASH_USERNAME and BKASH_PASSWORD)

    @classmethod
    def _grant_token(cls):
        if cls._token and cls._expires_at > time.time() + 60:
            return cls._token
        url = f"{BKASH_BASE_URL}/tokenized/checkout/token/grant"
        headers = {
            "Content-Type": "application/json",
            "username": BKASH_USERNAME,
            "password": BKASH_PASSWORD,
        }
        body = {"app_key": BKASH_APP_KEY, "app_secret": BKASH_APP_SECRET}
        r = rq.post(url, json=body, headers=headers, timeout=20)
        data = r.json()
        if not data.get("id_token"):
            raise RuntimeError(f"bKash token grant failed: {data}")
        cls._token = data["id_token"]
        cls._expires_at = time.time() + int(data.get("expires_in", 3600))
        return cls._token

    @classmethod
    def _auth_headers(cls):
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": cls._grant_token(),
            "X-APP-Key": BKASH_APP_KEY,
        }

    @classmethod
    def create_payment(cls, amount, invoice):
        url = f"{BKASH_BASE_URL}/tokenized/checkout/payment/create"
        body = {
            "mode": "0011",
            "payerReference": invoice,
            "callbackURL": BKASH_CALLBACK,
            "amount": f"{float(amount):.2f}",
            "currency": "BDT",
            "intent": "sale",
            "merchantInvoiceNumber": invoice,
        }
        r = rq.post(url, json=body, headers=cls._auth_headers(), timeout=25)
        data = r.json()
        if data.get("statusCode") != "0000":
            raise RuntimeError(f"bKash createPayment failed: {data.get('statusMessage')}")
        return data

    @classmethod
    def execute_payment(cls, paymentID):
        url = f"{BKASH_BASE_URL}/tokenized/checkout/payment/execute"
        r = rq.post(url, json={"paymentID": paymentID},
                    headers=cls._auth_headers(), timeout=25)
        return r.json()

    @classmethod
    def query_payment(cls, paymentID):
        url = f"{BKASH_BASE_URL}/tokenized/checkout/payment/query/{paymentID}"
        r = rq.get(url, headers=cls._auth_headers(), timeout=25)
        return r.json()

# =========================================================
#  Seed
# =========================================================
def seed():
    if not load(ADMINS_FILE, None):
        save(ADMINS_FILE, [{
            "id": str(uuid.uuid4()),
            "email": "adminsarker@gmail.com", "password": hpw("admin@123"),
            "name": "Root Superadmin", "role": "superadmin", "status": "active",
            "theme": "dark", "avatar": None, "twofa_enabled": False,
            "twofa_secret": None, "created": now_iso(),
        }])
    if not load(USERS_FILE, None):
        save(USERS_FILE, [{
            "id": str(uuid.uuid4()),
            "email": "user@demo.com", "password": hpw("user@123"),
            "name": "Demo User", "role": "user", "status": "active",
            "theme": "dark", "avatar": None, "twofa_enabled": False,
            "twofa_secret": None, "created": now_iso(),
        }])
    get_roles()
    if not load(PLANS_FILE, None): save(PLANS_FILE, DEFAULT_PLANS)
    if load(SUBS_FILE, None) is None:
        subs = {}
        now = datetime.utcnow()
        for u in load(USERS_FILE, []):
            subs[u["email"]] = {
                "email": u["email"], "plan_id": "free", "plans": ["free"],
                "started_at": now.isoformat() + "Z",
                "expires_at": (now + timedelta(days=36500)).isoformat() + "Z",
                "status": "active", "auto_renew": True, "history": [],
            }
        save(SUBS_FILE, subs)
seed()

# =========================================================
#  Decorators
# =========================================================
def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if not session.get("email"): return jsonify({"error": "Unauthorized"}), 401
        return f(*a, **k)
    return w

def admin_required(f):
    @wraps(f)
    def w(*a, **k):
        if not session.get("email"):       return jsonify({"error": "Unauthorized"}), 401
        if session.get("kind") != "admin": return jsonify({"error": "Admin access required"}), 403
        return f(*a, **k)
    return w

def permission_required(perm):
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            if not session.get("email"):       return jsonify({"error": "Unauthorized"}), 401
            if session.get("kind") != "admin": return jsonify({"error": "Admin access required"}), 403
            if not has_perm(session.get("subrole", "viewer"), perm):
                return jsonify({"error": f"Permission denied: {perm}"}), 403
            return f(*a, **k)
        return w
    return deco

def current_user_disabled():
    """Return True if the current session's user is disabled."""
    if session.get("kind") == "admin":
        return False
    user = find_by_email(load(USERS_FILE, []), session.get("email", ""))
    return bool(user and user.get("status") and user["status"] != "active")

def block_if_disabled(allow_ticket=False):
    """Decorator: block disabled users from any endpoint except tickets."""
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            if current_user_disabled() and not allow_ticket:
                return jsonify({"error": "Account disabled. Only support tickets are available."}), 403
            return f(*a, **k)
        return w
    return deco

# =========================================================
#  PAGES
# =========================================================
@app.route("/")
def root():
    if session.get("email"):
        return redirect("/admin" if session.get("kind") == "admin" else "/user")
    return send_from_directory(STATIC_DIR, "landing.html")

@app.route("/landing")
def landing_page():
    """Always serve landing even if user is logged in."""
    return send_from_directory(STATIC_DIR, "landing.html")

@app.route("/admin")
def admin_page():
    if session.get("kind") != "admin": return redirect("/")
    return send_from_directory(STATIC_DIR, "admin.html")

@app.route("/user")
def user_page():
    if not session.get("email"): return redirect("/")
    return send_from_directory(STATIC_DIR, "user.html")

@app.route("/avatars/<path:filename>")
def avatar_file(filename):
    return send_from_directory(AVATAR_DIR, filename)

@app.route("/uploads/<path:filename>")
def upload_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# =========================================================
#  AUTH
# =========================================================
def _complete_login(acc, kind):
    session.clear()
    session["email"] = acc["email"]
    session["kind"]  = kind
    session["role"]  = "admin" if kind == "admin" else "user"
    session["name"]  = acc.get("name", kind.title())
    session["id"]    = acc["id"]
    if kind == "admin":
        session["subrole"] = acc.get("role", "viewer")

@app.route("/api/login", methods=["POST"])
def api_login():
    d = request.get_json() or {}
    email = (d.get("email") or "").strip().lower()
    pw = d.get("password") or ""
    if not email or not pw: return jsonify({"error": "Email & password required"}), 400
    admin = find_by_email(load(ADMINS_FILE, []), email)
    user  = find_by_email(load(USERS_FILE, []), email)
    acc, kind = None, None
    if admin and admin["password"] == hpw(pw):   acc, kind = admin, "admin"
    elif user and user["password"] == hpw(pw):   acc, kind = user, "user"
    if not acc: return jsonify({"error": "Invalid credentials"}), 401
    if acc.get("status") and acc["status"] != "active" and kind == "admin":
        return jsonify({"error": "Account is not active"}), 403
    # Note: for users we allow login even if disabled (limited mode)
    if acc.get("twofa_enabled") and acc.get("twofa_secret"):
        session["pending_2fa_email"] = acc["email"]
        session["pending_2fa_kind"]  = kind
        return jsonify({"ok": False, "need2fa": True})
    _complete_login(acc, kind)
    push_activity(acc["email"], f"signed in as {kind}")
    return jsonify({"ok": True, "role": kind, "subrole": acc.get("role"),
                    "name": acc.get("name"), "email": acc["email"],
                    "theme": acc.get("theme", "dark"),
                    "status": acc.get("status", "active")})

@app.route("/api/login/2fa", methods=["POST"])
def api_login_2fa():
    pending = session.get("pending_2fa_email"); kind = session.get("pending_2fa_kind")
    if not pending: return jsonify({"error": "No pending 2FA session"}), 400
    d = request.get_json() or {}; code = (d.get("code") or "").strip()
    if not code: return jsonify({"error": "Code required"}), 400
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    acc = find_by_email(load(path, []), pending)
    if not acc or not acc.get("twofa_secret"): return jsonify({"error": "Account not found"}), 404
    if not pyotp.TOTP(acc["twofa_secret"]).verify(code, valid_window=1):
        return jsonify({"error": "Invalid 2FA code"}), 401
    _complete_login(acc, kind)
    push_activity(acc["email"], "signed in with 2FA")
    return jsonify({"ok": True, "role": kind, "subrole": acc.get("role"),
                    "name": acc.get("name"), "email": acc["email"],
                    "theme": acc.get("theme", "dark"),
                    "status": acc.get("status", "active")})

@app.route("/api/logout", methods=["POST"])
def api_logout():
    if session.get("email"): push_activity(session["email"], "signed out")
    session.clear(); return jsonify({"ok": True})

@app.route("/api/me")
@login_required
def api_me():
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    acc = find_by_email(load(path, []), session["email"])
    if not acc: return jsonify({"error": "Account not found"}), 404
    out = strip(acc)
    out["kind"] = kind
    if kind == "admin":
        out["permissions"] = user_permissions(out.get("role", "viewer"))
        role_def = get_roles().get(out.get("role", "viewer"), {})
        out["role_label"] = role_def.get("label", "Admin")
    else:
        sub = ensure_subscription(out["email"])
        plans = get_plans()
        out["subscription"] = sub
        out["plans_active"] = [plans.get(pid) for pid in sub.get("plans", []) if plans.get(pid)]
        out["plan"] = get_user_plan(out["email"])
        out["role_label"] = out["plan"]["name"] if out["plan"] else "User"
    return jsonify(out)

@app.route("/api/me", methods=["PUT"])
@login_required
def api_update_me():
    d = request.get_json() or {}
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if not me: return jsonify({"error": "Account not found"}), 404
    if d.get("email"):
        new = d["email"].strip().lower()
        if new != me["email"]:
            other = USERS_FILE if kind == "admin" else ADMINS_FILE
            if find_by_email(store, new) or find_by_email(load(other, []), new):
                return jsonify({"error": "Email already in use"}), 409
            me["email"] = new; session["email"] = new
    if d.get("name"): me["name"] = d["name"].strip(); session["name"] = me["name"]
    if d.get("password"): me["password"] = hpw(d["password"])
    if d.get("theme") in ("dark","light"): me["theme"] = d["theme"]
    save(path, store); push_activity(session["email"], "updated profile")
    return jsonify({"ok": True, "user": strip(me)})

# =========================================================
#  Avatar
# =========================================================
@app.route("/api/avatar", methods=["POST"])
@login_required
def api_avatar_upload():
    f = request.files.get("avatar")
    if not f or f.filename == "": return jsonify({"error": "No file"}), 400
    if not allowed_img(f.filename): return jsonify({"error": "Bad file type"}), 400
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if not me: return jsonify({"error": "Account not found"}), 404
    if me.get("avatar"):
        old = os.path.join(AVATAR_DIR, os.path.basename(me["avatar"]))
        if os.path.exists(old):
            try: os.remove(old)
            except: pass
    ext = f.filename.rsplit(".", 1)[1].lower()
    fname = f"{me['id']}-{int(time.time())}.{ext}"
    f.save(os.path.join(AVATAR_DIR, fname))
    me["avatar"] = fname; save(path, store)
    push_activity(me["email"], "uploaded avatar")
    return jsonify({"ok": True, "avatar": fname, "url": f"/avatars/{fname}"})

@app.route("/api/avatar", methods=["DELETE"])
@login_required
def api_avatar_delete():
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if me and me.get("avatar"):
        old = os.path.join(AVATAR_DIR, os.path.basename(me["avatar"]))
        if os.path.exists(old):
            try: os.remove(old)
            except: pass
        me["avatar"] = None; save(path, store)
        push_activity(me["email"], "removed avatar")
    return jsonify({"ok": True})

# =========================================================
#  2FA
# =========================================================
@app.route("/api/2fa/setup", methods=["POST"])
@login_required
def api_2fa_setup():
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if not me: return jsonify({"error": "Account not found"}), 404
    secret = pyotp.random_base32()
    me["twofa_secret"] = secret; me["twofa_enabled"] = False
    save(path, store)
    uri = pyotp.TOTP(secret).provisioning_uri(name=me["email"], issuer_name="PanelDemo")
    img = qrcode.make(uri); buf = io.BytesIO(); img.save(buf, format="PNG")
    return jsonify({"ok": True, "secret": secret,
                    "qr": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                    "uri": uri})

@app.route("/api/2fa/enable", methods=["POST"])
@login_required
def api_2fa_enable():
    d = request.get_json() or {}; code = (d.get("code") or "").strip()
    if not code: return jsonify({"error": "Code required"}), 400
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if not me or not me.get("twofa_secret"): return jsonify({"error": "Setup first"}), 400
    if not pyotp.TOTP(me["twofa_secret"]).verify(code, valid_window=1):
        return jsonify({"error": "Invalid code"}), 401
    me["twofa_enabled"] = True; save(path, store)
    push_activity(me["email"], "enabled 2FA")
    return jsonify({"ok": True})

@app.route("/api/2fa/disable", methods=["POST"])
@login_required
def api_2fa_disable():
    d = request.get_json() or {}; pw = d.get("password") or ""
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if not me: return jsonify({"error": "Account not found"}), 404
    if hpw(pw) != me["password"]: return jsonify({"error": "Wrong password"}), 401
    me["twofa_enabled"] = False; me["twofa_secret"] = None
    save(path, store); push_activity(me["email"], "disabled 2FA")
    return jsonify({"ok": True})

# =========================================================
#  Notifications
# =========================================================
@app.route("/api/notifications")
@login_required
def api_notifications():
    all_n = load(NOTIF_FILE, [])
    mine = [n for n in all_n if n["to"] in (session["email"], "*")]
    mine.sort(key=lambda x: x["at"], reverse=True)
    if request.args.get("unread") == "1":
        mine = [n for n in mine if not n.get("read")]
    return jsonify(mine[:100])

@app.route("/api/notifications/read", methods=["POST"])
@login_required
def api_notifications_read():
    d = request.get_json() or {}; ids = d.get("ids")
    all_n = load(NOTIF_FILE, [])
    for n in all_n:
        if n["to"] not in (session["email"], "*"): continue
        if ids is None or n["id"] in ids: n["read"] = True
    save(NOTIF_FILE, all_n); return jsonify({"ok": True})

@app.route("/api/notifications/send", methods=["POST"])
@permission_required("broadcast.send")
def api_notifications_send():
    d = request.get_json() or {}
    to = (d.get("to") or "").strip()
    title = (d.get("title") or "").strip()
    body = (d.get("body") or "").strip()
    kind = d.get("kind", "info")
    if not title or not body: return jsonify({"error": "Title and body required"}), 400
    targets = [u["email"] for u in load(USERS_FILE, [])] if to in ("", "*", "all") else [to]
    for t in targets:
        push_notification(t, title, body, sender=session["email"], kind=kind)
    push_activity(session["email"], f"broadcast to {len(targets)} recipients")
    return jsonify({"ok": True, "sent": len(targets)})

# =========================================================
#  ROLES
# =========================================================
@app.route("/api/roles")
@admin_required
def api_list_roles():
    return jsonify({"roles": list(get_roles().values()),
                    "permissions": ALL_PERMISSIONS})

@app.route("/api/roles", methods=["POST"])
@permission_required("roles.manage")
def api_create_role():
    d = request.get_json() or {}
    name = (d.get("name") or "").strip().lower().replace(" ", "_")
    if not name or not name.replace("_","").isalnum():
        return jsonify({"error": "Invalid role name"}), 400
    roles = get_roles()
    if name in roles: return jsonify({"error": "Role already exists"}), 409
    perms = [p for p in (d.get("permissions") or []) if p in ALL_PERMISSIONS]
    roles[name] = {"name": name, "label": (d.get("label") or name.title()).strip(),
                   "color": d.get("color") or "#00ff9d", "built_in": False,
                   "permissions": perms}
    save(ROLES_FILE, roles)
    push_activity(session["email"], f"created role '{name}'")
    return jsonify({"ok": True, "role": roles[name]}), 201

@app.route("/api/roles/<name>", methods=["PUT"])
@permission_required("roles.manage")
def api_update_role(name):
    d = request.get_json() or {}
    roles = get_roles()
    if name not in roles: return jsonify({"error": "Role not found"}), 404
    r = roles[name]
    if not r.get("built_in"):
        if "label" in d: r["label"] = d["label"].strip()
        if "color" in d: r["color"] = d["color"]
    if "permissions" in d:
        r["permissions"] = [p for p in d["permissions"] if p in ALL_PERMISSIONS]
    save(ROLES_FILE, roles)
    push_activity(session["email"], f"updated role '{name}'")
    return jsonify({"ok": True, "role": r})

@app.route("/api/roles/<name>", methods=["DELETE"])
@permission_required("roles.manage")
def api_delete_role(name):
    roles = get_roles()
    if name not in roles: return jsonify({"error": "Role not found"}), 404
    if roles[name].get("built_in"): return jsonify({"error": "Cannot delete built-in role"}), 400
    if any(a.get("role") == name for a in load(ADMINS_FILE, [])):
        return jsonify({"error": "Role is in use"}), 400
    del roles[name]; save(ROLES_FILE, roles)
    push_activity(session["email"], f"deleted role '{name}'")
    return jsonify({"ok": True})

# =========================================================
#  USERS
# =========================================================
@app.route("/api/users")
@admin_required
def api_list_users():
    users = load(USERS_FILE, [])
    r = paginate(users, q=request.args.get("q"),
                 search_fields=["name","email"],
                 filters={"status": request.args.get("status")},
                 sort=request.args.get("sort","created"),
                 order=request.args.get("order","desc"),
                 page=request.args.get("page",1),
                 limit=request.args.get("limit",10))
    # mask email in list view for safety
    r["items"] = [strip(u) for u in r["items"]]
    return jsonify(r)

@app.route("/api/users", methods=["POST"])
@permission_required("users.create")
def api_create_user():
    d = request.get_json() or {}
    email = (d.get("email") or "").strip().lower()
    pw = d.get("password") or ""
    name = (d.get("name") or "").strip() or email
    if not email or not pw: return jsonify({"error": "Email & password required"}), 400
    if find_by_email(load(USERS_FILE, []), email) or find_by_email(load(ADMINS_FILE, []), email):
        return jsonify({"error": "Email already exists"}), 409
    store = load(USERS_FILE, [])
    u = {"id": str(uuid.uuid4()), "email": email, "password": hpw(pw), "name": name,
         "role": "user", "status": d.get("status","active"),
         "theme": "dark", "avatar": None, "twofa_enabled": False,
         "twofa_secret": None, "created": now_iso()}
    store.append(u); save(USERS_FILE, store)
    push_activity(session["email"], f"created user {email}")
    push_notification(email, "Welcome!", f"Account created by {session['email']}.",
                      sender=session["email"], kind="success")
    return jsonify({"ok": True, "user": strip(u)}), 201

@app.route("/api/users/<uid>", methods=["GET"])
@admin_required
def api_get_user(uid):
    u = find_by_id(load(USERS_FILE, []), uid)
    if not u: return jsonify({"error": "User not found"}), 404
    return jsonify(strip(u))

@app.route("/api/users/<uid>", methods=["PUT"])
@permission_required("users.edit")
def api_update_user(uid):
    d = request.get_json() or {}
    store = load(USERS_FILE, []); u = find_by_id(store, uid)
    if not u: return jsonify({"error": "User not found"}), 404
    # Only allow status update from admin UI (not name/email/password)
    if "status" in d: u["status"] = d["status"]
    save(USERS_FILE, store)
    push_activity(session["email"], f"updated user status → {u['status']}")
    return jsonify({"ok": True, "user": strip(u)})

@app.route("/api/users/<uid>/reset-password", methods=["POST"])
@permission_required("users.edit")
def api_reset_user_password(uid):
    d = request.get_json() or {}
    new_pw = (d.get("password") or "").strip()
    if len(new_pw) < 6: return jsonify({"error": "Password min 6 chars"}), 400
    store = load(USERS_FILE, []); u = find_by_id(store, uid)
    if not u: return jsonify({"error": "User not found"}), 404
    u["password"] = hpw(new_pw); save(USERS_FILE, store)
    push_activity(session["email"], f"reset password for {u['email']}")
    push_notification(u["email"], "Password reset",
                      "Your password was reset by an administrator.",
                      sender=session["email"], kind="security")
    return jsonify({"ok": True})

@app.route("/api/users/<uid>", methods=["DELETE"])
@permission_required("users.delete")
def api_delete_user(uid):
    store = load(USERS_FILE, []); u = find_by_id(store, uid)
    if not u: return jsonify({"error": "User not found"}), 404
    save(USERS_FILE, [x for x in store if x["id"] != uid])
    push_activity(session["email"], f"deleted user {u['email']}")
    return jsonify({"ok": True})

@app.route("/api/users/bulk", methods=["POST"])
@permission_required("users.edit")
def api_bulk_users():
    d = request.get_json() or {}
    ids = set(d.get("ids") or []); action = d.get("action")
    if not ids or action not in ("delete","activate","disable"):
        return jsonify({"error": "ids and action required"}), 400
    if action == "delete" and not has_perm(session.get("subrole"), "users.delete"):
        return jsonify({"error": "Delete requires users.delete"}), 403
    store = load(USERS_FILE, [])
    if action == "delete":
        store = [u for u in store if u["id"] not in ids]
    else:
        for u in store:
            if u["id"] in ids:
                u["status"] = "active" if action == "activate" else "disabled"
    save(USERS_FILE, store)
    push_activity(session["email"], f"bulk {action} on {len(ids)} user(s)")
    return jsonify({"ok": True, "affected": len(ids)})

# =========================================================
#  ADMINS
# =========================================================
@app.route("/api/admins")
@admin_required
def api_list_admins():
    admins = load(ADMINS_FILE, [])
    r = paginate(admins, q=request.args.get("q"),
                 search_fields=["name","email"],
                 sort=request.args.get("sort","created"),
                 order=request.args.get("order","desc"),
                 page=request.args.get("page",1),
                 limit=request.args.get("limit",10))
    r["items"] = [strip(a) for a in r["items"]]
    return jsonify(r)

@app.route("/api/admins", methods=["POST"])
@permission_required("admins.manage")
def api_create_admin():
    d = request.get_json() or {}
    email = (d.get("email") or "").strip().lower()
    pw = d.get("password") or ""
    name = (d.get("name") or "").strip() or email
    role = d.get("role", "viewer")
    if role not in get_roles(): role = "viewer"
    if not email or not pw: return jsonify({"error": "Email & password required"}), 400
    if find_by_email(load(ADMINS_FILE, []), email) or find_by_email(load(USERS_FILE, []), email):
        return jsonify({"error": "Email already exists"}), 409
    store = load(ADMINS_FILE, [])
    a = {"id": str(uuid.uuid4()), "email": email, "password": hpw(pw), "name": name,
         "role": role, "status": "active", "theme": "dark", "avatar": None,
         "twofa_enabled": False, "twofa_secret": None, "created": now_iso()}
    store.append(a); save(ADMINS_FILE, store)
    push_activity(session["email"], f"created admin {email} ({role})")
    return jsonify({"ok": True, "admin": strip(a)}), 201

@app.route("/api/admins/<uid>", methods=["PUT"])
@permission_required("admins.manage")
def api_update_admin(uid):
    d = request.get_json() or {}
    store = load(ADMINS_FILE, []); a = find_by_id(store, uid)
    if not a: return jsonify({"error": "Admin not found"}), 404
    if d.get("email"):
        new = d["email"].strip().lower()
        if new != a["email"] and (find_by_email(store, new) or
                                   find_by_email(load(USERS_FILE, []), new)):
            return jsonify({"error": "Email already in use"}), 409
        a["email"] = new
    if d.get("name"):     a["name"] = d["name"].strip()
    if d.get("password"): a["password"] = hpw(d["password"])
    if d.get("role") in get_roles():
        if a["id"] == session.get("id") and d["role"] != "superadmin":
            supers = [x for x in store if x.get("role") == "superadmin"]
            if len(supers) <= 1:
                return jsonify({"error": "Cannot demote last superadmin"}), 400
        a["role"] = d["role"]
        if a["id"] == session.get("id"): session["subrole"] = a["role"]
    save(ADMINS_FILE, store)
    if a["id"] == session.get("id"):
        session["email"] = a["email"]; session["name"] = a["name"]
    push_activity(session["email"], f"updated admin {a['email']}")
    return jsonify({"ok": True, "admin": strip(a)})

@app.route("/api/admins/<uid>", methods=["DELETE"])
@permission_required("admins.manage")
def api_delete_admin(uid):
    if uid == session.get("id"): return jsonify({"error": "Cannot delete yourself"}), 400
    store = load(ADMINS_FILE, []); a = find_by_id(store, uid)
    if not a: return jsonify({"error": "Admin not found"}), 404
    if a.get("role") == "superadmin" and \
       len([x for x in store if x.get("role") == "superadmin"]) <= 1:
        return jsonify({"error": "Cannot delete last superadmin"}), 400
    save(ADMINS_FILE, [x for x in store if x["id"] != uid])
    push_activity(session["email"], f"deleted admin {a['email']}")
    return jsonify({"ok": True})

# =========================================================
#  ACTIVITY
# =========================================================
@app.route("/api/activity")
@login_required
def api_activity():
    log = load(ACTIVITY_FILE, [])
    if session.get("kind") != "admin":
        log = [x for x in log if x.get("who") == session.get("email")]
    else:
        if not has_perm(session.get("subrole", "viewer"), "activity.view_all"):
            log = [x for x in log if x.get("who") == session.get("email")]
    r = paginate(log, q=request.args.get("q"),
                 search_fields=["who","action"],
                 sort=request.args.get("sort","at"),
                 order=request.args.get("order","desc"),
                 page=request.args.get("page",1),
                 limit=request.args.get("limit",5))
    return jsonify(r)

# =========================================================
#  TICKETS
# =========================================================
@app.route("/api/tickets")
@login_required
def api_list_tickets():
    store = load(TICKETS_FILE, [])
    if session.get("kind") != "admin":
        store = [t for t in store if t.get("user_email") == session["email"]]
    r = paginate(store, q=request.args.get("q"),
                 search_fields=["subject","user_email","user_name"],
                 filters={"status": request.args.get("status"),
                          "priority": request.args.get("priority")},
                 sort=request.args.get("sort","updated"),
                 order=request.args.get("order","desc"),
                 page=request.args.get("page",1),
                 limit=request.args.get("limit",10))
    # strip emails from list
    for t in r["items"]:
        t.pop("user_email", None)
        for m in t.get("messages", []):
            m.pop("from_email", None)
    return jsonify(r)

@app.route("/api/tickets/<tid>", methods=["GET"])
@login_required
def api_get_ticket(tid):
    store = load(TICKETS_FILE, [])
    t = next((x for x in store if x["id"] == tid), None)
    if not t: return jsonify({"error": "Ticket not found"}), 404
    if session.get("kind") != "admin" and t.get("user_email") != session["email"]:
        return jsonify({"error": "Not your ticket"}), 403
    t2 = dict(t); t2.pop("user_email", None)
    for m in t2.get("messages", []): m.pop("from_email", None)
    return jsonify(t2)

@app.route("/api/tickets", methods=["POST"])
@login_required
def api_create_ticket():
    d = request.get_json() or {}
    subject = (d.get("subject") or "").strip()
    body = (d.get("body") or "").strip()
    priority = d.get("priority", "normal")
    attachments = d.get("attachments") or []
    if not subject or not body: return jsonify({"error": "Subject and body required"}), 400
    me = find_by_email(load(USERS_FILE if session.get("kind")!="admin" else ADMINS_FILE, []),
                       session["email"])
    t = {"id": str(uuid.uuid4()),
         "user_email": session["email"],
         "user_name": me.get("name") if me else session.get("name", "User"),
         "subject": subject,
         "priority": priority if priority in ("low","normal","high") else "normal",
         "status": "open", "created": now_iso(), "updated": now_iso(),
         "messages": [{"id": str(uuid.uuid4()),
                       "from_name": me.get("name") if me else "User",
                       "from_role": session.get("kind"),
                       "body": body, "attachments": attachments,
                       "at": now_iso()}]}
    store = load(TICKETS_FILE, []); store.insert(0, t); save(TICKETS_FILE, store)
    push_activity(session["email"], f"opened ticket '{subject}'")
    for a in load(ADMINS_FILE, []):
        push_notification(a["email"], f"New ticket: {subject}",
                          f"{t['user_name']} opened a ticket.",
                          sender="system", kind="ticket",
                          redirect_view="tickets", redirect_id=t["id"])
    return jsonify({"ok": True, "ticket": t}), 201

@app.route("/api/tickets/<tid>/reply", methods=["POST"])
@login_required
def api_reply_ticket(tid):
    d = request.get_json() or {}
    body = (d.get("body") or "").strip()
    attachments = d.get("attachments") or []
    if not body and not attachments:
        return jsonify({"error": "Reply body or attachment required"}), 400
    store = load(TICKETS_FILE, [])
    t = next((x for x in store if x["id"] == tid), None)
    if not t: return jsonify({"error": "Ticket not found"}), 404
    if session.get("kind") != "admin" and t.get("user_email") != session["email"]:
        return jsonify({"error": "Not your ticket"}), 403
    if session.get("kind") == "admin" and not has_perm(session.get("subrole"), "tickets.reply"):
        return jsonify({"error": "tickets.reply permission required"}), 403
    # closed ticket guard
    if t.get("status") == "closed" and session.get("kind") != "admin":
        return jsonify({"error": "Ticket is closed. Only admin can reopen."}), 403
    me = find_by_email(load(USERS_FILE if session.get("kind")!="admin" else ADMINS_FILE, []),
                       session["email"])
    msg = {"id": str(uuid.uuid4()),
           "from_name": me.get("name") if me else session.get("name"),
           "from_role": session.get("kind"),
           "body": body, "attachments": attachments, "at": now_iso()}
    t["messages"].append(msg); t["updated"] = msg["at"]
    if session.get("kind") == "admin" and t["status"] == "open":
        t["status"] = "in_progress"
    save(TICKETS_FILE, store)
    if session.get("kind") == "admin":
        push_notification(t["user_email"], f"Re: {t['subject']}",
                          "Admin replied.", sender="system", kind="ticket",
                          redirect_view="tickets", redirect_id=t["id"])
    else:
        for a in load(ADMINS_FILE, []):
            push_notification(a["email"], f"Re: {t['subject']}",
                              f"{msg['from_name']} replied.",
                              sender="system", kind="ticket",
                              redirect_view="tickets", redirect_id=t["id"])
    push_activity(session["email"], f"replied to ticket {tid[:8]}")
    t2 = dict(t); t2.pop("user_email", None)
    for m in t2.get("messages", []): m.pop("from_email", None)
    return jsonify({"ok": True, "ticket": t2})

@app.route("/api/tickets/<tid>", methods=["PUT"])
@permission_required("tickets.manage")
def api_update_ticket(tid):
    d = request.get_json() or {}
    store = load(TICKETS_FILE, []); t = next((x for x in store if x["id"] == tid), None)
    if not t: return jsonify({"error": "Ticket not found"}), 404
    if d.get("status") in ("open","in_progress","closed"):
        t["status"] = d["status"]; t["updated"] = now_iso()
    save(TICKETS_FILE, store)
    push_activity(session["email"], f"updated ticket → {t['status']}")
    return jsonify({"ok": True, "ticket": t})

# =========================================================
#  Ticket attachments
# =========================================================
@app.route("/api/upload/ticket", methods=["POST"])
@login_required
def api_ticket_upload():
    f = request.files.get("file")
    if not f or f.filename == "": return jsonify({"error": "No file"}), 400
    if not allowed_attach(f.filename):
        return jsonify({"error": "File type not allowed"}), 400
    ext = f.filename.rsplit(".", 1)[1].lower()
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    f.save(os.path.join(UPLOAD_DIR, safe_name))
    return jsonify({
        "ok": True,
        "url": f"/uploads/{safe_name}",
        "name": f.filename,
        "size": os.path.getsize(os.path.join(UPLOAD_DIR, safe_name)),
        "ext": ext,
    })

# =========================================================
#  API TESTER
# =========================================================
@app.route("/api/tester/send", methods=["POST"])
@permission_required("api_tester.use")
def api_tester_send():
    d = request.get_json() or {}
    method = (d.get("method") or "GET").upper()
    url = (d.get("url") or "").strip()
    params = d.get("params") or {}
    headers = d.get("headers") or {}
    body = d.get("body") or ""
    if method not in ("GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"):
        return jsonify({"error": "Invalid HTTP method"}), 400
    if not url.startswith(("http://","https://")):
        return jsonify({"error": "URL must start with http:// or https://"}), 400
    if is_private_url(url):
        return jsonify({"error": "Blocked: private hosts"}), 400
    # merge params
    if params:
        from urllib.parse import urlencode, urlparse as _up, parse_qs, urlunparse
        u = _up(url); qs = parse_qs(u.query)
        for k, v in params.items():
            if v != "": qs[k] = [v]
        new_q = urlencode({k: v[0] if isinstance(v, list) else v for k, v in qs.items()})
        url = urlunparse((u.scheme, u.netloc, u.path, u.params, new_q, u.fragment))
    t0 = time.time()
    try:
        resp = rq.request(method, url, headers=headers,
                          data=body.encode() if body else None,
                          timeout=20, verify=False, allow_redirects=True)
        duration_ms = int((time.time() - t0) * 1000)
        result = {"status": resp.status_code, "status_text": resp.reason,
                  "headers": dict(resp.headers), "body": resp.text[:200000],
                  "size": len(resp.content), "time_ms": duration_ms}
        hist = load(API_HISTORY_FILE, [])
        hist.insert(0, {"id": str(uuid.uuid4()), "by": session["email"],
                        "method": method, "url": url,
                        "headers": json.dumps(headers)[:2000], "body": body[:2000],
                        "params": json.dumps(params)[:1000],
                        "response_status": resp.status_code,
                        "duration_ms": duration_ms, "at": now_iso()})
        save(API_HISTORY_FILE, hist[:200])
        return jsonify(result)
    except rq.exceptions.RequestException as e:
        return jsonify({"error": f"Request failed: {e}"}), 500

@app.route("/api/tester/history")
@permission_required("api_tester.use")
def api_tester_history():
    hist = load(API_HISTORY_FILE, [])
    hist = [h for h in hist if h.get("by") == session["email"]]
    return jsonify(hist[:100])

@app.route("/api/tester/history", methods=["DELETE"])
@permission_required("api_tester.use")
def api_tester_history_clear():
    hist = load(API_HISTORY_FILE, [])
    hist = [h for h in hist if h.get("by") != session["email"]]
    save(API_HISTORY_FILE, hist)
    return jsonify({"ok": True})

@app.route("/api/tester/collections")
@permission_required("api_tester.save")
def api_tester_collections():
    cols = load(COLLECTIONS_FILE, [])
    return jsonify([c for c in cols if c.get("by") == session["email"]])

@app.route("/api/tester/collections", methods=["POST"])
@permission_required("api_tester.save")
def api_tester_collection_create():
    d = request.get_json() or {}; name = (d.get("name") or "").strip()
    if not name: return jsonify({"error": "Name required"}), 400
    cols = load(COLLECTIONS_FILE, [])
    c = {"id": str(uuid.uuid4()), "name": name, "by": session["email"], "created": now_iso()}
    cols.append(c); save(COLLECTIONS_FILE, cols); return jsonify(c), 201

@app.route("/api/tester/collections/<cid>", methods=["DELETE"])
@permission_required("api_tester.save")
def api_tester_collection_delete(cid):
    cols = load(COLLECTIONS_FILE, [])
    cols = [c for c in cols if not (c["id"] == cid and c["by"] == session["email"])]
    save(COLLECTIONS_FILE, cols)
    reqs = load(SAVED_REQ_FILE, [])
    reqs = [r for r in reqs if not (r.get("collection_id") == cid and r["by"] == session["email"])]
    save(SAVED_REQ_FILE, reqs); return jsonify({"ok": True})

@app.route("/api/tester/requests")
@permission_required("api_tester.save")
def api_tester_requests():
    reqs = load(SAVED_REQ_FILE, [])
    return jsonify([r for r in reqs if r.get("by") == session["email"]])

@app.route("/api/tester/requests", methods=["POST"])
@permission_required("api_tester.save")
def api_tester_request_save():
    d = request.get_json() or {}; name = (d.get("name") or "").strip()
    if not name: return jsonify({"error": "Name required"}), 400
    reqs = load(SAVED_REQ_FILE, [])
    r = {"id": str(uuid.uuid4()), "by": session["email"], "name": name,
         "collection_id": d.get("collection_id") or None,
         "method": d.get("method", "GET"), "url": d.get("url", ""),
         "headers": d.get("headers", ""), "body": d.get("body", ""),
         "params": d.get("params", ""), "created": now_iso()}
    reqs.append(r); save(SAVED_REQ_FILE, reqs); return jsonify(r), 201

@app.route("/api/tester/requests/<rid>", methods=["PUT"])
@permission_required("api_tester.save")
def api_tester_request_update(rid):
    d = request.get_json() or {}
    reqs = load(SAVED_REQ_FILE, [])
    for r in reqs:
        if r["id"] == rid and r["by"] == session["email"]:
            for k in ("name","method","url","headers","body","params","collection_id"):
                if k in d: r[k] = d[k]
            save(SAVED_REQ_FILE, reqs); return jsonify(r)
    return jsonify({"error": "Not found"}), 404

@app.route("/api/tester/requests/<rid>", methods=["DELETE"])
@permission_required("api_tester.save")
def api_tester_request_delete(rid):
    reqs = load(SAVED_REQ_FILE, [])
    reqs = [r for r in reqs if not (r["id"] == rid and r["by"] == session["email"])]
    save(SAVED_REQ_FILE, reqs); return jsonify({"ok": True})

# =========================================================
#  SHARED APIs  (URL hidden, params-driven, plan-gated)
# =========================================================
def _public_shared(s, user_email):
    """Return user-safe version — URL & secret params hidden."""
    usage_all = load(API_USAGE_FILE, {})
    my_usage = usage_all.get(s["id"], {}).get(user_email, {})
    limit, period = _effective_limit(user_email, s)
    used = 0
    if period == "day":
        today = datetime.utcnow().date().isoformat()
        if my_usage.get("day_date") == today: used = my_usage.get("day_used", 0)
    else:
        used = my_usage.get("total_used", 0)
    remaining = None if limit is None else max(0, limit - used)
    return {
        "id": s["id"], "name": s["name"], "description": s.get("description",""),
        "method": s.get("method"), "enabled": s.get("enabled"),
        "params": s.get("params") or [],
        "credit_limit": limit, "credit_period": period,
        "used": used, "remaining": remaining,
        "expires_at": s.get("expires_at"),
        "show_url": s.get("show_url", False),
        "url_masked": (s.get("url","") if s.get("show_url") else None),
        "has_secret": bool(s.get("secret_params")),
    }

def _effective_limit(user_email, shared):
    """Compute limit based on user's plan(s) + per-API override."""
    sub = ensure_subscription(user_email)
    active_pids = sub.get("plans", [])
    plans = get_plans()
    # check per-API overrides first
    overrides = shared.get("request_limit_per_plan") or {}
    best_limit = None; best_period = shared.get("credit_period", "day")
    for pid in active_pids:
        if pid in overrides:
            val = overrides[pid]
            if val is None: return None, best_period
            if best_limit is None or (isinstance(val, int) and val > best_limit):
                best_limit = val
    if best_limit is not None:
        return best_limit, best_period
    # fall back to API's own credit limit
    api_limit = shared.get("credit_limit")
    if api_limit is not None:
        return api_limit, shared.get("credit_period", "total")
    # fall back to plan default
    best = None; bp = "day"
    for pid in active_pids:
        plan = plans.get(pid)
        if not plan: continue
        lim = plan.get("request_limit_per_url")
        if lim is None: return None, plan.get("request_period") or "day"
        if best is None or lim > best:
            best = lim; bp = plan.get("request_period") or "day"
    return (best if best is not None else 3), bp

@app.route("/api/shared")
@permission_required("api_share.manage")
def api_shared_list():
    items = load(SHARED_APIS_FILE, [])
    items.sort(key=lambda x: x.get("created",""), reverse=True)
    # admin sees full object (with URL, secrets)
    return jsonify(items)

@app.route("/api/shared", methods=["POST"])
@permission_required("api_share.manage")
def api_shared_create():
    d = request.get_json() or {}
    name = (d.get("name") or "").strip()
    url = (d.get("url") or "").strip()
    if not name or not url: return jsonify({"error": "Name & URL required"}), 400
    if not url.startswith(("http://","https://")):
        return jsonify({"error": "Invalid URL"}), 400
    if is_private_url(url):
        return jsonify({"error": "Blocked: private hosts"}), 400
    item = {
        "id": str(uuid.uuid4()),
        "name": name,
        "description": (d.get("description") or "").strip(),
        "method": (d.get("method") or "GET").upper(),
        "url": url,
        "params": d.get("params") or [],           # [{"name","label","type","required","default"}]
        "secret_params": d.get("secret_params") or {}, # {"key": "..."} — server-side only
        "headers": d.get("headers") or {},
        "body": d.get("body") or "",
        "enabled": bool(d.get("enabled", True)),
        "show_url": bool(d.get("show_url", False)),
        "allowed_users": d.get("allowed_users") or ["*"],
        "allowed_plans": d.get("allowed_plans") or [],  # if non-empty, only these plans
        "credit_limit": d.get("credit_limit"),           # int or null
        "credit_period": d.get("credit_period") or "day",
        "request_limit_per_plan": d.get("request_limit_per_plan") or {}, # {"free": 3, "pro": 100}
        "expires_at": d.get("expires_at") or None,
        "created_by": session["email"],
        "created": now_iso(),
    }
    items = load(SHARED_APIS_FILE, [])
    items.insert(0, item); save(SHARED_APIS_FILE, items)
    push_activity(session["email"], f"created shared API '{name}'")
    return jsonify(item), 201

@app.route("/api/shared/<sid>", methods=["PUT"])
@permission_required("api_share.manage")
def api_shared_update(sid):
    d = request.get_json() or {}
    items = load(SHARED_APIS_FILE, [])
    item = next((x for x in items if x["id"] == sid), None)
    if not item: return jsonify({"error": "Not found"}), 404
    for k in ("name","description","method","url","params","secret_params","headers","body",
              "enabled","show_url","allowed_users","allowed_plans","credit_limit",
              "credit_period","request_limit_per_plan","expires_at"):
        if k in d: item[k] = d[k]
    if item["url"] and not item["url"].startswith(("http://","https://")):
        return jsonify({"error": "Invalid URL"}), 400
    if item["url"] and is_private_url(item["url"]):
        return jsonify({"error": "Blocked URL"}), 400
    save(SHARED_APIS_FILE, items)
    push_activity(session["email"], f"updated shared API '{item['name']}'")
    return jsonify(item)

@app.route("/api/shared/<sid>", methods=["DELETE"])
@permission_required("api_share.manage")
def api_shared_delete(sid):
    items = load(SHARED_APIS_FILE, [])
    items = [x for x in items if x["id"] != sid]
    save(SHARED_APIS_FILE, items)
    usage = load(API_USAGE_FILE, {}); usage.pop(sid, None); save(API_USAGE_FILE, usage)
    return jsonify({"ok": True})

@app.route("/api/shared/<sid>/usage")
@permission_required("api_share.manage")
def api_shared_usage(sid):
    return jsonify(load(API_USAGE_FILE, {}).get(sid, {}))

@app.route("/api/shared/mine")
@login_required
def api_shared_mine():
    items = load(SHARED_APIS_FILE, [])
    email = session["email"]
    sub = ensure_subscription(email)
    my_plans = sub.get("plans", [])
    visible = []
    for it in items:
        if not it.get("enabled"): continue
        allowed = it.get("allowed_users") or ["*"]
        if "*" not in allowed and email not in allowed: continue
        # plan gating
        ap = it.get("allowed_plans") or []
        if ap and not any(pid in ap for pid in my_plans): continue
        # expiry
        if it.get("expires_at"):
            try:
                if datetime.fromisoformat(it["expires_at"].replace("Z","")) < datetime.utcnow():
                    continue
            except: pass
        visible.append(_public_shared(it, email))
    return jsonify(visible)

@app.route("/api/shared/<sid>/execute", methods=["POST"])
@login_required
@block_if_disabled()
def api_shared_execute(sid):
    items = load(SHARED_APIS_FILE, [])
    item = next((x for x in items if x["id"] == sid), None)
    if not item: return jsonify({"error": "Shared API not found"}), 404
    if not item.get("enabled"): return jsonify({"error": "Disabled"}), 403
    email = session["email"]
    allowed = item.get("allowed_users") or ["*"]
    if "*" not in allowed and email not in allowed:
        return jsonify({"error": "Access denied"}), 403
    sub = ensure_subscription(email)
    if (item.get("allowed_plans") or []) and \
       not any(pid in item["allowed_plans"] for pid in sub.get("plans", [])):
        return jsonify({"error": "Plan does not include this API"}), 403
    if item.get("expires_at"):
        try:
            if datetime.fromisoformat(item["expires_at"].replace("Z","")) < datetime.utcnow():
                return jsonify({"error": "Expired"}), 403
        except: pass

    # credit check
    usage_all = load(API_USAGE_FILE, {})
    api_usage = usage_all.setdefault(sid, {})
    my = api_usage.setdefault(email, {"total_used": 0, "day_used": 0, "day_date": ""})
    limit, period = _effective_limit(email, item)
    today = datetime.utcnow().date().isoformat()
    if my.get("day_date") != today:
        my["day_used"] = 0; my["day_date"] = today
    if limit is not None:
        used = my["day_used"] if period == "day" else my["total_used"]
        if used >= limit:
            return jsonify({"error": f"Limit reached ({used}/{limit} per {period})"}), 429

    # build URL: user params + secret params
    user_params = (request.get_json() or {}).get("params") or {}
    # validate required
    for p in item.get("params", []):
        if p.get("required") and not user_params.get(p["name"]):
            return jsonify({"error": f"Missing required param: {p.get('label', p['name'])}"}), 400
    merged = {**(item.get("secret_params") or {}), **user_params}
    url = item["url"]
    for k, v in merged.items():
        url = url.replace("{" + k + "}", quote(str(v), safe=""))
    headers = {**(item.get("headers") or {})}
    body = item.get("body") or ""

    t0 = time.time()
    try:
        resp = rq.request(item["method"], url, headers=headers,
                          data=body.encode() if body else None,
                          timeout=20, verify=False, allow_redirects=True)
        duration_ms = int((time.time() - t0) * 1000)
        my["total_used"] += 1
        my["day_used"]   += 1
        my["day_date"] = today
        save(API_USAGE_FILE, usage_all)
        push_activity(email, f"used shared API '{item['name']}'")
        return jsonify({"status": resp.status_code, "status_text": resp.reason,
                        "headers": dict(resp.headers),
                        "body": resp.text[:200000], "size": len(resp.content),
                        "time_ms": duration_ms,
                        "credits_used": my["total_used"] if period=="total" else my["day_used"],
                        "credits_limit": limit})
    except rq.exceptions.RequestException as e:
        return jsonify({"error": f"Request failed: {e}"}), 500

# =========================================================
#  PLANS
# =========================================================
@app.route("/api/plans")
@login_required
def api_list_plans():
    return jsonify(list(get_plans().values()))

@app.route("/api/plans", methods=["POST"])
@permission_required("subscriptions.manage")
def api_create_plan():
    d = request.get_json() or {}
    name = (d.get("name") or "").strip()
    pid  = (d.get("id") or name.lower().replace(" ", "_")).strip()
    if not name or not pid: return jsonify({"error": "Name required"}), 400
    plans = get_plans()
    if pid in plans: return jsonify({"error": "ID exists"}), 409
    p = {"id": pid, "name": name,
         "price": float(d.get("price") or 0),
         "currency": d.get("currency","BDT"),
         "duration_days": int(d.get("duration_days") or 30),
         "color": d.get("color","#00ff9d"),
         "icon": d.get("icon","💎"),
         "built_in": False,
         "features": d.get("features") or [],
         "request_limit_per_url": d.get("request_limit_per_url"),
         "request_period": d.get("request_period","day"),
         "auto_renew": bool(d.get("auto_renew", False)),
         "show_features_input": bool(d.get("show_features_input", True))}
    plans[pid] = p; save(PLANS_FILE, plans)
    push_activity(session["email"], f"created plan '{name}'")
    return jsonify(p), 201

@app.route("/api/plans/<pid>", methods=["PUT"])
@permission_required("subscriptions.manage")
def api_update_plan(pid):
    d = request.get_json() or {}
    plans = get_plans()
    if pid not in plans: return jsonify({"error": "Not found"}), 404
    p = plans[pid]
    if not p.get("built_in"):
        for k in ("name","currency","icon"):
            if k in d: p[k] = d[k]
    for k in ("price","duration_days","color","features",
              "request_limit_per_url","request_period","auto_renew","show_features_input"):
        if k in d:
            if k == "price": p[k] = float(d[k] or 0)
            elif k == "duration_days": p[k] = int(d[k] or 30)
            elif k == "features": p[k] = d[k] or []
            elif k == "request_limit_per_url":
                p[k] = None if d[k] in (None, "", "null") else int(d[k])
            elif k in ("auto_renew","show_features_input"): p[k] = bool(d[k])
            else: p[k] = d[k]
    save(PLANS_FILE, plans)
    push_activity(session["email"], f"updated plan '{pid}'")
    return jsonify(p)

@app.route("/api/plans/<pid>", methods=["DELETE"])
@permission_required("subscriptions.manage")
def api_delete_plan(pid):
    plans = get_plans()
    if pid not in plans: return jsonify({"error": "Not found"}), 404
    if plans[pid].get("built_in"): return jsonify({"error": "Cannot delete built-in plan"}), 400
    subs = load(SUBS_FILE, {})
    if any(pid in (s.get("plans") or []) for s in subs.values()):
        return jsonify({"error": "Plan is in use"}), 400
    del plans[pid]; save(PLANS_FILE, plans)
    push_activity(session["email"], f"deleted plan '{pid}'")
    return jsonify({"ok": True})

# =========================================================
#  SUBSCRIPTIONS
# =========================================================
@app.route("/api/subscriptions")
@permission_required("subscriptions.manage")
def api_list_subscriptions():
    subs = list(load(SUBS_FILE, {}).values())
    users = {u["email"]: u for u in load(USERS_FILE, [])}
    for s in subs:
        u = users.get(s["email"], {})
        s["user_name"] = u.get("name", s["email"])
    r = paginate(subs, q=request.args.get("q"),
                 search_fields=["email","user_name"],
                 filters={"status": request.args.get("status"),
                          "plan_id": request.args.get("plan_id")},
                 sort=request.args.get("sort","started_at"),
                 order=request.args.get("order","desc"),
                 page=request.args.get("page",1),
                 limit=request.args.get("limit",10))
    # mask emails
    for s in r["items"]:
        e = s.get("email","")
        s["email_masked"] = e[:2] + "***" + e[e.find("@"):] if "@" in e else "***"
        s.pop("email", None)
    return jsonify(r)

@app.route("/api/subscriptions", methods=["POST"])
@permission_required("subscriptions.manage")
def api_assign_subscription():
    d = request.get_json() or {}
    email   = (d.get("email") or "").strip().lower()
    plan_id = (d.get("plan_id") or "").strip()
    if not email or not plan_id: return jsonify({"error": "Email & plan required"}), 400
    plans = get_plans()
    if plan_id not in plans: return jsonify({"error": "Plan not found"}), 404
    if not find_by_email(load(USERS_FILE, []), email):
        return jsonify({"error": "User not found"}), 404
    subs = load(SUBS_FILE, {})
    now = datetime.utcnow()
    sub = subs.get(email) or ensure_subscription(email)
    my_plans = set(sub.get("plans") or [])
    my_plans.add(plan_id)
    days = int(d.get("duration_days") or plans[plan_id]["duration_days"])
    sub["plans"] = list(my_plans)
    sub["plan_id"] = plan_id
    sub["started_at"] = now.isoformat() + "Z"
    sub["expires_at"] = (now + timedelta(days=days)).isoformat() + "Z"
    sub["status"] = "active"
    sub["auto_renew"] = bool(d.get("auto_renew", False))
    sub.setdefault("history", []).insert(0, {
        "plan_id": plan_id, "started_at": sub["started_at"],
        "expires_at": sub["expires_at"], "source": "admin", "by": session["email"],
    })
    subs[email] = sub; save(SUBS_FILE, subs)
    push_activity(session["email"], f"assigned {plan_id} plan to {email}")
    push_notification(email, "Subscription updated",
                      f"Your plan has been set to {plans[plan_id]['name']}.",
                      sender=session["email"], kind="success")
    return jsonify({"ok": True, "subscription": sub}), 201

@app.route("/api/subscriptions/<email>", methods=["PUT"])
@permission_required("subscriptions.manage")
def api_update_subscription(email):
    d = request.get_json() or {}
    subs = load(SUBS_FILE, {})
    if email not in subs: return jsonify({"error": "Not found"}), 404
    s = subs[email]
    for k in ("plan_id","plans","expires_at","status","auto_renew"):
        if k in d:
            if k == "auto_renew": s[k] = bool(d[k])
            else: s[k] = d[k]
    save(SUBS_FILE, subs)
    push_activity(session["email"], f"updated subscription for {email}")
    return jsonify(s)

@app.route("/api/subscriptions/<email>", methods=["DELETE"])
@permission_required("subscriptions.manage")
def api_revoke_subscription(email):
    subs = load(SUBS_FILE, {})
    if email not in subs: return jsonify({"error": "Not found"}), 404
    now = datetime.utcnow()
    subs[email] = {"email": email, "plan_id": "free", "plans": ["free"],
                   "started_at": now.isoformat()+"Z",
                   "expires_at": (now + timedelta(days=36500)).isoformat()+"Z",
                   "status": "active", "auto_renew": True, "history": []}
    save(SUBS_FILE, subs)
    push_activity(session["email"], f"reverted {email} to Free plan")
    return jsonify({"ok": True})

@app.route("/api/my-subscription")
@login_required
def api_my_subscription():
    sub = ensure_subscription(session["email"])
    plans = get_plans()
    active = [plans.get(pid) for pid in sub.get("plans", []) if plans.get(pid)]
    order = {"premium": 3, "pro": 2, "free": 1}
    active.sort(key=lambda x: order.get(x["id"], 0), reverse=True)
    return jsonify({"subscription": sub, "plans_active": active,
                    "plan": active[0] if active else plans.get("free"),
                    "all_plans": list(plans.values())})

# =========================================================
#  PAYMENTS  (bKash)
# =========================================================
@app.route("/api/payments/plans")
@login_required
def api_payment_plans():
    """Public list of purchasable plans."""
    return jsonify(list(get_plans().values()))

@app.route("/api/payments/checkout", methods=["POST"])
@login_required
def api_payment_checkout():
    d = request.get_json() or {}
    plan_id = (d.get("plan_id") or "").strip()
    plans = get_plans()
    if plan_id not in plans: return jsonify({"error": "Plan not found"}), 404
    plan = plans[plan_id]
    if float(plan.get("price") or 0) <= 0:
        # free — just assign
        subs = load(SUBS_FILE, {})
        sub = subs.get(session["email"]) or ensure_subscription(session["email"])
        my = set(sub.get("plans") or []); my.add(plan_id)
        sub["plans"] = list(my); sub["plan_id"] = plan_id
        sub["status"] = "active"
        subs[session["email"]] = sub; save(SUBS_FILE, subs)
        push_activity(session["email"], f"activated free plan '{plan_id}'")
        return jsonify({"ok": True, "free": True})

    if not BkashService.configured():
        return jsonify({"error": "Payment gateway not configured. Contact admin."}), 503

    # create payment record
    order_id = f"P{uuid.uuid4().hex[:12].upper()}"
    payment_record = {
        "id": str(uuid.uuid4()),
        "order_id": order_id,
        "email": session["email"],
        "plan_id": plan_id,
        "amount": float(plan["price"]),
        "currency": plan.get("currency","BDT"),
        "status": "pending",
        "provider": "bkash",
        "provider_ref": None,
        "provider_trx_id": None,
        "created": now_iso(),
        "completed_at": None,
    }
    payments = load(PAYMENTS_FILE, [])
    payments.insert(0, payment_record); save(PAYMENTS_FILE, payments)

    try:
        result = BkashService.create_payment(plan["price"], order_id)
        payment_record["provider_ref"] = result.get("paymentID")
        payment_record["bkash_url"] = result.get("bkashURL")
        save(PAYMENTS_FILE, payments)
        return jsonify({"ok": True, "paymentID": result.get("paymentID"),
                        "bkashURL": result.get("bkashURL"), "order_id": order_id})
    except Exception as e:
        payment_record["status"] = "failed"
        payment_record["error"] = str(e)
        save(PAYMENTS_FILE, payments)
        return jsonify({"error": str(e)}), 500

@app.route("/api/payments/bkash/callback")
def api_payment_callback():
    paymentID = request.args.get("paymentID")
    status = request.args.get("status")
    if not paymentID:
        return "Missing paymentID", 400
    payments = load(PAYMENTS_FILE, [])
    rec = next((p for p in payments if p.get("provider_ref") == paymentID), None)
    if not rec:
        return "Payment record not found", 404
    if rec["status"] == "completed":
        return redirect(f"/user#/plan?payment=already")
    try:
        result = BkashService.query_payment(paymentID)
    except Exception as e:
        rec["status"] = "failed"; rec["error"] = str(e)
        save(PAYMENTS_FILE, payments)
        return redirect(f"/user#/plan?payment=failed")
    if result.get("trxStatus") != "Completed":
        rec["status"] = "failed"; save(PAYMENTS_FILE, payments)
        return redirect(f"/user#/plan?payment=failed")
    _complete_payment(rec, payments, result)
    return redirect(f"/user#/plan?payment=success")

@app.route("/api/payments/bkash/webhook", methods=["POST"])
def api_payment_webhook():
    sig = request.headers.get("x-bkash-signature", "")
    payload = request.get_json(silent=True) or {}
    if BKASH_WEBHOOK_SECRET:
        expected = hmac.new(BKASH_WEBHOOK_SECRET.encode(),
                            json.dumps(payload, separators=(",",":")).encode(),
                            hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return jsonify({"error": "Invalid signature"}), 401
    paymentID = payload.get("paymentID")
    if not paymentID: return jsonify({"ok": True})
    payments = load(PAYMENTS_FILE, [])
    rec = next((p for p in payments if p.get("provider_ref") == paymentID), None)
    if rec and rec["status"] != "completed":
        try:
            result = BkashService.query_payment(paymentID)
            if result.get("trxStatus") == "Completed":
                _complete_payment(rec, payments, result)
        except: pass
    return jsonify({"ok": True})

def _complete_payment(rec, payments, bkash_result):
    """Idempotent — mark order paid and assign plan."""
    if rec["status"] == "completed": return
    rec["status"] = "completed"
    rec["completed_at"] = now_iso()
    rec["provider_trx_id"] = bkash_result.get("trxID")
    rec["amount"] = float(bkash_result.get("amount", rec["amount"]))
    save(PAYMENTS_FILE, payments)
    email = rec["email"]; plan_id = rec["plan_id"]
    plans = get_plans(); plan = plans.get(plan_id)
    if not plan: return
    subs = load(SUBS_FILE, {})
    sub = subs.get(email) or ensure_subscription(email)
    my = set(sub.get("plans") or []); my.add(plan_id)
    now = datetime.utcnow()
    sub["plans"] = list(my)
    sub["plan_id"] = plan_id
    sub["started_at"] = now.isoformat()+"Z"
    sub["expires_at"] = (now + timedelta(days=plan["duration_days"])).isoformat()+"Z"
    sub["status"] = "active"
    sub["auto_renew"] = bool(plan.get("auto_renew"))
    sub.setdefault("history", []).insert(0, {
        "plan_id": plan_id, "started_at": sub["started_at"],
        "expires_at": sub["expires_at"], "source": "purchase",
        "txn_id": rec["provider_trx_id"], "amount": rec["amount"],
    })
    subs[email] = sub; save(SUBS_FILE, subs)
    push_notification(email, "Payment successful",
                      f"Plan {plan['name']} activated.",
                      kind="success")
    push_activity(email, f"purchased plan '{plan_id}'")

@app.route("/api/payments/history")
@login_required
def api_payment_history():
    payments = load(PAYMENTS_FILE, [])
    if session.get("kind") == "admin":
        mine = payments
    else:
        mine = [p for p in payments if p["email"] == session["email"]]
    for p in mine:
        e = p.get("email","")
        p["email_masked"] = e[:2] + "***" + e[e.find("@"):] if "@" in e else "***"
        p.pop("email", None)
    return jsonify(mine[:100])

@app.route("/api/payments/manual", methods=["POST"])
@permission_required("subscriptions.manage")
def api_payment_manual():
    """Admin manually assigns a plan (bypasses payment)."""
    d = request.get_json() or {}
    email = (d.get("email") or "").strip().lower()
    plan_id = (d.get("plan_id") or "").strip()
    plans = get_plans()
    if email not in [u["email"] for u in load(USERS_FILE, [])]:
        return jsonify({"error": "User not found"}), 404
    if plan_id not in plans: return jsonify({"error": "Plan not found"}), 404
    subs = load(SUBS_FILE, {})
    sub = subs.get(email) or ensure_subscription(email)
    my = set(sub.get("plans") or []); my.add(plan_id)
    now = datetime.utcnow()
    sub["plans"] = list(my); sub["plan_id"] = plan_id
    sub["started_at"] = now.isoformat()+"Z"
    sub["expires_at"] = (now + timedelta(days=plans[plan_id]["duration_days"])).isoformat()+"Z"
    sub["status"] = "active"
    sub.setdefault("history", []).insert(0, {
        "plan_id": plan_id, "started_at": sub["started_at"],
        "expires_at": sub["expires_at"], "source": "manual",
        "by": session["email"]})
    subs[email] = sub; save(SUBS_FILE, subs)
    push_activity(session["email"], f"manually assigned {plan_id} to {email}")
    return jsonify({"ok": True})

# =========================================================
#  Stats
# =========================================================
@app.route("/api/stats")
@login_required
def api_stats():
    users = load(USERS_FILE, []); admins = load(ADMINS_FILE, [])
    act = load(ACTIVITY_FILE, []); tickets = load(TICKETS_FILE, [])
    notif = load(NOTIF_FILE, []); shared = load(SHARED_APIS_FILE, [])
    payments = load(PAYMENTS_FILE, [])
    if session.get("kind") == "admin":
        return jsonify({"users": len(users), "admins": len(admins),
                        "activity": len(act),
                        "tickets": len([t for t in tickets if t["status"] != "closed"]),
                        "shared": len(shared),
                        "payments": len([p for p in payments if p["status"]=="completed"]),
                        "online": 1,
                        "unread": len([n for n in notif
                                       if n["to"] in (session["email"], "*") and not n["read"]])})
    my_act = [x for x in act if x.get("who") == session.get("email")]
    my_not = [n for n in notif if n["to"] in (session["email"], "*") and not n["read"]]
    my_t   = [t for t in tickets if t.get("user_email") == session["email"]]
    my_sh  = 0
    sub = ensure_subscription(session["email"])
    my_plans = sub.get("plans", [])
    for it in shared:
        if not it.get("enabled"): continue
        allowed = it.get("allowed_users") or ["*"]
        if "*" in allowed or session["email"] in allowed:
            ap = it.get("allowed_plans") or []
            if ap and not any(pid in ap for pid in my_plans): continue
            my_sh += 1
    return jsonify({"actions": len(my_act), "sessions": 1,
                    "tickets": len([t for t in my_t if t["status"] != "closed"]),
                    "shared": my_sh, "unread": len(my_not), "score": 87})

# =========================================================
#  USER: Delete own account
# =========================================================
@app.route("/api/me/delete", methods=["POST"])
@login_required
def api_delete_self():
    d = request.get_json() or {}
    pw = d.get("password") or ""
    kind = session.get("kind")
    path = ADMINS_FILE if kind == "admin" else USERS_FILE
    store = load(path, []); me = find_by_email(store, session["email"])
    if not me: return jsonify({"error": "Account not found"}), 404
    if hpw(pw) != me["password"]: return jsonify({"error": "Wrong password"}), 401
    if kind == "admin":
        if me.get("role") == "superadmin" and \
           len([x for x in store if x.get("role") == "superadmin"]) <= 1:
            return jsonify({"error": "Cannot delete last superadmin"}), 400
    save(path, [x for x in store if x["id"] != me["id"]])
    push_activity(me["email"], "deleted own account")
    session.clear()
    return jsonify({"ok": True})

# =========================================================
if __name__ == "__main__":
    print("=" * 64)
    print("  🚀  Reusable Panel — v6.0")
    print("  🌐  http://localhost:5000/")
    print("  👑  Admin : adminsarker@gmail.com / admin@123")
    print("  👤  User  : user@demo.com / user@123")
    print("=" * 64)
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)