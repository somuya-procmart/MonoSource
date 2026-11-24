"""
Cleans extract.py's items.jsonl: product names, descriptions, brand and part number (MPN).

  python3 -I apps/api/scripts/adani/clean.py --data apps/api/.data/adani [--report]

Writes <data>/items.clean.jsonl (seed.ts uses it when present). Every item keeps its original SAP short text in
`raw_name`; the seed adds its words to the item's search keywords, so a search typed the SAP way still finds it.

What changes (nothing is invented: every value is read off the item's own text):
  name         SAP escapes decoded (L<(>&<)>T → L&T), ';' and ',' unified to ', ', stray/doubled punctuation dropped,
               ALL-CAPS text set in title case with codes, sizes and acronyms kept upper (BEARING,ROLLER,NU226 →
               Bearing, Roller, NU226). Text someone already wrote in mixed case is only tidied.
  description  '(blank)' and other placeholders removed, escapes decoded, dropped when it only repeats the name
  mpn          only after an explicit label (PN:, P/N, PART NO, CAT NO, MM:, MODEL:), so PNEUMATIC → 'EUMATIC' and
               flange ratings (PN16) are no longer read as part numbers; a code written with one space (3NA1 227) is kept whole
  brand        the make written as the last part of the name (…,SIEMENS) when it is a known make; material words
               (NBR, PTFE, MS) are never brands; one spelling per make (CAT/CATERPILLAR → Caterpillar, skf → SKF)
"""
import argparse, json, os, re, sys
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--report', action='store_true', help='print before/after samples')
a = ap.parse_args()

src = os.path.join(a.data, 'items.jsonl')
items = [json.loads(l) for l in open(src) if l.strip()]
tax = json.load(open(os.path.join(a.data, 'taxonomy.json')))

# ───────── text basics ─────────
def unescape(s):
    s = s or ''
    for _ in range(4):                                     # SAP: <(>&<)> → &; some texts were escaped twice
        t = re.sub(r'<\(>(.)<\)>', r'\1', s)
        if t == s: break
        s = t
    s = re.sub(r'<\(>&?(<\)?>?)?$', '&', s)              # cut off at the length limit
    while re.search(r'<\(>|<\)>', s): s = re.sub(r'<\(>|<\)>', '', s)   # broken escapes left over
    s = s.replace('&amp;', '&').replace('&quot;', '"').replace('&#39;', "'").replace('�', '')
    return re.sub(r'[\x00-\x1f]', ' ', s)

PLACEHOLDER = re.compile(r'^\W*(\(?blank\)?|na|n/a|nil|none|null|-+|\.+|0)\W*$', re.I)

def squash(s):
    return re.sub(r'\s+', ' ', s).strip()

def key(s):
    return re.sub(r'[^A-Z0-9]', '', s.upper())

# ───────── brands ─────────
# Words that describe an item and are never its make, even when written where a make usually goes.
NOT_BRAND = set('''NBR PTFE FKM EPDM VITON NEOPRENE RUBBER MS SS CS GI CI PVC HDPE UPVC CPVC XLPE FRLS ALU AL CU BRASS COPPER STEEL
NYLON WHITE BLACK RED BLUE GREEN YELLOW GREY ORANGE FULL HALF STD STANDARD SPARE SPARES NEW OLD OEM IBR RDSO ISI IS BIS NA NIL
HP KW KV LT HT AC DC SET KIT ASSY PAIR LH RH TOP BOTTOM FRONT REAR LEFT RIGHT INNER OUTER UPPER LOWER MALE FEMALE SMALL LARGE BIG
TYPE SIZE OD ID SCH ERW SEAMLESS SMLS ANTICORROSIVE HDG MTR NOS EA LOT JOB SERVICE REPAIR CABLE PIPE XLPE CABLE IMPORTED LOCAL INDIAN GENUINE ORIGINAL'''.split())
# One spelling per make. Keys are key()s (letters and digits only).
ALIAS = {'CAT': 'Caterpillar', 'CATERPILLAR': 'Caterpillar', 'ATLASCOPCO': 'Atlas Copco', 'ATLAS': 'Atlas Copco', 'LEYLAND': 'Ashok Leyland',
         'ASHOKLEYLAND': 'Ashok Leyland', 'ESCORT': 'Escorts', 'BHARATHEARTHMOVERSLTD': 'BEML', 'BHARATEARTHMOVERS': 'BEML',
         'FLSMIDTH': 'FLSmidth', 'FLS': 'FLSmidth', 'LT': 'L&T', 'LARSONTOUBRO': 'L&T', 'LARSENTOUBRO': 'L&T', 'SCHNEIDERELECTRIC': 'Schneider',
         'GODREJBOYCE': 'Godrej & Boyce', 'IR': 'Ingersoll Rand', 'INGERSOLLRAND': 'Ingersoll Rand', 'TATAHITA': 'Tata Hitachi',
         'NIIGATAPWR': 'Niigata Power', 'VOLVOPENTA': 'Volvo Penta', 'KOEL': 'Kirloskar Oil Engines', 'UNB': 'Unbrako',
         'LANDT': 'L&T', 'LTCASE': 'L&T', 'DLINK': 'D-Link', 'BUSSMAN': 'Bussmann', 'EH': 'E+H'}
