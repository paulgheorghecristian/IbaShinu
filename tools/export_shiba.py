"""Export a game-ready Shiba GLB from the Blender sources.

Run it through tools/export-shiba.sh, not directly — Blender needs numpy on its
PYTHONPATH and that script arranges it.

    blender --background <source.blend> --python export_shiba.py \
        -- <out.glb> '{"Walk":"Walk | In Place | Expressive"}' [--no-mesh]

Two things here are not obvious and both were learned the hard way.

**Every clip is exported from the blend it was authored in.** Appending an
IK-driven action into a different rig looks like it works — the body arc came out
right to within 1% — but the legs never move, because the foreign rig's
constraints do not solve it.

**The solved pose is baked by hand.** The skin is bound to the DEF_ bones, whose
legs are posed entirely by IK and COPY_ROTATION constraints driven from a few
CTRL bones; the actions contain no leg channels at all. glTF has no constraints,
and the exporter's "force sampling" samples the action rather than the solved
pose, so exporting straight from the source gives a dog whose body arcs correctly
and whose legs are frozen solid. The guard at the end refuses to write a file
where that has happened again.

Everything that makes the render beautiful and a browser miserable is dropped: the
million-vertex fur coat, the guard hairs, the ear fringes, and the subsurf and
displace modifiers. What survives is decimated to a vertex budget and gets flat
Principled materials reading the sculpt's painted colour attributes, so the
tan-and-cream coat arrives as vertex colours with no textures at all.
"""
import bpy
import json
import sys
from math import degrees, acos
from mathutils import Vector

_args = sys.argv[sys.argv.index('--') + 1:]
OUT = _args[0]
WANTED = json.loads(_args[1])          # {"clip name in the GLB": "action in this blend"}
WITH_MESH = '--no-mesh' not in _args   # animation-only exports carry the skeleton alone

FUR = {'Coat | short directional undercoat', 'Ear | fine inner fringe  1',
       'Ear | fine inner fringe -1', 'Tail | long curved guard hairs'}
BUDGET = {'Dog | continuous anatomical sculpt': 8000,
          'Tail | curled plume over right hip': 2500}
FLAT = {'Nose | textured black leather': (0.05, 0.04, 0.04, 1),
        'Pupils | obsidian': (0.02, 0.02, 0.02, 1),
        'Closed smile | warm dark lip': (0.12, 0.06, 0.06, 1),
        'Whiskers | soft charcoal': (0.15, 0.15, 0.16, 1),
        'Eyes | deep brown': (0.07, 0.04, 0.03, 1)}

scene = bpy.context.scene
report = {'source': bpy.data.filepath, 'clips_requested': WANTED, 'with_mesh': WITH_MESH}

# ------------------------------------------------------------------ cull -----
keep = []
for obj in list(bpy.data.objects):
    skinned = obj.type == 'MESH' and any(m.type == 'ARMATURE' for m in obj.modifiers)
    if obj.type == 'ARMATURE' or (skinned and obj.name not in FUR and WITH_MESH):
        keep.append(obj)
    else:
        bpy.data.objects.remove(obj, do_unlink=True)

arm = next(o for o in keep if o.type == 'ARMATURE')
meshes = [o for o in keep if o.type == 'MESH']
report['kept'] = [o.name for o in meshes]

# These rigs are saved in Pose Mode, which makes object-mode operators fail their
# poll in a background Blender.
bpy.context.view_layer.objects.active = arm
if arm.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)

# ------------------------------------------------------- simplify meshes -----
before = after = 0
for obj in meshes:
    before += len(obj.data.vertices)
    bpy.context.view_layer.objects.active = obj
    obj.hide_set(False)
    obj.hide_viewport = False
    for mod in [m for m in obj.modifiers if m.type in {'SUBSURF', 'DISPLACE'}]:
        obj.modifiers.remove(mod)
    target = BUDGET.get(obj.name)
    if target and len(obj.data.vertices) > target:
        dec = obj.modifiers.new('decimate', 'DECIMATE')
        dec.decimate_type = 'COLLAPSE'
        dec.ratio = target / len(obj.data.vertices)
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dec.name)
    after += len(obj.data.vertices)
