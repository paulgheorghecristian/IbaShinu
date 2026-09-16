import * as THREE from 'three'
import type { InputFrame } from '../engine/Input'
import type { Physics } from '../engine/Physics'
import type { Course } from '../world/Course'
import type { Runner } from './Runner'
import { AI, RUNNER, PHYSICS } from '../config'

/**
 * Hang time of a full jump on flat ground. Derived rather than tuned so the bots
 * re-plan automatically whenever the jump or gravity is retuned.
 */
/** Recomputed rather than captured, so the tuner can move either number. */
const airTime = () => (2 * RUNNER.jumpSpeed) / Math.abs(PHYSICS.gravity)

/**
 * Reactive steering for a bot racer.
 *
 * No pathfinding: the course hands out a racing line, and the bot follows it while
 * a short forward probe decides when to jump. That is enough to make a pack that
 * reads as alive — and, more importantly, one that visibly *fails* when a trap
 * removes the floor it was aiming at.
 */
export class AiBrain {
  private nodeIndex = 0
  private stuckTimer = 0
  private previousJumpIntent = false

  private readonly phase = Math.random() * Math.PI * 2
  private readonly bias = Math.random() < 0.5 ? -1 : 1
  private readonly target = new THREE.Vector3()
  private readonly here = new THREE.Vector3()

  constructor(readonly skill: number) {}

  think(runner: Runner, course: Course, physics: Physics, dt: number, elapsed: number): InputFrame {
    this.here.copy(runner.position)
    const v = runner.body.linvel()

    this.nodeIndex = course.nextWaypointIndex(this.here, this.nodeIndex)
    // Only cut a corner when both the current node and the next one are roomy —
    // skipping ahead on a stepping stone aims the bot straight into the void.
    const canSkip =
      course.nodeHalfWidth(this.nodeIndex) >= 3 && course.nodeHalfWidth(this.nodeIndex + 1) >= 3
    const lookIndex = Math.min(
      this.nodeIndex + (canSkip ? AI.lookaheadNodes : 1),
      course.waypoints.length - 1,
    )
    course.nodePosition(lookIndex, this.target)

    // Wander inside whatever lateral room the platform actually offers.
    const room = course.nodeHalfWidth(lookIndex)
    this.target.x += Math.sin(elapsed * AI.wanderSpeed + this.phase) * Math.min(AI.wanderAmplitude, room * 0.55)

    const dx = this.target.x - this.here.x
    const dz = this.target.z - this.here.z
    const flat = Math.hypot(dx, dz) || 1
    let yaw = Math.atan2(dx, dz)
    let throttle = this.skill

    // A sliding platform is a timing problem, not a steering one: hold on the lip
    // and strafe until it swings into range, then commit.
    const liningUp =
      course.nodeIsMover(lookIndex) &&
      runner.grounded &&
      dz > 0 &&
      dz < 8 &&
      Math.abs(dx) > 2.2
    if (liningUp) {
      yaw = dx > 0 ? Math.PI / 2 : -Math.PI / 2
      throttle = Math.min(1, Math.abs(dx) / 3) * this.skill
    }

    // --- is there floor where we are about to be? --------------------------
    // The jump now takes `jumpWindup` to leave the ground, so the decision has to
    // be made that much earlier or the launch happens past the edge.
    const speed = Math.hypot(v.x, v.z)
    const reach = AI.gapProbeDistance + speed * RUNNER.jumpWindup
    const floorAhead = physics.probeDown(
      { x: this.here.x + (dx / flat) * reach, y: this.here.y + 0.4, z: this.here.z + (dz / flat) * reach },
      AI.gapProbeDepth,
      runner.body,
    )
    const gapAhead = floorAhead === null

    this.stuckTimer = runner.grounded && speed < 1.4 ? this.stuckTimer + dt : 0
    const stuck = this.stuckTimer > AI.stuckTime

    const climbing = this.target.y > this.here.y + 0.7

    // Ballistic planning. Arriving at the edge too fast overshoots a stepping
    // stone just as reliably as arriving too slow falls short, so the bot brakes
    // (reverse thrust, which the movement clamp makes almost instant) until its
    // speed matches the distance it actually has to cover, then commits.
    //
    // Except when climbing, where the arithmetic inverts. A jump only clears a
    // 1.1 m riser for about half a second of its arc, so the horizontal reach at
    // that height is far shorter than on the flat — braking to the "right" speed
    // for the distance leaves the bot short of the next ledge, every time.
    let jumpForGap = false
    if (gapAhead && runner.grounded && !liningUp && !climbing) {
      const wanted = Math.min(RUNNER.maxGroundSpeed, Math.max(2.5, flat / airTime()))
      if (speed > wanted * AI.approachTolerance) throttle = -AI.brakeThrottle
      else jumpForGap = true
    }
    const wantJump =
      runner.grounded && (jumpForGap || stuck || (climbing && !liningUp))

    // Better bots convert a falling arc into a glide to stretch a jump.
    const wantGlide = !runner.grounded && v.y < -0.8 && flat > 2.2 && this.skill > 0.82

    // The edge tracks the *jump* decision alone. Deriving it from the held key
    // instead would swallow the first jump after every glide, because the key was
    // already down for the glide and so never produced a rising edge.
    const jumpPressed = wantJump && !this.previousJumpIntent
    this.previousJumpIntent = wantJump
    const jump = wantJump || wantGlide

    return {
      forward: throttle,
      right: stuck ? this.bias * 0.6 : 0,
      jump,
      jumpPressed,
      // Open ground only. The ballistic planner brakes them back down before a
      // gap, so sprinting into one costs time rather than saving it.
      sprint: runner.grounded && !liningUp && !gapAhead && flat > 5,
      yaw,
    }
  }
}
