package app.ghostprompter.remote

const val CONTROL_COOLDOWN_MS = 1000L

/** Shared by discrete controls so alternating buttons cannot build a command backlog. */
class ControlCooldown {
    var until = 0L
        private set

    fun acquire(now: Long): Boolean {
        if (now < until) return false
        until = now + CONTROL_COOLDOWN_MS
        return true
    }
}
