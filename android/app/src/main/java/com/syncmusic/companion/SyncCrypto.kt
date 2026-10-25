package com.syncmusic.companion

import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PC의 pc/src/sync/crypto.js와 바이트 단위로 같은 계산 (docs/PLAN.md 6.2~6.3).
 * 안드로이드 API 없이 순수 JVM 코드라서 단위 테스트(ProtocolTest)로 PC 값과 비교한다.
 */
object SyncCrypto {
    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    fun hex(bytes: ByteArray): String {
        val digits = "0123456789abcdef"
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            sb.append(digits[v ushr 4]).append(digits[v and 0x0f])
        }
        return sb.toString()
    }

    fun sha256hex(data: ByteArray): String = hex(sha256(data))

    val EMPTY_SHA256: String = sha256hex(ByteArray(0))

    fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)

    fun hmac(key: ByteArray, message: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(message.toByteArray(Charsets.UTF_8))
    }

    /** 요청 서명: HMAC(비밀키, METHOD \n 경로?쿼리 \n 시간 \n 본문해시) */
    fun signRequest(secret: ByteArray, method: String, pathWithQuery: String, time: Long, bodyHash: String): String =
        b64(hmac(secret, "${method.uppercase()}\n$pathWithQuery\n$time\n$bodyHash"))

    /** PC 응답 서명: 가짜 PC가 끼어들지 않았는지 확인 */
    fun signResponse(secret: ByteArray, requestSig: String, bodyHash: String): String =
        b64(hmac(secret, "resp\n$requestSig\n$bodyHash"))

    /** 페어링 증명: HMAC(키 = 6자리 코드, "부분1|부분2|...") */
    fun pairProof(code: String, vararg parts: String): String =
        b64(hmac(code.toByteArray(Charsets.UTF_8), parts.joinToString("|")))

    fun safeEquals(a: String, b: String): Boolean =
        MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

    // ───── ECDH P-256. 공개키는 비압축 65바이트(0x04 ‖ X ‖ Y) ─────

    private val P256: ECParameterSpec by lazy { (newKeyPair().public as ECPublicKey).params }

    fun newKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").run {
        initialize(ECGenParameterSpec("secp256r1"))
        generateKeyPair()
    }

    fun encodePublic(key: PublicKey): ByteArray {
        val w = (key as ECPublicKey).w
        return byteArrayOf(4) + fixed32(w.affineX) + fixed32(w.affineY)
    }

    fun decodePublic(raw: ByteArray): PublicKey {
        require(raw.size == 65 && raw[0] == 4.toByte()) { "공개키 형식이 올바르지 않아요" }
        val point = ECPoint(BigInteger(1, raw.copyOfRange(1, 33)), BigInteger(1, raw.copyOfRange(33, 65)))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, P256))
    }

    fun privateFromScalar(scalar: ByteArray): PrivateKey =
        KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, scalar), P256))

    /** 결과는 공유점의 X 좌표 32바이트 (Node의 ecdh.computeSecret과 같음) */
    fun ecdh(privateKey: PrivateKey, peer: PublicKey): ByteArray = KeyAgreement.getInstance("ECDH").run {
        init(privateKey)
        doPhase(peer, true)
        generateSecret()
    }

    /** RFC 5869 HKDF-SHA256 (Node의 crypto.hkdfSync와 같음) */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int = 32): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = mac.doFinal(ikm)
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        val out = ByteArray(length)
        var block = ByteArray(0)
        var pos = 0
        var counter = 1
        while (pos < length) {
            mac.update(block)
            mac.update(info)
            mac.update(counter.toByte())
            block = mac.doFinal()
            val n = minOf(block.size, length - pos)
            System.arraycopy(block, 0, out, pos, n)
            pos += n
            counter++
        }
        return out
    }

    fun deriveSecret(shared: ByteArray, code: String, deviceId: String, pcId: String): ByteArray =
        hkdf(shared, code.toByteArray(Charsets.UTF_8), "SyncMusic pair v1|$deviceId|$pcId".toByteArray(Charsets.UTF_8))

    private fun fixed32(n: BigInteger): ByteArray {
        val raw = n.toByteArray()
        return when {
            raw.size == 32 -> raw
            raw.size > 32 -> raw.copyOfRange(raw.size - 32, raw.size)
            else -> ByteArray(32 - raw.size) + raw
        }
    }
}
