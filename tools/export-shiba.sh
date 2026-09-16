#!/usr/bin/env bash
# Re-export the Shiba model and its clips from the Blender sources.
#
# Each animation is exported from the blend it was authored in. Retargeting an
# IK-driven action into another rig fails silently — the body moves and the legs
# stay frozen — so the exporter refuses any clip with under 5 degrees of mean leg
# articulation rather than shipping a stiff dog.
#
# Ubuntu's Blender uses the system Python, which has no numpy, and the glTF
# exporter needs it. Rather than touching the system we vendor numpy locally.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS="$HERE/../public/models"
VENDOR="$HERE/.blender-deps"

WALK_JUMP_BLEND="${WALK_JUMP_BLEND:-/home/paulg/Desktop/claude-blender/dog_work/dog_improved_rig.blend}"
RUN_BLEND="${RUN_BLEND:-/home/paulg/Desktop/astra-blender-test/dog_work/cascadeur_experiment2/travel_views/dog_experiment2_travel.blend}"

if [ ! -d "$VENDOR/numpy" ]; then
  echo "installing numpy for Blender into $VENDOR"
  python3 -m pip install --quiet --target "$VENDOR" numpy
fi

mkdir -p "$MODELS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_blender() {
  PYTHONPATH="$VENDOR" \
  TMPDIR="$TMP" XDG_CACHE_HOME="$TMP" XDG_CONFIG_HOME="$TMP" XDG_DATA_HOME="$TMP" \
  BLENDER_USER_CONFIG="$TMP/cfg" BLENDER_USER_SCRIPTS="$TMP/scripts" BLENDER_USER_DATAFILES="$TMP/data" \
  PYTHONDONTWRITEBYTECODE=1 \
  blender --background --factory-startup --threads 6 --python-exit-code 1 \
    "$1" --python "$HERE/export_shiba.py" -- "${@:2}"
}

# Mesh, skeleton, and the two IK-driven clips, from the rig that owns them.
echo "== walk + jump =="
run_blender "$WALK_JUMP_BLEND" "$MODELS/shiba.glb" \
  '{"Walk":"Walk | In Place | Expressive","Jump":"Jump 4 | In Place"}'

# The Cascadeur run is baked onto the deform bones and lives in another file;
# skeleton only, since three.js binds its clip onto the main model by bone name.
echo "== run =="
run_blender "$RUN_BLEND" "$MODELS/shiba-run.glb" \
  '{"Run":"Run | Energetic Experiment 2 | In Place"}' --no-mesh

ls -la "$MODELS"
