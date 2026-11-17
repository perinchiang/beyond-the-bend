"""
Beyond the Bend — miniature rally hatchback, generated procedurally.

    blender -b --python tools/blender/build_car.py -- public/models/car.glb

An original 1980s-flavoured rally hot hatch. The body is a loft through hand-tuned
cross-sections (so the silhouette is designed, not sculpted from primitives), with
boolean-cut wheel wells, box arch flares, inset glazing and separate wheels.

Conventions (Blender): +X forward, +Y left, +Z up, metres, ground at Z = 0.
Exported glTF: +X forward, +Y up. Wheels are separate nodes with origins on the axle.
Colours are placeholders; the game re-colours by material name.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "car.glb"

# ----------------------------------------------------------------------------- dimensions
AXLE_F, AXLE_R = 1.21, -1.21        # wheelbase 2.42
WHEEL_Y = 0.75                      # half track
WHEEL_R, WHEEL_W = 0.335, 0.25
WELL_R = 0.39
SIDE = 0.80                         # body half width
STRIPE = 0.20                       # half width of the centre stripe

MAT_NAMES = [
    "paint", "stripe", "stripe_dark", "trim", "underbody", "glass", "light_head", "light_tail",
    "light_amber", "lamp_pod", "tire", "rim", "metal", "flap", "plate",
]
PREVIEW = {
    "paint": (0.78, 0.12, 0.05), "stripe": (0.9, 0.84, 0.7), "stripe_dark": (0.02, 0.08, 0.11),
    "trim": (0.02, 0.02, 0.03), "underbody": (0.015, 0.015, 0.02), "glass": (0.03, 0.05, 0.08),
    "light_head": (1.0, 0.93, 0.7), "light_tail": (0.7, 0.03, 0.03), "light_amber": (0.9, 0.4, 0.05),
    "lamp_pod": (0.95, 0.93, 0.85), "tire": (0.02, 0.02, 0.025), "rim": (0.88, 0.84, 0.75),
    "metal": (0.3, 0.3, 0.33), "flap": (0.6, 0.05, 0.03), "plate": (0.9, 0.86, 0.75),
}
M = {n: i for i, n in enumerate(MAT_NAMES)}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_materials():
    mats = []
    for name in MAT_NAMES:
        mat = bpy.data.materials.new(name)
        col = (*PREVIEW[name], 1.0)
        mat.diffuse_color = col
        try:
            mat.use_nodes = True
        except Exception:
            pass
        if mat.node_tree:
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                bsdf.inputs["Base Color"].default_value = col
                bsdf.inputs["Roughness"].default_value = 0.7
        mats.append(mat)
    return mats


# ----------------------------------------------------------------------------- body loft
def hood_like(x, zb, ws, ztop, drop=0.04, x_top=None):
    """Section with no greenhouse: bonnet, nose, tail. Returns 10 half-profile points."""
    xt = x if x_top is None else x_top
    zs = ztop - drop
    zmid = max(zb + 0.16, min(0.56, zs - 0.10))
    return [
        (x, 0.0, zb), (x, ws - 0.10, zb), (x, ws, zb + 0.09), (x, ws + 0.012, zmid),
        (x, ws, zs - 0.05), (x, ws - 0.012, zs),
        (xt, ws - 0.05, ztop - 0.012), (xt, ws - 0.11, ztop), (xt, STRIPE, ztop + 0.010), (xt, 0.0, ztop + 0.014),
    ]


def cabin(x, zb, ws, zbelt, ztop, wtop, crown=0.022):
    """Section through the greenhouse: tumblehome side glass and a crowned roof."""
    return [
        (x, 0.0, zb), (x, ws - 0.10, zb), (x, ws, zb + 0.09), (x, ws + 0.012, 0.56),
        (x, ws, zbelt - 0.05), (x, ws - 0.012, zbelt),
        (x, wtop, ztop - 0.05), (x, wtop - 0.07, ztop), (x, STRIPE, ztop + crown * 0.8), (x, 0.0, ztop + crown),
    ]


# Stations front -> rear. Names are referenced when assigning glass and livery.
STATIONS = [
    ("nose",   hood_like(1.86, 0.30, 0.70, 0.70, drop=0.03)),
    ("lip",    hood_like(1.80, 0.25, 0.775, 0.785)),
    ("hood1",  hood_like(1.62, 0.22, 0.80, 0.82)),
    ("hood2",  hood_like(1.21, 0.22, 0.80, 0.878)),
    ("hood3",  hood_like(0.96, 0.22, 0.80, 0.925)),
    ("cowl",   hood_like(0.74, 0.22, 0.80, 0.955, drop=0.036)),
    ("a",      cabin(0.22, 0.22, 0.80, 0.935, 1.385, 0.66)),
    ("b1",     cabin(-0.36, 0.22, 0.80, 0.945, 1.405, 0.68)),
    ("b2",     cabin(-0.44, 0.22, 0.80, 0.946, 1.405, 0.68)),
    ("q",      cabin(-1.04, 0.22, 0.80, 0.955, 1.398, 0.67)),
    ("r",      cabin(-1.42, 0.23, 0.80, 0.955, 1.376, 0.65)),
    ("hatch",  hood_like(-1.80, 0.25, 0.795, 0.968, drop=0.022, x_top=-1.785)),
    ("tail",   hood_like(-1.86, 0.31, 0.745, 0.93, drop=0.03)),
]
HALF = 10
RING = HALF * 2 - 2  # 18 unique vertices per station


def build_shell(bm):
    """Loft the stations into a closed, manifold shell. Returns {(station, strip, side): face}."""
    rings = []
    for _, pts in STATIONS:
        ring = [bm.verts.new(p) for p in pts]
        ring += [bm.verts.new((p[0], -p[1], p[2])) for p in reversed(pts[1:-1])]
        rings.append(ring)
    faces = {}
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(RING):
            k2 = (k + 1) % RING
            f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            strip, side = (k, +1) if k < HALF - 1 else (RING - 1 - k, -1)
            faces[(STATIONS[i][0], strip, side)] = f
    front = bm.faces.new(rings[0])
    back = bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return faces, front, back


def paint_shell(bm, faces, front, back):
    for f in bm.faces:
        f.material_index = M["paint"]
    for (st, strip, side), f in faces.items():
        if strip == 0:
            f.material_index = M["underbody"]
        elif strip == 1:
            f.material_index = M["trim"]            # sill
        elif strip == 2:
            f.material_index = M["stripe_dark"]     # lower body band
        elif strip == 8 and st not in ("nose", "cowl", "r", "hatch"):
            f.material_index = M["stripe"]          # bonnet + roof stripe
    front.material_index = M["paint"]
    back.material_index = M["paint"]

    def glaze(keys, thickness, depth=0.012):
        region = [faces[k] for k in keys]
        res = bmesh.ops.inset_region(bm, faces=region, thickness=thickness, depth=-depth,
                                     use_even_offset=True, use_boundary=True)
        for f in region:
            f.material_index = M["glass"]
        return res["faces"]

    for side in (+1, -1):
        # door glass: the triangle behind the A-pillar plus the pane up to the B-pillar
        glaze([("cowl", 5, side), ("a", 5, side)], 0.032)
        # rear quarter glass
        glaze([("b2", 5, side)], 0.034)
        # B-pillar in black, like a blacked-out door frame
        faces[("b1", 5, side)].material_index = M["trim"]
    # windscreen and hatch glass span both sides of the centre line
    glaze([("cowl", 7, +1), ("cowl", 8, +1), ("cowl", 7, -1), ("cowl", 8, -1)], 0.04)
    glaze([("r", 7, +1), ("r", 8, +1), ("r", 7, -1), ("r", 8, -1)], 0.05)


def cut_wheel_wells(shell_obj, mats):
    """Boolean out four wheel wells; cut faces take the dark underbody material."""
    bm = bmesh.new()
    for ax in (AXLE_F, AXLE_R):
        for sy in (+1, -1):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=WELL_R, radius2=WELL_R, depth=0.62)
            rot = Matrix.Rotation(math.radians(90), 4, "X")
            bmesh.ops.transform(bm, matrix=Matrix.Translation((ax, sy * 0.72, WHEEL_R)) @ rot, verts=res["verts"])
    for f in bm.faces:
        f.material_index = M["underbody"]
    me = bpy.data.meshes.new("cutter")
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    cutter = bpy.data.objects.new("cutter", me)
    bpy.context.scene.collection.objects.link(cutter)
    mod = shell_obj.modifiers.new("wells", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "EXACT"
    dg = bpy.context.evaluated_depsgraph_get()
    result = bpy.data.meshes.new_from_object(shell_obj.evaluated_get(dg))
    bpy.data.objects.remove(cutter)
    return result


# ----------------------------------------------------------------------------- part helpers
def box(bm, centre, size, mat, bevel=0.0, rot=None):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    bmesh.ops.scale(bm, vec=size, verts=verts)
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        out = bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect="EDGES", profile=0.5)
        verts = out["verts"]
    faces = list({f for v in verts for f in v.link_faces})
    mtx = Matrix.Translation(centre) @ (rot if rot is not None else Matrix.Identity(4))
    bmesh.ops.transform(bm, matrix=mtx, verts=list({v for f in faces for v in f.verts}))
    for f in faces:
        f.material_index = M[mat]
    return faces


def disc(bm, centre, radius, axis, mat, depth=0.02, segments=16, mat_face=None):
    """Short cylinder whose axis is 'X' or 'Y'; mat_face colours the +axis cap."""
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    rot = Matrix.Rotation(math.radians(90), 4, "Y" if axis == "X" else "X")
    if axis == "Y":
        rot = Matrix.Rotation(math.radians(-90), 4, "X")
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ rot, verts=res["verts"])
    faces = list({f for v in res["verts"] for f in v.link_faces})
    for f in faces:
        f.material_index = M[mat]
    if mat_face:
        for f in faces:
            if len(f.verts) > 4:  # the two end caps
                f.material_index = M[mat_face]
    return faces


def arch_flare(bm, ax, sy):
    """Boxy wheel-arch flare: a chamfered band swept over the top of the wheel."""
    r_in, r_out = WELL_R - 0.004, WELL_R + 0.088
    y_in, y_out = SIDE - 0.03, SIDE + 0.085
    a0, a1, steps = math.radians(-16), math.radians(196), 16
    prof = [(r_in, y_in), (r_in, y_out), (r_out - 0.035, y_out), (r_out, y_out - 0.05), (r_out + 0.004, y_in)]
    rings = []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        rings.append([bm.verts.new((ax + math.cos(a) * r, sy * y, WHEEL_R + math.sin(a) * r)) for r, y in prof])
    faces = []
    n = len(prof)
    for i in range(steps):
        for k in range(n):
            k2 = (k + 1) % n
            faces.append(bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k])))
    faces.append(bm.faces.new(rings[0]))
    faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = M["paint"]
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def add_details(bm):
    # ---- front: bumper, grille, headlamps, indicators
    box(bm, (1.845, 0, 0.385), (0.13, 1.50, 0.17), "trim", bevel=0.03)
    box(bm, (1.80, 0, 0.27), (0.16, 1.30, 0.06), "trim", bevel=0.015)            # chin splitter
    box(bm, (1.868, 0, 0.585), (0.02, 0.60, 0.17), "trim")                        # grille
    for sy in (+1, -1):
        box(bm, (1.872, sy * 0.455, 0.585), (0.03, 0.27, 0.17), "light_head", bevel=0.012)
        box(bm, (1.866, sy * 0.635, 0.585), (0.03, 0.07, 0.15), "light_amber")
        # tow hook / fog lamp accents in the bumper
        box(bm, (1.905, sy * 0.47, 0.385), (0.02, 0.2, 0.07), "light_head", bevel=0.008)

    # ---- rally lamp pod on the bonnet edge: four round lamps
    box(bm, (1.70, 0, 0.845), (0.10, 0.98, 0.035), "trim", bevel=0.01)
    for y in (-0.36, -0.125, 0.125, 0.36):
        disc(bm, (1.735, y, 0.93), 0.105, "X", "trim", depth=0.11, segments=14)
        disc(bm, (1.796, y, 0.93), 0.086, "X", "lamp_pod", depth=0.02, segments=14)

    # ---- rear: bumper, lamps, plate, exhaust
    box(bm, (-1.85, 0, 0.40), (0.13, 1.52, 0.17), "trim", bevel=0.03)
    box(bm, (-1.868, 0, 0.74), (0.02, 1.36, 0.26), "trim")                        # black tail panel
    for sy in (+1, -1):
        box(bm, (-1.878, sy * 0.52, 0.76), (0.03, 0.30, 0.19), "light_tail", bevel=0.012)
        box(bm, (-1.878, sy * 0.33, 0.76), (0.03, 0.07, 0.19), "light_amber")
    box(bm, (-1.88, 0, 0.74), (0.02, 0.44, 0.13), "plate")
    disc(bm, (-1.90, -0.42, 0.25), 0.045, "X", "metal", depth=0.14, segments=10)

    # ---- roof spoiler over the hatch glass, with end plates
    wing = box(bm, (-1.53, 0, 1.412), (0.34, 1.24, 0.045), "paint", bevel=0.012,
               rot=Matrix.Rotation(math.radians(-7), 4, "Y"))
    box(bm, (-1.48, 0, 1.386), (0.2, 1.10, 0.03), "trim")
    for sy in (+1, -1):
        box(bm, (-1.53, sy * 0.62, 1.395), (0.36, 0.03, 0.10), "paint", bevel=0.008,
            rot=Matrix.Rotation(math.radians(-7), 4, "Y"))

    # ---- roof vent, mirrors, door roundels, mud flaps
    box(bm, (-0.16, 0, 1.438), (0.30, 0.34, 0.035), "trim", bevel=0.012)
    for sy in (+1, -1):
        box(bm, (0.64, sy * 0.855, 1.0), (0.10, 0.10, 0.085), "paint", bevel=0.02)
        box(bm, (0.66, sy * 0.80, 0.975), (0.05, 0.06, 0.03), "trim")
        disc(bm, (0.12, sy * 0.812, 0.745), 0.185, "Y", "plate", depth=0.014, segments=20)
        for ax in (AXLE_F, AXLE_R):
            box(bm, (ax - 0.445, sy * 0.745, 0.245), (0.025, 0.25, 0.25), "flap")
            arch_flare(bm, ax, sy)


def mark_sharp(bm, angle_deg=32.0):
    bm.normal_update()
    limit = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
            continue
        a, b = e.link_faces
        e.smooth = not (a.normal.angle(b.normal, 0.0) > limit or a.material_index != b.material_index)


def link_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ----------------------------------------------------------------------------- wheel
def build_wheel(mats, name, pos, outer):
    """Rally wheel: chunky tyre, dished white rim, five spokes. `outer` = +1 (left) or -1 (right)."""
    bm = bmesh.new()
    seg = 24
    hw = WHEEL_W / 2
    # (y, radius, material) profile from inner sidewall, over the tread, to the outer rim centre
    prof = [
        (-hw, 0.0, "tire"), (-hw, 0.275, "tire"), (-hw + 0.03, WHEEL_R - 0.012, "tire"), (-hw + 0.065, WHEEL_R, "tire"),
        (hw - 0.065, WHEEL_R, "tire"), (hw - 0.03, WHEEL_R - 0.012, "tire"), (hw, 0.275, "tire"),
        (hw, 0.222, "tire"), (hw - 0.012, 0.212, "rim"), (hw - 0.012, 0.185, "rim"), (hw - 0.07, 0.165, "trim"),
        (hw - 0.07, 0.0, "trim"),
    ]
    rings = []
    for y, r, _ in prof:
        if r == 0.0:
            rings.append([bm.verts.new((0, y, 0))])
        else:
            rings.append([bm.verts.new((math.cos(2 * math.pi * i / seg) * r, y, math.sin(2 * math.pi * i / seg) * r)) for i in range(seg)])
    for j in range(len(prof) - 1):
        a, b = rings[j], rings[j + 1]
        mat = M[prof[j + 1][2]]
        for i in range(seg):
            i2 = (i + 1) % seg
            if len(a) == 1:
                f = bm.faces.new((a[0], b[i2], b[i]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[i2], b[0]))
            else:
                f = bm.faces.new((a[i], a[i2], b[i2], b[i]))
            f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # spokes + hub sit in the dish
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        rot = Matrix.Rotation(-a, 4, "Y")
        box(bm, (math.cos(a) * 0.115, hw - 0.04, math.sin(a) * 0.115), (0.16, 0.05, 0.062), "rim", bevel=0.012, rot=rot)
    disc(bm, (0, hw - 0.03, 0), 0.062, "Y", "rim", depth=0.06, segments=12)
    disc(bm, (0, hw - 0.004, 0), 0.03, "Y", "metal", depth=0.02, segments=10)
    if outer < 0:
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi, 4, "Z"), verts=list(bm.verts))
    mark_sharp(bm, 38)
    obj = link_object(name, bm, mats)
    obj.location = pos
    return obj


# ----------------------------------------------------------------------------- assemble
def main():
    reset_scene()
    mats = make_materials()

    shell_bm = bmesh.new()
    faces, front, back = build_shell(shell_bm)
    paint_shell(shell_bm, faces, front, back)
    shell = link_object("shell", shell_bm, mats)
    cut = cut_wheel_wells(shell, mats)
    bpy.data.objects.remove(shell)

    bm = bmesh.new()
    bm.from_mesh(cut)
    bpy.data.meshes.remove(cut)
    add_details(bm)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    mark_sharp(bm)
    body = link_object("body", bm, mats)

    wheels = [
        build_wheel(mats, "wheel_fl", (AXLE_F, WHEEL_Y, WHEEL_R), +1),
        build_wheel(mats, "wheel_fr", (AXLE_F, -WHEEL_Y, WHEEL_R), -1),
        build_wheel(mats, "wheel_rl", (AXLE_R, WHEEL_Y, WHEEL_R), +1),
        build_wheel(mats, "wheel_rr", (AXLE_R, -WHEEL_Y, WHEEL_R), -1),
    ]

    tris = sum(len(p.vertices) - 2 for o in [body, *wheels] for p in o.data.polygons)
    bb = [Vector(c) for c in body.bound_box]
    size = Vector((max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb), max(v.z for v in bb)))
    print(f"[car] triangles: {tris}  body size L {size.x:.2f} W {size.y:.2f} H {size.z:.2f}")

    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB", export_yup=True, export_apply=True,
        export_normals=True, export_materials="EXPORT", export_cameras=False, export_lights=False,
    )
    print(f"[car] wrote {OUT}")


main()
