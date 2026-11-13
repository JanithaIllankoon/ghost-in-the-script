package app.ghostprompter.remote

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Ink = Color(0xFF17223B)
val GoGreen = Color(0xFF167151)
val SoftBlue = Color(0xFFECF1FF)

private val Light = lightColorScheme(
    primary = Color(0xFF315CE8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE8EEFF),
    onPrimaryContainer = Ink,
    secondary = Ink,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFEDF0F6),
    onSecondaryContainer = Ink,
    tertiary = Color(0xFF926019),
    tertiaryContainer = Color(0xFFFFF1D5),
    onTertiaryContainer = Color(0xFF704B13),
    background = Color(0xFFF6F5F2),
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF0F2F7),
    onSurfaceVariant = Color(0xFF606A7C),
    surfaceContainer = Color.White,
    surfaceContainerHigh = Color(0xFFF0F2F7),
    surfaceContainerHighest = Color(0xFFE6EAF2),
    outline = Color(0xFFADB6C6),
    outlineVariant = Color(0xFFE5E8EE),
    error = Color(0xFFBA3347),
)

private fun type(size: Int, height: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = height.sp,
)

private val Type = Typography(
    displaySmall = type(44, 50, FontWeight.ExtraBold).copy(letterSpacing = (-2).sp),
    headlineLarge = type(32, 38, FontWeight.ExtraBold).copy(letterSpacing = (-1).sp),
    headlineMedium = type(28, 34, FontWeight.ExtraBold),
    headlineSmall = type(24, 30, FontWeight.Bold),
    titleLarge = type(22, 28, FontWeight.Bold),
    titleMedium = type(17, 24, FontWeight.Bold),
    titleSmall = type(14, 20, FontWeight.Bold),
    bodyLarge = type(16, 24),
    bodyMedium = type(14, 21),
    bodySmall = type(12, 18),
    labelLarge = type(14, 20, FontWeight.Bold),
    labelMedium = type(12, 16, FontWeight.Bold),
    labelSmall = type(11, 16, FontWeight.Bold).copy(letterSpacing = 1.sp),
)

@Composable
fun GhostTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Light, typography = Type, content = content)
}
