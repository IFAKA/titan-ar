"""Write a tiny vanilla structure .nbt (3x3x3 hollow stone cube) into a datapack in the server world."""
import json, os, sys
import nbtlib
from nbtlib import File, Compound, List, Int, String

world = sys.argv[1]
dv = int(sys.argv[2])  # world_version from the server jar's version.json
pack = os.path.join(world, 'datapacks', 'titanroom')
os.makedirs(os.path.join(pack, 'data', 'room', 'structure'), exist_ok=True)
json.dump({'pack': {'description': 'titan room', 'min_format': 121, 'max_format': 121}}, open(os.path.join(pack, 'pack.mcmeta'), 'w'))
blocks = [Compound({'pos': List[Int]([x, y, z]), 'state': Int(0)})
          for x in range(3) for y in range(3) for z in range(3) if not (x == 1 and y == 1 and z == 1)]
s = File(Compound({
    'DataVersion': Int(dv),
    'size': List[Int]([3, 3, 3]),
    'palette': List[Compound]([Compound({'Name': String('minecraft:stone')})]),
    'blocks': List[Compound](blocks),
    'entities': List[Compound]([]),
}), gzipped=True)
s.save(os.path.join(pack, 'data', 'room', 'structure', 'test.nbt'))
print('wrote', len(blocks), 'blocks')
