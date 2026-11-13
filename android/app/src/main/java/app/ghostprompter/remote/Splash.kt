package app.ghostprompter.remote

// Start screen, like the desktop app's: credits the author, asks for a GitHub star, then the
// logo floats like a ghost into the credit badge at the bottom of the app.

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

const val AUTHOR = "Janitha Illankoon"
const val REPO_URL = "https://github.com/JanithaIllankoon/ghost-in-the-script"

/** The desktop app's star yellow. */
val StarYellow = Color(0xFFF0B323)

private val SplashLogoShape = RoundedCornerShape(27.dp)

@Composable
fun Splash(
    status: String,
    ready: Boolean,
    leaving: Boolean,
    onLogo: (Rect) -> Unit,
    onStar: () -> Unit,
    onContinue: () -> Unit,
) {
    val fade by animateFloatAsState(if (leaving) 0f else 1f, tween(600), label = "splash fade")
    Box(
        Modifier
            .fillMaxSize()
            .graphicsLayer { alpha = fade }
            .background(MaterialTheme.colorScheme.background)
            // Nothing underneath can be tapped while the start screen is up.
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) awaitPointerEvent()
                }
            }
            .systemBarsPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 520.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.ghost),
                contentDescription = null,
                modifier = Modifier
                    .size(120.dp)
                    .onGloballyPositioned { onLogo(it.boundsInRoot()) }
                    // During the flight the moving copy takes its place.
                    .alpha(if (leaving) 0f else 1f)
                    .clip(SplashLogoShape),
            )
            Spacer(Modifier.height(24.dp))
            Text("Ghost Remote", style = MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
            Spacer(Modifier.height(4.dp))
            Text(
                buildAnnotatedString {
                    append("Made by ")
                    withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)) { append(AUTHOR) }
                },
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Medium, fontSize = 20.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(20.dp))
            Text(
                "If it saves you a retake, a star on GitHub helps other presenters find it.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 340.dp),
            )
            Spacer(Modifier.height(28.dp))
            OutlinedButton(
                onClick = onStar,
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(1.dp, Color(0xFFCAD5F0)),
                colors = ButtonDefaults.outlinedButtonColors(containerColor = Color.White, contentColor = Ink),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            ) {
                Icon(Icons.Rounded.Star, contentDescription = null, tint = StarYellow)
                Spacer(Modifier.width(10.dp))
                Text("Star on GitHub", style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onContinue,
                enabled = ready && !leaving,
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp),
            ) {
                Text("Continue to the App", style = MaterialTheme.typography.titleMedium)
            }
            Text(
                status,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().heightIn(min = 22.dp).padding(top = 18.dp),
            )
        }
    }
}

/** Made by, with a star that opens the project on GitHub. [pop] makes the star glow once each time it goes up. */
@Composable
fun CreditBadge(logoVisible: Boolean, pop: Int, onLogo: (Rect) -> Unit, onStar: () -> Unit) {
    Row(
        Modifier
            .widthIn(max = 560.dp)
            .fillMaxWidth()
            .padding(start = 24.dp, end = 12.dp, top = 6.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Image(
            painter = painterResource(R.drawable.ghost),
            contentDescription = null,
            modifier = Modifier
                .size(30.dp)
                .onGloballyPositioned { onLogo(it.boundsInRoot()) }
                .alpha(if (logoVisible) 1f else 0f)
                .clip(RoundedCornerShape(8.dp)),
        )
        Column(Modifier.weight(1f)) {
            Text("Made by", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(AUTHOR, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        // After the start screen the star glows yellow for a moment, like on the PC.
        val glowTime = remember { Animatable(1f) }
        LaunchedEffect(pop) {
            if (pop == 0) return@LaunchedEffect
            glowTime.snapTo(0f)
            glowTime.animateTo(1f, tween(1300, easing = LinearEasing))
        }
        IconButton(onClick = onStar) {
            Icon(
                Icons.Rounded.Star,
                contentDescription = "Star Ghost In The Script on GitHub",
                tint = StarYellow,
                modifier = Modifier.drawBehind {
                    // Up to full glow at 35%, then fading out, eased both ways.
                    val k = glowTime.value
                    val g = FastOutSlowInEasing.transform(if (k < 0.35f) k / 0.35f else (1 - k) / 0.65f)
                    if (k < 1f && g > 0f) {
                        drawCircle(
                            Brush.radialGradient(
                                listOf(StarYellow.copy(alpha = 0.75f * g), StarYellow.copy(alpha = 0f)),
                                center = center,
                                radius = size.minDimension * 1.1f,
                            ),
                            radius = size.minDimension * 1.1f,
                        )
                    }
                },
            )
        }
    }
}

/**
 * The splash logo drifting into the credit badge: an upward arc with a side-to-side sway that
 * settles as it lands, and a little transparency mid-flight, the way a ghost would wander off.
 */
@Composable
fun GhostFlight(from: Rect, to: Rect, onLanded: () -> Unit) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        t.animateTo(1f, tween(1500, easing = LinearEasing))
        onLanded()
    }
    val density = LocalDensity.current
    val dx = to.center.x - from.center.x
    val dy = to.center.y - from.center.y
    val endScale = to.width / from.width
    Box(Modifier.fillMaxSize()) {
        Image(
            painter = painterResource(R.drawable.ghost),
            contentDescription = null,
            modifier = Modifier
                .size(with(density) { from.width.toDp() }, with(density) { from.height.toDp() })
                .graphicsLayer {
                    val k = t.value
                    val p = if (k < 0.5f) 4 * k * k * k else 1 - (-2 * k + 2).pow(3) / 2
                    val fade = 1 - k
                    val sway = sin(k * PI.toFloat() * 3) * 46.dp.toPx() * fade
                    val lift = -sin(k * PI.toFloat()) * 120.dp.toPx()
                    val bob = sin(k * PI.toFloat() * 5) * 8.dp.toPx() * fade
                    val s = 1 + (endScale - 1) * p
                    translationX = from.left + dx * p + sway
                    translationY = from.top + dy * p + lift + bob
                    scaleX = s
                    scaleY = s
                    rotationZ = sin(k * PI.toFloat() * 3) * 9 * fade
                    alpha = 1 - 0.4f * sin(k * PI.toFloat())
                    shape = SplashLogoShape
                    clip = true
                },
        )
    }
}
