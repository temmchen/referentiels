#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verwaltung.py – Zugänge von Référentiels Mobil und die Passwort-Übersicht (KI/Passwoerter).
  python3 verwaltung.py liste                   Zugänge zeigen (Passwörter verdeckt)
  python3 verwaltung.py passwort <Name>         neues Passwort setzen (danach veroeffentlichen.py)
  python3 verwaltung.py readme                  Passwort-Übersicht + QR-Code neu schreiben
Quelle der Wahrheit: zugangsdaten.json (Verknüpfung nach _Portal-Setup/geheim/Referentiels-zugangsdaten.json).
"""
import io
import json
import os
import secrets
import stat
import sys
import time
from pathlib import Path

HIER = Path(__file__).resolve().parent
ZUGANG = HIER / "zugangsdaten.json"
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
PASSWOERTER = Path.home() / "Library/CloudStorage/OneDrive-365education/KI/Passwoerter"
MOBIL = Path.home() / "Library/CloudStorage/OneDrive-365education/KI/Referentiels/mobil"


def neues_passwort():
    return "-".join("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(4))


def lade():
    with io.open(ZUGANG, encoding="utf-8") as f:
        return json.load(f)


def speichere(z):
    ziel = Path(os.path.realpath(ZUGANG))
    with io.open(ziel, "w", encoding="utf-8") as f:
        json.dump(z, f, ensure_ascii=False, indent=1)
    os.chmod(ziel, stat.S_IRUSR | stat.S_IWUSR)


def qr_erzeugen(url, ziel):
    try:
        import qrcode
        qrcode.make(url, border=2, box_size=10).save(str(ziel))
        return True
    except Exception:  # noqa: BLE001
        pass
    try:
        import segno
        segno.make(url).save(str(ziel), scale=10, border=2)
        return True
    except Exception:  # noqa: BLE001
        return False


def readme(z):
    PASSWOERTER.mkdir(parents=True, exist_ok=True)
    MOBIL.mkdir(parents=True, exist_ok=True)
    url = z.get("url") or "https://temmchen.github.io/referentiels/"
    qr = MOBIL / "QR-Referentiels-Mobil.png"
    hat_qr = qr_erzeugen(url, qr)
    zeilen = ["# 🔐 Référentiels Mobil (iPhone & iPad) — Zugang und Passwort", "",
              "> ⚠️ **NUR für dich (OneDrive, privat).** Niemals ins Repo kopieren, niemals teilen.",
              "> Diese Datei schreibt `verwaltung.py` **automatisch** — nicht von Hand pflegen.",
              "> Quelle der Wahrheit: `_Portal-Setup/geheim/Referentiels-zugangsdaten.json`.", "",
              "**Adresse:** %s  " % url,
              "**Schuljahr:** %s · **Stand:** %s" % (z.get("schuljahr", "2026 – 2027"), time.strftime("%d.%m.%Y")), "",
              "**Am iPhone/iPad öffnen:** Kamera auf den Code halten, dann in Safari „Teilen → Zum Home-Bildschirm“.", "",
              ("QR-Code: `KI/Referentiels/mobil/QR-Referentiels-Mobil.png`" if hat_qr else "QR-Code: im Repo-Manager von Dashboard Pro (Kachel GitHub › referentiels) oder Kachel Passwörter."), "",
              "| Zugang | Passwort |", "|---|---|"]
    for zg in z.get("zugaenge") or []:
        zeilen.append("| **%s** | `%s` |" % (zg.get("name"), zg.get("passwort")))
    zeilen += ["",
               "Anmelden: Zugang (Name) und Passwort eingeben — Bindestriche mitschreiben, Groß-/Kleinschreibung spielt keine Rolle.",
               "Inhalt: alle Référentiels de formation/d'évaluation und Programme je Schuljahr → Klasse → Modul mit Kurzfassung",
               "(Kompetenzen, Punkte, Lernsituationen) und den PDFs (Betrachter in der Seite, Teilen). „Für unterwegs laden“ hält alles offline.", "",
               "## Gut zu wissen",
               "- Passwort ändern: `/usr/bin/python3 ~/Documents/GitHub/referentiels/verwaltung.py passwort \"Tom\"`, dann veröffentlichen.",
               "- Veröffentlichen: Dashboard Pro › Kachel Référentiels › „Mobil veröffentlichen“ oder `KI/Referentiels/mobil/Mobil veröffentlichen.command`;",
               "  der Portal-Wächter tut es alle 20 min von selbst.",
               "- Das Repo `temmchen/referentiels` ist öffentlich, enthält aber nur Programmcode und AES-256-Chiffrat.",
               "- Quelle: `KI/Referentiels` (Référentiel-Filemanager, Kachel in Dashboard Pro) → GitHub Pages.", ""]
    ziel = PASSWOERTER / "Referentiels Mobil README.md"
    ziel.write_text("\n".join(zeilen), encoding="utf-8")
    print("Übersicht geschrieben:", ziel, "(QR: %s)" % ("ja" if hat_qr else "nein"))


def main():
    if not ZUGANG.exists():
        raise SystemExit("zugangsdaten.json fehlt (Verknüpfung nach geheim/).")
    z = lade()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "liste"
    if cmd == "liste":
        print("Portal:", z.get("portal"), "·", z.get("url"))
        for zg in z.get("zugaenge") or []:
            print("  %-12s %s" % (zg.get("name"), "•" * 8))
    elif cmd == "passwort":
        name = sys.argv[2] if len(sys.argv) > 2 else "Tom"
        for zg in z.setdefault("zugaenge", []):
            if zg.get("name") == name:
                zg["passwort"] = neues_passwort()
                break
        else:
            z["zugaenge"].append({"name": name, "passwort": neues_passwort()})
        speichere(z)
        readme(z)
        print("Neues Passwort für „%s“ gesetzt – steht in KI/Passwoerter/Referentiels Mobil README.md. Jetzt veröffentlichen." % name)
    elif cmd == "readme":
        readme(z)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
