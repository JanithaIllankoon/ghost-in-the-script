package app.ghostprompter.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ControlCooldownTest {
    @Test
    fun rapidTapsCannotExtendOrBypassCooldown() {
        val gate = ControlCooldown()
        assertTrue(gate.acquire(100))
        for (time in 101L until 1100L) assertFalse(gate.acquire(time))
        assertTrue(gate.acquire(1100))
        assertFalse(gate.acquire(1100))
    }

    @Test
    fun elapsedTimeRestoresControlsAfterBackgrounding() {
        val gate = ControlCooldown()
        assertTrue(gate.acquire(0))
        assertTrue(gate.acquire(60_000))
        assertFalse(gate.acquire(60_001))
    }
}
