package com.syncmusic.companion

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * PC(Node)와 바이트 단위로 같은 값이 나오는지 확인한다.
 * 기준값은 pc/tools/protocol-vectors.js 로 만들었다 (PC 코드가 바뀌면 다시 만들어 붙일 것).
 */
class ProtocolTest {
    private fun unhex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    @Test
    fun ecdhAndDerivedSecretMatchPc() {
        val shared = SyncCrypto.ecdh(SyncCrypto.privateFromScalar(unhex(PRIV_A)), SyncCrypto.decodePublic(unhex(PUB_B)))
        assertEquals(SHARED, SyncCrypto.hex(shared))
        assertEquals(SECRET, SyncCrypto.hex(SyncCrypto.deriveSecret(shared, "123456", "dev-12345678", "pc-0001")))
    }

    @Test
    fun publicKeyEncodingRoundTrips() {
        assertEquals(PUB_A, SyncCrypto.hex(SyncCrypto.encodePublic(SyncCrypto.decodePublic(unhex(PUB_A)))))
    }

    @Test
    fun freshKeyPairsAgree() {
        val a = SyncCrypto.newKeyPair()
        val b = SyncCrypto.newKeyPair()
        val ab = SyncCrypto.ecdh(a.private, SyncCrypto.decodePublic(SyncCrypto.encodePublic(b.public)))
        val ba = SyncCrypto.ecdh(b.private, SyncCrypto.decodePublic(SyncCrypto.encodePublic(a.public)))
        assertArrayEquals(ab, ba)
        assertEquals(65, SyncCrypto.encodePublic(a.public).size)
    }

    @Test
    fun requestAndResponseSignaturesMatchPc() {
        val secret = unhex(SECRET)
        val bodyHash = SyncCrypto.sha256hex("{\"hello\":\"폰\"}".toByteArray(Charsets.UTF_8))
        assertEquals(BODY_HASH, bodyHash)
        val sig = SyncCrypto.signRequest(secret, "POST", "/sync/manifest", 1700000000000, bodyHash)
        assertEquals(SIG, sig)
        assertEquals(RESP_SIG, SyncCrypto.signResponse(secret, sig, SyncCrypto.sha256hex("{}".toByteArray())))
    }

    @Test
    fun pairingProofMatchesPc() {
        assertEquals(PROOF, SyncCrypto.pairProof("123456", "pair1", "dev-12345678", "AAAA"))
    }

    @Test
    fun quickHashMatchesPc() {
        assertEquals(QH_BIG, QuickHash.ofBytes(ByteArray(200000) { (it % 251).toByte() }))
        assertEquals(QH_SMALL, QuickHash.ofBytes(ByteArray(1000) { ((it * 7) % 256).toByte() }))
        assertEquals(QH_EMPTY, QuickHash.ofBytes(ByteArray(0)))
    }

    companion object {
        const val PRIV_A = "1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f"
        const val PUB_A = "046bf85d5fe84598b10ca6199ec09ccd7d35dcd7195fdd1dc7737a0c67006ef251b952f25eec1deed1fca191838990466357d314adfb7e9760b8d9afc8f39a95ad"
        const val PUB_B = "04039b852db622408abe58a18c0f056631a6ca4b2cfeec198aae25017cad09d4e8e208b616e0dc5775a5d840775d38dafd4676da34100215e8be857bed2ba4ac30"
        const val SHARED = "8ff9d3b60959e96d66f6099897f6a9ef3c905352d6deb18885c22cdcc693b073"
        const val SECRET = "54c0c2fb662638b29d9b30c0e3ae03491f65a4e1e1cdc4d100148b52005dc1bf"
        const val BODY_HASH = "1d8e13dabdae430b55427e81b35530b3f860b8904dac2d8a494a3a56dc529b5c"
        const val SIG = "gH+xrk6at30z2LaMReKg6UG4lTd8gS1cWSgr71mIDVY="
        const val RESP_SIG = "WUs9/mXql6wZVI8PkcZD95pA6HU0cZ+kTwHdQs7Knpw="
        const val PROOF = "e9xf9tPVBujtbRAPJmoTQoPL8xXFDM/xlsB/yuUiySg="
        const val QH_BIG = "84e01709c427c78312b2469f33ae47bc"
        const val QH_SMALL = "7a797f004054a057efc95aca7fe0253e"
        const val QH_EMPTY = "af5570f5a1810b7af78caf4bc70a660f"
    }
}
