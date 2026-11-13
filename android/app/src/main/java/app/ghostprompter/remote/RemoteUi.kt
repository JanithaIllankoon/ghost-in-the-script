@file:OptIn(ExperimentalMaterial3Api::class)

package app.ghostprompter.remote

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.Icons.AutoMirrored
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CenterFocusStrong
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.VerticalAlignTop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

private val MODES = listOf(
    "manual" to "Fixed",
    "voice" to "Voice",
    "follow" to "Follow",
)

private val LocalCooldown = compositionLocalOf { 0f }

@Composable
fun RemoteApp(vm: RemoteViewModel, onScan: () -> Unit) {
    val conn by vm.conn.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val fine by vm.fineSteps.collectAsStateWithLifecycle()
    val ping by vm.pingStats.collectAsStateWithLifecycle()
    var showLog by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        val m = message ?: return@LaunchedEffect
        vm.clearMessage()
        snackbar.showSnackbar(m)
    }

    // Start screen: shown on every launch, even when the PC connects straight away.
    var splash by rememberSaveable { mutableIntStateOf(SPLASH_SHOWING) }
    LaunchedEffect(Unit) { if (splash == SPLASH_LEAVING) splash = SPLASH_DONE }
    var splashReady by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        // A short moment for the saved PC to connect before Continue lights up.
        delay(900)
        withTimeoutOrNull(2100) { vm.conn.first { it !is Conn.Connecting } }
        splashReady = true
    }
    var splashLogo by remember { mutableStateOf<Rect?>(null) }
    var creditLogo by remember { mutableStateOf<Rect?>(null) }
    var starPop by remember { mutableIntStateOf(0) }
    val uri = LocalUriHandler.current
    val openGithub: () -> Unit = {
        try {
            uri.openUri(REPO_URL)
        } catch (_: Exception) {
            vm.showMessage("Couldn't open GitHub. The project is at $REPO_URL")
        }
    }
    val context = LocalContext.current
    val land: () -> Unit = {
        splash = SPLASH_DONE
        starPop += 1
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            snackbarHost = {
                SnackbarHost(snackbar) { data ->
                    Snackbar { Text(data.visuals.message, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
                }
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { pad ->
            Column(Modifier.fillMaxSize().padding(pad), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                    if (showLog) {
                        BackHandler { showLog = false }
                        LatencyScreen(vm, onBack = { showLog = false })
                    } else when (val c = conn) {
                        is Conn.Connected -> RemoteScreen(c.name, status, fine, ping, vm, onScan, onLog = { showLog = true })
                        else -> ConnectScreen(c, vm.pairedName, onScan, vm::retry, vm::forget, onLog = { showLog = true })
                    }
                }
                if (!showLog) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    CreditBadge(
                        logoVisible = splash == SPLASH_DONE,
                        pop = starPop,
                        onLogo = { creditLogo = it },
                        onStar = openGithub,
                    )
                }
            }
        }
        if (splash != SPLASH_DONE) {
            Splash(
                status = splashStatus(conn, splashReady),
                ready = splashReady,
                leaving = splash == SPLASH_LEAVING,
                onLogo = { splashLogo = it },
                onStar = openGithub,
                onContinue = {
                    if (animationsOff(context) || splashLogo == null || creditLogo == null) {
                        land()
                    } else {
                        splash = SPLASH_LEAVING
                    }
                },
            )
        }
        val from = splashLogo
        val to = creditLogo
        if (splash == SPLASH_LEAVING && from != null && to != null) {
            GhostFlight(from, to, onLanded = land)
        }
    }
}

private const val SPLASH_SHOWING = 0
private const val SPLASH_LEAVING = 1
private const val SPLASH_DONE = 2

private fun splashStatus(conn: Conn, ready: Boolean): String = when (conn) {
    is Conn.Connecting -> if (ready) "Still connecting to ${conn.name}…" else "Connecting to ${conn.name}…"
    is Conn.Connected -> "Connected to ${conn.name}"
    is Conn.Problem -> if (ready) "Couldn't reach ${conn.name} yet" else "Connecting to ${conn.name}…"
    else -> if (ready) "" else "Getting ready…"
}

