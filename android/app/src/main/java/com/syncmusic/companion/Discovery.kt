package com.syncmusic.companion

import android.content.Context
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import org.json.JSONException
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.nio.ByteBuffer

/** 같은 Wi-Fi의 PC 찾기: UDP 브로드캐스트를 보내면 PC가 주소를 답한다 (docs/PLAN.md 6.1) */
object Discovery {
    data class Found(val host: String, val port: Int, val pcId: String, val pcName: String)

    fun find(context: Context, timeoutMs: Long = 2500, wantPcId: String? = null): Found? {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val lock = wifi.createMulticastLock("syncmusic").apply { setReferenceCounted(false) }
        runCatching { lock.acquire() }
        try {
            DatagramSocket().use { sock ->
                sock.broadcast = true
                sock.soTimeout = 300
                val msg = JSONObject().put("t", "discover").put("app", "SyncMusic").put("v", 1).toString().toByteArray(Charsets.UTF_8)
                val targets = (broadcastAddresses(context) + InetAddress.getByName("255.255.255.255")).distinct()
                val buf = ByteArray(2048)
                val deadline = System.currentTimeMillis() + timeoutMs
                var nextSend = 0L
                while (System.currentTimeMillis() < deadline) {
                    if (System.currentTimeMillis() >= nextSend) {
                        for (a in targets) runCatching { sock.send(DatagramPacket(msg, msg.size, a, Prefs.DISCOVERY_PORT)) }
                        nextSend = System.currentTimeMillis() + 700
                    }
                    try {
                        val p = DatagramPacket(buf, buf.size)
                        sock.receive(p)
                        val j = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
                        if (j.optString("t") != "here" || j.optString("app") != "SyncMusic") continue
                        val host = p.address.hostAddress ?: continue
                        val found = Found(host, j.optInt("port", Prefs.DEFAULT_SYNC_PORT), j.optString("pcId"), j.optString("pcName", "PC"))
                        if (wantPcId == null || found.pcId == wantPcId) return found
                    } catch (_: SocketTimeoutException) {
                        // 다시 보내고 기다림
                    } catch (_: JSONException) {
                        // 다른 프로그램의 패킷
                    }
                }
            }
        } finally {
            runCatching { lock.release() }
        }
        return null
    }

    /** 지금 Wi-Fi의 방송 주소 (예: 192.168.0.255). 255.255.255.255를 막는 공유기가 있어서 같이 보낸다 */
    private fun broadcastAddresses(context: Context): List<InetAddress> {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return emptyList()
        val network = cm.activeNetwork ?: return emptyList()
        val lp = cm.getLinkProperties(network) ?: return emptyList()
        return lp.linkAddresses.mapNotNull { la ->
            val a = la.address as? Inet4Address ?: return@mapNotNull null
            val ip = ByteBuffer.wrap(a.address).int
            val mask = if (la.prefixLength == 0) 0 else -1 shl (32 - la.prefixLength)
            InetAddress.getByAddress(ByteBuffer.allocate(4).putInt(ip or mask.inv()).array())
        }
    }
}
