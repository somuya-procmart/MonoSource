/** Illustrative demo catalogue. Fictional products, suppliers and prices. Not customer records. */
export interface DemoItem {
  key: string; name: string; brand: string; mpn: string; uom: string; category: string; description: string;
  specs: Record<string, string>; s01: string; s02?: string; art?: Record<string, any>; color: string; serviceability?: string;
}
let n = 0;
const code = () => String(1001000 + ++n * 7);
const it = (key: string, name: string, brand: string, mpn: string, uom: string, category: string, description: string, specs: Record<string, string>, color: string, extra: Partial<DemoItem> = {}): DemoItem =>
  ({ key, name, brand, mpn, uom, category, description, specs, color, s01: code(), ...extra });

export const ITEMS: DemoItem[] = [
  // bearings
  it('b6205s', 'Deep groove ball bearing 6205-2RS', 'SKF', '6205-2RS', 'EA', 'bearings', 'Single-row deep groove ball bearing with contact seals on both sides, 25 mm bore.', { type: 'Deep groove', bore: '25', outer: '52', seal: 'Sealed' }, '#2547d0', { art: { sealed: true }, serviceability: 'arc' }),
  it('b6205f', 'Deep groove ball bearing 6205-2RS (FAG)', 'FAG', '6205-2RS-FAG', 'EA', 'bearings', 'Sealed deep groove ball bearing, 25 mm bore. Dimensionally interchangeable with SKF 6205-2RS.', { type: 'Deep groove', bore: '25', outer: '52', seal: 'Sealed' }, '#0c6e86', { art: { sealed: true }, serviceability: 'on_quote' }),
  it('b6205o', 'Deep groove ball bearing 6205 (open)', 'SKF', '6205', 'EA', 'bearings', 'Open single-row deep groove ball bearing, 25 mm bore. Needs external lubrication and sealing.', { type: 'Deep groove', bore: '25', outer: '52', seal: 'Open' }, '#2547d0', { serviceability: 'arc' }),
  it('b6306s', 'Deep groove ball bearing 6306-2RS', 'SKF', '6306-2RS', 'EA', 'bearings', 'Sealed deep groove ball bearing for medium radial loads, 30 mm bore.', { type: 'Deep groove', bore: '30', outer: '72', seal: 'Sealed' }, '#2547d0', { art: { sealed: true }, serviceability: 'arc' }),
  it('b6308s', 'Deep groove ball bearing 6308-2RS', 'FAG', '6308-2RS', 'EA', 'bearings', 'Sealed deep groove ball bearing, 40 mm bore, for motors and pumps.', { type: 'Deep groove', bore: '40', outer: '90', seal: 'Sealed' }, '#0c6e86', { art: { sealed: true }, serviceability: 'arc' }),
  it('b6004z', 'Deep groove ball bearing 6004-ZZ', 'NSK', '6004ZZ', 'EA', 'bearings', 'Shielded deep groove ball bearing, 20 mm bore.', { type: 'Deep groove', bore: '20', outer: '42', seal: 'Shielded' }, '#6d3fd6', { art: { sealed: true }, serviceability: 'arc' }),
  it('b30208', 'Tapered roller bearing 30208', 'Timken', '30208', 'EA', 'bearings', 'Single-row tapered roller bearing for combined radial and axial loads, 40 mm bore.', { type: 'Tapered roller', bore: '40', outer: '80', seal: 'Open' }, '#a84e08', { serviceability: 'arc' }),
  it('b22216', 'Spherical roller bearing 22216 E', 'SKF', '22216 E', 'EA', 'bearings', 'Self-aligning spherical roller bearing for heavy loads and shaft misalignment, 80 mm bore.', { type: 'Spherical roller', bore: '80', outer: '140', seal: 'Open' }, '#2547d0', { serviceability: 'on_quote' }),
  it('bnu2210', 'Cylindrical roller bearing NU 2210', 'FAG', 'NU2210', 'EA', 'bearings', 'Single-row cylindrical roller bearing, high radial load capacity, 50 mm bore.', { type: 'Cylindrical roller', bore: '50', outer: '90', seal: 'Open' }, '#0c6e86', { serviceability: 'on_quote' }),
  // electrical
  it('mcb32', 'MCB 32 A single pole, C curve', 'Schneider', 'A9F74132', 'EA', 'electrical', 'Miniature circuit breaker, 1P 32 A, C curve, 10 kA breaking capacity.', { type: 'MCB', rating: '32 A', poles: '1P', curve: 'C' }, '#0c6e86', { serviceability: 'arc' }),
  it('mcb32d', 'MCB 32 A double pole, C curve', 'Schneider', 'A9F74232', 'EA', 'electrical', 'Miniature circuit breaker, 2P 32 A, C curve, 10 kA breaking capacity.', { type: 'MCB', rating: '32 A', poles: '2P', curve: 'C' }, '#0c6e86', { serviceability: 'arc' }),
  it('mcb16', 'MCB 16 A single pole, C curve', 'Siemens', '5SL6116-7', 'EA', 'electrical', 'Miniature circuit breaker, 1P 16 A, C curve, 6 kA breaking capacity.', { type: 'MCB', rating: '16 A', poles: '1P', curve: 'C' }, '#067647', { serviceability: 'arc' }),
  it('mcb10', 'MCB 10 A single pole, B curve', 'ABB', 'S201-B10', 'EA', 'electrical', 'Miniature circuit breaker, 1P 10 A, B curve, 6 kA breaking capacity.', { type: 'MCB', rating: '10 A', poles: '1P', curve: 'B' }, '#d94841', { serviceability: 'arc' }),
  it('mcb63', 'MCB 63 A four pole, C curve', 'Havells', 'DHMGCSPF4063', 'EA', 'electrical', 'Miniature circuit breaker, 4P 63 A, C curve.', { type: 'MCB', rating: '63 A', poles: '4P', curve: 'C' }, '#b54708', { serviceability: 'arc' }),
  it('cont25', 'Contactor 25 A, 24 V DC coil', 'Siemens', '3RT2026-1BB40', 'EA', 'electrical', 'Three-pole power contactor, 25 A AC-3, 24 V DC coil.', { type: 'Contactor', rating: '25 A', poles: '3P', coil: '24 V DC' }, '#067647', { serviceability: 'arc' }),
  // ppe
  it('glovn', 'Nitrile coated safety gloves, size L', '3M', 'GL-NIT-L', 'PAIR', 'ppe', 'Nitrile palm-coated knitted gloves for general handling and oily conditions.', { type: 'Gloves', size: 'L', material: 'Nitrile', standard: 'EN 388' }, '#0c6e86', { art: {}, serviceability: 'arc' }),
  it('glovc', 'Cut-resistant gloves, size L', 'Karam', 'HS-CUT5-L', 'PAIR', 'ppe', 'Level 5 cut-resistant gloves for sheet metal and glass handling.', { type: 'Gloves', size: 'L', material: 'HPPE', standard: 'EN 388 Level 5' }, '#475467', { serviceability: 'arc' }),
  it('helmy', 'Safety helmet, yellow', 'Karam', 'PN-501-Y', 'EA', 'ppe', 'HDPE industrial safety helmet with ratchet suspension and chin-strap slots.', { type: 'Helmet', colour: 'Yellow', material: 'HDPE', standard: 'IS 2925' }, '#f59e0b', { art: { kind: 'helmet' }, serviceability: 'arc' }),
  it('helmw', 'Safety helmet, white', 'Karam', 'PN-501-W', 'EA', 'ppe', 'HDPE industrial safety helmet for supervisors, ratchet suspension.', { type: 'Helmet', colour: 'White', material: 'HDPE', standard: 'IS 2925' }, '#e4e7ec', { art: { kind: 'helmet' }, serviceability: 'arc' }),
  it('jacket', 'Hi-vis safety jacket, size XL', 'Honeywell', 'HV-JKT-XL', 'EA', 'ppe', 'Fluorescent hi-visibility jacket with reflective tape.', { type: 'Jacket', size: 'XL', colour: 'Fluorescent yellow', standard: 'EN ISO 20471' }, '#a3e635', { serviceability: 'arc' }),
  // fasteners
  it('bolt316', 'Hex bolt SS316 M12 × 60', 'Boltcraft', 'HB-316-1260', 'EA', 'fasteners', 'Fully threaded hex bolt in A4 stainless steel for corrosive environments.', { type: 'Hex bolt', material: 'SS316', size: 'M12 × 60', grade: 'A4-70' }, '#8a94a6', { serviceability: 'arc' }),
  it('bolt304', 'Hex bolt SS304 M16 × 80', 'Boltcraft', 'HB-304-1680', 'EA', 'fasteners', 'Hex bolt in A2 stainless steel for general outdoor use.', { type: 'Hex bolt', material: 'SS304', size: 'M16 × 80', grade: 'A2-70' }, '#8a94a6', { serviceability: 'arc' }),
  it('bolt88', 'High-tensile bolt 8.8 M20 × 100', 'Boltcraft', 'HT-88-20100', 'EA', 'fasteners', 'Zinc-plated high-tensile hex bolt for structural fastening.', { type: 'Hex bolt', material: 'Carbon steel', size: 'M20 × 100', grade: '8.8' }, '#b45309', { serviceability: 'arc' }),
  it('nut316', 'Hex nut SS316 M12', 'Boltcraft', 'HN-316-12', 'EA', 'fasteners', 'Hex nut in A4 stainless steel, M12.', { type: 'Hex nut', material: 'SS316', size: 'M12', grade: 'A4-70' }, '#8a94a6', { serviceability: 'arc' }),
  it('anchor', 'Anchor bolt M16 × 150', 'Boltcraft', 'AB-16150', 'EA', 'fasteners', 'Wedge anchor bolt for concrete foundations.', { type: 'Anchor bolt', material: 'Carbon steel', size: 'M16 × 150', grade: '5.8' }, '#475467', { serviceability: 'arc' }),
  // valves
  it('vball', 'Ball valve SS316, 2 inch, 1000 WOG', 'Flowtech', 'BV-316-2', 'EA', 'valves', 'Two-piece full-bore ball valve in stainless steel with threaded ends.', { type: 'Ball valve', size: '2"', rating: '1000 WOG', material: 'SS316' }, '#0c6e86', { serviceability: 'arc' }),
  it('vgate', 'Gate valve CS, 4 inch, Class 150', 'Flowtech', 'GV-CS-4-150', 'EA', 'valves', 'Flanged gate valve in carbon steel, OS&Y bonnet.', { type: 'Gate valve', size: '4"', rating: 'Class 150', material: 'Carbon steel' }, '#0c6e86', { serviceability: 'arc' }),
  it('vglobe', 'Globe valve CS, 3 inch, Class 300', 'Flowtech', 'GL-CS-3-300', 'EA', 'valves', 'Flanged globe valve in carbon steel for throttling service.', { type: 'Globe valve', size: '3"', rating: 'Class 300', material: 'Carbon steel' }, '#0c6e86', { serviceability: 'arc' }),
  it('vbfly', 'Butterfly valve DI, 6 inch, PN16', 'Audco', 'BF-DI-6-16', 'EA', 'valves', 'Wafer-type butterfly valve in ductile iron with EPDM seat.', { type: 'Butterfly valve', size: '6"', rating: 'PN16', material: 'Ductile iron' }, '#6d3fd6', { serviceability: 'on_quote' }),
  it('vcheck', 'Swing check valve SS, 2 inch', 'Audco', 'CV-SS-2', 'EA', 'valves', 'Flanged swing check valve in stainless steel.', { type: 'Check valve', size: '2"', rating: 'Class 150', material: 'SS316' }, '#6d3fd6', { serviceability: 'on_quote' }),
  // hoses
  it('h12', 'Hydraulic hose 1/2 inch, 2SN', 'HydroMax', 'HH-2SN-08', 'M', 'hoses', 'Two-wire braid hydraulic hose, 1/2 inch bore, 275 bar working pressure.', { type: 'Hydraulic hose', bore: '1/2"', pressure: '275 bar', construction: '2SN' }, '#d94841', { serviceability: 'arc' }),
  it('h34', 'Hydraulic hose 3/4 inch, 4SP', 'HydroMax', 'HH-4SP-12', 'M', 'hoses', 'Four-spiral hydraulic hose, 3/4 inch bore, 350 bar working pressure.', { type: 'Hydraulic hose', bore: '3/4"', pressure: '350 bar', construction: '4SP' }, '#d94841', { serviceability: 'arc' }),
  it('hsteam', 'Steam hose 1 inch, 10 bar', 'HydroMax', 'SH-10-16', 'M', 'hoses', 'EPDM steam hose, 1 inch bore, 10 bar, 180 °C.', { type: 'Steam hose', bore: '1"', pressure: '10 bar', construction: 'EPDM' }, '#b54708', { serviceability: 'arc' }),
  it('hair', 'Air hose 3/4 inch, PVC reinforced', 'HydroMax', 'AH-PVC-12', 'M', 'hoses', 'Textile-reinforced PVC air hose, 3/4 inch, 20 bar.', { type: 'Air hose', bore: '3/4"', pressure: '20 bar', construction: 'PVC' }, '#0c6e86', { serviceability: 'arc' }),
  // lubricants
  it('gear220', 'Gear oil ISO VG 220, 20 L pail', 'Servo', 'GEAR-220-20', 'EA', 'lubricants', 'Industrial EP gear oil, ISO VG 220, 20 litre pail.', { type: 'Gear oil', grade: 'ISO VG 220', pack: '20 L' }, '#b54708', { s02: '', serviceability: 'arc' }),
  it('hyd46', 'Hydraulic oil ISO VG 46, 210 L drum', 'Servo', 'HYD-46-210', 'EA', 'lubricants', 'Anti-wear hydraulic oil, ISO VG 46, 210 litre drum.', { type: 'Hydraulic oil', grade: 'ISO VG 46', pack: '210 L' }, '#2547d0', { s02: '', serviceability: 'arc' }),
  it('grease', 'Multipurpose grease EP2, 18 kg', 'Servo', 'GRS-EP2-18', 'KG', 'lubricants', 'Lithium complex EP2 grease, 18 kg bucket.', { type: 'Grease', grade: 'NLGI 2', pack: '18 kg' }, '#a84e08', { s02: '', serviceability: 'arc' }),
  // cables (no contract: on quote)
  it('cab4c', 'Power cable 4C × 25 sq mm, Al armoured', 'Polycab', 'PC-4C25-AL', 'M', 'cables', '1.1 kV XLPE insulated, steel-wire armoured aluminium power cable.', { type: 'Power cable', cores: '4C', area: '25 sq mm', insulation: 'XLPE' }, '#067647', { serviceability: 'on_quote' }),
  it('cab12c', 'Control cable 12C × 1.5 sq mm', 'Polycab', 'CC-12C15', 'M', 'cables', 'PVC insulated copper control cable, 12 core, 1.5 sq mm.', { type: 'Control cable', cores: '12C', area: '1.5 sq mm', insulation: 'PVC' }, '#067647', { serviceability: 'on_quote' }),
  it('cab3c', 'Flexible cable 3C × 2.5 sq mm', 'Havells', 'FC-3C25', 'M', 'cables', 'Flexible copper cable for portable equipment, 3 core.', { type: 'Flexible cable', cores: '3C', area: '2.5 sq mm', insulation: 'PVC' }, '#067647', { serviceability: 'on_quote' }),
  it('cab2c', 'Earthing cable 1C × 16 sq mm', 'Havells', 'EC-1C16', 'M', 'cables', 'Single-core green/yellow earthing cable, 16 sq mm.', { type: 'Earthing cable', cores: '1C', area: '16 sq mm', insulation: 'PVC' }, '#a3e635', { serviceability: 'on_quote' }),
];
ITEMS.filter((i) => ['ppe', 'lubricants'].includes(i.category)).forEach((i, k) => { i.s02 = `2${String(5000 + k * 11)}`; });
export const byKey = Object.fromEntries(ITEMS.map((i) => [i.key, i]));