SUFFIX = re.compile(r'\s+(?:PVT\.?|PRIVATE|LTD\.?|LIMITED|CO\.?|CORP\.?|INC\.?|GMBH|EQUIP(?:MENT)?S?|PUMPS|VALVES|INDIA)$', re.I)
KEEP_CASE = {'FLSmidth', 'L&T', 'SKF', 'FAG', 'ABB', 'BHEL', 'BEML', 'KSB', 'JCB', 'SMC', 'KBL', 'ESAB', 'JLG', 'IFM', 'SEW', 'GEA', 'GE', 'HP',
             'IOCL', 'ZPMC', 'HBXG', 'EEL', 'IWI', 'TPS', 'MBPL', 'IKN', 'IHC', 'SGL', 'STL', 'DLW', 'BSBK', 'C&S', 'APL', 'HTC', 'KION', 'OCL', 'ATW'}

def brand_display(b):
    b = squash(unescape(b)).strip(' .,;:-')
    if not b: return ''
    parts = [p.strip() for p in re.split(r'\s*/\s*', b) if p.strip()]
    out = []
    for p in parts:
        while SUFFIX.search(p) and len(SUFFIX.sub('', p)) >= 2: p = SUFFIX.sub('', p).strip()
        k = key(p)
        if k in ALIAS: out.append(ALIAS[k]); continue
        u = p.upper()
        if u in KEEP_CASE or (len(k) <= 4 and ' ' not in p) or '&' in p: out.append(u)
        elif p == u or p == p.lower(): out.append(' '.join(w.upper() if len(w) <= 2 or w.upper() in KEEP_CASE else w[:1].upper() + w[1:].lower() for w in p.split()))
        else: out.append(p)
    return '/'.join(dict.fromkeys(out))

def is_brand_word(b):
    ws = key(b)
    return bool(ws) and not all(w in NOT_BRAND for w in re.findall(r'[A-Z]+', b.upper())) and b.upper() not in NOT_BRAND

# Words of the category structure: a trailing "FAN" or "VALVE" is a product, not a make.
TAXW = set()
for t in tax:
    for f in (t['category'], t['sub'], t['child'], t['product']):
        TAXW.update(re.findall(r'[A-Z]{2,}', f.upper()))

# Known makes: those the ProcMart file identified, and names that close many SAP short texts.
known = Counter()
for it in items:
    for p in re.split(r'\s*/\s*', it.get('brand') or ''):
        if p.strip(): known[key(p)] += 3
tail = Counter()
def segments(name):
    return [s.strip() for s in re.split(r'[,;]', name) if s.strip()]
for it in items:
    s = segments(unescape(it['name']))
    if len(s) >= 2 and re.fullmatch(r"[A-Za-z][A-Za-z&.\- ']{1,24}", s[-1]): tail[s[-1].upper()] += 1
def known_make(seg):
    u = seg.upper(); k = key(seg)
    if not is_brand_word(seg) or len(k) < 2: return False
    if k in ALIAS or known[k] >= 3: return True
    words = re.findall(r'[A-Z]+', u)
    return tail[u] >= 15 and not all(w in TAXW for w in words)

# ───────── part numbers ─────────
LABEL = r'(?:P\s*/\s*N|PN|PART\s*(?:NO|NUMBER|#)|CAT(?:ALOG(?:UE)?)?\s*(?:NO|NUMBER|#)?|MM|MODEL(?:\s*NO)?|ORDER\s*(?:NO|CODE)|ART(?:ICLE)?\s*NO)'
MPN_RX = re.compile(r'(?<![A-Z0-9])' + LABEL + r'\s*(?:[:#]|\.(?=\s)|NO\.?\s*:?|-|(?<=NO)\s|(?<=NUMBER)\s)\s*([A-Z0-9][A-Z0-9./\-_+: ]{1,40})', re.I)
PRIORITY = ['P/N', 'PN', 'PART', 'CAT', 'ORDER', 'ART', 'MODEL', 'MM']

