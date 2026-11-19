"""
Turns the three Adani workbooks into clean seed files for `seed.ts`.

  python3 -I apps/api/scripts/adani/extract.py \
      --bu "Business unit wise data.xlsx" --products "Adani Group_ProcMart_Supporting File.xlsx" \
      --taxonomy "Category Structure.xlsx" --out apps/api/.data/adani

Outputs (git-ignored; this is real customer data):
  taxonomy.json   category > sub category > child category > product type, with attributes
  org.csv         BU > company code > plant, per SAP server
  items.jsonl     one catalogue item per distinct description, with every (server, material code) it is known by
  po.csv          one row per PO line (FY25-26), the ARC flag and validity, linked to the item key
No prices exist in any of the files, so none are created.
"""
import argparse, json, os, re, sys
from collections import Counter, defaultdict
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument('--bu', required=True); ap.add_argument('--products', required=True); ap.add_argument('--taxonomy', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

def read(path, **kw):
    """CSV copies are used when present next to the xlsx (much faster on 50 MB workbooks)."""
    return pd.read_excel(path, dtype=str, engine='openpyxl', **kw)

def clean(s):
    if s is None or (isinstance(s, float) and pd.isna(s)) or str(s).strip().lower() in ('nan', '#n/a', 'none', ''): return ''
    return re.sub(r'\s+', ' ', str(s).replace('\xa0', ' ')).strip()

def key(s):
    s = clean(s).upper()
    s = re.sub(r'\s*([,;:/()\-])\s*', r'\1', s)
    return s

def code(s):
    s = clean(s)
    return re.sub(r'\.0$', '', s)

def xl_date(v):
    v = clean(v)
    if not v: return ''
    try:
        f = float(v)
        if f > 2958000: return ''  # 9999-12-31 = open-ended
        return (pd.Timestamp('1899-12-30') + pd.Timedelta(days=int(f))).strftime('%Y-%m-%d')
    except ValueError:
        try: return pd.Timestamp(v).strftime('%Y-%m-%d')
        except Exception: return ''

# ───────── taxonomy ─────────
t = read(a.taxonomy, sheet_name=0)
t.columns = [c.strip() for c in t.columns]
tax = {}
for r in t.itertuples(index=False):
    cat, sub, child, prod = (clean(x) for x in r[:4])
    if not prod: continue
    k = (cat, sub, child, prod)
    node = tax.setdefault(k, {'category': cat, 'sub': sub, 'child': child, 'product': prod, 'attrs': []})
    attr = clean(r[4])
    if attr and attr not in [x['name'] for x in node['attrs']]:
        node['attrs'].append({'name': attr, 'unit': clean(r[5]) or None, 'mandatory': clean(r[6]).lower() == 'mandatory'})
json.dump(list(tax.values()), open(os.path.join(a.out, 'taxonomy.json'), 'w'))
print('taxonomy product types', len(tax), file=sys.stderr)

# ───────── BU purchase data ─────────
b = read(a.bu, sheet_name=0)
b.columns = [c.strip() for c in b.columns]
b['server'] = b['Server'].map(code)
b['mat'] = b['Material number'].map(code)
b['ikey'] = b['Material short text'].map(key)
b = b[b['ikey'] != '']

org = b[['server', 'BU', 'Company code', 'Company name', 'Plant code', 'Plant name', 'Location']].copy()
org = org[org['server'] != ''].map(clean).drop_duplicates(subset=['server', 'Plant code', 'Company code', 'BU'])
org.to_csv(os.path.join(a.out, 'org.csv'), index=False)
print('org rows', len(org), file=sys.stderr)

items = {}
def item(k):
    return items.setdefault(k, {'key': k, 'name': '', 'description': '', 'uoms': Counter(), 'codes': set(), 'brand': '', 'mpn': '',
                                'pm_category': '', 'serviceability': '', 'pricing': '', 'spend_head': '', 'spend_category': '',
                                'capex_opex': '', 'rrs': '', 'material_group': '', 'po_lines': 0, 'plants': set(), 'last_po': '', 'arc': False})

po_cols = ['UID', 'server', 'Plant code', 'Purchasing document number', 'Purchasing document item', 'Purchasing Document date', 'Vendor code',
           'mat', 'ikey', 'Quantity', 'UoM', 'ARC/ Non ARC', 'Validitiy start date', 'Validity end date', 'Purchase requisition number',
           'Delivery date', 'Spend Category', 'Domestic/Import', 'MSME/Non MSME', 'Opex/Capex']
with open(os.path.join(a.out, 'po.csv'), 'w') as f:
    rows = []
    cols = list(b.columns)
    for r in b.itertuples(index=False, name=None):
        d = dict(zip(cols, r))
        k = d['ikey']; it = item(k)
        it['name'] = it['name'] or clean(d['Material short text'])
        it['uoms'][clean(d['UoM']).upper()] += 1
        if d['mat'] and d['server']: it['codes'].add((d['server'], d['mat']))
        it['spend_head'] = it['spend_head'] or clean(d['Spend Head']); it['spend_category'] = it['spend_category'] or clean(d['Spend Category'])
        it['capex_opex'] = it['capex_opex'] or clean(d['Opex/Capex']); it['material_group'] = it['material_group'] or code(d['Material group'])
        it['po_lines'] += 1; it['plants'].add((d['server'], clean(d['Plant code'])))
        pod = xl_date(d['Purchasing Document date']); it['last_po'] = max(it['last_po'], pod)
        arc = clean(d['ARC/ Non ARC']) == 'ARC'; it['arc'] = it['arc'] or arc
        rows.append([clean(d['UID']), d['server'], clean(d['Plant code']), code(d['Purchasing document number']), code(d['Purchasing document item']), pod,
                     code(d['Vendor code']), d['mat'], k, clean(d['Quantity']), clean(d['UoM']).upper(), 'ARC' if arc else '',
                     xl_date(d['Validitiy start date']), xl_date(d['Validity end date']), code(d['Purchase requisition number']),
                     xl_date(d['Delivery date']), clean(d['Spend Category']), clean(d['Domestic/Import']), clean(d['MSME/Non MSME']), clean(d['Opex/Capex'])])
    pd.DataFrame(rows, columns=po_cols).to_csv(f, index=False)
print('po lines', len(rows), file=sys.stderr)

# company code → server, so the products file's material codes can be placed on a server
cc_server = b.groupby('Company code')['server'].agg(lambda s: s.mode().iat[0]).to_dict()

# ───────── ProcMart product file (categories, serviceability, makes, long texts) ─────────
p = read(a.products, sheet_name='Unique main sheet')
p.columns = [c.strip() for c in p.columns]
SERV = {'Annual Rate Contract': 'arc', 'Quarterly Rate Contract': 'qrc', 'On Quote': 'on_quote', 'Non Serviceable': 'non_serviceable'}
pcols = list(p.columns)
for r in p.itertuples(index=False, name=None):
    d = dict(zip(pcols, r))
    k = key(d['Material_short_text'])
    if not k: continue
    it = item(k)
    it['name'] = it['name'] or clean(d['Material_short_text'])
    lt = clean(d['PO_Long Text'])
    if len(lt) > len(it['description']) and lt.upper().replace(' ', '') != k.replace(' ', ''): it['description'] = lt
    it['uoms'][clean(d['UoM as per Latest PO Date']).upper()] += 1
    cc = code(d['Company Code as per Latest PO Date']); m = code(d['Material Code as per Latest PO Date'])
    if m and cc_server.get(cc): it['codes'].add((cc_server[cc], m))
    cat = clean(d['Category'])
    it['pm_category'] = it['pm_category'] or (cat[:1].upper() + cat[1:] if cat else '')
    it['serviceability'] = it['serviceability'] or SERV.get(clean(d['Serviceability']), '')
    it['pricing'] = it['pricing'] or clean(d['Pricing mechanism'])
    it['brand'] = it['brand'] or clean(d['Identified make']) or clean(d['Suggested make'])
    it['spend_head'] = it['spend_head'] or clean(d['Spends Head']); it['spend_category'] = it['spend_category'] or clean(d['Spends Category'])
    it['capex_opex'] = it['capex_opex'] or clean(d['Capex / Opex']); it['rrs'] = clean(d['RRS Class(overall)']) or it['rrs']

PN = re.compile(r'(?:\bPN|PART\s*(?:NO|NUMBER)|P/N)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9./\-]{2,30})', re.I)
MAKE = re.compile(r'(?:\bMAKE|\bMFR|MANUFACTURER|\bMNFR)\s*[:\-]\s*([A-Z][A-Z0-9&. ]{1,30}?)(?=[,;]|\s{2}|$| PN| PART| MODEL)', re.I)
with open(os.path.join(a.out, 'items.jsonl'), 'w') as f:
    for it in items.values():
        text = f"{it['name']} {it['description']}"
        if not it['mpn']:
            m = PN.search(text); it['mpn'] = m.group(1).rstrip('.,') if m else ''
        if not it['brand']:
            m = MAKE.search(text); it['brand'] = m.group(1).strip().title() if m else ''
        uom = it['uoms'].most_common(1)[0][0] if it['uoms'] else 'EA'
        f.write(json.dumps({**{k: v for k, v in it.items() if k not in ('uoms', 'codes', 'plants')}, 'brand': it['brand'].title() if it['brand'].isupper() else it['brand'],
                            'uom': uom or 'EA', 'codes': sorted(it['codes']), 'plant_count': len(it['plants'])}) + '\n')
print('items', len(items), file=sys.stderr)