/** Animations are turned off in the phone's developer or accessibility settings. */
private fun animationsOff(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

// ---------- Not connected ----------

@Composable
private fun ConnectScreen(
    conn: Conn,
    pairedName: String?,
    onScan: () -> Unit,
    onRetry: () -> Unit,
    onForget: () -> Unit,
    onLog: () -> Unit,
) {
    Column(
        Modifier
            .widthIn(max = 520.dp)
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painter = painterResource(R.drawable.ghost),
            contentDescription = null,
            modifier = Modifier.size(88.dp).clip(RoundedCornerShape(28.dp)),
        )
        Spacer(Modifier.height(16.dp))
        Text("Ghost Remote", style = MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))

        Panel {
            when (conn) {
                is Conn.Connecting -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
                    Spacer(Modifier.height(14.dp))
                    CenteredMessage("Connecting to ${conn.name}…")
                }
                is Conn.Problem -> {
                    CenteredMessage(conn.message)
                    if (conn.retrying) {
                        Spacer(Modifier.height(10.dp))
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            CenteredMessage("Retrying…")
                        }
                    }
                }
                else -> {
                    Text("Connect Your PC", style = MaterialTheme.typography.titleLarge, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                    Spacer(Modifier.height(8.dp))
                    Step(1, "On your PC, open Settings > Remote.")
                    Step(2, "Enable Phone Remote.")
                    Step(3, "Scan the QR code.")
                    Spacer(Modifier.height(6.dp))
                    Instruction("Use the same Wi-Fi on both devices.")
                }
            }
        }

        Spacer(Modifier.height(24.dp))
        Button(onClick = onScan, shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp)) {
            Icon(Icons.Rounded.QrCodeScanner, contentDescription = null)
            Spacer(Modifier.width(10.dp))
            Text("Scan QR Code", style = MaterialTheme.typography.titleMedium)
        }
        if (conn is Conn.Problem && pairedName != null) {
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Icon(Icons.Rounded.Refresh, contentDescription = null)
                Spacer(Modifier.width(10.dp))
                Text("Try Again")
            }
        }
        if (pairedName != null && conn !is Conn.NotPaired) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onForget) { Text("Forget $pairedName") }
        }
        TextButton(onClick = onLog) { Text("Latency Log") }
    }
}

@Composable
private fun Step(n: Int, text: String) {
    Instruction("$n. $text")
}

@Composable
private fun Instruction(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Start,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
    )
}

// ---------- Connected ----------

@Composable
private fun RemoteScreen(
    pcName: String,
    s: PrompterStatus,
    fine: Boolean,
    ping: Stats?,
    vm: RemoteViewModel,
    onScan: () -> Unit,
    onLog: () -> Unit,
) {
    val until by vm.cooldownUntil.collectAsStateWithLifecycle()
    var remaining by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(until) {
        do {
            remaining = ((until - SystemClock.elapsedRealtime()).toFloat() / CONTROL_COOLDOWN_MS).coerceIn(0f, 1f)
            if (remaining > 0f) withFrameNanos { }
        } while (remaining > 0f)
    }
    CompositionLocalProvider(LocalCooldown provides remaining) {
        RemoteControls(pcName, s, fine, ping, vm, onScan, onLog)
    }
}

@Composable
private fun RemoteControls(
    pcName: String,
    s: PrompterStatus,
    fine: Boolean,
    ping: Stats?,
    vm: RemoteViewModel,
    onScan: () -> Unit,
    onLog: () -> Unit,
) {
    var positionTab by rememberSaveable { mutableStateOf(false) }
    val readScroll = rememberScrollState()
    val positionScroll = rememberScrollState()
    Column(
        Modifier
            .widthIn(max = 560.dp)
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(16.dp))
        Header(pcName, ping, onScan, vm::forget, onLog)
        Spacer(Modifier.height(20.dp))
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(5.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            listOf(false to "Read", true to "Position").forEach { (position, title) ->
                val selected = positionTab == position
                Surface(
                    onClick = { positionTab = position },
                    selected = selected,
                    shape = RoundedCornerShape(15.dp),
                    color = if (selected) Ink else Color.Transparent,
                    contentColor = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 14.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (position) Icons.Rounded.CenterFocusStrong else Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(title, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
        Column(
            Modifier.weight(1f).verticalScroll(if (positionTab) positionScroll else readScroll).padding(top = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (positionTab) {
                WindowPanel(fine, vm)
                Panel {
                    ToggleRow("Click-Through", s.clickThrough, vm::setClickThrough)
                }
            } else {
                PlaybackPanel(s, vm)
                SpeedPanel(s, vm)
                ModePanel(s, vm)
            }
        }
    }
}

@Composable
private fun Header(pcName: String, ping: Stats?, onScan: () -> Unit, onForget: () -> Unit, onLog: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.ghost),
            contentDescription = null,
            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Ghost Remote", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(GoGreen))
                Spacer(Modifier.width(6.dp))
                Text(
                    "$pcName · ${ping?.let { "${it.last} ms" } ?: "Connected"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.background(Color.White, CircleShape)) { Icon(Icons.Rounded.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Latency Log") }, onClick = { menu = false; onLog() })
                DropdownMenuItem(text = { Text("Pair a Different PC") }, onClick = { menu = false; onScan() })
                DropdownMenuItem(text = { Text("Forget This PC") }, onClick = { menu = false; onForget() })
            }
        }
    }
}