report['verts'] = {'before': before, 'after': after}

# ------------------------------------------ flat materials + vertex colour ---
for obj in meshes:
    attr = obj.data.color_attributes[0].name if len(obj.data.color_attributes) else None
    for slot in obj.material_slots:
        if not slot.material:
            continue
        old = slot.material.name
        mat = bpy.data.materials.new('gltf | ' + old)
        mat.use_nodes = True
        nt = mat.node_tree
        for node in list(nt.nodes):
            nt.nodes.remove(node)
        out_node = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = 0.72
        bsdf.inputs['Metallic'].default_value = 0.0
        nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
        if attr:
            vcol = nt.nodes.new('ShaderNodeVertexColor')
            vcol.layer_name = attr
            nt.links.new(vcol.outputs['Color'], bsdf.inputs['Base Color'])
        else:
            bsdf.inputs['Base Color'].default_value = FLAT.get(old, (0.6, 0.45, 0.3, 1))
        slot.material = mat

# ----------------------------------------------------------- keep actions ----
missing = [src for src in WANTED.values() if src not in bpy.data.actions]
if missing:
    raise SystemExit('missing actions: %r (have %r)'
                     % (missing, sorted(bpy.data.actions.keys())))
for act in list(bpy.data.actions):
    if act.name not in WANTED.values():
        bpy.data.actions.remove(act, do_unlink=True)

# -------------------------------------------------------- bake the solve -----
arm.animation_data_create()


def capture(action):
    """Armature-space matrices for every bone on every frame, constraints applied."""
    arm.animation_data.action = action
    lo, hi = int(action.frame_range[0]), int(action.frame_range[1])
    frames = list(range(lo, hi + 1))
    shots = []
    for frame in frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        shots.append({pb.name: pb.matrix.copy() for pb in arm.pose.bones})
    return frames, shots


def basis_of(bone, pose):
    """Armature-space pose back to a basis matrix: rest_local⁻¹ · parent⁻¹ · pose."""
    if bone.parent:
        rest_local = bone.parent.matrix_local.inverted() @ bone.matrix_local
        pose_local = pose[bone.parent.name].inverted() @ pose[bone.name]
    else:
        rest_local = bone.matrix_local
        pose_local = pose[bone.name]
    return rest_local.inverted() @ pose_local


captured = {clip: capture(bpy.data.actions[src]) for clip, src in WANTED.items()}

# Drop the sources now they are captured: leaving them makes the baked actions
# collide on name and silently become "Walk.001", while the original leg-less
# action keeps the name the exporter looks for.
arm.animation_data.action = None
for src in WANTED.values():
    bpy.data.actions.remove(bpy.data.actions[src], do_unlink=True)

# Constraints would re-solve on top of the baked keys and win, so they go.
for pb in arm.pose.bones:
    for con in list(pb.constraints):
        pb.constraints.remove(con)
    pb.rotation_mode = 'QUATERNION'

clips = {}
for clip, (frames, shots) in captured.items():
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    arm.animation_data.action = act
    for frame, pose in zip(frames, shots):
        for pb in arm.pose.bones:
            pb.matrix_basis = basis_of(arm.data.bones[pb.name], pose)
            pb.keyframe_insert('location', frame=frame)
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('scale', frame=frame)
    clips[clip] = {'frames': [float(frames[0]), float(frames[-1])],
                   'seconds': (frames[-1] - frames[0]) / scene.render.fps}
report['clips'] = clips
report['fps'] = scene.render.fps
scene.frame_start = 1
scene.frame_end = int(max(c['frames'][1] for c in clips.values()))

# --------------------------------------------- confirm the legs do move ------
# The failure this guards against was silent: the clip exported, the body arc
# matched the source to within 1%, and every leg bone was frozen.
LEGS = [b.name for b in arm.data.bones
        if b.name.startswith('DEF_') and ('front' in b.name or 'hind' in b.name)]