# "PN W0104317888" / "PN43284": no label punctuation, but a long code right after PN (PN16 / PN 6.4 are pressure ratings)
BARE_PN = re.compile(r'(?<![A-Z0-9])PN\s?(?=[A-Z0-9./\-]*\d)([A-Z0-9][A-Z0-9./\-]{4,30})(?![A-Z0-9])', re.I)

def code_value(raw):
    v = re.split(r'[,;]', raw)[0].strip(' .-_:')
    v = re.sub(r'^(?:PN|P/N)\s*[:#]\s*', '', v, flags=re.I)            # PN:PN:04821
    toks = v.split(' ')
    if len(toks) > 1:   # "3NA1 227" / "PHC 16B-2" are one code; "BMS300 DDT-P 12-24V DC" is a code and then words
        two = re.fullmatch(r'[A-Z0-9.\-/]{1,8}', toks[1], re.I) and re.search(r'\d', toks[0] + toks[1]) and (re.search(r'\d', toks[1]) or not re.search(r'\d', toks[0]))
        v = ' '.join(toks[:2]) if two else toks[0]
    v = re.sub(r':(?![^:]*\d).*$', '', v)                                # 919080562:EEL → 919080562 (a make after the colon)
    return v.upper().strip(' .-_:')

def find_mpn(text):
    best = None
    found = [(m, re.sub(r'\s', '', m.group(0).split(m.group(1))[0]).upper()) for m in MPN_RX.finditer(text)] + [(m, 'PN') for m in BARE_PN.finditer(text)]
    for m, lab in found:
        v = code_value(m.group(1))
        explicit = m.re is MPN_RX and re.match(r'P/?N|PART', lab)
        if len(re.sub(r'[^A-Z0-9]', '', v)) < 3: continue
        if not re.search(r'\d', v) and not (explicit and re.fullmatch(r'[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+', v)): continue   # PN:CT-ERE, PN:GLC-EX-SMD
        if re.fullmatch(r'\d{1,2}\.\d', v): continue                                 # 1.3 / 6.4: a rating
        if re.fullmatch(r'\d{1,3}(MM|M|V|A|W|KW|BAR)', v) or (not explicit and re.fullmatch(r'\d{1,3}', v)): continue   # a size, not a code
        rank = next((i for i, p in enumerate(PRIORITY) if lab.startswith(p)), len(PRIORITY)) + (0.5 if m.re is BARE_PN else 0)
        if best is None or rank < best[0]: best = (rank, v)
    return best[1] if best else ''

# ───────── names ─────────
ACRONYM = set('''MCB MCCB RCCB ELCB ACB VCB VFD UPS PLC SMPS HMI LED CFL HRC PVC CPVC UPVC HDPE LDPE XLPE FRLS PTFE NBR FKM EPDM SS MS CS GI CI
HDG ERW AC DC LT HT HV LV DOL TPN TP DP SP SPN DPN FP OD ID PCD NB BSP NPT BSPT UNC UNF IP RTD PT CT PT100 SCH ISI IS BIS DIN ASTM ANSI
API ASME JIS EN ISO OEM ABB SKF FAG BHEL BEML KSB JCB SMC KBL LH RH PU PP PE PCB IC IGBT SCR CPU RAM SSD HDD USB LAN WAN POE SFP UTP
HSS HSN GST LPG CNG CO2 O2 N2 DG CCTV PTZ NVR DVR VGA HDMI RJ45 MOV SPD AVR GPS RFID QR UV IR LCD TFT DVD PCV PRV NRV SOV BFV VRLA SMF
AL CU MCC PCC APFC TPI TPR RPM PSI KV KW KVA KVAR MVA VA MW TR HP SQMM MM CM KG DIA DWG MFR PN FFR CAT FRP GRP DCP LOTO CO2 SIO2'''.split())
LOWER = set('of for and with to in on the a an by or at as per'.split())
LABELS = {'PN', 'P/N', 'DWG', 'MM', 'CAT', 'MFR', 'MODEL', 'SIZE', 'BA', 'SL', 'REF'}