@Composable
private fun PlaybackPanel(s: PrompterStatus, vm: RemoteViewModel) {
    Panel(color = SoftBlue) {
        val state = when {
            s.counting > 0 -> "Starting in ${s.counting}"
            s.playing -> "Scrolling"
            else -> "Paused"
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Playback", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Surface(color = Color.White, shape = CircleShape) {
                Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).background(if (s.playing) GoGreen else MaterialTheme.colorScheme.tertiary, CircleShape))
                    Spacer(Modifier.width(6.dp))
                    Text(state, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(clock(s.elapsed), style = MaterialTheme.typography.displaySmall, modifier = Modifier.alignByBaseline())
            if (s.remaining >= 0) {
                Spacer(Modifier.width(8.dp))
                Text(
                    "/ ${clock(s.elapsed + s.remaining)} · ${(s.progress * 100).roundToInt()}%",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.alignByBaseline(),
                )
            }
        }
        if (!s.visible) {
            Text("Hidden on PC", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = TextAlign.Center)
        }

        // Scroll position: drag to jump anywhere in the script.
        var dragging by remember { mutableStateOf<Float?>(null) }
        var lastSent by remember { mutableLongStateOf(0L) }
        Slider(
            colors = controlSliderColors(),
            enabled = LocalCooldown.current == 0f,
            value = dragging ?: s.progress,
            onValueChange = { v ->
                dragging = v
                val now = SystemClock.uptimeMillis()
                if (now - lastSent > 120) {
                    lastSent = now
                    vm.seek(v)
                }
            },
            onValueChangeFinished = {
                dragging?.let { vm.seek(it) }
                dragging = null
            },
            modifier = Modifier.semantics { contentDescription = "Scroll position" },
        )

        Spacer(Modifier.height(4.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                BigIcon(Icons.Rounded.KeyboardArrowUp, "Back one line", onClick = vm::backLine)
                Text("Back", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
            }
            val playing = s.playing || s.counting > 0
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(
                    onClick = vm::playPause,
                    enabled = LocalCooldown.current == 0f,
                    shape = CircleShape,
                    color = Ink,
                    contentColor = Color.White,
                    modifier = Modifier.size(88.dp).cooldownBorder(),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                            contentDescription = if (playing) "Pause" else "Play",
                            modifier = Modifier.size(52.dp),
                        )
                    }
                }
                Text(if (playing) "Pause" else "Play", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                BigIcon(Icons.Rounded.KeyboardArrowDown, "Forward one line", onClick = vm::forwardLine)
                Text("Next", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = vm::stop, enabled = LocalCooldown.current == 0f, shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, Color(0xFFCAD5F0)), colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            CooldownIndicator()
            Icon(Icons.Rounded.Stop, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Stop & Rewind")
        }
    }
}

@Composable
private fun SpeedPanel(s: PrompterStatus, vm: RemoteViewModel) {
    Panel {
        var dragging by remember { mutableStateOf<Float?>(null) }
        var lastSent by remember { mutableLongStateOf(0L) }
        val shown = dragging?.roundToInt() ?: s.speed
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Reading Pace", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text("$shown", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            CooldownIcon(Icons.Rounded.Remove, "Slower") { vm.adjustSpeed(-1) }
            Slider(
                colors = controlSliderColors(),
                enabled = LocalCooldown.current == 0f,
                value = dragging ?: s.speed.toFloat(),
                onValueChange = { v ->
                    dragging = v
                    val now = SystemClock.uptimeMillis()
                    if (now - lastSent > 80) {
                        lastSent = now
                        vm.setSpeed(v.roundToInt())
                    }
                },
                onValueChangeFinished = {
                    dragging?.let { vm.setSpeed(it.roundToInt()) }
                    dragging = null
                },
                valueRange = 1f..100f,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp).semantics { contentDescription = "Speed" },
            )
            CooldownIcon(Icons.Rounded.Add, "Faster") { vm.adjustSpeed(1) }
        }
    }
}