export const SUPPLIERS = [
  { key: 'shree', name: 'Shree Bearings Pvt Ltd', s01: 'V10101', s02: 'V20101', email: 'orders@shree-bearings.example', phone: '+91 90000 10101' },
  { key: 'apex', name: 'Apex Industrial Supplies', s01: 'V10102', s02: 'V20102', email: 'sales@apex-industrial.example', phone: '+91 90000 10102' },
  { key: 'voltline', name: 'Voltline Electricals', s01: 'V10103', s02: 'V20103', email: 'tenders@voltline.example', phone: '+91 90000 10103' },
  { key: 'safeguard', name: 'Safeguard PPE Co', s01: 'V10104', s02: 'V20104', email: 'orders@safeguard-ppe.example', phone: '+91 90000 10104' },
  { key: 'boltcraft', name: 'Boltcraft Fasteners', s01: 'V10105', s02: 'V20105', email: 'sales@boltcraft.example', phone: '+91 90000 10105' },
  { key: 'flowtech', name: 'Flowtech Valves & Fittings', s01: 'V10106', s02: 'V20106', email: 'orders@flowtech.example', phone: '+91 90000 10106' },
  { key: 'hydromax', name: 'HydroMax Hoses', s01: 'V10107', s02: 'V20107', email: 'orders@hydromax.example', phone: '+91 90000 10107' },
  { key: 'kinetic', name: 'Kinetic Bearings & Drives', s01: 'V10108', s02: 'V20108', email: 'rfq@kinetic-bearings.example', phone: '+91 90000 10108' },
  { key: 'procmart', name: 'ProcMart Direct Supply', s01: 'V10199', s02: 'V20199', email: 'supply@procmart.example', phone: '+91 90000 10199', isProcmart: true },
];

