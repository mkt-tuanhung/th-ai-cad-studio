# Independent check of an exported IFC with IfcOpenShell (pip install ifcopenshell): schema validation,
# geometry of every product, volumes of a few elements. Usage: python3 tools/check_ifc.py file.ifc
import sys, ifcopenshell, ifcopenshell.validate, ifcopenshell.geom, ifcopenshell.util.shape as us, logging
f = ifcopenshell.open(sys.argv[1])
print('schema', f.schema, 'entities', len(list(f)))
log = ifcopenshell.validate.json_logger()
ifcopenshell.validate.validate(f, log, express_rules=False)
print('validation issues', len(log.statements))
for s in log.statements[:10]: print('  ', s.get('message') if isinstance(s, dict) else s)
st = ifcopenshell.geom.settings()
ok = bad = 0
vols = {}
for p in f.by_type('IfcProduct'):
    if not p.Representation or p.is_a('IfcOpeningElement'): continue
    try:
        sh = ifcopenshell.geom.create_shape(st, p)
        ok += 1
        vols[p.Name] = us.get_volume(sh.geometry)  # ifcopenshell works in metres
    except Exception as e:
        bad += 1; print('  geometry failed', p.is_a(), p.Name, e)
print('geometry ok', ok, 'failed', bad)
for k in ['Generic - 200mm Concrete:W1', 'Generic - 150mm Partition:W3', 'Stair:ST1', 'Floor:S1', 'Roof:RF1']:
    print(' ', k, round(vols.get(k, -1), 4), 'm3')
print('storeys', [(s.Name, s.Elevation, len(s.ContainsElements[0].RelatedElements) if s.ContainsElements else 0) for s in f.by_type('IfcBuildingStorey')])
print('W1 openings', [r.RelatedOpeningElement.Name for r in f.by_type('IfcWall')[0].HasOpenings] if f.by_type('IfcWall') else None)
sp = [s for s in f.by_type('IfcSpace') if s.Name == '107'][0]; print('space', sp.Name, sp.LongName)