@Composable
private fun ModePanel(s: PrompterStatus, vm: RemoteViewModel) {
    Panel {
        Text("Scroll Mode", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(10.dp))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            MODES.forEachIndexed { i, (id, label) ->
                SegmentedButton(
                    enabled = LocalCooldown.current == 0f,
                    selected = s.mode == id,
                    onClick = { vm.setMode(id) },
                    shape = SegmentedButtonDefaults.itemShape(i, MODES.size),
                    colors = SegmentedButtonDefaults.colors(activeContainerColor = Ink, activeContentColor = Color.White, inactiveContainerColor = Color.White),
                    label = { Text(label, fontWeight = FontWeight.Bold) },
                )
            }
        }
    }
}

// Left and right are the PC screen's left and right, so these arrows mustn't flip in right-to-left languages.
@Suppress("DEPRECATION")
@Composable
private fun WindowPanel(fine: Boolean, vm: RemoteViewModel) {
    val move = if (fine) 4 else 24
    val grow = if (fine) 8 else 40
    Panel {
        Text("Prompter Position", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(18.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(SoftBlue).padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CooldownIcon(Icons.Rounded.KeyboardArrowUp, "Move up", big = true) { vm.move(0, -move) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                CooldownIcon(Icons.Rounded.KeyboardArrowLeft, "Move left", big = true) { vm.move(-move, 0) }
                Spacer(Modifier.width(12.dp))
                CooldownIcon(Icons.Rounded.VerticalAlignTop, "Move to the top centre of the screen", big = true, onClick = vm::centre)
                Spacer(Modifier.width(12.dp))
                CooldownIcon(Icons.Rounded.KeyboardArrowRight, "Move right", big = true) { vm.move(move, 0) }
            }
            CooldownIcon(Icons.Rounded.KeyboardArrowDown, "Move down", big = true) { vm.move(0, move) }
        }
        Spacer(Modifier.height(12.dp))
        Button(onClick = vm::middle, enabled = LocalCooldown.current == 0f, shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
            CooldownIndicator()
            Icon(Icons.Rounded.CenterFocusStrong, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Reset to Screen Centre")
        }

        HorizontalDivider(Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
        Text("Window Size", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        SizeRow("Width", { vm.resize(-grow, 0) }, { vm.resize(grow, 0) })
        SizeRow("Height", { vm.resize(0, -grow) }, { vm.resize(0, grow) })

        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
        ToggleRow("Fine Adjustment", fine, vm::setFineSteps)
    }
}

@Composable
private fun SizeRow(label: String, smaller: () -> Unit, bigger: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        CooldownIcon(Icons.Rounded.Remove, "Make it ${if (label == "Width") "narrower" else "shorter"}", onClick = smaller)
        Spacer(Modifier.width(16.dp))
        CooldownIcon(Icons.Rounded.Add, "Make it ${if (label == "Width") "wider" else "taller"}", onClick = bigger)
    }
}

// ---------- Latency log ----------

@Composable
private fun LatencyScreen(vm: RemoteViewModel, onBack: () -> Unit) {
    val log by vm.log.collectAsStateWithLifecycle()
    val ping by vm.pingStats.collectAsStateWithLifecycle()
    val cmds by vm.cmdStats.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val time = remember { SimpleDateFormat("HH:mm:ss.SSS", Locale.US) }
    LazyColumn(
        Modifier.widthIn(max = 560.dp).fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(AutoMirrored.Rounded.ArrowBack, contentDescription = "Back") }
                Text("Latency Log", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            }
        }
        item {
            Panel {
                StatsRow("Network Ping", ping)
                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
                StatsRow("Controls", cmds)
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = {
                        val text = logText(log, ping, cmds, time)
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText("Ghost Remote latency log", text))
                        vm.showMessage("Log copied")
                    }, enabled = log.isNotEmpty()) { Text("Copy Log") }
                    TextButton(onClick = vm::clearLog, enabled = log.isNotEmpty() || ping != null) { Text("Clear") }
                }
            }
        }
        if (log.isEmpty()) {
            item {
                CenteredMessage("No activity yet.")
            }
        }
        items(log) { e ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    time.format(Date(e.at)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(92.dp),
                )
                Text(e.what, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                val ms = e.ms
                Text(
                    if (ms != null) "$ms ms" else if (e.failed) "failed" else "",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = when {
                        e.failed -> MaterialTheme.colorScheme.error
                        ms == null -> MaterialTheme.colorScheme.onSurfaceVariant
                        ms < 60 -> GoGreen
                        ms < 150 -> MaterialTheme.colorScheme.onSurface
                        else -> MaterialTheme.colorScheme.tertiary
                    },
                )
            }
        }
    }
}

