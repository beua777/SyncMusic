package com.syncmusic.companion

import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** 앱 설정과 페어링 정보 (앱 전용 저장소라 다른 앱은 읽을 수 없음) */
class Prefs(context: Context) {
    private val app = context.applicationContext
    private val sp = app.getSharedPreferences("syncmusic", Context.MODE_PRIVATE)

    val deviceId: String
        get() = sp.getString("deviceId", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("deviceId", it).apply() }

    /** "Galaxy S24"처럼 설정 → 휴대전화 정보에 보이는 이름 */
    val deviceName: String
        get() = runCatching { Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
            ?.takeIf { it.isNotBlank() } ?: Build.MODEL ?: "Android"

    var pcId: String?
        get() = sp.getString("pcId", null)
        set(v) = sp.edit().putString("pcId", v).apply()

    var pcName: String?
        get() = sp.getString("pcName", null)
        set(v) = sp.edit().putString("pcName", v).apply()

    var pcHost: String?
        get() = sp.getString("pcHost", null)
        set(v) = sp.edit().putString("pcHost", v).apply()

    var pcPort: Int
        get() = sp.getInt("pcPort", DEFAULT_SYNC_PORT)
        set(v) = sp.edit().putInt("pcPort", v).apply()

    /** 공유기가 브로드캐스트를 막을 때 직접 입력한 주소 ("192.168.0.10" 또는 "192.168.0.10:47811") */
    var manualHost: String?
        get() = sp.getString("manualHost", null)
        set(v) = sp.edit().putString("manualHost", v).apply()

    var secret: ByteArray?
        get() = sp.getString("secret", null)?.let { SyncCrypto.unb64(it) }
        set(v) = sp.edit().putString("secret", v?.let { SyncCrypto.b64(it) }).apply()

    var playlistTreeUri: Uri?
        get() = sp.getString("playlistTree", null)?.let(Uri::parse)
        set(v) = sp.edit().putString("playlistTree", v?.toString()).apply()

    var autoSync: Boolean
        get() = sp.getBoolean("autoSync", true)
        set(v) = sp.edit().putBoolean("autoSync", v).apply()

    var lastSyncAt: Long
        get() = sp.getLong("lastSyncAt", 0)
        set(v) = sp.edit().putLong("lastSyncAt", v).apply()

    var lastSummary: String?
        get() = sp.getString("lastSummary", null)
        set(v) = sp.edit().putString("lastSummary", v).apply()

    var lastError: String?
        get() = sp.getString("lastError", null)
        set(v) = sp.edit().putString("lastError", v).apply()

    val isPaired: Boolean get() = pcId != null && secret != null

    /** 우리가 삼성 뮤직 폴더에 쓴 파일 이름 → 쓴 내용의 SHA-256 (그대로면 삼성 뮤직이 아직 손대지 않은 것) */
    fun written(): MutableMap<String, String> {
        val j = JSONObject(sp.getString("written", "{}") ?: "{}")
        return j.keys().asSequence().associateWith { j.getString(it) }.toMutableMap()
    }

    fun saveWritten(map: Map<String, String>) = sp.edit().putString("written", JSONObject(map).toString()).apply()

    fun log(): List<String> {
        val a = JSONArray(sp.getString("log", "[]") ?: "[]")
        return List(a.length()) { a.getString(it) }
    }

    fun addLog(line: String) {
        val lines = (log() + line).takeLast(40)
        sp.edit().putString("log", JSONArray(lines).toString()).apply()
    }

    fun forgetPc() {
        sp.edit().remove("pcId").remove("pcName").remove("pcHost").remove("secret").remove("written").apply()
    }

    companion object {
        const val DEFAULT_SYNC_PORT = 47811
        const val DISCOVERY_PORT = 47812
    }
}