def case_token(t, first):
    if not t: return t
    core = re.sub(r'^[^A-Za-z0-9]+|[^A-Za-z0-9]+$', '', t)
    if not core: return t
    u = core.upper()
    if '/' in core and not re.search(r'\d', core):           # F/FD stays, F/TRANSFORMER → F/Transformer
        return t.replace(core, '/'.join(case_token(x, first) if len(x) > 2 else x.upper() for x in core.split('/')), 1)
    if re.search(r'\d', core): new = u                       # codes and sizes
    elif u in ACRONYM or u in KEEP_CASE or u in LABELS: new = u
    elif len(u) <= 3 and not re.search(r'[AEIOU]', u) and u not in ('MY', 'BY', 'TRY', 'DRY', 'FLY', 'PLY'): new = u  # BRG, HYD stay readable either way
    elif not first and u.lower() in LOWER: new = u.lower()
    else: new = re.sub(r'[A-Za-z]+', lambda m: m.group(0).upper() if m.group(0).upper() in ACRONYM else m.group(0)[:1].upper() + m.group(0)[1:].lower(), core)
    return t.replace(core, new, 1)

def clean_name(raw):
    s = unescape(raw)
    s = re.sub(r'\s*[;,]\s*', ', ', s)                     # one separator style
    s = re.sub(r'(,\s*){2,}', ', ', s)
    s = re.sub(r'\s*:\s*', ':', s)                          # PN: 123 / PN :123 → PN:123
    s = re.sub(r'\(\s+', '(', re.sub(r'\s+\)', ')', s))
    s = squash(s).strip(' ,;:-_.*#')
    s = s.rstrip('(').rstrip()                              # cut-off "...(" at the 40-char SAP limit
    letters = re.sub(r'[^A-Za-z]', '', ' '.join(w for w in re.split(r'[\s,]+', s) if not re.search(r'\d', w)))   # 33kV / 150mm2 don't make a name mixed-case
    if letters and letters.isupper():
        toks = re.split(r'(\s+|,\s*|:)', s)
        out, first = [], True
        for t in toks:
            if t and not re.fullmatch(r'\s+|,\s*|:', t):
                out.append(case_token(t, first)); first = False
            else:
                out.append(t)
                if t.startswith(','): first = False
        s = ''.join(out)
        # the text right after a code label stays as written (PN:Abc-12 → PN:ABC-12)
        s = re.sub(r'\b(PN|P/N|DWG|MM|CAT|MODEL):(\S+)', lambda m: f'{m.group(1)}:{m.group(2).upper()}', s)
    elif s:
        s = s[0].upper() + s[1:]
    return s

def clean_desc(d, name_raw):
    d = squash(unescape(d))
    if not d or PLACEHOLDER.match(d): return ''
    if key(d) == key(name_raw): return ''
    return d

# ───────── run ─────────
stats = Counter(); samples = []
with open(os.path.join(a.data, 'items.clean.jsonl'), 'w') as f:
    for it in items:
        raw = it['name']
        name = clean_name(raw)
        desc = clean_desc(it.get('description', ''), raw)
        text = f"{unescape(raw)} {desc}"
        mpn = find_mpn(text)
        brand = it.get('brand') or ''
        if brand and not is_brand_word(brand): brand = ''; stats['brand dropped (material word)'] += 1
        if not brand:
            segs = segments(unescape(raw))
            if len(segs) >= 2 and known_make(segs[-1]): brand = segs[-1]; stats['brand from name'] += 1
        if not brand:
            m = re.search(r'\b(?:MAKE|MFR|MANUFACTURER|BRAND)\s*:\s*([A-Za-z][A-Za-z&. ]{1,30}?)(?=\s*(?:[,;]|$|\b(?:PN|PART|MODEL|CAT|MM|DWG|DRAWING|MATERIAL|OEM)\b))', text, re.I)
            if m and known_make(m.group(1).strip()): brand = m.group(1).strip(); stats['brand from text'] += 1
        brand = brand_display(brand) if brand else ''
        stats['name changed'] += name != raw
        stats['desc placeholder removed'] += bool(it.get('description')) and not desc
        stats['mpn before'] += bool(it.get('mpn')); stats['mpn after'] += bool(mpn)
        stats['mpn changed'] += bool(it.get('mpn')) and bool(mpn) and it['mpn'].upper() != mpn
        stats['mpn dropped'] += bool(it.get('mpn')) and not mpn
        stats['brand before'] += bool(it.get('brand')); stats['brand after'] += bool(brand)
        if a.report and len(samples) < 400: samples.append((raw, name, it.get('mpn'), mpn, it.get('brand'), brand))
        f.write(json.dumps({**it, 'raw_name': raw, 'name': name or raw, 'description': desc, 'mpn': mpn, 'brand': brand}) + '\n')

for k, v in stats.items(): print(f'{k:28} {v}', file=sys.stderr)
if a.report:
    import random; random.seed(7)
    for r in random.sample(samples, 60): print(' | '.join(str(x) for x in r))