report['leg_swing_deg'] = {}
for clip in clips:
    arm.animation_data.action = bpy.data.actions[clip]
    rest, swing = {}, {}
    lo, hi = int(clips[clip]['frames'][0]), int(clips[clip]['frames'][1])
    for frame in range(lo, hi + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        for bone in LEGS:
            quat = arm.pose.bones[bone].matrix_basis.to_quaternion()
            if bone not in rest:
                rest[bone], swing[bone] = quat, 0.0
            else:
                swing[bone] = max(swing[bone],
                                  degrees(2 * acos(min(1.0, abs(quat.dot(rest[bone]))))))
    mean = sum(swing.values()) / max(1, len(swing))
    report['leg_swing_deg'][clip] = round(mean, 1)
    if mean < 5:
        raise SystemExit('clip %r has %.1f deg of mean leg articulation: the solved '
                         'pose did not bake, so the legs would ship frozen' % (clip, mean))

# --------------------------------------------------- measure the jump arc ----
# The clip is a whole jump — stand, crouch, push, fly, land, recover — but the
# game's jump is instantaneous, so the runtime needs to know which slice of it is
# the airborne part. Watch the lowest vertex: the dog is off the ground when it
# clears the floor. The reference is the STANDING pose at frame one, never the
# global minimum, which is the anticipation crouch dropping below the paws.
report['jump_phase'] = None
if 'Jump' in bpy.data.actions and meshes:
    body = max(meshes, key=lambda o: len(o.data.vertices))
    arm.animation_data.action = bpy.data.actions['Jump']
    lo, hi = int(clips['Jump']['frames'][0]), int(clips['Jump']['frames'][1])
    heights = []
    for frame in range(lo, hi + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        heights.append((frame, min((mw @ v.co).z for v in mesh.vertices)))
        ev.to_mesh_clear()

    standing = heights[0][1]
    peak = max(h for _, h in heights)
    threshold = standing + max(0.03 * (peak - standing), 0.01)
    airborne = [f for f, h in heights if h > threshold]
    apex = max(heights, key=lambda fh: fh[1])[0]
    takeoff, land = (min(airborne), max(airborne)) if airborne else (lo, hi)
    report['jump_phase'] = {
        'frames': {'takeoff': takeoff, 'apex': apex, 'land': land, 'clip': [lo, hi]},
        'seconds': {name: round((value - lo) / scene.render.fps, 4)
                    for name, value in (('takeoff', takeoff), ('apex', apex), ('land', land))},
        'standing_height': round(standing, 4),
        'ground_clearance': round(peak - standing, 4),
    }

# ------------------------------------------------------------- measure -------
arm.animation_data.action = bpy.data.actions[sorted(clips)[0]]
scene.frame_set(1)
bpy.context.view_layer.update()
report['bbox_blender_xyz'] = None
if meshes:
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        ev = obj.evaluated_get(dg)
        for corner in ev.bound_box:
            world = ev.matrix_world @ Vector(corner)
            low = Vector((min(low[i], world[i]) for i in range(3)))
            high = Vector((max(high[i], world[i]) for i in range(3)))
    report['bbox_blender_xyz'] = {'min': list(low), 'max': list(high),
                                  'size': [high[i] - low[i] for i in range(3)]}

# -------------------------------------------------------------- export -------
for obj in bpy.context.view_layer.objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    use_visible=False,
    export_apply=False,
    export_yup=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_frame_step=1,
    export_bake_animation=True,
    # OFF deliberately: it drops keyframes it judges redundant, which softens the
    # extremes of a punchy action.
    export_optimize_animation_size=False,
    export_skins=True,
    export_morph=False,
    export_materials='EXPORT',
    export_image_format='NONE',
    export_cameras=False,
    export_lights=False,
    export_extras=False,
)
print('###JSON###')
print(json.dumps(report, indent=1))
