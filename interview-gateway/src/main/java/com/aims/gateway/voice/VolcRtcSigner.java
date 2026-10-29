package com.aims.gateway.voice;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 火山 OpenAPI V4 HMAC-SHA256 签名，签名与请求使用完全相同的 JSON 字节。 协议参考官方 MIT 示例
 * rtc-aigc-embedded-demo/server/src/RtcApiRequester.py。
 */
final class VolcRtcSigner {
    private static final DateTimeFormatter DATE =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private static final String SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";

    private VolcRtcSigner() {}

    static Map<String, String> sign(
            URI endpoint,
            String query,
            String body,
            String accessKey,
            String secretKey,
            String region,
            Instant now) {
        String date = DATE.format(now);
        String day = date.substring(0, 8);
        String hash = sha256(body);
        String headers =
                "content-type:application/json\nhost:"
                        + endpoint.getAuthority()
                        + "\nx-content-sha256:"
                        + hash
                        + "\nx-date:"
                        + date
                        + "\n";
        String path = endpoint.getRawPath().isEmpty() ? "/" : endpoint.getRawPath();
        String canonical =
                "POST\n"
                        + path
                        + "\n"
                        + query
                        + "\n"
                        + headers
                        + "\n"
                        + SIGNED_HEADERS
                        + "\n"
                        + hash;
        String scope = day + "/" + region + "/rtc/request";
        String toSign = "HMAC-SHA256\n" + date + "\n" + scope + "\n" + sha256(canonical);
        byte[] key = RtcTokenGenerator.hmac(bytes(secretKey), bytes(day));
        key = RtcTokenGenerator.hmac(key, bytes(region));
        key = RtcTokenGenerator.hmac(key, bytes("rtc"));
        key = RtcTokenGenerator.hmac(key, bytes("request"));
        String signature = HexFormat.of().formatHex(RtcTokenGenerator.hmac(key, bytes(toSign)));
        Map<String, String> result = new LinkedHashMap<>();
        result.put("Content-Type", "application/json");
        result.put("X-Date", date);
        result.put("X-Content-Sha256", hash);
        result.put(
                "Authorization",
                "HMAC-SHA256 Credential="
                        + accessKey
                        + "/"
                        + scope
                        + ", SignedHeaders="
                        + SIGNED_HEADERS
                        + ", Signature="
                        + signature);
        return result;
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(bytes(value)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
