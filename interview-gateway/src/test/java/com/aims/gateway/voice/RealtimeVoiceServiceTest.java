package com.aims.gateway.voice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.aims.core.common.exception.BizException;
import com.aims.infra.persistence.entity.InterviewRoundEntity;
import com.aims.infra.persistence.entity.InterviewSessionEntity;
import com.aims.infra.persistence.service.InterviewRoundService;
import com.aims.infra.persistence.service.InterviewSessionService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

class RealtimeVoiceServiceTest {
    private final RtcVoiceApi api = mock(RtcVoiceApi.class);
    private final InterviewSessionService interviews = mock(InterviewSessionService.class);
    private final InterviewRoundService rounds = mock(InterviewRoundService.class);
    private final MutableClock clock = new MutableClock();
    private final RealtimeVoiceService service =
            new RealtimeVoiceService(config("test-ak", "test-sk"), api, interviews, rounds, clock);
    private InterviewSessionEntity interview;

    private static RealtimeVoiceProperties config(String ak, String sk) {
        return new RealtimeVoiceProperties(
                true,
                "0123456789abcdef01234567",
                "test-app-key",
                ak,
                sk,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                3600);
    }

    @BeforeEach
    void setup() {
        interview = new InterviewSessionEntity();
        interview.setId(1L);
        interview.setStatus("IN_PROGRESS");
        interview.setAccessMode("NONE");
        when(interviews.getById(1L)).thenReturn(interview);
    }

    @Test
    void incompleteConfigurationCannotCreateACloudTask() {
        var unconfigured = new RealtimeVoiceService(config("", ""), api, interviews, rounds, clock);
        assertThat(unconfigured.availability().missing())
                .containsExactly("VOLC_RTC_ACCESS_KEY_ID", "VOLC_RTC_SECRET_ACCESS_KEY");
        assertThatThrownBy(() -> unconfigured.open(1L, "user:admin"))
                .isInstanceOf(BizException.class);
        verifyNoInteractions(api);
    }

    @Test
    void startsRecognitionAndPlaybackWithoutAnIndependentLlm() {
        var ticket = service.open(1L, "user:admin");
        service.start(1L, "user:admin", ticket.connectionId());
        service.start(1L, "user:admin", ticket.connectionId());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> request = ArgumentCaptor.forClass(Map.class);
        verify(api).call(eq("StartVoiceChat"), request.capture());
        assertThat(request.getValue()).containsEntry("RoomId", ticket.roomId());
        Map<?, ?> config = (Map<?, ?>) request.getValue().get("Config");
        assertThat(config.get("InterruptMode")).isEqualTo(0);
        assertThat(config.get("LLMConfig")).isEqualTo(Map.of("AutoActive", false));
        assertThatThrownBy(() -> service.open(1L, "user:other")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> service.heartbeat(1L, "user:other", ticket.connectionId()))
                .isInstanceOf(BizException.class);
    }

    @Test
    void onlySpeaksQuestionsFromThisInterviewAndDeduplicatesRetries() {
        var ticket = service.open(1L, "user:admin");
        service.start(1L, "user:admin", ticket.connectionId());
        InterviewRoundEntity round = new InterviewRoundEntity();
        round.setId(7L);
        round.setSessionId(1L);
        round.setQuestion("请介绍一下 Java 的线程池。");
        when(rounds.listBySession(1L)).thenReturn(List.of(round));
        assertThatThrownBy(() -> service.speak(1L, "user:admin", ticket.connectionId(), 999L))
                .isInstanceOf(BizException.class);
        service.speak(1L, "user:admin", ticket.connectionId(), 7L);
        service.speak(1L, "user:admin", ticket.connectionId(), 7L);
        verify(api, times(1)).call(eq("UpdateVoiceChat"), anyMap());
    }

    @Test
    void lostHeartbeatStopsTheCloudTaskAndReleasesTheSlot() {
        var ticket = service.open(1L, "user:admin");
        service.start(1L, "user:admin", ticket.connectionId());
        clock.advance(61);
        service.cleanup();
        verify(api).call(eq("StopVoiceChat"), anyMap());
        assertThat(service.open(1L, "user:admin").connectionId())
                .isNotEqualTo(ticket.connectionId());
    }

    @Test
    void pausedOrFinishedInterviewsReleaseVoiceResources() {
        var ticket = service.open(1L, "user:admin");
        service.start(1L, "user:admin", ticket.connectionId());
        interview.setStatus("PAUSED");
        service.cleanup();
        verify(api).call(eq("StopVoiceChat"), anyMap());
        assertThatThrownBy(() -> service.open(1L, "user:admin")).isInstanceOf(BizException.class);
    }

    @Test
    void failedStopsAreRetriedInsteadOfForgettingTheCloudTask() {
        var ticket = service.open(1L, "user:admin");
        service.start(1L, "user:admin", ticket.connectionId());
        doThrow(new IllegalStateException("temporary network failure"))
                .doNothing()
                .when(api)
                .call(eq("StopVoiceChat"), anyMap());
        assertThatThrownBy(() -> service.stop(1L, "user:admin", ticket.connectionId()))
                .isInstanceOf(IllegalStateException.class);
        service.cleanup();
        verify(api, times(2)).call(eq("StopVoiceChat"), anyMap());
        assertThat(service.open(1L, "user:admin")).isNotNull();
    }

    @Test
    void rejectedStartsReleaseTheSlotWithoutTryingToStopAnUnacceptedTask() {
        var ticket = service.open(1L, "user:admin");
        doThrow(new RtcVoiceApi.Rejected("AccessDenied"))
                .when(api)
                .call(eq("StartVoiceChat"), anyMap());
        assertThatThrownBy(() -> service.start(1L, "user:admin", ticket.connectionId()))
                .isInstanceOf(BizException.class);
        service.stop(1L, "user:admin", ticket.connectionId());
        verify(api, never()).call(eq("StopVoiceChat"), anyMap());
        assertThat(service.open(1L, "user:admin")).isNotNull();
    }

    @Test
    void guestsAreBoundToTheirInterviewAndObserversCannotOpenMicrophones() {
        var controller = new RealtimeVoiceController(service, interviews);
        var guest =
                UsernamePasswordAuthenticationToken.authenticated(
                        "guest", null, List.of(new SimpleGrantedAuthority("ROLE_GUEST")));
        guest.setDetails(2L);
        interview.setAccessMode("CANDIDATE_ONLY");
        assertThatThrownBy(() -> controller.requireAccess(1L, guest))
                .isInstanceOf(BizException.class);
        guest.setDetails(1L);
        assertThat(controller.requireAccess(1L, guest)).isEqualTo("guest:1");
        var admin =
                UsernamePasswordAuthenticationToken.authenticated(
                        "admin", null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        assertThatThrownBy(() -> controller.requireAccess(1L, admin))
                .isInstanceOf(BizException.class);
        interview.setAccessMode("DISABLED");
        assertThatThrownBy(() -> controller.requireAccess(1L, guest))
                .isInstanceOf(BizException.class);
    }

    private static final class MutableClock extends Clock {
        private Instant instant = Instant.parse("2026-10-27T05:00:00Z");

        void advance(long seconds) {
            instant = instant.plusSeconds(seconds);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
