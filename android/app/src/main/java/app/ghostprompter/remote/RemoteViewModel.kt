package app.ghostprompter.remote

import android.app.Application
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** The prompter's state, as the PC reports it every 400 ms. */
data class PrompterStatus(
    val playing: Boolean = false,
    /** Countdown seconds left before scrolling starts, 0 when none. */
    val counting: Int = 0,
    val mode: String = "manual",
    val speed: Int = 22,
    val progress: Float = 0f,
    val elapsed: Double = 0.0,
    /** Estimated seconds left, negative when unknown. */
    val remaining: Double = -1.0,
    val clickThrough: Boolean = false,
    val visible: Boolean = false,
)

/** One line of the latency log. [ms] is null for events like connecting or losing the connection. */
data class LogEntry(val at: Long, val what: String, val ms: Long?, val failed: Boolean = false)

/** Round-trip times: the last value, and the average, lowest, highest and 95th percentile of recent ones. */
data class Stats(val last: Long, val avg: Long, val min: Long, val max: Long, val p95: Long, val count: Int) {
    companion object {
        fun of(values: List<Long>): Stats? {
            if (values.isEmpty()) return null
            val sorted = values.sorted()
            val p95 = sorted[((sorted.size - 1) * 0.95).toInt()]
            return Stats(values.last(), values.average().toLong(), sorted.first(), sorted.last(), p95, values.size)
        }
    }
}

/** A timed message waiting for its reply. [viaStatus]: done when a prompter status reports this id or a later one. */
private data class Pending(val label: String, val sentNanos: Long, val viaStatus: Boolean)

sealed interface Conn {
    data object NotPaired : Conn
    data class Connecting(val name: String) : Conn
    data class Connected(val name: String) : Conn
    /** Couldn't connect, or the PC closed the connection. [retrying] means the app keeps trying on its own. */
    data class Problem(val name: String, val message: String, val retrying: Boolean) : Conn
}

private sealed interface Attempt {
    data class Ok(val socket: WebSocket, val host: String) : Attempt
    data class Denied(val reason: String) : Attempt
    data object Unreachable : Attempt
}

class RemoteViewModel(app: Application) : AndroidViewModel(app) {
    private val store = PairingStore(app)
    private val http = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        // Keeps the connection alive and notices quickly when the PC goes away.
        .pingInterval(4, TimeUnit.SECONDS)
        .build()

    private var pairing: Pairing? = store.load()
    private val _conn = MutableStateFlow<Conn>(pairing?.let { Conn.Connecting(it.name) } ?: Conn.NotPaired)
    val conn: StateFlow<Conn> = _conn
    private val _status = MutableStateFlow(PrompterStatus())
    val status: StateFlow<PrompterStatus> = _status
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message
    private val _fine = MutableStateFlow(store.fineSteps)
    val fineSteps: StateFlow<Boolean> = _fine
    private val controlGate = ControlCooldown()
    private val _cooldownUntil = MutableStateFlow(0L)
    val cooldownUntil: StateFlow<Long> = _cooldownUntil

    /** Bumped for every new connection, so callbacks from an old socket are ignored. */
    private val gen = AtomicInteger(0)
    @Volatile private var socket: WebSocket? = null
    private var job: Job? = null
    private var started = false
    private var lastGoodHost: String? = null
    // Latency
    private val nextId = AtomicLong(1)
    private val pending = ConcurrentHashMap<Long, Pending>()
    private val timesLock = Any()
    private val pingTimes = ArrayDeque<Long>()
    private val cmdTimes = ArrayDeque<Long>()
    private val _log = MutableStateFlow<List<LogEntry>>(emptyList())
    /** Newest first, up to 300 lines. */
    val log: StateFlow<List<LogEntry>> = _log
    private val _pingStats = MutableStateFlow<Stats?>(null)
    val pingStats: StateFlow<Stats?> = _pingStats
    private val _cmdStats = MutableStateFlow<Stats?>(null)
    val cmdStats: StateFlow<Stats?> = _cmdStats
    private var pingJob: Job? = null

