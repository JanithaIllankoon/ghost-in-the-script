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

    /** Bumped for every new connection, so callbacks from an old socket are ignored. */
    private val gen = AtomicInteger(0)
    @Volatile private var socket: WebSocket? = null
    private var job: Job? = null
    private var started = false
    private var lastGoodHost: String? = null
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
        job = viewModelScope.launch {
            var wait = 1000L
            while (isActive && gen.get() == my) {
                when (val r = tryHosts(p, my)) {
                    is Attempt.Ok -> {
                        lastGoodHost = r.host
                        return@launch
                    }
                    is Attempt.Denied -> {
                        _conn.value = Conn.Problem(p.name, r.reason, retrying = false)
                        return@launch
                    }
                    Attempt.Unreachable -> {
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
                    "status" -> msg.optJSONObject("s")?.let { _status.value = merge(parseStatus(it)) }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost(webSocket)

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket)

            private fun lost(webSocket: WebSocket) {
                if (result.complete(Attempt.Unreachable)) return
                // The connection dropped after it was working: try again straight away.
                if (gen.get() == my && socket === webSocket) {
                    socket = null
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
            visible = if (held("visible")) cur.visible else incoming.visible,
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

    // ---------- Commands ----------

    private fun send(o: JSONObject) {
        if (_conn.value is Conn.Connected) socket?.send(o.toString())
    }

    private fun cmd(type: String, extra: JSONObject.() -> Unit = {}) {
        send(JSONObject().put("t", "cmd").put("cmd", JSONObject().put("type", type).apply(extra)))
    }

    fun playPause() = cmd("play-pause")
    /** Stops and goes back to the start of the script. */
    fun stop() = cmd("rewind")
    fun backLine() = cmd("back")
    fun forwardLine() = cmd("forward")
    fun seek(fraction: Float) = cmd("seek") { put("fraction", fraction.toDouble().coerceIn(0.0, 1.0)) }

    fun setSpeed(speed: Int) {
        val v = speed.coerceIn(1, 100)
        hold("speed")
        _status.value = _status.value.copy(speed = v)
        cmd("set-speed") { put("speed", v) }
    }

    fun setMode(mode: String) {
        hold("mode")
        _status.value = _status.value.copy(mode = mode)
        cmd("set-mode") { put("mode", mode) }
    }

    fun setClickThrough(on: Boolean) {
        hold("clickThrough")
        _status.value = _status.value.copy(clickThrough = on)
        cmd("set-click-through") { put("on", on) }
    }

    fun showPrompter(on: Boolean) {
        hold("visible")
        _status.value = _status.value.copy(visible = on)
        send(JSONObject().put("t", "show").put("on", on))
    }

    fun move(dx: Int, dy: Int) = send(JSONObject().put("t", "move").put("dx", dx).put("dy", dy))
    fun resize(dw: Int, dh: Int) = send(JSONObject().put("t", "resize").put("dw", dw).put("dh", dh))
    fun centre() = send(JSONObject().put("t", "centre"))
}
