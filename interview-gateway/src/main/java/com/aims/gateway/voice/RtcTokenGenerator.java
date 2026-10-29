package com.aims.gateway.voice;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * RTC 001 Token 编码。协议参考火山官方 MIT 示例：
 * https://github.com/volcengine/rtc-aigc-embedded-demo/blob/master/server/src/AccessToken.py
 */
final class RtcTokenGenerator {
    private static final SecureRandom RANDOM = new SecureRandom();

    private RtcTokenGenerator() {}

    static String generate(
            String appId, String appKey, String roomId, String userId, long now, long expiresAt) {
        return generate(
                appId, appKey, roomId, userId, now, expiresAt, RANDOM.nextInt(Integer.MAX_VALUE));
    }

    static String generate(
            String appId,
            String appKey,
            String roomId,
            String userId,
            long now,
            long expiresAt,
            int nonce) {
        ByteBuffer message = ByteBuffer.allocate(1024).order(ByteOrder.LITTLE_ENDIAN);
        message.putInt(nonce).putInt(Math.toIntExact(now)).putInt(Math.toIntExact(expiresAt));
        putBytes(message, roomId.getBytes(StandardCharsets.UTF_8));
        putBytes(message, userId.getBytes(StandardCharsets.UTF_8));
        message.putShort((short) 5);
        // 官方 PrivPublishStream 展开为 0..3，PrivSubscribeStream 为 4。
        for (short privilege = 0; privilege <= 4; privilege++) {
            message.putShort(privilege).putInt(Math.toIntExact(expiresAt));
        }
        byte[] payload = new byte[message.position()];
        message.flip().get(payload);
        byte[] signature = hmac(appKey.getBytes(StandardCharsets.UTF_8), payload);
        ByteBuffer content =
                ByteBuffer.allocate(payload.length + signature.length + 4)
                        .order(ByteOrder.LITTLE_ENDIAN);
        putBytes(content, payload);
        putBytes(content, signature);
        return "001" + appId + Base64.getEncoder().encodeToString(content.array());
    }

    static byte[] hmac(byte[] key, byte[] message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (Exception e) {
            throw new IllegalStateException("无法生成 RTC 签名", e);
        }
    }

    private static void putBytes(ByteBuffer buffer, byte[] value) {
        buffer.putShort((short) value.length).put(value);
    }
}
