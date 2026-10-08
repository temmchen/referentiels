#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
veroeffentlichen.py – Référentiels Mobil mit einem Aufruf aktuell halten (auch vom Portal-Wächter).
  python3 veroeffentlichen.py            holen, prüfen, bauen, Klartext-Prüfung, committen, pushen
  python3 veroeffentlichen.py --pruefen  nur melden: NICHTS-ZU-TUN oder OFFEN (Vertrag des Portal-Wächters)
  python3 veroeffentlichen.py --erzwingen   bauen und veröffentlichen, auch ohne erkannte Änderung
Inventar = Größe + mtime aller PDFs aus dem Index, der Kurzfassungen, config.json, referentiels.py und der
Oberfläche (docs/*.html|js|mjs|json) – verglichen mit .letzter-stand.json (Verknüpfung nach geheim/).
Kein input(): stdin ist unter launchd geschlossen.
"""
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HIER = Path(__file__).resolve().parent
DOCS = HIER / "docs"
STAND = HIER / ".letzter-stand.json"
ZUGANG = HIER / "zugangsdaten.json"


def git(*args, check=True):
    r = subprocess.run(["git", "-C", str(HIER)] + list(args), capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit("git %s: %s" % (" ".join(args), (r.stderr or r.stdout).strip()))
    return r.stdout.strip()


def lade(p, standard=None):
    try:
        with io.open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return standard


def quelle():
    z = lade(ZUGANG, {}) or {}
    return Path(os.path.expanduser(z.get("quelle") or str(Path.home() / "Library/CloudStorage/OneDrive-365education/KI/Referentiels")))


def inventar():
    q = quelle()
    inv = {}

    def merke(p):
        try:
            s = os.stat(p)
            inv[str(p)] = [s.st_size, int(s.st_mtime)]
        except OSError:
            pass
    for name in ("config.json", "referentiels.py"):
        merke(q / name)
    for p in (q / "daten" / "zusammenfassungen").glob("*.json"):
        merke(p)
    sys.path.insert(0, str(q))
    try:
        import referentiels as RF  # noqa: E402
        cfg = RF.config_lesen(str(q / "config.json"))
        for qu in cfg.get("quellen") or []:
            w = RF.pfad_aufloesen(qu["pfad"], str(q))
            if not os.path.isdir(w):
                continue
            liste = RF.scan_schuljahr_dashboard(w, qu["id"]) if qu.get("typ") == "schuljahr-dashboard" else RF.scan_archiv(w, qu["id"], int(qu.get("tiefe") or 7))
            for d in liste:
                merke(d["pfad"])
    except Exception as e:  # noqa: BLE001
        inv["__fehler__"] = [0, 0]
        print("Inventar unvollständig:", e)
    for p in list(DOCS.glob("*.html")) + list(DOCS.glob("*.js")) + list(DOCS.glob("*.webmanifest")):
        merke(p)
    return inv


def pruefe_klartext():
    """Kein Passwort, kein Titel eines Référentiels im Klartext unter docs/ (außer .enc)."""
    z = lade(ZUGANG, {}) or {}
    woerter = set()
    for zg in z.get("zugaenge") or []:
        pw = str(zg.get("passwort") or "")
        if pw:
            woerter.add(pw.lower())
            woerter.add(pw.lower().replace("-", ""))
    treffer = []
    for p in DOCS.rglob("*"):
        if not p.is_file() or p.suffix == ".enc" or p.suffix in (".png", ".mjs"):
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            continue
        for w in woerter:
            if w and w in t:
                treffer.append("%s enthält ein Passwort" % p.relative_to(HIER))
        if p.name == "index.json" and "kompetenzen" in t:
            treffer.append("%s enthält Klartext-Inhalte" % p.relative_to(HIER))
    for name in ("zugangsdaten.json", ".build-state.json", ".letzter-stand.json"):
        if git("ls-files", "--error-unmatch", name, check=False):
            treffer.append("%s steht im Git-Index!" % name)
    return treffer


def main():
    nur_pruefen = "--pruefen" in sys.argv
    erzwingen = "--erzwingen" in sys.argv
    if not ZUGANG.exists():
        print("OFFEN: zugangsdaten.json fehlt")
        sys.exit(2)
    inv = inventar()
    alt = lade(STAND, {}) or {}
    gleich = (inv == alt.get("inventar")) and (DOCS / "vaults" / "index.json").exists()
    if nur_pruefen:
        print("NICHTS-ZU-TUN" if gleich else "OFFEN: %d Einträge im Inventar, zuletzt %s" % (len(inv), alt.get("zeit", "nie")))
        return
    if gleich and not erzwingen:
        print("✅ Alles aktuell (zuletzt %s)." % alt.get("zeit", "?"))
        return
    git("pull", "--no-rebase", "-q", "origin", "main", check=False)
    r = subprocess.run([sys.executable, str(HIER / "build.py")], cwd=str(HIER))
    if r.returncode != 0:
        raise SystemExit("Bau fehlgeschlagen.")
    probleme = pruefe_klartext()
    if probleme:
        raise SystemExit("ABBRUCH – Klartext-Prüfung: " + "; ".join(probleme))
    git("add", "docs")
    status = git("status", "--porcelain")
    if status:
        n = sum(1 for z in status.splitlines() if z.startswith(("A", "?")))
        git("commit", "-q", "-m", "Inhalte aktualisiert: %d Dateien geändert (%s)" % (len(status.splitlines()), time.strftime("%d.%m.%Y %H:%M")))
        git("push", "-q", "origin", "main")
        print("✅ Fertig – veröffentlicht (%d Dateien, davon %d neu)." % (len(status.splitlines()), n))
    else:
        print("✅ Fertig – keine Änderung im Repo.")
    with io.open(STAND, "w", encoding="utf-8") as f:
        json.dump({"zeit": time.strftime("%Y-%m-%d %H:%M:%S"), "inventar": inv}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
