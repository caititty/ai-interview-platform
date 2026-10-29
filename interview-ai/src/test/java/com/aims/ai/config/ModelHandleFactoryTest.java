package com.aims.ai.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.aims.ai.advisor.LoggingAdvisor;
import com.aims.ai.advisor.RetryAdvisor;
import com.aims.ai.advisor.TokenMeterAdvisor;
import com.aims.ai.router.ModelTier;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.ai.openai.api.OpenAiApi;

class ModelHandleFactoryTest {

    @ParameterizedTest
    @CsvSource({
        "'', /v1/chat/completions",
        "/compatible-mode, /compatible-mode/v1/chat/completions",
        "/compatible-mode/v1, /compatible-mode/v1/chat/completions",
        "/api/coding/v3, /api/coding/v3/chat/completions",
        "/api/coding/v3/, /api/coding/v3/chat/completions"
    })
    void sendsChatRequestsToTheConfiguredApiVersion(String basePath, String expectedPath)
            throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestPath = new AtomicReference<>();
        server.createContext(
                "/",
                exchange -> {
                    requestPath.set(exchange.getRequestURI().getPath());
                    exchange.getRequestBody().readAllBytes();
                    byte[] response =
                            "{\"id\":\"test\",\"choices\":[],\"model\":\"test\"}"
                                    .getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + basePath;
            AiModelProperties properties =
                    new AiModelProperties(
                            ModelTier.STANDARD,
                            Map.of(
                                    "test",
                                    new AiModelProperties.ProviderConfig(
                                            baseUrl, "test-key", null, null)),
                            Map.of(),
                            Map.of(),
                            null);
            ModelHandleFactory factory =
                    new ModelHandleFactory(
                            mock(LoggingAdvisor.class),
                            mock(TokenMeterAdvisor.class),
                            mock(RetryAdvisor.class));
            OpenAiApi api = factory.buildApis(properties).get("test");
            api.chatCompletionEntity(
                    new OpenAiApi.ChatCompletionRequest(
                            List.of(
                                    new OpenAiApi.ChatCompletionMessage(
                                            "hello", OpenAiApi.ChatCompletionMessage.Role.USER)),
                            "test",
                            0.2));
            assertThat(requestPath.get()).isEqualTo(expectedPath);
        } finally {
            server.stop(0);
        }
    }
}
