package com.syncmusic.companion

import android.content.ContentResolver
import android.net.Uri
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.source
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class PcException(message: String, val status: Int = 0) : IOException(message)

/** PC 동기화 서버와 통신. hello·pair 말고는 모두 서명하고, PC 응답의 서명도 확인한다 */
class PcClient(val host: String, val port: Int, private val deviceId: String, private val secret: ByteArray?) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build()

    private val jsonType: MediaType = "application/json; charset=utf-8".toMediaType()
    private val binType: MediaType = "application/octet-stream".toMediaType()

    private fun url(path: String) = "http://$host:$port$path"

    fun hello(): JSONObject {
        val req = Request.Builder().url(url("/sync/hello")).get().build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw PcException("PC 응답 오류 (${res.code})", res.code)
            return JSONObject(res.body?.string().orEmpty())
        }
    }

    class Paired(val pcId: String, val pcName: String, val secret: ByteArray)

    /** 6자리 코드 + ECDH로 비밀키 만들기 (docs/PLAN.md 6.2) */
    fun pair(code: String, deviceName: String): Paired {
        val keyPair = SyncCrypto.newKeyPair()
        val phonePub = SyncCrypto.b64(SyncCrypto.encodePublic(keyPair.public))
        val body = JSONObject()
            .put("deviceId", deviceId)
            .put("deviceName", deviceName)
            .put("phonePub", phonePub)
            .put("proof", SyncCrypto.pairProof(code, "pair1", deviceId, phonePub))
        val req = Request.Builder().url(url("/sync/pair")).post(body.toString().toRequestBody(jsonType)).build()
        http.newCall(req).execute().use { res ->
            val j = runCatching { JSONObject(res.body?.string().orEmpty()) }.getOrElse { JSONObject() }
            if (!res.isSuccessful) throw PcException(j.optString("error").ifEmpty { "연결하지 못했어요 (${res.code})" }, res.code)
            val pcId = j.getString("pcId")
            val pcPub = j.getString("pcPub")
            if (!SyncCrypto.safeEquals(SyncCrypto.pairProof(code, "pair1-ok", pcId, pcPub, phonePub), j.getString("proof"))) {
                throw PcException("PC를 확인하지 못했어요. 코드를 다시 확인해 주세요")
            }
            val shared = SyncCrypto.ecdh(keyPair.private, SyncCrypto.decodePublic(SyncCrypto.unb64(pcPub)))
            return Paired(pcId, j.optString("pcName", "PC"), SyncCrypto.deriveSecret(shared, code, deviceId, pcId))
        }
    }

    fun postJson(path: String, body: JSONObject): JSONObject {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        val (req, sig) = signed(Request.Builder().url(url(path)).post(bytes.toRequestBody(jsonType)), "POST", path, SyncCrypto.sha256hex(bytes))
        http.newCall(req).execute().use { res -> return verifiedJson(res, sig) }
    }

    /** 폰 → PC 업로드. 서명에 본문 해시가 들어가서 파일을 한 번 읽어 해시한 뒤 보낸다 */
    fun upload(qh: String, phonePath: String, resolver: ContentResolver, uri: Uri, size: Long): JSONObject {
        val bodyHash = sha256Of(resolver, uri)
        val body = object : RequestBody() {
            override fun contentType() = binType

            override fun contentLength() = size

            override fun writeTo(sink: BufferedSink) {
                val input = resolver.openInputStream(uri) ?: throw IOException("파일을 열 수 없어요")
                input.use { sink.writeAll(it.source()) }
            }
        }
        val path = "/sync/file/$qh"
        val (req, sig) = signed(Request.Builder().url(url(path)).put(body).header("X-SM-Path", Uri.encode(phonePath)), "PUT", path, bodyHash)
        http.newCall(req).execute().use { res -> return verifiedJson(res, sig) }
    }

    /** PC → 폰 다운로드. 응답 본문 대신, 받은 파일의 quick hash가 요청한 ID와 같은지로 확인한다 (MediaSaver) */
    fun download(id: String, out: OutputStream): Long {
        val path = "/sync/file/$id"
        val (req, _) = signed(Request.Builder().url(url(path)).get(), "GET", path, SyncCrypto.EMPTY_SHA256)
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw PcException(errorOf(res), res.code)
            val body = res.body ?: throw PcException("PC가 빈 응답을 보냈어요")
            return body.byteStream().use { it.copyTo(out, 64 * 1024) }
        }
    }

    private fun signed(builder: Request.Builder, method: String, path: String, bodyHash: String): Pair<Request, String> {
        val key = secret ?: throw PcException("PC와 아직 연결되지 않았어요")
        val time = System.currentTimeMillis()
        val sig = SyncCrypto.signRequest(key, method, path, time, bodyHash)
        builder
            .header("X-SM-Device", deviceId)
            .header("X-SM-Time", time.toString())
            .header("X-SM-Body", bodyHash)
            .header("X-SM-Sig", sig)
        return builder.build() to sig
    }

    private fun verifiedJson(res: Response, requestSig: String): JSONObject {
        val bytes = res.body?.bytes() ?: ByteArray(0)
        val text = String(bytes, Charsets.UTF_8)
        if (!res.isSuccessful) {
            val msg = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
            throw PcException(msg.ifEmpty { "PC 오류 (${res.code})" }, res.code)
        }
        val h = SyncCrypto.sha256hex(bytes)
        val ok = res.header("X-SM-Body") == h &&
            SyncCrypto.safeEquals(SyncCrypto.signResponse(secret!!, requestSig, h), res.header("X-SM-Sig").orEmpty())
        if (!ok) throw PcException("PC 응답 서명이 맞지 않아요 (같은 Wi-Fi의 다른 기기가 끼어들었을 수 있어요)")
        return JSONObject(text)
    }

    private fun errorOf(res: Response): String {
        val msg = runCatching { JSONObject(res.body?.string().orEmpty()).optString("error") }.getOrNull().orEmpty()
        return msg.ifEmpty { "PC 오류 (${res.code})" }
    }

    private fun sha256Of(resolver: ContentResolver, uri: Uri): String {
        val md = MessageDigest.getInstance("SHA-256")
        val input = resolver.openInputStream(uri) ?: throw IOException("파일을 열 수 없어요")
        input.use {
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = it.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return SyncCrypto.hex(md.digest())
    }
}
