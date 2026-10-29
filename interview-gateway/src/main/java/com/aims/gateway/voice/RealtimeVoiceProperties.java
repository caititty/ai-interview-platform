package com.aims.gateway.voice;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** RTC 控制面凭据仅保存在服务端，浏览器只接收房间范围内的短期 Token。 */
@ConfigurationProperties("aims.voice")
public record RealtimeVoiceProperties(
        boolean enabled,
        String appId,
        String appKey,
        String accessKeyId,
        String secretAccessKey,
        String endpoint,
        String region,
        String apiVersion,
        String botPrefix,
        String asrResourceId,
        String ttsResourceId,
        String speaker,
        int tokenTtlSeconds) {

    public RealtimeVoiceProperties {
        endpoint = fallback(endpoint, "https://rtc.volcengineapi.com").replaceAll("/+$", "");
        region = fallback(region, "cn-north-1");
        apiVersion = fallback(apiVersion, "2025-06-01");
        botPrefix = fallback(botPrefix, "aims_bot");
        asrResourceId = fallback(asrResourceId, "volc.bigasr.sauc.duration");
        ttsResourceId = fallback(ttsResourceId, "seed-tts-2.0");
        speaker = fallback(speaker, "zh_male_m191_uranus_bigtts");
        tokenTtlSeconds = tokenTtlSeconds == 0 ? 3600 : Math.clamp(tokenTtlSeconds, 120, 3600);
    }

    public List<String> missing() {
        List<String> missing = new ArrayList<>();
        if (appId == null || !appId.matches("[a-zA-Z0-9]{24}")) missing.add("VOLC_RTC_APP_ID");
        if (appKey == null || appKey.isBlank()) missing.add("VOLC_RTC_APP_KEY");
        if (accessKeyId == null || accessKeyId.isBlank()) missing.add("VOLC_RTC_ACCESS_KEY_ID");
        if (secretAccessKey == null || secretAccessKey.isBlank())
            missing.add("VOLC_RTC_SECRET_ACCESS_KEY");
        return List.copyOf(missing);
    }

    private static String fallback(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
