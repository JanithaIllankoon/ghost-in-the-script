@file:OptIn(ExperimentalMaterial3Api::class)

package app.ghostprompter.remote

import android.os.SystemClock
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.math.roundToInt

private val MODES = listOf(
    Triple("manual", "Fixed", "Scrolls at a steady speed you choose."),
    Triple("voice", "Voice", "Scrolls while you talk, stops when you go quiet."),
    Triple("follow", "Follow", "Listens to your words and keeps your line on the guide."),
)

@Composable
fun RemoteApp(vm: RemoteViewModel, onScan: () -> Unit) {
    val conn by vm.conn.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val fine by vm.fineSteps.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        val m = message ?: return@LaunchedEffect
        vm.clearMessage()
        snackbar.showSnackbar(m)
    }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.TopCenter) {
            when (val c = conn) {
                is Conn.Connected -> RemoteScreen(c.name, status, fine, vm, onScan)
                else -> ConnectScreen(c, vm.pairedName, onScan, vm::retry, vm::forget)
            }
        }
    }
}

// ---------- Not connected ----------

@Composable
private fun ConnectScreen(
    conn: Conn,
    pairedName: String?,
    onScan: () -> Unit,
    onRetry: () -> Unit,
    onForget: () -> Unit,
) {
    Column(
        Modifier
            .widthIn(max = 520.dp)
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painter = painterResource(R.drawable.ghost),
            contentDescription = null,
            modifier = Modifier.size(96.dp).clip(RoundedCornerShape(24.dp)),
        )
        Spacer(Modifier.height(16.dp))
        Text("Ghost Remote", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Text(
            "Control Ghost In The Script from your phone.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))

        Panel {
            when (conn) {
                is Conn.Connecting -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
                    Spacer(Modifier.width(14.dp))
                    Text("Connecting to ${conn.name}…", style = MaterialTheme.typography.bodyLarge)
                }
                is Conn.Problem -> {
                    Text(conn.message, style = MaterialTheme.typography.bodyLarge)
                    if (conn.retrying) {
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text("Still trying…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                else -> {
                    Text("To pair", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    Step(1, "On your PC, open Ghost In The Script, then Settings > Remote.")
                    Step(2, "Turn on Allow a Phone to Control the Prompter. A QR code appears on the prompter.")
                    Step(3, "Tap Scan QR Code below and point your camera at it.")
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Your phone and PC need to be on the same Wi-Fi.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth().height(56.dp)) {
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
    }
}

@Composable
private fun Step(n: Int, text: String) {
    Row(Modifier.padding(vertical = 5.dp)) {
        Box(
            Modifier.size(24.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text("$n", color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.labelLarge)
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

// ---------- Connected ----------

@Composable
private fun RemoteScreen(
    pcName: String,
    s: PrompterStatus,
    fine: Boolean,
    vm: RemoteViewModel,
    onScan: () -> Unit,
) {
    Column(
        Modifier
            .widthIn(max = 560.dp)
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Header(pcName, onScan, vm::forget)
        PlaybackPanel(s, vm)
        SpeedPanel(s, vm)
        ModePanel(s, vm)
        Panel {
            ToggleRow("Show the Prompter", "Hide it when you don't need it on screen.", s.visible, vm::showPrompter)
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
            ToggleRow("Click-Through", "Clicks pass through the prompter to the app underneath.", s.clickThrough, vm::setClickThrough)
        }
        WindowPanel(fine, vm)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun Header(pcName: String, onScan: () -> Unit, onForget: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.ghost),
            contentDescription = null,
            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(pcName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(GoGreen))
                Spacer(Modifier.width(6.dp))
                Text("Connected", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Pair a Different PC") }, onClick = { menu = false; onScan() })
                DropdownMenuItem(text = { Text("Forget This PC") }, onClick = { menu = false; onForget() })
            }
        }
    }
}

@Composable
private fun PlaybackPanel(s: PrompterStatus, vm: RemoteViewModel) {
    Panel {
        val state = when {
            s.counting > 0 -> "Starting in ${s.counting}"
            s.playing -> "Scrolling"
            else -> "Paused"
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(state, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (!s.visible) {
                Text(
                    "Prompter hidden",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.tertiary,
                )
            }
        }
        Text(
            if (s.remaining >= 0) "${clock(s.elapsed)} / ${clock(s.elapsed + s.remaining)}" else clock(s.elapsed),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // Scroll position: drag to jump anywhere in the script.
        var dragging by remember { mutableStateOf<Float?>(null) }
        var lastSent by remember { mutableLongStateOf(0L) }
        Slider(
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
            BigIcon(Icons.Rounded.KeyboardArrowUp, "Back one line", onClick = vm::backLine)
            val playing = s.playing || s.counting > 0
            Surface(
                onClick = vm::playPause,
                shape = CircleShape,
                color = if (playing) MaterialTheme.colorScheme.primary else GoGreen,
                contentColor = Color.White,
                modifier = Modifier.size(96.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playing) "Pause" else "Play",
                        modifier = Modifier.size(52.dp),
                    )
                }
            }
            BigIcon(Icons.Rounded.KeyboardArrowDown, "Forward one line", onClick = vm::forwardLine)
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = vm::stop, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Icon(Icons.Rounded.Stop, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Stop and Go Back to the Start")
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
            Text("Speed", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text("$shown", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            RepeatIcon(Icons.Rounded.Remove, "Slower") { vm.setSpeed(vm.status.value.speed - 1) }
            Slider(
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
            RepeatIcon(Icons.Rounded.Add, "Faster") { vm.setSpeed(vm.status.value.speed + 1) }
        }
        if (s.mode == "follow") {
            Hint("Follow My Voice keeps pace with you, so speed doesn't apply in this mode.")
        }
    }
}

@Composable
private fun ModePanel(s: PrompterStatus, vm: RemoteViewModel) {
    Panel {
        Text("Scroll Mode", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            MODES.forEachIndexed { i, (id, label, _) ->
                SegmentedButton(
                    selected = s.mode == id,
                    onClick = { vm.setMode(id) },
                    shape = SegmentedButtonDefaults.itemShape(i, MODES.size),
                    label = { Text(label) },
                )
            }
        }
        MODES.firstOrNull { it.first == s.mode }?.let { Hint(it.third) }
    }
}

// Left and right are the PC screen's left and right, so these arrows mustn't flip in right-to-left languages.
@Suppress("DEPRECATION")
@Composable
private fun WindowPanel(fine: Boolean, vm: RemoteViewModel) {
    val move = if (fine) 4 else 24
    val grow = if (fine) 8 else 40
    Panel {
        Text("Prompter Position", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Hint("Hold an arrow to keep moving.")
        Spacer(Modifier.height(8.dp))
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            RepeatIcon(Icons.Rounded.KeyboardArrowUp, "Move up", big = true) { vm.move(0, -move) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                RepeatIcon(Icons.Rounded.KeyboardArrowLeft, "Move left", big = true) { vm.move(-move, 0) }
                Spacer(Modifier.width(12.dp))
                FilledTonalIconButton(onClick = vm::centre, modifier = Modifier.size(64.dp)) {
                    Icon(Icons.Rounded.VerticalAlignTop, contentDescription = "Move to the top centre of the screen")
                }
                Spacer(Modifier.width(12.dp))
                RepeatIcon(Icons.Rounded.KeyboardArrowRight, "Move right", big = true) { vm.move(move, 0) }
            }
            RepeatIcon(Icons.Rounded.KeyboardArrowDown, "Move down", big = true) { vm.move(0, move) }
        }
        Hint("The middle button puts the prompter at the top centre, under a typical webcam.", center = true)

        HorizontalDivider(Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
        Text("Prompter Size", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        SizeRow("Width", { vm.resize(-grow, 0) }, { vm.resize(grow, 0) })
        SizeRow("Height", { vm.resize(0, -grow) }, { vm.resize(0, grow) })

        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
        ToggleRow("Small Steps", "For fine adjustments.", fine, vm::setFineSteps)
    }
}

@Composable
private fun SizeRow(label: String, smaller: () -> Unit, bigger: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        RepeatIcon(Icons.Rounded.Remove, "Make it ${if (label == "Width") "narrower" else "shorter"}", onRepeat = smaller)
        Spacer(Modifier.width(16.dp))
        RepeatIcon(Icons.Rounded.Add, "Make it ${if (label == "Width") "wider" else "taller"}", onRepeat = bigger)
    }
}

// ---------- Building blocks ----------

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), content = content)
    }
}

@Composable
private fun Hint(text: String, center: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = if (center) TextAlign.Center else TextAlign.Start,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
    )
}

@Composable
private fun ToggleRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun BigIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    FilledTonalIconButton(onClick = onClick, modifier = Modifier.size(64.dp)) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(34.dp))
    }
}

/** A button that acts once when tapped and keeps acting while it's held down. */
@Composable
private fun RepeatIcon(icon: ImageVector, label: String, big: Boolean = false, onRepeat: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val action by rememberUpdatedState(onRepeat)
    var repeated by remember { mutableStateOf(false) }
    LaunchedEffect(pressed) {
        if (!pressed) return@LaunchedEffect
        repeated = false
        delay(400)
        while (isActive) {
            repeated = true
            action()
            delay(70)
        }
    }
    FilledTonalIconButton(
        // A plain tap; a hold has already acted while it was down.
        onClick = { if (!repeated) action(); repeated = false },
        interactionSource = interaction,
        modifier = Modifier.size(if (big) 64.dp else 52.dp),
    ) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(if (big) 34.dp else 26.dp))
    }
}

private fun clock(seconds: Double): String {
    if (!seconds.isFinite()) return "--:--"
    val s = seconds.coerceAtLeast(0.0).roundToInt()
    return "%d:%02d".format(s / 60, s % 60)
}