/** price = base × (1 − discount) */
export interface ArcDef { key: string; type: 'ARC' | 'QRC' | 'PROCMART_DIRECT'; number: string; supplier: string; from: string; to: string; scopes: string[]; erp: 'S01' | 'S02'; lines: { item: string; base: number; disc: number; moq: number; cap: number }[] }
export const ARCS: ArcDef[] = [
  { key: 'brg1', type: 'ARC', number: 'ARC-26-BRG-001', supplier: 'shree', from: '2026-04-01', to: '2027-03-31', scopes: ['Power'], erp: 'S01', lines: [
    { item: 'b6205s', base: 540, disc: 12, moq: 10, cap: 600 }, { item: 'b6306s', base: 780, disc: 12, moq: 10, cap: 400 }, { item: 'b6308s', base: 1120, disc: 10, moq: 5, cap: 300 }, { item: 'b6004z', base: 310, disc: 10, moq: 10, cap: 500 }, { item: 'b30208', base: 1380, disc: 10, moq: 5, cap: 200 }, { item: 'b22216', base: 9800, disc: 8, moq: 2, cap: 40 }] },
  { key: 'brg2', type: 'ARC', number: 'ARC-26-BRG-002', supplier: 'apex', from: '2026-06-01', to: '2027-05-31', scopes: ['Power', 'Ports'], erp: 'S01', lines: [
    { item: 'b6205s', base: 560, disc: 15, moq: 5, cap: 800 }, { item: 'b6205o', base: 420, disc: 12, moq: 10, cap: 400 }, { item: 'b6306s', base: 760, disc: 8, moq: 5, cap: 500 }, { item: 'bnu2210', base: 2450, disc: 10, moq: 4, cap: 100 }] },
  { key: 'ele1', type: 'ARC', number: 'ARC-26-ELE-001', supplier: 'voltline', from: '2026-01-01', to: '2026-12-20', scopes: ['Group'], erp: 'S01', lines: [
    { item: 'mcb32', base: 410, disc: 14, moq: 5, cap: 800 }, { item: 'mcb32d', base: 880, disc: 14, moq: 5, cap: 400 }, { item: 'mcb16', base: 360, disc: 12, moq: 5, cap: 800 }, { item: 'mcb10', base: 340, disc: 12, moq: 5, cap: 800 }, { item: 'mcb63', base: 2150, disc: 10, moq: 2, cap: 150 }, { item: 'cont25', base: 3150, disc: 12, moq: 2, cap: 120 }] },
  { key: 'ppe1', type: 'QRC', number: 'QRC-26Q4-PPE-001', supplier: 'safeguard', from: '2026-10-01', to: '2026-12-31', scopes: ['Group'], erp: 'S01', lines: [
    { item: 'glovn', base: 62, disc: 10, moq: 20, cap: 3000 }, { item: 'glovc', base: 145, disc: 10, moq: 20, cap: 1500 }, { item: 'helmy', base: 235, disc: 8, moq: 10, cap: 600 }, { item: 'helmw', base: 245, disc: 8, moq: 10, cap: 300 }, { item: 'jacket', base: 330, disc: 8, moq: 10, cap: 500 }] },
  { key: 'fas1', type: 'ARC', number: 'ARC-26-FAS-001', supplier: 'boltcraft', from: '2026-04-01', to: '2027-03-31', scopes: ['Power'], erp: 'S01', lines: [
    { item: 'bolt316', base: 38, disc: 10, moq: 100, cap: 20000 }, { item: 'bolt304', base: 52, disc: 10, moq: 100, cap: 12000 }, { item: 'bolt88', base: 44, disc: 8, moq: 100, cap: 15000 }, { item: 'nut316', base: 14, disc: 10, moq: 200, cap: 30000 }, { item: 'anchor', base: 96, disc: 8, moq: 50, cap: 5000 }] },
  { key: 'val1', type: 'ARC', number: 'ARC-26-VAL-001', supplier: 'flowtech', from: '2026-05-01', to: '2027-04-30', scopes: ['Group'], erp: 'S01', lines: [
    { item: 'vball', base: 6900, disc: 10, moq: 2, cap: 60 }, { item: 'vgate', base: 14800, disc: 10, moq: 1, cap: 30 }, { item: 'vglobe', base: 17900, disc: 8, moq: 1, cap: 24 }] },
  { key: 'val0', type: 'ARC', number: 'ARC-25-VAL-009', supplier: 'flowtech', from: '2026-06-01', to: '2027-01-31', scopes: ['Group'], erp: 'S01', lines: [{ item: 'vbfly', base: 19800, disc: 8, moq: 1, cap: 20 }] },
  { key: 'hyd1', type: 'ARC', number: 'ARC-26-HYD-001', supplier: 'hydromax', from: '2026-03-01', to: '2027-02-28', scopes: ['Group'], erp: 'S01', lines: [
    { item: 'h12', base: 410, disc: 10, moq: 10, cap: 600 }, { item: 'h34', base: 690, disc: 10, moq: 10, cap: 120 }, { item: 'hsteam', base: 520, disc: 10, moq: 10, cap: 300 }, { item: 'hair', base: 210, disc: 10, moq: 20, cap: 500 }] },
  { key: 'lub1', type: 'PROCMART_DIRECT', number: 'PD-26-LUB-001', supplier: 'procmart', from: '2026-07-01', to: '2027-06-30', scopes: ['Resources'], erp: 'S02', lines: [
    { item: 'gear220', base: 8900, disc: 6, moq: 2, cap: 200 }, { item: 'hyd46', base: 71500, disc: 5, moq: 1, cap: 20 }, { item: 'grease', base: 365, disc: 6, moq: 18, cap: 800 }] },
];

