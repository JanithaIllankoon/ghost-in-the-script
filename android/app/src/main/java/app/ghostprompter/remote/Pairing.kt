package app.ghostprompter.remote

import android.content.Context
import android.net.Uri

/**
 * What the PC's QR code holds:
 * `ghostremote://pair?v=1&h=192.168.1.20,10.0.0.4&p=47321&t=<token>&n=<PC name>`
 * The phone tries each address in turn, since a PC can have several network adapters.
 */
data class Pairing(
    val hosts: List<String>,
    val port: Int,
    val token: String,
    val name: String,
) {
    companion object {
        private val HOST = Regex("^[A-Za-z0-9.\\-]{1,253}$")

        fun parse(text: String?): Pairing? {
            if (text.isNullOrBlank()) return null
            val uri = runCatching { Uri.parse(text.trim()) }.getOrNull() ?: return null
            if (!uri.scheme.equals("ghostremote", true) || !uri.host.equals("pair", true)) return null
            val hosts = uri.getQueryParameter("h").orEmpty().split(',')
                .map { it.trim() }
                .filter { HOST.matches(it) }
                .take(6)
            val port = uri.getQueryParameter("p")?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            val token = uri.getQueryParameter("t")?.takeIf { it.length in 16..128 } ?: return null
            val name = uri.getQueryParameter("n")?.take(40)?.ifBlank { null } ?: "Your PC"
            if (hosts.isEmpty()) return null
            return Pairing(hosts, port, token, name)
        }
    }
}

/** Remembers the last paired PC so the app reconnects without scanning again. */
class PairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    fun load(): Pairing? {
        val hosts = prefs.getString("hosts", null)?.split(',')?.filter { it.isNotBlank() } ?: return null
        val token = prefs.getString("token", null) ?: return null
        val port = prefs.getInt("port", 0).takeIf { it > 0 } ?: return null
        if (hosts.isEmpty()) return null
        return Pairing(hosts, port, token, prefs.getString("name", null) ?: "Your PC")
    }

    fun save(p: Pairing) {
        prefs.edit()
            .putString("hosts", p.hosts.joinToString(","))
            .putInt("port", p.port)
            .putString("token", p.token)
            .putString("name", p.name)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    var fineSteps: Boolean
        get() = prefs.getBoolean("fine", false)
        set(v) {
            prefs.edit().putBoolean("fine", v).apply()
        }
}
