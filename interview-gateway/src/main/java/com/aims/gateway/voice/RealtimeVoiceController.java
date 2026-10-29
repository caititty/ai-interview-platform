package com.aims.gateway.voice;

import com.aims.core.common.ErrorCode;
import com.aims.core.common.Result;
import com.aims.core.common.exception.BizException;
import com.aims.infra.persistence.entity.InterviewSessionEntity;
import com.aims.infra.persistence.service.InterviewSessionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class RealtimeVoiceController {
    private final RealtimeVoiceService voice;
    private final InterviewSessionService interviews;

    public RealtimeVoiceController(RealtimeVoiceService voice, InterviewSessionService interviews) {
        this.voice = voice;
        this.interviews = interviews;
    }

    public record ConnectionRequest(@NotBlank String connectionId) {}

    public record SpeakRequest(@NotBlank String connectionId, @NotNull Long roundId) {}

    @GetMapping("/voice/config")
    public Result<RealtimeVoiceService.Availability> config() {
        return Result.ok(voice.availability());
    }

    @PostMapping("/interviews/{sessionId}/voice/connect")
    public Result<RealtimeVoiceService.Ticket> connect(
            @PathVariable Long sessionId, Authentication auth) {
        return Result.ok(voice.open(sessionId, requireAccess(sessionId, auth)));
    }

    @PostMapping("/interviews/{sessionId}/voice/start")
    public Result<Void> start(
            @PathVariable Long sessionId,
            @Valid @RequestBody ConnectionRequest body,
            Authentication auth) {
        voice.start(sessionId, requireAccess(sessionId, auth), body.connectionId());
        return Result.ok(null);
    }

    @PostMapping("/interviews/{sessionId}/voice/heartbeat")
    public Result<Void> heartbeat(
            @PathVariable Long sessionId,
            @Valid @RequestBody ConnectionRequest body,
            Authentication auth) {
        voice.heartbeat(sessionId, requireAccess(sessionId, auth), body.connectionId());
        return Result.ok(null);
    }

    @PostMapping("/interviews/{sessionId}/voice/speak")
    public Result<Void> speak(
            @PathVariable Long sessionId,
            @Valid @RequestBody SpeakRequest body,
            Authentication auth) {
        voice.speak(sessionId, requireAccess(sessionId, auth), body.connectionId(), body.roundId());
        return Result.ok(null);
    }

    @PostMapping("/interviews/{sessionId}/voice/interrupt")
    public Result<Void> interrupt(
            @PathVariable Long sessionId,
            @Valid @RequestBody ConnectionRequest body,
            Authentication auth) {
        voice.interrupt(sessionId, requireAccess(sessionId, auth), body.connectionId());
        return Result.ok(null);
    }

    @PostMapping("/interviews/{sessionId}/voice/stop")
    public Result<Void> stop(
            @PathVariable Long sessionId,
            @Valid @RequestBody ConnectionRequest body,
            Authentication auth) {
        voice.stop(sessionId, requireAccess(sessionId, auth), body.connectionId());
        return Result.ok(null);
    }

    /** 与现有 WS 相同：候选人只能操作自己的会话，观察者不能连接麦克风。 */
    String requireAccess(Long sessionId, Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) throw new BizException(ErrorCode.UNAUTHORIZED);
        InterviewSessionEntity interview = interviews.getById(sessionId);
        boolean guest =
                auth.getAuthorities().stream().anyMatch(a -> "ROLE_GUEST".equals(a.getAuthority()));
        if (guest) {
            if (!(auth.getDetails() instanceof Number sid)
                    || sid.longValue() != sessionId
                    || !"CANDIDATE_ONLY".equals(interview.getAccessMode())) {
                throw new BizException(ErrorCode.ACCESS_DENIED);
            }
        } else if (Objects.equals(interview.getAccessMode(), "CANDIDATE_ONLY")) {
            throw new BizException(ErrorCode.ACCESS_DENIED, "观察者不能开启候选人的麦克风");
        }
        return guest ? "guest:" + sessionId : "user:" + auth.getName();
    }
}
