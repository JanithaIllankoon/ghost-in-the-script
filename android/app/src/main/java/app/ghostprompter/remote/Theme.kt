package app.ghostprompter.remote

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The desktop app's colours: navy dark, white light, a blue accent from the logo, green for go.
private val Dark = darkColorScheme(
    primary = Color(0xFF3D78E7),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF1B3366),
    onPrimaryContainer = Color(0xFFDCE6FF),
    secondaryContainer = Color(0xFF1B2A4A),
    onSecondaryContainer = Color(0xFFEAF0FC),
    tertiary = Color(0xFFE9B75F),
    background = Color(0xFF0B1224),
    onBackground = Color(0xFFEAF0FC),
    surface = Color(0xFF101B31),
    onSurface = Color(0xFFEAF0FC),
    surfaceVariant = Color(0xFF1A2741),
    onSurfaceVariant = Color(0xFFB5C3DA),
    surfaceContainerHighest = Color(0xFF1A2741),
    outline = Color(0xFF3A4A68),
    outlineVariant = Color(0xFF29364E),
    error = Color(0xFFFF9CA9),
)

private val Light = lightColorScheme(
    primary = Color(0xFF2463D4),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDCE6FB),
    onPrimaryContainer = Color(0xFF0E3A8C),
    secondaryContainer = Color(0xFFE3ECFB),
    onSecondaryContainer = Color(0xFF1953BD),
    tertiary = Color(0xFF91641C),
    background = Color(0xFFF7F9FC),
    onBackground = Color(0xFF202B42),
    surface = Color.White,
    onSurface = Color(0xFF202B42),
    surfaceVariant = Color(0xFFEEF2F8),
    onSurfaceVariant = Color(0xFF52617A),
    surfaceContainerHighest = Color(0xFFEEF2F8),
    outline = Color(0xFFC9D2E0),
    outlineVariant = Color(0xFFE0E6EF),
    error = Color(0xFFB9384C),
)

/** Green for Play, like the desktop app's Start Prompting button. */
val GoGreen = Color(0xFF1F8A5B)

@Composable
fun GhostTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