@Composable
private fun StatsRow(title: String, st: Stats?) {
    Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    if (st == null) {
        CenteredMessage("No measurements yet.")
        return
    }
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Figure("Last", st.last)
        Figure("Average", st.avg)
        Figure("Best", st.min)
        Figure("95%", st.p95)
        Figure("Worst", st.max)
    }
}

@Composable
private fun Figure(label: String, ms: Long) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$ms", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("$label ms", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun logText(log: List<LogEntry>, ping: Stats?, cmds: Stats?, time: SimpleDateFormat): String = buildString {
    fun stats(name: String, st: Stats?) {
        if (st == null) appendLine("$name: no measurements")
        else appendLine("$name (last ${st.count}): avg ${st.avg} ms, best ${st.min} ms, 95% ${st.p95} ms, worst ${st.max} ms")
    }
    appendLine("Ghost Remote latency log")
    stats("Network ping", ping)
    stats("Controls", cmds)
    appendLine()
    for (e in log.reversed()) {
        val result = e.ms?.let { "$it ms" } ?: if (e.failed) "failed" else ""
        appendLine("${time.format(Date(e.at))}  ${e.what}  $result".trimEnd())
    }
}

// ---------- Building blocks ----------

@Composable
private fun Panel(color: Color = MaterialTheme.colorScheme.surface, content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = color),
        border = BorderStroke(1.dp, if (color == SoftBlue) Color(0xFFDDE5FC) else MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), content = content)
    }
}

@Composable
private fun CenteredMessage(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
    )
}

@Composable
private fun ToggleRow(title: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = LocalCooldown.current == 0f)
    }
}

@Composable
private fun controlSliderColors() = SliderDefaults.colors(
    thumbColor = Ink,
    activeTrackColor = MaterialTheme.colorScheme.primary,
    inactiveTrackColor = Color(0xFF7888A3),
    disabledThumbColor = Ink,
    disabledActiveTrackColor = Color(0xFF526789),
    disabledInactiveTrackColor = Color(0xFF7888A3),
)

@Composable
private fun BigIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    CooldownIcon(icon, label, big = true, onClick = onClick)
}

@Composable
private fun CooldownIcon(icon: ImageVector, label: String, big: Boolean = false, onClick: () -> Unit) {
    FilledTonalIconButton(
        onClick = onClick,
        enabled = LocalCooldown.current == 0f,
        colors = IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = Ink,
            contentColor = Color.White,
            disabledContainerColor = Color(0xFFE0E5EF),
            disabledContentColor = Color(0xFF78849B),
        ),
        modifier = Modifier.size(if (big) 60.dp else 52.dp).cooldownBorder(),
    ) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(if (big) 34.dp else 26.dp))
    }
}

@Composable
private fun Modifier.cooldownBorder(): Modifier {
    val remaining = LocalCooldown.current
    val color = MaterialTheme.colorScheme.primary
    return drawWithContent {
        drawContent()
        if (remaining > 0f) {
            val stroke = 3.dp.toPx()
            drawArc(
                color = color,
                startAngle = -90f,
                sweepAngle = 360f * remaining,
                useCenter = false,
                topLeft = Offset(stroke / 2, stroke / 2),
                size = Size(size.width - stroke, size.height - stroke),
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
private fun CooldownIndicator() {
    if (LocalCooldown.current > 0f) {
        Box(Modifier.size(20.dp).cooldownBorder())
        Spacer(Modifier.width(8.dp))
    }
}

private fun clock(seconds: Double): String {
    if (!seconds.isFinite()) return "--:--"
    val s = seconds.coerceAtLeast(0.0).roundToInt()
    return "%d:%02d".format(s / 60, s % 60)
}