    /** Fields changed on the phone a moment ago, so a status already on its way doesn't flip them back. */
    private val holds = ConcurrentHashMap<String, Long>()

    val pairedName: String? get() = pairing?.name

    // ---------- Lifecycle ----------

    /** The app came to the front: connect to the remembered PC. */
    fun onStart() {
        started = true
        val p = pairing ?: return
        if (_conn.value !is Conn.Connected && job?.isActive != true) connect(p)
    }

    /** The app went to the background: let go of the connection so the PC isn't kept waiting. */
    fun onStop() {
        started = false
        val p = pairing ?: return
        drop()
        _conn.value = Conn.Connecting(p.name)
    }

    override fun onCleared() {
        drop()
        http.dispatcher.executorService.shutdown()
    }

    private fun drop() {
        gen.incrementAndGet()
        job?.cancel()
        job = null
        pingJob?.cancel()
        pingJob = null
        pending.clear()
        socket?.close(1000, null)
        socket = null
    }

    // ---------- Pairing ----------

    /** A scanned QR code or a ghostremote:// link. Returns false if it isn't a pairing code. */
    fun onScanned(text: String?): Boolean {
        val p = Pairing.parse(text) ?: return false
        pairing = p
        lastGoodHost = null
        store.save(p)
        connect(p)
        return true
    }

    fun retry() {
        pairing?.let { connect(it) }
    }

    fun forget() {
        drop()
        pairing = null
        lastGoodHost = null
        store.clear()
        _status.value = PrompterStatus()
        _conn.value = Conn.NotPaired
    }

    fun showMessage(text: String) {
        _message.value = text
    }

    fun clearMessage() {
        _message.value = null
    }

    fun setFineSteps(on: Boolean) {
        _fine.value = on
        store.fineSteps = on
    }

    // ---------- Connecting ----------

    private fun connect(p: Pairing) {
        drop()
        val my = gen.get()
        _conn.value = Conn.Connecting(p.name)
        val began = SystemClock.elapsedRealtime()
        job = viewModelScope.launch {
            var wait = 1000L
            while (isActive && gen.get() == my) {
                when (val r = tryHosts(p, my)) {
                    is Attempt.Ok -> {
                        lastGoodHost = r.host
                        addLog("Connected to ${p.name} at ${r.host}", SystemClock.elapsedRealtime() - began)
                        startPings(my)
                        return@launch
                    }
                    is Attempt.Denied -> {
                        addLog("Refused: ${r.reason}", null, failed = true)
                        _conn.value = Conn.Problem(p.name, r.reason, retrying = false)
                        return@launch
                    }
                    Attempt.Unreachable -> {
                        addLog("Couldn't reach ${p.name}", null, failed = true)
                        _conn.value = Conn.Problem(
                            p.name,
                            "Can't reach ${p.name}. Check that Phone Remote is on in the app's Settings and that both are on the same Wi-Fi.",
                            retrying = true,
                        )
                        delay(wait)
                        wait = (wait * 2).coerceAtMost(8000L)
                    }
                }
            }
        }
    }

    private suspend fun tryHosts(p: Pairing, my: Int): Attempt {
        val hosts = p.hosts.sortedByDescending { it == lastGoodHost }
        for (host in hosts) {
            if (gen.get() != my) return Attempt.Unreachable
            val r = tryHost(p, host, my)
            if (r !is Attempt.Unreachable) return r
        }
        return Attempt.Unreachable
    }