export const ORG_CSV = [
  'BU,Server,Company code,Company name,Plant code,Plant name,Location',
  'Power,S01,1100,Meridian Power Generation Ltd,CPP1,Coastal Power Plant,Main store',
  'Power,S01,1100,Meridian Power Generation Ltd,NPP2,Northgate Power Plant,Central warehouse',
  'Ports,S01,2100,Meridian Ports & Logistics Ltd,HT01,Harbour Terminal,Terminal store',
  'Ports,S01,2100,Meridian Ports & Logistics Ltd,ICD3,Inland Container Depot,Depot store',
  'Resources,S02,3100,Meridian Resources Ltd,RCW1,Ridge Cement Works,Plant store',
  'Resources,S02,3100,Meridian Resources Ltd,MQ04,Hillside Quarry,Quarry store',
].join('\n');

/** How people actually describe items: old SAP text, supplier product codes, common names, applications. */
export const ALIASES: Record<string, [string, string, string?][]> = {
  b6205s: [['sap_description', 'BRG BALL 6205 2RS SKF'], ['sap_description', 'BEARING DEEP GROOVE 25X52X15 SEALED'], ['common_name', 'ball bearing'], ['common_name', 'motor bearing'], ['application', 'conveyor motor'], ['application', 'centrifugal pump'], ['supplier_code', 'SHR-6205-2RS', 'shree'], ['supplier_code', 'APX-BRG-6205', 'apex']],
  b6205o: [['sap_description', 'BRG BALL 6205 OPEN SKF'], ['common_name', 'ball bearing open']],
  b6306s: [['sap_description', 'BRG BALL 6306 2RS SKF'], ['application', 'conveyor motor'], ['common_name', 'ball bearing']],
  mcb32: [['sap_description', 'MCB 1P 32A C CRV SCHN'], ['common_name', 'circuit breaker'], ['common_name', 'breaker 32 amp'], ['application', 'distribution board']],
  mcb16: [['sap_description', 'MCB 1P 16A C CRV SIEM'], ['common_name', 'circuit breaker']],
  bolt316: [['sap_description', 'BOLT HEX SS316 M12X60 FULL THD'], ['common_name', 'stainless bolt'], ['common_name', 'hex bolt'], ['application', 'chemical plant fastening']],
  bolt304: [['sap_description', 'BOLT HEX SS304 M16X80'], ['common_name', 'stainless bolt']],
  vball: [['sap_description', 'VALVE BALL SS316 2IN 1000WOG'], ['common_name', 'ball valve']],
  vbfly: [['sap_description', 'VALVE BUTTERFLY DI 6IN PN16 WAFER'], ['common_name', 'butterfly valve'], ['application', 'cooling water line']],
  h34: [['sap_description', 'HOSE HYD 3/4 4SP 350BAR'], ['common_name', 'hydraulic pipe'], ['application', 'excavator']],
  glovn: [['sap_description', 'GLOVE NITRILE COATED L'], ['common_name', 'hand gloves'], ['application', 'oily parts handling']],
  helmy: [['sap_description', 'HELMET SAFETY YELLOW HDPE'], ['common_name', 'hard hat']],
  gear220: [['sap_description', 'OIL GEAR EP ISO220 20L'], ['common_name', 'gearbox oil']],
  cab4c: [['sap_description', 'CABLE PWR 4CX25 AL ARM XLPE'], ['common_name', 'armoured cable']],
};
export const ALTERNATIVES: [string, string, string][] = [['b6205s', 'b6205f', 'Dimensionally interchangeable (ISO 15: 6205-2RS). Approved by plant engineering (illustrative).']];

