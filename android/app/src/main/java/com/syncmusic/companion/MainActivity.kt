package com.syncmusic.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var tvProgress: TextView

    private val pickFolder = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> uri?.let(::onFolderPicked) }
    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        tvProgress = findViewById(R.id.tvProgress)

        findViewById<Button>(R.id.btnSyncNow).setOnClickListener { syncNow() }
        findViewById<Button>(R.id.btnPair).apply {
            setOnClickListener { startPairing() }
            setOnLongClickListener {
                confirmForget()
                true
            }
        }
        findViewById<Button>(R.id.btnPickFolder).setOnClickListener { pickFolder.launch(initialMusicUri()) }
        findViewById<Button>(R.id.btnOpenSamsung).setOnClickListener { openSamsungMusic() }
        findViewById<Button>(R.id.btnGrant).setOnClickListener { askPermissions.launch(missingPermissions().toTypedArray()) }
        findViewById<Button>(R.id.btnListener).setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        findViewById<Button>(R.id.btnBattery).setOnClickListener { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        findViewById<Button>(R.id.btnSendNowPlaying).setOnClickListener { sendNowPlaying() }
        findViewById<MaterialSwitch>(R.id.swAuto).apply {
            isChecked = prefs.autoSync
            setOnCheckedChangeListener { _, on ->
                prefs.autoSync = on
                if (on) SyncWorker.schedulePeriodic(this@MainActivity) else SyncWorker.cancelPeriodic(this@MainActivity)
            }
        }

        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData(SyncWorker.ONCE).observe(this) { infos ->
            onWork(infos.firstOrNull())
        }
        if (missingPermissions().isNotEmpty()) askPermissions.launch(missingPermissions().toTypedArray())
    }

    override fun onResume() {
        super.onResume()
        refresh()
        // 앱을 열면 바로 한 번 동기화 (같은 Wi-Fi에 PC가 있을 때)
        if (prefs.isPaired && SyncEngine.hasMediaPermission(this)) SyncWorker.runNow(this)
    }

    // ───── 화면 ─────

    private fun refresh() {
        findViewById<TextView>(R.id.tvPcStatus).text =
            if (prefs.isPaired) "${prefs.pcName} · ${prefs.pcHost ?: "주소 찾는 중"}:${prefs.pcPort}" else "연결된 PC가 없어요. 'PC 연결'을 눌러 주세요"
        val last = if (prefs.lastSyncAt > 0) {
            "마지막 동기화 ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(prefs.lastSyncAt))} · ${prefs.lastSummary.orEmpty()}"
        } else {
            "아직 동기화 전"
        }
        findViewById<TextView>(R.id.tvLastSync).text = prefs.lastError?.let { "$last\n최근 문제: $it" } ?: last
        findViewById<TextView>(R.id.tvFolder).text =
            prefs.playlistTreeUri?.let { PlaylistFolder(this, it).displayPath } ?: "선택 안 함 (곡만 맞추고 재생목록은 건너뛰어요)"
        val perms = buildString {
            append("음악 파일: ").append(if (SyncEngine.hasMediaPermission(this@MainActivity)) "허용됨" else "필요해요").append('\n')
            if (Build.VERSION.SDK_INT >= 33) append("알림: ").append(if (granted(Manifest.permission.POST_NOTIFICATIONS)) "허용됨" else "꺼짐").append('\n')
            append("이어듣기(알림 접근): ").append(if (NowPlaying.hasAccess(this@MainActivity)) "허용됨" else "꺼짐 (선택)")
        }
        findViewById<TextView>(R.id.tvPerms).text = perms
        findViewById<View>(R.id.btnGrant).visibility = if (missingPermissions().isEmpty()) View.GONE else View.VISIBLE
        findViewById<TextView>(R.id.tvLog).text = prefs.log().asReversed().joinToString("\n").ifEmpty { "아직 기록이 없어요" }
    }

    private fun onWork(info: WorkInfo?) {
        if (info == null) return
        when (info.state) {
            WorkInfo.State.RUNNING -> tvProgress.text = info.progress.getString(SyncWorker.KEY_MSG) ?: "동기화하는 중…"
            WorkInfo.State.ENQUEUED -> tvProgress.text = "같은 Wi-Fi를 기다리는 중…"
            WorkInfo.State.SUCCEEDED -> {
                tvProgress.text = info.outputData.getString(SyncWorker.KEY_MSG).orEmpty()
                refresh()
            }
            WorkInfo.State.FAILED -> {
                tvProgress.text = info.outputData.getString(SyncWorker.KEY_MSG) ?: "동기화하지 못했어요"
                refresh()
            }
            else -> Unit
        }
    }

    // ───── 동작 ─────

    private fun syncNow() {
        when {
            !prefs.isPaired -> startPairing()
            !SyncEngine.hasMediaPermission(this) -> askPermissions.launch(missingPermissions().toTypedArray())
            else -> {
                SyncWorker.runNow(this)
                toast("동기화를 시작해요")
            }
        }
    }

    private fun startPairing() {
        tvProgress.text = "같은 Wi-Fi에서 PC를 찾는 중…"
        lifecycleScope.launch {
            val found = withContext(Dispatchers.IO) { Discovery.find(this@MainActivity) }
            tvProgress.text = ""
            if (found != null) askCode(found.host, found.port, found.pcName) else askManualAddress()
        }
    }

    private fun askManualAddress() {
        val input = EditText(this).apply {
            hint = "예: 192.168.0.10"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.manualHost.orEmpty())
        }
        MaterialAlertDialogBuilder(this)
            .setTitle("PC를 찾지 못했어요")
            .setMessage("폰과 PC가 같은 Wi-Fi인지, PC에서 SyncMusic이 켜져 있는지 확인하세요. 공유기가 기기끼리 통신을 막고 있으면 PC 설정 화면에 보이는 주소를 직접 입력하세요.")
            .setView(padded(input))
            .setPositiveButton("연결") { _, _ ->
                val text = input.text.toString().trim()
                val host = text.substringBefore(':')
                val port = text.substringAfter(':', "").toIntOrNull() ?: Prefs.DEFAULT_SYNC_PORT
                prefs.manualHost = text
                lifecycleScope.launch {
                    val hello = withContext(Dispatchers.IO) { runCatching { PcClient(host, port, prefs.deviceId, null).hello() }.getOrNull() }
                    if (hello == null) toast("$text 에 연결할 수 없어요") else askCode(host, port, hello.optString("pcName", "PC"))
                }
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun askCode(host: String, port: Int, pcName: String) {
        val input = EditText(this).apply {
            hint = "6자리 코드"
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(6))
        }
        MaterialAlertDialogBuilder(this)
            .setTitle("$pcName 에 연결")
            .setMessage("PC의 SyncMusic → 설정 → '새 휴대폰 연결'에 보이는 6자리 코드를 입력하세요.")
            .setView(padded(input))
            .setPositiveButton("연결") { _, _ ->
                val code = input.text.toString().filter(Char::isDigit)
                lifecycleScope.launch {
                    tvProgress.text = "연결하는 중…"
                    val result = withContext(Dispatchers.IO) {
                        runCatching { PcClient(host, port, prefs.deviceId, null).pair(code, prefs.deviceName) }
                    }
                    tvProgress.text = ""
                    result.onSuccess { p ->
                        prefs.pcId = p.pcId
                        prefs.pcName = p.pcName
                        prefs.pcHost = host
                        prefs.pcPort = port
                        prefs.secret = p.secret
                        prefs.saveWritten(emptyMap())
                        prefs.addLog("${p.pcName}와 연결됨")
                        toast("${p.pcName}와 연결됐어요")
                        refresh()
                        if (SyncEngine.hasMediaPermission(this@MainActivity)) SyncWorker.runNow(this@MainActivity)
                    }
                    result.onFailure { e -> toast(e.message ?: "연결하지 못했어요") }
                }
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun confirmForget() {
        if (!prefs.isPaired) return
        MaterialAlertDialogBuilder(this)
            .setTitle("PC 연결 해제")
            .setMessage("${prefs.pcName}와의 연결을 지울까요? 폰의 음악과 재생목록은 그대로 남아요.")
            .setPositiveButton("해제") { _, _ ->
                prefs.forgetPc()
                refresh()
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun onFolderPicked(uri: Uri) {
        contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        prefs.playlistTreeUri = uri
        prefs.saveWritten(emptyMap())
        refresh()
        toast("재생목록 폴더를 정했어요")
        if (prefs.isPaired) SyncWorker.runNow(this)
    }

    private fun sendNowPlaying() {
        if (!NowPlaying.hasAccess(this)) {
            toast("먼저 '이어듣기 허용'에서 SyncMusic을 켜 주세요")
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            return
        }
        lifecycleScope.launch {
            val msg = withContext(Dispatchers.IO) {
                runCatching {
                    val tracks = if (SyncEngine.hasMediaPermission(this@MainActivity)) MusicScanner(this@MainActivity).scan() else null
                    val info = NowPlaying.read(this@MainActivity, tracks) ?: return@runCatching "삼성 뮤직에서 재생 중인 곡이 없어요"
                    SyncEngine(this@MainActivity).connect().postJson("/sync/nowplaying", info)
                    "PC로 보냈어요. PC 화면에서 '이어 듣기'를 누르세요"
                }.getOrElse { it.message ?: "보내지 못했어요" }
            }
            toast(msg)
        }
    }

    private fun openSamsungMusic() {
        val launch = packageManager.getLaunchIntentForPackage(NowPlaying.SAMSUNG_MUSIC)
        if (launch != null) startActivity(launch) else toast("삼성 뮤직이 설치되어 있지 않아요")
    }

    // ───── 도우미 ─────

    private fun initialMusicUri(): Uri = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Music")

    private fun missingPermissions(): List<String> {
        val wanted = if (Build.VERSION.SDK_INT >= 33) {
            listOf(Manifest.permission.READ_MEDIA_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
        } else {
            listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        return wanted.filterNot(::granted)
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun padded(view: View): View {
        val pad = (20 * resources.displayMetrics.density).toInt()
        return FrameLayout(this).apply {
            setPadding(pad, pad / 2, pad, 0)
            addView(view)
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
