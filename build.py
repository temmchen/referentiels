#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py – Référentiels Mobil: baut aus dem Index des Référentiel-Filemanagers (KI/Referentiels) den
verschlüsselten Tresor für GitHub Pages (docs/vaults). Gleiches Schema wie Dashboard Mobil / Journal Mobil:

  Passwort (NFC + trim + Kleinschreibung) → PBKDF2-HMAC-SHA256 (600 000, 16-B-Salt je Zugang) → KEK
  KEK wickelt den Tresorschlüssel K (32 B, bleibt über Builds gleich, liegt in .build-state.json) ein:
      AES-256-GCM über {"k": b64(K), "rolle": "leser", "label": <Name>} → {"iv","ct","p"}
  Manifest und PDFs: 12-B-Nonce || AES-256-GCM(K)   → docs/vaults/<vid>/m.enc, docs/vaults/<vid>/f/<fid>.enc
  docs/vaults/index.json (Klartext): {v, portal, erstellt, build, kdf, principals, vaults}

Unveränderte PDFs behalten ihre fid (Zuordnung sha1 → fid in .build-state.json), so bleibt der Offline-Cache
am Handy gültig und die Git-Historie klein. Aufruf: /usr/bin/python3 build.py [--quelle <KI/Referentiels>]
[--neu-verschluesseln]. Geheimnisse: zugangsdaten.json und .build-state.json sind Verknüpfungen nach
_Portal-Setup/geheim/Referentiels-… (gitignored).
"""
import argparse
import base64
import datetime
import io
import json
import os
import secrets
import stat
import sys
import unicodedata
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

HIER = Path(__file__).resolve().parent
DOCS = HIER / "docs"
VAULTS = DOCS / "vaults"
ZUGANG = HIER / "zugangsdaten.json"
STATE = HIER / ".build-state.json"
PBKDF2_ITER = 600_000
MAX_MB = 40
QUELLE_STANDARD = Path.home() / "Library/CloudStorage/OneDrive-365education/KI/Referentiels"

nfc = lambda s: unicodedata.normalize("NFC", str(s or ""))


def b64(d):
    return base64.b64encode(d).decode("ascii")


def normalisiere_passwort(pw):
    return nfc(pw).strip().lower()


def leite_kek_ab(passwort, salt):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ITER).derive(normalisiere_passwort(passwort).encode("utf-8"))


def verschluessele(key, klartext):
    nonce = secrets.token_bytes(12)
    return nonce + AESGCM(key).encrypt(nonce, klartext, None)


def wickle_ein(kek, nutzlast):
    nonce = secrets.token_bytes(12)
    return {"iv": b64(nonce), "ct": b64(AESGCM(kek).encrypt(nonce, json.dumps(nutzlast, ensure_ascii=False).encode("utf-8"), None))}


def lade_json(p, standard=None):
    try:
        with io.open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return standard


def schreibe_json_geheim(p, daten):
    ziel = Path(os.path.realpath(p))
    tmp = ziel.with_suffix(ziel.suffix + ".tmp")
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(daten, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ziel)
    os.chmod(ziel, stat.S_IRUSR | stat.S_IWUSR)


def zugang_laden():
    z = lade_json(ZUGANG)
    if not z or not z.get("zugaenge"):
        raise SystemExit("zugangsdaten.json fehlt oder hat keine Zugänge – zuerst „Mobil einrichten.command“ bzw. verwaltung.py liste.")
    return z


def index_holen(quelle):
    sys.path.insert(0, str(quelle))
    import referentiels as RF  # noqa: E402
    cfg = RF.config_lesen(str(quelle / "config.json"))
    idx, hinweise = RF.index_bauen(cfg, protokoll=lambda s: print("  " + s))
    return idx, hinweise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quelle", default=None)
    ap.add_argument("--neu-verschluesseln", action="store_true", help="neuer Tresorschlüssel, alle Dateien neu")
    args = ap.parse_args()
    z = zugang_laden()
    quelle = Path(os.path.expanduser(args.quelle or z.get("quelle") or str(QUELLE_STANDARD)))
    if not (quelle / "referentiels.py").is_file():
        raise SystemExit("Quelle nicht gefunden: %s (referentiels.py fehlt)" % quelle)
    st = lade_json(STATE, {}) or {}
    if args.neu_verschluesseln or not st.get("vault", {}).get("key"):
        st["vault"] = {"id": secrets.token_hex(8), "key": b64(secrets.token_bytes(32))}
        st["dateien"] = {}
    K = base64.b64decode(st["vault"]["key"])
    vid = st["vault"]["id"]
    st.setdefault("dateien", {})
    st.setdefault("principals", {})
    st["build"] = int(st.get("build") or 0) + 1

    print("Index aus %s" % quelle)
    idx, hinweise = index_holen(quelle)
    for h in hinweise:
        print("  Hinweis:", h)

    vdir = VAULTS / vid
    fdir = vdir / "f"
    fdir.mkdir(parents=True, exist_ok=True)
    # andere (alte) Tresore entfernen
    for alt in VAULTS.iterdir() if VAULTS.is_dir() else []:
        if alt.is_dir() and alt.name != vid:
            for p in sorted(alt.rglob("*"), reverse=True):
                p.unlink() if p.is_file() else p.rmdir()
            alt.rmdir()
    benutzt = set()
    neu = wieder = uebersprungen = 0
    manifest_jahre = []
    for j in idx["jahre"]:
        mj = {"jahr": j["jahr"], "klassen": []}
        for k in j["klassen"]:
            mk = {"klasse": k["klasse"], "name": k.get("name", ""), "farbe": k.get("farbe", ""), "rattrapage": k.get("rattrapage", False), "module": []}
            for m in k["module"]:
                mm = {sch: m.get(sch) for sch in ("modul", "titel", "zeitraum", "stunden", "semester", "sprache", "anzahl", "punkte", "kompetenzen",
                                                   "lernsituationen", "organisation", "lerneinheiten", "prog_kopf", "vorlage", "erwartet", "fehlt", "im_stundenplan")}
                mm["dateien"] = []
                for d in m.get("dateien", []):
                    sha = d.get("sha1")
                    pfad = d.get("pfad")
                    if not sha or not pfad or not os.path.isfile(pfad):
                        continue
                    groesse = os.path.getsize(pfad)
                    if groesse > MAX_MB * 1024 * 1024:
                        uebersprungen += 1
                        mm["dateien"].append({"typ": d["typ"], "name": nfc(d["name"]), "groesse": groesse, "hinweis": "zu groß fürs Handy"})
                        continue
                    eintrag = st["dateien"].get(sha)
                    if eintrag and (fdir / (eintrag["fid"] + ".enc")).is_file():
                        fid = eintrag["fid"]
                        wieder += 1
                    else:
                        fid = secrets.token_hex(12)
                        with open(pfad, "rb") as f:
                            klar = f.read()
                        (fdir / (fid + ".enc")).write_bytes(verschluessele(K, klar))
                        st["dateien"][sha] = {"fid": fid, "groesse": groesse}
                        neu += 1
                    benutzt.add(fid)
                    mm["dateien"].append({"typ": d["typ"], "name": nfc(d["name"]), "groesse": groesse, "fid": fid, "kanonisch": d.get("kanonisch", False)})
                mk["module"].append(mm)
            mj["klassen"].append(mk)
        manifest_jahre.append(mj)
    # verwaiste Chiffrate löschen
    geloescht = 0
    for p in fdir.glob("*.enc"):
        if p.stem not in benutzt:
            p.unlink()
            geloescht += 1
    for sha in [s for s, e in st["dateien"].items() if e.get("fid") not in benutzt]:
        del st["dateien"][sha]
    jetzt = datetime.datetime.now().replace(microsecond=0).isoformat()
    anzahl = sum(1 for j in manifest_jahre for k in j["klassen"] for m in k["module"] for d in m["dateien"] if d.get("fid"))
    manifest = {"v": 1, "portal": "Référentiels", "erstellt": jetzt, "build": st["build"], "jahre": manifest_jahre,
                "statistik": {"dateien": anzahl, "jahre": len(manifest_jahre), "module": sum(len(k["module"]) for j in manifest_jahre for k in j["klassen"])}}
    (vdir / "m.enc").write_bytes(verschluessele(K, json.dumps(manifest, ensure_ascii=False).encode("utf-8")))
    # Zugänge
    principals, wraps = [], []
    for zg in z["zugaenge"]:
        name = nfc(zg.get("name") or zg.get("label") or "")
        if not name or not zg.get("passwort"):
            continue
        pid = "p" + str(len(principals))
        salt_b64 = st["principals"].get(name)
        if not salt_b64:
            salt_b64 = b64(secrets.token_bytes(16))
            st["principals"][name] = salt_b64
        kek = leite_kek_ab(zg["passwort"], base64.b64decode(salt_b64))
        principals.append({"id": pid, "salt": salt_b64, "label": name})
        w = wickle_ein(kek, {"k": st["vault"]["key"], "rolle": "leser", "label": name})
        w["p"] = pid
        wraps.append(w)
    index_json = {"v": 2, "portal": "Référentiels", "erstellt": jetzt, "build": st["build"],
                  "kdf": {"typ": "PBKDF2-SHA256", "iter": PBKDF2_ITER, "normalisierung": "nfc+trim+lower"},
                  "principals": principals, "vaults": [{"id": vid, "manifest": "vaults/%s/m.enc" % vid, "wraps": wraps}]}
    with io.open(VAULTS / "index.json", "w", encoding="utf-8") as f:
        json.dump(index_json, f, ensure_ascii=False, indent=1)
    schreibe_json_geheim(STATE, st)
    print("✅ Tresor gebaut (Build %d): %d PDFs (%d neu, %d unverändert, %d übersprungen, %d verwaist gelöscht), %d Zugänge" % (st["build"], anzahl, neu, wieder, uebersprungen, geloescht, len(principals)))


if __name__ == "__main__":
    main()