    private suspend fun tryHost(p: Pairing, host: String, my: Int): Attempt {
        val result = CompletableDeferred<Attempt>()
        val request = Request.Builder().url("ws://$host:${p.port}/").build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val hello = JSONObject()
                    .put("t", "hello")
                    .put("token", p.token)
                    .put("device", deviceName())
                webSocket.send(hello.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (gen.get() != my) {
                    webSocket.cancel()
                    return
                }
                val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (msg.optString("t")) {
                    "welcome" -> {
                        socket = webSocket
                        val pc = msg.optString("pc").ifBlank { p.name }
                        _conn.value = Conn.Connected(pc)
                        result.complete(Attempt.Ok(webSocket, host))
                    }
                    "denied" -> {
                        val reason = msg.optString("reason").ifBlank { "The PC refused the connection." }
                        if (!result.complete(Attempt.Denied(reason))) {
                            // Already connected: the PC turned Phone Remote off or made a new code.
                            gen.incrementAndGet()
                            socket = null
                            _conn.value = Conn.Problem(p.name, reason, retrying = false)
                        }
                        webSocket.close(1000, null)
                    }
                    "status" -> msg.optJSONObject("s")?.let {
                        _status.value = merge(parseStatus(it))
                        if (it.has("rid")) settle(it.optLong("rid"), upTo = true)
                    }
                    "ack", "pong" -> if (msg.has("id")) settle(msg.optLong("id"), upTo = false)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost(webSocket)

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket)

            private fun lost(webSocket: WebSocket) {
                if (result.complete(Attempt.Unreachable)) return
                // The connection dropped after it was working: try again straight away.
                if (gen.get() == my && socket === webSocket) {
                    socket = null
                    addLog("Connection lost", null, failed = true)
                    viewModelScope.launch {
                        delay(600)
                        if (gen.get() == my && started) connect(p)
                    }
                }
            }
        }
        val ws = http.newWebSocket(request, listener)
        val r = withTimeoutOrNull(4500) { result.await() }
        if (r == null) {
            result.complete(Attempt.Unreachable)
            ws.cancel()
            return Attempt.Unreachable
        }
        if (r !is Attempt.Ok) ws.cancel()
        return r
    }

    private fun hold(field: String) {
        holds[field] = SystemClock.uptimeMillis() + 700
    }

    private fun merge(incoming: PrompterStatus): PrompterStatus {
        val now = SystemClock.uptimeMillis()
        fun held(field: String) = (holds[field] ?: 0L) > now
        val cur = _status.value
        return incoming.copy(
            speed = if (held("speed")) cur.speed else incoming.speed,
            mode = if (held("mode")) cur.mode else incoming.mode,
            clickThrough = if (held("clickThrough")) cur.clickThrough else incoming.clickThrough,
        )
    }

