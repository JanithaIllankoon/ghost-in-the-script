package app.ghostprompter.remote

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: RemoteViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.WHITE),
        )
        // A ghostremote:// link (the PC's QR code scanned with the camera app) pairs straight away.
        if (savedInstanceState == null) handleLink(intent)
        setContent {
            GhostTheme {
                RemoteApp(vm = vm, onScan = ::scan)
            }
        }
        // Keep the screen on while connected, so the remote is ready mid-recording.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                vm.conn.collect { c ->
                    if (c is Conn.Connected) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    override fun onStart() {
        super.onStart()
        vm.onStart()
    }

    override fun onStop() {
        super.onStop()
        // Turning the phone doesn't need to drop the connection.
        if (!isChangingConfigurations) vm.onStop()
    }

    private fun handleLink(intent: Intent?) {
        val link = intent?.dataString ?: return
        if (!vm.onScanned(link)) vm.showMessage("That link isn't a Ghost In The Script pairing code.")
    }

    private fun scan() {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { code ->
                if (!vm.onScanned(code.rawValue)) {
                    vm.showMessage("That QR code isn't from Ghost In The Script. On the PC, open Settings > Remote to show the right one.")
                }
            }
            .addOnFailureListener { e ->
                vm.showMessage("The scanner couldn't start: ${e.localizedMessage ?: "unknown problem"}. It needs Google Play services.")
            }
    }
}
