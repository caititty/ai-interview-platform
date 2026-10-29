package com.aims.gateway.voice;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class RtcProtocolTest {
    @Test
    void tokenMatchesTheOfficialPythonImplementation() {
        // 官方 AccessToken.py：固定 nonce / issued_at，发布与订阅权限，非真实凭据。
        String token =
                RtcTokenGenerator.generate(
                        "0123456789abcdef01234567",
                        "test-app-key",
                        "aims_test",
                        "user_test",
                        1700000000,
                        1700003600,
                        12345);
        assertThat(token)
                .isEqualTo(
                        "0010123456789abcdef01234567QgA5MAAAAPFTZRD/U2UJAGFpbXNfdGVzdAkAdXNlcl90ZXN0BQAAABD/U2UBABD/U2UCABD/U2UDABD/U2UEABD/U2UgAHrvquJReUZjDsDuQ3gTOfInBOdvCYi7i4ueKe/zR+k6");
        assertThat(token).doesNotContain("test-app-key");
    }

    @Test
    void openApiSignatureMatchesTheOfficialPythonImplementation() {
        var headers =
                VolcRtcSigner.sign(
                        URI.create("https://rtc.volcengineapi.com"),
                        "Action=StartVoiceChat&Version=2025-06-01",
                        "{\"AppId\":\"test\"}",
                        "test-ak",
                        "test-sk",
                        "cn-north-1",
                        Instant.parse("2026-10-27T05:00:00Z"));
        assertThat(headers.get("X-Date")).isEqualTo("20261027T050000Z");
        assertThat(headers.get("Authorization"))
                .isEqualTo(
                        "HMAC-SHA256 Credential=test-ak/20261027/cn-north-1/rtc/request,"
                            + " SignedHeaders=content-type;host;x-content-sha256;x-date,"
                            + " Signature=4e3f738a8824fd86cd56ca4186b79f987319243d0753c5238a91308c93e7b123");
    }
}