/** Illustrative PO history: a stand-in for a SAP PO feed. Used to find off-contract buying where a group ARC existed. */
export const PO_HISTORY: { po: string; date: string; plant: string; server: 'S01' | 'S02'; item: string; vendorCode: string; vendor: string; qty: number; price: number }[] = [
  { po: '4500100101', date: '2026-05-12', plant: 'CPP1', server: 'S01', item: 'b6205s', vendorCode: 'V10101', vendor: 'Shree Bearings Pvt Ltd', qty: 30, price: 475.2 },
  { po: '4500100102', date: '2026-06-03', plant: 'CPP1', server: 'S01', item: 'b6205s', vendorCode: 'V10101', vendor: 'Shree Bearings Pvt Ltd', qty: 24, price: 475.2 },
  { po: '4500100177', date: '2026-07-14', plant: 'NPP2', server: 'S01', item: 'b6205s', vendorCode: 'VX9001', vendor: 'Metro Traders', qty: 40, price: 560 },
  { po: '4500100178', date: '2026-09-02', plant: 'NPP2', server: 'S01', item: 'b6205s', vendorCode: 'VX9001', vendor: 'Metro Traders', qty: 36, price: 565 },
  { po: '4500100231', date: '2026-06-21', plant: 'CPP1', server: 'S01', item: 'mcb32', vendorCode: 'V10103', vendor: 'Voltline Electricals', qty: 25, price: 440 },
  { po: '4500100232', date: '2026-08-11', plant: 'CPP1', server: 'S01', item: 'mcb32', vendorCode: 'V10103', vendor: 'Voltline Electricals', qty: 20, price: 352.6 },
  { po: '4500100311', date: '2026-07-02', plant: 'HT01', server: 'S01', item: 'bolt316', vendorCode: 'VX9002', vendor: 'Local Hardware Co', qty: 1200, price: 49 },
  { po: '4500100312', date: '2026-09-18', plant: 'HT01', server: 'S01', item: 'bolt316', vendorCode: 'VX9002', vendor: 'Local Hardware Co', qty: 900, price: 50 },
  { po: '4500100344', date: '2026-08-05', plant: 'ICD3', server: 'S01', item: 'bolt304', vendorCode: 'VX9002', vendor: 'Local Hardware Co', qty: 800, price: 62 },
  { po: '4500100361', date: '2026-08-27', plant: 'HT01', server: 'S01', item: 'b30208', vendorCode: 'VX9001', vendor: 'Metro Traders', qty: 12, price: 1650 },
  { po: '4500100402', date: '2026-10-09', plant: 'HT01', server: 'S01', item: 'cab4c', vendorCode: 'VX9004', vendor: 'CableMart Distributors', qty: 500, price: 430 },
  { po: '4500100455', date: '2026-10-20', plant: 'RCW1', server: 'S02', item: 'helmy', vendorCode: 'VX9003', vendor: 'Safety Mart', qty: 150, price: 260 },
  { po: '4500100456', date: '2026-10-28', plant: 'RCW1', server: 'S02', item: 'helmy', vendorCode: 'V20104', vendor: 'Safeguard PPE Co', qty: 120, price: 216.2 },
  { po: '4500100501', date: '2026-09-10', plant: 'NPP2', server: 'S01', item: 'h34', vendorCode: 'V10107', vendor: 'HydroMax Hoses', qty: 60, price: 621 },
  { po: '4500100502', date: '2026-10-05', plant: 'CPP1', server: 'S01', item: 'vball', vendorCode: 'V10106', vendor: 'Flowtech Valves & Fittings', qty: 6, price: 6210 },
  { po: '4500100503', date: '2026-10-12', plant: 'ICD3', server: 'S01', item: 'vbfly', vendorCode: 'VX9005', vendor: 'Valve World', qty: 3, price: 23500 },
];
