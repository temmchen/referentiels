/* Référentiels – Zeitplan (Gantt). Wo stehe ich je Klasse und Modul mit K1 … Kn?
   Daten: GET /api/zeitplan?jahr= (zeitplan.py) – echte Unterrichtsstunden je Modul aus dem Journal de Classe
   (Stundenplan, Ferien, Ausnahmen) und die Anteile der Kompetenzen (Gewichtung oder Lehrplan-Richtzeit).
   Hier wird „heute“ gerechnet: Stunden vor heute gelten als gehalten; die Kompetenzen liegen der Reihe nach
   auf den Stunden. ?heute=JJJJ-MM-TT in der Adresse simuliert einen anderen Tag.
   Öffentlich: window.RFZ = { laden, seite, detail, modulKarte, heuteISO, setze, auswahl, waehle }.
   Référentiels Mobil (build.py kopiert diese Datei nach docs/): RFZ.setze({ quelle: jahr => Daten aus dem
   entschlüsselten Manifest, nurLesen: true }) – dann kein fetch und der Ist-Stand ist nur Anzeige. */
(() => {
  'use strict';
  const TAG = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const merk = (k, v) => { try { localStorage.setItem('rfm.' + k, v); } catch (e) {} };
  const lies = k => { try { return localStorage.getItem('rfm.' + k); } catch (e) { return null; } };
  const ms = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const kurzDatum = t => { const d = new Date(t); return d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; };
  const langDatum = t => { const d = new Date(t); return WT[d.getUTCDay()] + ' ' + kurzDatum(t); };
  const h = x => (Math.round(x * 10) / 10).toString().replace('.', ',');

  const heuteParam = (() => { const m = /[?&]heute=(\d{4}-\d{2}-\d{2})/.exec(location.search); return m ? m[1] : null; })();
  const heuteISO = () => heuteParam || (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

  const z = { daten: {}, periode: lies('zp.periode') || 'auto', basis: lies('zp.basis') || 'gewichtung', auswahl: lies('zp.klasse') || '', quelle: null, nurLesen: false };
  function setze(o) { Object.assign(z, o || {}); z.daten = {}; }

  async function laden(jahr, neu) {
    if (z.daten[jahr] && !neu) return z.daten[jahr];
    if (z.quelle) { const d = await z.quelle(jahr); if (!d) throw new Error('Für ' + jahr + ' gibt es keinen Zeitplan.'); return (z.daten[jahr] = d); }
    const r = await fetch('/api/zeitplan?jahr=' + encodeURIComponent(jahr));
    const d = await r.json();
    if (!d.ok) throw new Error(d.fehler || 'Zeitplan nicht verfügbar');
    z.daten[jahr] = d;
    return d;
  }

  // ------------------------------------------------------------ Rechnen
  /* Ein Modul zu „heute“: Kompetenz-Grenzen in Stunden, Lage auf der Zeitachse, Soll-Stand. */
  function rechne(m, heute) {
    const L = m.lektionen || []; const H = m.gesamt || 0;
    const ant = (z.basis === 'lehrplan' && m.anteile.lehrplan) || m.anteile.gewichtung || [];
    const tHeute = ms(heute);
    // kumulierte Stunden je Lektion
    const kum = []; let s = 0;
    for (const l of L) { kum.push([s, s + l[1], ms(l[0])]); s += l[1]; }
    // Stunde → Zeitpunkt (Lektion = ihr Kalendertag, Stunden darin linear)
    const pos = x => {
      if (!kum.length) return null;
      if (x <= 0) return kum[0][2];
      for (const [a, b, t] of kum) if (x <= b + 1e-9) return t + ((x - a) / (b - a)) * TAG;
      return kum[kum.length - 1][2] + TAG;
    };
    let gehalten = 0, heuteStd = 0;
    for (const l of L) { const t = ms(l[0]); if (t < tHeute) gehalten += l[1]; else if (t === tHeute) heuteStd += l[1]; }
    const naechste = L.find(l => ms(l[0]) >= tHeute);
    let a = 0;
    const seg = (m.items || []).map((it, i) => {
      const von = a * H, bis = (a + (ant[i] || 0)) * H; a += ant[i] || 0;
      const st = gehalten >= bis - 1e-9 ? 'fertig' : gehalten <= von + 1e-9 ? 'offen' : 'laeuft';
      return { it, i, von, bis, std: bis - von, t0: pos(von), t1: pos(bis), st, anteil: st === 'fertig' ? 1 : st === 'offen' ? 0 : (gehalten - von) / (bis - von) };
    });
    const jetzt = seg.find(x => x.st === 'laeuft') || (gehalten > 0 ? null : seg[0]);
    const vorbei = L.length && ms(L[L.length - 1][0]) < tHeute;
    const begonnen = L.length && ms(L[0][0]) < tHeute;
    let istIdx = -1;
    if (m.ist === 'fertig') istIdx = seg.length; else if (m.ist) istIdx = seg.findIndex(x => x.it.nr === m.ist);
    const sollIdx = vorbei ? seg.length : (seg.findIndex(x => x.st !== 'fertig'));
    return { L, H, seg, gehalten, heuteStd, rest: H - gehalten, naechste, jetzt, vorbei, begonnen, quote: H ? gehalten / H : 0,
      t0: L.length ? ms(L[0][0]) : null, t1: L.length ? ms(L[L.length - 1][0]) + TAG : null, istIdx, sollIdx: sollIdx < 0 ? seg.length : sollIdx };
  }

  function statusText(m, r) {
    if (!r.L.length) return { kurz: 'keine Stunden', lang: m.hinweis || 'keine Unterrichtsstunden gefunden', art: 'leer' };
    if (r.vorbei) return { kurz: '✓ abgeschlossen', lang: 'Modul vorbei – alle ' + h(r.H) + ' Std. gehalten', art: 'fertig' };
    if (!r.begonnen) return { kurz: 'beginnt ' + kurzDatum(r.t0), lang: 'beginnt ' + langDatum(r.t0) + ' · ' + h(r.H) + ' Std. geplant', art: 'spaeter' };
    if (!r.seg.length) return { kurz: Math.round(r.quote * 100) + ' %', lang: h(r.gehalten) + ' von ' + h(r.H) + ' Std. gehalten', art: 'laeuft' };
    const j = r.jetzt;
    return j ? { kurz: '▶ ' + j.it.nr + ' · ' + Math.round(j.anteil * 100) + ' %', lang: 'jetzt ' + j.it.nr + ' (' + Math.round(j.anteil * 100) + ' % davon) · noch ' + h(r.rest) + ' Std.', art: 'laeuft' }
      : { kurz: Math.round(r.quote * 100) + ' %', lang: '', art: 'laeuft' };
  }

  function istVergleich(r) {
    if (r.istIdx < 0 || !r.seg.length) return '';
    const d = r.istIdx - r.sollIdx;
    const ist = r.istIdx >= r.seg.length ? 'fertig' : r.seg[r.istIdx].it.nr;
    if (d === 0) return `<span class="zp-ist ok" title="Ist-Stand von Hand gesetzt">Ist ${esc(ist)} · im Plan</span>`;
    return d < 0 ? `<span class="zp-ist hinten" title="Ist-Stand von Hand gesetzt">Ist ${esc(ist)} · ${-d} K zurück</span>`
      : `<span class="zp-ist vorn" title="Ist-Stand von Hand gesetzt">Ist ${esc(ist)} · ${d} K voraus</span>`;
  }

  // ------------------------------------------------------------ Zeitfenster
  function aktuellePeriode(d, heute) {
    const t = heute;
    for (const p of ['S1', 'S2']) { const v = d.perioden[p]; if (v && v[0] <= t && t <= v[1]) return p; }
    return 'Jahr';
  }
  function fenster(d, heute, klasse) {
    let p = z.periode;
    if (p === 'auto') {
      if (klasse && klasse.zeitraum === 'trimester') { for (const x of ['T1', 'T2', 'T3']) { const v = d.perioden[x]; if (v && v[0] <= heute && heute <= v[1]) { p = x; break; } } if (p === 'auto') p = 'Jahr'; }
      else p = klasse ? aktuellePeriode(d, heute) : 'Jahr';
    }
    const v = d.perioden[p] || d.perioden.Jahr;
    return { p, a: ms(v[0]), b: ms(v[1]) + TAG };
  }

  // ------------------------------------------------------------ Bausteine
  const pct = (t, f) => Math.max(0, Math.min(100, (t - f.a) / (f.b - f.a) * 100));

  function hintergrund(d, f, heute) {
    let s = '';
    // Monatslinien
    const s0 = new Date(f.a); let m = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 1);
    while (m < f.b) { s += `<i class="zp-mon" style="left:${pct(m, f)}%"></i>`; const x = new Date(m); m = Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1); }
    for (const fe of d.ferien) {
      const a = ms(fe.von), b = ms(fe.bis) + TAG; if (b <= f.a || a >= f.b) continue;
      s += `<i class="zp-frei ${fe.art}" style="left:${pct(a, f)}%;width:${Math.max(pct(b, f) - pct(a, f), .25)}%" title="${esc(fe.name)} ${kurzDatum(a)}–${kurzDatum(b - TAG)}"></i>`;
    }
    const th = ms(heute);
    if (th >= f.a && th < f.b) s += `<i class="zp-heute" style="left:${pct(th + TAG / 2, f)}%"></i>`;
    return s;
  }

  function achse(d, f, heute, klasse) {
    const nur = klasse ? (klasse.zeitraum === 'trimester' ? 'T' : 'S') : '';
    let mon = '';
    const s0 = new Date(f.a); let m = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth(), 1);
    while (m < f.b) {
      const x = new Date(m); const n = Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1);
      const l = pct(Math.max(m, f.a), f), r = pct(Math.min(n, f.b), f);
      if (r - l > 2.5) mon += `<span class="zp-m" style="left:${l}%;width:${r - l}%">${MON[x.getUTCMonth()]}${x.getUTCMonth() === 0 || m <= f.a ? ' ' + String(x.getUTCFullYear()).slice(2) : ''}</span>`;
      m = n;
    }
    let per = '';
    for (const p of ['S1', 'S2', 'T1', 'T2', 'T3']) {
      const v = d.perioden[p]; if (!v || (nur && p[0] !== nur)) continue;
      const a = ms(v[0]), b = ms(v[1]) + TAG; if (b <= f.a || a >= f.b) continue;
      per += `<span class="zp-p ${p[0] === 'S' ? 's' : 't'}" style="left:${pct(a, f)}%;width:${pct(b, f) - pct(a, f)}%">${p}</span>`;
    }
    const th = ms(heute);
    const hm = th >= f.a && th < f.b ? `<span class="zp-heute-marke" style="left:${pct(th + TAG / 2, f)}%">heute ${kurzDatum(th)}</span>` : '';
    return `<div class="zp-achse"><div class="zp-per">${per}</div><div class="zp-mons">${mon}</div>${hm}</div>`;
  }

  function balken(m, r, f, farbe, gross) {
    if (!r.L.length) return `<div class="zp-leer">${esc(m.hinweis || 'keine Stunden')}</div>`;
    const th = ms(heuteISO());
    let s = '';
    if (!r.seg.length) {
      const l = pct(r.t0, f), w = pct(r.t1, f) - l;
      const fill = r.t1 <= th ? 100 : r.t0 >= th ? 0 : (th - r.t0) / (r.t1 - r.t0) * 100;
      return `<div class="zp-seg ohne" style="left:${l}%;width:${w}%;--c:${farbe}" title="${esc(m.modul)} · ${h(r.H)} Std."><b style="width:${fill}%"></b><span>${esc(m.art === 'keine' ? 'ohne Kompetenzliste' : '')}</span></div>`;
    }
    for (const g of r.seg) {
      if (g.t0 == null) continue;
      const l = pct(g.t0, f), w = pct(g.t1, f) - l; if (w <= 0) continue;
      const fill = g.t1 <= th ? 100 : g.t0 >= th ? 0 : (th - g.t0) / (g.t1 - g.t0) * 100;
      const ist = r.istIdx === g.i ? ' ist' : '';
      const tip = `${g.it.nr}${g.it.prozent != null ? ' (' + g.it.prozent + ' %)' : ''} · ${kurzDatum(g.t0)}–${kurzDatum(g.t1 - 1)} · ${h(g.std)} Std.${g.it.kurz ? '\n' + g.it.kurz : ''}`;
      s += `<div class="zp-seg ${g.st}${ist}${gross ? ' gross' : ''}" style="left:${l}%;width:${w}%;--c:${farbe}" title="${esc(tip)}"><b style="width:${fill}%"></b><span>${w > 2.2 ? esc(g.it.nr) : ''}</span></div>`;
    }
    return s;
  }

  function modulZeile(d, k, m, f, heute) {
    const r = rechne(m, heute);
    if (r.L.length && (r.t1 <= f.a || r.t0 >= f.b)) return '';
    const stx = statusText(m, r);
    const farbe = k.farbe || 'var(--accent)';
    return `<div class="zp-zeile" data-klasse="${esc(k.klasse)}" data-modul="${esc(m.modul)}">
      <div class="zp-label" title="${esc(m.titel)}"><span class="zp-code" data-sprung="1">${esc(m.modul)}</span>${m.zeitraum ? `<span class="badge ${esc(m.zeitraum.toLowerCase())}">${esc(m.zeitraum)}</span>` : ''}${m.herkunft === 'geschaetzt' ? `<span class="zp-schaetz" title="${esc(m.hinweis)}">≈</span>` : ''}</div>
      <div class="zp-spur">${hintergrund(d, f, heute)}${balken(m, r, f, farbe)}</div>
      <div class="zp-stand ${stx.art}" title="${esc(stx.lang)}">${esc(stx.kurz)}${istVergleich(r)}<small>${r.L.length && !r.vorbei && r.begonnen ? 'noch ' + h(r.rest) + ' von ' + h(r.H) + ' Std.' : r.L.length ? h(r.H) + ' Std.' : ''}</small></div>
    </div>`;
  }

  function steuerung(d, f, mitBasis) {
    const P = ['auto', 'Jahr', 'S1', 'S2', 'T1', 'T2', 'T3'].filter(p => p === 'auto' || d.perioden[p]);
    const name = { auto: 'Aktuell', Jahr: 'Schuljahr' };
    return `<div class="zp-steuer"><span class="zp-gruppe">${P.map(p => `<button class="chip${z.periode === p ? ' on' : ''}" data-periode="${p}" title="${p === 'auto' ? 'Gesamt: Schuljahr · Klasse: laufendes Semester/Trimester' : ''}">${name[p] || p}</button>`).join('')}</span>
      ${mitBasis ? `<span class="zp-gruppe" title="Wie die Stunden auf K1 … Kn verteilt werden"><span class="zp-lbl">Aufteilung</span><button class="chip${z.basis === 'gewichtung' ? ' on' : ''}" data-basis="gewichtung" title="nach Gewichtung (Référentiel d'évaluation)">Gewichtung</button><button class="chip${z.basis === 'lehrplan' ? ' on' : ''}" data-basis="lehrplan" title="nach Richtzeit der Lernsituationen (Référentiel de formation); gemeinsame Lernsituationen gleich geteilt – fehlt sie, gilt die Gewichtung">Lehrplan</button></span>` : ''}
      <span class="zp-legende"><i class="lg fertig"></i>gehalten <i class="lg laeuft"></i>läuft <i class="lg offen"></i>offen <i class="lg frei"></i>Ferien <i class="lg heute"></i>heute</span></div>`;
  }

  // ------------------------------------------------------------ Seitenleiste
  function seite(el, d, opts) {
    const heute = heuteISO();
    let html = `<div class="modul zp-nav${!z.auswahl ? ' on' : ''}" data-zk=""><span class="code">Alle Klassen</span><span class="kz">${esc(d.jahr)}</span><span class="t">Gesamtübersicht · heute ${kurzDatum(ms(heute))}</span></div>`;
    for (const k of d.klassen) {
      const lauf = k.module.map(m => ({ m, r: rechne(m, heute) })).filter(x => x.r.begonnen && !x.r.vorbei);
      const txt = lauf.length ? lauf.map(x => x.m.modul + ' ' + (x.r.jetzt ? x.r.jetzt.it.nr : Math.round(x.r.quote * 100) + ' %')).join(' · ') : 'zurzeit kein Modul';
      const q = lauf.length ? lauf.reduce((a, x) => a + x.r.quote, 0) / lauf.length : 0;
      html += `<div class="modul zp-nav${z.auswahl === k.klasse ? ' on' : ''}" data-zk="${esc(k.klasse)}"><span class="code"><span class="punkt" style="background:${esc(k.farbe || 'var(--text-3)')}"></span>${esc(k.klasse)}${k.rattrapage ? '<span class="badge r">R</span>' : ''}</span><span class="kz">${k.zeitraum === 'trimester' ? 'Trim.' : 'Sem.'}</span><span class="t">${esc(txt)}</span>${lauf.length ? `<span class="zp-mini" style="--c:${esc(k.farbe || 'var(--accent)')}"><b style="width:${q * 100}%"></b></span>` : ''}</div>`;
    }
    el.innerHTML = html;
    if (z.auswahl && !d.klassen.some(k => k.klasse === z.auswahl)) z.auswahl = '';
    el.querySelectorAll('[data-zk]').forEach(x => x.onclick = () => { z.auswahl = x.dataset.zk; merk('zp.klasse', z.auswahl); opts.neu(); });
  }

  // ------------------------------------------------------------ Detail
  function detail(el, d, opts) {
    const heute = heuteISO();
    const k = z.auswahl ? d.klassen.find(x => x.klasse === z.auswahl) : null;
    const f = fenster(d, heute, k);
    let html = '';
    const hinweise = [];
    if (!d.stundenplan) hinweise.push('Für ' + d.jahr + ' gibt es keinen Stundenplan im Journal – die Stunden sind aus Std./Woche geschätzt.');
    if (d.ferien_herkunft && d.ferien_herkunft !== 'online' && d.ferien_herkunft !== 'eingebaut') hinweise.push('Ferien geschätzt (keine ferien.json für ' + d.jahr + ').');
    if (heuteParam) hinweise.push('Simulierter Tag: ' + heuteParam + ' (Adresse ?heute=…).');
    const kopf = k
      ? `<div class="zp-titel"><span class="punkt gross" style="background:${esc(k.farbe || 'var(--text-3)')}"></span><h2>${esc(k.klasse)}</h2><span class="zp-unter">${esc(k.name !== k.klasse ? k.name : '')} ${k.zeitraum === 'trimester' ? 'Trimesterklasse' : 'Semesterklasse'} · ${esc(d.jahr)} · Fenster ${esc(f.p === 'Jahr' ? 'Schuljahr' : f.p)}</span></div>`
      : `<div class="zp-titel"><h2>Zeitplan ${esc(d.jahr)}</h2><span class="zp-unter">alle Klassen · Kompetenzen der Reihe nach auf den echten Unterrichtsstunden (Stundenplan, Ferien, Ausfälle aus dem Journal) · Fenster ${esc(f.p === 'Jahr' ? 'Schuljahr' : f.p)}</span></div>`;
    html += `<div class="karte zp-karte">${kopf}${steuerung(d, f, true)}${hinweise.length ? `<div class="hinweis">${hinweise.map(esc).join('<br>')}</div>` : ''}
      <div class="zp-gantt">${`<div class="zp-zeile zp-kopfzeile"><div class="zp-label"></div>${achse(d, f, heute, k)}<div class="zp-stand"><small>Soll heute</small></div></div>`}`;
    const liste = k ? [k] : d.klassen;
    let zeilen = 0;
    for (const kk of liste) {
      const rows = kk.module.map(m => modulZeile(d, kk, m, f, heute)).filter(Boolean);
      if (!rows.length) continue;
      zeilen += rows.length;
      if (!k) html += `<div class="zp-klasse" data-zk="${esc(kk.klasse)}"><span class="punkt" style="background:${esc(kk.farbe || 'var(--text-3)')}"></span>${esc(kk.klasse)}${kk.rattrapage ? '<span class="badge r">Rattrapage</span>' : ''}<span class="zp-unter">${kk.zeitraum === 'trimester' ? 'Trimester' : 'Semester'}</span></div>`;
      html += rows.join('');
    }
    if (!zeilen) html += `<div class="leer">Keine Module in diesem Zeitfenster.</div>`;
    html += `</div></div>`;
    if (k) html += k.module.map(m => karte(d, k, m, heute)).join('');
    else html += uebersichtListe(d, heute);
    el.innerHTML = html;
    binden(el, d, opts);
    el.scrollTop = 0;
  }

  /* Gesamtübersicht unter dem Gantt: je laufendem Modul, was fertig sein muss und was noch kommt. */
  function uebersichtListe(d, heute) {
    const z1 = [];
    for (const k of d.klassen) for (const m of k.module) {
      const r = rechne(m, heute);
      if (!r.begonnen || r.vorbei || !r.seg.length) continue;
      const fertig = r.seg.filter(g => g.st === 'fertig').map(g => g.it.nr);
      const offen = r.seg.filter(g => g.st === 'offen').map(g => g.it.nr);
      z1.push(`<tr data-klasse="${esc(k.klasse)}" data-modul="${esc(m.modul)}"><td><span class="punkt" style="background:${esc(k.farbe || 'var(--text-3)')}"></span><b>${esc(k.klasse)}</b> ${esc(m.modul)}</td>
        <td class="zp-ok">${fertig.length ? '✓ ' + fertig.join(', ') : '–'}</td>
        <td class="zp-jetzt">${r.jetzt ? '▶ ' + esc(r.jetzt.it.nr) + ` <small>bis ~${kurzDatum(r.jetzt.t1 - 1)} · ${Math.round(r.jetzt.anteil * 100)} %</small>` : '–'}</td>
        <td class="zp-offen">${offen.length ? offen.join(', ') : '–'}</td>
        <td class="num">${h(r.gehalten)} / ${h(r.H)}</td>
        <td>${r.naechste ? langDatum(ms(r.naechste[0])) : '–'}</td><td>${istVergleich(r)}</td></tr>`);
    }
    if (!z1.length) return '';
    return `<div class="karte"><h2>Stand heute <span class="badge">${z1.length}</span><span class="rechts">laufende Module · Soll nach Plan</span></h2>
      <div class="zp-tabwrap"><table class="zp-tab"><thead><tr><th>Klasse · Modul</th><th>muss abgeschlossen sein</th><th>jetzt dran</th><th>noch abzuarbeiten</th><th class="num">Std. gehalten</th><th>nächste Stunde</th><th>Ist</th></tr></thead><tbody>${z1.join('')}</tbody></table></div></div>`;
  }

  /* Karte je Modul: Kompetenz-Zeilen (klassisches Gantt), Soll-Stand, Ist-Stand von Hand. */
  function karte(d, k, m, heute, eingebettet) {
    const r = rechne(m, heute);
    const farbe = k.farbe || 'var(--accent)';
    const v = { a: ms(m.von), b: ms(m.bis) + TAG };
    if (r.L.length) { v.a = Math.min(v.a, r.t0); v.b = Math.max(v.b, r.t1); }
    const f = { p: '', a: v.a, b: v.b };
    const stx = statusText(m, r);
    let zeilen = '';
    if (r.seg.length) {
      for (const g of r.seg) {
        const tl = g.t0 == null ? '' : `${kurzDatum(g.t0)}–${kurzDatum(g.t1 - 1)}`;
        zeilen += `<div class="zp-kz ${g.st}${r.istIdx === g.i ? ' ist' : ''}"><div class="zp-knr" style="--c:${esc(farbe)}">${esc(g.it.nr)}</div>
          <div class="zp-ktext"><div>${esc(g.it.kurz)}</div><small>${tl} · ${h(g.std)} Std.${g.it.prozent != null ? ' · ' + g.it.prozent + ' %' : ''}${g.it.punkte != null ? ' · ' + g.it.punkte + ' P' : ''}${g.st === 'laeuft' ? ' · <b>' + Math.round(g.anteil * 100) + ' % geschafft</b>' : ''}</small></div>
          <div class="zp-spur klein">${hintergrund(d, f, heute)}${balken(m, { ...r, seg: [g] }, f, farbe, true)}</div></div>`;
      }
    } else {
      zeilen = `<div class="zp-kz"><div class="zp-knr" style="--c:${esc(farbe)}">∑</div><div class="zp-ktext"><div>${esc(m.art === 'keine' ? 'Keine Kompetenzliste (kein Référentiel/Programme mit Kompetenzen) – nur Stundenfortschritt.' : '')}</div><small>${r.L.length ? h(r.gehalten) + ' von ' + h(r.H) + ' Std.' : ''}</small></div><div class="zp-spur klein">${hintergrund(d, f, heute)}${balken(m, r, f, farbe, true)}</div></div>`;
    }
    const fertig = r.seg.filter(g => g.st === 'fertig'), offen = r.seg.filter(g => g.st === 'offen');
    const zus = r.L.length && r.seg.length ? `<div class="zp-zus">
        <div class="zp-box ok"><b>Muss abgeschlossen sein</b>${fertig.length ? fertig.map(g => `<span>${esc(g.it.nr)}</span>`).join('') : '<em>noch nichts</em>'}</div>
        <div class="zp-box jetzt"><b>Jetzt dran</b>${r.vorbei ? '<em>Modul vorbei</em>' : r.jetzt ? `<span>${esc(r.jetzt.it.nr)}</span><em>${r.begonnen ? Math.round(r.jetzt.anteil * 100) + ' % · bis ~' + kurzDatum(r.jetzt.t1 - 1) : 'ab ' + kurzDatum(r.jetzt.t0)}</em>` : '–'}</div>
        <div class="zp-box offen"><b>Noch abzuarbeiten</b>${offen.length ? offen.map(g => `<span>${esc(g.it.nr)}</span>`).join('') + `<em>${h(offen.reduce((a, g) => a + g.std, 0) + (r.jetzt && r.jetzt.st === 'laeuft' ? r.jetzt.std * (1 - r.jetzt.anteil) : 0))} Std.</em>` : '<em>nichts mehr</em>'}</div>
        <div class="zp-box"><b>Stunden</b><span class="zahl">${h(r.gehalten)}</span><em>von ${h(r.H)} gehalten${r.naechste ? ' · nächste ' + langDatum(ms(r.naechste[0])) : ''}</em></div>
      </div>` : '';
    const istKn = z.nurLesen ? (r.istIdx >= 0 ? `<div class="zp-istwahl"><span class="zp-lbl" title="am Mac gesetzt">Ist-Stand</span>${istVergleich(r)}</div>` : '') : r.seg.length ? `<div class="zp-istwahl" data-klasse="${esc(k.klasse)}" data-modul="${esc(m.modul)}"><span class="zp-lbl" title="Von Hand: woran arbeitest du tatsächlich? Wird mit dem Soll verglichen.">Ist-Stand</span>${r.seg.map(g => `<button class="chip${m.ist === g.it.nr ? ' on' : ''}" data-ist="${esc(g.it.nr)}">${esc(g.it.nr)}</button>`).join('')}<button class="chip${m.ist === 'fertig' ? ' on' : ''}" data-ist="fertig">fertig</button>${m.ist ? '<button class="chip leise" data-ist="">zurücksetzen</button>' : ''}${istVergleich(r)}</div>` : '';
    const basis = (z.basis === 'lehrplan' && m.anteile.lehrplan) ? 'Lehrplan-Richtzeit' : 'Gewichtung';
    return `<div class="karte zp-modul" style="--c:${esc(farbe)}"><h2>${eingebettet ? 'Zeitplan' : `<span class="punkt" style="background:${esc(farbe)}"></span>${esc(m.modul)}`} ${m.zeitraum ? `<span class="badge ${esc(m.zeitraum.toLowerCase())}">${esc(m.zeitraum)}</span>` : ''}<span class="zp-stand-inline ${stx.art}">${esc(stx.lang)}</span>
        <span class="rechts">${r.L.length ? kurzDatum(r.t0) + '–' + kurzDatum(r.t1 - 1) + ' · ' + r.L.length + ' Termine · ' + h(r.H) + ' Std.' : ''}${r.seg.length ? ' · Aufteilung: ' + basis : ''}${m.vorlage ? ' · Kompetenzen wie ' + esc(m.vorlage) : ''}</span></h2>
      ${!eingebettet && m.titel ? `<div class="zp-mtitel" data-sprung-modul="${esc(m.modul)}" data-klasse="${esc(k.klasse)}">${esc(m.titel)}</div>` : ''}
      ${m.hinweis ? `<div class="hinweis zp-warn">≈ ${esc(m.hinweis)}</div>` : ''}
      ${zus}<div class="zp-kliste">${`<div class="zp-kz zp-kopfzeile"><div></div><div></div>${achse(d, f, heute, k)}</div>`}${zeilen}</div>${istKn}</div>`;
  }

  function modulKarte(el, d, klasse, modul, opts) {
    const k = d.klassen.find(x => x.klasse === klasse); if (!k) return false;
    const m = k.module.find(x => x.modul === modul); if (!m) return false;
    el.innerHTML = karte(d, k, m, heuteISO(), true);
    binden(el, d, opts);
    return true;
  }

  function binden(el, d, opts) {
    el.querySelectorAll('[data-periode]').forEach(b => b.onclick = () => { z.periode = b.dataset.periode; merk('zp.periode', z.periode); opts.neu(); });
    el.querySelectorAll('[data-basis]').forEach(b => b.onclick = () => { z.basis = b.dataset.basis; merk('zp.basis', z.basis); opts.neu(); });
    el.querySelectorAll('[data-zk]').forEach(b => b.onclick = () => { z.auswahl = b.dataset.zk; merk('zp.klasse', z.auswahl); opts.neu(); });
    el.querySelectorAll('.zp-zeile[data-modul], tr[data-modul]').forEach(row => {
      const lbl = row.querySelector('[data-sprung]') || row.querySelector('td');
      if (lbl) { lbl.style.cursor = 'pointer'; lbl.title = 'Kompetenzen dieses Moduls zeigen'; lbl.onclick = e => { e.stopPropagation(); opts.zumModul(row.dataset.klasse, row.dataset.modul); }; }
      if (row.classList.contains('zp-zeile') && !z.auswahl) row.querySelector('.zp-spur').onclick = () => { z.auswahl = row.dataset.klasse; merk('zp.klasse', z.auswahl); opts.neu(); };
    });
    el.querySelectorAll('[data-sprung-modul]').forEach(x => x.onclick = () => opts.zumModul(x.dataset.klasse, x.dataset.sprungModul));
    el.querySelectorAll('.zp-istwahl').forEach(w => w.querySelectorAll('[data-ist]').forEach(b => b.onclick = async () => {
      const ist = b.dataset.ist;
      const r = await fetch('/api/fortschritt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jahr: d.jahr, klasse: w.dataset.klasse, modul: w.dataset.modul, ist }) }).then(x => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { alert('Ist-Stand nicht gespeichert: ' + (r.fehler || 'Server nicht erreichbar')); return; }
      const k = d.klassen.find(x => x.klasse === w.dataset.klasse); const m = k && k.module.find(x => x.modul === w.dataset.modul);
      if (m) m.ist = ist;
      opts.neu();
    }));
  }

  const auswahl = () => z.auswahl;
  function waehle(k) { z.auswahl = k || ''; merk('zp.klasse', z.auswahl); }
  window.RFZ = { laden, seite, detail, modulKarte, heuteISO, setze, auswahl, waehle };
})();
