package com.aims.gateway.voice;

import com.aims.core.common.ErrorCode;
import com.aims.core.common.exception.BizException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class RtcVoiceApi {
    static final class Rejected extends BizException {
        Rejected(String code) {
            super(ErrorCode.INFRA_UNAVAILABLE, "火山实时语音调用失败：" + code);
        }
    }

    private static final Logger log = LoggerFactory.getLogger(RtcVoiceApi.class);
    private final RealtimeVoiceProperties config;
    private final ObjectMapper mapper;
    private final HttpClient client =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public RtcVoiceApi(RealtimeVoiceProperties config, ObjectMapper mapper) {
        this.config = config;
        this.mapper = mapper;
    }

    public void call(String action, Map<String, Object> payload) {
        try {
            String body = mapper.writeValueAsString(payload);
            URI endpoint = URI.create(config.endpoint());
            String query = "Action=" + action + "&Version=" + config.apiVersion();
            HttpRequest.Builder request =
                    HttpRequest.newBuilder(URI.create(config.endpoint() + "/?" + query))
                            .timeout(Duration.ofSeconds(12))
                            .POST(HttpRequest.BodyPublishers.ofString(body));
            VolcRtcSigner.sign(
                            endpoint,
                            query,
                            body,
                            config.accessKeyId(),
                            config.secretAccessKey(),
                            config.region(),
                            Instant.now())
                    .forEach(request::header);
            HttpResponse<String> response =
                    client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode result = mapper.readTree(response.body());
            JsonNode error = result.path("ResponseMetadata").path("Error");
            if (response.statusCode() / 100 != 2 || error.isObject()) {
                String code = error.path("Code").asText("HTTP_" + response.statusCode());
                log.warn(
                        "RTC action={} code={} requestId={}",
                        action,
                        code,
                        result.path("ResponseMetadata").path("RequestId").asText());
                throw new Rejected(code);
            }
        } catch (BizException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException(ErrorCode.INFRA_UNAVAILABLE, "实时语音请求被中断");
        } catch (Exception e) {
            log.warn("RTC action={} transportError={}", action, e.getClass().getSimpleName());
            throw new BizException(ErrorCode.INFRA_UNAVAILABLE, "实时语音服务连接失败，请稍后重试");
        }
    }
}