    private fun parseStatus(s: JSONObject) = PrompterStatus(
        playing = s.optBoolean("playing"),
        counting = s.optInt("counting"),
        mode = s.optString("mode", "manual"),
        speed = s.optInt("speed", 22),
        progress = s.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f),
        elapsed = s.optDouble("elapsed", 0.0),
        remaining = s.optDouble("remaining", -1.0),
        clickThrough = s.optBoolean("clickThrough"),
        visible = s.optBoolean("visible"),
    )

    private fun deviceName(): String {
        val named = runCatching {
            Settings.Global.getString(getApplication<Application>().contentResolver, "device_name")
        }.getOrNull()
        if (!named.isNullOrBlank()) return named
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        return if (Build.MODEL.startsWith(Build.MANUFACTURER, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
    }

    // ---------- Latency ----------

    private fun addLog(what: String, ms: Long?, failed: Boolean = false) {
        val entry = LogEntry(System.currentTimeMillis(), what, ms, failed)
        synchronized(timesLock) { _log.value = (listOf(entry) + _log.value).take(300) }
    }

    fun clearLog() {
        synchronized(timesLock) {
            _log.value = emptyList()
            pingTimes.clear()
            cmdTimes.clear()
            _pingStats.value = null
            _cmdStats.value = null
        }
    }

    /** Sends [o] with a new id and remembers when, so the reply can be timed. */
    private fun sendTimed(label: String, o: JSONObject, viaStatus: Boolean) {
        val ws = socket ?: return
        if (_conn.value !is Conn.Connected) return
        val id = nextId.getAndIncrement()
        pending[id] = Pending(label, SystemClock.elapsedRealtimeNanos(), viaStatus)
        ws.send(o.put("id", id).toString())
    }

    /** A reply arrived for [id]. A prompter status means every command up to [id] is done. */
    private fun settle(id: Long, upTo: Boolean) {
        val now = SystemClock.elapsedRealtimeNanos()
        val done = if (upTo) pending.filter { (k, v) -> v.viaStatus && k <= id } else pending.filterKeys { it == id }
        for ((k, v) in done.toSortedMap()) {
            if (pending.remove(k) == null) continue
            val ms = (now - v.sentNanos) / 1_000_000
            if (v.label == "Ping") {
                record(pingTimes, ms, _pingStats)
            } else {
                record(cmdTimes, ms, _cmdStats)
                addLog(v.label, ms)
            }
        }
    }

    private fun record(times: ArrayDeque<Long>, ms: Long, out: MutableStateFlow<Stats?>) {
        synchronized(timesLock) {
            times.addLast(ms)
            while (times.size > 50) times.removeFirst()
            out.value = Stats.of(times.toList())
        }
    }

    /** Pings every 2 s while connected, and notes anything that never got a reply. */
    private fun startPings(my: Int) {
        pingJob?.cancel()
        pingJob = viewModelScope.launch {
            while (isActive && gen.get() == my) {
                sendTimed("Ping", JSONObject().put("t", "ping"), viaStatus = false)
                delay(2000)
                val cutoff = SystemClock.elapsedRealtimeNanos() - 5_000_000_000L
                for ((k, v) in pending.filterValues { it.sentNanos < cutoff }) {
                    if (pending.remove(k) != null) addLog("${v.label}: no reply after 5 s", null, failed = true)
                }
            }
        }
    }

    // ---------- Commands ----------

    private fun control(action: () -> Unit) {
        if (socket == null || _conn.value !is Conn.Connected) return
        val now = SystemClock.elapsedRealtime()
        if (!controlGate.acquire(now)) return
        _cooldownUntil.value = controlGate.until
        action()
    }

    private fun send(label: String, o: JSONObject) = control { sendTimed(label, o, viaStatus = false) }

    private fun cmd(label: String, type: String, extra: JSONObject.() -> Unit = {}) {
        val c = JSONObject().put("type", type).apply(extra)
        sendTimed(label, JSONObject().put("t", "cmd").put("cmd", c), viaStatus = true)
    }

    fun playPause() = control { cmd(if (_status.value.playing || _status.value.counting > 0) "Pause" else "Play", "play-pause") }
    /** Stops and goes back to the start of the script. */
    fun stop() = control { cmd("Stop", "rewind") }
    fun backLine() = control { cmd("Back one line", "back") }
    fun forwardLine() = control { cmd("Forward one line", "forward") }
    fun seek(fraction: Float) =
        cmd("Scroll to ${(fraction * 100).toInt()}%", "seek") { put("fraction", fraction.toDouble().coerceIn(0.0, 1.0)) }

    fun setSpeed(speed: Int) {
        val v = speed.coerceIn(1, 100)
        hold("speed")
        _status.value = _status.value.copy(speed = v)
        cmd("Speed $v", "set-speed") { put("speed", v) }
    }

    fun adjustSpeed(delta: Int) = control { setSpeed(_status.value.speed + delta) }

    fun setMode(mode: String) = control {
        hold("mode")
        _status.value = _status.value.copy(mode = mode)
        cmd("Mode: $mode", "set-mode") { put("mode", mode) }
    }

    fun setClickThrough(on: Boolean) = control {
        hold("clickThrough")
        _status.value = _status.value.copy(clickThrough = on)
        cmd("Click-through ${if (on) "on" else "off"}", "set-click-through") { put("on", on) }
    }

    fun move(dx: Int, dy: Int) = send("Move", JSONObject().put("t", "move").put("dx", dx).put("dy", dy))
    fun resize(dw: Int, dh: Int) = send("Resize", JSONObject().put("t", "resize").put("dw", dw).put("dh", dh))
    fun centre() = send("Top centre", JSONObject().put("t", "centre"))
    fun middle() = send("Reset to screen centre", JSONObject().put("t", "middle"))
}
