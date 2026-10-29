package com.aims.gateway.voice;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(RealtimeVoiceProperties.class)
@EnableScheduling
public class RealtimeVoiceConfiguration {}
